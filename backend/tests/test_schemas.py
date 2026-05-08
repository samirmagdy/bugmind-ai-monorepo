"""
Tests for Phase 1 schema changes.

Validates backward compatibility and new field defaults
for the updated bug and test case schemas.
"""
from app.schemas.bug import (
    GeneratedFindingResponse,
    BugDraft,
    TestCase,
    TestCaseGenerationRequest,
    QualityCheckRequest,
    StoryAnalysisRequest,
    TEST_CATEGORIES,
    DEFAULT_TEST_CATEGORIES,
)


class TestGeneratedFindingResponse:
    def test_new_fields_default(self):
        bug = GeneratedFindingResponse(
            summary="Test",
            description="Test desc",
            steps_to_reproduce="step 1",
            expected_result="expected",
            actual_result="actual",
            fields={"summary": "Test"},
        )
        assert bug.priority is None
        assert bug.environment is None
        assert bug.root_cause is None
        assert bug.suggested_evidence == []
        assert bug.labels == []
        assert bug.review_required is False

    def test_new_fields_populated(self):
        bug = GeneratedFindingResponse(
            summary="Test",
            description="Test desc",
            steps_to_reproduce="step 1",
            expected_result="expected",
            actual_result="actual",
            priority="High",
            environment="Chrome / macOS",
            root_cause="Missing validation",
            suggested_evidence=["Screenshot", "Console log"],
            labels=["regression", "checkout"],
            review_required=True,
            fields={"summary": "Test"},
        )
        assert bug.priority == "High"
        assert bug.environment == "Chrome / macOS"
        assert bug.root_cause == "Missing validation"
        assert len(bug.suggested_evidence) == 2
        assert len(bug.labels) == 2
        assert bug.review_required is True

    def test_backward_compatible(self):
        """Existing fields still work without new ones."""
        bug = GeneratedFindingResponse(
            summary="Test",
            description="Desc",
            steps_to_reproduce="Steps",
            expected_result="Expected",
            actual_result="Actual",
            severity="High",
            confidence=80,
            category="Functional Gap",
            acceptance_criteria_refs=["AC1"],
            evidence=["Signal"],
            fields={"summary": "Test"},
        )
        assert bug.severity == "High"
        assert bug.confidence == 80


class TestBugDraft:
    def test_new_fields_default(self):
        draft = BugDraft(
            summary="Test",
            description="Desc",
            steps_to_reproduce="Steps",
            expected_result="Expected",
            actual_result="Actual",
        )
        assert draft.priority is None
        assert draft.environment is None
        assert draft.root_cause is None
        assert draft.suggested_evidence == []
        assert draft.labels == []
        assert draft.review_required is False


class TestTestCase:
    def test_new_fields_default(self):
        tc = TestCase(
            title="Test title",
            steps=["Step 1"],
            expected_result="Expected",
            priority="Medium",
        )
        assert tc.objective is None
        assert tc.test_data is None
        assert tc.review_notes is None

    def test_new_fields_populated(self):
        tc = TestCase(
            title="Verify login",
            objective="Validate successful authentication",
            steps=["Go to login", "Enter credentials"],
            expected_result="User is logged in",
            priority="High",
            test_data="email: test@example.com, password: valid123",
            review_notes="Assumes 2FA is disabled for test account",
        )
        assert tc.objective == "Validate successful authentication"
        assert tc.test_data == "email: test@example.com, password: valid123"
        assert tc.review_notes is not None


class TestTestCaseGenerationRequest:
    def test_categories_field_optional(self):
        req = TestCaseGenerationRequest(
            jira_connection_id=1,
            project_key="PROJ",
            issue_type_id="10001",
        )
        assert req.test_categories is None

    def test_categories_field_populated(self):
        req = TestCaseGenerationRequest(
            jira_connection_id=1,
            project_key="PROJ",
            issue_type_id="10001",
            test_categories=["Positive", "API", "Performance"],
        )
        assert req.test_categories == ["Positive", "API", "Performance"]


class TestConstants:
    def test_all_categories_present(self):
        assert len(TEST_CATEGORIES) == 11
        assert "Positive" in TEST_CATEGORIES
        assert "Negative" in TEST_CATEGORIES
        assert "Boundary" in TEST_CATEGORIES
        assert "Performance" in TEST_CATEGORIES
        assert "Mobile" in TEST_CATEGORIES
        assert "Accessibility" in TEST_CATEGORIES

    def test_default_categories(self):
        assert len(DEFAULT_TEST_CATEGORIES) == 4
        for cat in DEFAULT_TEST_CATEGORIES:
            assert cat in TEST_CATEGORIES


class TestQualityCheckRequest:
    def test_all_fields_optional_with_defaults(self):
        req = QualityCheckRequest()
        assert req.description == ""
        assert req.user_description == ""


class TestStoryAnalysisRequest:
    def test_all_fields_optional_with_defaults(self):
        req = StoryAnalysisRequest()
        assert req.summary == ""
        assert req.include_description is True
        assert req.test_categories is None
