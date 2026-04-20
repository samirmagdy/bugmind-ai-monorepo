from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import datetime
from typing import Optional, List, Dict
from app.api import deps
from app.models.user import User
from app.models.jira import JiraConnection, JiraFieldMapping
from app.models.subscription import Subscription, PlanType
from app.models.usage import UsageLog
from app.schemas.bug import (
    BugGenerationRequest,
    BugGenerationResponse,
    PreviewPreparationRequest,
    PreviewPreparationResponse,
    SubmitBugsRequest,
    SubmitBugsResponse,
    TestSuiteResponse,
    XrayPublishedTest,
)
from app.services.ai.bug_generator import BugGenerator
from app.services.subscription.limit_checker import LimitChecker
from app.services.jira.metadata_engine import JiraMetadataEngine
from app.services.jira.field_resolver import JiraFieldResolver
from app.services.jira.adapters.server import JiraServerAdapter
from app.services.jira.contract_aliases import (
    canonicalize_ai_payload,
    get_payload_value_for_field,
    inject_standard_field_aliases,
    is_system_managed_standard_field,
)
from app.api.v1.jira import get_adapter, _normalize_instance_url
from app.core.security import decrypt_credential
from app.core.audit import log_audit
from app.core.idempotency import idempotency_store
from app.core.rate_limit import rate_limiter
import re

router = APIRouter()

STANDARD_ISSUE_FIELDS = {"summary", "description", "issuetype", "project"}


def _compose_story_context(selected_text: Optional[str], issue_context) -> str:
    if issue_context:
        sections = []

        summary = (issue_context.summary or "").strip()
        if summary:
            sections.append(f"Summary:\n{summary}")

        description = (issue_context.description or "").strip()
        if description:
            sections.append(f"Description:\n{description}")

        acceptance_criteria = (issue_context.acceptance_criteria or "").strip()
        if acceptance_criteria:
            sections.append(f"Acceptance Criteria:\n{acceptance_criteria}")

        if sections:
            return "\n\n".join(sections)

    if selected_text and selected_text.strip():
        return selected_text.strip()

    raise HTTPException(status_code=400, detail="Issue context is required for AI generation")


def _get_owned_connection(db: Session, user_id: int, connection_id: int) -> JiraConnection:
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == connection_id,
        JiraConnection.user_id == user_id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Jira connection not found")
    return conn


def _assert_connection_matches_instance(connection: JiraConnection, instance_url: Optional[str]) -> None:
    if not instance_url:
        return

    requested = _normalize_instance_url(instance_url)
    connection_url = _normalize_instance_url(connection.host_url)
    if requested and connection_url and requested != connection_url:
        raise HTTPException(
            status_code=400,
            detail=f"Active Jira connection does not match the current tab. Expected {requested} but selected connection points to {connection_url}."
        )


def _normalize_project_value(
    raw_project: object,
    fallback_project_key: str,
    fallback_project_id: Optional[str],
    prefer_key: bool = False
) -> dict:
    if isinstance(raw_project, dict):
        project_id = raw_project.get("id")
        project_key = raw_project.get("key")
        if prefer_key and project_key:
            return {"key": str(project_key)}
        if project_id:
            return {"id": str(project_id)}
        if project_key:
            return {"key": str(project_key)}

    if isinstance(raw_project, str):
        cleaned = raw_project.strip()
        if cleaned:
            return {"id": cleaned} if cleaned.isdigit() else {"key": cleaned}

    if prefer_key and fallback_project_key:
        return {"key": fallback_project_key}

    return {"id": project_id} if (project_id := fallback_project_id) else {"key": fallback_project_key}


def _build_issue_fields(
    bug: dict,
    issue_type_id: str,
    project_key: str,
    project_id: Optional[str],
    prefer_project_key: bool = False
) -> dict:
    raw_project = (bug.get("extra_fields") or {}).get("project")
    extra_fields = {
        key: value
        for key, value in (bug.get("extra_fields") or {}).items()
        if key not in STANDARD_ISSUE_FIELDS
    }

    project_value = _normalize_project_value(raw_project, project_key, project_id, prefer_key=prefer_project_key)
    return {
        "summary": bug.get("summary"),
        "description": bug.get("description"),
        "steps_to_reproduce": bug.get("steps_to_reproduce", ""),
        "expected_result": bug.get("expected_result"),
        "actual_result": bug.get("actual_result"),
        "project": project_value,
        "issuetype": {"id": issue_type_id},
        **extra_fields
    }


def _resolve_payload(db: Session, user_id: int, project_key: str, project_id: Optional[str], issue_type_id: str, schema: list, payload_fields: dict, platform: str = "cloud") -> dict:
    mapping_record = db.query(JiraFieldMapping).filter(
        or_(
            JiraFieldMapping.project_key == project_key,
            JiraFieldMapping.project_id == project_id
        ),
        JiraFieldMapping.issue_type_id == issue_type_id,
        JiraFieldMapping.user_id == user_id
    ).first()
    mapping_config = mapping_record.field_mappings if mapping_record else {}

    resolver = JiraFieldResolver(mapping_config, schema, platform=platform)
    ai_raw = canonicalize_ai_payload({
        "summary": payload_fields.get("summary"),
        "description": payload_fields.get("description"),
        "steps": payload_fields.get("steps_to_reproduce", "").split("\n"),
        "expected": payload_fields.get("expected_result"),
        "actual": payload_fields.get("actual_result"),
        **payload_fields
    })

    clean_steps = []
    for step in ai_raw["steps"]:
        cleaned = re.sub(r"^\d+\.\s*", "", str(step)).strip()
        if cleaned:
            clean_steps.append(cleaned)
    ai_raw["steps"] = clean_steps

    resolved_payload = resolver.resolve(ai_raw)
    explicit_fields = resolver.resolve_explicit_fields(payload_fields)
    resolved_payload["fields"] = {
        **resolved_payload.get("fields", {}),
        **explicit_fields,
        "project": payload_fields["project"],
        "issuetype": {"id": issue_type_id},
    }
    return resolved_payload


def _validate_payload(schema: list, payload_fields: dict) -> List[Dict]:
    missing_fields = []
    for field in schema:
        if not field.get("required"):
            continue

        if is_system_managed_standard_field(field):
            continue

        value = get_payload_value_for_field(field, payload_fields)
        if value is None:
            missing_fields.append({
                "key": field["key"],
                "name": field["name"]
            })
            continue

        if value == "" or (isinstance(value, list) and not value):
            missing_fields.append({
                "key": field["key"],
                "name": field["name"]
            })
    return missing_fields

@router.get("/usage")
def get_usage(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    sub = db.query(Subscription).filter(Subscription.user_id == current_user.id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    now = datetime.utcnow()
    first_day = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    usage_count = db.query(UsageLog).filter(
        UsageLog.user_id == current_user.id,
        UsageLog.created_at >= first_day
    ).count()

    if sub.plan == PlanType.FREE:
        limit = LimitChecker.FREE_LIMIT
        remaining = max(limit - usage_count, 0)
    else:
        limit = 999999
        remaining = max(limit - usage_count, 0)

    return {
        "count": usage_count,
        "limit": limit,
        "remaining": remaining,
        "plan": sub.plan.value
    }

@router.post("/generate", response_model=BugGenerationResponse)
async def generate_bug_report(
    request: Request,
    req: BugGenerationRequest,
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    rate_limiter.check("ai.generate", str(current_user.id), limit=10, window_seconds=60)
    # 1. Enforce Subscription Limits
    LimitChecker.check_and_increment(db, current_user.id, "/generate", 0)

    # 2. Get Jira Schema
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == req.jira_connection_id, 
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Jira connection not found")
    _assert_connection_matches_instance(conn, req.instance_url)
        
    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    schema_project_id = req.project_id or req.project_key
    schema = engine.get_field_schema(schema_project_id, req.issue_type_id)

    # 3. Request AI Generation
    custom_api_key = None
    if current_user.encrypted_ai_api_key:
        custom_api_key = decrypt_credential(current_user.encrypted_ai_api_key)

    generator = BugGenerator(api_key=custom_api_key)
    story_context = _compose_story_context(req.selected_text, req.issue_context)
    ai_raw = await generator.generate_bug(
        story_context,
        schema, 
        model=req.model or current_user.custom_ai_model,
        user_description=req.user_description,
        custom_instructions=req.custom_instructions
    )

    # 4. Resolve Fields (Mapping)
    mapping_record = db.query(JiraFieldMapping).filter(
        or_(
            JiraFieldMapping.project_key == req.project_key,
            JiraFieldMapping.project_id == req.project_id
        ),
        JiraFieldMapping.issue_type_id == req.issue_type_id,
        JiraFieldMapping.user_id == current_user.id
    ).first()
    mapping_config = mapping_record.field_mappings if mapping_record else {}
    
    platform = "server" if isinstance(adapter, JiraServerAdapter) else "cloud"
    resolver = JiraFieldResolver(mapping_config, schema, platform=platform)
    jira_payload = resolver.resolve(ai_raw)

    # 5. Format Steps and Results
    steps_list = ai_raw.get("steps", [])
    if isinstance(steps_list, list):
        clean_steps = [
            re.sub(r"^\s*\d+\.\s*", "", str(step)).strip()
            for step in steps_list
            if str(step).strip()
        ]
        steps_text = "\n".join(clean_steps)
    else:
        steps_text = str(steps_list)

    response = BugGenerationResponse(
        summary=ai_raw.get("summary", ""),
        description=ai_raw.get("description", ""),
        steps_to_reproduce=steps_text,
        expected_result=ai_raw.get("expected", ""),
        actual_result=ai_raw.get("actual", ""),
        fields=jira_payload["fields"],
        ac_coverage=ai_raw.get("ac_coverage", 0.0)
    )
    log_audit(
        "ai.generate",
        current_user.id,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
    )
    return response

@router.post("/test-cases", response_model=TestSuiteResponse)
async def generate_test_suite(
    request: Request,
    req: BugGenerationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Analyzes story context and generates a suite of test cases.
    """
    rate_limiter.check("ai.test_cases", str(current_user.id), limit=5, window_seconds=60)
    LimitChecker.check_and_increment(db, current_user.id, "/test-cases", 0)

    custom_api_key = None
    if current_user.encrypted_ai_api_key:
        custom_api_key = decrypt_credential(current_user.encrypted_ai_api_key)

    generator = BugGenerator(api_key=custom_api_key)
    story_context = _compose_story_context(req.selected_text, req.issue_context)
    suite = await generator.generate_test_cases(
        story_context,
        model=req.model or current_user.custom_ai_model,
        custom_instructions=req.custom_instructions
    )
    response = TestSuiteResponse(**suite)
    log_audit(
        "ai.test_cases",
        current_user.id,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        generated_count=len(response.test_cases),
    )
    return response


@router.post("/preview", response_model=PreviewPreparationResponse)
async def prepare_bug_preview(
    req: PreviewPreparationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = _get_owned_connection(db, current_user.id, req.jira_connection_id)
    _assert_connection_matches_instance(conn, req.instance_url)
    adapter = get_adapter(conn)
    prefer_project_key = isinstance(adapter, JiraServerAdapter)
    engine = JiraMetadataEngine(adapter)
    schema_project_id = req.project_id or req.project_key
    schema = engine.get_field_schema(schema_project_id, req.issue_type_id)

    payload_fields = inject_standard_field_aliases(
        schema,
        _build_issue_fields(
            req.bug.model_dump(),
            req.issue_type_id,
            req.project_key,
            req.project_id,
            prefer_project_key=prefer_project_key
        )
    )
    platform = "server" if prefer_project_key else "cloud"
    missing_fields = _validate_payload(schema, payload_fields)
    resolved_payload = _resolve_payload(
        db,
        current_user.id,
        req.project_key,
        req.project_id,
        req.issue_type_id,
        schema,
        payload_fields,
        platform=platform
    )

    return PreviewPreparationResponse(
        valid=len(missing_fields) == 0,
        missing_fields=missing_fields,
        resolved_payload=resolved_payload
    )


@router.post("/submit", response_model=SubmitBugsResponse)
async def submit_bugs(
    request: Request,
    req: SubmitBugsRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    rate_limiter.check("ai.submit", str(current_user.id), limit=10, window_seconds=60)
    idem_key = request.headers.get("Idempotency-Key")
    cached_response = idempotency_store.replay_or_reserve(
        "ai.submit",
        str(current_user.id),
        idem_key,
        req.model_dump(),
    )
    if cached_response is not None:
        return SubmitBugsResponse(**cached_response)

    conn = _get_owned_connection(db, current_user.id, req.jira_connection_id)
    _assert_connection_matches_instance(conn, req.instance_url)
    adapter = get_adapter(conn)
    prefer_project_key = isinstance(adapter, JiraServerAdapter)
    schema_project_id = req.project_id or req.project_key
    engine = JiraMetadataEngine(adapter)
    schema = engine.get_field_schema(schema_project_id, req.issue_type_id)
    created_issues: List[XrayPublishedTest] = []

    for bug in req.bugs:
        payload_fields = inject_standard_field_aliases(
            schema,
            _build_issue_fields(
                bug.model_dump(),
                req.issue_type_id,
                req.project_key,
                req.project_id,
                prefer_project_key=prefer_project_key
            )
        )
        missing_fields = _validate_payload(schema, payload_fields)
        if missing_fields:
            names = ", ".join(field["name"] for field in missing_fields)
            raise HTTPException(status_code=400, detail=f"Cannot submit bug. Missing required Jira fields: {names}")

        platform = "server" if prefer_project_key else "cloud"
        resolved_payload = _resolve_payload(
            db,
            current_user.id,
            req.project_key,
            req.project_id,
            req.issue_type_id,
            schema,
            payload_fields,
            platform=platform
        )

        issue_key = adapter.create_issue(resolved_payload)
        created_issues.append(XrayPublishedTest(id=issue_key, key=issue_key, self=""))

    response = SubmitBugsResponse(created_issues=created_issues)
    idempotency_store.store_response(
        "ai.submit",
        str(current_user.id),
        idem_key,
        req.model_dump(),
        response.model_dump(),
    )
    log_audit(
        "ai.submit",
        current_user.id,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        created_issue_keys=[issue.key for issue in created_issues],
    )
    return response
