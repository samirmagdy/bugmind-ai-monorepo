import httpx
import base64
from typing import Dict, Any, List
from fastapi import HTTPException
from app.services.jira.adapters.base import JiraAdapter

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
            timeout=httpx.Timeout(20.0, connect=5.0),
            trust_env=False,
            verify=self.verify_ssl,
        )

    def _request(self, method: str, path: str) -> httpx.Response:
        try:
            return self.client.request(method, path)
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail=f"Timed out connecting to Jira at {self.host_url}. Verify the Jira URL, network access, and credentials."
            )
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to reach Jira at {self.host_url}: {str(exc)}"
            )

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

    def _to_adf(self, text: str) -> Dict[str, Any]:
        """
        Converts plain text to Atlassian Document Format (ADF) for Jira Cloud v3.
        """
        if not isinstance(text, str) or not text:
            return text
            
        lines = text.split('\n')
        return {
            "version": 1,
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": line}] if line.strip() else []
                } for line in lines
            ]
        }

    def get_projects(self) -> List[Dict[str, Any]]:
        response = self._request("GET", "/rest/api/3/project")
        if response.status_code != 200:
            print(f"[JiraCloud] Project Fetch Error: {response.text}")
            raise HTTPException(status_code=400, detail=f"Failed to fetch projects: {response.text}")
        return response.json()

    def get_issue_types(self, project_id: str) -> List[Dict[str, Any]]:
        # Use project metadata endpoint instead of deprecated createmeta
        response = self._request("GET", f"/rest/api/3/project/{project_id}")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch project issue types: {response.text}")
        
        data = response.json()
        issue_types = data.get("issueTypes", [])
        
        # Standardize for frontend (ensure id and name are present)
        return [{"id": str(t["id"]), "name": t["name"]} for t in issue_types]

    def get_fields(self, project_id: str, issue_type_id: str) -> List[Dict[str, Any]]:
        # Use the replacement for the deprecated createmeta endpoint
        response = self._request("GET", f"/rest/api/3/issue/createmeta/{project_id}/issuetypes/{issue_type_id}")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch field metadata: {response.text}")

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
            raise HTTPException(status_code=502, detail=f"Failed to reach Jira at {self.host_url}: {str(exc)}")
        if response.status_code not in [200, 201]:
            print(f"[JiraCloud] Issue Creation Error: {response.text}")
            raise HTTPException(status_code=400, detail=f"Failed to create issue: {response.text}")
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

    def search_users(self, query: str) -> List[Dict[str, Any]]:
        response = self._request("GET", f"/rest/api/3/user/search?query={query}")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to search users")
        
        users = response.json()
        return [{"id": u.get("accountId"), "name": u.get("displayName"), "email": u.get("emailAddress")} for u in users]

    def get_issue_link_types(self) -> List[str]:
        response = self._request("GET", "/rest/api/3/issueLinkType")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch issue link types: {response.text}")

        data = response.json()
        types = data.get("issueLinkTypes", [])
        return [link_type.get("name") for link_type in types if link_type.get("name")]
