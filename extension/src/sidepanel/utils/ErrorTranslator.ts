export interface TranslatedError {
  title: string;
  description: string;
}

export function translateError(error: unknown, context?: string): TranslatedError {
  let message = 'Unknown error occurred';
  
  if (typeof error === 'string') {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String((error as { message: unknown }).message);
  }
  
  // 1. Handle network/general fetch errors
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return {
      title: 'Connection Failed',
      description: 'Could not reach the BugMind server. Please check your internet connection and verify the API URL in Setup.'
    };
  }

  if (message.includes('Timeout') || message.includes('Aborted') || message.includes('The user aborted a request')) {
    return {
      title: 'Request Timed Out',
      description: 'The operation is taking longer than expected. Please check your connection and try again.'
    };
  }

  // 2. Handle Auth Errors
  if (message === 'Unauthorized' || message.includes('401')) {
    return {
      title: 'Session Expired',
      description: 'Your session has expired or access was denied. Please sign in again to continue.'
    };
  }

  if (message.includes('Forbidden') || message.includes('403')) {
    return {
      title: 'Access Restricted',
      description: 'You do not have the required permissions. Please verify your account access level.'
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

  // 3. Handle Jira Errors
  if (message.includes('Jira fields') || message.includes('issue types')) {
    return {
      title: 'Jira Sync Failed',
      description: 'We had trouble pulling configuration from Jira. Ensure your URLs and API tokens are correct.'
    };
  }

  if (message.includes('base_url')) {
    return {
      title: 'Invalid Jira URL',
      description: 'The Jira Base URL provided is invalid. It should usually look like https://your-company.atlassian.net'
    };
  }

  // 4. Handle AI Errors
  if (message.includes('AI Analysis failed') || message.includes('content') || message.includes('Empty response')) {
    return {
      title: 'AI Analysis Error',
      description: 'BugMind AI failed to analyze the issue. This might be a temporary issue with the AI provider. Please try again.'
    };
  }

  if (message.includes('429') || message.includes('limit')) {
    return {
      title: 'Rate Limit Reached',
      description: 'You have reached the limit of requests for now. Please wait a few minutes before trying again.'
    };
  }

  // 5. Page State Errors
  if (message === 'STALE_PAGE') {
    return {
      title: 'Page Connection Lost',
      description: 'The connection to the Jira page is stale. Please refresh the browser tab to continue.'
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

  // Fallback for custom detail messages from backend
  return {
    title: 'Unexpected Error',
    description: message
  };
}
