# BugMind AI — E2E Test Scenarios

## Overview

These are the target scenarios for end-to-end testing. Currently manual; Playwright automation is planned for Roadmap P2.

---

## Scenario 1: Single Story Bug Generation (Happy Path)

**Preconditions**: Extension installed, Jira Cloud connection configured.

| Step | Action | Expected result |
|---|---|---|
| 1 | Navigate to a Jira Cloud user story | Extension detects Jira context |
| 2 | Open BugMind side panel | Side panel opens, shows detected story |
| 3 | Click "Generate Bug Report" | Loading state shown |
| 4 | Wait for generation | Bug report displayed with summary, steps, severity |
| 5 | Review and edit fields | Inline editing works |
| 6 | Click "Publish to Jira" | Loading state, then success message |
| 7 | Open Jira | Bug ticket created with correct fields |

---

## Scenario 2: Duplicate Detection

| Step | Action | Expected result |
|---|---|---|
| 1 | Generate a bug report for story X | Bug report generated |
| 2 | Publish the bug | Jira ticket created |
| 3 | Generate again for same story | Duplicate detected before publish |
| 4 | Review duplicate warning | Shows existing ticket key |
| 5 | Confirm publish anyway | Second ticket created with duplicate note |

---

## Scenario 3: Test Case Generation + Xray Publish (Server/DC)

| Step | Action | Expected result |
|---|---|---|
| 1 | Navigate to a Jira Server story | Extension detects Jira Server context |
| 2 | Select "Generate Test Cases" | Category selector shown |
| 3 | Select Positive + Negative | Categories checked |
| 4 | Generate | Test cases generated |
| 5 | Select Xray Server destination | Xray Server/DC selected |
| 6 | Publish to Xray | Test cases created in Xray with manual steps |

---

## Scenario 4: Bulk Epic Test Generation Job

| Step | Action | Expected result |
|---|---|---|
| 1 | Navigate to a Jira Epic | Epic detected |
| 2 | Open Bulk Mode | Bulk screen opens |
| 3 | Click "Start Epic Test Generation" | Job created, job dashboard shown |
| 4 | Monitor job progress | Progress bar updates as stories processed |
| 5 | Job completes | Results shown per story |
| 6 | Navigate away and return | Job status persists in dashboard |

---

## Scenario 5: BRD Coverage Comparison

| Step | Action | Expected result |
|---|---|---|
| 1 | Navigate to an Epic with a BRD attachment | Epic and attachment detected |
| 2 | Load BRD from attachment | BRD text extracted and shown |
| 3 | Start BRD coverage comparison | Job created |
| 4 | Job completes | Coverage gaps and matched requirements shown |

---

## Scenario 6: Workspace Switching

| Step | Action | Expected result |
|---|---|---|
| 1 | Open Settings → Workspaces | Workspace list shown |
| 2 | Switch to a different workspace | Active workspace changes |
| 3 | Shared connections from new workspace shown | Workspace connections visible |
| 4 | Generate a bug | Bug generated under new workspace context |

---

## Scenario 7: Session Expiry

| Step | Action | Expected result |
|---|---|---|
| 1 | Let session expire | Access token expired |
| 2 | Attempt bug generation | 401 response detected |
| 3 | Refresh token used automatically | New access token obtained |
| 4 | Generation retried | Success |

---

## Scenario 8: Jira Server/DC Connection (Optional Host Permissions)

| Step | Action | Expected result |
|---|---|---|
| 1 | Add a Jira Server connection with custom domain | Optional permission prompt shown |
| 2 | Grant permission | Permission granted |
| 3 | Navigate to Jira Server story | Context detected |
| 4 | Generate bug | Bug generated using Server/DC adapter |
| 5 | Revoke permission | Extension falls back gracefully |

---

## Manual Test Notes

- Test with Jira Cloud and Jira Server/DC versions.
- Test with Xray Cloud credentials separate from Xray Server/DC credentials.
- Test PII redaction: paste a description containing an email — verify `[REDACTED_EMAIL]` in the prompt preview (if debug mode enabled).
- Test rate limiting: make >N requests per minute and verify graceful error message (not a raw 429).
