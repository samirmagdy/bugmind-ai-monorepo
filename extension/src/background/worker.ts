/**
 * worker.ts
 * Background service worker for BugMind AI.
 * Handles tab orchestration, context discovery, and sidepanel sync.
 */

// Deployment Metadata
const VERSION = '1.2.0';
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
