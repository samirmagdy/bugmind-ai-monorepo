# BugMind AI — Release Checklist

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
