from pydantic import BaseModel
from typing import Dict, Any, List, Optional


class IssueContext(BaseModel):
    issue_key: Optional[str] = None
    summary: str = ""
    description: str = ""
    acceptance_criteria: str = ""

class BugGenerationRequest(BaseModel):
    selected_text: Optional[str] = None
    issue_context: Optional[IssueContext] = None
    jira_connection_id: int
    instance_url: Optional[str] = None
    project_key: str
    project_id: Optional[str] = None
    issue_type_id: str
    model: Optional[str] = None
    user_description: Optional[str] = None
    custom_instructions: Optional[str] = None

class StructBugField(BaseModel):
    field_id: str
    value: Any

class GeneratedBugResponse(BaseModel):
    summary: str
    description: str
    steps_to_reproduce: str
    expected_result: str
    actual_result: str
    fields: Dict[str, Any]


class BugGenerationResponse(BaseModel):
    bugs: List[GeneratedBugResponse]
    ac_coverage: float


class BugDraft(BaseModel):
    summary: str
    description: str
    steps_to_reproduce: str
    expected_result: str
    actual_result: str
    severity: Optional[str] = None
    extra_fields: Optional[Dict[str, Any]] = None


class MissingField(BaseModel):
    key: str
    name: str


class PreviewPreparationRequest(BaseModel):
    jira_connection_id: int
    instance_url: Optional[str] = None
    project_key: str
    project_id: Optional[str] = None
    issue_type_id: str
    bug: BugDraft


class PreviewPreparationResponse(BaseModel):
    valid: bool
    missing_fields: List[MissingField]
    resolved_payload: Dict[str, Any]


class SubmitBugsRequest(BaseModel):
    jira_connection_id: int
    instance_url: Optional[str] = None
    story_issue_key: Optional[str] = None
    project_key: str
    project_id: Optional[str] = None
    issue_type_id: str
    bugs: List[BugDraft]

class TestCase(BaseModel):
    title: str
    steps: List[str]
    expected_result: str
    priority: str

class TestSuiteResponse(BaseModel):
    test_cases: List[TestCase]
    coverage_score: float


class XrayTestSuitePublishRequest(BaseModel):
    jira_connection_id: int
    story_issue_key: str
    xray_project_id: str
    xray_project_key: Optional[str] = None
    test_cases: List[TestCase]
    test_issue_type_id: Optional[str] = None
    test_issue_type_name: Optional[str] = "Test"
    repository_path_field_id: Optional[str] = None
    folder_path: Optional[str] = None
    link_type: Optional[str] = "Tests"


class XrayPublishedTest(BaseModel):
    id: str
    key: str
    self: str = ""


class SubmitBugsResponse(BaseModel):
    created_issues: List[XrayPublishedTest]


class XrayTestSuitePublishResponse(BaseModel):
    created_tests: List[XrayPublishedTest]
    folder_path: str
    repository_path_field_id: Optional[str] = None
    link_type_used: Optional[str] = None
    warnings: List[str] = []
