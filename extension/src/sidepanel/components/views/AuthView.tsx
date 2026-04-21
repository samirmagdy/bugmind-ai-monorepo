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
    { label: 'Min. 12 characters', passed: password.length >= 12 },
    { label: 'Uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', passed: /[a-z]/.test(password) },
    { label: 'Numeric digit', passed: /\d/.test(password) },
    { label: 'Special character', passed: /[^A-Za-z0-9]/.test(password) },
    { label: 'Identity verified', passed: confirmPassword.length > 0 && password === confirmPassword },
  ];
  const allPasswordChecksPassed = passwordChecks.every((check) => check.passed);
  const registerFormValid = emailValid && allPasswordChecksPassed;

  const emailInputClass = authMode === 'register' && email.length > 0
    ? emailValid
      ? 'border-[var(--status-success)]/40 focus:border-[var(--status-success)]/60 focus:ring-[var(--status-success)]/10'
      : 'border-[var(--status-danger)]/40 focus:border-[var(--status-danger)]/60 focus:ring-[var(--status-danger)]/10'
    : '';

  const passwordInputClass = authMode === 'register' && password.length > 0
    ? allPasswordChecksPassed
      ? 'border-[var(--status-success)]/40 focus:border-[var(--status-success)]/60 focus:ring-[var(--status-success)]/10'
      : 'border-[var(--status-danger)]/40 focus:border-[var(--status-danger)]/60 focus:ring-[var(--status-danger)]/10'
    : '';

  return (
    <div className="space-y-8 pt-8 animate-bp-flicker">
      <div className="text-center space-y-3">
        <h2 className="text-xl font-black bp-heading">
          {authMode === 'login' ? 'Welcome Back' : 'Join BugMind'}
        </h2>
        <div className="flex items-center justify-center gap-2">
          <div className="h-1 w-8 bg-gradient-to-r from-transparent to-[var(--status-info)]/30 rounded-full"></div>
          <p className="bp-subheading lowercase font-bold tracking-tight opacity-40">
            {authMode === 'login' 
              ? 'Login to synthesize requirements' 
              : 'Deploy AI-powered QA in seconds'}
          </p>
          <div className="h-1 w-8 bg-gradient-to-l from-transparent to-[var(--status-info)]/30 rounded-full"></div>
        </div>
      </div>

      <div className="bp-panel p-8 rounded-none relative group overflow-hidden">
        {/* Decorative Top Line */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[var(--status-info)]/30 to-transparent"></div>
        
        <form onSubmit={authMode === 'login' ? handleLogin : handleRegister} className="space-y-6">
          <div className="space-y-2">
            <label className="bp-subheading ml-1 opacity-60">Identity Credentials</label>
            <input 
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)}
              className={`w-full bp-input rounded-none px-5 py-4 outline-none transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-20 ${emailInputClass}`}
              placeholder="business@company.com"
              required
            />
            {authMode === 'register' && (
              <div className={`flex items-center gap-2.5 ml-2 transition-all duration-500 ${email.length === 0 ? 'opacity-0 -translate-y-2' : 'opacity-100 translate-y-0'}`}>
                <div className={`h-1.5 w-1.5 rounded-full ${emailValid ? 'bg-[var(--status-success)] shadow-[0_0_8px_var(--status-success)]' : 'bg-[var(--status-danger)] shadow-[0_0_8px_var(--status-danger)]'}`}></div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${emailValid ? 'text-[var(--status-success)]/80' : 'text-[var(--status-danger)]/80'}`}>
                  {emailValid ? 'Valid Enterprise Format' : 'Awaiting Business Email'}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="bp-subheading ml-1 opacity-60">Security Key</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)}
              className={`w-full bp-input rounded-none px-5 py-4 outline-none transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-20 ${passwordInputClass}`}
              placeholder="••••••••••••"
              required
            />
            {authMode === 'register' && (
              <div className="bp-card bg-transparent rounded-none p-5 space-y-4 border border-[var(--border-main)] animate-bp-flicker mt-2">
                <p className="bp-subheading text-[10px] opacity-40">Encryption Requirements</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {passwordChecks.slice(0, 6).map((check) => (
                    <div key={check.label} className={`flex items-center gap-3 transition-all duration-500 ${check.passed ? 'opacity-100 translate-x-1' : 'opacity-40'}`}>
                      <div className={`h-1.5 w-1.5 rounded-full transition-all duration-500 ${check.passed ? 'bg-[var(--status-success)] shadow-[0_0_8px_var(--status-success)] scale-125' : 'bg-[var(--text-muted)]'}`}></div>
                      <span className={`text-[9px] font-black uppercase tracking-widest ${check.passed ? 'text-[var(--status-success)]' : 'text-[var(--text-muted)]'}`}>
                        {check.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {authMode === 'register' && (
            <div className="space-y-2 animate-bp-flicker">
              <label className="bp-subheading ml-1 opacity-60">Confirm Security Key</label>
              <input 
                type="password" 
                value={confirmPassword} 
                onChange={e => setConfirmPassword(e.target.value)}
                className={`w-full bp-input rounded-none px-5 py-4 outline-none transition-all text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] placeholder:opacity-20 ${passwordInputClass}`}
                placeholder="••••••••••••"
                required
              />
            </div>
          )}
          
          {authMode === 'login' && (
            <div className="flex items-center gap-3 ml-2 group cursor-pointer" onClick={() => setRememberMe(!rememberMe)}>
              <div className={`w-5 h-5 rounded-lg border transition-all flex items-center justify-center ${rememberMe ? 'bg-[var(--accent)] border-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]' : 'border-[var(--border-main)] bg-[var(--bg-input)] group-hover:border-[var(--status-info)]/40'}`}>
                {rememberMe && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
              </div>
              <span className="bp-subheading opacity-60 group-hover:opacity-100 transition-opacity">Stay Authenticated</span>
            </div>
          )}

          <button
            type="submit"
            disabled={authMode === 'register' && !registerFormValid}
            className="w-full relative group overflow-hidden bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-white font-black py-5 rounded-none transition-all shadow-2xl shadow-[var(--accent)]/30 enabled:hover:scale-[1.02] enabled:hover:shadow-[var(--accent)]/50 active:scale-[0.98] disabled:opacity-40 disabled:grayscale mt-2"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out"></div>
            <span className="relative text-xs uppercase tracking-[0.2em]">
              {authMode === 'login' ? 'Authorize Session' : 'Create Intelligence Profile'}
            </span>
          </button>
        </form>
      </div>

      <div className="text-center animate-bp-flicker stagger-3">
        <button 
          onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); updateSession({ error: null }); }}
          className="bp-subheading hover:text-[var(--status-info)] hover:opacity-100 transition-all font-bold lowercase italic tracking-tight"
        >
          {authMode === 'login' ? "Require an account? Initialize registration" : "Existing operative? Authenticate session"}
        </button>
      </div>
    </div>
  );
};

export default AuthView;

