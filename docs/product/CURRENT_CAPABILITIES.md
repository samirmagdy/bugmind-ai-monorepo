# BugMind Current Capabilities

Last reviewed: 2026-05-05

## Supported

- Jira context detection from the active issue page.
- Jira Cloud and Jira Server/Data Center connections.
- Bug generation with server-side prompt redaction and output validation.
- Test case generation with selectable categories.
- Jira bug publishing with saved field mappings and idempotency support.
- Xray Server/Data Center test publishing, manual steps, issue links, and repository folders.
- Xray Cloud authentication and test publishing through the separated Cloud client.
- Bulk Epic screen for child-story fetch, story risk scoring, bulk test generation, cross-story audit, and BRD comparison.
- BRD extraction from Jira attachments for text, DOCX, and text-based PDF files.
- Duplicate bug detection before publishing.
- Workspace membership, roles, shared connection discovery, and workspace switching.
- Background job dashboard for Epic test generation, Epic audit, and BRD coverage comparison.
- Workspace template create/update/delete APIs and sidepanel management.
- Workspace usage and audit-log views.
- Shared Jira/Xray connection management at workspace level.

## Known Limitations

- Enterprise controls such as SSO, IP allowlisting, billing, approval workflows, audit export, and secret rotation are not complete.
- Xray Cloud folder operations depend on the configured Xray Cloud API credentials and project permissions.
- PDF BRD extraction supports text-based PDFs only; scanned PDFs require OCR before upload.

## Operational Checks

- Backend API health: `GET /health`
- Database health: `GET /health/db`
- AI configuration health: `GET /health/ai`
- Jira connection health: use the Jira connection setup/test flow in the extension.
