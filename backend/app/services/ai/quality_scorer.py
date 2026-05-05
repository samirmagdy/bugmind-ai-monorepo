"""
Rule-based bug input quality scorer.

Scores bug input quality from 0-100 without AI calls.
Returns missing sections and improvement hints.
"""
import re
from typing import List, Optional

from pydantic import BaseModel


class QualityCheckItem(BaseModel):
    label: str
    present: bool
    hint: str


class QualityCheckResult(BaseModel):
    score: int
    missing_items: List[QualityCheckItem]
    hints: List[str]
    summary: str


_ENVIRONMENT_KEYWORDS = {
    "browser", "chrome", "firefox", "safari", "edge", "opera",
    "ios", "android", "windows", "macos", "linux", "ubuntu",
    "mobile", "tablet", "desktop", "iphone", "ipad", "pixel",
    "production", "staging", "dev", "environment", "version",
    "api", "endpoint", "device", "screen", "resolution",
}

_IMPACT_KEYWORDS = {
    "impact", "affects", "blocks", "prevents", "unable",
    "cannot", "broken", "fails", "crash", "data loss",
    "security", "usability", "accessibility", "performance",
    "regression", "downtime", "user", "customer", "critical",
    "workaround", "degraded",
}

_EVIDENCE_KEYWORDS = {
    "log", "logs", "screenshot", "error", "trace", "stack",
    "traceback", "exception", "console", "network", "response",
    "payload", "recording", "video", "attachment", "debug",
    "http", "status code", "400", "401", "403", "404", "500",
}


def _word_set(text: str) -> set:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _has_keywords(text: str, keywords: set) -> bool:
    words = _word_set(text)
    return bool(words & keywords)


def _count_meaningful_lines(text: str) -> int:
    return sum(1 for line in text.strip().splitlines() if len(line.strip()) > 5)


def score_bug_input(
    description: str = "",
    steps_to_reproduce: str = "",
    expected_result: str = "",
    actual_result: str = "",
    user_description: str = "",
    selected_text: str = "",
) -> QualityCheckResult:
    """
    Score the quality of bug input from 0-100.

    Accepts raw text from either the story context or user-provided fields.
    Combines all available text for context-aware scoring.
    """
    # Merge all available input for keyword scanning
    combined = " ".join(filter(None, [
        description, steps_to_reproduce, expected_result,
        actual_result, user_description, selected_text,
    ]))

    items: List[QualityCheckItem] = []
    hints: List[str] = []
    total_score = 0

    # 1. Steps to reproduce (20 points)
    steps_present = bool(steps_to_reproduce.strip()) and _count_meaningful_lines(steps_to_reproduce) >= 2
    items.append(QualityCheckItem(
        label="Steps to reproduce",
        present=steps_present,
        hint="Add numbered steps showing how to trigger the bug." if not steps_present else "",
    ))
    if steps_present:
        total_score += 20
    else:
        hints.append("Add at least 2 clear reproduction steps.")

    # 2. Actual result (15 points)
    actual_present = bool(actual_result.strip()) and len(actual_result.strip()) > 20
    items.append(QualityCheckItem(
        label="Actual result",
        present=actual_present,
        hint="Describe what actually happened in detail." if not actual_present else "",
    ))
    if actual_present:
        total_score += 15
    else:
        hints.append("Describe the actual (incorrect) behavior you observed.")

    # 3. Expected result (15 points)
    expected_present = bool(expected_result.strip()) and len(expected_result.strip()) > 20
    items.append(QualityCheckItem(
        label="Expected result",
        present=expected_present,
        hint="Describe what should have happened instead." if not expected_present else "",
    ))
    if expected_present:
        total_score += 15
    else:
        hints.append("Describe what the correct behavior should be.")

    # 4. Environment/browser/device (15 points)
    env_present = _has_keywords(combined, _ENVIRONMENT_KEYWORDS)
    items.append(QualityCheckItem(
        label="Environment / browser / device",
        present=env_present,
        hint="Mention the browser, OS, device, or environment." if not env_present else "",
    ))
    if env_present:
        total_score += 15
    else:
        hints.append("Specify the environment (browser, OS, device, or API endpoint).")

    # 5. User impact (15 points)
    impact_present = _has_keywords(combined, _IMPACT_KEYWORDS)
    items.append(QualityCheckItem(
        label="User impact described",
        present=impact_present,
        hint="Explain how this bug affects users or business." if not impact_present else "",
    ))
    if impact_present:
        total_score += 15
    else:
        hints.append("Explain who is affected and how severe the impact is.")

    # 6. Evidence/logs (10 points)
    evidence_present = _has_keywords(combined, _EVIDENCE_KEYWORDS)
    items.append(QualityCheckItem(
        label="Evidence / logs mentioned",
        present=evidence_present,
        hint="Attach or reference logs, screenshots, or error messages." if not evidence_present else "",
    ))
    if evidence_present:
        total_score += 10
    else:
        hints.append("Reference any error messages, logs, or screenshots if available.")

    # 7. Description quality (10 points)
    desc_text = description.strip() or user_description.strip() or selected_text.strip()
    desc_quality = bool(desc_text) and len(desc_text) > 50
    items.append(QualityCheckItem(
        label="Detailed description",
        present=desc_quality,
        hint="Provide a clear summary of the problem (>50 characters)." if not desc_quality else "",
    ))
    if desc_quality:
        total_score += 10
    else:
        hints.append("Write a clear, detailed description of the problem.")

    # Clamp score
    total_score = max(0, min(100, total_score))

    # Summary
    if total_score >= 80:
        summary = "Strong input — ready for high-quality AI generation."
    elif total_score >= 50:
        summary = "Moderate input — AI can generate, but results may need editing."
    elif total_score > 0:
        summary = "Weak input — consider adding more detail for better results."
    else:
        summary = "No meaningful input detected."

    return QualityCheckResult(
        score=total_score,
        missing_items=items,
        hints=[h for h in hints if h],
        summary=summary,
    )
