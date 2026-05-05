import { useEffect, useRef } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

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
import { JobDashboardView } from './components/views/JobDashboardView';
import DebugConsole from './components/layout/DebugConsole';
import BlockingLoader from './components/common/BlockingLoader';
import OnboardingTour from './components/common/OnboardingTour';
import { ActionButton, StatusPanel } from './components/common/DesignSystem';
import { XrayCloudWizard } from './components/views/XrayCloudWizard';
import { APP_VERSION } from './constants';

export default function App() {
  const { 
    session, updateSession, auth, initializing, checkAuth, refreshIssue, debug, handleLogout, sessionHydrated 
  } = useBugMind();
  const debugLog = debug.log;
  const themeClass = session.theme === 'dark' ? 'theme-dark' : 'theme-light';
  
  const lastEffectiveView = useRef<string | null>(null);
  const lastAuthCheckKey = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.body.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add(themeClass);
    document.body.classList.add(themeClass);

    return () => {
      document.documentElement.classList.remove(themeClass);
      document.body.classList.remove(themeClass);
    };
  }, [themeClass]);

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
      <div className={`bugmind-panel relative overflow-hidden bg-[var(--bg-page)] ${themeClass}`}>
        <div className="panel-header">
          <div className="flex items-center gap-3">
            <div className="panel-icon">
              <Loader2 className="text-white animate-spin" size={18} />
            </div>
            <div className="leading-tight">
              <h1 className="panel-title">
                BugMind <span className="text-[var(--primary-blue)] opacity-70">AI</span>
              </h1>
              <div className="panel-subtitle">Initializing</div>
            </div>
          </div>
        </div>

        <main className="relative z-[1] flex-1 overflow-hidden">
          <div className="flex h-full items-start justify-center px-2.5 pt-4 pb-4">
            <div className="context-card w-full rounded-[1.5rem] px-5 py-6">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.1rem] border border-[var(--card-border)] bg-[var(--surface-accent-strong)] text-[var(--primary-blue)]">
                  <Loader2 className="animate-spin" size={22} />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                      Extension Startup
                    </p>
                    <h2 className="text-[18px] font-extrabold tracking-[-0.03em] text-[var(--text-primary)]">
                      Securing workspace
                    </h2>
                    <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">
                      Reloading authentication, restoring the active tab session, and reconnecting to Jira context.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--disabled-bg)]">
                      <div className="h-full w-full animate-pulse bg-[var(--primary-gradient)]" />
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      <span>Preparing panel</span>
                      <span>Syncing state</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        <footer className="relative z-[1] h-12 border-t border-[var(--footer-border)] bg-[var(--footer-bg)] flex items-center justify-between px-3 shrink-0">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Startup
          </span>
          <span className="text-[10px] text-[var(--text-muted)] font-semibold opacity-60">{APP_VERSION}</span>
        </footer>
      </div>
    );
  }

  return (
    <div className={`bugmind-panel bg-[var(--bg-page)] ${themeClass}`}>
      <Header />

      <main className="relative z-[1] flex-1 overflow-y-auto overflow-x-hidden">
        <div className="px-2.5 pt-2.5 pb-4 space-y-3">
          {(session.error && !['NOT_A_JIRA_PAGE', 'UNSUPPORTED_ISSUE_TYPE', 'NO_ISSUE_TYPES_FOUND', 'STALE_PAGE'].includes(session.error)) && (() => {
            const translated = translateError(session.error);
            return (
              <StatusPanel
                icon={AlertCircle}
                tone="danger"
                title={translated.title}
                description={
                  <div className="space-y-2">
                    <p>{translated.description}</p>
                    {translated.userAction && (
                      <p className="font-bold text-[var(--text-primary)]">
                        Action: {translated.userAction}
                      </p>
                    )}
                    {translated.traceId && (
                      <div className="flex items-center justify-between gap-2 border-t border-[var(--border-soft)] pt-2 mt-2">
                        <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-mono">
                          Trace ID: {translated.traceId}
                        </span>
                        <button
                          onClick={() => {
                            void navigator.clipboard.writeText(translated.traceId!);
                            // Optional: show a toast or feedback
                          }}
                          className="text-[9px] font-bold text-[var(--primary-blue)] uppercase hover:underline"
                        >
                          Copy Technical ID
                        </button>
                      </div>
                    )}
                  </div>
                }
                action={(
                  <ActionButton
                    onClick={() => updateSession({ error: null })}
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                  >
                    Dismiss
                  </ActionButton>
                )}
              />
            );
          })()}
          
          {session.success && (
            <StatusPanel
              icon={CheckCircle2}
              tone="success"
              title="Success"
              description={session.success}
              action={(
                <ActionButton
                  onClick={() => updateSession({ success: null })}
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                >
                  Dismiss
                </ActionButton>
              )}
            />
          )}

          {activeView === 'auth' && <AuthView />}
          {activeView === 'setup' && <SetupView />}
          {activeView === 'main' && <MainView />}
          {activeView === 'success' && <SuccessView />}
          {activeView === 'settings' && <SettingsView />}
          {activeView === 'preview' && <PreviewView />}
          {activeView === 'jobs' && <JobDashboardView />}
        </div>
      </main>

      <footer className="relative z-[1] h-12 border-t border-[var(--footer-border)] bg-[var(--footer-bg)] flex items-center justify-between px-3 shrink-0">
        <button 
          onClick={() => debug.setShow(!debug.show)}
          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.16em] transition-colors opacity-75 ${debug.show ? 'bg-[var(--surface-soft)] text-[var(--primary-blue)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:opacity-100'}`}
        >
          Debug Log
        </button>
        
        <div className="flex items-center gap-3">
          {auth.authToken && (
            <button 
              onClick={handleLogout}
              className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] hover:text-[var(--error)] hover:bg-[var(--surface-soft)] transition-colors opacity-75 hover:opacity-100"
            >
              Sign Out
            </button>
          )}
          <span className="text-[10px] text-[var(--text-muted)] font-semibold opacity-60">{APP_VERSION}</span>
        </div>
      </footer>

      {debug.show && <DebugConsole />}
      {session.showXrayCloudWizard && <XrayCloudWizard />}
      {session.loading && <BlockingLoader />}
      {auth.authToken && sessionHydrated && !session.onboardingCompleted && <OnboardingTour />}
    </div>
  );
}
