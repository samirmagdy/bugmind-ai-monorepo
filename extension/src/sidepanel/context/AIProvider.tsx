import React, { useState, useRef, useMemo, useCallback } from 'react';
import { TabSession, BugReport, Usage, INITIAL_SESSION, TestCase, MissingField, IssueContextPayload } from '../types';
import { apiRequest, readJsonResponse } from '../services/api';
import {
  AIGenerationRequestPayload,
  AIGenerationResponsePayload,
  AIPreviewRequestPayload,
  AIPreviewResponsePayload,
  AISubmitRequestPayload,
  AISubmitResponsePayload,
  AISettingsResponsePayload,
  AITestCasesResponsePayload,
  JiraUserSearchRequestPayload,
  JiraUsersSearchResponsePayload,
  UsageResponsePayload,
  XrayPublishRequestPayload,
  XrayPublishResponsePayload,
  buildIssueContextPayload,
  buildProjectRequestParams,
} from '../services/contracts';
import { translateError } from '../utils/ErrorTranslator';
import { AIContext } from './ai-context';

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
  const parseJiraRequiredFieldErrors = useCallback((err: unknown) => {
    const rawMessage = err instanceof Error ? err.message : String(err || '');
    const parseFieldMap = (value: unknown): Array<{ key: string; name: string }> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      return Object.entries(value as Record<string, unknown>)
        .filter(([, message]) => typeof message === 'string' && /required/i.test(message))
        .map(([key]) => {
          const field = session.jiraMetadata?.fields.find((item) => item.key === key);
          return {
            key,
            name: field?.name || key
          };
        });
    };

    try {
      const topLevel = JSON.parse(rawMessage) as { detail?: unknown };
      if (topLevel?.detail && typeof topLevel.detail === 'string') {
        const nestedMatch = topLevel.detail.match(/Failed to create issue:\s*(\{.*\})$/);
        if (nestedMatch) {
          const nested = JSON.parse(nestedMatch[1]) as { errors?: unknown };
          const parsed = parseFieldMap(nested.errors);
          if (parsed.length > 0) return parsed;
        }
      }
    } catch {
      // Fall through to regex-free path below.
    }

    const fallbackMatch = rawMessage.match(/Failed to create issue:\s*(\{.*\})$/);
    if (!fallbackMatch) return [];

    try {
      const nested = JSON.parse(fallbackMatch[1]) as { errors?: unknown };
      return parseFieldMap(nested.errors);
    } catch {
      return [];
    }
  }, [session.jiraMetadata?.fields]);

  const isSystemManagedMissingField = useCallback((field: MissingField) => {
    const normalizedKey = field.key.trim().toLowerCase().replace(/[_-]/g, '');
    const normalizedName = field.name.trim().toLowerCase();

    return (
      normalizedName === 'project' ||
      normalizedName === 'issue type' ||
      ['project', 'projectid', 'pid', 'issuetype', 'issuetypeid', 'typeid'].includes(normalizedKey)
    );
  }, []);

  const [usage, setUsage] = useState<Usage | null>(null);
  const [customModel, setCustomModel] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [hasCustomKeySaved, setHasCustomKeySaved] = useState(false);
  const searchControllerRef = useRef<AbortController | null>(null);

  const activeFetches = useRef<Set<string>>(new Set());
  const isFetching = (key: string) => activeFetches.current.has(key);
  const startFetch = (key: string) => activeFetches.current.add(key);
  const clearFetch = (key: string) => activeFetches.current.delete(key);

  const sanitizeExtraFields = useCallback((fields: BugReport['extra_fields']) => {
    if (!fields) return {};

    const sanitized = { ...fields } as NonNullable<BugReport['extra_fields']>;
    delete sanitized.summary;
    delete sanitized.description;
    delete sanitized.issuetype;
    delete sanitized.project;
    return sanitized;
  }, []);

  const buildIssueContext = useCallback((): IssueContextPayload => buildIssueContextPayload(session.issueData), [session.issueData]);
  const getProjectRequestParams = useCallback(() => {
    const { project_key, project_id } = buildProjectRequestParams(session.issueData);
    return {
      projectKey: project_key,
      projectId: project_id
    };
  }, [session.issueData]);

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
      const data = await readJsonResponse<UsageResponsePayload>(res);
      setUsage(data);
    } catch (err) {
      logDebug('USAGE-ERR', String(err));
    } finally {
      clearFetch(fetchKey);
    }
  }, [apiBase, authToken, logDebug, refreshAuthToken]);

  const fetchAISettings = useCallback(async () => {
    if (!authToken) return;
    const fetchKey = 'ai-settings-fetch';
    if (isFetching(fetchKey)) return;
    startFetch(fetchKey);
    try {
      const res = await apiRequest(`${apiBase}/settings/ai`, { token: authToken, onUnauthorized: refreshAuthToken });
      if (!res.ok) {
        throw new Error(await res.text() || `Request failed with status ${res.status}`);
      }

      const data = await readJsonResponse<AISettingsResponsePayload>(res);
      setCustomModel(data.custom_model || '');
      setHasCustomKeySaved(Boolean(data.has_custom_key));
    } catch (err) {
      logDebug('AI-SETTINGS-ERR', String(err));
      updateSession({ error: translateError(err, 'settings').description });
    } finally {
      clearFetch(fetchKey);
    }
  }, [apiBase, authToken, logDebug, refreshAuthToken, updateSession]);

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
      const { projectKey, projectId } = getProjectRequestParams();
      const payload: AIGenerationRequestPayload = {
        issue_context: buildIssueContext(),
        jira_connection_id: session.jiraConnectionId,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        issue_type_id: session.selectedIssueType.id
      };
      const res = await apiRequest(`${apiBase}/ai/generate`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await res.text() || `Failed to generate analytical report (${res.status})`);
      }

      const data = await readJsonResponse<AIGenerationResponsePayload>(res);
      const bug: BugReport = {
        summary: data.summary,
        description: data.description,
        steps_to_reproduce: data.steps_to_reproduce || "", 
        expected_result: data.expected_result || "",
        actual_result: data.actual_result || "",
        severity: "Medium",
        extra_fields: sanitizeExtraFields((data.fields || {}) as BugReport['extra_fields'])
      };

      updateSession({ bugs: [bug], testCases: [], coverageScore: null }, currentTabId);
      logDebug('AI-OK', `Analysis complete for ${session.issueData.key}.`);

    } catch (err: unknown) {
      logDebug('AI-ERR', String(err));
      updateSession({ error: translateError(err, 'ai-analysis').description }, currentTabId);
    } finally {
      updateSession({ loading: false }, currentTabId);
    }
  }, [apiBase, authToken, buildIssueContext, currentTabId, getProjectRequestParams, logDebug, refreshAuthToken, sanitizeExtraFields, session.instanceUrl, session.issueData, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const generateTestCases = useCallback(async () => {
    if (!currentTabId || !session.issueData || !session.jiraConnectionId) return;
    if (!session.selectedIssueType?.id) {
      updateSession({ error: 'MISSING_ISSUE_TYPE' }, currentTabId);
      return;
    }
    updateSession({ loading: true, error: null, bugs: [], testCases: [] }, currentTabId);
    try {
      const { projectKey, projectId } = getProjectRequestParams();
      const payload: AIGenerationRequestPayload = {
        issue_context: buildIssueContext(),
        jira_connection_id: session.jiraConnectionId,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        issue_type_id: session.selectedIssueType.id
      };
      const res = await apiRequest(`${apiBase}/ai/test-cases`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(await res.text() || `Failed to generate test cases (${res.status})`);
      }
      const data = await readJsonResponse<AITestCasesResponsePayload>(res);
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
  }, [apiBase, authToken, buildIssueContext, currentTabId, fetchUsage, getProjectRequestParams, refreshAuthToken, session.instanceUrl, session.issueData, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const publishTestCasesToXray = useCallback(async () => {
    if (!currentTabId || !session.issueData || !session.jiraConnectionId || !session.testCases.length) return;
    if (!session.xrayTargetProjectId) {
      updateSession({ error: 'Please choose an Xray target project before publishing.' }, currentTabId);
      return;
    }

    updateSession({ loading: true, error: null, success: null }, currentTabId);

    try {
      const payload: XrayPublishRequestPayload = {
        jira_connection_id: session.jiraConnectionId,
        story_issue_key: session.issueData.key,
        xray_project_id: session.xrayTargetProjectId,
        xray_project_key: session.xrayTargetProjectKey,
        test_cases: session.testCases,
        test_issue_type_name: session.xrayTestIssueTypeName || 'Test',
        repository_path_field_id: session.xrayRepositoryPathFieldId || undefined,
        folder_path: session.xrayFolderPath || session.issueData.key,
        link_type: session.xrayLinkType || 'Tests'
      };
      const res = await apiRequest(`${apiBase}/jira/connections/${session.jiraConnectionId}/xray/test-suite`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await res.text() || `Failed to publish test cases to Xray (${res.status})`);
      }

      const data = await readJsonResponse<XrayPublishResponsePayload>(res);
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
      const { projectKey, projectId } = getProjectRequestParams();
      const payload: AIGenerationRequestPayload = {
        issue_context: session.issueData ? buildIssueContext() : undefined,
        selected_text: session.issueData ? undefined : session.manualDesc,
        jira_connection_id: session.jiraConnectionId,
        instance_url: session.instanceUrl,
        project_key: projectKey || 'MANUAL',
        project_id: projectId,
        issue_type_id: session.selectedIssueType.id,
        user_description: session.manualDesc
      };
      const res = await apiRequest(`${apiBase}/ai/generate`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await res.text() || `Manual processing failed (${res.status})`);
      }

      const data = await readJsonResponse<AIGenerationResponsePayload>(res);
      const newBug: BugReport = {
        summary: data.summary,
        description: data.description,
        steps_to_reproduce: data.steps_to_reproduce || '',
        expected_result: data.expected_result || '',
        actual_result: data.actual_result || '',
        severity: 'Medium',
        extra_fields: sanitizeExtraFields((data.fields || {}) as BugReport['extra_fields'])
      };
      const existing = session.bugs || [];
      updateSession({ bugs: [...existing, newBug], testCases: [], coverageScore: null, manualDesc: '', showManualInput: false, expandedBug: existing.length });
      fetchUsage();
    } catch (err: unknown) {
      updateSession({ error: translateError(err, 'ai-manual').description });
    } finally {
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, buildIssueContext, fetchUsage, getProjectRequestParams, logDebug, refreshAuthToken, sanitizeExtraFields, session.bugs, session.instanceUrl, session.issueData, session.jiraConnectionId, session.manualDesc, session.selectedIssueType?.id, updateSession]);

  const validateBug = useCallback(async (index: number): Promise<boolean> => {
    const bug = session.bugs[index];
    if (!bug || !session.jiraConnectionId || !session.issueData || !session.selectedIssueType?.id) return false;

    updateSession({ loading: true, error: null, validationErrors: [] });
    try {
      const { projectKey, projectId } = getProjectRequestParams();
      const payload: AIPreviewRequestPayload = {
        jira_connection_id: session.jiraConnectionId,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        issue_type_id: session.selectedIssueType.id,
        bug
      };
      const res = await apiRequest(`${apiBase}/ai/preview`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(await res.text() || "Validation failed");
      
      const data = await readJsonResponse<AIPreviewResponsePayload>(res);
      const actionableMissingFields = (data.missing_fields || []).filter((field) => !isSystemManagedMissingField(field));
      updateSession({ resolvedPayload: data.resolved_payload ?? null });
      if (actionableMissingFields.length > 0) {
        updateSession({ 
          validationErrors: actionableMissingFields.map(f => `Field "${f.name}" is required.`) 
        });
        return false;
      }
      updateSession({ validationErrors: [] });
      return true;
    } catch (err) {
      updateSession({ error: translateError(err, 'jira-validate').description });
      return false;
    } finally {
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, getProjectRequestParams, isSystemManagedMissingField, refreshAuthToken, session.bugs, session.instanceUrl, session.issueData, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const preparePreviewBug = useCallback((index: number) => {
    updateSession({ view: 'preview', previewBugIndex: index, validationErrors: [], resolvedPayload: null });
    void validateBug(index);
  }, [updateSession, validateBug]);

  const submitBugs = useCallback(async (index?: number) => {
    let bugs = session.bugs || [];
    if (index !== undefined) {
      bugs = [bugs[index]];
    }
    
    if (!session.issueData || !bugs.length || !session.jiraConnectionId || !session.selectedIssueType?.id) return;
    updateSession({ loading: true, error: null });
    
    try {
      const { projectKey, projectId } = getProjectRequestParams();
      const payload: AISubmitRequestPayload = {
        jira_connection_id: session.jiraConnectionId,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        issue_type_id: session.selectedIssueType.id,
        bugs
      };
      const res = await apiRequest(`${apiBase}/ai/submit`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(await res.text() || 'Failed to submit bugs');
      }

      const data = await readJsonResponse<AISubmitResponsePayload>(res);
      updateSession({ view: 'success', createdIssues: data.created_issues || [] });
    } catch (err: unknown) {
      const jiraRequiredFields = parseJiraRequiredFieldErrors(err);
      if (jiraRequiredFields.length > 0) {
        const visibleKeys = Array.from(new Set([
          ...(session.visibleFields || []),
          ...jiraRequiredFields.map((field) => field.key)
        ]));

        updateSession({
          error: null,
          view: 'preview',
          previewBugIndex: index ?? session.previewBugIndex ?? 0,
          visibleFields: visibleKeys,
          validationErrors: jiraRequiredFields.map((field) => `Field "${field.name}" is required.`)
        });
        return;
      }

      updateSession({ error: translateError(err, 'jira-submit').description });
    } finally {
      updateSession({ loading: false });
    }
  }, [authToken, apiBase, getProjectRequestParams, parseJiraRequiredFieldErrors, refreshAuthToken, session.bugs, session.instanceUrl, session.issueData, session.jiraConnectionId, session.previewBugIndex, session.selectedIssueType, session.visibleFields, updateSession]);

  const searchUsers = useCallback(async (query: string, bugIndex?: number) => {
    if (query.length < 2 || !session.jiraConnectionId) return;
    if (bugIndex !== undefined) handleUpdateBug(bugIndex, { isSearchingUsers: true, lastSearchedQuery: query });
    if (searchControllerRef.current) searchControllerRef.current.abort();
    searchControllerRef.current = new AbortController();

    try {
      const payload: JiraUserSearchRequestPayload = {
        jira_connection_id: session.jiraConnectionId,
        query,
        project_id: getProjectRequestParams().projectId,
        project_key: getProjectRequestParams().projectKey
      };
      const res = await apiRequest(`${apiBase}/jira/users/search`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        signal: searchControllerRef.current.signal,
        body: JSON.stringify(payload)
      });
      if (res.ok && bugIndex !== undefined) {
        handleUpdateBug(bugIndex, { userSearchResults: await readJsonResponse<JiraUsersSearchResponsePayload>(res), isSearchingUsers: false });
      }
    } catch (err) {
      if (bugIndex !== undefined) handleUpdateBug(bugIndex, { isSearchingUsers: false });
    }
  }, [apiBase, authToken, getProjectRequestParams, refreshAuthToken, handleUpdateBug, session.jiraConnectionId]);

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
    preparePreviewBug
  }), [usage, fetchUsage, customModel, customKey, hasCustomKeySaved, fetchAISettings, generateBugs, generateTestCases, handleManualGenerate, submitBugs, searchUsers, handleUpdateBug, handleUpdateTestCase, publishTestCasesToXray, validateBug, preparePreviewBug]);

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
};
