# Privacy Policy for BugMind AI

**Effective Date**: May 8, 2026

At BugMind AI ("we," "us," or "our"), we are committed to protecting your privacy and ensuring the security of your data. This Privacy Policy describes how the BugMind AI Chrome Extension and Backend Service collect, use, and handle your information.

## 1. Information We Collect

### 1.1 User Provided Information
- **Account Information**: When you register for BugMind AI, we collect your email address.
- **Jira/Xray Credentials**: To interact with your Jira instance, we collect and store your Jira host URL, username, and API tokens. These are **encrypted at rest** using industry-standard AES-GCM encryption.

### 1.2 Data Processed by the Extension
- **Jira Issue Data**: The extension scrapes Jira story details (summary, description, acceptance criteria) from the active tab to generate bug reports and test cases.
- **PII Redaction**: Before any Jira content is sent to our AI backend, it is processed by a local redaction pipeline that scrubs sensitive information, including email addresses, JWT tokens, and long numeric identifiers.

## 2. How We Use Your Information

- **To Provide Our Service**: We use your data to generate AI-powered QA content, sync it back to Jira/Xray, and manage your team's workspaces.
- **AI Processing**: Redacted Jira content is sent to OpenRouter (our AI provider) to generate bug reports and test cases. No PII is shared with our AI provider.
- **Audit Logging**: We record workspace actions (e.g., template creation, connection sharing) for security and accountability purposes.

## 3. Data Storage and Security

- **Encryption at Rest**: All sensitive credentials (Jira tokens, API keys) are encrypted using AES-GCM before storage in our PostgreSQL database.
- **In-Browser Storage**: We use `chrome.storage.local` to store session tokens. These tokens are obfuscated to prevent cleartext exposure.
- **Communication Security**: All communication between the extension and our backend, and between our backend and third-party APIs (Jira, OpenRouter, Stripe), is encrypted via HTTPS (TLS).

## 4. Third-Party Services

We integrate with the following third-party services:
- **Jira (Atlassian)**: For fetching and publishing bug/test data.
- **OpenRouter**: For AI generation (receives redacted data only).
- **Stripe**: For subscription management and billing.
- **Render**: For hosting our backend API and database.

## 5. Your Rights and Choices

- **Data Access**: You can view your workspace data and connections through the BugMind AI interface.
- **Data Deletion**: You can delete your Jira connections or workspace templates at any time. To request full account deletion, please contact support.

## 6. Changes to This Policy

We may update this Privacy Policy from time to time. We will notify you of any significant changes by posting the new policy on our website or within the extension interface.

## 7. Contact Us

If you have any questions about this Privacy Policy, please contact us at:
[Your Support Email/Contact Link]
