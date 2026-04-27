from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional, List, Dict
from difflib import SequenceMatcher
import logging
from app.api import deps
from app.models.user import User
from app.models.jira import JiraConnection, JiraFieldMapping
from app.models.subscription import Subscription, PlanType
from app.models.usage import UsageLog
from app.schemas.bug import (
    AIWorkItemGenerationRequest,
    GapAnalysisResponse,
    ManualBugGenerationResponse,
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
from app.api.v1.jira import get_adapter, _normalize_instance_url, _resolve_link_type_candidates
from app.core.security import decrypt_credential
from app.core.audit import log_audit
from app.core.idempotency import idempotency_store
from app.core.rate_limit import rate_limiter
import re

router = APIRouter()
logger = logging.getLogger(__name__)

STANDARD_ISSUE_FIELDS = {"summary", "description", "issuetype", "project"}
NON_CREATABLE_ISSUE_FIELDS = {"issuelinks"}


def _get_field_mapping_record(
    db: Session,
    user_id: int,
    project_key: str,
    project_id: Optional[str],
    issue_type_id: str,
) -> Optional[JiraFieldMapping]:
    query = db.query(JiraFieldMapping).filter(
        JiraFieldMapping.project_key == project_key,
        JiraFieldMapping.issue_type_id == issue_type_id,
        JiraFieldMapping.user_id == user_id
    )
    if project_id is None:
        query = query.filter(JiraFieldMapping.project_id.is_(None))
    else:
        query = query.filter(JiraFieldMapping.project_id == project_id)
    return query.first()


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


def _normalize_text_for_overlap(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip().lower())
    return re.sub(r"[^a-z0-9 ]+", "", text)


def _token_overlap_ratio(left: str, right: str) -> float:
    left_tokens = set(token for token in left.split() if token)
    right_tokens = set(token for token in right.split() if token)
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / max(len(left_tokens | right_tokens), 1)


def _annotate_bug_overlaps(raw_bugs: List[dict]) -> tuple[List[dict], List[str]]:
    warnings: List[str] = []
    duplicate_group_index = 1

    for index, bug in enumerate(raw_bugs):
        if not isinstance(bug, dict):
            continue
        bug.setdefault("duplicate_group", None)
        bug.setdefault("overlap_warning", None)
        bug.setdefault("acceptance_criteria_refs", [])
        bug.setdefault("evidence", [])

        current_summary = _normalize_text_for_overlap(bug.get("summary"))
        current_signature = _normalize_text_for_overlap(
            " ".join(
                [
                    str(bug.get("summary", "")),
                    str(bug.get("expected", "")),
                    str(bug.get("actual", "")),
                ]
            )
        )
        for compare_index in range(index):
            other_bug = raw_bugs[compare_index]
            if not isinstance(other_bug, dict):
                continue

            other_summary = _normalize_text_for_overlap(other_bug.get("summary"))
            other_signature = _normalize_text_for_overlap(
                " ".join(
                    [
                        str(other_bug.get("summary", "")),
                        str(other_bug.get("expected", "")),
                        str(other_bug.get("actual", "")),
                    ]
                )
            )

            summary_similarity = SequenceMatcher(None, current_summary, other_summary).ratio()
            signature_similarity = SequenceMatcher(None, current_signature, other_signature).ratio()
            token_overlap = _token_overlap_ratio(current_signature, other_signature)

            if max(summary_similarity, signature_similarity, token_overlap) < 0.78:
                continue

            group = other_bug.get("duplicate_group") or f"DUP-{duplicate_group_index}"
            if not other_bug.get("duplicate_group"):
                duplicate_group_index += 1
                other_bug["duplicate_group"] = group
            bug["duplicate_group"] = group
            bug["overlap_warning"] = f"Potential overlap with finding {compare_index + 1}."
            other_bug.setdefault("overlap_warning", f"Potential overlap with finding {index + 1}.")
            warnings.append(
                f"Findings {compare_index + 1} and {index + 1} may overlap. Review before publishing."
            )
            break

    return raw_bugs, list(dict.fromkeys(warnings))


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
        logger.warning(
            "connection_mismatch_attempted user_id=%s connection_id=%s requested=%s actual=%s",
            connection.user_id, connection.id, requested, connection_url
        )
        raise HTTPException(
            status_code=400,
            detail=f"Security Alert: Your active Jira connection ({connection_url}) does not match the page you are currently viewing ({requested}). Please verify your connection settings."
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
        if key not in STANDARD_ISSUE_FIELDS and key not in NON_CREATABLE_ISSUE_FIELDS
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


def _merge_saved_field_defaults(
    payload_fields: dict,
    mapping_record: Optional[JiraFieldMapping],
    schema: Optional[list] = None,
) -> dict:
    merged_fields = dict(payload_fields)
    saved_defaults = (mapping_record.field_defaults if mapping_record else None) or {}
    creatable_schema_keys = {field.get("key") for field in (schema or [])}
    for field_key, default_value in saved_defaults.items():
        if field_key in NON_CREATABLE_ISSUE_FIELDS:
            continue
        if schema is not None and field_key not in creatable_schema_keys:
            continue
        existing = merged_fields.get(field_key)
        if existing is None or existing == "" or existing == []:
            merged_fields[field_key] = default_value
    return merged_fields


def _is_missing_jira_value(field: dict, value: object) -> bool:
    if value is None or value == "":
        return True
    if isinstance(value, list):
        if not value:
            return True
        return any(_is_missing_jira_value(field, item) for item in value)
    if not isinstance(value, dict):
        return False

    field_type = field.get("type", "")
    if field_type in {"option", "priority"}:
        return not any(str(value.get(key) or "").strip() for key in ("id", "value", "name"))
    if field_type in {"user", "multi-user"}:
        return not any(str(value.get(key) or "").strip() for key in ("accountId", "name", "id"))
    if field_type in {"array", "multi-select"}:
        return not any(str(value.get(key) or "").strip() for key in ("id", "value", "name", "accountId"))
    return False


def _resolve_payload(db: Session, user_id: int, project_key: str, project_id: Optional[str], issue_type_id: str, schema: list, payload_fields: dict, platform: str = "cloud") -> dict:
    mapping_record = _get_field_mapping_record(db, user_id, project_key, project_id, issue_type_id)
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
        if _is_missing_jira_value(field, value):
            missing_fields.append({
                "key": field["key"],
                "name": field["name"]
            })
    return missing_fields


async def _generate_findings_response(
    req: AIWorkItemGenerationRequest,
    db: Session,
    current_user: User,
    include_analysis_summary: bool,
):
    if not (req.project_id or req.project_key) or not req.issue_type_id:
        raise HTTPException(
            status_code=400,
            detail="Missing Jira context (Project or Issue Type). Please ensure you are on a valid Jira issue tab."
        )

    conn = _get_owned_connection(db, current_user.id, req.jira_connection_id)
    _assert_connection_matches_instance(conn, req.instance_url)

    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    schema_project_id = req.project_id or req.project_key
    try:
        schema = engine.get_field_schema(schema_project_id, req.issue_type_id)
    except HTTPException as e:
        if e.status_code == 400:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to fetch Jira configurations for project '{schema_project_id}' and issue type '{req.issue_type_id}'. Verify these exist and your account has access."
            )
        raise e

    custom_api_key = None
    if current_user.encrypted_ai_api_key:
        custom_api_key = decrypt_credential(current_user.encrypted_ai_api_key)

    generator = BugGenerator(api_key=custom_api_key)
    story_context = _compose_story_context(req.selected_text, req.issue_context)
    ai_raw = await generator.generate_bug(
        story_context,
        schema,
        issue_type_name=req.issue_type_name,
        model=req.model or current_user.custom_ai_model,
        user_description=req.user_description,
        custom_instructions=req.custom_instructions,
        bug_count=req.bug_count,
        focus_bug_summary=req.focus_bug_summary,
        refinement_prompt=req.refinement_prompt,
        supporting_context=req.supporting_context,
    )

    ai_bugs_raw = ai_raw.get("bugs", [])
    if not isinstance(ai_bugs_raw, list) or len(ai_bugs_raw) == 0:
        ai_bugs_raw = [ai_raw]
    ai_bugs_raw, overlap_warnings = _annotate_bug_overlaps(ai_bugs_raw)

    mapping_record = _get_field_mapping_record(db, current_user.id, req.project_key, req.project_id, req.issue_type_id)
    mapping_config = mapping_record.field_mappings if mapping_record else {}

    platform = "server" if isinstance(adapter, JiraServerAdapter) else "cloud"
    resolver = JiraFieldResolver(mapping_config, schema, platform=platform)
    resolved_bugs = []
    for raw_bug in ai_bugs_raw:
        if not isinstance(raw_bug, dict):
            continue

        jira_payload = resolver.resolve(raw_bug)
        jira_payload["fields"] = _merge_saved_field_defaults(jira_payload["fields"], mapping_record, schema)

        steps_list = raw_bug.get("steps", [])
        if isinstance(steps_list, list):
            clean_steps = [
                re.sub(r"^\s*\d+\.\s*", "", str(step)).strip()
                for step in steps_list
                if str(step).strip()
            ]
            steps_text = "\n".join(clean_steps)
        else:
            steps_text = str(steps_list)

        resolved_bugs.append({
            "summary": raw_bug.get("summary", ""),
            "description": raw_bug.get("description", ""),
            "steps_to_reproduce": steps_text,
            "expected_result": raw_bug.get("expected", ""),
            "actual_result": raw_bug.get("actual", ""),
            "severity": raw_bug.get("severity", "Medium"),
            "confidence": raw_bug.get("confidence", 75),
            "category": raw_bug.get("category", "Functional Gap"),
            "acceptance_criteria_refs": raw_bug.get("acceptance_criteria_refs", []) or [],
            "evidence": raw_bug.get("evidence", []) or [],
            "duplicate_group": raw_bug.get("duplicate_group"),
            "overlap_warning": raw_bug.get("overlap_warning"),
            "fields": jira_payload["fields"],
        })

    ai_warnings = ai_raw.get("warnings", [])
    if isinstance(ai_warnings, str):
        ai_warnings = [ai_warnings]
    elif not isinstance(ai_warnings, list):
        ai_warnings = []

    warnings = list(dict.fromkeys([*ai_warnings, *overlap_warnings]))
    if include_analysis_summary:
        analysis_summary = ai_raw.get("analysis_summary")
        if not isinstance(analysis_summary, dict):
            analysis_summary = None
        return GapAnalysisResponse(
            bugs=resolved_bugs,
            ac_coverage=ai_raw.get("ac_coverage", 0.0),
            warnings=warnings,
            analysis_summary=analysis_summary,
        )

    return ManualBugGenerationResponse(
        bugs=resolved_bugs,
        warnings=warnings,
    )

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

@router.post("/generate", response_model=GapAnalysisResponse)
async def generate_bug_report(
    request: Request,
    req: AIWorkItemGenerationRequest,
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    rate_limiter.check("ai.generate", str(current_user.id), limit=10, window_seconds=60)
    LimitChecker.check_allowed(db, current_user.id)
    response = await _generate_findings_response(req, db, current_user, include_analysis_summary=True)
    LimitChecker.record_usage(db, current_user.id, "/generate", 0)
    log_audit(
        "ai.generate",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
    )
    return response


@router.post("/generate/manual", response_model=ManualBugGenerationResponse)
async def generate_manual_bug_report(
    request: Request,
    req: AIWorkItemGenerationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    rate_limiter.check("ai.generate", str(current_user.id), limit=10, window_seconds=60)
    LimitChecker.check_allowed(db, current_user.id)

    response = await _generate_findings_response(req, db, current_user, include_analysis_summary=False)
    LimitChecker.record_usage(db, current_user.id, "/generate", 0)
    log_audit(
        "ai.generate.manual",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        generated_count=len(response.bugs),
    )
    return response

@router.post("/test-cases", response_model=TestSuiteResponse)
async def generate_test_suite(
    request: Request,
    req: AIWorkItemGenerationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Analyzes story context and generates a suite of test cases.
    """
    rate_limiter.check("ai.test_cases", str(current_user.id), limit=5, window_seconds=60)
    LimitChecker.check_allowed(db, current_user.id)

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
    LimitChecker.record_usage(db, current_user.id, "/test-cases", 0)
    log_audit(
        "ai.test_cases",
        current_user.id,
        db=db,
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

    mapping_record = _get_field_mapping_record(db, current_user.id, req.project_key, req.project_id, req.issue_type_id)
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
    payload_fields = _merge_saved_field_defaults(payload_fields, mapping_record, schema)
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
    missing_fields = _validate_payload(schema, resolved_payload.get("fields", {}))

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
    request_payload = req.model_dump()
    cached_response = idempotency_store.replay_or_reserve(
        "ai.submit",
        str(current_user.id),
        idem_key,
        request_payload,
    )
    if cached_response is not None:
        return SubmitBugsResponse(**cached_response)

    try:
        conn = _get_owned_connection(db, current_user.id, req.jira_connection_id)
        _assert_connection_matches_instance(conn, req.instance_url)
        adapter = get_adapter(conn)
        prefer_project_key = isinstance(adapter, JiraServerAdapter)
        if not (req.project_id or req.project_key) or not req.issue_type_id:
            raise HTTPException(
                status_code=400,
                detail="Missing Jira context (Project or Issue Type). Submission aborted."
            )

        schema_project_id = req.project_id or req.project_key
        engine = JiraMetadataEngine(adapter)
        try:
            schema = engine.get_field_schema(schema_project_id, req.issue_type_id)
        except HTTPException as e:
            if e.status_code == 400:
                 raise HTTPException(
                    status_code=400,
                    detail=f"Failed to fetch Jira configurations for submission. Project '{schema_project_id}' or issue type '{req.issue_type_id}' may be invalid or inaccessible."
                )
            raise e
    except Exception:
        idempotency_store.clear_reservation("ai.submit", str(current_user.id), idem_key, request_payload)
        raise
    created_issues: List[XrayPublishedTest] = []
    created_issue_keys_for_rollback: List[str] = []
    warnings: List[str] = []
    linked_issue_keys: List[str] = []
    unlinked_issue_keys: List[str] = []
    story_issue_key = (req.story_issue_key or "").strip()
    link_type_used: Optional[str] = None
    available_link_types: list[str] = []
    if story_issue_key:
        try:
            available_link_types = adapter.get_issue_link_types()
        except HTTPException:
            available_link_types = []
    link_candidates = _resolve_link_type_candidates("Relates", available_link_types) if story_issue_key else []

    mapping_record = _get_field_mapping_record(db, current_user.id, req.project_key, req.project_id, req.issue_type_id)
    platform = "server" if prefer_project_key else "cloud"
    prepared_payloads: List[tuple[int, Any, Dict[str, Any]]] = []

    try:
        for bug_index, bug in enumerate(req.bugs):
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
            payload_fields = _merge_saved_field_defaults(payload_fields, mapping_record, schema)
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
            missing_fields = _validate_payload(schema, resolved_payload.get("fields", {}))
            if missing_fields:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": {
                            "code": "BULK_BUG_FIELDS_MISSING",
                            "message": f"Bug {bug_index + 1} is missing required Jira fields.",
                            "details": [{
                                "bug_index": bug_index,
                                "bug_summary": bug.summary,
                                "missing_fields": missing_fields,
                            }],
                        }
                    },
                )
            prepared_payloads.append((bug_index, bug, resolved_payload))
    except Exception:
        idempotency_store.clear_reservation("ai.submit", str(current_user.id), idem_key, request_payload)
        raise

    try:
        for bug_index, bug, resolved_payload in prepared_payloads:

            try:
                issue_key = adapter.create_issue(resolved_payload)
            except HTTPException as exc:
                rollback_failed_keys: List[str] = []
                rolled_back_issue_keys: List[str] = []
                rollback_failure_details: List[dict[str, str]] = []
                for created_issue_key in reversed(created_issue_keys_for_rollback):
                    try:
                        adapter.delete_issue(created_issue_key)
                        rolled_back_issue_keys.append(created_issue_key)
                    except HTTPException as rollback_exc:
                        rollback_failed_keys.append(created_issue_key)
                        rollback_failure_details.append(
                            {
                                "issue_key": created_issue_key,
                                "error": str(rollback_exc.detail),
                            }
                        )
                error_message = f"Bug {bug_index + 1} could not be created in Jira."
                if rollback_failed_keys:
                    error_message = (
                        f"{error_message} Some earlier bugs were already created and could not be deleted automatically. "
                        "Review Jira permissions or remove them manually."
                    )
                raise HTTPException(
                    status_code=exc.status_code,
                    detail={
                        "error": {
                            "code": "BULK_BUG_SUBMIT_FAILED",
                            "message": error_message,
                            "details": [{
                                "bug_index": bug_index,
                                "bug_summary": bug.summary,
                                "jira_error": exc.detail,
                                "rolled_back_issue_keys": rolled_back_issue_keys,
                                "rollback_attempted_issue_keys": created_issue_keys_for_rollback,
                                "rollback_failed_issue_keys": rollback_failed_keys,
                                "rollback_failed_issue_details": rollback_failure_details,
                                "partial_publish": bool(rollback_failed_keys),
                            }],
                        }
                    },
                ) from exc
            created_issue_keys_for_rollback.append(issue_key)
            created_issues.append(XrayPublishedTest(id=issue_key, key=issue_key, self=""))
            if story_issue_key:
                linked = False
                for candidate in link_candidates:
                    try:
                        adapter.link_issues(issue_key, candidate, story_issue_key)
                        linked = True
                        linked_issue_keys.append(issue_key)
                        if not link_type_used:
                            link_type_used = candidate
                        break
                    except HTTPException:
                        continue
                if not linked:
                    unlinked_issue_keys.append(issue_key)
                    warnings.append(f"Issue {issue_key} was created but could not be linked to parent story {story_issue_key}.")
                    logger.warning(
                        "bug_submit_link_failed story_issue_key=%s created_issue_key=%s jira_connection_id=%s",
                        story_issue_key,
                        issue_key,
                        req.jira_connection_id,
                    )
    except Exception:
        idempotency_store.clear_reservation("ai.submit", str(current_user.id), idem_key, request_payload)
        raise

    response = SubmitBugsResponse(
        created_issues=created_issues,
        warnings=warnings,
        linked_story_issue_key=story_issue_key or None,
        link_type_used=link_type_used,
        linked_issue_keys=linked_issue_keys,
        unlinked_issue_keys=unlinked_issue_keys,
    )
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
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        issue_type_id=req.issue_type_id,
        request_path=str(request.url.path),
        created_issue_keys=[issue.key for issue in created_issues],
        linked_story_issue_key=story_issue_key or None,
        link_type_used=link_type_used,
    )
    return response
