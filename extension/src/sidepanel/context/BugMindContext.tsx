import React, { ReactNode, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSession } from '../hooks/useSession';

import { TIMEOUTS, LIMITS } from '../constants';
import { translateError } from '../utils/ErrorTranslator';
import { apiRequest, readJsonResponse } from '../services/api';
import { BugMindContext, BugMindContextType } from '../hooks/useBugMind';
import { obfuscate } from '../utils/StorageObfuscator';
import { DebugLog } from '../types';

// New Specialized Providers
import { AuthProvider } from './AuthProvider';
import { JiraProvider } from './JiraProvider';
import { AIProvider } from './AIProvider';
import { useAuthContext } from '../hooks/useAuthContext';
import { useAIContext } from '../hooks/useAIContext';
import { useJiraContext } from '../hooks/useJiraContext';

type BackgroundMessage =
  | { type: 'CONTEXT_UPDATED'; tabId: number; context: ReturnType<typeof useSession>['session'] }
  | { type: 'THEME_CHANGED'; theme: 'light' | 'dark' };

interface WrapperProps {
  children: ReactNode;
  logDebug: (tag: string, msg: string) => void;
  internalLogs: DebugLog[];
  showDebug: boolean;
  setShowDebug: (v: boolean) => void;
  clearLogs: () => void;
}

/**
 * Inner Provider that orchestrates sub-providers and handles global messaging.
 */
const BugMindOrchestrator: React.FC<WrapperProps & {
  sessionData: ReturnType<typeof useSession>
}> = ({
  children, logDebug, internalLogs, showDebug, setShowDebug, clearLogs, sessionData 
}) => {
  const auth = useAuthContext();
  const jira = useJiraContext();
  const ai = useAIContext();
  const { currentTabId, session, sessionHydrated, updateSession, setTabSessions } = sessionData;
  const authCheckInFlight = useRef<Promise<void> | null>(null);

  const withTimeout = useCallback(async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      })
    ]);
  }, []);

  const bootstrapCurrentContext = useCallback(async (
    context: { instanceUrl?: string | null; issueData?: { key?: string; projectId?: string } | null } | null | undefined,
    tabId?: number | null,
    tokenOverride?: string
  ) => {
    if (!auth.authToken && !tokenOverride) return null;
    if (!context?.instanceUrl) return null;

    const projectKey = context.issueData?.key?.split('-')[0];
    logDebug('SYNC-CONN-CONTEXT', `Bootstrapping Jira context for ${context.instanceUrl}`);
    return jira.bootstrapContext({
      instanceUrl: context.instanceUrl,
      projectKey,
      projectId: context.issueData?.projectId,
      issueTypeId: session.selectedIssueType?.id || undefined,
      tabId: tabId || currentTabId || undefined,
      tokenOverride
    });
  }, [auth.authToken, currentTabId, jira, logDebug, session.selectedIssueType?.id]);

  const fetchCurrentContext = useCallback(async (force: boolean = false) => {
    if (!currentTabId) return null;

    return await new Promise<{ issueData?: { key?: string; projectId?: string } | null; instanceUrl?: string | null; error?: string | null } | null>((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'GET_CURRENT_CONTEXT', tabId: currentTabId, force },
        (response) => resolve(response || null)
      );
    });
  }, [currentTabId]);

  const resolveConnectionAfterAuth = useCallback(async (tokenOverride: string, source: 'login' | 'bootstrap'): Promise<boolean> => {
    const currentContext = await fetchCurrentContext(true);

    if (currentContext?.instanceUrl) {
      try {
        const bootstrapped = await withTimeout(
          bootstrapCurrentContext(currentContext, currentTabId || undefined, tokenOverride),
          8000,
          'Jira bootstrap'
        );
        if (bootstrapped) {
          return true;
        }
        logDebug('AUTH-CONN-FALLBACK', `Bootstrap returned no match during ${source}. Falling back to global connection check.`);
      } catch (err) {
        logDebug('AUTH-CONN-FALLBACK', `Bootstrap failed during ${source}: ${String(err)}. Falling back to global connection check.`);
      }
    }

    return await withTimeout(
      jira.checkJiraStatus(true, undefined, tokenOverride, undefined, currentTabId || undefined),
      8000,
      'Global Jira status check'
    );
  }, [bootstrapCurrentContext, currentTabId, fetchCurrentContext, jira, logDebug, withTimeout]);

  // 1. Initial Context Hydration (Phase 1)
  useEffect(() => {
    if (currentTabId && sessionHydrated) {
      logDebug('SYS-INIT', `Hydrating context for tab ${currentTabId}...`);
      chrome.runtime.sendMessage({ 
        type: 'GET_CURRENT_CONTEXT', 
        tabId: currentTabId,
        force: true
      }, (response) => {
        if (response && !response.error) {
          logDebug('SYS-INIT-OK', 'Received initial context from background');
          updateSession(response);
          bootstrapCurrentContext(response, currentTabId);
        }
      });
    }
  }, [bootstrapCurrentContext, currentTabId, logDebug, sessionHydrated, updateSession]);

  // 2. Listen for Background Events (Phase 1)
  useEffect(() => {
    const handleMessage = (message: BackgroundMessage) => {
      if (message.type === 'CONTEXT_UPDATED' && message.tabId === currentTabId) {
        logDebug('SYS-SYNC', 'Received context update from background');
        updateSession(message.context);
        bootstrapCurrentContext(message.context, message.tabId);
      }
      if (message.type === 'THEME_CHANGED' && session.themeSource === 'auto') {
        logDebug('SYS-THEME', `Theme update: ${message.theme}`);
        updateSession({ theme: message.theme });
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [bootstrapCurrentContext, currentTabId, logDebug, session.themeSource, updateSession]);

  const lastStaleCheck = useRef<number | null>(null);

  // 3. Orchestration Logic (Sync dependencies)
  useEffect(() => {
    // CIRCUIT BREAKER: Stop all automated sync attempts if we have an error or are already loading
    if (session.error || session.loading || !sessionHydrated) return;

    // 1. Logic to define defaults
    const isMain = auth.authToken && auth.globalView === 'main';
    const hasContext = session.issueData?.key && session.instanceUrl;
    
    // Auto-recovery if stuck without context
    if (isMain && !hasContext && sessionHydrated) {
      if (!lastStaleCheck.current) { lastStaleCheck.current = Date.now(); }
      const staleTime = Date.now() - lastStaleCheck.current;
      
      if (staleTime > 2000) { // 2 seconds without context
        logDebug('SYNC-STALE', 'Still no context after 2s. Re-requesting background scan...');
        chrome.runtime.sendMessage({ 
          type: 'GET_CURRENT_CONTEXT', 
          tabId: currentTabId,
          force: true 
        });
        lastStaleCheck.current = Date.now();
      }
    } else {
      lastStaleCheck.current = null;
    }

    if (isMain && hasContext) {
      if (!session.jiraConnectionId) {
        logDebug('SYNC-CONN', 'Connection ID missing. Discovering connection...');
        bootstrapCurrentContext(session, currentTabId);
        return;
      }
    } else if (isMain) {
      const missing = [];
      if (!session.issueData?.key) missing.push('Issue Key (Context)');
      if (!session.instanceUrl) missing.push('Jira Hub URL');
      if (missing.length > 0) {
        logDebug('SYNC-WAIT', `Waiting for: ${missing.join(', ')}`);
      }
    }
  }, [
    auth.authToken, auth.globalView, 
    bootstrapCurrentContext, currentTabId, jira, logDebug, 
    session, session.error, session.instanceUrl,
    session.issueData, session.jiraConnectionId,
    session.loading, sessionHydrated
  ]);



  // Handle Authentication Logic (Login/Verify)
  const checkAuth = useCallback(async (token?: string) => {
    if (authCheckInFlight.current) {
      return authCheckInFlight.current;
    }

    const run = (async () => {
    const activeToken = token || auth.authToken;
    if (!activeToken) {
      if (auth.globalView !== 'auth') auth.setGlobalView('auth');
      auth.setInitializing(false);
      return;
    }
    try {
      const verifyPromise = apiRequest(`${auth.apiBase}/auth/me`, { token: activeToken, onUnauthorized: auth.refreshSession });
      const res = await withTimeout(verifyPromise, 8000, 'Authentication bootstrap');
      if (res.ok) {
        logDebug('AUTH-OK', 'Token valid. Checking Jira connection...');
        const connected = await resolveConnectionAfterAuth(activeToken, 'bootstrap');
        
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
      updateSession({ error: translateError(err, 'auth').description });
    } finally {
      auth.setInitializing(false);
      authCheckInFlight.current = null;
    }
    })();

    authCheckInFlight.current = run;
    return run;
  }, [auth, logDebug, resolveConnectionAfterAuth, updateSession, withTimeout]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    logDebug('LOGIN-START', `Attempting login for ${auth.email}`);
    updateSession({ error: null, loading: true });
    try {
      const formData = new URLSearchParams();
      formData.append('username', auth.email);
      formData.append('password', auth.password);

      const response = await apiRequest(`${auth.apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        timeoutMs: 10000,
        onDebug: logDebug
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
        const connected = await resolveConnectionAfterAuth(data.access_token, 'login');
        
        if (connected) {
          auth.setGlobalView('main');
          updateSession({ success: `Welcome back, ${auth.email}!` });
        } else {
          auth.setGlobalView('setup');
          updateSession({ success: 'Login successful! Please connect your Jira instance.' });
        }
        
        ai.fetchUsage();
        ai.fetchAISettings();
        setTimeout(() => updateSession({ success: null }), TIMEOUTS.NOTIFICATION_AUTO_HIDE_LONG);
      } else {
        throw new Error(data.detail || 'Login failed');
      }
    } catch (err) {
      updateSession({ error: translateError(err, 'login').description });
    } finally {
      updateSession({ loading: false });
    }
  }, [ai, auth, logDebug, resolveConnectionAfterAuth, updateSession]);


  const value: BugMindContextType = {
    session: sessionData.session,
    updateSession: sessionData.updateSession,
    currentTabId: sessionData.currentTabId,
    setTabSessions: sessionData.setTabSessions,
    auth,
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
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_CONTEXT', tabId: currentTabId, force });
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
    handleLogout: () => auth.handleLogout(() => setTabSessions({})),
    handleTabReload: () => chrome.tabs.reload(currentTabId!),
    completeOnboarding: async () => {
      await chrome.storage.local.set({ bugmind_onboarding_completed: true });
      setTabSessions(prev => {
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
  const [internalLogs, setInternalLogs] = React.useState<DebugLog[]>([]);
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
const AuthContextValueWrapper: React.FC<WrapperProps> = ({ children, logDebug, ...props }) => {
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
