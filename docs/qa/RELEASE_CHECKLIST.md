# BugMind AI — Release Checklist

## Production Gate

The release is not production-ready until this command exits `0` with no
`FAIL` or `BLOCKED` lines:

```bash
python scripts/production_readiness_gate.py
```

This gate runs backend tests, extension lint/build/E2E smoke tests, dependency
audits, secret scanning, Render Blueprint validation, live health checks, Render
environment validation, Stripe live-mode validation, monitoring protection
checks, custom-domain allowlist checks, and real Jira/Xray tenant contracts.

Required external production values before the gate can pass:

- Render API access: `RENDER_API_KEY` or `render login`
- Production domain: `PRODUCTION_CUSTOM_DOMAIN`
- Render web env vars: `SECRET_KEY`, `ENCRYPTION_KEY`, `DATABASE_URL`,
  `DATABASE_EXTERNAL_URL`, `REDIS_URL`, `OPENROUTER_API_KEY`, `CORS_ORIGINS`,
  `ALLOWED_HOSTS`, `EXTENSION_ORIGINS`, `MONITORING_SECRET_TOKEN`
- Render worker env vars: `SECRET_KEY`, `ENCRYPTION_KEY`, `DATABASE_URL`,
  `DATABASE_EXTERNAL_URL`, `REDIS_URL`, `OPENROUTER_API_KEY`
- Stripe live billing: `STRIPE_SECRET_KEY=sk_live_*`,
  `STRIPE_WEBHOOK_SECRET=whsec_*`, `STRIPE_PRO_PRICE_ID=price_*`, and HTTPS
  billing success/cancel/portal URLs
- Monitoring alerts: `ALERT_WEBHOOK_URL` or SMTP plus
  `ALERT_EMAIL_RECIPIENTS`
- Chrome Web Store extension origin in `EXTENSION_ORIGINS`
- Real tenant contract env vars:
  `RUN_REAL_TENANT_CONTRACTS=true`, `REAL_JIRA_CLOUD_URL`,
  `REAL_JIRA_CLOUD_EMAIL`, `REAL_JIRA_CLOUD_API_TOKEN`,
  `REAL_JIRA_SERVER_URL`, `REAL_JIRA_SERVER_USERNAME`,
  `REAL_JIRA_SERVER_TOKEN`, `REAL_XRAY_CLOUD_CLIENT_ID`,
  `REAL_XRAY_CLOUD_CLIENT_SECRET`

## Pre-Release Checklist

Use this checklist before releasing a new version to production.

---

### Code Quality

- [ ] All tests pass: `cd backend && pytest --tb=short -q`
- [ ] Extension builds cleanly: `cd extension && npm run build`
- [ ] No lint errors: `cd extension && npm run lint`
- [ ] No Python compile errors: `python -m compileall backend/app`
- [ ] Alembic migrations apply cleanly: `cd backend && alembic upgrade head`

### Security

- [ ] `ENCRYPTION_KEY` is set and backed up in secrets manager
- [ ] `SECRET_KEY` is a strong random value (not a dev default)
- [ ] `CORS_ORIGINS` is set to real extension/web origins only
- [ ] `ALLOWED_HOSTS` is set to real Render hostname(s)
- [ ] `ENVIRONMENT=production` is set
- [ ] `RATE_LIMITS_ENABLED=true` (requires Redis)
- [ ] PII redaction confirmed: run `test_sanitization.py`
- [ ] No hardcoded credentials in code (check git history if unsure)

### Database

- [ ] Alembic migration history is linear (no branching heads): `alembic heads`
- [ ] Migration applies on a clean DB without error
- [ ] Data migrations (if any) are tested on a copy of production data

### Deployment

- [ ] `render.yaml` or Dockerfile reflects the latest runtime requirements
- [ ] Environment variables are all set in Render dashboard
- [ ] Health endpoints respond: `GET /health`, `GET /health/db`, `GET /health/ai`
- [ ] Redis is provisioned (if `RATE_LIMITS_ENABLED=true`)

### Extension

- [ ] `manifest.json` version is bumped
- [ ] Extension build is tested locally in Chrome (Load unpacked → `extension/dist/`)
- [ ] Jira Cloud context detection works on a real Jira issue
- [ ] Bug generation end-to-end flow tested manually
- [ ] No console errors in extension DevTools

### Observability

- [ ] Logs are flowing (check Render log stream)
- [ ] `/health` is configured as Render health check endpoint
- [ ] Audit log entries are being written for AI generation events

---

## Post-Release Checks (First 30 Minutes)

- [ ] Render deployment succeeded (green deploy status)
- [ ] `GET /health` returns `200 OK`
- [ ] `GET /health/db` returns `200 OK`
- [ ] `GET /health/ai` returns `200 OK`
- [ ] Test a real bug generation flow from the extension
- [ ] Check Render logs for unexpected errors or warnings

---

## Rollback Procedure

1. In Render, go to `Deployments` → select the previous successful deployment → click `Rollback`
2. If migration caused schema issues: apply a down migration `alembic downgrade -1`
3. Notify any affected users

---

## Version Bumping

```bash
# Patch release (bug fixes)
npm run release

# Minor release (new features)
npm run release:minor

# Major release (breaking changes)
npm run release:major
```

This uses `standard-version` to bump `package.json`, update `CHANGELOG.md`, and create a git tag.
