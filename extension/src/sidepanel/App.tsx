import { useEffect, useRef } from 'react';
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
import PreviewView from './components/views/PreviewView';
import DebugConsole from './components/layout/DebugConsole';
import BlockingLoader from './components/common/BlockingLoader';
import OnboardingTour from './components/common/OnboardingTour';
import { APP_VERSION } from './constants';

export default function App() {
  const { 
    session, updateSession, auth, initializing, checkAuth, refreshIssue, debug, handleLogout, sessionHydrated 
  } = useBugMind();
  const debugLog = debug.log;
  
  const lastEffectiveView = useRef<string | null>(null);
  const lastAuthCheckKey = useRef<string | null>(null);

  useEffect(() => {
    if (!auth.storageLoaded) return;
    if (auth.globalView !== 'auth') return;
    if (session.loading) return;

    const authCheckKey = `${auth.storageLoaded}:${auth.authToken ? 'token' : 'guest'}:${auth.globalView}`;
    if (lastAuthCheckKey.current === authCheckKey) return;

    lastAuthCheckKey.current = authCheckKey;
    checkAuth();
  }, [auth.globalView, auth.storageLoaded, auth.authToken, checkAuth, session.loading]);

  // Logic to determine which view to show
  const activeView = (auth.globalView === 'auth' || auth.globalView === 'setup') 
    ? auth.globalView 
    : session.view;
    
  // Sync logic: Primary refresh when entering main view
  useEffect(() => {
    const isMain = auth.authToken && session.view === 'main' && auth.globalView === 'main';
    
    if (isMain && lastEffectiveView.current !== activeView) {
      debugLog('INIT-SYNC', 'App entering main view, triggering refresh...');
      refreshIssue();
    }
    
    // Track current view for next transition
    lastEffectiveView.current = activeView;
  }, [activeView, auth.authToken, auth.globalView, debugLog, refreshIssue, session.view]);




  if (initializing) {
    return (
      <div className="h-screen flex flex-col items-center justify-center space-y-8 p-10 bg-[var(--bg-app)] relative overflow-hidden">
        {/* Luxury Background Glow */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[var(--status-info)]/10 blur-[120px] rounded-full animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[var(--status-success)]/5 blur-[120px] rounded-full animate-pulse-slow"></div>

        <div className="relative group">
          <div className="absolute inset-0 blur-3xl rounded-full animate-pulse bg-[var(--status-info)]/20 group-hover:bg-[var(--status-info)]/30 transition-all duration-1000"></div>
          <div className="relative z-10 bp-panel p-8 rounded-none border border-[var(--border-main)] shadow-2xl animate-bp-flicker">
            <Loader2 className="w-12 h-12 text-[var(--status-info)] animate-spin" />
          </div>
        </div>

        <div className="text-center space-y-4 animate-bp-flicker stagger-1">
          <h2 className="text-xl font-black tracking-tighter bp-heading">BugMind <span className="opacity-40">AI</span></h2>
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 bg-[var(--status-info)] rounded-full animate-pulse"></div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)]">Resuming secure session</p>
            </div>
            <div className="h-1 w-40 rounded-full overflow-hidden bg-[var(--bg-input)] border border-[var(--border-main)]">
              <div className="h-full bg-gradient-to-r from-[var(--status-info)] to-[var(--accent-hover)] animate-progress origin-left" />
            </div>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className={`flex flex-col h-screen text-[var(--text-main)] overflow-hidden font-sans selection:bg-[var(--status-info)]/30 transition-colors duration-500 ${session.theme === 'light' ? 'theme-light bg-[var(--bg-app)]' : 'bg-[var(--bg-app)]'}`}>
      <Header />

      <main className="flex-1 overflow-y-auto overflow-x-hidden relative custom-scrollbar">
        <div className="p-4 pb-24 max-w-4xl mx-auto">
          {session.error && !['NOT_A_JIRA_PAGE', 'UNSUPPORTED_ISSUE_TYPE', 'NO_ISSUE_TYPES_FOUND', 'STALE_PAGE'].includes(session.error) && (
            <div className="mb-6 p-5 bp-panel border-[var(--status-danger)]/20 rounded-[2rem] flex items-start gap-4 animate-bp-flicker shadow-2xl shadow-[var(--status-danger)]/5 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[var(--status-danger)]/30 to-transparent"></div>
              <div className="w-10 h-10 bg-[var(--status-danger)]/10 rounded-none flex items-center justify-center shrink-0 border border-[var(--status-danger)]/20">
                <AlertCircle className="w-5 h-5 text-[var(--status-danger)]" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-black text-[var(--text-main)] tracking-tight uppercase">{translateError(session.error).title}</p>
                <p className="text-[11px] font-medium text-[var(--text-muted)] leading-relaxed mt-1">{translateError(session.error).description}</p>
                <button 
                  onClick={() => updateSession({ error: null })}
                  className="mt-3 text-[10px] font-black text-[var(--status-danger)] hover:opacity-70 transition-all uppercase tracking-widest flex items-center gap-2"
                >
                  <Plus size={12} className="rotate-45" />
                  Dismiss Warning
                </button>
              </div>
            </div>
          )}
          
          {session.success && (
            <div className="mb-6 p-5 bp-panel border-[var(--status-success)]/20 rounded-[2rem] flex items-center gap-4 animate-bp-flicker shadow-2xl shadow-[var(--status-success)]/5 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-[var(--status-success)]/30 to-transparent"></div>
              <div className="w-10 h-10 bg-[var(--status-success)]/10 rounded-none flex items-center justify-center shrink-0 border border-[var(--status-success)]/20">
                <div className="w-1.5 h-1.5 bg-[var(--status-success)] rounded-full animate-pulse shadow-[0_0_10px_var(--status-success)]" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-black text-[var(--text-main)] tracking-tight uppercase leading-tight">{session.success}</p>
                <p className="text-[9px] text-[var(--status-success)]/70 font-black uppercase tracking-[0.2em] mt-1">Operation Finalized</p>
              </div>
              <button 
                onClick={() => updateSession({ success: null })}
                className="p-2 hover:bg-[var(--status-success)]/10 rounded-none transition-all text-[var(--status-success)] hover:text-[var(--text-main)]"
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
          {activeView === 'preview' && <PreviewView />}
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
      {auth.authToken && sessionHydrated && !session.onboardingCompleted && <OnboardingTour />}
    </div>
  );
}
