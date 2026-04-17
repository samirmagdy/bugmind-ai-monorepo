import React, { ReactNode, useCallback, useMemo } from 'react';
import { useSession } from '../hooks/useSession';
import { useAuth } from '../hooks/useAuth';
import { useJira } from '../hooks/useJira';
import { useAI } from '../hooks/useAI';
import { INITIAL_SESSION } from '../types';
import { translateError } from '../utils/ErrorTranslator';
import { apiRequest } from '../services/api';
import { TIMEOUTS, LIMITS, DOMAINS } from '../constants';
import { obfuscate } from '../utils/StorageObfuscator';
import { BugMindContext, BugMindContextType } from '../hooks/useBugMind';

export const BugMindProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // 1. Utilities (Debug)
  const [internalLogs, setInternalLogs] = React.useState<{timestamp: string, tag: string, msg: string}[]>([]);
  const [showDebug, setShowDebug] = React.useState(false);

  const logDebug = useCallback((tag: string, msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    
    // Security: Scrub sensitive data from logs
    let scrubbedMsg = msg;
    scrubbedMsg = scrubbedMsg.replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[JWT_TOKEN]');
    scrubbedMsg = scrubbedMsg.replace(/Basic [a-zA-Z0-9+/=]+/g, 'Basic [REDACTED]');
    scrubbedMsg = scrubbedMsg.replace(/Bearer [a-zA-Z0-9_-]+/g, 'Bearer [REDACTED]');

    setInternalLogs(prev => [{ timestamp, tag, msg: scrubbedMsg }, ...prev].slice(0, LIMITS.MAX_DEBUG_LOGS));
  }, []);

  const clearLogs = useCallback(() => setInternalLogs([]), []);

  // 2. Initialize Hooks
  const sessionData = useSession(logDebug);
  const authData = useAuth(logDebug);
  const jiraData = useJira(
    authData.apiBase, 
    authData.authToken, 
    logDebug, 
    sessionData.session, 
    sessionData.updateSession
  );
  const aiData = useAI(
    authData.apiBase,
    authData.authToken,
    logDebug,
    sessionData.session,
    sessionData.updateSession,
    sessionData.currentTabId,
    sessionData.setTabSessions
  );

  // 3. Orchestration Logic

  const checkAuth = useCallback(async (token?: string) => {
    logDebug('AUTH-INIT', 'Checking for existing session...');
    
    chrome.storage.local.get(['bugmind_onboarding_completed'], (res) => {
      if (res.bugmind_onboarding_completed) {
        sessionData.updateSession({ onboardingCompleted: true });
      }
    });

    const activeToken = token || authData.authToken;
    if (!activeToken) {
      authData.setGlobalView('auth');
      authData.setInitializing(false);
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.API_REQUEST);

      const res = await apiRequest(`${authData.apiBase}/auth/login/verify`, {
        token: activeToken,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        logDebug('AUTH-OK', 'Token valid.');
        authData.setGlobalView('main');
        await jiraData.checkJiraStatus(true, undefined, activeToken, undefined, sessionData.currentTabId || undefined);
        aiData.fetchUsage(); 
        aiData.fetchAISettings();
      } else {
        logDebug('AUTH-ERROR', 'Session expired');
        authData.setAuthToken(null);
        authData.setGlobalView('auth');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('AUTH-ERROR', errMsg);
      const translated = translateError(err, 'auth');
      sessionData.updateSession({ error: translated.description });
    } finally {
      logDebug('AUTH-READY', 'Initialization complete');
      authData.setInitializing(false);
    }
  }, [authData, logDebug, jiraData, aiData, sessionData]);

  const refreshIssue = useCallback((force = false) => {
    if (sessionData.session.loading && !force) {
      logDebug('EXTRACT-SKIP', 'Already refreshing context...');
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab?.url) return;
      
      const tabId = tab.id;
      const url = tab.url;
      logDebug('EXTRACT', `Hunting for Jira issue context in tab ${tabId}...`);

      if (!url.includes(DOMAINS.JIRA_CLOUD) && !url.includes(DOMAINS.BROWSE_PATH) && !url.includes(DOMAINS.ISSUES_PATH)) {
        logDebug('EXTRACT-SKIP', 'Not a Jira URL');
        sessionData.updateSession({ issueData: null, error: 'NOT_A_JIRA_PAGE' }, tabId);
        return;
      }

      chrome.tabs.sendMessage(tabId, { type: 'PING' }, (pingRes) => {
        const isHealthy = !chrome.runtime.lastError && pingRes?.type === 'PONG' && pingRes?.version === '1.2.0';
        
        if (isHealthy) {
          logDebug('EXTRACT', 'Content script healthy, requesting data...');
          chrome.tabs.sendMessage(tabId, { type: 'GET_ISSUE_DATA' }, (response) => {
            if (response?.type === 'ISSUE_DATA_SUCCESS') {
              const detectedInstance = url.split('/browse/')[0].split('/issues/')[0];
              const isStory = response.data.typeName?.toLowerCase().includes('story');
              
              if (!isStory) {
                logDebug('EXTRACT-SKIP', `Issue type ${response.data.typeName} is not a Story. Blocking.`);
                sessionData.updateSession({ 
                  issueData: response.data,
                  instanceUrl: detectedInstance,
                  error: 'UNSUPPORTED_ISSUE_TYPE' 
                }, tabId);
                return;
              }

              sessionData.updateSession({ 
                issueData: response.data,
                instanceUrl: detectedInstance,
                theme: sessionData.session.themeSource === 'auto' 
                  ? (response.data.theme || sessionData.session.theme) 
                  : sessionData.session.theme,
                error: null 
              }, tabId);
            } else {
              logDebug('EXTRACT-FAIL', 'Healthy script failed to return valid data');
              sessionData.updateSession({ error: 'STALE_PAGE' }, tabId);
            }
          });
        } else {
          logDebug('EXTRACT-HEAL', `Script unhealthy: ${chrome.runtime.lastError?.message || 'Version Mismatch'}. Healing...`);
          
          chrome.scripting.executeScript({
            target: { tabId },
            files: ['assets/content.js']
          }).then(() => {
            logDebug('HEAL-OK', 'Content script healed. Extracting...');
            chrome.tabs.sendMessage(tabId, { type: 'GET_ISSUE_DATA' }, (retryResponse) => {
              if (retryResponse?.type === 'ISSUE_DATA_SUCCESS') {
                const detectedInstance = url.split('/browse/')[0].split('/issues/')[0];
                const isStory = retryResponse.data.typeName?.toLowerCase().includes('story');
                
                if (!isStory) {
                  logDebug('HEAL-EXTRACT-SKIP', `Healed issue type ${retryResponse.data.typeName} is not a Story.`);
                  sessionData.updateSession({ 
                    issueData: retryResponse.data,
                    instanceUrl: detectedInstance,
                    error: 'UNSUPPORTED_ISSUE_TYPE' 
                  }, tabId);
                  return;
                }

                logDebug('HEAL-EXTRACT-OK', 'Extraction recovered after healing');
                sessionData.updateSession({ 
                  issueData: retryResponse.data,
                  instanceUrl: detectedInstance,
                  theme: sessionData.session.themeSource === 'auto' 
                    ? (retryResponse.data.theme || sessionData.session.theme) 
                    : sessionData.session.theme,
                  error: null 
                }, tabId);
              } else {
                logDebug('HEAL-EXTRACT-FAIL', 'Extraction failed even after healing');
                sessionData.updateSession({ error: 'STALE_PAGE' }, tabId);
              }
            });
          }).catch((err) => {
            logDebug('HEAL-FAIL', `Heal failed: ${err.message}`);
            sessionData.updateSession({ error: 'STALE_PAGE' }, tabId);
          });
        }
      });
    });
  }, [logDebug, sessionData]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    logDebug('LOGIN-START', `Attempting login for ${authData.email}`);
    sessionData.updateSession({ error: null });
    try {
      const formData = new URLSearchParams();
      formData.append('username', authData.email);
      formData.append('password', authData.password);

      const response = await apiRequest(`${authData.apiBase}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
      });
      const data = await response.json();
      if (data.access_token) {
        logDebug('LOGIN-OK', `Login successful. Remember: ${authData.rememberMe}`);
        authData.setAuthToken(data.access_token);
        chrome.storage.local.set({ 
          bugmind_email: authData.email,
          bugmind_remember_me: authData.rememberMe
        });
        const secureToken = obfuscate(data.access_token);
        if (authData.rememberMe) {
          chrome.storage.local.set({ bugmind_token: secureToken });
        } else {
          chrome.storage.session.set({ bugmind_token: secureToken });
        }
        authData.setGlobalView('main');
        
        await jiraData.checkJiraStatus(true, undefined, data.access_token, undefined, sessionData.currentTabId || undefined);
        aiData.fetchUsage();
        aiData.fetchAISettings();
        refreshIssue();

        sessionData.updateSession({ success: `Welcome back, ${authData.email}!` });
        setTimeout(() => sessionData.updateSession({ success: null }), TIMEOUTS.NOTIFICATION_AUTO_HIDE_LONG);
      } else {
        throw new Error(data.detail || 'Login failed');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('LOGIN-ERR', errMsg);
      const translated = translateError(err, 'login');
      sessionData.updateSession({ error: translated.description });
    }
  }, [authData, logDebug, sessionData, jiraData, aiData, refreshIssue]);

  const handleRegister = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (authData.password !== authData.confirmPassword) {
      sessionData.updateSession({ error: "Passwords do not match" });
      return;
    }
    logDebug('REG-START', `Registering account: ${authData.email}`);
    sessionData.updateSession({ error: null });
    try {
      const response = await apiRequest(`${authData.apiBase}/auth/register`, {
        method: 'POST',
        body: JSON.stringify({
          email: authData.email,
          password: authData.password
        })
      });
      const data = await response.json();
      if (data.id) {
        logDebug('REG-OK', 'Registration successful');
        authData.setAuthMode('login');
        sessionData.updateSession({ error: null, success: 'Account created! You can now sign in.' });
        setTimeout(() => sessionData.updateSession({ success: null }), TIMEOUTS.NOTIFICATION_AUTO_HIDE_LONG);
      } else {
        throw new Error(data.detail || 'Registration failed');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('REG-ERR', errMsg);
      const translated = translateError(err, 'register');
      sessionData.updateSession({ error: translated.description });
    }
  }, [authData, logDebug, sessionData]);

  const handleJiraConnect = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    logDebug('JIRA-CONNECT', 'Saving connection settings...');
    sessionData.updateSession({ loading: true, error: null });
    
    try {
      const url = jiraData.jiraPlatform === 'cloud' ? jiraData.cloudUrl : jiraData.serverUrl;
      const connected = await jiraData.checkJiraStatus(
        true, 
        undefined, 
        authData.authToken || undefined, 
        url, 
        sessionData.currentTabId || undefined
      );

      if (connected) {
        logDebug('JIRA-OK', 'Connection verified and saved');
        authData.setGlobalView('main');
        sessionData.updateSession({ success: 'Jira connected successfully' });
        setTimeout(() => sessionData.updateSession({ success: null }), TIMEOUTS.NOTIFICATION_AUTO_HIDE);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('JIRA-ERR', errMsg);
      const translated = translateError(err, 'jira-connect');
      sessionData.updateSession({ error: translated.description });
    } finally {
      sessionData.updateSession({ loading: false });
    }
  }, [authData, jiraData, logDebug, sessionData]);

  const handleSaveSettings = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    logDebug('SETTINGS-SAVE', 'Updating AI overrides...');
    sessionData.updateSession({ loading: true });
    try {
      const res = await apiRequest(`${authData.apiBase}/settings/ai`, {
        method: 'POST',
        token: authData.authToken,
        body: JSON.stringify({
          custom_model: aiData.customModel,
          openrouter_key: aiData.customKey
        })
      });
      if (res.ok) {
        logDebug('SETTINGS-OK', 'Settings saved successfully');
        aiData.setHasCustomKeySaved(!!aiData.customKey || aiData.hasCustomKeySaved);
        aiData.setCustomKey('');
        sessionData.updateSession({ success: 'AI settings updated successfully' });
        setTimeout(() => sessionData.updateSession({ success: null }), TIMEOUTS.NOTIFICATION_AUTO_HIDE);
      } else {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to save settings');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('SETTINGS-ERR', errMsg);
      const translated = translateError(err, 'settings');
      sessionData.updateSession({ error: translated.description });
    } finally {
      sessionData.updateSession({ loading: false });
    }
  }, [aiData, authData.apiBase, authData.authToken, logDebug, sessionData]);

  const saveFieldSettings = useCallback(async (nextFields?: string[], nextMapping?: Record<string, string>) => {
    if (!sessionData.session.instanceUrl || !sessionData.session.jiraMetadata) return;
    const pKey = sessionData.session.jiraMetadata.project_key;
    const pId = sessionData.session.issueData?.projectId;
    const issueTypeId = sessionData.session.selectedIssueType?.id;
    if (!issueTypeId) return;

    const visibleFields = nextFields || sessionData.session.visibleFields;
    const aiMapping = nextMapping || sessionData.session.aiMapping;

    logDebug('SETTINGS-SYNC', `Saving project field configuration...`);
    sessionData.updateSession({ visibleFields, aiMapping });

    try {
      await apiRequest(`${authData.apiBase}/settings/jira`, {
        method: 'POST',
        token: authData.authToken,
        body: JSON.stringify({
          base_url: sessionData.session.instanceUrl,
          project_key: pKey,
          project_id: pId,
          issue_type_id: issueTypeId,
          visible_fields: visibleFields,
          ai_mapping: aiMapping
        })
      });
      logDebug('SETTINGS-OK', 'Project settings persisted to cloud');
      sessionData.updateSession({ success: 'Field configuration synced' });
      setTimeout(() => sessionData.updateSession({ success: null }), TIMEOUTS.NOTIFICATION_AUTO_HIDE);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('SETTINGS-ERR', `Failed to sync settings: ${errMsg}`);
      const translated = translateError(err, 'settings-sync');
      sessionData.updateSession({ error: translated.description });
    }
  }, [authData.apiBase, authData.authToken, logDebug, sessionData]);

  const handleLogout = useCallback(() => {
    authData.handleLogout(() => sessionData.setTabSessions({}));
  }, [authData, sessionData]);

  const handleTabReload = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.reload(tabs[0].id);
        logDebug('SYS-RELOAD', 'Target tab reload triggered');
      }
    });
  }, [logDebug]);

  const completeOnboarding = useCallback(async () => {
    logDebug('SYS-ONBOARD', 'Onboarding completed');
    await chrome.storage.local.set({ 'bugmind_onboarding_completed': true });
    const nextTabSessions = { ...sessionData.tabSessions };
    Object.keys(nextTabSessions).forEach(id => {
      const tid = Number(id);
      nextTabSessions[tid] = { ...(nextTabSessions[tid] || INITIAL_SESSION), onboardingCompleted: true };
    });
    sessionData.setTabSessions(nextTabSessions);
  }, [logDebug, sessionData]);

  // 4. Global Effects
  
  const currentTabIdRef = React.useRef(sessionData.currentTabId);
  React.useEffect(() => {
    currentTabIdRef.current = sessionData.currentTabId;
  }, [sessionData.currentTabId, sessionData]);

  React.useEffect(() => {
    const handleTabLoad = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === 'complete' && tabId === currentTabIdRef.current) {
        logDebug('SYS-SYNC', 'Tab refreshed. Re-scanning context...');
        refreshIssue();
      }
    };
    chrome.tabs.onUpdated.addListener(handleTabLoad);
    
    const handleRuntimeMessage = (message: { type: string, theme?: 'light' | 'dark' }) => {
      if (message.type === 'THEME_CHANGED' && message.theme) {
        if (sessionData.session.themeSource === 'auto') {
          logDebug('SYS-THEME', `Jira theme change detected: ${message.theme}`);
          sessionData.updateSession({ theme: message.theme });
        } else {
          logDebug('SYS-THEME', 'Jira theme change ignored (Manual override active)');
        }
      }
    };
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabLoad);
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [logDebug, refreshIssue, sessionData]);

  React.useEffect(() => {
    const issueKey = sessionData.session.issueData?.key;
    const instanceUrl = sessionData.session.instanceUrl;
    const projectId = sessionData.session.issueData?.projectId;
    const tabId = sessionData.currentTabId;

    if (issueKey && instanceUrl) {
      if (sessionData.session.issueTypes.length > 0) return;
      const pKey = issueKey.split('-')[0];
      jiraData.fetchIssueTypes(pKey, instanceUrl, tabId || undefined, projectId);
    }
  }, [sessionData, jiraData]);

  React.useEffect(() => {
    const issueKey = sessionData.session.issueData?.key;
    const instanceUrl = sessionData.session.instanceUrl;
    const selectedIssueType = sessionData.session.selectedIssueType;
    const projectId = sessionData.session.issueData?.projectId;
    const tabId = sessionData.currentTabId;

    if (issueKey && instanceUrl && selectedIssueType) {
      const pKey = issueKey.split('-')[0];
      const issueTypeId = selectedIssueType.id;
      
      const hasMetadata = sessionData.session.jiraMetadata?.project_key === pKey && sessionData.session.jiraMetadata?.issue_type_id === issueTypeId;
      if (!hasMetadata) {
        jiraData.fetchJiraMetadata(pKey, instanceUrl, issueTypeId, tabId || undefined, projectId);
      }
      
      if (sessionData.session.visibleFields.length === 0) {
        jiraData.fetchFieldSettings(pKey, instanceUrl, issueTypeId, tabId || undefined, projectId);
      }
    }
  }, [sessionData, jiraData]);

  React.useEffect(() => {
    const error = sessionData.session.error;

    if (error && !['STALE_PAGE', 'NOT_A_JIRA_PAGE', 'UNSUPPORTED_ISSUE_TYPE'].includes(error)) {
      sessionData.updateSession({ error: null });
    }
  }, [sessionData, authData.globalView]);

  React.useEffect(() => {
    const isInit = authData.initializing;
    const tabExists = !!sessionData.currentTabId;

    if (!isInit && tabExists) {
      logDebug('SYS-INIT', 'Authentication ready. Triggering initial context scan...');
      refreshIssue();
    }
  }, [authData.initializing, sessionData.currentTabId, logDebug, refreshIssue, sessionData]);

  const value: BugMindContextType = {
    session: sessionData.session,
    updateSession: sessionData.updateSession,
    currentTabId: sessionData.currentTabId,
    setTabSessions: sessionData.setTabSessions,
    auth: authData,
    jira: jiraData,
    ai: aiData,
    debug: useMemo(() => ({
      logs: internalLogs,
      show: showDebug,
      setShow: setShowDebug,
      log: logDebug,
      clear: clearLogs
    }), [internalLogs, showDebug, logDebug, clearLogs]),
    refreshIssue,
    checkAuth,
    handleLogin,
    handleRegister,
    handleJiraConnect,
    handleSaveSettings,
    saveFieldSettings,
    handleLogout,
    handleTabReload,
    completeOnboarding,
    initializing: authData.initializing,
    sessionHydrated: sessionData.sessionHydrated
  };

  return (
    <BugMindContext.Provider value={value}>
      {children}
    </BugMindContext.Provider>
  );
};
