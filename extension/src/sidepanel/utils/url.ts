/**
 * URL Utilities for BugMind Side Panel
 * Shared functions for API endpoint normalization and validation.
 */

import { DEFAULT_API_BASE as DEFAULT_API_BASE_CONST } from '../constants';

/**
 * Normalize a BugMind API base URL to canonical form.
 *
 * Rules:
 * - Trim whitespace and trailing slashes
 * - Remove any path segments like /auth, /jira, /ai, /settings, /stripe
 * - Ensure ends with /api/v1
 * - Fallback to DEFAULT_API_BASE if empty after trimming
 *
 * @param url - The URL to normalize (may be null/undefined)
 * @returns Normalized API base URL guaranteed to end with /api/v1
 */
export function normalizeApiBase(url: string | null | undefined): string {
  let trimmed = (url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE_CONST;

  trimmed = trimmed.replace(/\/(auth|jira|ai|settings|stripe)(?:\/.*)?$/i, '');

  if (trimmed.endsWith('/api')) {
    return `${trimmed}/v1`;
  }

  if (!trimmed.endsWith('/api/v1')) {
    trimmed = trimmed.replace(/\/api\/v1\/.*$/i, '/api/v1');
  }

  return trimmed;
}

// Re-export for consumers who import from utils/url
export { DEFAULT_API_BASE_CONST as DEFAULT_API_BASE };
