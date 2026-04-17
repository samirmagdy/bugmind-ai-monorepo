# BugMind AI 🚀
**Intelligent Bug Generator from Jira User Stories**

BugMind AI is a production-grade SaaS system that analyzes Jira User Stories and Acceptance Criteria to automatically generate high-quality QA bug reports using AI (OpenRouter/GPT-4o).

## 📁 System Architecture
- **Backend**: FastAPI, PostgreSQL, SQLAlchemy, Redis.
- **Extension**: React, TypeScript, TailwindCSS, Vite (Manifest V3).
- **AI**: OpenRouter integration with structured JSON output.
- **Billing**: Stripe Subscription logic included.

## 🚀 Getting Started

### 1. Backend Setup (Docker)
1. Copy `.env.example` to `.env` and fill in your keys:
   - `OPENROUTER_API_KEY`
   - `STRIPE_API_KEY`
2. Run the stack:
   ```bash
   docker-compose up --build
   ```
The API will be available at `http://localhost:8000`.

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
   - Select the `extension/dist` folder (after build) or `extension` folder if using a dev server.

## 🧠 Features
- **Auto-Detection**: Scrapes Jira Cloud & Server issues automatically.
- **Direct Submission**: Create bug tickets in Jira with one click.
- **Self-Healing**: AI output validation and API retry logic.
- **Usage Tracking**: SaaS-ready with subscription enforcement hooks.

## ⚙️ Development
- **Backend API**: `http://localhost:8000/docs` (Swagger UI)
- **Database**: PostgreSQL on port 5432.
- **Cache**: Redis on port 6379.
