import { useState, useEffect, useCallback, useMemo } from 'react';
import { View } from '../types';
import { deobfuscate } from '../utils/StorageObfuscator';

const DEFAULT_API_BASE = 'http://localhost:8000/api/v1';

function normalizeApiBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE;

  if (trimmed.endsWith('/api')) {
    return `${trimmed}/v1`;
  }

  return trimmed;
}

export function useAuth(logDebug: (tag: string, msg: string) => void) {
  const [globalView, setGlobalView] = useState<View>('auth');
  const [initializing, setInitializing] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);

  // Auth/Setup Form States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [rememberMe, setRememberMe] = useState(true);

  const setGlobalViewWithLog = useCallback((view: View) => {
    logDebug('VIEW-CHG', `Transitioning to ${view.toUpperCase()}`);
    setGlobalView(view);
  }, [logDebug]);

  useEffect(() => {
    // Load Global Config & Auth State
    logDebug('AUTH-INIT', 'Checking storage for existing session...');
    chrome.storage.local.get(['bugmind_api_base', 'bugmind_token', 'bugmind_email', 'bugmind_remember_me'], (local) => {
      if (local.bugmind_api_base) {
        const normalized = normalizeApiBase(local.bugmind_api_base as string);
        setApiBase(normalized);
        if (normalized !== local.bugmind_api_base) {
          chrome.storage.local.set({ bugmind_api_base: normalized });
        }
      }
      if (local.bugmind_email) setEmail(local.bugmind_email as string);
      if (local.bugmind_remember_me !== undefined) setRememberMe(local.bugmind_remember_me as boolean);
      
      // Check session storage first (highest priority) then local
      chrome.storage.session.get(['bugmind_token'], (session) => {
        const tokenValue = (session.bugmind_token as string || local.bugmind_token as string);
        const token = deobfuscate(tokenValue);
        
        if (token) {
          setAuthToken(token);
          logDebug('AUTH-LOAD', `Token found ${session.bugmind_token ? '(session)' : '(local)'}. Verifying...`);
        } else {
          logDebug('AUTH-LOAD', 'No token found in storage.');
          setGlobalView('auth');
          // If no token, we can stop initializing now
          setInitializing(false);
        }
        setStorageLoaded(true);
      });
    });
  }, [logDebug]);

  const handleLogout = useCallback((clearSessions: () => void) => {
    chrome.storage.local.remove(['bugmind_token'], () => {
      chrome.storage.session.remove(['bugmind_token'], () => {
        setAuthToken(null);
        clearSessions();
        setGlobalViewWithLog('auth');
        logDebug('LOGOUT', 'Logged out and cleared auth tokens');
      });
    });
  }, [logDebug, setGlobalViewWithLog]);

  return useMemo(() => ({
    globalView, setGlobalView: setGlobalViewWithLog,
    initializing, setInitializing,
    authToken, setAuthToken,
    storageLoaded,
    apiBase,
    setApiBase: (url: string) => setApiBase(normalizeApiBase(url)),
    email, setEmail,
    password, setPassword,
    confirmPassword, setConfirmPassword,
    authMode, setAuthMode,
    rememberMe, setRememberMe,
    handleLogout
  }), [
    globalView, setGlobalViewWithLog, 
    initializing, authToken, 
    apiBase, email, 
    password, confirmPassword, 
    authMode, rememberMe, 
    handleLogout
  ]);
}
