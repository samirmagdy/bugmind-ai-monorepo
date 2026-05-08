import React, { useMemo, useState } from 'react';
import { AlertTriangle, Bookmark, Clock3, History, Play, Save, ShieldCheck, Zap } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { ActionButton, StatusBadge, SurfaceCard } from './DesignSystem';
import {
  addActivity,
  createPresetFromSession,
  getDraftStatus,
  getQualityWarnings,
  getWorkflowLabel
} from '../../utils/productivity';
import { MainWorkflow, WorkspaceTemplate } from '../../types';

function getTemplateBody(template: WorkspaceTemplate): string {
  const body = template.content?.body;
  return typeof body === 'string' ? body : JSON.stringify(template.content || {});
}

const ProductivityPanel: React.FC = () => {
  const { session, updateSession, ai: { usage } } = useBugMind();
  const [presetName, setPresetName] = useState('');
  const draftStatus = getDraftStatus(session);
  const warnings = getQualityWarnings(session);
  const workspace = session.workspaces.find((item) => item.id === session.activeWorkspaceId);
  const templates = workspace?.templates || [];
  const selectedTemplate = templates.find((template) => template.id === session.selectedWorkspaceTemplateId);

  const usageTone = !usage ? 'neutral' : usage.remaining <= 0 ? 'danger' : usage.remaining <= Math.max(1, Math.floor(usage.limit * 0.2)) ? 'warning' : 'success';

  const recentActivity = useMemo(() => (session.activityFeed || []).slice(0, 5), [session.activityFeed]);

  const savePreset = () => {
    const name = presetName.trim() || `${getWorkflowLabel(session.mainWorkflow === 'home' ? 'tests' : session.mainWorkflow)} preset`;
    const preset = createPresetFromSession(session, name);
    updateSession({
      workflowPresets: [preset, ...(session.workflowPresets || [])].slice(0, 12),
      activityFeed: addActivity(session, {
        kind: 'settings',
        title: 'Workflow preset saved',
        detail: name,
        actionView: 'main',
        actionWorkflow: preset.workflow
      })
    });
    setPresetName('');
  };

  const applyPreset = (workflow: MainWorkflow, presetId?: string) => {
    const preset = session.workflowPresets.find((item) => item.id === presetId);
    if (!preset) {
      updateSession({ mainWorkflow: workflow });
      return;
    }
    const selectedIssueType = session.issueTypes.find((item) => item.id === preset.selectedIssueTypeId) || session.selectedIssueType;
    updateSession({
      mainWorkflow: preset.workflow,
      bugGenerationCount: preset.bugGenerationCount,
      testGenerationTypes: preset.testGenerationTypes,
      selectedIssueType,
      xrayTargetProjectId: preset.xrayTargetProjectId || session.xrayTargetProjectId,
      xrayFolderPath: preset.xrayFolderPath || session.xrayFolderPath,
      activityFeed: addActivity(session, {
        kind: 'settings',
        title: 'Workflow preset applied',
        detail: preset.name,
        actionView: 'main',
        actionWorkflow: preset.workflow
      })
    });
  };

  const applyTemplate = (templateId: number | null) => {
    const template = templates.find((item) => item.id === templateId);
    const content = template ? getTemplateBody(template).trim() : '';
    updateSession({
      selectedWorkspaceTemplateId: templateId,
      generationSupportingContext: content
        ? [session.generationSupportingContext, `Workspace template: ${template?.name}\n${content}`].filter(Boolean).join('\n\n')
        : session.generationSupportingContext,
      activityFeed: template ? addActivity(session, {
        kind: 'settings',
        title: 'Workspace template applied',
        detail: template.name,
        actionView: 'main',
        actionWorkflow: session.mainWorkflow
      }) : session.activityFeed
    });
  };

  return (
    <div className="space-y-3">
      <SurfaceCard className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="view-kicker">Daily Workflow</p>
            <h3 className="workflow-card-title">Status and shortcuts</h3>
            <p className="workflow-card-subtitle">Recover drafts, watch quality, and reuse repeat setup.</p>
          </div>
          <StatusBadge tone={draftStatus.tone}>{draftStatus.label}</StatusBadge>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <Bookmark size={12} /> Draft
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{draftStatus.detail}</div>
          </div>
          <div className="rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-soft)] p-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <Zap size={12} /> Usage
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--text-secondary)]">
                {usage ? `${usage.remaining}/${usage.limit} left` : 'Loading quota'}
              </span>
              {usage && <StatusBadge tone={usageTone}>{usage.plan}</StatusBadge>}
            </div>
          </div>
        </div>
      </SurfaceCard>

      {warnings.length > 0 && (
        <SurfaceCard className="space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-[var(--warning)]" />
            <span className="view-kicker">Preflight Warnings</span>
          </div>
          {warnings.map((warning) => (
            <div key={`${warning.title}-${warning.detail}`} className="rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-[var(--text-primary)]">{warning.title}</span>
                <StatusBadge tone={warning.tone}>{warning.tone}</StatusBadge>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">{warning.detail}</p>
            </div>
          ))}
        </SurfaceCard>
      )}

      <SurfaceCard className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="view-kicker">Presets</p>
            <h3 className="workflow-card-title">Repeat workflow setup</h3>
          </div>
          <ActionButton onClick={savePreset} variant="secondary" className="h-8 px-3 text-[10px]">
            <Save size={12} /> Save
          </ActionButton>
        </div>
        <input
          value={presetName}
          onChange={(event) => setPresetName(event.target.value)}
          className="form-input px-3 py-2 text-xs"
          placeholder="Preset name, e.g. Sprint regression"
          aria-label="Workflow preset name"
        />
        {session.workflowPresets.length > 0 && (
          <div className="space-y-2">
            {session.workflowPresets.slice(0, 4).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.workflow, preset.id)}
                className="flex w-full items-center justify-between gap-3 rounded-[8px] border border-[var(--border-soft)] bg-[var(--bg-input)] px-3 py-2 text-left hover:border-[var(--border-active)]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold text-[var(--text-primary)]">{preset.name}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{getWorkflowLabel(preset.workflow)}</span>
                </span>
                <Play size={12} className="text-[var(--primary-blue)]" />
              </button>
            ))}
          </div>
        )}
      </SurfaceCard>

      {templates.length > 0 && (
        <SurfaceCard className="space-y-3">
          <div>
            <p className="view-kicker">Workspace Templates</p>
            <h3 className="workflow-card-title">Apply team style</h3>
          </div>
          <select
            value={selectedTemplate?.id || ''}
            onChange={(event) => applyTemplate(event.target.value ? Number(event.target.value) : null)}
            className="form-input px-3 py-2 text-xs"
            aria-label="Workspace template"
          >
            <option value="">No template applied</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </SurfaceCard>
      )}

      <SurfaceCard className="space-y-2">
        <div className="flex items-center gap-2">
          <History size={14} className="text-[var(--primary-blue)]" />
          <span className="view-kicker">Recent Activity</span>
        </div>
        {recentActivity.length > 0 ? recentActivity.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => item.actionView && updateSession({ view: item.actionView, mainWorkflow: item.actionWorkflow || session.mainWorkflow })}
            className="flex w-full items-start gap-3 rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2 text-left"
          >
            <Clock3 size={12} className="mt-0.5 text-[var(--text-muted)]" />
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-bold text-[var(--text-primary)]">{item.title}</span>
              <span className="block truncate text-[10px] text-[var(--text-muted)]">{item.detail || item.issueKey || new Date(item.createdAt).toLocaleString()}</span>
            </span>
          </button>
        )) : (
          <div className="rounded-[8px] border border-dashed border-[var(--border-main)] p-4 text-center text-[11px] text-[var(--text-muted)]">
            Recent work will appear here after generation, publish, or setup changes.
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-[var(--success)]" />
          <span className="view-kicker">Message History</span>
        </div>
        {(session.toastHistory || []).length > 0 ? (session.toastHistory || []).slice(0, 4).map((toast) => (
          <div key={toast.id} className="rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-soft)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-[var(--text-primary)]">{toast.title}</span>
              <StatusBadge tone={toast.tone === 'error' ? 'danger' : toast.tone === 'success' ? 'success' : 'info'}>{toast.tone}</StatusBadge>
            </div>
            {toast.detail && <p className="mt-1 line-clamp-2 text-[10px] text-[var(--text-muted)]">{toast.detail}</p>}
          </div>
        )) : (
          <div className="rounded-[8px] border border-dashed border-[var(--border-main)] p-4 text-center text-[11px] text-[var(--text-muted)]">
            Success and error messages will be saved here during this session.
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

export default ProductivityPanel;
