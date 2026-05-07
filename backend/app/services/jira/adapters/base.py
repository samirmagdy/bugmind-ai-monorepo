from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Tuple

class JiraAdapter(ABC):
    def __init__(self, host_url: str, username: str, token: str, verify_ssl: bool = True):
        self.host_url = host_url.rstrip("/")
        self.username = username
        self.token = token
        self.verify_ssl = verify_ssl
        
    @abstractmethod
    def get_current_user(self) -> Dict[str, Any]:
        """Returns the authenticated Jira user's identity."""
        pass

    @abstractmethod
    def fetch_issue(self, issue_key: str) -> Dict[str, Any]:
        """Returns full Jira issue details for a given issue key."""
        pass

    @abstractmethod
    def search_issues(
        self,
        jql: str,
        fields: Optional[List[str]] = None,
        max_results: int = 100,
    ) -> List[Dict[str, Any]]:
        """Returns Jira issues matching a JQL query."""
        pass

    @abstractmethod
    def fetch_attachment(self, attachment_id: str) -> Tuple[bytes, str, str]:
        """Returns attachment bytes, content type, and filename."""
        pass

    @abstractmethod
    def get_projects(self) -> List[Dict[str, Any]]:
        pass
        
    @abstractmethod
    def get_issue_types(self, project_id: str) -> List[Dict[str, Any]]:
        pass
        
    @abstractmethod
    def get_fields(self, project_id: str, issue_type_id: str) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def get_issue_context(self, issue_key: str) -> Dict[str, Any]:
        """Returns canonical project and issue type context for an issue key."""
        pass
        
    @abstractmethod
    def create_issue(self, issue_data: Dict[str, Any]) -> str:
        """Returns the created issue key."""
        pass

    @abstractmethod
    def update_issue(self, issue_key: str, issue_data: Dict[str, Any]) -> None:
        """Updates an existing Jira issue."""
        pass

    @abstractmethod
    def delete_issue(self, issue_key: str) -> None:
        """Deletes a previously created issue."""
        pass
        
    @abstractmethod
    def link_issues(self, inpatient_key: str, link_type: str, outward_issue_key: str):
        pass

    @abstractmethod
    def add_comment(self, issue_key: str, body: str) -> None:
        """Adds a comment to a Jira issue."""
        pass

    @abstractmethod
    def transition_issue(self, issue_key: str, transition_name: Optional[str] = None) -> Optional[str]:
        """Transitions a Jira issue and returns the transition name used, when applied."""
        pass

    @abstractmethod
    def search_users(
        self,
        query: str,
        project_id: Optional[str] = None,
        project_key: Optional[str] = None,
        issue_type_id: Optional[str] = None,
        field_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Searches for users based on query string, optionally scoped by project."""
        pass

    @abstractmethod
    def get_issue_link_types(self) -> List[str]:
        """Returns available Jira issue link type names."""
        pass

    @abstractmethod
    def get_sprint_options(self, project_id: str) -> List[Dict[str, Any]]:
        """Returns selectable sprint options for a project."""
        pass

    @abstractmethod
    def add_xray_step(
        self,
        issue_key: str,
        step: str,
        data: Optional[str] = None,
        result: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Adds a manual Xray test step to a Test issue."""
        pass

    @abstractmethod
    def create_xray_folder(self, project_key: str, parent_id: str, name: str) -> Dict[str, Any]:
        """Creates an Xray Test Repository folder."""
        pass

    @abstractmethod
    def add_test_to_folder(self, project_key: str, folder_id: str, issue_key: str) -> None:
        """Adds or moves a Test issue into an Xray Test Repository folder."""
        pass
