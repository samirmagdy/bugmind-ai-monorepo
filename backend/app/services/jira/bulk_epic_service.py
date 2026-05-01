from typing import Any, Optional

from fastapi import HTTPException

from app.schemas.jira import JiraAttachmentResponse, JiraBulkFetchResponse, JiraBulkIssueResponse


def quote_jql_value(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_epic_children_jql(epic_key: str) -> str:
    quoted = quote_jql_value(epic_key)
    return f'parent = {quoted} OR "Epic Link" = {quoted} OR issue in linkedIssues({quoted})'


def attachment_response(raw_attachment: dict, issue_key: Optional[str] = None) -> JiraAttachmentResponse:
    return JiraAttachmentResponse(
        id=str(raw_attachment.get("id") or ""),
        filename=str(raw_attachment.get("filename") or raw_attachment.get("name") or ""),
        mime_type=raw_attachment.get("mimeType") or raw_attachment.get("mime_type"),
        size=raw_attachment.get("size"),
        issue_key=issue_key,
    )


def stringify_jira_description(value: Any) -> str:
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


def score_story_risk(issue: dict) -> tuple[int, list[str]]:
    fields = issue.get("fields", {}) if isinstance(issue, dict) else {}
    summary = str(fields.get("summary") or "")
    description = stringify_jira_description(fields.get("description"))
    combined = f"{summary}\n{description}".lower()
    reasons: list[str] = []
    score = 0

    if len(description.strip()) < 80:
        score += 25
        reasons.append("short_description")
    if not any(term in combined for term in ("acceptance criteria", "given", "when", "then", "must", "should")):
        score += 25
        reasons.append("missing_clear_acceptance_criteria")
    if any(term in combined for term in ("tbd", "todo", "unknown", "n/a", "later")):
        score += 20
        reasons.append("placeholder_language")
    if any(term in combined for term in ("payment", "auth", "permission", "security", "role", "integration", "migration")):
        score += 15
        reasons.append("high_impact_domain")
    if any(term in combined for term in ("all", "any", "etc", "and/or", "multiple")):
        score += 10
        reasons.append("ambiguous_scope")

    return min(score, 100), reasons


def normalize_bulk_issue(issue: dict) -> JiraBulkIssueResponse:
    fields = issue.get("fields", {}) if isinstance(issue, dict) else {}
    issue_type = fields.get("issuetype") if isinstance(fields.get("issuetype"), dict) else {}
    status = fields.get("status") if isinstance(fields.get("status"), dict) else {}
    issue_key = str(issue.get("key") or "")
    risk_score, risk_reasons = score_story_risk(issue)

    raw_attachments = fields.get("attachment") or []
    attachments = [
        attachment_response(attachment, issue_key)
        for attachment in raw_attachments
        if isinstance(attachment, dict) and attachment.get("id")
    ]

    return JiraBulkIssueResponse(
        id=str(issue.get("id") or ""),
        key=issue_key,
        summary=str(fields.get("summary") or ""),
        description=fields.get("description"),
        issue_type=issue_type.get("name"),
        status=status.get("name"),
        risk_score=risk_score,
        risk_reasons=risk_reasons,
        attachments=attachments,
    )


def fetch_epic_children(adapter, epic_key: str, max_results: int) -> JiraBulkFetchResponse:
    normalized_epic_key = epic_key.strip().upper()
    if not normalized_epic_key or "-" not in normalized_epic_key:
        raise HTTPException(status_code=400, detail="A valid Epic issue key is required")

    jql = build_epic_children_jql(normalized_epic_key)
    issues = adapter.search_issues(
        jql,
        fields=["summary", "description", "issuetype", "status", "attachment", "parent"],
        max_results=max(1, min(max_results, 250)),
    )
    normalized_issues = [normalize_bulk_issue(issue) for issue in issues]

    epic_attachments: list[JiraAttachmentResponse] = []
    try:
        epic = adapter.fetch_issue(normalized_epic_key)
        fields = epic.get("fields", {}) if isinstance(epic, dict) else {}
        raw_attachments = fields.get("attachment") or []
        epic_attachments = [
            attachment_response(attachment, normalized_epic_key)
            for attachment in raw_attachments
            if isinstance(attachment, dict) and attachment.get("id")
        ]
    except HTTPException:
        epic_attachments = []

    return JiraBulkFetchResponse(
        epic_key=normalized_epic_key,
        jql=jql,
        issues=normalized_issues,
        epic_attachments=epic_attachments,
    )
