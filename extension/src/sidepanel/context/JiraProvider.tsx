import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TabSession, JiraConnection, JiraProject, JiraBootstrapContext } from '../types';
import { apiRequest } from '../services/api';
import { translateError } from '../utils/ErrorTranslator';
import { dbService } from '../services/db';
import { JiraConnectionConfig, JiraContext } from './jira-context';

function normalizeJiraUrl(url: string | null | undefined): string {
  if (!url) return '';

  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    const issuePathMatch = normalizedPath.match(/^(.*?)(\/browse\/|\/issues\/|\/projects\/)/);
    const basePath = issuePathMatch ? issuePathMatch[1] : normalizedPath;
    return `${parsed.origin}${basePath}`.replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function inferPlatformFromUrl(url: string): 'cloud' | 'server' {
  return url.includes('.atlassian.net') ? 'cloud' : 'server';
}

function resolveConnectionForUrl(connections: JiraConnection[], targetUrl: string | null | undefined): JiraConnection | undefined {
  const normalizedTarget = normalizeJiraUrl(targetUrl);
  if (!normalizedTarget) return connections.find(c => c.is_active) || connections[0];

  const rankedMatches = connections
    .map((connection) => ({
      connection,
      normalizedBase: normalizeJiraUrl(connection.host_url)
    }))
    .filter(({ normalizedBase }) =>
      normalizedBase &&
      (normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}/`) || normalizedTarget.startsWith(normalizedBase))
    )
    .sort((a, b) => b.normalizedBase.length - a.normalizedBase.length);

  return rankedMatches[0]?.connection || connections.find(c => c.is_active) || connections[0];
}

function buildProjectIdentity(projectKey: string, projectId?: string): string {
  return projectId || projectKey;
}

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
  const [serverUrl, setServerUrl] = useState('');
  const [verifySsl, setVerifySslState] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);

  const activeFetches = useRef<Set<string>>(new Set());
  const statusCheckPromiseRef = useRef<Promise<boolean> | null>(null);
  const bootstrapPromiseRef = useRef<Map<string, Promise<JiraBootstrapContext | null>>>(new Map());
  const isFetching = (key: string) => activeFetches.current.has(key);
  const startFetch = (key: string) => activeFetches.current.add(key);
  const clearFetch = (key: string) => activeFetches.current.delete(key);

  const saveJiraConfig = useCallback((updates: Record<string, string | boolean | undefined>) => {
    chrome.storage.local.get(['bugmind_jira_config'], (res) => {
      const current = (res.bugmind_jira_config as Record<string, string | boolean | undefined>) || {};
      chrome.storage.local.set({ 'bugmind_jira_config': { ...current, ...updates } });
    });
  }, []);

  const applyBootstrapContext = useCallback((data: JiraBootstrapContext, tabId?: number | null, hasProjectContext: boolean = false) => {
    const normalizedBase = normalizeJiraUrl(data.instance_url);
    const platform = data.platform || inferPlatformFromUrl(normalizedBase);

    setJiraConnected(true);
    setJiraPlatform(platform);
    setVerifySslState(data.verify_ssl ?? true);

    if (platform === 'cloud') setCloudUrl(normalizedBase);
    if (platform === 'server') setServerUrl(normalizedBase);

    saveJiraConfig({
      platform,
      [platform === 'cloud' ? 'cloudUrl' : 'serverUrl']: normalizedBase,
      verifySsl: data.verify_ssl ?? true
    });

    updateSession({
      instanceUrl: normalizedBase,
      jiraConnectionId: data.connection_id,
      issueTypes: data.issue_types || [],
      issueTypesFetched: hasProjectContext,
      selectedIssueType: data.selected_issue_type || null,
      visibleFields: data.visible_fields || [],
      aiMapping: data.ai_mapping || {},
      jiraMetadata: data.jira_metadata || null,
      error: null
    }, tabId);
  }, [saveJiraConfig, updateSession]);

  const bootstrapContext = useCallback(async ({
    instanceUrl,
    projectKey,
    projectId,
    issueTypeId,
    tabId,
    force,
    tokenOverride
  }: {
    instanceUrl: string;
    projectKey?: string;
    projectId?: string;
    issueTypeId?: string;
    tabId?: number | null;
    force?: boolean;
    tokenOverride?: string;
  }): Promise<JiraBootstrapContext | null> => {
    const activeToken = tokenOverride || authToken;
    const normalizedUrl = normalizeJiraUrl(instanceUrl);
    if (!activeToken || !normalizedUrl) return null;

    const projectIdentity = projectKey ? buildProjectIdentity(projectKey, projectId) : '';
    const requestIssueTypeId = issueTypeId || undefined;
    const cacheKey = `bootstrap-${normalizedUrl}-${projectIdentity}-${requestIssueTypeId || 'default'}`;
    const fetchKey = `bootstrap-${normalizedUrl}-${projectIdentity}`;
    const metadataCacheKey = projectKey ? `metadata-${projectIdentity}-${requestIssueTypeId || 'default'}` : '';

    if (!force) {
      const inFlight = bootstrapPromiseRef.current.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }

      if (projectKey && metadataCacheKey) {
        const cached = await dbService.getMetadata<JiraBootstrapContext>(metadataCacheKey);
        if (cached) {
          applyBootstrapContext(cached, tabId, true);
          return cached;
        }
      }
    }

    logDebug('JIRA-BOOT', `Bootstrapping Jira context for ${normalizedUrl}${projectIdentity ? ` (${projectIdentity})` : ''}`);
    startFetch(fetchKey);

    const promise = (async () => {
      try {
        const res = await apiRequest(`${apiBase}/jira/bootstrap-context`, {
          method: 'POST',
          token: activeToken,
          onUnauthorized: tokenOverride ? undefined : refreshAuthToken,
          onDebug: logDebug,
          body: JSON.stringify({
            instance_url: normalizedUrl,
            project_key: projectKey,
            project_id: projectId,
            issue_type_id: requestIssueTypeId
          })
        });

        if (!res.ok) {
          throw new Error(await res.text() || `Failed to bootstrap Jira context (${res.status})`);
        }

        const data = await res.json() as JiraBootstrapContext;
        applyBootstrapContext(data, tabId, !!projectKey || !!projectId);

        if (projectKey && metadataCacheKey) {
          await dbService.saveMetadata(metadataCacheKey, data);
        }

        logDebug('JIRA-BOOT-OK', `Resolved connection ${data.connection_id}`);
        return data;
      } catch (err: unknown) {
        logDebug('JIRA-BOOT-ERR', String(err));
        updateSession({ error: translateError(err, 'jira-status').description }, tabId);
        return null;
      } finally {
        clearFetch(fetchKey);
        bootstrapPromiseRef.current.delete(cacheKey);
      }
    })();

    bootstrapPromiseRef.current.set(cacheKey, promise);
    return promise;
  }, [apiBase, applyBootstrapContext, authToken, logDebug, refreshAuthToken, updateSession]);

  useEffect(() => {
    chrome.storage.local.get(['bugmind_jira_config'], (res) => {
      if (res.bugmind_jira_config) {
        const c = res.bugmind_jira_config as Record<string, string | boolean | undefined>;
        if (c.platform === 'cloud' || c.platform === 'server') setJiraPlatform(c.platform);
        if (typeof c.cloudUrl === 'string') setCloudUrl(c.cloudUrl);
        if (typeof c.serverUrl === 'string') setServerUrl(c.serverUrl);
        if (typeof c.verifySsl === 'boolean') setVerifySslState(c.verifySsl);

        const {
          cloudUsername: _cloudUsername,
          cloudToken: _cloudToken,
          serverUsername: _serverUsername,
          serverToken: _serverToken,
          ...sanitizedConfig
        } = c;

        if (
          _cloudUsername !== undefined ||
          _cloudToken !== undefined ||
          _serverUsername !== undefined ||
          _serverToken !== undefined
        ) {
          chrome.storage.local.set({ bugmind_jira_config: sanitizedConfig });
        }
      }
    });
  }, []);

  const fetchIssueTypes = useCallback(async (_connectionId: number, projectKey: string, tabId?: number | null, projectId?: string, force?: boolean) => {
    const instanceUrl = session.instanceUrl;
    if (!instanceUrl) return;

    updateSession({ loading: true }, tabId);
    logDebug('TYPES-SCAN', `Triggering issue-type fetch for project: ${projectId || projectKey}`);
    try {
      const data = await bootstrapContext({ instanceUrl, projectKey, projectId, tabId, force });
      if (data) {
        logDebug('TYPES-OK', `Found ${data.issue_types.length} issue types.`);
      }
    } catch (err: unknown) {
      logDebug('TYPES-ERROR', String(err));
      updateSession({ error: translateError(err, 'jira-types').description, issueTypesFetched: true }, tabId);
    } finally {
      updateSession({ loading: false }, tabId);
    }
  }, [bootstrapContext, logDebug, session.instanceUrl, updateSession]);

  const fetchJiraMetadata = useCallback(async (_connectionId: number, projectKey: string, issueTypeId: string, tabId?: number | null, projectId?: string, force?: boolean) => {
    const instanceUrl = session.instanceUrl;
    if (!instanceUrl) return;

    updateSession({ loading: true }, tabId);
    try {
      const data = await bootstrapContext({ instanceUrl, projectKey, projectId, issueTypeId, tabId, force });
      if (data?.jira_metadata) {
        logDebug('META-OK', `Received ${data.jira_metadata.fields.length || 0} fields`);
      }
    } catch (err: unknown) {
      logDebug('META-ERROR', String(err));
      updateSession({ error: translateError(err, 'jira-metadata').description }, tabId);
    } finally {
      updateSession({ loading: false }, tabId);
    }
  }, [bootstrapContext, logDebug, session.instanceUrl, updateSession]);

  const fetchFieldSettings = useCallback(async (_connectionId: number, projectKey: string, tabId?: number | null, issueTypeId?: string, projectId?: string, force?: boolean) => {
    const instanceUrl = session.instanceUrl;
    if (!instanceUrl) return;

    try {
      await bootstrapContext({ instanceUrl, projectKey, projectId, issueTypeId, tabId, force });
    } catch {
      // Background fetch, ignore errors
    }
  }, [bootstrapContext, session.instanceUrl]);

  const checkJiraStatus = useCallback(async (isInit: boolean = false, signal?: AbortSignal, tokenOverride?: string, urlOverride?: string, tabId?: number | null): Promise<boolean> => {
    const fetchKey = 'status-check';
    if (isFetching(fetchKey)) {
      return statusCheckPromiseRef.current ?? false;
    }

    startFetch(fetchKey);
    if (!isInit) updateSession({ loading: true }, tabId);
    const targetUrl = normalizeJiraUrl(urlOverride || session.instanceUrl);

    logDebug('JIRA-STATUS', `Verifying connection... ${targetUrl || '(global)'}`);

    const statusPromise = (async () => {
      try {
        const res = await apiRequest(`${apiBase}/jira/connections`, { signal, token: tokenOverride || authToken, onUnauthorized: tokenOverride ? undefined : refreshAuthToken, onDebug: logDebug });
        if (res.ok) {
          const connections = await res.json() as JiraConnection[];
          updateSession({ connections });

          if (connections && connections.length > 0) {
            setJiraConnected(true);

            const conn = resolveConnectionForUrl(connections, targetUrl);
            const platform = conn ? ((conn.auth_type as 'cloud' | 'server') || inferPlatformFromUrl(targetUrl || conn.host_url)) : inferPlatformFromUrl(targetUrl);
            const normalizedBase = normalizeJiraUrl(conn?.host_url || targetUrl);

            if (normalizedBase) {
              setJiraPlatform(platform);
              setVerifySslState(conn?.verify_ssl ?? true);
              if (platform === 'cloud') setCloudUrl(normalizedBase);
              if (platform === 'server') setServerUrl(normalizedBase);

              saveJiraConfig({
                platform,
                [platform === 'cloud' ? 'cloudUrl' : 'serverUrl']: normalizedBase,
                verifySsl: conn?.verify_ssl ?? true
              });

              updateSession({
                instanceUrl: normalizedBase,
                jiraConnectionId: conn?.id ?? null
              }, tabId);

              if (conn) {
                logDebug('JIRA-OK', `Connected via connection ID: ${conn.id}`);
                return true;
              }
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
        statusCheckPromiseRef.current = null;
      }
    })();

    statusCheckPromiseRef.current = statusPromise;
    return await statusPromise;
  }, [apiBase, authToken, logDebug, refreshAuthToken, saveJiraConfig, session.instanceUrl, updateSession]);

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
  }, [apiBase, authToken, logDebug, refreshAuthToken, saveJiraConfig, updateSession]);

  useEffect(() => {
    if (!authToken) return;
    fetchConnections();
  }, [authToken, fetchConnections]);

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
  }, [apiBase, authToken, fetchConnections, logDebug, refreshAuthToken, saveJiraConfig, session.jiraConnectionId]);

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
  }, [apiBase, authToken, fetchConnections, logDebug, refreshAuthToken, updateSession]);

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

  const createConnection = useCallback(async (config: JiraConnectionConfig): Promise<boolean> => {
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
  }, [apiBase, authToken, fetchConnections, fetchProjects, logDebug, refreshAuthToken, saveJiraConfig, updateSession]);

  const value = useMemo(() => ({
    jiraPlatform,
    setJiraPlatform,
    jiraConnected,
    setJiraConnected,
    fetchIssueTypes,
    fetchJiraMetadata,
    fetchFieldSettings,
    bootstrapContext,
    checkJiraStatus,
    cloudUrl, setCloudUrl,
    serverUrl, setServerUrl,
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
    bootstrapContext, checkJiraStatus, cloudUrl, serverUrl, verifySsl, setVerifySsl, saveJiraConfig, createConnection, fetchConnections, deleteConnection, setActiveConnection, updateConnection, fetchProjects,
    isInitializing
  ]);

  return <JiraContext.Provider value={value}>{children}</JiraContext.Provider>;
};
