import React from 'react';
import { Bug, Settings, LogOut, Moon, Sun, ClipboardList, Layout, Search } from 'lucide-react';
import { useBugMind } from '../../hooks/useBugMind';
import { StatusBadge } from '../common/DesignSystem';

const Header: React.FC = () => {
  const { session, auth: { globalView }, ai: { fetchAISettings, usage }, updateSession, handleLogout } = useBugMind();
  const navItems = [
    { view: 'main' as const, label: 'Work', icon: Bug },
    { view: 'jobs' as const, label: 'Jobs', icon: ClipboardList },
    { view: 'workspace' as const, label: 'Workspace', icon: Layout }
  ];

  return (
    <header className="panel-header">
      <div className="min-w-0 flex items-center gap-3">
        <div className="panel-icon">
          <Bug className="text-white" size={20} />
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="panel-title">
            BugMind <span className="text-[var(--primary-blue)] opacity-70">AI</span>
          </h1>
          <div className="panel-subtitle">Issue Copilot</div>
        </div>
      </div>

      {globalView !== 'auth' && (
        <div className="panel-actions">
          <nav className="panel-nav" aria-label="Primary panel navigation">
            {navItems.map(({ view, label, icon: Icon }) => (
              <button
                key={view}
                type="button"
                onClick={() => updateSession({ view })}
                className={`panel-nav-button ${session.view === view ? 'panel-nav-button-active' : ''}`}
                title={label}
                aria-label={label}
                aria-current={session.view === view ? 'page' : undefined}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {usage && (
            <div className="panel-usage">
              <StatusBadge tone="success" className="bg-[var(--surface-soft)]">
                {usage.remaining} left
              </StatusBadge>
            </div>
          )}
          
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => updateSession({ commandPaletteOpen: true })}
              className="icon-action"
              title="Search actions"
              aria-label="Search actions"
            >
              <Search size={18} />
            </button>
            <button
              type="button"
              onClick={() => updateSession({
                theme: session.theme === 'dark' ? 'light' : 'dark',
                themeSource: 'manual'
              })}
              className="icon-action"
              title={session.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={session.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {session.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button 
              type="button"
              onClick={() => { fetchAISettings(); updateSession({ view: 'settings' }); }} 
              className={`icon-action ${session.view === 'settings' ? 'icon-action-active' : ''}`}
              title="Settings"
              aria-label="Settings"
            >
              <Settings size={18} />
            </button>
            
            <button 
              type="button"
              onClick={handleLogout} 
              className="icon-action icon-action-danger"
              title="Logout"
              aria-label="Logout"
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
