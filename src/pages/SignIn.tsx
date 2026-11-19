import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/Icon';
import { SiteHeader } from '@/components/SiteHeader';
import { useAuth } from '@/hooks/useAuth';
import { isSupabaseConfigured } from '@/lib/supabase';

type Mode = 'signin' | 'signup' | 'magic';
type Status = 'idle' | 'sending' | 'error';

const MIN_PASSWORD = 6; // Supabase's default minimum

/** Only same-site paths, so ?next= can't send people to another website. */
function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/projects';
}

export function SignIn() {
  const { user, signInWithEmail, signInWithPassword, signUpWithPassword } = useAuth();
  const [search] = useSearchParams();
  const next = safeNext(search.get('next'));
  const [mode, setMode] = useState<Mode>(search.get('mode') === 'signup' ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  /** Set after a magic link or confirmation email is sent. */
  const [sentTo, setSentTo] = useState<{ email: string; kind: 'magic' | 'confirm' } | null>(null);

  if (user) return <Navigate to={next} replace />;

  const switchMode = (m: Mode) => {
    setMode(m);
    setStatus('idle');
    setMessage('');
    setPassword('');
    setConfirm('');
  };

  const fail = (text: string) => {
    setStatus('error');
    setMessage(text);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return; // double submit (Enter + click)
    const cleanEmail = email.trim();

    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD) return fail(`Use a password with at least ${MIN_PASSWORD} characters.`);
      if (password !== confirm) return fail('The two passwords don’t match.');
    }

    setStatus('sending');
    setMessage('');
    try {
      if (mode === 'magic') {
        await signInWithEmail(cleanEmail, next);
        setSentTo({ email: cleanEmail, kind: 'magic' });
      } else if (mode === 'signin') {
        await signInWithPassword(cleanEmail, password);
        // Success: `user` updates and <Navigate> above takes over.
      } else {
        const { needsConfirmation } = await signUpWithPassword(cleanEmail, password, next);
        if (needsConfirmation) setSentTo({ email: cleanEmail, kind: 'confirm' });
      }
      setStatus('idle');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    }
  };

  const sending = status === 'sending';
  const title = mode === 'signup' ? 'Create your account' : mode === 'magic' ? 'Sign in with a link' : 'Welcome back';
  const submitLabel =
    mode === 'magic'
      ? sending
        ? 'Sending…'
        : 'Email me a link'
      : mode === 'signin'
        ? sending
          ? 'Signing in…'
          : 'Sign in'
        : sending
          ? 'Creating account…'
          : 'Create account';

  return (
    <div className="light-page">
      <SiteHeader />
      <main className="container auth">
        <div className="auth__card">
          <h1>{title}</h1>
          {!isSupabaseConfigured ? (
            <p className="muted">
              Sign-in needs Supabase. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to{' '}
              <code>.env.local</code> and restart the dev server.
            </p>
          ) : sentTo ? (
            <div className="auth__form">
              <p>
                {sentTo.kind === 'magic' ? 'Check ' : 'We sent a confirmation link to '}
                <strong>{sentTo.email}</strong>
                {sentTo.kind === 'magic'
                  ? ' for a sign-in link. You can close this tab.'
                  : '. Open it to activate your account, then sign in.'}
              </p>
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => {
                  setSentTo(null);
                  switchMode('signin');
                }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="auth__form">
              {mode !== 'magic' && (
                <div className="segmented auth__tabs" role="tablist" aria-label="Account">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signin'}
                    aria-pressed={mode === 'signin'}
                    onClick={() => switchMode('signin')}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'signup'}
                    aria-pressed={mode === 'signup'}
                    onClick={() => switchMode('signup')}
                  >
                    Create account
                  </button>
                </div>
              )}
              {status === 'error' && (
                <div className="alert alert--danger" role="alert">
                  <Icon name="alert" size={16} />
                  <span>{message}</span>
                </div>
              )}
              {mode === 'magic' && <p className="muted">We’ll email you a magic link. No password needed.</p>}

              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              {mode !== 'magic' && (
                <>
                  <label htmlFor="password">Password</label>
                  <div className="password">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      aria-invalid={status === 'error' || undefined}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="password__toggle"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      <Icon name={showPassword ? 'eyeOff' : 'eye'} />
                    </button>
                  </div>
                </>
              )}

              {mode === 'signup' && (
                <>
                  <label htmlFor="confirm-password">Confirm password</label>
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <p className="muted small">At least {MIN_PASSWORD} characters.</p>
                </>
              )}

              <button type="submit" className="btn btn--primary btn--lg" disabled={sending}>
                {submitLabel}
              </button>

              <div className="auth__divider" aria-hidden="true">
                or
              </div>
              <button
                type="button"
                className="btn btn--outline btn--lg"
                onClick={() => switchMode(mode === 'magic' ? 'signin' : 'magic')}
              >
                {mode === 'magic' ? 'Use email and password instead' : 'Email me a magic link'}
              </button>
              <p className="auth__foot">
                You can also <Link to="/editor/local">keep working without an account</Link>.
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
