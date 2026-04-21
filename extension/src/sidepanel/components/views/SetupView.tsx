import React, { useEffect, useState } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { ExternalLink, ArrowLeft, RefreshCw, Globe, ShieldCheck } from 'lucide-react';

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
    <div className="space-y-8 pt-6 animate-bp-flicker">
      <div className="flex items-center gap-4">
        {hasConnections && (
          <button 
            onClick={() => setGlobalView('main')}
            className="p-3 bg-[var(--bg-input)] hover:bg-[var(--bg-card)] rounded-none border border-[var(--border-main)] transition-all text-[var(--text-muted)] hover:text-[var(--text-main)] shadow-sm group"
          >
            <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
          </button>
        )}
        <div className="space-y-1">
          <h2 className="text-xl font-black bp-heading">Instance Config</h2>
          <div className="flex items-center gap-2">
            <div className="h-1 w-6 bg-[var(--status-info)]/30 rounded-full"></div>
            <p className="bp-subheading lowercase font-bold tracking-tight opacity-40">Link your Jira workspace</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Global Orchestrator Settings */}
        <div className="bp-panel p-6 rounded-none relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--status-info)]/20 to-transparent"></div>
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2 bg-[var(--status-info)]/10 rounded-none border border-[var(--status-info)]/20 shadow-inner">
              <Globe size={16} className="text-[var(--status-info)]" />
            </div>
            <span className="bp-subheading text-[var(--status-info)]">BugMind Engine</span>
          </div>
          <div className="space-y-2">
            <label className="bp-subheading ml-1 opacity-40 lowercase">Control Plane Endpoint</label>
            <input 
              type="url" 
              value={apiBase} 
              onChange={e => {
                const val = e.target.value;
                setApiBase(val);
                chrome.storage.local.set({ 'bugmind_api_base': val.trim().replace(/\/+$/, '') });
              }}
              className="w-full bp-input rounded-none px-5 py-4 outline-none transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-20"
              placeholder="https://api.bugmind.ai/v1"
              required
            />
          </div>
        </div>

        {/* Platform Selection */}
        <div className="space-y-3">
          <label className="bp-subheading ml-2 opacity-40 lowercase">Deployment Architecture</label>
          <div className="flex bg-[var(--bg-input)] p-1.5 rounded-none border border-[var(--border-main)] shadow-inner">
            <button 
              type="button" 
              onClick={() => setPlatform('cloud')}
              className={`flex-1 py-3 text-[10px] font-black uppercase tracking-[0.2em] rounded-none transition-all duration-500 ${platform === 'cloud' ? 'bg-[var(--accent)] text-white shadow-xl shadow-[var(--accent)]/20 translate-y-[-1px]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
            >
              Atlassian Cloud
            </button>
            <button 
              type="button" 
              onClick={() => setPlatform('server')}
              className={`flex-1 py-3 text-[10px] font-black uppercase tracking-[0.2em] rounded-none transition-all duration-500 ${platform === 'server' ? 'bg-[var(--accent)] text-white shadow-xl shadow-[var(--accent)]/20 translate-y-[-1px]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
            >
              Data Center
            </button>
          </div>
        </div>

        {/* Credentials Section */}
        <div className="bp-card rounded-none p-8 space-y-6 shadow-2xl relative overflow-hidden border border-[var(--border-main)]">
          <div className="space-y-2">
            <label className="bp-subheading ml-1 opacity-40 lowercase">Workspace URL</label>
            <input 
              type="url" 
              value={url} 
              onChange={e => setUrl(e.target.value)}
              className="w-full bp-input rounded-none px-5 py-4 outline-none transition-all text-sm text-[var(--text-main)]"
              placeholder={platform === 'cloud' ? "https://your-domain.atlassian.net" : "https://jira.your-corp.com"}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="bp-subheading ml-1 opacity-40 lowercase">Administrative Identity</label>
            <input 
              type="text" 
              value={username} 
              onChange={e => setUsername(e.target.value)}
              className="w-full bp-input rounded-none px-5 py-4 outline-none transition-all text-sm text-[var(--text-main)]"
              placeholder="identity@company.com"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center px-2">
              <label className="bp-subheading opacity-40 lowercase">Secure Access Key</label>
              <a 
                href={platform === 'cloud' ? "https://id.atlassian.com/manage-profile/security/api-tokens" : "https://confluence.atlassian.com/x/8Y9XN"} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[9px] text-[var(--status-info)] hover:text-[var(--accent-hover)] flex items-center gap-1.5 font-black uppercase tracking-widest transition-all"
              >
                Generate {platform === 'cloud' ? 'API Token' : 'PAT'}
                <ExternalLink size={12} />
              </a>
            </div>
            <input 
              type="password" 
              value={token} 
              onChange={e => setToken(e.target.value)}
              className="w-full bp-input rounded-none px-5 py-4 outline-none transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-20"
              placeholder="••••••••••••••••"
              required
            />
          </div>

          <div className="flex items-center gap-4 px-2 py-1 group cursor-pointer" onClick={() => setVerifySsl(!verifySsl)}>
            <div className={`w-6 h-6 rounded-none border transition-all flex items-center justify-center ${verifySsl ? 'bg-[var(--status-success)] border-[var(--status-success)] shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'border-[var(--border-main)] bg-[var(--bg-input)] group-hover:border-[var(--status-success)]/40'}`}>
              <ShieldCheck size={14} className={verifySsl ? 'text-white' : 'text-[var(--text-muted)]'} />
            </div>
            <div className="flex flex-col">
              <span className="bp-subheading opacity-80 group-hover:opacity-100 transition-opacity">Enforce Protocol Security</span>
              <span className="text-[8px] font-bold text-[var(--text-muted)] opacity-40 uppercase tracking-tight">Verify SSL certificates during sync</span>
            </div>
          </div>
        </div>

        <button 
          type="submit" 
          disabled={isSubmitting}
          className="group relative w-full overflow-hidden bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-white font-black py-5 rounded-[2rem] transition-all shadow-2xl shadow-[var(--accent)]/30 enabled:hover:scale-[1.02] enabled:hover:shadow-[var(--accent)]/50 active:scale-[0.98] disabled:opacity-40 disabled:grayscale cursor-pointer"
        >
          {/* Shimmer Effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>
          
          <div className="relative flex items-center justify-center gap-3">
            {isSubmitting ? (
              <RefreshCw size={20} className="animate-spin" />
            ) : (
              <ShieldCheck size={20} />
            )}
            <span className="text-sm uppercase tracking-[0.15em]">{isSubmitting ? 'Synchronizing Environment...' : 'Authenticate & Save Cluster'}</span>
          </div>
        </button>
      </form>
    </div>
  );
};

export default SetupView;

