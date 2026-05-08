import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, ClipboardList, Cog, History, Layout, Search, X, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { getWorkflowLabel } from '../../utils/productivity';
import { MainWorkflow, View } from '../../types';
import { buildAnalyticsEvent, sendProductEvent } from '../../services/productEvents';

type Command = {
  id: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  run: () => void;
};

const CommandPalette: React.FC = () => {
  const { session, updateSession, auth: { apiBase, authToken, refreshSession }, ai: { fetchAISettings } } = useBugMind();
  const [query, setQuery] = useState('');

  const goView = useCallback((view: View) => updateSession({ view, commandPaletteOpen: false }), [updateSession]);
  const goWorkflow = useCallback((workflow: MainWorkflow) => updateSession({ view: 'main', mainWorkflow: workflow, commandPaletteOpen: false }), [updateSession]);
  const runCommand = useCallback((command: Command) => {
    command.run();
    sendProductEvent({
      apiBase,
      authToken,
      refreshSession,
    }, buildAnalyticsEvent(session, 'command_palette_action', { commandId: command.id, query }), 'analytics').catch(() => undefined);
  }, [apiBase, authToken, query, refreshSession, session]);

  const commands = useMemo<Command[]>(() => [
    { id: 'work', label: 'Open Work', detail: 'Return to current Jira workflow', icon: Briefcase, run: () => goView('main') },
    { id: 'tests', label: getWorkflowLabel('tests'), detail: 'Generate Xray-ready test cases', icon: ClipboardList, run: () => goWorkflow('tests') },
    { id: 'analysis', label: getWorkflowLabel('analysis'), detail: 'Find gaps, risks, and edge cases', icon: Zap, run: () => goWorkflow('analysis') },
    { id: 'manual', label: getWorkflowLabel('manual'), detail: 'Create Jira-ready bug reports from notes', icon: Zap, run: () => goWorkflow('manual') },
    { id: 'bulk', label: getWorkflowLabel('bulk'), detail: 'Run epic-level QA workflows', icon: Layout, run: () => goWorkflow('bulk') },
    { id: 'jobs', label: 'Background Jobs', detail: 'Review running, failed, and completed jobs', icon: History, run: () => goView('jobs') },
    { id: 'workspace', label: 'Workspace', detail: 'Members, templates, shared connections, audit', icon: Layout, run: () => goView('workspace') },
    { id: 'settings', label: 'Settings', detail: 'AI, Jira mappings, Xray, connections, teams', icon: Cog, run: () => { fetchAISettings(); goView('settings'); } }
  ], [fetchAISettings, goView, goWorkflow]);

  const filtered = useMemo(() => commands.filter((command) => {
    const haystack = `${command.label} ${command.detail}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [commands, query]);

  useEffect(() => {
    if (!session.commandPaletteOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') updateSession({ commandPaletteOpen: false });
      if (event.key === 'Enter' && filtered[0]) runCommand(filtered[0]);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filtered, runCommand, session.commandPaletteOpen, updateSession]);

  useEffect(() => {
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        updateSession({ commandPaletteOpen: true });
        sendProductEvent({
          apiBase,
          authToken,
          refreshSession,
        }, buildAnalyticsEvent(session, 'command_palette_opened'), 'analytics').catch(() => undefined);
      }
    };
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, [apiBase, authToken, refreshSession, session, updateSession]);

  if (!session.commandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-[2100] bg-[var(--bg-overlay)] backdrop-blur-[12px] px-3 py-8" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="mx-auto max-w-md overflow-hidden rounded-[8px] border border-[var(--card-border)] bg-[var(--bg-elevated)]">
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3 py-2">
          <Search size={15} className="text-[var(--text-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-10 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none"
            placeholder="Search actions..."
            aria-label="Search actions"
          />
          <button type="button" onClick={() => updateSession({ commandPaletteOpen: false })} className="icon-button" aria-label="Close command palette">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2" role="listbox" aria-label="Available actions">
          {filtered.length > 0 ? filtered.map((command, index) => {
            const Icon = command.icon;
            return (
              <button
                key={command.id}
                type="button"
                onClick={() => runCommand(command)}
                className="flex w-full items-center gap-3 rounded-[8px] px-3 py-2.5 text-left hover:bg-[var(--surface-soft)]"
                role="option"
                aria-selected={index === 0 ? 'true' : 'false'}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-accent-strong)] text-[var(--primary-blue)]">
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[var(--text-primary)]">{command.label}</span>
                  <span className="block truncate text-[10px] text-[var(--text-muted)]">{command.detail}</span>
                </span>
              </button>
            );
          }) : (
            <div className="rounded-[8px] border border-dashed border-[var(--border-main)] p-5 text-center">
              <p className="text-xs font-bold text-[var(--text-primary)]">No matching actions</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">Try “jobs”, “tests”, “workspace”, or “settings”.</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border-soft)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
          <span>Enter to open first result</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
