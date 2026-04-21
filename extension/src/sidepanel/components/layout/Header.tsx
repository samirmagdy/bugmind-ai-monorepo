import React from 'react';
import { Bug, Settings, LogOut, Sun, Moon } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { StatusBadge } from '../common/DesignSystem';

const Header: React.FC = () => {
  const { session: { theme }, auth: { globalView }, ai: { fetchAISettings, usage }, updateSession, handleLogout } = useBugMind();

  return (
    <header className="px-4 py-3 border-b border-[var(--border-main)] flex justify-between items-center backdrop-blur-[20px] bg-[var(--bg-app)]/70 sticky top-0 z-[100] shadow-xl shadow-black/5">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-[var(--accent)]/10 rounded-xl border border-[var(--accent)]/20 shadow-inner group">
          <Bug className="text-[var(--accent)] group-hover:scale-110 transition-transform duration-500" size={16} />
        </div>
        <h1 className="text-lg font-black tracking-tighter luxury-heading">
          BugMind <span className="opacity-30">AI</span>
        </h1>
      </div>

      {globalView !== 'auth' && (
        <div className="flex items-center gap-2">
          {usage && (
            <div className="hidden sm:flex items-center">
              <StatusBadge tone="success" className="shadow-inner">
                {usage.plan}: {usage.remaining}
              </StatusBadge>
            </div>
          )}
          
          <div className="flex items-center gap-1.5 p-1 bg-[var(--bg-input)]/50 rounded-xl border border-[var(--border-main)]">
            <button 
              onClick={() => { fetchAISettings(); updateSession({ view: 'settings' }); }} 
              className="p-2 hover:bg-[var(--bg-card)] rounded-xl transition-all text-[var(--text-muted)] hover:text-[var(--status-info)] border border-transparent hover:border-[var(--border-main)] group"
              title="Intelligence Config"
            >
              <Settings size={16} className="group-hover:rotate-45 transition-transform duration-500" />
            </button>
            
            <button 
              onClick={() => updateSession({ 
                theme: theme === 'light' ? 'dark' : 'light',
                themeSource: 'manual'
              })}
              className="p-2 hover:bg-[var(--bg-card)] rounded-xl transition-all text-[var(--text-muted)] hover:text-[var(--accent)] border border-transparent hover:border-[var(--border-main)]"
              title={theme === 'light' ? "Oscurify Interface" : "Illuminate Interface"}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            
            <div className="w-px h-4 bg-[var(--border-main)] mx-1"></div>
            
            <button 
              onClick={handleLogout} 
              className="p-2 hover:bg-[var(--status-danger)]/10 rounded-xl transition-all text-[var(--text-muted)] hover:text-[var(--status-danger)] border border-transparent hover:border-[var(--status-danger)]/20"
              title="Terminate Session"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
