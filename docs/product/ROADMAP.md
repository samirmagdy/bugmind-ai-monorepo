# BugMind AI — Roadmap

> Status: **Advanced Beta / Pre-Production Hardening**

The next phase is hardening the existing features — not adding more. The focus is reliability, testability, documentation, and security before wider rollout.

---

## Current Sprint (P0 — Hardening)

| # | Task | Status |
|---|---|---|
| 1 | Run backend `pytest` in CI | ✅ Done |
| 2 | Fix background worker DB session handling | ✅ Done |
| 3 | Update README and fix broken local path | ✅ Done |
| 4 | Add frontend PII redaction (`piiRedaction.ts`) | ✅ Done |
| 5 | Reorganise docs by audience | ✅ Done |

---

## Near-Term (P1 — Quality & Safety)

| # | Task | Notes |
|---|---|---|
| 1 | Add prompt version metadata to audit logs | `prompt_template_id`, `model`, `input_hash`, `redaction_applied` |
| 2 | Add Jira/Xray contract tests | Payloads for Cloud, Server/DC, Xray Cloud, Raven API |
| 3 | Add domain allowlist enforcement in extension | Block extraction if domain not trusted; log mismatches |
| 4 | Add coverage reporting to CI (`pytest --cov`) | Upload to Codecov or GitHub Actions artifacts |
| 5 | Formal permission matrix for workspace roles | Owner / Admin / Member / Viewer |

---

## Medium-Term (P2 — Observability & Scale)

| # | Task | Notes |
|---|---|---|
| 1 | Add Playwright extension E2E smoke tests | Story → Generate → Publish flow |
| 2 | Persistent job queue (Redis/RQ or Arq) | Replace FastAPI BackgroundTasks for bulk jobs |
| 3 | Xray Cloud folder behaviour hardening | Depends on Xray Cloud API permissions |
| 4 | BRD scanned PDF support (OCR) | Currently text-only PDFs |
| 5 | Stripe billing enforcement review | Hooks exist; need enforcement audit |

---

## Longer-Term (P3 — Enterprise)

| # | Task | Notes |
|---|---|---|
| 1 | SSO / SAML integration | Enterprise auth requirement |
| 2 | IP allowlisting | Enterprise security requirement |
| 3 | Audit log export (CSV / JSON) | Compliance requirement |
| 4 | Secret rotation flows | Periodic token/key rotation |
| 5 | Approval workflows for publishing | Governance requirement |
| 6 | Multi-region deployment | Data residency requirements |
