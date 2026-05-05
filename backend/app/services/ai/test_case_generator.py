from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.services.ai.base_generator import BaseAIGenerator


class TestCaseGenerator(BaseAIGenerator):
    async def generate_test_cases(
        self,
        context_text: str,
        model: str = None,
        custom_instructions: str = None,
        issue_type_name: str = None,
        supporting_context: str = None,
        test_categories: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Converts a Jira story context into a comprehensive manual test suite.
        Accepts optional test_categories to focus generation on specific test types.
        """
        instruction_block = f"\nPERSONALITY & STYLE GUIDE: {custom_instructions}" if custom_instructions else ""

        # Build category instruction
        if test_categories and len(test_categories) > 0:
            categories_str = ", ".join(test_categories)
            category_instruction = f"""
            REQUIRED TEST CATEGORIES: {categories_str}
            Generate test cases that specifically cover these categories.
            Each test case must have its "test_type" set to one of the requested categories.
            Distribute test cases across the requested categories, prioritizing the first ones listed.
            """
        else:
            category_instruction = """
            Cover positive, negative, edge, regression, validation, permissions/security, accessibility/UX, and integration risks where relevant.
            """

        system_prompt = f"""
        You are BugMind, a Lead QA Engineer.
        Read the provided User Story and Acceptance Criteria.
        Generate a comprehensive set of manual test cases to verify this story.
        {instruction_block}

        Source issue type: {issue_type_name or "Story"}

        {category_instruction}

        REQUIREMENTS:
        - Include traceability to acceptance criteria or story sections in "acceptance_criteria_refs".
        - Include "preconditions" when setup, data, permissions, device, or environment matter.
        - Include "test_type" matching one of the requested categories.
        - Include a brief "objective" describing what this test validates.
        - Include "test_data" when specific data values are needed for the test.
        - Include "review_notes" if the test case has assumptions or needs human review.
        - Include concise "labels" and "components" only when strongly implied by the story.
        - Each test must have a non-empty title, at least one step, and a non-empty expected_result.

        OUTPUT FORMAT (JSON ONLY):
        {{
            "test_cases": [
                {{
                    "title": "Clear case title",
                    "objective": "What this test validates",
                    "steps": ["Step 1", "Step 2"],
                    "expected_result": "What should happen",
                    "priority": "High",
                    "test_type": "Positive",
                    "preconditions": "User is authenticated with permission X",
                    "test_data": "Use email: test@example.com, password: valid123",
                    "review_notes": "Assumes the feature flag is enabled",
                    "acceptance_criteria_refs": ["AC1"],
                    "labels": ["checkout"],
                    "components": ["Payments"]
                }}
            ],
            "coverage_score": 95.0
        }}
        """

        try:
            truncated_context = self._truncate_context(self._sanitize_for_ai(context_text))
            user_prompt = f"Story Context:\n{truncated_context}"
            if supporting_context:
                user_prompt += f"\n\nSupporting Context:\n{self._truncate_context(self._sanitize_for_ai(supporting_context), 10000)}"
            return await self._generate_with_json_retry(
                system_prompt,
                user_prompt,
                model=model,
                expect_test_suite=True,
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI Test Suite Generation Failed: {str(e)}")
