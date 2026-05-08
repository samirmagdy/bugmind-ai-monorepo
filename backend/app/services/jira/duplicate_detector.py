"""
Duplicate detection service for Jira bug candidates.

Provides deterministic text-similarity-based duplicate detection
by comparing a bug candidate against existing Jira issues found
via JQL search. No AI calls are made; scoring is purely token-based.

Privacy: raw Jira descriptions are never stored or logged.
Only issue keys, summary hashes, and scores are emitted.
"""
from __future__ import annotations

import hashlib
import logging
import re
from typing import Any, Dict, List, Optional, Set

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Stop words (common English words that add noise to similarity) ──────────
_STOP_WORDS: Set[str] = {
    "a", "an", "the", "is", "it", "in", "on", "at", "to", "for", "of",
    "and", "or", "but", "not", "with", "by", "from", "as", "was", "were",
    "be", "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "shall", "may", "might", "can",
    "this", "that", "these", "those", "i", "we", "you", "he", "she",
    "they", "me", "him", "her", "us", "them", "my", "our", "your",
    "his", "its", "their", "what", "which", "who", "whom", "where",
    "when", "how", "why", "if", "then", "else", "so", "than", "too",
    "very", "just", "also", "about", "up", "out", "no", "yes",
    "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "only", "own", "same", "into", "over", "after",
    "before", "between", "under", "again", "further", "once",
    # Jira / bug-report noise
    "bug", "issue", "error", "problem", "ticket", "story", "task",
    "test", "case", "expected", "actual", "result", "steps",
}

# ── Error signature patterns ──────────────────────────────────────────────
_ERROR_PATTERNS = [
    re.compile(r"\b(?:HTTP\s*)?(?:status\s*(?:code)?:?\s*)?([45]\d{2})\b", re.IGNORECASE),
    re.compile(r"\b((?:TypeError|ReferenceError|SyntaxError|ValueError|KeyError|AttributeError|NullPointerException|IndexOutOfBoundsException|RuntimeException)\b[^\n]{0,80})", re.IGNORECASE),
    re.compile(r"\b(ERR[_-]?\w{3,30})\b"),
    re.compile(r"\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EPERM|EACCES)\b"),
]

# ── Path / endpoint patterns ─────────────────────────────────────────────
_PATH_PATTERN = re.compile(r"(?:^|[\s\"'])(\/(?:api|v\d|rest|graphql)[\w/\-.]*)", re.IGNORECASE)

# ── Confidence thresholds ─────────────────────────────────────────────────
CONFIDENCE_HIGH = 0.80
CONFIDENCE_MEDIUM = 0.55
CONFIDENCE_LOW = 0.35
MAX_SCOPE_WORK_ITEMS = 30
LINKED_ISSUE_CHUNK_SIZE = 8


# ═══════════════════════════════════════════════════════════════════════════
# Public data models
# ═══════════════════════════════════════════════════════════════════════════

class DuplicateCandidate(BaseModel):
    """Input: a generated bug that hasn't been published yet."""
    summary: str = ""
    description: str = ""
    error_message: str = ""
    component: str = ""
    labels: List[str] = []
    screen_or_page: str = ""
    api_endpoint: str = ""


class DuplicateMatch(BaseModel):
    """One potential duplicate found in Jira."""
    issue_key: str
    summary: str
    status: str
    priority: str
    similarity_score: float
    confidence: str  # "high" | "medium" | "low"
    reason: str
    url: str


# ═══════════════════════════════════════════════════════════════════════════
# Text processing utilities
# ═══════════════════════════════════════════════════════════════════════════

def normalize_text(text: str) -> str:
    """Lowercase, collapse whitespace, strip non-alphanumeric chars."""
    if not text:
        return ""
    lowered = text.lower()
    # Keep alphanumeric, slashes (for paths), hyphens, and underscores
    cleaned = re.sub(r"[^a-z0-9/_\-\s]", " ", lowered)
    return re.sub(r"\s+", " ", cleaned).strip()


def extract_tokens(text: str) -> Set[str]:
    """Split normalized text into meaningful tokens after removing stop words."""
    if not text:
        return set()
    normalized = normalize_text(text)
    tokens = set(normalized.split())
    return tokens - _STOP_WORDS


def extract_error_signatures(text: str) -> Set[str]:
    """Extract error codes, status codes, and exception names."""
    if not text:
        return set()
    signatures: Set[str] = set()
    for pattern in _ERROR_PATTERNS:
        for match in pattern.finditer(text):
            signatures.add(match.group(1).strip().lower())
    return signatures


def extract_paths(text: str) -> Set[str]:
    """Extract API endpoint paths like /api/v1/users."""
    if not text:
        return set()
    paths: Set[str] = set()
    for match in _PATH_PATTERN.finditer(text):
        path = match.group(1).strip().lower()
        # Normalize trailing slashes
        paths.add(path.rstrip("/"))
    return paths


def summary_hash(text: str) -> str:
    """Short deterministic hash for cache keys — never logged."""
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()[:16]


# ═══════════════════════════════════════════════════════════════════════════
# Similarity scoring
# ═══════════════════════════════════════════════════════════════════════════

def _jaccard(set_a: Set[str], set_b: Set[str]) -> float:
    """Jaccard index between two sets. Returns 0.0 if both empty."""
    if not set_a and not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union) if union else 0.0


def _sets_overlap(set_a: Set[str], set_b: Set[str]) -> float:
    """Overlap coefficient: |A ∩ B| / min(|A|, |B|)."""
    if not set_a or not set_b:
        return 0.0
    intersection = set_a & set_b
    return len(intersection) / min(len(set_a), len(set_b))


def _days_old(issue: Dict[str, Any]) -> int:
    """Rough estimate of issue age in days from the created field."""
    import datetime
    created = (issue.get("fields") or {}).get("created") or ""
    if not created:
        return 999
    try:
        dt = datetime.datetime.fromisoformat(created.replace("Z", "+00:00"))
        delta = datetime.datetime.now(datetime.timezone.utc) - dt
        return max(0, delta.days)
    except (ValueError, TypeError):
        return 999


def score_duplicate(
    candidate: DuplicateCandidate,
    existing_issue: Dict[str, Any],
) -> Optional[DuplicateMatch]:
    """
    Score an existing Jira issue against a candidate bug.

    Weights:
    - Title token similarity: 40%
    - Error signature match: 25%
    - Component/label overlap: 15%
    - Path/endpoint match: 10%
    - Recency bonus: 10%

    Returns None if score < CONFIDENCE_LOW.
    """
    fields = existing_issue.get("fields") or {}
    existing_summary = str(fields.get("summary") or "")
    existing_description = _stringify_description(fields.get("description"))
    existing_combined = f"{existing_summary} {existing_description}"

    candidate_combined = f"{candidate.summary} {candidate.description}"

    # ── 1. Title and body token similarity ───────────────────────────────
    candidate_title_tokens = extract_tokens(candidate.summary)
    existing_title_tokens = extract_tokens(existing_summary)
    title_score = max(
        _jaccard(candidate_title_tokens, existing_title_tokens),
        _sets_overlap(candidate_title_tokens, existing_title_tokens) * 0.75,
    )
    candidate_body_tokens = extract_tokens(candidate_combined)
    existing_body_tokens = extract_tokens(existing_combined)
    body_score = _jaccard(candidate_body_tokens, existing_body_tokens)

    # ── 2. Error signature match (25%) ───────────────────────────────────
    candidate_errors = extract_error_signatures(
        f"{candidate_combined} {candidate.error_message}"
    )
    existing_errors = extract_error_signatures(existing_combined)
    error_score = _sets_overlap(candidate_errors, existing_errors) if candidate_errors else 0.0

    # ── 3. Component / label overlap (15%) ───────────────────────────────
    candidate_labels = {label.strip().lower() for label in candidate.labels if label.strip()}
    if candidate.component:
        candidate_labels.add(candidate.component.strip().lower())

    existing_labels = set()
    for label in (fields.get("labels") or []):
        if isinstance(label, str):
            existing_labels.add(label.strip().lower())
    existing_components = fields.get("components") or []
    for comp in existing_components:
        if isinstance(comp, dict):
            name = comp.get("name") or ""
            if name:
                existing_labels.add(name.strip().lower())

    label_score = _sets_overlap(candidate_labels, existing_labels) if candidate_labels else 0.0

    # ── 4. Path / endpoint match (10%) ───────────────────────────────────
    candidate_paths = extract_paths(f"{candidate_combined} {candidate.api_endpoint}")
    existing_paths = extract_paths(existing_combined)
    path_score = _sets_overlap(candidate_paths, existing_paths) if candidate_paths else 0.0

    # ── 5. Recency bonus (10%) ───────────────────────────────────────────
    age_days = _days_old(existing_issue)
    recency_score = max(0.0, 1.0 - (age_days / 90.0))  # Full bonus if < 1 day, zero at 90 days

    # ── Weighted composite ───────────────────────────────────────────────
    total = (
        title_score * 0.30
        + body_score * 0.30
        + error_score * 0.18
        + label_score * 0.07
        + path_score * 0.10
        + recency_score * 0.05
    )
    if error_score >= 0.8:
        total = max(total, CONFIDENCE_LOW + 0.01)
    if path_score >= 0.8:
        total = max(total, CONFIDENCE_LOW + 0.01)
    if body_score >= 0.55:
        total = max(total, CONFIDENCE_LOW + 0.01)

    if total < CONFIDENCE_LOW:
        return None

    # ── Build reason string ──────────────────────────────────────────────
    reasons: list[str] = []
    if title_score >= 0.4:
        reasons.append("similar summary")
    if body_score >= 0.35:
        reasons.append("similar description")
    if error_score >= 0.5:
        reasons.append("matching error signature")
    if label_score >= 0.5:
        reasons.append("shared labels/components")
    if path_score >= 0.5:
        reasons.append("matching API endpoint")
    if recency_score >= 0.7:
        reasons.append("recently created")
    if not reasons:
        reasons.append("partial text overlap")

    confidence = (
        "high" if total >= CONFIDENCE_HIGH
        else "medium" if total >= CONFIDENCE_MEDIUM
        else "low"
    )

    # Build Jira URL
    issue_key = str(existing_issue.get("key") or "")
    # URL will be set by the caller who knows the instance URL

    status_obj = fields.get("status") or {}
    priority_obj = fields.get("priority") or {}

    return DuplicateMatch(
        issue_key=issue_key,
        summary=existing_summary[:200],
        status=str(status_obj.get("name") or "Unknown") if isinstance(status_obj, dict) else "Unknown",
        priority=str(priority_obj.get("name") or "Unknown") if isinstance(priority_obj, dict) else "Unknown",
        similarity_score=round(total, 3),
        confidence=confidence,
        reason=", ".join(reasons).capitalize(),
        url="",  # Set by caller
    )


# ═══════════════════════════════════════════════════════════════════════════
# JQL query builders
# ═══════════════════════════════════════════════════════════════════════════

def _quote_jql(value: str) -> str:
    """Safely quote a JQL string value."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _extract_keywords(text: str, max_terms: int = 6) -> List[str]:
    """Extract the most significant keywords from text for JQL search."""
    tokens = extract_tokens(text)
    # Sort by length descending (longer words are typically more specific)
    sorted_tokens = sorted(tokens, key=len, reverse=True)
    return sorted_tokens[:max_terms]


def _issue_key(value: Any) -> str:
    if isinstance(value, dict):
        raw_key = value.get("key")
        return str(raw_key).strip().upper() if raw_key else ""
    return ""


def _issue_type_name(issue: Dict[str, Any]) -> str:
    fields = issue.get("fields") or {}
    issue_type = fields.get("issuetype") or {}
    if isinstance(issue_type, dict):
        return str(issue_type.get("name") or "").strip().lower()
    return ""


def _parent_key(issue: Dict[str, Any]) -> str:
    fields = issue.get("fields") or {}
    return _issue_key(fields.get("parent"))


def _append_unique_key(keys: List[str], key: str) -> None:
    normalized = key.strip().upper()
    if normalized and normalized not in keys:
        keys.append(normalized)


def _linked_issue_clauses(keys: List[str]) -> List[str]:
    clauses: List[str] = []
    for idx in range(0, len(keys), LINKED_ISSUE_CHUNK_SIZE):
        chunk = keys[idx:idx + LINKED_ISSUE_CHUNK_SIZE]
        if chunk:
            clauses.append(" OR ".join(f'issue in linkedIssues({_quote_jql(key)})' for key in chunk))
    return clauses


def resolve_duplicate_scope_work_items(adapter: Any, project_key: str, story_key: Optional[str]) -> List[str]:
    """
    Resolve work items whose linked bugs should be considered duplicates.

    Scope includes:
    - the current issue
    - its parent user story/epic when Jira exposes one
    - the parent of that parent when present
    - sibling/child work items under those parent/epic roots
    """
    if not story_key:
        return []

    scope_keys: List[str] = []
    root_keys: List[str] = []
    current_key = story_key.strip().upper()
    _append_unique_key(scope_keys, current_key)

    try:
        current_issue = adapter.fetch_issue(current_key)
    except Exception:
        return scope_keys

    if _issue_type_name(current_issue) == "epic":
        _append_unique_key(root_keys, current_key)

    current_parent_key = _parent_key(current_issue)
    if current_parent_key:
        _append_unique_key(scope_keys, current_parent_key)
        _append_unique_key(root_keys, current_parent_key)
        try:
            parent_issue = adapter.fetch_issue(current_parent_key)
            parent_parent_key = _parent_key(parent_issue)
            if parent_parent_key:
                _append_unique_key(scope_keys, parent_parent_key)
                _append_unique_key(root_keys, parent_parent_key)
            if _issue_type_name(parent_issue) == "epic":
                _append_unique_key(root_keys, current_parent_key)
        except Exception:
            pass

    for root_key in root_keys:
        root_queries = [
            f'project = {_quote_jql(project_key)} AND parent = {_quote_jql(root_key)} ORDER BY created DESC',
            f'project = {_quote_jql(project_key)} AND "Epic Link" = {_quote_jql(root_key)} ORDER BY created DESC',
            f'project = {_quote_jql(project_key)} AND issue in linkedIssues({_quote_jql(root_key)}) ORDER BY created DESC',
        ]
        for jql in root_queries:
            if len(scope_keys) >= MAX_SCOPE_WORK_ITEMS:
                return scope_keys[:MAX_SCOPE_WORK_ITEMS]
            try:
                issues = adapter.search_issues(
                    jql,
                    fields=["summary", "issuetype", "parent"],
                    max_results=MAX_SCOPE_WORK_ITEMS,
                )
            except Exception:
                continue

            for issue in issues:
                _append_unique_key(scope_keys, str(issue.get("key") or ""))
                if len(scope_keys) >= MAX_SCOPE_WORK_ITEMS:
                    return scope_keys[:MAX_SCOPE_WORK_ITEMS]

    return scope_keys[:MAX_SCOPE_WORK_ITEMS]


def build_search_queries(
    project_key: str,
    candidate: DuplicateCandidate,
    story_key: Optional[str] = None,
    issue_type_id: Optional[str] = None,
    issue_type_name: Optional[str] = None,
    related_work_item_keys: Optional[List[str]] = None,
) -> List[str]:
    """
    Build a list of JQL queries to find potential duplicates.
    Each query targets a different signal.
    """
    queries: List[str] = []
    project_filter = f'project = {_quote_jql(project_key)}'
    issue_type_filters: List[str] = []
    if issue_type_id:
        issue_type_filters.append(f'{project_filter} AND issuetype = {_quote_jql(issue_type_id)}')
    if issue_type_name:
        issue_type_filters.append(f'{project_filter} AND issuetype = {_quote_jql(issue_type_name)}')
    issue_type_filters.append(f'{project_filter} AND issuetype in (Bug, Defect, "Bug Report")')

    # Last-resort project-only fallback prevents custom/localized bug type names
    # from making duplicate detection look empty before scoring can run.
    base_filters = list(dict.fromkeys(issue_type_filters))

    # 1. Summary keyword search
    keywords = _extract_keywords(candidate.summary)
    if keywords:
        text_clause = " OR ".join(f'summary ~ {_quote_jql(kw)}' for kw in keywords[:4])
        for base_filter in base_filters:
            queries.append(f'{base_filter} AND ({text_clause}) ORDER BY created DESC')

    # 2. Error message search
    error_sigs = extract_error_signatures(
        f"{candidate.description} {candidate.error_message}"
    )
    for sig in list(error_sigs)[:2]:
        for base_filter in base_filters:
            queries.append(
                f'{base_filter} AND text ~ {_quote_jql(sig)} ORDER BY created DESC'
            )

    # 3. Bugs linked to the current issue, parent/epic, or sibling work items
    linked_scope_keys: List[str] = []
    if story_key:
        _append_unique_key(linked_scope_keys, story_key)
    for key in related_work_item_keys or []:
        _append_unique_key(linked_scope_keys, key)

    for linked_clause in _linked_issue_clauses(linked_scope_keys):
        for base_filter in base_filters:
            queries.append(
                f'{base_filter} AND ({linked_clause}) ORDER BY created DESC'
            )

    # 4. Recently created bugs in same project (last 30 days)
    for base_filter in base_filters:
        queries.append(
            f'{base_filter} AND created >= -90d ORDER BY created DESC'
        )
    queries.append(f'{project_filter} AND created >= -30d ORDER BY created DESC')

    return list(dict.fromkeys(queries))


# ═══════════════════════════════════════════════════════════════════════════
# Main search orchestrator
# ═══════════════════════════════════════════════════════════════════════════

def find_duplicates(
    adapter: Any,
    project_key: str,
    candidate: DuplicateCandidate,
    instance_url: str = "",
    story_key: Optional[str] = None,
    issue_type_id: Optional[str] = None,
    issue_type_name: Optional[str] = None,
    max_results: int = 10,
) -> tuple[List[DuplicateMatch], bool, str]:
    """
    Search Jira for potential duplicates of a candidate bug.

    Returns:
        (matches, check_failed, failure_reason)
        - matches: sorted by score descending, max_results capped
        - check_failed: True if all Jira queries failed
        - failure_reason: human-readable reason if check_failed
    """
    related_work_item_keys = resolve_duplicate_scope_work_items(adapter, project_key, story_key)
    queries = build_search_queries(
        project_key,
        candidate,
        story_key,
        issue_type_id,
        issue_type_name,
        related_work_item_keys,
    )
    if not queries:
        return [], False, ""

    search_fields = ["summary", "description", "status", "priority", "labels", "components", "created"]
    seen_keys: Set[str] = set()
    all_issues: List[Dict[str, Any]] = []
    query_failures = 0

    for jql in queries:
        try:
            issues = adapter.search_issues(jql, fields=search_fields, max_results=20)
            for issue in issues:
                key = issue.get("key")
                if key and key not in seen_keys:
                    seen_keys.add(key)
                    all_issues.append(issue)
        except Exception:
            query_failures += 1
            logger.warning(
                "duplicate_detection_jql_failed",
                extra={"project_key": project_key},
            )

    if query_failures == len(queries):
        return [], True, "All Jira searches failed. Duplicate check could not be completed."

    # Score each issue
    matches: List[DuplicateMatch] = []
    base_url = instance_url.rstrip("/") if instance_url else ""

    for issue in all_issues:
        match = score_duplicate(candidate, issue)
        if match:
            if base_url:
                match.url = f"{base_url}/browse/{match.issue_key}"
            matches.append(match)

    # Sort by score descending, cap results
    matches.sort(key=lambda m: m.similarity_score, reverse=True)
    return matches[:max_results], False, ""


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def _stringify_description(value: Any) -> str:
    """Convert Jira description (string or ADF) to plain text."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        parts: list[str] = []
        def walk(node: Any) -> None:
            if isinstance(node, dict):
                text = node.get("text")
                if isinstance(text, str):
                    parts.append(text)
                for child in node.get("content") or []:
                    walk(child)
            elif isinstance(node, list):
                for child in node:
                    walk(child)
        walk(value)
        return " ".join(parts)
    return ""
