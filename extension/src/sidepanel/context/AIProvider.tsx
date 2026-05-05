import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { TabSession, BugReport, Usage, INITIAL_SESSION, TestCase, MissingField, IssueContextPayload, SupportingArtifact, ManualBugInput, GapAnalysisSummary, BulkFetchResult, BulkProgressPayload, BulkStory, DuplicateCheckResponse, DuplicateLinkResponse } from '../types';
import { ApiError, apiRequest, getErrorMessage, readJsonResponse, throwApiErrorResponse } from '../services/api';
import {
  AIGenerationRequestPayload,
  AITestCaseGenerationRequestPayload,
  GapAnalysisResponsePayload,
  ManualBugGenerationResponsePayload,
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
  GeneratedFindingResponsePayload,
  BulkWorkerResponsePayload,
  buildIssueContextPayload,
  buildProjectRequestParams,
  DuplicateCheckRequestPayload,
  DuplicateLinkRequestPayload,
} from '../services/contracts';
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
  const extractBulkSubmitFailure = useCallback((err: unknown) => {
    if (!(err instanceof ApiError) || !Array.isArray(err.details)) return null;

    const detail = err.details.find((item) => item && typeof item === 'object' && 'bug_index' in (item as Record<string, unknown>)) as
      | {
          bug_index?: unknown;
          bug_summary?: unknown;
          missing_fields?: unknown;
          jira_error?: unknown;
        }
      | undefined;

    if (!detail || typeof detail.bug_index !== 'number') return null;

    const parsedMissingFields = Array.isArray(detail.missing_fields)
      ? detail.missing_fields
          .filter((field): field is { key: string; name: string } => Boolean(field) && typeof field === 'object' && typeof (field as { key?: unknown }).key === 'string' && typeof (field as { name?: unknown }).name === 'string')
      : [];

    return {
      bugIndex: detail.bug_index,
      bugSummary: typeof detail.bug_summary === 'string' ? detail.bug_summary : undefined,
      missingFields: parsedMissingFields,
      jiraError: typeof detail.jira_error === 'string' ? detail.jira_error : undefined,
    };
  }, []);

  const parseJiraRequiredFieldErrors = useCallback((err: unknown) => {
    const bulkFailure = extractBulkSubmitFailure(err);
    if (bulkFailure?.missingFields?.length) {
      return bulkFailure.missingFields.map((field) => {
        const schemaField = session.jiraMetadata?.fields.find((item) => item.key === field.key);
        return {
          key: field.key,
          name: schemaField?.name || field.name || field.key,
        };
      });
    }

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
  }, [extractBulkSubmitFailure, session.jiraMetadata?.fields]);

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
  const [clearCustomKeyRequested, setClearCustomKeyRequested] = useState(false);
  const searchControllerRef = useRef<AbortController | null>(null);
  const generateBugsInFlightRef = useRef(false);
  const generateBugsRequestRef = useRef(0);
  const generateTestsInFlightRef = useRef(false);
  const generateTestsRequestRef = useRef(0);
  const manualGenerateInFlightRef = useRef(false);
  const submitBugsInFlightRef = useRef(false);
  const publishXrayInFlightRef = useRef(false);
  const validationRequestRef = useRef(0);

  const activeFetches = useRef<Set<string>>(new Set());
  const isFetching = (key: string) => activeFetches.current.has(key);
  const startFetch = (key: string) => activeFetches.current.add(key);
  const clearFetch = (key: string) => activeFetches.current.delete(key);

  const sendBulkWorkerMessage = useCallback(<T,>(action: string, payload: Record<string, unknown>): Promise<T> => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action,
          tabId: currentTabId || undefined,
          payload: {
            ...payload,
            apiBase,
            authToken: authToken || undefined,
          }
        },
        (response: BulkWorkerResponsePayload<T> | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response) {
            reject(new Error('Bulk worker did not return a response.'));
            return;
          }
          if (!response.ok) {
            reject(new Error(response.error));
            return;
          }
          resolve(response.result);
        }
      );
    });
  }, [apiBase, authToken, currentTabId]);

  useEffect(() => {
    const handler = (message: { action?: string; tabId?: number; payload?: BulkProgressPayload }) => {
      if (!message?.action || !message.payload) return;
      if (!['bulkFetchProgress', 'bulkGenerationProgress', 'bulkAnalysisProgress', 'brdComparisonProgress'].includes(message.action)) return;
      if (message.tabId && currentTabId && message.tabId !== currentTabId) return;
      updateSession({
        bulkProgressMessage: message.payload.message,
        bulkProgressPercent: message.payload.percent,
      }, currentTabId || undefined);
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [currentTabId, updateSession]);

  const sanitizeExtraFields = useCallback((fields: BugReport['extra_fields']) => {
    if (!fields) return {};

    const sanitized = { ...fields } as NonNullable<BugReport['extra_fields']>;
    delete sanitized.summary;
    delete sanitized.description;
    delete sanitized.issuetype;
    delete sanitized.project;
    return sanitized;
  }, []);

  const buildIdempotencyKey = useCallback((prefix = 'request') => {
    const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${currentTabId ?? 'tab'}-${randomId}`;
  }, [currentTabId]);

  const buildDefaultExtraFields = useCallback(() => {
    return sanitizeExtraFields((session.fieldDefaults || {}) as BugReport['extra_fields']);
  }, [sanitizeExtraFields, session.fieldDefaults]);

  const toFrontendBug = useCallback((bug: GeneratedFindingResponsePayload): BugReport => ({
    summary: bug.summary,
    description: bug.description,
    steps_to_reproduce: bug.steps_to_reproduce || '',
    expected_result: bug.expected_result || '',
    actual_result: bug.actual_result || '',
    severity: bug.severity || 'Medium',
    priority: bug.priority || 'Medium',
    confidence: typeof bug.confidence === 'number' ? bug.confidence : 75,
    category: bug.category || 'Functional Gap',
    environment: bug.environment || undefined,
    root_cause: bug.root_cause || undefined,
    acceptance_criteria_refs: bug.acceptance_criteria_refs || [],
    evidence: bug.evidence || [],
    suggested_evidence: bug.suggested_evidence || [],
    labels: bug.labels || [],
    review_required: Boolean(bug.review_required),
    duplicate_group: bug.duplicate_group || null,
    overlap_warning: bug.overlap_warning || null,
    edited: false,
    extra_fields: {
      ...buildDefaultExtraFields(),
      ...sanitizeExtraFields((bug.fields || {}) as BugReport['extra_fields'])
    }
  }), [buildDefaultExtraFields, sanitizeExtraFields]);

  const normalizeFrontendTestCase = useCallback((testCase: TestCase): TestCase => ({
    title: testCase.title || 'Untitled test case',
    objective: testCase.objective || undefined,
    steps: Array.isArray(testCase.steps) ? testCase.steps.filter(Boolean) : [],
    expected_result: testCase.expected_result || '',
    priority: testCase.priority || 'Medium',
    selected: testCase.selected !== false,
    test_type: testCase.test_type || 'Manual',
    preconditions: testCase.preconditions || '',
    test_data: testCase.test_data || undefined,
    review_notes: testCase.review_notes || undefined,
    acceptance_criteria_refs: Array.isArray(testCase.acceptance_criteria_refs) ? testCase.acceptance_criteria_refs : [],
    labels: Array.isArray(testCase.labels) ? testCase.labels : [],
    components: Array.isArray(testCase.components) ? testCase.components : []
  }), []);

  const normalizeGapAnalysisSummary = useCallback((summary: GapAnalysisSummary | null | undefined): GapAnalysisSummary | null => {
    if (!summary || typeof summary !== 'object') return null;

    const grouped_risks = Array.isArray(summary.grouped_risks)
      ? summary.grouped_risks.filter((risk): risk is GapAnalysisSummary['grouped_risks'][number] =>
        Boolean(risk) &&
        typeof risk === 'object' &&
        typeof risk.group === 'string' &&
        typeof risk.title === 'string' &&
        typeof risk.description === 'string' &&
        typeof risk.count === 'number'
      )
      : [];

    const missing_ac_recommendations = Array.isArray(summary.missing_ac_recommendations)
      ? summary.missing_ac_recommendations.filter((item): item is string => typeof item === 'string')
      : [];

    const ac_coverage_map = Array.isArray(summary.ac_coverage_map)
      ? summary.ac_coverage_map
        .filter((item): item is GapAnalysisSummary['ac_coverage_map'][number] =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof item.reference === 'string' &&
          typeof item.status === 'string' &&
          typeof item.rationale === 'string'
        )
        .map((item) => ({
          ...item,
          related_bug_indexes: Array.isArray(item.related_bug_indexes)
            ? item.related_bug_indexes.filter((index): index is number => typeof index === 'number')
            : []
        }))
      : [];

    return {
      issue_type_mode: summary.issue_type_mode || null,
      summary_headline: summary.summary_headline || null,
      highest_risk_area: summary.highest_risk_area || null,
      recommended_next_action: summary.recommended_next_action || null,
      grouped_risks,
      missing_ac_recommendations,
      ac_coverage_map
    };
  }, []);

  const buildIssueContext = useCallback((): IssueContextPayload => buildIssueContextPayload(session.issueData), [session.issueData]);
  const getProjectRequestParams = useCallback(() => {
    const { project_key, project_id } = buildProjectRequestParams(session.issueData);
    return {
      projectKey: session.jiraMetadata?.project_key || project_key,
      projectId: session.jiraMetadata?.project_id || project_id
    };
  }, [session.issueData, session.jiraMetadata]);

  const fetchUsage = useCallback(async () => {
    if (!authToken) return;
    const fetchKey = 'usage-fetch';
    if (isFetching(fetchKey)) return;
    startFetch(fetchKey);
    try {
      const res = await apiRequest(`${apiBase}/ai/usage`, { token: authToken, onUnauthorized: refreshAuthToken });
      if (!res.ok) {
        await throwApiErrorResponse(res, `Request failed with status ${res.status}`);
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
        await throwApiErrorResponse(res, `Request failed with status ${res.status}`);
      }

      const data = await readJsonResponse<AISettingsResponsePayload>(res);
      setCustomModel(data.custom_model || '');
      setHasCustomKeySaved(Boolean(data.has_custom_key));
    } catch (err) {
      logDebug('AI-SETTINGS-ERR', String(err));
      updateSession({ error: getErrorMessage(err) });
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
        newBugs[index] = {
          ...newBugs[index],
          ...updates,
          extra_fields: updates.extra_fields
            ? { ...(newBugs[index].extra_fields || {}), ...updates.extra_fields }
            : newBugs[index].extra_fields,
          edited: true
        };
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

  const buildGenerationLearningHints = useCallback(() => {
    const editedBugs = (session.bugs || []).filter((bug) => bug.edited);
    if (!editedBugs.length) return '';

    const hints = editedBugs.slice(0, 3).map((bug, index) => {
      const refs = (bug.acceptance_criteria_refs || []).slice(0, 2).join(', ');
      return `Edited example ${index + 1}: Severity=${bug.severity}; Category=${bug.category || 'Unspecified'}; Summary="${bug.summary}".${refs ? ` References=${refs}.` : ''}`;
    });
    return `Use these user-corrected bug drafting preferences as guidance:\n${hints.join('\n')}`;
  }, [session.bugs]);

  const buildArtifactContextFromList = useCallback((artifactsInput: SupportingArtifact[]) => {
    const artifacts = (artifactsInput || []).map((artifact: SupportingArtifact) => {
      const truncated = artifact.content.length > 4000
        ? `${artifact.content.slice(0, 4000)}\n... (artifact truncated) ...`
        : artifact.content;
      return `Attachment: ${artifact.name} (${artifact.type || 'text/plain'}, ${artifact.size} bytes)\n${truncated}`;
    });
    return artifacts.join('\n\n');
  }, []);

  const buildArtifactContext = useCallback(() => buildArtifactContextFromList(session.supportingArtifacts || []), [buildArtifactContextFromList, session.supportingArtifacts]);

  // Phase 5: Streaming Implementation
  const generateBugs = useCallback(async () => {
    if (generateBugsInFlightRef.current) return;
    if (!currentTabId || !session.issueData || !session.jiraConnectionId) {
      logDebug('AI-ABORT', 'Missing session data or Jira connection ID');
      return;
    }
    if (!session.selectedIssueType?.id) {
      updateSession({ error: 'MISSING_ISSUE_TYPE' }, currentTabId);
      logDebug('AI-ABORT', 'Missing Jira issue type selection');
      return;
    }
    generateBugsInFlightRef.current = true;
    const requestId = generateBugsRequestRef.current + 1;
    generateBugsRequestRef.current = requestId;
    const requestTabId = currentTabId;
    const requestIssueKey = session.issueData.key;
    const requestJiraConnectionId = session.jiraConnectionId;
    const requestIssueTypeId = session.selectedIssueType.id;
    updateSession({ loading: true, error: null, success: null, testCases: [], coverageScore: null, gapAnalysisSummary: null }, currentTabId);
    logDebug('AI-START', `Analyzing ${session.issueData.key}...`);

    try {
      const { projectKey, projectId } = getProjectRequestParams();
      const payload: AIGenerationRequestPayload = {
        issue_context: buildIssueContext(),
        jira_connection_id: session.jiraConnectionId,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        issue_type_id: session.selectedIssueType.id,
        issue_type_name: session.selectedIssueType.name,
        bug_count: session.bugGenerationCount,
        supporting_context: [session.generationSupportingContext, buildGenerationLearningHints(), buildArtifactContext()].filter(Boolean).join('\n\n')
      };
      const res = await apiRequest(`${apiBase}/ai/generate`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        await throwApiErrorResponse(res, `Failed to generate analytical report (${res.status})`);
      }

      const data = await readJsonResponse<GapAnalysisResponsePayload>(res);
      const bugs = (data.bugs || []).map(toFrontendBug);
      if (!bugs.length) {
        throw new Error('AI returned no usable findings. Please try again with more story detail or supporting context.');
      }
      const rawCoverageScore = data.ac_coverage === undefined || data.ac_coverage === null
        ? null
        : Number(data.ac_coverage);
      const coverageScore = rawCoverageScore === null || !Number.isFinite(rawCoverageScore)
        ? null
        : Math.max(0, Math.min(100, rawCoverageScore));

      let applied = false;
      setTabSessions(prev => {
        const curr = prev[requestTabId] || INITIAL_SESSION;
        if (
          generateBugsRequestRef.current !== requestId ||
          curr.issueData?.key !== requestIssueKey ||
          curr.jiraConnectionId !== requestJiraConnectionId ||
          curr.selectedIssueType?.id !== requestIssueTypeId
        ) {
          return prev;
        }
        applied = true;
        return {
          ...prev,
          [requestTabId]: {
            ...curr,
            bugs,
            testCases: [],
            coverageScore,
            gapAnalysisSummary: normalizeGapAnalysisSummary(data.analysis_summary),
            success: data.warnings?.length ? data.warnings.join(' ') : null,
          }
        };
      });
      if (applied) fetchUsage();
      logDebug('AI-OK', `Analysis complete for ${session.issueData.key}.`);

    } catch (err: unknown) {
      logDebug('AI-ERR', String(err));
      setTabSessions(prev => {
        const curr = prev[requestTabId] || INITIAL_SESSION;
        if (
          generateBugsRequestRef.current !== requestId ||
          curr.issueData?.key !== requestIssueKey ||
          curr.jiraConnectionId !== requestJiraConnectionId ||
          curr.selectedIssueType?.id !== requestIssueTypeId
        ) {
          return prev;
        }
        return { ...prev, [requestTabId]: { ...curr, error: getErrorMessage(err) } };
      });
    } finally {
      generateBugsInFlightRef.current = false;
      if (generateBugsRequestRef.current === requestId) {
        setTabSessions(prev => {
          const curr = prev[requestTabId] || INITIAL_SESSION;
          return { ...prev, [requestTabId]: { ...curr, loading: false } };
        });
      }
    }
  }, [apiBase, authToken, buildArtifactContext, buildGenerationLearningHints, buildIssueContext, currentTabId, fetchUsage, getProjectRequestParams, logDebug, normalizeGapAnalysisSummary, refreshAuthToken, session.bugGenerationCount, session.generationSupportingContext, session.instanceUrl, session.issueData, session.jiraConnectionId, session.selectedIssueType, setTabSessions, toFrontendBug, updateSession]);

  const generateTestCases = useCallback(async () => {
    if (generateTestsInFlightRef.current) return;
    if (!currentTabId || !session.issueData || !session.jiraConnectionId) return;
    if (!session.selectedIssueType?.id) {
      updateSession({ error: 'MISSING_ISSUE_TYPE' }, currentTabId);
      return;
    }
    generateTestsInFlightRef.current = true;
    const requestId = generateTestsRequestRef.current + 1;
    generateTestsRequestRef.current = requestId;
    const requestTabId = currentTabId;
    const requestIssueKey = session.issueData.key;
    const requestJiraConnectionId = session.jiraConnectionId;
    const requestIssueTypeId = session.selectedIssueType.id;
    updateSession({ loading: true, error: null, success: null, gapAnalysisSummary: null }, currentTabId);
    try {
      const { projectKey, projectId } = getProjectRequestParams();
      const payload: AITestCaseGenerationRequestPayload = {
        issue_context: buildIssueContext(),
        jira_connection_id: session.jiraConnectionId,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        issue_type_id: session.selectedIssueType.id,
        issue_type_name: session.selectedIssueType.name,
        test_categories: session.testGenerationTypes?.length ? session.testGenerationTypes : undefined,
        supporting_context: [
          session.generationSupportingContext,
          buildArtifactContext()
        ].filter(Boolean).join('\n\n')
      };
      const res = await apiRequest(`${apiBase}/ai/test-cases`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        await throwApiErrorResponse(res, `Failed to generate test cases (${res.status})`);
      }
      const data = await readJsonResponse<AITestCasesResponsePayload>(res);
      const testCases = (data.test_cases || []).map(normalizeFrontendTestCase);
      if (!testCases.length) {
        throw new Error('AI returned no usable test cases. Please try again with more story detail or supporting context.');
      }
      const rawCoverageScore = data.coverage_score === undefined || data.coverage_score === null
        ? null
        : Number(data.coverage_score);
      const coverageScore = rawCoverageScore === null || !Number.isFinite(rawCoverageScore)
        ? null
        : Math.max(0, Math.min(100, rawCoverageScore));
      let applied = false;
      setTabSessions(prev => {
        const curr = prev[requestTabId] || INITIAL_SESSION;
        if (
          generateTestsRequestRef.current !== requestId ||
          curr.issueData?.key !== requestIssueKey ||
          curr.jiraConnectionId !== requestJiraConnectionId ||
          curr.selectedIssueType?.id !== requestIssueTypeId
        ) {
          return prev;
        }
        applied = true;
        return {
          ...prev,
          [requestTabId]: {
            ...curr,
            bugs: [],
            testCases,
            coverageScore,
            gapAnalysisSummary: null,
            xrayFolderPath: requestIssueKey,
            xrayWarnings: [],
            createdIssues: [],
            xrayProjects: [],
            xrayTargetProjectId: null,
            xrayTargetProjectKey: null
          }
        };
      });
      if (applied) fetchUsage();
    } catch (err) {
      setTabSessions(prev => {
        const curr = prev[requestTabId] || INITIAL_SESSION;
        if (
          generateTestsRequestRef.current !== requestId ||
          curr.issueData?.key !== requestIssueKey ||
          curr.jiraConnectionId !== requestJiraConnectionId ||
          curr.selectedIssueType?.id !== requestIssueTypeId
        ) {
          return prev;
        }
        return { ...prev, [requestTabId]: { ...curr, error: getErrorMessage(err) } };
      });
    } finally {
      generateTestsInFlightRef.current = false;
      if (generateTestsRequestRef.current === requestId) {
        setTabSessions(prev => {
          const curr = prev[requestTabId] || INITIAL_SESSION;
          return { ...prev, [requestTabId]: { ...curr, loading: false } };
        });
      }
    }
  }, [apiBase, authToken, buildArtifactContext, buildIssueContext, currentTabId, fetchUsage, getProjectRequestParams, normalizeFrontendTestCase, refreshAuthToken, session.generationSupportingContext, session.instanceUrl, session.issueData, session.jiraConnectionId, session.selectedIssueType, session.testGenerationTypes, setTabSessions, updateSession]);

  const publishTestCasesToXray = useCallback(async () => {
    if (publishXrayInFlightRef.current) return;
    if (!currentTabId || !session.issueData || !session.jiraConnectionId || !session.testCases.length) return;
    if (!session.xrayPublishSupported) {
      updateSession({ error: session.xrayUnsupportedReason || 'Xray publishing is not available for this Jira connection.' }, currentTabId);
      return;
    }
    if (!session.xrayTargetProjectId) {
      updateSession({ error: 'Please choose an Xray target project before publishing.' }, currentTabId);
      return;
    }
    const selectedTestCases = session.testCases.filter((testCase) => testCase.selected !== false);
    if (!selectedTestCases.length) {
      updateSession({ error: 'Select at least one test case before publishing.' }, currentTabId);
      return;
    }

    publishXrayInFlightRef.current = true;
    updateSession({ loading: true, error: null, success: null }, currentTabId);

    try {
      const payload: XrayPublishRequestPayload = {
        jira_connection_id: session.jiraConnectionId,
        story_issue_key: session.issueData.key,
        xray_project_id: session.xrayTargetProjectId,
        xray_project_key: session.xrayTargetProjectKey,
        test_cases: selectedTestCases.map(normalizeFrontendTestCase),
        test_issue_type_id: undefined,
        test_issue_type_name: session.xrayTestIssueTypeName || 'Test',
        repository_path_field_id: session.xrayRepositoryPathFieldId || undefined,
        folder_path: session.xrayFolderPath || session.issueData.key,
        link_type: session.xrayLinkType || 'Tests'
      };
      const res = await apiRequest(`${apiBase}/jira/connections/${session.jiraConnectionId}/xray/test-suite`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        headers: { 'Idempotency-Key': buildIdempotencyKey('xray-publish') },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        await throwApiErrorResponse(res, `Failed to publish test cases to Xray (${res.status})`);
      }

      const data = await readJsonResponse<XrayPublishResponsePayload>(res);
      updateSession({
        createdIssues: data.created_tests || [],
        xrayWarnings: data.warnings || [],
        success: `Published ${(data.created_tests || []).length} test cases to Xray folder ${data.folder_path}.`
      }, currentTabId);
    } catch (err) {
      updateSession({ error: getErrorMessage(err) }, currentTabId);
    } finally {
      publishXrayInFlightRef.current = false;
      updateSession({ loading: false }, currentTabId);
    }
  }, [apiBase, authToken, buildIdempotencyKey, currentTabId, normalizeFrontendTestCase, refreshAuthToken, session.issueData, session.jiraConnectionId, session.testCases, session.xrayFolderPath, session.xrayLinkType, session.xrayPublishSupported, session.xrayRepositoryPathFieldId, session.xrayTargetProjectId, session.xrayTargetProjectKey, session.xrayTestIssueTypeName, session.xrayUnsupportedReason, updateSession]);

  const handleManualGenerate = useCallback(async () => {
    if (manualGenerateInFlightRef.current) return;
    const manualInputs = (session.manualInputs || []).filter((item: ManualBugInput) => item.text.trim());
    if (!manualInputs.length || !session.jiraConnectionId) return;
    if (!session.selectedIssueType?.id) {
      updateSession({ error: 'MISSING_ISSUE_TYPE' });
      logDebug('MANUAL-ABORT', 'Missing Jira issue type selection');
      return;
    }
    manualGenerateInFlightRef.current = true;
    updateSession({ loading: true, error: null, testCases: [], coverageScore: null, gapAnalysisSummary: null });
    logDebug('MANUAL-START', `Structuring ${manualInputs.length} manual finding(s)...`);
    const generatedBugs: BugReport[] = [];
    let committedGeneratedBugs = false;
    try {
      const { projectKey, projectId } = getProjectRequestParams();

      for (const manualInput of manualInputs) {
        const payload: AIGenerationRequestPayload = {
          issue_context: session.issueData ? buildIssueContext() : undefined,
          selected_text: session.issueData ? undefined : manualInput.text,
          jira_connection_id: session.jiraConnectionId,
          instance_url: session.instanceUrl,
          project_key: projectKey || 'MANUAL',
          project_id: projectId,
          issue_type_id: session.selectedIssueType.id,
          issue_type_name: session.selectedIssueType.name,
          user_description: manualInput.text,
          bug_count: 1,
          supporting_context: [
            manualInput.supportingContext,
            buildGenerationLearningHints(),
            buildArtifactContextFromList(manualInput.supportingArtifacts || [])
          ].filter(Boolean).join('\n\n')
        };
        const res = await apiRequest(`${apiBase}/ai/generate/manual`, {
          method: 'POST',
          token: authToken,
          onUnauthorized: refreshAuthToken,
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          await throwApiErrorResponse(res, `Manual processing failed (${res.status})`);
        }

        const data = await readJsonResponse<ManualBugGenerationResponsePayload>(res);
        const generated = (data.bugs || []).map(toFrontendBug);
        generatedBugs.push(...generated);
      }

      const existing = session.bugs || [];
      updateSession({
        bugs: [...existing, ...generatedBugs],
        testCases: [],
        coverageScore: null,
        gapAnalysisSummary: null,
        manualInputs: [{ text: '', supportingContext: '', supportingArtifacts: [] }],
        mainWorkflow: 'home',
        expandedBug: existing.length
      });
      committedGeneratedBugs = true;
      fetchUsage();
    } catch (err: unknown) {
      if (generatedBugs.length > 0 && !committedGeneratedBugs) {
        const existing = session.bugs || [];
        updateSession({
          bugs: [...existing, ...generatedBugs],
          mainWorkflow: 'home',
          expandedBug: existing.length,
          error: getErrorMessage(err)
        });
        fetchUsage();
      } else {
        updateSession({ error: getErrorMessage(err) });
      }
    } finally {
      manualGenerateInFlightRef.current = false;
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, buildArtifactContextFromList, buildGenerationLearningHints, buildIssueContext, fetchUsage, getProjectRequestParams, logDebug, refreshAuthToken, session.bugs, session.instanceUrl, session.issueData, session.jiraConnectionId, session.manualInputs, session.selectedIssueType?.id, session.selectedIssueType?.name, toFrontendBug, updateSession]);

  const regenerateBug = useCallback(async (index: number, refinementPrompt?: string) => {
    const bug = session.bugs[index];
    if (!bug || !session.issueData || !session.jiraConnectionId || !session.selectedIssueType?.id) return;
    updateSession({ loading: true, error: null, success: null });
    try {
      const { projectKey, projectId } = getProjectRequestParams();
      const payload: AIGenerationRequestPayload = {
        issue_context: buildIssueContext(),
        jira_connection_id: session.jiraConnectionId,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        issue_type_id: session.selectedIssueType.id,
        issue_type_name: session.selectedIssueType.name,
        bug_count: 1,
        focus_bug_summary: bug.summary,
        refinement_prompt: refinementPrompt || `Refine this finding as a stronger ${bug.category || 'functional'} bug with severity ${bug.severity}.`,
        supporting_context: [
          session.generationSupportingContext,
          buildGenerationLearningHints(),
          buildArtifactContext(),
          `Current draft evidence: ${(bug.evidence || []).join('; ')}`,
          `Current AC references: ${(bug.acceptance_criteria_refs || []).join(', ')}`
        ].filter(Boolean).join('\n\n')
      };
      const res = await apiRequest(`${apiBase}/ai/generate`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        await throwApiErrorResponse(res, `Failed to refine finding (${res.status})`);
      }
      const data = await readJsonResponse<GapAnalysisResponsePayload>(res);
      const regenerated = (data.bugs || []).map(toFrontendBug)[0];
      if (!regenerated || !currentTabId) return;

      setTabSessions(prev => {
        const curr = prev[currentTabId] || INITIAL_SESSION;
        const nextBugs = [...(curr.bugs || [])];
        if (!nextBugs[index]) return prev;
        const existingBug = nextBugs[index];
        nextBugs[index] = {
          ...existingBug,
          ...regenerated,
          extra_fields: {
            ...(regenerated.extra_fields || {}),
            ...(existingBug.extra_fields || {})
          },
          edited: true
        };
        return {
          ...prev,
          [currentTabId]: {
            ...curr,
            bugs: nextBugs,
            expandedBug: index,
            success: data.warnings?.length ? data.warnings.join(' ') : 'Finding regenerated.',
          }
        };
      });
    } catch (err) {
      updateSession({ error: getErrorMessage(err) });
    } finally {
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, buildArtifactContext, buildGenerationLearningHints, buildIssueContext, currentTabId, getProjectRequestParams, refreshAuthToken, session.bugs, session.generationSupportingContext, session.instanceUrl, session.issueData, session.jiraConnectionId, session.selectedIssueType, setTabSessions, toFrontendBug, updateSession]);

  const validateBug = useCallback(async (index: number): Promise<boolean> => {
    const bug = session.bugs[index];
    if (!bug || !session.jiraConnectionId || !session.issueData || !session.selectedIssueType?.id) return false;

    const requestId = validationRequestRef.current + 1;
    validationRequestRef.current = requestId;
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

      if (!res.ok) await throwApiErrorResponse(res, 'Validation failed');
      
      const data = await readJsonResponse<AIPreviewResponsePayload>(res);
      const actionableMissingFields = (data.missing_fields || []).filter((field) => !isSystemManagedMissingField(field));
      if (validationRequestRef.current !== requestId) return false;

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
      if (validationRequestRef.current === requestId) {
        updateSession({ error: getErrorMessage(err) });
      }
      return false;
    } finally {
      if (validationRequestRef.current === requestId) {
        updateSession({ loading: false });
      }
    }
  }, [apiBase, authToken, getProjectRequestParams, isSystemManagedMissingField, refreshAuthToken, session.bugs, session.instanceUrl, session.issueData, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const preparePreviewBug = useCallback((index: number) => {
    if (index < 0 || index >= session.bugs.length) {
      updateSession({ view: 'main', previewBugIndex: null, validationErrors: [], resolvedPayload: null, error: 'Could not find the draft for review.' });
      return;
    }
    updateSession({
      view: 'preview',
      previewBugIndex: index,
      validationErrors: [],
      resolvedPayload: null,
      duplicateMatches: [],
      duplicateCheckFailed: false,
      duplicateCheckFailureReason: '',
      duplicateCheckLoading: false,
    });
    void validateBug(index);
  }, [session.bugs.length, updateSession, validateBug]);


  // ── Phase 2: Duplicate detection ─────────────────────────────────────

  const checkDuplicates = useCallback(async (bugIndex: number) => {
    const bug = session.bugs[bugIndex];
    if (!bug || !session.jiraConnectionId) return;

    const { projectKey } = getProjectRequestParams();
    if (!projectKey) return;

    updateSession({ duplicateCheckLoading: true, duplicateCheckFailed: false, duplicateCheckFailureReason: '' });

    try {
      const payload: DuplicateCheckRequestPayload = {
        jira_connection_id: session.jiraConnectionId,
        project_key: projectKey,
        story_key: session.issueData?.key || undefined,
        instance_url: session.instanceUrl,
        candidate_summary: bug.summary || '',
        candidate_description: bug.description || '',
        error_message: bug.actual_result || '',
        component: '',
        labels: bug.labels || [],
      };

      const res = await apiRequest(`${apiBase}/jira/duplicates/check`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        updateSession({
          duplicateCheckLoading: false,
          duplicateCheckFailed: true,
          duplicateCheckFailureReason: 'Duplicate check request failed.',
          duplicateMatches: [],
        });
        return;
      }

      const data = await readJsonResponse<DuplicateCheckResponse>(res);
      updateSession({
        duplicateCheckLoading: false,
        duplicateMatches: data.matches || [],
        duplicateCheckFailed: data.check_failed || false,
        duplicateCheckFailureReason: data.failure_reason || '',
      });
    } catch {
      updateSession({
        duplicateCheckLoading: false,
        duplicateCheckFailed: true,
        duplicateCheckFailureReason: 'Duplicate check could not be completed.',
        duplicateMatches: [],
      });
    }
  }, [session.bugs, session.jiraConnectionId, session.issueData?.key, session.instanceUrl, apiBase, authToken, refreshAuthToken, updateSession, getProjectRequestParams]);


  const linkToExisting = useCallback(async (existingKey: string): Promise<DuplicateLinkResponse | null> => {
    if (!session.jiraConnectionId || !session.issueData?.key) return null;

    try {
      const payload: DuplicateLinkRequestPayload = {
        jira_connection_id: session.jiraConnectionId,
        story_key: session.issueData.key,
        existing_issue_key: existingKey,
      };

      const res = await apiRequest(`${apiBase}/jira/duplicates/link`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify(payload),
      });

      if (!res.ok) return null;
      return await readJsonResponse<DuplicateLinkResponse>(res);
    } catch {
      return null;
    }
  }, [session.jiraConnectionId, session.issueData?.key, apiBase, authToken, refreshAuthToken]);

  const submitBugs = useCallback(async (index?: number) => {
    if (submitBugsInFlightRef.current) return;
    const allBugs = session.bugs || [];
    let bugs = allBugs;
    if (index !== undefined) {
      const selectedBug = allBugs[index];
      if (!selectedBug) {
        updateSession({ error: 'Could not find the selected bug draft to publish.' });
        return;
      }
      bugs = [selectedBug];
    }
    
    if (!session.issueData || !bugs.length || !session.jiraConnectionId || !session.selectedIssueType?.id) return;
    submitBugsInFlightRef.current = true;
    updateSession({ loading: true, error: null });
    
    try {
      if (index === undefined) {
        for (let bugIndex = 0; bugIndex < allBugs.length; bugIndex += 1) {
          const isBugValid = await validateBug(bugIndex);
          if (!isBugValid) {
            updateSession({
              view: 'preview',
              previewBugIndex: bugIndex,
              error: null
            });
            return;
          }
        }
        bugs = allBugs;
      } else {
        const isBugValid = await validateBug(index);
        if (!isBugValid) {
          updateSession({ view: 'preview', previewBugIndex: index, error: null });
          return;
        }
      }

      updateSession({ loading: true, error: null });
      const { projectKey, projectId } = getProjectRequestParams();
      const payload: AISubmitRequestPayload = {
        jira_connection_id: session.jiraConnectionId,
        instance_url: session.instanceUrl,
        story_issue_key: session.issueData.key,
        project_key: projectKey,
        project_id: projectId,
        issue_type_id: session.selectedIssueType.id,
        bugs
      };
      const res = await apiRequest(`${apiBase}/ai/submit`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        headers: { 'Idempotency-Key': buildIdempotencyKey('ai-submit') },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        await throwApiErrorResponse(res, 'Failed to submit bugs');
      }

      const data = await readJsonResponse<AISubmitResponsePayload>(res);
      updateSession({
        view: 'success',
        mainWorkflow: 'home',
        createdIssues: (data.created_issues || []).map((issue) => ({
          ...issue,
          linkedToStory: !(data.unlinked_issue_keys || []).includes(issue.key)
        })),
        previewBugIndex: null,
        resolvedPayload: null,
        validationErrors: [],
        expandedBug: null,
        success: data.warnings?.length ? data.warnings.join(' ') : null,
      });
    } catch (err: unknown) {
      const bulkFailure = extractBulkSubmitFailure(err);
      const jiraRequiredFields = parseJiraRequiredFieldErrors(err);
      if (jiraRequiredFields.length > 0) {
        const visibleKeys = Array.from(new Set([
          ...(session.visibleFields || []),
          ...jiraRequiredFields.map((field) => field.key)
        ]));

        updateSession({
          error: null,
          view: 'preview',
          previewBugIndex: bulkFailure?.bugIndex ?? index ?? session.previewBugIndex ?? 0,
          visibleFields: visibleKeys,
          validationErrors: jiraRequiredFields.map((field) => `Field "${field.name}" is required.`)
        });
        return;
      }

      if (bulkFailure) {
        updateSession({
          view: 'preview',
          previewBugIndex: bulkFailure.bugIndex,
          error: bulkFailure.jiraError || getErrorMessage(err),
        });
        return;
      }

      updateSession({ error: getErrorMessage(err) });
    } finally {
      submitBugsInFlightRef.current = false;
      updateSession({ loading: false });
    }
  }, [authToken, apiBase, buildIdempotencyKey, extractBulkSubmitFailure, getProjectRequestParams, parseJiraRequiredFieldErrors, refreshAuthToken, session.bugs, session.instanceUrl, session.issueData, session.jiraConnectionId, session.previewBugIndex, session.selectedIssueType, session.visibleFields, updateSession, validateBug]);

  const searchUsers = useCallback(async (query: string, bugIndex?: number, fieldId?: string) => {
    if (query.length < 2 || !session.jiraConnectionId) return;
    if (bugIndex !== undefined) handleUpdateBug(bugIndex, { isSearchingUsers: true, lastSearchedQuery: query });
    if (searchControllerRef.current) searchControllerRef.current.abort();
    searchControllerRef.current = new AbortController();

    try {
      const payload: JiraUserSearchRequestPayload = {
        jira_connection_id: session.jiraConnectionId,
        query,
        project_id: getProjectRequestParams().projectId,
        project_key: getProjectRequestParams().projectKey,
        issue_type_id: session.selectedIssueType?.id ?? null,
        field_id: fieldId || (bugIndex !== undefined ? session.bugs[bugIndex]?.activeUserSearchField ?? null : null),
      };
      const res = await apiRequest(`${apiBase}/jira/users/search`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        signal: searchControllerRef.current.signal,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        if (bugIndex !== undefined) handleUpdateBug(bugIndex, { userSearchResults: [], isSearchingUsers: false });
        return;
      }

      const results = await readJsonResponse<JiraUsersSearchResponsePayload>(res);

      if (bugIndex !== undefined) {
        handleUpdateBug(bugIndex, {
          userSearchResults: results,
          isSearchingUsers: false
        });
      }
      
      return results;
    } catch {
      if (bugIndex !== undefined) handleUpdateBug(bugIndex, { userSearchResults: [], isSearchingUsers: false });
    }
  }, [apiBase, authToken, getProjectRequestParams, refreshAuthToken, handleUpdateBug, session.bugs, session.jiraConnectionId, session.selectedIssueType]);

  const getSelectedBulkStories = useCallback((): BulkStory[] => {
    const selectedKeys = new Set(session.bulkSelectedStoryKeys || []);
    return (session.bulkStories || []).filter((story) => selectedKeys.has(story.key));
  }, [session.bulkSelectedStoryKeys, session.bulkStories]);

  const bulkFetchEpic = useCallback(async () => {
    if (!session.jiraConnectionId || !session.bulkEpicKey.trim()) {
      updateSession({ error: 'Enter an Epic key before fetching bulk stories.' });
      return;
    }

    updateSession({
      loading: true,
      error: null,
      success: null,
      bulkProgressMessage: `Fetching stories for ${session.bulkEpicKey.trim().toUpperCase()}...`,
      bulkProgressPercent: 5,
    });

    try {
      const result = await sendBulkWorkerMessage<BulkFetchResult>('BULK_FETCH', {
        jiraConnectionId: session.jiraConnectionId,
        epicKey: session.bulkEpicKey.trim().toUpperCase(),
        maxResults: 100,
      });
      updateSession({
        bulkEpicKey: result.epic_key,
        bulkStories: result.issues || [],
        bulkSelectedStoryKeys: (result.issues || []).map((story) => story.key),
        bulkEpicAttachments: result.epic_attachments || [],
        bulkProgressMessage: `Fetched ${(result.issues || []).length} stories from ${result.epic_key}.`,
        bulkProgressPercent: 100,
        success: `Fetched ${(result.issues || []).length} stories from ${result.epic_key}.`,
      });
    } catch (err) {
      updateSession({ error: getErrorMessage(err) });
    } finally {
      updateSession({ loading: false });
    }
  }, [sendBulkWorkerMessage, session.bulkEpicKey, session.jiraConnectionId, updateSession]);

  const bulkGenerateTests = useCallback(async () => {
    const stories = getSelectedBulkStories();
    if (!session.jiraConnectionId || !session.selectedIssueType?.id || stories.length === 0) {
      updateSession({ error: 'Select stories and an issue type before bulk test generation.' });
      return;
    }

    updateSession({ loading: true, error: null, success: null, bulkProgressMessage: 'Starting bulk test generation...', bulkProgressPercent: 0 });
    try {
      const { projectKey, projectId } = getProjectRequestParams();
      const res = await apiRequest(`${apiBase}/ai/bulk/test-cases`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({
        jira_connection_id: session.jiraConnectionId,
        stories,
        issue_type_id: session.selectedIssueType.id,
        issue_type_name: session.selectedIssueType.name,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        supporting_context: session.generationSupportingContext,
        })
      });
      if (!res.ok) {
        await throwApiErrorResponse(res, `Bulk test generation failed (${res.status})`);
      }
      const result = await readJsonResponse<{ results?: Array<{ storyKey?: string; ok?: boolean; result?: AITestCasesResponsePayload; error?: string }>; warnings?: string[] }>(res);

      const testCases = (result.results || []).flatMap((item) => {
        const storyKey = item.storyKey || 'Story';
        return (item.result?.test_cases || []).map((testCase) => ({
          ...normalizeFrontendTestCase(testCase),
          title: `[${storyKey}] ${testCase.title || 'Untitled test case'}`
        }));
      });
      const failures = (result.results || []).filter((item) => !item.ok);
      updateSession({
        testCases,
        bugs: [],
        mainWorkflow: testCases.length ? 'tests' : 'bulk',
        coverageScore: null,
        bulkProgressMessage: `Generated ${testCases.length} test cases across ${stories.length} stories.`,
        bulkProgressPercent: 100,
        success: (result.warnings || []).length
          ? (result.warnings || []).join(' ')
          : failures.length ? `Generated ${testCases.length} test cases. ${failures.length} stories failed.` : `Generated ${testCases.length} test cases.`,
      });
      fetchUsage();
    } catch (err) {
      updateSession({ error: getErrorMessage(err) });
    } finally {
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, fetchUsage, getProjectRequestParams, getSelectedBulkStories, normalizeFrontendTestCase, refreshAuthToken, session.generationSupportingContext, session.instanceUrl, session.jiraConnectionId, session.selectedIssueType, updateSession]);

  const bulkAnalyzeStories = useCallback(async () => {
    const stories = getSelectedBulkStories();
    if (!session.jiraConnectionId || !session.selectedIssueType?.id || stories.length === 0) {
      updateSession({ error: 'Select stories and an issue type before bulk analysis.' });
      return;
    }

    updateSession({ loading: true, error: null, success: null, bulkProgressMessage: 'Starting cross-story audit...', bulkProgressPercent: 0 });
    try {
      const { projectKey, projectId } = getProjectRequestParams();
      const res = await apiRequest(`${apiBase}/ai/bulk/analyze`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({
        jira_connection_id: session.jiraConnectionId,
        stories,
        issue_type_id: session.selectedIssueType.id,
        issue_type_name: session.selectedIssueType.name,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        })
      });
      if (!res.ok) {
        await throwApiErrorResponse(res, `Bulk analysis failed (${res.status})`);
      }
      const result = await readJsonResponse<GapAnalysisResponsePayload>(res);
      const bugs = (result.bugs || []).map(toFrontendBug);
      updateSession({
        bugs,
        testCases: [],
        mainWorkflow: bugs.length ? 'analysis' : 'bulk',
        coverageScore: typeof result.ac_coverage === 'number' ? result.ac_coverage : null,
        gapAnalysisSummary: normalizeGapAnalysisSummary(result.analysis_summary),
        bulkProgressMessage: `Cross-story audit produced ${bugs.length} findings.`,
        bulkProgressPercent: 100,
        success: result.warnings?.length ? result.warnings.join(' ') : `Cross-story audit produced ${bugs.length} findings.`,
      });
      fetchUsage();
    } catch (err) {
      updateSession({ error: getErrorMessage(err) });
    } finally {
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, fetchUsage, getProjectRequestParams, getSelectedBulkStories, normalizeGapAnalysisSummary, refreshAuthToken, session.instanceUrl, session.jiraConnectionId, session.selectedIssueType, toFrontendBug, updateSession]);

  const bulkCompareBrd = useCallback(async () => {
    const stories = getSelectedBulkStories();
    if (!session.jiraConnectionId || !session.selectedIssueType?.id || stories.length === 0 || !session.bulkBrdText.trim()) {
      updateSession({ error: 'Add BRD text and select stories before comparing.' });
      return;
    }

    updateSession({ loading: true, error: null, success: null, bulkProgressMessage: 'Starting BRD comparison...', bulkProgressPercent: 0 });
    try {
      const { projectKey, projectId } = getProjectRequestParams();
      const res = await apiRequest(`${apiBase}/ai/bulk/brd-compare`, {
        method: 'POST',
        token: authToken,
        onUnauthorized: refreshAuthToken,
        body: JSON.stringify({
        jira_connection_id: session.jiraConnectionId,
        stories,
        brd_text: session.bulkBrdText,
        issue_type_id: session.selectedIssueType.id,
        issue_type_name: session.selectedIssueType.name,
        instance_url: session.instanceUrl,
        project_key: projectKey,
        project_id: projectId,
        })
      });
      if (!res.ok) {
        await throwApiErrorResponse(res, `BRD comparison failed (${res.status})`);
      }
      const result = await readJsonResponse<GapAnalysisResponsePayload>(res);
      const bugs = (result.bugs || []).map(toFrontendBug);
      updateSession({
        bugs,
        testCases: [],
        mainWorkflow: bugs.length ? 'analysis' : 'bulk',
        coverageScore: typeof result.ac_coverage === 'number' ? result.ac_coverage : null,
        gapAnalysisSummary: normalizeGapAnalysisSummary(result.analysis_summary),
        bulkProgressMessage: `BRD comparison produced ${bugs.length} findings.`,
        bulkProgressPercent: 100,
        success: result.warnings?.length ? result.warnings.join(' ') : `BRD comparison produced ${bugs.length} findings.`,
      });
      fetchUsage();
    } catch (err) {
      updateSession({ error: getErrorMessage(err) });
    } finally {
      updateSession({ loading: false });
    }
  }, [apiBase, authToken, fetchUsage, getProjectRequestParams, getSelectedBulkStories, normalizeGapAnalysisSummary, refreshAuthToken, session.bulkBrdText, session.instanceUrl, session.jiraConnectionId, session.selectedIssueType, toFrontendBug, updateSession]);

  const bulkLoadAttachmentAsBrd = useCallback(async (attachmentId: string) => {
    if (!session.jiraConnectionId || !attachmentId) return;

    updateSession({ loading: true, error: null, success: null, bulkProgressMessage: 'Fetching Epic attachment...', bulkProgressPercent: 20 });
    try {
      const result = await sendBulkWorkerMessage<{
        attachmentId: string;
        contentType: string;
        filename: string;
        content: string;
      }>('FETCH_ATTACHMENT', {
        jiraConnectionId: session.jiraConnectionId,
        attachmentId,
      });

      const text = (result.content || '').trim();
      if (!text) {
        throw new Error('The selected attachment did not contain readable text.');
      }
      updateSession({
        bulkBrdText: text,
        bulkProgressMessage: `${result.filename || 'Attachment'} loaded into BRD compare.`,
        bulkProgressPercent: 100,
        success: `${result.filename || 'Attachment'} loaded into BRD compare.`,
      });
    } catch (err) {
      updateSession({ error: getErrorMessage(err) });
    } finally {
      updateSession({ loading: false });
    }
  }, [sendBulkWorkerMessage, session.jiraConnectionId, updateSession]);

  const value = useMemo(() => ({
    usage, fetchUsage,
    customModel, setCustomModel,
    customKey, setCustomKey,
    hasCustomKeySaved, setHasCustomKeySaved,
    clearCustomKeyRequested, setClearCustomKeyRequested,
    fetchAISettings,
    generateBugs,
    generateTestCases,
    handleManualGenerate,
    submitBugs,
    regenerateBug,
    searchUsers,
    handleUpdateBug,
    handleUpdateTestCase,
    publishTestCasesToXray,
    bulkFetchEpic,
    bulkGenerateTests,
    bulkAnalyzeStories,
    bulkCompareBrd,
    bulkLoadAttachmentAsBrd,
    validateBug,
    preparePreviewBug,
    checkDuplicates,
    linkToExisting,
  }), [usage, fetchUsage, customModel, customKey, hasCustomKeySaved, clearCustomKeyRequested, fetchAISettings, generateBugs, generateTestCases, handleManualGenerate, submitBugs, regenerateBug, searchUsers, handleUpdateBug, handleUpdateTestCase, publishTestCasesToXray, bulkFetchEpic, bulkGenerateTests, bulkAnalyzeStories, bulkCompareBrd, bulkLoadAttachmentAsBrd, validateBug, preparePreviewBug, checkDuplicates, linkToExisting]);

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
};
