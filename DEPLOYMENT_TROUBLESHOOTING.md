# Database Connection Troubleshooting Guide (Render Managed Postgres)

## Overview
BugMind AI now uses **Managed PostgreSQL on Render**, which eliminates the complex IP whitelisting issues associated with external providers like Supabase.

---

## Common Issues

### 1. Backend failing to start: "DATABASE_URL must be set"
**Symptoms:** 
- Render logs show `ValueError: DATABASE_URL must be set in production`.
- The service stays in a "Deploying" or "Failed" state.

**Why it happens:**
- The `bugmind-backend` service is not correctly linked to the `bugmind-db` database.
- The `DATABASE_URL` environment variable is missing or incorrectly named.

**Solution:**
1. Go to your **Render Dashboard**.
2. Click on the **bugmind-backend** service.
3. Go to **Environment**.
4. Check if `DATABASE_URL` is present and set to "from database bugmind-db".
5. If missing, ensure your `render.yaml` was applied correctly via a Blueprint deploy.

---

### 2. Migration Failures during deploy
**Symptoms:**
- Logs show `alembic.util.exc.CommandError` or SQL errors related to `anon` or `authenticated` roles.

**Why it happens:**
- Legacy migrations were specifically designed for Supabase's role-based system.
- Standard Postgres on Render does not have these roles by default.

**Solution:**
- We have hardened the migrations to check for these roles before attempting to create policies.
- Ensure you have pushed the latest version of the migrations in `backend/alembic/versions/`.
- If a migration is stuck, you can try to manually run `alembic upgrade head` from a local environment or a Render shell.

---

### 3. "too many connections" error
**Symptoms:**
- Logs show `psycopg.OperationalError: fatal: remaining connection slots are reserved for non-replication superuser connections`.

**Why it happens:**
- The Render PostgreSQL Free tier has a limit of **5 concurrent connections**.
- If multiple instances of the backend or AI workers are running, they might exceed this limit.

**Solution:**
1. Set `DATABASE_POOL_SIZE` to a lower value (e.g., `2` or `3`).
2. Close unused database connections in your code.
3. Upgrade to the **Starter** tier or higher on Render if you need more concurrent connections.

---

### 4. Database doesn't exist yet
**Symptoms:**
- Logs show `psycopg.OperationalError: database "bugmind" does not exist`.

**Why it happens:**
- The database resource was created but the specific database name hasn't been initialized.

**Solution:**
- Your Blueprint should automatically create the database name specified in `render.yaml` (`databaseName: bugmind`).
- If it didn't, go to the **bugmind-db** settings and verify the database name.

---

## Testing Connectivity Locally

To test if your Render database is reachable from your local machine (using the External Connection String):

```bash
# Export your external connection string from Render dashboard
export DATABASE_URL="postgresql://user:password@hostname.render.com/bugmind"

# Run a simple check
python -c "from sqlalchemy import create_engine; engine = create_engine('${DATABASE_URL}'); print('Connection successful' if engine.connect() else 'Failed')"
```

> [!IMPORTANT]
> Render's external connection string usually requires `sslmode=require`. The BugMind backend handles this automatically, but manually testing might require adding it to the URL.
