# BugMind AI — Missing Parts Requirements

Status: Advanced Beta / Pre-Production Hardening

The next phase is focused on reliability, testability, documentation, security, and production gates. This backlog intentionally prioritizes making publishing safe, making bulk jobs reliable, making Jira/Xray integrations contract-tested, making RBAC enforceable, making billing real, and making audit logs enterprise-grade.

## Priority Legend

| Priority | Meaning |
|---|---|
| P0 | Must-have before production release |
| P1 | Needed before wider beta / paid users |
| P2 | Needed for scale and enterprise readiness |
| P3 | Advanced / enterprise / long-term |

## Requirement Index

| ID | Priority | Area | Requirement |
|---|---:|---|---|
| RQ-AI-BUG-001 | P0 | AI Bug Generation, Audit Logs | Add AI prompt/version audit metadata |
| RQ-XRAY-001 | P0 | Xray Cloud Publishing | Harden Xray Cloud folder behavior |
| RQ-XRAY-002 | P0 | Xray Cloud, Xray Server/DC | Add Xray publish contract tests |
| RQ-BULK-001 | P0 | Bulk Epic Workflows, Background Jobs | Replace in-process background tasks with persistent queue |
| RQ-JIRA-001 | P0 | Jira Integration | Add Jira Cloud/Server contract tests |
| RQ-WORKSPACE-001 | P0 | Workspace / RBAC | Enforce full workspace permission matrix |
| RQ-SEC-001 | P0 | Security, Chrome Extension | Enforce domain allowlist in extension |
| RQ-BILL-001 | P0 | SaaS Billing | Enforce subscription limits |
| RQ-QA-001 | P0 | QA Automation | Add Playwright E2E tests for Chrome extension |
| RQ-QA-003 | P0 | Release Management | Enforce release readiness checklist |
| RQ-INFRA-001 | P0 | Infrastructure | Add production Redis requirement |
| RQ-AI-BUG-002 | P1 | AI Bug Generation | Add bug quality scoring before Jira publish |
| RQ-AI-BUG-003 | P1 | Manual Bug Generation | Add richer manual evidence support |
| RQ-AI-TEST-001 | P1 | Test Case Generation | Add category-specific QA generation rules |
| RQ-AI-TEST-002 | P1 | Test Case Generation | Add test case quality score |
| RQ-AI-TEST-003 | P1 | Xray Sync, Test Case Generation | Add test case update/reuse logic |
| RQ-GAP-001 | P1 | AI Gap Analysis | Add PO/BA clarification checklist |
| RQ-GAP-002 | P1 | Gap Analysis, Test Coverage | Add acceptance criteria coverage traceability |
| RQ-DUP-001 | P1 | Duplicate Detection | Add duplicate explanation and confidence breakdown |
| RQ-DUP-002 | P1 | Duplicate Detection, Jira Publishing | Add link-to-existing workflow |
| RQ-XRAY-003 | P1 | Xray Publishing, Readiness | Add Xray publish dry-run report |
| RQ-BULK-002 | P1 | Bulk Epic Workflows | Add bulk job resume support |
| RQ-BULK-003 | P1 | Bulk Epic Workflows, Reporting | Add bulk dry-run history and reporting |
| RQ-BRD-001 | P1 | BRD Comparison | Add OCR support for scanned PDFs |
| RQ-BRD-002 | P1 | BRD Coverage Analysis | Add BRD clause-to-story traceability |
| RQ-JIRA-002 | P1 | Jira Field Mapping | Add full visual Jira field mapping editor |
| RQ-JIRA-003 | P1 | Jira Context Detection | Add richer active issue context extraction |
| RQ-CAP-001 | P1 | Jira Capability Profile | Add direct capability profile refresh without reconnect |
| RQ-CAP-002 | P1 | Admin Diagnostics | Add full admin diagnostic report |
| RQ-WORKSPACE-002 | P1 | Workspace Templates | Add template validation rules |
| RQ-BILL-002 | P1 | Usage Tracking | Add workspace usage dashboard |
| RQ-QA-002 | P1 | CI/CD | Add CI coverage reporting |
| RQ-WORKSPACE-003 | P2 | Enterprise Governance | Add approval workflow before publish |
| RQ-SEC-004 | P2 | Security / Credential Management | Add secret rotation flows |
| RQ-REPORT-001 | P2 | Audit Logs, Compliance | Add CSV/JSON audit log export |
| RQ-REPORT-002 | P2 | Reporting | Add QA report package export |
| RQ-SEC-002 | P3 | Enterprise Auth | Add enterprise SSO/SAML |
| RQ-SEC-003 | P3 | Enterprise Security | Add IP allowlisting |
| RQ-INFRA-002 | P3 | Enterprise Infrastructure | Add multi-region deployment support |

## P0 Production Gate

### RQ-AI-BUG-001 — Add AI prompt/version audit metadata

The system shall store AI generation metadata for every generated bug report without storing raw sensitive input.

Required metadata:
- Prompt template ID and version.
- AI model name and provider name.
- Input hash and output hash.
- Redaction applied flag and redaction rules version.
- Jira issue key, user ID, workspace ID, generation timestamp.
- Generation source: Jira story, manual bug, gap analysis, or bulk job.
- Failure reason for failed attempts.

Definition of Done:
- Backend database migration added.
- Audit log schema and UI updated.
- Existing generation endpoints write metadata.
- Unit tests cover success, failure, and repeated-input hash comparison.

### RQ-XRAY-001 — Harden Xray Cloud folder behavior

The system shall handle Xray Cloud folder operations safely across project permission setups.

Definition of Done:
- Contract tests cover folder allowed, denied, and not found.
- Folder permission errors produce clear recovery messages.
- Test creation falls back without blocking when folder behavior is unsupported.
- No duplicate tests are created during retry.
- Publish result stores folder warnings.

### RQ-XRAY-002 — Add Xray publish contract tests

The system shall include contract tests for all supported Xray publishing modes.

Required scenarios:
- Xray Cloud valid publish, permission denied, and folder not found.
- Xray Server/DC valid publish, manual steps, and repository folder.
- Native steps supported.
- Native steps failed to manual steps fallback.
- Manual steps failed to description fallback.
- Missing required Jira field.
- Invalid test issue type.

Definition of Done:
- Cloud and Server/DC fixtures added.
- Mock API responses added.
- Payload shape is validated before API call.
- Contract tests run in CI and block merge on failure.

### RQ-BULK-001 — Replace in-process background tasks with persistent queue

Bulk generation, Epic audit, and BRD comparison shall run through a persistent background job queue such as Redis Queue, Arq, Celery, or RQ.

Definition of Done:
- Queue worker implemented.
- Job state persists across API process restarts.
- Retry, cancel, and resume behavior is implemented.
- Jobs are isolated per workspace.
- Queue-unavailable degraded mode is explicit.
- Tests cover restart, failure, retry, and cancel.

### RQ-JIRA-001 — Add Jira Cloud/Server contract tests

The system shall include contract tests for Jira Cloud and Jira Server/DC issue creation and metadata discovery.

Required scenarios:
- Valid issue creation.
- Missing required field.
- Expired token.
- Permission denied.
- Rate limit.
- Invalid issue type.
- Custom field mapping.
- Field default fallback.
- User-level override.
- Workspace-level default.
- Built-in default fallback.

Definition of Done:
- Cloud and Server/DC fixtures added.
- Mock Jira responses added.
- Payload validation happens before Jira API call.
- Contract tests run in CI.

### RQ-WORKSPACE-001 — Enforce full workspace permission matrix

The system shall enforce permissions consistently across all workspace actions.

Roles:
- Owner.
- Admin.
- QA Lead.
- QA Engineer.
- Viewer.

Permission areas:
- Workspace lifecycle, member management, role changes.
- Shared Jira/Xray connection management.
- Template create/edit/delete and default assignment.
- AI generation, Jira publish, Xray publish.
- Audit log viewing, report export, billing management.

Definition of Done:
- Permission matrix documented.
- Backend authorization added to all relevant endpoints.
- Frontend gates added.
- Tests cover each role/action pair.

### RQ-SEC-001 — Enforce domain allowlist in extension

The extension shall block Jira context extraction unless the active domain is trusted.

Definition of Done:
- Domain allowlist implemented.
- Workspace/admin settings added.
- Non-allowlisted pages do not get DOM scraping.
- Security event is logged on mismatch.
- Tests added.

### RQ-BILL-001 — Enforce subscription limits

The system shall enforce plan limits before AI generation, Jira publishing, Xray publishing, and bulk jobs.

Plan limits should include:
- Monthly AI generations and generated test cases.
- Monthly Jira and Xray publishes.
- Bulk jobs per month and max stories per bulk job.
- Max workspaces, users, and connected Jira instances.

Definition of Done:
- Plan model finalized.
- Enforcement middleware added.
- Frontend usage UI added.
- Stripe webhook behavior tested.

### RQ-QA-001 — Add Playwright E2E tests for Chrome extension

The project shall include Playwright E2E tests for the full Chrome extension workflow.

Required flows:
- Load extension on Jira Cloud issue page.
- Detect Jira context automatically.
- Generate, review, edit, and publish a bug with saved field mapping.
- Verify idempotency on second publish.
- Generate test cases and publish to Xray.
- Handle missing required field and permission denied.

Definition of Done:
- Playwright configured.
- Extension test harness created.
- E2E tests run in CI and block release on failure.
- Manual smoke checklist remains documented.

### RQ-QA-003 — Enforce release readiness checklist

A release shall not be approved unless all release checklist items pass.

Required checks:
- Backend tests, extension build, lint, Python compile, Alembic migrations.
- Production secrets, CORS, allowed hosts, Redis/rate limiting.
- PII redaction tests, hardcoded credential scan, health endpoints.
- Jira Cloud context detection, real bug generation flow, audit log writes.

Definition of Done:
- Checklist automated where possible.
- Manual checks documented.
- CI/CD gate added.
- Release owner signoff recorded.

### RQ-INFRA-001 — Add production Redis requirement

Production deployment shall use Redis for rate limiting, idempotency replay, metadata caching, and background queues.

Definition of Done:
- Redis config documented.
- Redis health check added.
- Production startup warns or fails based on configuration.
- Tests cover missing Redis and degraded behavior.

## P1 Wider Beta / Paid Users

### RQ-AI-BUG-002 — Add bug quality scoring before Jira publish

Score each generated bug before Jira submission using checks for clarity, impact, reproduction steps, expected/actual result, severity/priority justification, environment, evidence, and AC references.

Definition of Done:
- Quality score appears on every bug card.
- Configurable minimum publish threshold exists.
- Low-score publish requires confirmation.
- Backend validation mirrors frontend validation.
- Tests cover low, medium, and high-quality examples.

### RQ-AI-BUG-003 — Add richer manual evidence support

Manual bug generation shall support screenshots, videos, HAR files, mobile crash logs, Appium logs, browser console logs, network logs, device information, and OS/browser/app version metadata.

Definition of Done:
- File validation and configurable size limits added.
- Unsupported files show clear errors.
- Evidence extraction is safe and redacts sensitive tokens.
- Storage/security policy documented.

### RQ-AI-TEST-001 — Add category-specific QA generation rules

Selected test categories shall produce category-specific output.

Category requirements:
- Positive: main successful path.
- Negative: invalid actions, invalid data, blocked states.
- Boundary: min/max values, empty values, limit edges.
- Regression: existing behavior and backward compatibility.
- Permission: roles, unauthorized access, restricted actions.
- Validation: mandatory fields and invalid formats.
- API: endpoint, method, request, response, status code.
- UI: visible elements, layout behavior, user actions.
- Mobile: device, OS, orientation, network, app state.
- Accessibility: keyboard, screen reader, labels, contrast.
- Performance: response-time and load expectations.

Definition of Done:
- Prompt templates updated.
- Test case schema supports category-specific fields.
- UI shows category badges.
- Tests verify each category produces distinct output.

### RQ-AI-TEST-002 — Add test case quality score

Calculate a quality score for each generated test case using objective clarity, preconditions, actionable steps, expected result specificity, AC coverage, test data clarity, risk, priority, duplicate steps, and vague wording.

Definition of Done:
- Quality score displayed per test.
- Coverage matrix consumes test score.
- Backend validation available before Xray publish.
- Unit tests added.

### RQ-AI-TEST-003 — Add test case update/reuse logic

Detect existing linked tests and allow users to update, reuse, or create new tests.

Definition of Done:
- Existing linked tests loaded.
- Matching algorithm implemented.
- Update/create selection UI added.
- Xray/Jira update API covered by tests.

### RQ-GAP-001 — Add PO/BA clarification checklist

Gap analysis shall produce structured clarification questions when requirements are incomplete.

Checklist categories:
- Missing business rule, validation rule, error handling.
- Missing role/permission, API, UI, mobile behavior.
- Missing edge case, dependency, out-of-scope clarification.
- Missing acceptance criteria or non-functional requirement.

Definition of Done:
- Gap analysis output schema updated.
- UI section added.
- Export/copy support added.
- Tests cover weak, medium, and strong stories.

### RQ-GAP-002 — Add acceptance criteria coverage traceability

Map every generated bug and test case to one or more acceptance criteria.

Definition of Done:
- AC parser improved.
- Coverage matrix updated.
- Bug/test cards show AC references.
- Export includes coverage status.

### RQ-DUP-001 — Add duplicate explanation and confidence breakdown

Duplicate detection shall explain why an issue is considered a duplicate.

Breakdown factors:
- Summary, description, and steps similarity.
- Same acceptance criteria, component/module, error message, linked story, or labels.

Definition of Done:
- Duplicate response schema updated.
- UI explanation added.
- Tests cover threshold boundaries.
- Hash collision test added.

### RQ-DUP-002 — Add link-to-existing workflow

Users shall be able to link a generated bug/test to an existing Jira issue instead of creating a duplicate.

Definition of Done:
- Link API implemented.
- Permission handling added.
- UI added.
- Tests cover success, permission denied, and invalid issue key.

### RQ-XRAY-003 — Add Xray publish dry-run report

Generate a dry-run report before publishing test cases to Xray.

Report includes:
- Target project, test issue type, folder path, and link type.
- Required fields, missing fields, and defaults used.
- Native steps support status and fallback strategy.
- Estimated created/updated tests.
- Blocking issues and warnings.

Definition of Done:
- Dry-run report generated from current session.
- Export JSON works.
- UI shows blockers/warnings clearly.
- Backend validation mirrors frontend result.

### RQ-BULK-002 — Add bulk job resume support

Users shall be able to resume failed or interrupted bulk jobs without duplicating already completed work.

Definition of Done:
- Per-story job status stored.
- Resume API added.
- UI resume button added.
- Tests cover partial success and retry.

### RQ-BULK-003 — Add bulk dry-run history and reporting

Store and display dry-run history for bulk operations.

Definition of Done:
- Bulk dry-run history model added.
- Job dashboard UI added.
- JSON and CSV export added.
- Tests added.

### RQ-BRD-001 — Add OCR support for scanned PDFs

Extract text from scanned/image-based PDF BRDs using OCR.

Definition of Done:
- OCR service integrated.
- OCR confidence score stored.
- File-size/page-count limits configured.
- Tests cover text PDF, scanned PDF, and corrupted PDF.
- Redaction runs before AI processing.

### RQ-BRD-002 — Add BRD clause-to-story traceability

Map BRD clauses to Jira stories, generated tests, and missing coverage.

Definition of Done:
- BRD parser improved.
- Traceability matrix added.
- Export added.
- Tests added with sample BRD.

### RQ-JIRA-002 — Add full visual Jira field mapping editor

Provide a visual editor for mapping BugMind fields to Jira custom fields.

Editor must support core Jira fields, user fields, severity/environment/custom result fields, acceptance criteria, test type, manual steps, sprint, and any required custom field.

Definition of Done:
- Visual editor implemented.
- Mapping validation added.
- Save/load per connection/project/issue type.
- Tests added.

### RQ-JIRA-003 — Add richer active issue context extraction

Extract richer Jira context from the active issue.

Required extracted data:
- Summary, description, acceptance criteria, status, priority.
- Labels, components, fix versions, linked tests, linked issues.
- Comments, attachments metadata, subtasks.
- Assignee, reporter, sprint, Epic link.
- Environment/custom fields.

Definition of Done:
- Context schema updated.
- Privacy controls respected.
- UI preview updated.
- Tests added.

### RQ-CAP-001 — Add direct capability profile refresh without reconnect

Users shall be able to refresh the capability profile without re-entering credentials.

Definition of Done:
- Refresh endpoint implemented.
- UI button added.
- Expired-token reconnect handling added.
- Previous profile remains available on failed discovery.
- Tests added.

### RQ-CAP-002 — Add full admin diagnostic report

Generate a full admin diagnostic report for Jira/Xray setup.

Report includes:
- Connection health, deployment type, API version, permissions.
- Projects, selected project, issue types, required fields, missing defaults.
- Xray mode, native steps support, folder support, link types.
- Sync strategy, readiness blockers, recommended admin actions.

Definition of Done:
- Report generator added.
- Export JSON added.
- Sensitive tokens excluded.
- Tests added.

### RQ-WORKSPACE-002 — Add template validation rules

Validate workspace templates before saving or applying them.

Validation rules:
- Required fields exist.
- Unsupported variables are rejected.
- Template type matches workflow.
- Project/issue type compatibility checked.
- Default assignment rules are valid.
- AI prompt instructions do not conflict with safety/redaction policy.

Definition of Done:
- Backend and frontend validation added.
- Audit log records template changes.
- Tests and documentation added.

### RQ-BILL-002 — Add workspace usage dashboard

Workspace admins shall see usage by user, project, and workflow.

Metrics include:
- AI bug generations, AI test generations, gap analysis runs.
- Bulk jobs, Xray publishes, Jira publishes.
- Failed generations, average generation time, estimated AI cost.
- Most active projects and users.

Definition of Done:
- Usage aggregation added.
- Dashboard UI added.
- CSV export added.
- Tests added.

### RQ-QA-002 — Add CI coverage reporting

CI shall generate backend and frontend coverage reports.

Definition of Done:
- Backend coverage generated using pytest coverage.
- Frontend coverage generated for unit/component tests.
- Coverage report uploaded as GitHub Actions artifact.
- Minimum threshold configured and documented.

## P2 Enterprise Readiness

### RQ-WORKSPACE-003 — Add approval workflow before publish

Support approval workflows before publishing generated bugs/tests to Jira/Xray.

Definition of Done:
- Approval model added.
- Review queue UI added.
- Publish permissions updated.
- Approvals, rejections, and owner bypasses audited.
- Tests added.

### RQ-SEC-004 — Add secret rotation flows

Support safe rotation of Jira, Xray, OpenRouter, encryption, and webhook secrets.

Definition of Done:
- Rotation UI and backend endpoints added.
- Health recheck after rotation.
- Failed rotation keeps old secret active until confirmed.
- Audit logs record rotation without exposing secrets.
- Tests added.

### RQ-REPORT-001 — Add CSV/JSON audit log export

Authorized users shall be able to export audit logs.

Definition of Done:
- Export endpoint added.
- Date range filtering added.
- Permission checks added.
- Secrets/tokens excluded.
- Export action is audited.
- Tests added.

### RQ-REPORT-002 — Add QA report package export

Export full QA report packages for stories and Epics.

Package contents:
- Story details, generated bugs, generated tests, coverage matrix.
- Gap analysis, BRD comparison, dry-run report.
- Xray/Jira publish results, warnings/blockers, audit metadata.

Formats:
- PDF, DOCX, JSON, CSV, ZIP package.

Definition of Done:
- Report generator and export UI added.
- Permissions added.
- Prompt/model metadata included for AI content.
- Tests added.

## P3 Long-Term Enterprise

### RQ-SEC-002 — Add enterprise SSO/SAML

Support enterprise SSO/SAML authentication with IdP access revocation, role/group mapping, and workspace policy to disable password login.

Definition of Done:
- SAML provider integration added.
- Workspace SSO settings added.
- Group/role mapping added.
- Tests added.

### RQ-SEC-003 — Add IP allowlisting

Allow enterprise admins to restrict access by IP range.

Definition of Done:
- Middleware added.
- Admin UI added.
- Blocked requests audited.
- Tests added.

### RQ-INFRA-002 — Add multi-region deployment support

Support multi-region deployment for enterprise data residency requirements.

Definition of Done:
- Region-aware workspace model added.
- Deployment docs added.
- Data residency policy documented.
- Tests added.

## Recommended Implementation Order

### Phase 1 — Production Gate / P0

1. Prompt/version audit metadata.
2. Jira/Xray contract tests.
3. Xray Cloud hardening.
4. Persistent job queue.
5. RBAC enforcement.
6. Billing enforcement.
7. Domain allowlist enforcement.
8. Playwright E2E smoke tests.
9. Release readiness automation.

### Phase 2 — Wider Beta / P1

1. Bug quality scoring.
2. Test quality scoring.
3. PO/BA clarification checklist.
4. Full Jira mapping editor.
5. Richer active issue context extraction.
6. BRD OCR.
7. Bulk resume support.
8. Workspace usage dashboard.
9. Template validation.

### Phase 3 — Enterprise / P2-P3

1. Approval workflows.
2. Audit log export.
3. Secret rotation.
4. SSO/SAML.
5. IP allowlisting.
6. Multi-region deployment.
7. Full QA report package export.
