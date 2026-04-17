import { useState, useRef } from 'react';
import { TabSession, BugReport, Usage, INITIAL_SESSION } from '../types';
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

  const fetchUsage = async () => {
    if (!authToken) return;
    try {
      const res = await apiRequest(`${apiBase}/bugs/usage`, { token: authToken });
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      }
    } catch (err: any) {
      logDebug('USAGE-ERR', err.message);
    }
  };

  const fetchAISettings = async () => {
    updateSession({ loading: true });
    try {
      const res = await apiRequest(`${apiBase}/settings/ai`, { token: authToken });
      const data = await res.json();
      setCustomModel(data.custom_model || '');
      setHasCustomKeySaved(data.has_custom_key);
    } catch (err: any) {
      logDebug('AI-SETTINGS-ERR', err.message);
      const translated = translateError(err, 'settings');
      updateSession({ error: translated.description });
    } finally { updateSession({ loading: false }); }
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
    
    updateSession({ loading: true, error: null, bugs: [] });
    logDebug('AI-START', `Analyzing ${session.issueData.key}`);

    try {
      const res = await apiRequest(`${apiBase}/bugs/generate`, {
        method: 'POST',
        token: authToken,
        onDebug: logDebug,
        body: JSON.stringify({
          issue_key: session.issueData.key,
          summary: session.issueData.summary,
          description: session.issueData.description,
          acceptance_criteria: session.issueData.acceptanceCriteria
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "AI Analysis failed");
      updateSession({ bugs: data }, currentTabId);
      logDebug('AI-OK', `Generated ${data.length} reports for tab ${currentTabId}`);
      fetchUsage();
    } catch (err: any) {
      logDebug('AI-ERR', err.message);
      const translated = translateError(err, 'ai-analysis');
      updateSession({ error: translated.description }, currentTabId);
    } finally {
      updateSession({ loading: false }, currentTabId);
    }
  };

  const handleManualGenerate = async () => {
    if (!session.manualDesc.trim()) return;
    updateSession({ loading: true, error: null });
    logDebug('MANUAL-START', 'Structuring manual description...');
    try {
      const res = await apiRequest(`${apiBase}/bugs/generate/manual`, {
        method: 'POST',
        token: authToken,
        onDebug: logDebug,
        body: JSON.stringify({
          description: session.manualDesc,
          issue_key: session.issueData?.key || 'MANUAL',
          jira_context: session.issueData ? `${session.issueData.summary}\n${session.issueData.description}` : undefined
        })
      });
      
      const rawBody = await res.text();
      if (!res.ok) throw new Error(rawBody || "Manual processing failed");
      
      const newBug: BugReport = { ...JSON.parse(rawBody), extra_fields: {} };
      logDebug('MANUAL-SUCCESS', `Structured: ${newBug.summary}`);
      const existingBugs = session.bugs || [];
      updateSession({ 
        bugs: [...existingBugs, newBug],
        manualDesc: '',
        showManualInput: false,
        expandedBug: existingBugs.length
      });

      fetchUsage();
    } catch (err: any) {
      logDebug('MANUAL-CRASH', err.message);
      const translated = translateError(err, 'ai-manual');
      updateSession({ error: translated.description });
    } finally {
      updateSession({ loading: false });
    }
  };

  const submitBugs = async () => {
    const bugs = session.bugs || [];
    if (!session.issueData || !bugs.length) return;
    
    updateSession({ loading: true, error: null });
    try {
      const pKey = session.issueData.key.split('-')[0];
      
      const res = await apiRequest(`${apiBase}/bugs/submit/batch`, {
        method: 'POST',
        token: authToken,
        onDebug: logDebug,
        body: JSON.stringify({
          issue_key: session.issueData.key,
          project_key: pKey,
          project_id: session.issueData.projectId,
          base_url: session.instanceUrl,
          bugs: bugs
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Submission failed");
      
      updateSession({ 
        view: 'success',
        createdIssues: data.issues || []
      });
      logDebug('SUBMIT-OK', `Batch of ${data.created_count || (session.bugs || []).length} pushed to Jira`);
    } catch (err: any) {
      logDebug('SUBMIT-ERR', err.message);
      const translated = translateError(err, 'jira-submit');
      updateSession({ error: translated.description });
    } finally {
      updateSession({ loading: false });
    }
  };

  const searchUsers = async (query: string, baseUrl: string, projectId?: string, projectKey?: string, bugIndex?: number) => {
    if (query.length < 2) return;

    if (bugIndex !== undefined) {
      handleUpdateBug(bugIndex, { 
        isSearchingUsers: true,
        lastSearchedQuery: query 
      });
    }

    if (searchControllerRef.current) {
      logDebug('SEARCH-ABORT', 'Aborting previous search request...');
      searchControllerRef.current.abort();
    }
    searchControllerRef.current = new AbortController();

    try {
      let url = `${apiBase}/jira/users/search?project_key=${projectId || projectKey || ''}&query=${encodeURIComponent(query)}&base_url=${encodeURIComponent(baseUrl)}`;
      if (projectId) url += `&project_id=${projectId}`;
      
      const res = await apiRequest(url, { 
        token: authToken,
        signal: searchControllerRef.current.signal
      });
      if (res.ok) {
        const users = await res.json();
        if (bugIndex !== undefined) {
          handleUpdateBug(bugIndex, { 
            userSearchResults: users,
            isSearchingUsers: false 
          });
          return;
        }
      }
    } catch (err: any) {
      logDebug('SEARCH-ERR', `User search failed: ${err.message || 'Unknown error'}`);
    } finally {
      if (bugIndex !== undefined) {
        handleUpdateBug(bugIndex, { isSearchingUsers: false });
      }
    }
  };

  return {
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
  };
}
