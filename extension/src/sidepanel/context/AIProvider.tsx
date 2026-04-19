import React, { createContext, useContext, useState, useRef, useMemo, useCallback } from 'react';
import { TabSession, BugReport, Usage, INITIAL_SESSION, TestCase, XrayPublishResult } from '../types';
import { apiRequest, readJsonResponse } from '../services/api';
import { translateError } from '../utils/ErrorTranslator';

interface AIContextType {
  usage: Usage | null;
  fetchUsage: () => Promise<void>;
  customModel: string;
  setCustomModel: (m: string) => void;
  customKey: string;
  setCustomKey: (k: string) => void;
  hasCustomKeySaved: boolean;
  setHasCustomKeySaved: (v: boolean) => void;
  fetchAISettings: () => Promise<void>;
  generateBugs: () => Promise<void>;
  generateTestCases: () => Promise<void>;
  handleManualGenerate: () => Promise<void>;
  submitBugs: (index?: number) => Promise<void>;
  searchUsers: (query: string, baseUrl: string, projectId?: string, projectKey?: string, bugIndex?: number) => Promise<void>;
  handleUpdateBug: (index: number, updates: Partial<BugReport>) => void;
  handleUpdateTestCase: (index: number, updates: Partial<TestCase>) => void;
  publishTestCasesToXray: () => Promise<void>;
  validateBug: (index: number) => Promise<boolean>;
  preparePreviewBug: (index: number) => void;
  fetchResolvedPayload: (index: number) => Promise<void>;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

export const AIProvider: React.FC<{
  children: React.ReactNode,
  logDebug: (tag: string, msg: string) => void,
  apiBase: string,
  authToken: string | null,
  refreshAuthToken: () => Promise<string | null>,
  session: TabSession,
  updateSession: (updates: Partial<TabSession>, tabId?: number) => void,
  currentTabId: number | null,
  setTabSessions: React.Dispatch<React.SetStateAction<Record<number, TabSession>>>
}> = ({ children, logDebug, apiBase, authToken, refreshAuthToken, session, updateSession, currentTabId, setTabSessions }) => {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [customModel, setCustomModel] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [hasCustomKeySaved, setHasCustomKeySaved] = useState(false);
  const searchControllerRef = useRef<AbortController | null>(null);

  const activeFetches = useRef<Set<string>>(new Set());
  const isFetching = (key: string) => activeFetches.current.has(key);
  const startFetch = (key: string) => activeFetches.current.add(key);
  const clearFetch = (key: string) => activeFetches.current.delete(key);

  const fetchUsage = useCallback(async () => {
    if (!authToken) return;
    const fetchKey = 'usage-fetch';
    if (isFetching(fetchKey)) return;
    startFetch(fetchKey);
    try {
      const res = await apiRequest(`${apiBase}/ai/usage`, { token: authToken, onUnauthorized: refreshAuthToken });
      if (!res.ok) {
        throw new Error(await res.text() || `Request failed with status ${res.status}`);
      }
      const data = await readJsonResponse<Usage>(res);
      setUsage(data);
    } catch (err) {
      logDebug('USAGE-ERR', String(err));
    } finally {
      clearFetch(fetchKey);
    }
  }, [apiBase, authToken, logDebug]);

  const fetchAISettings = useCallback(async () => {
    if (!authToken) return;
    const fetchKey = 'ai-settings-fetch';
    if (isFetching(fetchKey)) return;
    startFetch(fetchKey);
    updateSession({ loading: true });
    try {
      const res = await apiRequest(`${apiBase}/settings/ai`, { token: authToken, onUnauthorized: refreshAuthToken });
      if (!res.ok) {
        throw new Error(await res.text() || `Request failed with status ${res.status}`);
      }

      const data = await readJsonResponse<{ custom_model?: string; has_custom_key?: boolean }>(res);
      setCustomModel(data.custom_model || '');
      setHasCustomKeySaved(Boolean(data.has_custom_key));
    } catch (err) {
      logDebug('AI-SETTINGS-ERR', String(err));
      updateSession({ error: translateError(err, 'settings').description });
    } finally {
      updateSession({ loading: false });
      clearFetch(fetchKey);
    }
  }, [apiBase, authToken, logDebug, updateSession]);

  const handleUpdateBug = useCallback((index: number, updates: Partial<BugReport>) => {
    if (!currentTabId) return;
    setTabSessions(prev => {
      const curr = prev[currentTabId] || INITIAL_SESSION;
      const newBugs = [...(curr.bugs || [])];
      if (newBugs[index]) {
        newBugs[index] = { ...newBugs[index], ...updates };
      }
      return { ...prev, [currentTabId]: { ...curr, bugs: newBugs } };
    });
  }, [currentTabId, setTabSessions]);

  const handleUpdateTestCase = useCallback((index: number, updates: Partial<TestCase>) => {
    if (!currentTabId) return;
    setTabSessions(prev => {
      const curr = prev[currentTabId] || INITIAL_SESSION;
      const newCases = [...(curr.testCases || [])];
      if (newCases[index]) {
        newCases[index] = { ...newCases[index], ...updates };
      }
      return { ...prev, [currentTabId]: { ...curr, testCases: newCases } };
    });
  }, [currentTabId, setTabSessions]);

  // Phase 5: Streaming Implementation
  const generateBugs = useCallback(async () => {
    if (!currentTabId || !session.issueData || !session.jiraConnectionId) {
      logDebug('AI-ABORT', 'Missing session data or Jira connection ID');
      return;
    }
    if (!session.selectedIssueType?.id) {
      updateSession({ error: 'MISSING_ISSUE_TYPE' }, currentTabId);
      logDebug('AI-ABORT', 'Missing Jira issue type selection');
      return;
    }
    updateSession({ loading: true, error: null, bugs: [], testCases: [], coverageScore: null });
    logDebug('AI-START', `Analyzing ${session.issueData.key}...`);

    try {
      const res = await apiRequest(`${apiBase}/ai/generate`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({
          selected_text: `${session.issueData.summary}\n${session.issueData.description}\n${session.issueData.acceptanceCriteria}`,
          jira_connection_id: session.jiraConnectionId,
          project_key: session.issueData.key.split('-')[0],
          project_id: session.issueData.projectId,
          issue_type_id: session.selectedIssueType.id
        })
      });

      if (!res.ok) {
        throw new Error(await res.text() || `Failed to generate analytical report (${res.status})`);
      }

      const data = await res.json();
      const bug: BugReport = {
        summary: data.summary,
        description: data.description,
        steps_to_reproduce: data.steps_to_reproduce || "", 
        expected_result: data.expected_result || "",
        actual_result: data.actual_result || "",
        severity: "Medium",
        extra_fields: data.fields || {}
      };

      updateSession({ bugs: [bug], testCases: [], coverageScore: null }, currentTabId);
      logDebug('AI-OK', `Analysis complete for ${session.issueData.key}.`);

    } catch (err: unknown) {
      logDebug('AI-ERR', String(err));
      updateSession({ error: translateError(err, 'ai-analysis').description }, currentTabId);
    } finally {
      updateSession({ loading: false }, currentTabId);
    }
  }, [apiBase, authToken, currentTabId, logDebug, refreshAuthToken, session.issueData, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const generateTestCases = useCallback(async () => {
    if (!currentTabId || !session.issueData || !session.jiraConnectionId) return;
    if (!session.selectedIssueType?.id) {
      updateSession({ error: 'MISSING_ISSUE_TYPE' }, currentTabId);
      return;
    }
    updateSession({ loading: true, error: null, bugs: [], testCases: [] }, currentTabId);
    try {
      const res = await apiRequest(`${apiBase}/ai/test-cases`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({
          selected_text: `${session.issueData.summary}\n${session.issueData.description}\n${session.issueData.acceptanceCriteria}`,
          jira_connection_id: session.jiraConnectionId,
          project_key: session.issueData.key.split('-')[0],
          project_id: session.issueData.projectId,
          issue_type_id: session.selectedIssueType.id
        })
      });
      if (!res.ok) {
        throw new Error(await res.text() || `Failed to generate test cases (${res.status})`);
      }
      const data = await readJsonResponse<{ test_cases: TestCase[]; coverage_score: number }>(res);
      updateSession({
        bugs: [],
        testCases: data.test_cases || [],
        coverageScore: data.coverage_score ?? null,
        xrayFolderPath: session.issueData.key,
        xrayWarnings: [],
        createdIssues: []
      }, currentTabId);
      fetchUsage();
    } catch (err) {
      updateSession({ error: translateError(err, 'ai-analysis').description }, currentTabId);
    } finally {
      updateSession({ loading: false }, currentTabId);
    }
  }, [apiBase, authToken, currentTabId, fetchUsage, refreshAuthToken, session.issueData, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const publishTestCasesToXray = useCallback(async () => {
    if (!currentTabId || !session.issueData || !session.jiraConnectionId || !session.testCases.length) return;
    if (!session.xrayTargetProjectId) {
      updateSession({ error: 'Please choose an Xray target project before publishing.' }, currentTabId);
      return;
    }

    updateSession({ loading: true, error: null, success: null }, currentTabId);

    try {
      const metadataRes = await apiRequest(
        `${apiBase}/jira/connections/${session.jiraConnectionId}/projects/${session.xrayTargetProjectId}/metadata`,
        {
          token: authToken,
          onUnauthorized: refreshAuthToken
        }
      );
      if (!metadataRes.ok) {
        throw new Error(await metadataRes.text() || `Failed to inspect Xray project issue types (${metadataRes.status})`);
      }

      const projectIssueTypes = await readJsonResponse<Array<{ id: string; name: string }>>(metadataRes);
      const desiredIssueType = (session.xrayTestIssueTypeName || 'Test').trim().toLowerCase();
      const hasTestIssueType = projectIssueTypes.some(issueType => {
        const name = String(issueType.name || '').trim().toLowerCase();
        return name === desiredIssueType || name.includes(desiredIssueType) || name.includes('test');
      });
      if (!hasTestIssueType) {
        throw new Error(`XRAY_TEST_ISSUE_TYPE_MISSING:${session.xrayTargetProjectKey || session.xrayTargetProjectId}`);
      }

      const res = await apiRequest(`${apiBase}/jira/connections/${session.jiraConnectionId}/xray/test-suite`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({
          jira_connection_id: session.jiraConnectionId,
          story_issue_key: session.issueData.key,
          xray_project_id: session.xrayTargetProjectId,
          xray_project_key: session.xrayTargetProjectKey,
          test_cases: session.testCases,
          test_issue_type_name: session.xrayTestIssueTypeName || 'Test',
          repository_path_field_id: session.xrayRepositoryPathFieldId || undefined,
          folder_path: session.xrayFolderPath || session.issueData.key,
          link_type: session.xrayLinkType || 'Tests'
        })
      });

      if (!res.ok) {
        throw new Error(await res.text() || `Failed to publish test cases to Xray (${res.status})`);
      }

      const data = await readJsonResponse<XrayPublishResult>(res);
      updateSession({
        createdIssues: data.created_tests || [],
        xrayWarnings: data.warnings || [],
        success: `Published ${(data.created_tests || []).length} test cases to Xray folder ${data.folder_path}.`
      }, currentTabId);
    } catch (err) {
      updateSession({ error: translateError(err, 'jira-submit').description }, currentTabId);
    } finally {
      updateSession({ loading: false }, currentTabId);
    }
  }, [apiBase, authToken, currentTabId, refreshAuthToken, session.issueData, session.jiraConnectionId, session.testCases, session.xrayFolderPath, session.xrayLinkType, session.xrayRepositoryPathFieldId, session.xrayTargetProjectId, session.xrayTargetProjectKey, session.xrayTestIssueTypeName, updateSession]);

  const handleManualGenerate = useCallback(async () => {
    if (!session.manualDesc.trim() || !session.jiraConnectionId) return;
    if (!session.selectedIssueType?.id) {
      updateSession({ error: 'MISSING_ISSUE_TYPE' });
      logDebug('MANUAL-ABORT', 'Missing Jira issue type selection');
      return;
    }
    updateSession({ loading: true, error: null, testCases: [], coverageScore: null });
    logDebug('MANUAL-START', 'Structuring manual description...');
    try {
      const selectedText = session.issueData
        ? `${session.issueData.summary}\n${session.issueData.description}\n${session.issueData.acceptanceCriteria}`
        : session.manualDesc;

      const res = await apiRequest(`${apiBase}/ai/generate`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({
          selected_text: selectedText,
          jira_connection_id: session.jiraConnectionId,
          project_key: session.issueData?.key.split('-')[0] || 'MANUAL',
          project_id: session.issueData?.projectId,
          issue_type_id: session.selectedIssueType.id,
          user_description: session.manualDesc
        })
      });

      if (!res.ok) {
        throw new Error(await res.text() || `Manual processing failed (${res.status})`);
      }

      const data = await res.json() as { 
        summary: string; 
        description: string; 
        steps_to_reproduce: string;
        expected_result: string;
        actual_result: string;
        fields?: Record<string, unknown> 
      };
      const newBug: BugReport = {
        summary: data.summary,
        description: data.description,
        steps_to_reproduce: data.steps_to_reproduce || '',
        expected_result: data.expected_result || '',
        actual_result: data.actual_result || '',
        severity: 'Medium',
        extra_fields: (data.fields || {}) as BugReport['extra_fields']
      };
      const existing = session.bugs || [];
      updateSession({ bugs: [...existing, newBug], testCases: [], coverageScore: null, manualDesc: '', showManualInput: false, expandedBug: existing.length });
      fetchUsage();
    } catch (err: unknown) {
      updateSession({ error: translateError(err, 'ai-manual').description });
    } finally {
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, fetchUsage, logDebug, refreshAuthToken, session.bugs, session.issueData, session.manualDesc, updateSession]);

  const validateBug = useCallback(async (index: number): Promise<boolean> => {
    const bug = session.bugs[index];
    if (!bug || !session.jiraConnectionId || !session.issueData) return false;

    updateSession({ loading: true, error: null, validationErrors: [] });
    try {
      const projectKey = session.issueData.key.split('-')[0];
      const projId = session.issueData.projectId || projectKey;
      
      const payload = {
        fields: {
          summary: bug.summary,
          description: bug.description,
          issuetype: { id: session.selectedIssueType?.id },
          ...bug.extra_fields
        }
      };

      const res = await apiRequest(`${apiBase}/jira/connections/${session.jiraConnectionId}/projects/${projId}/validate-issue`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error("Validation failed");
      
      const data = await res.json() as { valid: boolean; missing_fields: { key: string; name: string }[] };
      if (!data.valid) {
        updateSession({ 
          validationErrors: data.missing_fields.map(f => `Field "${f.name}" is required.`) 
        });
        return false;
      }
      updateSession({ validationErrors: [] });
      return true;
    } catch (err) {
      updateSession({ error: "Could not validate bug with Jira." });
      return false;
    } finally {
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, refreshAuthToken, session.bugs, session.issueData, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const fetchResolvedPayload = useCallback(async (index: number) => {
    const bug = session.bugs[index];
    if (!bug || !session.jiraConnectionId || !session.issueData) return;

    try {
      const projectKey = session.issueData.key.split('-')[0];
      const projId = session.issueData.projectId || projectKey;

      const res = await apiRequest(`${apiBase}/jira/connections/${session.jiraConnectionId}/projects/${projId}/resolve-issue`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({
          fields: {
            summary: bug.summary,
            description: bug.description,
            steps_to_reproduce: bug.steps_to_reproduce,
            expected_result: bug.expected_result,
            actual_result: bug.actual_result,
            issuetype: { id: session.selectedIssueType?.id },
            ...bug.extra_fields
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        updateSession({ resolvedPayload: data });
      }
    } catch (err) {
      console.error('Failed to resolve bug payload', err);
    }
  }, [apiBase, authToken, refreshAuthToken, session.bugs, session.issueData, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const preparePreviewBug = useCallback((index: number) => {
    updateSession({ view: 'preview', previewBugIndex: index, validationErrors: [], resolvedPayload: null });
    // Auto-trigger validation and payload resolution
    validateBug(index);
    fetchResolvedPayload(index);
  }, [updateSession, validateBug, fetchResolvedPayload]);

  const submitBugs = useCallback(async (index?: number) => {
    let bugs = session.bugs || [];
    if (index !== undefined) {
      bugs = [bugs[index]];
    }
    
    if (!session.issueData || !bugs.length || !session.jiraConnectionId) return;
    updateSession({ loading: true, error: null });
    
    try {
      const connId = session.jiraConnectionId;
      const projectKey = session.issueData.key.split('-')[0];
      const projId = session.issueData.projectId || projectKey;
      
      const results = [];
      for (const bug of bugs) {
        const payload = {
          fields: {
            summary: bug.summary,
            description: bug.description,
            issuetype: { id: session.selectedIssueType?.id },
            ...bug.extra_fields
          }
        };
        
        const res = await apiRequest(`${apiBase}/jira/connections/${connId}/projects/${projId}/issues`, {
          method: 'POST',
          token: authToken,
          onUnauthorized: refreshAuthToken,
          body: JSON.stringify(payload)
        });
        
        if (res.ok) {
          results.push(await res.json());
        }
      }
      
      updateSession({ view: 'success', createdIssues: results.map(r => ({ id: r.issue_key, key: r.issue_key, self: "" })) });
    } catch (err: unknown) {
      updateSession({ error: translateError(err, 'jira-submit').description });
    } finally {
      updateSession({ loading: false });
    }
  }, [authToken, apiBase, refreshAuthToken, session.bugs, session.issueData, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const searchUsers = useCallback(async (query: string, _baseUrl: string, _projectId?: string, _projectKey?: string, bugIndex?: number) => {
    if (query.length < 2 || !session.jiraConnectionId) return;
    if (bugIndex !== undefined) handleUpdateBug(bugIndex, { isSearchingUsers: true, lastSearchedQuery: query });
    if (searchControllerRef.current) searchControllerRef.current.abort();
    searchControllerRef.current = new AbortController();

    try {
      const connId = session.jiraConnectionId;
      const url = `${apiBase}/jira/connections/${connId}/users/search?query=${encodeURIComponent(query)}`;
      const res = await apiRequest(url, { token: authToken, onUnauthorized: refreshAuthToken, signal: searchControllerRef.current.signal });
      if (res.ok && bugIndex !== undefined) {
        handleUpdateBug(bugIndex, { userSearchResults: await res.json(), isSearchingUsers: false });
      }
    } catch (err) {
      if (bugIndex !== undefined) handleUpdateBug(bugIndex, { isSearchingUsers: false });
    }
  }, [apiBase, authToken, refreshAuthToken, handleUpdateBug, session.jiraConnectionId]);

  const value = useMemo(() => ({
    usage, fetchUsage,
    customModel, setCustomModel,
    customKey, setCustomKey,
    hasCustomKeySaved, setHasCustomKeySaved,
    fetchAISettings,
    generateBugs,
    generateTestCases,
    handleManualGenerate,
    submitBugs,
    searchUsers,
    handleUpdateBug,
    handleUpdateTestCase,
    publishTestCasesToXray,
    validateBug,
    preparePreviewBug,
    fetchResolvedPayload
  }), [usage, fetchUsage, customModel, customKey, hasCustomKeySaved, fetchAISettings, generateBugs, generateTestCases, handleManualGenerate, submitBugs, searchUsers, handleUpdateBug, handleUpdateTestCase, publishTestCasesToXray, validateBug, preparePreviewBug, fetchResolvedPayload]);

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
};

export const useAIContext = () => {
  const context = useContext(AIContext);
  if (!context) throw new Error('useAIContext must be used within AIProvider');
  return context;
};
