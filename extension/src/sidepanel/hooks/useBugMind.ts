import { createContext, useContext } from 'react';
import { useSession } from './useSession';
import { useAuth } from './useAuth';
import { useJira } from './useJira';
import { useAI } from './useAI';
import { DebugLog } from '../types';

export interface BugMindContextType {
  // Session & Tab
  session: ReturnType<typeof useSession>['session'];
  updateSession: ReturnType<typeof useSession>['updateSession'];
  currentTabId: ReturnType<typeof useSession>['currentTabId'];
  setTabSessions: ReturnType<typeof useSession>['setTabSessions'];
  
  // Auth
  auth: ReturnType<typeof useAuth>;
  
  // Jira
  jira: ReturnType<typeof useJira>;
  
  // AI
  ai: ReturnType<typeof useAI>;
  
  // Utils
  debug: {
    logs: DebugLog[];
    show: boolean;
    setShow: (show: boolean) => void;
    log: (tag: string, msg: string) => void;
    clear: () => void;
  };
  // Orchestration Methods
  refreshIssue: (force?: boolean) => void;
  checkAuth: (token?: string) => Promise<void>;
  handleLogin: (e: React.FormEvent) => Promise<void>;
  handleRegister: (e: React.FormEvent) => Promise<void>;
  handleJiraConnect: (e: React.FormEvent) => Promise<void>;
  handleSaveSettings: (e: React.FormEvent) => Promise<void>;
  saveFieldSettings: (nextFields?: string[], nextMapping?: Record<string, string>) => Promise<void>;
  handleLogout: () => void;
  handleTabReload: () => void;
  completeOnboarding: () => Promise<void>;
  
  // Status
  initializing: boolean;
  sessionHydrated: boolean;
}

export const BugMindContext = createContext<BugMindContextType | undefined>(undefined);

export const useBugMind = () => {
  const context = useContext(BugMindContext);
  if (context === undefined) {
    throw new Error('useBugMind must be used within a BugMindProvider');
  }
  return context;
};
