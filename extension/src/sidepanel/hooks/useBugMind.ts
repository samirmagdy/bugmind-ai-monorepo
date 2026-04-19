import { createContext, useContext } from 'react';
import { useSession } from './useSession';
import { DebugLog } from '../types';

import { useAuthContext } from '../context/AuthProvider';
import { useJiraContext } from '../context/JiraProvider';
import { useAIContext } from '../context/AIProvider';

export interface BugMindContextType {
  // Session & Tab
  session: ReturnType<typeof useSession>['session'];
  updateSession: ReturnType<typeof useSession>['updateSession'];
  currentTabId: number | null;
  setTabSessions: ReturnType<typeof useSession>['setTabSessions'];
  
  // Auth
  auth: ReturnType<typeof useAuthContext>;
  
  // Jira
  jira: ReturnType<typeof useJiraContext>;
  
  // AI
  ai: ReturnType<typeof useAIContext>;
  
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
