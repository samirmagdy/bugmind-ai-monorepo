import React, { useEffect, useRef } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { 
  Plus, ChevronDown, Bug,
  Loader2, Send, AlertCircle, Zap, RefreshCw,
  Compass, ArrowRight, Check, Layout, AlertTriangle, BrainCircuit, Paperclip, X
} from 'lucide-react';
import { BugReport, JiraField, JiraFieldOption, JiraUser, SupportingArtifact, TestCase } from '../../types';
import AutoResizeTextarea from '../common/AutoResizeTextarea';
import { ActionButton, SurfaceCard, StatusBadge, StatusPanel } from '../common/DesignSystem';
import LuxurySearchableSelect, { SelectOption, SelectValue } from '../common/LuxurySearchableSelect';
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

type StoredSelectValue = {
  id: string;
  name?: string;
  value?: string;
  label?: string;
  avatar?: string;
};

type ExtraFieldValue =
  | string
  | number
  | boolean
  | null
  | JiraUser
  | JiraFieldOption
  | (JiraUser | JiraFieldOption | string)[];

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

function toStoredSelectValue(value: SelectValue): StoredSelectValue {
  if (typeof value === 'object' && value !== null) {
    return {
      id: String(value.id ?? ''),
      name: value.name,
      value: value.value,
      label: value.label,
      avatar: value.avatar
    };
  }

  return { id: String(value ?? '') };
}

function isSelectOption(value: SelectValue | SelectValue[]): value is SelectOption {
  return !Array.isArray(value) && typeof value === 'object' && value !== null;
}

function toAllowedValueOption(option: JiraFieldOption): SelectOption {
  return {
    id: option.id,
    name: option.name,
    value: option.value,
    label: option.label
  };
}

function toUserOption(user: JiraUser): SelectOption {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar
  };
}

const MainView: React.FC = () => {
  const { 
    session, updateSession, currentTabId, refreshIssue, debug, handleTabReload,
    jira,
    ai: { 
      generateBugs, generateTestCases, handleManualGenerate, 
      handleUpdateBug, handleUpdateTestCase, publishTestCasesToXray, 
      searchUsers, preparePreviewBug, regenerateBug
    } 
  } = useBugMind();
  const { log } = debug;
  const isRecoveringStalePage = session.error === 'STALE_PAGE' && !session.issueData;
  const staleRecoveryAttemptsRef = useRef(0);
  const artifactInputRef = useRef<HTMLInputElement | null>(null);
  const manualInputs = session.manualInputs?.length ? session.manualInputs : [''];
  const requiresIssueType = !session.issueData || !session.selectedIssueType?.id || session.issueTypes.length === 0;
  const acceptanceCriteria = session.issueData?.acceptanceCriteria?.trim() || '';
  const descriptionText = session.issueData?.description?.trim() || '';
  const hasStructuredCriteria = acceptanceCriteria.length > 120 || acceptanceCriteria.includes('\n') || acceptanceCriteria.includes('-');
  const recommendedWorkflow = !session.issueData ? null : hasStructuredCriteria ? 'tests' : (acceptanceCriteria.length < 48 && descriptionText.length > 0 ? 'analysis' : 'manual');
  const recommendationLabel = !session.issueData
    ? 'Open a Jira story to enable all workflows.'
    : recommendedWorkflow === 'tests'
      ? 'Recommended: Generate Test Cases for this story'
      : recommendedWorkflow === 'analysis'
        ? 'Recommended: Run AI Gap Analysis to uncover missing scenarios'
        : 'Recommended: I Found a Bug for quick reporting';

  const setWorkflow = (mainWorkflow: 'home' | 'manual' | 'analysis' | 'tests') => {
    updateSession({ mainWorkflow, error: null });
  };

  const updateManualInput = (index: number, value: string) => {
    const nextInputs = [...manualInputs];
    nextInputs[index] = value;
    updateSession({ manualInputs: nextInputs });
  };

  const addManualInput = () => {
    updateSession({ manualInputs: [...manualInputs, ''] });
  };

  const removeManualInput = (index: number) => {
    const nextInputs = manualInputs.filter((_, currentIndex) => currentIndex !== index);
    updateSession({ manualInputs: nextInputs.length ? nextInputs : [''] });
  };

  const removeSupportingArtifact = (artifactId: string) => {
    updateSession({
      supportingArtifacts: (session.supportingArtifacts || []).filter((artifact) => artifact.id !== artifactId)
    });
  };

  const handleSupportingFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const acceptedExtensions = /\.(txt|log|md|json|csv|xml|yaml|yml)$/i;
    const nextArtifacts: SupportingArtifact[] = [];
    const rejectedNames: string[] = [];

    for (const file of files) {
      const isTextLike = file.type.startsWith('text/') || file.type === 'application/json' || acceptedExtensions.test(file.name);
      if (!isTextLike || file.size > 300_000) {
        rejectedNames.push(file.name);
        continue;
      }

      const rawContent = await file.text();
      const content = rawContent.trim();
      if (!content) continue;

      nextArtifacts.push({
        id: `${file.name}-${file.lastModified}-${file.size}`,
        name: file.name,
        type: file.type || 'text/plain',
        size: file.size,
        content
      });
    }

    if (nextArtifacts.length > 0) {
      const existing = session.supportingArtifacts || [];
      const merged = [...existing];
      for (const artifact of nextArtifacts) {
        if (!merged.some((item) => item.id === artifact.id)) {
          merged.push(artifact);
        }
      }
      updateSession({
        supportingArtifacts: merged,
        success: rejectedNames.length ? `Skipped unsupported files: ${rejectedNames.join(', ')}` : 'Supporting files added.'
      });
    } else if (rejectedNames.length) {
      updateSession({ error: `Only text-based files up to 300 KB are supported here. Skipped: ${rejectedNames.join(', ')}` });
    }

    event.target.value = '';
  };

  const supportingContextPanel = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="context-label uppercase tracking-wider block ml-1">Supporting Context</label>
        <AutoResizeTextarea
          value={session.generationSupportingContext}
          onChange={e => updateSession({ generationSupportingContext: e.target.value })}
          className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] p-3 text-xs text-[var(--text-secondary)] outline-none min-h-[72px]"
          placeholder="Optional: add logs, constraints, environment notes, or URLs that should influence generation."
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="context-label uppercase tracking-wider block ml-1">Supporting Files</label>
          <button
            type="button"
            onClick={() => artifactInputRef.current?.click()}
            className="flex items-center gap-1 rounded-full border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-primary)]"
          >
            <Paperclip size={12} />
            Add Files
          </button>
          <input
            ref={artifactInputRef}
            type="file"
            multiple
            accept=".txt,.log,.md,.json,.csv,.xml,.yaml,.yml,text/*,application/json"
            className="hidden"
            onChange={(event) => { void handleSupportingFiles(event); }}
          />
        </div>
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          Upload text logs, JSON, markdown, CSV, or config snippets. These are included as AI support context for bug generation and refinement.
        </p>
        {session.supportingArtifacts.length > 0 && (
          <div className="space-y-2">
            {session.supportingArtifacts.map((artifact) => (
              <div key={artifact.id} className="flex items-start justify-between gap-3 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-[var(--text-primary)] truncate">{artifact.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{artifact.type || 'text/plain'} • {Math.max(1, Math.round(artifact.size / 1024))} KB</div>
                </div>
                <button
                  type="button"
                  onClick={() => removeSupportingArtifact(artifact.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  aria-label={`Remove ${artifact.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

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
      <SurfaceCard className="relative group animate-in slide-in-from-top-4 duration-700">
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
        </SurfaceCard>


      {/* Action/List Section */}
      {session.error === 'NOT_A_JIRA_PAGE' ? null : (
        <div className="relative overflow-y-auto flex-1 pt-1 pb-2">
          {/* Locked State Overlay */}
          {session.error === 'UNSUPPORTED_ISSUE_TYPE' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-8 p-3 animate-in fade-in zoom-in slide-in-from-top-3 duration-700">
              <StatusPanel
                icon={AlertCircle}
                tone="warning"
                title="Requirement Focus"
                description={
                  <span>
                    BugMind is designed for <strong>User Stories</strong>.<br />
                    This issue is identified as a <span className="text-[var(--status-warning)] font-black">{session.issueData?.typeName || 'Other'}</span>.
                  </span>
                }
                action={
                  <ActionButton 
                    onClick={() => refreshIssue(true)}
                    variant="primary"
                    className="w-full text-[10px] uppercase tracking-widest"
                  >
                    <RefreshCw size={12} className="mr-2" />
                    Re-Scan Issue
                  </ActionButton>
                }
                className="shadow-[var(--shadow-card)] max-w-[260px]"
              />
            </div>
          )}

          {session.error === 'NO_ISSUE_TYPES_FOUND' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start pt-12 p-3 animate-in fade-in zoom-in slide-in-from-top-3 duration-700">
              <StatusPanel
                icon={AlertCircle}
                tone="danger"
                title="Permission Restriction"
                description="Jira returned 0 accessible issue types for this instance. This usually means the API Token used does not have permissions to view projects."
                action={
                  <ActionButton 
                    onClick={() => updateSession({ view: 'setup' })}
                    variant="primary"
                    className="w-full text-[10px] uppercase tracking-widest bg-[var(--primary-gradient)] border-0"
                  >
                    <RefreshCw size={12} className="mr-2" />
                    Check Jira Connection
                  </ActionButton>
                }
                className="shadow-[var(--shadow-card)] max-w-[300px]"
              />
            </div>
          )}

          <div className={`transition-all duration-700 ${['UNSUPPORTED_ISSUE_TYPE', 'NO_ISSUE_TYPES_FOUND'].includes(session.error || '') ? 'blur-md grayscale opacity-30 pointer-events-none pt-4' : ''}`}>
            {(!session.bugs || session.bugs.length === 0) && (!session.testCases || session.testCases.length === 0) ? (
              <div className="space-y-4">
                {session.mainWorkflow === 'home' ? (
                  <SurfaceCard className="space-y-0 cursor-default hover:border-[var(--card-border)] animate-in fade-in slide-in-from-bottom-4 duration-700 overflow-hidden">
                    <div className="space-y-3 pb-5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Choose Workflow</div>
                        <StatusBadge tone="info" className="opacity-80">
                          {session.issueData ? 'Story Detected' : 'Context Needed'}
                        </StatusBadge>
                      </div>
                      <h3 className="workflow-card-title">Start from one action</h3>
                      <p className="workflow-card-subtitle">Each workflow opens in its own focused page while keeping the same Jira context above.</p>
                      <div className={`rounded-[1rem] border px-3.5 py-3 text-[11px] font-medium leading-relaxed ${
                        session.issueData
                          ? 'border-[var(--border-soft)] bg-[var(--surface-soft)] text-[var(--text-secondary)]'
                          : 'border-[var(--status-warning)]/20 bg-[var(--warning-bg)] text-[var(--text-secondary)]'
                      }`}>
                        <span className="font-bold text-[var(--text-primary)]">{recommendationLabel}</span>
                        {session.issueData && (
                          <span className="block mt-1">
                            {recommendedWorkflow === 'tests'
                              ? 'Create Xray-ready coverage from the current acceptance criteria.'
                              : recommendedWorkflow === 'analysis'
                                ? 'Get a report of missing requirements, edge cases, and functional risks.'
                                : 'Generate structured Jira-ready bugs instantly from your notes.'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="border-t border-[var(--border-soft)]">
                      <div className={`group relative flex items-center justify-between gap-4 rounded-[1.1rem] py-5 px-1 transition-colors ${
                        recommendedWorkflow === 'manual' ? 'bg-[var(--surface-accent)]/45' : 'hover:bg-[var(--surface-soft)]/70'
                      }`}>
                        <button type="button" onClick={() => setWorkflow('manual')} className="absolute inset-0" aria-label="I Found a Bug" />
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-[1.1rem] flex items-center justify-center shrink-0 ${
                            recommendedWorkflow === 'manual'
                              ? 'bg-[var(--primary-gradient)] text-white'
                              : 'bg-[var(--surface-accent)] text-[var(--primary-purple)]'
                          }`}>
                            <Bug size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="workflow-card-title text-[15px]">I Found a Bug</h4>
                              <StatusBadge className={recommendedWorkflow === 'manual' ? '' : 'opacity-80'}>
                                {recommendedWorkflow === 'manual' ? 'Recommended' : 'Primary'}
                              </StatusBadge>
                            </div>
                            <p className="workflow-card-subtitle">Generate structured bugs ready to submit in Jira.</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="rounded-full border border-[var(--card-border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-primary)]">
                            Start
                          </span>
                          <ArrowRight size={16} className="text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-[var(--border-soft)]">
                      <div className={`group relative flex items-center justify-between gap-4 rounded-[1.1rem] py-5 px-1 transition-colors ${
                        recommendedWorkflow === 'analysis' ? 'bg-[var(--surface-accent-strong)]/55' : 'hover:bg-[var(--surface-soft)]/70'
                      }`}>
                        <button type="button" onClick={() => setWorkflow('analysis')} className="absolute inset-0" aria-label="AI Gap Analysis" />
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-[1.1rem] flex items-center justify-center shrink-0 ${
                            recommendedWorkflow === 'analysis'
                              ? 'bg-[var(--primary-blue)] text-white'
                              : 'bg-[var(--surface-accent-strong)] text-[var(--primary-blue)]'
                          }`}>
                            <Zap size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="workflow-card-title text-[15px]">AI Gap Analysis</h4>
                              {recommendedWorkflow === 'analysis' && <StatusBadge tone="info">Recommended</StatusBadge>}
                            </div>
                            <p className="workflow-card-subtitle">Get a report of missing scenarios, requirements, and risk areas.</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="rounded-full border border-[var(--card-border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-primary)]">
                            Start
                          </span>
                          <ArrowRight size={16} className="text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-[var(--border-soft)]">
                      <div className={`group relative flex items-center justify-between gap-4 rounded-[1.1rem] py-5 px-1 transition-colors ${
                        recommendedWorkflow === 'tests' ? 'bg-[var(--success-bg)]/70' : 'hover:bg-[var(--surface-soft)]/70'
                      }`}>
                        <button type="button" onClick={() => setWorkflow('tests')} className="absolute inset-0" aria-label="Generate Test Cases" />
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-[1.1rem] flex items-center justify-center shrink-0 ${
                            recommendedWorkflow === 'tests'
                              ? 'bg-[var(--status-success)] text-white'
                              : 'bg-[var(--surface-soft)] text-[var(--status-success)]'
                          }`}>
                            <Check size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="workflow-card-title text-[15px]">Generate Test Cases</h4>
                              {recommendedWorkflow === 'tests' && <StatusBadge tone="success">Recommended</StatusBadge>}
                            </div>
                            <p className="workflow-card-subtitle">Create and export Xray-ready test cases linked to this story.</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="rounded-full border border-[var(--card-border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-primary)]">
                            Start
                          </span>
                          <ArrowRight size={16} className="text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </div>
                  </SurfaceCard>
                ) : (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-500">
                    <SurfaceCard className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setWorkflow('home')} className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--card-border)] bg-[var(--surface-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                            <ArrowRight size={14} className="rotate-180" />
                          </button>
                          <div>
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Workflow</div>
                            <h3 className="workflow-card-title">
                              {session.mainWorkflow === 'manual'
                                ? 'I Found a Bug'
                                : session.mainWorkflow === 'analysis'
                                  ? 'AI Gap Analysis'
                                  : 'Generate Test Cases'}
                            </h3>
                          </div>
                        </div>
                        <div className="step-badge">
                          {session.mainWorkflow === 'manual' ? 'BUG' : session.mainWorkflow === 'analysis' ? 'AI' : 'QA'}
                        </div>
                      </div>

                      {session.mainWorkflow !== 'manual' && (
                        <div className="space-y-2">
                          <label className="context-label uppercase tracking-wider mb-1.5 block ml-1">Analysis Context</label>
                          <LuxurySearchableSelect
                            options={session.issueTypes.map(t => ({ id: t.id, name: t.name, avatar: t.icon_url }))}
                            value={session.selectedIssueType}
                            placeholder="Select issue type..."
                            onChange={(type) => {
                              if (type && !Array.isArray(type) && session.jiraConnectionId && session.issueData) {
                                const selectedType = session.issueTypes.find((issueType) => issueType.id === (isSelectOption(type) ? type.id : type));
                                if (!selectedType) return;
                                updateSession({ selectedIssueType: selectedType, jiraMetadata: null });
                                void bootstrapJiraConfig(selectedType.id, { force: true, loading: true, logTag: 'MAIN-TYPE-SWITCH' });
                              }
                            }}
                          />
                        </div>
                      )}

                      {session.mainWorkflow === 'manual' ? (
                        <div className="space-y-3">
                          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                            Add one or more bug descriptions. Each input will be structured as a separate Jira-ready bug report.
                          </p>
                          <div className="space-y-3">
                            {manualInputs.map((manualInput, index) => (
                              <div key={`manual-input-${index}`} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <label className="context-label uppercase tracking-wider block ml-1">Bug Input {index + 1}</label>
                                  {manualInputs.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeManualInput(index)}
                                      className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--error)]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                                <AutoResizeTextarea
                                  className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[1rem] p-3 text-sm outline-none focus:border-[var(--border-active)] min-h-[96px]"
                                  placeholder="Describe the issue in plain English. This input becomes one bug."
                                  value={manualInput}
                                  onChange={e => updateManualInput(index, e.target.value)}
                                />
                              </div>
                            ))}
                          </div>
                          {supportingContextPanel}
                          <ActionButton onClick={addManualInput} variant="secondary" className="h-10 w-full text-[12px]">
                            <Plus size={15} />
                            Add Another Bug
                          </ActionButton>
                          <ActionButton
                            onClick={() => handleManualGenerate()}
                            variant="primary"
                            disabled={session.loading || manualInputs.every(input => !input.trim())}
                            className="h-11"
                          >
                            <Zap size={16} />
                            Generate Structured Bugs
                          </ActionButton>
                        </div>
                      ) : session.mainWorkflow === 'analysis' ? (
                        <div className="space-y-3">
                          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                            Analyze the story and acceptance criteria to surface hidden requirements, edge cases, and functional risk.
                          </p>
                          <div className="space-y-2">
                            <label className="context-label uppercase tracking-wider mb-1.5 block ml-1">Finding Count</label>
                            <div className="grid grid-cols-3 gap-2">
                              {[3, 5, 7].map((count) => (
                                <button
                                  key={count}
                                  type="button"
                                  onClick={() => updateSession({ bugGenerationCount: count })}
                                  className={`rounded-[0.95rem] border px-3 py-2 text-[11px] font-bold ${
                                    session.bugGenerationCount === count
                                      ? 'border-[var(--border-active)] bg-[var(--surface-accent)] text-[var(--text-primary)]'
                                      : 'border-[var(--border-soft)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {count} Bugs
                                </button>
                              ))}
                            </div>
                          </div>
                          {supportingContextPanel}
                          <ActionButton 
                            onClick={generateBugs}
                            variant="primary"
                            className="h-11 text-[13px]"
                            disabled={requiresIssueType}
                          >
                            <Zap size={16} />
                            Run Gap Analysis
                          </ActionButton>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                            Generate comprehensive QA-ready test cases from the current story and prepare them for direct Jira Xray publishing.
                          </p>
                          <ActionButton 
                            onClick={generateTestCases}
                            variant="primary"
                            className="h-11 text-[13px]"
                            disabled={requiresIssueType}
                          >
                            <Check size={16} />
                            Generate Test Cases
                          </ActionButton>
                        </div>
                      )}

                      {requiresIssueType && session.mainWorkflow !== 'manual' && (
                        <div className="flex items-center justify-center gap-2 pt-1 text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider">
                          <Loader2 size={10} className="animate-spin" />
                          Fetching project metadata...
                        </div>
                      )}
                    </SurfaceCard>
                  </div>
                )}
              </div>
                  ) : session.testCases && session.testCases.length > 0 ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">{session.testCases.length} Test Assets</h3>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => updateSession({ testCases: [], coverageScore: null, error: null, createdIssues: [], xrayWarnings: [], mainWorkflow: 'home' })} 
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
                    <SurfaceCard key={`${testCase.title}-${idx}`} className="space-y-3">
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
                    </SurfaceCard>
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
                        onChange={(next) => {
                          const selectedProjectId = isSelectOption(next) ? String(next.id ?? '') : Array.isArray(next) ? '' : String(next ?? '');
                          const project = session.xrayProjects.find(item => item.id === selectedProjectId);
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
                    <StatusPanel 
                      tone="warning" 
                      title="Publish Warnings"
                      icon={AlertTriangle}
                    >
                      <div className="text-[11px]">
                        {session.xrayWarnings.map((warning, idx) => (
                          <div key={`${warning}-${idx}`}>{warning}</div>
                        ))}
                      </div>
                    </StatusPanel>
                  )}

                  {!session.xrayPublishSupported && session.xrayUnsupportedReason && (
                    <StatusPanel 
                      tone="danger" 
                      title="Export Unavailable"
                      description={session.xrayUnsupportedReason}
                      icon={AlertCircle}
                    />
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
                      onClick={() => updateSession({ bugs: [], testCases: [], coverageScore: null, error: null, mainWorkflow: 'home' })} 
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
                    <SurfaceCard key={idx}>
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
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <div className="workflow-card-subtitle text-[11px] font-bold uppercase tracking-wider">{bug.severity} Risk</div>
                            {bug.category && (
                              <StatusBadge tone="info" className="text-[9px]">
                                {bug.category}
                              </StatusBadge>
                            )}
                            {typeof bug.confidence === 'number' && (
                              <StatusBadge tone={bug.confidence >= 80 ? 'success' : bug.confidence >= 60 ? 'info' : 'warning'} className="text-[9px]">
                                {bug.confidence}% confidence
                              </StatusBadge>
                            )}
                            {bug.duplicate_group && (
                              <StatusBadge tone="warning" className="text-[9px]">
                                Overlap {bug.duplicate_group}
                              </StatusBadge>
                            )}
                          </div>
                        </div>
                        <ChevronDown 
                          size={16} 
                          className={`text-[var(--text-muted)] transition-transform duration-300 ${session.expandedBug === idx ? 'rotate-180' : ''}`} 
                        />
                      </div>
                      
                      {session.expandedBug === idx && (
                        <div className="mt-4 pt-4 border-t border-[var(--border-soft)] space-y-4 animate-in slide-in-from-top-2">
                          <div className="space-y-1.5">
                            <label className="context-label uppercase tracking-widest block">Core Summary</label>
                            <AutoResizeTextarea 
                              value={bug.summary}
                              onChange={e => handleUpdateBug(idx, { summary: e.target.value })}
                              className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-primary)] font-bold outline-none"
                            />
                          </div>
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
                              <label className="context-label uppercase tracking-widest block">Severity</label>
                              <LuxurySearchableSelect
                                options={['Critical', 'High', 'Medium', 'Low'].map((value) => ({ id: value, name: value }))}
                                value={bug.severity ? { id: bug.severity, name: bug.severity } : null}
                                onChange={(next) => {
                                  const nextValue = isSelectOption(next) ? String(next.id) : '';
                                  handleUpdateBug(idx, { severity: nextValue || 'Medium' });
                                }}
                                placeholder="Select severity..."
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Category</label>
                              <LuxurySearchableSelect
                                options={['Functional Gap', 'Validation', 'Workflow', 'Edge Case', 'Permissions', 'Data Integrity', 'Regression Risk', 'UX'].map((value) => ({ id: value, name: value }))}
                                value={bug.category ? { id: bug.category, name: bug.category } : null}
                                onChange={(next) => {
                                  const nextValue = isSelectOption(next) ? String(next.id) : '';
                                  handleUpdateBug(idx, { category: nextValue || 'Functional Gap' });
                                }}
                                placeholder="Select category..."
                              />
                            </div>
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
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">AC References</label>
                              <AutoResizeTextarea
                                value={(bug.acceptance_criteria_refs || []).join('\n')}
                                onChange={e => handleUpdateBug(idx, {
                                  acceptance_criteria_refs: e.target.value.split('\n').map((item) => item.trim()).filter(Boolean)
                                })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="context-label uppercase tracking-widest block">Evidence</label>
                              <AutoResizeTextarea
                                value={(bug.evidence || []).join('\n')}
                                onChange={e => handleUpdateBug(idx, {
                                  evidence: e.target.value.split('\n').map((item) => item.trim()).filter(Boolean)
                                })}
                                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-[0.9rem] p-2.5 text-xs text-[var(--text-secondary)] outline-none"
                              />
                            </div>
                          </div>
                          {bug.overlap_warning && (
                            <StatusPanel
                              tone="warning"
                              title="Potential Overlap"
                              description={bug.overlap_warning}
                              icon={AlertTriangle}
                            />
                          )}

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
                                          options={(field.allowed_values || []).map(toAllowedValueOption)}
                                          value={currentVal as SelectValue | SelectValue[]}
                                          placeholder={field.type.includes('user') ? "Search users..." : (isMulti ? `Add ${field.name}...` : `Select ${field.name}...`)}
                                          required={field.required}
                                          allowCustomValues={field.type === 'labels' || field.type === 'array'}
                                          onSearchAsync={field.type.includes('user') ? async (q) => {
                                            const results = await searchUsers(q, undefined, field.key);
                                            return (results || []).map(toUserOption);
                                          } : undefined}
                                          onChange={(next) => {
                                            let finalVal: ExtraFieldValue = (next ?? null) as ExtraFieldValue;
                                            if (field.type === 'option' || field.type === 'multi-select' || field.type === 'priority' || field.type === 'user' || field.type === 'multi-user') {
                                              if (isMulti) {
                                                finalVal = (Array.isArray(next) ? next : []).map(toStoredSelectValue);
                                              } else {
                                                finalVal = toStoredSelectValue(Array.isArray(next) ? next[0] : next);
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
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => void regenerateBug(idx)}
                                className="flex items-center gap-1 text-[10px] font-bold text-[var(--primary-blue)] hover:opacity-80"
                              >
                                <BrainCircuit size={12} />
                                Refine Finding
                              </button>
                              <button onClick={() => updateSession({ expandedBug: null })} className="text-[10px] font-bold text-[var(--primary-blue)] hover:opacity-80">
                                Close Editor
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </SurfaceCard>
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
