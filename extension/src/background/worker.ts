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

// In-memory cache for active tab context
const tabContextCache: Record<number, any> = {};

chrome.runtime.onInstalled.addListener(() => {
  console.log('[BugMind-BG] Extension installed. Ready for context discovery.');
});

// Sidebar setup (MV3)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

/**
 * Ensures the content script is active and version-matched.
 */
async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(() => null);
    if (response?.type === 'PONG' && response?.version === VERSION) {
      return true;
    }
    console.log(`[BugMind-BG] Version mismatch or script missing on tab ${tabId}. Healing...`);
  } catch (e) {
    // Expected if script is not injected
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['assets/content.js']
    });
    return true;
  } catch (err) {
    console.error(`[BugMind-BG] Failed to inject content script into tab ${tabId}:`, err);
    return false;
  }
}

/**
 * Orchestrates context extraction for a specific tab.
 */
async function refreshTabContext(tabId: number, url?: string) {
  if (!url) {
    try {
      const tab = await chrome.tabs.get(tabId);
      url = tab.url;
    } catch (e) {
      return;
    }
  }

  if (!url) return;

  // Domain Filter
  const isJira = url.includes(DOMAINS.JIRA_CLOUD) || url.includes(DOMAINS.BROWSE_PATH) || url.includes(DOMAINS.ISSUES_PATH);
  if (!isJira) {
    tabContextCache[tabId] = { error: 'NOT_A_JIRA_PAGE', issueData: null, instanceUrl: null };
    chrome.runtime.sendMessage({ type: 'CONTEXT_UPDATED', tabId, context: tabContextCache[tabId] }).catch(() => {});
    return;
  }

  const ready = await ensureContentScript(tabId);
  if (!ready) return;

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_ISSUE_DATA' });
    if (response?.type === 'ISSUE_DATA_SUCCESS') {
      const data = response.data;
      const detectedInstance = url.split('/browse/')[0].split('/issues/')[0];
      
      tabContextCache[tabId] = {
        issueData: data,
        instanceUrl: detectedInstance,
        error: data ? null : 'NOT_A_JIRA_PAGE'
      };
      
      // Notify sidepanel if open
      chrome.runtime.sendMessage({ 
        type: 'CONTEXT_UPDATED', 
        tabId, 
        context: tabContextCache[tabId] 
      }).catch(() => {
        // Catch "Could not establish connection" if sidepanel is closed (normal)
      });
    }
  } catch (err) {
    console.error('[BugMind-BG] Context extraction failed:', err);
  }
}

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
    const tabId = message.tabId;
    if (tabContextCache[tabId]) {
      sendResponse(tabContextCache[tabId]);
    } else {
      refreshTabContext(tabId).then(() => {
        sendResponse(tabContextCache[tabId] || { error: 'STALE_PAGE' });
      });
    }
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'THEME_CHANGED') {
    // Forward theme changes to sidepanel
    chrome.runtime.sendMessage(message).catch(() => {});
  }
});

// 4. Cleanup storage + IndexedDB when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabContextCache[tabId];
  
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
  } catch (e) {
    // Non-critical cleanup failure
  }
});
