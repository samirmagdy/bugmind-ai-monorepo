import React from 'react';
import { useBugMind } from '../../hooks/useBugMind';

const AuthView: React.FC = () => {
  const { 
    auth: { 
      authMode, email, setEmail, password, setPassword, confirmPassword, setConfirmPassword, 
      setAuthMode, rememberMe, setRememberMe
    },
    handleLogin, handleRegister, updateSession
  } = useBugMind();

  return (
    <div className="space-y-6 pt-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-black text-[var(--text-main)]">{authMode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {authMode === 'login' 
            ? 'Login to start generating bug reports.' 
            : 'Join BugMind to automate your QA workflow.'}
        </p>
      </div>
      <form onSubmit={authMode === 'login' ? handleLogin : handleRegister} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1 opacity-80">Email Address</label>
          <input 
            type="email" 
            value={email} 
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50 focus:scale-[1.01] focus:ring-1 focus:ring-[var(--status-info)]/10"
            placeholder="name@company.com"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1 opacity-80">Password</label>
          <input 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50 focus:scale-[1.01] focus:ring-1 focus:ring-[var(--status-info)]/10"
            placeholder="••••••••"
            required
          />
        </div>
        {authMode === 'register' && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
            <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1 opacity-80">Confirm Password</label>
            <input 
              type="password" 
              value={confirmPassword} 
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full bg-[var(--bg-input)] border border-[var(--border-main)] rounded-xl px-4 py-3 outline-none focus:border-[var(--status-info)]/50 transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50 focus:scale-[1.01] focus:ring-1 focus:ring-[var(--status-info)]/10"
              placeholder="••••••••"
              required
            />
          </div>
        )}
        
        {authMode === 'login' && (
          <div className="flex items-center space-x-2 ml-1">
            <input 
              type="checkbox" 
              id="remember"
              checked={rememberMe}
              onChange={e => setRememberMe(e.target.checked)}
              className="w-3.5 h-3.5 rounded border border-[var(--border-main)] bg-[var(--bg-input)] checked:bg-[var(--accent)] checked:border-[var(--accent)] transition-all cursor-pointer"
            />
            <label htmlFor="remember" className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] cursor-pointer select-none hover:text-[var(--text-main)] transition-colors">
              Remember Me
            </label>
          </div>
        )}

        <button type="submit" className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-[var(--accent)]/20 active:scale-[0.98] mt-2">
          {authMode === 'login' ? 'Sign In' : 'Sign Up'}
        </button>
      </form>
      <div className="text-center">
        <button 
          onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); updateSession({ error: null }); }}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--status-info)] transition-colors"
        >
          {authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
        </button>
      </div>
    </div>
  );
};

export default AuthView;
