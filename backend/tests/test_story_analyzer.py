"""
Tests for the story analyzer.

Covers:
- AC counting from various formats
- Complexity estimation
- Content warnings for sparse input
- Edge cases with empty input
"""
from app.services.ai.story_analyzer import analyze_story_context, _count_acceptance_criteria


class TestACCounting:
    def test_bullet_list(self):
        ac = "- User can log in\n- User can log out\n- User receives email"
        assert _count_acceptance_criteria(ac) == 3

    def test_numbered_list(self):
        ac = "1. Login works\n2. Logout works\n3. Reset works"
        assert _count_acceptance_criteria(ac) == 3

    def test_gherkin_format(self):
        ac = "Given the user is on login page\nWhen they enter credentials\nThen they are logged in\nGiven the user is logged in\nWhen they click logout\nThen they are redirected"
        # 2 scenarios (2 "Given" lines)
        assert _count_acceptance_criteria(ac) == 2

    def test_empty_input(self):
        assert _count_acceptance_criteria("") == 0
        assert _count_acceptance_criteria("   ") == 0

    def test_heading_ignored(self):
        ac = "Acceptance Criteria:\n- First criterion\n- Second criterion"
        assert _count_acceptance_criteria(ac) == 2

    def test_freeform_lines(self):
        ac = "The system should validate email format\nPasswords must be at least 8 characters"
        assert _count_acceptance_criteria(ac) == 2


class TestComplexityEstimation:
    def test_small_complexity(self):
        result = analyze_story_context(
            summary="Fix button color",
            description="Change the submit button from red to blue.",
        )
        assert result.estimated_complexity == "small"
        assert result.ac_count == 0

    def test_medium_complexity(self):
        result = analyze_story_context(
            summary="User login flow",
            description="Implement the full login flow with validation." * 20,
            acceptance_criteria="- User can log in with email\n- User can log in with SSO\n- Invalid credentials show error",
        )
        assert result.estimated_complexity == "medium"
        assert result.ac_count == 3

    def test_large_complexity(self):
        result = analyze_story_context(
            summary="Payment processing epic",
            description="Full payment processing system." * 100,
            acceptance_criteria="\n".join(f"- Criterion {i}" for i in range(8)),
        )
        assert result.estimated_complexity == "large"
        assert result.ac_count >= 6


class TestContentWarnings:
    def test_no_content_warning(self):
        result = analyze_story_context()
        assert len(result.content_warnings) > 0
        assert any("No description" in w for w in result.content_warnings)

    def test_no_ac_warning(self):
        result = analyze_story_context(
            description="A detailed description of the feature that needs testing.",
        )
        assert any("acceptance criteria" in w.lower() for w in result.content_warnings)

    def test_short_content_warning(self):
        result = analyze_story_context(
            description="Short.",
            acceptance_criteria="Short AC.",
        )
        assert any("very short" in w.lower() for w in result.content_warnings)

    def test_no_warnings_for_detailed_input(self):
        result = analyze_story_context(
            description="A comprehensive feature description that covers all the key requirements and provides clear context for testing.",
            acceptance_criteria="- User can perform action A\n- System validates input B\n- Error state C is handled properly",
        )
        assert len(result.content_warnings) == 0


class TestStoryAnalysisFields:
    def test_privacy_always_active(self):
        result = analyze_story_context()
        assert result.privacy_redaction_active is True

    def test_has_description_flag(self):
        result = analyze_story_context(description="Some description")
        assert result.has_description is True

        result2 = analyze_story_context()
        assert result2.has_description is False

    def test_description_length(self):
        text = "x" * 500
        result = analyze_story_context(description=text)
        assert result.description_length == 500
