import React from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { ActionButton, StatusPanel, SurfaceCard } from '../common/DesignSystem';
import { Mail, Lock, ShieldCheck, ArrowRight } from 'lucide-react';

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

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-700">
      <div className="flex-1 flex flex-col justify-center px-6 py-12">
        <div className="space-y-2 mb-10 text-center">
          <h1 className="text-3xl font-bold text-[var(--text-primary)] tracking-tight">
            {authMode === 'login' ? 'Welcome Back' : 'Get Started'}
          </h1>
          <p className="text-[var(--text-secondary)] text-sm">
            {authMode === 'login' ? 'Securely access your QA workspace' : 'Create your professional intelligence profile'}
          </p>
        </div>

        <SurfaceCard className="p-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-[var(--primary-gradient)]" />
          
          <form onSubmit={authMode === 'login' ? handleLogin : handleRegister} className="space-y-6">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Email Address</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-[var(--text-muted)] group-focus-within:text-[var(--primary-blue)] transition-colors">
                  <Mail size={16} />
                </div>
                <input 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-2xl pl-12 pr-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-[var(--primary-blue)]/5 transition-all"
                  placeholder="name@company.com"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center px-1">
                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Password</label>
                {authMode === 'login' && (
                  <button type="button" className="text-[10px] font-bold text-[var(--primary-blue)] hover:opacity-80">Forgot?</button>
                )}
              </div>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-[var(--text-muted)] group-focus-within:text-[var(--primary-blue)] transition-colors">
                  <Lock size={16} />
                </div>
                <input 
                  type="password" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-2xl pl-12 pr-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-[var(--primary-blue)]/5 transition-all"
                  placeholder="••••••••••••"
                  required
                />
              </div>
            </div>

            {authMode === 'register' && (
              <div className="space-y-4 animate-in slide-in-from-top-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Confirm Password</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-4 flex items-center text-[var(--text-muted)] group-focus-within:text-[var(--primary-blue)] transition-colors">
                      <ShieldCheck size={16} />
                    </div>
                    <input 
                      type="password" 
                      value={confirmPassword} 
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full bg-[var(--bg-input)] border border-[var(--border-soft)] rounded-2xl pl-12 pr-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary-blue)] focus:ring-4 focus:ring-[var(--primary-blue)]/5 transition-all"
                      placeholder="••••••••••••"
                      required
                    />
                  </div>
                </div>

                <StatusPanel title="Security Requirements" tone="info" className="p-4 bg-[var(--surface-soft)] border-[var(--border-soft)]">
                  <div className="grid grid-cols-2 gap-x-2 gap-y-2">
                    {passwordChecks.map((check) => (
                      <div key={check.label} className="flex items-center gap-2">
                        <div className={`h-1.5 w-1.5 rounded-full ${check.passed ? 'bg-[var(--success)] shadow-[0_0_8px_var(--success)]' : 'bg-[var(--text-muted)]/30'}`} />
                        <span className={`text-[9px] font-bold tracking-tight ${check.passed ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                          {check.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </StatusPanel>
              </div>
            )}
            
            {authMode === 'login' && (
              <div className="flex items-center gap-2.5 px-1 group cursor-pointer" onClick={() => setRememberMe(!rememberMe)}>
                <div className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${rememberMe ? 'bg-[var(--primary-blue)] border-[var(--primary-blue)]' : 'border-[var(--border-soft)] bg-[var(--bg-elevated)] group-hover:border-[var(--primary-blue)]'}`}>
                  {rememberMe && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                </div>
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">Stay signed in</span>
              </div>
            )}

            <ActionButton
              type="submit"
              disabled={authMode === 'register' && !registerFormValid}
              variant="primary"
              className="h-11 text-sm font-bold"
            >
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
              <ArrowRight size={18} />
            </ActionButton>
          </form>
        </SurfaceCard>

        <div className="mt-8 text-center">
          <button 
            onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); updateSession({ error: null }); }}
            className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--primary-blue)] transition-colors"
          >
            {authMode === 'login' ? (
              <>Don't have an account? <span className="text-[var(--primary-blue)] font-bold">Register here</span></>
            ) : (
              <>Already have an account? <span className="text-[var(--primary-blue)] font-bold">Sign in</span></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthView;
