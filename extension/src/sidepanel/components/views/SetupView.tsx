import React from 'react';
import { useBugMind } from '../../context/BugMindContext';
import { ExternalLink } from 'lucide-react';

const SetupView: React.FC = () => {
  const { 
    jira: { 
      jiraPlatform, setJiraPlatform, cloudUrl, setCloudUrl, serverUrl, setServerUrl,
      cloudUsername, setCloudUsername, serverUsername, setServerUsername,
      cloudToken, setCloudToken, serverToken, setServerToken, verifySsl, setVerifySsl,
      saveJiraConfig
    },
    auth: { apiBase, setApiBase },
    handleJiraConnect
  } = useBugMind();

  return (
    <div className="space-y-6 pt-4">
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-[var(--text-main)]">Project Setup</h2>
        <p className="text-sm text-[var(--text-muted)] opacity-80">Configure your BugMind connection settings.</p>
      </div>
      <form onSubmit={handleJiraConnect} className="space-y-4">
        <div className="p-4 bg-[var(--bg-card)] rounded-2xl border border-[var(--border-main)] shadow-[var(--shadow-sm)] space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-1 w-1 bg-[var(--status-info)] rounded-full"></div>
            <span className="text-[10px] font-black uppercase text-[var(--status-info)] tracking-widest">Backend Configuration</span>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">BugMind API Endpoint</label>
            <input 
              type="url" 
              value={apiBase} 
              onChange={e => {
                const val = e.target.value;
                setApiBase(val);
                chrome.storage.local.set({ 'bugmind_api_base': val });
              }}
              className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50"
              placeholder="https://api.bugmind.ai/api"
              required
            />
            <p className="text-[10px] text-[var(--text-muted)] ml-1 opacity-70">Must end with /api</p>
          </div>
        </div>

        <div className="flex bg-[var(--bg-input)] p-1 rounded-xl border border-[var(--border-main)] mb-4 shadow-[var(--shadow-sm)]">
          <button 
            type="button" 
            onClick={() => { setJiraPlatform('cloud'); saveJiraConfig({ platform: 'cloud' }); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${jiraPlatform === 'cloud' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
          >
            Jira Cloud
          </button>
          <button 
            type="button" 
            onClick={() => { setJiraPlatform('server'); saveJiraConfig({ platform: 'server' }); }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${jiraPlatform === 'server' ? 'bg-[var(--accent)] text-white shadow-lg' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
          >
            Server / DC
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Jira Base URL</label>
          <input 
            type="url" 
            value={jiraPlatform === 'cloud' ? cloudUrl : serverUrl} 
            onChange={e => {
              const val = e.target.value;
              if (jiraPlatform === 'cloud') { setCloudUrl(val); saveJiraConfig({ cloudUrl: val }); }
              else { setServerUrl(val); saveJiraConfig({ serverUrl: val }); }
            }}
            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50"
            placeholder={jiraPlatform === 'cloud' ? "https://company.atlassian.net" : "http://jira.internal.com"}
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1">Jira Email / Username</label>
          <input 
            type="text" 
            value={jiraPlatform === 'cloud' ? cloudUsername : serverUsername} 
            onChange={e => {
              const val = e.target.value;
              if (jiraPlatform === 'cloud') { setCloudUsername(val); saveJiraConfig({ cloudUsername: val }); }
              else { setServerUsername(val); saveJiraConfig({ serverUsername: val }); }
            }}
            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50 focus:scale-[1.01] focus:ring-1 focus:ring-[var(--status-info)]/10"
            placeholder="QA Lead / email@company.com"
            required
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between items-center px-1">
            <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)]">API Token / PAT</label>
            <a 
              href={jiraPlatform === 'cloud' ? "https://id.atlassian.com/manage-profile/security/api-tokens" : "https://confluence.atlassian.com/x/8Y9XN"} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[10px] text-[var(--status-info)] hover:underline flex items-center gap-1 font-bold"
            >
              Get {jiraPlatform === 'cloud' ? 'Token' : 'PAT'}
              <ExternalLink size={10} />
            </a>
          </div>
          <input 
            type="password" 
            value={jiraPlatform === 'cloud' ? cloudToken : serverToken} 
            onChange={e => {
              const val = e.target.value;
              if (jiraPlatform === 'cloud') { setCloudToken(val); saveJiraConfig({ cloudToken: val }); }
              else { setServerToken(val); saveJiraConfig({ serverToken: val }); }
            }}
            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50 focus:scale-[1.01] focus:ring-1 focus:ring-[var(--status-info)]/10"
            placeholder="ATATT3xFfGF..."
            required
          />
        </div>
        <div className="flex items-center gap-3 px-1 py-1">
          <input 
            type="checkbox" 
            id="verify-ssl-setup"
            checked={verifySsl} 
            onChange={e => {
              const val = e.target.checked;
              setVerifySsl(val);
              saveJiraConfig({ verifySsl: val });
            }}
            className="w-4 h-4 rounded border-[var(--border-main)] bg-[var(--bg-input)] text-[var(--status-info)] focus:ring-[var(--status-info)]/50"
          />
          <label htmlFor="verify-ssl-setup" className="text-xs text-[var(--text-muted)] cursor-pointer flex items-center gap-1.5">
            Enforce SSL Security 
            <span className="text-[9px] opacity-60">(Recommended for Production)</span>
          </label>
        </div>
        <button type="submit" className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-[var(--accent)]/20">
          Save Connection
        </button>
      </form>
    </div>
  );
};

export default SetupView;
