# BugMind AI — Audit Logging

## Overview

BugMind maintains an audit log for security, compliance, and debugging purposes. Audit events are stored in the PostgreSQL database and exposed through workspace-level API endpoints.

---

## What Is Logged

| Category | Events |
|---|---|
| **Auth** | Login, logout, token refresh, password change |
| **AI Generation** | Bug generation, test case generation (model, workspace, user, timestamp) |
| **Publishing** | Jira publish attempts (success/failure), Xray publish attempts |
| **Workspace** | Member add/remove, role change, connection share/unshare |
| **Jobs** | Job creation, job start, job completion, job failure, cancellation |

---

## Audit Log Schema

```python
class AuditLog(Base):
    id: int
    user_id: int
    workspace_id: Optional[int]
    event_type: str       # e.g. "ai.generate_bug", "jira.publish_success"
    resource_type: str    # e.g. "bug_report", "test_case", "job"
    resource_id: str      # e.g. Jira issue key, job ID
    detail: dict          # JSON blob with event-specific metadata
    ip_address: str
    created_at: datetime
```

---

## API

| Endpoint | Description |
|---|---|
| `GET /api/v1/workspaces/{id}/audit-logs` | Retrieve audit logs for a workspace (paginated) |

Access requires Owner or Admin role on the workspace.

---

## Planned Additions (Roadmap P1)

### Prompt Version Metadata

Every AI generation event should include:

```json
{
  "prompt_template_id": "bug_gen_v2",
  "prompt_version": "2.1.0",
  "model": "openai/gpt-4o",
  "input_hash": "sha256:abc123...",
  "output_hash": "sha256:def456...",
  "generation_type": "bug_report",
  "redaction_applied": true,
  "fallback_used": false
}
```

This enables: "Why did this test case change between yesterday and today?"

### Audit Log Export

Future: Export audit logs as CSV or JSON for compliance reporting.

---

## Retention

Audit logs are currently retained indefinitely in the database. A retention policy (e.g., 90-day rolling window) should be implemented before enterprise deployment.
