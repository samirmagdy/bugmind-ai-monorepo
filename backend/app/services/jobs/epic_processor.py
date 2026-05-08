import asyncio
import logging
from typing import cast, Optional
from sqlalchemy.orm import Session
from app.core.security import decrypt_credential
from app.services.jobs.worker import update_job_progress, check_cancelled
from app.services.jira.bulk_epic_service import fetch_epic_children
from app.services.jira.connection_service import get_adapter, get_owned_connection
from app.services.ai.test_case_generator import TestCaseGenerator
from app.services.ai.workflows import bulk_analyze_stories_response, bulk_compare_brd_response
from app.models.user import User
from app.schemas.bug import BulkAnalyzeRequest, BulkBrdCompareRequest, BulkStoryInput

logger = logging.getLogger(__name__)

def _job_story_inputs(stories) -> list[BulkStoryInput]:
    return [
        BulkStoryInput(
            key=story.key,
            summary=story.summary,
            description=story.description,
        )
        for story in stories
    ]


async def epic_test_generation_processor(job_id: str, db: Session, user: User, connection_id: int, epic_key: str, issue_type_id: str):
    """
    Process an epic for test generation.
    1. Fetch epic and children stories.
    2. Iterate through stories.
    3. Truncate context and generate tests.
    4. Save partial results.
    """
    try:
        if check_cancelled(db, job_id):
            return

        update_job_progress(db, job_id, 5.0, "Fetching Epic Children", {"stories": [], "epic_key": epic_key})
        
        conn = get_owned_connection(db, cast(int, user.id), connection_id)
        adapter = get_adapter(conn)
        
        # 1. Fetch Epic Children
        bulk_fetch_response = fetch_epic_children(adapter, epic_key, max_results=50)
        stories = bulk_fetch_response.issues
        total_stories = len(stories)
        
        if total_stories == 0:
            update_job_progress(db, job_id, 100.0, "Completed - No Stories Found", {"stories": [], "epic_key": epic_key, "warnings": ["No stories found in this epic."]})
            return

        custom_api_key = decrypt_credential(cast(str, user.encrypted_ai_api_key)) if user.encrypted_ai_api_key else None
        ai_generator = TestCaseGenerator(api_key=custom_api_key)
        results = []
        warnings = []
        
        for idx, story in enumerate(stories):
            if check_cancelled(db, job_id):
                break
                
            progress = 10.0 + (90.0 * (idx / total_stories))
            update_job_progress(db, job_id, progress, f"Processing Story {story.key} ({idx+1}/{total_stories})", {
                "stories": results,
                "epic_key": epic_key,
                "warnings": warnings
            })
            
            try:
                # 2. Fetch full issue context to pass to AI (in a real app, use the Jira content parser)
                # But here we already have summary and description from bulk_fetch
                context_text = f"Title: {story.summary}\n\nDescription: {story.description}"
                
                # Truncate to avoid blowing up the context window
                if len(context_text) > 20000:
                    context_text = context_text[:20000] + "\n\n...[TRUNCATED]"
                    warnings.append(f"Story {story.key} was truncated due to length.")

                ai_result = await ai_generator.generate_test_cases(
                    context_text=context_text,
                    model=cast(Optional[str], user.custom_ai_model),
                    issue_type_name="Story",
                    test_categories=["Positive", "Negative", "Boundary", "Regression"],
                )
                
                results.append({
                    "story_key": story.key,
                    "summary": story.summary,
                    "test_cases": ai_result.get("test_cases", []),
                    "coverage_score": ai_result.get("coverage_score", 0),
                    "error": None
                })
            except Exception as e:
                logger.error(f"Failed to generate tests for story {story.key}: {e}")
                results.append({
                    "story_key": story.key,
                    "summary": story.summary,
                    "test_cases": [],
                    "coverage_score": 0,
                    "error": str(e)
                })
            
            # Small delay to yield event loop
            await asyncio.sleep(0.5)

        # Final update
        if not check_cancelled(db, job_id):
            update_job_progress(db, job_id, 100.0, "Completed", {
                "stories": results,
                "epic_key": epic_key,
                "warnings": warnings
            })
            
    except Exception:
        logger.exception(f"Epic job {job_id} failed catastrophically.")
        raise


async def epic_audit_processor(
    job_id: str,
    db: Session,
    user: User,
    connection_id: int,
    epic_key: str,
    issue_type_id: str,
    project_key: str = "",
    project_id: Optional[str] = None,
    issue_type_name: Optional[str] = None,
):
    if check_cancelled(db, job_id):
        return

    update_job_progress(db, job_id, 10.0, "Fetching Epic Children", {"epic_key": epic_key, "findings": []})
    conn = get_owned_connection(db, cast(int, user.id), connection_id)
    adapter = get_adapter(conn)
    bulk_fetch_response = fetch_epic_children(adapter, epic_key, max_results=50)
    stories = _job_story_inputs(bulk_fetch_response.issues)

    if not stories:
        update_job_progress(
            db,
            job_id,
            100.0,
            "Completed - No Stories Found",
            {"epic_key": epic_key, "findings": [], "warnings": ["No stories found in this epic."]},
        )
        return

    if check_cancelled(db, job_id):
        return

    update_job_progress(db, job_id, 45.0, "Running Cross-Story Audit", {"epic_key": epic_key, "story_count": len(stories)})
    result = await bulk_analyze_stories_response(
        BulkAnalyzeRequest(
            jira_connection_id=connection_id,
            project_key=project_key or epic_key.split("-", 1)[0],
            project_id=project_id,
            issue_type_id=issue_type_id,
            issue_type_name=issue_type_name,
            stories=stories,
        ),
        db,
        user,
    )
    update_job_progress(db, job_id, 100.0, "Completed", result.model_dump())


async def brd_coverage_processor(
    job_id: str,
    db: Session,
    user: User,
    connection_id: int,
    epic_key: str,
    issue_type_id: str,
    brd_text: str,
    project_key: str = "",
    project_id: Optional[str] = None,
    issue_type_name: Optional[str] = None,
):
    if check_cancelled(db, job_id):
        return

    if not brd_text or not brd_text.strip():
        raise ValueError("BRD text is required for async BRD coverage comparison.")

    update_job_progress(db, job_id, 10.0, "Fetching Epic Children", {"epic_key": epic_key, "findings": []})
    conn = get_owned_connection(db, cast(int, user.id), connection_id)
    adapter = get_adapter(conn)
    bulk_fetch_response = fetch_epic_children(adapter, epic_key, max_results=50)
    stories = _job_story_inputs(bulk_fetch_response.issues)

    if not stories:
        update_job_progress(
            db,
            job_id,
            100.0,
            "Completed - No Stories Found",
            {"epic_key": epic_key, "findings": [], "warnings": ["No stories found in this epic."]},
        )
        return

    if check_cancelled(db, job_id):
        return

    update_job_progress(db, job_id, 45.0, "Comparing BRD to Stories", {"epic_key": epic_key, "story_count": len(stories)})
    result = await bulk_compare_brd_response(
        BulkBrdCompareRequest(
            jira_connection_id=connection_id,
            project_key=project_key or epic_key.split("-", 1)[0],
            project_id=project_id,
            issue_type_id=issue_type_id,
            issue_type_name=issue_type_name,
            stories=stories,
            brd_text=brd_text,
        ),
        db,
        user,
    )
    update_job_progress(db, job_id, 100.0, "Completed", result.model_dump())
