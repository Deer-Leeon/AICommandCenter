import { useState, useEffect, useRef } from 'react';
import { useStore }         from '../../store/useStore';
import { useConnections }   from '../../hooks/useConnections';
import { useAuth }          from '../../hooks/useAuth';
import { apiFetch }         from '../../lib/api';
import { SharedChessWidget } from '../../components/widgets/SharedChessWidget';
import type { ChessGameState } from '../../types';

const MOBILE_CHESS_KEY = 'nexus_mobile_chess_connId';

type GamePeek = ChessGameState | null | 'loading';

function gameStatusLine(peek: GamePeek, myId: string) {
  if (peek === 'loading') return { icon: '♟️', text: 'Ready to play…', color: 'var(--text-faint)' };
  if (!peek)              return { icon: '♟️', text: 'No game yet — you\'ll make the first move!', color: 'var(--text-faint)' };
  const moveCount = peek.moveHistory?.length ?? 0;
  const label = moveCount === 0 ? 'no moves yet' : `${moveCount} move${moveCount !== 1 ? 's' : ''}`;
  if (peek.status === 'active') {
    const myColor  = peek.whiteUserId === myId ? 'white' : 'black';
    const isMyTurn = peek.currentTurn === myColor;
    if (moveCount === 0) return { icon: '🟡', text: 'Board ready — waiting for first move', color: '#c0a060' };
    return isMyTurn
      ? { icon: '🟡', text: `Active · ${label} · Your turn!`, color: '#c0a060' }
      : { icon: '⏳', text: `Active · ${label} · Opponent's turn`, color: 'var(--text-muted)' };
  }
  if (peek.status === 'white_wins') { const w = peek.whiteUserId === myId; return { icon: w ? '🏆' : '😔', text: `White won · ${label}`, color: w ? '#22c55e' : 'var(--text-faint)' }; }
  if (peek.status === 'black_wins') { const w = peek.blackUserId === myId; return { icon: w ? '🏆' : '😔', text: `Black won · ${label}`, color: w ? '#22c55e' : 'var(--text-faint)' }; }
  if (peek.status === 'stalemate')  return { icon: '🤝', text: `Stalemate · ${label}`, color: 'var(--text-faint)' };
  if (peek.status === 'draw')       return { icon: '🤝', text: `Draw · ${label}`, color: 'var(--text-faint)' };
  return { icon: '♟️', text: 'Chess', color: 'var(--text-faint)' };
}

// ── Main component ─────────────────────────────────────────────────────────────

export function MobileSharedChessCard() {
  const { user }        = useAuth();
  const myId            = user?.id ?? '';
  const grid            = useStore(s => s.grid);
  const gridConnections = useStore(s => s.gridConnections);

  // Resolve connectionId: prefer the desktop grid binding, then mobile localStorage
  const desktopEntry = Object.entries(grid).find(
    ([key, type]) => type === 'shared_chess' && !!gridConnections[key],
  );
  const desktopConnId = desktopEntry ? gridConnections[desktopEntry[0]] : null;

  const [localConnId, setLocalConnId] = useState<string | null>(() => {
    try { return localStorage.getItem(MOBILE_CHESS_KEY); } catch { return null; }
  });

  const activeConnId = desktopConnId ?? localConnId;

  // If we have a connectionId, show the board
  if (activeConnId) {
    return (
      <ChessWithBack
        connectionId={activeConnId}
        onBack={() => {
          setLocalConnId(null);
          try { localStorage.removeItem(MOBILE_CHESS_KEY); } catch { /* quota */ }
        }}
      />
    );
  }

  // Otherwise show friend picker
  return (
    <ChessPicker
      myId={myId}
      onPick={(connId, reset) => {
        const start = async () => {
          if (reset) await apiFetch(`/api/chess/${connId}/reset`, { method: 'POST' });
          setLocalConnId(connId);
          try { localStorage.setItem(MOBILE_CHESS_KEY, connId); } catch { /* quota */ }
        };
        start();
      }}
    />
  );
}

// ── Chess board wrapper with a "← Change opponent" back button ────────────────

function ChessWithBack({ connectionId, onBack }: { connectionId: string; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tiny back button */}
      <button
        onClick={onBack}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-faint)', fontSize: 11,
          padding: '6px 10px 2px', textAlign: 'left', flexShrink: 0,
          fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
        }}
      >
        ← change opponent
      </button>
      {/*
        Use position:relative + absolute child so SharedChessWidget always
        receives a definite height. Without this, height:100% inside a flex
        item can fail to resolve on some mobile browsers, leaving the board
        at its initial 200px fallback size.
      */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <SharedChessWidget connectionId={connectionId} slotKey="mobile" onClose={() => {}} />
        </div>
      </div>
    </div>
  );
}

// ── Friend picker ─────────────────────────────────────────────────────────────

function ChessPicker({
  myId,
  onPick,
}: {
  myId: string;
  onPick: (connId: string, reset: boolean) => void;
}) {
  const { active, loading } = useConnections(true);
  const [selected,       setSelected]       = useState<string | null>(null);
  const [gameStatuses,   setGameStatuses]   = useState<Record<string, GamePeek>>({});
  const [showWarning,    setShowWarning]    = useState(false);
  const [confirming,     setConfirming]     = useState(false);
  const [confirmError,   setConfirmError]   = useState<string | null>(null);

  // Track which connection IDs have already had their peek fetch fired so
  // re-runs of the effect never reset a connection that already resolved.
  const fetchedRef = useRef(new Set<string>());

  // Peek at each connection's game status — only fetch ones not yet checked
  useEffect(() => {
    const unfetched = active.filter(c => !fetchedRef.current.has(c.connection_id));
    if (unfetched.length === 0) return;

    unfetched.forEach(conn => {
      const id = conn.connection_id;
      fetchedRef.current.add(id);
      setGameStatuses(p => ({ ...p, [id]: 'loading' }));

      const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 4_000));
      Promise.race([
        apiFetch(`/api/chess/${id}/peek`).then(r => r.ok ? r.json() : null),
        timeout,
      ])
        .then((data: ChessGameState | null) => setGameStatuses(p => ({ ...p, [id]: data })))
        .catch(() => setGameStatuses(p => ({ ...p, [id]: null })));
    });
  }, [active.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setShowWarning(false); }, [selected]);

  const selectedPeek: GamePeek | undefined = selected
    ? (selected in gameStatuses ? gameStatuses[selected] : 'loading')
    : undefined;

  const hasGame = !!selectedPeek && selectedPeek !== 'loading';

  async function handleConfirm(reset: boolean) {
    if (!selected || confirming) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      onPick(selected, reset);
    } catch {
      setConfirmError('Something went wrong — please try again.');
      setConfirming(false);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
      padding: '16px 14px 12px',
    }}>
      {/* Header */}
      <div style={{ flexShrink: 0, marginBottom: 14 }}>
        <div style={{ fontSize: 26, marginBottom: 6 }}>♟️</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          Play Chess
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
          Pick a friend to play against
        </div>
      </div>

      {/* Connection list */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, textAlign: 'center', padding: 20 }}>
            Loading connections…
          </div>
        ) : active.length === 0 ? (
          <div style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '18px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>🔗</div>
            <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              No friends connected yet
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>
              Go to <strong>Settings → Connections</strong> to invite someone, then come back to start a game.
            </div>
          </div>
        ) : (
          active.map(conn => {
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
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '12px 14px', borderRadius: 12, textAlign: 'left',
                  border: isSel ? '2px solid #c0a060' : '1px solid var(--border)',
                  background: isSel ? 'rgba(192,160,96,0.1)' : 'var(--surface2)',
                  cursor: 'pointer', width: '100%', flexShrink: 0,
                  transition: 'border-color 0.15s, background 0.15s',
                  minHeight: 44,
                }}
              >
                {/* Online dot */}
                <div style={{
                  width: 9, height: 9, borderRadius: '50%', marginTop: 4, flexShrink: 0,
                  background: isOnline ? '#22c55e' : 'var(--text-faint)',
                  boxShadow: isOnline ? '0 0 5px #22c55e88' : 'none',
                }} />

                {/* Name + status */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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

                {isSel && <div style={{ color: '#c0a060', fontSize: 18, flexShrink: 0, marginTop: 2 }}>✓</div>}
              </button>
            );
          })
        )}
      </div>

      {/* Warning banner */}
      {showWarning && selected && (
        <div style={{
          background: 'rgba(220,80,40,0.1)', border: '1px solid rgba(220,80,40,0.35)',
          borderRadius: 10, padding: '10px 14px', margin: '10px 0 0',
          fontSize: 12, color: '#f87171', lineHeight: 1.5, flexShrink: 0,
        }}>
          ⚠️ Starting a new game will discard the current game for <strong>both players</strong>. This cannot be undone.
        </div>
      )}

      {/* Error */}
      {confirmError && (
        <div style={{ color: '#f87171', fontSize: 12, textAlign: 'center', marginTop: 8, flexShrink: 0 }}>
          {confirmError}
        </div>
      )}

      {/* Action buttons */}
      {selected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, flexShrink: 0 }}>
          {/* Primary: open/continue */}
          <button
            onClick={() => handleConfirm(false)}
            disabled={confirming}
            style={{
              background: confirming ? 'var(--surface3)' : '#c0a060',
              color: confirming ? 'var(--text-faint)' : '#fff',
              border: 'none', borderRadius: 12, padding: '14px',
              fontSize: 15, fontWeight: 700, cursor: confirming ? 'default' : 'pointer',
              minHeight: 44,
            }}
          >
            {confirming ? 'Opening…' : (!hasGame ? 'Start Game ♟️' : (selectedPeek as ChessGameState)?.status === 'active' ? 'Continue Game →' : 'View & Play Again →')}
          </button>

          {/* Secondary: start fresh (only if game already exists) */}
          {hasGame && (
            showWarning ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setShowWarning(false)}
                  style={{
                    flex: 1, background: 'transparent', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '11px', fontSize: 13, color: 'var(--text-muted)',
                    cursor: 'pointer', minHeight: 44,
                  }}
                >
                  Keep current
                </button>
                <button
                  onClick={() => handleConfirm(true)}
                  disabled={confirming}
                  style={{
                    flex: 1, background: 'rgba(220,80,40,0.12)', border: '1px solid rgba(220,80,40,0.4)',
                    borderRadius: 10, padding: '11px', fontSize: 13, color: '#f87171',
                    cursor: confirming ? 'default' : 'pointer', fontWeight: 600, minHeight: 44,
                  }}
                >
                  {confirming ? 'Starting…' : 'Yes, reset'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowWarning(true)}
                style={{
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '11px', fontSize: 13, color: 'var(--text-muted)',
                  cursor: 'pointer', minHeight: 44,
                }}
              >
                ↺ Start New Game
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
