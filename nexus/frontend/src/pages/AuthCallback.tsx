import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Remove this after auth is confirmed working
const DEBUG = true;

export default function AuthCallback() {
  const navigate = useNavigate();
  const [authError, setAuthError] = useState<string | null>(null);
  const [debugInfo] = useState(() => ({
    protocol: window.location.protocol,
    hasCode: new URLSearchParams(window.location.search).has('code'),
    hasHashToken: window.location.hash.includes('access_token'),
    hasError: window.location.hash.includes('error') || new URLSearchParams(window.location.search).has('error'),
    hash: window.location.hash.slice(0, 40) || '(empty)',
    search: window.location.search.slice(0, 40) || '(empty)',
  }));

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

    // With implicit flow, detectSessionInUrl:true parses the #access_token hash
    // automatically. We just wait for the SIGNED_IN event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session) {
        subscription.unsubscribe();
        goHome();
      }
    });

    // getSession() awaits Supabase's internal initializePromise which parses
    // the URL. By the time this resolves the session is established or not.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        subscription.unsubscribe();
        goHome();
      }
    });

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
      className="min-h-screen flex flex-col items-center justify-center gap-4"
      style={{ background: 'var(--bg)' }}
    >
      <p className="font-mono text-sm animate-pulse" style={{ color: 'var(--text-muted)' }}>
        Signing you in…
      </p>
      {DEBUG && (
        <pre
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 16px',
            fontSize: 11,
            color: 'var(--text-muted)',
            maxWidth: 460,
            textAlign: 'left',
          }}
        >
{`Protocol:   ${debugInfo.protocol}
Has #token: ${debugInfo.hasHashToken}   Has ?code: ${debugInfo.hasCode}
Has error:  ${debugInfo.hasError}
Hash:       ${debugInfo.hash}
Search:     ${debugInfo.search}`}
        </pre>
      )}
    </div>
  );
}
