# BugMind AI 🚀

[![CI](https://github.com/samirmagdy/bugmind-ai-monorepo/actions/workflows/ci.yml/badge.svg)](https://github.com/samirmagdy/bugmind-ai-monorepo/actions/workflows/ci.yml)
[![Release](https://github.com/samirmagdy/bugmind-ai-monorepo/actions/workflows/release.yml/badge.svg)](https://github.com/samirmagdy/bugmind-ai-monorepo/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/github/v/release/samirmagdy/bugmind-ai-monorepo)](https://github.com/samirmagdy/bugmind-ai-monorepo/releases)

**Intelligent Bug Generator from Jira User Stories**

BugMind AI is a production-grade SaaS system that analyzes Jira User Stories and Acceptance Criteria to automatically generate high-quality QA bug reports using AI (OpenRouter/GPT-4o).

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
This repo now includes a Render Blueprint at [render.yaml](/Users/samirmagdy/JBG%203/render.yaml) for the backend.

What it provisions:
- one Python web service for FastAPI
- one managed Key Value instance for Redis-compatible caching/rate limiting/idempotency

How to deploy:
1. Push the repo to GitHub/GitLab.
2. In Render, choose `New > Blueprint`.
3. Select this repository.
4. Render will detect `render.yaml` and propose:
   - `bugmind-backend`
   - `bugmind-redis`
5. Fill in the prompted secret env vars:
   - `DATABASE_URL`
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

Deployment behavior:
- Render runs the service from `backend/`
- migrations run through Alembic before startup
- the app binds to Render’s `PORT` environment variable
- health checks use `/health`

Important:
- Alembic is now configured to use `DATABASE_URL` from the environment, which is required for Render Postgres.
- The current deployment blueprint expects an external Postgres database URL, such as Supabase Postgres.
- For Supabase Postgres, use `?sslmode=require` in `DATABASE_URL`.
- `/health` verifies database connectivity and is suitable for Render health checks.
- In production, set `CORS_ORIGINS` to your real extension/web origins and `ALLOWED_HOSTS` to your Render hostname(s).
- If you do not use Stripe yet, you can leave the Stripe secrets unset until you enable billing flows.

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

- **Auto-Detection**: Scrapes Jira Cloud & Server issues automatically.
- **Direct Submission**: Create bug tickets in Jira with one click.
- **Self-Healing**: AI output validation and API retry logic.
- **Usage Tracking**: SaaS-ready with subscription enforcement hooks.

## ⚙️ Development

- **Release Management**: This project uses [standard-version](https://github.com/conventional-changelog/standard-version) for automated versioning.
  - Patch: `npm run release`
  - Minor: `npm run release:minor`
  - Major: `npm run release:major`
- **CI/CD**: GitHub Actions validate every PR and automate releases on tag pushes.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
