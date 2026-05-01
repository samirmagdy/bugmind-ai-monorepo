import logging
import re
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core.audit import log_audit
from app.core.idempotency import idempotency_store
from app.core.security import decrypt_credential
from app.models.jira import JiraFieldMapping
from app.models.subscription import PlanType, Subscription
from app.models.usage import UsageLog
from app.models.user import User
from app.schemas.bug import (
    BulkAnalyzeRequest,
    BulkBrdCompareRequest,
    BulkTestGenerationItem,
    BulkTestGenerationRequest,
    BulkTestGenerationResponse,
    FindingGenerationRequest,
    GapAnalysisResponse,
    ManualBugGenerationResponse,
    PreviewPreparationRequest,
    PreviewPreparationResponse,
    SubmitBugsRequest,
    SubmitBugsResponse,
    TestCaseGenerationRequest,
    TestSuiteResponse,
    XrayPublishedTest,
)
from app.services.ai.bug_generator import BugGenerator
from app.services.ai.test_case_generator import TestCaseGenerator
from app.services.jira.adapters.server import JiraServerAdapter
from app.services.jira.connection_service import assert_connection_matches_instance, get_adapter, get_owned_connection
from app.services.jira.contract_aliases import (
    canonicalize_ai_payload,
    get_payload_value_for_field,
    inject_standard_field_aliases,
    is_system_managed_standard_field,
)
from app.services.jira.field_resolver import BugJiraPayloadResolver
from app.services.jira.metadata_engine import JiraMetadataEngine
from app.services.jira.xray_publisher import resolve_link_type_candidates


logger = logging.getLogger(__name__)

STANDARD_ISSUE_FIELDS = {"summary", "description", "issuetype", "project"}
NON_CREATABLE_ISSUE_FIELDS = {"issuelinks"}
BULK_STORY_CONTEXT_CHAR_LIMIT = 6_000
BULK_COMBINED_CONTEXT_CHAR_LIMIT = 45_000
BULK_BRD_TEXT_CHAR_LIMIT = 60_000


def get_usage_summary(db: Session, current_user: User) -> dict:
    sub = db.query(Subscription).filter(Subscription.user_id == current_user.id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    now = datetime.utcnow()
    first_day = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    usage_count = db.query(UsageLog).filter(
        UsageLog.user_id == current_user.id,
        UsageLog.created_at >= first_day,
    ).count()

    if sub.plan == PlanType.FREE:
        limit = 5
        remaining = max(limit - usage_count, 0)
    else:
        limit = 999999
        remaining = max(limit - usage_count, 0)

    return {
        "count": usage_count,
        "limit": limit,
        "remaining": remaining,
        "plan": sub.plan.value,
    }


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
        JiraFieldMapping.user_id == user_id,
    )
    if project_id is None:
        query = query.filter(JiraFieldMapping.project_id.is_(None))
    else:
        query = query.filter(JiraFieldMapping.project_id == project_id)
    return query.first()


def compose_story_context(selected_text: Optional[str], issue_context) -> str:
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


def _stringify_bulk_description(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        parts: List[str] = []

        def walk(node: object) -> None:
            if isinstance(node, dict):
                text = node.get("text")
                if isinstance(text, str):
                    parts.append(text)
                content = node.get("content")
                if isinstance(content, list):
                    for child in content:
                        walk(child)
            elif isinstance(node, list):
                for child in node:
                    walk(child)

        walk(value)
        return " ".join(parts)
    return ""


def _truncate_text(value: str, limit: int, label: str, warnings: List[str]) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    warnings.append(f"{label} was truncated to {limit} characters for reliable AI processing.")
    return text[:limit].rstrip()


def _bulk_story_context(story, warnings: List[str]) -> str:
    description = _truncate_text(
        _stringify_bulk_description(story.description),
        BULK_STORY_CONTEXT_CHAR_LIMIT,
        f"{story.key} description",
        warnings,
    )
    acceptance_criteria = story.acceptance_criteria or story.acceptanceCriteria or ""
    if acceptance_criteria:
        acceptance_criteria = _truncate_text(
            acceptance_criteria,
            2_000,
            f"{story.key} acceptance criteria",
            warnings,
        )
    sections = [
        f"Story: {story.key}",
        f"Summary: {story.summary or ''}",
        f"Description:\n{description}",
    ]
    if acceptance_criteria:
        sections.append(f"Acceptance Criteria:\n{acceptance_criteria}")
    return "\n".join(sections)


def _bulk_combined_story_context(stories: list, warnings: List[str]) -> str:
    combined = "\n\n".join(_bulk_story_context(story, warnings) for story in stories)
    return _truncate_text(combined, BULK_COMBINED_CONTEXT_CHAR_LIMIT, "Combined story context", warnings)


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
            " ".join([str(bug.get("summary", "")), str(bug.get("expected", "")), str(bug.get("actual", ""))])
        )
        for compare_index in range(index):
            other_bug = raw_bugs[compare_index]
            if not isinstance(other_bug, dict):
                continue
            other_summary = _normalize_text_for_overlap(other_bug.get("summary"))
            other_signature = _normalize_text_for_overlap(
                " ".join([str(other_bug.get("summary", "")), str(other_bug.get("expected", "")), str(other_bug.get("actual", ""))])
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
            warnings.append(f"Findings {compare_index + 1} and {index + 1} may overlap. Review before publishing.")
            break
    return raw_bugs, list(dict.fromkeys(warnings))


def _normalize_project_value(raw_project: object, fallback_project_key: str, fallback_project_id: Optional[str], prefer_key: bool = False) -> dict:
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


def _build_issue_fields(bug: dict, issue_type_id: str, project_key: str, project_id: Optional[str], prefer_project_key: bool = False) -> dict:
    raw_project = (bug.get("extra_fields") or {}).get("project")
    extra_fields = {
        key: value
        for key, value in (bug.get("extra_fields") or {}).items()
        if key not in STANDARD_ISSUE_FIELDS and key not in NON_CREATABLE_ISSUE_FIELDS
    }
    return {
        "summary": bug.get("summary"),
        "description": bug.get("description"),
        "steps_to_reproduce": bug.get("steps_to_reproduce", ""),
        "expected_result": bug.get("expected_result"),
        "actual_result": bug.get("actual_result"),
        "project": _normalize_project_value(raw_project, project_key, project_id, prefer_key=prefer_project_key),
        "issuetype": {"id": issue_type_id},
        **extra_fields,
    }


def _merge_saved_field_defaults(payload_fields: dict, mapping_record: Optional[JiraFieldMapping], schema: Optional[list] = None) -> dict:
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


def _extract_ai_custom_fields(raw_bug: dict, schema: list) -> dict:
    schema_keys = {field.get("key") for field in schema}
    custom_fields = raw_bug.get("custom_fields")
    if not isinstance(custom_fields, dict):
        custom_fields = raw_bug.get("fields") if isinstance(raw_bug.get("fields"), dict) else {}
    return {
        key: value
        for key, value in custom_fields.items()
        if key in schema_keys and key not in STANDARD_ISSUE_FIELDS and key not in NON_CREATABLE_ISSUE_FIELDS
    }


def _normalize_percentage(value: object, default: float = 0.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = default
    return max(0.0, min(100.0, numeric))


def _normalize_confidence(value: object, default: int = 75) -> int:
    return int(round(_normalize_percentage(value, default)))


def _normalize_string_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    if isinstance(value, str):
        return [item.strip() for item in re.split(r"[,;\n]+", value) if item.strip()]
    return []


def _normalize_test_case(raw_test: object) -> Optional[dict]:
    if not isinstance(raw_test, dict):
        return None
    title = str(raw_test.get("title") or "").strip()
    expected_result = str(raw_test.get("expected_result") or raw_test.get("expected") or "").strip()
    raw_steps = raw_test.get("steps") or []
    if isinstance(raw_steps, str):
        steps = [step.strip() for step in raw_steps.splitlines() if step.strip()]
    elif isinstance(raw_steps, list):
        steps = [str(step).strip() for step in raw_steps if str(step or "").strip()]
    else:
        steps = []
    if not (title and steps and expected_result):
        return None
    priority = str(raw_test.get("priority") or "Medium").strip().title()
    if priority not in {"Highest", "High", "Medium", "Low", "Lowest"}:
        priority = "Medium"
    test_type = str(raw_test.get("test_type") or raw_test.get("type") or "Manual").strip().title()
    return {
        "title": title,
        "steps": steps,
        "expected_result": expected_result,
        "priority": priority,
        "selected": bool(raw_test.get("selected", True)),
        "test_type": test_type or "Manual",
        "preconditions": str(raw_test.get("preconditions") or "").strip() or None,
        "acceptance_criteria_refs": _normalize_string_list(raw_test.get("acceptance_criteria_refs") or raw_test.get("ac_refs")),
        "labels": _normalize_string_list(raw_test.get("labels")),
        "components": _normalize_string_list(raw_test.get("components")),
    }


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
    resolver = BugJiraPayloadResolver(mapping_config, schema, platform=platform)
    ai_raw = canonicalize_ai_payload({
        "summary": payload_fields.get("summary"),
        "description": payload_fields.get("description"),
        "steps": payload_fields.get("steps_to_reproduce", "").split("\n"),
        "expected": payload_fields.get("expected_result"),
        "actual": payload_fields.get("actual_result"),
        **payload_fields,
    })
    clean_steps = []
    for step in ai_raw["steps"]:
        cleaned = re.sub(r"^\d+\.\s*", "", str(step)).strip()
        if cleaned:
            clean_steps.append(cleaned)
    ai_raw["steps"] = clean_steps
    resolver_payload = resolver.resolve(ai_raw)
    explicit_fields = resolver.resolve_explicit_fields(payload_fields)
    resolver_payload["fields"] = {
        **resolver_payload.get("fields", {}),
        **explicit_fields,
        "project": payload_fields["project"],
        "issuetype": {"id": issue_type_id},
    }
    return resolver_payload


def _validate_payload(schema: list, payload_fields: dict) -> List[Dict]:
    missing_fields = []
    for field in schema:
        if not field.get("required") or is_system_managed_standard_field(field):
            continue
        value = get_payload_value_for_field(field, payload_fields)
        if _is_missing_jira_value(field, value):
            missing_fields.append({"key": field["key"], "name": field["name"]})
    return missing_fields


async def generate_findings_response(req: FindingGenerationRequest, db: Session, current_user: User, include_analysis_summary: bool):
    if not (req.project_id or req.project_key) or not req.issue_type_id:
        raise HTTPException(status_code=400, detail="Missing Jira context (Project or Issue Type). Please ensure you are on a valid Jira issue tab.")

    conn = get_owned_connection(db, current_user.id, req.jira_connection_id)
    assert_connection_matches_instance(conn, req.instance_url)
    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    schema_project_id = req.project_id or req.project_key
    try:
        schema = engine.get_field_schema(schema_project_id, req.issue_type_id)
    except HTTPException as e:
        if e.status_code == 400:
            raise HTTPException(status_code=400, detail=f"Failed to fetch Jira configurations for project '{schema_project_id}' and issue type '{req.issue_type_id}'. Verify these exist and your account has access.")
        raise e

    custom_api_key = decrypt_credential(current_user.encrypted_ai_api_key) if current_user.encrypted_ai_api_key else None
    generator = BugGenerator(api_key=custom_api_key)
    story_context = compose_story_context(req.selected_text, req.issue_context)
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
    resolver = BugJiraPayloadResolver(mapping_config, schema, platform=platform)
    resolved_bugs = []
    for raw_bug in ai_bugs_raw:
        if not isinstance(raw_bug, dict):
            continue
        jira_payload = resolver.resolve(raw_bug)
        ai_custom_fields = resolver.resolve_explicit_fields(_extract_ai_custom_fields(raw_bug, schema))
        jira_payload["fields"].update(ai_custom_fields)
        jira_payload["fields"] = _merge_saved_field_defaults(jira_payload["fields"], mapping_record, schema)
        steps_list = raw_bug.get("steps", [])
        if isinstance(steps_list, list):
            steps_text = "\n".join(re.sub(r"^\s*\d+\.\s*", "", str(step)).strip() for step in steps_list if str(step).strip())
        else:
            steps_text = str(steps_list)
        summary = str(raw_bug.get("summary") or "").strip()
        description = str(raw_bug.get("description") or "").strip()
        expected = str(raw_bug.get("expected") or "").strip()
        actual = str(raw_bug.get("actual") or "").strip()
        if not (summary and description and steps_text.strip() and expected and actual):
            continue
        resolved_bugs.append({
            "summary": summary,
            "description": description,
            "steps_to_reproduce": steps_text,
            "expected_result": expected,
            "actual_result": actual,
            "severity": str(raw_bug.get("severity") or "Medium").strip() or "Medium",
            "confidence": _normalize_confidence(raw_bug.get("confidence"), 75),
            "category": str(raw_bug.get("category") or "Functional Gap").strip() or "Functional Gap",
            "acceptance_criteria_refs": raw_bug.get("acceptance_criteria_refs", []) or [],
            "evidence": raw_bug.get("evidence", []) or [],
            "duplicate_group": raw_bug.get("duplicate_group"),
            "overlap_warning": raw_bug.get("overlap_warning"),
            "fields": jira_payload["fields"],
        })
    if not resolved_bugs:
        raise HTTPException(status_code=502, detail="AI returned no usable findings. Please try again with more story detail or supporting context.")
    ai_warnings = ai_raw.get("warnings", [])
    if isinstance(ai_warnings, str):
        ai_warnings = [ai_warnings]
    elif not isinstance(ai_warnings, list):
        ai_warnings = []
    warnings = list(dict.fromkeys([*ai_warnings, *overlap_warnings]))
    if include_analysis_summary:
        analysis_summary = ai_raw.get("analysis_summary")
        if not isinstance(analysis_summary, dict):
            analysis_summary = generator._synthesize_analysis_summary(resolved_bugs, "Gap analysis", story_context)
        return GapAnalysisResponse(
            bugs=resolved_bugs,
            ac_coverage=_normalize_percentage(ai_raw.get("ac_coverage"), 0.0),
            warnings=warnings,
            analysis_summary=analysis_summary,
        )
    return ManualBugGenerationResponse(bugs=resolved_bugs, warnings=warnings)


async def generate_test_suite_response(req: TestCaseGenerationRequest, db: Session, current_user: User) -> TestSuiteResponse:
    if not (req.project_id or req.project_key) or not req.issue_type_id:
        raise HTTPException(status_code=400, detail="Missing Jira context (Project or Issue Type). Please ensure you are on a valid Jira issue tab.")
    conn = get_owned_connection(db, current_user.id, req.jira_connection_id)
    assert_connection_matches_instance(conn, req.instance_url)
    custom_api_key = decrypt_credential(current_user.encrypted_ai_api_key) if current_user.encrypted_ai_api_key else None
    generator = TestCaseGenerator(api_key=custom_api_key)
    story_context = compose_story_context(req.selected_text, req.issue_context)
    suite = await generator.generate_test_cases(
        story_context,
        model=req.model or current_user.custom_ai_model,
        custom_instructions=req.custom_instructions,
        issue_type_name=req.issue_type_name,
        supporting_context=req.supporting_context,
    )
    normalized_tests = [normalized for raw_test in (suite.get("test_cases") or []) if (normalized := _normalize_test_case(raw_test))]
    if not normalized_tests:
        raise HTTPException(status_code=502, detail="AI returned no usable test cases. Please try again with more story detail or supporting context.")
    return TestSuiteResponse(test_cases=normalized_tests, coverage_score=_normalize_percentage(suite.get("coverage_score"), 0.0))


async def generate_bulk_test_suites_response(req: BulkTestGenerationRequest, db: Session, current_user: User) -> BulkTestGenerationResponse:
    if not req.stories:
        raise HTTPException(status_code=400, detail="At least one story is required for bulk test generation")
    conn = get_owned_connection(db, current_user.id, req.jira_connection_id)
    assert_connection_matches_instance(conn, req.instance_url)
    custom_api_key = decrypt_credential(current_user.encrypted_ai_api_key) if current_user.encrypted_ai_api_key else None
    generator = TestCaseGenerator(api_key=custom_api_key)
    results: List[BulkTestGenerationItem] = []
    warnings: List[str] = []
    for story in req.stories[:50]:
        story_warnings: List[str] = []
        try:
            suite = await generator.generate_test_cases(
                _bulk_story_context(story, story_warnings),
                model=req.model or current_user.custom_ai_model,
                issue_type_name=req.issue_type_name,
                supporting_context=req.supporting_context,
            )
            normalized_tests = [normalized for raw_test in (suite.get("test_cases") or []) if (normalized := _normalize_test_case(raw_test))]
            if not normalized_tests:
                raise HTTPException(status_code=502, detail="AI returned no usable test cases")
            results.append(BulkTestGenerationItem(
                storyKey=story.key,
                ok=True,
                result=TestSuiteResponse(test_cases=normalized_tests, coverage_score=_normalize_percentage(suite.get("coverage_score"), 0.0)),
            ))
            warnings.extend(story_warnings)
        except HTTPException as exc:
            results.append(BulkTestGenerationItem(storyKey=story.key, ok=False, error=str(exc.detail)))
        except Exception as exc:
            logger.exception("bulk_test_generation_failed story=%s", story.key)
            results.append(BulkTestGenerationItem(storyKey=story.key, ok=False, error=str(exc)))
    return BulkTestGenerationResponse(results=results, warnings=list(dict.fromkeys(warnings)))


async def bulk_analyze_stories_response(req: BulkAnalyzeRequest, db: Session, current_user: User) -> GapAnalysisResponse:
    if not req.stories:
        raise HTTPException(status_code=400, detail="At least one story is required for bulk analysis")
    warnings: List[str] = []
    story_context = _bulk_combined_story_context(req.stories[:50], warnings)
    bulk_req = FindingGenerationRequest(
        selected_text=f"Analyze these {len(req.stories)} stories for contradictions, redundancies, missing requirements, and cross-story risks.\n\n{story_context}",
        jira_connection_id=req.jira_connection_id,
        instance_url=req.instance_url,
        project_key=req.project_key,
        project_id=req.project_id,
        issue_type_id=req.issue_type_id,
        issue_type_name=req.issue_type_name,
        model=req.model,
        bug_count=7,
        supporting_context=req.supporting_context,
    )
    response = await generate_findings_response(bulk_req, db, current_user, include_analysis_summary=True)
    response.warnings = list(dict.fromkeys([*response.warnings, *warnings]))
    return response


async def bulk_compare_brd_response(req: BulkBrdCompareRequest, db: Session, current_user: User) -> GapAnalysisResponse:
    if not req.stories:
        raise HTTPException(status_code=400, detail="At least one story is required for BRD comparison")
    if not req.brd_text.strip():
        raise HTTPException(status_code=400, detail="BRD text is required for comparison")
    warnings: List[str] = []
    brd_text = _truncate_text(req.brd_text, BULK_BRD_TEXT_CHAR_LIMIT, "BRD text", warnings)
    story_context = _bulk_combined_story_context(req.stories[:50], warnings)
    bulk_req = FindingGenerationRequest(
        selected_text=(
            "Compare this BRD against the Jira stories. Identify missing stories, contradictions, "
            "ambiguous requirements, and uncovered acceptance criteria.\n\n"
            f"BRD:\n{brd_text}\n\nStories:\n{story_context}"
        ),
        jira_connection_id=req.jira_connection_id,
        instance_url=req.instance_url,
        project_key=req.project_key,
        project_id=req.project_id,
        issue_type_id=req.issue_type_id,
        issue_type_name=req.issue_type_name,
        model=req.model,
        bug_count=7,
        supporting_context=req.supporting_context,
    )
    response = await generate_findings_response(bulk_req, db, current_user, include_analysis_summary=True)
    response.warnings = list(dict.fromkeys([*response.warnings, *warnings]))
    return response


def prepare_bug_preview_response(req: PreviewPreparationRequest, db: Session, current_user: User) -> PreviewPreparationResponse:
    conn = get_owned_connection(db, current_user.id, req.jira_connection_id)
    assert_connection_matches_instance(conn, req.instance_url)
    adapter = get_adapter(conn)
    prefer_project_key = isinstance(adapter, JiraServerAdapter)
    schema_project_id = req.project_id or req.project_key
    schema = JiraMetadataEngine(adapter).get_field_schema(schema_project_id, req.issue_type_id)
    mapping_record = _get_field_mapping_record(db, current_user.id, req.project_key, req.project_id, req.issue_type_id)
    payload_fields = inject_standard_field_aliases(
        schema,
        _build_issue_fields(req.bug.model_dump(), req.issue_type_id, req.project_key, req.project_id, prefer_project_key=prefer_project_key),
    )
    payload_fields = _merge_saved_field_defaults(payload_fields, mapping_record, schema)
    platform = "server" if prefer_project_key else "cloud"
    resolved_payload = _resolve_payload(db, current_user.id, req.project_key, req.project_id, req.issue_type_id, schema, payload_fields, platform=platform)
    missing_fields = _validate_payload(schema, resolved_payload.get("fields", {}))
    return PreviewPreparationResponse(valid=len(missing_fields) == 0, missing_fields=missing_fields, resolved_payload=resolved_payload)


def submit_bugs_response(request: Request, req: SubmitBugsRequest, db: Session, current_user: User) -> SubmitBugsResponse:
    idem_key = request.headers.get("Idempotency-Key")
    request_payload = req.model_dump()
    cached_response = idempotency_store.replay_or_reserve("ai.submit", str(current_user.id), idem_key, request_payload)
    if cached_response is not None:
        return SubmitBugsResponse(**cached_response)

    try:
        conn = get_owned_connection(db, current_user.id, req.jira_connection_id)
        assert_connection_matches_instance(conn, req.instance_url)
        adapter = get_adapter(conn)
        prefer_project_key = isinstance(adapter, JiraServerAdapter)
        if not (req.project_id or req.project_key) or not req.issue_type_id:
            raise HTTPException(status_code=400, detail="Missing Jira context (Project or Issue Type). Submission aborted.")
        schema_project_id = req.project_id or req.project_key
        try:
            schema = JiraMetadataEngine(adapter).get_field_schema(schema_project_id, req.issue_type_id)
        except HTTPException as e:
            if e.status_code == 400:
                raise HTTPException(status_code=400, detail=f"Failed to fetch Jira configurations for submission. Project '{schema_project_id}' or issue type '{req.issue_type_id}' may be invalid or inaccessible.")
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
    link_candidates = resolve_link_type_candidates("Relates", available_link_types) if story_issue_key else []
    mapping_record = _get_field_mapping_record(db, current_user.id, req.project_key, req.project_id, req.issue_type_id)
    platform = "server" if prefer_project_key else "cloud"
    prepared_payloads: List[tuple[int, Any, Dict[str, Any]]] = []

    try:
        for bug_index, bug in enumerate(req.bugs):
            payload_fields = inject_standard_field_aliases(
                schema,
                _build_issue_fields(bug.model_dump(), req.issue_type_id, req.project_key, req.project_id, prefer_project_key=prefer_project_key),
            )
            payload_fields = _merge_saved_field_defaults(payload_fields, mapping_record, schema)
            resolved_payload = _resolve_payload(db, current_user.id, req.project_key, req.project_id, req.issue_type_id, schema, payload_fields, platform=platform)
            missing_fields = _validate_payload(schema, resolved_payload.get("fields", {}))
            if missing_fields:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": {
                            "code": "BULK_BUG_FIELDS_MISSING",
                            "message": f"Bug {bug_index + 1} is missing required Jira fields.",
                            "details": [{"bug_index": bug_index, "bug_summary": bug.summary, "missing_fields": missing_fields}],
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
                        rollback_failure_details.append({"issue_key": created_issue_key, "error": str(rollback_exc.detail)})
                error_message = f"Bug {bug_index + 1} could not be created in Jira."
                if rollback_failed_keys:
                    error_message = f"{error_message} Some earlier bugs were already created and could not be deleted automatically. Review Jira permissions or remove them manually."
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
    idempotency_store.store_response("ai.submit", str(current_user.id), idem_key, req.model_dump(), response.model_dump())
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
