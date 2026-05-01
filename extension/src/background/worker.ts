/**
 * worker.ts
 * Background service worker for BugMind AI.
 * Handles tab orchestration, context discovery, and sidepanel sync.
 */

import { deobfuscate } from '../sidepanel/utils/StorageObfuscator';

// Deployment Metadata
const VERSION = '1.2.0';
const DEFAULT_API_BASE = 'https://bugmind-ai-monorepo.onrender.com/api/v1';
const BULK_MODE_DEFAULT = true;
const DOMAINS = {
  JIRA_CLOUD: '.atlassian.net',
  BROWSE_PATH: '/browse/',
  ISSUES_PATH: '/issues/',
};

interface ExtractedIssueData {
  key: string;
  projectId: string;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  typeName: string;
  theme: 'light' | 'dark';
}

interface TabContext {
  issueData: ExtractedIssueData | null;
  instanceUrl: string | null;
  error: string | null;
}

interface GetCurrentContextMessage {
  type: 'GET_CURRENT_CONTEXT';
  tabId: number;
  force?: boolean;
}

interface ThemeChangedMessage {
  type: 'THEME_CHANGED';
  theme: 'light' | 'dark';
}

interface JiraContextChangedMessage {
  type: 'JIRA_CONTEXT_CHANGED';
  url?: string;
}

interface BulkStory {
  key: string;
  summary?: string;
  description?: string | Record<string, unknown> | null;
  acceptanceCriteria?: string;
  risk_score?: number;
  risk_reasons?: string[];
}

interface BulkMessage {
  action: 'BULK_FETCH' | 'BULK_GENERATE' | 'BULK_ANALYZE' | 'PROCESS_GOAL' | 'FETCH_ATTACHMENT';
  tabId?: number;
  payload?: Record<string, unknown>;
}

function normalizeJiraUrl(url: string | null | undefined): string {
  if (!url) return '';

  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    const issuePathMatch = normalizedPath.match(/^(.*?)(\/browse\/|\/issues\/|\/projects\/)/);
    const basePath = issuePathMatch ? issuePathMatch[1] : normalizedPath;
    return `${parsed.origin}${basePath}`.replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function normalizeApiBase(url: string | null | undefined): string {
  let trimmed = (url || '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE;
  trimmed = trimmed.replace(/\/(auth|jira|ai|settings|stripe)(?:\/.*)?$/i, '');
  if (trimmed.endsWith('/api')) return `${trimmed}/v1`;
  if (!trimmed.endsWith('/api/v1')) {
    trimmed = trimmed.replace(/\/api\/v1\/.*$/i, '/api/v1');
  }
  return trimmed.endsWith('/api') ? `${trimmed}/v1` : trimmed;
}

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) <= 31);
}

function decodeStoredToken(encoded: string | undefined): string {
  if (!encoded) return '';
  const decoded = deobfuscate(encoded);
  if (decoded && decoded.split('.').length === 3 && !containsControlCharacters(decoded)) {
    return decoded;
  }
  try {
    const legacy = atob(encoded);
    if (legacy && legacy.split('.').length === 3 && !containsControlCharacters(legacy)) {
      return legacy;
    }
  } catch {
    // Ignore legacy decode failure.
  }
  return decoded;
}

function storageLocalGet<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return new Promise((resolve) => chrome.storage.local.get(keys, (value) => resolve(value as T)));
}

function storageSessionGet<T extends Record<string, unknown>>(keys: string[]): Promise<T> {
  return new Promise((resolve) => chrome.storage.session.get(keys, (value) => resolve(value as T)));
}

async function getWorkerAuthContext(payload?: Record<string, unknown>): Promise<{ apiBase: string; token: string }> {
  const local = await storageLocalGet<Record<string, unknown>>(['bugmind_api_base', 'bugmind_token']);
  const session = await storageSessionGet<Record<string, unknown>>(['bugmind_token']);
  const explicitToken = typeof payload?.authToken === 'string' ? payload.authToken : '';
  const token = explicitToken || decodeStoredToken((session.bugmind_token || local.bugmind_token) as string | undefined);
  const apiBase = normalizeApiBase(typeof payload?.apiBase === 'string' ? payload.apiBase : local.bugmind_api_base as string | undefined);

  if (!token) throw new Error('Bulk action requires an authenticated BugMind session.');
  return { apiBase, token };
}

async function isBulkModeEnabled(): Promise<boolean> {
  const local = await storageLocalGet<{ bugmind_bulk_mode?: boolean }>(['bugmind_bulk_mode']);
  return local.bugmind_bulk_mode ?? BULK_MODE_DEFAULT;
}

async function backendFetch<T>(path: string, options: RequestInit, payload?: Record<string, unknown>): Promise<T> {
  const { apiBase, token } = await getWorkerAuthContext(payload);
  const url = `${apiBase}${path}`;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${token}`,
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const retryable = response.status === 429;
    let message = body || `Request failed with status ${response.status}`;
    if (response.status === 404 && path.includes('/bulk/epic')) {
      message = `Bulk API endpoint was not found at ${url}. Confirm the backend is deployed with the latest bulk Jira routes. Response: ${body || 'Not Found'}`;
    } else {
      message = `Request failed at ${url} with status ${response.status}: ${message}`;
    }
    const error = new Error(message) as Error & { status?: number; retryable?: boolean };
    error.status = response.status;
    error.retryable = retryable;
    throw error;
  }
  return await response.json() as T;
}

function broadcastProgress(action: string, tabId: number | undefined, message: string, percent: number): void {
  chrome.runtime.sendMessage({
    action,
    tabId,
    payload: { message, percent: Math.max(0, Math.min(100, Math.round(percent))) }
  }).catch(() => {});
}

function buildBulkAIRequest(payload: Record<string, unknown>, stories: BulkStory[]) {
  const issueTypeId = String(payload.issueTypeId || payload.issue_type_id || '');
  const projectKey = String(payload.projectKey || payload.project_key || '');
  if (!issueTypeId || stories.length === 0) {
    throw new Error('Bulk AI action requires issueTypeId and stories.');
  }
  return {
    jira_connection_id: Number(payload.jiraConnectionId),
    stories,
    instance_url: payload.instanceUrl || payload.instance_url || null,
    project_key: projectKey || (stories[0].key.includes('-') ? stories[0].key.split('-')[0] : ''),
    project_id: payload.projectId || payload.project_id || undefined,
    issue_type_id: issueTypeId,
    issue_type_name: payload.issueTypeName || payload.issue_type_name || 'Story',
    supporting_context: payload.supportingContext || payload.supporting_context || '',
  };
}

async function startBulkFetch(message: BulkMessage): Promise<unknown> {
  if (!await isBulkModeEnabled()) throw new Error('BULK_MODE is disabled.');
  const payload = message.payload || {};
  const jiraConnectionId = Number(payload.jiraConnectionId);
  const epicKey = String(payload.epicKey || '').trim();
  if (!jiraConnectionId || !epicKey) throw new Error('BULK_FETCH requires jiraConnectionId and epicKey.');

  broadcastProgress('bulkFetchProgress', message.tabId, `Fetching stories for ${epicKey}...`, 10);
  const result = await backendFetch<unknown>(
    `/jira/connections/${jiraConnectionId}/bulk/epic`,
    {
      method: 'POST',
      body: JSON.stringify({ epic_key: epicKey, max_results: Number(payload.maxResults || 100) })
    },
    payload
  );
  broadcastProgress('bulkFetchProgress', message.tabId, `Fetched stories for ${epicKey}.`, 100);
  return result;
}

async function startBulkGeneration(message: BulkMessage): Promise<unknown> {
  if (!await isBulkModeEnabled()) throw new Error('BULK_MODE is disabled.');
  const payload = message.payload || {};
  const stories = (Array.isArray(payload.stories) ? payload.stories : []) as BulkStory[];
  const jiraConnectionId = Number(payload.jiraConnectionId);
  if (!jiraConnectionId || stories.length === 0) {
    throw new Error('BULK_GENERATE requires jiraConnectionId, issueTypeId, and stories.');
  }

  broadcastProgress('bulkGenerationProgress', message.tabId, `Generating tests for ${stories.length} stories...`, 10);
  const result = await backendFetch<unknown>(
    '/ai/bulk/test-cases',
    { method: 'POST', body: JSON.stringify(buildBulkAIRequest(payload, stories)) },
    payload,
  );
  broadcastProgress('bulkGenerationProgress', message.tabId, 'Bulk test generation complete.', 100);
  return result;
}

async function startBulkAnalysis(message: BulkMessage): Promise<unknown> {
  if (!await isBulkModeEnabled()) throw new Error('BULK_MODE is disabled.');
  const payload = message.payload || {};
  const stories = (Array.isArray(payload.stories) ? payload.stories : []) as BulkStory[];
  const jiraConnectionId = Number(payload.jiraConnectionId);
  if (!jiraConnectionId || stories.length === 0) {
    throw new Error('BULK_ANALYZE requires jiraConnectionId, issueTypeId, and stories.');
  }

  broadcastProgress('bulkAnalysisProgress', message.tabId, `Analyzing ${stories.length} stories...`, 25);
  const result = await backendFetch<unknown>(
    '/ai/bulk/analyze',
    { method: 'POST', body: JSON.stringify(buildBulkAIRequest(payload, stories)) },
    payload,
  );
  broadcastProgress('bulkAnalysisProgress', message.tabId, 'Cross-story audit complete.', 100);
  return result;
}

async function fetchAttachment(message: BulkMessage): Promise<unknown> {
  const payload = message.payload || {};
  const jiraConnectionId = Number(payload.jiraConnectionId);
  const attachmentId = String(payload.attachmentId || '');
  if (!jiraConnectionId || !attachmentId) throw new Error('FETCH_ATTACHMENT requires jiraConnectionId and attachmentId.');

  const { apiBase, token } = await getWorkerAuthContext(payload);
  const url = `${apiBase}/jira/connections/${jiraConnectionId}/attachments/${attachmentId}/text`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let message = body || response.statusText;
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === 'string') message = parsed.detail;
    } catch {
      // Use raw body.
    }
    throw new Error(`Attachment text fetch failed at ${url} with status ${response.status}: ${message}`);
  }
  const data = await response.json() as {
    id?: string;
    filename?: string;
    mime_type?: string;
    content?: string;
  };
  return {
    attachmentId,
    contentType: data.mime_type || 'text/plain',
    filename: data.filename || '',
    content: data.content || '',
  };
}

async function startBrdCompare(message: BulkMessage): Promise<unknown> {
  if (!await isBulkModeEnabled()) throw new Error('BULK_MODE is disabled.');
  const payload = message.payload || {};
  if (payload.goalId !== 'brd-compare') throw new Error('Unsupported bulk goal.');
  const stories = (Array.isArray(payload.stories) ? payload.stories : []) as BulkStory[];
  const brdText = String(payload.brdText || '');
  const jiraConnectionId = Number(payload.jiraConnectionId);
  if (!jiraConnectionId || !brdText || stories.length === 0) {
    throw new Error('brd-compare requires jiraConnectionId, issueTypeId, brdText, and stories.');
  }

  broadcastProgress('brdComparisonProgress', message.tabId, 'Comparing BRD against selected stories...', 30);
  const result = await backendFetch<unknown>(
    '/ai/bulk/brd-compare',
    { method: 'POST', body: JSON.stringify({ ...buildBulkAIRequest(payload, stories), brd_text: brdText }) },
    payload,
  );
  broadcastProgress('brdComparisonProgress', message.tabId, 'BRD comparison complete.', 100);
  return result;
}

async function handleBulkAction(message: BulkMessage): Promise<unknown> {
  switch (message.action) {
    case 'BULK_FETCH':
      return startBulkFetch(message);
    case 'BULK_GENERATE':
      return startBulkGeneration(message);
    case 'BULK_ANALYZE':
      return startBulkAnalysis(message);
    case 'FETCH_ATTACHMENT':
      return fetchAttachment(message);
    case 'PROCESS_GOAL':
      return startBrdCompare(message);
    default:
      throw new Error(`Unsupported bulk action: ${(message as { action?: string }).action}`);
  }
}

// In-memory cache for active tab context
const tabContextCache: Record<number, TabContext> = {};
const tabRefreshInFlight = new Map<number, Promise<TabContext | null>>();
const tabLastRefreshAt = new Map<number, number>();
const tabLastUrl = new Map<number, string>();
const tabScriptInjectionInFlight = new Map<number, Promise<boolean>>();
const REFRESH_DEBOUNCE_MS = 1200;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[BugMind-BG] Extension installed. Ready for context discovery.');
});

// Sidebar setup (MV3)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

async function refreshExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab): tab is chrome.tabs.Tab & { id: number; url: string } => typeof tab.id === 'number' && typeof tab.url === 'string')
        .map((tab) => refreshTabContext(tab.id, tab.url))
    );
  } catch (error) {
    console.error('[BugMind-BG] Failed to prime existing tabs:', error);
  }
}

/**
 * Ensures the content script is active and version-matched.
 */
async function ensureContentScript(tabId: number): Promise<boolean> {
  const pingContentScript = async (): Promise<boolean> => {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(() => null);
    return response?.type === 'PONG' && response?.version === VERSION;
  };

  try {
    if (await pingContentScript()) {
      return true;
    }
    const existingInjection = tabScriptInjectionInFlight.get(tabId);
    if (existingInjection) {
      return existingInjection;
    }

    const injectPromise = (async () => {
      console.log(`[BugMind-BG] Content script not ready on tab ${tabId}. Attempting runtime injection...`);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['assets/content.js']
        });

        for (let attempt = 0; attempt < 5; attempt += 1) {
          if (await pingContentScript()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      } catch (error) {
        console.error(`[BugMind-BG] Failed to inject content script into tab ${tabId}:`, error);
      } finally {
        tabScriptInjectionInFlight.delete(tabId);
      }

      return false;
    })();

    tabScriptInjectionInFlight.set(tabId, injectPromise);
    return injectPromise;
  } catch {
    // Expected if script is not injected yet
  }
  return false;
}

/**
 * Orchestrates context extraction for a specific tab.
 */
function sameContext(a: TabContext | undefined, b: TabContext): boolean {
  return JSON.stringify(a || null) === JSON.stringify(b);
}

async function refreshTabContext(tabId: number, url?: string, force: boolean = false): Promise<TabContext | null> {
  if (!force) {
    const existing = tabRefreshInFlight.get(tabId);
    if (existing) {
      return existing;
    }
  }

  const run = (async (): Promise<TabContext | null> => {
  if (!url) {
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab.url;
    } catch {
      return null;
    }
  }

  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;

  const now = Date.now();
  const lastRefresh = tabLastRefreshAt.get(tabId) || 0;
  const lastUrl = tabLastUrl.get(tabId);
  if (!force && lastUrl === url && now - lastRefresh < REFRESH_DEBOUNCE_MS) {
    return tabContextCache[tabId] || null;
  }
  tabLastRefreshAt.set(tabId, now);
  tabLastUrl.set(tabId, url);

  // Domain Filter
  const isJira = url.includes(DOMAINS.JIRA_CLOUD) || url.includes(DOMAINS.BROWSE_PATH) || url.includes(DOMAINS.ISSUES_PATH);
  if (!isJira) {
    const nextContext = { error: 'NOT_A_JIRA_PAGE', issueData: null, instanceUrl: null };
    const changed = !sameContext(tabContextCache[tabId], nextContext);
    tabContextCache[tabId] = nextContext;
    if (changed) {
      chrome.runtime.sendMessage({ type: 'CONTEXT_UPDATED', tabId, context: nextContext }).catch(() => {});
    }
    return nextContext;
  }

  const ready = await ensureContentScript(tabId);
  if (!ready) return null;

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_ISSUE_DATA' });
    if (response?.type === 'ISSUE_DATA_SUCCESS') {
      const data = response.data;
      const detectedInstance = normalizeJiraUrl(url);

      const nextContext: TabContext = {
        issueData: data,
        instanceUrl: detectedInstance,
        error: data ? null : 'NOT_A_JIRA_PAGE'
      };
      const changed = !sameContext(tabContextCache[tabId], nextContext);
      tabContextCache[tabId] = nextContext;

      if (changed) {
        chrome.runtime.sendMessage({
          type: 'CONTEXT_UPDATED',
          tabId,
          context: nextContext
        }).catch(() => {
          // Catch "Could not establish connection" if sidepanel is closed (normal)
        });
      }
      return nextContext;
    }
  } catch (err) {
    console.error('[BugMind-BG] Context extraction failed:', err);
    return tabContextCache[tabId] || null;
  } finally {
    tabRefreshInFlight.delete(tabId);
  }
  return tabContextCache[tabId] || null;
  })();

  tabRefreshInFlight.set(tabId, run);
  return run;
}

refreshExistingTabs();

// 1. Listen for Tab Updates (Navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    console.log(`[BugMind-BG] Tab ${tabId} navigation complete. Refreshing context...`);
    refreshTabContext(tabId, tab.url);
  }
});

// 2. Listen for Tab Activation (Switching)
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log(`[BugMind-BG] Tab ${activeInfo.tabId} activated.`);
  refreshTabContext(activeInfo.tabId);
});

// 3. Listen for Sidepanel Requests (Initial Hydration)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action) {
    handleBulkAction(message as BulkMessage)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err: unknown) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[BugMind-BG] Bulk action failed:', errorMessage);
        sendResponse({ ok: false, error: errorMessage });
      });
    return true;
  }

  if (message.type === 'GET_CURRENT_CONTEXT') {
    const { tabId, force } = message as GetCurrentContextMessage;
    if (tabContextCache[tabId] && !force) {
      sendResponse(tabContextCache[tabId]);
    } else {
      refreshTabContext(tabId, undefined, Boolean(force))
        .then((context) => {
          sendResponse(context || tabContextCache[tabId] || { error: 'STALE_PAGE' });
        })
        .catch((err) => {
          console.error('[BugMind-BG] Message handler crash:', err);
          sendResponse({ error: 'WORKER_INTERNAL_ERROR' });
        });
    }
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'THEME_CHANGED') {
    // Forward theme changes to sidepanel
    chrome.runtime.sendMessage(message as ThemeChangedMessage).catch(() => {});
  }

  if (message.type === 'JIRA_CONTEXT_CHANGED') {
    const sender = _sender as chrome.runtime.MessageSender;
    const tabId = sender.tab?.id;
    const nextUrl = (message as JiraContextChangedMessage).url || sender.tab?.url;

    if (typeof tabId === 'number') {
      refreshTabContext(tabId, nextUrl, true).catch((err) => {
        console.error('[BugMind-BG] Failed to refresh context from content hint:', err);
      });
    }
  }
});

// 4. Cleanup storage + IndexedDB when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabContextCache[tabId];
  tabScriptInjectionInFlight.delete(tabId);
  
  // 1. Clean chrome.storage.local metadata
  const key = `bugmind_tab_${tabId}`;
  chrome.storage.local.remove([key], () => {
    console.log(`[BugMind-BG] Cleaned up storage for tab ${tabId}`);
  });

  // 2. Clean IndexedDB bug data
  try {
    const request = indexedDB.open('BugMindDB', 2);
    request.onsuccess = (event: Event) => {

      const target = event.target as IDBOpenDBRequest;
      const db: IDBDatabase = target.result;
      if (db.objectStoreNames.contains('tab_bugs')) {
        const tx = db.transaction(['tab_bugs'], 'readwrite');
        const store = tx.objectStore('tab_bugs');
        store.delete(tabId);
        tx.oncomplete = () => console.log(`[BugMind-BG] Cleaned up IndexedDB bugs for tab ${tabId}`);
      }
      db.close();
    };
  } catch {
    // Non-critical cleanup failure
  }
});
