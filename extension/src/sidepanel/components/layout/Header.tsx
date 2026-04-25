import React from 'react';
import { Bug, Settings, LogOut, Moon, Sun } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { StatusBadge } from '../common/DesignSystem';

const Header: React.FC = () => {
  const { session, auth: { globalView }, ai: { fetchAISettings, usage }, updateSession, handleLogout } = useBugMind();

  return (
    <header className="panel-header">
      <div className="flex items-center gap-3">
        <div className="panel-icon">
          <Bug className="text-white" size={20} />
        </div>
        <div className="leading-tight">
          <h1 className="panel-title">
            BugMind <span className="text-[var(--primary-blue)] opacity-70">AI</span>
          </h1>
          <div className="panel-subtitle">Issue Copilot</div>
        </div>
      </div>

      {globalView !== 'auth' && (
        <div className="panel-actions">
          {usage && (
            <div className="hidden sm:flex items-center">
              <StatusBadge tone="success" className="bg-[var(--surface-soft)]">
                {usage.remaining} left
              </StatusBadge>
            </div>
          )}
          
          <div className="flex items-center gap-1">
            <button
              onClick={() => updateSession({
                theme: session.theme === 'dark' ? 'light' : 'dark',
                themeSource: 'manual'
              })}
              className="p-2.5 hover:bg-[var(--surface-soft)] rounded-full transition-all text-[var(--text-secondary)] hover:text-[var(--primary-blue)]"
              title={session.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {session.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button 
              onClick={() => { fetchAISettings(); updateSession({ view: 'settings' }); }} 
              className="p-2.5 hover:bg-[var(--surface-soft)] rounded-full transition-all text-[var(--text-secondary)] hover:text-[var(--primary-blue)]"
              title="Settings"
            >
              <Settings size={18} />
            </button>
            
            <button 
              onClick={handleLogout} 
              className="p-2.5 hover:bg-[var(--error-bg)] rounded-full transition-all text-[var(--text-secondary)] hover:text-[var(--error)]"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
