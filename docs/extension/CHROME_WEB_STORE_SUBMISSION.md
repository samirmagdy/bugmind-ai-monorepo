# Chrome Web Store Submission

## Package

Build the extension and submit only the contents of `extension/dist`:

```bash
cd extension
npm run build
cd dist
zip -r ../../bugmind-extension-store.zip .
```

Before upload, run the production gate from the repo root:

```bash
python scripts/production_readiness_gate.py --skip-live --skip-render --skip-real-tenants
```

The Chrome Web Store checks must all pass:

- Manifest V3
- Listing metadata length and version format
- No manifest key or embedded OAuth secrets
- Expected permissions only
- Required host permissions limited to Atlassian Cloud
- Self-hosted Jira permissions are optional
- CSP does not allow remote scripts or `unsafe-eval`
- 16, 48, and 128 px PNG icons are valid
- Package has no source maps, private keys, source files, env files, or `node_modules`
- Built HTML/CSS has no remote asset URLs
- Built JS has no remote executable-code patterns
- ZIP has `manifest.json` at the package root

## Permission Justification

Use these justifications in the Chrome Web Store privacy and permission review.

- `sidePanel`: Opens BugMind AI in Chrome's side panel.
- `storage`: Stores user settings, session state, and connection preferences locally.
- `activeTab`: Reads the currently open Jira issue tab after user interaction.
- `scripting`: Injects the Jira content extractor into Jira issue pages.
- `identity`: Starts the Google sign-in OAuth flow through Chrome Identity.
- `https://*.atlassian.net/*`: Reads Jira Cloud issue context on Atlassian-hosted Jira pages.
- Optional `*://*/browse/*`, `*://*/issues/*`, `*://*/rest/api/*`, `*://*/rest/raven/*`: Supports user-approved self-hosted Jira and Xray Server/Data Center instances.

## Privacy Disclosure

BugMind AI processes Jira issue context, Jira connection settings, generated bug
reports, generated test cases, user account details, and authentication tokens
needed to operate the service. The extension sends this data to the BugMind AI
backend selected in the extension settings.

The extension stores access and refresh tokens in Chrome extension storage. The
stored values are obfuscated to reduce accidental exposure, but this is not a
substitute for server-side token revocation and short token lifetimes.

The extension does not sell user data and does not use data for unrelated
advertising. AI generation may send selected issue content to the configured
BugMind AI backend, which may call the configured AI provider.

## Store Listing Draft

Short description:

```text
Generate structured bug reports and test cases from Jira issue context.
```

Detailed description:

```text
BugMind AI helps QA, product, and engineering teams turn Jira story context into structured bug reports and test cases from a Chrome side panel.

Open a Jira issue, launch the side panel, connect your BugMind AI account, and generate consistent QA artifacts using your configured workspace, Jira, Xray, and AI settings.

Features:
- Reads Jira Cloud issue context from active Jira tabs
- Supports optional self-hosted Jira and Xray Server/Data Center access
- Generates structured bug reports
- Generates test cases from story context
- Supports Google sign-in and email/password login
- Keeps required host permissions limited to Atlassian Cloud by default

BugMind AI requires a BugMind AI account and backend service.
```

## Manual Store Review Checks

- Confirm the Chrome Web Store extension ID is added to production `EXTENSION_ORIGINS`.
- Confirm Google OAuth is configured for the final Chrome extension redirect URI.
- Confirm a public privacy policy URL is ready for the store listing.
- Confirm support contact details are ready for the store listing.
- Confirm screenshots show the real side panel UI and do not expose customer data.
