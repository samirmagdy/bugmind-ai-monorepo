import httpx
import base64
import logging
from typing import Dict, Any, List
from fastapi import HTTPException
from app.services.jira.adapters.base import JiraAdapter

logger = logging.getLogger(__name__)

class JiraServerAdapter(JiraAdapter):
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
            timeout=httpx.Timeout(20.0, connect=5.0),
            trust_env=False,
            verify=self.verify_ssl,
        )

    def _send_with_headers(self, method: str, path: str, headers: Dict[str, str]) -> httpx.Response:
        return self.client.request(method, path, headers=headers)

    def _request(self, method: str, path: str) -> httpx.Response:
        try:
            response = self._send_with_headers(method, path, self._bearer_headers)
            if response.status_code == 401:
                response = self._send_with_headers(method, path, self._basic_headers)
            if response.status_code == 401:
                raise HTTPException(
                    status_code=400,
                    detail="Jira Server authentication failed. Verify the username and token/password."
                )
            if response.status_code == 403:
                raise HTTPException(
                    status_code=400,
                    detail="Jira Server access denied. The account may be locked or require CAPTCHA."
                )
            return response
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail=f"Timed out connecting to Jira at {self.host_url}. Verify the Jira URL, network access, and credentials."
            )
        except httpx.HTTPError as exc:
            logger.warning("jira_server_request_failed", extra={"host": self.host_url, "path": path, "method": method, "error": str(exc)})
            raise HTTPException(
                status_code=502,
                detail="Failed to reach Jira Server"
            )

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

    def get_projects(self) -> List[Dict[str, Any]]:
        response = self._request("GET", "/rest/api/2/project")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira projects"))
        return response.json()

    def get_issue_types(self, project_id: str) -> List[Dict[str, Any]]:
        # Jira Server v2 metadata (Compatible with Jira 9.0+ and older)
        response = self._request("GET", f"/rest/api/2/project/{project_id}")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira issue types"))
        
        data = response.json()
        return data.get("issueTypes", [])

    def get_fields(self, project_id: str, issue_type_id: str) -> List[Dict[str, Any]]:
        # Try Jira Server 9.0+ specific endpoint first
        response = self._request("GET", f"/rest/api/2/issue/createmeta/{project_id}/issuetypes/{issue_type_id}?expand=allowedValues")

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
        try:
            response = self.client.post("/rest/api/2/issue", json=issue_data)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"Timed out connecting to Jira at {self.host_url}.")
        except httpx.HTTPError as exc:
            logger.warning("jira_server_create_issue_failed", extra={"host": self.host_url, "error": str(exc)})
            raise HTTPException(status_code=502, detail="Failed to reach Jira Server")
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
            response = self.client.post("/rest/api/2/issueLink", json=payload)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"Timed out connecting to Jira at {self.host_url}.")
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Failed to reach Jira at {self.host_url}: {str(exc)}")
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=400, detail="Failed to link issues")

    def search_users(self, query: str, project_key: Optional[str] = None, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        response = self._request("GET", f"/rest/api/2/user/search?username={query}")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to search users")
        
        users = response.json()
        return [{"id": u.get("name"), "name": u.get("displayName"), "email": u.get("emailAddress")} for u in users]

    def get_issue_link_types(self) -> List[str]:
        response = self._request("GET", "/rest/api/2/issueLinkType")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira issue link types"))

        data = response.json()
        types = data.get("issueLinkTypes", [])
        return [link_type.get("name") for link_type in types if link_type.get("name")]
