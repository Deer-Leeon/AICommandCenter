import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
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
  const [user, setUser]       = useState<User | null>(() => readCachedUser());
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

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    localStorage.removeItem('nexus_onboarding_done');
    await supabase.auth.signOut();
  };

  return { user, session, loading, signOut };
}
