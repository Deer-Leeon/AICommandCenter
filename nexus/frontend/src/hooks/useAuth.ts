import { useState, useEffect, useRef } from 'react';
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
  const [user, setUser]               = useState<User | null>(() => readCachedUser());
  const [session, setSession]         = useState<Session | null>(null);
  const [loading, setLoading]         = useState<boolean>(() => readCachedUser() === null);
  const [awaitingBrowser, setAwaitingBrowser] = useState(false);
  const deepLinkRegistered            = useRef(false);

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
      if (session) setAwaitingBrowser(false);
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

    // Electron: receive the PKCE code forwarded by the OAuth popup window
    if (window.electronAPI?.isElectron && !deepLinkRegistered.current) {
      deepLinkRegistered.current = true;

      window.electronAPI.onDeepLink(async (url: string) => {
        if (!url.startsWith('nexus://auth/callback')) return;
        try {
          const parsed = new URL(url);
          const code   = parsed.searchParams.get('code');
          if (code) {
            await supabase.auth.exchangeCodeForSession(code);
          }
        } catch {
          // Silent — auth state change listener handles the result
        } finally {
          setAwaitingBrowser(false);
        }
      });

      // User closed the popup without signing in
      window.electronAPI.onOAuthCancelled(() => {
        setAwaitingBrowser(false);
      });
    }

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  /**
   * In Electron: opens Google auth in the system browser (Safari / Chrome) so
   * the user gets full Touch ID / passkey / 2FA support. Returns 'browser-opened'
   * so LoginPage can show a "waiting" screen.
   *
   * On web: redirects the page directly (standard PKCE flow).
   */
  const signInWithGoogle = async (): Promise<void | 'browser-opened'> => {
    if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
      window.location.replace(
        `https://${window.location.host}${window.location.pathname}${window.location.search}`,
      );
      return;
    }

    if (window.electronAPI?.isElectron) {
      const { data } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getAuthRedirectUrl(),
          queryParams: { prompt: 'select_account' },
          skipBrowserRedirect: true,
        },
      });
      if (data?.url) {
        setAwaitingBrowser(true);
        // Open a popup BrowserWindow — main process intercepts the callback
        // before it loads and delivers the PKCE code via onDeepLink.
        await window.electronAPI.openOAuthWindow(data.url);
        return 'browser-opened';
      }
    } else {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: getAuthRedirectUrl(),
          queryParams: { prompt: 'select_account' },
        },
      });
    }
  };

  const cancelBrowserAuth = () => setAwaitingBrowser(false);

  const signOut = async () => {
    localStorage.removeItem('nexus_onboarding_done');
    await supabase.auth.signOut();
  };

  return { user, session, loading, awaitingBrowser, signInWithGoogle, cancelBrowserAuth, signOut };
}
