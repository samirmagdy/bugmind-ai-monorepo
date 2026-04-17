import { useState, useEffect } from 'react';
import { View } from '../types';
import { deobfuscate } from '../utils/StorageObfuscator';


export function useAuth(logDebug: (tag: string, msg: string) => void) {
  const [globalView, setGlobalView] = useState<View>('auth');
  const [initializing, setInitializing] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [apiBase, setApiBase] = useState('http://localhost:8000/api');

  // Auth/Setup Form States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [rememberMe, setRememberMe] = useState(true);

  useEffect(() => {
    // Load Global Config & Auth State
    chrome.storage.local.get(['bugmind_api_base', 'bugmind_token', 'bugmind_email', 'bugmind_remember_me'], (local) => {
      if (local.bugmind_api_base) setApiBase(local.bugmind_api_base);
      if (local.bugmind_email) setEmail(local.bugmind_email);
      if (local.bugmind_remember_me !== undefined) setRememberMe(local.bugmind_remember_me);
      
      // Check session storage first (highest priority) then local
      chrome.storage.session.get(['bugmind_token'], (session) => {
        // Deobfuscate tokens if present
        const token = deobfuscate(session.bugmind_token || local.bugmind_token);
        if (token) {
          setAuthToken(token);
          logDebug('AUTH-LOAD', `Session restored ${session.bugmind_token ? '(session)' : '(local)'}`);
        } else {
          setGlobalView('auth');
          setInitializing(false);
        }
      });
    });
  }, []);

  const handleLogout = (clearSessions: () => void) => {
    chrome.storage.local.remove(['bugmind_token'], () => {
      chrome.storage.session.remove(['bugmind_token'], () => {
        setAuthToken(null);
        clearSessions();
        setGlobalViewWithLog('auth');
        logDebug('LOGOUT', 'Logged out and cleared auth tokens');
      });
    });
  };

  const setGlobalViewWithLog = (view: View) => {
    logDebug('VIEW-CHG', `Transitioning to ${view.toUpperCase()}`);
    setGlobalView(view);
  };

  return {
    globalView, setGlobalView: setGlobalViewWithLog,
    initializing, setInitializing,
    authToken, setAuthToken,
    apiBase, setApiBase,
    email, setEmail,
    password, setPassword,
    confirmPassword, setConfirmPassword,
    authMode, setAuthMode,
    rememberMe, setRememberMe,
    handleLogout
  };
}
