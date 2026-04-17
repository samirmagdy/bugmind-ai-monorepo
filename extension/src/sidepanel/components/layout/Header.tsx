import React from 'react';
import { Bug, Settings, LogOut, Sun, Moon } from 'lucide-react';
import { useBugMind } from '../../context/BugMindContext';

const Header: React.FC = () => {
  const { session: { theme }, auth: { globalView }, ai: { fetchAISettings }, updateSession, handleLogout } = useBugMind();

  return (
    <header className="px-5 py-4 border-b border-[var(--border-main)] flex justify-between items-center backdrop-blur-xl bg-[var(--bg-app)]/80 dark:bg-white/5 sticky top-0 z-50 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 bg-blue-500/10 rounded-xl border border-blue-500/20 shadow-inner">
          <Bug className="text-blue-500" size={20} />
        </div>
        <h1 className="text-lg font-black tracking-tighter bg-gradient-to-tr from-blue-500 via-blue-400 to-indigo-400 bg-clip-text text-transparent">BugMind</h1>
      </div>
      {globalView !== 'auth' && (
        <div className="flex items-center gap-1">
          <button 
            onClick={() => { fetchAISettings(); updateSession({ view: 'settings' }); }} 
            className="p-2.5 hover:bg-blue-500/10 rounded-2xl transition-all text-[var(--text-muted)] hover:text-blue-500 border border-transparent hover:border-blue-500/20"
            title="Settings"
          >
            <Settings size={18} />
          </button>
          <button 
            onClick={() => updateSession({ 
              theme: theme === 'light' ? 'dark' : 'light',
              themeSource: 'manual'
            })}
            className="p-2.5 hover:bg-amber-500/10 dark:hover:bg-blue-500/10 rounded-2xl transition-all text-[var(--text-muted)] hover:text-amber-500 dark:hover:text-blue-400 border border-transparent hover:border-amber-500/20 dark:hover:border-blue-500/20"
            title={theme === 'light' ? "Switch to Dark Mode" : "Switch to Light Mode"}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button 
            onClick={handleLogout} 
            className="p-2.5 hover:bg-red-500/10 rounded-2xl transition-all text-[var(--text-muted)] hover:text-red-500 border border-transparent hover:border-red-500/20"
            title="Log Out"
          >
            <LogOut size={18} />
          </button>
        </div>
      )}
    </header>
  );
};

export default Header;
