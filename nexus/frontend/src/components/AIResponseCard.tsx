import { useStore } from '../store/useStore';

export function AIResponseCard() {
  const { lastAIResponse, setLastAIResponse } = useStore();

  if (!lastAIResponse) return null;

  return (
    <div
      className="w-full mb-3 rounded-xl overflow-hidden animate-slide-up"
      style={{
        maxWidth: '760px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          {/* Pulsing teal dot */}
          <div className="relative w-2 h-2">
            <div
              className="absolute inset-0 rounded-full"
              style={{ background: 'var(--teal)' }}
            />
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'var(--teal)',
                animation: 'ping 1.5s ease-in-out infinite',
                opacity: 0.4,
              }}
            />
          </div>
          <span
            className="font-mono text-xs uppercase tracking-wider"
            style={{ color: 'var(--teal)', letterSpacing: '0.1em' }}
          >
            NEXUS AI
          </span>
          <span
            className="font-mono text-xs px-1.5 py-0.5 rounded"
            style={{
              background: 'var(--accent-dim)',
              color: 'var(--accent)',
              fontSize: '10px',
            }}
          >
            {lastAIResponse.intent}
          </span>
        </div>
        <button
          onClick={() => setLastAIResponse(null)}
          className="text-xs w-5 h-5 rounded flex items-center justify-center transition-colors"
          style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--color-danger)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
          }}
        >
          ×
        </button>
      </div>

      {/* Response text */}
      <div className="px-4 py-3">
        <p
          className="text-sm leading-relaxed"
          style={{ color: 'var(--text)', lineHeight: 1.6, fontSize: '13px' }}
          dangerouslySetInnerHTML={{ __html: lastAIResponse.humanResponse }}
        />
      </div>

      {/* Action pills */}
      {lastAIResponse.suggestedActions && lastAIResponse.suggestedActions.length > 0 && (
        <div
          className="flex items-center gap-2 px-4 pb-3 flex-wrap"
        >
          {lastAIResponse.suggestedActions.map((action, i) => (
            <button
              key={i}
              onClick={() => setLastAIResponse(null)}
              className="nexus-teal-pill text-xs px-3 py-1 rounded-full"
            >
              {action}
            </button>
          ))}
        </div>
      )}

      <style>{`
        @keyframes ping {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
