import httpx
import base64
import re
import logging
import html
from typing import Dict, Any, List, Optional, Sequence, Tuple
from fastapi import HTTPException
from app.services.jira.adapters.base import JiraAdapter

logger = logging.getLogger(__name__)

class JiraCloudAdapter(JiraAdapter):
    def __init__(self, host_url: str, username: str, token: str, verify_ssl: bool = True):
        super().__init__(host_url, username, token, verify_ssl)
        auth_string = f"{self.username}:{self.token}"
        encoded_auth = base64.b64encode(auth_string.encode()).decode()
        self.headers = {
            "Authorization": f"Basic {encoded_auth}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
        self.client = httpx.Client(
            base_url=self.host_url,
            headers=self.headers,
            timeout=httpx.Timeout(60.0, connect=10.0),
            trust_env=False,
            verify=self.verify_ssl,
        )

    def _fallback_candidate(self, v3_path: str) -> Optional[str]:
        if "/rest/api/3/" not in v3_path:
            return None
        return v3_path.replace("/rest/api/3/", "/rest/api/2/", 1)

    def _request_candidates(
        self,
        method: str,
        paths: Sequence[str],
        fallback_statuses: Tuple[int, ...] = (404, 405),
    ) -> httpx.Response:
        last_response: Optional[httpx.Response] = None
        tried: list[str] = []

        for path in paths:
            if not path or path in tried:
                continue
            tried.append(path)
            response = self._request(method, path)
            last_response = response
            if response.status_code in fallback_statuses:
                fallback_path = self._fallback_candidate(path)
                if fallback_path and fallback_path not in tried:
                    tried.append(fallback_path)
                    fallback_response = self._request(method, fallback_path)
                    last_response = fallback_response
                    if fallback_response.status_code not in fallback_statuses:
                        return fallback_response
                continue
            return response

        return last_response if last_response is not None else self._request(method, paths[0])

    def _request(self, method: str, path: str) -> httpx.Response:
        try:
            response = self.client.request(method, path)
            if response.status_code == 401:
                raise HTTPException(
                    status_code=400,
                    detail="Jira Cloud authentication failed. Verify the email and API token."
                )
            if response.status_code == 403:
                raise HTTPException(
                    status_code=400,
                    detail="Jira Cloud access denied. Verify the account permissions."
                )
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                detail = "Jira Cloud rate limit exceeded."
                if retry_after:
                    detail = f"{detail} Retry after {retry_after} seconds."
                raise HTTPException(status_code=429, detail=detail)
            return response
        except httpx.TimeoutException:
            logger.error("jira_cloud_request_timeout", extra={"path": path})
            raise HTTPException(status_code=504, detail="Connection to Jira Cloud timed out. Please try again.")
        except httpx.HTTPError as exc:
            logger.error("jira_cloud_request_error", extra={"error": str(exc), "path": path})
            raise HTTPException(status_code=502, detail=f"Failed to reach Jira Cloud: {str(exc)}")

    def _extract_error_message(self, response: httpx.Response, fallback: str) -> str:
        try:
            data = response.json()
        except ValueError:
            return fallback
        messages = []
        error_messages = data.get("errorMessages")
        if isinstance(error_messages, list):
            messages.extend(str(item) for item in error_messages if item)
        errors = data.get("errors")
        if isinstance(errors, dict):
            messages.extend(f"{key}: {value}" for key, value in errors.items() if value)
        return "; ".join(messages) if messages else fallback

    def _normalize_fields_payload(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        fields_raw = data.get("fields")

        if isinstance(fields_raw, dict):
            return [{"fieldId": key, **value} for key, value in fields_raw.items()]

        if isinstance(fields_raw, list):
            return [field if "fieldId" in field else {"fieldId": field.get("key"), **field} for field in fields_raw]

        projects = data.get("projects")
        if isinstance(projects, list) and projects:
            issuetypes = projects[0].get("issuetypes", [])
            if isinstance(issuetypes, list) and issuetypes:
                nested_fields = issuetypes[0].get("fields", {})
                if isinstance(nested_fields, dict):
                    return [{"fieldId": key, **value} for key, value in nested_fields.items()]
                if isinstance(nested_fields, list):
                    return [field if "fieldId" in field else {"fieldId": field.get("key"), **field} for field in nested_fields]

        return []

    def _make_text_node(self, text: str, bold: bool = False) -> Dict[str, Any]:
        node: Dict[str, Any] = {"type": "text", "text": text}
        if bold:
            node["marks"] = [{"type": "strong"}]
        return node

    def _make_paragraph(self, text: str, bold: bool = False) -> Dict[str, Any]:
        stripped = text.strip()
        return {
            "type": "paragraph",
            "content": [self._make_text_node(stripped, bold=bold)] if stripped else []
        }

    def _make_ordered_list(self, items: List[str]) -> Dict[str, Any]:
        return {
            "type": "orderedList",
            "attrs": {"order": 1},
            "content": [
                {
                    "type": "listItem",
                    "content": [self._make_paragraph(item)]
                }
                for item in items if item.strip()
            ]
        }

    def _extract_sections(self, text: str) -> Dict[str, Any]:
        normalized = text.replace("\r\n", "\n").strip()
        heading_pattern = re.compile(r"^\*(.+?)\*:?$", re.MULTILINE)
        matches = list(heading_pattern.finditer(normalized))

        if not matches:
            return {"summary": normalized, "sections": {}}

        summary = normalized[:matches[0].start()].strip()
        sections: Dict[str, str] = {}
        for idx, match in enumerate(matches):
            heading = match.group(1).strip().lower()
            body_start = match.end()
            body_end = matches[idx + 1].start() if idx + 1 < len(matches) else len(normalized)
            sections[heading] = normalized[body_start:body_end].strip()

        return {"summary": summary, "sections": sections}

    def _parse_step_lines(self, value: str) -> List[str]:
        steps: List[str] = []
        for raw_line in value.split("\n"):
            line = raw_line.strip()
            if not line:
                continue
            cleaned = re.sub(r"^(?:#|\d+\.)\s*", "", line).strip()
            if cleaned:
                steps.append(cleaned)
        return steps

    def _to_adf(self, text: str) -> Dict[str, Any]:
        """
        Converts structured description text to Atlassian Document Format (ADF)
        for Jira Cloud v3, preserving section titles and ordered steps.
        """
        if not isinstance(text, str) or not text:
            return text

        parsed = self._extract_sections(text)
        content: List[Dict[str, Any]] = []

        summary = parsed["summary"]
        sections = parsed["sections"]

        if summary:
            content.append(self._make_paragraph("Summary", bold=True))
            content.append(self._make_paragraph(summary))
            content.append(self._make_paragraph(""))

        heading_order = [
            ("steps to reproduce", "Steps to Reproduce:", True),
            ("expected result", "Expected Result:", False),
            ("actual result", "Actual Result:", False),
        ]

        for key, title, is_list in heading_order:
            value = sections.get(key, "").strip()
            if not value:
                continue

            content.append(self._make_paragraph(title, bold=True))
            if is_list:
                steps = self._parse_step_lines(value)
                if steps:
                    content.append(self._make_ordered_list(steps))
            else:
                content.append(self._make_paragraph(value))
            content.append(self._make_paragraph(""))

        if not content:
            lines = text.split('\n')
            content = [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": line}] if line.strip() else []
                } for line in lines
            ]

        if content and content[-1].get("type") == "paragraph" and not content[-1].get("content"):
            content.pop()

        return {
            "version": 1,
            "type": "doc",
            "content": content
        }

    def get_projects(self) -> List[Dict[str, Any]]:
        response = self._request_candidates("GET", ["/rest/api/3/project"])
        if response.status_code != 200:
            logger.warning("jira_cloud_get_projects_failed", extra={"host": self.host_url, "status_code": response.status_code})
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira projects"))
        return response.json()

    def _resolve_project_ref(self, project_ref: str) -> Optional[str]:
        normalized_ref = str(project_ref).strip()
        if not normalized_ref:
            return None

        try:
            projects = self.get_projects()
        except HTTPException:
            return None

        normalized_lower = normalized_ref.lower()
        for project in projects:
            candidate_id = str(project.get("id", "")).strip()
            candidate_key = str(project.get("key", "")).strip()
            if normalized_ref == candidate_id or normalized_lower == candidate_key.lower():
                return candidate_id or candidate_key or None
        return None

    def get_issue_types(self, project_id: str) -> Dict[str, Any]:
        response = self._request_candidates("GET", [f"/rest/api/3/project/{project_id}"])
        if response.status_code == 404:
            resolved_project_ref = self._resolve_project_ref(project_id)
            if resolved_project_ref and str(resolved_project_ref) != str(project_id):
                response = self._request_candidates("GET", [f"/rest/api/3/project/{resolved_project_ref}"])

        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira issue types"))
        
        data = response.json()
        issue_types = data.get("issueTypes", [])
        
        return {
            "project_id": str(data.get("id")),
            "project_key": str(data.get("key")),
            "issue_types": [
                {
                    "id": str(t["id"]), 
                    "name": t.get("name"),
                    "icon_url": t.get("iconUrl") or t.get("icon_url"),
                    "subtask": bool(t.get("subtask", False))
                } 
                for t in issue_types
            ]
        }

    def get_issue_context(self, issue_key: str) -> Dict[str, Any]:
        response = self._request_candidates("GET", [f"/rest/api/3/issue/{issue_key}?fields=project,issuetype"])
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira issue context"))

        data = response.json()
        fields = data.get("fields", {}) if isinstance(data, dict) else {}
        project = fields.get("project", {}) if isinstance(fields, dict) else {}
        issue_type = fields.get("issuetype", {}) if isinstance(fields, dict) else {}

        return {
            "issue_key": str(data.get("key") or issue_key),
            "project_id": str(project.get("id") or "").strip() or None,
            "project_key": str(project.get("key") or "").strip() or None,
            "issue_type_id": str(issue_type.get("id") or "").strip() or None,
        }

    def get_fields(self, project_id: str, issue_type_id: str) -> List[Dict[str, Any]]:
        url = "/rest/api/3/issue/createmeta"
        param_sets = []
        project_ref = str(project_id).strip()
        base_params = {
            "issueTypeIds": issue_type_id,
            "expand": "projects.issuetypes.fields"
        }

        if project_ref.isdigit():
            param_sets.append({**base_params, "projectIds": project_ref})
        else:
            param_sets.append({**base_params, "projectKeys": project_ref})
            resolved_project_ref = self._resolve_project_ref(project_ref)
            if resolved_project_ref and str(resolved_project_ref) != project_ref:
                param_sets.append({**base_params, "projectIds": str(resolved_project_ref)})

        last_error_response: Optional[httpx.Response] = None
        for params in param_sets:
            try:
                response = self.client.get(url, params=params)
            except httpx.TimeoutException:
                logger.error("jira_cloud_get_fields_timeout", extra={"project": project_id})
                raise HTTPException(status_code=504, detail="Jira metadata request timed out. High project complexity detected.")
            except httpx.HTTPError as exc:
                logger.error("jira_cloud_get_fields_network_error", extra={"error": str(exc), "project": project_id})
                raise HTTPException(status_code=502, detail=f"Failed to connect to Jira: {str(exc)}")

            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                detail = "Jira Cloud rate limit exceeded while fetching field metadata."
                if retry_after:
                    detail = f"{detail} Retry after {retry_after} seconds."
                raise HTTPException(status_code=429, detail=detail)

            if response.status_code in (404, 405):
                fallback_url = self._fallback_candidate(url)
                if fallback_url:
                    fallback_response = self.client.get(fallback_url, params=params)
                    response = fallback_response

            if response.status_code == 200:
                data = response.json()
                fields = self._normalize_fields_payload(data)
                if fields:
                    return fields

            last_error_response = response
            logger.info(
                "jira_cloud_get_fields_fallback",
                extra={"status": response.status_code, "project": project_id, "params": params},
            )

        logger.error("jira_cloud_get_fields_failed", extra={
            "status": last_error_response.status_code if last_error_response is not None else "unknown",
            "project": project_id,
            "type": issue_type_id,
            "response": last_error_response.text[:200] if last_error_response is not None else "",
        })
        raise HTTPException(
            status_code=400,
            detail=self._extract_error_message(last_error_response, "Failed to fetch Jira field metadata") if last_error_response is not None else "Failed to fetch Jira field metadata",
        )



    def create_issue(self, issue_data: Dict[str, Any]) -> str:
        # Standardize standard text fields to ADF for API v3 compatibility
        fields = issue_data.get("fields", {})
        if "description" in fields and isinstance(fields["description"], str):
            fields["description"] = self._to_adf(fields["description"])
            
        try:
            response = self.client.post("/rest/api/3/issue", json=issue_data)
            if response.status_code in (404, 405):
                response = self.client.post("/rest/api/2/issue", json=issue_data)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"Timed out connecting to Jira at {self.host_url}.")
        except httpx.HTTPError as exc:
            logger.warning("jira_cloud_create_issue_failed", extra={"host": self.host_url, "error": str(exc)})
            raise HTTPException(status_code=502, detail=f"Failed to reach Jira at {self.host_url}: {str(exc)}")
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to create Jira issue"))
        return response.json().get("key")

    def link_issues(self, inpatient_key: str, link_type: str, outward_issue_key: str):
        payload = {
            "type": {"name": link_type},
            "inwardIssue": {"key": inpatient_key},
            "outwardIssue": {"key": outward_issue_key}
        }
        try:
            response = self.client.post("/rest/api/3/issueLink", json=payload)
            if response.status_code in (404, 405):
                response = self.client.post("/rest/api/2/issueLink", json=payload)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"Timed out connecting to Jira at {self.host_url}.")
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Failed to reach Jira at {self.host_url}: {str(exc)}")
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=400, detail="Failed to link issues")

    def _normalize_user_search_results(self, payload: Any) -> List[Dict[str, Any]]:
        users_raw: Any = payload
        if isinstance(payload, dict):
            users_raw = payload.get("users", payload)
            if isinstance(users_raw, dict):
                users_raw = users_raw.get("users", [])
        if not isinstance(users_raw, list):
            return []

        normalized: List[Dict[str, Any]] = []
        for user in users_raw:
            if not isinstance(user, dict):
                continue

            account_id = (
                user.get("accountId")
                or user.get("id")
                or user.get("key")
                or user.get("name")
            )
            html_display_name = user.get("displayNameHtml") or user.get("html")
            display_name = (
                user.get("displayName")
                or user.get("name")
                or (re.sub(r"<[^>]+>", "", html_display_name) if isinstance(html_display_name, str) else None)
            )
            if isinstance(display_name, str):
                display_name = html.unescape(display_name).strip()
            if not account_id or not display_name:
                continue

            avatar_urls = user.get("avatarUrls")
            avatar = user.get("avatarUrl")
            if not avatar and isinstance(avatar_urls, dict):
                avatar = (
                    avatar_urls.get("16x16")
                    or avatar_urls.get("24x24")
                    or avatar_urls.get("32x32")
                    or avatar_urls.get("48x48")
                )

            normalized.append(
                {
                    "id": account_id,
                    "name": display_name,
                    "email": user.get("emailAddress"),
                    "avatar": avatar,
                }
            )

        return normalized

    def search_users(
        self,
        query: str,
        project_id: Optional[str] = None,
        project_key: Optional[str] = None,
        issue_type_id: Optional[str] = None,
        field_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        base_params: Dict[str, Any] = {"query": query, "maxResults": 20}
        attempts: List[tuple[str, Dict[str, Any]]] = []

        if project_key:
            attempts.append(
                (
                    "/rest/api/3/user/assignable/multiProjectSearch",
                    {**base_params, "projectKeys": project_key},
                )
            )
            attempts.append(
                (
                    "/rest/api/3/user/assignable/search",
                    {**base_params, "project": project_key},
                )
            )
        elif project_id:
            attempts.append(
                (
                    "/rest/api/3/user/assignable/search",
                    {**base_params, "project": project_id},
                )
            )

        picker_params: Dict[str, Any] = {
            **base_params,
            "showAvatar": "true",
        }
        if field_id:
            picker_params["fieldId"] = field_id
        if project_id:
            picker_params["projectId"] = project_id
        if issue_type_id:
            picker_params["issueTypeId"] = issue_type_id
        attempts.append(("/rest/api/3/groupuserpicker", picker_params))

        # Picker endpoints are the best general-purpose typeahead fallback for Cloud.
        attempts.append(("/rest/api/3/user/picker", dict(base_params)))
        attempts.append(("/rest/api/3/user/search", dict(base_params)))
        attempts.append(("/rest/api/2/user/picker", dict(base_params)))
        attempts.append(("/rest/api/2/user/search", dict(base_params)))

        last_status: Optional[int] = None
        for endpoint, params in attempts:
            try:
                response = self.client.get(endpoint, params=params)
            except httpx.HTTPError as exc:
                logger.warning(
                    "jira_cloud_search_users_exception",
                    extra={"error": str(exc), "endpoint": endpoint, "query": query},
                )
                continue

            last_status = response.status_code
            if response.status_code == 401:
                raise HTTPException(
                    status_code=400,
                    detail=self._extract_error_message(response, "Failed to search Jira users"),
                )
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                detail = "Jira Cloud rate limit exceeded while searching users."
                if retry_after:
                    detail = f"{detail} Retry after {retry_after} seconds."
                raise HTTPException(status_code=429, detail=detail)
            if response.status_code != 200:
                logger.info(
                    "jira_cloud_search_users_fallback",
                    extra={"status": response.status_code, "endpoint": endpoint, "query": query},
                )
                continue

            users = self._normalize_user_search_results(response.json())
            if users:
                return users

        if last_status is not None:
            logger.warning(
                "jira_cloud_search_users_failed",
                extra={"status": last_status, "query": query, "project_id": project_id, "project_key": project_key},
            )
        return []



    def get_issue_link_types(self) -> List[str]:
        response = self._request_candidates("GET", ["/rest/api/3/issueLinkType"])
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira issue link types"))

        data = response.json()
        types = data.get("issueLinkTypes", [])
        return [link_type.get("name") for link_type in types if link_type.get("name")]

    def get_sprint_options(self, project_id: str) -> List[Dict[str, Any]]:
        project_ref = str(project_id).strip()
        if not project_ref:
            return []

        try:
            board_response = self.client.get("/rest/agile/1.0/board", params={"projectKeyOrId": project_ref, "maxResults": 50})
        except httpx.HTTPError:
            return []

        if board_response.status_code != 200:
            return []

        boards = board_response.json().get("values", [])
        sprint_options: List[Dict[str, Any]] = []
        seen_ids: set[str] = set()

        for board in boards:
            board_id = board.get("id")
            if not board_id:
                continue

            try:
                sprint_response = self.client.get(
                    f"/rest/agile/1.0/board/{board_id}/sprint",
                    params={"state": "active,future", "maxResults": 100}
                )
            except httpx.HTTPError:
                continue

            if sprint_response.status_code != 200:
                continue

            for sprint in sprint_response.json().get("values", []):
                sprint_id = str(sprint.get("id") or "").strip()
                if not sprint_id or sprint_id in seen_ids:
                    continue
                seen_ids.add(sprint_id)
                state = str(sprint.get("state") or "").strip()
                name = str(sprint.get("name") or sprint_id).strip()
                sprint_options.append({
                    "id": sprint_id,
                    "name": f"{name} ({state.title()})" if state else name,
                    "value": name,
                    "label": state.title() if state else None,
                })

        return sprint_options
