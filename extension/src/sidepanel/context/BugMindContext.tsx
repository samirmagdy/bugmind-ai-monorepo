import React, { ReactNode, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSession } from '../hooks/useSession';

import { TIMEOUTS, LIMITS } from '../constants';
import { translateError } from '../utils/ErrorTranslator';
import { apiRequest, readJsonResponse } from '../services/api';
import { BugMindContext, BugMindContextType } from '../hooks/useBugMind';
import { obfuscate } from '../utils/StorageObfuscator';

// New Specialized Providers
import { AuthProvider, useAuthContext } from './AuthProvider';
import { JiraProvider, useJiraContext } from './JiraProvider';
import { AIProvider, useAIContext } from './AIProvider';

/**
 * Inner Provider that orchestrates sub-providers and handles global messaging.
 */
const BugMindOrchestrator: React.FC<{ 
  children: ReactNode, 
  logDebug: (tag: string, msg: string) => void, 
  internalLogs: any[], 
  showDebug: boolean, 
  setShowDebug: (v: boolean) => void, 
  clearLogs: () => void,
  sessionData: ReturnType<typeof useSession> 
}> = ({ 
  children, logDebug, internalLogs, showDebug, setShowDebug, clearLogs, sessionData 
}) => {
  const auth = useAuthContext();
  const jira = useJiraContext();
  const ai = useAIContext();

  // 1. Initial Context Hydration (Phase 1)
  useEffect(() => {
    if (sessionData.currentTabId && sessionData.sessionHydrated) {
      logDebug('SYS-INIT', `Hydrating context for tab ${sessionData.currentTabId}...`);
      chrome.runtime.sendMessage({ 
        type: 'GET_CURRENT_CONTEXT', 
        tabId: sessionData.currentTabId 
      }, (response) => {
        if (response && !response.error) {
          logDebug('SYS-INIT-OK', 'Received initial context from background');
          sessionData.updateSession(response);
        }
      });
    }
  }, [sessionData.currentTabId, sessionData.sessionHydrated]);

  // 2. Listen for Background Events (Phase 1)
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'CONTEXT_UPDATED' && message.tabId === sessionData.currentTabId) {
        logDebug('SYS-SYNC', 'Received context update from background');
        sessionData.updateSession(message.context);
      }
      if (message.type === 'THEME_CHANGED' && sessionData.session.themeSource === 'auto') {
        logDebug('SYS-THEME', `Theme update: ${message.theme}`);
        sessionData.updateSession({ theme: message.theme });
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [sessionData.currentTabId, sessionData.session.themeSource, sessionData.updateSession, logDebug]);

  const lastStaleCheck = useRef<number | null>(null);

  // 3. Orchestration Logic (Sync dependencies)
  useEffect(() => {
    // CIRCUIT BREAKER: Stop all automated sync attempts if we have an error or are already loading
    if (sessionData.session.error || sessionData.session.loading || !sessionData.sessionHydrated) return;

    // 1. Logic to define defaults
    const isMain = auth.authToken && auth.globalView === 'main';
    const hasContext = sessionData.session.issueData?.key && sessionData.session.instanceUrl;
    
    // Auto-recovery if stuck without context
    if (isMain && !hasContext && sessionData.sessionHydrated) {
      if (!lastStaleCheck.current) { lastStaleCheck.current = Date.now(); }
      const staleTime = Date.now() - lastStaleCheck.current;
      
      if (staleTime > 2000) { // 2 seconds without context
        logDebug('SYNC-STALE', 'Still no context after 2s. Re-requesting background scan...');
        chrome.runtime.sendMessage({ 
          type: 'GET_CURRENT_CONTEXT', 
          tabId: sessionData.currentTabId,
          force: true 
        });
        lastStaleCheck.current = Date.now();
      }
    } else {
      lastStaleCheck.current = null;
    }

    if (isMain && hasContext) {
      if (!sessionData.session.jiraConnectionId) {
        logDebug('SYNC-CONN', 'Connection ID missing. Discovering connection...');
        jira.checkJiraStatus(true, undefined, undefined, sessionData.session.instanceUrl || undefined, sessionData.currentTabId || undefined);
        return;
      }

      const pKey = sessionData.session.issueData!.key.split('-')[0];
      const pId = sessionData.session.issueData!.projectId;

      // Sync Issue Types
      const hasTypes = sessionData.session.issueTypes.length > 0;
      if (!sessionData.session.issueTypesFetched || !hasTypes) {
        logDebug('SYNC-INIT', `Refreshing issue types for ${pKey}...`);
        jira.fetchIssueTypes(sessionData.session.jiraConnectionId, pKey, sessionData.currentTabId!, pId);
      } else if (!sessionData.session.selectedIssueType) {
        // FAIL-SAFE: Selection missing
        const bugType = sessionData.session.issueTypes.find((t: any) => t.name.toLowerCase().includes('bug')) || sessionData.session.issueTypes[0];
        logDebug('SYNC-HEAL', `Auto-selected issue type: ${bugType.name}`);
        sessionData.updateSession({ selectedIssueType: bugType });
      }

      // Sync Metadata when issue type is selected
      if (sessionData.session.selectedIssueType) {
        const itId = sessionData.session.selectedIssueType.id;
        const hasMeta = sessionData.session.jiraMetadata?.project_key === pKey && sessionData.session.jiraMetadata?.issue_type_id === itId;
        if (!hasMeta) {
          logDebug('SYNC-META', `Syncing schema for ${pKey}:${sessionData.session.selectedIssueType.name}`);
          jira.fetchJiraMetadata(sessionData.session.jiraConnectionId, pKey, itId, sessionData.currentTabId!, pId);
          jira.fetchFieldSettings(sessionData.session.jiraConnectionId, pKey, sessionData.currentTabId!, itId, pId);
        }
      }
    } else if (isMain) {
      const missing = [];
      if (!sessionData.session.issueData?.key) missing.push('Issue Key (Context)');
      if (!sessionData.session.instanceUrl) missing.push('Jira Hub URL');
      if (missing.length > 0) {
        logDebug('SYNC-WAIT', `Waiting for: ${missing.join(', ')}`);
      }
    }
  }, [
    auth.authToken, auth.globalView, 
    sessionData.session.issueData?.key, 
    sessionData.session.jiraConnectionId,
    sessionData.session.selectedIssueType?.id,
    sessionData.session.issueTypesFetched,
    sessionData.session.issueTypes.length,
    sessionData.session.jiraMetadata?.issue_type_id,
    sessionData.currentTabId, sessionData.sessionHydrated,
    jira, sessionData.updateSession, logDebug
  ]);



  // Handle Authentication Logic (Login/Verify)
  const checkAuth = useCallback(async (token?: string) => {
    const activeToken = token || auth.authToken;
    if (!activeToken) {
      if (auth.globalView !== 'auth') auth.setGlobalView('auth');
      auth.setInitializing(false);
      return;
    }
    try {
      const res = await apiRequest(`${auth.apiBase}/auth/me`, { token: activeToken, onUnauthorized: auth.refreshSession });
      if (res.ok) {
        logDebug('AUTH-OK', 'Token valid. Checking Jira connection...');
        const connected = await jira.checkJiraStatus(true, undefined, activeToken, undefined, sessionData.currentTabId || undefined);
        
        if (connected) {
          // Only auto-redirect if we are explicitly sitting on the Auth screen
          if (auth.globalView === 'auth') {
            logDebug('AUTH-REDIRECT', 'Connected. Moving to MAIN.');
            auth.setGlobalView('main');
          }
        } else {
          logDebug('AUTH-SETUP', 'No Jira connection found.');
          // Only auto-redirect if we are explicitly sitting on the Auth screen
          if (auth.globalView === 'auth') {
            auth.setGlobalView('setup');
          }
        }
      } else {
        logDebug('AUTH-FAIL', 'Session invalid. Redirecting to login.');
        auth.setAuthToken(null);
        auth.setGlobalView('auth');
      }
    } catch (err) {
      logDebug('AUTH-ERR', `Background verification failed: ${err}`);
      // Don't force redirect on network errors, just show the error
      sessionData.updateSession({ error: translateError(err, 'auth').description });
    } finally {
      auth.setInitializing(false);
    }
  }, [auth.authToken, auth.globalView, auth.setGlobalView, auth.setAuthToken, auth.setInitializing, auth.apiBase, jira, sessionData.currentTabId, sessionData.updateSession, logDebug]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    logDebug('LOGIN-START', `Attempting login for ${auth.email}`);
    sessionData.updateSession({ error: null, loading: true });
    try {
      const formData = new URLSearchParams();
      formData.append('username', auth.email);
      formData.append('password', auth.password);

      const response = await apiRequest(`${auth.apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });
      const data = await readJsonResponse<{ access_token?: string; refresh_token?: string; detail?: string }>(response);
      if (data.access_token) {
        auth.setAuthToken(data.access_token);
        if (data.refresh_token) auth.setRefreshToken(data.refresh_token);
        
        // Phase 3 Secure Storage
        const secureToken = obfuscate(data.access_token);
        const secureRefreshToken = data.refresh_token ? obfuscate(data.refresh_token) : '';
        if (auth.rememberMe) {
          chrome.storage.local.set({ bugmind_token: secureToken, bugmind_refresh_token: secureRefreshToken, bugmind_email: auth.email, bugmind_remember_me: true });
        }
        chrome.storage.session.set({ bugmind_token: secureToken, bugmind_refresh_token: secureRefreshToken });
        
        logDebug('LOGIN-OK', 'Login successful. Verifying Jira status...');
        const connected = await jira.checkJiraStatus(true, undefined, data.access_token, undefined, sessionData.currentTabId || undefined);
        
        if (connected) {
          auth.setGlobalView('main');
          sessionData.updateSession({ success: `Welcome back, ${auth.email}!` });
        } else {
          auth.setGlobalView('setup');
          sessionData.updateSession({ success: 'Login successful! Please connect your Jira instance.' });
        }
        
        ai.fetchUsage();
        ai.fetchAISettings();
        setTimeout(() => sessionData.updateSession({ success: null }), TIMEOUTS.NOTIFICATION_AUTO_HIDE_LONG);
      } else {
        throw new Error(data.detail || 'Login failed');
      }
    } catch (err) {
      sessionData.updateSession({ error: translateError(err, 'login').description });
    } finally {
      sessionData.updateSession({ loading: false });
    }
  }, [auth, jira, ai, sessionData.currentTabId, sessionData.updateSession, logDebug]);


  const value: BugMindContextType = {
    session: sessionData.session,
    updateSession: sessionData.updateSession,
    currentTabId: sessionData.currentTabId,
    setTabSessions: sessionData.setTabSessions,
    auth: auth as any,
    jira: jira,
    ai: ai,
    debug: useMemo(() => ({
      logs: internalLogs,
      show: showDebug,
      setShow: setShowDebug,
      log: logDebug,
      clear: clearLogs
    }), [internalLogs, showDebug, setShowDebug, logDebug, clearLogs]),
    refreshIssue: (force) => {
      logDebug('MANUAL-SYNC', 'Triggering manual context refresh via worker...');
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_CONTEXT', tabId: sessionData.currentTabId, force });
    },
    checkAuth,
    handleLogin,
    handleRegister: async (e) => {
      e.preventDefault();
      try {
        const res = await apiRequest(`${auth.apiBase}/auth/register`, {
          method: 'POST',
          body: JSON.stringify({ email: auth.email, password: auth.password })
        });
        if (res.ok) {
          auth.setAuthMode('login');
          sessionData.updateSession({ success: 'Account created! Please sign in.' });
        }
      } catch (err) { sessionData.updateSession({ error: translateError(err, 'register').description }); }
    },
    handleSaveSettings: async (e) => {
      e.preventDefault();
      try {
        const res = await apiRequest(`${auth.apiBase}/settings/ai`, {
          method: 'POST', token: auth.authToken, onUnauthorized: auth.refreshSession,
          body: JSON.stringify({ custom_model: ai.customModel, openrouter_key: ai.customKey })
        });
        if (!res.ok) {
          throw new Error(await res.text() || `Request failed with status ${res.status}`);
        }
        if (res.ok) {
          ai.setHasCustomKeySaved(true);
          ai.setCustomKey('');
          sessionData.updateSession({ success: 'Saved' });
        }
      } catch (err) { sessionData.updateSession({ error: translateError(err, 'settings').description }); }
    },
    saveFieldSettings: async (nf, nm) => {
      try {
        const pKey = sessionData.session.issueData?.key.split('-')[0];
        await apiRequest(`${auth.apiBase}/settings/jira`, {
          method: 'POST', token: auth.authToken, onUnauthorized: auth.refreshSession,
          body: JSON.stringify({
            jira_connection_id: sessionData.session.jiraConnectionId,
            project_key: pKey,
            project_id: sessionData.session.issueData?.projectId,
            issue_type_id: sessionData.session.selectedIssueType?.id,
            visible_fields: nf || sessionData.session.visibleFields,
            ai_mapping: nm || sessionData.session.aiMapping
          })
        });
        sessionData.updateSession({ visibleFields: nf || sessionData.session.visibleFields, aiMapping: nm || sessionData.session.aiMapping, success: 'Synced' });
      } catch (err) { sessionData.updateSession({ error: 'Sync failed' }); }
    },
    handleLogout: () => auth.handleLogout(() => sessionData.setTabSessions({})),
    handleTabReload: () => chrome.tabs.reload(sessionData.currentTabId!),
    completeOnboarding: async () => {
      await chrome.storage.local.set({ bugmind_onboarding_completed: true });
      sessionData.setTabSessions(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(id => { next[Number(id)] = { ...next[Number(id)], onboardingCompleted: true }; });
        return next;
      });
    },
    initializing: auth.initializing,
    sessionHydrated: sessionData.sessionHydrated
  };

  return <BugMindContext.Provider value={value}>{children}</BugMindContext.Provider>;
}

export const BugMindProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [internalLogs, setInternalLogs] = React.useState<{timestamp: string, tag: string, msg: string}[]>([]);
  const [showDebug, setShowDebug] = React.useState(false);
  const lastLogRef = useRef<string>('');
  const lastLogTimeRef = useRef<number>(0);

  const logDebug = useCallback((tag: string, msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logKey = `${tag}:${msg}`;
    if (lastLogRef.current === logKey && (Date.now() - lastLogTimeRef.current < 50)) return;
    lastLogRef.current = logKey;
    lastLogTimeRef.current = Date.now();
    setInternalLogs(prev => [{ timestamp, tag, msg }, ...prev].slice(0, LIMITS.MAX_DEBUG_LOGS));
  }, []);

  const clearLogs = useCallback(() => setInternalLogs([]), []);

  return (
    <AuthProvider logDebug={logDebug}>
      <AuthContextValueWrapper logDebug={logDebug} internalLogs={internalLogs} showDebug={showDebug} setShowDebug={setShowDebug} clearLogs={clearLogs}>
        {children}
      </AuthContextValueWrapper>
    </AuthProvider>
  );
};

// Intermediate wrapper to access Auth context before Jira/AI providers
const AuthContextValueWrapper: React.FC<any> = ({ children, logDebug, ...props }) => {
  const auth = useAuthContext();
  const sessionData = useSession(logDebug); // We need session in Jira/AI too

  return (
    <JiraProvider 
      logDebug={logDebug} 
      apiBase={auth.apiBase} 
      authToken={auth.authToken} 
      refreshAuthToken={auth.refreshSession}
      session={sessionData.session} 
      updateSession={sessionData.updateSession}
    >
      <AIProvider 
        logDebug={logDebug} 
        apiBase={auth.apiBase} 
        authToken={auth.authToken} 
        refreshAuthToken={auth.refreshSession}
        session={sessionData.session} 
        updateSession={sessionData.updateSession} 
        currentTabId={sessionData.currentTabId} 
        setTabSessions={sessionData.setTabSessions}
      >
        <BugMindOrchestrator logDebug={logDebug} sessionData={sessionData} {...props}>
          {children}
        </BugMindOrchestrator>
      </AIProvider>
    </JiraProvider>
  );
}
