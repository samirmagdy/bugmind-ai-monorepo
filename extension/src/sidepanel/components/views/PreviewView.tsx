import React from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { 
  ArrowLeft, AlertTriangle, Send,
  Layout, AlignLeft, ShieldAlert
} from 'lucide-react';
import JiraMarkdown from '../common/JiraMarkdown';
import { ResolvedFieldValue } from '../../types';

function hasResolvedField(
  fields: Record<string, ResolvedFieldValue> | undefined,
  key: string
): fields is Record<string, ResolvedFieldValue> {
  return Boolean(fields) && Object.prototype.hasOwnProperty.call(fields, key);
}

function formatResolvedFieldValue(value: ResolvedFieldValue): string {
  if (Array.isArray(value)) {
    return `${value.length} items selected`;
  }

  if (value === '') {
    return '(empty)';
  }

  if (value && typeof value === 'object') {
    if ('name' in value && typeof value.name === 'string') return value.name;
    if ('value' in value && typeof value.value === 'string') return value.value;
    if ('id' in value && typeof value.id === 'string') return value.id;
    return JSON.stringify(value);
  }

  return String(value);
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
  const { session, updateSession, ai: { submitBugs } } = useBugMind();
  
  const bugIndex = session.previewBugIndex;
  const bug = bugIndex !== null ? session.bugs[bugIndex] : null;
  const resolved = session.resolvedPayload?.fields;
  const resolvedSummary = hasResolvedField(resolved, 'summary') ? formatResolvedFieldValue(resolved.summary) : bug?.summary ?? '';
  const previewDescription = bug?.description ?? '';
  const previewSteps = formatStepsForPreview(bug?.steps_to_reproduce);
  
  if (!bug) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 text-center">
        <ShieldAlert size={48} className="text-[var(--status-danger)] opacity-20 mb-4" />
        <h3 className="text-lg font-bold text-[var(--text-main)]">Issue Not Found</h3>
        <p className="text-xs text-[var(--text-muted)] mt-2">Could not find the draft for review.</p>
        <button 
          onClick={() => updateSession({ view: 'main' })}
          className="mt-6 text-[var(--status-info)] font-black uppercase text-[10px] tracking-widest"
        >
          Return to List
        </button>
      </div>
    );
  }

  const isValid = session.validationErrors.length === 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500 pb-48">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button 
          onClick={() => updateSession({ view: 'main' })}
          className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          <span className="text-[10px] font-black uppercase tracking-widest">Back to Findings</span>
        </button>
        <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--border-main)] px-3 py-1 rounded-full shadow-sm">
          <div className={`w-2 h-2 rounded-full ${isValid ? 'bg-[var(--status-success)]' : 'bg-[var(--status-warning)] animate-pulse'}`}></div>
          <span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Jira Preview</span>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-black text-[var(--text-main)] tracking-tight">Jira Preview</h2>
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
          This is exactly how your bug will look in <span className="font-bold text-[var(--status-info)]">Jira {session.issueData?.key.split('-')[0]}</span>. 
          Use the <span className="font-bold">Edit Manually</span> button below to change individual fields.
        </p>
      </div>

      {/* Validation Panel */}
      {!isValid && (
        <div className="bg-[var(--status-danger)]/5 border border-[var(--status-danger)]/20 rounded-none p-4 space-y-3">
          <div className="flex items-center gap-2 text-[var(--status-danger)] font-black text-[10px] uppercase tracking-widest">
            <AlertTriangle size={14} />
            Mandatory Fields Missing
          </div>
          <ul className="space-y-1">
            {session.validationErrors.map((err, i) => (
              <li key={i} className="text-[11px] text-[var(--status-danger)] font-medium">• {err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* High Fidelity Preview Card */}
      <div className="space-y-6 bg-[var(--bg-card)] border border-[var(--border-main)] rounded-none p-8 pb-16 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-transparent via-[var(--status-info)]/30 to-transparent"></div>
        
        {/* Issue Type Header */}
        <div className="flex items-center gap-3">
          {session.selectedIssueType?.iconUrl && (
            <img src={session.selectedIssueType.iconUrl} className="w-4 h-4" alt="" />
          )}
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">
            {session.selectedIssueType?.name || 'BUG'} REPORT
          </span>
        </div>

        {/* Summary */}
        <h1 className="text-xl font-black text-[var(--text-main)] leading-tight tracking-tight">
          {resolvedSummary}
        </h1>

        <div className="h-px bg-[var(--border-main)]/50 mr-[-2rem] ml-[-2rem]"></div>

        {/* Core description only. Steps/expected/actual are previewed separately below. */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <AlignLeft size={12} />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">Core Description</span>
          </div>
          <div className="prose prose-invert max-w-none bg-[var(--bg-app)]/20 rounded-none p-4 border border-dashed border-[var(--border-main)]/50">
            <JiraMarkdown content={previewDescription} />
          </div>
        </div>

        <div className="h-px bg-[var(--border-main)]/50 mr-[-2rem] ml-[-2rem]"></div>

        {/* Structured Fields for Clarity */}
        <div className="grid grid-cols-1 gap-6 mb-8">
          <div className="space-y-2">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--status-success)]/80">Steps to Reproduce</span>
            <div className="bg-[var(--bg-app)]/40 rounded-none p-4 border border-[var(--border-main)]/50">
              <JiraMarkdown content={previewSteps} />
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--status-info)]/80">Expected Result</span>
              <div className="bg-[var(--bg-app)]/40 rounded-none p-4 border border-[var(--border-main)]/50 h-full">
                <JiraMarkdown content={bug.expected_result} />
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--status-danger)]/80">Actual Result</span>
              <div className="bg-[var(--bg-app)]/40 rounded-none p-4 border border-[var(--border-main)]/50 h-full">
                <JiraMarkdown content={bug.actual_result} />
              </div>
            </div>
          </div>
        </div>

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
                const displayVal = formatResolvedFieldValue(val);

                return (
                  <div key={key} className="flex flex-col gap-1 bg-[var(--bg-app)]/40 p-3 rounded-none border border-[var(--border-main)]/30">
                    <span className="text-[8px] font-black text-[var(--text-muted)] uppercase tracking-wider">{field?.name || key}</span>
                    <span className="text-[10px] font-bold text-[var(--status-info)] truncate">{displayVal}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Action Bar */}
      <div className="fixed bottom-10 left-0 w-full p-6 bg-gradient-to-t from-[var(--bg-app)] via-[var(--bg-app)] to-transparent pt-10 z-[60]">
        <div className="flex gap-3">
          <button 
            onClick={() => updateSession({ view: 'main', expandedBug: bugIndex })}
            className="flex-1 bg-[var(--bg-card)] border border-[var(--border-main)] text-[var(--text-main)] font-black py-4 rounded-[1.5rem] shadow-lg hover:shadow-xl transition-all active:scale-95 uppercase text-[10px] tracking-widest"
          >
            Edit Manually
          </button>
          <button 
            onClick={() => submitBugs(bugIndex!)}
            disabled={!isValid || session.loading}
            className="flex-[2] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-black py-4 rounded-[1.5rem] shadow-xl shadow-[var(--accent)]/20 transition-all enabled:hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-3 uppercase text-[10px] tracking-widest"
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
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreviewView;
