from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from app.api import deps
from app.models.user import User
from app.models.jira import JiraConnection, JiraAuthType, JiraFieldMapping
from app.schemas.jira import (
    JiraBootstrapContextRequest,
    JiraBootstrapContextResponse,
    JiraConnectionCreate,
    JiraConnectionResponse,
    JiraConnectionUpdate,
    JiraFieldResponse,
    JiraIssueTypeResponse,
    JiraMetadataResponse,
    JiraProjectResponse,
    JiraUserSearchRequest,
    XrayDefaultsResponse,
)
from app.schemas.bug import XrayTestSuitePublishRequest, XrayTestSuitePublishResponse, XrayPublishedTest
from app.core import security
from app.services.jira.adapters.cloud import JiraCloudAdapter
from app.services.jira.adapters.server import JiraServerAdapter
from app.services.jira.metadata_engine import JiraMetadataEngine
from urllib.parse import urlparse
from app.core.audit import log_audit
from app.core.idempotency import idempotency_store
from app.core.rate_limit import rate_limiter
from app.core.request_security import enforce_secure_jira_ssl, validate_connection_host

router = APIRouter()

from cryptography.fernet import InvalidToken

def get_adapter(connection: JiraConnection):
    enforce_secure_jira_ssl(connection.verify_ssl)
    safe_host_url = validate_connection_host(connection.host_url, connection.auth_type.value)
    try:
        token = security.decrypt_credential(connection.encrypted_token)
    except InvalidToken:
        raise HTTPException(
            status_code=401, 
            detail="Jira Connection Stale: Encryption keys have changed. Please delete and re-add this connection."
        )
    if connection.auth_type == JiraAuthType.CLOUD:
        return JiraCloudAdapter(safe_host_url, connection.username, token, verify_ssl=connection.verify_ssl)
    return JiraServerAdapter(safe_host_url, connection.username, token, verify_ssl=connection.verify_ssl)


def _normalize_instance_url(url: Optional[str]) -> str:
    trimmed = (url or "").strip().rstrip("/")
    if not trimmed:
        return ""

    try:
        parsed = urlparse(trimmed)
        path = parsed.path.rstrip("/")
        for marker in ("/browse/", "/issues/", "/projects/"):
            if marker in path:
                path = path.split(marker, 1)[0]
                break
        normalized = f"{parsed.scheme}://{parsed.netloc}{path}"
        return normalized.rstrip("/")
    except Exception:
        return trimmed


def _serialize_issue_type(issue_type: dict) -> JiraIssueTypeResponse:
    return JiraIssueTypeResponse(
        id=str(issue_type.get("id", "")),
        name=str(issue_type.get("name", "")),
        icon_url=issue_type.get("iconUrl") or issue_type.get("icon_url"),
        subtask=bool(issue_type.get("subtask", False)),
    )


def _select_issue_type(issue_types: list[dict], issue_type_id: Optional[str]) -> Optional[dict]:
    if issue_type_id:
        exact = next((item for item in issue_types if str(item.get("id")) == str(issue_type_id)), None)
        if exact:
            return exact

    bug_type = next((item for item in issue_types if "bug" in str(item.get("name", "")).strip().lower()), None)
    if bug_type:
        return bug_type
    return issue_types[0] if issue_types else None


def _normalize_folder_path(folder_path: Optional[str], story_issue_key: str) -> str:
    raw_value = (folder_path or story_issue_key or "").strip()
    normalized = raw_value.replace("\\", "/")
    normalized = "/".join(part.strip() for part in normalized.split("/") if part.strip())
    if not normalized:
        raise HTTPException(status_code=400, detail="A valid Xray folder path is required")
    return normalized


def _resolve_test_issue_type_id(issue_types: list[dict], test_issue_type_id: Optional[str], test_issue_type_name: Optional[str]) -> str:
    if test_issue_type_id:
        return str(test_issue_type_id)

    desired_name = (test_issue_type_name or "Test").strip().lower()
    exact_match = next((item for item in issue_types if str(item.get("name", "")).strip().lower() == desired_name), None)
    if exact_match:
        return str(exact_match["id"])

    partial_match = next((item for item in issue_types if desired_name in str(item.get("name", "")).strip().lower()), None)
    if partial_match:
        return str(partial_match["id"])

    fallback = next((item for item in issue_types if "test" in str(item.get("name", "")).strip().lower()), None)
    if fallback:
        return str(fallback["id"])

    raise HTTPException(status_code=400, detail="Could not find an Xray Test issue type in the selected project")


def _detect_repository_path_field_id(fields: list[dict], repository_path_field_id: Optional[str]) -> Optional[str]:
    if repository_path_field_id:
        return repository_path_field_id

    preferred_names = (
        "test repository path",
        "repository path",
        "test repository",
        "test repo path",
    )
    for field in fields:
        name = str(field.get("name", "")).strip().lower()
        if any(candidate in name for candidate in preferred_names):
            return field.get("id")
    return None


def _resolve_link_type_candidates(link_type: Optional[str], available_types: list[str]) -> list[str]:
    candidates: list[str] = []
    for candidate in [link_type, "Tests", "Test", "Relates"]:
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    if available_types:
        available_lookup = {name.lower(): name for name in available_types}
        resolved: list[str] = []
        for candidate in candidates:
            match = available_lookup.get(candidate.lower())
            if match and match not in resolved:
                resolved.append(match)
        if resolved:
            return resolved
    return candidates


def _format_test_issue_description(story_issue_key: str, test_case: dict) -> str:
    steps = test_case.get("steps", []) or []
    lines = [f"Source Story: {story_issue_key}", "", "Steps:"]
    for idx, step in enumerate(steps, start=1):
        lines.append(f"{idx}. {step}")
    lines.extend(["", "Expected Result:", str(test_case.get("expected_result", "")).strip()])
    lines.extend(["", f"Priority: {str(test_case.get('priority', '')).strip()}"])
    return "\n".join(lines).strip()


def resolve_jira_bootstrap_context(
    req: JiraBootstrapContextRequest,
    db: Session,
    current_user: User,
    request: Request
) -> JiraBootstrapContextResponse:
    connections = db.query(JiraConnection).filter(
        JiraConnection.user_id == current_user.id
    ).order_by(JiraConnection.is_active.desc(), JiraConnection.id.asc()).all()
    if not connections:
        raise HTTPException(status_code=404, detail="No Jira connections found")

    target_url = _normalize_instance_url(req.instance_url)
    if not target_url:
        raise HTTPException(status_code=400, detail="A valid Jira instance URL is required")

    ranked_matches = []
    for connection in connections:
        normalized_host = _normalize_instance_url(connection.host_url)
        if normalized_host and (
            target_url == normalized_host or
            target_url.startswith(f"{normalized_host}/") or
            target_url.startswith(normalized_host)
        ):
            ranked_matches.append((len(normalized_host), connection))

    ranked_matches.sort(key=lambda item: item[0], reverse=True)
    conn = ranked_matches[0][1] if ranked_matches else (next((item for item in connections if item.is_active), None) or connections[0])

    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)
    issue_context: dict = {}
    if req.issue_key:
        try:
            issue_context = adapter.get_issue_context(req.issue_key)
        except HTTPException:
            issue_context = {}

    canonical_project_id = issue_context.get("project_id") or req.project_id
    canonical_project_key = issue_context.get("project_key") or req.project_key
    canonical_issue_type_id = req.issue_type_id or issue_context.get("issue_type_id")

    issue_types_raw: list[dict] = []
    selected_issue_type_raw: Optional[dict] = None
    visible_fields: list[str] = []
    ai_mapping: dict = {}
    field_defaults: dict = {}
    metadata_fields: list[dict] = []

    project_candidates: list[str] = []
    for candidate in [
        canonical_project_id,
        canonical_project_key,
        req.project_id,
        req.project_key,
    ]:
        if candidate and str(candidate) not in project_candidates:
            project_candidates.append(str(candidate))

    if project_candidates:
        last_project_error: Optional[HTTPException] = None
        resolved_issue_type_project_ref: Optional[str] = None
        for project_candidate in project_candidates:
            try:
                issue_types_raw = engine.get_project_metadata(project_candidate, force_refresh=req.force_refresh)
                resolved_issue_type_project_ref = project_candidate
                last_project_error = None # Clear any errors from previous candidates
                break
            except HTTPException as exc:
                last_project_error = exc
                continue

        if not issue_types_raw and last_project_error:
            # Only raise if we didn't get a successful response from ANY candidate
            raise last_project_error

        selected_issue_type_raw = _select_issue_type(issue_types_raw, canonical_issue_type_id)

        if selected_issue_type_raw:
            selected_issue_type_id = str(selected_issue_type_raw.get("id", ""))
            mapping = db.query(JiraFieldMapping).filter(
                JiraFieldMapping.user_id == current_user.id,
                or_(
                    JiraFieldMapping.project_key == (canonical_project_key or resolved_issue_type_project_ref),
                    JiraFieldMapping.project_id == canonical_project_id,
                ),
                JiraFieldMapping.issue_type_id == selected_issue_type_id
            ).first()
            visible_fields = mapping.visible_fields if mapping else []
            ai_mapping = mapping.field_mappings if mapping else {}
            field_defaults = mapping.field_defaults if mapping else {}

            for project_candidate in project_candidates:
                try:
                    metadata_fields = engine.get_field_schema(project_candidate, selected_issue_type_id, force_refresh=req.force_refresh)
                    if str(project_candidate).isdigit():
                        canonical_project_id = canonical_project_id or project_candidate
                    else:
                        canonical_project_key = canonical_project_key or project_candidate
                    break
                except HTTPException:
                    continue

    metadata_response: Optional[JiraMetadataResponse] = None
    if canonical_project_id or canonical_project_key:
        metadata_response = JiraMetadataResponse(
            project_key=canonical_project_key or str(canonical_project_id),
            project_id=canonical_project_id or canonical_project_key,
            issue_type_id=str(selected_issue_type_raw.get("id", "")) if selected_issue_type_raw else canonical_issue_type_id,
            fields=[JiraFieldResponse(**field) for field in metadata_fields]
        )

    response = JiraBootstrapContextResponse(
        connection_id=conn.id,
        instance_url=_normalize_instance_url(conn.host_url),
        platform=conn.auth_type,
        verify_ssl=conn.verify_ssl,
        issue_types=[_serialize_issue_type(issue_type) for issue_type in issue_types_raw],
        selected_issue_type=_serialize_issue_type(selected_issue_type_raw) if selected_issue_type_raw else None,
        visible_fields=visible_fields,
        ai_mapping=ai_mapping,
        field_defaults=field_defaults,
        jira_metadata=metadata_response
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

@router.get("/connections", response_model=list[JiraConnectionResponse])
def list_connections(
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    return db.query(JiraConnection).filter(JiraConnection.user_id == current_user.id).order_by(JiraConnection.is_active.desc(), JiraConnection.id.asc()).all()


@router.post("/bootstrap-context", response_model=JiraBootstrapContextResponse)
def bootstrap_jira_context(
    req: JiraBootstrapContextRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    return resolve_jira_bootstrap_context(req, db, current_user, request)

@router.post("/connections", response_model=JiraConnectionResponse)
def create_connection(
    conn_in: JiraConnectionCreate, 
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    if not conn_in.token or not conn_in.token.strip():
        raise HTTPException(status_code=400, detail="API Token cannot be empty")
    enforce_secure_jira_ssl(conn_in.verify_ssl)
    safe_host_url = validate_connection_host(conn_in.host_url, conn_in.auth_type.value)

    encrypted = security.encrypt_credential(conn_in.token)
    db.query(JiraConnection).filter(JiraConnection.user_id == current_user.id).update(
        {JiraConnection.is_active: False},
        synchronize_session=False
    )

    conn = JiraConnection(
        user_id=current_user.id,
        auth_type=conn_in.auth_type,
        host_url=safe_host_url,
        username=conn_in.username,
        encrypted_token=encrypted,
        verify_ssl=conn_in.verify_ssl,
        is_active=True,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    log_audit("jira.connection_create", current_user.id, db=db, connection_id=conn.id, host_url=conn.host_url)
    return conn

@router.patch("/connections/{conn_id}", response_model=JiraConnectionResponse)
def update_connection(
    conn_id: int,
    conn_in: JiraConnectionUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    update_data = conn_in.model_dump(exclude_unset=True)
    effective_auth_type = update_data.get("auth_type", conn.auth_type)
    if "verify_ssl" in update_data and update_data["verify_ssl"] is not None:
        enforce_secure_jira_ssl(update_data["verify_ssl"])
    if "host_url" in update_data and update_data["host_url"]:
        update_data["host_url"] = validate_connection_host(update_data["host_url"], effective_auth_type.value)
    if "token" in update_data:
        token_val = update_data.pop("token")
        if token_val and token_val.strip():
            update_data["encrypted_token"] = security.encrypt_credential(token_val)
    
    if update_data.get("is_active") is True:
        db.query(JiraConnection).filter(
            JiraConnection.user_id == current_user.id,
            JiraConnection.id != conn_id
        ).update({JiraConnection.is_active: False}, synchronize_session=False)

    for field, value in update_data.items():
        setattr(conn, field, value)
    
    db.add(conn)
    db.commit()
    db.refresh(conn)
    log_audit("jira.connection_update", current_user.id, db=db, connection_id=conn_id)
    return conn

@router.delete("/connections/{conn_id}", status_code=204)
def delete_connection(
    conn_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    db.delete(conn)
    db.commit()
    log_audit("jira.connection_delete", current_user.id, db=db, connection_id=conn_id)

    if conn.is_active:
        replacement = db.query(JiraConnection).filter(JiraConnection.user_id == current_user.id).order_by(JiraConnection.id.asc()).first()
        if replacement:
            replacement.is_active = True
            db.add(replacement)
            db.commit()
    return None

@router.get("/connections/{conn_id}/projects")
def get_projects(
    conn_id: int, 
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
        
    adapter = get_adapter(conn)
    return adapter.get_projects()


@router.get("/connections/{conn_id}/xray/defaults", response_model=XrayDefaultsResponse)
def get_xray_defaults(
    conn_id: int,
    story_issue_key: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == conn_id,
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    projects = adapter.get_projects()
    story_project_key = (story_issue_key or "").split("-", 1)[0] if story_issue_key else None
    default_project = next((project for project in projects if project.get("key") == story_project_key), None)
    if not default_project and projects:
        default_project = projects[0]

    projects_response = [
        JiraProjectResponse(
            id=str(project.get("id", "")),
            key=str(project.get("key", "")),
            name=str(project.get("name", "")),
        )
        for project in projects
    ]

    return XrayDefaultsResponse(
        projects=projects_response,
        target_project_id=str(default_project.get("id")) if default_project else None,
        target_project_key=str(default_project.get("key")) if default_project else None,
        test_issue_type_name="Test",
        repository_path_field_id=None,
        folder_path=(story_issue_key or "").strip(),
        link_type="Tests",
    )

@router.post("/users/search")
def search_jira_users(
    request: JiraUserSearchRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    query = request.query.strip()
    if len(query) < 2:
        return []

    conn = db.query(JiraConnection).filter(
        JiraConnection.id == request.jira_connection_id,
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    results = adapter.search_users(
        query,
        project_id=request.project_id,
        project_key=request.project_key,
        issue_type_id=request.issue_type_id,
        field_id=request.field_id,
    )
    log_audit(
        "jira.user_search",
        current_user.id,
        db=db,
        jira_connection_id=conn.id,
        query_length=len(query),
        result_count=len(results),
    )
    return results

@router.post("/connections/{conn_id}/xray/test-suite", response_model=XrayTestSuitePublishResponse)
def publish_xray_test_suite(
    conn_id: int,
    request: Request,
    req: XrayTestSuitePublishRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    rate_limiter.check("jira.xray_publish", str(current_user.id), limit=5, window_seconds=60)
    idem_key = request.headers.get("Idempotency-Key")
    cached_response = idempotency_store.replay_or_reserve(
        "jira.xray_publish",
        str(current_user.id),
        idem_key,
        req.model_dump(),
    )
    if cached_response is not None:
        return XrayTestSuitePublishResponse(**cached_response)

    if conn_id != req.jira_connection_id:
        raise HTTPException(status_code=400, detail="Connection mismatch for Xray publish request")
    if not req.test_cases:
        raise HTTPException(status_code=400, detail="No test cases were provided for Xray publishing")

    conn = db.query(JiraConnection).filter(
        JiraConnection.id == conn_id,
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)

    issue_types = engine.get_project_metadata(req.xray_project_id)
    test_issue_type_id = _resolve_test_issue_type_id(issue_types, req.test_issue_type_id, req.test_issue_type_name)
    test_fields = engine.get_field_schema(req.xray_project_id, test_issue_type_id)
    repository_path_field_id = _detect_repository_path_field_id(test_fields, req.repository_path_field_id)
    folder_path = _normalize_folder_path(req.folder_path, req.story_issue_key)

    available_link_types: list[str] = []
    try:
        available_link_types = adapter.get_issue_link_types()
    except HTTPException:
        available_link_types = []

    link_candidates = _resolve_link_type_candidates(req.link_type, available_link_types)
    created_tests: list[XrayPublishedTest] = []
    warnings: list[str] = []
    link_type_used: Optional[str] = None

    for test_case in req.test_cases:
        fields = {
            "project": {"key": req.xray_project_key} if req.xray_project_key else {"id": req.xray_project_id},
            "summary": test_case.title,
            "description": _format_test_issue_description(req.story_issue_key, test_case.model_dump()),
            "issuetype": {"id": test_issue_type_id},
        }
        if repository_path_field_id:
            fields[repository_path_field_id] = folder_path

        issue_key = adapter.create_issue({"fields": fields})
        created_tests.append(XrayPublishedTest(id=issue_key, key=issue_key, self=""))

        linked = False
        for candidate in link_candidates:
            try:
                adapter.link_issues(issue_key, candidate, req.story_issue_key)
                linked = True
                if not link_type_used:
                    link_type_used = candidate
                break
            except HTTPException:
                continue

        if not linked:
            warnings.append(f"Created {issue_key} but could not link it to {req.story_issue_key}")

    if not repository_path_field_id:
        warnings.append("Created tests without setting an Xray repository path because no repository path field was detected")

    response = XrayTestSuitePublishResponse(
        created_tests=created_tests,
        folder_path=folder_path,
        repository_path_field_id=repository_path_field_id,
        link_type_used=link_type_used,
        warnings=warnings,
    )
    idempotency_store.store_response(
        "jira.xray_publish",
        str(current_user.id),
        idem_key,
        req.model_dump(),
        response.model_dump(),
    )
    log_audit(
        "jira.xray_publish",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_id=req.xray_project_id,
        request_path=str(request.url.path),
        created_test_keys=[test.key for test in created_tests],
        warnings=warnings,
    )
    return response
