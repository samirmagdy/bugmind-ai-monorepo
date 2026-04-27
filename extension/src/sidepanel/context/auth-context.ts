import { createContext } from 'react';
import { View } from '../types';

export interface AuthContextType {
  globalView: View;
  setGlobalView: (view: View) => void;
  initializing: boolean;
  setInitializing: (val: boolean) => void;
  authToken: string | null;
  setAuthToken: (token: string | null) => void;
  refreshToken: string | null;
  setRefreshToken: (token: string | null) => void;
  refreshSession: () => Promise<string | null>;
  storageLoaded: boolean;
  apiBase: string;
  setApiBase: (url: string) => void;
  email: string;
  setEmail: (email: string) => void;
  password: string;
  setPassword: (pw: string) => void;
  confirmPassword: string;
  setConfirmPassword: (pw: string) => void;
  resetCode: string;
  setResetCode: (code: string) => void;
  authMode: 'login' | 'register' | 'forgot' | 'reset';
  setAuthMode: (mode: 'login' | 'register' | 'forgot' | 'reset') => void;
  rememberMe: boolean;
  setRememberMe: (val: boolean) => void;
  handleLogout: (clearSessions: () => void) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
