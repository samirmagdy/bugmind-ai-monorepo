from pydantic import BaseModel
from typing import Dict, Any, List, Optional


class IssueContext(BaseModel):
    issue_key: Optional[str] = None
    summary: str = ""
    description: str = ""
    acceptance_criteria: str = ""

class FindingGenerationRequest(BaseModel):
    selected_text: Optional[str] = None
    issue_context: Optional[IssueContext] = None
    jira_connection_id: int
    instance_url: Optional[str] = None
    project_key: str
    project_id: Optional[str] = None
    issue_type_id: str
    issue_type_name: Optional[str] = None
    model: Optional[str] = None
    user_description: Optional[str] = None
    custom_instructions: Optional[str] = None
    bug_count: Optional[int] = None
    focus_bug_summary: Optional[str] = None
    refinement_prompt: Optional[str] = None
    supporting_context: Optional[str] = None


class TestCaseGenerationRequest(BaseModel):
    selected_text: Optional[str] = None
    issue_context: Optional[IssueContext] = None
    jira_connection_id: int
    instance_url: Optional[str] = None
    project_key: str
    project_id: Optional[str] = None
    issue_type_id: str
    issue_type_name: Optional[str] = None
    model: Optional[str] = None
    custom_instructions: Optional[str] = None
    supporting_context: Optional[str] = None

class StructBugField(BaseModel):
    field_id: str
    value: Any

class GeneratedFindingResponse(BaseModel):
    summary: str
    description: str
    steps_to_reproduce: str
    expected_result: str
    actual_result: str
    severity: Optional[str] = None
    confidence: Optional[int] = None
    category: Optional[str] = None
    acceptance_criteria_refs: List[str] = []
    evidence: List[str] = []
    duplicate_group: Optional[str] = None
    overlap_warning: Optional[str] = None
    fields: Dict[str, Any]


class AnalysisCoverageItem(BaseModel):
    reference: str
    status: str
    rationale: str
    related_bug_indexes: List[int] = []


class RiskSummaryGroup(BaseModel):
    group: str
    title: str
    description: str
    count: int = 0


class GapAnalysisSummary(BaseModel):
    issue_type_mode: Optional[str] = None
    summary_headline: Optional[str] = None
    highest_risk_area: Optional[str] = None
    recommended_next_action: Optional[str] = None
    grouped_risks: List[RiskSummaryGroup] = []
    missing_ac_recommendations: List[str] = []
    ac_coverage_map: List[AnalysisCoverageItem] = []


class FindingGenerationResponse(BaseModel):
    bugs: List[GeneratedFindingResponse]
    warnings: List[str] = []


class ManualBugGenerationResponse(FindingGenerationResponse):
    pass


class GapAnalysisResponse(FindingGenerationResponse):
    ac_coverage: float
    analysis_summary: Optional[GapAnalysisSummary] = None


class BugDraft(BaseModel):
    summary: str
    description: str
    steps_to_reproduce: str
    expected_result: str
    actual_result: str
    severity: Optional[str] = None
    confidence: Optional[int] = None
    category: Optional[str] = None
    acceptance_criteria_refs: List[str] = []
    evidence: List[str] = []
    duplicate_group: Optional[str] = None
    overlap_warning: Optional[str] = None
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
    selected: Optional[bool] = True
    test_type: Optional[str] = "Manual"
    preconditions: Optional[str] = None
    acceptance_criteria_refs: List[str] = []
    labels: List[str] = []
    components: List[str] = []

class TestSuiteResponse(BaseModel):
    test_cases: List[TestCase]
    coverage_score: float


class BulkStoryInput(BaseModel):
    key: str
    summary: str = ""
    description: Any = None
    acceptanceCriteria: Optional[str] = None
    acceptance_criteria: Optional[str] = None


class BulkFindingBaseRequest(BaseModel):
    jira_connection_id: int
    instance_url: Optional[str] = None
    project_key: str
    project_id: Optional[str] = None
    issue_type_id: str
    issue_type_name: Optional[str] = None
    stories: List[BulkStoryInput]
    model: Optional[str] = None
    supporting_context: Optional[str] = None


class BulkTestCaseGenerationRequest(BaseModel):
    jira_connection_id: int
    instance_url: Optional[str] = None
    project_key: str
    project_id: Optional[str] = None
    issue_type_id: str
    issue_type_name: Optional[str] = None
    stories: List[BulkStoryInput]
    model: Optional[str] = None
    supporting_context: Optional[str] = None


class BulkTestGenerationRequest(BulkTestCaseGenerationRequest):
    pass


class BulkTestGenerationItem(BaseModel):
    storyKey: str
    ok: bool
    result: Optional[TestSuiteResponse] = None
    error: Optional[str] = None


class BulkTestGenerationResponse(BaseModel):
    results: List[BulkTestGenerationItem]
    warnings: List[str] = []


class BulkAnalyzeRequest(BulkFindingBaseRequest):
    pass


class BulkBrdCompareRequest(BulkFindingBaseRequest):
    brd_text: str


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
    warnings: List[str] = []
    linked_story_issue_key: Optional[str] = None
    link_type_used: Optional[str] = None
    linked_issue_keys: List[str] = []
    unlinked_issue_keys: List[str] = []


class XrayTestSuitePublishResponse(BaseModel):
    created_tests: List[XrayPublishedTest]
    folder_path: str
    repository_path_field_id: Optional[str] = None
    link_type_used: Optional[str] = None
    warnings: List[str] = []


# Backward-compatible aliases while the rest of the codebase migrates.
AIWorkItemGenerationRequest = FindingGenerationRequest
BugGenerationRequest = FindingGenerationRequest
TestGenerationRequest = TestCaseGenerationRequest
GeneratedBugResponse = GeneratedFindingResponse
BugGenerationResponse = GapAnalysisResponse
