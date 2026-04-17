import { useState, useEffect, useCallback, useMemo } from 'react';
import { TabSession, INITIAL_SESSION } from '../types';
import { dbService } from '../services/db';
import { TIMEOUTS } from '../constants';

export function useSession(log?: (tag: string, msg: string) => void) {
  const [tabSessions, setTabSessions] = useState<Record<number, TabSession>>({});
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);

  // Helper to get active session
  const session = useMemo(() => currentTabId ? (tabSessions[currentTabId] || INITIAL_SESSION) : INITIAL_SESSION, [currentTabId, tabSessions]);

  // Helper to update active session
  const updateSession = useCallback((updates: Partial<TabSession>, tabId?: number) => {
    const id = tabId || currentTabId;
    if (!id) return;
    setTabSessions((prev: Record<number, TabSession>) => ({
      ...prev,
      [id]: { ...(prev[id] || INITIAL_SESSION), ...updates }
    }));
  }, [currentTabId]);

  useEffect(() => {
    // Set initial tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) setCurrentTabId(tabs[0].id);
    });

    // Listen for tab updates and activation
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === 'complete') {
        setCurrentTabId(tabId);
        // Clear errors on page load/refresh
        setTabSessions(prev => {
          if (!prev[tabId]) return prev;
          return { ...prev, [tabId]: { ...prev[tabId], error: null } };
        });
      }
    };
    const handleTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      setCurrentTabId(activeInfo.tabId);
    };
    const handleWindowFocus = (windowId: number) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            setCurrentTabId(tabs[0].id);
          }
        });
      }
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdate);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.windows.onFocusChanged.addListener(handleWindowFocus);

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.windows.onFocusChanged.removeListener(handleWindowFocus);
    };
  }, []);

  // Persistence - Load tab data (Hybrid: Storage + IndexedDB)
  useEffect(() => {
    if (!currentTabId) return;
    setSessionHydrated(false);

    const key = `bugmind_tab_${currentTabId}`;
    
    // 1. Load metadata from chrome storage (include global onboarding flag)
    chrome.storage.local.get([key, 'bugmind_onboarding_completed'], async (result) => {
      const globalOnboardingDone = !!result['bugmind_onboarding_completed'];
      const rawSession = (result[key] || {}) as Partial<TabSession>;
      
      let sessionData: TabSession = { 
        ...INITIAL_SESSION, 
        ...rawSession,
        // Always respect the global onboarding flag so new tabs don't re-show onboarding
        onboardingCompleted: globalOnboardingDone || (rawSession.onboardingCompleted ?? false)
      };
      
      // 2. Load large bugs array from IndexedDB
      try {
        const bugs = await dbService.getBugs(currentTabId);
        if (bugs.length > 0) {
          sessionData = { ...sessionData, bugs };
        }
      } catch (err) {
        console.error('Failed to load bugs from IndexedDB', err);
      }

      setTabSessions((prev: Record<number, TabSession>) => ({
        ...prev,
        [currentTabId]: sessionData
      }));
      setSessionHydrated(true);
    });
  }, [currentTabId]);

  // Derived state for serialization to avoid complicated dependency logic
  const serializeTarget = useMemo(() => {
    if (!currentTabId || !tabSessions[currentTabId]) return null;
    const sessionToSave = { ...tabSessions[currentTabId] };
    const bugsToSave = sessionToSave.bugs;
    
    // Do NOT store bugs or transient UI messages in chrome.storage.local
    const strippedSession: Partial<TabSession> = { ...sessionToSave };
    delete strippedSession.bugs;
    delete strippedSession.error;
    delete strippedSession.success;
    
    return { key: `bugmind_tab_${currentTabId}`, tabId: currentTabId, session: strippedSession, bugs: bugsToSave };
  }, [currentTabId, tabSessions]);

  // Sync tab session to storage with debounce (Hybrid sync)
  useEffect(() => {
    if (!serializeTarget) return;

    const timeout = setTimeout(async () => {
      // 1. Sync metadata to chrome.storage
      chrome.storage.local.set({ [serializeTarget.key]: serializeTarget.session });
      
      // 2. Sync large bugs array to IndexedDB
      try {
        await dbService.saveBugs(serializeTarget.tabId, serializeTarget.bugs);
        log?.('DB-SYNC', `Bugs saved to IndexedDB for tab ${serializeTarget.tabId}`);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.('DB-ERR', `Failed to save bugs: ${errMsg}`);
        console.error('Failed to save bugs to IndexedDB', err);
      }
    }, TIMEOUTS.STORAGE_SYNC_DEBOUNCE); 
    
    return () => clearTimeout(timeout);
  }, [serializeTarget, log]);

  return {
    tabSessions,
    currentTabId,
    session,
    updateSession,
    setTabSessions,
    sessionHydrated
  };
}
