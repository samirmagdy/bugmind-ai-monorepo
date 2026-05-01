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
from app.schemas.bug import XrayTestSuitePublishRequest, XrayTestSuitePublishResponse, XrayPublishedTest
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


def _verify_connection_credentials(auth_type: JiraAuthType, host_url: str, username: str, token: str, verify_ssl: bool) -> None:
    adapter = (
        JiraCloudAdapter(host_url, username, token, verify_ssl=verify_ssl)
        if auth_type == JiraAuthType.CLOUD
        else JiraServerAdapter(host_url, username, token, verify_ssl=verify_ssl)
    )
    adapter.get_current_user()


def _normalize_instance_url(url: Optional[str]) -> str:
    trimmed = (url or "").strip().lower().rstrip("/")
    if not trimmed:
        return ""

    if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
        trimmed = f"https://{trimmed}"

    try:
        parsed = urlparse(trimmed)
        scheme = parsed.scheme or "https"
        netloc = parsed.netloc
        
        path = parsed.path.rstrip("/")
        for marker in ("/browse/", "/issues/", "/projects/", "/rest/"):
            if marker in path:
                path = path.split(marker, 1)[0]
                break
        
        normalized = f"{scheme}://{netloc}{path}"
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


def _decode_text_attachment(content: bytes, content_type: str, filename: str) -> str:
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
                return content.decode(encoding).strip()
            except UnicodeDecodeError:
                continue
        return content.decode("utf-8", errors="replace").strip()

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
        return "\n\n".join(paragraphs).strip()

    is_pdf = normalized_type == "application/pdf" or normalized_name.endswith(".pdf")
    if is_pdf:
        try:
            reader = PdfReader(BytesIO(content))
            pages = []
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
        return text

    raise HTTPException(
        status_code=415,
        detail="This attachment type cannot be extracted as BRD text. Use TXT, MD, CSV, JSON, XML, YAML, LOG, DOCX, or text-based PDF.",
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

    canonical_project_id = req.project_id
    canonical_project_key = req.project_key or _project_key_from_issue_key(req.issue_key)
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
    for candidate in [
        canonical_project_id,
        canonical_project_key,
        req.project_id,
        req.project_key,
    ]:
        if candidate and str(candidate) not in project_candidates:
            project_candidates.append(str(candidate))

    # Phase 1: Resolve Project & Issue Types
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

    # Phase 2: Resolve Fields & Metadata
    if issue_types_raw:
        selected_issue_type_raw = _select_issue_type(issue_types_raw, canonical_issue_type_id)
        if not selected_issue_type_raw:
            raise HTTPException(status_code=400, detail="Could not resolve a Jira issue type for the selected project")

        if selected_issue_type_raw:
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

            mapping_query = db.query(JiraFieldMapping).filter(
                JiraFieldMapping.user_id == current_user.id,
                JiraFieldMapping.project_key == canonical_project_key,
                JiraFieldMapping.issue_type_id == selected_issue_type_id
            )
            canonical_mapping_project_id = canonical_project_id if str(canonical_project_id).isdigit() else None
            if canonical_mapping_project_id is None:
                mapping_query = mapping_query.filter(JiraFieldMapping.project_id.is_(None))
            else:
                mapping_query = mapping_query.filter(JiraFieldMapping.project_id == canonical_mapping_project_id)
            mapping = mapping_query.first()
            visible_fields = mapping.visible_fields if mapping else []
            ai_mapping = mapping.field_mappings if mapping else {}
            field_defaults = mapping.field_defaults if mapping else {}

    metadata_response: Optional[JiraMetadataResponse] = None
    if canonical_project_id or canonical_project_key:
        metadata_response = JiraMetadataResponse(
            project_key=canonical_project_key or str(canonical_project_id),
            project_id=canonical_project_id,
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
    _verify_connection_credentials(conn_in.auth_type, safe_host_url, conn_in.username, conn_in.token, conn_in.verify_ssl)

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
    effective_verify_ssl = update_data.get("verify_ssl", conn.verify_ssl)
    effective_host_url = conn.host_url
    effective_username = update_data.get("username", conn.username)
    effective_token = None
    if "verify_ssl" in update_data and update_data["verify_ssl"] is not None:
        enforce_secure_jira_ssl(update_data["verify_ssl"])
    if "host_url" in update_data and update_data["host_url"]:
        update_data["host_url"] = validate_connection_host(update_data["host_url"], effective_auth_type.value)
        effective_host_url = update_data["host_url"]
    if "token" in update_data:
        token_val = update_data.pop("token")
        if token_val and token_val.strip():
            update_data["encrypted_token"] = security.encrypt_credential(token_val)
            effective_token = token_val.strip()

    should_verify = any(key in update_data for key in ("auth_type", "host_url", "username", "verify_ssl", "encrypted_token"))
    if should_verify:
        if effective_token is None:
            effective_token = security.decrypt_credential(conn.encrypted_token)
        _verify_connection_credentials(
            effective_auth_type,
            effective_host_url,
            effective_username,
            effective_token,
            effective_verify_ssl,
        )
    
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

    was_active = bool(conn.is_active)
    db.delete(conn)

    if was_active:
        replacement = db.query(JiraConnection).filter(JiraConnection.user_id == current_user.id).order_by(JiraConnection.id.asc()).first()
        if replacement:
            replacement.is_active = True
            db.add(replacement)

    db.commit()
    log_audit("jira.connection_delete", current_user.id, db=db, connection_id=conn_id)
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


@router.get("/connections/{conn_id}/current-user")
def get_current_jira_user(
    conn_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    return adapter.get_current_user()


@router.get("/connections/{conn_id}/issues/{issue_key}")
def fetch_jira_issue(
    conn_id: int,
    issue_key: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    return adapter.fetch_issue(issue_key)


@router.post("/connections/{conn_id}/bulk/epic", response_model=JiraBulkFetchResponse)
def bulk_fetch_epic_children(
    conn_id: int,
    req: JiraBulkFetchRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    epic_key = req.epic_key.strip().upper()
    if not epic_key or "-" not in epic_key:
        raise HTTPException(status_code=400, detail="A valid Epic issue key is required")

    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    jql = _build_epic_children_jql(epic_key)
    issues = adapter.search_issues(
        jql,
        fields=["summary", "description", "issuetype", "status", "attachment", "parent"],
        max_results=max(1, min(req.max_results, 250)),
    )
    normalized_issues = [_normalize_bulk_issue(issue) for issue in issues]

    epic_attachments: list[JiraAttachmentResponse] = []
    try:
        epic = adapter.fetch_issue(epic_key)
        fields = epic.get("fields", {}) if isinstance(epic, dict) else {}
        raw_attachments = fields.get("attachment") or []
        epic_attachments = [
            _attachment_response(attachment, epic_key)
            for attachment in raw_attachments
            if isinstance(attachment, dict) and attachment.get("id")
        ]
    except HTTPException:
        epic_attachments = []

    log_audit(
        "jira.bulk_fetch_epic",
        current_user.id,
        db=db,
        jira_connection_id=conn.id,
        epic_key=epic_key,
        issue_count=len(normalized_issues),
    )
    return JiraBulkFetchResponse(
        epic_key=epic_key,
        jql=jql,
        issues=normalized_issues,
        epic_attachments=epic_attachments,
    )


@router.get("/connections/{conn_id}/attachments/{attachment_id}")
def fetch_jira_attachment(
    conn_id: int,
    attachment_id: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

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
    conn = db.query(JiraConnection).filter(JiraConnection.id == conn_id, JiraConnection.user_id == current_user.id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    content, content_type, filename = adapter.fetch_attachment(attachment_id)
    text = _decode_text_attachment(content, content_type, filename)
    if not text:
        raise HTTPException(status_code=400, detail="The selected attachment does not contain readable BRD text")

    return JiraAttachmentTextResponse(
        id=attachment_id,
        filename=filename,
        mime_type=content_type,
        content=text,
    )


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
    return _publish_xray_server_test_suite(req.jira_connection_id, req, current_user, db, request)


def _publish_xray_server_test_suite(
    conn_id: int,
    req: XrayTestSuitePublishRequest,
    current_user: User,
    db: Session,
    request: Request,
) -> XrayTestSuitePublishResponse:
    conn = db.query(JiraConnection).filter(
        JiraConnection.id == conn_id,
        JiraConnection.user_id == current_user.id
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    adapter = get_adapter(conn)
    engine = JiraMetadataEngine(adapter)

    project_metadata = engine.get_project_metadata(req.xray_project_id)
    test_issue_type_id = _resolve_test_issue_type_id(project_metadata, req.test_issue_type_id, req.test_issue_type_name)
    test_fields = engine.get_field_schema(req.xray_project_id, test_issue_type_id)
    repository_path_field_id = _detect_repository_path_field_id(test_fields, req.repository_path_field_id)
    folder_path = _normalize_folder_path(req.folder_path, req.story_issue_key)
    xray_project_key = req.xray_project_key or str(project_metadata.get("project_key") or "").strip()
    xray_folder_id: Optional[str] = None
    uses_raven_repository = isinstance(adapter, JiraServerAdapter) and bool(xray_project_key)
    if uses_raven_repository:
        xray_folder_id = _ensure_xray_folder(adapter, xray_project_key, folder_path)

    available_link_types: list[str] = []
    try:
        available_link_types = adapter.get_issue_link_types()
    except HTTPException:
        available_link_types = []

    link_candidates = _resolve_link_type_candidates(req.link_type, available_link_types)
    created_tests: list[XrayPublishedTest] = []
    warnings: list[str] = []
    link_type_used: Optional[str] = None

    try:
        for test_case in req.test_cases:
            test_case_payload = test_case.model_dump()
            fields = {
                "project": {"key": req.xray_project_key} if req.xray_project_key else {"id": req.xray_project_id},
                "summary": test_case.title,
                "description": _format_test_issue_description(req.story_issue_key, test_case_payload),
                "issuetype": {"id": test_issue_type_id},
            }
            _apply_optional_xray_fields(fields, test_fields, test_case_payload)
            if repository_path_field_id:
                fields[repository_path_field_id] = folder_path

            issue_key = adapter.create_issue({"fields": fields})
            created_tests.append(XrayPublishedTest(id=issue_key, key=issue_key, self=""))
            if isinstance(adapter, JiraServerAdapter):
                _add_xray_manual_steps(adapter, issue_key, test_case_payload)
                if xray_project_key and xray_folder_id:
                    adapter.add_test_to_folder(xray_project_key, xray_folder_id, issue_key)

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
    except HTTPException as exc:
        rollback_failed_keys: list[str] = []
        for created_test in reversed(created_tests):
            try:
                adapter.delete_issue(created_test.key)
            except HTTPException:
                rollback_failed_keys.append(created_test.key)
        detail = exc.detail
        if rollback_failed_keys:
            detail = {
                "error": "Xray test publish failed and some created tests could not be rolled back.",
                "jira_error": exc.detail,
                "rollback_failed_issue_keys": rollback_failed_keys,
            }
        raise HTTPException(status_code=exc.status_code, detail=detail) from exc

    if not repository_path_field_id and not uses_raven_repository:
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
        request.headers.get("Idempotency-Key"),
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

        conn = db.query(JiraConnection).filter(
            JiraConnection.id == conn_id,
            JiraConnection.user_id == current_user.id
        ).first()
        if not conn:
            raise HTTPException(status_code=404, detail="Connection not found")

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
