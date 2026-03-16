/**
 * SharedPhotoSetupModal — shown when the user drops the Photo Frame widget.
 * Follows the exact same pattern as ChessSetupModal / TodoSetupModal.
 */
import { useState, useEffect } from 'react';
import { useConnections } from '../hooks/useConnections';
import { preloadSharedPhoto } from './widgets/SharedPhotoWidget';

interface Props {
  onConfirm: (connectionId: string) => void;
  onCancel: () => void;
  onOpenConnections: () => void;
}

export function SharedPhotoSetupModal({ onConfirm, onCancel, onOpenConnections }: Props) {
  const { active, loading } = useConnections(true);
  const [selected, setSelected] = useState<string | null>(null);

  // Pre-load photos for ALL connections as soon as the list is available so
  // every fetch is in-flight before the user even clicks a row.
  useEffect(() => {
    if (active.length === 0) return;
    active.forEach((conn) => preloadSharedPhoto(conn.connection_id));
  }, [active]);

  function handleConfirm() {
    if (selected) onConfirm(selected);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '28px 32px',
          width: 400,
          maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Header */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 24 }}>📷</span>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
              Set Up Your Photo Frame
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Share a live photo frame with a friend — upload a photo and they see it instantly.
          </p>
        </div>

        {/* Connection list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Choose a friend
          </p>

          {loading && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>Loading connections…</p>
          )}

          {!loading && active.length === 0 && (
            <div style={{ padding: '16px 0', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                No active connections yet.
              </p>
              <button
                onClick={() => { onCancel(); onOpenConnections(); }}
                style={{
                  padding: '7px 14px',
                  background: 'var(--accent)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Go to Settings → Connections
              </button>
            </div>
          )}

          {!loading && active.map((conn) => {
            const isSelected = selected === conn.connection_id;
            const name = conn.partner?.displayName ?? 'Unknown';
            const username = conn.partner?.username ?? '';
            const isOnline = conn.presence?.isOnline ?? false;

            return (
              <button
                key={conn.connection_id}
                onClick={() => {
                  setSelected(conn.connection_id);
                  preloadSharedPhoto(conn.connection_id); // fire fetch immediately
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px',
                  background: isSelected ? 'rgba(124,106,255,0.15)' : 'var(--surface2)',
                  border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s, border-color 0.15s',
                  width: '100%',
                }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--accent), #a855f7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 700, color: '#000',
                    flexShrink: 0, position: 'relative',
                  }}
                >
                  {name.charAt(0).toUpperCase()}
                  <span
                    style={{
                      position: 'absolute', bottom: 0, right: 0,
                      width: 10, height: 10, borderRadius: '50%',
                      background: isOnline ? '#22c55e' : '#6b7280',
                      border: '1.5px solid var(--surface)',
                    }}
                  />
                </div>

                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {name}
                  </p>
                  {username && (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                      @{username}
                    </p>
                  )}
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <span style={{ fontSize: 16, color: 'var(--accent)', flexShrink: 0 }}>✓</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            onClick={onCancel}
            style={{
              padding: '9px 18px',
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected}
            style={{
              padding: '9px 20px',
              background: selected ? 'var(--accent)' : 'rgba(124,106,255,0.25)',
              color: selected ? '#000' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: selected ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s',
            }}
          >
            Create Photo Frame
          </button>
        </div>
      </div>
    </div>
  );
}
