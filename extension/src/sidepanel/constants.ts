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

export const BULK = {
  FEATURE_FLAG_KEY: 'bugmind_bulk_mode',
  REQUEST_DELAY_MS: 1200,
  RATE_LIMIT_RETRY_MS: 10000,
};

export const DOMAINS = {
  JIRA_CLOUD: '.atlassian.net',
  BROWSE_PATH: '/browse/',
  ISSUES_PATH: '/issues/',
};

export const DEFAULT_API_BASE = 'https://bugmind-ai-monorepo.onrender.com/api/v1';

export const APP_VERSION = 'v1.0.0-PRO';
