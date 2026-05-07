# BugMind AI — Troubleshooting

## Backend Issues

### "Session already closed" in background jobs
**Fixed in current version.** `process_job` now creates its own `SessionLocal()` session instead of sharing the request-scoped session. If you see this after upgrading, ensure you're on the latest version of `worker.py`.

### Alembic "Multiple heads" error
```bash
cd backend
alembic heads          # Check for branching
alembic merge heads    # Merge if needed
alembic upgrade head
```

### "ENCRYPTION_KEY invalid" startup error
Generate a fresh key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
**Note**: Changing the key invalidates all stored encrypted credentials.

### Health check fails at `/health/db`
- Check `DATABASE_URL` is set correctly
- Verify the database is reachable from the app (firewall, VPC rules)
- Check Alembic migrations have been applied: `alembic upgrade head`

### Health check fails at `/health/ai`
- Check `OPENROUTER_API_KEY` is set and valid
- Test the key directly: `curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/models`

---

## Extension Issues

### Extension does not detect Jira context
- Verify the current page URL matches `https://*.atlassian.net/browse/*` (Cloud) or matches the optional host permission pattern for Server/DC
- Check Chrome DevTools → Extension background worker → Console for errors
- Reload the extension: go to `chrome://extensions` → BugMind AI → Reload

### "401 Unauthorized" when generating
- Session may have expired; try logging out and back in from the extension settings
- Check that the backend API URL in extension settings is correct

### Xray publish fails with "403 Forbidden"
- For Xray Cloud: verify Client ID and Client Secret are correct and have test creation permissions
- For Xray Server/DC: verify the Jira user has Xray project permissions
- Check the project key and issue type ID in the field mappings

---

## CI Failures

### `pytest` fails in CI but passes locally
- Check Python version: CI uses Python 3.12 — ensure local environment matches
- Check that `requirements-dev.txt` is installed: `pip install -r backend/requirements-dev.txt`
- Check for environment variable dependencies in tests — CI injects `DATABASE_URL=sqlite:///./ci.db`

### Extension build fails in CI
- Check Node.js version: CI uses Node 24
- Delete `node_modules` locally and re-run `npm install` to verify lockfile is clean

---

## Redis Not Available

If Redis is not provisioned:
- Set `RATE_LIMITS_ENABLED=false` to disable Redis-dependent features gracefully
- Background jobs still work via FastAPI `BackgroundTasks` (in-process, not persistent)
- Idempotency replay and metadata caching degrade gracefully
