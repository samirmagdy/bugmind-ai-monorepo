import React, { useEffect, useRef } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { 
  Plus, ChevronDown, 
  Loader2, X, Send, AlertCircle, Zap, RefreshCw,
  Compass, ArrowRight, Check, Layout
} from 'lucide-react';
import { BugReport, JiraField, TestCase } from '../../types';
import AutoResizeTextarea from '../common/AutoResizeTextarea';
import { ActionButton } from '../common/DesignSystem';
import LuxurySearchableSelect from '../common/LuxurySearchableSelect';
import { TIMEOUTS } from '../../constants';

const HIDDEN_SYSTEM_FIELD_KEYS = new Set([
  'summary',
  'description',
  'project',
  'issuetype'
]);

type SelectDisplayValue = {
  id?: string | number;
  name?: string;
  value?: string;
  label?: string;
  avatar?: string;
};

function isSystemManagedField(field: JiraField): boolean {
  const normalizedKey = field.key.trim().toLowerCase().replace(/[_-]/g, '');
  const normalizedSystem = (field.system || '').trim().toLowerCase();

  return (
    HIDDEN_SYSTEM_FIELD_KEYS.has(field.key.trim().toLowerCase()) ||
    ['summary', 'description', 'project', 'issuetype'].includes(normalizedSystem) ||
    ['projectid', 'issuetypeid', 'pid', 'typeid'].includes(normalizedKey)
  );
}

function hasDisplayLabel(value: unknown): value is SelectDisplayValue {
  return typeof value === 'object' && value !== null && (
    'name' in value ||
    'value' in value ||
    'label' in value
  );
}

function mergeDisplayValue(currentValue: unknown, fallbackValue: unknown): unknown {
  if (Array.isArray(currentValue) && Array.isArray(fallbackValue)) {
    return currentValue.map((item) => {
      if (hasDisplayLabel(item) || typeof item !== 'object' || item === null || !('id' in item)) return item;
      const match = fallbackValue.find((fallbackItem) =>
        typeof fallbackItem === 'object' &&
        fallbackItem !== null &&
        'id' in fallbackItem &&
        fallbackItem.id === item.id
      );
      return match && typeof match === 'object' ? { ...match, ...item } : item;
    });
  }

  if (
    typeof currentValue === 'object' &&
    currentValue !== null &&
    'id' in currentValue &&
    !hasDisplayLabel(currentValue) &&
    typeof fallbackValue === 'object' &&
    fallbackValue !== null &&
    'id' in fallbackValue &&
    fallbackValue.id === currentValue.id
  ) {
    return { ...fallbackValue, ...currentValue };
  }

  return currentValue;
}

const MainView: React.FC = () => {
  const { 
    session, updateSession, currentTabId, refreshIssue, debug, handleTabReload,
    jira,
    ai: { 
      generateBugs, generateTestCases, handleManualGenerate, 
      handleUpdateBug, handleUpdateTestCase, publishTestCasesToXray, 
      searchUsers, preparePreviewBug 
    } 
  } = useBugMind();
  const { log } = debug;
  const isRecoveringStalePage = session.error === 'STALE_PAGE' && !session.issueData;
  const staleRecoveryAttemptsRef = useRef(0);

  const bootstrapJiraConfig = async (issueTypeId?: string, options?: { force?: boolean; loading?: boolean; logTag?: string; errorMessage?: string }) => {
    const projectKey = session.issueData?.key.split('-')[0];
    if (!projectKey || !session.instanceUrl || !session.issueData) return null;

    const force = options?.force ?? true;
    const showLoading = options?.loading ?? false;

    if (showLoading) {
      updateSession({ loading: true }, currentTabId);
    }

    if (options?.logTag) {
      log(options.logTag, `Bootstrapping Jira config for ${projectKey}${issueTypeId ? ` (${issueTypeId})` : ''}`);
    }

    try {
      return await jira.bootstrapContext({
        instanceUrl: session.instanceUrl,
        issueKey: session.issueData.key,
        projectKey,
        projectId: session.jiraMetadata?.project_id || session.issueData.projectId,
        issueTypeId,
        tabId: currentTabId,
        force
      });
    } catch {
      if (options?.errorMessage) {
        updateSession({ error: options.errorMessage }, currentTabId);
      }
      return null;
    } finally {
      if (showLoading) {
        updateSession({ loading: false }, currentTabId);
      }
    }
  };

  useEffect(() => {
    if (!isRecoveringStalePage) {
      staleRecoveryAttemptsRef.current = 0;
      return;
    }

    if (staleRecoveryAttemptsRef.current >= 3) {
      return;
    }

    staleRecoveryAttemptsRef.current += 1;
    const attemptNumber = staleRecoveryAttemptsRef.current;
    const delay = attemptNumber === 1 ? 0 : 2000;

    const timer = window.setTimeout(() => {
      log('STALE-RECOVER', `Automatic Jira recovery attempt ${attemptNumber}/3`);
      refreshIssue(true);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isRecoveringStalePage, log, refreshIssue]);

  // Trigger user search when query changes with 400ms debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      (session.bugs || []).forEach((bug: BugReport, idx: number) => {
        const q = bug.userSearchQuery || '';
        // Only trigger search if query is 2+ chars, we're not already searching, and it's a NEW query
        if (q.length >= 2 && bug.activeUserSearchField && !bug.isSearchingUsers && q !== bug.lastSearchedQuery) {
          if (session.instanceUrl) {
            const logTag = `SEARCH-${idx}`;
            debug.log(logTag, `Debounce passed. Searching for "${q}"...`);
            searchUsers(q, idx);
          }
        }
      });
    }, TIMEOUTS.USER_SEARCH_DEBOUNCE);

    return () => clearTimeout(timer);
  }, [session.bugs, session.instanceUrl, session.issueData, debug, searchUsers]);

  useEffect(() => {
    if (!session.testCases.length || !session.jiraConnectionId || session.xrayProjects.length > 0) return;

    let cancelled = false;
    jira.fetchXrayDefaults(session.jiraConnectionId, session.issueData?.key || undefined).then(defaults => {
      if (cancelled || !defaults) return;
      updateSession({
        xrayProjects: defaults.projects || [],
        xrayTargetProjectId: session.xrayTargetProjectId || defaults.target_project_id || null,
        xrayTargetProjectKey: session.xrayTargetProjectKey || defaults.target_project_key || null,
        xrayFolderPath: session.xrayFolderPath || defaults.folder_path || session.issueData?.key || '',
        xrayTestIssueTypeName: session.xrayTestIssueTypeName || defaults.test_issue_type_name || 'Test',
        xrayLinkType: session.xrayLinkType || defaults.link_type || 'Tests',
        xrayRepositoryPathFieldId: session.xrayRepositoryPathFieldId || defaults.repository_path_field_id || '',
        xrayPublishSupported: defaults.publish_supported ?? true,
        xrayPublishMode: defaults.publish_mode || 'jira_server',
        xrayUnsupportedReason: defaults.unsupported_reason || null
      });
    });

    return () => {
      cancelled = true;
    };
  }, [jira, session.issueData?.key, session.jiraConnectionId, session.testCases.length, session.xrayFolderPath, session.xrayLinkType, session.xrayProjects.length, session.xrayRepositoryPathFieldId, session.xrayTargetProjectId, session.xrayTargetProjectKey, session.xrayTestIssueTypeName, updateSession]);

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {/* Issue Context Card */}
      <div className="context-card relative group animate-in slide-in-from-top-4 duration-700">
        <div className="absolute top-4 right-4">
          <button 
            onClick={() => refreshIssue()} 
            title="Refresh Context"
            className={`p-1.5 text-[var(--text-muted)] hover:text-[var(--primary-blue)] transition-colors ${session.loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <RefreshCw size={14} className={session.loading ? 'animate-spin' : ''} /> 
          </button>
        </div>

        {session.issueData ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="connected-badge">
                <div className="w-1 h-1 rounded-full bg-[var(--success)] animate-pulse" />
                Connected
              </span>
              <span className="text-[var(--text-muted)] text-[11px] font-bold">{session.issueData.key}</span>
            </div>
            <h2 className="text-[13px] font-bold text-[var(--text-primary)] leading-tight pr-7">
              {session.issueData.summary}
            </h2>
            <div className="context-row pt-2.5 mt-1 border-t border-[var(--border-soft)]">
              <div className="col-span-2">
                <div className="context-label uppercase tracking-wider mb-0.5">Project</div>
                <div className="context-value">{session.issueData.key.split('-')[0]}</div>
              </div>
              <div className="col-span-2">
                <div className="context-label uppercase tracking-wider mb-0.5">Issue Type</div>
                <div className="context-value">{session.issueData.typeName || 'Story'}</div>
              </div>
            </div>
          </div>
        ) : session.error === 'STALE_PAGE' ? (
          <div className="space-y-4 py-1">
            <div className="flex items-center gap-2 text-[var(--primary-blue)] font-bold text-[12px]">
              <Loader2 size={16} className="animate-spin" />
              Reconnecting to Jira...
            </div>
            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
              BugMind is re-scanning the open Jira tab. This will update as soon as the issue context is available.
            </p>
            <div className="flex gap-2">
              <ActionButton 
                onClick={() => refreshIssue(true)}
                variant="secondary"
                className="flex-1 h-9 text-xs"
              >
                Retry Now
              </ActionButton>
              <ActionButton 
                onClick={() => handleTabReload()} 
                variant="secondary"
                className="flex-1 h-9 text-xs"
              >
                Reload Tab
              </ActionButton>
            </div>
          </div>
        ) : session.error === 'NOT_A_JIRA_PAGE' ? (
          <div className="space-y-4 py-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] flex items-center justify-center text-[var(--primary-blue)]">
                <Compass size={18} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[var(--text-primary)]">Awaiting Context</h4>
                <p className="text-xs text-[var(--text-secondary)]">Open a Jira ticket to begin analysis.</p>
              </div>
            </div>
            
            <ActionButton 
              onClick={() => window.open('https://atlassian.net', '_blank')}
              variant="primary"
              className="h-10 text-xs"
            >
              Open Jira 
              <ArrowRight size={14} />
            </ActionButton>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <Loader2 className="animate-spin text-[var(--primary-blue)]/40" size={24} />
            <span className="text-xs font-medium text-[var(--text-muted)]">Hunting for context...</span>
          </div>
        )}
      </div>


      {/* Action/List Section */}
      {session.error === 'NOT_A_JIRA_PAGE' ? null : (
        <div className="relative overflow-y-auto flex-1 pt-1 pb-2">
          {/* Locked State Overlay */}
          {session.error === 'UNSUPPORTED_ISSUE_TYPE' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-8 p-3 animate-in fade-in zoom-in slide-in-from-top-3 duration-700">
              <div className="context-card rounded-[1.75rem] p-4 shadow-[var(--shadow-card)] border-[var(--status-warning)]/20 space-y-4 text-center max-w-[260px] relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--status-warning)]/40 to-transparent"></div>
                <div className="w-8 h-8 bg-[var(--status-warning)]/10 rounded-xl flex items-center justify-center text-[var(--status-warning)] mx-auto shadow-inner border border-[var(--status-warning)]/10">
                  <AlertCircle size={20} />
                </div>
                <div className="space-y-1.5">
                  <h4 className="text-xs font-black text-[var(--text-main)] tracking-tight">Requirement Focus</h4>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed px-2">
                    BugMind is designed for **User Stories**. 
                    This issue is identified as a <span className="text-[var(--status-warning)] font-black">{session.issueData?.typeName || 'Other'}</span>.
                  </p>
                </div>
                <button 
                  onClick={() => refreshIssue(true)}
                  className="w-full bg-[var(--text-main)] text-white text-[10px] font-black py-2.5 rounded-[1rem] shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest"
                >
                  <RefreshCw size={12} />
                  Re-Scan Issue
                </button>
              </div>
            </div>
          )}

          {session.error === 'NO_ISSUE_TYPES_FOUND' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-12 p-3 animate-in fade-in zoom-in slide-in-from-top-3 duration-700">
              <div className="context-card rounded-[2rem] p-4 shadow-[var(--shadow-card)] border-[var(--status-danger)]/20 space-y-5 text-center max-w-[300px] relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--status-danger)]/40 to-transparent"></div>
                <div className="w-8 h-8 bg-[var(--status-danger)]/10 rounded-xl flex items-center justify-center text-[var(--status-danger)] mx-auto shadow-inner border border-[var(--status-danger)]/10">
                  <AlertCircle size={28} />
                </div>
                <div className="space-y-2">
                  <h4 className="text-base font-black text-[var(--text-main)] tracking-tight">Permission Restriction</h4>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed px-2">
                    Jira returned **0 accessible issue types** for this instance. This usually means the API Token used does not have permissions to view projects.
                  </p>
                </div>
                <button 
                  onClick={() => updateSession({ view: 'setup' })}
                  className="w-full bg-[var(--primary-gradient)] text-white text-[10px] font-black py-2.5 rounded-[1rem] shadow-[var(--shadow-button)] transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest"
                >
                  <RefreshCw size={12} />
                  Check Jira Connection
                </button>
              </div>
            </div>
          )}

          <div className={`transition-all duration-700 ${['UNSUPPORTED_ISSUE_TYPE', 'NO_ISSUE_TYPES_FOUND'].includes(session.error || '') ? 'blur-md grayscale opacity-30 pointer-events-none pt-4' : ''}`}>
            {(!session.bugs || session.bugs.length === 0) && (!session.testCases || session.testCases.length === 0) ? (
              <div className="space-y-4">
                <div className="empty-state-card animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <div className="empty-icon">
                    <Zap size={28} />
                  </div>
                  <h3 className="empty-title">Ready for Analysis</h3>
                  <p className="empty-description">
                    BugMind will analyze the story and criteria to uncover hidden requirements and potential functional gaps.
                  </p>

                  <div className="mt-6 space-y-3 text-left">
                    <div>
                      <label className="context-label uppercase tracking-wider mb-1.5 block ml-1">Analysis Context</label>
                      <LuxurySearchableSelect
                        options={session.issueTypes.map(t => ({ id: t.id, name: t.name, avatar: t.icon_url }))}
                        value={session.selectedIssueType}
                        placeholder="Select issue type..."
                        onChange={(type: any) => {
                          if (type && session.jiraConnectionId && session.issueData) {
                            updateSession({ selectedIssueType: type, jiraMetadata: null });
                            void bootstrapJiraConfig(type.id, { force: true, loading: true, logTag: 'MAIN-TYPE-SWITCH' });
                          }
                        }}
                      />
                    </div>

                    <div className="pt-2 space-y-2.5">
                      <ActionButton 
                        onClick={generateBugs}
                        variant="primary"
                        className="h-11 text-[13px]"
                        disabled={!session.issueData || !session.selectedIssueType?.id || session.issueTypes.length === 0}
                      >
                        <Zap size={16} />
                        Run Gap Analysis
                      </ActionButton>

                      <ActionButton 
                        onClick={generateTestCases}
                        variant="secondary"
                        className="h-11 w-full text-[13px]"
                        disabled={!session.issueData || !session.selectedIssueType?.id || session.issueTypes.length === 0}
                      >
                        <Check size={16} />
                        Generate Test Cases
                      </ActionButton>
                    </div>
                    
                    {(!session.selectedIssueType?.id || session.issueTypes.length === 0) && (
                      <div className="flex items-center justify-center gap-2 mt-4 text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider">
                        <Loader2 size={10} className="animate-spin" />
                        Fetching project metadata...
                      </div>
                    )}
                  </div>
                </div>

                {!session.showManualInput ? (
                  <div 
                    onClick={() => updateSession({ showManualInput: true })}
                    className="workflow-card flex items-center gap-3 group"
                  >
                    <div className="w-9 h-9 rounded-[1rem] bg-[var(--surface-accent)] flex items-center justify-center text-[var(--primary-purple)] group-hover:bg-[var(--primary-purple)] group-hover:text-white transition-colors shrink-0">
                      <Plus size={18} />
                    </div>
                    <div>
                      <h4 className="workflow-card-title text-[14px]">Add manual finding</h4>
                      <p className="workflow-card-subtitle">Register bug notes in plain English</p>
                    </div>
                  </div>
                ) : (
                  <div className="flow-screen space-y-4 animate-in slide-in-from-bottom-2">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <div className="step-badge">AI</div>
                        <h4 className="text-sm font-bold">Manual Entry</h4>
                      </div>
                      <button onClick={() => updateSession({ showManualInput: false })} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                        <X size={16} />
                      </button>
                    </div>
                    <AutoResizeTextarea 
                      className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] p-3 text-sm outline-none focus:border-[var(--border-active)] min-h-[100px]"
                      placeholder="Describe the issue... We'll structure it for Jira."
                      value={session.manualDesc}
                      onChange={e => updateSession({ manualDesc: e.target.value })}
                    />
                    <ActionButton 
                      onClick={() => handleManualGenerate()}
                      variant="primary"
                      disabled={session.loading || !session.manualDesc.trim()}
                    >
                      <Zap size={16} />
                      Synthesize Findings
                    </ActionButton>
                  </div>
                )}
              </div>
                  ) : session.testCases && session.testCases.length > 0 ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">{session.testCases.length} Test Assets</h3>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => updateSession({ testCases: [], coverageScore: null, error: null, createdIssues: [], xrayWarnings: [] })} 
                      className="text-xs font-bold text-[var(--error)]"
                    >
                      Clear
                    </button>
                    <button 
                      onClick={generateTestCases} 
                      className="text-xs font-bold text-[var(--primary-blue)]"
                    >
                      Retry
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {session.testCases.map((testCase: TestCase, idx: number) => (
                    <div key={`${testCase.title}-${idx}`} className="workflow-card space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Test Case {idx + 1}</span>
                        <input
                          value={testCase.priority}
                          onChange={e => handleUpdateTestCase(idx, { priority: e.target.value })}
                          className="w-20 bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.85rem] px-2 py-1 text-[10px] font-bold text-[var(--primary-blue)] text-right"
                        />
                      </div>
                      <AutoResizeTextarea
                        value={testCase.title}
                        onChange={e => handleUpdateTestCase(idx, { title: e.target.value })}
                        className="w-full bg-transparent border-none p-0 text-sm font-bold text-[var(--text-primary)] outline-none"
                      />
                      <div className="space-y-1.5">
                        <label className="context-label uppercase tracking-widest block">Steps</label>
                        <AutoResizeTextarea
                          value={testCase.steps.join('\n')}
                          onChange={e => handleUpdateTestCase(idx, {
                            steps: e.target.value
                              .split('\n')
                              .map(step => step.trim())
                              .filter(Boolean)
                          })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="context-label uppercase tracking-widest block">Expected Result</label>
                        <AutoResizeTextarea
                          value={testCase.expected_result}
                          onChange={e => handleUpdateTestCase(idx, { expected_result: e.target.value })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flow-screen space-y-4 mt-8">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-[0.9rem] bg-[var(--bg-input)] flex items-center justify-center text-[var(--primary-blue)] border border-[var(--border-soft)]">
                      <Send size={16} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold">Publish to Xray</h4>
                      <p className="text-[11px] text-[var(--text-muted)]">Link to {session.issueData?.key} and repository folder.</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="context-label uppercase tracking-wider block ml-1">Xray Project</label>
                      <LuxurySearchableSelect
                        options={session.xrayProjects.map(p => ({ id: p.id, name: `${p.key} · ${p.name}` }))}
                        value={session.xrayTargetProjectId ? { id: session.xrayTargetProjectId } : null}
                        placeholder="Select target project..."
                        onChange={(next: any) => {
                          const project = session.xrayProjects.find(item => item.id === next?.id);
                          updateSession({
                            xrayTargetProjectId: project?.id || null,
                            xrayTargetProjectKey: project?.key || null
                          });
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="context-label uppercase tracking-wider block ml-1">Repository Folder</label>
                        <input
                          value={session.xrayFolderPath}
                          onChange={e => updateSession({ xrayFolderPath: e.target.value })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] px-3 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                          placeholder={session.issueData?.key || 'STORY-123'}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="context-label uppercase tracking-wider block ml-1">Issue Type</label>
                        <input
                          value={session.xrayTestIssueTypeName}
                          onChange={e => updateSession({ xrayTestIssueTypeName: e.target.value })}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] px-3 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                          placeholder="Test"
                        />
                      </div>
                    </div>
                  </div>

                  {session.createdIssues.length > 0 && (
                    <div className="rounded-xl bg-[var(--success-bg)] p-3 border border-[var(--success)]/20 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--success)]">Published Tests</div>
                      <div className="flex flex-wrap gap-2">
                        {session.createdIssues.map(issue => (
                          <span key={issue.key} className="px-2 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-soft)] text-[11px] font-bold text-[var(--text-primary)]">
                            {issue.key}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {session.xrayWarnings.length > 0 && (
                    <div className="warning-card space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider">Publish Warnings</div>
                      <div className="text-[11px]">
                        {session.xrayWarnings.map((warning, idx) => (
                          <div key={`${warning}-${idx}`}>{warning}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!session.xrayPublishSupported && session.xrayUnsupportedReason && (
                    <div className="error-card text-xs">
                      {session.xrayUnsupportedReason}
                    </div>
                  )}

                  <ActionButton
                    onClick={publishTestCasesToXray}
                    disabled={!session.xrayTargetProjectId || session.testCases.length === 0 || session.loading || !session.xrayPublishSupported}
                    variant="primary"
                  >
                    <Send size={16} />
                    Publish Selected to Xray
                  </ActionButton>
                </div>
              </div>            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">{(session.bugs || []).length} Analysis Findings</h3>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => updateSession({ bugs: [], testCases: [], coverageScore: null, error: null })} 
                      className="text-xs font-bold text-[var(--error)]"
                    >
                      Clear
                    </button>
                    <button 
                      onClick={generateBugs} 
                      className="text-xs font-bold text-[var(--primary-blue)]"
                    >
                      Retry
                    </button>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {(session.bugs || []).map((bug: BugReport, idx: number) => (
                    <div key={idx} className="workflow-card">
                      <div 
                        onClick={() => updateSession({ expandedBug: session.expandedBug === idx ? null : idx })}
                        className="flex items-start gap-3 cursor-pointer"
                      >
                        <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                          bug.severity === 'Critical' ? 'bg-[var(--error)] shadow-[0_0_8px_var(--error)]' : 
                          bug.severity === 'High' ? 'bg-[var(--warning)]' : 'bg-[var(--primary-blue)]'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="workflow-card-title text-sm">{bug.summary}</div>
                          <div className="workflow-card-subtitle text-[11px] font-bold uppercase tracking-wider">{bug.severity} Risk</div>
                        </div>
                        <ChevronDown 
                          size={16} 
                          className={`text-[var(--text-muted)] transition-transform duration-300 ${session.expandedBug === idx ? 'rotate-180' : ''}`} 
                        />
                      </div>
                      
                      {session.expandedBug === idx && (
                        <div className="mt-4 pt-4 border-t border-[var(--border-soft)] space-y-4 animate-in slide-in-from-top-2">
                          <div className="space-y-1.5">
                            <label className="context-label uppercase tracking-widest block">Summary</label>
                            <AutoResizeTextarea 
                              value={bug.description}
                              onChange={e => handleUpdateBug(idx, { description: e.target.value })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="context-label uppercase tracking-widest block">Steps to Reproduce</label>
                            <AutoResizeTextarea 
                              value={bug.steps_to_reproduce}
                              onChange={e => handleUpdateBug(idx, { steps_to_reproduce: e.target.value })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] font-mono outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Expected</label>
                              <AutoResizeTextarea 
                                value={bug.expected_result}
                                onChange={e => handleUpdateBug(idx, { expected_result: e.target.value })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Actual</label>
                              <AutoResizeTextarea 
                                value={bug.actual_result}
                                onChange={e => handleUpdateBug(idx, { actual_result: e.target.value })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                              />
                            </div>
                          </div>

                          {/* Dynamic Jira Fields */}
                          {(() => {
                            const metadataFields = (session.jiraMetadata?.fields || []).filter((field: JiraField) => !isSystemManagedField(field));
                            const visibleKeys = session.visibleFields || [];
                            const requiredKeys = metadataFields.filter(f => f.required).map(f => f.key);
                            const allVisibleKeys = Array.from(new Set([...visibleKeys, ...requiredKeys]));
                            
                            if (allVisibleKeys.length === 0) return null;

                            return (
                              <div className="pt-2 space-y-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 bg-[var(--primary-blue)] rounded-full" />
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Issue Metadata</span>
                                </div>
                                <div className="space-y-3">
                                  {allVisibleKeys.map((fieldKey: string) => {
                                    const field = metadataFields.find((f: JiraField) => f.key === fieldKey);
                                    if (!field) return null;

                                    const isMulti = field.type === 'array' || field.type === 'multi-select';
                                    const currentVal = mergeDisplayValue(
                                      bug.extra_fields?.[fieldKey],
                                      session.fieldDefaults?.[fieldKey]
                                    );

                                    return (
                                      <div key={fieldKey} className="space-y-1">
                                        <label className="context-label lowercase font-bold ml-1">
                                          {field.name} {field.required && <span className="text-[var(--error)]">*</span>}
                                        </label>
                                        <LuxurySearchableSelect 
                                          isMulti={isMulti}
                                          options={(field.allowed_values || []) as any[]}
                                          value={currentVal}
                                          placeholder={field.type.includes('user') ? "Search users..." : (isMulti ? `Add ${field.name}...` : `Select ${field.name}...`)}
                                          required={field.required}
                                          allowCustomValues={field.type === 'labels' || field.type === 'array'}
                                          onSearchAsync={field.type.includes('user') ? async (q) => {
                                            const results = await searchUsers(q, undefined, field.key);
                                            return (results || []) as any[];
                                          } : undefined}
                                          onChange={(next) => {
                                            let finalVal = next;
                                            if (field.type === 'option' || field.type === 'multi-select' || field.type === 'priority' || field.type === 'user' || field.type === 'multi-user') {
                                              const toStoredOption = (value: any) => {
                                                if (typeof value === 'object' && value !== null) {
                                                  return {
                                                    id: value.id,
                                                    name: value.name,
                                                    value: value.value,
                                                    label: value.label,
                                                    avatar: value.avatar
                                                  };
                                                }
                                                return { id: value };
                                              };

                                              if (isMulti) {
                                                finalVal = (next as any[]).map(toStoredOption);
                                              } else {
                                                finalVal = toStoredOption(next);
                                              }
                                            }
                                            handleUpdateBug(idx, { 
                                              extra_fields: { ...(bug.extra_fields || {}), [fieldKey]: finalVal } 
                                            });
                                          }}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                          <div className="flex items-center justify-between pt-2">
                            <div className="flex items-center gap-1.5 text-[var(--success)]">
                              <Check size={12} />
                              <span className="text-[10px] font-bold uppercase tracking-tighter">Synced to context</span>
                            </div>
                            <button onClick={() => updateSession({ expandedBug: null })} className="text-[10px] font-bold text-[var(--primary-blue)] hover:opacity-80">
                              Close Editor
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="pt-4">
                  <ActionButton 
                    onClick={() => {
                      if ((session.bugs || []).length > 0) {
                        preparePreviewBug(0);
                      }
                    }}
                    variant="primary"
                    className="h-11"
                  >
                    <Layout size={18} />
                    Review & Publish Findings
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MainView;
