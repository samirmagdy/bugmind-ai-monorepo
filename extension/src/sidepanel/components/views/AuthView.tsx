import React from 'react';
import { useBugMind } from '../../hooks/useBugMind';
import { ActionButton, StatusPanel, SurfaceCard } from '../common/DesignSystem';
import { ArrowRight, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GoogleLogo: React.FC = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
    <path
      fill="#4285F4"
      d="M21.805 12.23c0-.75-.067-1.47-.191-2.16H12v4.09h5.498a4.704 4.704 0 0 1-2.04 3.086v2.563h3.305c1.935-1.782 3.042-4.408 3.042-7.579Z"
    />
    <path
      fill="#34A853"
      d="M12 22c2.754 0 5.062-.913 6.749-2.472l-3.305-2.563c-.913.612-2.08.973-3.444.973-2.648 0-4.893-1.787-5.697-4.188H2.887v2.644A9.997 9.997 0 0 0 12 22Z"
    />
    <path
      fill="#FBBC05"
      d="M6.303 13.75A5.995 5.995 0 0 1 5.984 12c0-.608.11-1.198.319-1.75V7.606H2.887A9.997 9.997 0 0 0 2 12c0 1.612.386 3.138 1.07 4.394l3.233-2.644Z"
    />
    <path
      fill="#EA4335"
      d="M12 6.063c1.497 0 2.84.515 3.898 1.526l2.923-2.923C17.058 3.03 14.75 2 12 2a9.997 9.997 0 0 0-9.113 5.606l3.416 2.644C7.107 7.85 9.352 6.063 12 6.063Z"
    />
  </svg>
);

const AuthView: React.FC = () => {
  const {
    auth: {
      authMode,
      email,
      setEmail,
      password,
      setPassword,
      confirmPassword,
      setConfirmPassword,
      resetCode,
      setResetCode,
      setAuthMode,
      rememberMe,
      setRememberMe
    },
    handleLogin,
    handleRegister,
    handleForgotPassword,
    handleResetPassword,
    handleGoogleLogin,
    updateSession
  } = useBugMind();

  const emailValid = EMAIL_REGEX.test(email.trim());
  const passwordChecks = [
    { label: 'Min. 12 characters', passed: password.length >= 12 },
    { label: 'Uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', passed: /[a-z]/.test(password) },
    { label: 'Numeric digit', passed: /\d/.test(password) },
    { label: 'Special character', passed: /[^A-Za-z0-9]/.test(password) },
    { label: 'Passwords match', passed: confirmPassword.length > 0 && password === confirmPassword },
  ];
  const allPasswordChecksPassed = passwordChecks.every((check) => check.passed);

  const isLogin = authMode === 'login';
  const isRegister = authMode === 'register';
  const isForgot = authMode === 'forgot';
  const isReset = authMode === 'reset';
  const registerOrResetValid = emailValid && allPasswordChecksPassed;

  const title = isLogin
    ? 'Welcome Back'
    : isRegister
      ? 'Create Account'
      : isForgot
        ? 'Reset Password'
        : 'Enter Reset Code';

  const subtitle = isLogin
    ? 'Securely access your QA workspace'
    : isRegister
      ? 'Create your professional intelligence profile'
      : isForgot
        ? 'We will email a one-time code to your account'
        : 'Choose a new password after entering the code';

  const submitHandler = isLogin
    ? handleLogin
    : isRegister
      ? handleRegister
      : isForgot
        ? handleForgotPassword
        : handleResetPassword;

  const clearAuthFeedback = () => updateSession({ error: null, success: null });

  return (
    <div className="flex flex-col h-full animate-in fade-in duration-700">
      <div className="flex-1 flex flex-col justify-center px-4 py-6">
        <div className="space-y-2 mb-5 text-center">
          <p className="view-kicker">Account</p>
          <h1 className="text-[22px] font-bold text-[var(--text-primary)] tracking-normal">{title}</h1>
          <p className="text-[var(--text-secondary)] text-xs">{subtitle}</p>
        </div>

        <SurfaceCard className="p-5 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-[var(--primary-gradient)]" />

          {(isLogin || isRegister) && (
            <div className="mb-6">
              <ActionButton type="button" variant="secondary" className="h-11 w-full text-sm font-bold" onClick={handleGoogleLogin}>
                <GoogleLogo />
                Continue with Google
              </ActionButton>
              <div className="mt-4 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                <div className="h-px flex-1 bg-[var(--border-soft)]" />
                <span>or use email</span>
                <div className="h-px flex-1 bg-[var(--border-soft)]" />
              </div>
            </div>
          )}

          <form onSubmit={submitHandler} className="space-y-6">
            <div className="space-y-1.5">
              <label htmlFor="auth-email" className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Email Address</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-[var(--text-muted)] group-focus-within:text-[var(--primary-blue)] transition-colors">
                  <Mail size={16} />
                </div>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input pl-12 pr-4 py-3 text-sm"
                  placeholder="name@company.com"
                  required
                />
              </div>
            </div>

            {!isForgot && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center px-1">
                  <label htmlFor="auth-password" className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                    {isReset ? 'New Password' : 'Password'}
                  </label>
                  {isLogin && (
                    <button
                      type="button"
                      className="text-[10px] font-bold text-[var(--primary-blue)] hover:opacity-80"
                      onClick={() => {
                        clearAuthFeedback();
                        setPassword('');
                        setConfirmPassword('');
                        setResetCode('');
                        setAuthMode('forgot');
                      }}
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center text-[var(--text-muted)] group-focus-within:text-[var(--primary-blue)] transition-colors">
                    <Lock size={16} />
                  </div>
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input pl-12 pr-4 py-3 text-sm"
                    placeholder="••••••••••••"
                    required
                  />
                </div>
              </div>
            )}

            {isReset && (
              <div className="space-y-1.5 animate-in slide-in-from-top-2">
                <label htmlFor="auth-reset-code" className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Reset Code</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center text-[var(--text-muted)] group-focus-within:text-[var(--primary-blue)] transition-colors">
                    <KeyRound size={16} />
                  </div>
                  <input
                    id="auth-reset-code"
                    type="text"
                    inputMode="numeric"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="form-input pl-12 pr-4 py-3 text-sm tracking-[0.25em]"
                    placeholder="123456"
                    required
                  />
                </div>
              </div>
            )}

            {(isRegister || isReset) && (
              <div className="space-y-4 animate-in slide-in-from-top-2">
                <div className="space-y-1.5">
                  <label htmlFor="auth-confirm-password" className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider ml-1">Confirm Password</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-4 flex items-center text-[var(--text-muted)] group-focus-within:text-[var(--primary-blue)] transition-colors">
                      <ShieldCheck size={16} />
                    </div>
                    <input
                      id="auth-confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="form-input pl-12 pr-4 py-3 text-sm"
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

            {isLogin && (
              <label className="flex items-center gap-2.5 px-1 group cursor-pointer w-fit">
                <div className="relative flex items-center justify-center">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <div className={`w-4 h-4 rounded border transition-all flex items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-[var(--primary-blue)] ${rememberMe ? 'bg-[var(--primary-blue)] border-[var(--primary-blue)]' : 'border-[var(--border-soft)] bg-[var(--bg-elevated)] group-hover:border-[var(--primary-blue)]'}`}>
                    {rememberMe && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                  </div>
                </div>
                <span className="text-[11px] font-medium text-[var(--text-secondary)] select-none">Stay signed in</span>
              </label>
            )}

            <ActionButton
              type="submit"
              disabled={(isRegister || isReset) ? !registerOrResetValid : !emailValid}
              variant="primary"
              className="h-11 text-sm font-bold"
            >
              {isLogin ? 'Sign In' : isRegister ? 'Create Account' : isForgot ? 'Send Reset Code' : 'Update Password'}
              <ArrowRight size={18} />
            </ActionButton>
          </form>
        </SurfaceCard>

        <div className="mt-8 text-center space-y-3">
          {(isLogin || isRegister) && (
            <button
              onClick={() => {
                clearAuthFeedback();
                setPassword('');
                setConfirmPassword('');
                setResetCode('');
                setAuthMode(isLogin ? 'register' : 'login');
              }}
              className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--primary-blue)] transition-colors"
            >
              {isLogin ? (
                <>Don&apos;t have an account? <span className="text-[var(--primary-blue)] font-bold">Register here</span></>
              ) : (
                <>Already have an account? <span className="text-[var(--primary-blue)] font-bold">Sign in</span></>
              )}
            </button>
          )}

          {(isForgot || isReset) && (
            <button
              onClick={() => {
                clearAuthFeedback();
                setPassword('');
                setConfirmPassword('');
                setResetCode('');
                setAuthMode('login');
              }}
              className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--primary-blue)] transition-colors"
            >
              Back to sign in
            </button>
          )}

          {isReset && (
            <button
              onClick={() => {
                clearAuthFeedback();
                setResetCode('');
                setPassword('');
                setConfirmPassword('');
                setAuthMode('forgot');
              }}
              className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--primary-blue)] transition-colors"
            >
              Resend reset code
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthView;
