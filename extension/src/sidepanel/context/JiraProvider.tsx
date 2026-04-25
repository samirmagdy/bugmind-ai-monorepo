import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TabSession, JiraConnection, JiraProject, JiraBootstrapContext, XrayDefaultsResponse } from '../types';
import { apiRequest, getErrorMessage, readJsonResponse, throwApiErrorResponse } from '../services/api';
import {
  JiraBootstrapResponsePayload,
  JiraBootstrapRequestPayload,
  JiraConnectionsResponsePayload,
  JiraConnectionCreateRequestPayload,
  JiraConnectionMutationResponsePayload,
  JiraProjectsResponsePayload,
  XrayDefaultsResponsePayload,
  JiraSettingsRequestPayload,
} from '../services/contracts';
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

async function ensureOptionalJiraPermissions(baseUrl: string, authType: 'cloud' | 'server'): Promise<boolean> {
  if (authType === 'cloud') return true;

  try {
    const origin = new URL(normalizeJiraUrl(baseUrl)).origin;
    const origins = [`${origin}/browse/*`, `${origin}/issues/*`, `${origin}/rest/api/*`];

    const contains = await chrome.permissions.contains({ origins });
    if (contains) return true;

    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
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
  const [verifySsl, setVerifySslState] = useState(true);
  const activeFetches = useRef<Set<string>>(new Set());
  const bootstrapPromiseRef = useRef<Map<string, Promise<JiraBootstrapContext | null>>>(new Map());
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

    setJiraPlatform(platform);
    setVerifySslState(data.verify_ssl ?? true);

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
      fieldDefaults: data.field_defaults || {},
      jiraMetadata: data.jira_metadata || null,
      error: null
    }, tabId);
  }, [saveJiraConfig, updateSession]);

  const bootstrapContext = useCallback(async ({
    instanceUrl,
    issueKey,
    projectKey,
    projectId,
    issueTypeId,
    tabId,
    force,
    tokenOverride
  }: {
    instanceUrl: string;
    issueKey?: string;
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

    const payload: JiraBootstrapRequestPayload = {
      instance_url: normalizedUrl,
      issue_key: issueKey,
      project_key: projectKey,
      project_id: projectId,
      issue_type_id: requestIssueTypeId
    };

    const performFetch = async (retryCount = 0): Promise<JiraBootstrapContext | null> => {
      try {
        const res = await apiRequest(`${apiBase}/jira/bootstrap-context`, {
          method: 'POST',
          token: activeToken,
          onUnauthorized: tokenOverride ? undefined : refreshAuthToken,
          onDebug: logDebug,
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          await throwApiErrorResponse(res, `Failed to bootstrap Jira context (${res.status})`);
        }

        const data = await readJsonResponse<JiraBootstrapResponsePayload>(res);
        applyBootstrapContext(data, tabId, !!projectKey || !!projectId);

        if (projectKey && metadataCacheKey) {
          await dbService.saveMetadata(metadataCacheKey, data);
        }

        logDebug('JIRA-BOOT-OK', `Resolved connection ${data.connection_id}`);
        return data;
      } catch (err: unknown) {
        const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status?: number }).status) : undefined;
        const shouldRetry = retryCount < 2 && (!status || status >= 500 || status === 429);
        if (shouldRetry) {
          logDebug('JIRA-BOOT-RETRY', `Retrying bootstrap (${retryCount + 1}/2) due to: ${String(err)}`);
          return performFetch(retryCount + 1);
        }
        logDebug('JIRA-BOOT-ERR', String(err));
        updateSession({ error: getErrorMessage(err) }, tabId);
        return null;
      } finally {
        clearFetch(fetchKey);
      }
    };

    const promise = performFetch();
    bootstrapPromiseRef.current.set(cacheKey, promise);
    return promise.finally(() => {
      const currentPromise = bootstrapPromiseRef.current.get(cacheKey);
      if (currentPromise === promise) {
        bootstrapPromiseRef.current.delete(cacheKey);
      }
    });
  }, [apiBase, applyBootstrapContext, authToken, logDebug, refreshAuthToken, updateSession]);

  useEffect(() => {
    chrome.storage.local.get(['bugmind_jira_config'], (res) => {
      if (res.bugmind_jira_config) {
        const c = res.bugmind_jira_config as Record<string, string | boolean | undefined>;
        if (c.platform === 'cloud' || c.platform === 'server') setJiraPlatform(c.platform);
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

  const fetchConnections = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await apiRequest(`${apiBase}/jira/connections`, { token: authToken, onUnauthorized: refreshAuthToken });
      if (res.ok) {
        const connections = await readJsonResponse<JiraConnectionsResponsePayload>(res);
        updateSession({ connections });
        const resolved = resolveConnectionForUrl(connections, session.instanceUrl);
        const fallback = connections.find(c => c.is_active) || connections[0];
        const selected = resolved || fallback;

        if (selected) {
          setVerifySslState(selected.verify_ssl ?? true);

          // Preserve the live tab context URL when we already know it; only
          // fall back to the connection host when no tab-specific URL exists yet.
          updateSession({
            jiraConnectionId: selected.id,
            instanceUrl: session.instanceUrl || selected.host_url
          });

          saveJiraConfig({
            verifySsl: selected.verify_ssl ?? true,
            platform: (selected.auth_type as 'cloud' | 'server') || inferPlatformFromUrl(selected.host_url),
            [((selected.auth_type as 'cloud' | 'server') || inferPlatformFromUrl(selected.host_url)) === 'cloud' ? 'cloudUrl' : 'serverUrl']: normalizeJiraUrl(selected.host_url)
          });
        }
      }
    } catch (err) {
      logDebug('CONN-FETCH-ERR', String(err));
    }
  }, [apiBase, authToken, logDebug, refreshAuthToken, saveJiraConfig, session.instanceUrl, updateSession]);

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
      const nextHost = typeof updates.host_url === 'string' ? updates.host_url : null;
      const nextAuthType = updates.auth_type === 'cloud' || updates.auth_type === 'server'
        ? updates.auth_type
        : null;
      if (nextHost && nextAuthType) {
        const granted = await ensureOptionalJiraPermissions(nextHost, nextAuthType);
        if (!granted) {
          logDebug('CONN-PERMS-ERR', `Optional Jira permissions denied for ${nextHost}`);
          updateSession({ error: 'Optional permission for this Jira host was denied.' });
          return false;
        }
      }

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
  }, [apiBase, authToken, fetchConnections, logDebug, refreshAuthToken, updateSession]);

  const fetchProjects = useCallback(async (id: number): Promise<JiraProject[]> => {
    if (!authToken) return [];
    try {
      const res = await apiRequest(`${apiBase}/jira/connections/${id}/projects`, {
        token: authToken,
        onUnauthorized: refreshAuthToken
      });
      if (!res.ok) {
        await throwApiErrorResponse(res, `Failed to fetch Jira projects (${res.status})`);
      }
      const data = await readJsonResponse<JiraProjectsResponsePayload>(res);
      return data.map(project => ({
        id: String(project.id ?? project.key ?? ''),
        key: project.key || String(project.id ?? ''),
        name: project.name || project.key || String(project.id ?? '')
      }));
    } catch (err) {
      logDebug('CONN-PROJECTS-ERR', String(err));
      updateSession({ error: getErrorMessage(err) });
      return [];
    }
  }, [apiBase, authToken, logDebug, refreshAuthToken, updateSession]);

  const fetchXrayDefaults = useCallback(async (id: number, storyIssueKey?: string): Promise<XrayDefaultsResponse | null> => {
    if (!authToken) return null;
    try {
      const query = storyIssueKey ? `?story_issue_key=${encodeURIComponent(storyIssueKey)}` : '';
      const res = await apiRequest(`${apiBase}/jira/connections/${id}/xray/defaults${query}`, {
        token: authToken,
        onUnauthorized: refreshAuthToken,
        onDebug: logDebug
      });
      if (!res.ok) {
        await throwApiErrorResponse(res, `Failed to fetch Xray defaults (${res.status})`);
      }
      return await readJsonResponse<XrayDefaultsResponsePayload>(res);
    } catch (err) {
      logDebug('XRAY-DEFAULTS-ERR', String(err));
      return null;
    }
  }, [apiBase, authToken, logDebug, refreshAuthToken]);

  const saveFieldSettings = useCallback(async ({
    jiraConnectionId,
    projectKey,
    projectId,
    issueTypeId,
    visibleFields,
    aiMapping,
    fieldDefaults
  }: {
    jiraConnectionId: number;
    projectKey: string;
    projectId?: string;
    issueTypeId: string;
    visibleFields?: string[];
    aiMapping?: Record<string, string>;
    fieldDefaults?: Record<string, unknown>;
  }) => {
    if (!authToken) return false;
    try {
      const nextVisibleFields = visibleFields ?? session.visibleFields;
      const nextAiMapping = aiMapping ?? session.aiMapping;
      const nextFieldDefaults = fieldDefaults ?? session.fieldDefaults;
      const payload: JiraSettingsRequestPayload = {
        jira_connection_id: jiraConnectionId,
        project_key: projectKey,
        project_id: projectId,
        issue_type_id: issueTypeId,
        visible_fields: nextVisibleFields,
        ai_mapping: nextAiMapping,
        field_defaults: nextFieldDefaults
      };
      const res = await apiRequest(`${apiBase}/settings/jira`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        onDebug: logDebug,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        await throwApiErrorResponse(res, `Failed to sync Jira field settings (${res.status})`);
      }
      updateSession({ visibleFields: nextVisibleFields, aiMapping: nextAiMapping, fieldDefaults: nextFieldDefaults });
      return true;
    } catch (err) {
      logDebug('FIELD-SETTINGS-ERR', String(err));
      return false;
    }
  }, [apiBase, authToken, logDebug, refreshAuthToken, session.aiMapping, session.fieldDefaults, session.visibleFields, updateSession]);

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
        await dbService.clearAllMetadata();
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
      const granted = await ensureOptionalJiraPermissions(config.base_url, config.auth_type);
      if (!granted) {
        logDebug('JIRA-PERMS-ERR', `Optional Jira permissions denied for ${config.base_url}`);
        updateSession({ error: 'Optional permission for this Jira host was denied.' });
        return false;
      }

      const payload: JiraConnectionCreateRequestPayload = {
        host_url: config.base_url.replace(/\/$/, ''),
        username: config.username,
        token: config.token,
        auth_type: config.auth_type,
        verify_ssl: config.verify_ssl
      };
      const res = await apiRequest(`${apiBase}/jira/connections`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const conn = await readJsonResponse<JiraConnectionMutationResponsePayload>(res);
        logDebug('JIRA-OK', `Connection created with ID: ${conn.id}`);
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
    saveFieldSettings,
    bootstrapContext,
    applyBootstrapContext,
    verifySsl, setVerifySsl,
    createConnection,
    fetchConnections,
    deleteConnection,
    setActiveConnection,
    updateConnection,
    fetchProjects,
    fetchXrayDefaults
  }), [
    jiraPlatform, saveFieldSettings, bootstrapContext, applyBootstrapContext, verifySsl, setVerifySsl, createConnection, fetchConnections, deleteConnection, setActiveConnection, updateConnection, fetchProjects, fetchXrayDefaults
  ]);

  return <JiraContext.Provider value={value}>{children}</JiraContext.Provider>;
};
