import React, { useEffect, useState } from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { ExternalLink, ArrowLeft } from 'lucide-react';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const connected = await jira.createConnection({
      auth_type: platform,
      base_url: url,
      username,
      token,
      verify_ssl: verifySsl
    });

    if (connected) {
      updateSession({ success: 'Connection saved successfully.' });
      setGlobalView('main');
    } else {
      updateSession({ error: 'Failed to save Jira connection.' });
    }
  };

  const hasConnections = (session.connections?.length || 0) > 0;

  return (
    <div className="space-y-6 pt-4 animate-in slide-in-from-right-4 duration-300">
      <div className="flex items-center gap-3">
        {hasConnections && (
          <button 
            onClick={() => setGlobalView('main')}
            className="p-2 hover:bg-[var(--bg-input)] rounded-full transition-colors text-[var(--text-muted)] hover:text-[var(--text-main)]"
            title="Back to Main"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-[var(--text-main)]">Add Connection</h2>
          <p className="text-sm text-[var(--text-muted)] opacity-80">Link a new Jira instance to BugMind.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Backend Endpoint - Only show if not configured or in advanced mode? Actually SetupView is for first time too */}
        <div className="p-4 bg-[var(--bg-card)] rounded-2xl border border-[var(--border-main)] shadow-[var(--shadow-sm)] space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-1 w-1 bg-[var(--status-info)] rounded-full"></div>
            <span className="text-[10px] font-black uppercase text-[var(--status-info)] tracking-widest">Global Settings</span>
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
              className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)]"
              placeholder="https://api.bugmind.ai/api/v1"
              required
            />
          </div>
        </div>

        <div className="flex bg-[var(--bg-input)] p-1 rounded-xl border border-[var(--border-main)] shadow-[var(--shadow-sm)]">
          <button 
            type="button" 
            onClick={() => setPlatform('cloud')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${platform === 'cloud' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
          >
            Jira Cloud
          </button>
          <button 
            type="button" 
            onClick={() => setPlatform('server')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${platform === 'server' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
          >
            Server / DC
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Jira Base URL</label>
          <input 
            type="url" 
            value={url} 
            onChange={e => setUrl(e.target.value)}
            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)]"
            placeholder={platform === 'cloud' ? "https://company.atlassian.net" : "http://jira.internal.com"}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Jira Email / Username</label>
          <input 
            type="text" 
            value={username} 
            onChange={e => setUsername(e.target.value)}
            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)]"
            placeholder="email@company.com"
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between items-center px-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">API Token / PAT</label>
            <a 
              href={platform === 'cloud' ? "https://id.atlassian.com/manage-profile/security/api-tokens" : "https://confluence.atlassian.com/x/8Y9XN"} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[10px] text-[var(--status-info)] hover:underline flex items-center gap-1 font-bold"
            >
              Get {platform === 'cloud' ? 'Token' : 'PAT'}
              <ExternalLink size={10} />
            </a>
          </div>
          <input 
            type="password" 
            value={token} 
            onChange={e => setToken(e.target.value)}
            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)]"
            placeholder="••••••••••••••••"
            required
          />
        </div>

        <div className="flex items-center gap-3 px-1 py-1">
          <input 
            type="checkbox" 
            id="verify-ssl-setup"
            checked={verifySsl} 
            onChange={e => setVerifySsl(e.target.checked)}
            className="w-4 h-4 rounded border-[var(--border-main)] bg-[var(--bg-input)] text-[var(--status-info)]"
          />
          <label htmlFor="verify-ssl-setup" className="text-xs text-[var(--text-muted)] cursor-pointer">
            Enforce SSL Security
          </label>
        </div>

        <button 
          type="submit" 
          disabled={jira.isInitializing}
          className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold py-3.5 rounded-xl transition-all shadow-lg"
        >
          {jira.isInitializing ? 'Connecting...' : 'Test & Save Connection'}
        </button>
      </form>
    </div>
  );
};

export default SetupView;
