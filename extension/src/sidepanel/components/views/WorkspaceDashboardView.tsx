import React, { useEffect, useState, useCallback } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { Activity, BarChart3, Link2, Shield, Layout, Plus, Trash2, Loader2 } from 'lucide-react';
import { ActionButton, StatusBadge, StatusPanel, SurfaceCard } from '../common/DesignSystem';
import { JiraConnection, Workspace, WorkspaceTemplateAssignment } from '../../types';
import { apiRequest, getErrorMessage, readJsonResponse, throwApiErrorResponse } from '../../services/api';

interface WorkspaceAuditLog {
  id: number;
  user_id: number | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface WorkspaceUsage {
  members_count: number;
  templates_count: number;
  shared_connections_count: number;
  jobs_count: number;
  audit_events_count: number;
}

export const WorkspaceDashboardView: React.FC = () => {
  const { session, updateSession, auth: { apiBase, authToken, refreshSession } } = useBugMind();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'members' | 'connections' | 'templates' | 'audit'>('members');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('viewer');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sharedConnections, setSharedConnections] = useState<JiraConnection[]>([]);
  const [auditLogs, setAuditLogs] = useState<WorkspaceAuditLog[]>([]);
  const [usage, setUsage] = useState<WorkspaceUsage | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateType, setTemplateType] = useState<'bug' | 'test' | 'preset' | 'style'>('test');
  const [templateBody, setTemplateBody] = useState('');
  const [assignmentTemplateId, setAssignmentTemplateId] = useState('');
  const [assignmentProjectKey, setAssignmentProjectKey] = useState('');
  const [assignmentIssueTypeId, setAssignmentIssueTypeId] = useState('');
  const [assignmentWorkflow, setAssignmentWorkflow] = useState('');
  const [assignmentDefault, setAssignmentDefault] = useState(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const activeRole = session.activeWorkspaceRole || workspace?.role || null;
  const canManageMembers = activeRole === 'owner' || activeRole === 'admin';
  const canManageTemplates = canManageMembers || activeRole === 'qa_lead';
  const workspaceSummary = `${workspace?.members?.length || 0} members / ${workspace?.templates?.length || 0} templates / ${workspace?.template_assignments?.length || 0} rules`;

  const request = useCallback((url: string, options: RequestInit = {}) => {
    return apiRequest(url, {
      ...options,
      token: authToken,
      onUnauthorized: refreshSession,
    });
  }, [authToken, refreshSession]);

  const showError = (err: unknown, fallback: string) => {
    const message = getErrorMessage(err);
    setNotice({ type: 'error', message: message === 'Unknown error occurred' ? fallback : message });
  };

  const fetchWorkspace = useCallback(async () => {
    if (!session.activeWorkspaceId) {
        setLoading(false);
        return;
    }
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}`);
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to fetch workspace');
      const nextWorkspace = await readJsonResponse<Workspace>(res);
      setWorkspace(nextWorkspace);
      const existingWorkspace = (session.workspaces || []).find((item) => item.id === nextWorkspace.id);
      if (JSON.stringify(existingWorkspace) !== JSON.stringify(nextWorkspace)) {
        updateSession({
          workspaces: [
            nextWorkspace,
            ...(session.workspaces || []).filter((item) => item.id !== nextWorkspace.id)
          ]
        });
      }
    } catch (err) {
      console.error('Failed to fetch workspace', err);
      showError(err, 'Failed to fetch workspace');
    } finally {
      setLoading(false);
    }
  }, [session.activeWorkspaceId, session.workspaces, apiBase, request, updateSession]);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  const fetchWorkspaceAdminData = useCallback(async () => {
    if (!session.activeWorkspaceId) return;
    try {
      const [connectionsRes, auditRes, usageRes] = await Promise.all([
        request(`${apiBase}/workspaces/${session.activeWorkspaceId}/connections`),
        request(`${apiBase}/workspaces/${session.activeWorkspaceId}/audit-logs`),
        request(`${apiBase}/workspaces/${session.activeWorkspaceId}/usage`),
      ]);
      if (connectionsRes.ok) setSharedConnections(await readJsonResponse<JiraConnection[]>(connectionsRes));
      if (auditRes.ok) setAuditLogs(await readJsonResponse<WorkspaceAuditLog[]>(auditRes));
      if (usageRes.ok) setUsage(await readJsonResponse<WorkspaceUsage>(usageRes));
    } catch (err) {
      console.error('Failed to fetch workspace admin data', err);
      showError(err, 'Failed to fetch workspace admin data');
    }
  }, [apiBase, request, session.activeWorkspaceId]);

  useEffect(() => {
    if (activeTab === 'connections' || activeTab === 'audit') {
      fetchWorkspaceAdminData();
    }
  }, [activeTab, fetchWorkspaceAdminData]);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}/members?email=${encodeURIComponent(inviteEmail)}&role=${inviteRole}`, {
        method: 'POST',
      });
      if (res.ok) {
        setInviteEmail('');
        setNotice({ type: 'success', message: 'Member invited.' });
        fetchWorkspace();
      } else {
        await throwApiErrorResponse(res, 'Failed to invite user');
      }
    } catch (err) {
      showError(err, 'Error inviting user');
    }
  };

  const removeMember = async (userId: number) => {
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}/members/${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to remove member');
      if (res.ok) fetchWorkspace();
    } catch (err) {
      console.error('Failed to remove member', err);
      showError(err, 'Failed to remove member');
    }
  };

  const changeRole = async (userId: number, newRole: string) => {
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole })
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to change member role');
      if (res.ok) fetchWorkspace();
    } catch (err) {
      console.error('Failed to change role', err);
      showError(err, 'Failed to change member role');
    }
  };

  const createTemplate = async () => {
    if (!templateName.trim()) return;
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}/templates`, {
        method: 'POST',
        body: JSON.stringify({
          name: templateName.trim(),
          template_type: templateType,
          content: { body: templateBody.trim() }
        })
      });
      if (res.ok) {
        setTemplateName('');
        setTemplateBody('');
        setNotice({ type: 'success', message: 'Template saved.' });
        fetchWorkspace();
      } else {
        await throwApiErrorResponse(res, 'Failed to create template');
      }
    } catch (err) {
      showError(err, 'Error creating template');
    }
  };

  const deleteTemplate = async (templateId: number) => {
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}/templates/${templateId}`, {
        method: 'DELETE',
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to delete template');
      if (res.ok) fetchWorkspace();
    } catch (err) {
      showError(err, 'Failed to delete template');
    }
  };

  const createTemplateAssignment = async () => {
    if (!assignmentTemplateId) return;
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}/template-assignments`, {
        method: 'POST',
        body: JSON.stringify({
          template_id: Number(assignmentTemplateId),
          project_key: assignmentProjectKey.trim() || null,
          issue_type_id: assignmentIssueTypeId.trim() || null,
          workflow: assignmentWorkflow || null,
          is_default: assignmentDefault,
        })
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to create template rule');
      setAssignmentTemplateId('');
      setAssignmentProjectKey('');
      setAssignmentIssueTypeId('');
      setAssignmentWorkflow('');
      setAssignmentDefault(false);
      setNotice({ type: 'success', message: 'Template rule saved.' });
      fetchWorkspace();
    } catch (err) {
      showError(err, 'Failed to create template rule');
    }
  };

  const deleteTemplateAssignment = async (assignmentId: number) => {
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}/template-assignments/${assignmentId}`, {
        method: 'DELETE',
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to delete template rule');
      fetchWorkspace();
    } catch (err) {
      showError(err, 'Failed to delete template rule');
    }
  };

  const shareConnection = async (connectionId: number) => {
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}/connections/${connectionId}/share`, {
        method: 'POST',
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to share connection');
      if (res.ok) fetchWorkspaceAdminData();
    } catch (err) {
      showError(err, 'Failed to share connection');
    }
  };

  const unshareConnection = async (connectionId: number) => {
    try {
      const res = await request(`${apiBase}/workspaces/${session.activeWorkspaceId}/connections/${connectionId}/share`, {
        method: 'DELETE',
      });
      if (!res.ok) await throwApiErrorResponse(res, 'Failed to unshare connection');
      if (res.ok) fetchWorkspaceAdminData();
    } catch (err) {
      showError(err, 'Failed to unshare connection');
    }
  };

  if (loading && !workspace) {
    return (
      <StatusPanel
        icon={Loader2}
        title="Loading workspace"
        description="Fetching members, templates, connections, and rules."
        className="[&_.empty-icon_svg]:animate-spin"
      />
    );
  }

  if (!workspace) {
    return (
      <div className="p-4 text-center space-y-4">
        <div className="w-12 h-12 rounded-[8px] bg-[var(--surface-soft)] flex items-center justify-center mx-auto text-[var(--text-muted)]">
            <Layout size={24} />
        </div>
        <div>
            <h2 className="text-sm font-bold text-[var(--text-main)]">No Workspace Selected</h2>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">Select a workspace from settings to collaborate with your team.</p>
        </div>
        <ActionButton variant="primary" onClick={() => updateSession({ view: 'settings' })}>Go to Settings</ActionButton>
      </div>
    );
  }

  return (
    <div className="view-shell animate-in fade-in slide-in-from-bottom-2 duration-300">
      <SurfaceCard className="view-header">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-accent-strong)] text-[var(--primary-blue)]">
            <Layout size={18} />
          </div>
          <div className="view-heading">
            <p className="view-kicker">Workspace</p>
            <h2 className="view-title truncate max-w-[190px]">{workspace.name}</h2>
            <p className="view-subtitle">{workspaceSummary}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => updateSession({ view: 'main' })}
          className="rounded-[8px] border border-[var(--card-border)] bg-[var(--surface-soft)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          Back
        </button>
      </SurfaceCard>

      {notice && (
        <div className={`rounded-xl border px-3 py-2 text-[11px] font-medium ${
          notice.type === 'error'
            ? 'border-[var(--error)]/20 bg-[var(--error)]/10 text-[var(--error)]'
            : 'border-[var(--success)]/20 bg-[var(--success)]/10 text-[var(--success)]'
        }`} role={notice.type === 'error' ? 'alert' : 'status'} aria-live={notice.type === 'error' ? 'assertive' : 'polite'}>
          {notice.message}
        </div>
      )}

      {/* Tabs */}
      <div className="view-tabs grid-cols-4" role="tablist" aria-label="Workspace sections">
        <button 
          type="button"
          onClick={() => setActiveTab('members')}
          className={`view-tab ${activeTab === 'members' ? 'view-tab-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'members'}
        >
          Members
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('connections')}
          className={`view-tab ${activeTab === 'connections' ? 'view-tab-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'connections'}
        >
          Connections
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('templates')}
          className={`view-tab ${activeTab === 'templates' ? 'view-tab-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'templates'}
        >
          Templates
        </button>
        <button 
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`view-tab ${activeTab === 'audit' ? 'view-tab-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'audit'}
        >
          Audit
        </button>
      </div>

      {activeTab === 'members' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Invite Section */}
          {canManageMembers && (
              <SurfaceCard className="p-3 bg-[var(--surface-soft)] border-dashed">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                  <Plus size={12} /> Invite Member
                </h3>
                <div className="grid grid-cols-[minmax(0,1fr)_118px] gap-2">
                  <div className="min-w-0">
                    <input 
                      placeholder="user@example.com"
                      value={inviteEmail}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInviteEmail(e.target.value)}
                      className="h-10 w-full min-w-0 bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 text-xs text-[var(--text-primary)] outline-none"
                      aria-label="Invite member email"
                    />
                  </div>
                  <select 
                    value={inviteRole}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setInviteRole(e.target.value)}
                    className="h-10 w-full bg-[var(--bg-input)] text-[11px] border border-[var(--border-main)] rounded-xl px-2 text-[var(--text-main)] outline-none"
                    aria-label="Invite member role"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="qa_engineer">Engineer</option>
                    <option value="qa_lead">Lead</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleInvite}
                    disabled={!inviteEmail.trim()}
                    className="col-span-2 flex h-10 w-full items-center justify-center rounded-xl bg-[var(--primary-gradient)] px-3 text-xs font-bold text-white shadow-[var(--shadow-button)] disabled:cursor-not-allowed disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-text)] disabled:shadow-none"
                  >
                    Invite
                  </button>
                </div>
              </SurfaceCard>
          )}

          {/* Members List */}
          <div className="space-y-2">
            {workspace.members?.map(member => (
              <SurfaceCard key={member.id} className="p-3 flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[var(--primary-blue)]/10 flex items-center justify-center text-[var(--primary-blue)] font-bold text-xs uppercase">
                    {member.email?.[0]}
                  </div>
                  <div className="overflow-hidden">
                    <div className="text-xs font-semibold text-[var(--text-main)] truncate max-w-[120px]">{member.email}</div>
                    <div className="text-[10px] text-[var(--text-muted)] capitalize">{member.role.replace(/_/g, ' ')}</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {canManageMembers && member.role !== 'owner' ? (
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <select 
                        value={member.role}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => changeRole(member.user_id, e.target.value)}
                        className="bg-transparent text-[10px] font-bold text-[var(--primary-blue)] border-none outline-none cursor-pointer"
                        aria-label={`Change role for ${member.email || 'workspace member'}`}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="qa_engineer">Engineer</option>
                        <option value="qa_lead">Lead</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button 
                        type="button"
                        onClick={() => setConfirmAction({
                          title: 'Remove member',
                          message: `Remove ${member.email || 'this member'} from the workspace?`,
                          onConfirm: () => removeMember(member.user_id),
                        })}
                        className="p-1.5 hover:bg-[var(--error)]/10 rounded text-[var(--error)]"
                        aria-label={`Remove ${member.email || 'workspace member'}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ) : member.role === 'owner' ? (
                    <Shield size={12} className="text-[var(--primary-blue)]" />
                  ) : null}
                </div>
              </SurfaceCard>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'connections' && (
        <div className="space-y-3 animate-in fade-in duration-200">
           <p className="text-[10px] text-[var(--text-muted)] px-1 italic">Shared Jira/Xray connections for this workspace.</p>
           <div className="space-y-2">
            {sharedConnections.length === 0 ? (
                <StatusPanel
                  icon={Link2}
                  title="No shared connections"
                  description="Share a Jira or Xray connection so workspace members can use the same setup."
                />
            ) : sharedConnections.map(conn => (
              <SurfaceCard key={conn.id} className="p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--text-main)] truncate">{conn.host_url}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{conn.username}</div>
                </div>
                  {canManageMembers && (
                  <button type="button" onClick={() => unshareConnection(conn.id)} className="p-1.5 hover:bg-[var(--error)]/10 rounded text-[var(--error)]" aria-label="Unshare connection">
                    <Trash2 size={12} />
                  </button>
                )}
              </SurfaceCard>
            ))}
           </div>
           {canManageMembers && (
            <SurfaceCard className="p-3 bg-[var(--surface-soft)] border-dashed">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                <Link2 size={12} /> Share Personal Connection
              </h3>
              <div className="flex flex-wrap gap-2">
                {session.connections.filter(conn => !conn.is_shared).map(conn => (
                  <button key={conn.id} type="button" onClick={() => shareConnection(conn.id)} className="rounded-lg border border-[var(--border-main)] px-2.5 py-1 text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--primary-blue)]">
                    {conn.host_url}
                  </button>
                ))}
              </div>
            </SurfaceCard>
           )}
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-3 animate-in fade-in duration-200">
           <p className="text-[10px] text-[var(--text-muted)] px-1 italic">Workspace templates for consistent QA style.</p>
           {canManageTemplates && (
            <SurfaceCard className="p-3 bg-[var(--surface-soft)] border-dashed space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2">
                <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" className="h-9 min-w-0 bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg px-3 text-xs text-[var(--text-primary)] outline-none" aria-label="Template name" />
                <select value={templateType} onChange={(e) => setTemplateType(e.target.value as typeof templateType)} className="h-9 bg-[var(--bg-input)] text-[10px] border border-[var(--border-main)] rounded-lg px-2 text-[var(--text-main)] outline-none" aria-label="Template type">
                  <option value="bug">Bug</option>
                  <option value="test">Test</option>
                  <option value="preset">Preset</option>
                  <option value="style">Style</option>
                </select>
              </div>
              <textarea value={templateBody} onChange={(e) => setTemplateBody(e.target.value)} placeholder="Template content or prompt preset" className="w-full min-h-16 resize-y bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] outline-none" aria-label="Template content" />
              <button
                type="button"
                onClick={createTemplate}
                disabled={!templateName.trim()}
                className="flex h-9 w-full items-center justify-center rounded-lg bg-[var(--primary-gradient)] px-3 text-[10px] font-bold uppercase tracking-wider text-white shadow-[var(--shadow-button)] disabled:cursor-not-allowed disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-text)] disabled:shadow-none"
              >
                Save Template
              </button>
            </SurfaceCard>
           )}
           <div className="space-y-2">
              {workspace.templates && workspace.templates.length > 0 ? workspace.templates.map(template => (
                <SurfaceCard key={template.id} className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--text-main)] truncate">{template.name}</div>
                    <div className="text-[10px] text-[var(--text-muted)] uppercase">{template.template_type}</div>
                    <div className="mt-1 line-clamp-2 text-[10px] text-[var(--text-secondary)]">{String(template.content?.body || '')}</div>
                  </div>
                  {canManageTemplates && (
                    <button
                      type="button"
                      onClick={() => setConfirmAction({
                        title: 'Delete template',
                        message: `Delete "${template.name}"? This cannot be undone.`,
                        onConfirm: () => deleteTemplate(template.id),
                      })}
                      className="p-1.5 hover:bg-[var(--error)]/10 rounded text-[var(--error)]"
                      aria-label="Delete template"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </SurfaceCard>
              )) : (
                <StatusPanel
                  title="No workspace templates"
                  description="Save templates for bug reports, test cases, presets, and team writing style."
                />
              )}
           </div>
           <SurfaceCard className="space-y-3">
              <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[11px] font-bold text-[var(--text-main)]">Assignment Rules</h3>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">Apply the right template by project, issue type, or workflow.</p>
              </div>
              <StatusBadge tone={(workspace.template_assignments || []).length > 0 ? 'success' : 'neutral'}>
                {(workspace.template_assignments || []).length} rules
              </StatusBadge>
            </div>
            {canManageTemplates && workspace.templates && workspace.templates.length > 0 && (
              <div className="space-y-2 rounded-[8px] border border-dashed border-[var(--border-main)] bg-[var(--surface-soft)] p-3">
                <select value={assignmentTemplateId} onChange={(e) => setAssignmentTemplateId(e.target.value)} className="form-input px-3 py-2 text-xs" aria-label="Rule template">
                  <option value="">Choose template</option>
                  {workspace.templates.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input value={assignmentProjectKey} onChange={(e) => setAssignmentProjectKey(e.target.value.toUpperCase())} placeholder="Project key" className="form-input px-3 py-2 text-xs" aria-label="Rule project key" />
                  <select value={assignmentWorkflow} onChange={(e) => setAssignmentWorkflow(e.target.value)} className="form-input px-3 py-2 text-xs" aria-label="Rule workflow">
                    <option value="">Any workflow</option>
                    <option value="manual">Bug reports</option>
                    <option value="analysis">Gap analysis</option>
                    <option value="tests">Test cases</option>
                    <option value="bulk">Bulk workflows</option>
                  </select>
                </div>
                <input value={assignmentIssueTypeId} onChange={(e) => setAssignmentIssueTypeId(e.target.value)} placeholder="Issue type ID (optional)" className="form-input px-3 py-2 text-xs" aria-label="Rule issue type ID" />
                <label className="flex items-center gap-2 text-[11px] font-semibold text-[var(--text-secondary)]">
                  <input type="checkbox" checked={assignmentDefault} onChange={(e) => setAssignmentDefault(e.target.checked)} />
                  Use as default when no specific rule matches
                </label>
                <button
                  type="button"
                  onClick={createTemplateAssignment}
                  disabled={!assignmentTemplateId}
                  className="flex h-9 w-full items-center justify-center rounded-lg bg-[var(--primary-gradient)] px-3 text-[10px] font-bold uppercase tracking-wider text-white shadow-[var(--shadow-button)] disabled:cursor-not-allowed disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-text)] disabled:shadow-none"
                >
                  Save Rule
                </button>
              </div>
            )}
            <div className="space-y-2">
              {(workspace.template_assignments || []).length > 0 ? (workspace.template_assignments || []).map((assignment: WorkspaceTemplateAssignment) => {
                const template = assignment.template || workspace.templates?.find((item) => item.id === assignment.template_id);
                const ruleParts = [
                  assignment.project_key || 'Any project',
                  assignment.workflow ? String(assignment.workflow).replace(/_/g, ' ') : 'Any workflow',
                  assignment.issue_type_id ? `Issue type ${assignment.issue_type_id}` : 'Any issue type',
                  assignment.is_default ? 'Default' : '',
                ].filter(Boolean);
                return (
                  <SurfaceCard key={assignment.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-[var(--text-main)]">{template?.name || `Template ${assignment.template_id}`}</div>
                      <div className="mt-1 text-[10px] text-[var(--text-muted)]">{ruleParts.join(' / ')}</div>
                    </div>
                    {canManageTemplates && (
                      <button
                        type="button"
                        onClick={() => setConfirmAction({
                          title: 'Delete template rule',
                          message: 'Delete this assignment rule?',
                          onConfirm: () => deleteTemplateAssignment(assignment.id),
                        })}
                        className="p-1.5 hover:bg-[var(--error)]/10 rounded text-[var(--error)]"
                        aria-label="Delete template rule"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </SurfaceCard>
                );
              }) : (
                <StatusPanel
                  title="No assignment rules"
                  description="Create a rule to recommend the right template automatically for repeated team workflows."
                />
              )}
            </div>
           </SurfaceCard>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="space-y-3 animate-in fade-in duration-200">
          {usage && (
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Members', usage.members_count],
                ['Templates', usage.templates_count],
                ['Shared Connections', usage.shared_connections_count],
                ['Jobs', usage.jobs_count],
              ].map(([label, value]) => (
                <SurfaceCard key={label} className="p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <BarChart3 size={11} /> {label}
                  </div>
                  <div className="mt-1 text-lg font-bold text-[var(--text-main)]">{value}</div>
                </SurfaceCard>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {auditLogs.length > 0 ? auditLogs.map(log => (
              <SurfaceCard key={log.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-main)]">
                    <Activity size={12} className="text-[var(--primary-blue)]" /> {log.action}
                  </div>
                  <div className="text-[9px] text-[var(--text-muted)]">{new Date(log.created_at).toLocaleString()}</div>
                </div>
              </SurfaceCard>
            )) : (
              <div className="text-center p-5 border border-dashed border-[var(--border-main)] rounded-xl text-[var(--text-muted)] text-xs">
                No workspace audit events yet.
              </div>
            )}
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="workspace-confirm-title">
          <SurfaceCard className="w-full max-w-xs p-4 shadow-2xl">
            <h3 id="workspace-confirm-title" className="text-sm font-bold text-[var(--text-main)]">{confirmAction.title}</h3>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{confirmAction.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-lg border border-[var(--border-main)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = confirmAction.onConfirm;
                  setConfirmAction(null);
                  action();
                }}
                className="rounded-lg bg-[var(--error)] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white"
              >
                Confirm
              </button>
            </div>
          </SurfaceCard>
        </div>
      )}
    </div>
  );
};
