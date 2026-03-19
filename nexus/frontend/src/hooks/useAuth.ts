import { useState, useEffect } from 'react';
import { supabase, getAuthRedirectUrl } from '../lib/supabase';
import { isCapacitor } from '../lib/isCapacitor';
import { isElectron } from '../lib/isElectron';
import { openInAppBrowser } from '../lib/capacitorBridge';
import type { User, Session } from '@supabase/supabase-js';

function readCachedUser(): User | null {
  // On Capacitor (iOS/Android) the session lives in native Preferences, which
  // is async-only. localStorage will be empty or stale, so we skip the sync
  // read and let getSession() restore the session from Preferences.
  if (typeof window !== 'undefined' && !!(window as Record<string, unknown>).Capacitor) {
    return null;
  }
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
   * Google PKCE OAuth — platform-aware:
   *
   * Capacitor (iOS): open the OAuth URL in Safari View Controller so that
   *   Google's 2FA, biometrics, and saved passwords all work correctly.
   *   `skipBrowserRedirect: true` gets the URL without navigating the WebView;
   *   the PKCE verifier is stored in localStorage so the code exchange works
   *   when appUrlOpen fires with nexus://auth/callback?code=…
   *
   * Web / Electron: standard PKCE flow — navigate the current window to Google,
   *   which redirects back to /auth/callback.
   */
  const signInWithGoogle = async (): Promise<void> => {
    if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
      window.location.replace(
        `https://${window.location.host}${window.location.pathname}${window.location.search}`,
      );
      return;
    }

    // iOS / Android: open Google in Safari View Controller so biometrics,
    // saved passwords and 2FA work correctly in a real browser context.
    if (isCapacitor()) {
      const { data } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'nexus://auth/callback',
          skipBrowserRedirect: true,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (data.url) await openInAppBrowser(data.url);
      return;
    }

    // Electron: RFC 8252 loopback server — opens Google in the user's default
    // system browser rather than the embedded WebView. Google increasingly
    // blocks OAuth in embedded WebViews; the system browser always works.
    // The loopback server in main.ts catches the redirect, extracts the PKCE
    // code, and sends it to the renderer via the 'deep-link' IPC event.
    // main.tsx registers onDeepLink and calls exchangeCodeForSession(code).
    if (isElectron() && window.electronAPI) {
      const port = await window.electronAPI.startOAuthServer();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `http://localhost:${port}/auth/callback`,
          skipBrowserRedirect: true,
          queryParams: { prompt: 'select_account' },
        },
      });
      if (!error && data.url) {
        await window.electronAPI.openExternalUrl(data.url);
      }
      return;
    }

    // Web: standard PKCE — navigate the current tab to Google and back.
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
    // 'local' scope clears only THIS session's tokens without invalidating
    // the refresh token on the server — other open sessions (e.g. the
    // Electron app while Chrome is open, or vice-versa) stay logged in.
    await supabase.auth.signOut({ scope: 'local' });
  };

  return { user, session, loading, signInWithGoogle, signOut };
}
