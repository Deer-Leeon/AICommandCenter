import { useState, useEffect } from 'react';
import { supabase, getAuthRedirectUrl } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

/**
 * Read the cached Supabase session synchronously from localStorage.
 * The key 'nexus-auth' matches the storageKey set in supabase.ts.
 * This lets us initialize user state before the async getSession() call resolves,
 * eliminating the loading spinner for returning users entirely.
 */
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
  // Synchronous init — returning users get user immediately, no loading flash
  const [user, setUser]       = useState<User | null>(() => readCachedUser());
  const [session, setSession] = useState<Session | null>(null);
  // Only block rendering if there is genuinely no cached session to show
  const [loading, setLoading] = useState<boolean>(() => readCachedUser() === null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirectUrl(),
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
  };

  const signOut = async () => {
    // Clear onboarding flag so ConnectServicesPage re-runs after sign-in
    localStorage.removeItem('nexus_onboarding_done');
    await supabase.auth.signOut();
  };

  return { user, session, loading, signInWithGoogle, signOut };
}
