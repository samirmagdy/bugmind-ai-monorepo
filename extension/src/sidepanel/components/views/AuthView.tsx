import React from 'react';
import { useBugMind } from '../../hooks/useBugMind';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AuthView: React.FC = () => {
  const { 
    auth: { 
      authMode, email, setEmail, password, setPassword, confirmPassword, setConfirmPassword, 
      setAuthMode, rememberMe, setRememberMe
    },
    handleLogin, handleRegister, updateSession
  } = useBugMind();

  const emailValid = EMAIL_REGEX.test(email.trim());
  const passwordChecks = [
    { label: 'At least 12 characters', passed: password.length >= 12 },
    { label: 'One uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', passed: /[a-z]/.test(password) },
    { label: 'One number', passed: /\d/.test(password) },
    { label: 'One special character', passed: /[^A-Za-z0-9]/.test(password) },
    { label: 'Passwords match', passed: confirmPassword.length > 0 && password === confirmPassword },
  ];
  const allPasswordChecksPassed = passwordChecks.every((check) => check.passed);
  const registerFormValid = emailValid && allPasswordChecksPassed;

  const emailInputClass = authMode === 'register' && email.length > 0
    ? emailValid
      ? 'border-green-500/70 focus:border-green-500 focus:ring-green-500/10'
      : 'border-red-400/60 focus:border-red-400 focus:ring-red-400/10'
    : 'border-[var(--border-main)] focus:border-[var(--status-info)]/50 focus:ring-[var(--status-info)]/10';

  const passwordInputClass = authMode === 'register' && password.length > 0
    ? allPasswordChecksPassed
      ? 'border-green-500/70 focus:border-green-500 focus:ring-green-500/10'
      : 'border-red-400/60 focus:border-red-400 focus:ring-red-400/10'
    : 'border-[var(--border-main)] focus:border-[var(--status-info)]/50 focus:ring-[var(--status-info)]/10';

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
            className={`w-full bg-[var(--bg-input)] border rounded-xl px-4 py-3 outline-none transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50 focus:scale-[1.01] focus:ring-1 ${emailInputClass}`}
            placeholder="name@company.com"
            required
          />
          {authMode === 'register' && (
            <div className={`flex items-center gap-2 ml-1 text-[11px] transition-colors ${email.length === 0 ? 'text-[var(--text-muted)]' : emailValid ? 'text-green-600' : 'text-red-500'}`}>
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black ${emailValid ? 'bg-green-500 text-white' : 'bg-[var(--bg-input)] border border-[var(--border-main)] text-[var(--text-muted)]'}`}>
                {emailValid ? '✓' : '·'}
              </span>
              <span>Use a valid email format like `name@company.com`</span>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1 opacity-80">Password</label>
          <input 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)}
            className={`w-full bg-[var(--bg-input)] border rounded-xl px-4 py-3 outline-none transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50 focus:scale-[1.01] focus:ring-1 ${passwordInputClass}`}
            placeholder="••••••••"
            required
          />
          {authMode === 'register' && (
            <div className="rounded-xl border border-[var(--border-main)] bg-[var(--bg-input)]/60 px-3 py-2.5 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] opacity-80">
                Password Requirements
              </p>
              <div className="space-y-1.5">
                {passwordChecks.slice(0, 5).map((check) => (
                  <div key={check.label} className={`flex items-center gap-2 text-[11px] transition-colors ${check.passed ? 'text-green-600' : 'text-[var(--text-muted)]'}`}>
                    <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black ${check.passed ? 'bg-green-500 text-white' : 'bg-transparent border border-[var(--border-main)] text-[var(--text-muted)]'}`}>
                      {check.passed ? '✓' : '·'}
                    </span>
                    <span>{check.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {authMode === 'register' && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-300">
            <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-muted)] ml-1 opacity-80">Confirm Password</label>
            <input 
              type="password" 
              value={confirmPassword} 
              onChange={e => setConfirmPassword(e.target.value)}
              className={`w-full bg-[var(--bg-input)] border rounded-xl px-4 py-3 outline-none transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-50 focus:scale-[1.01] focus:ring-1 ${passwordInputClass}`}
              placeholder="••••••••"
              required
            />
            <div className={`flex items-center gap-2 ml-1 text-[11px] transition-colors ${confirmPassword.length === 0 ? 'text-[var(--text-muted)]' : password === confirmPassword ? 'text-green-600' : 'text-red-500'}`}>
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black ${password === confirmPassword && confirmPassword.length > 0 ? 'bg-green-500 text-white' : 'bg-[var(--bg-input)] border border-[var(--border-main)] text-[var(--text-muted)]'}`}>
                {password === confirmPassword && confirmPassword.length > 0 ? '✓' : '·'}
              </span>
              <span>{password === confirmPassword && confirmPassword.length > 0 ? 'Passwords match' : 'Confirm the same password'}</span>
            </div>
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
        <button
          type="submit"
          disabled={authMode === 'register' && !registerFormValid}
          className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--border-main)] disabled:text-[var(--text-muted)] disabled:shadow-none disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-[var(--accent)]/20 active:scale-[0.98] mt-2"
        >
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
