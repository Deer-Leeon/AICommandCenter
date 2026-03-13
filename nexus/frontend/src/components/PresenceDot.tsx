/**
 * PresenceDot — a subtle always-visible indicator showing whether your
 * connected partner is online.  Only rendered when an active connection exists.
 * Clicking it opens Settings → Connections.
 */
import { useConnections } from '../hooks/useConnections';
import { nexusSSE } from '../lib/nexusSSE';
import { useState, useEffect } from 'react';

interface PresenceDotProps {
  onOpenConnections: () => void;
}

export function PresenceDot({ onOpenConnections }: PresenceDotProps) {
  const { active } = useConnections(true);

  // Listen for presence updates so the dot stays reactive even when the
  // connection list hasn't been re-fetched
  const [presenceOverride, setPresenceOverride] = useState<{
    userId: string; isOnline: boolean;
  } | null>(null);

  useEffect(() => {
    const unsub = nexusSSE.subscribe((e) => {
      if (e.type !== 'presence:update') return;
      setPresenceOverride({ userId: e.userId as string, isOnline: e.isOnline as boolean });
    });
    return unsub;
  }, []);

  if (active.length === 0) return null;

  const conn      = active[0];
  const partner   = conn.partner;
  let   isOnline  = conn.presence?.isOnline ?? false;

  if (presenceOverride && presenceOverride.userId === partner?.userId) {
    isOnline = presenceOverride.isOnline;
  }

  const initials = (partner?.displayName ?? '?').slice(0, 1).toUpperCase();

  return (
    <>
      <style>{`
        @keyframes nexusPresencePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(61,232,176,0.5); }
          50%       { box-shadow: 0 0 0 4px rgba(61,232,176,0); }
        }
      `}</style>
      <button
        title={`${partner?.displayName ?? 'Connected user'} — ${isOnline ? 'Online' : 'Offline'} · Open Connections`}
        onClick={onOpenConnections}
        style={{
          position:       'relative',
          background:     'var(--surface2)',
          border:         '1px solid var(--border)',
          borderRadius:   '50%',
          width:          28,
          height:         28,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          cursor:         'pointer',
          fontSize:       11,
          fontWeight:     600,
          color:          'var(--text-muted)',
          flexShrink:     0,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(61,232,176,0.45)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
      >
        {initials}
        {/* Status dot */}
        <span
          style={{
            position:    'absolute',
            bottom:      -1,
            right:       -1,
            width:       9,
            height:      9,
            borderRadius: '50%',
            background:  isOnline ? '#3de8b0' : 'var(--text-faint)',
            border:      '1.5px solid var(--surface)',
            animation:   isOnline ? 'nexusPresencePulse 2s ease-in-out infinite' : 'none',
          }}
        />
      </button>
    </>
  );
}
