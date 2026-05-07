/**
 * piiRedaction.ts — Client-side PII redaction utility.
 *
 * This is Stage 1 of BugMind's two-stage redaction pipeline:
 *   Stage 1 (here): Extension scrubs obvious PII before sending to the backend.
 *   Stage 2 (backend): AI sanitization service runs a second pass on all prompts.
 *
 * Patterns covered:
 *   - Email addresses
 *   - JWT tokens (eyJ…)
 *   - Bearer / long opaque tokens (≥32 chars)
 *   - Long numeric IDs (≥12 digits, e.g. Jira account IDs, phone-like numbers)
 *   - Phone numbers (E.164 and common NA formats)
 *
 * Usage:
 *   import { redactForAi } from '../utils/piiRedaction';
 *   const safeText = redactForAi(rawJiraDescription);
 */

/** Replacement tags used in redacted output. */
export const REDACTION_TAGS = {
  EMAIL: '[REDACTED_EMAIL]',
  JWT: '[REDACTED_JWT]',
  TOKEN: '[REDACTED_TOKEN]',
  ID: '[REDACTED_ID]',
  PHONE: '[REDACTED_PHONE]',
} as const;

/** Ordered redaction rules applied left-to-right. */
const REDACTION_RULES: Array<{ pattern: RegExp; tag: string }> = [
  // JWT tokens — match before generic token rule
  {
    pattern: /\beyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_.+/=]*\b/g,
    tag: REDACTION_TAGS.JWT,
  },
  // Email addresses
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    tag: REDACTION_TAGS.EMAIL,
  },
  // Phone numbers — E.164 and common North-American formats
  {
    pattern:
      /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
    tag: REDACTION_TAGS.PHONE,
  },
  // Long numeric IDs (≥12 digits) — Jira account IDs, Atlassian IDs, etc.
  {
    pattern: /\b\d{12,}\b/g,
    tag: REDACTION_TAGS.ID,
  },
  // Bearer tokens and long opaque strings (≥32 alphanumeric+hyphen+underscore chars)
  {
    pattern: /\b(?:Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g,
    tag: REDACTION_TAGS.TOKEN,
  },
];

/**
 * Scrub PII from a string before sending it to the AI backend.
 *
 * @param input - Raw text (Jira story description, acceptance criteria, etc.)
 * @returns Redacted string safe for transmission to external AI services.
 */
export function redactForAi(input: string): string {
  if (!input || typeof input !== 'string') return input;

  return REDACTION_RULES.reduce(
    (text, { pattern, tag }) => text.replace(pattern, tag),
    input,
  );
}

/**
 * Redact PII from all string values in a plain object (shallow).
 * Useful for sanitizing Jira issue field maps before AI processing.
 *
 * @param obj - Object whose string values should be redacted.
 * @returns New object with redacted string values.
 */
export function redactObjectForAi<T extends Record<string, unknown>>(obj: T): T {
  // Use a non-generic working copy so TS allows index writes.
  // Casting back to T at return is safe: we only mutate string-valued keys.
  const result: Record<string, unknown> = { ...obj };
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'string') {
      result[key] = redactForAi(result[key] as string);
    }
  }
  return result as T;
}

/**
 * Check whether a string contains any PII patterns (without redacting).
 * Useful for logging or warning the user before transmission.
 *
 * @param input - Raw text to inspect.
 * @returns true if any PII pattern was detected.
 */
export function containsPii(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  return REDACTION_RULES.some(({ pattern }) => {
    // Reset lastIndex for stateful regexes
    pattern.lastIndex = 0;
    return pattern.test(input);
  });
}
