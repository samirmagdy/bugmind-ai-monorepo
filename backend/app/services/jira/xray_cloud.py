from typing import Any, Dict, List, Optional
import httpx
from fastapi import HTTPException
from app.core.config import settings
from app.core import security
from app.models.jira import JiraConnection
import json

class XrayCloudClient:
    def __init__(self, connection: JiraConnection):
        self.connection = connection
        self.base_url = "https://xray.cloud.getxray.app"
        self._token: Optional[str] = None
        
        # Try connection credentials first, fallback to env vars
        self.client_id = connection.xray_cloud_client_id or settings.XRAY_CLOUD_CLIENT_ID
        self.client_secret = None
        
        if connection.encrypted_xray_cloud_client_secret:
            self.client_secret = security.decrypt_credential(connection.encrypted_xray_cloud_client_secret)
        elif settings.XRAY_CLOUD_CLIENT_SECRET:
            self.client_secret = settings.XRAY_CLOUD_CLIENT_SECRET

    def _get_token(self) -> str:
        if self._token:
            return self._token
            
        if not self.client_id or not self.client_secret:
            raise HTTPException(
                status_code=400,
                detail="Xray Cloud credentials not configured. Please run the setup wizard in Settings."
            )

        try:
            response = httpx.post(
                f"{self.base_url}/api/v2/authenticate",
                json={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
                timeout=httpx.Timeout(30.0, connect=10.0),
                trust_env=False,
            )
            response.raise_for_status()
            
            token = response.text.strip().strip('"')
            if not token:
                raise ValueError("Empty token")
            self._token = token
            return token
        except Exception as exc:
            raise HTTPException(
                status_code=401, 
                detail=f"Failed to authenticate to Xray Cloud: Invalid credentials or API error ({str(exc)})"
            )

    def _graphql(self, query: str, variables: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        token = self._get_token()
        try:
            response = httpx.post(
                f"{self.base_url}/api/v2/graphql",
                headers={"Authorization": f"Bearer {token}"},
                json={"query": query, "variables": variables or {}},
                timeout=httpx.Timeout(30.0, connect=10.0),
                trust_env=False,
            )
            response.raise_for_status()
            result = response.json()
            if "errors" in result and result["errors"]:
                msg = result["errors"][0].get("message", "Unknown GraphQL error")
                raise ValueError(msg)
            return result.get("data", {})
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Xray Cloud GraphQL error: {str(exc)}")

    def test_connection(self) -> bool:
        # Simple test to verify auth works
        self._get_token()
        return True

    def add_test_steps(self, issue_id: str, steps: List[Dict[str, str]]) -> None:
        """
        Adds manual steps to an existing Test issue.
        steps should be a list of dicts with keys: action, data, result
        """
        for step in steps:
            query = """
            mutation($issueId: String!, $step: StepInput!) {
                addTestStep(issueId: $issueId, step: $step) {
                    id
                }
            }
            """
            variables = {
                "issueId": issue_id,
                "step": {
                    "action": step.get("action", ""),
                    "data": step.get("data", ""),
                    "result": step.get("result", "")
                }
            }
            self._graphql(query, variables)

    def get_folders(self, project_id: str) -> List[Dict[str, Any]]:
        """
        Returns all folders in a project
        """
        query = """
        query($projectId: String!) {
            getFolders(projectId: $projectId) {
                id
                name
                folders {
                    id
                    name
                    folders {
                        id
                        name
                        folders {
                            id
                            name
                        }
                    }
                }
            }
        }
        """
        data = self._graphql(query, {"projectId": project_id})
        return data.get("getFolders", [])

    def create_folder(self, project_id: str, name: str, parent_id: Optional[str] = None) -> str:
        query = """
        mutation($projectId: String!, $name: String!, $parentId: String) {
            createFolder(projectId: $projectId, name: $name, parentId: $parentId) {
                folder {
                    id
                    name
                }
                warnings
            }
        }
        """
        variables = {
            "projectId": project_id,
            "name": name
        }
        if parent_id and parent_id != "0":
            variables["parentId"] = parent_id
            
        data = self._graphql(query, variables)
        folder = data.get("createFolder", {}).get("folder")
        if not folder:
            raise HTTPException(status_code=500, detail="Failed to create folder in Xray Cloud")
        return folder["id"]

    def add_test_to_folder(self, project_id: str, folder_id: str, issue_id: str) -> None:
        query = """
        mutation($projectId: String!, $folderId: String!, $issueIds: [String]!) {
            addTestsToFolder(projectId: $projectId, folderId: $folderId, issueIds: $issueIds) {
                warning
            }
        }
        """
        self._graphql(query, {
            "projectId": project_id,
            "folderId": folder_id,
            "issueIds": [issue_id]
        })
