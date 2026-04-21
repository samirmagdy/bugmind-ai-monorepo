import httpx
import base64
import re
import logging
from typing import Dict, Any, List, Optional
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
        response = self._request("GET", "/rest/api/3/project")
        if response.status_code != 200:
            logger.warning("jira_cloud_get_projects_failed", extra={"host": self.host_url, "status_code": response.status_code})
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira projects"))
        return response.json()

    def get_issue_types(self, project_id: str) -> List[Dict[str, Any]]:
        # Use project metadata endpoint instead of deprecated createmeta
        response = self._request("GET", f"/rest/api/3/project/{project_id}")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira issue types"))
        
        data = response.json()
        issue_types = data.get("issueTypes", [])
        
        # Standardize for frontend (ensure id and name are present)
        return [{"id": str(t["id"]), "name": t["name"]} for t in issue_types]

    def get_fields(self, project_id: str, issue_type_id: str) -> List[Dict[str, Any]]:
        # Use the official Jira Cloud v3 createmeta endpoint with query filters
        # Note: The path-based version is for Server/DC only.
        url = "/rest/api/3/issue/createmeta"
        params = {
            "projectIds": project_id,
            "issueTypeIds": issue_type_id,
            "expand": "projects.issuetypes.fields"
        }
        
        try:
            response = self.client.get(url, params=params)
        except httpx.TimeoutException:
            logger.error("jira_cloud_get_fields_timeout", extra={"project": project_id})
            raise HTTPException(status_code=504, detail="Jira metadata request timed out. High project complexity detected.")
        except httpx.HTTPError as exc:
            logger.error("jira_cloud_get_fields_network_error", extra={"error": str(exc), "project": project_id})
            raise HTTPException(status_code=502, detail=f"Failed to connect to Jira: {str(exc)}")

        if response.status_code != 200:
            logger.error("jira_cloud_get_fields_failed", extra={
                "status": response.status_code,
                "project": project_id,
                "type": issue_type_id,
                "response": response.text[:200]
            })
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira field metadata"))

        data = response.json()
        return self._normalize_fields_payload(data)



    def create_issue(self, issue_data: Dict[str, Any]) -> str:
        # Standardize standard text fields to ADF for API v3 compatibility
        fields = issue_data.get("fields", {})
        if "description" in fields and isinstance(fields["description"], str):
            fields["description"] = self._to_adf(fields["description"])
            
        try:
            response = self.client.post("/rest/api/3/issue", json=issue_data)
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
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"Timed out connecting to Jira at {self.host_url}.")
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Failed to reach Jira at {self.host_url}: {str(exc)}")
        if response.status_code not in [200, 201]:
            raise HTTPException(status_code=400, detail="Failed to link issues")

    def search_users(self, query: str, project_id: Optional[str] = None, project_key: Optional[str] = None) -> List[Dict[str, Any]]:
        # Use httpx params to ensure safe URL encoding for spaces/special chars
        params: Dict[str, Any] = {"query": query}
        
        # Determine the best endpoint based on project context
        # Official docs: /user/assignable/search handles project scoping, /user/search is global.
        endpoint = "/rest/api/3/user/search"
        use_fallback = False
        
        if project_id or project_key:
            endpoint = "/rest/api/3/user/assignable/search"
            params["project"] = project_id or project_key
            use_fallback = True

        try:
            response = self.client.get(endpoint, params=params)
            
            # Fallback for 404s (e.g. invalid project context or restricted API)
            if response.status_code == 404 and use_fallback:
                logger.info("jira_cloud_search_users_404_fallback", extra={"project": params.get("project"), "query": query})
                endpoint = "/rest/api/3/user/search"
                params.pop("project", None)
                response = self.client.get(endpoint, params=params)

            if response.status_code != 200:
                logger.warning("jira_cloud_search_users_failed", extra={"status": response.status_code, "endpoint": endpoint, "query": query})
                raise HTTPException(status_code=400, detail="Failed to search users")
            
            users = response.json()
            return [{"id": u.get("accountId"), "name": u.get("displayName"), "email": u.get("emailAddress")} for u in users]
        except httpx.HTTPError as exc:
            logger.error("jira_cloud_search_users_exception", extra={"error": str(exc), "endpoint": endpoint, "query": query})
            raise HTTPException(status_code=502, detail="Failed to reach Jira Cloud for user search")



    def get_issue_link_types(self) -> List[str]:
        response = self._request("GET", "/rest/api/3/issueLinkType")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=self._extract_error_message(response, "Failed to fetch Jira issue link types"))

        data = response.json()
        types = data.get("issueLinkTypes", [])
        return [link_type.get("name") for link_type in types if link_type.get("name")]
