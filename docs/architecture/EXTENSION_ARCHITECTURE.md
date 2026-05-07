# BugMind AI — Extension Architecture

## Overview

The Chrome extension uses Manifest V3, React, TypeScript, Vite, and TailwindCSS. It runs as a side panel that is activated when the user is on a Jira issue page.

```
extension/
  public/
    manifest.json         # MV3 manifest
  src/
    background/
      worker.ts           # Service worker — message routing, tab events
    content/              # Content script — Jira DOM scraping
    sidepanel/
      App.tsx             # Root app component, view routing
      types.ts            # All shared TypeScript types
      services/
        JiraCapabilityService.ts  # Core orchestration service
        api.ts            # Backend API client (secureFetch wrapper)
        contracts.ts      # API request/response contracts
        db.ts             # Extension-local IndexedDB helpers
      utils/
        ErrorTranslator.ts     # User-facing error messages
        StorageObfuscator.ts   # Obfuscates tokens in chrome.storage.local
        piiRedaction.ts        # Stage 1 PII scrubbing before AI calls
      components/         # UI components (views, panels, modals)
      hooks/              # React hooks
      context/            # React context providers
      locales/            # i18n strings
```

---

## Message Flow

```
Content Script (Jira DOM)
  → chrome.runtime.sendMessage
  → Service Worker (worker.ts)
    → Routes message to Side Panel
      → JiraCapabilityService.ts
        → piiRedaction.ts  (Stage 1 PII scrub)
        → api.ts / Backend API
          → Backend AI service (Stage 2 PII scrub + AI call)
        → Result → UI component
```

---

## Permissions

| Permission | Purpose |
|---|---|
| `sidePanel` | Run as a Chrome side panel |
| `storage` | Persist Jira connections, field mappings, workspace settings |
| `activeTab` | Read the current active Jira tab URL |
| `scripting` | Inject content script on demand |
| `identity` | Chrome identity API for future OAuth flows |
| `https://*.atlassian.net/*` | Jira Cloud access |
| `*://*/browse/*` (optional) | Jira Server/DC issue pages |
| `*://*/rest/api/*` (optional) | Jira Server/DC REST API |
| `*://*/rest/raven/*` (optional) | Xray Server/DC Raven API |

> **Security note**: Optional host permissions are only granted for user-configured Jira Server/DC domains. The extension should enforce a domain allowlist (see roadmap P1) so extraction is only attempted on trusted, user-configured Jira domains.

---

## PII Redaction (Stage 1)

`piiRedaction.ts` runs **before any data leaves the extension**:

- Email addresses → `[REDACTED_EMAIL]`
- JWT tokens → `[REDACTED_JWT]`
- Long opaque tokens (≥32 chars) → `[REDACTED_TOKEN]`
- Long numeric IDs (≥12 digits) → `[REDACTED_ID]`
- Phone numbers → `[REDACTED_PHONE]`

The backend then runs a second sanitization pass (Stage 2) before constructing AI prompts.

---

## Storage & Credential Security

Sensitive credentials (Jira tokens, API keys) are stored via `StorageObfuscator.ts`, which applies a lightweight obfuscation layer over `chrome.storage.local`. This prevents casual cleartext exposure in Chrome's developer tools storage inspector.

---

## Build

```bash
cd extension
npm install
npm run build   # Output: extension/dist/
npm run lint    # ESLint check
```

Load `extension/dist/` as an unpacked extension in Chrome (Developer Mode).
