import { ApiError, getErrorMessage } from '../services/api';

export interface TranslatedError {
  title: string;
  description: string;
  userAction?: string;
  traceId?: string;
}

export function translateError(error: unknown, context?: string): TranslatedError {
  const message = getErrorMessage(error);
  const status = error instanceof ApiError ? error.status : undefined;
  const code = error instanceof ApiError ? error.code : undefined;
  const userActionFromApi = error instanceof ApiError ? error.userAction : undefined;
  const traceId = error instanceof ApiError ? error.traceId : undefined;
  const details = error instanceof ApiError ? error.details : undefined;

  const result: TranslatedError = {
    title: status && status >= 500 ? 'Server Error' : 'Unexpected Error',
    description: message,
    userAction: userActionFromApi,
    traceId,
  };

  // 1. Handle network/general fetch errors
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    result.title = 'Connection Failed';
    result.description = 'Could not reach the BugMind server. Please check your internet connection and verify the API URL in Setup.';
  } else if (message.includes('Request timed out after')) {
    result.title = 'BugMind API Unreachable';
    result.description = 'The configured BugMind API endpoint did not respond in time. Make sure the backend server is running and the API URL in Setup is correct.';
  } else if (message.includes('Timeout') || message.includes('Aborted') || message.includes('The user aborted a request')) {
    result.title = 'Request Timed Out';
    result.description = 'The operation is taking longer than expected. Please check your connection and try again.';
  } else if (message.includes('AI returned an unreadable response')) {
    result.title = 'AI Response Failed';
    result.description = 'The AI service responded, but the result was malformed. Please try again.';
  } else if (status === 413 || message.includes('payload too large')) {
    result.title = 'Request Too Large';
    result.description = 'The data sent to BugMind was too large to process. Reduce the input size and try again.';
  } else if (message.includes('Timed out connecting to Jira')) {
    result.title = 'Jira Connection Timed Out';
    result.description = message;
  }
  // 2. Handle Auth Errors
  else if (message === 'Unauthorized' || message.includes('401')) {
    result.title = 'Session Expired';
    result.description = 'Your session has expired or access was denied. Please sign in again to continue.';
  } else if (message.includes('Could not validate credentials') || message === 'Invalid token' || message === 'User not found') {
    result.title = 'Session Expired';
    result.description = 'Your login session is no longer valid. Sign in again to continue.';
  } else if (message.includes('Forbidden') || message.includes('403')) {
    result.title = 'Access Restricted';
    result.description = 'You do not have the required permissions. Please verify your account access level.';
  } else if (message.includes('Unauthorized request origin')) {
    result.title = 'Connection Blocked';
    result.description = 'This BugMind build is not authorized to call the backend. Verify the configured extension origin on the server.';
  } else if (message.includes('Invalid credentials') || message.includes('Incorrect email or password') || (context === 'login' && message.toLowerCase().includes('failed'))) {
    result.title = 'Login Failed';
    result.description = 'Invalid email or password. Please double-check your credentials and try again.';
  } else if (message.includes('User already exists') || message.includes('registered')) {
    result.title = 'Account Exists';
    result.description = 'An account with this email already exists. Try signing in instead.';
  } else if (message.includes('Inactive user')) {
    result.title = 'Account Inactive';
    result.description = 'Your account is currently inactive. Contact support if you believe this is a mistake.';
  } else if (message.includes('Invalid reset code')) {
    result.title = 'Reset Code Invalid';
    result.description = 'The reset code is invalid or expired. Request a new code and try again.';
  } else if (message.includes('Password must')) {
    result.title = 'Password Requirements';
    result.description = message;
  } else if (message.includes('Passwords do not match')) {
    result.title = 'Passwords Do Not Match';
    result.description = 'Enter the same password in both fields before continuing.';
  } else if (message.includes('Google sign-in')) {
    result.title = 'Google Sign-In Failed';
    result.description = message;
  } else if (message.includes('No subscription found')) {
    result.title = 'Subscription Missing';
    result.description = 'No active BugMind subscription was found for this account. Sign out and back in, or contact support.';
  }
  // 3. Handle Jira Errors
  else if (message.includes('Access Denied') || message.includes('permissions') || message.includes('not found')) {
    result.title = 'Jira Access Issue';
    result.description = message.includes('Browse Projects') 
      ? message 
      : 'Access denied to Jira. Please verify your API Token permissions and project access.';
  } else if (message.includes('Jira fields') || message.includes('issue types')) {
    result.title = 'Jira Sync Failed';
    result.description = 'We had trouble pulling configuration from Jira. Ensure your URLs and API tokens are correct.';
  } else if (message.includes('Jira Connection Stale')) {
    result.title = 'Saved Jira Connection Expired';
    result.description = 'The saved Jira connection can no longer be decrypted. Delete it and add it again.';
  } else if (message.includes('Jira Cloud authentication failed') || message.includes('Jira Server authentication failed')) {
    result.title = 'Jira Authentication Failed';
    result.description = 'BugMind could not authenticate to Jira. Verify the username/email and API token or PAT.';
  } else if (message.includes('Jira Cloud access denied') || message.includes('Jira Server access denied')) {
    result.title = 'Jira Access Denied';
    result.description = 'The Jira account connected to BugMind does not have enough permissions for this action.';
  } else if (message.includes('Failed to reach Jira') || message.includes('Failed to connect to Jira')) {
    result.title = 'Jira Unreachable';
    result.description = 'BugMind could not reach Jira. Check the Jira base URL, VPN/network access, and SSL settings.';
  } else if (message.includes('Missing Jira context')) {
    result.title = 'Jira Context Missing';
    result.description = 'Open a Jira issue and let BugMind load its project and issue type details before trying again.';
  } else if (message.includes('Security Alert: Your active Jira connection')) {
    result.title = 'Jira Connection Mismatch';
    result.description = 'The Jira page you are viewing does not match the Jira connection selected in BugMind. Switch to the matching connection and try again.';
  } else if (message.includes('Failed to fetch Jira configurations')) {
    result.title = 'Jira Configuration Unavailable';
    result.description = 'BugMind could not load Jira field configuration for this project and issue type. Verify that both exist and that your Jira account can access them.';
  } else if (message.includes('Could not resolve Jira project context from the current page')) {
    result.title = 'Project Context Missing';
    result.description = 'BugMind could not determine the Jira project from this page. Open the issue directly inside Jira and try again.';
  } else if (message.includes('No Jira issue types could be resolved') || message.includes('Could not resolve a Jira issue type')) {
    result.title = 'Issue Types Unavailable';
    result.description = 'BugMind could not resolve Jira issue types for this project. Verify the project configuration and your Jira permissions.';
  } else if (message.includes('No Jira connections found') || message.includes('Connection not found')) {
    result.title = 'Jira Connection Missing';
    result.description = 'No valid Jira connection is available. Reconnect Jira in Settings and try again.';
  } else if (message.includes('A valid Jira instance URL is required') || message.includes('Invalid Jira URL') || message.includes('Jira URL must')) {
    result.title = 'Invalid Jira URL';
    result.description = 'The Jira URL is invalid or blocked by security rules. Use a clean Jira base URL such as `https://company.atlassian.net`.';
  } else if (message.includes('API Token cannot be empty')) {
    result.title = 'Missing Jira Token';
    result.description = 'The Jira API token or PAT cannot be empty.';
  } else if (message.startsWith('XRAY_TEST_ISSUE_TYPE_MISSING:') || message.includes('Could not find an Xray Test issue type')) {
    const projectRef = message.split(':')[1] || 'the selected project';
    result.title = 'Xray Not Available';
    result.description = `Project ${projectRef} does not expose a Jira issue type for Xray Tests. Add Xray Test issue types to that project or choose a different test repository project.`;
  } else if (message.includes('Xray Cloud publishing is not enabled') || message.includes('Xray publishing is not available')) {
    result.title = 'Xray Publish Unsupported';
    result.description = message;
  } else if (message.includes('AI Bug Generation Failed') || message.includes('AI Test Suite Generation Failed') || message.includes('AI Service Error')) {
    result.title = 'AI Generation Failed';
    result.description = 'BugMind could not get a usable response from the AI provider. Please try again in a moment.';
  } else if (message.includes('A valid Xray folder path is required')) {
    result.title = 'Xray Folder Required';
    result.description = 'Choose a valid Xray folder path before publishing test cases.';
  } else if (message.includes('Xray Cloud requires XRAY_CLOUD_CLIENT_ID') || message.includes('Failed to authenticate to Xray Cloud') || message.includes('Xray Cloud authentication returned an empty token')) {
    result.title = 'Xray Cloud Unavailable';
    result.description = 'Xray Cloud is not configured correctly on the backend. Contact the BugMind administrator.';
  } else if (message.includes('Xray Cloud publishing is now separated')) {
    result.title = 'Xray Cloud Setup Required';
    result.description = 'Xray Cloud publishing uses the separated Cloud setup. Add Xray Cloud credentials in Settings and try again.';
  } else if (message.includes('No test cases were provided for Xray publishing')) {
    result.title = 'No Test Cases To Publish';
    result.description = 'Generate test cases first, then publish them to Xray.';
  } else if (message.includes('Connection mismatch for Xray publish request')) {
    result.title = 'Xray Connection Mismatch';
    result.description = 'The selected Xray publish connection no longer matches the current request. Reload the screen and try again.';
  } else if (message.includes('base_url')) {
    result.title = 'Invalid Jira URL';
    result.description = 'The Jira Base URL provided is invalid. It should usually look like https://your-company.atlassian.net';
  }
  // 4. Handle AI Errors
  else if (message.includes('AI Quota Exceeded') || message.includes('402') || message.includes('credits')) {
    result.title = 'AI Credits Exhausted';
    result.description = 'Your AI credit limit has been reached. Please check your OpenRouter account settings or add credits.';
  } else if (code === 'RATE_LIMITED' || status === 429 || message.includes('429') || message.includes('Too many requests')) {
    const retryAfterSeconds = (Array.isArray(details) ? details : []).find(
      (item): item is { retry_after_seconds: number } => 
        !!item && typeof item === 'object' && 'retry_after_seconds' in item
    );

    result.title = 'Rate Limit Reached';
    result.description = typeof retryAfterSeconds?.retry_after_seconds === 'number'
      ? `Too many requests were sent too quickly. Wait about ${retryAfterSeconds.retry_after_seconds} seconds and try again.`
      : 'You have reached the limit of requests for now. Please wait a few minutes before trying again.';
  } else if (message.includes('Free tier limit reached')) {
    result.title = 'Plan Limit Reached';
    result.description = 'You have reached the current BugMind plan limit. Upgrade your plan or wait until the quota resets.';
  } else if (message.includes('AI Service is not configured')) {
    result.title = 'AI Not Configured';
    result.description = 'The backend does not have a working AI provider key. Add an OpenRouter key in Settings or configure the server.';
  } else if (message.includes('AI Service Error') || message.includes('AI Connection Failed')) {
    result.title = 'AI Provider Unavailable';
    result.description = 'BugMind could not reach the AI provider or received an invalid upstream response. Try again in a moment.';
  } else if (message.includes('AI Analysis failed') || message.includes('content') || message.includes('Empty response')) {
    result.title = 'AI Analysis Error';
    result.description = 'BugMind AI failed to analyze the issue. This might be a temporary issue with the AI provider. Please try again.';
  }
  // 5. Page State Errors
  else if (message === 'STALE_PAGE') {
    result.title = 'Reconnecting to Jira';
    result.description = 'BugMind is automatically trying to reconnect to the current Jira issue.';
  } else if (message === 'NOT_A_JIRA_PAGE') {
    result.title = 'Awaiting Context';
    result.description = 'Navigate to a Jira ticket to start analysis.';
  } else if (message === 'UNSUPPORTED_ISSUE_TYPE') {
    result.title = 'Not a User Story';
    result.description = 'BugMind is optimized for Requirement Analysis of User Stories.';
  } else if (message === 'MISSING_ISSUE_TYPE') {
    result.title = 'Jira Config Still Loading';
    result.description = 'Wait for Jira issue types to load, then try the analysis again.';
  }

  return result;
}
