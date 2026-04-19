import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TabSession, IssueType, JiraMetadata, JiraField, JiraConnection, JiraProject } from '../types';
import { apiRequest } from '../services/api';
import { translateError } from '../utils/ErrorTranslator';
import { obfuscate, deobfuscate } from '../utils/StorageObfuscator';
import { dbService } from '../services/db';

interface JiraContextType {
  jiraPlatform: 'cloud' | 'server';
  setJiraPlatform: (p: 'cloud' | 'server') => void;
  jiraConnected: boolean;
  setJiraConnected: (val: boolean) => void;
  createConnection: (config: any) => Promise<boolean>;
  fetchConnections: () => Promise<void>;
  deleteConnection: (id: number, tabId?: number | null) => Promise<void>;
  setActiveConnection: (id: number, hostUrl: string) => Promise<void>;
  updateConnection: (id: number, updates: Record<string, unknown>) => Promise<boolean>;
  fetchProjects: (id: number) => Promise<JiraProject[]>;
  fetchIssueTypes: (connectionId: number, projectKey: string, tabId?: number | null, projectId?: string, force?: boolean) => Promise<void>;
  fetchJiraMetadata: (connectionId: number, projectKey: string, issueTypeId: string, tabId?: number | null, projectId?: string, force?: boolean) => Promise<void>;
  fetchFieldSettings: (connectionId: number, projectKey: string, tabId?: number | null, issueTypeId?: string, projectId?: string, force?: boolean) => Promise<void>;
  checkJiraStatus: (isInit?: boolean, signal?: AbortSignal, tokenOverride?: string, urlOverride?: string, tabId?: number | null) => Promise<boolean>;
  isInitializing: boolean;
  cloudUrl: string;
  setCloudUrl: (v: string) => void;
  cloudUsername: string;
  setCloudUsername: (v: string) => void;
  cloudToken: string;
  setCloudToken: (v: string) => void;
  serverUrl: string;
  setServerUrl: (v: string) => void;
  serverUsername: string;
  setServerUsername: (v: string) => void;
  serverToken: string;
  setServerToken: (v: string) => void;
  verifySsl: boolean;
  setVerifySsl: (v: boolean) => Promise<void>;
  saveJiraConfig: (updates: Record<string, string | boolean | undefined>) => void;
}

const JiraContext = createContext<JiraContextType | undefined>(undefined);

export const JiraProvider: React.FC<{ 
  children: React.ReactNode, 
  logDebug: (tag: string, msg: string) => void,
  apiBase: string,
  authToken: string | null,
  refreshAuthToken: () => Promise<string | null>,
  session: TabSession,
  updateSession: (updates: Partial<TabSession>, tabId?: number | null) => void
}> = ({ children, logDebug, apiBase, authToken, refreshAuthToken, session, updateSession }) => {
  const [jiraPlatform, setJiraPlatform] = useState<'cloud' | 'server'>('cloud');
  const [jiraConnected, setJiraConnected] = useState(false);
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudUsername, setCloudUsername] = useState('');
  const [cloudToken, setCloudToken] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [serverUsername, setServerUsername] = useState('');
  const [serverToken, setServerToken] = useState('');
  const [verifySsl, setVerifySslState] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);

  const activeFetches = useRef<Set<string>>(new Set());
  const isFetching = (key: string) => activeFetches.current.has(key);
  const startFetch = (key: string) => activeFetches.current.add(key);
  const clearFetch = (key: string) => activeFetches.current.delete(key);

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
        if (c.verifySsl !== undefined) setVerifySslState(c.verifySsl);
      }
    });
  }, []);

  const saveJiraConfig = useCallback((updates: Record<string, string | boolean | undefined>) => {
    chrome.storage.local.get(['bugmind_jira_config'], (res) => {
      const current = (res.bugmind_jira_config as Record<string, string | boolean | undefined>) || {};
      const secureUpdates = { ...updates };
      if (typeof secureUpdates.cloudToken === 'string') secureUpdates.cloudToken = obfuscate(secureUpdates.cloudToken);
      if (typeof secureUpdates.serverToken === 'string') secureUpdates.serverToken = obfuscate(secureUpdates.serverToken);
      if (typeof secureUpdates.cloudUsername === 'string') secureUpdates.cloudUsername = obfuscate(secureUpdates.cloudUsername);
      if (typeof secureUpdates.serverUsername === 'string') secureUpdates.serverUsername = obfuscate(secureUpdates.serverUsername);
      
      chrome.storage.local.set({ 'bugmind_jira_config': { ...current, ...secureUpdates } });
    });
  }, []);

  const fetchIssueTypes = useCallback(async (connectionId: number, projectKey: string, tabId?: number | null, projectId?: string, force?: boolean) => {
    if (!authToken) return;
    const cacheKey = `issue-types-${connectionId}-${projectId || projectKey}`;
    const fetchKey = `types-${projectKey}`;
    
    if (isFetching(fetchKey)) return;
    
    if (!force) {
      const cached = await dbService.getMetadata(cacheKey);
      if (cached) {
        updateSession({ issueTypes: cached, issueTypesFetched: true }, tabId);
        return;
      }
    }

    startFetch(fetchKey);
    updateSession({ loading: true }, tabId);
    logDebug('TYPES-SCAN', `Triggering issue-type fetch for project: ${projectId || projectKey} (Conn: ${connectionId})`);
    try {
      const projId = projectId || projectKey;
      const finalUrl = `${apiBase}/jira/connections/${connectionId}/projects/${projId}/metadata`;
      const res = await apiRequest(finalUrl, { token: authToken, onUnauthorized: refreshAuthToken, onDebug: logDebug });

      if (!res.ok) {
        throw new Error(await res.text() || `Failed to fetch issue types (${res.status})`);
      }

      const types = await res.json() as IssueType[];
      logDebug('TYPES-OK', `Found ${types.length} issue types.`);
      
      await dbService.saveMetadata(cacheKey, types);
      updateSession({ issueTypes: types, issueTypesFetched: true, error: null }, tabId);
      
      if (!session.selectedIssueType) {
        const bugType = types.find((t: any) => t.name.toLowerCase().includes('bug'));
        updateSession({ selectedIssueType: bugType || types[0] }, tabId);
      }
    } catch (err: unknown) {
      logDebug('TYPES-ERROR', String(err));
      updateSession({ error: translateError(err, 'jira-types').description, issueTypesFetched: true }, tabId);
    } finally {
      updateSession({ loading: false }, tabId);
      clearFetch(fetchKey);
    }
  }, [apiBase, authToken, logDebug, session.selectedIssueType, updateSession]);

  const fetchJiraMetadata = useCallback(async (connectionId: number, projectKey: string, issueTypeId: string, tabId?: number | null, projectId?: string, force?: boolean) => {
    if (!authToken) return;
    const cacheKey = `metadata-${connectionId}-${projectId || projectKey}-${issueTypeId}`;
    const fetchKey = `meta-${projectKey}-${issueTypeId}`;
    
    if (isFetching(fetchKey)) return;
    
    if (!force) {
      const cached = await dbService.getMetadata(cacheKey);
      if (cached?.fields?.length) {
        updateSession({ jiraMetadata: cached }, tabId);
        return;
      }
    }

    startFetch(fetchKey);
    updateSession({ loading: true }, tabId);
    const projId = projectId || projectKey;
    const finalUrl = `${apiBase}/jira/connections/${connectionId}/projects/${projId}/issue-types/${issueTypeId}/fields`;
    
    try {
      const res = await apiRequest(finalUrl, { token: authToken, onUnauthorized: refreshAuthToken, onDebug: logDebug });

      if (!res.ok) {
        throw new Error(await res.text() || `Failed to fetch field metadata (${res.status})`);
      }

      const fields = await res.json() as JiraField[];
      logDebug('META-OK', `Received ${fields.length || 0} fields`);
      logDebug('META-RAW', JSON.stringify(fields));
      
      const metadata: JiraMetadata = {
        project_key: projectKey,
        project_id: projId,
        issue_type_id: issueTypeId,
        fields: fields
      };

      if (fields.length > 0) {
        await dbService.saveMetadata(cacheKey, metadata);
      }
      const updates: Partial<TabSession> = { jiraMetadata: metadata };
      
      if (!session.visibleFields || session.visibleFields.length === 0) {
        const requiredFields = fields.filter((f: JiraField) => f.required).map((f: JiraField) => f.key);
        if (requiredFields.length > 0) updates.visibleFields = requiredFields;
      }
      updateSession(updates, tabId);
    } catch (err: unknown) {
      logDebug('META-ERROR', String(err));
      updateSession({ error: translateError(err, 'jira-metadata').description }, tabId);
    } finally {
      updateSession({ loading: false }, tabId);
      clearFetch(fetchKey);
    }
  }, [apiBase, authToken, logDebug, session.visibleFields?.length, updateSession]);

  const fetchFieldSettings = useCallback(async (connectionId: number, projectKey: string, tabId?: number | null, issueTypeId?: string, projectId?: string, force?: boolean) => {
    if (!authToken) return;
    const cacheKey = `settings-${connectionId}-${projectId || projectKey}-${issueTypeId || 'none'}`;
    const fetchKey = `settings-${projectKey}-${issueTypeId || 'none'}`;
    
    if (isFetching(fetchKey)) return;

    if (!force) {
      const cached = await dbService.getMetadata(cacheKey);
      if (cached) {
        updateSession({ 
          visibleFields: cached.visible_fields || [],
          aiMapping: cached.ai_mapping || {}
        }, tabId);
        return;
      }
    }

    startFetch(fetchKey);
    const projId = projectId || projectKey;
    const finalUrl = `${apiBase}/jira/connections/${connectionId}/projects/${projId}/field-settings${issueTypeId ? `?issue_type_id=${issueTypeId}` : ''}`;
    
    try {
      const res = await apiRequest(finalUrl, { token: authToken, onUnauthorized: refreshAuthToken });
      if (res.ok) {
        const data = await res.json() as { visible_fields?: string[]; ai_mapping?: Record<string, string> };
        await dbService.saveMetadata(cacheKey, data);
        updateSession({ 
          visibleFields: data.visible_fields || [],
          aiMapping: data.ai_mapping || {}
        }, tabId);
      }
    } catch (err: unknown) {
      // Background fetch, ignore errors
    } finally {
      clearFetch(fetchKey);
    }
  }, [apiBase, authToken, updateSession]);

  const checkJiraStatus = useCallback(async (isInit: boolean = false, signal?: AbortSignal, tokenOverride?: string, urlOverride?: string, tabId?: number | null): Promise<boolean> => {
    const fetchKey = 'status-check';
    if (isFetching(fetchKey)) return false;

    startFetch(fetchKey);
    if (!isInit) updateSession({ loading: true }, tabId);
    let targetUrl = urlOverride || session.instanceUrl;
    
    if (targetUrl) targetUrl = targetUrl.replace(/\/$/, '');
    
    logDebug('JIRA-STATUS', `Verifying connection... ${targetUrl || '(global)'}`);
    
    try {
      const res = await apiRequest(`${apiBase}/jira/connections`, { signal, token: tokenOverride || authToken, onUnauthorized: tokenOverride ? undefined : refreshAuthToken, onDebug: logDebug });
      if (res.ok) {
        const connections = await res.json() as JiraConnection[];
        updateSession({ connections });
        
        if (connections && connections.length > 0) {
          setJiraConnected(true);
          
          const activeConn = connections.find(c => c.is_active);
          const conn = targetUrl 
            ? (connections.find(c => c.host_url?.replace(/\/$/, '') === targetUrl) || activeConn || connections[0])
            : (activeConn || connections[0]);
            
          const platform = (conn.auth_type as 'cloud' | 'server') || 'cloud';
          const normalizedBase = conn.host_url?.replace(/\/$/, '');
          
          if (normalizedBase) {
            setJiraPlatform(platform);
            setVerifySslState(conn.verify_ssl ?? true);
            if (platform === 'cloud') setCloudUrl(normalizedBase);
            if (platform === 'server') setServerUrl(normalizedBase);
            
            saveJiraConfig({ 
              platform, 
              [platform === 'cloud' ? 'cloudUrl' : 'serverUrl']: normalizedBase,
              verifySsl: conn.verify_ssl ?? true
            });
            
            updateSession({ 
              instanceUrl: normalizedBase,
              jiraConnectionId: conn.id 
            }, tabId);
            
            logDebug('JIRA-OK', `Connected via connection ID: ${conn.id}`);
            return true;
          }
        }
      }
      return false;
    } catch (err: unknown) {
      logDebug('JIRA-ERR', String(err));
      return false;
    } finally {
      if (!isInit) updateSession({ loading: false }, tabId || undefined);
      if (isInit) setIsInitializing(false);
      clearFetch(fetchKey);
    }
  }, [apiBase, authToken, logDebug, saveJiraConfig, session.instanceUrl, updateSession]);

  const fetchConnections = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await apiRequest(`${apiBase}/jira/connections`, { token: authToken, onUnauthorized: refreshAuthToken });
      if (res.ok) {
        const connections = await res.json() as JiraConnection[];
        updateSession({ connections });
        const active = connections.find(c => c.is_active) || connections[0];
        if (active) {
          setVerifySslState(active.verify_ssl ?? true);
          updateSession({ jiraConnectionId: active.id, instanceUrl: active.host_url });
          saveJiraConfig({ verifySsl: active.verify_ssl ?? true });
        }
      }
    } catch (err) {
      logDebug('CONN-FETCH-ERR', String(err));
    }
  }, [apiBase, authToken, saveJiraConfig, updateSession, logDebug]);

  const setVerifySsl = useCallback(async (value: boolean) => {
    setVerifySslState(value);
    saveJiraConfig({ verifySsl: value });

    if (!authToken || !session.jiraConnectionId) return;

    try {
      const res = await apiRequest(`${apiBase}/jira/connections/${session.jiraConnectionId}`, {
        method: 'PATCH',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({ verify_ssl: value })
      });
      if (res.ok) {
        await fetchConnections();
      }
    } catch (err) {
      logDebug('CONN-SSL-ERR', String(err));
    }
  }, [apiBase, authToken, fetchConnections, logDebug, saveJiraConfig, session.jiraConnectionId]);

  const setActiveConnection = useCallback(async (id: number, hostUrl: string) => {
    if (!authToken) return;
    try {
      const res = await apiRequest(`${apiBase}/jira/connections/${id}`, {
        method: 'PATCH',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({ is_active: true })
      });
      if (res.ok) {
        updateSession({ jiraConnectionId: id, instanceUrl: hostUrl });
        await fetchConnections();
      }
    } catch (err) {
      logDebug('CONN-ACTIVE-ERR', String(err));
    }
  }, [apiBase, authToken, fetchConnections, logDebug, updateSession]);

  const updateConnection = useCallback(async (id: number, updates: Record<string, unknown>): Promise<boolean> => {
    if (!authToken) return false;
    try {
      const res = await apiRequest(`${apiBase}/jira/connections/${id}`, {
        method: 'PATCH',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        await fetchConnections();
        return true;
      }
      return false;
    } catch (err) {
      logDebug('CONN-UPDATE-ERR', String(err));
      return false;
    }
  }, [apiBase, authToken, fetchConnections, logDebug, refreshAuthToken]);

  const fetchProjects = useCallback(async (id: number): Promise<JiraProject[]> => {
    if (!authToken) return [];
    try {
      const res = await apiRequest(`${apiBase}/jira/connections/${id}/projects`, {
        token: authToken,
        onUnauthorized: refreshAuthToken
      });
      if (!res.ok) return [];
      const data = await res.json() as Array<{ id?: string | number; key?: string; name?: string }>;
      return data.map(project => ({
        id: String(project.id ?? project.key ?? ''),
        key: project.key || String(project.id ?? ''),
        name: project.name || project.key || String(project.id ?? '')
      }));
    } catch (err) {
      logDebug('CONN-PROJECTS-ERR', String(err));
      return [];
    }
  }, [apiBase, authToken, logDebug, refreshAuthToken]);

  const deleteConnection = useCallback(async (id: number) => {
    if (!authToken) return;
    try {
      const res = await apiRequest(`${apiBase}/jira/connections/${id}`, {
        method: 'DELETE',
        token: authToken
        , onUnauthorized: refreshAuthToken
      });
      if (res.ok) {
        if (session.jiraConnectionId === id) {
          updateSession({ jiraConnectionId: null });
        }
        await fetchConnections();
      }
    } catch (err) {
      logDebug('CONN-DELETE-ERR', String(err));
    }
  }, [apiBase, authToken, fetchConnections, logDebug, refreshAuthToken, session.jiraConnectionId, updateSession]);

  const createConnection = useCallback(async (config: any): Promise<boolean> => {
    updateSession({ loading: true });
    logDebug('JIRA-CONN', `Creating new connection to ${config.base_url}...`);
    try {
      const res = await apiRequest(`${apiBase}/jira/connections`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({
          host_url: config.base_url.replace(/\/$/, ''),
          username: config.username,
          token: config.token,
          auth_type: config.auth_type,
          verify_ssl: config.verify_ssl
        })
      });
      if (res.ok) {
        const conn = await res.json();
        logDebug('JIRA-OK', `Connection created with ID: ${conn.id}`);
        setJiraConnected(true);
        setVerifySslState(config.verify_ssl);
        saveJiraConfig({ verifySsl: config.verify_ssl });
        updateSession({ jiraConnectionId: conn.id, instanceUrl: config.base_url.replace(/\/$/, '') });
        await fetchProjects(conn.id);
        await fetchConnections();
        return true;
      }
      return false;
    } catch (err) {
      logDebug('JIRA-ERR', String(err));
      return false;
    } finally {
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, fetchConnections, fetchProjects, logDebug, refreshAuthToken, updateSession]);

  const value = useMemo(() => ({
    jiraPlatform,
    setJiraPlatform,
    jiraConnected,
    setJiraConnected,
    fetchIssueTypes,
    fetchJiraMetadata,
    fetchFieldSettings,
    checkJiraStatus,
    cloudUrl, setCloudUrl,
    cloudUsername, setCloudUsername,
    cloudToken, setCloudToken,
    serverUrl, setServerUrl,
    serverUsername, setServerUsername,
    serverToken, setServerToken,
    verifySsl, setVerifySsl,
    saveJiraConfig,
    createConnection,
    fetchConnections,
    deleteConnection,
    setActiveConnection,
    updateConnection,
    fetchProjects,
    isInitializing
  }), [
    jiraPlatform, jiraConnected, fetchIssueTypes, fetchJiraMetadata, fetchFieldSettings,
    checkJiraStatus, cloudUrl, cloudUsername, cloudToken, serverUrl, serverUsername,
    serverToken, verifySsl, saveJiraConfig, createConnection, fetchConnections, deleteConnection, setActiveConnection, updateConnection, fetchProjects,
    isInitializing
  ]);

  return <JiraContext.Provider value={value}>{children}</JiraContext.Provider>;
};

export const useJiraContext = () => {
  const context = useContext(JiraContext);
  if (!context) throw new Error('useJiraContext must be used within JiraProvider');
  return context;
};
