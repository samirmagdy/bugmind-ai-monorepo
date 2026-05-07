# BugMind AI — PII Redaction

## Overview

BugMind uses a two-stage PII redaction pipeline to ensure no personally identifiable information reaches external AI services.

---

## Stage 1: Extension-Side Redaction

**File**: `extension/src/sidepanel/utils/piiRedaction.ts`

**When it runs**: Before any Jira content is sent from the browser to the BugMind backend.

**Patterns**:

| Pattern | Replaced with |
|---|---|
| Email addresses | `[REDACTED_EMAIL]` |
| JWT tokens (`eyJ...`) | `[REDACTED_JWT]` |
| Long opaque tokens (≥32 chars) | `[REDACTED_TOKEN]` |
| Long numeric IDs (≥12 digits) | `[REDACTED_ID]` |
| Phone numbers (E.164, NA formats) | `[REDACTED_PHONE]` |

**Usage**:
```typescript
import { redactForAi } from '../utils/piiRedaction';

const safeText = redactForAi(rawJiraDescription);
// Pass safeText to the backend API
```

---

## Stage 2: Backend AI Sanitization

**Location**: `backend/app/services/ai/` (AI sanitizer)

**When it runs**: On the backend, before constructing any OpenRouter AI prompt.

**Additional patterns** (beyond Stage 1):
- HTTP `Authorization` header values
- Sensitive URL query parameters (`token=`, `key=`, `secret=`, `api_key=`)
- Cookie values
- Bearer token strings in request context

---

## Why Two Stages?

| Reason | Explanation |
|---|---|
| **Defense in depth** | If Stage 1 misses something, Stage 2 catches it |
| **Backend-only paths** | Some data arrives at the backend without going through the extension (e.g., bulk Epic fetches via the Jira adapter). Stage 2 covers these paths. |
| **Enterprise requirement** | Enterprise security reviewers expect both client-side and server-side controls |

---

## Testing PII Redaction

Stage 1 can be unit-tested directly:
```typescript
import { redactForAi, containsPii } from '../utils/piiRedaction';

expect(redactForAi('Email: user@example.com')).toBe('Email: [REDACTED_EMAIL]');
expect(containsPii('Call me at +1-555-867-5309')).toBe(true);
```

Stage 2 is covered by `backend/tests/test_sanitization.py`.

---

## Limitations

- Stage 1 JWT pattern requires the token to start with `eyJ` (standard JWT header encoding). Non-standard JWT formats may not be caught.
- Long token pattern (≥32 chars) may over-redact some legitimate long identifiers (e.g., Jira Epic keys with many characters). This is intentional — false positives are safer than false negatives.
- Stage 1 does not inspect binary or image content; only text strings are redacted.
