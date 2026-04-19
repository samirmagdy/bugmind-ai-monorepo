from abc import ABC, abstractmethod
from typing import Dict, Any, List

class JiraAdapter(ABC):
    def __init__(self, host_url: str, username: str, token: str, verify_ssl: bool = True):
        self.host_url = host_url.rstrip("/")
        self.username = username
        self.token = token
        self.verify_ssl = verify_ssl
        
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
    def create_issue(self, issue_data: Dict[str, Any]) -> str:
        """Returns the created issue key."""
        pass
        
    @abstractmethod
    def link_issues(self, inpatient_key: str, link_type: str, outward_issue_key: str):
        pass

    @abstractmethod
    def search_users(self, query: str) -> List[Dict[str, Any]]:
        """Searches for users based on query string."""
        pass

    @abstractmethod
    def get_issue_link_types(self) -> List[str]:
        """Returns available Jira issue link type names."""
        pass
