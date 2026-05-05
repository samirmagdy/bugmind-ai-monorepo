# BugMind API Documentation

## Overview

This document describes the live API surface for the BugMind project as implemented in the current codebase.

- Backend framework: FastAPI
- Base API prefix: `/api/v1`
- Default local server: `http://localhost:8000`
- OpenAPI spec: `/api/v1/openapi.json`
- Interactive docs are available through FastAPI when the backend is running

The extension is the primary client for these endpoints. Most application flows are:

1. Authenticate the user.
2. Resolve the active Jira context from the current browser tab.
3. Generate, preview, and submit bugs or test cases.
4. Persist per-project Jira field settings.

## Authentication

Most `/api/v1/*` endpoints require a Bearer token.

Header format:

```http
Authorization: Bearer <access_token>
```

Notes:

- `/api/v1/auth/login` uses `application/x-www-form-urlencoded` via FastAPI `OAuth2PasswordRequestForm`.
- Access tokens are short-lived.
- Refresh tokens are exchanged through `/api/v1/auth/refresh`.
- `/health` and `/metrics` do not require authentication.
- `/api/v1/stripe/webhook` is authenticated by Stripe signature, not by Bearer token.

## Common Conventions

### Error format

Failures return a structured error envelope with trace IDs and suggested user actions.

```json
{
  "code": "JIRA_AUTH_FAILED",
  "message": "Invalid credentials",
  "user_action": "Check your Jira API token and username in Settings.",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "details": {
    "raw_error": "401 Unauthorized"
  },
  "detail": "Invalid credentials"
}
```

Notes:

- `code`: Machine-readable error identifier.
- `message`: Human-friendly error description.
- `user_action`: Specific instructions for the user to resolve the issue.
- `trace_id`: Unique request ID for server-side log correlation.
- `details`: Additional technical context (e.g., validation errors).
- `detail`: Preserved for backward compatibility with legacy clients.

### Jira identity fields

Many endpoints accept both:

- `project_key`
- `project_id`

The backend uses whichever is available and normalizes based on Jira Cloud vs Jira Server/DC behavior.

### Jira platform behavior

Supported Jira connection types:

- `cloud`
- `server`

Server and Cloud differ in a few payload details:

- Jira Cloud user fields usually use `accountId`
- Jira Server/DC user fields usually use `name`
- Jira Server/DC issue creation prefers project `key`

## System Endpoints

### `GET /health`
Returns system status, version, and trace ID.

Response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "environment": "production",
  "trace_id": "..."
}
```

### `GET /health/db`
Verifies database connectivity.

### `GET /health/ai`
Verifies AI provider configuration status.

### `GET /health/jira`
Verifies Jira integration service status.

### `GET /metrics`

Returns lightweight service diagnostics for monitoring.

Response:

```json
{
  "status": "ok",
  "service": "BugMind Backend",
  "version": "1.2.0",
  "environment": "development",
  "uptime_seconds": 42.123,
  "trace_id": "abc-123"
}
```

## Auth API

Base prefix: `/api/v1/auth`

### `POST /auth/register`

Create a user account.

Request body:

```json
{
  "email": "user@example.com",
  "password": "secret"
}
```

Response:

```json
{
  "id": 1,
  "email": "user@example.com",
  "is_active": true,
  "created_at": "2026-04-20T12:00:00"
}
```

Notes:

- Also creates a default free subscription record.

### `POST /auth/login`

Authenticate and return access + refresh tokens.

Content type:

```http
application/x-www-form-urlencoded
```

Form fields:

- `username`: user email
- `password`: plaintext password

Response:

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "token_type": "bearer"
}
```

### `POST /auth/refresh`

Exchange a refresh token for a fresh token pair.

Request body:

```json
{
  "refresh_token": "<jwt>"
}
```

Response:

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "token_type": "bearer"
}
```

### `GET /auth/me`

Validate the current session token and return the user.

Response:

```json
{
  "id": 1,
  "email": "user@example.com",
  "is_active": true,
  "created_at": "2026-04-20T12:00:00"
}
```

### `POST /auth/bootstrap`

Bootstraps the authenticated extension session.

Used by the sidepanel after authentication to decide whether the user should land in setup or main view, and optionally hydrate Jira context for the active tab.

Request body:

```json
{
  "instance_url": "https://example.atlassian.net/browse/PROJ-123",
  "project_key": "PROJ",
  "project_id": "10001",
  "issue_type_id": "10004"
}
```

Response:

```json
{
  "view": "main",
  "has_connections": true,
  "bootstrap_context": {
    "connection_id": 12,
    "instance_url": "https://example.atlassian.net",
    "platform": "cloud",
    "verify_ssl": true,
    "issue_types": [],
    "selected_issue_type": null,
    "visible_fields": [],
    "ai_mapping": {},
    "jira_metadata": null
  }
}
```

Response meanings:

- `view = "setup"`: user has no Jira connections
- `view = "main"`: user has at least one Jira connection
- `bootstrap_context`: populated when the current tab can be matched to a Jira connection and project context

## Settings API

Base prefix: `/api/v1/settings`

### `GET /settings/ai`

Returns saved AI settings for the current user.

Response:

```json
{
  "custom_model": "google/gemini-2.0-flash-001",
  "has_custom_key": true
}
```

### `POST /settings/ai`

Updates AI settings.

Request body:

```json
{
  "custom_model": "openai/gpt-4.1",
  "openrouter_key": "sk-..."
}
```

Response:

```json
{
  "status": "ok"
}
```

Notes:

- `openrouter_key` is encrypted before storage.
- Any omitted field is left unchanged.

### `POST /settings/jira`

Stores per-project Jira field visibility and AI mapping configuration.

Request body:

```json
{
  "jira_connection_id": 12,
  "project_key": "PROJ",
  "project_id": "10001",
  "issue_type_id": "10004",
  "visible_fields": ["customfield_10010", "customfield_10011"],
  "ai_mapping": {
    "steps_to_reproduce": "customfield_10010",
    "expected_result": "customfield_10011"
  }
}
```

Response:

```json
{
  "status": "ok"
}
```

Notes:

- This is used by the extension settings and manual-edit experience.
- Data is keyed by user + project + issue type.

## Jira API

Base prefix: `/api/v1/jira`

### `GET /jira/connections`

List Jira connections for the current user.

Response:

```json
[
  {
    "id": 12,
    "auth_type": "cloud",
    "host_url": "https://example.atlassian.net",
    "username": "user@example.com",
    "verify_ssl": true,
    "is_active": true
  }
]
```

### `POST /jira/bootstrap-context`

Resolve the Jira context for an active browser tab.

Request body:

```json
{
  "instance_url": "https://example.atlassian.net/browse/PROJ-123",
  "project_key": "PROJ",
  "project_id": "10001",
  "issue_type_id": "10004"
}
```

Response fields:

- `connection_id`: matched saved Jira connection
- `instance_url`: normalized base Jira URL
- `platform`: `cloud` or `server`
- `verify_ssl`: current connection SSL policy
- `issue_types`: available issue types for the selected project
- `selected_issue_type`: chosen issue type, preferring the requested one, then Bug, then first available
- `visible_fields`: saved field visibility for this project + issue type
- `ai_mapping`: saved AI-to-Jira field mapping
- `jira_metadata.fields`: resolved Jira create metadata

Example response:

```json
{
  "connection_id": 12,
  "instance_url": "https://example.atlassian.net",
  "platform": "cloud",
  "verify_ssl": true,
  "issue_types": [
    {
      "id": "10004",
      "name": "Bug",
      "icon_url": "https://...",
      "subtask": false
    }
  ],
  "selected_issue_type": {
    "id": "10004",
    "name": "Bug",
    "icon_url": "https://...",
    "subtask": false
  },
  "visible_fields": ["customfield_12345"],
  "ai_mapping": {
    "steps_to_reproduce": "customfield_12345"
  },
  "jira_metadata": {
    "project_key": "PROJ",
    "project_id": "10001",
    "issue_type_id": "10004",
    "fields": [
      {
        "key": "customfield_12345",
        "name": "Steps to Reproduce",
        "type": "string",
        "required": false,
        "system": null,
        "allowed_values": null
      }
    ]
  }
}
```

### `POST /jira/connections`

Create a Jira connection and make it active.

Request body:

```json
{
  "auth_type": "cloud",
  "host_url": "https://example.atlassian.net",
  "username": "user@example.com",
  "token": "jira-api-token",
  "verify_ssl": true
}
```

Response:

```json
{
  "id": 12,
  "auth_type": "cloud",
  "host_url": "https://example.atlassian.net",
  "username": "user@example.com",
  "verify_ssl": true,
  "is_active": true
}
```

Notes:

- Stored token is encrypted.
- Creating a new connection deactivates all others.

### `PATCH /jira/connections/{conn_id}`

Update a Jira connection.

Supported fields:

- `auth_type`
- `host_url`
- `username`
- `token`
- `verify_ssl`
- `is_active`

Example:

```json
{
  "verify_ssl": false,
  "is_active": true
}
```

Notes:

- If `token` is provided and non-empty, it is re-encrypted.
- Activating one connection deactivates all others.

### `DELETE /jira/connections/{conn_id}`

Delete a Jira connection.

Response:

- HTTP `204 No Content`

Notes:

- If the deleted connection was active, another saved connection is promoted to active automatically.

### `GET /jira/connections/{conn_id}/projects`

Return Jira projects visible to the given connection.

Response shape depends on the Jira adapter but typically includes:

```json
[
  {
    "id": "10001",
    "key": "PROJ",
    "name": "Project Name"
  }
]
```

### `GET /jira/connections/{conn_id}/xray/defaults`

Get default Xray publishing values for a story.

Query params:

- `story_issue_key` optional

Response:

```json
{
  "projects": [
    {
      "id": "10001",
      "key": "PROJ",
      "name": "Project Name"
    }
  ],
  "target_project_id": "10001",
  "target_project_key": "PROJ",
  "test_issue_type_name": "Test",
  "repository_path_field_id": null,
  "folder_path": "PROJ-123",
  "link_type": "Tests"
}
```

### `POST /jira/users/search`

Search assignable/selectable Jira users.

Request body:

```json
{
  "jira_connection_id": 12,
  "query": "sam",
  "project_key": "PROJ",
  "project_id": "10001"
}
```

Behavior:

- Returns `[]` if query length is below 2 characters.

Response:

- Adapter-specific user records suitable for assignee-style fields

### `POST /jira/connections/{conn_id}/xray/test-suite`

Publish generated test cases into Xray.

Request body:

```json
{
  "jira_connection_id": 12,
  "story_issue_key": "PROJ-123",
  "xray_project_id": "10001",
  "xray_project_key": "PROJ",
  "test_cases": [
    {
      "title": "Login works",
      "steps": ["Open login", "Enter credentials", "Submit"],
      "expected_result": "User reaches dashboard",
      "priority": "High"
    }
  ],
  "test_issue_type_id": "10010",
  "test_issue_type_name": "Test",
  "repository_path_field_id": "customfield_12345",
  "folder_path": "PROJ-123",
  "link_type": "Tests"
}
```

Response:

```json
{
  "created_tests": [
    {
      "id": "PROJ-456",
      "key": "PROJ-456",
      "self": ""
    }
  ],
  "folder_path": "PROJ-123",
  "repository_path_field_id": "customfield_12345",
  "link_type_used": "Tests",
  "warnings": []
}
```

Notes:

- Supports optional `Idempotency-Key` request header to prevent duplicate publishes.
- Validates that `conn_id` matches `jira_connection_id` in the body.
- Auto-detects test issue type if not supplied.
- Attempts to detect the repository path field if not supplied.
- Creates Jira issues first, then tries to link them back to the story.

## AI API

Base prefix: `/api/v1/ai`

### `GET /ai/usage`

Get monthly AI usage counters for the current user.

Response:

```json
{
  "count": 12,
  "limit": 50,
  "remaining": 38,
  "plan": "free"
}
```

### Shared request concepts

Many AI endpoints use the same context envelope:

- `jira_connection_id`
- `instance_url`
- `project_key`
- `project_id`
- `issue_type_id`

They may also include:

- `selected_text`
- `issue_context`
- `model`
- `user_description`
- `custom_instructions`

`issue_context` shape:

```json
{
  "issue_key": "PROJ-123",
  "summary": "Story summary",
  "description": "Story description",
  "acceptance_criteria": "Given ... When ... Then ..."
}
```

### `POST /ai/generate`

Generate a bug draft from story context and Jira metadata.

Request body:

```json
{
  "selected_text": "Optional selected text from the page",
  "issue_context": {
    "issue_key": "PROJ-123",
    "summary": "User login story",
    "description": "As a user ...",
    "acceptance_criteria": "Given valid credentials ..."
  },
  "jira_connection_id": 12,
  "instance_url": "https://example.atlassian.net/browse/PROJ-123",
  "project_key": "PROJ",
  "project_id": "10001",
  "issue_type_id": "10004",
  "model": "google/gemini-2.0-flash-001",
  "user_description": "Focus on login regressions",
  "custom_instructions": "Prefer concise steps"
}
```

Response:

```json
{
  "summary": "User cannot log in after logout",
  "description": "Users are unable to log back in after a successful first login.",
  "steps_to_reproduce": "Log in\nLog out\nLog in again",
  "expected_result": "User logs in successfully",
  "actual_result": "User remains blocked from login",
  "fields": {
    "summary": "User cannot log in after logout",
    "assignee": {
      "accountId": "abc123"
    }
  },
  "ac_coverage": 0.82
}
```

Notes:

- Rate limited to `10 requests / 60 seconds / user`.
- Increments usage counters.
- Builds Jira field schema before prompting the model.
- Applies saved AI field mapping after generation.

### `POST /ai/test-cases`

Generate a suite of test cases from story context.

Request body:

- Same shape as `/ai/generate`

Response:

```json
{
  "test_cases": [
    {
      "title": "User can log in",
      "steps": ["Open login page", "Enter credentials", "Submit"],
      "expected_result": "Dashboard is shown",
      "priority": "High"
    }
  ],
  "coverage_score": 0.88
}
```

Notes:

- Rate limited to `5 requests / 60 seconds / user`.

### `POST /ai/preview`

Validate a bug draft against Jira required fields and return the final resolved Jira payload that would be submitted.

Request body:

```json
{
  "jira_connection_id": 12,
  "instance_url": "https://example.atlassian.net/browse/PROJ-123",
  "project_key": "PROJ",
  "project_id": "10001",
  "issue_type_id": "10004",
  "bug": {
    "summary": "Login fails after logout",
    "description": "Users report inability to log in again.",
    "steps_to_reproduce": "Log in\nLog out\nTry to log in again",
    "expected_result": "User can log back in",
    "actual_result": "User cannot log back in",
    "severity": "High",
    "extra_fields": {
      "customfield_19020": {
        "id": "12345"
      }
    }
  }
}
```

Response:

```json
{
  "valid": true,
  "missing_fields": [],
  "resolved_payload": {
    "fields": {
      "summary": "Login fails after logout",
      "description": "Users report inability to log in again.",
      "project": {
        "id": "10001"
      },
      "issuetype": {
        "id": "10004"
      }
    }
  }
}
```

Notes:

- Uses Jira metadata to validate required fields.
- System-managed standard fields are handled separately and not shown as user-fillable fields.
- Explicit user-entered field values now override AI-mapped values.
- For Jira Server/DC, project payloads prefer `key`.

### `POST /ai/submit`

Create one or more Jira issues from prepared bug drafts.

Request body:

```json
{
  "jira_connection_id": 12,
  "instance_url": "https://example.atlassian.net/browse/PROJ-123",
  "project_key": "PROJ",
  "project_id": "10001",
  "issue_type_id": "10004",
  "bugs": [
    {
      "summary": "Login fails after logout",
      "description": "Users report inability to log in again.",
      "steps_to_reproduce": "Log in\nLog out\nTry to log in again",
      "expected_result": "User can log back in",
      "actual_result": "User cannot log back in",
      "severity": "High",
      "extra_fields": {
        "customfield_19020": {
          "id": "12345"
        }
      }
    }
  ]
}
```

Response:

```json
{
  "created_issues": [
    {
      "id": "PROJ-456",
      "key": "PROJ-456",
      "self": ""
    }
  ]
}
```

Failure behavior:

- If required Jira fields are still missing:

```json
{
  "detail": "Cannot submit bug. Missing required Jira fields: Testing Stage, The Environment"
}
```

- If Jira itself rejects the payload, `detail` may contain the upstream Jira error payload.

Notes:

- Supports optional `Idempotency-Key` request header to prevent duplicate Jira issue creation on retries or double-clicks.
- Rate limited to `10 requests / 60 seconds / user`.

## Stripe API

Base prefix: `/api/v1/stripe`

### `POST /stripe/webhook`

Stripe webhook receiver.

Authentication:

- Stripe signature via `stripe-signature` header

Behavior:

- Validates request body with `STRIPE_WEBHOOK_SECRET`
- Handles:
  - `checkout.session.completed`
  - `customer.subscription.deleted`

Success response:

```json
{
  "status": "success"
}
```

## Extension-to-Backend Call Map

This is the main frontend integration flow used by the Chrome extension.

### Session startup

1. `POST /api/v1/auth/bootstrap`
2. If Jira context is available: `POST /api/v1/jira/bootstrap-context`

### Jira setup and settings

1. `GET /api/v1/jira/connections`
2. `POST /api/v1/jira/connections`
3. `PATCH /api/v1/jira/connections/{id}`
4. `GET /api/v1/jira/connections/{id}/projects`
5. `POST /api/v1/settings/jira`

### Bug generation flow

1. `POST /api/v1/ai/generate`
2. `POST /api/v1/ai/preview`
3. `POST /api/v1/ai/submit`

### Test case flow

1. `POST /api/v1/ai/test-cases`
2. `GET /api/v1/jira/connections/{id}/xray/defaults`
3. `POST /api/v1/jira/connections/{id}/xray/test-suite`

### Auxiliary calls

- `GET /api/v1/ai/usage`
- `POST /api/v1/ai/quality-check` — Scores bug input quality (0-100) with missing items and hints
- `POST /api/v1/ai/analyze-context` — Lightweight pre-generation story analysis (AC count, complexity, warnings)
- `GET /api/v1/settings/ai`
- `POST /api/v1/settings/ai`
- `POST /api/v1/jira/users/search`

### Test Categories (Phase 1)

Valid test categories for `test_categories` field:

`Positive`, `Negative`, `Boundary`, `Regression`, `Permission`, `Validation`, `API`, `UI`, `Mobile`, `Accessibility`, `Performance`

Default categories (when `test_categories` is omitted): `Positive`, `Negative`, `Boundary`, `Regression`

### Duplicate Detection (Phase 2)

#### Duplicate check flow

1. `POST /api/v1/jira/duplicates/check` — Search for existing bugs matching a candidate
2. User reviews matches in the PreviewView panel
3. `POST /api/v1/jira/duplicates/link` — Link story to existing bug instead of creating

#### How duplicate detection works

The system uses deterministic text similarity (no AI calls):

1. Extracts keywords from the candidate bug summary
2. Searches Jira via JQL for bugs with similar summaries, matching error signatures, linked to the same story, and recently created
3. Scores each result using a weighted composite:
   - Title token similarity: **30%**
   - Description/body similarity: **30%**
   - Error signature match: **18%**
   - Component/label overlap: **7%**
   - API endpoint/path match: **10%**
   - Recency bonus (< 90 days): **5%**

The duplicate search uses the configured Jira issue type when available, falls back to common bug type names, then performs a recent project search so custom or localized Jira issue types do not silently hide possible matches.

#### Confidence scores

| Confidence | Score Range | User Experience |
|------------|-----------|-----------------|
| High       | ≥ 0.80    | Red warning card, strong visual emphasis |
| Medium     | ≥ 0.55    | Amber warning card |
| Low        | ≥ 0.35    | Subtle info card |

Matches below 0.35 are not shown.

#### How to override warnings

- Duplicate warnings are **advisory only** — they never block publishing
- Click **"Publish to Jira"** to create the bug regardless
- Click **"Link Instead"** to link your story to the existing bug
- Click **"Open in Jira"** to review the potential duplicate first

#### Limitations

- Text similarity only (no semantic/embedding analysis)
- Requires the candidate and existing bugs to share visible keywords
- Only searches within the same Jira project
- Maximum 10 matches returned per check
- If Jira search fails, the check is marked as failed but publishing proceeds normally

## Data Contracts Summary

### `BugDraft`

```json
{
  "summary": "string",
  "description": "string",
  "steps_to_reproduce": "string",
  "expected_result": "string",
  "actual_result": "string",
  "severity": "optional string — Critical | High | Medium | Low",
  "priority": "optional string — Highest | High | Medium | Low | Lowest",
  "confidence": "optional int — 0-100",
  "category": "optional string — e.g. Functional Gap, Validation, Edge Case",
  "environment": "optional string — e.g. Chrome / macOS / Production",
  "root_cause": "optional string — probable root cause hypothesis",
  "acceptance_criteria_refs": ["AC1", "Checkout flow"],
  "evidence": ["Story requires X"],
  "suggested_evidence": ["Screenshot of error", "Network log"],
  "labels": ["regression", "checkout"],
  "review_required": false,
  "extra_fields": {
    "customfield_12345": "any Jira-shaped value"
  }
}
```

### `JiraFieldResponse`

```json
{
  "key": "customfield_12345",
  "name": "Field Name",
  "type": "string | option | user | multi-user | multi-select | labels | priority | ...",
  "required": true,
  "system": "optional Jira system name",
  "allowed_values": [
    {
      "id": "10001",
      "value": "Option A"
    }
  ]
}
```

### `TestCase`

```json
{
  "title": "string",
  "objective": "optional string — what this test validates",
  "steps": ["step 1", "step 2"],
  "expected_result": "string",
  "priority": "string",
  "test_type": "optional string — Positive, Negative, etc.",
  "preconditions": "optional string",
  "test_data": "optional string — specific data needed for the test",
  "review_notes": "optional string — assumptions or concerns",
  "acceptance_criteria_refs": ["AC1"],
  "labels": ["checkout"],
  "components": ["Payments"]
}
```

## Operational Notes

- CORS is currently open to all origins for extension development.
- Redis is used for Jira field metadata caching.
- Redis is also used for best-effort rate limiting and idempotency caching.
- Field schema cache keys are versioned in the metadata engine.
- Jira Server/DC authentication uses a Bearer-first, Basic-on-401 fallback strategy.
- The API is source-of-truth compatible with the extension contract centralization in `extension/src/sidepanel/services/contracts.ts`.

## Recommended Next Step

If you want this to be fully self-maintaining, the next improvement is to add:

- per-endpoint example payloads directly to FastAPI route metadata
- schema descriptions on Pydantic models
- a link from `README.md` to this document
