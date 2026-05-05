import React, { useEffect, useState, useCallback } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { Shield, Layout, Plus, Trash2, Loader2 } from 'lucide-react';
import { ActionButton, SurfaceCard } from '../common/DesignSystem';
import { Workspace } from '../../types';

export const WorkspaceDashboardView: React.FC = () => {
  const { session, updateSession, auth: { apiBase, authToken } } = useBugMind();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'members' | 'connections' | 'templates'>('members');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('viewer');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

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
           <div className="text-center p-8 border border-dashed border-[var(--border-main)] rounded-xl text-[var(--text-muted)] text-xs">
              Go to Settings &gt; Connections to manage shared connections.
           </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-3 animate-in fade-in duration-200">
           <p className="text-[10px] text-[var(--text-muted)] px-1 italic">Workspace templates for consistent QA style.</p>
           <div className="grid grid-cols-2 gap-2">
              {['Banking QA', 'Mobile QA', 'API QA', 'Security'].map(style => (
                <SurfaceCard key={style} className="p-3 border-dashed flex items-center justify-between hover:border-[var(--primary-blue)] cursor-pointer transition-colors">
                  <span className="text-xs font-medium text-[var(--text-main)]">{style}</span>
                  <Plus size={12} className="text-[var(--text-muted)]" />
                </SurfaceCard>
              ))}
           </div>
        </div>
      )}
    </div>
  );
};
