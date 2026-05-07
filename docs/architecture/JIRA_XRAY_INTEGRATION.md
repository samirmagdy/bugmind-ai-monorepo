# BugMind AI — Jira & Xray Integration

## Jira Connection Model

BugMind supports both Jira Cloud and Jira Server/Data Center through a unified connection abstraction.

### Connection Types

| Type | Authentication | Base URL pattern |
|---|---|---|
| Jira Cloud | API token + email | `https://<instance>.atlassian.net` |
| Jira Server/DC | Personal access token or Basic auth | `https://<your-jira-domain>` |

### Connection Storage

- Connections are stored encrypted in PostgreSQL (`JiraConnection` model).
- Credentials (API tokens) are AES-GCM encrypted at rest via the `ENCRYPTION_KEY` environment variable.
- Workspace-level connections can be shared across workspace members (owner/admin permission required).

---

## Jira API Adapter

`connection_service.py` returns an adapter configured for the connection type. The adapter abstracts:

- Issue fetch (single + bulk)
- Field metadata discovery
- Issue creation
- Attachment fetch (for BRD extraction)

Field mapping is user-configured per connection, with a priority resolution order:
1. User-level override
2. Workspace-level default
3. BugMind built-in default

---

## Xray Integration

### Xray Server / Data Center (Raven API)

- Endpoint: `/rest/raven/1.0/api/`
- Auth: Shares the Jira Server/DC connection credentials
- Features: Test creation, manual steps, issue links, repository folder assignment

### Xray Cloud

- Endpoint: `https://xray.cloud.getxray.app/api/v2/`
- Auth: Client ID + Client secret (separate `XrayCloudCredential` model)
- Features: Test creation, test plan linking
- Limitations: Folder operations depend on configured project permissions; some API behaviours differ from Server/DC

---

## Field Mapping

Field mappings define how BugMind-generated fields map to Jira custom fields:

| BugMind field | Jira target |
|---|---|
| Summary | `summary` |
| Description | `description` |
| Issue Type | `issuetype` |
| Priority | `priority` |
| Labels | `labels` |
| Custom fields | Configured per mapping |

Missing required fields fall back to configured defaults. If a required field has no mapping and no default, the publish operation returns a validation error before calling Jira.

---

## Idempotency

Jira publishing is idempotent. Each publish request carries a deterministic key based on:
- Source Jira issue key
- Generated content hash

Re-submitting the same story will not create duplicate tickets if the idempotency key already exists in the backend's idempotency store.

---

## BRD Extraction

BRD text is extracted from Jira issue attachments:

| Format | Support |
|---|---|
| Plain text (`.txt`) | ✅ Full |
| DOCX (`.docx`) | ✅ Full |
| Text-based PDF | ✅ Full (via `pypdf`) |
| Scanned PDF | ❌ Not supported — requires OCR pre-processing |

Extracted text is then compared against Epic child stories via the BRD Coverage AI workflow.

---

## Sync History

`JiraSyncHistory` records each publish event with:
- Source issue key
- Target Jira issue key (if created)
- Timestamp
- Status (success / failure)
- Error detail (on failure)

This enables idempotency replay and audit trail reconstruction.
