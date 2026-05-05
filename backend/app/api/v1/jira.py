from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Any, Optional
import httpx
import zipfile
import xml.etree.ElementTree as ET
from pypdf import PdfReader
from app.api import deps
from app.models.user import User
from app.models.jira import JiraConnection, JiraAuthType, JiraFieldMapping
from app.schemas.jira import (
    JiraBootstrapContextRequest,
    JiraBootstrapContextResponse,
    JiraBulkFetchRequest,
    JiraBulkFetchResponse,
    JiraBulkIssueResponse,
    JiraAttachmentResponse,
    JiraAttachmentTextResponse,
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
from app.schemas.bug import (
    XrayTestSuitePublishRequest,
    XrayTestSuitePublishResponse,
    XrayPublishedTest,
    DuplicateCheckRequest,
    DuplicateCheckResponse,
    DuplicateMatchResponse,
    DuplicateLinkRequest,
    DuplicateLinkResponse,
)
from app.core import security
from app.services.jira.adapters.cloud import JiraCloudAdapter
from app.services.jira.adapters.server import JiraServerAdapter
from app.services.jira.metadata_engine import JiraMetadataEngine
from urllib.parse import quote, urlparse
from io import BytesIO
from app.core.audit import log_audit
from app.core.idempotency import idempotency_store
from app.core.rate_limit import rate_limiter
from app.core.request_security import enforce_secure_jira_ssl, validate_connection_host
from app.core.config import settings
from app.services.jira.bulk_epic_service import fetch_epic_children
from app.services.jira.bootstrap_service import (
    resolve_jira_bootstrap_context as resolve_jira_bootstrap_context_service,
    select_issue_type as service_select_issue_type,
    serialize_issue_type,
)
from app.services.jira.connection_service import (
    get_adapter as build_jira_adapter,
    get_owned_connection,
    normalize_instance_url,
    verify_connection_credentials,
)
from app.services.jira.connection_management import (
    create_user_connection,
    delete_user_connection,
    list_user_connections,
    update_user_connection,
)
from app.services.jira.document_extractor import decode_text_attachment
from app.services.jira.xray_publisher import (
    XrayCloudPublisher,
    XrayServerPublisher,
    resolve_link_type_candidates as service_resolve_link_type_candidates,
)

router = APIRouter()
MAX_BRD_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_BRD_ATTACHMENT_TEXT_CHARS = 120_000
MAX_BRD_PDF_PAGES = 50

from cryptography.fernet import InvalidToken

def get_adapter(connection: JiraConnection):
    return build_jira_adapter(connection)


def _verify_connection_credentials(auth_type: JiraAuthType, host_url: str, username: str, token: str, verify_ssl: bool) -> None:
    verify_connection_credentials(auth_type, host_url, username, token, verify_ssl)


def _normalize_instance_url(url: Optional[str]) -> str:
    return normalize_instance_url(url)


def _serialize_issue_type(issue_type: dict) -> JiraIssueTypeResponse:
    return serialize_issue_type(issue_type)


def _project_key_from_issue_key(issue_key: Optional[str]) -> Optional[str]:
    raw = (issue_key or "").strip()
    if "-" not in raw:
        return None
    candidate = raw.split("-", 1)[0].strip()
    return candidate or None


def _quote_jql_value(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _build_epic_children_jql(epic_key: str) -> str:
    quoted = _quote_jql_value(epic_key)
    return f'parent = {quoted} OR "Epic Link" = {quoted} OR issue in linkedIssues({quoted})'


def _attachment_response(raw_attachment: dict, issue_key: Optional[str] = None) -> JiraAttachmentResponse:
    return JiraAttachmentResponse(
        id=str(raw_attachment.get("id") or ""),
        filename=str(raw_attachment.get("filename") or raw_attachment.get("name") or ""),
        mime_type=raw_attachment.get("mimeType") or raw_attachment.get("mime_type"),
        size=raw_attachment.get("size"),
        issue_key=issue_key,
    )


def _stringify_jira_description(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        parts: list[str] = []

        def walk(node: Any) -> None:
            if isinstance(node, dict):
                text = node.get("text")
                if isinstance(text, str):
                    parts.append(text)
                for child in node.get("content") or []:
                    walk(child)
            elif isinstance(node, list):
                for child in node:
                    walk(child)

        walk(value)
        return " ".join(parts)
    return ""


def _score_story_risk(issue: dict) -> tuple[int, list[str]]:
    fields = issue.get("fields", {}) if isinstance(issue, dict) else {}
    summary = str(fields.get("summary") or "")
    description = _stringify_jira_description(fields.get("description"))
    combined = f"{summary}\n{description}".lower()
    reasons: list[str] = []
    score = 0

    if len(description.strip()) < 80:
        score += 25
        reasons.append("short_description")
    if not any(term in combined for term in ("acceptance criteria", "given", "when", "then", "must", "should")):
        score += 25
        reasons.append("missing_clear_acceptance_criteria")
    if any(term in combined for term in ("tbd", "todo", "unknown", "n/a", "later")):
        score += 20
        reasons.append("placeholder_language")
    if any(term in combined for term in ("payment", "auth", "permission", "security", "role", "integration", "migration")):
        score += 15
        reasons.append("high_impact_domain")
    if any(term in combined for term in ("all", "any", "etc", "and/or", "multiple")):
        score += 10
        reasons.append("ambiguous_scope")

    return min(score, 100), reasons


def _normalize_bulk_issue(issue: dict) -> JiraBulkIssueResponse:
    fields = issue.get("fields", {}) if isinstance(issue, dict) else {}
    issue_type = fields.get("issuetype") if isinstance(fields.get("issuetype"), dict) else {}
    status = fields.get("status") if isinstance(fields.get("status"), dict) else {}
    issue_key = str(issue.get("key") or "")
    risk_score, risk_reasons = _score_story_risk(issue)

    raw_attachments = fields.get("attachment") or []
    attachments = [
        _attachment_response(attachment, issue_key)
        for attachment in raw_attachments
        if isinstance(attachment, dict) and attachment.get("id")
    ]

    return JiraBulkIssueResponse(
        id=str(issue.get("id") or ""),
        key=issue_key,
        summary=str(fields.get("summary") or ""),
        description=fields.get("description"),
        issue_type=issue_type.get("name"),
        status=status.get("name"),
        risk_score=risk_score,
        risk_reasons=risk_reasons,
        attachments=attachments,
    )


def _limit_extracted_attachment_text(text: str) -> tuple[str, bool]:
    stripped = text.strip()
    if len(stripped) <= MAX_BRD_ATTACHMENT_TEXT_CHARS:
        return stripped, False
    return stripped[:MAX_BRD_ATTACHMENT_TEXT_CHARS].rstrip(), True


def _decode_text_attachment(content: bytes, content_type: str, filename: str) -> tuple[str, bool]:
    if len(content) > MAX_BRD_ATTACHMENT_BYTES:
        raise HTTPException(
            status_code=413,
            detail="The selected attachment is too large for BRD extraction. Use a file up to 10 MB or paste the relevant text manually.",
        )

    normalized_type = (content_type or "").split(";", 1)[0].strip().lower()
    normalized_name = filename.strip().lower()

    if (
        normalized_type.startswith("text/")
        or normalized_type in {
            "application/json",
            "application/xml",
            "application/yaml",
            "application/x-yaml",
            "text/markdown",
            "text/csv",
        }
        or normalized_name.endswith((".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log"))
    ):
        for encoding in ("utf-8-sig", "utf-8", "utf-16"):
            try:
                return _limit_extracted_attachment_text(content.decode(encoding))
            except UnicodeDecodeError:
                continue
        return _limit_extracted_attachment_text(content.decode("utf-8", errors="replace"))

    is_docx = (
        normalized_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or normalized_name.endswith(".docx")
    )
    if is_docx:
        try:
            with zipfile.ZipFile(BytesIO(content)) as archive:
                document_xml = archive.read("word/document.xml")
        except (KeyError, zipfile.BadZipFile) as exc:
            raise HTTPException(status_code=400, detail="Could not read text from the DOCX attachment") from exc

        try:
            root = ET.fromstring(document_xml)
        except ET.ParseError as exc:
            raise HTTPException(status_code=400, detail="Could not parse DOCX document text") from exc

        namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        paragraphs: list[str] = []
        for paragraph in root.iter(f"{namespace}p"):
            parts: list[str] = []
            for node in paragraph.iter():
                if node.tag == f"{namespace}t" and node.text:
                    parts.append(node.text)
                elif node.tag == f"{namespace}tab":
                    parts.append("\t")
                elif node.tag == f"{namespace}br":
                    parts.append("\n")
            text = "".join(parts).strip()
            if text:
                paragraphs.append(text)
        return _limit_extracted_attachment_text("\n\n".join(paragraphs))

    is_pdf = normalized_type == "application/pdf" or normalized_name.endswith(".pdf")
    if is_pdf:
        try:
            reader = PdfReader(BytesIO(content))
            pages = []
            page_count = len(reader.pages)
            if page_count > MAX_BRD_PDF_PAGES:
                raise HTTPException(
                    status_code=413,
                    detail=f"The selected PDF has {page_count} pages. Use a PDF up to {MAX_BRD_PDF_PAGES} pages or paste the relevant BRD text manually.",
                )
            for index, page in enumerate(reader.pages, start=1):
                page_text = (page.extract_text() or "").strip()
                if page_text:
                    pages.append(f"Page {index}\n{page_text}")
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Could not read text from the PDF attachment") from exc

        text = "\n\n".join(pages).strip()
        if not text:
            raise HTTPException(
                status_code=400,
                detail="The selected PDF does not contain extractable text. Use an OCR/text PDF or paste the BRD text manually.",
            )
        return _limit_extracted_attachment_text(text)

    raise HTTPException(
        status_code=415,
        detail="This attachment type cannot be extracted as BRD text. Use TXT, MD, CSV, JSON, XML, YAML, LOG, DOCX, or text-based PDF.",
    )


def _select_issue_type(issue_types: list[dict], issue_type_id: Optional[str]) -> Optional[dict]:
    return service_select_issue_type(issue_types, issue_type_id)


def _normalize_folder_path(folder_path: Optional[str], story_issue_key: str) -> str:
    raw_value = (folder_path or story_issue_key or "").strip()
    normalized = raw_value.replace("\\", "/")
    normalized = "/".join(part.strip() for part in normalized.split("/") if part.strip())
    if not normalized:
        raise HTTPException(status_code=400, detail="A valid Xray folder path is required")
    return normalized


def _resolve_test_issue_type_id(issue_types: list[dict], test_issue_type_id: Optional[str], test_issue_type_name: Optional[str]) -> str:
    if isinstance(issue_types, dict):
        issue_types = issue_types.get("issue_types", []) or []
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
            return field.get("key") or field.get("id")
    return None


def _resolve_link_type_candidates(link_type: Optional[str], available_types: list[str]) -> list[str]:
    return service_resolve_link_type_candidates(link_type, available_types)


def _format_test_issue_description(story_issue_key: str, test_case: dict) -> str:
    steps = test_case.get("steps", []) or []
    lines = [f"Source Story: {story_issue_key}"]
    if test_case.get("test_type"):
        lines.extend(["", f"Test Type: {str(test_case.get('test_type')).strip()}"])
    if test_case.get("preconditions"):
        lines.extend(["", "Preconditions:", str(test_case.get("preconditions", "")).strip()])
    refs = test_case.get("acceptance_criteria_refs") or []
    if refs:
        lines.extend(["", "Acceptance Criteria References:", ", ".join(str(ref) for ref in refs)])
    lines.extend(["", "Steps:"])
    for idx, step in enumerate(steps, start=1):
        lines.append(f"{idx}. {step}")
    lines.extend(["", "Expected Result:", str(test_case.get("expected_result", "")).strip()])
    lines.extend(["", f"Priority: {str(test_case.get('priority', '')).strip()}"])
    labels = test_case.get("labels") or []
    components = test_case.get("components") or []
    if labels:
        lines.extend(["", "Labels:", ", ".join(str(label) for label in labels)])
    if components:
        lines.extend(["", "Components:", ", ".join(str(component) for component in components)])
    return "\n".join(lines).strip()


def _folder_id(folder: dict[str, Any]) -> Optional[str]:
    value = folder.get("id") or folder.get("folderId") or folder.get("folder_id")
    return str(value).strip() if value is not None and str(value).strip() else None


def _folder_name(folder: dict[str, Any]) -> str:
    return str(folder.get("name") or folder.get("folderName") or "").strip()


def _folder_parent_id(folder: dict[str, Any]) -> Optional[str]:
    value = folder.get("parentId") or folder.get("parent_id") or folder.get("parent")
    if isinstance(value, dict):
        value = value.get("id")
    return str(value).strip() if value is not None and str(value).strip() else None


def _folder_path(folder: dict[str, Any]) -> str:
    raw_path = str(folder.get("path") or folder.get("fullPath") or "").strip()
    if raw_path:
        return "/" + "/".join(part.strip() for part in raw_path.split("/") if part.strip())
    return ""


def _flatten_xray_folders(folders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    stack = list(folders)
    while stack:
        folder = stack.pop(0)
        if not isinstance(folder, dict):
            continue
        flattened.append(folder)
        for child_key in ("children", "folders"):
            children = folder.get(child_key)
            if isinstance(children, list):
                stack.extend(child for child in children if isinstance(child, dict))
    return flattened


def _find_xray_folder(
    folders: list[dict[str, Any]],
    *,
    name: Optional[str] = None,
    parent_id: Optional[str] = None,
    path: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    normalized_path = _normalize_folder_path(path, "") if path else None
    for folder in _flatten_xray_folders(folders):
        if normalized_path and _folder_path(folder).strip("/") == normalized_path:
            return folder
        if name:
            folder_parent = _folder_parent_id(folder)
            parent_matches = (
                not parent_id
                or folder_parent == str(parent_id)
                or (str(parent_id) == "0" and folder_parent in (None, "", "0"))
            )
            if parent_matches and _folder_name(folder).lower() == name.strip().lower():
                return folder
    return None


def _ensure_xray_folder(adapter: JiraServerAdapter, project_key: str, folder_path: str) -> str:
    parent_id = "0"
    current_path_parts: list[str] = []

    for part in [segment for segment in folder_path.split("/") if segment.strip()]:
        name = part.strip()
        current_path_parts.append(name)
        folders = adapter.get_xray_folders(project_key)
        existing = _find_xray_folder(
            folders,
            name=name,
            parent_id=parent_id,
            path="/".join(current_path_parts),
        )
        if existing:
            existing_id = _folder_id(existing)
            if existing_id:
                parent_id = existing_id
                continue

        try:
            created = adapter.create_xray_folder(project_key, parent_id, name)
        except HTTPException:
            refreshed = adapter.get_xray_folders(project_key)
            existing = _find_xray_folder(
                refreshed,
                name=name,
                parent_id=parent_id,
                path="/".join(current_path_parts),
            )
            existing_id = _folder_id(existing or {})
            if existing_id:
                parent_id = existing_id
                continue
            raise

        created_id = _folder_id(created)
        if not created_id:
            refreshed = adapter.get_xray_folders(project_key)
            created = _find_xray_folder(
                refreshed,
                name=name,
                parent_id=parent_id,
                path="/".join(current_path_parts),
            ) or {}
            created_id = _folder_id(created)
        if not created_id:
            raise HTTPException(status_code=400, detail=f"Xray created folder '{name}' but did not return a folder id")
        parent_id = created_id

    return parent_id


def _add_xray_manual_steps(adapter: JiraServerAdapter, issue_key: str, test_case: dict) -> None:
    steps = [str(step).strip() for step in (test_case.get("steps") or []) if str(step).strip()]
    expected_result = str(test_case.get("expected_result") or "").strip()
    preconditions = str(test_case.get("preconditions") or "").strip()
    last_index = len(steps) - 1
    for index, step in enumerate(steps):
        adapter.add_xray_step(
            issue_key,
            step,
            data=preconditions if index == 0 and preconditions else None,
            result=expected_result if index == last_index else None,
        )


def _field_key_by_name(fields: list[dict], names: tuple[str, ...]) -> Optional[str]:
    normalized_names = {name.strip().lower() for name in names}
    for field in fields:
        key = field.get("key") or field.get("id")
        name = str(field.get("name", "")).strip().lower()
        if key in normalized_names or name in normalized_names:
            return str(key)
    return None


def _apply_optional_xray_fields(fields_payload: dict, test_fields: list[dict], test_case: dict) -> None:
    field_keys = {str(field.get("key") or field.get("id")) for field in test_fields}

    priority = str(test_case.get("priority") or "").strip()
    if priority and "priority" in field_keys:
        fields_payload["priority"] = {"name": priority}

    labels = [str(label).strip() for label in (test_case.get("labels") or []) if str(label).strip()]
    if labels and "labels" in field_keys:
        fields_payload["labels"] = labels

    components = [str(component).strip() for component in (test_case.get("components") or []) if str(component).strip()]
    if components and "components" in field_keys:
        fields_payload["components"] = [{"name": component} for component in components]

    test_type = str(test_case.get("test_type") or "").strip()
    test_type_field = _field_key_by_name(test_fields, ("test type", "xray test type"))
    if test_type and test_type_field:
        fields_payload[test_type_field] = {"value": test_type}

    preconditions = str(test_case.get("preconditions") or "").strip()
    precondition_field = _field_key_by_name(test_fields, ("precondition", "preconditions"))
    if preconditions and precondition_field:
        fields_payload[precondition_field] = preconditions


def resolve_jira_bootstrap_context(
    req: JiraBootstrapContextRequest,
    db: Session,
    current_user: User,
    request: Request
) -> JiraBootstrapContextResponse:
    return resolve_jira_bootstrap_context_service(req, db, current_user, request)

@router.get("/connections", response_model=list[JiraConnectionResponse])
def list_connections(
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    return list_user_connections(db, current_user)


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
    return create_user_connection(db, current_user, conn_in)

@router.patch("/connections/{conn_id}", response_model=JiraConnectionResponse)
def update_connection(
    conn_id: int,
    conn_in: JiraConnectionUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    return update_user_connection(db, current_user, conn_id, conn_in)

@router.delete("/connections/{conn_id}", status_code=204)
def delete_connection(
    conn_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    delete_user_connection(db, current_user, conn_id)
    return None

@router.get("/connections/{conn_id}/projects")
def get_projects(
    conn_id: int, 
    db: Session = Depends(deps.get_db), 
    current_user: User = Depends(deps.get_current_user)
):
    conn = get_owned_connection(db, current_user.id, conn_id)
        
    adapter = get_adapter(conn)
    return adapter.get_projects()


@router.get("/connections/{conn_id}/current-user")
def get_current_jira_user(
    conn_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = get_owned_connection(db, current_user.id, conn_id)

    adapter = get_adapter(conn)
    return adapter.get_current_user()


@router.get("/connections/{conn_id}/issues/{issue_key}")
def fetch_jira_issue(
    conn_id: int,
    issue_key: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = get_owned_connection(db, current_user.id, conn_id)

    adapter = get_adapter(conn)
    return adapter.fetch_issue(issue_key)


@router.post("/connections/{conn_id}/bulk/epic", response_model=JiraBulkFetchResponse)
def bulk_fetch_epic_children(
    conn_id: int,
    req: JiraBulkFetchRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = get_owned_connection(db, current_user.id, conn_id)
    adapter = get_adapter(conn)
    response = fetch_epic_children(adapter, req.epic_key, req.max_results)
    log_audit(
        "jira.bulk_fetch_epic",
        current_user.id,
        db=db,
        jira_connection_id=conn.id,
        epic_key=response.epic_key,
        issue_count=len(response.issues),
    )
    return response


@router.get("/connections/{conn_id}/attachments/{attachment_id}")
def fetch_jira_attachment(
    conn_id: int,
    attachment_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = get_owned_connection(db, current_user.id, conn_id)

    adapter = get_adapter(conn)
    content, content_type, filename = adapter.fetch_attachment(attachment_id)
    encoded_filename = quote(filename)
    return StreamingResponse(
        BytesIO(content),
        media_type=content_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


@router.get("/connections/{conn_id}/attachments/{attachment_id}/text", response_model=JiraAttachmentTextResponse)
def fetch_jira_attachment_text(
    conn_id: int,
    attachment_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = get_owned_connection(db, current_user.id, conn_id)

    adapter = get_adapter(conn)
    content, content_type, filename = adapter.fetch_attachment(attachment_id)
    text, truncated = decode_text_attachment(content, content_type, filename)
    if not text:
        raise HTTPException(status_code=400, detail="The selected attachment does not contain readable BRD text")

    return JiraAttachmentTextResponse(
        id=attachment_id,
        filename=filename,
        mime_type=content_type,
        content=text,
        truncated=truncated,
    )


@router.get("/connections/{conn_id}/xray/defaults", response_model=XrayDefaultsResponse)
def get_xray_defaults(
    conn_id: int,
    story_issue_key: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = get_owned_connection(db, current_user.id, conn_id)

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

    publish_supported = True
    publish_mode = "xray_cloud" if conn.auth_type == JiraAuthType.CLOUD else "jira_server"
    unsupported_reason = None

    return XrayDefaultsResponse(
        projects=projects_response,
        target_project_id=str(default_project.get("id")) if default_project else None,
        target_project_key=str(default_project.get("key")) if default_project else None,
        test_issue_type_name="Test",
        repository_path_field_id=None,
        folder_path=(story_issue_key or "").strip(),
        link_type="Tests",
        publish_supported=publish_supported,
        publish_mode=publish_mode,
        unsupported_reason=unsupported_reason,
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

    conn = get_owned_connection(db, current_user.id, request.jira_connection_id)

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


def _get_xray_cloud_access_token() -> str:
    if not settings.XRAY_CLOUD_CLIENT_ID or not settings.XRAY_CLOUD_CLIENT_SECRET:
        raise HTTPException(
            status_code=501,
            detail="Xray Cloud requires XRAY_CLOUD_CLIENT_ID and XRAY_CLOUD_CLIENT_SECRET to be configured",
        )

    try:
        response = httpx.post(
            "https://xray.cloud.getxray.app/api/v2/authenticate",
            json={
                "client_id": settings.XRAY_CLOUD_CLIENT_ID,
                "client_secret": settings.XRAY_CLOUD_CLIENT_SECRET,
            },
            timeout=httpx.Timeout(30.0, connect=10.0),
            trust_env=False,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to authenticate to Xray Cloud: {str(exc)}")

    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to authenticate to Xray Cloud")

    token = response.text.strip().strip('"')
    if not token:
        raise HTTPException(status_code=400, detail="Xray Cloud authentication returned an empty token")
    return token


def _publish_xray_cloud_test_suite(
    req: XrayTestSuitePublishRequest,
    current_user: User,
    db: Session,
    request: Request,
) -> XrayTestSuitePublishResponse:
    return XrayCloudPublisher(db, current_user, request).publish(req.jira_connection_id, req)


def _publish_xray_server_test_suite(
    conn_id: int,
    req: XrayTestSuitePublishRequest,
    current_user: User,
    db: Session,
    request: Request,
) -> XrayTestSuitePublishResponse:
    return XrayServerPublisher(db, current_user, request).publish(conn_id, req)

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

    try:
        if conn_id != req.jira_connection_id:
            raise HTTPException(status_code=400, detail="Connection mismatch for Xray publish request")
        if not req.test_cases:
            raise HTTPException(status_code=400, detail="No test cases were provided for Xray publishing")

        conn = get_owned_connection(db, current_user.id, conn_id)

        if conn.auth_type == JiraAuthType.CLOUD:
            return _publish_xray_cloud_test_suite(req, current_user, db, request)

        return _publish_xray_server_test_suite(conn_id, req, current_user, db, request)
    except Exception:
        idempotency_store.clear_reservation(
            "jira.xray_publish",
            str(current_user.id),
            idem_key,
            req.model_dump(),
        )
        raise

@router.post("/connections/{conn_id}/xray/test-connection")
def test_xray_cloud_connection(
    conn_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = get_owned_connection(db, current_user.id, conn_id)

    from app.services.jira.xray_cloud import XrayCloudClient
    client = XrayCloudClient(conn)
    
    try:
        client.test_connection()
        return {"status": "success", "message": "Successfully authenticated to Xray Cloud"}
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ═══════════════════════════════════════════════════════════════════════════
# Phase 2: Duplicate Detection
# ═══════════════════════════════════════════════════════════════════════════

from app.services.jira.duplicate_detector import (
    DuplicateCandidate,
    find_duplicates,
)


@router.post("/duplicates/check", response_model=DuplicateCheckResponse)
def check_duplicates(
    req: DuplicateCheckRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Check if a bug candidate has potential duplicates in Jira."""
    rate_limiter.check("jira.duplicates", str(current_user.id), limit=15, window_seconds=60)

    conn = get_owned_connection(db, current_user.id, req.jira_connection_id)
    adapter = get_adapter(conn)
    instance_url = req.instance_url or normalize_instance_url(conn.host_url)

    candidate = DuplicateCandidate(
        summary=req.candidate_summary,
        description=req.candidate_description,
        error_message=req.error_message,
        component=req.component,
        labels=req.labels,
        screen_or_page=req.screen_or_page,
        api_endpoint=req.api_endpoint,
    )

    matches, check_failed, failure_reason = find_duplicates(
        adapter=adapter,
        project_key=req.project_key,
        candidate=candidate,
        instance_url=instance_url,
        story_key=req.story_key,
    )

    log_audit(
        "jira.duplicates.check",
        current_user.id,
        db=db,
        jira_connection_id=req.jira_connection_id,
        project_key=req.project_key,
        matches_found=len(matches),
        check_failed=check_failed,
    )

    return DuplicateCheckResponse(
        matches=[
            DuplicateMatchResponse(**m.model_dump())
            for m in matches
        ],
        check_failed=check_failed,
        failure_reason=failure_reason,
    )


@router.post("/duplicates/link", response_model=DuplicateLinkResponse)
def link_to_existing(
    req: DuplicateLinkRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Link the current story to an existing bug instead of creating a duplicate."""
    rate_limiter.check("jira.duplicates.link", str(current_user.id), limit=10, window_seconds=60)

    conn = get_owned_connection(db, current_user.id, req.jira_connection_id)
    adapter = get_adapter(conn)

    # Resolve link type
    link_type = req.link_type
    if not link_type:
        try:
            available_types = adapter.get_issue_link_types()
            candidates = service_resolve_link_type_candidates("Relates", available_types)
            link_type = candidates[0] if candidates else "Relates"
        except Exception:
            link_type = "Relates"

    try:
        adapter.link_issues(req.story_key, link_type, req.existing_issue_key)
        log_audit(
            "jira.duplicates.link",
            current_user.id,
            db=db,
            jira_connection_id=req.jira_connection_id,
            story_key=req.story_key,
            linked_issue_key=req.existing_issue_key,
            link_type=link_type,
        )
        return DuplicateLinkResponse(linked=True, link_type_used=link_type)
    except HTTPException as exc:
        return DuplicateLinkResponse(
            linked=False,
            link_type_used=link_type,
            error=str(exc.detail),
        )
