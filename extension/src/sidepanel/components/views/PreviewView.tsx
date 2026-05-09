import React, { useEffect, useRef } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import {
  ArrowLeft, AlertTriangle, Send, ChevronLeft, ChevronRight,
  Layout, AlignLeft, ShieldAlert, Search, ExternalLink, Link2, Loader2, Info
} from 'lucide-react';
import JiraMarkdown from '../common/JiraMarkdown';
import { ActionButton, StatusPanel, SurfaceCard } from '../common/DesignSystem';
import {
  BugReport,
  JiraField,
  JiraFieldOption,
  ResolvedFieldValue
} from '../../types';
import { getProfileProjectParams } from '../../services/JiraCapabilityService';

function hasResolvedField(
  fields: Record<string, ResolvedFieldValue> | undefined,
  key: string
): fields is Record<string, ResolvedFieldValue> {
  return Boolean(fields) && Object.prototype.hasOwnProperty.call(fields, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractNamedValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : '(empty)';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value
      .map(item => extractNamedValue(item))
      .filter((item): item is string => Boolean(item) && item !== '(empty)');

    if (items.length > 0) {
      return items.join(', ');
    }

    return value.length > 0 ? `${value.length} items selected` : '(empty)';
  }

  if (isRecord(value)) {
    const preferredKeys = [
      'displayName',
      'name',
      'label',
      'value',
      'key',
      'emailAddress',
      'accountId',
      'id'
    ] as const;

    for (const key of preferredKeys) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }
  }

  return null;
}

function resolveAllowedValueLabel(
  field: JiraField | undefined,
  value: unknown
): string | null {
  if (!field?.allowed_values?.length) return null;

  const rawCandidate = extractNamedValue(value);
  if (!rawCandidate) return null;

  const match = field.allowed_values.find((option: JiraFieldOption) =>
    [option.id, option.name, option.value, option.label]
      .filter((candidate): candidate is string => Boolean(candidate))
      .includes(rawCandidate)
  );

  return match?.name || match?.value || match?.label || null;
}

function resolvePreviewFieldValue(
  key: string,
  resolvedValue: ResolvedFieldValue,
  field: JiraField | undefined,
  bugExtraFields: BugReport['extra_fields'] | undefined,
  fieldDefaults: Record<string, unknown>,
  projectKey: string | undefined
): string {
  if (key === 'project' && projectKey) {
    return projectKey;
  }

  const fallbackValue = bugExtraFields?.[key] ?? fieldDefaults[key];

  const preferredDisplay =
    resolveAllowedValueLabel(field, fallbackValue) ??
    extractNamedValue(fallbackValue);
  if (preferredDisplay) {
    return preferredDisplay;
  }

  const resolvedDisplay =
    resolveAllowedValueLabel(field, resolvedValue) ??
    extractNamedValue(resolvedValue);
  if (resolvedDisplay) {
    return resolvedDisplay;
  }

  if (isRecord(resolvedValue)) {
    return JSON.stringify(resolvedValue);
  }

  return '(empty)';
}

function formatStepsForPreview(stepsText: string | undefined): string {
  if (!stepsText) return '';

  const steps = stepsText
    .split('\n')
    .map(step => step.trim())
    .filter(Boolean)
    .map(step => step.replace(/^\d+\.\s*/, '').trim());

  return steps.map(step => `# ${step}`).join('\n');
}

const PreviewView: React.FC = () => {
  const { session, updateSession, ai: { submitBugs, preparePreviewBug, checkDuplicates, linkToExisting } } = useBugMind();
  const restoredPreviewRef = useRef<number | null>(null);
  
  const bugIndex = session.previewBugIndex;
  const bug = bugIndex !== null ? session.bugs[bugIndex] : null;
  const totalBugs = session.bugs.length;
  const resolved = session.resolvedPayload?.fields;
  const profileProject = getProfileProjectParams(session.jiraCapabilityProfile);
  const projectKey = session.jiraCapabilityProfile
    ? profileProject.projectKey || session.issueData?.key.split('-')[0]
    : session.jiraMetadata?.project_key || profileProject.projectKey || session.issueData?.key.split('-')[0];
  const resolvedSummary = hasResolvedField(resolved, 'summary')
    ? resolvePreviewFieldValue(
        'summary',
        resolved.summary,
        session.jiraMetadata?.fields.find(f => f.key === 'summary'),
        bug?.extra_fields,
        session.fieldDefaults,
        projectKey
      )
    : bug?.summary ?? '';
  const previewDescription = bug?.description ?? '';
  const previewSteps = formatStepsForPreview(bug?.steps_to_reproduce);
  const returnToFindings = (expandedBug: number | null = null) => {
    updateSession({
      view: 'main',
      mainWorkflow: session.gapAnalysisSummary ? 'analysis' : session.mainWorkflow,
      expandedBug,
      previewBugIndex: null,
      resolvedPayload: null,
      validationErrors: [],
      error: null
    });
  };

  useEffect(() => {
    if (session.view !== 'preview' || bugIndex === null || !bug) {
      restoredPreviewRef.current = null;
      return;
    }

    if (resolved || session.loading) return;
    if (restoredPreviewRef.current === bugIndex) return;

    restoredPreviewRef.current = bugIndex;
    preparePreviewBug(bugIndex);
  }, [bug, bugIndex, preparePreviewBug, resolved, session.loading, session.view]);

  if (!bug) {
    return (
      <SurfaceCard className="flex flex-col items-center justify-center h-full py-12 text-center">
        <ShieldAlert size={48} className="text-[var(--status-danger)] opacity-20 mb-4" />
        <h3 className="text-lg font-bold text-[var(--text-main)]">Issue Not Found</h3>
        <p className="text-xs text-[var(--text-muted)] mt-2">Could not find the draft for review.</p>
        <button 
          onClick={() => returnToFindings()}
          className="mt-6 rounded-full border border-[var(--card-border)] bg-[var(--surface-soft)] px-4 py-2 text-[var(--status-info)] font-black uppercase text-[10px] tracking-[0.18em]"
        >
          Return to List
        </button>
      </SurfaceCard>
    );
  }

  const isValid = session.validationErrors.length === 0;
  const canGoPrevious = bugIndex !== null && bugIndex > 0;
  const canGoNext = bugIndex !== null && bugIndex < totalBugs - 1;

  return (
    <div className="view-shell animate-in fade-in slide-in-from-right-4 duration-500 pb-40">
      {/* Header */}
      <SurfaceCard className="view-header">
        <button 
          onClick={() => returnToFindings()}
          className="flex items-center gap-2 rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          <span className="text-[10px] font-black uppercase tracking-widest">Back to Findings</span>
        </button>
        <div className="flex items-center gap-2">
          {totalBugs > 1 && (
            <div className="flex items-center gap-1 rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] p-1">
              <button
                type="button"
                onClick={() => bugIndex !== null && preparePreviewBug(bugIndex - 1)}
                disabled={!canGoPrevious}
                className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-35 disabled:cursor-not-allowed"
                aria-label="Preview previous bug"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="min-w-[52px] text-center text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">
                {bugIndex! + 1} / {totalBugs}
              </span>
              <button
                type="button"
                onClick={() => bugIndex !== null && preparePreviewBug(bugIndex + 1)}
                disabled={!canGoNext}
                className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-35 disabled:cursor-not-allowed"
                aria-label="Preview next bug"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
          {totalBugs > 1 && bug && (
            <div className="min-w-0 max-w-[140px] truncate text-[11px] font-medium text-[var(--text-primary)]" title={bug.summary}>
              {bug.summary}
            </div>
          )}
          <div className="flex items-center gap-2 bg-[var(--surface-soft)] border border-[var(--card-border)] px-3 py-1.5 rounded-[8px]">
            <div className={`w-2 h-2 rounded-full ${isValid ? 'bg-[var(--status-success)]' : 'bg-[var(--status-warning)] animate-pulse'}`}></div>
            <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Jira Preview</span>
          </div>
        </div>
      </SurfaceCard>

      <div className="space-y-2">
        <p className="view-kicker">Review</p>
        <h2 className="view-title">Jira Preview</h2>
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          This is exactly how {totalBugs > 1 ? 'this bug' : 'your bug'} will look in <span className="font-bold text-[var(--status-info)]">Jira {session.issueData?.key.split('-')[0]}</span>. 
          Use the <span className="font-bold">Edit Manually</span> button below to change individual fields.
        </p>
      </div>

      {/* Validation Panel */}
      {!isValid && (
        <StatusPanel icon={AlertTriangle} title="Mandatory Fields Missing" tone="danger">
          <ul className="space-y-1">
            {session.validationErrors.map((err, i) => (
              <li key={i} className="text-[11px] text-[var(--status-danger)] font-medium">• {err}</li>
            ))}
          </ul>
        </StatusPanel>
      )}

      {/* Duplicate Detection Panel */}
      <SurfaceCard className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-[var(--text-muted)]" />
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-[var(--text-muted)]">
              Duplicate Check
            </span>
          </div>
          <button
            onClick={() => bugIndex !== null && checkDuplicates(bugIndex)}
            disabled={session.duplicateCheckLoading}
            className="flex items-center gap-1.5 rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-1.5 text-[10px] font-bold text-[var(--status-info)] hover:opacity-80 transition-opacity disabled:opacity-40"
          >
            {session.duplicateCheckLoading ? (
              <><Loader2 size={12} className="animate-spin" /> Checking...</>
            ) : (
              <><Search size={12} /> Check for Duplicates</>
            )}
          </button>
        </div>

        {session.duplicateCheckFailed && (
          <div className="flex items-center gap-2 rounded-[8px] bg-[var(--status-warning)]/8 border border-[var(--status-warning)]/20 px-3 py-2">
            <Info size={12} className="text-[var(--status-warning)] shrink-0" />
            <span className="text-[10px] text-[var(--text-muted)]">
              {session.duplicateCheckFailureReason || 'Duplicate check unavailable. You can still publish.'}
            </span>
          </div>
        )}

        {session.duplicateMatches.length > 0 && (
          <div className="space-y-2">
            {session.duplicateMatches.map((match) => {
              const isHigh = match.confidence === 'high';
              const isMedium = match.confidence === 'medium';
              const borderColor = isHigh
                ? 'border-[var(--status-danger)]/40'
                : isMedium
                ? 'border-[var(--status-warning)]/40'
                : 'border-[var(--card-border)]';
              const bgColor = isHigh
                ? 'bg-[var(--status-danger)]/5'
                : isMedium
                ? 'bg-[var(--status-warning)]/5'
                : 'bg-[var(--surface-soft)]';
              const confidenceColor = isHigh
                ? 'text-[var(--status-danger)]'
                : isMedium
                ? 'text-[var(--status-warning)]'
                : 'text-[var(--text-muted)]';

              return (
                <div key={match.issue_key} className={`rounded-[8px] border ${borderColor} ${bgColor} p-3 space-y-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[9px] font-black uppercase tracking-wider ${confidenceColor}`}>
                        {match.confidence}
                      </span>
                      <span className="text-[10px] font-bold text-[var(--status-info)]">
                        {match.issue_key}
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)] truncate">
                        {match.status}
                      </span>
                    </div>
                    <span className="text-[9px] font-mono text-[var(--text-muted)] shrink-0">
                      {Math.round(match.similarity_score * 100)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-main)] font-medium leading-snug">
                    {match.summary}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)] italic">
                    {match.reason}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    {match.url && (
                      <a
                        href={match.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] px-2.5 py-1 text-[9px] font-bold text-[var(--status-info)] hover:opacity-80"
                      >
                        <ExternalLink size={10} /> Open in Jira
                      </a>
                    )}
                    <button
                      onClick={async () => {
                        const result = await linkToExisting(match.issue_key);
                        if (result?.linked) {
                          updateSession({
                            success: `Linked ${session.issueData?.key} to ${match.issue_key} (${result.link_type_used})`,
                            view: 'main',
                            mainWorkflow: session.gapAnalysisSummary ? 'analysis' : session.mainWorkflow,
                            previewBugIndex: null,
                            duplicateMatches: [],
                          });
                        } else {
                          updateSession({ error: result?.error || 'Could not link issues.' });
                        }
                      }}
                      className="flex items-center gap-1 rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] px-2.5 py-1 text-[9px] font-bold text-[var(--text-muted)] hover:text-[var(--status-info)] hover:opacity-80"
                    >
                      <Link2 size={10} /> Link Instead
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!session.duplicateCheckLoading && !session.duplicateCheckFailed && session.duplicateMatches.length === 0 && (
          <p className="text-[10px] text-[var(--text-muted)] italic">
            Click &quot;Check for Duplicates&quot; to search for similar existing bugs before publishing.
          </p>
        )}
      </SurfaceCard>

      {/* High Fidelity Preview Card */}
      <SurfaceCard className="space-y-5 p-5 pb-14 relative overflow-hidden">
        {/* Issue Type Header */}
        <div className="flex items-center gap-3">
          {session.selectedIssueType?.iconUrl && (
            <img src={session.selectedIssueType.iconUrl} className="w-4 h-4" alt="" />
          )}
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">
            {session.selectedIssueType?.name || 'BUG'} REPORT
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bug.category && (
            <div className="rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">
              {bug.category}
            </div>
          )}
          <div className="rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">
            {bug.severity} severity
          </div>
          {typeof bug.confidence === 'number' && (
            <div className="rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">
              {bug.confidence}% confidence
            </div>
          )}
        </div>

        {/* Summary */}
        <h1 className="text-lg font-black text-[var(--text-main)] leading-tight tracking-normal">
          {resolvedSummary}
        </h1>

        <div className="h-px bg-[var(--border-main)]/50 mr-[-2rem] ml-[-2rem]"></div>

        {/* Core description only. Steps/expected/actual are previewed separately below. */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <AlignLeft size={12} />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">Core Description</span>
          </div>
          <div className="max-w-none bg-[var(--bg-app)]/45 rounded-[8px] p-4 border border-dashed border-[var(--border-main)]/50">
            <JiraMarkdown content={previewDescription} />
          </div>
        </div>

        <div className="h-px bg-[var(--border-main)]/50 mr-[-2rem] ml-[-2rem]"></div>

        {/* Structured Fields for Clarity */}
        <div className="grid grid-cols-1 gap-6 mb-8">
          <div className="space-y-2">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--status-success)]/80">Steps to Reproduce</span>
            <div className="bg-[var(--bg-app)]/50 rounded-[8px] p-4 border border-[var(--border-main)]/50">
              <JiraMarkdown content={previewSteps} />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--status-info)]/80">Expected Result</span>
              <div className="bg-[var(--bg-app)]/50 rounded-[8px] p-4 border border-[var(--border-main)]/50 h-full">
                <JiraMarkdown content={bug.expected_result} />
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--status-danger)]/80">Actual Result</span>
              <div className="bg-[var(--bg-app)]/50 rounded-[8px] p-4 border border-[var(--border-main)]/50 h-full">
                <JiraMarkdown content={bug.actual_result} />
              </div>
            </div>
          </div>
        </div>

        {((bug.acceptance_criteria_refs && bug.acceptance_criteria_refs.length > 0) || (bug.evidence && bug.evidence.length > 0)) && (
          <>
            <div className="h-px bg-[var(--border-main)]/50 mr-[-2rem] ml-[-2rem]"></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(bug.acceptance_criteria_refs && bug.acceptance_criteria_refs.length > 0) && (
                <div className="space-y-2">
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Acceptance Criteria References</span>
                  <div className="bg-[var(--bg-app)]/50 rounded-[8px] p-4 border border-[var(--border-main)]/30 text-[11px] text-[var(--text-secondary)] space-y-1">
                    {bug.acceptance_criteria_refs.map((reference, index) => <div key={`${reference}-${index}`}>• {reference}</div>)}
                  </div>
                </div>
              )}
              {(bug.evidence && bug.evidence.length > 0) && (
                <div className="space-y-2">
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Supporting Evidence</span>
                  <div className="bg-[var(--bg-app)]/50 rounded-[8px] p-4 border border-[var(--border-main)]/30 text-[11px] text-[var(--text-secondary)] space-y-1">
                    {bug.evidence.map((item, index) => <div key={`${item}-${index}`}>• {item}</div>)}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Full Mapped Payload - excluding summary/description */}
        {resolved && Object.keys(resolved).length > 2 && (
          <div className="space-y-4 pt-4">
            <div className="h-px bg-[var(--border-main)]/30 mr-[-2rem] ml-[-2rem]"></div>
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <Layout size={12} />
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">Additional Details</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(resolved).map(([key, val]) => {
                if (key === 'summary' || key === 'description' || key === 'issuetype' || val === null || val === undefined) return null;
                const field = session.jiraMetadata?.fields.find(f => f.key === key);
                const displayVal = resolvePreviewFieldValue(
                  key,
                  val,
                  field,
                  bug.extra_fields,
                  session.fieldDefaults,
                  projectKey
                );

                return (
                  <div key={key} className="flex flex-col gap-1 bg-[var(--bg-app)]/50 p-3 rounded-[8px] border border-[var(--border-main)]/30">
                    <span className="text-[8px] font-black text-[var(--text-muted)] uppercase tracking-wider">{field?.name || key}</span>
                    <span className="text-[10px] font-bold text-[var(--status-info)] truncate">{displayVal}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SurfaceCard>

      {/* Action Bar */}
      <div className="fixed bottom-12 left-0 w-full px-4 pt-6 pb-3 bg-gradient-to-t from-[var(--bg-app)] via-[var(--bg-app)]/96 to-transparent z-[60]">
        <div className="flex gap-3">
          <ActionButton
            onClick={() => returnToFindings(bugIndex)}
            variant="secondary"
            tone="neutral"
            className="flex-1 h-12 rounded-[8px] text-[10px]"
          >
            Edit Manually
          </ActionButton>
          <ActionButton
            onClick={() => submitBugs(bugIndex!)}
            disabled={!isValid || session.loading}
            variant="primary"
            className="flex-[2] h-12 rounded-[8px] text-[10px]"
          >
            {session.loading ? (
              <span className="flex items-center gap-2">
                <Layout className="animate-pulse" size={14} />
                Publishing...
              </span>
            ) : (
              <>
                <Send size={14} />
                Publish to Jira
              </>
            )}
          </ActionButton>
        </div>
        {totalBugs > 1 && (
          <div className="mt-2.5">
            <ActionButton
              onClick={() => submitBugs()}
              disabled={session.loading}
              variant="secondary"
              className="w-full h-11 rounded-[8px] text-[10px]"
            >
              Publish All {totalBugs} Bugs
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
};

export default PreviewView;
