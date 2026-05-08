# BugMind AI 🚀

[![CI](https://github.com/samirmagdy/bugmind-ai-monorepo/actions/workflows/ci.yml/badge.svg)](https://github.com/samirmagdy/bugmind-ai-monorepo/actions/workflows/ci.yml)
[![Release](https://github.com/samirmagdy/bugmind-ai-monorepo/actions/workflows/release.yml/badge.svg)](https://github.com/samirmagdy/bugmind-ai-monorepo/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/github/v/release/samirmagdy/bugmind-ai-monorepo)](https://github.com/samirmagdy/bugmind-ai-monorepo/releases)

**AI-Powered Jira & Xray QA Orchestration Platform**

BugMind AI is a production-grade SaaS platform for generating, reviewing, syncing, auditing, and managing test and bug intelligence directly from your Jira & Xray workflows. It combines a Chrome extension with a FastAPI backend and OpenRouter AI to automate the full QA lifecycle — from single story bug generation to bulk Epic test suites, BRD coverage analysis, and Xray publishing.

---

## 📁 System Architecture

- **Backend**: FastAPI, PostgreSQL, SQLAlchemy, Redis.
- **Extension**: React, TypeScript, TailwindCSS, Vite (Manifest V3).
- **AI**: OpenRouter integration with structured JSON output.
- **Billing**: Stripe Subscription logic included.

## 🚀 Getting Started

### 1. Backend Setup (Docker)
1. Copy `.env.example` to `.env` and fill in your keys:
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL` if you want to override the default model
   - `STRIPE_SECRET_KEY`
   - `ENCRYPTION_KEY`
2. Run the stack:
   ```bash
   docker-compose up --build
   ```
The API will be available at `http://localhost:8000`.

### 1.1 Backend Deploy on Render
This repo now includes a Render Blueprint at [render.yaml](./render.yaml) for the backend.

What it provisions:
- one Python web service for FastAPI
- one managed PostgreSQL database

How to deploy:
1. Push the repo to GitHub/GitLab.
2. In Render, choose `New > Blueprint`.
3. Select this repository.
4. Render will detect `render.yaml` and propose:
   - `bugmind-backend`
   - `bugmind-db`
5. Fill in the prompted secret env vars (the `DATABASE_URL` is automatically linked):
   - `ENVIRONMENT`
   - `LOG_LEVEL`
   - `SECRET_KEY`
   - `ENCRYPTION_KEY`
   - `OPENROUTER_API_KEY`
   - `OPENROUTER_MODEL` if you want a non-default model
   - `CORS_ORIGINS`
   - `ALLOWED_HOSTS`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
6. Deploy the Blueprint.

Recommended Render setting:
- turn off Render's repository auto-deploy if you plan to deploy only through GitHub Actions, otherwise every push to `main` can trigger a second duplicate deploy.

Deployment behavior:
- Render runs the service from `backend/`
- migrations run through Alembic before startup
- the app binds to Render’s `PORT` environment variable
- health checks use `/health`
- the free-tier setup does not provision Redis; Redis-backed rate limiting, idempotency replay, and metadata caching degrade gracefully

Important:
- Alembic is now configured to use `DATABASE_URL` from the environment, provided automatically by the Render Blueprint.
- The system now uses Render's managed Postgres, simplifying connectivity and security.
- `/health` verifies database connectivity and is suitable for Render health checks.
- In production, set `CORS_ORIGINS` to your real extension/web origins and `ALLOWED_HOSTS` to your Render hostname(s).
- The free Render blueprint sets `REDIS_URL=redis://localhost:6379/0` and `RATE_LIMITS_ENABLED=false` so the app can run without a paid Redis service.
- If you do not use Stripe yet, you can leave the Stripe secrets unset until you enable billing flows.

### 1.2 GitHub Actions -> Render
The repo now includes a deployment workflow at `.github/workflows/render-deploy.yml`.

What it does:
- waits for the main `CI` workflow to pass on `main`
- triggers Render through a deploy hook
- also supports manual deploys through `workflow_dispatch`

Required GitHub repository secret:
- `RENDER_DEPLOY_HOOK_URL`

How to get it:
1. Open your Render web service
2. Go to `Settings > Deploy Hook`
3. Create a deploy hook for the backend service
4. Add that URL to GitHub as the `RENDER_DEPLOY_HOOK_URL` repository secret

Recommended deployment flow:
1. Push to a branch
2. Open a PR
3. Let `CI` pass
4. Merge to `main`
5. GitHub Actions triggers the Render deploy hook

If you keep Render's own repo auto-deploy enabled, GitHub Actions will still work, but you may get duplicate deployments.

### 2. Extension Setup
1. Navigate to the `extension` folder.
2. Install dependencies (requires Node.js):
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run build
   ```
4. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension/dist` folder (after build).

## 🧠 Features

**Bug & Test Generation**
- **Auto-Detection**: Scrapes Jira Cloud & Server/DC issues automatically from the active page.
- **Bug Generation**: AI-generated bug reports with structured fields, severity, and reproduction steps.
- **Test Case Generation**: Selectable test categories (Positive, Negative, Boundary, Regression).
- **Duplicate Detection**: Deterministic pre-publish duplicate check — no AI dependency.
- **Xray Publishing**: Publish test cases to Xray Cloud and Xray Server/DC (Raven API), including manual steps, issue links, and repository folders.
- **Direct Submission**: Create bug tickets in Jira Cloud or Server/DC with one click, with field mapping and idempotency.

**Bulk & Epic Workflows**
- **Bulk Epic Screen**: Fetch all child stories from an Epic and process them in batch.
- **Epic Test Generation Job**: Background AI test generation across all stories in an Epic.
- **Cross-Story Risk Audit**: Identify overlapping risks, missing coverage, and cross-story dependencies.
- **BRD Comparison**: Extract BRD text (DOCX, text PDF, plain text) from Jira attachments and compare against story coverage.
- **Job Dashboard**: Monitor running, completed, and failed background jobs with progress tracking, cancellation, retry, and resume.

**Workspace & Collaboration**
- **Team Workspaces**: Workspace membership, roles, shared Jira/Xray connections, and workspace switching.
- **Templates**: Create, update, and delete workspace-level QA templates with project, issue type, workflow, and default assignment rules.
- **Audit Logs**: Workspace audit-log views and usage tracking.

**Platform**
- **Self-Healing**: AI output validation and API retry logic with rate-limit handling.
- **Activity & Analytics Events**: Server-backed activity history and product analytics events for workflow drop-off and CTA measurement.
- **Usage Tracking**: SaaS-ready with Stripe subscription enforcement hooks.
- **Security**: PII redaction before AI processing, encrypted credential storage, production CORS/ALLOWED_HOSTS enforcement.

## ⚙️ Development

### Production Readiness Checks

Before shipping changes:

```bash
cd extension && npm run lint && npm run build
cd backend && .venv/bin/python -m pytest -q
cd backend && DATABASE_URL="sqlite:////tmp/bugmind-check.db" .venv/bin/alembic upgrade head
```

For production deployments, set real `SECRET_KEY`, `ENCRYPTION_KEY`, `DATABASE_URL`, `EXTENSION_ORIGINS`, and `ALLOWED_HOSTS`. The API intentionally aborts startup when required security keys or database tables are missing.

- **Release Management**: This project uses [standard-version](https://github.com/conventional-changelog/standard-version) for automated versioning.
  - Patch: `npm run release`
  - Minor: `npm run release:minor`
  - Major: `npm run release:major`
- **CI/CD**: GitHub Actions validate every PR, trigger Render deployments for `main`, and automate releases on tag pushes.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
