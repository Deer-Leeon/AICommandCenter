import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

// ── Main login page ───────────────────────────────────────────────────────────

export default function LoginPage() {
  const { signInWithGoogle } = useAuth();

  useEffect(() => {
    const w = window as unknown as { __nexusTypeBufferActive?: boolean; __nexusTypeBuffer?: string };
    w.__nexusTypeBufferActive = false;
    w.__nexusTypeBuffer = '';
  }, []);

  const [mode, setMode]           = useState<'login' | 'signup'>('login');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName]   = useState('');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [info, setInfo]           = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);

  function switchMode(m: 'login' | 'signup') {
    setMode(m);
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName, name: fullName,
              first_name: firstName.trim(), last_name: lastName.trim(),
              avatar_url: null, email_verified: false,
            },
          },
        });
        if (error) throw error;
        setInfo('Check your email for a confirmation link, then sign in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', fontSize: 14, outline: 'none',
    boxSizing: 'border-box', transition: 'border-color 0.15s',
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', position: 'relative', overflow: 'hidden',
    }}>

      {/* Background glow orbs */}
      <div style={{
        position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 400, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(ellipse, rgba(124,106,255,0.07) 0%, transparent 65%)',
        filter: 'blur(40px)',
      }} />
      <div style={{
        position: 'absolute', bottom: '10%', right: '15%', pointerEvents: 'none',
        width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(61,232,176,0.05) 0%, transparent 70%)',
        filter: 'blur(30px)',
      }} />

      {/* Card */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 20, padding: '36px 36px 32px',
        width: '100%', maxWidth: 400, margin: '0 16px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
      }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: 14, marginBottom: 14,
            background: 'linear-gradient(135deg, rgba(124,106,255,0.25) 0%, rgba(61,232,176,0.1) 100%)',
            border: '1px solid rgba(124,106,255,0.3)',
            boxShadow: '0 4px 20px rgba(124,106,255,0.2)',
          }}>
            <span style={{ fontSize: 22 }}>⚡</span>
          </div>
          <div style={{
            fontFamily: 'var(--font-sans)', fontSize: 22, fontWeight: 700,
            letterSpacing: '0.18em', color: 'var(--text)', marginBottom: 4,
          }}>
            NEXUS
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            Your AI-powered command center
          </div>
        </div>

        {/* Google button */}
        <button
          onClick={async () => { await signInWithGoogle(); }}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 10, padding: '11px 16px', borderRadius: 12,
            background: '#fff', color: '#1f1f1f',
            border: '1px solid rgba(0,0,0,0.08)', cursor: 'pointer',
            fontSize: 14, fontWeight: 600,
            boxShadow: '0 1px 6px rgba(0,0,0,0.12)',
            transition: 'box-shadow 0.15s, transform 0.1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.18)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 6px rgba(0,0,0,0.12)'; e.currentTarget.style.transform = 'none'; }}
          onMouseDown={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 11, color: 'var(--text-faint)', letterSpacing: '0.05em' }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        {/* Mode toggle */}
        <div style={{
          display: 'flex', borderRadius: 10, overflow: 'hidden',
          border: '1px solid var(--border)', marginBottom: 16,
        }}>
          {(['login', 'signup'] as const).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, transition: 'background 0.15s, color 0.15s',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--text-muted)',
              }}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mode === 'signup' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text" placeholder="First name" value={firstName}
                onChange={e => setFirstName(e.target.value)} required
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              <input
                type="text" placeholder="Last name" value={lastName}
                onChange={e => setLastName(e.target.value)}
                style={inputStyle}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
            </div>
          )}

          <input
            type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} required
            style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
          <input
            type="password" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)} required minLength={6}
            style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          />

          {error && (
            <div style={{
              fontSize: 12, color: 'var(--color-danger)',
              background: 'var(--color-danger-bg)', borderRadius: 8,
              padding: '8px 12px',
            }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{
              fontSize: 12, color: 'var(--teal)',
              background: 'var(--teal-dim)', borderRadius: 8,
              padding: '8px 12px',
            }}>
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '11px 0', borderRadius: 12, border: 'none',
              background: 'var(--accent)', color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1, marginTop: 2,
              transition: 'opacity 0.15s, transform 0.1s',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.88'; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = '1'; }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
