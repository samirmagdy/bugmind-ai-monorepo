# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-05-08

### Initial Release

#### UI/UX Improvements
- Complete Enterprise-grade side panel interface built with React.
- Specialized "Bulk Epic" screen for processing large Jira Epics.
- Real-time job dashboard for monitoring background AI tasks.
- Theme support (Light/Dark) with auto-detection.
- Sophisticated design system using TailwindCSS and Lucide React.

#### Technical Improvements
- Manifest V3 compliant Chrome Extension.
- High-performance FastAPI backend with PostgreSQL and SQLAlchemy 2.0.
- Advanced PII redaction pipeline (Extension-side + Backend-side).
- OpenRouter AI integration with structured JSON output and self-healing logic.
- Workspace support with RBAC (Roles: Owner, Admin, Member, Viewer).
- Shared Jira/Xray connection management across teams.
- Stripe subscription logic and usage tracking hooks.
- Encrypted credential storage (AES-GCM).
- Redis-backed sliding window rate limiting.

#### Bug Fixes
- Resolved SQLAlchemy 2.0 "InstrumentedAttribute" type-safety errors.
- Fixed dependency injection conflicts in the test suite.
- Corrected background worker session lifecycle management.
- Improved session hydration and tab-switching logic in the extension.

#### Known Issues
- SSO/SAML integration is not yet implemented.
- IP allowlisting is not yet implemented.
- Extension domain allowlist enforcement is on the roadmap.

#### Next Planned Improvements
- Automated test case execution sync back to Jira.
- PDF/Word report generation for Epic-level risk audits.
- Team-wide AI prompt templates.
