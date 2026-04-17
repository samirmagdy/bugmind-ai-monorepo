import { useState, useEffect } from 'react';
import { TabSession, IssueType, JiraField, JiraMetadata } from '../types';
import { apiRequest } from '../services/api';
import { translateError } from '../utils/ErrorTranslator';
import { obfuscate, deobfuscate } from '../utils/StorageObfuscator';

export function useJira(
  apiBase: string,
  authToken: string | null,
  logDebug: (tag: string, msg: string) => void,
  session: TabSession,
  updateSession: (updates: Partial<TabSession>, tabId?: number) => void
) {
  const [jiraPlatform, setJiraPlatform] = useState<'cloud' | 'server'>('cloud');
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudUsername, setCloudUsername] = useState('');
  const [cloudToken, setCloudToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [serverUsername, setServerUsername] = useState('');
  const [serverToken, setServerToken] = useState('');
  const [verifySsl, setVerifySsl] = useState(true);
  const [jiraConnected, setJiraConnected] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Persistence logic
  const saveJiraConfig = (updates: Record<string, string | boolean | undefined>) => {
    chrome.storage.local.get(['bugmind_jira_config'], (res) => {
      const current = (res.bugmind_jira_config as Record<string, string | boolean | undefined>) || {};
      
      // Obfuscate sensitive fields before saving
      const secureUpdates = { ...updates };
      if (typeof secureUpdates.cloudToken === 'string') secureUpdates.cloudToken = obfuscate(secureUpdates.cloudToken);
      if (typeof secureUpdates.serverToken === 'string') secureUpdates.serverToken = obfuscate(secureUpdates.serverToken);
      if (typeof secureUpdates.cloudUsername === 'string') secureUpdates.cloudUsername = obfuscate(secureUpdates.cloudUsername);
      if (typeof secureUpdates.serverUsername === 'string') secureUpdates.serverUsername = obfuscate(secureUpdates.serverUsername);
      
      chrome.storage.local.set({ 'bugmind_jira_config': { ...current, ...secureUpdates } });
    });
  };

  useEffect(() => {
    chrome.storage.local.get(['bugmind_jira_config'], (res) => {
      if (res.bugmind_jira_config) {
        const c = res.bugmind_jira_config;
        if (c.platform) setJiraPlatform(c.platform);
        if (c.cloudUrl) setCloudUrl(c.cloudUrl);
        if (c.cloudUsername) setCloudUsername(deobfuscate(c.cloudUsername));
        if (c.cloudToken) setCloudToken(deobfuscate(c.cloudToken));
        if (c.serverUrl) setServerUrl(c.serverUrl);
        if (c.serverUsername) setServerUsername(deobfuscate(c.serverUsername));
        if (c.serverToken) setServerToken(deobfuscate(c.serverToken));
        if (c.verifySsl !== undefined) setVerifySsl(c.verifySsl);
      }
      setIsInitializing(false);
    });
  }, []);

  const normalizeUrl = (url: string | null | undefined) => {
    if (!url) return null;
    return url.trim().replace(/\/$/, '');
  };

  const fetchIssueTypes = async (projectKey: string, baseUrl: string, tabId?: number, projectId?: string) => {
    if (!authToken) return;
    logDebug('TYPES-START', `Fetching issue types for ${projectKey} on ${baseUrl}`);
    try {
      let url = `${apiBase}/jira/issue-types?project_key=${projectKey}&base_url=${encodeURIComponent(baseUrl)}`;
      if (projectId) url += `&project_id=${projectId}`;
      
      const res = await apiRequest(url, { token: authToken, onDebug: logDebug });
      if (res.ok) {
        const types = await res.json() as IssueType[];
        logDebug('TYPES-OK', `Found ${types.length} issue types`);
        updateSession({ issueTypes: types }, tabId);
        
        if (!session.selectedIssueType) {
          const bugType = types.find((t: IssueType) => t.name.toLowerCase().includes('bug'));
          if (bugType) {
            updateSession({ selectedIssueType: bugType }, tabId);
          } else if (types.length > 0) {
            updateSession({ selectedIssueType: types[0] }, tabId);
          }
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('TYPES-ERROR', errMsg);
      const translated = translateError(err, 'jira-types');
      updateSession({ error: translated.description }, tabId);
    }
  };

  const fetchJiraMetadata = async (projectKey: string, baseUrl: string, issueTypeId?: string, tabId?: number, projectId?: string) => {
    if (!authToken) return;
    logDebug('META-START', `Fetching schema for ${projectKey} on ${baseUrl}`);
    try {
      let url = `${apiBase}/jira/metadata?project_key=${projectKey}&base_url=${encodeURIComponent(baseUrl)}`;
      if (issueTypeId) url += `&issue_type_id=${issueTypeId}`;
      if (projectId) url += `&project_id=${projectId}`;
      
      const res = await apiRequest(url, { token: authToken, onDebug: logDebug });
      if (res.ok) {
        const data = await res.json() as JiraMetadata;
        logDebug('META-OK', `Received ${data.fields?.length || 0} fields`);
        
        const updates: Partial<TabSession> = { jiraMetadata: data };
        if (session.visibleFields.length === 0 && data.fields) {
          const requiredFields = data.fields.filter((f: JiraField) => f.required).map((f: JiraField) => f.key);
          if (requiredFields.length > 0) updates.visibleFields = requiredFields;
        }
        updateSession(updates, tabId);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('META-ERROR', errMsg);
      const translated = translateError(err, 'jira-metadata');
      updateSession({ error: translated.description }, tabId);
    }
  };

  const fetchFieldSettings = async (projectKey: string, baseUrl: string, issueTypeId?: string, tabId?: number, projectId?: string) => {
    if (!authToken) return;
    logDebug('SETTINGS-FETCH', `Pulling project field settings for ${projectKey}...`);
    try {
      let url = `${apiBase}/jira/field-settings?project_key=${projectKey}&base_url=${encodeURIComponent(baseUrl)}`;
      if (issueTypeId) url += `&issue_type_id=${issueTypeId}`;
      if (projectId) url += `&project_id=${projectId}`;

      const res = await apiRequest(url, { token: authToken });
      if (res.ok) {
        const data = await res.json() as { visible_fields?: string[]; ai_mapping?: Record<string, string> };
        updateSession({ 
          visibleFields: data.visible_fields || [],
          aiMapping: data.ai_mapping || {}
        }, tabId);
      }
    } catch (err: unknown) {
      // Background fetch, ignore errors
    }
  };

  const checkJiraStatus = async (isInit: boolean = false, signal?: AbortSignal, tokenOverride?: string, urlOverride?: string, tabId?: number): Promise<boolean> => {
    if (!isInit) updateSession({ loading: true }, tabId);
    const targetUrl = urlOverride || session.instanceUrl;
    logDebug('JIRA-STATUS', `Verifying connection... ${targetUrl || '(global)'}`);
    
    try {
      let url = `${apiBase}/jira/status`;
      if (targetUrl) url += `?base_url=${encodeURIComponent(targetUrl)}`;
      
      const res = await apiRequest(url, { signal, token: tokenOverride || authToken, onDebug: logDebug });
      const data = await res.json() as { connected?: boolean; connections?: { auth_type?: 'cloud' | 'server'; base_url: string; verify_ssl?: boolean }[] };
      
      if (data.connected || (data.connections && data.connections.length > 0)) {
        logDebug('JIRA-OK', 'Jira connected successfully');
        setJiraConnected(true);
        
        // If we don't have a targetUrl, use the first active connection
        const activeConn = data.connections && data.connections[0];
        if (activeConn || data.connected) {
          // Special case: if data.connected is true but activeConn is null, it might be the status of the CURRENT requested targetUrl
          const conn = activeConn || { auth_type: 'cloud', base_url: targetUrl || '', verify_ssl: true };
          const platform = conn.auth_type || 'cloud';
          const normalizedBase = normalizeUrl(conn.base_url) || targetUrl;
          
          if (normalizedBase) {
            setJiraPlatform(platform);
            if (platform === 'cloud') setCloudUrl(normalizedBase);
            if (platform === 'server') setServerUrl(normalizedBase);
            setVerifySsl(conn.verify_ssl ?? true);
            
            // Persist the identified base URL for the form too
            saveJiraConfig({ 
              platform, 
              [platform === 'cloud' ? 'cloudUrl' : 'serverUrl']: normalizedBase,
              verifySsl: conn.verify_ssl ?? true
            });

            updateSession({ view: 'main', instanceUrl: normalizedBase }, tabId);
            return true;
          }
        }
        return true;
      } else {
        logDebug('JIRA-SETUP', 'Account valid but Jira not connected');
        if (targetUrl) updateSession({ view: 'setup' }, tabId);
        return false;
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('JIRA-ERR', `Status check failed: ${errMsg}`);
      return false;
    } finally {
      if (!isInit) updateSession({ loading: false }, tabId);
    }
  };

  return {
    jiraPlatform, setJiraPlatform,
    cloudUrl, setCloudUrl,
    cloudUsername, setCloudUsername,
    cloudToken, setCloudToken,
    serverUrl, setServerUrl,
    serverUsername, setServerUsername,
    serverToken, setServerToken,
    verifySsl, setVerifySsl,
    jiraConnected, setJiraConnected,
    isInitializing,
    saveJiraConfig,
    fetchIssueTypes,
    fetchJiraMetadata,
    fetchFieldSettings,
    checkJiraStatus,
    normalizeUrl
  };
}
