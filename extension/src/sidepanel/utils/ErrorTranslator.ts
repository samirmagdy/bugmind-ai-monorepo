import { ApiError, getErrorMessage } from '../services/api';

export interface TranslatedError {
  title: string;
  description: string;
}

export function translateError(error: unknown, context?: string): TranslatedError {
  const message = getErrorMessage(error);
  const status = error instanceof ApiError ? error.status : undefined;
  const code = error instanceof ApiError ? error.code : undefined;
  const details = error instanceof ApiError ? error.details : undefined;
  
  // 1. Handle network/general fetch errors
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return {
      title: 'Connection Failed',
      description: 'Could not reach the BugMind server. Please check your internet connection and verify the API URL in Setup.'
    };
  }

  if (message.includes('Request timed out after')) {
    return {
      title: 'BugMind API Unreachable',
      description: 'The configured BugMind API endpoint did not respond in time. Make sure the backend server is running and the API URL in Setup is correct.'
    };
  }

  if (message.includes('Timeout') || message.includes('Aborted') || message.includes('The user aborted a request')) {
    return {
      title: 'Request Timed Out',
      description: 'The operation is taking longer than expected. Please check your connection and try again.'
    };
  }

  if (status === 413 || message.includes('payload too large')) {
    return {
      title: 'Request Too Large',
      description: 'The data sent to BugMind was too large to process. Reduce the input size and try again.'
    };
  }

  if (message.includes('Timed out connecting to Jira')) {
    return {
      title: 'Jira Connection Timed Out',
      description: message
    };
  }

  // 2. Handle Auth Errors
  if (message === 'Unauthorized' || message.includes('401')) {
    return {
      title: 'Session Expired',
      description: 'Your session has expired or access was denied. Please sign in again to continue.'
    };
  }

  if (message.includes('Could not validate credentials') || message === 'Invalid token' || message === 'User not found') {
    return {
      title: 'Session Expired',
      description: 'Your login session is no longer valid. Sign in again to continue.'
    };
  }

  if (message.includes('Forbidden') || message.includes('403')) {
    return {
      title: 'Access Restricted',
      description: 'You do not have the required permissions. Please verify your account access level.'
    };
  }

  if (message.includes('Unauthorized request origin')) {
    return {
      title: 'Connection Blocked',
      description: 'This BugMind build is not authorized to call the backend. Verify the configured extension origin on the server.'
    };
  }

  if (message.includes('Invalid credentials') || (context === 'login' && message.toLowerCase().includes('failed'))) {
    return {
      title: 'Login Failed',
      description: 'Invalid email or password. Please double-check your credentials and try again.'
    };
  }

  if (message.includes('User already exists') || message.includes('registered')) {
    return {
      title: 'Account Exists',
      description: 'An account with this email already exists. Try signing in instead.'
    };
  }

  if (message.includes('Inactive user')) {
    return {
      title: 'Account Inactive',
      description: 'Your account is currently inactive. Contact support if you believe this is a mistake.'
    };
  }

  if (message.includes('No subscription found')) {
    return {
      title: 'Subscription Missing',
      description: 'No active BugMind subscription was found for this account. Sign out and back in, or contact support.'
    };
  }

  // 3. Handle Jira Errors
  if (message.includes('Access Denied') || message.includes('permissions') || message.includes('not found')) {
    return {
      title: 'Jira Access Issue',
      description: message.includes('Browse Projects') 
        ? message 
        : 'Access denied to Jira. Please verify your API Token permissions and project access.'
    };
  }

  if (message.includes('Jira fields') || message.includes('issue types')) {
    return {
      title: 'Jira Sync Failed',
      description: 'We had trouble pulling configuration from Jira. Ensure your URLs and API tokens are correct.'
    };
  }

  if (message.includes('Jira Connection Stale')) {
    return {
      title: 'Saved Jira Connection Expired',
      description: 'The saved Jira connection can no longer be decrypted. Delete it and add it again.'
    };
  }

  if (message.includes('Jira Cloud authentication failed') || message.includes('Jira Server authentication failed')) {
    return {
      title: 'Jira Authentication Failed',
      description: 'BugMind could not authenticate to Jira. Verify the username/email and API token or PAT.'
    };
  }

  if (message.includes('Jira Cloud access denied') || message.includes('Jira Server access denied')) {
    return {
      title: 'Jira Access Denied',
      description: 'The Jira account connected to BugMind does not have enough permissions for this action.'
    };
  }

  if (message.includes('Failed to reach Jira') || message.includes('Failed to connect to Jira')) {
    return {
      title: 'Jira Unreachable',
      description: 'BugMind could not reach Jira. Check the Jira base URL, VPN/network access, and SSL settings.'
    };
  }

  if (message.includes('Missing Jira context')) {
    return {
      title: 'Jira Context Missing',
      description: 'Open a Jira issue and let BugMind load its project and issue type details before trying again.'
    };
  }

  if (message.includes('Security Alert: Your active Jira connection')) {
    return {
      title: 'Jira Connection Mismatch',
      description: 'The Jira page you are viewing does not match the Jira connection selected in BugMind. Switch to the matching connection and try again.'
    };
  }

  if (message.includes('Failed to fetch Jira configurations')) {
    return {
      title: 'Jira Configuration Unavailable',
      description: 'BugMind could not load Jira field configuration for this project and issue type. Verify that both exist and that your Jira account can access them.'
    };
  }

  if (message.includes('Could not resolve Jira project context from the current page')) {
    return {
      title: 'Project Context Missing',
      description: 'BugMind could not determine the Jira project from this page. Open the issue directly inside Jira and try again.'
    };
  }

  if (message.includes('No Jira issue types could be resolved') || message.includes('Could not resolve a Jira issue type')) {
    return {
      title: 'Issue Types Unavailable',
      description: 'BugMind could not resolve Jira issue types for this project. Verify the project configuration and your Jira permissions.'
    };
  }

  if (message.includes('No Jira connections found') || message.includes('Connection not found')) {
    return {
      title: 'Jira Connection Missing',
      description: 'No valid Jira connection is available. Reconnect Jira in Settings and try again.'
    };
  }

  if (message.includes('A valid Jira instance URL is required') || message.includes('Invalid Jira URL') || message.includes('Jira URL must')) {
    return {
      title: 'Invalid Jira URL',
      description: 'The Jira URL is invalid or blocked by security rules. Use a clean Jira base URL such as `https://company.atlassian.net`.'
    };
  }

  if (message.includes('API Token cannot be empty')) {
    return {
      title: 'Missing Jira Token',
      description: 'The Jira API token or PAT cannot be empty.'
    };
  }

  if (message.startsWith('XRAY_TEST_ISSUE_TYPE_MISSING:') || message.includes('Could not find an Xray Test issue type')) {
    const projectRef = message.split(':')[1] || 'the selected project';
    return {
      title: 'Xray Not Available',
      description: `Project ${projectRef} does not expose a Jira issue type for Xray Tests. Add Xray Test issue types to that project or choose a different test repository project.`
    };
  }

  if (message.includes('Xray Cloud publishing is not enabled') || message.includes('Xray publishing is not available')) {
    return {
      title: 'Xray Publish Unsupported',
      description: message
    };
  }

  if (message.includes('A valid Xray folder path is required')) {
    return {
      title: 'Xray Folder Required',
      description: 'Choose a valid Xray folder path before publishing test cases.'
    };
  }

  if (message.includes('Xray Cloud requires XRAY_CLOUD_CLIENT_ID') || message.includes('Failed to authenticate to Xray Cloud') || message.includes('Xray Cloud authentication returned an empty token')) {
    return {
      title: 'Xray Cloud Unavailable',
      description: 'Xray Cloud is not configured correctly on the backend. Contact the BugMind administrator.'
    };
  }

  if (message.includes('Xray Cloud publishing is now separated')) {
    return {
      title: 'Xray Cloud Not Implemented',
      description: 'This BugMind deployment does not yet support publishing test cases to Xray Cloud.'
    };
  }

  if (message.includes('No test cases were provided for Xray publishing')) {
    return {
      title: 'No Test Cases To Publish',
      description: 'Generate test cases first, then publish them to Xray.'
    };
  }

  if (message.includes('Connection mismatch for Xray publish request')) {
    return {
      title: 'Xray Connection Mismatch',
      description: 'The selected Xray publish connection no longer matches the current request. Reload the screen and try again.'
    };
  }

  if (message.includes('base_url')) {
    return {
      title: 'Invalid Jira URL',
      description: 'The Jira Base URL provided is invalid. It should usually look like https://your-company.atlassian.net'
    };
  }

  // 4. Handle AI Errors
  if (message.includes('AI Quota Exceeded') || message.includes('402') || message.includes('credits')) {
    return {
      title: 'AI Credits Exhausted',
      description: 'Your AI credit limit has been reached. Please check your OpenRouter account settings or add credits.'
    };
  }

  if (code === 'RATE_LIMITED' || status === 429 || message.includes('429') || message.includes('Too many requests')) {
    const retryAfterSeconds = details?.find((item) => item && typeof item === 'object' && 'retry_after_seconds' in (item as Record<string, unknown>)) as
      | { retry_after_seconds?: unknown }
      | undefined;

    return {
      title: 'Rate Limit Reached',
      description: typeof retryAfterSeconds?.retry_after_seconds === 'number'
        ? `Too many requests were sent too quickly. Wait about ${retryAfterSeconds.retry_after_seconds} seconds and try again.`
        : 'You have reached the limit of requests for now. Please wait a few minutes before trying again.'
    };
  }

  if (message.includes('Free tier limit reached')) {
    return {
      title: 'Plan Limit Reached',
      description: 'You have reached the current BugMind plan limit. Upgrade your plan or wait until the quota resets.'
    };
  }

  if (message.includes('AI Service is not configured')) {
    return {
      title: 'AI Not Configured',
      description: 'The backend does not have a working AI provider key. Add an OpenRouter key in Settings or configure the server.'
    };
  }

  if (message.includes('AI Service Error') || message.includes('AI Connection Failed')) {
    return {
      title: 'AI Provider Unavailable',
      description: 'BugMind could not reach the AI provider or received an invalid upstream response. Try again in a moment.'
    };
  }

  if (message.includes('AI Analysis failed') || message.includes('content') || message.includes('Empty response')) {
    return {
      title: 'AI Analysis Error',
      description: 'BugMind AI failed to analyze the issue. This might be a temporary issue with the AI provider. Please try again.'
    };
  }

  // 5. Page State Errors
  if (message === 'STALE_PAGE') {
    return {
      title: 'Reconnecting to Jira',
      description: 'BugMind is automatically trying to reconnect to the current Jira issue.'
    };
  }

  if (message === 'NOT_A_JIRA_PAGE') {
    return {
      title: 'Awaiting Context',
      description: 'Navigate to a Jira ticket to start analysis.'
    };
  }

  if (message === 'UNSUPPORTED_ISSUE_TYPE') {
    return {
      title: 'Not a User Story',
      description: 'BugMind is optimized for Requirement Analysis of User Stories.'
    };
  }

  if (message === 'MISSING_ISSUE_TYPE') {
    return {
      title: 'Jira Config Still Loading',
      description: 'Wait for Jira issue types to load, then try the analysis again.'
    };
  }

  // Fallback for custom detail messages from backend
  return {
    title: status && status >= 500 ? 'Server Error' : 'Unexpected Error',
    description: message
  };
}
