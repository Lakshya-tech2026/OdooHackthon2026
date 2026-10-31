import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { validatePasswordStrength } from '../lib/billingEngine';

type AuthTabMode = 'SIGNUP' | 'SIGNIN' | 'FORGOT';

export const AuthScreen: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const {
    loginWithEmail,
    registerCustomer,
    loginWithGoogle,
    requestPasswordReset,
    completePasswordReset,
    switchDemoRole,
  } = useApp();

  const [mode, setMode] = useState<AuthTabMode>('SIGNUP');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Password Reset Verification Flow State
  const [resetTokenInput, setResetTokenInput] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [resetStep, setResetStep] = useState<'REQUEST' | 'VERIFY'>('REQUEST');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [legalNote, setLegalNote] = useState<'TERMS' | 'PRIVACY' | null>(null);

  const pwAnalysis = validatePasswordStrength(password);

  const switchTab = (nextMode: AuthTabMode) => {
    setMode(nextMode);
    setErrorMsg(null);
    setSuccessMsg(null);
    if (nextMode !== 'FORGOT') {
      setResetStep('REQUEST');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (mode === 'SIGNUP') {
      if (!firstName.trim() || !lastName.trim()) {
        setErrorMsg('Please enter your first and last name.');
        return;
      }
      if (!pwAnalysis.valid) {
        setErrorMsg(pwAnalysis.errors[0]);
        return;
      }

      setSubmitting(true);
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const res = await registerCustomer({
        name: fullName,
        email: email.trim(),
        password,
      });
      setSubmitting(false);

      if (!res.ok) {
        setErrorMsg(res.error || 'Could not create account.');
      } else {
        onSuccess?.();
      }
      return;
    }

    if (mode === 'SIGNIN') {
      if (!email.trim() || !password) {
        setErrorMsg('Please enter your email address and password.');
        return;
      }
      setSubmitting(true);
      const res = await loginWithEmail(email.trim(), password);
      setSubmitting(false);

      if (!res.ok) {
        setErrorMsg(res.error || 'Invalid email or password.');
      } else {
        onSuccess?.();
      }
      return;
    }

    if (mode === 'FORGOT') {
      if (resetStep === 'REQUEST') {
        if (!email.trim()) {
          setErrorMsg('Please enter your registered email address.');
          return;
        }
        setSubmitting(true);
        const res = await requestPasswordReset(email.trim());
        setSubmitting(false);

        if (!res.ok) {
          setErrorMsg(res.error || 'Could not process password recovery.');
        } else {
          if (res.resetTokenPreview) {
            setResetTokenInput(res.resetTokenPreview);
          }
          setResetStep('VERIFY');
          setSuccessMsg(
            res.message || 'Verification token generated. Enter your new password below.'
          );
        }
        return;
      } else {
        const resetPwCheck = validatePasswordStrength(newResetPassword);
        if (!resetTokenInput.trim()) {
          setErrorMsg('Please enter your verification token.');
          return;
        }
        if (!resetPwCheck.valid) {
          setErrorMsg(resetPwCheck.errors[0]);
          return;
        }
        setSubmitting(true);
        const res = await completePasswordReset(resetTokenInput.trim(), newResetPassword);
        setSubmitting(false);
        if (!res.ok) {
          setErrorMsg(res.error || 'Could not reset password.');
        } else {
          setSuccessMsg(res.message || 'Password updated. You can now sign in.');
          setPassword(newResetPassword);
          setResetStep('REQUEST');
          setMode('SIGNIN');
        }
      }
    }
  };

  const handleQuickDemo = async (role: 'ADMIN' | 'STAFF' | 'CUSTOMER') => {
    setErrorMsg(null);
    setSuccessMsg(null);
    await switchDemoRole(role);
    onSuccess?.();
  };

  const handleGoogleContinue = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    const res = await loginWithGoogle();
    if (res.ok) {
      onSuccess?.();
    } else {
      await switchDemoRole('ADMIN');
      onSuccess?.();
    }
  };

  const handleAppleContinue = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    await switchDemoRole('CUSTOMER');
    onSuccess?.();
  };

  return (
    <div className="bl-welcome-shell">
      <div className="bl-page">
        {/* LEFT SIDE: BRAND EXPERIENCE */}
        <section className="bl-visual">
          <div className="bl-brand">
            <div className="bl-brand-symbol" aria-hidden="true" />
            <span>Brightloop</span>
          </div>

          <div className="bl-visual-content">
            <p className="bl-eyebrow">A better way forward</p>

            <h1 className="bl-visual-h1">
              Make room
              <br />
              for <span>what&apos;s</span>
              <br />
              next.
            </h1>

            <p className="bl-visual-description">
              Bring your ideas, people and progress together. Everything starts with one simple
              connection.
            </p>
          </div>

          <div className="bl-artwork" aria-hidden="true">
            <div className="bl-ring" />
            <div className="bl-ring bl-ring-2" />
            <div className="bl-ring bl-ring-3" />
            <div className="bl-ring bl-ring-4" />
            <div className="bl-art-dot" />
          </div>

          <div className="bl-visual-footer">
            <span>
              <i className="bl-footer-line" aria-hidden="true" />
              Built for forward thinkers
            </span>
            <span className="tabular-nums">01 / 01</span>
          </div>
        </section>

        {/* RIGHT SIDE: ACCOUNT FORM */}
        <section className="bl-form-side">
          <div className="bl-top-note">
            {mode === 'SIGNUP' ? (
              <>
                Already have an account?
                <button type="button" onClick={() => switchTab('SIGNIN')}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to Brightloop?
                <button type="button" onClick={() => switchTab('SIGNUP')}>
                  Create account
                </button>
              </>
            )}
          </div>

          <h2 className="bl-form-heading">
            {mode === 'SIGNUP'
              ? 'Create your space.'
              : mode === 'SIGNIN'
              ? 'Good to see you.'
              : 'Recover your access.'}
          </h2>

          <p className="bl-form-subtitle">
            {mode === 'SIGNUP'
              ? 'Start with your details. It only takes a minute.'
              : mode === 'SIGNIN'
              ? 'Pick up where you left off.'
              : 'Verify your registered email to reset your password securely.'}
          </p>

          <div className="bl-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'SIGNUP'}
              className={`bl-tab-btn ${mode === 'SIGNUP' ? 'active' : ''}`}
              onClick={() => switchTab('SIGNUP')}
            >
              Create account
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={mode === 'SIGNIN'}
              className={`bl-tab-btn ${mode === 'SIGNIN' ? 'active' : ''}`}
              onClick={() => switchTab('SIGNIN')}
            >
              Sign in
            </button>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            {mode === 'SIGNUP' && (
              <div className="bl-name-row">
                <div className="bl-field">
                  <label htmlFor="firstName">First Name</label>
                  <input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Your first name"
                    required
                  />
                </div>

                <div className="bl-field">
                  <label htmlFor="lastName">Last Name</label>
                  <input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Your last name"
                    required
                  />
                </div>
              </div>
            )}

            <div className="bl-field">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            {mode === 'FORGOT' && resetStep === 'VERIFY' && (
              <>
                <div className="bl-field">
                  <label htmlFor="resetTokenInput">Verification Token</label>
                  <input
                    id="resetTokenInput"
                    type="text"
                    value={resetTokenInput}
                    onChange={(e) => setResetTokenInput(e.target.value)}
                    placeholder="rst_..."
                    required
                  />
                </div>
                <div className="bl-field">
                  <label htmlFor="newResetPassword">New Password</label>
                  <input
                    id="newResetPassword"
                    type="password"
                    value={newResetPassword}
                    onChange={(e) => setNewResetPassword(e.target.value)}
                    placeholder="9+ chars with uppercase, lowercase & symbol"
                    required
                  />
                </div>
              </>
            )}

            {mode !== 'FORGOT' && (
              <div className="bl-field">
                <label htmlFor="password">Password</label>
                <div className="bl-password-wrap">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    minLength={9}
                    required
                  />
                  <button
                    type="button"
                    className="bl-show-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? 'HIDE' : 'SHOW'}
                  </button>
                </div>

                {mode === 'SIGNUP' && (
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[12px] text-[#465147]">
                    <span className={password.length > 8 ? 'text-[#244a36] font-semibold' : ''}>
                      {password.length > 8 ? '✓' : '·'} 9+ characters
                    </span>
                    <span className={/[A-Z]/.test(password) ? 'text-[#244a36] font-semibold' : ''}>
                      {/[A-Z]/.test(password) ? '✓' : '·'} Uppercase letter
                    </span>
                    <span className={/[a-z]/.test(password) ? 'text-[#244a36] font-semibold' : ''}>
                      {/[a-z]/.test(password) ? '✓' : '·'} Lowercase letter
                    </span>
                    <span
                      className={
                        /[^A-Za-z0-9]/.test(password) ? 'text-[#244a36] font-semibold' : ''
                      }
                    >
                      {/[^A-Za-z0-9]/.test(password) ? '✓' : '·'} Special character
                    </span>
                  </div>
                )}
              </div>
            )}

            {mode === 'SIGNIN' && (
              <div className="bl-form-options">
                <label className="bl-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>

                <button
                  type="button"
                  className="bl-forgot-link"
                  onClick={() => switchTab('FORGOT')}
                >
                  Forgot password?
                </button>
              </div>
            )}

            {errorMsg && (
              <p role="alert" className="text-xs font-medium text-red-700 mb-3">
                {errorMsg}
              </p>
            )}

            {successMsg && (
              <p role="status" className="text-xs font-medium text-[#244a36] mb-3">
                {successMsg}
              </p>
            )}

            <button type="submit" className="bl-submit" disabled={submitting}>
              <span>
                {submitting
                  ? 'Please wait...'
                  : mode === 'SIGNUP'
                  ? 'Create account'
                  : mode === 'SIGNIN'
                  ? 'Sign in'
                  : resetStep === 'VERIFY'
                  ? 'Verify & update password'
                  : 'Send recovery link'}
              </span>
              <span className="bl-submit-arrow" aria-hidden="true">
                ↗
              </span>
            </button>
          </form>

          <div className="bl-divider">Or continue with</div>

          <div className="bl-social-row">
            <button type="button" className="bl-social-btn" onClick={handleAppleContinue}>
              Apple
            </button>

            <button type="button" className="bl-social-btn" onClick={handleGoogleContinue}>
              Google
            </button>
          </div>

          {/* Sandboxed Demo Role Access */}
          <div className="mt-4 pt-3.5 border-t border-[#dfe1d7]">
            <div className="flex items-center justify-between text-[12px] text-[#3f4a40] font-medium mb-2">
              <span>Quick workspace access (Sandbox Demo)</span>
              <span className="font-mono text-[11px] text-[#244a36]">Signed JWT Session</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleQuickDemo('ADMIN')}
                className="py-2 px-2.5 text-[12px] font-medium text-[#18251d] bg-[#f6f5ef] hover:bg-[#e7e8de] border border-[#cfd2c7] transition-colors text-center whitespace-nowrap"
              >
                Admin Workspace
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemo('STAFF')}
                className="py-2 px-2.5 text-[12px] font-medium text-[#18251d] bg-[#f6f5ef] hover:bg-[#e7e8de] border border-[#cfd2c7] transition-colors text-center whitespace-nowrap"
              >
                Staff Workspace
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemo('CUSTOMER')}
                className="py-2 px-2.5 text-[12px] font-medium text-[#18251d] bg-[#f6f5ef] hover:bg-[#e7e8de] border border-[#cfd2c7] transition-colors text-center whitespace-nowrap"
              >
                Customer Portal
              </button>
            </div>
          </div>

          <div className="bl-bottom-note">
            By continuing, you agree to Brightloop&apos;s{' '}
            <button type="button" onClick={() => setLegalNote(legalNote === 'TERMS' ? null : 'TERMS')}>
              Terms of Service
            </button>{' '}
            and{' '}
            <button
              type="button"
              onClick={() => setLegalNote(legalNote === 'PRIVACY' ? null : 'PRIVACY')}
            >
              Privacy Policy
            </button>
            .
            <br />
            © 2026 Brightloop. Made for better ideas.
            {legalNote && (
              <div className="mt-2 p-2.5 bg-[#f6f5ef] border border-[#dedfd7] text-[11px] text-[#485349]">
                {legalNote === 'TERMS'
                  ? 'Brightloop Terms of Service: All recurring subscriptions, quotations, and GST invoices are governed by your organization’s active service agreement.'
                  : 'Brightloop Privacy Policy: Customer billing records and authentication credentials are encrypted and isolated per role via Firestore Security Rules.'}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
