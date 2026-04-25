import React, { useEffect, useState } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { ExternalLink, ArrowLeft, RefreshCw, Globe, ShieldCheck, Lock, AtSign, Link } from 'lucide-react';
import { ActionButton } from '../common/DesignSystem';

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
        verify_ssl: verifySsl
      });

      if (connected) {
        updateSession({ success: 'Jira environment synchronized successfully.' });
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
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="context-card flex items-center gap-3 px-4 py-3.5">
        {hasConnections && (
          <button 
            onClick={() => setGlobalView('main')}
            className="p-2.5 rounded-full bg-[var(--surface-soft)] border border-[var(--card-border)] text-[var(--text-muted)] hover:text-[var(--primary-blue)] hover:border-[var(--primary-blue)] transition-all"
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Jira Connection</h2>
          <p className="text-xs text-[var(--text-secondary)]">Link your Jira workspace to BugMind</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Engine Endpoint */}
        <div className="context-card space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-[0.9rem] bg-[var(--bg-input)] border border-[var(--border-soft)] flex items-center justify-center text-[var(--primary-blue)]">
              <Globe size={14} />
            </div>
            <span className="text-sm font-bold text-[var(--text-primary)]">BugMind Engine</span>
          </div>
          <div className="space-y-1.5">
            <label className="context-label uppercase tracking-wider block ml-1">Control Plane Endpoint</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
                <Link size={14} />
              </div>
              <input 
                type="url" 
                value={apiBase} 
                onChange={e => {
                  const val = e.target.value;
                  setApiBase(val);
                  chrome.storage.local.set({ 'bugmind_api_base': val.trim().replace(/\/+$/, '') });
                }}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-2xl pl-9 pr-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] transition-all"
                placeholder="https://api.bugmind.ai/v1"
                required
              />
            </div>
          </div>
        </div>

        {/* Platform Selection */}
        <div className="space-y-2">
          <label className="context-label uppercase tracking-wider block ml-1">Deployment Type</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPlatform('cloud')}
              className={`py-3 rounded-xl text-xs font-bold border transition-all ${
                platform === 'cloud'
                  ? 'bg-[var(--primary-gradient)] text-white border-transparent shadow-[var(--shadow-button)]'
                  : 'bg-[var(--surface-soft)] text-[var(--text-secondary)] border-[var(--card-border)] hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]'
              }`}
            >
              Atlassian Cloud
            </button>
            <button
              type="button"
              onClick={() => setPlatform('server')}
              className={`py-3 rounded-xl text-xs font-bold border transition-all ${
                platform === 'server'
                  ? 'bg-[var(--primary-gradient)] text-white border-transparent shadow-[var(--shadow-button)]'
                  : 'bg-[var(--surface-soft)] text-[var(--text-secondary)] border-[var(--card-border)] hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]'
              }`}
            >
              Data Center
            </button>
          </div>
        </div>

        {/* Credentials */}
        <div className="context-card space-y-4">
          <div className="space-y-1.5">
            <label className="context-label uppercase tracking-wider block ml-1">Workspace URL</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
                <Link size={14} />
              </div>
              <input 
                type="url" 
                value={url} 
                onChange={e => setUrl(e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-2xl pl-9 pr-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] transition-all"
                placeholder={platform === 'cloud' ? 'https://your-domain.atlassian.net' : 'https://jira.your-corp.com'}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="context-label uppercase tracking-wider block ml-1">Admin Email</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center text-[var(--text-muted)]">
                <AtSign size={14} />
              </div>
              <input 
                type="text" 
                value={username} 
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-2xl pl-9 pr-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] transition-all"
                placeholder="admin@company.com"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center px-1">
              <label className="context-label uppercase tracking-wider">API Token</label>
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
                type="password" 
                value={token} 
                onChange={e => setToken(e.target.value)}
                className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-2xl pl-9 pr-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] transition-all"
                placeholder="••••••••••••••••"
                required
              />
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
        </div>

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
          {isSubmitting ? 'Connecting...' : 'Save & Authenticate'}
        </ActionButton>
      </form>
    </div>
  );
};

export default SetupView;
