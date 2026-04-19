import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { deobfuscate, obfuscate } from '../utils/StorageObfuscator';
import { apiRequest, readJsonResponse } from '../services/api';
import { View } from '../types';
import { AuthContext } from './auth-context';

const DEFAULT_API_BASE = 'http://localhost:8000/api/v1';

function normalizeApiBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE;

  if (trimmed.endsWith('/api')) {
    return `${trimmed}/v1`;
  }

  return trimmed;
}

function decodeStoredToken(encoded: string | undefined): string {
  if (!encoded) return '';

  const decoded = deobfuscate(encoded);
  if (decoded && decoded.split('.').length === 3 && !containsControlCharacters(decoded)) {
    return decoded;
  }

  try {
    const legacy = atob(encoded);
    if (legacy && legacy.split('.').length === 3 && !containsControlCharacters(legacy)) {
      return legacy;
    }
  } catch {
    // Ignore legacy decode failure and fall through.
  }

  return decoded;
}

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31;
  });
}

export const AuthProvider: React.FC<{ children: React.ReactNode, logDebug: (tag: string, msg: string) => void }> = ({ children, logDebug }) => {
  const [globalView, setGlobalView] = useState<View>('auth');
  const [initializing, setInitializing] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
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
    logDebug('AUTH-INIT', 'Checking storage for existing session...');
    chrome.storage.local.get(['bugmind_api_base', 'bugmind_token', 'bugmind_refresh_token', 'bugmind_email', 'bugmind_remember_me'], (local) => {
      if (local.bugmind_api_base) {
        const normalized = normalizeApiBase(local.bugmind_api_base as string);
        setApiBase(normalized);
        if (normalized !== local.bugmind_api_base) {
          chrome.storage.local.set({ bugmind_api_base: normalized });
        }
      }
      if (local.bugmind_email) setEmail(local.bugmind_email as string);
      if (local.bugmind_remember_me !== undefined) setRememberMe(local.bugmind_remember_me as boolean);
      
      // Phase 3: Check session storage first (highest priority) then local
      chrome.storage.session.get(['bugmind_token', 'bugmind_refresh_token'], (session) => {
        const tokenValue = (session.bugmind_token as string || local.bugmind_token as string);
        const refreshTokenValue = (session.bugmind_refresh_token as string || local.bugmind_refresh_token as string);
        const token = decodeStoredToken(tokenValue);
        const refreshed = decodeStoredToken(refreshTokenValue);
        
        if (token) {
          setAuthToken(token);
          if (refreshed) setRefreshToken(refreshed);
          logDebug('AUTH-LOAD', `Token found ${session.bugmind_token ? '(session)' : '(local)'}. Verifying...`);
        } else {
          logDebug('AUTH-LOAD', 'No token found in storage.');
          setGlobalView('auth');
          setInitializing(false);
        }
        setStorageLoaded(true);
      });
    });
  }, [logDebug]);

  const handleLogout = useCallback((clearSessions: () => void) => {
    chrome.storage.local.remove(['bugmind_token', 'bugmind_refresh_token'], () => {
      chrome.storage.session.remove(['bugmind_token', 'bugmind_refresh_token'], () => {
        setAuthToken(null);
        setRefreshToken(null);
        clearSessions();
        setGlobalViewWithLog('auth');
        logDebug('LOGOUT', 'Logged out and cleared auth tokens');
      });
    });
  }, [logDebug, setGlobalViewWithLog]);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    if (!refreshToken) return null;
    try {
      const res = await apiRequest(`${apiBase}/auth/refresh`, {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
        timeoutMs: 10000,
        onDebug: logDebug
      });
      if (!res.ok) {
        throw new Error(await res.text() || `Refresh failed (${res.status})`);
      }
      const data = await readJsonResponse<{ access_token: string; refresh_token: string }>(res);
      const secureAccessToken = obfuscate(data.access_token);
      const secureRefreshToken = obfuscate(data.refresh_token);
      setAuthToken(data.access_token);
      setRefreshToken(data.refresh_token);
      chrome.storage.session.set({ bugmind_token: secureAccessToken, bugmind_refresh_token: secureRefreshToken });
      if (rememberMe) {
        chrome.storage.local.set({ bugmind_token: secureAccessToken, bugmind_refresh_token: secureRefreshToken });
      }
      return data.access_token;
    } catch (err) {
      chrome.storage.local.remove(['bugmind_token', 'bugmind_refresh_token']);
      chrome.storage.session.remove(['bugmind_token', 'bugmind_refresh_token']);
      setAuthToken(null);
      setRefreshToken(null);
      setGlobalViewWithLog('auth');
      logDebug('AUTH-REFRESH-ERR', String(err));
      return null;
    }
  }, [apiBase, logDebug, refreshToken, rememberMe, setGlobalViewWithLog]);

  const value = useMemo(() => ({
    globalView, setGlobalView: setGlobalViewWithLog,
    initializing, setInitializing,
    authToken, setAuthToken,
    refreshToken, setRefreshToken,
    refreshSession,
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
    initializing, authToken, refreshToken, refreshSession,
    storageLoaded, apiBase, email, 
    password, confirmPassword, 
    authMode, rememberMe, 
    handleLogout
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
