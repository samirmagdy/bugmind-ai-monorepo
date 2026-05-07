import httpx
import base64
import logging
import time
from typing import Dict, Any, List, Optional, Tuple
from fastapi import HTTPException
from app.services.jira.adapters.base import JiraAdapter

logger = logging.getLogger(__name__)

class JiraServerAdapter(JiraAdapter):
    _TRANSIENT_STATUS_CODES = {429, 502, 503, 504}
    _MAX_RETRIES = 2
    _RETRY_BACKOFF_SECONDS = 0.5

    def __init__(self, host_url: str, username: str, token: str, verify_ssl: bool = True):
        super().__init__(host_url, username, token, verify_ssl)
        
        auth_string = f"{self.username}:{self.token}"
        encoded_auth = base64.b64encode(auth_string.encode()).decode()
        self._basic_headers = {
            "Authorization": f"Basic {encoded_auth}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
        self._bearer_headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
        # Prefer Bearer first because PAT-backed Server/DC installs often require it,
        # but transparently retry once with Basic to preserve existing password/basic flows.
        self.headers = self._bearer_headers
        self.client = httpx.Client(
            base_url=self.host_url,
            headers=self.headers,
            timeout=httpx.Timeout(60.0, connect=10.0),
            trust_env=False,
            verify=self.verify_ssl,
        )

    def _send_with_headers(
        self,
        method: str,
        path: str,
        headers: Dict[str, str],
        *,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
    ) -> httpx.Response:
        return self.client.request(method, path, headers=headers, params=params, json=json)

    def _sleep_before_retry(self, attempt: int, retry_after: Optional[str] = None) -> None:
        if retry_after:
            try:
                time.sleep(min(float(retry_after), 5.0))
                return
            except (TypeError, ValueError):
                pass
        time.sleep(self._RETRY_BACKOFF_SECONDS * attempt)

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        preferred_headers: Optional[Dict[str, str]] = None,
        retry_on_transient: Optional[bool] = None,
    ) -> httpx.Response:
        attempts = self._MAX_RETRIES + 1
        should_retry = method.upper() in {"GET", "HEAD"} if retry_on_transient is None else retry_on_transient
        try:
            for attempt in range(1, attempts + 1):
                if preferred_headers is not None:
                    auth_candidates = [preferred_headers]
                else:
                    auth_candidates = [self._bearer_headers, self._basic_headers]

                response: Optional[httpx.Response] = None
                for index, headers in enumerate(auth_candidates):
                    response = self._send_with_headers(
                        method,
                        path,
                        headers,
                        params=params,
                        json=json,
                    )
                    if response.status_code != 401 or index == len(auth_candidates) - 1:
                        break

                if response is None:
                    raise HTTPException(status_code=502, detail="Failed to reach Jira Server.")

                if response.status_code == 401:
                    raise HTTPException(
                        status_code=400,
                        detail="Jira Server authentication failed. Verify the PAT or Basic credentials."
                    )
                if response.status_code == 403:
                    raise HTTPException(
                        status_code=400,
                        detail="Jira Server access denied. Verify the account permissions."
                    )
                if should_retry and response.status_code in self._TRANSIENT_STATUS_CODES and attempt < attempts:
                    logger.warning(
                        "jira_server_request_retry",
                        extra={"path": path, "status": response.status_code, "attempt": attempt},
                    )
                    self._sleep_before_retry(attempt, response.headers.get("Retry-After"))
                    continue
                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    detail = "Jira Server rate limit exceeded."
                    if retry_after:
                        detail = f"{detail} Retry after {retry_after} seconds."
                    raise HTTPException(status_code=429, detail=detail)
                return response
        except httpx.TimeoutException:
            logger.error("jira_server_request_timeout", extra={"path": path})
            raise HTTPException(status_code=504, detail="Connection to Jira Server timed out. Please try again.")
        except httpx.HTTPError as exc:
            logger.error("jira_server_request_error", extra={"error": str(exc), "path": path})
            raise HTTPException(status_code=502, detail=f"Failed to reach Jira Server: {str(exc)}")

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
        fields_raw = data.get("fields") or data.get("values")

        if not fields_raw:
            projects = data.get("projects")
            if isinstance(projects, list) and projects:
                issuetypes = projects[0].get("issuetypes", [])
                if issuetypes:
                    fields_raw = issuetypes[0].get("fields")

        if isinstance(fields_raw, dict):
            return [{"fieldId": key, **value} for key, value in fields_raw.items()]

        if isinstance(fields_raw, list):
            normalized = []
            for field in fields_raw:
                if "fieldId" in field:
                    normalized.append(field)
                elif "id" in field:
                    normalized.append({"fieldId": field["id"], **field})
                elif "key" in field:
                    normalized.append({"fieldId": field["key"], **field})
                else:
                    normalized.append(field)
            return normalized

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

    def get_current_user(self) -> Dict[str, Any]:
        response = self._request("GET", "/rest/api/2/myself")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira user identity"))
        return response.json()

    def fetch_issue(self, issue_key: str) -> Dict[str, Any]:
        response = self._request("GET", f"/rest/api/2/issue/{issue_key}")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira issue"))
        return response.json()

    def search_issues(
        self,
        jql: str,
        fields: Optional[List[str]] = None,
        max_results: int = 100,
    ) -> List[Dict[str, Any]]:
        collected: List[Dict[str, Any]] = []
        start_at = 0
        page_size = min(max_results, 100)
        requested_fields = fields or ["summary", "description", "issuetype", "status", "attachment", "parent"]

        while len(collected) < max_results:
            payload = {
                "jql": jql,
                "fields": requested_fields,
                "startAt": start_at,
                "maxResults": min(page_size, max_results - len(collected)),
            }
            response = self._request("POST", "/rest/api/2/search", json=payload)
            if response.status_code != 200:
                raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to search Jira issues"))

            data = response.json()
            issues = data.get("issues", [])
            if not isinstance(issues, list) or not issues:
                break
            collected.extend(issues)
            start_at += len(issues)
            total = int(data.get("total") or 0)
            if start_at >= total:
                break

        return collected

    def fetch_attachment(self, attachment_id: str) -> Tuple[bytes, str, str]:
        metadata_response = self._request("GET", f"/rest/api/2/attachment/{attachment_id}")
        if metadata_response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(metadata_response, "Failed to fetch Jira attachment metadata"))

        metadata = metadata_response.json()
        filename = str(metadata.get("filename") or f"attachment-{attachment_id}")
        content_type = str(metadata.get("mimeType") or "application/octet-stream")
        content_url = metadata.get("content") or f"/rest/api/2/attachment/content/{attachment_id}"
        content_response = self._request("GET", str(content_url))
        if content_response.status_code in (302, 303) and content_response.headers.get("Location"):
            content_response = self._request("GET", content_response.headers["Location"])
        if content_response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(content_response, "Failed to fetch Jira attachment content"))
        return content_response.content, content_type, filename

    def get_projects(self) -> List[Dict[str, Any]]:
        response = self._request("GET", "/rest/api/2/project")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira projects"))
        return response.json()

    def get_issue_types(self, project_id: str) -> Dict[str, Any]:
        # Jira Server v2 metadata (Compatible with Jira 9.0+ and older)
        response = self._request("GET", f"/rest/api/2/project/{project_id}")
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
        response = self._request("GET", f"/rest/api/2/issue/{issue_key}?fields=project,issuetype")
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
        # Try Jira Server 9.0+ specific endpoint first
        url = f"/rest/api/2/issue/createmeta/{project_id}/issuetypes/{issue_type_id}?expand=allowedValues"
        response = self._request("GET", url)

        if response.status_code == 404 or (response.status_code == 400 and "Issue Does Not Exist" in response.text):
            is_numeric_id = str(project_id).isdigit()
            proj_param = f"projectIds={project_id}" if is_numeric_id else f"projectKeys={project_id}"
            url = f"/rest/api/2/issue/createmeta?{proj_param}&issuetypeIds={issue_type_id}&expand=projects.issuetypes.fields"
            response = self._request("GET", url)
            if response.status_code != 200:
                raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira field metadata"))
            data = response.json()
            return self._normalize_fields_payload(data)

        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira field metadata"))

        data = response.json()
        return self._normalize_fields_payload(data)

    def create_issue(self, issue_data: Dict[str, Any]) -> str:
        response = self._request("POST", "/rest/api/2/issue", json=issue_data, retry_on_transient=False)
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to create Jira issue"))
        return response.json().get("key")

    def update_issue(self, issue_key: str, issue_data: Dict[str, Any]) -> None:
        response = self._request("PUT", f"/rest/api/2/issue/{issue_key}", json=issue_data, retry_on_transient=False)
        if response.status_code not in [200, 201, 204]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to update Jira issue"))

    def delete_issue(self, issue_key: str) -> None:
        response = self._request("DELETE", f"/rest/api/2/issue/{issue_key}", retry_on_transient=False)
        if response.status_code not in [200, 202, 204]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to delete Jira issue"))

    def link_issues(self, inpatient_key: str, link_type: str, outward_issue_key: str):
        payload = {
            "type": {"name": link_type},
            "inwardIssue": {"key": inpatient_key},
            "outwardIssue": {"key": outward_issue_key}
        }
        response = self._request("POST", "/rest/api/2/issueLink", json=payload, retry_on_transient=False)
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to link Jira issues"))

    def add_comment(self, issue_key: str, body: str) -> None:
        response = self._request("POST", f"/rest/api/2/issue/{issue_key}/comment", json={"body": body}, retry_on_transient=False)
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to add Jira comment"))

    def transition_issue(self, issue_key: str, transition_name: Optional[str] = None) -> Optional[str]:
        response = self._request("GET", f"/rest/api/2/issue/{issue_key}/transitions")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira transitions"))

        transitions = response.json().get("transitions", [])
        if not isinstance(transitions, list) or not transitions:
            return None
        desired = (transition_name or "").strip().lower()
        selected = None
        if desired:
            selected = next((item for item in transitions if str(item.get("name", "")).strip().lower() == desired), None)
        if selected is None:
            selected = next((item for item in transitions if str(item.get("name", "")).strip().lower() in {"done", "complete", "completed", "close", "closed", "ready"}), None)
        if selected is None:
            selected = transitions[0]

        transition_id = selected.get("id")
        if not transition_id:
            return None
        post_response = self._request(
            "POST",
            f"/rest/api/2/issue/{issue_key}/transitions",
            json={"transition": {"id": str(transition_id)}},
            retry_on_transient=False,
        )
        if post_response.status_code not in [200, 201, 204]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(post_response, "Failed to transition Jira issue"))
        return str(selected.get("name") or transition_id)

    def add_xray_step(
        self,
        issue_key: str,
        step: str,
        data: Optional[str] = None,
        result: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload = {"step": step}
        if data:
            payload["data"] = data
        if result:
            payload["result"] = result

        response = self._request(
            "PUT",
            f"/rest/raven/1.0/api/test/{issue_key}/step",
            json=payload,
            retry_on_transient=False,
        )
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to add Xray test step"))
        return response.json()

    def create_xray_folder(self, project_key: str, parent_id: str, name: str) -> Dict[str, Any]:
        response = self._request(
            "POST",
            f"/rest/raven/1.0/api/testrepository/{project_key}/folders/{parent_id}",
            json={"name": name},
            retry_on_transient=False,
        )
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to create Xray repository folder"))
        return response.json()

    def get_xray_folders(self, project_key: str) -> List[Dict[str, Any]]:
        response = self._request("GET", f"/rest/raven/1.0/api/testrepository/{project_key}/folders")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Xray repository folders"))
        payload = response.json()
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            folders = payload.get("folders") or payload.get("values") or payload.get("children")
            if isinstance(folders, list):
                return folders
        return []

    def add_test_to_folder(self, project_key: str, folder_id: str, issue_key: str) -> None:
        response = self._request(
            "PUT",
            f"/rest/raven/1.0/api/testrepository/{project_key}/folders/{folder_id}/tests",
            json={"add": [issue_key], "remove": []},
            retry_on_transient=False,
        )
        if response.status_code not in [200, 201, 204]:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to assign Xray test to repository folder"))

    def search_users(
        self,
        query: str,
        project_id: Optional[str] = None,
        project_key: Optional[str] = None,
        issue_type_id: Optional[str] = None,
        field_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        # Use httpx params to ensure safe URL encoding for spaces/special chars
        # For Jira Server/DC, 'username' is the traditional search parameter.
        params: Dict[str, Any] = {"username": query, "maxResults": 20}
        
        # Determine endpoint and parameters based on project context
        endpoint = "/rest/api/2/user/search"
        use_fallback = False

        if project_id or project_key:
            endpoint = "/rest/api/2/user/assignable/search"
            params["project"] = project_id or project_key
            use_fallback = True

        try:
            response = self._request("GET", endpoint, params=params)

            # Fallback for 404s (e.g. invalid project context or restricted API)
            if response.status_code == 404 and use_fallback:
                logger.info("jira_server_search_users_404_fallback", extra={"project": params.get("project"), "query": query})
                endpoint = "/rest/api/2/user/search"
                params.pop("project", None)
                response = self._request("GET", endpoint, params=params)

            # Fallback for newer Server/DC versions that might prefer 'query' parameter
            if response.status_code == 400 and "username" in response.text:
                params["query"] = params.pop("username")
                response = self._request("GET", endpoint, params=params)

            if response.status_code != 200:
                logger.warning("jira_server_search_users_failed", extra={"status": response.status_code, "endpoint": endpoint, "query": query, "msg": response.text[:100]})
                raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to search Jira users"))
            
            users = response.json()
            # Jira Server returns 'name' (username) and 'key', Cloud returns 'accountId'
            return [{"id": u.get("name") or u.get("key"), "name": u.get("displayName"), "email": u.get("emailAddress")} for u in users]
        except httpx.HTTPError as exc:
            logger.error("jira_server_search_users_exception", extra={"error": str(exc), "endpoint": endpoint, "query": query})
            raise HTTPException(status_code=502, detail="Failed to reach Jira Server for user search")

    def get_issue_link_types(self) -> List[str]:
        response = self._request("GET", "/rest/api/2/issueLinkType")
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
            board_response = self._request(
                "GET",
                "/rest/agile/1.0/board",
                params={"projectKeyOrId": project_ref, "maxResults": 50},
            )
        except HTTPException as exc:
            logger.warning("jira_server_sprint_boards_unavailable", extra={"project": project_ref, "detail": exc.detail})
            return []

        if board_response.status_code != 200:
            logger.info("jira_server_sprint_boards_failed", extra={"project": project_ref, "status": board_response.status_code})
            return []

        boards = board_response.json().get("values", [])
        sprint_options: List[Dict[str, Any]] = []
        seen_ids: set[str] = set()

        for board in boards:
            board_id = board.get("id")
            if not board_id:
                continue

            try:
                sprint_response = self._request(
                    "GET",
                    f"/rest/agile/1.0/board/{board_id}/sprint",
                    params={"state": "active,future", "maxResults": 100},
                )
            except HTTPException as exc:
                logger.info(
                    "jira_server_sprint_options_failed",
                    extra={"project": project_ref, "board_id": board_id, "detail": exc.detail},
                )
                continue

            if sprint_response.status_code != 200:
                logger.info(
                    "jira_server_sprint_options_status",
                    extra={"project": project_ref, "board_id": board_id, "status": sprint_response.status_code},
                )
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
