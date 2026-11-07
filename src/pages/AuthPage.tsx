import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

interface AuthPageProps {
  mode?: 'signin' | 'signup';
}

/**
 * Render Supabase sign-in or signup, including Google OAuth, provider errors and
 * email confirmation. Authentication is disabled without a configured client;
 * access follows verified session state.
 */
export default function AuthPage({ mode = 'signin' }: AuthPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const isSignup = mode === 'signup';

  const handleGoogleAuth = async () => {
    if (!supabase || loading) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // Supabase exchanges the OAuth code and restores the session before
          // the existing auth-state listener routes the user into the workspace.
          redirectTo: `${window.location.origin}/#/signin`,
        },
      });
      if (authError) throw authError;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Google authentication failed. Please try again.',
      );
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || loading) return;
    setError('');
    setSuccess('');
    if (isSignup && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const credentials = { email: email.trim().toLowerCase(), password };
      const { data, error: authError } = isSignup
        ? await supabase.auth.signUp({
            ...credentials,
            options: { data: { full_name: fullName.trim() || undefined } },
          })
        : await supabase.auth.signInWithPassword(credentials);
      if (authError) throw authError;
      // Access is granted only by the session listener, never by form submission.
      if (isSignup && !data.session) {
        setSuccess('Check your email to confirm your account, then sign in.');
        setPassword('');
        setConfirmPassword('');
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Authentication failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="font-display text-2xl font-bold text-cyan-200">
        {isSignup ? 'Create your RYANAI account' : 'Sign in to RYANAI'}
      </h1>
      <p className="mb-6 mt-2 text-sm text-slate-400">
        Sign in to access your dashboard and workspace.
      </p>
      {!supabase ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-400/30 p-4 text-amber-200"
        >
          Sign in is unavailable because authentication has not been configured.
          Contact your administrator.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void handleGoogleAuth()}
            disabled={loading}
            className="w-full rounded-lg border border-white/15 bg-white/[0.04] p-3 font-semibold text-slate-100 hover:bg-white/[0.08] disabled:opacity-60"
          >
            {loading ? 'Please wait…' : 'Continue with Google'}
          </button>
          <div className="my-4 flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1 bg-white/10" />
            <span>or use email</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <fieldset
              disabled={loading}
              className="space-y-4 disabled:opacity-60"
            >
              {isSignup && (
                <label className="block text-sm">
                  Full name (optional)
                  <input
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    className="mt-1 block w-full rounded-lg bg-slate-800 p-3"
                  />
                </label>
              )}
              <label className="block text-sm">
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 block w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              <label className="block text-sm">
                Password
                <input
                  type="password"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  required
                  minLength={isSignup ? 8 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 block w-full rounded-lg bg-slate-800 p-3"
                />
              </label>
              {isSignup && (
                <label className="block text-sm">
                  Confirm password
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="mt-1 block w-full rounded-lg bg-slate-800 p-3"
                  />
                </label>
              )}
              {error && (
                <p role="alert" className="text-sm text-rose-300">
                  {error}
                </p>
              )}
              {success && (
                <p role="status" className="text-sm text-emerald-300">
                  {success}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-cyan-500/20 p-3 font-semibold text-cyan-200 disabled:opacity-60"
              >
                {loading
                  ? 'Please wait…'
                  : isSignup
                    ? 'Create account'
                    : 'Sign in'}
              </button>
            </fieldset>
          </form>
        </>
      )}
      {error && !supabase && (
        <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>
      )}
      <a
        href={isSignup ? '#/signin' : '#/signup'}
        className="mt-5 text-sm text-cyan-300"
      >
        {isSignup
          ? 'Already have an account? Sign in'
          : 'New to RYANAI? Sign up'}
      </a>
    </section>
  );
}
