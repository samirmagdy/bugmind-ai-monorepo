import React, { useEffect, useState } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { ExternalLink, ArrowLeft, RefreshCw, Globe, ShieldCheck, Lock, AtSign, Link, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ActionButton, SurfaceCard } from '../common/DesignSystem';

const SetupView: React.FC = () => {
  const { 
    auth: { apiBase, setApiBase, setGlobalView },
    jira,
    session,
    updateSession
  } = useBugMind();

  // Local form state
  const [platform, setPlatform] = useState<'cloud' | 'server'>('cloud');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [projectKey, setProjectKey] = useState('');
  const [xrayMode, setXrayMode] = useState<'auto' | 'server-dc-raven' | 'xray-cloud' | 'jira-fields' | 'description-fallback'>('auto');
  const [verifySsl, setVerifySsl] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (session.instanceUrl) {
      setUrl(prev => prev || session.instanceUrl || '');
    }
  }, [session.instanceUrl]);

  useEffect(() => {
    setPlatform(jira.jiraPlatform);
  }, [jira.jiraPlatform]);

  useEffect(() => {
    setVerifySsl(jira.verifySsl);
  }, [jira.verifySsl]);

  useEffect(() => {
    if (session.connections && session.connections.length > 0) return;
    void jira.fetchConnections();
  }, [jira, session.connections]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const connected = await jira.createConnection({
        auth_type: platform,
        base_url: url,
        username,
        token,
        verify_ssl: verifySsl,
        project_key: projectKey.trim() || undefined,
        xray_mode: xrayMode
      });

      if (connected) {
        const missing = session.jiraCapabilityProfile?.readiness.missingRequiredFields || [];
        updateSession({
          success: missing.length > 0
            ? `Jira connected. Setup needs required field defaults: ${missing.join(', ')}.`
            : 'Jira connected and capability profile discovered successfully.'
        });
        setGlobalView('main');
      } else {
        updateSession({ error: 'Orchestration failed: Check your Jira credentials.' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasConnections = (session.connections?.length || 0) > 0;

  return (
    <div className="view-shell animate-in fade-in duration-500">
      {/* Header */}
      <SurfaceCard className="view-header">
        {hasConnections && (
          <button 
            onClick={() => setGlobalView('main')}
            className="icon-button"
            aria-label="Back to workspace"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="view-heading flex-1">
          <p className="view-kicker">Setup</p>
          <h2 className="view-title">Jira Connection</h2>
          <p className="view-subtitle">Link the Jira workspace and discover project capabilities.</p>
        </div>
      </SurfaceCard>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Engine Endpoint */}
        <SurfaceCard className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[0.9rem] bg-[var(--bg-input)] border border-[var(--border-soft)] flex items-center justify-center text-[var(--primary-blue)]">
              <Globe size={14} />
            </div>
            <span className="text-sm font-bold text-[var(--text-primary)]">BugMind Engine</span>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="setup-api-base" className="context-label uppercase tracking-wider block ml-1">Control Plane Endpoint</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
                <Link size={14} />
              </div>
              <input 
                id="setup-api-base"
                type="url" 
                value={apiBase} 
                onChange={e => setApiBase(e.target.value)}
                onBlur={e => {
                  const val = e.target.value;
                  chrome.storage.local.set({ 'bugmind_api_base': val.trim().replace(/\/+$/, '') });
                }}
                className="form-input pl-9 pr-4 py-2.5 text-sm"
                placeholder="https://api.bugmind.ai/v1"
                required
              />
            </div>
          </div>
        </SurfaceCard>

        {/* Platform Selection */}
        <div className="space-y-2">
          <label className="context-label uppercase tracking-wider block ml-1">Deployment Type</label>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              type="button"
              onClick={() => setPlatform('cloud')}
              variant={platform === 'cloud' ? 'primary' : 'secondary'}
              className="py-3 text-xs"
            >
              Atlassian Cloud
            </ActionButton>
            <ActionButton
              type="button"
              onClick={() => setPlatform('server')}
              variant={platform === 'server' ? 'primary' : 'secondary'}
              className="py-3 text-xs"
            >
              Data Center
            </ActionButton>
          </div>
        </div>

        {/* Credentials */}
        <SurfaceCard className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="setup-workspace-url" className="context-label uppercase tracking-wider block ml-1">Workspace URL</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
                <Link size={14} />
              </div>
              <input 
                id="setup-workspace-url"
                type="url" 
                value={url} 
                onChange={e => setUrl(e.target.value)}
                className="form-input pl-9 pr-4 py-2.5 text-sm"
                placeholder={platform === 'cloud' ? 'https://your-domain.atlassian.net' : 'https://jira.your-corp.com'}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="setup-admin-email" className="context-label uppercase tracking-wider block ml-1">Admin Email</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
                <AtSign size={14} />
              </div>
              <input 
                id="setup-admin-email"
                type="text" 
                value={username} 
                onChange={e => setUsername(e.target.value)}
                className="form-input pl-9 pr-4 py-2.5 text-sm"
                placeholder="admin@company.com"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center px-1">
              <label htmlFor="setup-api-token" className="context-label uppercase tracking-wider">API Token</label>
              <a 
                href={platform === 'cloud' ? 'https://id.atlassian.com/manage-profile/security/api-tokens' : 'https://confluence.atlassian.com/x/8Y9XN'} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[10px] font-bold text-[var(--primary-blue)] flex items-center gap-1 hover:opacity-80"
              >
                Generate Token <ExternalLink size={10} />
              </a>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
                <Lock size={14} />
              </div>
              <input 
                id="setup-api-token"
                type="password" 
                value={token} 
                onChange={e => setToken(e.target.value)}
                className="form-input pl-9 pr-4 py-2.5 text-sm"
                placeholder="••••••••••••••••"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="setup-project-key" className="context-label uppercase tracking-wider block ml-1">Project Key</label>
              <input
                id="setup-project-key"
                type="text"
                value={projectKey}
                onChange={e => setProjectKey(e.target.value.toUpperCase())}
                className="form-input px-4 py-2.5 text-sm"
                placeholder="Optional, e.g. YMA"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="setup-xray-mode" className="context-label uppercase tracking-wider block ml-1">Xray Mode</label>
              <select
                id="setup-xray-mode"
                value={xrayMode}
                onChange={e => setXrayMode(e.target.value as typeof xrayMode)}
                className="form-input px-4 py-2.5 text-sm"
              >
                <option value="auto">Auto detect</option>
                <option value="server-dc-raven">Server/DC Raven API</option>
                <option value="xray-cloud">Xray Cloud</option>
                <option value="jira-fields">Jira fields fallback</option>
                <option value="description-fallback">Description fallback</option>
              </select>
            </div>
          </div>

          <div
            className="flex items-center gap-3 px-1 py-2 cursor-pointer group"
            onClick={() => setVerifySsl(!verifySsl)}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
              verifySsl
                ? 'bg-[var(--success)] border-[var(--success)]'
                : 'bg-[var(--bg-elevated)] border-[var(--border-soft)] group-hover:border-[var(--success)]'
            }`}>
              {verifySsl && <ShieldCheck size={10} className="text-white" />}
            </div>
            <div>
              <span className="text-xs font-semibold text-[var(--text-primary)]">Enforce SSL verification</span>
              <p className="text-[10px] text-[var(--text-muted)]">Verify certificates during sync</p>
            </div>
          </div>
        </SurfaceCard>

        {session.jiraCapabilityProfile && (
          <SurfaceCard className="space-y-3">
            <div className="flex items-center gap-2">
              {session.jiraCapabilityProfile.readiness.canSyncToXray ? (
                <CheckCircle2 size={16} className="text-[var(--success)]" />
              ) : (
                <AlertTriangle size={16} className="text-[var(--warning)]" />
              )}
              <span className="text-sm font-bold text-[var(--text-primary)]">Jira Readiness</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="text-[var(--text-secondary)]">User</div>
              <div className="font-semibold text-[var(--text-primary)] truncate">{session.jiraCapabilityProfile.user.displayName || 'Connected'}</div>
              <div className="text-[var(--text-secondary)]">Project</div>
              <div className="font-semibold text-[var(--text-primary)] truncate">{session.jiraCapabilityProfile.selectedProject?.key || 'Auto'}</div>
              <div className="text-[var(--text-secondary)]">Create Tests</div>
              <div className="font-semibold text-[var(--text-primary)]">{session.jiraCapabilityProfile.permissions.canCreateIssues ? 'Yes' : 'No'}</div>
              <div className="text-[var(--text-secondary)]">Link Issues</div>
              <div className="font-semibold text-[var(--text-primary)]">{session.jiraCapabilityProfile.permissions.canLinkIssues ? 'Yes' : 'No'}</div>
              <div className="text-[var(--text-secondary)]">Xray Mode</div>
              <div className="font-semibold text-[var(--text-primary)] truncate">{session.jiraCapabilityProfile.xray.mode}</div>
            </div>
            {session.jiraCapabilityProfile.readiness.missingRequiredFields.length > 0 && (
              <p className="text-xs text-[var(--warning)]">
                Missing required defaults: {session.jiraCapabilityProfile.readiness.missingRequiredFields.join(', ')}
              </p>
            )}
          </SurfaceCard>
        )}

        <ActionButton 
          type="submit" 
          disabled={isSubmitting}
          variant="primary"
          className="h-11 font-bold"
        >
          {isSubmitting ? (
            <RefreshCw size={18} className="animate-spin" />
          ) : (
            <ShieldCheck size={18} />
          )}
          {isSubmitting ? 'Discovering...' : 'Connect & Discover Jira'}
        </ActionButton>
      </form>
    </div>
  );
};

export default SetupView;
