import React, { ReactNode, useCallback, useMemo, useEffect, useRef } from 'react';
import { useSession } from '../hooks/useSession';

import { TIMEOUTS, LIMITS } from '../constants';
import { apiRequest, getErrorMessage, readJsonResponse, throwApiErrorResponse } from '../services/api';
import {
  AISettingsUpdateRequestPayload,
  AuthBootstrapRequestPayload,
  AuthBootstrapResponsePayload,
  AuthLogoutRequestPayload,
  AuthTokenResponsePayload,
  ForgotPasswordRequestPayload,
  GoogleAuthConfigResponsePayload,
  GoogleLoginRequestPayload,
  MessageResponsePayload,
  RegisterRequestPayload,
  ResetPasswordRequestPayload,
  buildProjectRequestParams,
} from '../services/contracts';
import { BugMindContext, BugMindContextType } from '../hooks/useBugMind';
import { obfuscate } from '../utils/StorageObfuscator';
import { DebugLog, IssueData, JiraCapabilityProfile } from '../types';

// New Specialized Providers
import { AuthProvider } from './AuthProvider';
import { JiraProvider } from './JiraProvider';
import { AIProvider } from './AIProvider';
import { useAuthContext } from '../hooks/useAuthContext';
import { useAIContext } from '../hooks/useAIContext';
import { useJiraContext } from '../hooks/useJiraContext';
import { getMappedSourceStoryFields, getProfileProjectParams } from '../services/JiraCapabilityService';

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
  const forgotPasswordInFlightRef = useRef(false);
  const resetPasswordInFlightRef = useRef(false);
  const googleLoginInFlightRef = useRef(false);
  const saveSettingsInFlightRef = useRef(false);
  const enrichedIssueSignatureRef = useRef('');

  const stringifyJiraFieldValue = useCallback((value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(item => stringifyJiraFieldValue(item)).filter(Boolean).join('\n');
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.type === 'doc' && Array.isArray(record.content)) {
        return stringifyJiraFieldValue(record.content);
      }
      if (typeof record.text === 'string') return record.text;
      if (typeof record.value === 'string') return record.value;
      if (typeof record.name === 'string') return record.name;
      if (typeof record.displayName === 'string') return record.displayName;
      if (Array.isArray(record.content)) return stringifyJiraFieldValue(record.content);
      return Object.values(record).map(item => stringifyJiraFieldValue(item)).filter(Boolean).join(' ');
    }
    return '';
  }, []);

  const buildProfileIssueData = useCallback((
    current: IssueData,
    profile: JiraCapabilityProfile,
    rawIssue: Record<string, unknown>
  ): IssueData => {
    const fields = rawIssue.fields && typeof rawIssue.fields === 'object'
      ? rawIssue.fields as Record<string, unknown>
      : {};
    const sections = getMappedSourceStoryFields(profile)
      .map(section => {
        const text = section.fieldId ? stringifyJiraFieldValue(fields[section.fieldId]).trim() : '';
        return text ? `${section.label}:\n${text}` : '';
      })
      .filter(Boolean);
    const linkedTestKeys = Array.isArray(fields.issuelinks)
      ? fields.issuelinks.flatMap((link) => {
        if (!link || typeof link !== 'object') return [];
        const record = link as Record<string, unknown>;
        const linkedIssues = [record.inwardIssue, record.outwardIssue]
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
        return linkedIssues
          .filter((issue) => {
            const issueFields = issue.fields && typeof issue.fields === 'object' ? issue.fields as Record<string, unknown> : {};
            const issueType = issueFields.issuetype && typeof issueFields.issuetype === 'object' ? issueFields.issuetype as Record<string, unknown> : {};
            const typeName = String(issueType.name || '').trim().toLowerCase();
            return typeName === profile.issueTypes.test?.name?.trim().toLowerCase() || typeName.includes('test');
          })
          .map((issue) => String(issue.key || '').trim())
          .filter(Boolean);
      })
      : [];

    return {
      ...current,
      summary: stringifyJiraFieldValue(fields.summary).trim() || current.summary,
      description: stringifyJiraFieldValue(fields.description).trim() || current.description,
      acceptanceCriteria: sections.join('\n\n') || current.acceptanceCriteria,
      priority: stringifyJiraFieldValue(fields.priority).trim() || current.priority,
      labels: Array.isArray(fields.labels) ? fields.labels.map(item => stringifyJiraFieldValue(item).trim()).filter(Boolean) : current.labels,
      components: Array.isArray(fields.components) ? fields.components.map(item => stringifyJiraFieldValue(item).trim()).filter(Boolean) : current.components,
      fixVersions: Array.isArray(fields.fixVersions) ? fields.fixVersions.map(item => stringifyJiraFieldValue(item).trim()).filter(Boolean) : current.fixVersions,
      linkedTestKeys: Array.from(new Set(linkedTestKeys.length ? linkedTestKeys : current.linkedTestKeys || [])),
    };
  }, [stringifyJiraFieldValue]);

  useEffect(() => {
    selectedIssueTypeIdRef.current = session.selectedIssueType?.id || undefined;
  }, [session.selectedIssueType?.id]);

  useEffect(() => {
    const profile = session.jiraCapabilityProfile;
    const issueKey = session.issueData?.key;
    if (!profile || !issueKey || !session.jiraConnectionId || !auth.authToken) return;

    const mappedFields = Object.values(profile.sourceStoryMapping).filter(Boolean).sort().join(',');
    if (!mappedFields) return;

    const signature = `${session.jiraConnectionId}:${issueKey}:${mappedFields}`;
    if (enrichedIssueSignatureRef.current === signature) return;
    enrichedIssueSignatureRef.current = signature;

    let cancelled = false;
    logDebug('JIRA-SOURCE', `Fetching mapped source fields for ${issueKey}`);
    apiRequest(`${auth.apiBase}/jira/connections/${session.jiraConnectionId}/issues/${encodeURIComponent(issueKey)}`, {
      token: auth.authToken,
      onUnauthorized: auth.refreshSession,
      onDebug: logDebug
    })
      .then(async (res) => {
        if (!res.ok) {
          await throwApiErrorResponse(res, `Failed to fetch mapped Jira issue fields (${res.status})`);
        }
        return readJsonResponse<Record<string, unknown>>(res);
      })
      .then((rawIssue) => {
        if (cancelled || !session.issueData) return;
        const enriched = buildProfileIssueData(session.issueData, profile, rawIssue);
        updateSession({ issueData: enriched });
        logDebug('JIRA-SOURCE-OK', `Applied source story mapping for ${issueKey}`);
      })
      .catch((err) => {
        enrichedIssueSignatureRef.current = '';
        logDebug('JIRA-SOURCE-WARN', getErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [auth.apiBase, auth.authToken, auth.refreshSession, buildProfileIssueData, logDebug, session.issueData, session.jiraCapabilityProfile, session.jiraConnectionId, updateSession]);

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

    const profileProject = getProfileProjectParams(session.jiraCapabilityProfile);
    const projectKey = profileProject.projectKey || context.issueData?.key?.split('-')[0];
    const signature = JSON.stringify({
      tabId: tabId || currentTabId || null,
      instanceUrl: context.instanceUrl,
      projectKey: projectKey || null,
      projectId: profileProject.projectId || context.issueData?.projectId || null,
      issueTypeId: selectedIssueTypeIdRef.current || null
    });

    const alreadySynced =
      !!session.jiraConnectionId &&
      (!!session.jiraMetadata || !projectKey) &&
      (!projectKey || session.jiraMetadata?.project_key === projectKey);

    if (inFlightBootstrapRef.current) {
      return null;
    }

    if (lastBootstrapSignatureRef.current === signature && alreadySynced) {
      return null;
    }
    
    inFlightBootstrapRef.current = true;
    lastBootstrapSignatureRef.current = signature;

    logDebug('JIRA-BOOT', `Triggering background bootstrap for ${context.instanceUrl}`);
    try {
      const result = await jira.bootstrapContext({
        instanceUrl: context.instanceUrl,
        issueKey: context.issueData?.key,
        projectKey,
        projectId: profileProject.projectId || context.issueData?.projectId,
        issueTypeId: selectedIssueTypeIdRef.current,
        tabId: tabId || currentTabId || undefined,
        tokenOverride
      });

      if (result && auth.globalView === 'setup') {
        auth.setGlobalView('main');
      }

      if (!result) {
        lastBootstrapSignatureRef.current = '';
      }

      return result;
    } finally {
      inFlightBootstrapRef.current = false;
    }
  }, [auth, currentTabId, jira, logDebug, session.jiraCapabilityProfile, session.jiraConnectionId, session.jiraMetadata]);

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
    const profileProject = getProfileProjectParams(session.jiraCapabilityProfile);
    const payload: AuthBootstrapRequestPayload = {
      instance_url: currentContext?.instanceUrl || undefined,
      issue_key: currentContext?.issueData?.key || undefined,
      project_key: profileProject.projectKey || project_key,
      project_id: profileProject.projectId || project_id,
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
      await throwApiErrorResponse(response, `Auth bootstrap failed (${response.status})`);
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

      // Phase 5: Workspaces
      updateSession({
        workspaces: data.workspaces || [],
        activeWorkspaceId: data.active_workspace_id || null,
        activeWorkspaceRole: data.workspaces?.find(w => w.id === data.active_workspace_id)?.role || null
      });


    return data.view;
  }, [auth.apiBase, currentTabId, fetchCurrentContext, jira, logDebug, session.jiraCapabilityProfile, session.selectedIssueType?.id, updateSession, withTimeout]);

  const completeAuthenticatedSession = useCallback(async (
    data: AuthTokenResponsePayload,
    successMessages?: { main: string; setup: string }
  ) => {
    auth.setAuthToken(data.access_token);
    if (data.refresh_token) auth.setRefreshToken(data.refresh_token);

    const secureToken = obfuscate(data.access_token);
    const secureRefreshToken = data.refresh_token ? obfuscate(data.refresh_token) : '';
    if (auth.rememberMe) {
      chrome.storage.local.set({
        bugmind_token: secureToken,
        bugmind_refresh_token: secureRefreshToken,
        bugmind_email: auth.email,
        bugmind_remember_me: true
      });
    } else {
      chrome.storage.local.remove(['bugmind_token', 'bugmind_refresh_token']);
      chrome.storage.local.set({ bugmind_email: auth.email, bugmind_remember_me: false });
    }
    chrome.storage.session.set({ bugmind_token: secureToken, bugmind_refresh_token: secureRefreshToken });

    const nextView = await runAuthBootstrap(data.access_token);
    if (nextView === 'main') {
      auth.setGlobalView('main');
      updateSession({ success: successMessages?.main || `Welcome back, ${auth.email}!` });
    } else {
      auth.setGlobalView('setup');
      updateSession({ success: successMessages?.setup || 'Login successful! Please connect your Jira instance.' });
    }

    ai.fetchUsage();
    ai.fetchAISettings();
    setTimeout(() => updateSession({ success: null }), TIMEOUTS.NOTIFICATION_AUTO_HIDE_LONG);
  }, [ai, auth, runAuthBootstrap, updateSession]);

  const startGoogleAuthFlow = useCallback(async (): Promise<string> => {
    const configRes = await apiRequest(`${auth.apiBase}/auth/google/config`, {
      onDebug: logDebug,
      timeoutMs: 10000
    });
    if (!configRes.ok) {
      await throwApiErrorResponse(configRes, `Google config failed (${configRes.status})`);
    }

    const config = await readJsonResponse<GoogleAuthConfigResponsePayload>(configRes);
    if (!config.enabled || !config.client_id) {
      throw new Error('Google sign-in is not configured');
    }

    const redirectUri = chrome.identity.getRedirectURL('google');
    const nonce = crypto.randomUUID();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', config.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'id_token');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('prompt', 'select_account');
    if (auth.email.trim()) {
      authUrl.searchParams.set('login_hint', auth.email.trim());
    }

    const callbackUrl = await chrome.identity.launchWebAuthFlow({
      interactive: true,
      url: authUrl.toString()
    });
    if (!callbackUrl) {
      throw new Error('Google sign-in was cancelled');
    }

    const fragment = callbackUrl.split('#')[1] || '';
    const params = new URLSearchParams(fragment);
    const idToken = params.get('id_token');
    if (!idToken) {
      throw new Error(params.get('error_description') || params.get('error') || 'Google sign-in failed');
    }
    return idToken;
  }, [auth.apiBase, auth.email, logDebug]);

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
      } else if (res.status === 401) {
        logDebug('AUTH-FAIL', 'Session invalid. Redirecting to login.');
        auth.setAuthToken(null);
        auth.setGlobalView('auth');
      } else {
        await throwApiErrorResponse(res, `Authentication bootstrap failed (${res.status})`);
      }
    } catch (err) {
      logDebug('AUTH-ERR', `Background verification failed: ${err}`);
      // Don't force redirect on network errors, just show the error
      updateSession({ error: getErrorMessage(err) });
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
      if (!response.ok) {
        await throwApiErrorResponse(response, `Login failed (${response.status})`);
      }
      const data = await readJsonResponse<AuthTokenResponsePayload>(response);
      if (data.access_token) {
        logDebug('LOGIN-OK', 'Login successful. Verifying Jira status...');
        await completeAuthenticatedSession(data);
      } else {
        throw new Error(data.detail || 'Login failed');
      }
    } catch (err) {
      updateSession({ error: getErrorMessage(err) });
    } finally {
      loginInFlightRef.current = false;
      updateSession({ loading: false });
    }
  }, [auth, completeAuthenticatedSession, logDebug, updateSession]);


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
    refreshIssue: useCallback((force) => {
      logDebug('MANUAL-SYNC', 'Triggering manual context refresh via worker...');
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_CONTEXT', tabId: currentTabId, force });
    }, [currentTabId, logDebug]),
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
          await throwApiErrorResponse(res, `Registration failed (${res.status})`);
        }

        auth.setAuthMode('login');
        auth.setPassword('');
        auth.setConfirmPassword('');
        sessionData.updateSession({ success: 'Account created! Please sign in.' });
      } catch (err) {
        sessionData.updateSession({ error: getErrorMessage(err) });
      } finally {
        registerInFlightRef.current = false;
        sessionData.updateSession({ loading: false });
      }
    },
    handleForgotPassword: async (e) => {
      e.preventDefault();
      if (forgotPasswordInFlightRef.current) return;
      forgotPasswordInFlightRef.current = true;
      sessionData.updateSession({ loading: true, error: null, success: null });
      try {
        const payload: ForgotPasswordRequestPayload = { email: auth.email };
        const res = await apiRequest(`${auth.apiBase}/auth/password/forgot`, {
          method: 'POST',
          body: JSON.stringify(payload),
          timeoutMs: 10000,
          onDebug: logDebug
        });
        if (!res.ok) {
          await throwApiErrorResponse(res, `Forgot password failed (${res.status})`);
        }
        const data = await readJsonResponse<MessageResponsePayload>(res);
        auth.setResetCode('');
        auth.setPassword('');
        auth.setConfirmPassword('');
        auth.setAuthMode('reset');
        sessionData.updateSession({ success: data.message || 'Reset code sent. Check your email.' });
      } catch (err) {
        sessionData.updateSession({ error: getErrorMessage(err) });
      } finally {
        forgotPasswordInFlightRef.current = false;
        sessionData.updateSession({ loading: false });
      }
    },
    handleResetPassword: async (e) => {
      e.preventDefault();
      if (resetPasswordInFlightRef.current) return;
      resetPasswordInFlightRef.current = true;
      sessionData.updateSession({ loading: true, error: null, success: null });
      try {
        if (auth.password !== auth.confirmPassword) {
          throw new Error('Passwords do not match');
        }
        const payload: ResetPasswordRequestPayload = {
          email: auth.email,
          code: auth.resetCode,
          new_password: auth.password
        };
        const res = await apiRequest(`${auth.apiBase}/auth/password/reset`, {
          method: 'POST',
          body: JSON.stringify(payload),
          timeoutMs: 10000,
          onDebug: logDebug
        });
        if (!res.ok) {
          await throwApiErrorResponse(res, `Password reset failed (${res.status})`);
        }
        const data = await readJsonResponse<MessageResponsePayload>(res);
        auth.setAuthMode('login');
        auth.setPassword('');
        auth.setConfirmPassword('');
        auth.setResetCode('');
        sessionData.updateSession({ success: data.message || 'Password updated. Please sign in again.' });
      } catch (err) {
        sessionData.updateSession({ error: getErrorMessage(err) });
      } finally {
        resetPasswordInFlightRef.current = false;
        sessionData.updateSession({ loading: false });
      }
    },
    handleGoogleLogin: async () => {
      if (googleLoginInFlightRef.current) return;
      googleLoginInFlightRef.current = true;
      sessionData.updateSession({ loading: true, error: null, success: null });
      try {
        const idToken = await startGoogleAuthFlow();
        const res = await apiRequest(`${auth.apiBase}/auth/google`, {
          method: 'POST',
          body: JSON.stringify({ id_token: idToken } satisfies GoogleLoginRequestPayload),
          timeoutMs: 15000,
          onDebug: logDebug
        });
        if (!res.ok) {
          await throwApiErrorResponse(res, `Google login failed (${res.status})`);
        }
        const data = await readJsonResponse<AuthTokenResponsePayload>(res);
        if (!data.access_token) {
          throw new Error(data.detail || 'Google login failed');
        }
        await completeAuthenticatedSession(data, {
          main: 'Google sign-in successful.',
          setup: 'Google sign-in successful! Please connect your Jira instance.'
        });
      } catch (err) {
        sessionData.updateSession({ error: getErrorMessage(err) });
      } finally {
        googleLoginInFlightRef.current = false;
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
        payload.custom_model = ai.customModel.trim();
        if (ai.customKey.trim()) {
          payload.openrouter_key = ai.customKey.trim();
        }
        if (ai.clearCustomKeyRequested) {
          payload.clear_openrouter_key = true;
        }
        const res = await apiRequest(`${auth.apiBase}/settings/ai`, {
          method: 'POST', token: auth.authToken, onUnauthorized: auth.refreshSession,
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          await throwApiErrorResponse(res, `Request failed with status ${res.status}`);
        }
        if (res.ok) {
          ai.setHasCustomKeySaved(ai.clearCustomKeyRequested ? false : (ai.customKey.trim() ? true : ai.hasCustomKeySaved));
          ai.setCustomKey('');
          ai.setClearCustomKeyRequested(false);
          sessionData.updateSession({ success: 'Saved' });
        }
      } catch (err) {
        sessionData.updateSession({ error: getErrorMessage(err) });
      } finally {
        saveSettingsInFlightRef.current = false;
        sessionData.updateSession({ loading: false });
      }
    },
    saveFieldSettings: async (nf, nm, nd) => {
      try {
        const profileProject = getProfileProjectParams(sessionData.session.jiraCapabilityProfile);
        const pKey = profileProject.projectKey || sessionData.session.issueData?.key.split('-')[0];
        if (!sessionData.session.jiraConnectionId || !pKey || !sessionData.session.selectedIssueType?.id) {
          throw new Error('Missing Jira context for field settings sync');
        }
        const synced = await jira.saveFieldSettings({
          jiraConnectionId: sessionData.session.jiraConnectionId,
          projectKey: pKey,
          projectId: sessionData.session.jiraMetadata?.project_id || profileProject.projectId || sessionData.session.issueData?.projectId,
          issueTypeId: sessionData.session.selectedIssueType.id,
          visibleFields: nf || sessionData.session.visibleFields,
          aiMapping: nm || sessionData.session.aiMapping,
          fieldDefaults: nd || sessionData.session.fieldDefaults
        });
        if (!synced) {
          throw new Error('Sync failed');
        }
        sessionData.updateSession({ success: 'Synced' });
      } catch (err) { sessionData.updateSession({ error: getErrorMessage(err) }); }
    },
    handleLogout: async () => {
      try {
        if (auth.refreshToken) {
          await apiRequest(`${auth.apiBase}/auth/logout`, {
            method: 'POST',
            body: JSON.stringify({ refresh_token: auth.refreshToken } satisfies AuthLogoutRequestPayload),
            timeoutMs: 5000,
            onDebug: logDebug
          });
        }
      } catch (err) {
        logDebug('LOGOUT-WARN', `Remote logout failed: ${getErrorMessage(err)}`);
      } finally {
        auth.handleLogout(() => setTabSessions({}));
      }
    },
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
