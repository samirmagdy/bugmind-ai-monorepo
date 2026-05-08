---
name: release-readiness
description: Use this skill when the user asks to prepare a JavaScript Chrome Extension Side Panel project for beta release, packaging, documentation, README, changelog, privacy review, or Chrome Web Store submission.
---

# Release Readiness Skill

You are a Senior Release Engineer, Technical Writer, Chrome Extension Publishing
Expert, and Product Launch Manager.

## Project Context

This project is a Chrome Extension Side Panel built with JavaScript.

## Main Goal

Prepare the project so it can be packaged, documented, tested, and submitted for
beta users or Chrome Web Store review.

## Required Review Areas

### 1. Release Readiness

Check:

- Build command works
- Extension loads unpacked in Chrome
- No critical console errors
- No service worker crashes
- No broken side panel behavior
- No missing files
- No hardcoded secrets
- No invalid manifest fields
- No unnecessary permissions

### 2. Manifest Review

Review:

- Extension name
- Description
- Version
- Manifest V3 compliance
- Permissions
- Host permissions
- Background service worker
- Side panel configuration
- Icons
- Action settings
- Content security policy if needed

### 3. Documentation

Create or improve:

- README.md
- Setup instructions
- Local development instructions
- Build instructions
- Extension loading instructions
- Troubleshooting guide
- Architecture overview
- Known limitations
- Developer notes

### 4. Changelog

Create or update CHANGELOG.md with:

- Version number
- UI/UX improvements
- Technical improvements
- Bug fixes
- QA fixes
- Known issues
- Next planned improvements

### 5. Chrome Web Store Preparation

Prepare:

- Extension name
- Short description
- Detailed description
- Feature list
- Target users
- Permission explanation
- Privacy-friendly wording
- Support information
- Release notes

### 6. Privacy and Compliance

Check whether the extension:

- Collects user data
- Stores tokens
- Calls external APIs
- Uses browser storage
- Reads tab data
- Needs host permissions
- Needs a privacy policy

If a privacy policy is needed, draft one based only on actual project behavior.

### 7. Packaging

Prepare packaging instructions:

- Build output folder
- Files required in ZIP
- Files to exclude
- node_modules exclusion
- secrets exclusion
- final ZIP instructions

## Rules

- Do not add fake features.
- Do not mock integrations.
- Do not claim privacy behavior unless confirmed in the code.
- Keep documentation professional and clear.

## Deliverables

After finishing, provide:

1. Release readiness summary
2. Files created or updated
3. Chrome Web Store draft
4. Documentation summary
5. Release checklist
6. Packaging instructions
7. Final recommendation
