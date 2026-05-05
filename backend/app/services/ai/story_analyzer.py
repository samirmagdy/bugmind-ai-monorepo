"""
Lightweight, rule-based story analysis helper.

Provides pre-generation context summary:
- Acceptance criteria count
- Estimated complexity (small / medium / large)
- Privacy indicators
- Content statistics
"""
import re
from typing import List, Optional

from pydantic import BaseModel


class StoryAnalysis(BaseModel):
    ac_count: int
    estimated_complexity: str  # "small" | "medium" | "large"
    has_description: bool
    description_length: int
    has_acceptance_criteria: bool
    privacy_redaction_active: bool = True  # Always true — server-side redaction is mandatory
    content_warnings: List[str] = []


def _count_acceptance_criteria(ac_text: str) -> int:
    """Count distinct acceptance criteria items."""
    if not ac_text or not ac_text.strip():
        return 0

    lines = [line.strip() for line in ac_text.strip().splitlines() if line.strip()]

    # Count lines that look like individual criteria
    ac_count = 0
    for line in lines:
        # Skip headings like "Acceptance Criteria:" or "AC:"
        if re.match(r"^(acceptance\s+criteria|ac)\s*[:;]?\s*$", line, re.IGNORECASE):
            continue
        # Count bullet points, numbered items, or Given/When/Then lines
        if re.match(r"^[-*•]\s+", line) or re.match(r"^\d+[.)]\s+", line):
            ac_count += 1
        elif re.match(r"^(given|when|then|and|but)\s+", line, re.IGNORECASE):
            # Only count "Given" as a new AC start in Gherkin
            if re.match(r"^given\s+", line, re.IGNORECASE):
                ac_count += 1
        elif len(line) > 15:
            # Freeform lines that are substantial enough
            ac_count += 1

    return max(ac_count, 1) if lines else 0


def _estimate_complexity(description: str, ac_text: str, ac_count: int) -> str:
    """Estimate story complexity based on content volume."""
    total_chars = len(description or "") + len(ac_text or "")
    
    if ac_count >= 6 or total_chars > 3000:
        return "large"
    elif ac_count >= 3 or total_chars > 1000:
        return "medium"
    else:
        return "small"


def analyze_story_context(
    summary: str = "",
    description: str = "",
    acceptance_criteria: str = "",
    issue_key: Optional[str] = None,
) -> StoryAnalysis:
    """
    Analyze a story's context to provide pre-generation metadata.
    """
    ac_count = _count_acceptance_criteria(acceptance_criteria)
    desc_text = (description or "").strip()
    ac_text = (acceptance_criteria or "").strip()

    complexity = _estimate_complexity(desc_text, ac_text, ac_count)

    warnings: List[str] = []
    if not desc_text and not ac_text:
        warnings.append("No description or acceptance criteria found. AI output may be generic.")
    elif not ac_text:
        warnings.append("No acceptance criteria found. AI will infer test targets from the description.")
    elif len(desc_text) < 50 and len(ac_text) < 50:
        warnings.append("Both description and acceptance criteria are very short. Consider adding more detail.")

    return StoryAnalysis(
        ac_count=ac_count,
        estimated_complexity=complexity,
        has_description=bool(desc_text),
        description_length=len(desc_text),
        has_acceptance_criteria=bool(ac_text),
        content_warnings=warnings,
    )
