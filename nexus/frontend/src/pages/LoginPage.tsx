import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { signInWithGoogle } = useAuth();

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

        {/* Feature list */}
        <div className="space-y-3 mb-8 text-left">
          {[
            'Google Calendar integration',
            'Google Docs access',
            'AI assistant powered by local LLM',
            'Slack, Obsidian, Weather &amp; more',
          ].map((feat) => (
            <div key={feat} className="flex items-center gap-3" style={{ color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--teal)' }}>✓</span>
              <span
                className="text-sm"
                dangerouslySetInnerHTML={{ __html: feat }}
              />
            </div>
          ))}
        </div>

        {/* Sign-in button */}
        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 font-semibold py-3 px-6 rounded-xl transition-colors"
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

        <p className="text-xs mt-6" style={{ color: 'var(--text-faint)' }}>
          By signing in you agree to let NEXUS access your Google Calendar and Docs
        </p>
      </div>
    </div>
  );
}
