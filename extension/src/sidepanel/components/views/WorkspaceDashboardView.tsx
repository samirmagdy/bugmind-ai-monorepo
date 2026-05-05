import React, { useEffect, useState, useCallback } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { Activity, BarChart3, Link2, Shield, Layout, Plus, Trash2, Loader2 } from 'lucide-react';
import { ActionButton, SurfaceCard } from '../common/DesignSystem';
import { JiraConnection, Workspace } from '../../types';

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
  const { session, updateSession, auth: { apiBase, authToken } } = useBugMind();
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

  const fetchWorkspace = useCallback(async () => {
    if (!session.activeWorkspaceId) {
        setLoading(false);
        return;
    }
    try {
      const res = await fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data);
      }
    } catch (err) {
      console.error('Failed to fetch workspace', err);
    } finally {
      setLoading(false);
    }
  }, [session.activeWorkspaceId, apiBase, authToken]);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  const fetchWorkspaceAdminData = useCallback(async () => {
    if (!session.activeWorkspaceId) return;
    try {
      const [connectionsRes, auditRes, usageRes] = await Promise.all([
        fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/connections`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        }),
        fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/audit-logs`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        }),
        fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/usage`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        }),
      ]);
      if (connectionsRes.ok) setSharedConnections(await connectionsRes.json());
      if (auditRes.ok) setAuditLogs(await auditRes.json());
      if (usageRes.ok) setUsage(await usageRes.json());
    } catch (err) {
      console.error('Failed to fetch workspace admin data', err);
    }
  }, [apiBase, authToken, session.activeWorkspaceId]);

  useEffect(() => {
    if (activeTab === 'connections' || activeTab === 'audit') {
      fetchWorkspaceAdminData();
    }
  }, [activeTab, fetchWorkspaceAdminData]);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    try {
      const res = await fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/members?email=${encodeURIComponent(inviteEmail)}&role=${inviteRole}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        setInviteEmail('');
        fetchWorkspace();
      } else {
        const data = await res.json();
        alert(data.detail || 'Failed to invite user');
      }
    } catch {
      alert('Error inviting user');
    }
  };

  const removeMember = async (userId: number) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    try {
      const res = await fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/members/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) fetchWorkspace();
    } catch (err) {
      console.error('Failed to remove member', err);
    }
  };

  const changeRole = async (userId: number, newRole: string) => {
    try {
      const res = await fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/members/${userId}`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: newRole })
      });
      if (res.ok) fetchWorkspace();
    } catch (err) {
      console.error('Failed to change role', err);
    }
  };

  const createTemplate = async () => {
    if (!templateName.trim()) return;
    try {
      const res = await fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/templates`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: templateName.trim(),
          template_type: templateType,
          content: { body: templateBody.trim() }
        })
      });
      if (res.ok) {
        setTemplateName('');
        setTemplateBody('');
        fetchWorkspace();
      } else {
        const data = await res.json();
        alert(data.detail || 'Failed to create template');
      }
    } catch {
      alert('Error creating template');
    }
  };

  const deleteTemplate = async (templateId: number) => {
    if (!confirm('Delete this workspace template?')) return;
    const res = await fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/templates/${templateId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) fetchWorkspace();
  };

  const shareConnection = async (connectionId: number) => {
    const res = await fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/connections/${connectionId}/share`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      fetchWorkspaceAdminData();
    } else {
      const data = await res.json();
      alert(data.detail || 'Failed to share connection');
    }
  };

  const unshareConnection = async (connectionId: number) => {
    const res = await fetch(`${apiBase}/workspaces/${session.activeWorkspaceId}/connections/${connectionId}/share`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) fetchWorkspaceAdminData();
  };

  if (loading && !workspace) {
    return <div className="flex items-center justify-center p-8"><Loader2 className="animate-spin text-[var(--text-muted)]" /></div>;
  }

  if (!workspace) {
    return (
      <div className="p-4 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[var(--surface-soft)] flex items-center justify-center mx-auto text-[var(--text-muted)]">
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
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between pb-2 border-b border-[var(--border-main)]">
        <div className="flex items-center gap-2">
          <Layout size={18} className="text-[var(--primary-blue)]" />
          <h2 className="text-sm font-bold text-[var(--text-main)] truncate max-w-[150px]">{workspace.name}</h2>
        </div>
        <button
          onClick={() => updateSession({ view: 'main' })}
          className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          Back
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-[var(--border-soft)]">
        <button 
          onClick={() => setActiveTab('members')}
          className={`pb-2 text-xs font-semibold transition-colors relative ${activeTab === 'members' ? 'text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
        >
          Members
          {activeTab === 'members' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary-blue)]" />}
        </button>
        <button 
          onClick={() => setActiveTab('connections')}
          className={`pb-2 text-xs font-semibold transition-colors relative ${activeTab === 'connections' ? 'text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
        >
          Connections
          {activeTab === 'connections' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary-blue)]" />}
        </button>
        <button 
          onClick={() => setActiveTab('templates')}
          className={`pb-2 text-xs font-semibold transition-colors relative ${activeTab === 'templates' ? 'text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
        >
          Templates
          {activeTab === 'templates' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary-blue)]" />}
        </button>
        <button 
          onClick={() => setActiveTab('audit')}
          className={`pb-2 text-xs font-semibold transition-colors relative ${activeTab === 'audit' ? 'text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
        >
          Audit
          {activeTab === 'audit' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary-blue)]" />}
        </button>
      </div>

      {activeTab === 'members' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          {/* Invite Section */}
          {(session.activeWorkspaceRole === 'owner' || session.activeWorkspaceRole === 'admin') && (
              <SurfaceCard className="p-3 bg-[var(--surface-soft)] border-dashed">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                  <Plus size={12} /> Invite Member
                </h3>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input 
                      placeholder="user@example.com"
                      value={inviteEmail}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInviteEmail(e.target.value)}
                      className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none"
                    />
                  </div>
                  <select 
                    value={inviteRole}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setInviteRole(e.target.value)}
                    className="bg-[var(--bg-input)] text-[10px] border border-[var(--border-main)] rounded-lg px-2 h-8 text-[var(--text-main)] outline-none"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="qa_engineer">Engineer</option>
                    <option value="qa_lead">Lead</option>
                    <option value="admin">Admin</option>
                  </select>
                  <ActionButton variant="primary" className="h-8 px-3 text-[10px]" onClick={handleInvite}>Invite</ActionButton>
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
                  {(session.activeWorkspaceRole === 'owner' || session.activeWorkspaceRole === 'admin') && member.role !== 'owner' ? (
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <select 
                        value={member.role}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => changeRole(member.user_id, e.target.value)}
                        className="bg-transparent text-[10px] font-bold text-[var(--primary-blue)] border-none outline-none cursor-pointer"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="qa_engineer">Engineer</option>
                        <option value="qa_lead">Lead</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button 
                        onClick={() => removeMember(member.user_id)}
                        className="p-1.5 hover:bg-[var(--error)]/10 rounded text-[var(--error)]"
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
              <div className="text-center p-5 border border-dashed border-[var(--border-main)] rounded-xl text-[var(--text-muted)] text-xs">
                No shared connections yet.
              </div>
            ) : sharedConnections.map(conn => (
              <SurfaceCard key={conn.id} className="p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[var(--text-main)] truncate">{conn.host_url}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{conn.username}</div>
                </div>
                {(session.activeWorkspaceRole === 'owner' || session.activeWorkspaceRole === 'admin') && (
                  <button onClick={() => unshareConnection(conn.id)} className="p-1.5 hover:bg-[var(--error)]/10 rounded text-[var(--error)]" aria-label="Unshare connection">
                    <Trash2 size={12} />
                  </button>
                )}
              </SurfaceCard>
            ))}
           </div>
           {(session.activeWorkspaceRole === 'owner' || session.activeWorkspaceRole === 'admin') && (
            <SurfaceCard className="p-3 bg-[var(--surface-soft)] border-dashed">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                <Link2 size={12} /> Share Personal Connection
              </h3>
              <div className="flex flex-wrap gap-2">
                {session.connections.filter(conn => !conn.is_shared).map(conn => (
                  <button key={conn.id} onClick={() => shareConnection(conn.id)} className="rounded-lg border border-[var(--border-main)] px-2.5 py-1 text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--primary-blue)]">
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
           {(session.activeWorkspaceRole === 'owner' || session.activeWorkspaceRole === 'admin' || session.activeWorkspaceRole === 'qa_lead') && (
            <SurfaceCard className="p-3 bg-[var(--surface-soft)] border-dashed space-y-2">
              <div className="flex gap-2">
                <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" className="flex-1 bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none" />
                <select value={templateType} onChange={(e) => setTemplateType(e.target.value as typeof templateType)} className="bg-[var(--bg-input)] text-[10px] border border-[var(--border-main)] rounded-lg px-2 h-8 text-[var(--text-main)] outline-none">
                  <option value="bug">Bug</option>
                  <option value="test">Test</option>
                  <option value="preset">Preset</option>
                  <option value="style">Style</option>
                </select>
              </div>
              <textarea value={templateBody} onChange={(e) => setTemplateBody(e.target.value)} placeholder="Template content or prompt preset" className="w-full min-h-16 resize-y bg-[var(--bg-input)] border border-[var(--border-main)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] outline-none" />
              <ActionButton variant="primary" className="h-8 px-3 text-[10px]" onClick={createTemplate}>Save Template</ActionButton>
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
                  {(session.activeWorkspaceRole === 'owner' || session.activeWorkspaceRole === 'admin' || session.activeWorkspaceRole === 'qa_lead') && (
                    <button onClick={() => deleteTemplate(template.id)} className="p-1.5 hover:bg-[var(--error)]/10 rounded text-[var(--error)]" aria-label="Delete template">
                      <Trash2 size={12} />
                    </button>
                  )}
                </SurfaceCard>
              )) : (
                <div className="text-center p-5 border border-dashed border-[var(--border-main)] rounded-xl text-[var(--text-muted)] text-xs">
                  No workspace templates yet.
                </div>
              )}
           </div>
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
    </div>
  );
};
