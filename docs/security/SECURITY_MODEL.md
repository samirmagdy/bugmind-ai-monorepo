# BugMind AI — Security Model

## Overview

BugMind applies defence-in-depth: multiple independent security layers protect user data, credentials, and AI prompts.

---

## Authentication

| Control | Implementation |
|---|---|
| Session tokens | JWT (HS256), signed with `SECRET_KEY` |
| Token lifetime | Short-lived access tokens + refresh token rotation |
| Password storage | bcrypt (via `passlib[bcrypt]`) — no plaintext |
| Token verification | Every protected endpoint verifies JWT signature and expiry |

---

## Credential Encryption

Jira tokens, API keys, and Xray credentials stored in the database are encrypted at rest:

- **Algorithm**: AES-GCM via Python `cryptography` library
- **Key**: `ENCRYPTION_KEY` environment variable (must be set at deploy time)
- **Scope**: `encrypted_jira_token`, `encrypted_ai_api_key`, `XrayCloudCredential.encrypted_*`

> **Important**: Losing the `ENCRYPTION_KEY` means all stored credentials become unrecoverable. Back up this key securely (e.g., in a secrets manager).

---

## Network Security

| Control | Implementation |
|---|---|
| CORS | `CORS_ORIGINS` env var; strict in production |
| ALLOWED_HOSTS | Validated by `request_security.py` middleware |
| Security headers | X-Frame-Options, X-Content-Type-Options, CSP applied |
| Extension CSP | `script-src 'self'; object-src 'self'` in `manifest.json` |
| HTTPS | Enforced in production; Render HTTPS by default |

---

## PII Redaction Pipeline

PII is scrubbed in two independent stages:

### Stage 1: Extension-side (`piiRedaction.ts`)
Runs before any data leaves the browser:
- Email addresses → `[REDACTED_EMAIL]`
- JWT tokens → `[REDACTED_JWT]`
- Long opaque tokens ≥32 chars → `[REDACTED_TOKEN]`
- Long numeric IDs ≥12 digits → `[REDACTED_ID]`
- Phone numbers → `[REDACTED_PHONE]`

### Stage 2: Backend (`ai_sanitizer` service)
Runs on every AI prompt before calling OpenRouter:
- Same patterns plus HTTP auth headers and sensitive query parameters
- Ensures even data arriving via the backend API (not the extension) is scrubbed

---

## Rate Limiting

- Redis-backed sliding window rate limiting per user
- Gracefully degrades (disabled) when Redis is unavailable (e.g., Render free tier)
- `RATE_LIMITS_ENABLED` env var controls activation

---

## RBAC — Workspace Roles

| Role | Capabilities |
|---|---|
| Owner | Full control including member management and shared connection management |
| Admin | Can manage connections, templates, audit logs |
| Member | Can use workspaces, generate content, view jobs |
| Viewer | Read-only access to workspace content |

> **Status**: Permission matrix is implemented; enforcement hardening is a P1 roadmap item.

---

## Extension Credential Storage

The Chrome extension uses `StorageObfuscator.ts` to obfuscate credentials stored in `chrome.storage.local`. This prevents cleartext token exposure in Chrome's built-in storage inspector. This is obfuscation, not encryption — the primary security layer is backend credential encryption.

---

## Known Gaps (Roadmap)

| Gap | Status |
|---|---|
| SSO / SAML | Not implemented |
| IP allowlisting | Not implemented |
| Extension domain allowlist enforcement | Roadmap P1 |
| Audit log export | Not implemented |
| Secret rotation flows | Not implemented |
| Stripe billing enforcement audit | Partial |
