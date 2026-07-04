# BugMind AI — Roadmap

> Status: **Advanced Beta / Pre-Production Hardening**

The next phase is hardening the existing features, not adding random new capabilities. The focus is reliability, testability, documentation, security, and release gates before wider rollout.

For the full requirements backlog, see [Missing Parts Requirements](./MISSING_REQUIREMENTS.md).

---

## Current Sprint (Completed Hardening)

| # | Task | Status |
|---|---|---|
| 1 | Run backend `pytest` in CI | ✅ Done |
| 2 | Fix background worker DB session handling | ✅ Done |
| 3 | Update README and fix broken local path | ✅ Done |
| 4 | Add frontend PII redaction (`piiRedaction.ts`) | ✅ Done |
| 5 | Reorganise docs by audience | ✅ Done |

---

## Phase 1 (P0 — Production Gate)

| # | Task | Requirement |
|---|---|---|
| 1 | Add AI prompt/version audit metadata | RQ-AI-BUG-001 |
| 2 | Add Jira Cloud/Server contract tests | RQ-JIRA-001 |
| 3 | Add Xray publish contract tests | RQ-XRAY-002 |
| 4 | Harden Xray Cloud folder behavior | RQ-XRAY-001 |
| 5 | Replace in-process background tasks with persistent queue | RQ-BULK-001 |
| 6 | Enforce full workspace permission matrix | RQ-WORKSPACE-001 |
| 7 | Enforce subscription limits | RQ-BILL-001 |
| 8 | Enforce domain allowlist in extension | RQ-SEC-001 |
| 9 | Add Playwright E2E smoke tests for the extension | RQ-QA-001 |
| 10 | Enforce release readiness checklist | RQ-QA-003 |
| 11 | Add production Redis requirement | RQ-INFRA-001 |

---

## Phase 2 (P1 — Wider Beta / Paid Users)

| # | Task | Requirement |
|---|---|---|
| 1 | Add bug quality scoring before Jira publish | RQ-AI-BUG-002 |
| 2 | Add test case quality score | RQ-AI-TEST-002 |
| 3 | Add category-specific QA generation rules | RQ-AI-TEST-001 |
| 4 | Add test case update/reuse logic | RQ-AI-TEST-003 |
| 5 | Add duplicate explanation and link-to-existing workflows | RQ-DUP-001 / RQ-DUP-002 |
| 6 | Add PO/BA clarification checklist | RQ-GAP-001 |
| 7 | Add acceptance criteria coverage traceability | RQ-GAP-002 |
| 8 | Add Xray publish dry-run report | RQ-XRAY-003 |
| 9 | Add bulk job resume support and dry-run history | RQ-BULK-002 / RQ-BULK-003 |
| 10 | Add BRD OCR and clause-to-story traceability | RQ-BRD-001 / RQ-BRD-002 |
| 11 | Add full Jira field mapping editor and richer active issue context | RQ-JIRA-002 / RQ-JIRA-003 |
| 12 | Add capability profile refresh and admin diagnostic report | RQ-CAP-001 / RQ-CAP-002 |
| 13 | Add template validation rules | RQ-WORKSPACE-002 |
| 14 | Add workspace usage dashboard | RQ-BILL-002 |
| 15 | Add CI coverage reporting | RQ-QA-002 |

---

## Phase 3 (P2-P3 — Enterprise Readiness)

| # | Task | Requirement |
|---|---|---|
| 1 | Add approval workflow before publish | RQ-WORKSPACE-003 |
| 2 | Add secret rotation flows | RQ-SEC-004 |
| 3 | Add CSV/JSON audit log export | RQ-REPORT-001 |
| 4 | Add QA report package export | RQ-REPORT-002 |
| 5 | Add enterprise SSO/SAML | RQ-SEC-002 |
| 6 | Add IP allowlisting | RQ-SEC-003 |
| 7 | Add multi-region deployment support | RQ-INFRA-002 |
