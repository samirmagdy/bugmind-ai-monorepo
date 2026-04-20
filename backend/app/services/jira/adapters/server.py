import httpx
import base64
from typing import Dict, Any, List
from fastapi import HTTPException
from app.services.jira.adapters.base import JiraAdapter

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
                print(f"[JiraServer] Authentication failed (401) for {self.host_url}. Check credentials.")
                raise HTTPException(
                    status_code=400,
                    detail=f"Jira Server Authentication Failed: Verify your username and token/password at {self.host_url}."
                )
            if response.status_code == 403:
                print(f"[JiraServer] Permission denied (403) for {self.host_url}. Check permissions or CAPTCHA.")
                raise HTTPException(
                    status_code=400,
                    detail=f"Jira Server Access Denied: Your account might be locked or requires CAPTCHA. Try logging in via your browser first."
                )
            return response
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
        fields_raw = data.get("fields") or data.get("values")
        
        if not fields_raw:
            print(f"[JiraServer] No fields or values found in payload keys: {list(data.keys())}")
            # check for nested projects structure as fallback
            projects = data.get("projects")
            if isinstance(projects, list) and projects:
                issuetypes = projects[0].get("issuetypes", [])
                if issuetypes:
                    fields_raw = issuetypes[0].get("fields")
                    print(f"[JiraServer] Found fields in nested projects structure")

        if isinstance(fields_raw, dict):
            print(f"[JiraServer] Found {len(fields_raw)} fields in dict structure")
            return [{"fieldId": key, **value} for key, value in fields_raw.items()]

        if isinstance(fields_raw, list):
            print(f"[JiraServer] Found {len(fields_raw)} fields in list structure")
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
                    print(f"[JiraServer] Found {len(nested_fields)} fields in nested projects[].issuetypes[].fields")
                    return [{"fieldId": key, **value} for key, value in nested_fields.items()]
                if isinstance(nested_fields, list):
                    print(f"[JiraServer] Found {len(nested_fields)} fields in nested field list")
                    return [field if "fieldId" in field else {"fieldId": field.get("key"), **field} for field in nested_fields]

        print("[JiraServer] No fields found in response payload")
        return []

    def get_projects(self) -> List[Dict[str, Any]]:
        response = self._request("GET", "/rest/api/2/project")
        if response.status_code != 200:
            print(f"[JiraServer] Project Fetch Error: {response.text}")
            raise HTTPException(status_code=400, detail=f"Failed to fetch projects: {response.text}")
        return response.json()

    def get_issue_types(self, project_id: str) -> List[Dict[str, Any]]:
        # Jira Server v2 metadata (Compatible with Jira 9.0+ and older)
        response = self._request("GET", f"/rest/api/2/project/{project_id}")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch issue types: {response.text}")
        
        data = response.json()
        return data.get("issueTypes", [])

    def get_fields(self, project_id: str, issue_type_id: str) -> List[Dict[str, Any]]:
        # Try Jira Server 9.0+ specific endpoint first
        print(f"[JiraServer] Fetching fields for Project: {project_id}, IssueType: {issue_type_id}")
        response = self._request("GET", f"/rest/api/2/issue/createmeta/{project_id}/issuetypes/{issue_type_id}?expand=allowedValues")
        
        if response.status_code == 400 and "Issue Does Not Exist" in response.text:
            print(f"[JiraServer] Modern endpoint returned 400: {response.text}")
            
        if response.status_code == 404 or (response.status_code == 400 and "Issue Does Not Exist" in response.text):
            # Fallback to pre-9.0 createmeta endpoint
            print(f"[JiraServer] Modern createmeta not found, falling back to legacy endpoint...")
            
            # Detect if project_id is a numeric ID or a string Key
            is_numeric_id = str(project_id).isdigit()
            proj_param = f"projectIds={project_id}" if is_numeric_id else f"projectKeys={project_id}"
            
            url = f"/rest/api/2/issue/createmeta?{proj_param}&issuetypeIds={issue_type_id}&expand=projects.issuetypes.fields"
            print(f"[JiraServer] Legacy URL: {url}")
            response = self._request("GET", url)
            
            if response.status_code != 200:
                print(f"[JiraServer] Legacy fetch failed: {response.status_code} - {response.text}")
                raise HTTPException(status_code=400, detail=f"Failed to fetch fields: {response.text}")
            
            data = response.json()
            # Detailed Debug
            print(f"[JiraServer] RAW LEGACY RESPONSE KEYS: {list(data.keys())}")
            
            return self._normalize_fields_payload(data)

        if response.status_code != 200:
            print(f"[JiraServer] Modern fetch failed: {response.status_code} - {response.text}")
            raise HTTPException(status_code=400, detail=f"Failed to fetch fields: {response.text}")

        data = response.json()
        print(f"[JiraServer] RAW MODERN RESPONSE KEYS: {list(data.keys())}")
        return self._normalize_fields_payload(data)

    def create_issue(self, issue_data: Dict[str, Any]) -> str:
        try:
            response = self.client.post("/rest/api/2/issue", json=issue_data)
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail=f"Timed out connecting to Jira at {self.host_url}.")
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Failed to reach Jira at {self.host_url}: {str(exc)}")
        if response.status_code not in [200, 201]:
            print(f"[JiraServer] Issue Creation Error: {response.text}")
            raise HTTPException(status_code=400, detail=f"Failed to create issue: {response.text}")
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

    def search_users(self, query: str) -> List[Dict[str, Any]]:
        response = self._request("GET", f"/rest/api/2/user/search?username={query}")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to search users")
        
        users = response.json()
        return [{"id": u.get("name"), "name": u.get("displayName"), "email": u.get("emailAddress")} for u in users]

    def get_issue_link_types(self) -> List[str]:
        response = self._request("GET", "/rest/api/2/issueLinkType")
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch issue link types: {response.text}")

        data = response.json()
        types = data.get("issueLinkTypes", [])
        return [link_type.get("name") for link_type in types if link_type.get("name")]
