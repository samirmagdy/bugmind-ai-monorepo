"""
Tests for the bug input quality scorer.

Covers:
- Full-quality input scoring
- Empty input
- Partial input with missing sections
- Keyword detection for environment, impact, evidence
"""
import pytest
from app.services.ai.quality_scorer import score_bug_input


class TestQualityScorer:
    def test_empty_input_scores_zero(self):
        result = score_bug_input()
        assert result.score == 0
        assert len(result.missing_items) == 7
        assert all(not item.present for item in result.missing_items)
        assert "No meaningful input detected." in result.summary

    def test_full_quality_input_scores_100(self):
        result = score_bug_input(
            description="When a user submits the checkout form with an expired credit card, the system silently fails without showing an error message, causing significant confusion.",
            steps_to_reproduce="1. Navigate to checkout page\n2. Enter an expired credit card number\n3. Click Submit Payment\n4. Observe the result",
            expected_result="The system should display a clear error message indicating the card is expired and prompt the user to try another card.",
            actual_result="The form submission appears to succeed but no order is created. The user sees a blank page with no feedback.",
            user_description="This bug affects all users attempting to purchase. It's a critical blocker for the checkout flow on Chrome browser in the staging environment. The console log shows a 422 unprocessable entity error.",
        )
        assert result.score == 100
        assert all(item.present for item in result.missing_items)
        assert "Strong" in result.summary

    def test_partial_input_scores_moderate(self):
        result = score_bug_input(
            description="Login form doesn't work properly.",
            steps_to_reproduce="1. Go to login page\n2. Enter credentials\n3. Click login",
            expected_result="Should log in",
            actual_result="Shows error",
        )
        # Steps present (20) + description quality maybe not (10)
        # Expected/actual too short (<20 chars) — 0 each
        # Environment, impact, evidence missing
        assert 10 <= result.score <= 40
        assert any(not item.present for item in result.missing_items)
        assert len(result.hints) > 0

    def test_environment_keywords_detected(self):
        result = score_bug_input(
            description="Bug only appears on Chrome 120 on Windows 11.",
        )
        env_item = next(i for i in result.missing_items if "Environment" in i.label)
        assert env_item.present

    def test_impact_keywords_detected(self):
        result = score_bug_input(
            description="This blocks all users from completing checkout and prevents order processing.",
        )
        impact_item = next(i for i in result.missing_items if "impact" in i.label.lower())
        assert impact_item.present

    def test_evidence_keywords_detected(self):
        result = score_bug_input(
            description="The console log shows a stack trace and the screenshot is attached.",
        )
        evidence_item = next(i for i in result.missing_items if "Evidence" in i.label)
        assert evidence_item.present

    def test_selected_text_contributes_to_score(self):
        result = score_bug_input(
            selected_text="The API endpoint /api/users returns a 500 error on Chrome browser when the user impact is critical and blocks all users from accessing the dashboard.",
        )
        # selected_text should contribute to keyword detection
        assert result.score > 0

    def test_score_clamped_to_range(self):
        result = score_bug_input()
        assert 0 <= result.score <= 100

    def test_hints_match_missing_items(self):
        result = score_bug_input(description="Short desc.")
        missing_count = sum(1 for item in result.missing_items if not item.present)
        assert len(result.hints) == missing_count

    def test_user_description_as_description_source(self):
        result = score_bug_input(
            user_description="This is a very detailed user description of the bug that explains exactly what happened when the user tried to submit the form with invalid data input.",
        )
        desc_item = next(i for i in result.missing_items if "description" in i.label.lower())
        assert desc_item.present
