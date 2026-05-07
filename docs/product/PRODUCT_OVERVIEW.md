# BugMind AI — Product Overview

> **AI-Powered Jira & Xray QA Orchestration Platform**

BugMind AI automates the full QA lifecycle directly from your Jira and Xray workflows. It combines a Chrome side panel extension with a FastAPI backend and OpenRouter AI models to generate, review, sync, audit, and manage test and bug intelligence at scale.

---

## What BugMind Does

| Layer | What it solves |
|---|---|
| **Bug Generation** | Instantly generate structured QA bug reports from Jira User Stories |
| **Test Case Generation** | Produce categorised test cases (Positive, Negative, Boundary, Regression) |
| **Xray Publishing** | Push test cases to Xray Cloud or Xray Server/DC without leaving the browser |
| **Bulk Epic Processing** | Process every story in an Epic through AI in a managed background job |
| **BRD Coverage Analysis** | Compare Business Requirements Documents against story coverage |
| **Duplicate Detection** | Deterministic pre-publish duplicate check |
| **Workspace Collaboration** | Team workspaces, shared connections, role-based access, templates |
| **Audit Trails** | Full audit logging of AI actions, publishing events, and workspace changes |

---

## Target Users

| Persona | Primary use |
|---|---|
| QA Engineer | Generate bug reports and test cases from Jira stories |
| QA Lead | Bulk Epic test generation, coverage review, Xray sync |
| Engineering Manager | Workspace management, audit log reviews, coverage dashboards |
| Enterprise Team | Shared Jira/Xray connections, workspace templates, role controls |

---

## Supported Integrations

| Platform | Support level |
|---|---|
| Jira Cloud | Full |
| Jira Server / Data Center | Full |
| Xray Server / Data Center | Full (Raven API) |
| Xray Cloud | Beta (API permissions and folder behaviour may vary) |
| OpenRouter (AI) | Full — configurable model, custom API key support |
| Stripe (billing) | Partial — hooks exist, enforcement in hardening |

---

## Key Design Decisions

1. **Two-stage PII redaction**: Extension strips PII locally before sending to backend; backend runs a second AI sanitization pass. No raw PII ever reaches an external AI service.
2. **Deterministic duplicate detection**: Duplicate checking is entirely rule-based (no AI call), making it fast, reproducible, and audit-friendly.
3. **Request-scoped vs background sessions**: Background jobs use their own database sessions independent from the HTTP request scope, preventing session closure errors on long bulk jobs.
4. **Manifest V3**: The Chrome extension uses MV3 for future-proofing and better security sandboxing.
5. **Idempotent publishing**: Bug and test case publishing is idempotent — re-submitting the same Jira issue won't create duplicate tickets.

---

## Related Docs

- [CURRENT_CAPABILITIES.md](../CURRENT_CAPABILITIES.md) — What is currently implemented and known limitations
- [ROADMAP.md](ROADMAP.md) — Planned enhancements
- [../architecture/BACKEND_ARCHITECTURE.md](../architecture/BACKEND_ARCHITECTURE.md) — Technical backend overview
- [../architecture/EXTENSION_ARCHITECTURE.md](../architecture/EXTENSION_ARCHITECTURE.md) — Extension design
- [../qa/TEST_STRATEGY.md](../qa/TEST_STRATEGY.md) — Testing approach and release matrix
