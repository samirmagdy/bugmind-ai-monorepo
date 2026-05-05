"""
Tests for the duplicate detection service.

Covers:
- Text normalization
- Token extraction and stop word removal
- Error signature extraction
- Path/endpoint extraction
- Similarity scoring (Jaccard, overlap)
- Full duplicate scoring with weighted composite
- Confidence threshold classification
- JQL query building
- Edge cases
"""
import pytest
from app.services.jira.duplicate_detector import (
    normalize_text,
    extract_tokens,
    extract_error_signatures,
    extract_paths,
    summary_hash,
    score_duplicate,
    build_search_queries,
    find_duplicates,
    resolve_duplicate_scope_work_items,
    DuplicateCandidate,
    DuplicateMatch,
    CONFIDENCE_HIGH,
    CONFIDENCE_MEDIUM,
    CONFIDENCE_LOW,
    _jaccard,
    _sets_overlap,
)


class TestNormalizeText:
    def test_empty(self):
        assert normalize_text("") == ""
        assert normalize_text("   ") == ""

    def test_lowercase(self):
        assert normalize_text("Hello WORLD") == "hello world"

    def test_strips_punctuation(self):
        result = normalize_text("Error: 'invalid' token!")
        assert ":" not in result
        assert "'" not in result

    def test_preserves_slashes(self):
        result = normalize_text("/api/v1/users")
        assert "/api/v1/users" in result

    def test_preserves_hyphens_underscores(self):
        result = normalize_text("my-component some_value")
        assert "my-component" in result
        assert "some_value" in result

    def test_collapses_whitespace(self):
        result = normalize_text("a    b   c")
        assert result == "a b c"


class TestExtractTokens:
    def test_empty(self):
        assert extract_tokens("") == set()

    def test_removes_stop_words(self):
        tokens = extract_tokens("The user is not able to login")
        assert "the" not in tokens
        assert "is" not in tokens
        assert "not" not in tokens
        assert "to" not in tokens
        assert "login" in tokens
        assert "able" in tokens

    def test_returns_meaningful_tokens(self):
        tokens = extract_tokens("Payment validation fails for expired cards")
        assert "payment" in tokens
        assert "validation" in tokens
        assert "fails" in tokens
        assert "expired" in tokens
        assert "cards" in tokens


class TestExtractErrorSignatures:
    def test_empty(self):
        assert extract_error_signatures("") == set()

    def test_http_status_codes(self):
        sigs = extract_error_signatures("Got a 500 Internal Server Error")
        assert "500" in sigs

    def test_exception_names(self):
        sigs = extract_error_signatures("Uncaught TypeError: Cannot read properties of undefined")
        assert any("typeerror" in s for s in sigs)

    def test_error_codes(self):
        sigs = extract_error_signatures("Received ERR_CONNECTION_REFUSED when calling API")
        assert any("err_connection_refused" in s for s in sigs)

    def test_network_errors(self):
        sigs = extract_error_signatures("ECONNREFUSED on port 8080")
        assert "econnrefused" in sigs

    def test_multiple_signatures(self):
        sigs = extract_error_signatures("Got 404 and TypeError in the same request")
        assert "404" in sigs
        assert any("typeerror" in s for s in sigs)


class TestExtractPaths:
    def test_empty(self):
        assert extract_paths("") == set()

    def test_api_paths(self):
        paths = extract_paths("The endpoint /api/v1/users/create returns 500")
        assert "/api/v1/users/create" in paths

    def test_rest_paths(self):
        paths = extract_paths("POST /rest/auth/login fails")
        assert "/rest/auth/login" in paths

    def test_no_paths(self):
        paths = extract_paths("The login form does not work")
        assert len(paths) == 0


class TestSummaryHash:
    def test_deterministic(self):
        h1 = summary_hash("Test summary text")
        h2 = summary_hash("Test summary text")
        assert h1 == h2
        assert len(h1) == 16

    def test_different_text(self):
        h1 = summary_hash("First summary")
        h2 = summary_hash("Second summary")
        assert h1 != h2


class TestJaccard:
    def test_empty_sets(self):
        assert _jaccard(set(), set()) == 0.0

    def test_identical_sets(self):
        assert _jaccard({"a", "b", "c"}, {"a", "b", "c"}) == 1.0

    def test_partial_overlap(self):
        result = _jaccard({"a", "b", "c"}, {"b", "c", "d"})
        assert 0.45 < result < 0.55  # 2/4 = 0.5

    def test_no_overlap(self):
        assert _jaccard({"a", "b"}, {"c", "d"}) == 0.0


class TestSetsOverlap:
    def test_empty(self):
        assert _sets_overlap(set(), {"a"}) == 0.0

    def test_full_overlap(self):
        assert _sets_overlap({"a"}, {"a", "b"}) == 1.0

    def test_partial_overlap(self):
        result = _sets_overlap({"a", "b"}, {"b", "c"})
        assert result == 0.5


class TestScoreDuplicate:
    def _make_issue(self, summary, description="", status="Open", priority="Medium",
                    labels=None, components=None, created="2026-05-01T00:00:00Z"):
        return {
            "key": "TEST-123",
            "fields": {
                "summary": summary,
                "description": description,
                "status": {"name": status},
                "priority": {"name": priority},
                "labels": labels or [],
                "components": [{"name": c} for c in (components or [])],
                "created": created,
            }
        }

    def test_identical_summary_high_confidence(self):
        candidate = DuplicateCandidate(
            summary="Payment fails with 500 error on checkout page",
        )
        issue = self._make_issue("Payment fails with 500 error on checkout page")
        match = score_duplicate(candidate, issue)
        assert match is not None
        assert match.confidence in ("high", "medium")
        assert match.similarity_score >= CONFIDENCE_MEDIUM

    def test_completely_different_returns_none(self):
        candidate = DuplicateCandidate(
            summary="Login form styling broken",
        )
        issue = self._make_issue("Database migration script timeout")
        match = score_duplicate(candidate, issue)
        assert match is None

    def test_partial_overlap_medium_confidence(self):
        candidate = DuplicateCandidate(
            summary="User registration form returns 422",
            error_message="422 Unprocessable Entity",
        )
        issue = self._make_issue(
            "Registration validation error 422",
            description="The registration form returns 422 when submitting",
        )
        match = score_duplicate(candidate, issue)
        assert match is not None
        assert match.similarity_score >= CONFIDENCE_LOW

    def test_error_signature_boost(self):
        candidate = DuplicateCandidate(
            summary="API endpoint fails",
            error_message="ERR_CONNECTION_REFUSED",
        )
        issue = self._make_issue(
            "API service unreachable",
            description="ERR_CONNECTION_REFUSED when calling backend API",
        )
        match = score_duplicate(candidate, issue)
        assert match is not None
        assert match.similarity_score > 0.0

    def test_label_component_boost(self):
        candidate = DuplicateCandidate(
            summary="Checkout page crashes on payment submit",
            component="Checkout",
            labels=["regression", "payment"],
        )
        issue = self._make_issue(
            "Checkout page crashes during payment",
            components=["Checkout"],
            labels=["regression"],
        )
        match = score_duplicate(candidate, issue)
        assert match is not None

    def test_returns_correct_fields(self):
        candidate = DuplicateCandidate(summary="Test summary match")
        issue = self._make_issue("Test summary match", status="In Progress", priority="High")
        match = score_duplicate(candidate, issue)
        assert match is not None
        assert match.issue_key == "TEST-123"
        assert match.status == "In Progress"
        assert match.priority == "High"
        assert match.confidence in ("high", "medium", "low")

    def test_old_issue_lower_recency(self):
        candidate = DuplicateCandidate(summary="Shared terms between these two summaries here")
        recent = self._make_issue("Shared terms between summaries", created="2026-05-04T00:00:00Z")
        old = self._make_issue("Shared terms between summaries", created="2025-01-01T00:00:00Z")
        match_recent = score_duplicate(candidate, recent)
        match_old = score_duplicate(candidate, old)
        if match_recent and match_old:
            assert match_recent.similarity_score >= match_old.similarity_score


class TestBuildSearchQueries:
    def test_basic_queries(self):
        candidate = DuplicateCandidate(summary="Login page returns 500 error")
        queries = build_search_queries("PROJ", candidate)
        assert len(queries) >= 2  # At least summary + recent
        assert all("PROJ" in q for q in queries)

    def test_with_story_key(self):
        candidate = DuplicateCandidate(summary="Test bug")
        queries = build_search_queries("PROJ", candidate, story_key="PROJ-42")
        assert any("linkedIssues" in q for q in queries)

    def test_with_related_work_item_keys(self):
        candidate = DuplicateCandidate(summary="Test bug")
        queries = build_search_queries(
            "PROJ",
            candidate,
            story_key="PROJ-42",
            related_work_item_keys=["PROJ-1", "PROJ-43"],
        )
        assert any("linkedIssues" in q and "PROJ-1" in q and "PROJ-43" in q for q in queries)

    def test_with_configured_issue_type_and_project_fallback(self):
        candidate = DuplicateCandidate(summary="Login failure")
        queries = build_search_queries(
            "PROJ",
            candidate,
            issue_type_id="10004",
            issue_type_name="Production Defect",
        )
        assert any('issuetype = "10004"' in q for q in queries)
        assert any('issuetype = "Production Defect"' in q for q in queries)
        assert any('project = "PROJ" AND created >= -30d' in q for q in queries)

    def test_with_error_message(self):
        candidate = DuplicateCandidate(
            summary="API failure",
            description="Got 500 Internal Server Error",
        )
        queries = build_search_queries("PROJ", candidate)
        assert any("500" in q for q in queries)

    def test_empty_summary(self):
        candidate = DuplicateCandidate(summary="")
        queries = build_search_queries("PROJ", candidate)
        # Should still have the recent bugs query
        assert len(queries) >= 1


class FakeDuplicateScopeAdapter:
    def __init__(self):
        self.search_queries = []

    def fetch_issue(self, issue_key):
        issues = {
            "PROJ-11": {
                "key": "PROJ-11",
                "fields": {
                    "issuetype": {"name": "Task"},
                    "parent": {"key": "PROJ-10"},
                },
            },
            "PROJ-10": {
                "key": "PROJ-10",
                "fields": {
                    "issuetype": {"name": "Story"},
                    "parent": {"key": "PROJ-1"},
                },
            },
        }
        return issues[issue_key]

    def search_issues(self, jql, fields=None, max_results=100):
        self.search_queries.append(jql)
        if "PROJ-10" in jql:
            return [{"key": "PROJ-12", "fields": {}}]
        if "PROJ-1" in jql:
            return [{"key": "PROJ-13", "fields": {}}]
        return []


class TestDuplicateScope:
    def test_resolves_current_parent_epic_and_sibling_work_items(self):
        adapter = FakeDuplicateScopeAdapter()
        keys = resolve_duplicate_scope_work_items(adapter, "PROJ", "PROJ-11")
        assert keys[:3] == ["PROJ-11", "PROJ-10", "PROJ-1"]
        assert "PROJ-12" in keys
        assert "PROJ-13" in keys
        assert any("parent" in query and "PROJ-10" in query for query in adapter.search_queries)
        assert any('"Epic Link"' in query and "PROJ-1" in query for query in adapter.search_queries)


class TestConfidenceThresholds:
    def test_thresholds_ordered(self):
        assert CONFIDENCE_HIGH > CONFIDENCE_MEDIUM > CONFIDENCE_LOW > 0

    def test_high_is_080(self):
        assert CONFIDENCE_HIGH == 0.80

    def test_medium_is_055(self):
        assert CONFIDENCE_MEDIUM == 0.55

    def test_low_is_035(self):
        assert CONFIDENCE_LOW == 0.35


class TestDuplicateCandidateSchema:
    def test_defaults(self):
        c = DuplicateCandidate()
        assert c.summary == ""
        assert c.labels == []

    def test_populated(self):
        c = DuplicateCandidate(
            summary="Test",
            component="Checkout",
            labels=["regression"],
        )
        assert c.component == "Checkout"
        assert c.labels == ["regression"]


class TestDuplicateMatchSchema:
    def test_required_fields(self):
        m = DuplicateMatch(
            issue_key="TEST-1",
            summary="Test",
            status="Open",
            priority="High",
            similarity_score=0.85,
            confidence="high",
            reason="similar summary",
            url="https://jira.example.com/browse/TEST-1",
        )
        assert m.issue_key == "TEST-1"
        assert m.similarity_score == 0.85


class TestEdgeCases:
    def test_unicode_text(self):
        tokens = extract_tokens("Ünïcödé chàracters in búg title")
        assert len(tokens) > 0

    def test_very_long_input(self):
        long_text = "word " * 10000
        tokens = extract_tokens(long_text)
        assert "word" in tokens

    def test_none_safe_description(self):
        """Scoring should handle None description in issue fields."""
        candidate = DuplicateCandidate(summary="Test match")
        issue = {
            "key": "X-1",
            "fields": {
                "summary": "Test match",
                "description": None,
                "status": {"name": "Open"},
                "priority": {"name": "Medium"},
                "labels": [],
                "components": [],
                "created": "2026-05-01T00:00:00Z",
            }
        }
        match = score_duplicate(candidate, issue)
        # Should not crash
        assert match is None or isinstance(match, DuplicateMatch)

    def test_empty_fields(self):
        """Scoring should handle empty fields dict."""
        candidate = DuplicateCandidate(summary="Test")
        issue = {"key": "X-2", "fields": {}}
        match = score_duplicate(candidate, issue)
        assert match is None or isinstance(match, DuplicateMatch)

    def test_similar_description_can_match_when_title_wording_differs(self):
        candidate = DuplicateCandidate(
            summary="Unsuccessful login",
            description="User cannot sign in with valid credentials and stays on login page",
        )
        issue = {
            "key": "X-3",
            "fields": {
                "summary": "Login fails for valid user",
                "description": "User cannot sign in with valid credentials and remains on login page",
                "status": {"name": "Open"},
                "priority": {"name": "Medium"},
                "labels": [],
                "components": [],
                "created": "2026-05-01T00:00:00Z",
            }
        }
        match = score_duplicate(candidate, issue)
        assert match is not None
