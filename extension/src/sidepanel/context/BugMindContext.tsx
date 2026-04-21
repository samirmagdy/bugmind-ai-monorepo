import React, { ReactNode, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSession } from '../hooks/useSession';

import { TIMEOUTS, LIMITS } from '../constants';
import { translateError } from '../utils/ErrorTranslator';
import { apiRequest, readJsonResponse } from '../services/api';
import {
  AISettingsUpdateRequestPayload,
  AuthBootstrapRequestPayload,
  AuthBootstrapResponsePayload,
  AuthTokenResponsePayload,
  RegisterRequestPayload,
  buildProjectRequestParams,
} from '../services/contracts';
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
  const selectedIssueTypeIdRef = useRef<string | undefined>(undefined);
  const hydratedTabRef = useRef<number | null>(null);
  const lastBootstrapSignatureRef = useRef<string>('');
  const inFlightBootstrapRef = useRef<boolean>(false);
  const lastContextMessageSignatureRef = useRef<string>('');
  const staleRecoveryAttemptedRef = useRef<number | null>(null);
  const loginInFlightRef = useRef(false);
  const registerInFlightRef = useRef(false);
  const saveSettingsInFlightRef = useRef(false);

  useEffect(() => {
    selectedIssueTypeIdRef.current = session.selectedIssueType?.id || undefined;
  }, [session.selectedIssueType?.id]);

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
    const signature = JSON.stringify({
      tabId: tabId || currentTabId || null,
      instanceUrl: context.instanceUrl,
      projectKey: projectKey || null,
      projectId: context.issueData?.projectId || null,
      issueTypeId: selectedIssueTypeIdRef.current || null
    });

    if (lastBootstrapSignatureRef.current === signature || inFlightBootstrapRef.current) {
      return null;
    }
    
    inFlightBootstrapRef.current = true;
    lastBootstrapSignatureRef.current = signature;

    logDebug('JIRA-BOOT', `Triggering background bootstrap for ${context.instanceUrl}`);
    return jira.bootstrapContext({
      instanceUrl: context.instanceUrl,
      issueKey: context.issueData?.key,
      projectKey,
      projectId: context.issueData?.projectId,
      issueTypeId: selectedIssueTypeIdRef.current,
      tabId: tabId || currentTabId || undefined,
      tokenOverride
    }).finally(() => {
      inFlightBootstrapRef.current = false;
    });
  }, [auth.authToken, currentTabId, jira, logDebug]);

  const fetchCurrentContext = useCallback(async (force: boolean = false) => {
    if (!currentTabId) return null;

    return await new Promise<{ issueData?: { key?: string; projectId?: string } | null; instanceUrl?: string | null; error?: string | null } | null>((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'GET_CURRENT_CONTEXT', tabId: currentTabId, force },
        (response) => resolve(response || null)
      );
    });
  }, [currentTabId]);

  const runAuthBootstrap = useCallback(async (tokenOverride: string): Promise<'main' | 'setup'> => {
    const currentContext = await fetchCurrentContext(true);
    if (currentContext && !currentContext.error) {
      updateSession({
        instanceUrl: currentContext.instanceUrl ?? null,
        error: currentContext.error ?? null
      }, currentTabId || undefined);
      hydratedTabRef.current = currentTabId;
      lastContextMessageSignatureRef.current = JSON.stringify({
        tabId: currentTabId || null,
        instanceUrl: currentContext.instanceUrl || null,
        issueKey: currentContext.issueData?.key || null,
        projectId: currentContext.issueData?.projectId || null,
        error: currentContext.error || null
      });
      lastBootstrapSignatureRef.current = JSON.stringify({
        tabId: currentTabId || null,
        instanceUrl: currentContext.instanceUrl || null,
        projectKey: currentContext.issueData?.key?.split('-')[0] || null,
        projectId: currentContext.issueData?.projectId || null,
        issueTypeId: session.selectedIssueType?.id || null
      });
    }

    const { project_key, project_id } = buildProjectRequestParams(currentContext?.issueData || null);
    const payload: AuthBootstrapRequestPayload = {
      instance_url: currentContext?.instanceUrl || undefined,
      issue_key: currentContext?.issueData?.key || undefined,
      project_key,
      project_id,
      issue_type_id: session.selectedIssueType?.id || undefined
    };

    const response = await withTimeout(
      apiRequest(`${auth.apiBase}/auth/bootstrap`, {
        method: 'POST',
        token: tokenOverride,
        onDebug: logDebug,
        body: JSON.stringify(payload)
      }),
      8000,
      'Auth bootstrap'
    );

    if (!response.ok) {
      throw new Error(await response.text() || `Auth bootstrap failed (${response.status})`);
    }

      const data = await readJsonResponse<AuthBootstrapResponsePayload>(response);
      if (data.bootstrap_context) {
        jira.applyBootstrapContext(
          data.bootstrap_context,
          currentTabId || undefined,
          Boolean(currentContext?.issueData?.key || currentContext?.issueData?.projectId)
        );
        logDebug('AUTH-BOOT-OK', `Resolved landing view ${data.view.toUpperCase()} with Jira bootstrap.`);
      } else {
        if (data.bootstrap_error?.message) {
          logDebug('AUTH-BOOT-WARN', data.bootstrap_error.message);
        }
        logDebug('AUTH-BOOT-OK', `Resolved landing view ${data.view.toUpperCase()} without Jira bootstrap payload.`);
      }

    return data.view;
  }, [auth.apiBase, currentTabId, fetchCurrentContext, jira, logDebug, session.selectedIssueType?.id, updateSession, withTimeout]);

  // 1. Initial Context Hydration (Phase 1)
  useEffect(() => {
    if (!currentTabId || !sessionHydrated) return;
    if (hydratedTabRef.current === currentTabId) return;

    hydratedTabRef.current = currentTabId;
    logDebug('SYS-INIT', `Hydrating context for tab ${currentTabId}...`);
        chrome.runtime.sendMessage({
          type: 'GET_CURRENT_CONTEXT',
          tabId: currentTabId,
          force: false
        }, (response) => {
          if (response) {
            if (response.error) {
              logDebug('SYS-INIT-ERR', `Initial context returned error: ${String(response.error)}`);
            } else {
              logDebug('SYS-INIT-OK', 'Received initial context from background');
            }

            updateSession(response);

            if (!response.error) {
              bootstrapCurrentContext(response, currentTabId);
            }
          }
        });
  }, [bootstrapCurrentContext, currentTabId, logDebug, sessionHydrated, updateSession]);

  useEffect(() => {
    hydratedTabRef.current = null;
    lastBootstrapSignatureRef.current = '';
    lastContextMessageSignatureRef.current = '';
    staleRecoveryAttemptedRef.current = null;
  }, [currentTabId]);

  // 2. Listen for Background Events (Phase 1)
  useEffect(() => {
    const handleMessage = (message: BackgroundMessage) => {
      if (message.type === 'CONTEXT_UPDATED' && message.tabId === currentTabId) {
        const signature = JSON.stringify({
          tabId: message.tabId,
          instanceUrl: message.context?.instanceUrl || null,
          issueKey: message.context?.issueData?.key || null,
          projectId: message.context?.issueData?.projectId || null,
          error: message.context?.error || null
        });
        if (lastContextMessageSignatureRef.current === signature) {
          return;
        }
        lastContextMessageSignatureRef.current = signature;
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
      
      if (staleTime > 4000 && staleRecoveryAttemptedRef.current !== currentTabId) {
        staleRecoveryAttemptedRef.current = currentTabId;
        logDebug('SYNC-STALE', 'Still no context after 4s. Re-requesting background scan once...');
        chrome.runtime.sendMessage({
          type: 'GET_CURRENT_CONTEXT',
          tabId: currentTabId,
          force: true
        });
      }
    } else {
      lastStaleCheck.current = null;
      staleRecoveryAttemptedRef.current = null;
    }

    if (isMain && hasContext) {
      const projectKey = session.issueData?.key?.split('-')[0];
      const needsSync = !session.jiraConnectionId || !session.jiraMetadata || session.jiraMetadata.project_key !== projectKey;
      
      if (needsSync) {
        logDebug('SYNC-CONN', 'Jira context sync triggered...');
        bootstrapCurrentContext(session, currentTabId);
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
        const nextView = await runAuthBootstrap(activeToken);
        if (auth.globalView === 'auth' || auth.globalView === 'setup') {
          auth.setGlobalView(nextView);
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
  }, [auth, logDebug, runAuthBootstrap, updateSession, withTimeout]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginInFlightRef.current) return;
    loginInFlightRef.current = true;
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
      const data = await readJsonResponse<AuthTokenResponsePayload>(response);
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
        const nextView = await runAuthBootstrap(data.access_token);

        if (nextView === 'main') {
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
      loginInFlightRef.current = false;
      updateSession({ loading: false });
    }
  }, [ai, auth, logDebug, runAuthBootstrap, updateSession]);


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
      if (registerInFlightRef.current) return;
      registerInFlightRef.current = true;
      sessionData.updateSession({ loading: true, error: null, success: null });
      try {
        if (auth.password !== auth.confirmPassword) {
          throw new Error('Passwords do not match');
        }

        const payload: RegisterRequestPayload = { email: auth.email, password: auth.password };
        const res = await apiRequest(`${auth.apiBase}/auth/register`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          throw new Error(await res.text() || `Registration failed (${res.status})`);
        }

        auth.setAuthMode('login');
        auth.setPassword('');
        auth.setConfirmPassword('');
        sessionData.updateSession({ success: 'Account created! Please sign in.' });
      } catch (err) {
        sessionData.updateSession({ error: translateError(err, 'register').description });
      } finally {
        registerInFlightRef.current = false;
        sessionData.updateSession({ loading: false });
      }
    },
    handleSaveSettings: async (e) => {
      e.preventDefault();
      if (saveSettingsInFlightRef.current) return;
      saveSettingsInFlightRef.current = true;
      sessionData.updateSession({ loading: true, error: null, success: null });
      try {
        const payload: AISettingsUpdateRequestPayload = {};
        if (ai.customModel.trim()) {
          payload.custom_model = ai.customModel.trim();
        }
        if (ai.customKey.trim()) {
          payload.openrouter_key = ai.customKey.trim();
        }
        const res = await apiRequest(`${auth.apiBase}/settings/ai`, {
          method: 'POST', token: auth.authToken, onUnauthorized: auth.refreshSession,
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          throw new Error(await res.text() || `Request failed with status ${res.status}`);
        }
        if (res.ok) {
          ai.setHasCustomKeySaved(true);
          ai.setCustomKey('');
          sessionData.updateSession({ success: 'Saved' });
        }
      } catch (err) {
        sessionData.updateSession({ error: translateError(err, 'settings').description });
      } finally {
        saveSettingsInFlightRef.current = false;
        sessionData.updateSession({ loading: false });
      }
    },
    saveFieldSettings: async (nf, nm, nd) => {
      try {
        const pKey = sessionData.session.issueData?.key.split('-')[0];
        if (!sessionData.session.jiraConnectionId || !pKey || !sessionData.session.selectedIssueType?.id) {
          throw new Error('Missing Jira context for field settings sync');
        }
        const synced = await jira.saveFieldSettings({
          jiraConnectionId: sessionData.session.jiraConnectionId,
          projectKey: pKey,
          projectId: sessionData.session.jiraMetadata?.project_id || sessionData.session.issueData?.projectId,
          issueTypeId: sessionData.session.selectedIssueType.id,
          visibleFields: nf || sessionData.session.visibleFields,
          aiMapping: nm || sessionData.session.aiMapping,
          fieldDefaults: nd || sessionData.session.fieldDefaults
        });
        if (!synced) {
          throw new Error('Sync failed');
        }
        sessionData.updateSession({ success: 'Synced' });
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
