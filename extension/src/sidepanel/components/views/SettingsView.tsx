import { useEffect, useState } from 'react';
import { X, ChevronDown, Loader2, AlertCircle, RefreshCw, Pencil, FolderOpen, Save } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { IssueType, JiraField, JiraProject } from '../../types';

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

const SettingsView: React.FC = () => {
  const { 
    session, updateSession, handleSaveSettings, saveFieldSettings,
    ai: { customKey, setCustomKey, hasCustomKeySaved, customModel, setCustomModel },
    jira, refreshIssue, currentTabId,
    auth: { apiBase, setApiBase },
    debug: { log }
  } = useBugMind();
  const [editingConnectionId, setEditingConnectionId] = useState<number | null>(null);
  const [connectionDrafts, setConnectionDrafts] = useState<Record<number, { auth_type: string; host_url: string; username: string; token: string; verify_ssl: boolean }>>({});
  const [projectsByConnection, setProjectsByConnection] = useState<Record<number, JiraProject[]>>({});
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [newConnection, setNewConnection] = useState({
    auth_type: 'cloud',
    host_url: session.instanceUrl || '',
    username: '',
    token: '',
    verify_ssl: jira.verifySsl
  });
  const [isCreatingConnection, setIsCreatingConnection] = useState(false);
  const editableJiraFields = (session.jiraMetadata?.fields || []).filter((field: JiraField) => !isSystemManagedField(field));

  // Auto-refetch when entering Jira tab if empty
  useEffect(() => {
    if (session.settingsTab === 'jira' && session.issueTypes.length === 0 && !session.issueTypesFetched && !session.error && session.instanceUrl && !session.loading) {
      log('SETTINGS-AUTO', 'Mapping tab empty, triggering background sync...');
      refreshIssue(true);
    }
  }, [session.settingsTab, session.issueTypes.length, session.issueTypesFetched, session.error, session.instanceUrl, session.loading, refreshIssue, log]);

  useEffect(() => {
    if (session.settingsTab !== 'connections') return;
    if (session.connections && session.connections.length > 0) return;
    void jira.fetchConnections();
  }, [jira, session.connections, session.settingsTab]);

  useEffect(() => {
    if (!showAddConnection) return;
    setNewConnection((prev) => ({
      ...prev,
      host_url: prev.host_url || session.instanceUrl || '',
      verify_ssl: jira.verifySsl
    }));
  }, [jira.verifySsl, session.instanceUrl, showAddConnection]);

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
        projectKey,
        projectId: session.issueData.projectId,
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

  return (
    <div className="space-y-6 pt-4 animate-in slide-in-from-right-4 duration-300">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => updateSession({ view: 'main' })} className="p-2 hover:bg-[var(--bg-card)] rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all">
          <X size={20} />
        </button>
        <h2 className="text-xl font-bold text-[var(--text-main)] leading-none">Settings</h2>
      </div>
      
      <div className="flex bg-[var(--bg-input)] p-1 rounded-xl border border-[var(--border-main)] mb-6 shadow-[var(--shadow-sm)]">
        <button 
          onClick={() => updateSession({ settingsTab: 'ai' })}
          className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${session.settingsTab === 'ai' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
        >
          AI
        </button>
        <button 
          onClick={() => updateSession({ settingsTab: 'jira' })}
          className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${session.settingsTab === 'jira' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
        >
          Field Mapping
        </button>
        <button 
          onClick={() => updateSession({ settingsTab: 'connections' })}
          className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${session.settingsTab === 'connections' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
        >
          Connections
        </button>
      </div>

      {session.settingsTab === 'ai' ? (
        <>
          <div className="bg-[var(--bg-card)] border border-[var(--border-main)] p-4 rounded-xl space-y-3 mb-6 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-1 w-1 bg-[var(--status-info)] rounded-full"></div>
              <span className="text-[10px] font-black uppercase text-[var(--status-info)] tracking-widest">Platform Settings</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">BugMind API Endpoint</label>
              <input 
                type="url" 
                value={apiBase} 
                onChange={e => {
                  const val = e.target.value;
                  setApiBase(val);
                  chrome.storage.local.set({ 'bugmind_api_base': val.trim().replace(/\/+$/, '') });
                }}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50"
                placeholder="https://api.bugmind.ai/api/v1"
              />
            </div>
          </div>
          <div className="bg-[var(--status-info)]/5 border border-[var(--status-info)]/10 p-4 rounded-xl space-y-2 mb-6 shadow-inner">
            <p className="text-[11px] text-[var(--status-info)] uppercase font-bold tracking-wider">Experimental Feature</p>
            <p className="text-xs text-[var(--text-muted)] leading-normal">
              Override the default BugMind AI configuration with your own OpenRouter credentials. Leave fields empty to use the system default.
            </p>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-5">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">OpenRouter API Key</label>
              <input 
                type="password" 
                value={customKey} 
                onChange={e => setCustomKey(e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-blue-500/50 transition-all text-sm text-[var(--text-main)]"
                placeholder={hasCustomKeySaved ? "••••••••••••••••" : "sk-or-v1-..."}
              />
              {hasCustomKeySaved && <p className="text-[10px] text-[var(--status-success)] ml-1">✓ Custom key currently active</p>}
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">AI Model ID</label>
              <input 
                type="text" 
                value={customModel} 
                onChange={e => setCustomModel(e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-blue-500/50 transition-all text-sm text-[var(--text-main)]"
                placeholder="e.g. anthropic/claude-3-sonnet"
              />
              <p className="text-[10px] text-[var(--text-muted)] ml-1 opacity-70">Format: vendor/model-name</p>
            </div>

            <div className="pt-4 space-y-3">
              <button type="submit" className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-[var(--accent)]/20">
                Apply Custom Settings
              </button>
            </div>
          </form>
        </>
      ) : session.settingsTab === 'connections' ? (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-black uppercase text-[var(--text-muted)] tracking-widest">Active Connections</h3>
            <button 
              onClick={() => {
                setShowAddConnection(prev => !prev);
                setEditingConnectionId(null);
              }}
              className="text-[10px] font-bold text-[var(--accent)] hover:underline"
            >
              {showAddConnection ? 'Close' : '+ Add New Connection'}
            </button>
          </div>

          {showAddConnection && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setIsCreatingConnection(true);
                try {
                  const connected = await jira.createConnection({
                    auth_type: newConnection.auth_type as 'cloud' | 'server',
                    base_url: newConnection.host_url.trim(),
                    username: newConnection.username.trim(),
                    token: newConnection.token,
                    verify_ssl: newConnection.verify_ssl
                  });

                  if (connected) {
                    updateSession({ success: 'Connection saved successfully.' });
                    setShowAddConnection(false);
                    setNewConnection({
                      auth_type: 'cloud',
                      host_url: session.instanceUrl || '',
                      username: '',
                      token: '',
                      verify_ssl: jira.verifySsl
                    });
                  } else {
                    updateSession({ error: 'Failed to save Jira connection.' });
                  }
                } finally {
                  setIsCreatingConnection(false);
                }
              }}
              className="bg-[var(--bg-card)] border border-[var(--border-main)] rounded-2xl p-4 space-y-3 shadow-[var(--shadow-sm)]"
            >
              <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Add New Connection</div>
              <select
                value={newConnection.auth_type}
                onChange={(e) => setNewConnection(prev => ({ ...prev, auth_type: e.target.value }))}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
              >
                <option value="cloud">Jira Cloud</option>
                <option value="server">Server / DC</option>
              </select>
              <input
                type="url"
                value={newConnection.host_url}
                onChange={(e) => setNewConnection(prev => ({ ...prev, host_url: e.target.value }))}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
                placeholder={newConnection.auth_type === 'cloud' ? 'https://company.atlassian.net' : 'http://jira.internal.com'}
                required
              />
              <input
                type="text"
                value={newConnection.username}
                onChange={(e) => setNewConnection(prev => ({ ...prev, username: e.target.value }))}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
                placeholder="Email / username"
                required
              />
              <input
                type="password"
                value={newConnection.token}
                onChange={(e) => setNewConnection(prev => ({ ...prev, token: e.target.value }))}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
                placeholder="API Token / PAT"
                required
              />
              <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={newConnection.verify_ssl}
                  onChange={(e) => setNewConnection(prev => ({ ...prev, verify_ssl: e.target.checked }))}
                />
                Verify SSL certificates
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isCreatingConnection}
                  className="flex-1 bg-[var(--accent)] text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  <Save size={12} />
                  {isCreatingConnection ? 'Saving...' : 'Add New Connection'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddConnection(false)}
                  className="px-3 bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl text-xs"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {(!session.connections || session.connections.length === 0) ? (
              <div className="py-8 text-center bg-[var(--bg-input)] rounded-2xl border border-dashed border-[var(--border-main)]">
                <p className="text-xs text-[var(--text-muted)]">No connections found.</p>
              </div>
            ) : (
              session.connections.map((conn) => (
                <div 
                  key={conn.id} 
                  className={`p-4 rounded-2xl border transition-all ${
                    session.jiraConnectionId === conn.id 
                      ? 'bg-[var(--accent)]/5 border-[var(--accent)] shadow-md' 
                      : 'bg-[var(--bg-card)] border-[var(--border-main)]'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[var(--bg-input)] flex items-center justify-center border border-[var(--border-main)]">
                        {conn.icon_url ? (
                          <img src={conn.icon_url} className="w-6 h-6 rounded-md" alt="" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[var(--text-main)] leading-tight">{conn.username}</p>
                        <p className="text-[10px] text-[var(--text-muted)] truncate max-w-[150px]">{conn.host_url}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setEditingConnectionId(conn.id);
                          setConnectionDrafts(prev => ({
                            ...prev,
                            [conn.id]: prev[conn.id] || {
                              auth_type: conn.auth_type,
                              host_url: conn.host_url,
                              username: conn.username,
                              token: '',
                              verify_ssl: conn.verify_ssl ?? true
                            }
                          }));
                        }}
                        className="p-1.5 hover:bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg transition-all"
                        title="Edit connection"
                      >
                        <Pencil size={14} />
                      </button>
                      {session.jiraConnectionId !== conn.id && (
                        <button 
                          onClick={() => jira.setActiveConnection(conn.id, conn.host_url)}
                          className="p-1.5 hover:bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg transition-all"
                          title="Set as Active"
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                      <button 
                        onClick={async () => {
                          const projects = await jira.fetchProjects(conn.id);
                          setProjectsByConnection(prev => ({ ...prev, [conn.id]: projects }));
                        }}
                        className="p-1.5 hover:bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg transition-all"
                        title="Load projects"
                      >
                        <FolderOpen size={14} />
                      </button>
                      <button 
                        onClick={() => jira.deleteConnection(conn.id)}
                        className="p-1.5 hover:bg-red-500/10 text-red-500 rounded-lg transition-all"
                        title="Delete connection"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {session.jiraConnectionId === conn.id && (
                    <div className="mt-2 pt-2 border-t border-[var(--accent)]/10 flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)]" />
                      <span className="text-[10px] font-bold text-[var(--status-success)] uppercase tracking-widest">Active Connection</span>
                    </div>
                  )}
                  {projectsByConnection[conn.id] && (
                    <div className="mt-3 pt-3 border-t border-[var(--border-main)] space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Accessible Projects</div>
                      <div className="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar">
                        {projectsByConnection[conn.id].slice(0, 10).map(project => (
                          <div key={`${conn.id}-${project.id}`} className="text-[11px] text-[var(--text-muted)]">
                            <span className="font-bold text-[var(--text-main)]">{project.key}</span> {project.name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {editingConnectionId === conn.id && connectionDrafts[conn.id] && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const draft = connectionDrafts[conn.id];
                        const ok = await jira.updateConnection(conn.id, {
                          auth_type: draft.auth_type,
                          host_url: draft.host_url.trim(),
                          username: draft.username.trim(),
                          token: draft.token.trim() || undefined,
                          verify_ssl: draft.verify_ssl
                        });
                        if (ok) {
                          setEditingConnectionId(null);
                          const projects = await jira.fetchProjects(conn.id);
                          setProjectsByConnection(prev => ({ ...prev, [conn.id]: projects }));
                        }
                      }}
                      className="mt-3 pt-3 border-t border-[var(--border-main)] space-y-3"
                    >
                      <select
                        value={connectionDrafts[conn.id].auth_type}
                        onChange={(e) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], auth_type: e.target.value } }))}
                        className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
                      >
                        <option value="cloud">Jira Cloud</option>
                        <option value="server">Server / DC</option>
                      </select>
                      <input
                        type="url"
                        value={connectionDrafts[conn.id].host_url}
                        onChange={(e) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], host_url: e.target.value } }))}
                        className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
                        placeholder="https://company.atlassian.net"
                      />
                      <input
                        type="text"
                        value={connectionDrafts[conn.id].username}
                        onChange={(e) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], username: e.target.value } }))}
                        className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
                        placeholder="Email / username"
                      />
                      <input
                        type="password"
                        value={connectionDrafts[conn.id].token}
                        onChange={(e) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], token: e.target.value } }))}
                        className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2 text-xs text-[var(--text-main)]"
                        placeholder="Leave blank to keep current token"
                      />
                      <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        <input
                          type="checkbox"
                          checked={connectionDrafts[conn.id].verify_ssl}
                          onChange={(e) => setConnectionDrafts(prev => ({ ...prev, [conn.id]: { ...prev[conn.id], verify_ssl: e.target.checked } }))}
                        />
                        Verify SSL certificates
                      </label>
                      <div className="flex gap-2">
                        <button type="submit" className="flex-1 bg-[var(--accent)] text-white font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-2">
                          <Save size={12} />
                          Save Connection
                        </button>
                        <button type="button" onClick={() => setEditingConnectionId(null)} className="px-3 bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl text-xs">
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="bg-[var(--status-success)]/5 border border-[var(--status-success)]/10 p-4 rounded-xl space-y-2 mb-2 shadow-inner">
            <p className="text-[11px] text-[var(--status-success)] uppercase font-bold tracking-wider">Project Configuration</p>
            <p className="text-xs text-[var(--text-muted)] leading-normal">
              Configuration for project <strong>{session.issueData?.key.split('-')[0]}</strong>. Settings are saved per issue type.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Select Issue Type</label>
              <div className="relative flex items-center gap-3">
                {session.selectedIssueType?.icon_url && (
                  <div className="w-10 h-10 rounded-xl bg-[var(--bg-input)] flex items-center justify-center border border-[var(--border-main)] shrink-0">
                    <img src={session.selectedIssueType.icon_url} className="w-6 h-6" alt="" />
                  </div>
                )}
                <div className="relative flex-1">
                  <select 
                    value={session.selectedIssueType?.id || ''}
                    onChange={(e) => {
                      const type = session.issueTypes.find((t: IssueType) => t.id === e.target.value);
                      if (type && session.jiraConnectionId && session.issueData) {
                        updateSession({ selectedIssueType: type, jiraMetadata: null });
                        void bootstrapJiraConfig(type.id, { force: true, loading: true, logTag: 'SETTINGS-TYPE' });
                      }
                    }}
                    className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm appearance-none cursor-pointer pr-10 text-[var(--text-main)] shadow-[var(--shadow-sm)]"
                  >
                    {session.issueTypes.map((type: IssueType) => (
                      <option key={type.id} value={type.id}>{type.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={16} />
                </div>
              </div>
            </div>

            {!session.jiraMetadata ? (
              session.error?.includes('Jira fields') || session.error?.includes('issue types') ? (
                <div className="py-8 px-4 text-center bg-[var(--status-danger)]/5 border border-[var(--status-danger)]/20 rounded-2xl space-y-4 animate-in fade-in duration-300">
                  <div className="text-[var(--status-danger)] text-xs font-bold uppercase tracking-tight">Configuration Error</div>
                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed px-4">{session.error}</p>
                  <button 
                    onClick={() => {
                      const pKey = session.issueData?.key.split('-')[0];
                      if (pKey && session.instanceUrl && session.issueData) {
                        updateSession({ error: null });
                        if (session.issueTypes.length === 0) {
                          void bootstrapJiraConfig(undefined, { force: true, loading: true, logTag: 'SETTINGS-RETRY', errorMessage: 'Failed to refresh issue types.' });
                        } else if (session.selectedIssueType) {
                          void bootstrapJiraConfig(session.selectedIssueType.id, { force: true, loading: true, logTag: 'SETTINGS-RETRY', errorMessage: 'Failed to refresh Jira fields.' });
                        }
                      }
                    }}
                    className="w-full bg-[var(--status-danger)]/10 hover:bg-[var(--status-danger)]/20 border border-[var(--status-danger)]/30 text-[var(--status-danger)] text-[10px] font-black py-3 rounded-xl transition-all uppercase tracking-widest"
                  >
                    Retry Fetch
                  </button>
                </div>
              ) : session.issueTypesFetched && session.issueTypes.length === 0 ? (
                <div className="py-12 px-4 text-center bg-[var(--status-warning)]/5 border border-[var(--status-warning)]/20 rounded-2xl space-y-4 animate-in fade-in duration-300">
                  <div className="w-12 h-12 bg-[var(--status-warning)]/10 rounded-2xl flex items-center justify-center text-[var(--status-warning)] mx-auto shadow-inner border border-[var(--status-warning)]/10">
                    <AlertCircle size={24} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[var(--text-main)] text-sm font-bold">No Issue Types Found</div>
                    <p className="text-[11px] text-[var(--text-muted)] leading-tight px-4 italic">
                      Verify your Jira account has "Browse Projects" permissions for project <strong>{session.issueData?.key.split('-')[0]}</strong>.
                    </p>
                  </div>
                  <button 
                    onClick={() => {
                      const pKey = session.issueData?.key.split('-')[0];
                      if (pKey && session.instanceUrl && session.issueData) {
                        updateSession({ error: null, issueTypesFetched: false });
                        void bootstrapJiraConfig(undefined, { force: true, loading: true, logTag: 'SETTINGS-REFRESH', errorMessage: 'Failed to refresh issue types.' });
                      }
                    }}
                    className="w-full bg-[var(--status-info)]/10 hover:bg-[var(--status-info)]/20 border border-[var(--status-info)]/30 text-[var(--status-info)] text-[10px] font-black py-3 rounded-xl transition-all uppercase tracking-widest"
                  >
                    Refresh Project Config
                  </button>
                </div>
              ) : (
                <div className="py-12 text-center text-[var(--text-muted)] flex flex-col items-center gap-3">
                  <div className="relative">
                    <Loader2 className="animate-spin text-[var(--status-info)]/30" size={32} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-1.5 w-1.5 bg-[var(--status-info)] rounded-full animate-pulse" />
                    </div>
                  </div>
                  <div className="text-[10px] uppercase tracking-widest font-black text-[var(--text-muted)] opacity-60">Fetching Remote Schema...</div>
                </div>
              )
            ) : (
              <div className="space-y-6">
                <div className="flex justify-between items-center px-1">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-[var(--text-muted)] tracking-widest opacity-60">Schema Loaded</span>
                    <span className="text-[9px] text-[var(--status-success)] font-bold">Synced with Jira</span>
                  </div>
                  <button 
                    onClick={() => {
                      const pKey = session.issueData?.key.split('-')[0];
                      if (pKey && session.issueData && session.selectedIssueType) {
                        void bootstrapJiraConfig(session.selectedIssueType.id, { force: true, loading: true, logTag: 'SETTINGS-FORCE', errorMessage: 'Failed to refresh Jira fields.' });
                      }
                    }}
                    className="text-[10px] font-bold text-blue-500 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw size={10} />
                    Force Refresh
                  </button>
                </div>
                {/* AI Property Mapping Section */}
                <div className="bg-[var(--status-info)]/5 border border-[var(--status-info)]/10 p-4 rounded-xl space-y-4 shadow-inner">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-1 w-1 bg-[var(--status-info)] rounded-full"></div>
                    <span className="text-[10px] font-black uppercase text-[var(--status-info)] tracking-widest">AI Property Mapping</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] opacity-80 leading-normal uppercase font-bold tracking-tight">
                    Route AI data to specific custom fields
                  </p>
                  
                  {[
                    { id: 'steps_to_reproduce', label: 'Steps to Reproduce' },
                    { id: 'expected_result', label: 'Expected Result' },
                    { id: 'actual_result', label: 'Actual Result' }
                  ].map(prop => (
                    <div key={prop.id} className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">{prop.label}</label>
                      <div className="relative">
                        <select 
                          value={(session.aiMapping?.[prop.id]) || 'description'}
                          onChange={(e) => {
                            const nextMapping = { ...(session.aiMapping || {}), [prop.id]: e.target.value };
                            saveFieldSettings(undefined, nextMapping);
                          }}
                          className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-3 py-2.5 outline-none focus:border-[var(--status-info)]/50 transition-all text-xs appearance-none cursor-pointer pr-10 text-[var(--text-main)] shadow-inner"
                        >
                          <option value="description">Description (Default)</option>
                          {editableJiraFields.map((f: JiraField) => (
                            <option key={f.key} value={f.key}>{f.name} ({f.key})</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none opacity-60" size={14} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Visible Fields Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Available Fields</label>
                      <button 
                        onClick={() => {
                          if (session.issueData && session.selectedIssueType) {
                            void bootstrapJiraConfig(session.selectedIssueType.id, { force: true, loading: true, logTag: 'SETTINGS-FIELDS', errorMessage: 'Failed to refresh Jira fields.' });
                          }
                        }}
                        disabled={session.loading}
                        className={`p-1 rounded-md hover:bg-[var(--accent)]/10 text-[var(--accent)] transition-all ${session.loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Force refresh available fields"
                      >
                        <RefreshCw size={12} className={session.loading ? 'animate-spin' : ''} />
                      </button>
                    </div>
                    <span className="text-[10px] text-[var(--status-info)] font-bold bg-[var(--status-info)]/10 px-2 py-0.5 rounded-full shadow-sm">{editableJiraFields.length} Found</span>
                  </div>
                  <div className="max-h-[250px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
                    {editableJiraFields.length === 0 ? (
                      <div className="py-8 text-center bg-[var(--bg-input)] rounded-xl border border-dashed border-[var(--border-main)] shadow-inner">
                        <p className="text-xs text-[var(--text-muted)] opacity-60">No extra fields found for this type.</p>
                      </div>
                    ) : (
                      editableJiraFields.map((field: JiraField) => (
                        <label 
                          key={field.key}
                          className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                            session.visibleFields.includes(field.key) || field.required
                              ? 'bg-[var(--status-info)]/10 border-[var(--status-info)]/30' 
                              : 'bg-[var(--bg-card)] border-[var(--border-main)] hover:border-[var(--status-info)]/30 shadow-[var(--shadow-sm)]'
                          } ${field.required ? 'opacity-80 cursor-not-allowed' : ''}`}
                        >
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-[var(--text-main)]">{field.name}</span>
                              {field.required && <span className="text-[10px] font-black text-[var(--status-info)] bg-[var(--status-info)]/20 px-1.5 py-0.5 rounded uppercase tracking-tighter">Locked</span>}
                            </div>
                            <span className="text-[9px] text-[var(--text-muted)] opacity-70 uppercase tracking-tighter">{field.type} {field.required && '• REQUIRED'}</span>
                          </div>
                          <input 
                            type="checkbox"
                            checked={session.visibleFields.includes(field.key) || field.required}
                            disabled={field.required}
                            onChange={() => {
                              if (field.required) return;
                              const next = session.visibleFields.includes(field.key)
                                ? session.visibleFields.filter((f: string) => f !== field.key)
                                : [...session.visibleFields, field.key];
                              saveFieldSettings(next);
                            }}
                            className="w-4 h-4 rounded border-[var(--border-main)] bg-[var(--bg-input)] text-[var(--status-info)] focus:ring-[var(--status-info)]/50 disabled:opacity-50"
                          />
                        </label>
                      ))
                    )}
                  </div>
                </div>

                {/* SSL Toggle in Settings */}
                <div className="bg-[var(--bg-card)] border border-[var(--border-main)] p-4 rounded-xl space-y-3 shadow-[var(--shadow-sm)]">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-1 w-1 bg-[var(--status-success)] rounded-full"></div>
                    <span className="text-[10px] font-black uppercase text-[var(--status-success)] tracking-widest">Security Configuration</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input 
                      type="checkbox" 
                      id="verify-ssl-settings"
                      checked={jira.verifySsl} 
                      onChange={e => {
                        const val = e.target.checked;
                        jira.setVerifySsl(val);
                      }}
                      className="w-4 h-4 rounded border-[var(--border-main)] bg-[var(--bg-input)] text-blue-600 focus:ring-blue-500/50"
                    />
                    <label htmlFor="verify-ssl-settings" className="text-xs text-[var(--text-muted)] cursor-pointer">Verify SSL Certificates</label>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] opacity-70 italic">Note: Changing this requires re-verifying the connection.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
};

export default SettingsView;
