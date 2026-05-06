import { useState, useEffect, useCallback, useMemo } from 'react';
import { TabSession, INITIAL_SESSION, ManualBugInput, SupportingArtifact } from '../types';
import { dbService } from '../services/db';
import { TIMEOUTS } from '../constants';

function stripEphemeralJiraState(session: Partial<TabSession>): Partial<TabSession> {
  const sanitized = { ...session };

  delete sanitized.loading;
  delete sanitized.error;
  delete sanitized.success;
  delete sanitized.issueData;
  delete sanitized.instanceUrl;
  delete sanitized.jiraConnectionId;
  delete sanitized.issueTypesFetched;
  delete sanitized.issueTypes;
  delete sanitized.selectedIssueType;
  delete sanitized.jiraMetadata;
  delete sanitized.visibleFields;
  delete sanitized.aiMapping;
  delete sanitized.validationErrors;
  delete sanitized.resolvedPayload;
  delete sanitized.undoStack;
  delete sanitized.redoStack;
  delete sanitized.revisions;
  delete sanitized.generationProgressMessage;
  delete sanitized.generationProgressPercent;
  delete sanitized.generationEtaSeconds;

  return sanitized;
}

function normalizeSupportingArtifacts(value: unknown): SupportingArtifact[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is SupportingArtifact =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as SupportingArtifact).id === 'string' &&
      typeof (item as SupportingArtifact).name === 'string' &&
      typeof (item as SupportingArtifact).type === 'string' &&
      typeof (item as SupportingArtifact).size === 'number' &&
      typeof (item as SupportingArtifact).content === 'string'
    );
}

function normalizeManualInputs(value: unknown): ManualBugInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    return INITIAL_SESSION.manualInputs;
  }

  const normalized = value
    .map((item): ManualBugInput | null => {
      if (typeof item === 'string') {
        return { text: item, supportingContext: '', supportingArtifacts: [] };
      }

      if (!item || typeof item !== 'object') return null;

      const text = typeof (item as { text?: unknown }).text === 'string'
        ? (item as { text: string }).text
        : '';
      const supportingContext = typeof (item as { supportingContext?: unknown }).supportingContext === 'string'
        ? (item as { supportingContext: string }).supportingContext
        : '';

      return {
        text,
        supportingContext,
        supportingArtifacts: normalizeSupportingArtifacts((item as { supportingArtifacts?: unknown }).supportingArtifacts)
      };
    })
    .filter((item): item is ManualBugInput => Boolean(item));

  return normalized.length > 0 ? normalized : INITIAL_SESSION.manualInputs;
}

export function useSession(log?: (tag: string, msg: string) => void) {
  const [tabSessions, setTabSessions] = useState<Record<number, TabSession>>({});
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);

  // Helper to get active session
  const session = useMemo(() => currentTabId ? (tabSessions[currentTabId] || INITIAL_SESSION) : INITIAL_SESSION, [currentTabId, tabSessions]);

  // Helper to update active session
  const updateSession = useCallback((updates: Partial<TabSession>, tabId?: number | null) => {
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
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (changeInfo.status === 'complete') {
        if (!tab.active || !tab.highlighted) return;
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
      const rawSession = stripEphemeralJiraState((result[key] || {}) as Partial<TabSession>);
      
      let sessionData: TabSession = { 
        ...INITIAL_SESSION, 
        ...rawSession,
        manualInputs: normalizeManualInputs((rawSession as Partial<TabSession>).manualInputs),
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

      if (
        sessionData.view === 'preview' &&
        (sessionData.previewBugIndex === null ||
          sessionData.previewBugIndex === undefined ||
          sessionData.previewBugIndex < 0 ||
          sessionData.previewBugIndex >= sessionData.bugs.length)
      ) {
        sessionData = {
          ...sessionData,
          view: 'main',
          previewBugIndex: null
        };
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
    const strippedSession: Partial<TabSession> = stripEphemeralJiraState({ ...sessionToSave });
    delete strippedSession.bugs;
    
    return { key: `bugmind_tab_${currentTabId}`, tabId: currentTabId, session: strippedSession, bugs: bugsToSave };
  }, [currentTabId, tabSessions]);

  const shouldFlushSessionImmediately = useMemo(() => {
    if (!currentTabId || !tabSessions[currentTabId]) return false;
    const currentSession = tabSessions[currentTabId];
    return currentSession.view === 'success' || currentSession.view === 'preview';
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
    }, shouldFlushSessionImmediately ? 0 : TIMEOUTS.STORAGE_SYNC_DEBOUNCE); 
    
    return () => clearTimeout(timeout);
  }, [serializeTarget, log, shouldFlushSessionImmediately]);

  return useMemo(() => ({
    tabSessions,
    currentTabId,
    session,
    updateSession,
    setTabSessions,
    sessionHydrated
  }), [tabSessions, currentTabId, session, updateSession, sessionHydrated]);
}
