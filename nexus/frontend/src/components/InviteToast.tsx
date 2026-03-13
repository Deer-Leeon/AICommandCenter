/**
 * InviteToast — bottom-right toast shown when a connection invite arrives
 * via SSE while the app is open.
 *
 * Dismissing the toast WITHOUT choosing accept/decline does NOT decline the
 * invite — it remains visible in Settings → Connections.
 */
import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';
import { nexusSSE } from '../lib/nexusSSE';

interface ToastInvite {
  connectionId: string;
  displayName:  string;
  username:     string | null;
}

interface InviteToastProps {
  onOpenConnections: () => void;
}

export function InviteToast({ onOpenConnections }: InviteToastProps) {
  const [invites, setInvites] = useState<ToastInvite[]>([]);

  useEffect(() => {
    const unsub = nexusSSE.subscribe((event) => {
      if (event.type !== 'connection:invite_received') return;
      const conn    = event.connection as { connection_id: string } | undefined;
      const profile = event.fromProfile as { display_name: string; username: string | null } | undefined;
      if (!conn || !profile) return;
      setInvites(prev => {
        // Don't duplicate
        if (prev.some(i => i.connectionId === conn.connection_id)) return prev;
        return [
          ...prev,
          {
            connectionId: conn.connection_id,
            displayName:  profile.display_name,
            username:     profile.username,
          },
        ];
      });
    });
    return unsub;
  }, []);

  const dismiss = (connectionId: string) =>
    setInvites(prev => prev.filter(i => i.connectionId !== connectionId));

  const accept = async (invite: ToastInvite) => {
    await apiFetch(`/api/connections/${invite.connectionId}/accept`, { method: 'POST' });
    dismiss(invite.connectionId);
    onOpenConnections();
  };

  const decline = async (invite: ToastInvite) => {
    await apiFetch(`/api/connections/${invite.connectionId}/decline`, { method: 'POST' });
    dismiss(invite.connectionId);
  };

  if (invites.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom:   24,
        right:    24,
        zIndex:   9999,
        display:  'flex',
        flexDirection: 'column',
        gap:      10,
        maxWidth: 340,
      }}
    >
      {invites.map(invite => (
        <div
          key={invite.connectionId}
          style={{
            background:   'var(--surface)',
            border:       '1px solid rgba(61,232,176,0.35)',
            borderRadius: 14,
            boxShadow:    'var(--shadow-popup)',
            padding:      '14px 16px',
            animation:    'nexusToastIn 0.25s cubic-bezier(0.34,1.28,0.64,1) both',
          }}
        >
          <style>{`
            @keyframes nexusToastIn {
              from { opacity: 0; transform: translateY(12px) scale(0.96); }
              to   { opacity: 1; transform: none; }
            }
          `}</style>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: '0 0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {invite.displayName}
                {invite.username && (
                  <span style={{ fontWeight: 400, color: 'var(--text-faint)', marginLeft: 4 }}>
                    @{invite.username}
                  </span>
                )}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                wants to connect with you
              </p>
            </div>
            <button
              onClick={() => dismiss(invite.connectionId)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--text-faint)', fontSize: 16, lineHeight: 1,
                padding: 0, flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={() => accept(invite)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(61,232,176,0.15)', border: '1px solid rgba(61,232,176,0.4)',
                color: 'var(--teal)', fontSize: 13, fontWeight: 500,
              }}
            >
              Accept
            </button>
            <button
              onClick={() => decline(invite)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 8, cursor: 'pointer',
                background: 'var(--surface2)', border: '1px solid var(--border)',
                color: 'var(--text-muted)', fontSize: 13,
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
