import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    // Check for OAuth error params in both hash (implicit) and query (PKCE)
    const hash  = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);

    const errorCode = hash.get('error') ?? query.get('error');
    if (errorCode) {
      if (errorCode === 'access_denied') {
        navigate('/', { replace: true });
        return;
      }
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session) {
        subscription.unsubscribe();
        goHome();
      }
    });

    // ── PKCE flow: exchange the `code` query param for a session ─────────────
    // With flowType:'pkce', Supabase redirects here with ?code=xxx rather than
    // putting tokens in the hash. We must explicitly exchange the code.
    const code = query.get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(window.location.href).then(({ error }) => {
        if (error) {
          subscription.unsubscribe();
          setAuthError(error.message);
        }
        // On success, onAuthStateChange fires SIGNED_IN and calls goHome().
      });
    } else {
      // Implicit flow / session already present fallback
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          subscription.unsubscribe();
          goHome();
        }
      });
    }

    // Hard timeout fallback — never leave the user stuck on "Signing you in…"
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
