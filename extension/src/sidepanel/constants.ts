/**
 * BugMind Side Panel Constants
 * Centralized configuration for timeouts, intervals, and functional limits.
 */

export const TIMEOUTS = {
  API_REQUEST: 10000,
  USER_SEARCH_DEBOUNCE: 400,
  STORAGE_SYNC_DEBOUNCE: 1000,
  NOTIFICATION_AUTO_HIDE: 3000,
  NOTIFICATION_AUTO_HIDE_LONG: 5000,
};

export const INTERVALS = {
  CONTEXT_DISCOVERY: 5000,
};

export const LIMITS = {
  MAX_DEBUG_LOGS: 200,
};

export const DOMAINS = {
  JIRA_CLOUD: '.atlassian.net',
  BROWSE_PATH: '/browse/',
  ISSUES_PATH: '/issues/',
};

export const APP_VERSION = 'v1.2.0-PRO';
