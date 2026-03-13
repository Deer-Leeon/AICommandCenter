/**
 * ChessSetupModal — shown when the user drops the Chess widget on a grid slot.
 *
 * Chess is always a shared widget, so we go directly to the friend picker.
 * For each friend we peek at the backend to show whether a game is already in
 * progress, finished, or hasn't started yet — so the player can make an
 * informed choice before placing the widget.
 */
import { useState, useEffect } from 'react';
import { useConnections } from '../hooks/useConnections';
import { useAuth }        from '../hooks/useAuth';
import { apiFetch }       from '../lib/api';
import type { ChessGameState } from '../types';

interface ChessSetupModalProps {
  /** Called after all setup work is done — the widget can be placed safely. */
  onConfirm:          (connectionId: string) => void;
  onCancel:           () => void;
  onOpenConnections:  () => void;
}

type GamePeek = ChessGameState | null | 'loading';

// ── Helpers ───────────────────────────────────────────────────────────────────

function gameStatusLine(peek: GamePeek, myId: string): { icon: string; text: string; color: string } {
  if (peek === 'loading') return { icon: '♟️', text: 'Ready to play — start a new game!', color: 'var(--text-faint)' };
  if (!peek)              return { icon: '♟️', text: 'No game yet — you\'ll make the first move!', color: 'var(--text-faint)' };

  const moveCount = peek.moveHistory?.length ?? 0;
  const movesLabel = moveCount === 0 ? 'no moves yet' : `${moveCount} move${moveCount !== 1 ? 's' : ''} played`;

  if (peek.status === 'active') {
    const myColor   = peek.whiteUserId === myId ? 'white' : 'black';
    const isMyTurn  = peek.currentTurn === myColor;
    if (moveCount === 0) return { icon: '🟡', text: 'Game board is ready — waiting for first move', color: '#c0a060' };
    return isMyTurn
      ? { icon: '🟡', text: `Active game · ${movesLabel} · It's your turn!`, color: '#c0a060' }
      : { icon: '⏳', text: `Active game · ${movesLabel} · Waiting for opponent`, color: 'var(--text-muted)' };
  }

  if (peek.status === 'white_wins') {
    const iWon = peek.whiteUserId === myId;
    return { icon: iWon ? '🏆' : '😔', text: `Last game: White won · ${movesLabel}`, color: iWon ? '#22c55e' : 'var(--text-faint)' };
  }
  if (peek.status === 'black_wins') {
    const iWon = peek.blackUserId === myId;
    return { icon: iWon ? '🏆' : '😔', text: `Last game: Black won · ${movesLabel}`, color: iWon ? '#22c55e' : 'var(--text-faint)' };
  }
  if (peek.status === 'stalemate') return { icon: '🤝', text: `Last game ended in stalemate · ${movesLabel}`, color: 'var(--text-faint)' };
  if (peek.status === 'draw')      return { icon: '🤝', text: `Last game ended in a draw · ${movesLabel}`, color: 'var(--text-faint)' };

  return { icon: '♟️', text: 'Chess', color: 'var(--text-faint)' };
}

function primaryBtnLabel(peek: GamePeek): string {
  if (!peek || peek === 'loading') return 'Start Game ♟️';
  if (peek.status === 'active') return 'Continue Game →';
  return 'View & Play Again →';
}

function hasExistingGame(peek: GamePeek): boolean {
  return !!peek && peek !== 'loading';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChessSetupModal({ onConfirm, onCancel, onOpenConnections }: ChessSetupModalProps) {
  const { user }             = useAuth();
  const myId                 = user?.id ?? '';
  const { active, loading: isLoading } = useConnections(true);

  const [selected,     setSelected]     = useState<string | null>(null);
  const [gameStatuses, setGameStatuses] = useState<Record<string, GamePeek>>({});
  const [showNewGameWarning, setShowNewGameWarning] = useState(false);
  const [confirming,   setConfirming]   = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // Peek at every connection's game status in parallel once connections load.
  // We race each fetch against a 6-second timeout so a slow backend never
  // keeps the modal permanently blocked.
  useEffect(() => {
    if (active.length === 0) return;
    const init: Record<string, 'loading'> = {};
    active.forEach(c => { init[c.connection_id] = 'loading'; });
    setGameStatuses(init);

    active.forEach(conn => {
      const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 6_000));
      Promise.race([
        apiFetch(`/api/chess/${conn.connection_id}/peek`).then(r => r.ok ? r.json() : null),
        timeout,
      ])
        .then((data: ChessGameState | null) => {
          setGameStatuses(prev => ({ ...prev, [conn.connection_id]: data }));
        })
        .catch(() => {
          setGameStatuses(prev => ({ ...prev, [conn.connection_id]: null }));
        });
    });
  }, [active.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset warning when selection changes
  useEffect(() => { setShowNewGameWarning(false); }, [selected]);

  // Use `in` check (not `??`) so that null (= no game) is not confused with
  // 'loading' (= fetch not yet returned). null ?? 'loading' would be 'loading'
  // which would permanently disable the button if there is no existing game.
  const selectedPeek: GamePeek | undefined = selected
    ? (selected in gameStatuses ? gameStatuses[selected] : 'loading')
    : undefined;

  async function handleConfirm(resetGame: boolean) {
    if (!selected || confirming) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      if (resetGame) {
        // Await the reset so the widget mounts AFTER fresh state is written to DB.
        // The backend broadcasts chess:reset via SSE to both players once done.
        const res = await apiFetch(`/api/chess/${selected}/reset`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to start new game');
      }
      onConfirm(selected);
    } catch {
      setConfirmError('Something went wrong — please try again.');
      setConfirming(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         1000,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        background:     'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        style={{
          background:   'var(--surface)',
          border:       '1px solid var(--border)',
          borderRadius: 16,
          padding:      '28px 32px',
          maxWidth:     440,
          width:        '100%',
          boxShadow:    'var(--shadow-popup)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>♟️</div>
          <h2 style={{ margin: 0, color: 'var(--text)', fontSize: 18, fontWeight: 700 }}>
            Set up your Chess game
          </h2>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Chess is always a shared widget — choose a friend to play against.
          </p>
        </div>

        {/* Friend list */}
        {isLoading ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
            Loading connections…
          </div>
        ) : active.length === 0 ? (
          <div
            style={{
              background:   'var(--surface2)',
              border:       '1px solid var(--border)',
              borderRadius: 10,
              padding:      '16px 18px',
              marginBottom: 16,
            }}
          >
            <p style={{ margin: '0 0 10px', color: 'var(--text-muted)', fontSize: 13 }}>
              You have no connected friends yet. Go to{' '}
              <strong>Settings → Connections</strong> to invite someone.
            </p>
            <button
              onClick={() => { onCancel(); onOpenConnections(); }}
              style={{
                background:   '#c0a060',
                color:        '#fff',
                border:       'none',
                borderRadius: 7,
                padding:      '7px 14px',
                fontSize:     12,
                cursor:       'pointer',
                fontWeight:   600,
              }}
            >
              Open Connections
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {active.map(conn => {
              const partner  = conn.partner;
              const isOnline = conn.presence?.isOnline ?? false;
              const isSel    = selected === conn.connection_id;
              const peek     = gameStatuses[conn.connection_id] ?? 'loading';
              const status   = gameStatusLine(peek, myId);

              return (
                <button
                  key={conn.connection_id}
                  onClick={() => setSelected(conn.connection_id)}
                  style={{
                    display:    'flex',
                    alignItems: 'flex-start',
                    gap:        12,
                    padding:    '10px 14px',
                    borderRadius: 10,
                    border:     isSel ? '2px solid #c0a060' : '1px solid var(--border)',
                    background: isSel ? 'rgba(192,160,96,0.08)' : 'var(--surface2)',
                    cursor:     'pointer',
                    textAlign:  'left',
                    width:      '100%',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  {/* Online dot */}
                  <div
                    style={{
                      width:      9,
                      height:     9,
                      borderRadius: '50%',
                      background: isOnline ? '#22c55e' : 'var(--text-faint)',
                      flexShrink: 0,
                      marginTop:  5,
                      boxShadow:  isOnline ? '0 0 5px #22c55e88' : 'none',
                    }}
                  />

                  {/* Name + status */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}>
                        {partner?.displayName || partner?.username || '—'}
                      </span>
                      {partner?.username && (
                        <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                          @{partner.username}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                      <span style={{ fontSize: 12 }}>{status.icon}</span>
                      <span style={{ color: status.color, fontSize: 11, lineHeight: 1.4 }}>
                        {status.text}
                      </span>
                    </div>
                  </div>

                  {/* Selected check */}
                  {isSel && (
                    <div style={{ color: '#c0a060', fontSize: 16, flexShrink: 0, marginTop: 2 }}>✓</div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Error */}
        {confirmError && (
          <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>
            {confirmError}
          </div>
        )}

        {/* "Start New Game" warning banner — shown when user clicks that option */}
        {showNewGameWarning && selected && (
          <div
            style={{
              background:   'rgba(220, 80, 40, 0.1)',
              border:       '1px solid rgba(220, 80, 40, 0.35)',
              borderRadius: 8,
              padding:      '10px 14px',
              marginBottom: 12,
              fontSize:     12,
              color:        '#f87171',
              lineHeight:   1.5,
            }}
          >
            ⚠️ Starting a new game will discard the current game for <strong>both players</strong>.
            This cannot be undone. Are you sure?
          </div>
        )}

        {/* Action bar */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            onClick={onCancel}
            style={{
              padding:      '9px 18px',
              border:       '1px solid var(--border)',
              borderRadius: 8,
              background:   'transparent',
              color:        'var(--text-muted)',
              fontSize:     13,
              cursor:       'pointer',
              fontWeight:   500,
            }}
          >
            Cancel
          </button>

          {/* "Start New Game" — secondary, only when a game already exists */}
          {selected && hasExistingGame(selectedPeek ?? 'loading') && (
            showNewGameWarning ? (
              <>
                <button
                  onClick={() => setShowNewGameWarning(false)}
                  style={{
                    padding:      '9px 14px',
                    border:       '1px solid var(--border)',
                    borderRadius: 8,
                    background:   'transparent',
                    color:        'var(--text-muted)',
                    fontSize:     12,
                    cursor:       'pointer',
                  }}
                >
                  Keep current game
                </button>
                <button
                  onClick={() => handleConfirm(true)}
                  disabled={confirming}
                  style={{
                    padding:      '9px 16px',
                    border:       '1px solid rgba(220,80,40,0.5)',
                    borderRadius: 8,
                    background:   confirming ? 'var(--surface3)' : 'rgba(220,80,40,0.15)',
                    color:        confirming ? 'var(--text-faint)' : '#f87171',
                    fontSize:     13,
                    cursor:       confirming ? 'default' : 'pointer',
                    fontWeight:   600,
                  }}
                >
                  {confirming ? 'Starting…' : '↺ Yes, start new game'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowNewGameWarning(true)}
                style={{
                  padding:      '9px 16px',
                  border:       '1px solid var(--border)',
                  borderRadius: 8,
                  background:   'transparent',
                  color:        'var(--text-muted)',
                  fontSize:     12,
                  cursor:       'pointer',
                }}
              >
                ↺ Start New Game
              </button>
            )
          )}

          {/* Primary action — never blocked by the status check (that is purely
              informational). Only disabled while an async confirm is in flight. */}
          {selected && (
            <button
              onClick={() => handleConfirm(false)}
              disabled={confirming}
              style={{
                padding:      '9px 18px',
                border:       'none',
                borderRadius: 8,
                background:   confirming ? 'var(--surface3)' : '#c0a060',
                color:        confirming ? 'var(--text-faint)' : '#fff',
                fontSize:     13,
                cursor:       confirming ? 'default' : 'pointer',
                fontWeight:   600,
                whiteSpace:   'nowrap',
              }}
            >
              {confirming ? 'Opening…' : primaryBtnLabel(selectedPeek ?? 'loading')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
