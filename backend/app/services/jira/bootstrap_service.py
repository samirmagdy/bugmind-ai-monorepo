from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core.audit import log_audit
from app.models.jira import JiraConnection, JiraFieldMapping
from app.models.user import User
from app.schemas.jira import (
    JiraBootstrapContextRequest,
    JiraBootstrapContextResponse,
    JiraFieldResponse,
    JiraIssueTypeResponse,
    JiraMetadataResponse,
)
from app.services.jira.connection_service import get_adapter, normalize_instance_url
from app.services.jira.metadata_engine import JiraMetadataEngine


def serialize_issue_type(issue_type: dict) -> JiraIssueTypeResponse:
    return JiraIssueTypeResponse(
        id=str(issue_type.get("id", "")),
        name=str(issue_type.get("name", "")),
        icon_url=issue_type.get("iconUrl") or issue_type.get("icon_url"),
        subtask=bool(issue_type.get("subtask", False)),
    )


def project_key_from_issue_key(issue_key: Optional[str]) -> Optional[str]:
    raw = (issue_key or "").strip()
    if "-" not in raw:
        return None
    candidate = raw.split("-", 1)[0].strip()
    return candidate or None


def select_issue_type(issue_types: list[dict], issue_type_id: Optional[str]) -> Optional[dict]:
    if issue_type_id:
        exact = next((item for item in issue_types if str(item.get("id")) == str(issue_type_id)), None)
        if exact:
            return exact

    bug_type = next((item for item in issue_types if "bug" in str(item.get("name", "")).strip().lower()), None)
    if bug_type:
        return bug_type
    return issue_types[0] if issue_types else None


from app.models.workspace import WorkspaceMember

def resolve_jira_bootstrap_context(
    req: JiraBootstrapContextRequest,
    db: Session,
    current_user: User,
    request: Request,
) -> JiraBootstrapContextResponse:
    # 1. Fetch connections (personal + shared via workspaces)
    connections = db.query(JiraConnection).outerjoin(
        WorkspaceMember, JiraConnection.workspace_id == WorkspaceMember.workspace_id
    ).filter(
        (JiraConnection.user_id == current_user.id) |
        (WorkspaceMember.user_id == current_user.id)
    ).distinct().order_by(JiraConnection.is_active.desc(), JiraConnection.id.asc()).all()
    
    if not connections:
        raise HTTPException(status_code=404, detail="No Jira connections found")

    target_url = normalize_instance_url(req.instance_url)
    if not target_url:
        raise HTTPException(status_code=400, detail="A valid Jira instance URL is required")

    ranked_matches = []
    for connection in connections:
        normalized_host = normalize_instance_url(connection.host_url)
        if normalized_host and (
            target_url == normalized_host
            or target_url.startswith(f"{normalized_host}/")
            or target_url.startswith(normalized_host)
        ):
            ranked_matches.append((len(normalized_host), connection))

    ranked_matches.sort(key=lambda item: item[0], reverse=True)
    conn = ranked_matches[0][1] if ranked_matches else (next((item for item in connections if item.is_active), None) or connections[0])
    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)

    canonical_project_id = req.project_id
    canonical_project_key = req.project_key or project_key_from_issue_key(req.issue_key)
    canonical_issue_type_id = req.issue_type_id

    issue_context: dict = {}
    needs_issue_lookup = bool(req.issue_key and not (canonical_project_id and canonical_project_key and canonical_issue_type_id))
    if needs_issue_lookup:
        try:
            issue_context = adapter.get_issue_context(req.issue_key)
        except HTTPException as exc:
            if exc.status_code not in (400, 404):
                raise
            issue_context = {}
    canonical_project_id = issue_context.get("project_id") or canonical_project_id
    canonical_project_key = issue_context.get("project_key") or canonical_project_key
    canonical_issue_type_id = canonical_issue_type_id or issue_context.get("issue_type_id")

    if not (canonical_project_id or canonical_project_key):
        raise HTTPException(status_code=400, detail="Could not resolve Jira project context from the current page")

    project_context: Optional[dict] = None
    issue_types_raw: list[dict] = []
    selected_issue_type_raw: Optional[dict] = None
    visible_fields: list[str] = []
    ai_mapping: dict = {}
    field_defaults: dict = {}
    metadata_fields: list[dict] = []

    project_candidates: list[str] = []
    for candidate in [canonical_project_id, canonical_project_key, req.project_id, req.project_key]:
        if candidate and str(candidate) not in project_candidates:
            project_candidates.append(str(candidate))

    last_project_error: Optional[HTTPException] = None
    for project_candidate in project_candidates:
        try:
            project_context = engine.get_project_metadata(project_candidate)
            issue_types_raw = project_context.get("issue_types", [])
            canonical_project_id = project_context.get("project_id")
            canonical_project_key = project_context.get("project_key")
            break
        except HTTPException as exc:
            last_project_error = exc
            continue

    if not issue_types_raw and last_project_error:
        raise last_project_error
    if not issue_types_raw:
        raise HTTPException(status_code=400, detail="No Jira issue types could be resolved for the selected project")

    selected_issue_type_raw = select_issue_type(issue_types_raw, canonical_issue_type_id)
    if not selected_issue_type_raw:
        raise HTTPException(status_code=400, detail="Could not resolve a Jira issue type for the selected project")

    selected_issue_type_id = str(selected_issue_type_raw.get("id", ""))
    field_resolution_candidates = []
    for candidate in [canonical_project_id, canonical_project_key, req.project_id, req.project_key]:
        if candidate and str(candidate) not in field_resolution_candidates:
            field_resolution_candidates.append(str(candidate))

    last_field_error: Optional[HTTPException] = None
    for field_resolution_ref in field_resolution_candidates:
        try:
            metadata_fields = engine.get_field_schema(field_resolution_ref, selected_issue_type_id)
            if metadata_fields:
                break
        except HTTPException as exc:
            last_field_error = exc
            continue

    if not metadata_fields and last_field_error:
        raise last_field_error

    # 2. Fetch field mappings (personal first, then shared)
    mapping = db.query(JiraFieldMapping).filter(
        JiraFieldMapping.user_id == current_user.id,
        JiraFieldMapping.project_key == canonical_project_key,
        JiraFieldMapping.issue_type_id == selected_issue_type_id,
    )
    canonical_mapping_project_id = canonical_project_id if str(canonical_project_id).isdigit() else None
    if canonical_mapping_project_id is None:
        mapping = mapping.filter(JiraFieldMapping.project_id.is_(None))
    else:
        mapping = mapping.filter(JiraFieldMapping.project_id == canonical_mapping_project_id)
    
    mapping_record = mapping.first()
    if not mapping_record:
        # Fallback to shared workspace mapping
        mapping_record = db.query(JiraFieldMapping).join(
            WorkspaceMember, JiraFieldMapping.workspace_id == WorkspaceMember.workspace_id
        ).filter(
            WorkspaceMember.user_id == current_user.id,
            JiraFieldMapping.is_shared == True,
            JiraFieldMapping.project_key == canonical_project_key,
            JiraFieldMapping.issue_type_id == selected_issue_type_id,
        )
        if canonical_mapping_project_id is None:
            mapping_record = mapping_record.filter(JiraFieldMapping.project_id.is_(None))
        else:
            mapping_record = mapping_record.filter(JiraFieldMapping.project_id == canonical_mapping_project_id)
        mapping_record = mapping_record.first()

    visible_fields = mapping_record.visible_fields if mapping_record else []
    ai_mapping = mapping_record.field_mappings if mapping_record else {}
    field_defaults = mapping_record.field_defaults if mapping_record else {}

    metadata_response = JiraMetadataResponse(
        project_key=canonical_project_key or str(canonical_project_id),
        project_id=canonical_project_id,
        issue_type_id=selected_issue_type_id,
        fields=[JiraFieldResponse(**field) for field in metadata_fields],
    )

    response = JiraBootstrapContextResponse(
        connection_id=conn.id,
        instance_url=normalize_instance_url(conn.host_url),
        platform=conn.auth_type,
        verify_ssl=conn.verify_ssl,
        issue_types=[serialize_issue_type(issue_type) for issue_type in issue_types_raw],
        selected_issue_type=serialize_issue_type(selected_issue_type_raw),
        visible_fields=visible_fields,
        ai_mapping=ai_mapping,
        field_defaults=field_defaults,
        jira_metadata=metadata_response,
    )
    log_audit(
        "jira.bootstrap_context",
        current_user.id,
        db=db,
        jira_connection_id=conn.id,
        instance_url=response.instance_url,
        project_key=req.project_key,
        request_path=str(request.url.path),
    )
    return response
