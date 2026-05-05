import time
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.core.audit import log_audit
from app.core.rate_limit import rate_limiter
from app.models.user import User
from app.schemas.bug import (
    BulkAnalyzeRequest,
    BulkBrdCompareRequest,
    BulkTestGenerationRequest,
    BulkTestGenerationResponse,
    FindingGenerationRequest,
    GapAnalysisResponse,
    ManualBugGenerationResponse,
    PreviewPreparationRequest,
    PreviewPreparationResponse,
    QualityCheckRequest,
    StoryAnalysisRequest,
    SubmitBugsRequest,
    SubmitBugsResponse,
    TestCaseGenerationRequest,
    TestSuiteResponse,
)
from app.services.ai.workflows import (
    bulk_analyze_stories_response,
    bulk_compare_brd_response,
    generate_bulk_test_suites_response,
    generate_findings_response,
    generate_test_suite_response,
    get_usage_summary,
    prepare_bug_preview_response,
    submit_bugs_response,
)
from app.services.subscription.limit_checker import LimitChecker
from app.services.ai.quality_scorer import score_bug_input
from app.services.ai.story_analyzer import analyze_story_context


router = APIRouter()


@router.get("/usage")
def get_usage(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    return get_usage_summary(db, current_user)


@router.post("/generate", response_model=GapAnalysisResponse)
async def generate_bug_report(
    request: Request,
    req: FindingGenerationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    rate_limiter.check("ai.generate", str(current_user.id), limit=10, window_seconds=60)
    LimitChecker.check_allowed(db, current_user.id)
    start_time = time.monotonic()
    response = await generate_findings_response(req, db, current_user, include_analysis_summary=True)
    duration_ms = int((time.monotonic() - start_time) * 1000)
    LimitChecker.record_usage(db, current_user.id, "/generate", 0)
    log_audit(
        "ai.generate",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        generation_type="gap_analysis",
        output_count=len(response.bugs),
        duration_ms=duration_ms,
        success=True,
    )
    return response


@router.post("/generate/manual", response_model=ManualBugGenerationResponse)
async def generate_manual_bug_report(
    request: Request,
    req: FindingGenerationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    rate_limiter.check("ai.generate", str(current_user.id), limit=10, window_seconds=60)
    LimitChecker.check_allowed(db, current_user.id)
    start_time = time.monotonic()
    response = await generate_findings_response(req, db, current_user, include_analysis_summary=False)
    duration_ms = int((time.monotonic() - start_time) * 1000)
    LimitChecker.record_usage(db, current_user.id, "/generate", 0)
    log_audit(
        "ai.generate.manual",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        generation_type="manual",
        output_count=len(response.bugs),
        duration_ms=duration_ms,
        success=True,
    )
    return response


@router.post("/test-cases", response_model=TestSuiteResponse)
async def generate_test_suite(
    request: Request,
    req: TestCaseGenerationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    rate_limiter.check("ai.test_cases", str(current_user.id), limit=5, window_seconds=60)
    LimitChecker.check_allowed(db, current_user.id)
    start_time = time.monotonic()
    response = await generate_test_suite_response(req, db, current_user)
    duration_ms = int((time.monotonic() - start_time) * 1000)
    LimitChecker.record_usage(db, current_user.id, "/test-cases", 0)
    log_audit(
        "ai.test_cases",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        generation_type="test_cases",
        selected_categories=req.test_categories,
        output_count=len(response.test_cases),
        duration_ms=duration_ms,
        success=True,
    )
    return response


@router.post("/quality-check")
async def check_bug_quality(
    req: QualityCheckRequest,
    current_user: User = Depends(deps.get_current_user),
):
    """Score bug input quality from 0-100 with missing items and hints."""
    return score_bug_input(
        description=req.description,
        steps_to_reproduce=req.steps_to_reproduce,
        expected_result=req.expected_result,
        actual_result=req.actual_result,
        user_description=req.user_description,
        selected_text=req.selected_text,
    )


@router.post("/analyze-context")
async def analyze_context(
    req: StoryAnalysisRequest,
    current_user: User = Depends(deps.get_current_user),
):
    """Lightweight pre-generation story analysis."""
    analysis = analyze_story_context(
        summary=req.summary,
        description=req.description,
        acceptance_criteria=req.acceptance_criteria,
        issue_key=req.issue_key,
    )
    return {
        **analysis.model_dump(),
        "selected_categories": req.test_categories,
        "include_description": req.include_description,
    }


@router.post("/bulk/test-cases", response_model=BulkTestGenerationResponse)
async def generate_bulk_test_suites(
    request: Request,
    req: BulkTestGenerationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    rate_limiter.check("ai.bulk_test_cases", str(current_user.id), limit=2, window_seconds=60)
    LimitChecker.check_allowed(db, current_user.id)
    response = await generate_bulk_test_suites_response(req, db, current_user)
    LimitChecker.record_usage(db, current_user.id, "/bulk/test-cases", 0)
    log_audit(
        "ai.bulk_test_cases",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        story_count=len(req.stories),
        success_count=sum(1 for item in response.results if item.ok),
    )
    return response


@router.post("/bulk/analyze", response_model=GapAnalysisResponse)
async def bulk_analyze_stories(
    request: Request,
    req: BulkAnalyzeRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    rate_limiter.check("ai.bulk_analyze", str(current_user.id), limit=2, window_seconds=60)
    LimitChecker.check_allowed(db, current_user.id)
    response = await bulk_analyze_stories_response(req, db, current_user)
    LimitChecker.record_usage(db, current_user.id, "/bulk/analyze", 0)
    log_audit(
        "ai.bulk_analyze",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        story_count=len(req.stories),
    )
    return response


@router.post("/bulk/brd-compare", response_model=GapAnalysisResponse)
async def bulk_compare_brd(
    request: Request,
    req: BulkBrdCompareRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    rate_limiter.check("ai.bulk_brd_compare", str(current_user.id), limit=2, window_seconds=60)
    LimitChecker.check_allowed(db, current_user.id)
    response = await bulk_compare_brd_response(req, db, current_user)
    LimitChecker.record_usage(db, current_user.id, "/bulk/brd-compare", 0)
    log_audit(
        "ai.bulk_brd_compare",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        story_count=len(req.stories),
    )
    return response


@router.post("/preview", response_model=PreviewPreparationResponse)
async def prepare_bug_preview(
    req: PreviewPreparationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    return prepare_bug_preview_response(req, db, current_user)


@router.post("/submit", response_model=SubmitBugsResponse)
async def submit_bugs(
    request: Request,
    req: SubmitBugsRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    rate_limiter.check("ai.submit", str(current_user.id), limit=10, window_seconds=60)
    return submit_bugs_response(request, req, db, current_user)
