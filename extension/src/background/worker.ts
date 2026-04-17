/**
 * worker.ts
 * Background service worker for BugMind AI.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('BugMind AI Extension installed');
});

// Sidebar setup (MV3)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Cleanup storage + IndexedDB when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  // 1. Clean chrome.storage.local metadata
  const key = `bugmind_tab_${tabId}`;
  chrome.storage.local.remove([key], () => {
    console.log(`Cleaned up storage for tab ${tabId}`);
  });

  // 2. Clean IndexedDB bug data (inline, since worker can't import sidepanel modules)
  try {
    const request = indexedDB.open('BugMindDB', 1);
    request.onsuccess = (event: any) => {
      const db: IDBDatabase = event.target.result;
      if (db.objectStoreNames.contains('tab_bugs')) {
        const tx = db.transaction(['tab_bugs'], 'readwrite');
        const store = tx.objectStore('tab_bugs');
        store.delete(tabId);
        tx.oncomplete = () => console.log(`Cleaned up IndexedDB bugs for tab ${tabId}`);
      }
      db.close();
    };
    request.onerror = () => {
      // IndexedDB not available in this context — non-critical, skip silently
    };
  } catch {
    // Service worker may not have indexedDB access in all browsers
  }
});
