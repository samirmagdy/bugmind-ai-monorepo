from fastapi import APIRouter, Depends, HTTPException
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
from app.api.v1.jira import get_adapter
from app.core.security import decrypt_credential
import re

router = APIRouter()

STANDARD_ISSUE_FIELDS = {"summary", "description", "issuetype", "project"}


def _get_owned_connection(db: Session, user_id: int, connection_id: int) -> JiraConnection:
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == connection_id,
        JiraConnection.user_id == user_id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Jira connection not found")
    return conn


def _build_issue_fields(bug: dict, issue_type_id: str) -> dict:
    extra_fields = {
        key: value
        for key, value in (bug.get("extra_fields") or {}).items()
        if key not in STANDARD_ISSUE_FIELDS
    }
    return {
        "summary": bug.get("summary"),
        "description": bug.get("description"),
        "steps_to_reproduce": bug.get("steps_to_reproduce", ""),
        "expected_result": bug.get("expected_result"),
        "actual_result": bug.get("actual_result"),
        "issuetype": {"id": issue_type_id},
        **extra_fields
    }


def _resolve_payload(db: Session, user_id: int, project_key: str, project_id: Optional[str], issue_type_id: str, schema: list, payload_fields: dict) -> dict:
    mapping_record = db.query(JiraFieldMapping).filter(
        or_(
            JiraFieldMapping.project_key == project_key,
            JiraFieldMapping.project_id == project_id
        ),
        JiraFieldMapping.issue_type_id == issue_type_id,
        JiraFieldMapping.user_id == user_id
    ).first()
    mapping_config = mapping_record.field_mappings if mapping_record else {}

    resolver = JiraFieldResolver(mapping_config, schema)
    ai_raw = {
        "summary": payload_fields.get("summary"),
        "description": payload_fields.get("description"),
        "steps": payload_fields.get("steps_to_reproduce", "").split("\n"),
        "expected": payload_fields.get("expected_result"),
        "actual": payload_fields.get("actual_result"),
        **payload_fields
    }

    clean_steps = []
    for step in ai_raw["steps"]:
        cleaned = re.sub(r"^\d+\.\s*", "", step).strip()
        if cleaned:
            clean_steps.append(cleaned)
    ai_raw["steps"] = clean_steps

    return resolver.resolve(ai_raw)


def _validate_payload(schema: list, payload_fields: dict) -> List[Dict]:
    missing_fields = []
    for field in schema:
        if field.get("required") and field["key"] not in payload_fields:
            missing_fields.append({
                "key": field["key"],
                "name": field["name"]
            })
        elif field.get("required") and field["key"] in payload_fields:
            value = payload_fields[field["key"]]
            if value is None or value == "" or (isinstance(value, list) and not value):
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
    req: BugGenerationRequest,
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    # 1. Enforce Subscription Limits
    LimitChecker.check_and_increment(db, current_user.id, "/generate", 0)

    # 2. Get Jira Schema
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == req.jira_connection_id, 
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Jira connection not found")
        
    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    schema_project_id = req.project_id or req.project_key
    schema = engine.get_field_schema(schema_project_id, req.issue_type_id)

    # 3. Request AI Generation
    custom_api_key = None
    if current_user.encrypted_ai_api_key:
        custom_api_key = decrypt_credential(current_user.encrypted_ai_api_key)

    generator = BugGenerator(api_key=custom_api_key)
    ai_raw = await generator.generate_bug(
        req.selected_text, 
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
    
    resolver = JiraFieldResolver(mapping_config, schema)
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

    return BugGenerationResponse(
        summary=ai_raw.get("summary", ""),
        description=ai_raw.get("description", ""),
        steps_to_reproduce=steps_text,
        expected_result=ai_raw.get("expected", ""),
        actual_result=ai_raw.get("actual", ""),
        fields=jira_payload["fields"],
        ac_coverage=ai_raw.get("ac_coverage", 0.0)
    )

@router.post("/test-cases", response_model=TestSuiteResponse)
async def generate_test_suite(
    req: BugGenerationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Analyzes story context and generates a suite of test cases.
    """
    LimitChecker.check_and_increment(db, current_user.id, "/test-cases", 0)

    custom_api_key = None
    if current_user.encrypted_ai_api_key:
        custom_api_key = decrypt_credential(current_user.encrypted_ai_api_key)

    generator = BugGenerator(api_key=custom_api_key)
    suite = await generator.generate_test_cases(
        req.selected_text,
        model=req.model or current_user.custom_ai_model,
        custom_instructions=req.custom_instructions
    )
    return TestSuiteResponse(**suite)


@router.post("/preview", response_model=PreviewPreparationResponse)
async def prepare_bug_preview(
    req: PreviewPreparationRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = _get_owned_connection(db, current_user.id, req.jira_connection_id)
    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    schema_project_id = req.project_id or req.project_key
    schema = engine.get_field_schema(schema_project_id, req.issue_type_id)

    payload_fields = _build_issue_fields(req.bug.model_dump(), req.issue_type_id)
    missing_fields = _validate_payload(schema, payload_fields)
    resolved_payload = _resolve_payload(
        db,
        current_user.id,
        req.project_key,
        req.project_id,
        req.issue_type_id,
        schema,
        payload_fields
    )

    return PreviewPreparationResponse(
        valid=len(missing_fields) == 0,
        missing_fields=missing_fields,
        resolved_payload=resolved_payload
    )


@router.post("/submit", response_model=SubmitBugsResponse)
async def submit_bugs(
    req: SubmitBugsRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = _get_owned_connection(db, current_user.id, req.jira_connection_id)
    adapter = get_adapter(conn)
    schema_project_id = req.project_id or req.project_key
    created_issues: List[XrayPublishedTest] = []

    for bug in req.bugs:
        issue_data = {
            "fields": {
                "summary": bug.summary,
                "description": bug.description,
                "issuetype": {"id": req.issue_type_id},
                **{
                    key: value
                    for key, value in (bug.extra_fields or {}).items()
                    if key not in STANDARD_ISSUE_FIELDS
                }
            }
        }
        if "project" not in issue_data["fields"]:
            issue_data["fields"]["project"] = {"key": schema_project_id}

        issue_key = adapter.create_issue(issue_data)
        created_issues.append(XrayPublishedTest(id=issue_key, key=issue_key, self=""))

    return SubmitBugsResponse(created_issues=created_issues)
