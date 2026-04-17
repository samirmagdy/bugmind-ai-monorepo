import { useEffect } from 'react';
import { Loader2, AlertCircle, Plus } from 'lucide-react';

// Context
import { useBugMind } from './hooks/useBugMind';

// Components
import Header from './components/layout/Header';
import { translateError } from './utils/ErrorTranslator';
import AuthView from './components/views/AuthView';
import SetupView from './components/views/SetupView';
import MainView from './components/views/MainView';
import SuccessView from './components/views/SuccessView';
import SettingsView from './components/views/SettingsView';
import DebugConsole from './components/layout/DebugConsole';
import BlockingLoader from './components/common/BlockingLoader';
import OnboardingTour from './components/common/OnboardingTour';
import { INTERVALS, APP_VERSION } from './constants';

export default function App() {
  const { 
    session, updateSession, auth, initializing, checkAuth, refreshIssue, debug, handleLogout, sessionHydrated 
  } = useBugMind();

  useEffect(() => {
    checkAuth();
  }, [auth.authToken, checkAuth]);

  // Sync logic: Primary refresh when entering main view
  useEffect(() => {
    if (auth.authToken && session.view === 'main' && auth.globalView === 'main') {
      debug.log('INIT-SYNC', 'App entering main view, triggering refresh...');
      refreshIssue();
    }
  }, [auth.authToken, session.view, auth.globalView, debug, refreshIssue]);

  // Context Discovery Poller: Only runs in background when main view is active
  useEffect(() => {
    if (auth.authToken && session.view === 'main' && auth.globalView === 'main') {
      const interval = setInterval(() => {
        // Only trigger poll if we DON'T have data and aren't already fetching
        if (!session.issueData && !session.loading) {
          debug.log('POLL-SYNC', 'Poller triggering dynamic refresh...');
          refreshIssue();
        }
      }, INTERVALS.CONTEXT_DISCOVERY);
      return () => clearInterval(interval);
    }
  }, [auth.authToken, session.view, auth.globalView, session.issueData, session.loading, debug, refreshIssue]);

  if (initializing) {
    return (
      <div className={`h-screen flex flex-col items-center justify-center space-y-6 p-8 transition-colors duration-700 bg-[var(--bg-app)]`}>
        <div className="relative">
          <div className={`absolute inset-0 blur-3xl rounded-full animate-pulse bg-[var(--status-info)]/20`} />
          <div className="relative z-10 bg-[var(--bg-card)] backdrop-blur-md p-6 rounded-3xl border border-[var(--border-main)] shadow-2xl">
            <Loader2 className="w-10 h-10 text-[var(--status-info)] animate-spin" />
          </div>
        </div>
        <div className="text-center space-y-3">
          <h2 className={`text-2xl font-black tracking-tight text-[var(--text-main)]`}>BugMind AI</h2>
          <div className="flex flex-col items-center gap-1">
            <p className={`text-sm font-medium text-[var(--text-muted)] opacity-80`}>Resuming secure session...</p>
            <div className={`h-1 w-32 rounded-full overflow-hidden bg-[var(--border-main)] opacity-50`}>
              <div className="h-full bg-[var(--status-info)] animate-progress origin-left" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Determine active view
  const activeView = auth.globalView === 'auth' || auth.globalView === 'setup' ? auth.globalView : session.view;

  return (
    <div className={`flex flex-col h-screen text-[var(--text-main)] overflow-hidden font-sans selection:bg-[var(--status-info)]/30 transition-colors duration-500 ${session.theme === 'light' ? 'theme-light bg-[var(--bg-app)]' : 'bg-[var(--bg-app)]'}`}>
      <Header />

      <main className="flex-1 overflow-y-auto overflow-x-hidden relative custom-scrollbar">
        <div className="p-4 pb-24 max-w-4xl mx-auto">
          {session.error && !['NOT_A_JIRA_PAGE', 'UNSUPPORTED_ISSUE_TYPE'].includes(session.error) && (
            <div className="mb-4 p-4 bg-[var(--status-danger)]/10 border border-[var(--status-danger)]/20 rounded-2xl flex items-start gap-3 animate-in slide-in-from-top-2 duration-300">
              <AlertCircle className="w-5 h-5 text-[var(--status-danger)] shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-black text-[var(--status-danger)] tracking-tight opacity-90">{translateError(session.error).title}</p>
                <p className="text-[11px] font-medium text-[var(--status-danger)]/80 leading-relaxed mt-0.5">{translateError(session.error).description}</p>
                <button 
                  onClick={() => updateSession({ error: null })}
                  className="mt-2 text-xs font-bold text-[var(--status-danger)] hover:opacity-70 transition-colors uppercase tracking-widest"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          
          {session.success && (
            <div className="mb-4 p-4 bg-[var(--status-success)]/10 border border-[var(--status-success)]/20 rounded-[1.5rem] flex items-center gap-4 animate-in slide-in-from-top-4 duration-500 shadow-xl shadow-[var(--status-success)]/5">
              <div className="w-10 h-10 bg-[var(--status-success)]/20 rounded-2xl flex items-center justify-center shrink-0 border border-[var(--status-success)]/30">
                <div className="w-2 h-2 bg-[var(--status-success)] rounded-full animate-ping" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-black text-[var(--status-success)] tracking-tight leading-tight opacity-90">{session.success}</p>
                <p className="text-[10px] text-[var(--status-success)]/70 font-bold uppercase tracking-widest mt-0.5">Operation Successful</p>
              </div>
              <button 
                onClick={() => updateSession({ success: null })}
                className="p-2 hover:bg-[var(--status-success)]/10 rounded-xl transition-all text-[var(--status-success)] hover:text-[var(--text-main)]"
              >
                <Plus size={16} className="rotate-45" />
              </button>
            </div>
          )}

          {activeView === 'auth' && <AuthView />}
          {activeView === 'setup' && <SetupView />}
          
          {activeView === 'main' && (
            <MainView />
          )}

          {activeView === 'success' && <SuccessView />}
          {activeView === 'settings' && <SettingsView />}
        </div>
      </main>

      <footer className="h-10 border-t border-[var(--border-main)] bg-[var(--bg-app)]/80 backdrop-blur-xl flex items-center justify-between px-4 fixed bottom-0 left-0 right-0 z-50">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => debug.setShow(!debug.show)}
            className={`text-[9px] uppercase tracking-[0.2em] font-black transition-all ${debug.show ? 'text-[var(--status-info)]' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
          >
            {debug.show ? 'Close Console' : 'Telemetry Log'}
          </button>
        </div>
        
        <div className="flex items-center gap-3">
          {auth.authToken && (
            <button 
              onClick={handleLogout}
              className="text-[9px] uppercase tracking-[0.2em] font-black text-[var(--text-muted)] hover:text-[var(--status-danger)] transition-all font-bold"
            >
              Log Out
            </button>
          )}
          <span className="text-[10px] text-[var(--text-muted)] font-bold opacity-30">{APP_VERSION}</span>
        </div>
      </footer>

      {debug.show && <DebugConsole />}
      {session.loading && <BlockingLoader />}
      {sessionHydrated && !session.onboardingCompleted && <OnboardingTour />}
    </div>
  );
}
