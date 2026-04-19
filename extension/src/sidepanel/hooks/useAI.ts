import { useState, useRef, useMemo } from 'react';
import { TabSession, BugReport, Usage, INITIAL_SESSION, CreatedIssue, JiraUser } from '../types';
import { apiRequest } from '../services/api';
import { translateError } from '../utils/ErrorTranslator';

export function useAI(
  apiBase: string,
  authToken: string | null,
  logDebug: (tag: string, msg: string) => void,
  session: TabSession,
  updateSession: (updates: Partial<TabSession>, tabId?: number) => void,
  currentTabId: number | null,
  setTabSessions: React.Dispatch<React.SetStateAction<Record<number, TabSession>>>
) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const searchControllerRef = useRef<AbortController | null>(null);
  const [customModel, setCustomModel] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [hasCustomKeySaved, setHasCustomKeySaved] = useState(false);

  const activeFetches = useRef<Set<string>>(new Set());
  const isFetching = (key: string) => activeFetches.current.has(key);
  const startFetch = (key: string) => activeFetches.current.add(key);
  const clearFetch = (key: string) => activeFetches.current.delete(key);

  const fetchUsage = async () => {
    if (!authToken) return;
    const fetchKey = 'usage-fetch';
    if (isFetching(fetchKey)) return;

    startFetch(fetchKey);
    try {
      const res = await apiRequest(`${apiBase}/ai/usage`, { token: authToken });
      if (res.ok) {
        const data = await res.json() as Usage;
        setUsage(data);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('USAGE-ERR', errMsg);
    } finally {
      clearFetch(fetchKey);
    }
  };

  const fetchAISettings = async () => {
    if (!authToken) return;
    const fetchKey = 'ai-settings-fetch';
    if (isFetching(fetchKey)) return;

    startFetch(fetchKey);
    updateSession({ loading: true });
    try {
      const res = await apiRequest(`${apiBase}/settings/ai`, { token: authToken });
      const data = await res.json() as { custom_model: string; has_custom_key: boolean };
      setCustomModel(data.custom_model || '');
      setHasCustomKeySaved(data.has_custom_key);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('AI-SETTINGS-ERR', errMsg);
      const translated = translateError(err, 'settings');
      updateSession({ error: translated.description });
    } finally { 
      updateSession({ loading: false }); 
      clearFetch(fetchKey);
    }
  };

  const handleUpdateBug = (index: number, updates: Partial<BugReport>) => {
    if (!currentTabId) return;
    setTabSessions(prev => {
      const currentSession = prev[currentTabId] || INITIAL_SESSION;
      const newBugs = [...(currentSession.bugs || [])];
      if (newBugs[index]) {
        const fieldKeys = Object.keys(updates).join(', ');
        logDebug('BUG-EDIT', `Updated bug #${index} [${fieldKeys}]`);
        newBugs[index] = { ...newBugs[index], ...updates };
      }
      return {
        ...prev,
        [currentTabId]: { ...currentSession, bugs: newBugs }
      };
    });
  };

  const generateBugs = async () => {
    if (!currentTabId || !session.issueData) return;
    if (!session.selectedIssueType?.id) {
      updateSession({ error: 'MISSING_ISSUE_TYPE' }, currentTabId);
      return;
    }
    
    updateSession({ loading: true, error: null, bugs: [] });
    logDebug('AI-START', `Analyzing ${session.issueData.key}`);

    try {
      const res = await apiRequest(`${apiBase}/ai/generate`, {
        method: 'POST',
        token: authToken,
        onDebug: logDebug,
        body: JSON.stringify({
          selected_text: `${session.issueData.summary}\n${session.issueData.description}\n${session.issueData.acceptanceCriteria}`,
          jira_connection_id: session.jiraConnectionId,
          project_key: session.issueData.key.split('-')[0],
          project_id: session.issueData.projectId,
          issue_type_id: session.selectedIssueType.id
        })
      });

      const data = await res.json() as { summary: string; description: string; fields?: Record<string, unknown> };
      if (!res.ok) {
        throw new Error((data as { detail?: string }).detail || "AI Analysis failed");
      }
      const bug: BugReport = {
        summary: data.summary,
        description: data.description,
        steps_to_reproduce: '',
        expected_result: '',
        actual_result: '',
        severity: 'Medium',
        extra_fields: (data.fields || {}) as BugReport['extra_fields']
      };
      updateSession({ bugs: [bug] }, currentTabId);
      logDebug('AI-OK', `Generated 1 report for tab ${currentTabId}`);
      fetchUsage();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('AI-ERR', errMsg);
      const translated = translateError(err, 'ai-analysis');
      updateSession({ error: translated.description }, currentTabId);
    } finally {
      updateSession({ loading: false }, currentTabId);
    }
  };

  const handleManualGenerate = async () => {
    if (!session.manualDesc.trim()) return;
    if (!session.selectedIssueType?.id) {
      updateSession({ error: 'MISSING_ISSUE_TYPE' });
      return;
    }
    updateSession({ loading: true, error: null });
    logDebug('MANUAL-START', 'Structuring manual description...');
    try {
      const selectedText = session.issueData
        ? `${session.issueData.summary}\n${session.issueData.description}\n${session.issueData.acceptanceCriteria}`
        : session.manualDesc;

      const res = await apiRequest(`${apiBase}/ai/generate`, {
        method: 'POST',
        token: authToken,
        onDebug: logDebug,
        body: JSON.stringify({
          selected_text: selectedText,
          jira_connection_id: session.jiraConnectionId,
          project_key: session.issueData?.key.split('-')[0] || 'MANUAL',
          project_id: session.issueData?.projectId,
          issue_type_id: session.selectedIssueType.id,
          user_description: session.manualDesc
        })
      });
      
      const data = await res.json() as { summary: string; description: string; fields?: Record<string, unknown>; detail?: string };
      if (!res.ok) throw new Error(data.detail || "Manual processing failed");
      
      const newBug: BugReport = {
        summary: data.summary,
        description: data.description,
        steps_to_reproduce: '',
        expected_result: '',
        actual_result: '',
        severity: 'Medium',
        extra_fields: (data.fields || {}) as BugReport['extra_fields']
      };
      logDebug('MANUAL-SUCCESS', `Structured: ${newBug.summary}`);
      const existingBugs = session.bugs || [];
      updateSession({ 
        bugs: [...existingBugs, newBug],
        manualDesc: '',
        showManualInput: false,
        expandedBug: existingBugs.length
      });

      fetchUsage();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('MANUAL-CRASH', errMsg);
      const translated = translateError(err, 'ai-manual');
      updateSession({ error: translated.description });
    } finally {
      updateSession({ loading: false });
    }
  };

  const submitBugs = async () => {
    const bugs = session.bugs || [];
    if (!session.issueData || !bugs.length || !session.jiraConnectionId) return;
    
    updateSession({ loading: true, error: null });
    try {
      const pKey = session.issueData.key.split('-')[0];
      
      const projId = session.issueData.projectId || pKey;
      const createdIssues: CreatedIssue[] = [];

      for (const bug of bugs) {
        const payload = {
          fields: {
            summary: bug.summary,
            description: bug.description,
            issuetype: { id: session.selectedIssueType?.id },
            ...bug.extra_fields
          }
        };

        const res = await apiRequest(`${apiBase}/jira/connections/${session.jiraConnectionId}/projects/${projId}/issues`, {
          method: 'POST',
          token: authToken,
          onDebug: logDebug,
          body: JSON.stringify(payload)
        });
        const data = await res.json() as { detail?: string; issue_key?: string };
        if (!res.ok) throw new Error(data.detail || "Submission failed");
        if (data.issue_key) {
          createdIssues.push({ id: data.issue_key, key: data.issue_key, self: '' });
        }
      }

      updateSession({ view: 'success', createdIssues });
      logDebug('SUBMIT-OK', `Batch of ${createdIssues.length} pushed to Jira`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logDebug('SUBMIT-ERR', errMsg);
      const translated = translateError(err, 'jira-submit');
      updateSession({ error: translated.description });
    } finally {
      updateSession({ loading: false });
    }
  };

  const searchUsers = async (query: string, projectId?: string, projectKey?: string, bugIndex?: number) => {
    if (query.length < 2) return;
    const connId = session.jiraConnectionId;
    if (!connId) return;

    if (bugIndex !== undefined) {
      handleUpdateBug(bugIndex, { 
        isSearchingUsers: true,
        lastSearchedQuery: query 
      });
    }

    if (searchControllerRef.current) {
      searchControllerRef.current.abort();
    }
    searchControllerRef.current = new AbortController();

    try {
      const url = `${apiBase}/jira/connections/${connId}/users/search?query=${encodeURIComponent(query)}&project_id=${projectId || ''}&project_key=${projectKey || ''}`;
      
      const res = await apiRequest(url, { 
        token: authToken,
        signal: searchControllerRef.current.signal
      });
      if (res.ok) {
        const users = await res.json() as JiraUser[];
        if (bugIndex !== undefined) {
          handleUpdateBug(bugIndex, { 
            userSearchResults: users,
            isSearchingUsers: false 
          });
          return;
        }
      }
    } catch (err: unknown) {
      // Ignore abort errors
    } finally {
      if (bugIndex !== undefined) {
        handleUpdateBug(bugIndex, { isSearchingUsers: false });
      }
    }
  };


  return useMemo(() => ({
    usage, fetchUsage,
    customModel, setCustomModel,
    customKey, setCustomKey,
    hasCustomKeySaved, setHasCustomKeySaved,
    fetchAISettings,
    handleUpdateBug,
    generateBugs,
    handleManualGenerate,
    submitBugs,
    searchUsers
  }), [
    usage, customModel, customKey, hasCustomKeySaved,
    session.issueData, session.bugs, session.instanceUrl, session.manualDesc, 
    currentTabId, updateSession, setTabSessions
  ]);
}
