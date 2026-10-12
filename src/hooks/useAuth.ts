import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/**
 * Restore and track a non-anonymous Supabase session, loading state, and auth errors.
 * An unconfigured client leaves the session null. The auth subscription is removed
 * on unmount; restoration failures are exposed through error.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let authChanged = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      authChanged = true;
      setSession(nextSession?.user.is_anonymous ? null : nextSession);
      setError(null);
      setLoading(false);
    });

    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        // A delayed restoration must never overwrite a newer sign-in or sign-out.
        if (!active || authChanged) return;
        setSession(
          sessionError || data.session?.user.is_anonymous ? null : data.session,
        );
        setError(
          sessionError
            ? 'Unable to restore your session. Please sign in again.'
            : null,
        );
        setLoading(false);
      })
      .catch(() => {
        if (!active || authChanged) return;
        setSession(null);
        setError('Unable to restore your session. Please sign in again.');
        setLoading(false);
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  /**
   * Clear the session after successful sign-out; return false on failure or no client.
   * Sign-out failures update error and leave the local session intact.
   */
  const signOut = useCallback(async () => {
    if (!supabase) return false;
    setSigningOut(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setSession(null);
      return true;
    } catch {
      setError('Sign out failed. Please try again.');
      return false;
    } finally {
      setSigningOut(false);
    }
  }, []);

  return { session, loading, error, signingOut, signOut };
}
