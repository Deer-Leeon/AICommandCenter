import { useState, useEffect } from 'react';
import { supabase, getAuthRedirectUrl } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

function readCachedUser(): User | null {
  try {
    const raw = window.localStorage.getItem('nexus-auth');
    if (!raw) return null;
    const session = JSON.parse(raw) as { user?: User };
    return session?.user ?? null;
  } catch {
    return null;
  }
}

export function useAuth() {
  const [user, setUser]     = useState<User | null>(() => readCachedUser());
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(() => readCachedUser() === null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Re-validate session when the user returns to the window
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
          setUser(session?.user ?? null);
        });
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  /**
   * Standard PKCE OAuth flow — works identically for web and Electron.
   *
   * The main window navigates to Google, authenticates, then returns to
   * nexus.lj-buchmiller.com/auth/callback?code=… Supabase's detectSessionInUrl
   * automatically finds the code and exchanges it using the verifier already
   * stored in localStorage (same origin, same window — so it's always present).
   *
   * This avoids system-browser / loopback-server complexity and matches the
   * approach that worked before.
   */
  const signInWithGoogle = async (): Promise<void> => {
    if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
      window.location.replace(
        `https://${window.location.host}${window.location.pathname}${window.location.search}`,
      );
      return;
    }

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirectUrl(),
        queryParams: { prompt: 'select_account' },
      },
    });
  };

  const signOut = async () => {
    localStorage.removeItem('nexus_onboarding_done');
    await supabase.auth.signOut();
  };

  return { user, session, loading, signInWithGoogle, signOut };
}
