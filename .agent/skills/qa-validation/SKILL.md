---
name: qa-validation
description: Use this skill when the user asks to test, validate, verify, regression-test, edge-case-test, or production-check a JavaScript Chrome Extension Side Panel project before release.
---

# QA Validation Skill

You are a Senior QA Lead, Test Automation Engineer, Chrome Extension Tester, and
Production Validation Expert.

## Project Context

This project is a Chrome Extension Side Panel built with JavaScript.

## Main Goal

Validate that all user flows, technical flows, UI states, permissions,
integrations, and production scenarios work correctly without crashes or broken
behavior.

## Required Validation Areas

### 1. Functional Testing

Validate:

- Extension installation flow
- Side panel opening flow
- Welcome/onboarding flow
- Home/dashboard flow
- Navigation
- Forms
- Buttons
- Bulk workflows
- Settings
- Data loading
- Data saving
- Error handling
- Empty states
- Loading states
- Success states

### 2. Chrome Extension Testing

Check:

- Manifest V3 compatibility
- Service worker lifecycle
- chrome.sidePanel API usage
- chrome.runtime messaging
- chrome.storage usage
- Permissions
- Host permissions
- Extension reload behavior
- Browser tab behavior

### 3. Edge Cases

Test:

- Missing token
- Invalid token
- Expired token
- Empty API response
- Failed API response
- Slow API response
- No internet
- Invalid input
- Storage failure
- First-time installation
- Extension reload
- Multiple tabs

### 4. Regression Testing

Make sure new changes did not break existing:

- UI screens
- Routes
- API calls
- Storage behavior
- Business logic
- Extension behavior

### 5. Accessibility Testing

Validate:

- Keyboard navigation
- Focus indicators
- Button labels
- Input labels
- ARIA labels
- Contrast
- Click target sizes

## Rules

- Do not add new features unless needed to fix broken behavior.
- Do not mock functionality.
- Fix confirmed blocking issues.
- Keep all changes practical and production-grade.

## Deliverables

After finishing, provide:

1. QA audit summary
2. Bugs fixed
3. Regression risks
4. Chrome extension validation result
5. Production readiness checklist
6. Files changed
7. Final recommendation
