# BugMind Extension Production QA Checklist

Use this checklist before each beta or production extension release. Mark each item `Passed`, `Failed`, or `Needs Attention`.

## Automated Gates

| Status | Check | Command / Evidence |
| --- | --- | --- |
| Passed | Extension lint has zero warnings | `cd extension && npm run lint` |
| Passed | Extension production build succeeds | `cd extension && npm run build` |
| Passed | Backend test suite passes | `cd backend && .venv/bin/python -m pytest -q` |
| Passed | Alembic upgrades fresh DB and has no drift | `alembic upgrade head` + `alembic check` against temp DB |

## Chrome Extension / Manifest V3

| Status | Test Case | Expected Result |
| --- | --- | --- |
| Needs Attention | Load `extension/dist` as unpacked extension | Chrome accepts manifest with no install errors. |
| Needs Attention | Click extension action icon | Side panel opens via `chrome.sidePanel.setPanelBehavior`. |
| Needs Attention | Open Jira Cloud issue page matching `/browse/*` | Content script loads and sends context to side panel. |
| Needs Attention | Open non-Jira page | Side panel shows non-Jira/unsupported state, no worker crash. |
| Needs Attention | Reload extension from `chrome://extensions` | Service worker restarts and side panel can hydrate current tab again. |
| Needs Attention | Inspect service worker console | No uncaught errors on install, tab update, side panel open, or bulk messages. |
| Needs Attention | Inspect side panel console | No React runtime errors, failed imports, or unhandled promise rejections. |
| Needs Attention | Switch between two Jira tabs | Context updates to the active tab without leaking previous tab data. |
| Needs Attention | Navigate Jira SPA from one issue to another | Content script detects route change once and updates context. |

## Functional Flows

| Status | Test Case | Expected Result |
| --- | --- | --- |
| Needs Attention | First-time user opens side panel | Auth/setup/onboarding state is clear and recoverable. |
| Needs Attention | Returning authenticated user opens side panel | Existing session, active workspace, settings, and drafts restore correctly. |
| Needs Attention | Main workflow navigation | Home, manual bug, gap analysis, tests, bulk, jobs, settings, workspace, preview, success all render without crashes. |
| Needs Attention | Command palette open with `Cmd/Ctrl+K` | Dialog opens, search filters actions, Enter activates first result, Escape closes. |
| Needs Attention | Toast stack | Success/error/info toasts appear, auto-dismiss, and manual dismiss works. |
| Needs Attention | Job dashboard retry/resume | Failed/cancelled jobs create a new retry job; partial/interrupted jobs create a resume job. |
| Needs Attention | Workspace template assignment | Create/delete assignment by project/workflow/issue type/default and verify it appears after refresh. |
| Needs Attention | Activity history | Server-backed activity events load after auth and local events persist. |
| Needs Attention | Analytics events | View changes and CTA/command actions post non-blocking analytics events. |

## Edge Cases

| Status | Test Case | Expected Result |
| --- | --- | --- |
| Needs Attention | Missing token | Auth view appears; background bulk actions return controlled auth error. |
| Needs Attention | Expired token | API layer attempts refresh, then routes to auth if refresh fails. |
| Needs Attention | Network offline | UI shows actionable error and does not crash. |
| Needs Attention | Slow API response | Loading state remains visible; timeout errors are readable. |
| Needs Attention | Empty workspace/templates/jobs responses | Empty states render with clear copy. |
| Needs Attention | Invalid form input | Primary actions remain disabled or show validation error. |
| Needs Attention | User cancels a running job | Status becomes cancelled and retry is available. |
| Needs Attention | Storage read/write unavailable | Side panel logs controlled warning and continues with default state where possible. |
| Needs Attention | Extension closed/reopened | No duplicate toasts, duplicate activity posts, or duplicate content-script messages. |

## Accessibility

| Status | Check | Expected Result |
| --- | --- | --- |
| Needs Attention | Full keyboard navigation | Header, footer, command palette, forms, tabs, modals, and toast dismiss buttons are reachable. |
| Needs Attention | Focus indicators | Visible focus ring appears on interactive controls. |
| Needs Attention | Dialog semantics | Command palette and confirmation dialogs expose `role="dialog"` and modal state. |
| Needs Attention | Toast announcements | Error toasts use alert semantics; success/info use status semantics. |
| Needs Attention | Form labels | Inputs and selects expose labels or ARIA labels. |
| Needs Attention | Contrast spot check | Text, borders, badges, disabled controls, and warnings meet readable contrast in light/dark themes. |

## Security / Privacy

| Status | Check | Expected Result |
| --- | --- | --- |
| Passed | No unsafe HTML APIs found in source scan | No `dangerouslySetInnerHTML`, `innerHTML`, or `eval` usage in app source. |
| Passed | Activity event redaction | Tokens, secrets, passwords, and emails are redacted before event persistence. |
| Passed | Backend event authorization | Event endpoints require auth and workspace read permission. |
| Passed | Backend job authorization | Retry/resume/cancel/read are scoped to current user. |
| Needs Attention | Manifest permissions review | Confirm `activeTab`, `scripting`, `identity`, host, and optional host permissions are acceptable for Chrome Web Store review. |
| Needs Attention | Console/log review | No Jira tokens, JWTs, API keys, or AI payloads appear in frontend, content, or worker logs. |

## Production Readiness

| Status | Check | Expected Result |
| --- | --- | --- |
| Passed | Build artifacts generated | `extension/dist` contains `manifest.json`, `sidepanel.html`, background, content, CSS, and JS assets. |
| Passed | Backend migrations current | Fresh database can upgrade to head and `alembic check` reports no drift. |
| Needs Attention | Real backend environment | Production has real `SECRET_KEY`, `ENCRYPTION_KEY`, `DATABASE_URL`, `EXTENSION_ORIGINS`, `ALLOWED_HOSTS`. |
| Needs Attention | External integration smoke test | Jira/Xray/OpenRouter calls validated with a test tenant and non-production project. |
| Needs Attention | Monitoring | Job failures, product events volume, auth errors, and API latency are observable in production logs/metrics. |
