import { useState, useRef, useMemo, useCallback } from 'react';
import { TabSession, IssueType, JiraField, JiraMetadata } from '../types';
import { apiRequest } from '../services/api';
import { translateError } from '../utils/ErrorTranslator';

export function useJira(
  apiBase: string,
  authToken: string | null,
  logDebug: (tag: string, msg: string) => void,
  session: TabSession,
  updateSession: (updates: Partial<TabSession>, tabId?: number | null) => void
) {
  const [isInitializing, setIsInitializing] = useState(true);
  const activeFetches = useRef<Set<string>>(new Set());

  const isFetching = (key: string) => activeFetches.current.has(key);
  const startFetch = (key: string) => activeFetches.current.add(key);
  const clearFetch = (key: string) => activeFetches.current.delete(key);

  const fetchIssueTypes = async (connectionId: number, projectKey: string, tabId?: number | null, projectId?: string) => {
    if (!authToken) return;
    const fetchKey = `types-${projectKey}-${connectionId}`;
    if (isFetching(fetchKey)) return;
    
    startFetch(fetchKey);
    logDebug('TYPES-SCAN', `Triggering issue-type fetch for ${projectKey} on connection ${connectionId}`);
    try {
      const projId = projectId || projectKey;
      const finalUrl = `${apiBase}/jira/connections/${connectionId}/projects/${projId}/metadata`;
      
      const res = await apiRequest(finalUrl, { token: authToken, onDebug: logDebug });
      if (res.ok) {
        const types = await res.json() as IssueType[];
        
        if (types.length === 0) {
          updateSession({ issueTypes: [], issueTypesFetched: true, error: 'NO_ISSUE_TYPES_FOUND' }, tabId);
          return;
        }

        updateSession({ issueTypes: types, issueTypesFetched: true, error: null }, tabId);
        
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
    } finally {
      clearFetch(fetchKey);
    }
  };

  const fetchJiraMetadata = async (connectionId: number, projectKey: string, issueTypeId: string, tabId?: number | null, projectId?: string) => {
    if (!authToken) return;
    const fetchKey = `meta-${projectKey}-${connectionId}-${issueTypeId || 'none'}`;
    if (isFetching(fetchKey)) return;

    startFetch(fetchKey);
    const projId = projectId || projectKey;
    const finalUrl = `${apiBase}/jira/connections/${connectionId}/projects/${projId}/issue-types/${issueTypeId}/fields`;

    try {
      const res = await apiRequest(finalUrl, { token: authToken, onDebug: logDebug });
      if (res.ok) {
        const data = await res.json() as JiraMetadata;
        const updates: Partial<TabSession> = { jiraMetadata: data };
        if (session.visibleFields.length === 0 && data.fields) {
          const requiredFields = data.fields.filter((f: JiraField) => f.required).map((f: JiraField) => f.key);
          if (requiredFields.length > 0) updates.visibleFields = requiredFields;
        }
        updateSession(updates, tabId);
      }
    } catch (err: unknown) {
      const translated = translateError(err, 'jira-metadata');
      updateSession({ error: translated.description }, tabId);
    } finally {
      clearFetch(fetchKey);
    }
  };

  const fetchFieldSettings = async (connectionId: number, projectKey: string, tabId?: number | null, issueTypeId?: string, projectId?: string) => {
    if (!authToken) return;
    const fetchKey = `settings-${projectKey}-${connectionId}`;
    if (isFetching(fetchKey)) return;
    startFetch(fetchKey);

    const settingsProjectId = projectId || projectKey;
    const finalUrl = `${apiBase}/jira/connections/${connectionId}/projects/${settingsProjectId}/field-settings${issueTypeId ? `?issue_type_id=${issueTypeId}` : ''}`;
    
    try {
      const res = await apiRequest(finalUrl, { token: authToken });
      if (res.ok) {
        const data = await res.json() as { visible_fields?: string[]; ai_mapping?: Record<string, string> };
        const nextVisible = data.visible_fields || [];
        
        // If we don't have saved settings but we do have metadata, pre-fill with required fields
        if (nextVisible.length === 0 && session.jiraMetadata?.fields) {
          const required = session.jiraMetadata.fields.filter((f: JiraField) => f.required).map((f: JiraField) => f.key);
          if (required.length > 0) {
            updateSession({ visibleFields: required, aiMapping: data.ai_mapping || {} }, tabId);
            return;
          }
        }

        updateSession({ 
          visibleFields: nextVisible,
          aiMapping: data.ai_mapping || {}
        }, tabId);
      }
    } catch (err: unknown) {
      // Background fetch, ignore errors
    } finally {
      clearFetch(fetchKey);
    }
  };

  const checkJiraStatus = useCallback(async (isInit: boolean = false, signal?: AbortSignal, tokenOverride?: string, tabId?: number | null): Promise<boolean> => {
    if (!authToken && !tokenOverride) {
      setIsInitializing(false);
      return false;
    }

    const fetchKey = 'status-check';
    if (isFetching(fetchKey)) return false;

    startFetch(fetchKey);
    if (!isInit) updateSession({ loading: true }, tabId);
    
    try {
      const res = await apiRequest(`${apiBase}/jira/connections`, { signal, token: tokenOverride || authToken, onDebug: logDebug });
      if (res.ok) {
        const connections = await res.json();
        
        const updates: Partial<TabSession> = { connections };

        if (connections.length > 0 && !updates.jiraConnectionId) {
          updates.jiraConnectionId = connections[0].id;
        }

        updateSession(updates, tabId);
        return connections.length > 0;
      }
      return false;
    } catch (err: unknown) {
      logDebug('JIRA-ERR', `Status check failed: ${err}`);
      return false;
    } finally {
      setIsInitializing(false);
      if (!isInit) updateSession({ loading: false }, tabId);
      clearFetch(fetchKey);
    }
  }, [apiBase, authToken, logDebug, session.jiraConnectionId, updateSession]);

  const createConnection = async (config: any) => {
    if (!authToken) return;
    updateSession({ loading: true });
    try {
      const res = await apiRequest(`${apiBase}/jira/connections`, {
        method: 'POST',
        token: authToken,
        body: JSON.stringify(config)
      });
      if (res.ok) {
        await checkJiraStatus(false);
        updateSession({ view: 'main' });
      } else {
        const data = await res.json();
        updateSession({ error: data.detail || 'Failed to create connection' });
      }
    } catch (err) {
      updateSession({ error: 'Connection failed' });
    } finally {
      updateSession({ loading: false });
    }
  };

  const deleteConnection = async (id: number, tabId?: number | null) => {
    if (!authToken) return;
    updateSession({ loading: true }, tabId);
    try {
      await apiRequest(`${apiBase}/jira/connections/${id}`, {
        method: 'DELETE',
        token: authToken
      });
      await checkJiraStatus(false, undefined, undefined, tabId);
    } catch (err) {
      logDebug('CONN-DEL-ERR', String(err));
    } finally {
      updateSession({ loading: false }, tabId);
    }
  };

  const switchConnection = async (id: number) => {
    updateSession({ jiraConnectionId: id });
  };

  return useMemo(() => ({
    isInitializing,
    fetchIssueTypes,
    fetchJiraMetadata,
    fetchFieldSettings,
    checkJiraStatus,
    createConnection,
    deleteConnection,
    switchConnection
  }), [isInitializing, fetchIssueTypes, fetchJiraMetadata, fetchFieldSettings, checkJiraStatus, createConnection, deleteConnection, switchConnection]);
}
