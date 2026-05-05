import asyncio
import logging
from sqlalchemy.orm import Session
from app.services.jobs.worker import update_job_progress, check_cancelled
from app.services.jira.bulk_epic_service import fetch_epic_children
from app.services.jira.connection_service import get_adapter, get_owned_connection
from app.services.ai.test_case_generator import TestCaseGenerator
from app.models.user import User

logger = logging.getLogger(__name__)

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
        
        conn = get_owned_connection(db, connection_id, user.id)
        adapter = get_adapter(conn)
        
        # 1. Fetch Epic Children
        bulk_fetch_response = fetch_epic_children(adapter, epic_key, max_results=50)
        stories = bulk_fetch_response.issues
        total_stories = len(stories)
        
        if total_stories == 0:
            update_job_progress(db, job_id, 100.0, "Completed - No Stories Found", {"stories": [], "epic_key": epic_key, "warnings": ["No stories found in this epic."]})
            return

        ai_generator = TestCaseGenerator()
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

                # Generate tests
                # Here we mock user inputs for test generation request
                # We expect the AI generator to return a TestSuite format.
                ai_result = await ai_generator.generate(
                    context_text=context_text,
                    test_types=["Functional", "Edge Case"],
                    model=user.custom_ai_model,
                    api_key=user.encrypted_ai_api_key,
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
            
    except Exception as e:
        logger.exception(f"Epic job {job_id} failed catastrophically.")
        raise
