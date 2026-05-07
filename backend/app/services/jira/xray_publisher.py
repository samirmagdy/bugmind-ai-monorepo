from typing import Any, Optional

import httpx
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.core.audit import log_audit
from app.core.config import settings
from app.core.idempotency import idempotency_store
from app.models.user import User
from app.schemas.bug import XrayPublishedTest, XrayTestSuitePublishRequest, XrayTestSuitePublishResponse
from app.services.jira.adapters.server import JiraServerAdapter
from app.services.jira.connection_service import get_adapter, get_owned_connection
from app.services.jira.metadata_engine import JiraMetadataEngine


def resolve_link_type_candidates(link_type: Optional[str], available_types: list[str]) -> list[str]:
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


def normalize_folder_path(folder_path: Optional[str], story_issue_key: str) -> str:
    raw_value = (folder_path or story_issue_key or "").strip()
    normalized = raw_value.replace("\\", "/")
    normalized = "/".join(part.strip() for part in normalized.split("/") if part.strip())
    if not normalized:
        raise HTTPException(status_code=400, detail="A valid Xray folder path is required")
    return normalized


def resolve_test_issue_type_id(issue_types: list[dict], test_issue_type_id: Optional[str], test_issue_type_name: Optional[str]) -> str:
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


def detect_repository_path_field_id(fields: list[dict], repository_path_field_id: Optional[str]) -> Optional[str]:
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


def format_test_issue_description(story_issue_key: str, test_case: dict) -> str:
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


def format_story_sync_comment(created_tests: list[XrayPublishedTest], folder_path: str, custom_comment: Optional[str] = None) -> str:
    issue_keys = [test.key for test in created_tests]
    lines = [
        custom_comment.strip() if custom_comment and custom_comment.strip() else "BugMind created Xray Test coverage for this story.",
        "",
        f"Created Tests: {', '.join(issue_keys) if issue_keys else 'None'}",
        f"Xray Folder: {folder_path}",
    ]
    return "\n".join(lines).strip()


def issue_already_linked(adapter, source_issue_key: str, target_issue_key: str) -> bool:
    try:
        issue = adapter.fetch_issue(source_issue_key)
    except HTTPException:
        return False
    fields = issue.get("fields") if isinstance(issue, dict) else {}
    links = fields.get("issuelinks") if isinstance(fields, dict) else []
    if not isinstance(links, list):
        return False
    for link in links:
        if not isinstance(link, dict):
            continue
        inward = link.get("inwardIssue")
        outward = link.get("outwardIssue")
        linked_keys = []
        if isinstance(inward, dict):
            linked_keys.append(str(inward.get("key") or ""))
        if isinstance(outward, dict):
            linked_keys.append(str(outward.get("key") or ""))
        if target_issue_key in linked_keys:
            return True
    return False


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
    normalized_path = normalize_folder_path(path, "") if path else None
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


def ensure_xray_folder(adapter: JiraServerAdapter, project_key: str, folder_path: str) -> str:
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


def add_xray_manual_steps(adapter: JiraServerAdapter, issue_key: str, test_case: dict) -> None:
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


def apply_optional_xray_fields(fields_payload: dict, test_fields: list[dict], test_case: dict) -> None:
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


def _compact_dict(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item not in (None, "")}


def normalize_target_default_value(field: dict, value: Any) -> Any:
    field_type = str(field.get("type") or "").strip().lower()

    if isinstance(value, list):
        return [
            normalize_target_default_value({**field, "type": field_type.replace("multi-", "")}, item)
            for item in value
            if item not in (None, "")
        ]

    if not isinstance(value, dict):
        return value

    field_key = str(field.get("key") or field.get("id") or "").strip()
    raw_id = value.get("id")
    raw_value = value.get("value")
    raw_name = value.get("name") or value.get("label")

    if field_type in {"option", "priority", "sprint", "user", "version"} or field_type.startswith("multi-"):
        if raw_id not in (None, ""):
            return {"id": str(raw_id)}
        if raw_value not in (None, ""):
            return {"value": raw_value}
        if raw_name not in (None, ""):
            return {"name": raw_name}

    if field_type == "array" or field_key in {"components", "fixVersions", "versions"}:
        if raw_id not in (None, ""):
            return {"id": str(raw_id)}
        if raw_name not in (None, ""):
            return {"name": raw_name}
        if raw_value not in (None, ""):
            return {"value": raw_value}

    return _compact_dict(value)


def apply_target_field_defaults(fields_payload: dict, test_fields: list[dict], defaults: dict[str, Any]) -> None:
    if not defaults:
        return

    fields_by_key = {str(field.get("key") or field.get("id")): field for field in test_fields}
    for key, value in defaults.items():
        field_key = str(key).strip()
        field_meta = fields_by_key.get(field_key)
        if not field_key or not field_meta:
            continue
        if value is None or value == "":
            continue
        normalized_value = normalize_target_default_value(field_meta, value)
        if normalized_value in (None, "") or normalized_value == []:
            continue
        fields_payload[field_key] = normalized_value


def get_xray_cloud_access_token() -> str:
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


class XrayServerPublisher:
    def __init__(self, db: Session, current_user: User, request: Request):
        self.db = db
        self.current_user = current_user
        self.request = request

    def publish(self, conn_id: int, req: XrayTestSuitePublishRequest) -> XrayTestSuitePublishResponse:
        conn = get_owned_connection(self.db, self.current_user.id, conn_id)
        adapter = get_adapter(conn)
        engine = JiraMetadataEngine(adapter)

        project_metadata = engine.get_project_metadata(req.xray_project_id)
        test_issue_type_id = resolve_test_issue_type_id(project_metadata, req.test_issue_type_id, req.test_issue_type_name)
        test_fields = engine.get_field_schema(req.xray_project_id, test_issue_type_id)
        repository_path_field_id = detect_repository_path_field_id(test_fields, req.repository_path_field_id)
        folder_path = normalize_folder_path(req.folder_path, req.story_issue_key)
        xray_project_key = req.xray_project_key or str(project_metadata.get("project_key") or "").strip()
        xray_folder_id: Optional[str] = None
        uses_raven_repository = isinstance(adapter, JiraServerAdapter) and bool(xray_project_key)
        if uses_raven_repository:
            xray_folder_id = ensure_xray_folder(adapter, xray_project_key, folder_path)

        available_link_types: list[str] = []
        try:
            available_link_types = adapter.get_issue_link_types()
        except HTTPException:
            available_link_types = []

        link_candidates = resolve_link_type_candidates(req.link_type, available_link_types)
        created_tests: list[XrayPublishedTest] = []
        transitioned_tests: list[str] = []
        warnings: list[str] = []
        link_type_used: Optional[str] = None

        try:
            for test_case in req.test_cases:
                test_case_payload = test_case.model_dump()
                fields = {
                    "project": {"key": req.xray_project_key} if req.xray_project_key else {"id": req.xray_project_id},
                    "summary": test_case.title,
                    "description": format_test_issue_description(req.story_issue_key, test_case_payload),
                    "issuetype": {"id": test_issue_type_id},
                }
                apply_optional_xray_fields(fields, test_fields, test_case_payload)
                apply_target_field_defaults(fields, test_fields, req.target_field_defaults)
                if repository_path_field_id:
                    fields[repository_path_field_id] = folder_path

                existing_issue_key = str(test_case_payload.get("existing_issue_key") or "").strip()
                updated_existing = bool(req.update_existing and existing_issue_key)
                if updated_existing:
                    issue_key = existing_issue_key
                    update_fields = {
                        key: value for key, value in fields.items()
                        if key not in {"project", "issuetype"}
                    }
                    adapter.update_issue(issue_key, {"fields": update_fields})
                else:
                    issue_key = adapter.create_issue({"fields": fields})
                created_tests.append(XrayPublishedTest(id=issue_key, key=issue_key, self="", updated=updated_existing))
                if isinstance(adapter, JiraServerAdapter):
                    add_xray_manual_steps(adapter, issue_key, test_case_payload)
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
                    if issue_already_linked(adapter, req.story_issue_key, issue_key):
                        linked = True
                        warnings.append(f"Skipped duplicate link for {issue_key}; it is already linked to {req.story_issue_key}")
                    else:
                        warnings.append(f"Created {issue_key} but could not link it to {req.story_issue_key}")

                if req.transition_after_create:
                    try:
                        transition_used = adapter.transition_issue(issue_key, req.transition_name)
                        if transition_used:
                            transitioned_tests.append(issue_key)
                        else:
                            warnings.append(f"Created {issue_key} but no Jira transition was available")
                    except HTTPException as exc:
                        warnings.append(f"Created {issue_key} but could not transition it: {exc.detail}")
        except HTTPException as exc:
            rollback_failed_keys: list[str] = []
            for created_test in reversed(created_tests):
                if created_test.updated:
                    continue
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

        commented_story = False
        if req.add_comment_to_story and created_tests:
            try:
                adapter.add_comment(req.story_issue_key, format_story_sync_comment(created_tests, folder_path, req.story_comment))
                commented_story = True
            except HTTPException as exc:
                warnings.append(f"Created tests but could not comment on {req.story_issue_key}: {exc.detail}")

        response = XrayTestSuitePublishResponse(
            created_tests=created_tests,
            folder_path=folder_path,
            repository_path_field_id=repository_path_field_id,
            link_type_used=link_type_used,
            transitioned_tests=transitioned_tests,
            commented_story=commented_story,
            warnings=warnings,
        )
        idempotency_store.store_response(
            "jira.xray_publish",
            str(self.current_user.id),
            self.request.headers.get("Idempotency-Key"),
            req.model_dump(),
            response.model_dump(),
        )
        log_audit(
            "jira.xray_publish",
            self.current_user.id,
            db=self.db,
            jira_connection_id=req.jira_connection_id,
            project_id=req.xray_project_id,
            request_path=str(self.request.url.path),
            created_test_keys=[test.key for test in created_tests],
            transitioned_test_keys=transitioned_tests,
            commented_story=commented_story,
            warnings=warnings,
        )
        return response


class XrayCloudPublisher:
    def __init__(self, db: Session, current_user: User, request: Request):
        self.db = db
        self.current_user = current_user
        self.request = request

    def publish(self, conn_id: int, req: XrayTestSuitePublishRequest) -> XrayTestSuitePublishResponse:
        conn = get_owned_connection(self.db, self.current_user.id, conn_id)
        adapter = get_adapter(conn)
        engine = JiraMetadataEngine(adapter)

        project_metadata = engine.get_project_metadata(req.xray_project_id)
        test_issue_type_id = resolve_test_issue_type_id(project_metadata, req.test_issue_type_id, req.test_issue_type_name)
        test_fields = engine.get_field_schema(req.xray_project_id, test_issue_type_id)
        
        # Xray Cloud doesn't use standard Jira custom fields for repository path, it uses GraphQL folders
        folder_path = normalize_folder_path(req.folder_path, req.story_issue_key)
        
        from app.services.jira.xray_cloud import XrayCloudClient
        xray_client = XrayCloudClient(conn)
        
        # 1. Ensure Folder exists via GraphQL
        folder_id: Optional[str] = None
        if folder_path and req.xray_project_id:
            # Simple folder creation handling
            parent_id = "0" # Or null
            current_path_parts: list[str] = []
            
            folders_response = xray_client.get_folders(req.xray_project_id)
            for part in [segment for segment in folder_path.split("/") if segment.strip()]:
                name = part.strip()
                current_path_parts.append(name)
                
                # A naive folder finding - ideally we search recursively in folders_response
                # Since Xray GraphQL getFolders returns a tree, we need to traverse it.
                def find_folder(nodes: list, target_name: str) -> Optional[dict]:
                    for node in nodes:
                        if node.get("name", "").lower() == target_name.lower():
                            return node
                    return None

                # For simplicity in this iteration, we create if we can't easily find it at the top
                found = find_folder(folders_response, name)
                if found:
                    parent_id = found["id"]
                    folders_response = found.get("folders", [])
                else:
                    parent_id = xray_client.create_folder(req.xray_project_id, name, parent_id)
                    folders_response = [] # New folder has no children

            folder_id = parent_id

        available_link_types: list[str] = []
        try:
            available_link_types = adapter.get_issue_link_types()
        except HTTPException:
            available_link_types = []

        link_candidates = resolve_link_type_candidates(req.link_type, available_link_types)
        created_tests: list[XrayPublishedTest] = []
        transitioned_tests: list[str] = []
        warnings: list[str] = []
        link_type_used: Optional[str] = None

        try:
            for test_case in req.test_cases:
                test_case_payload = test_case.model_dump()
                fields = {
                    "project": {"id": req.xray_project_id},
                    "summary": test_case.title,
                    "description": format_test_issue_description(req.story_issue_key, test_case_payload),
                    "issuetype": {"id": test_issue_type_id},
                }
                apply_optional_xray_fields(fields, test_fields, test_case_payload)
                apply_target_field_defaults(fields, test_fields, req.target_field_defaults)

                # Create the Jira issue
                existing_issue_key = str(test_case_payload.get("existing_issue_key") or "").strip()
                updated_existing = bool(req.update_existing and existing_issue_key)
                if updated_existing:
                    issue_key = existing_issue_key
                    update_fields = {
                        key: value for key, value in fields.items()
                        if key not in {"project", "issuetype"}
                    }
                    adapter.update_issue(issue_key, {"fields": update_fields})
                else:
                    issue_key = adapter.create_issue({"fields": fields})
                
                # Fetch issue ID required by GraphQL
                issue = adapter.get_issue(issue_key)
                issue_id = issue["id"]
                
                created_tests.append(XrayPublishedTest(id=issue_key, key=issue_key, self="", updated=updated_existing))
                
                # Add steps via GraphQL
                steps_data = []
                steps = [str(step).strip() for step in (test_case.get("steps") or []) if str(step).strip()]
                expected_result = str(test_case.get("expected_result") or "").strip()
                preconditions = str(test_case.get("preconditions") or "").strip()
                
                for index, step in enumerate(steps):
                    steps_data.append({
                        "action": step,
                        "data": preconditions if index == 0 and preconditions else "",
                        "result": expected_result if index == len(steps) - 1 else ""
                    })
                
                if steps_data:
                    xray_client.add_test_steps(issue_id, steps_data)
                
                # Add to folder via GraphQL
                if folder_id:
                    xray_client.add_test_to_folder(req.xray_project_id, folder_id, issue_id)

                # Link to Story
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
                    if issue_already_linked(adapter, req.story_issue_key, issue_key):
                        linked = True
                        warnings.append(f"Skipped duplicate link for {issue_key}; it is already linked to {req.story_issue_key}")
                    else:
                        warnings.append(f"Created {issue_key} but could not link it to {req.story_issue_key}")

                if req.transition_after_create:
                    try:
                        transition_used = adapter.transition_issue(issue_key, req.transition_name)
                        if transition_used:
                            transitioned_tests.append(issue_key)
                        else:
                            warnings.append(f"Created {issue_key} but no Jira transition was available")
                    except HTTPException as exc:
                        warnings.append(f"Created {issue_key} but could not transition it: {exc.detail}")
        except HTTPException as exc:
            rollback_failed_keys: list[str] = []
            for created_test in reversed(created_tests):
                if created_test.updated:
                    continue
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

        commented_story = False
        if req.add_comment_to_story and created_tests:
            try:
                adapter.add_comment(req.story_issue_key, format_story_sync_comment(created_tests, folder_path, req.story_comment))
                commented_story = True
            except HTTPException as exc:
                warnings.append(f"Created tests but could not comment on {req.story_issue_key}: {exc.detail}")

        response = XrayTestSuitePublishResponse(
            created_tests=created_tests,
            folder_path=folder_path,
            repository_path_field_id=None,
            link_type_used=link_type_used,
            transitioned_tests=transitioned_tests,
            commented_story=commented_story,
            warnings=warnings,
        )
        
        idempotency_store.store_response(
            "jira.xray_publish",
            str(self.current_user.id),
            self.request.headers.get("Idempotency-Key"),
            req.model_dump(),
            response.model_dump(),
        )
        log_audit(
            "jira.xray_publish",
            self.current_user.id,
            db=self.db,
            jira_connection_id=req.jira_connection_id,
            project_id=req.xray_project_id,
            request_path=str(self.request.url.path),
            created_test_keys=[test.key for test in created_tests],
            transitioned_test_keys=transitioned_tests,
            commented_story=commented_story,
            warnings=warnings,
        )
        return response
