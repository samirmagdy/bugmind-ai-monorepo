# BugMind AI — AI Orchestration

## Overview

BugMind uses OpenRouter as its AI provider, giving access to a range of models (GPT-4o, Claude, Gemini, etc.) via a single API surface. The backend AI layer handles prompt construction, PII redaction, structured output parsing, retries, and fallback logic.

---

## AI Services

| Service | File | Purpose |
|---|---|---|
| OpenRouter Client | `services/ai/openrouter_client.py` | Base HTTP client with retry + fallback |
| Bug Generator | `services/ai/bug_generator.py` | Single-story bug report generation |
| Test Case Generator | `services/ai/test_case_generator.py` | Single-story and bulk test case generation |
| AI Workflows | `services/ai/workflows.py` | Bulk cross-story analysis and BRD comparison orchestration |

---

## Prompt Construction

1. Jira issue context (summary + description + acceptance criteria) is assembled.
2. **Stage 1 PII redaction** (extension-side `piiRedaction.ts`) strips obvious PII before sending to the backend.
3. **Stage 2 PII redaction** (backend `ai_sanitizer`) runs a second pass on all AI prompt inputs.
4. The sanitised context is inserted into a versioned prompt template.
5. The prompt is sent to OpenRouter with structured JSON output mode.

---

## Prompt Versioning (Roadmap P1)

> Currently the model, prompt template, and generation metadata are logged in the audit log but not stored per-generation for diff/debug purposes.

The planned prompt versioning metadata per AI call:

```json
{
  "prompt_template_id": "bug_gen_v2",
  "prompt_version": "2.1.0",
  "model": "openai/gpt-4o",
  "input_hash": "sha256:abc123...",
  "output_hash": "sha256:def456...",
  "generation_type": "bug_report",
  "generation_timestamp": "2026-05-08T00:00:00Z",
  "redaction_applied": true,
  "fallback_used": false
}
```

This allows answering: *"Why did this test case change between yesterday and today?"*

---

## Retry & Fallback Logic

| Condition | Behaviour |
|---|---|
| HTTP 429 (Rate limit) | Exponential backoff with jitter |
| HTTP 408 (Timeout) | Retry with same model |
| Quota exhausted | Fallback to configured fallback model |
| Structured output parse failure | Re-prompt with format reminder |

---

## Supported Generation Types

| Type | Endpoint | Async? |
|---|---|---|
| Bug report (single story) | `POST /api/v1/ai/generate-bug` | No |
| Test cases (single story) | `POST /api/v1/ai/generate-tests` | No |
| Bulk Epic test generation | `POST /api/v1/jobs/epic-test-generation` | Yes (background job) |
| Cross-story risk audit | `POST /api/v1/jobs/epic-audit` | Yes (background job) |
| BRD coverage comparison | `POST /api/v1/jobs/brd-coverage-comparison` | Yes (background job) |

---

## Quality Scorer

The `QualityScorer` service evaluates AI-generated outputs against a rubric:
- Coverage completeness
- Step clarity
- Reproducibility
- Field completeness

The score is attached to generated outputs and surfaced in the extension UI.

---

## Custom AI Keys

Users can supply their own OpenRouter API key and custom model identifier via the backend settings. If provided, the user's key is used instead of the platform-level key. The user's key is stored encrypted at rest.
