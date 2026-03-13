import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

export default function LoginPage() {
  const { signInWithGoogle } = useAuth();

  const [mode, setMode]       = useState<'login' | 'signup'>('login');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState<string | null>(null);
  const [info, setInfo]       = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo('Check your email for a confirmation link, then sign in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // onAuthStateChange in useAuth will update the session automatically
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="rounded-2xl p-10 max-w-md w-full mx-4 text-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)' }}
      >
        {/* Logo / title */}
        <div className="mb-8">
          <h1
            className="font-mono text-4xl font-bold mb-2 tracking-widest"
            style={{ color: 'var(--accent)' }}
          >
            NEXUS
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Your AI-powered command center
          </p>
        </div>

        {/* Google sign-in */}
        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 font-semibold py-3 px-6 rounded-xl transition-colors mb-6"
          style={{ background: '#ffffff', color: '#1a1a2e', border: '1px solid rgba(0,0,0,0.12)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#f5f5f5')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#ffffff')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>or</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg overflow-hidden mb-5" style={{ border: '1px solid var(--border)' }}>
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); setInfo(null); }}
              className="flex-1 py-2 text-sm font-medium transition-colors"
              style={{
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#000' : 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        {/* Email / password form */}
        <form onSubmit={handleEmailAuth} className="space-y-3 text-left">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full py-2.5 px-4 rounded-lg text-sm outline-none"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full py-2.5 px-4 rounded-lg text-sm outline-none"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
          />
          {error && (
            <p className="text-xs" style={{ color: '#ea4335' }}>{error}</p>
          )}
          {info && (
            <p className="text-xs" style={{ color: 'var(--teal)' }}>{info}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-opacity"
            style={{
              background: 'var(--accent)',
              color: '#000',
              opacity: loading ? 0.6 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
              border: 'none',
            }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="text-xs mt-6" style={{ color: 'var(--text-faint)' }}>
          By signing in you agree to let NEXUS access your Google Calendar and Docs
        </p>
      </div>
    </div>
  );
}
