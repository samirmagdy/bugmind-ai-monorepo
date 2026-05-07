# BugMind AI — Test Strategy & Release Readiness Matrix

## Testing Philosophy

BugMind uses a layered test strategy:

1. **Unit tests**: Business logic services (sanitization, quality scoring, story analysis, duplicate detection, schema validation)
2. **Integration tests**: Auth lifecycle, workspace CRUD, job state transitions
3. **Contract tests** *(Roadmap P1)*: Jira/Xray publish payload shapes, field mapping resolution, token expiry behaviour
4. **E2E tests** *(Roadmap P2)*: Playwright browser tests of the extension flow (Story → Generate → Publish)

---

## Current Test Coverage

| Test file | Area |
|---|---|
| `test_auth_flows.py` | Registration, login, token refresh, logout |
| `test_auth_lifecycle.py` | Full auth lifecycle including token expiry |
| `test_bug_generation_flow.py` | AI bug generation pipeline |
| `test_duplicate_detector.py` | Duplicate detection scoring |
| `test_jobs.py` | Job creation, status transitions, cancellation |
| `test_main_security.py` | CORS, ALLOWED_HOSTS, security headers |
| `test_quality_scorer.py` | Quality score rubric |
| `test_sanitization.py` | PII redaction (Stage 2) |
| `test_schemas.py` | Pydantic schema validation |
| `test_story_analyzer.py` | Story parsing and analysis |
| `test_workspaces.py` | Workspace CRUD, membership, roles |
| `test_xray_cloud.py` | Xray Cloud client |

---

## Running Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest --tb=short -q

# With coverage:
pytest --cov=app --cov-report=term-missing -q
```

CI (`ci.yml`) runs `pytest --tb=short -q` on every push and PR to `main`.

---

## Release Readiness Matrix

| Feature | Status | Risk / Notes |
|---|---|---|
| Single story bug generation | **Beta-ready** | AI quality varies by story clarity |
| Single story test case generation | **Beta-ready** | Category selection works; Xray sync validation needed |
| Jira Cloud bug publishing | **Beta-ready** | Field mapping edge cases; test with diverse Jira configs |
| Jira Server/DC bug publishing | **Beta-ready** | Customer-specific custom field configs may vary |
| Xray Server/DC publishing | **Beta-ready** | Raven API well-tested; customer config may vary |
| Xray Cloud publishing | **Partial/Beta** | API permissions and folder behaviour vary by project |
| Duplicate detection | **Beta-ready** | Deterministic scoring; no AI dependency |
| Bulk Epic test generation job | **Partial** | Background job reliability; session handling fixed; needs queue for production scale |
| Cross-story risk audit job | **Partial** | Same concerns as bulk Epic job |
| BRD PDF extraction | **Partial** | Text PDFs only; scanned PDFs not supported |
| BRD coverage comparison job | **Partial** | Same concerns as bulk Epic job |
| Workspace creation/management | **Partial** | CRUD works; permission matrix enforcement hardening needed |
| Workspace roles (RBAC) | **Partial** | Roles defined; enforcement audit needed |
| Workspace templates | **Partial** | Create/update/delete works; template validation rules incomplete |
| Workspace audit logs | **Beta-ready** | Logged; prompt version metadata is a P1 add |
| Background job dashboard | **Beta-ready** | Progress polling works; relies on in-process BackgroundTasks |
| Billing / Stripe | **Partial** | Webhooks exist; enforcement not fully audited |
| PII redaction (backend) | **Beta-ready** | Covers emails, JWTs, tokens, IDs, auth headers |
| PII redaction (extension) | **Beta-ready** | Added in current sprint; covers same patterns |
| Health endpoints | **Production-ready** | `/health`, `/health/db`, `/health/ai` all implemented |

### Status Definitions

| Status | Meaning |
|---|---|
| **Production-ready** | Hardened, tested, no known gaps |
| **Beta-ready** | Works end-to-end; known edge cases documented; safe for limited users |
| **Partial** | Core flow works; identified gaps that need fixing before wider rollout |
| **Experimental** | Proof of concept; not safe for real users |

---

## Contract Tests (Roadmap P1)

The following contract tests are planned to catch Jira/Xray API breaking changes and edge cases:

| Contract | Test scenarios |
|---|---|
| Jira Cloud issue creation | Valid payload, missing required field, expired token, permission denied, rate limit |
| Jira Server/DC issue creation | Valid payload, custom field mapping, invalid issue type |
| Xray Cloud publish | Valid payload, permission denied, folder not found |
| Xray Server/DC Raven API | Valid payload, manual steps, repository folder |
| Field mapping resolution | Priority order, missing default, override |
| Duplicate detection | Hash collision, threshold boundary, no duplicates |

---

## E2E Smoke Tests (Roadmap P2)

Planned Playwright tests:
1. Load extension on Jira Cloud issue page
2. Detect Jira context automatically
3. Generate bug report
4. Review and edit generated fields
5. Publish to Jira with saved field mapping
6. Verify idempotency on second publish attempt
