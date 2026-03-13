import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    // ── Check for OAuth error params before waiting for a session ──────────────
    // Supabase redirects here with #error=... when sign-in fails (e.g. the
    // database trigger that creates a new user's profile throws an exception).
    const hash  = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);

    const errorCode = hash.get('error') ?? query.get('error');
    if (errorCode) {
      if (errorCode === 'access_denied') {
        // User cancelled the Google OAuth screen — silently go back to login.
        navigate('/', { replace: true });
        return;
      }
      // Any other error (e.g. server_error from a failed DB trigger) — show it.
      const desc = hash.get('error_description') ?? query.get('error_description') ?? errorCode;
      setAuthError(decodeURIComponent(desc.replace(/\+/g, ' ')));
      return;
    }

    let done = false;

    function goHome() {
      if (done) return;
      done = true;
      navigate('/', { replace: true });
    }

    // Watch for Supabase to fire SIGNED_IN once it has processed the
    // OAuth code/token in the URL and written the session to localStorage.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session) {
        subscription.unsubscribe();
        goHome();
      }
    });

    // Also check if a session is already present
    // (handles the case where the session was established before this effect ran).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        subscription.unsubscribe();
        goHome();
      }
    });

    // Hard timeout fallback — navigate anyway after 8 s so the user is never stuck.
    const timer = setTimeout(() => {
      subscription.unsubscribe();
      goHome();
    }, 8000);

    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (authError) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-6"
        style={{ background: 'var(--bg)' }}
      >
        <p className="font-mono text-sm" style={{ color: '#ea4335', maxWidth: 360, textAlign: 'center' }}>
          Sign-in failed: {authError}
        </p>
        <button
          onClick={() => navigate('/', { replace: true })}
          className="text-sm font-medium px-5 py-2 rounded-lg"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer' }}
        >
          Back to login
        </button>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <p
        className="font-mono text-sm animate-pulse"
        style={{ color: 'var(--text-muted)' }}
      >
        Signing you in…
      </p>
    </div>
  );
}
