import React, { useEffect, useRef } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { 
  Plus, ChevronDown, 
  Loader2, Search, X, Save, Send, AlertCircle, Zap, RefreshCw,
  Compass, ArrowRight, Check, Layout
} from 'lucide-react';
import { BugReport, JiraField, TestCase } from '../../types';
import AutoResizeTextarea from '../common/AutoResizeTextarea';
import { ActionButton, StatusBadge, SurfaceCard } from '../common/DesignSystem';
import LuxurySearchableSelect from '../common/LuxurySearchableSelect';
import { TIMEOUTS } from '../../constants';

const HIDDEN_SYSTEM_FIELD_KEYS = new Set([
  'summary',
  'description',
  'project',
  'issuetype'
]);

function isSystemManagedField(field: JiraField): boolean {
  const normalizedKey = field.key.trim().toLowerCase().replace(/[_-]/g, '');
  const normalizedSystem = (field.system || '').trim().toLowerCase();

  return (
    HIDDEN_SYSTEM_FIELD_KEYS.has(field.key.trim().toLowerCase()) ||
    ['summary', 'description', 'project', 'issuetype'].includes(normalizedSystem) ||
    ['projectid', 'issuetypeid', 'pid', 'typeid'].includes(normalizedKey)
  );
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
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Issue Context Card */}
      {/* Issue Context Card */}
      <SurfaceCard className="p-3 rounded-[2.5rem] relative group overflow-hidden animate-luxury">
        {/* Animated Accent Line */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--status-info)]/40 to-transparent"></div>
        
        <div className="absolute top-0 right-0 p-3">
          <button 
            onClick={() => refreshIssue()} 
            title="Refresh Context"
            className={`p-2.5 text-[var(--text-muted)] hover:text-[var(--status-info)] transition-all bg-[var(--bg-app)]/50 hover:bg-[var(--bg-app)] rounded-xl border border-[var(--border-main)] shadow-sm hover:rotate-180 duration-700 ${session.loading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <RefreshCw size={16} className={session.loading ? 'animate-spin' : ''} /> 
          </button>
        </div>

        {session.issueData ? (
          <div className="space-y-2 animate-luxury stagger-1">
            <div className="flex items-center gap-2">
              {session.issueData.iconUrl ? (
                <div className="p-0.5 bg-white/5 rounded border border-white/10 shadow-inner">
                  <img src={session.issueData.iconUrl} className="w-4 h-4 rounded-sm" alt="" />
                </div>
              ) : (
                <StatusBadge tone="info" className="rounded-lg px-2 py-0.5 shadow-[0_0_10px_rgba(59,130,246,0.1)]">{session.issueData.key}</StatusBadge>
              )}
              {session.issueData.iconUrl && <span className="text-[10px] font-black text-blue-400/90 tracking-tight">{session.issueData.key}</span>}
              <div className="h-px flex-1 bg-gradient-to-r from-[var(--border-main)] to-transparent"></div>
            </div>
            <div className="text-base font-black text-[var(--text-main)] leading-tight tracking-tight pr-8">{session.issueData.summary}</div>
          </div>
        ) : session.error === 'STALE_PAGE' ? (
          <div className="flex flex-col gap-3 py-1.5 animate-luxury">
            <div className="flex items-center gap-2 text-[var(--status-info)] font-black text-[11px] uppercase tracking-[0.05em]">
              <div className="p-1.5 bg-[var(--status-info)]/10 rounded-lg border border-[var(--status-info)]/20 shadow-inner">
                <Loader2 size={14} className="animate-spin" />
              </div>
              Reconnecting to Jira
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed font-medium">
              BugMind is re-scanning the open Jira tab automatically. This screen will update as soon as the issue context is available again.
            </p>
            <div className="bg-[var(--bg-app)]/50 rounded-xl p-3 border border-[var(--border-main)] space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-muted)] block">Recovery Status</span>
                <span className="text-[8px] font-black uppercase tracking-widest text-[var(--status-info)]">Auto Retry Active</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-input)] border border-[var(--border-main)]">
                <div className="h-full w-1/2 bg-gradient-to-r from-[var(--status-info)]/20 via-[var(--status-info)] to-[var(--accent-hover)] animate-progress origin-left" />
              </div>
              <p className="text-[9px] text-[var(--text-muted)] leading-tight">
                If Jira does not come back in a few seconds, reload the workspace once.
              </p>
            </div>
            <div className="flex gap-2">
              <ActionButton 
                onClick={() => refreshIssue(true)}
                variant="secondary"
                tone="info"
                className="flex-1 py-2.5 rounded-xl text-[9px]"
              >
                Retry Now
              </ActionButton>
              <ActionButton 
                onClick={() => handleTabReload()} 
                variant="secondary"
                tone="warning"
                className="flex-1 py-2.5 rounded-xl text-[9px]"
              >
                Reload Tab
              </ActionButton>
            </div>
          </div>
        ) : session.error === 'NOT_A_JIRA_PAGE' ? (
          <div className="flex flex-col gap-3 py-1 animate-in fade-in duration-300">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-[var(--bg-input)] rounded-xl flex items-center justify-center text-[var(--status-info)]/50 border border-[var(--border-main)] shadow-inner shrink-0">
                <Compass size={16} />
              </div>
              <div className="space-y-0">
                <h4 className="text-[11px] font-bold text-[var(--text-main)]">Awaiting Context</h4>
                <p className="text-[9px] text-[var(--text-muted)] leading-tight">Ready to analyze when you land on a ticket.</p>
              </div>
            </div>
            
            <div className="bg-[var(--bg-app)]/50 rounded-xl p-3 border border-[var(--border-main)] space-y-2">
              <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-muted)] block">Quick Start Guide</span>
              <div className="space-y-1.5">
                {[
                  { step: "1", text: "Open any Jira issue tab" },
                  { step: "2", text: "Wait for identification" },
                  { step: "3", text: "Click 'Analyze' to begin" }
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-[var(--status-info)]/10 text-[var(--status-info)] text-[8px] font-black flex items-center justify-center shrink-0 border border-[var(--status-info)]/20">{item.step}</span>
                    <span className="text-[9px] text-[var(--text-muted)] leading-tight">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <ActionButton 
              onClick={() => window.open('https://atlassian.net', '_blank')}
              variant="secondary"
              tone="info"
              className="py-2.5 rounded-xl text-[9px] group"
            >
              Open Jira 
              <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
            </ActionButton>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-3 animate-in fade-in duration-300">
            <div className="relative">
              <Loader2 className="animate-spin text-[var(--status-info)]/50" size={24} />
              <Search className="absolute inset-0 m-auto text-[var(--status-info)]" size={10} />
            </div>
            <div className="text-center">
              <span className="text-[11px] font-medium text-[var(--text-muted)]">Hunting for context...</span>
              <div className="flex gap-1.5 justify-center mt-1.5">
                 <button onClick={() => refreshIssue()} className="text-[9px] font-bold text-blue-500 hover:underline">Retry Scan</button>
              </div>
            </div>
          </div>
        )}
      </SurfaceCard>

      {/* Action/List Section */}
      {session.error === 'NOT_A_JIRA_PAGE' ? null : (
        <div className="relative overflow-y-auto flex-1 p-3">
          {/* Locked State Overlay */}
          {session.error === 'UNSUPPORTED_ISSUE_TYPE' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-8 p-3 animate-in fade-in zoom-in slide-in-from-top-3 duration-700">
              <div className="glass-panel rounded-xl p-3 shadow-xl border-[var(--status-warning)]/20 space-y-4 text-center max-w-[260px] relative overflow-hidden">
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
                  className="w-full bg-[var(--text-main)] text-[var(--bg-app)] text-[10px] font-black py-2.5 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest"
                >
                  <RefreshCw size={12} />
                  Re-Scan Issue
                </button>
              </div>
            </div>
          )}

          {session.error === 'NO_ISSUE_TYPES_FOUND' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-12 p-3 animate-in fade-in zoom-in slide-in-from-top-3 duration-700">
              <div className="glass-panel rounded-[2rem] p-3 shadow-2xl border-[var(--status-danger)]/20 space-y-5 text-center max-w-[300px] relative overflow-hidden">
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
                  className="w-full bg-[var(--status-info)] text-white text-[10px] font-black py-2.5 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest"
                >
                  <RefreshCw size={12} />
                  Check Jira Connection
                </button>
              </div>
            </div>
          )}

          <div className={`transition-all duration-700 ${['UNSUPPORTED_ISSUE_TYPE', 'NO_ISSUE_TYPES_FOUND'].includes(session.error || '') ? 'blur-md grayscale opacity-30 pointer-events-none pt-4' : ''}`}>
            {(!session.bugs || session.bugs.length === 0) && (!session.testCases || session.testCases.length === 0) ? (
        <div className="py-12 text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="relative inline-block">
            <div className="absolute inset-0 bg-[var(--status-info)]/20 blur-3xl rounded-full animate-pulse"></div>
            <div className="relative bg-[var(--bg-card)] border border-[var(--border-main)] w-24 h-24 rounded-[2.5rem] flex items-center justify-center mx-auto text-[var(--status-info)] shadow-2xl backdrop-blur-xl">
              <Zap size={40} fill="currentColor" />
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="text-2xl font-black text-[var(--text-main)] tracking-tight">AI Analysis Ready</h3>
            <p className="text-xs text-[var(--text-muted)] px-10 leading-relaxed opacity-90">
              We'll analyze the User Story and Acceptance Criteria to uncover hidden requirements and potential functional bugs.
            </p>
          </div>

          <div className="px-6 space-y-4">
            <div className="space-y-2 text-left">
              <label className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] opacity-50 ml-1">Target Issue Type</label>
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
          </div>
          
          <div className="space-y-4 px-1 animate-luxury stagger-2">
            <button 
              onClick={generateBugs}
              disabled={!session.issueData || !session.selectedIssueType?.id || session.issueTypes.length === 0}
              className="group relative w-full overflow-hidden btn-ai-audit py-3.5 rounded-xl disabled:opacity-40 disabled:grayscale cursor-pointer"
            >
              {/* Shimmer Effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>
              
              <div className="relative flex items-center justify-center gap-2.5">
                <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-md border border-white/10 shadow-lg">
                  <Zap size={18} fill="currentColor" className="text-white" />
                </div>
                <span className="text-[11px] uppercase tracking-[0.15em]">Perform AI Audit</span>
              </div>
            </button>

            <button 
              onClick={generateTestCases}
              disabled={!session.issueData || !session.selectedIssueType?.id || session.issueTypes.length === 0}
              className="w-full luxury-card bg-transparent hover:bg-white/5 text-[var(--text-main)] font-black py-3 rounded-xl transition-all flex items-center justify-center gap-2.5 disabled:opacity-40 border border-[var(--border-main)] group"
            >
              <div className="p-1 bg-[var(--status-success)]/10 rounded group-hover:bg-[var(--status-success)]/20 transition-colors">
                <Check size={16} className="text-[var(--status-success)]" />
              </div>
              <span className="text-[10px] uppercase tracking-[0.1em]">Draft Test Cases</span>
            </button>
            
            {(!session.selectedIssueType?.id || session.issueTypes.length === 0) && (
              <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-[var(--bg-input)] rounded-full border border-[var(--border-main)]">
                <Loader2 size={10} className="animate-spin text-[var(--status-info)]" />
                <p className="text-[9px] text-[var(--text-muted)] font-black uppercase tracking-widest opacity-60">
                  Awaiting project metadata
                </p>
              </div>
            )}

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-[var(--border-main)] opacity-30"></div>
              </div>
              <div className="relative flex justify-center text-[10px] uppercase tracking-[0.4em] font-black text-[var(--text-muted)]">
                <span className="bg-[var(--bg-app)] px-4 opacity-40">Insight Forge</span>
              </div>
            </div>

            {!session.showManualInput ? (
              <button 
                onClick={() => updateSession({ showManualInput: true })}
                className="w-full luxury-card bg-transparent hover:bg-white/5 text-[var(--text-main)] font-black py-5 rounded-[1.8rem] transition-all flex items-center justify-center gap-3 group border border-[var(--border-main)]"
              >
                <div className="p-1.5 bg-[var(--status-info)]/10 rounded-lg group-hover:bg-[var(--status-info)]/20 transition-colors">
                  <Plus size={18} className="text-[var(--status-info)]" />
                </div>
                <span className="text-[11px] uppercase tracking-[0.1em]">Register Manual Bug</span>
              </button>
            ) : (
              <div className="luxury-panel p-3 rounded-xl space-y-4 animate-luxury shadow-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[var(--status-info)]/30 to-transparent"></div>
                <div className="flex justify-between items-center">
                  <h4 className="luxury-subheading text-[var(--status-info)]">Manual Structure</h4>
                  <button onClick={() => updateSession({ showManualInput: false })} className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1.5 bg-[var(--bg-input)] rounded-lg border border-[var(--border-main)] transition-all">
                    <X size={14} />
                  </button>
                </div>
                <textarea 
                  className="w-full luxury-input rounded-lg p-2.5 text-[11px] text-[var(--text-main)] outline-none transition-all min-h-[90px] placeholder:text-[var(--text-muted)] placeholder:opacity-30 custom-scrollbar"
                  placeholder="Describe the issue you've identified... We'll use AI to structure it for Jira."
                  value={session.manualDesc}
                  onChange={e => updateSession({ manualDesc: e.target.value })}
                />
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleManualGenerate()}
                    disabled={session.loading || !session.manualDesc.trim()}
                    className="flex-1 btn-ai-audit py-2 rounded-lg flex items-center justify-center gap-2 group disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Zap size={14} className="group-hover:fill-current transition-all" />
                    <span className="text-[10px] font-black uppercase tracking-wider">Synthesize Findings</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : session.testCases && session.testCases.length > 0 ? (
        <div className="space-y-4 animate-luxury">
          <div className="flex justify-between items-end px-2">
            <div className="space-y-1">
              <h3 className="text-lg font-black text-[var(--text-main)] tracking-tighter leading-none">{session.testCases.length} Test Assets</h3>
              <div className="flex items-center gap-1.5">
                <div className="h-1 w-1 bg-[var(--status-success)] rounded-full shadow-[0_0_5px_var(--status-success)]"></div>
              </div>
            </div>
            <div className="flex gap-5">
              <button 
                onClick={() => updateSession({ testCases: [], coverageScore: null, error: null, createdIssues: [], xrayWarnings: [] })} 
                className="text-[10px] font-black text-[var(--status-danger)] hover:text-[var(--status-danger)]/80 uppercase tracking-[0.2em] transition-all"
              >
                Clear
              </button>
              <button 
                onClick={generateTestCases} 
                className="text-[10px] font-black text-[var(--status-info)] hover:text-[var(--status-info)]/80 uppercase tracking-[0.2em] transition-all"
              >
                Regenerate
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {session.testCases.map((testCase: TestCase, idx: number) => (
              <div key={`${testCase.title}-${idx}`} className="bg-[var(--bg-card)] border border-[var(--border-main)] rounded-xl p-3 shadow-[var(--shadow-sm)] space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Test Case {idx + 1}</div>
                  <input
                    value={testCase.priority}
                    onChange={e => handleUpdateTestCase(idx, { priority: e.target.value })}
                    className="w-24 bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[var(--status-info)] outline-none focus:border-[var(--status-info)] text-right"
                  />
                </div>
                <AutoResizeTextarea
                  value={testCase.title}
                  onChange={e => handleUpdateTestCase(idx, { title: e.target.value })}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl p-3 text-xs font-semibold text-[var(--text-main)] leading-relaxed outline-none focus:border-[var(--status-info)]"
                />
                <div className="space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Steps</div>
                  <AutoResizeTextarea
                    value={testCase.steps.join('\n')}
                    onChange={e => handleUpdateTestCase(idx, {
                      steps: e.target.value
                        .split('\n')
                        .map(step => step.trim())
                        .filter(Boolean)
                    })}
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl p-3 text-[11px] text-[var(--text-main)] leading-relaxed outline-none focus:border-[var(--status-info)]"
                    placeholder={`1. Open the story\n2. Complete the flow\n3. Verify the result`}
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Expected Result</div>
                  <AutoResizeTextarea
                    value={testCase.expected_result}
                    onChange={e => handleUpdateTestCase(idx, { expected_result: e.target.value })}
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl p-3 text-[11px] text-[var(--text-main)] leading-relaxed outline-none focus:border-[var(--status-info)]"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="bg-[var(--bg-card)] border border-[var(--border-main)] rounded-[1.75rem] p-5 shadow-[var(--shadow-md)] space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-black text-[var(--text-main)]">Publish to Xray</h4>
                <p className="text-[11px] text-[var(--text-muted)]">Create Test issues, link them to {session.issueData?.key}, and place them in a repository folder.</p>
              </div>
              <Send size={18} className="text-[var(--status-info)]" />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] ml-1">Xray Project</span>
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

              <label className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Repository Folder</span>
                <input
                  value={session.xrayFolderPath}
                  onChange={e => updateSession({ xrayFolderPath: e.target.value })}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-3 text-[11px] text-[var(--text-main)] outline-none focus:border-[var(--status-info)]"
                  placeholder={session.issueData?.key || 'STORY-123'}
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Test Issue Type</span>
                  <input
                    value={session.xrayTestIssueTypeName}
                    onChange={e => updateSession({ xrayTestIssueTypeName: e.target.value })}
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-3 text-[11px] text-[var(--text-main)] outline-none focus:border-[var(--status-info)]"
                    placeholder="Test"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Link Type</span>
                  <input
                    value={session.xrayLinkType}
                    onChange={e => updateSession({ xrayLinkType: e.target.value })}
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-3 text-[11px] text-[var(--text-main)] outline-none focus:border-[var(--status-info)]"
                    placeholder="Tests"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Repository Field Id</span>
                  <input
                    value={session.xrayRepositoryPathFieldId}
                    onChange={e => updateSession({ xrayRepositoryPathFieldId: e.target.value })}
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-3 text-[11px] text-[var(--text-main)] outline-none focus:border-[var(--status-info)]"
                    placeholder="auto-detect"
                  />
                </label>
              </div>
            </div>

            {session.createdIssues.length > 0 && (
              <div className="rounded-xl border border-[var(--status-success)]/20 bg-[var(--status-success)]/5 p-3 space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--status-success)]">Published Tests</div>
                <div className="flex flex-wrap gap-2">
                  {session.createdIssues.map(issue => (
                    <span key={issue.key} className="px-2.5 py-1 rounded-xl bg-[var(--bg-app)] border border-[var(--border-main)] text-[11px] font-bold text-[var(--text-main)]">
                      {issue.key}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {session.xrayWarnings.length > 0 && (
              <div className="rounded-xl border border-[var(--status-warning)]/20 bg-[var(--status-warning)]/5 p-3 space-y-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-[var(--status-warning)]">Publish Warnings</div>
                <div className="space-y-1 text-[11px] text-[var(--text-main)]">
                  {session.xrayWarnings.map((warning, idx) => (
                    <div key={`${warning}-${idx}`}>{warning}</div>
                  ))}
                </div>
              </div>
            )}

            {!session.xrayPublishSupported && session.xrayUnsupportedReason && (
              <div className="rounded-xl border border-[var(--status-danger)]/20 bg-[var(--status-danger)]/5 p-3 text-[11px] text-[var(--text-main)]">
                {session.xrayUnsupportedReason}
              </div>
            )}

            <button
              onClick={publishTestCasesToXray}
              disabled={!session.xrayTargetProjectId || session.testCases.length === 0 || session.loading || !session.xrayPublishSupported}
              className="w-full bg-[var(--status-info)] hover:bg-[var(--status-info)]/90 text-white font-black py-2.5 rounded-[1.3rem] transition-all shadow-xl shadow-[var(--status-info)]/20 flex items-center justify-center gap-3 disabled:opacity-50"
            >
              <Send size={16} />
              Publish Test Cases to Xray
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-luxury">
          <div className="flex justify-between items-end px-2">
            <div className="space-y-1">
              <h3 className="text-2xl font-black text-[var(--text-main)] tracking-tighter leading-none">{(session.bugs || []).length} Intelligence Findings</h3>
              <div className="flex items-center gap-2">
                <div className="h-1 w-1 bg-[var(--status-info)] rounded-full shadow-[0_0_5px_var(--status-info)]"></div>
                <span className="luxury-subheading">Ready for Review</span>
              </div>
            </div>
            <div className="flex gap-5">
              <button 
                onClick={() => updateSession({ bugs: [], testCases: [], coverageScore: null, error: null })} 
                className="text-[10px] font-black text-[var(--status-danger)] hover:text-[var(--status-danger)]/80 uppercase tracking-[0.2em] transition-all"
              >
                Discard
              </button>
              <button 
                onClick={generateBugs} 
                className="text-[10px] font-black text-[var(--status-info)] hover:text-[var(--status-info)]/80 uppercase tracking-[0.2em] transition-all"
              >
                Refresh
              </button>
            </div>
          </div>
          
          <div className="space-y-4">
            {(session.bugs || []).map((bug: BugReport, idx: number) => (
              <div key={idx} className={`luxury-card rounded-[2rem] overflow-hidden animate-luxury stagger-${(idx % 5) + 1} ${session.expandedBug === idx ? 'ring-2 ring-[var(--status-info)]/30 border-[var(--status-info)]/30 shadow-[var(--shadow-lg)]' : 'shadow-[var(--shadow-md)]'}`}>
                <button 
                  onClick={() => updateSession({ expandedBug: session.expandedBug === idx ? null : idx })}
                  className="w-full p-3 flex items-start gap-3 text-left transition-all group"
                >
                  <div className={`mt-1.5 h-3 w-3 rounded-full shrink-0 relative ${
                    bug.severity === 'Critical' ? 'bg-[var(--status-danger)] shadow-[0_0_10px_rgba(244,63,94,0.6)]' : 
                    bug.severity === 'High' ? 'bg-[var(--status-warning)] shadow-[0_0_10px_rgba(245,158,11,0.4)]' : 'bg-[var(--status-info)] shadow-[0_0_10px_rgba(59,130,246,0.4)]'
                  }`}>
                    {bug.severity === 'Critical' && <div className="absolute inset-0 rounded-full animate-ping bg-[var(--status-danger)] opacity-40"></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-black text-[var(--text-main)] line-clamp-2 leading-[1.3] tracking-tight group-hover:text-[var(--status-info)] transition-colors">{bug.summary}</div>
                    <div className="luxury-subheading mt-2 font-black text-[var(--text-muted)] opacity-80">{bug.severity} Sensitivity</div>
                  </div>
                  <div className={`mt-1.5 p-1.5 bg-[var(--bg-input)] rounded-xl border border-[var(--border-main)] transition-all duration-500 ${session.expandedBug === idx ? 'rotate-180 bg-[var(--status-info)]/10 border-[var(--status-info)]/30' : ''}`}>
                    <ChevronDown size={18} className={session.expandedBug === idx ? 'text-[var(--status-info)]' : 'text-[var(--text-muted)]'} />
                  </div>
                </button>
                
                <div className={`collapsible-grid ${session.expandedBug === idx ? 'expanded' : ''} relative`}>
                  <div className="collapsible-content">
                    <div className="px-6 pb-6 pt-0 space-y-5">
                      <div className="h-px bg-gradient-to-r from-[var(--border-main)] via-[var(--border-main)] to-transparent"></div>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <span className="luxury-subheading opacity-80">Investigation Summary</span>
                          <AutoResizeTextarea 
                            value={bug.description}
                            onChange={e => handleUpdateBug(idx, { description: e.target.value })}
                            className="w-full luxury-input rounded-xl p-3 text-[11px] text-[var(--text-main)] leading-relaxed outline-none transition-all placeholder:text-[var(--text-muted)] placeholder:opacity-30"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <span className="luxury-subheading text-[var(--status-success)]/90 opacity-80">Reproduction Protocol</span>
                          <AutoResizeTextarea 
                            value={bug.steps_to_reproduce}
                            onChange={e => handleUpdateBug(idx, { steps_to_reproduce: e.target.value })}
                            className="w-full luxury-input rounded-xl p-3 text-[11px] text-[var(--text-main)] leading-relaxed outline-none transition-all font-mono placeholder:text-[var(--text-muted)] placeholder:opacity-30 border-[var(--status-success)]/10"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <span className="luxury-subheading opacity-80">Expected State</span>
                            <AutoResizeTextarea 
                              value={bug.expected_result}
                              onChange={e => handleUpdateBug(idx, { expected_result: e.target.value })}
                              className="w-full luxury-input rounded-xl p-3 text-[11px] text-[var(--text-main)] leading-relaxed outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <span className="luxury-subheading text-[var(--status-danger)] opacity-80">Observed Deviation</span>
                            <AutoResizeTextarea 
                              value={bug.actual_result}
                              onChange={e => handleUpdateBug(idx, { actual_result: e.target.value })}
                              className="w-full luxury-input rounded-xl p-3 text-[11px] text-[var(--text-main)] leading-relaxed outline-none transition-all border-[var(--status-danger)]/20"
                            />
                          </div>
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
                          <div className="pt-2 space-y-5">
                            <div className="h-px bg-gradient-to-r from-[var(--border-main)] via-[var(--border-main)] to-transparent"></div>
                            <div className="flex items-center gap-3">
                              <div className="h-1.5 w-1.5 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div>
                              <span className="luxury-subheading text-blue-400">Jira Integration Context</span>
                            </div>
                            <div className="grid grid-cols-1 gap-5">
                              {allVisibleKeys.map((fieldKey: string) => {
                                 const field = metadataFields.find((f: JiraField) => f.key === fieldKey);
                                 if (!field) return null;

                                 const isMulti = field.type === 'array' || field.type === 'multi-select';
                                 const currentVal = bug.extra_fields?.[fieldKey];

                                 return (
                                   <div key={fieldKey} className="space-y-2">
                                     <div className="flex justify-between items-center ml-1">
                                      <label className="luxury-subheading lowercase font-bold tracking-tight opacity-40">
                                         {field.name} {field.required && <span className="text-[var(--status-danger)] font-black">*</span>}
                                       </label>
                                     </div>
                                   
                                   {(field.type === 'user' || field.type === 'multi-user' || field.allowed_values || field.type === 'labels' || field.type === 'array') ? (
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
                                   ) : (
                                     <input 
                                       type="text"
                                       value={typeof currentVal === 'boolean' ? String(currentVal) : (currentVal?.toString() || '')}
                                       onChange={e => handleUpdateBug(idx, { 
                                         extra_fields: { ...(bug.extra_fields || {}), [fieldKey]: e.target.value } 
                                       })}
                                       className={`w-full luxury-input rounded-xl px-3 py-2.5 outline-none transition-all text-[11px] text-[var(--text-main)] ${field.required && !currentVal ? 'border-[var(--status-danger)]/20' : 'border-[var(--border-main)]'}`}
                                       placeholder={`Enter ${field.name.toLowerCase()}...`}
                                     />
                                   )}
                                 </div>
                                 );
                               })}
                             </div>
                           </div>
                         );
                       })()}
                       <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2">
                           <div className="text-[10px] text-[var(--text-muted)] italic">Auto-saving edits...</div>
                           {/* Quick indicator pulse on successful update */}
                           <div className="flex items-center gap-1 text-[var(--status-success)] animate-in fade-in zoom-in duration-300">
                             <Check size={10} className="stroke-[3px]" />
                             <span className="text-[9px] font-black uppercase tracking-tighter">Synced</span>
                           </div>
                         </div>
                         <button onClick={() => updateSession({ expandedBug: null })} className="flex items-center gap-2 text-[10px] font-bold text-[var(--status-info)] hover:text-[var(--status-info)]/80">
                           <Save size={12} />
                           Close Editor
                         </button>
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button 
            onClick={() => {
              if ((session.bugs || []).length > 0) {
                preparePreviewBug(0);
              }
            }}
            className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-black py-2.5 rounded-xl transition-all shadow-xl shadow-[var(--accent)]/20 flex items-center justify-center gap-2 mt-6 btn-press active:scale-[0.98] hover:scale-[1.01]"
          >
            <Layout size={18} />
            Review & Publish Findings
          </button>
        </div>
      )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MainView;
