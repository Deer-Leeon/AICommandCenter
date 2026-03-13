'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Chess } from 'chess.js';
import { useAuth } from '../../hooks/useAuth';
import { useConnections } from '../../hooks/useConnections';
import { useSharedChannel } from '../../hooks/useSharedChannel';
import { apiFetch } from '../../lib/api';
import { awaitPrefetchOrFetch } from '../../lib/widgetCache';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import type { ChessGameState } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const LIGHT_SQ   = '#f0d9b5';
const DARK_SQ    = '#b58863';
const LAST_MOVE  = 'rgba(255, 255, 0, 0.38)';
const SELECTED   = 'rgba(20, 85, 30, 0.45)';
const LEGAL_DOT  = 'rgba(0, 0, 0, 0.15)';
const CHECK_RED  = 'rgba(220, 30, 30, 0.45)';
const PIECE_FONT = '"Segoe UI Symbol", "Apple Symbols", "Noto Chess", serif';

const PIECE_GLYPH: Record<string, string> = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

const PROMO_PIECES = ['q', 'r', 'b', 'n'] as const;
const PROMO_LABEL: Record<string, string> = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

// ── localStorage cache ────────────────────────────────────────────────────────

const CHESS_CACHE = 'nexus_chess_';

function readChessCache(connectionId: string): ChessGameState | null {
  try {
    const raw = localStorage.getItem(CHESS_CACHE + connectionId);
    return raw ? (JSON.parse(raw) as ChessGameState) : null;
  } catch { return null; }
}

function writeChessCache(connectionId: string, game: ChessGameState): void {
  try { localStorage.setItem(CHESS_CACHE + connectionId, JSON.stringify(game)); } catch { /* quota */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert display row/col indices to a chess square name. */
function displayToSquare(dRow: number, dCol: number, isFlipped: boolean): string {
  const file = isFlipped ? 'abcdefgh'[7 - dCol] : 'abcdefgh'[dCol];
  const rank = isFlipped ? dRow + 1 : 8 - dRow;
  return `${file}${rank}`;
}

/** chess.js board() row/col from a square name. */
function squareToBoardIdx(square: string): { row: number; col: number } {
  const col = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const row = 8 - parseInt(square[1]);
  return { row, col };
}

function isLightSquare(dRow: number, dCol: number, isFlipped: boolean): boolean {
  const { row, col } = squareToBoardIdx(displayToSquare(dRow, dCol, isFlipped));
  return (row + col) % 2 === 0;
}

function findKingSquare(chess: Chess, color: 'w' | 'b'): string | null {
  const board = chess.board();
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color)
        return 'abcdefgh'[c] + (8 - r);
    }
  return null;
}

function statusBanner(status: ChessGameState['status']): string {
  if (status === 'white_wins') return '♔ White wins by checkmate!';
  if (status === 'black_wins') return '♚ Black wins by checkmate!';
  if (status === 'stalemate')  return 'Stalemate — draw';
  if (status === 'draw')       return 'Draw';
  return '';
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  connectionId: string;
  slotKey:      string;
  onClose:      () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SharedChessWidget({ connectionId, onClose }: Props) {
  const { user }  = useAuth();
  const myId      = user?.id ?? '';

  // Connections — to find partner info and online status
  const { active } = useConnections(true);
  const connection  = active.find(c => c.connection_id === connectionId);
  const partner     = connection?.partner ?? null;
  const isOnline    = connection?.presence?.isOnline ?? false;

  // Game state — pre-seeded from localStorage so the board is visible immediately
  const [game,       setGame]       = useState<ChessGameState | null>(() => readChessCache(connectionId));
  const [loading,    setLoading]    = useState(() => readChessCache(connectionId) === null);
  const [dissolved,  setDissolved]  = useState(false);

  // Signal the reveal orchestrator once we have any data (cache or network)
  useWidgetReady('shared_chess', !loading);

  // Interaction state
  const [selected,   setSelected]   = useState<string | null>(null);
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [pendingPromo, setPendingPromo] = useState<{ from: string; to: string } | null>(null);
  const [promoTimer,   setPromoTimer]   = useState<ReturnType<typeof setTimeout> | null>(null);
  const [resetting,    setResetting]    = useState(false);
  const [errMsg,       setErrMsg]       = useState<string | null>(null);

  // Replay mode
  const [inReview,    setInReview]    = useState(false);
  const [reviewStep,  setReviewStep]  = useState(0);
  const moveListRef = useRef<HTMLDivElement>(null);

  // Two separate refs / measurements to avoid a ResizeObserver feedback loop:
  //
  //  wrapperRef  → the outer widget shell, whose size is set by the grid cell.
  //                Its dimensions NEVER change because of content inside it.
  //                We derive all chrome font/spacing values from this so that
  //                changing chrome height can't feed back into the measurement.
  //
  //  containerRef → the flex-grow board area (flex: 1 1 0).
  //                Its height shrinks when chrome grows.  We ONLY use it to
  //                compute how many pixels each board square should be.
  //
  // Without this split, chrome heights depended on boardSize, which came from
  // the board area, which shrank when chrome grew → infinite resize loop.
  const wrapperRef   = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [wrapperMin, setWrapperMin] = useState(200);  // outer cell min dimension
  const [boardSize,  setBoardSize]  = useState(200);  // inner board area min dimension

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0) setWrapperMin(Math.floor(Math.min(width, height)));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0) setBoardSize(Math.floor(Math.min(width, height)));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const sqSize = Math.floor(boardSize / 8);

  // Chrome scale is derived from the stable outer wrapper, not the board area.
  const uiFs        = Math.max(8,  Math.round(wrapperMin * 0.034));  // 8 – 13 px
  const uiPad       = Math.max(2,  Math.round(wrapperMin * 0.013));  // 2 – 6 px
  const uiGap       = Math.max(1,  Math.round(wrapperMin * 0.008));  // 1 – 4 px
  const hideChrome  = wrapperMin < 120;
  const condensed   = wrapperMin < 200;

  // ── My color (white or black) ───────────────────────────────────────────────
  const myColor  = game?.whiteUserId === myId ? 'white' : 'black';
  const isFlipped = myColor === 'black';
  const isMyTurn  = game?.status === 'active' && game?.currentTurn === myColor;

  // ── chess.js instance (derived from live FEN or review step) ───────────────
  const chess = useMemo(() => {
    if (!game) return null;
    if (inReview) {
      const c = new Chess();
      const moves = game.moveHistory ?? [];
      for (let i = 0; i < Math.min(reviewStep, moves.length); i++) {
        try { c.move(moves[i]); } catch { break; }
      }
      return c;
    }
    try { return new Chess(game.boardFen); } catch { return new Chess(); }
  }, [game, inReview, reviewStep]);

  // ── Shared refetch helper (used by initial load, polling, and reconnect) ────
  const latestUpdatedAtRef = useRef<string>('');
  latestUpdatedAtRef.current = game?.updatedAt ?? '';

  const applyIfNewer = useCallback((data: ChessGameState) => {
    setGame(prev => {
      if (!prev || data.updatedAt >= prev.updatedAt) {
        setSelected(null);
        setLegalMoves([]);
        return data;
      }
      return prev;
    });
  }, []);

  const refetchGame = useCallback(() => {
    apiFetch(`/api/chess/${connectionId}`)
      .then(r => {
        if (r.status === 403) { setDissolved(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((data: ChessGameState | null) => { if (data) applyIfNewer(data); })
      .catch(() => {});
  }, [connectionId, applyIfNewer]);

  // ── Load game ───────────────────────────────────────────────────────────────
  // Uses awaitPrefetchOrFetch so the in-flight prefetch from index.html is reused.
  // Does NOT reset loading=true — if we have a cache hit loading is already false;
  // the server response will silently update the board via applyIfNewer.
  useEffect(() => {
    let cancelled = false;
    const endpoint = `/api/chess/${connectionId}`;
    awaitPrefetchOrFetch(endpoint, () => apiFetch(endpoint))
      .then(r => {
        if (r.status === 403) { setDissolved(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((data: ChessGameState | null) => {
        if (cancelled) return;
        if (data) applyIfNewer(data);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [connectionId, applyIfNewer]);

  // ── Persist game state to localStorage so next page load shows the board instantly
  useEffect(() => {
    if (game) writeChessCache(connectionId, game);
  }, [game, connectionId]);

  // ── Polling fallback (5 s) — catches any SSE event that was dropped ─────────
  // Uses a ref for the latest updatedAt to keep the interval stable and avoid
  // re-creating it on every game state change.
  useEffect(() => {
    if (dissolved) return;
    const id = setInterval(() => {
      apiFetch(`/api/chess/${connectionId}`)
        .then(r => {
          if (r.status === 403) { setDissolved(true); return null; }
          return r.ok ? r.json() : null;
        })
        .then((data: ChessGameState | null) => {
          if (data && data.updatedAt > latestUpdatedAtRef.current) {
            applyIfNewer(data);
          }
        })
        .catch(() => {});
    }, 5_000);
    return () => clearInterval(id);
  }, [connectionId, dissolved, applyIfNewer]);

  // ── SSE events ─────────────────────────────────────────────────────────────
  const handleEventRef = useRef<(e: { type: string; payload: unknown }) => void>(() => undefined);
  handleEventRef.current = useCallback((evt: { type: string; payload: unknown }) => {
    if (evt.type === 'nexus:reconnected') {
      // SSE dropped and came back — immediately re-fetch so we never stay stale
      refetchGame();
      return;
    }
    if (evt.type === 'chess:move' || evt.type === 'chess:reset') {
      setGame(evt.payload as ChessGameState);
      setSelected(null);
      setLegalMoves([]);
      setInReview(false);
    }
    if (evt.type === 'connection:dissolved') {
      setDissolved(true);
    }
  }, [refetchGame]);

  useSharedChannel(connectionId, 'shared_chess', useCallback(
    (e: { type: string; payload: unknown }) => handleEventRef.current(e),
    [],
  ));

  // ── Board interaction ───────────────────────────────────────────────────────
  function handleSquareClick(sq: string) {
    if (!chess || !isMyTurn || inReview) return;
    const piece = chess.get(sq as Parameters<typeof chess.get>[0]);
    const myChessColor = myColor === 'white' ? 'w' : 'b';

    // If square is a legal destination from selected piece → make move
    if (selected && legalMoves.includes(sq)) {
      initiateMove(selected, sq);
      return;
    }

    // If clicking own piece → select it
    if (piece && piece.color === myChessColor) {
      const moves = chess
        .moves({ square: sq as Parameters<typeof chess.moves>[0]['square'], verbose: true })
        .map(m => m.to);
      setSelected(sq);
      setLegalMoves(moves);
      return;
    }

    // Otherwise deselect
    setSelected(null);
    setLegalMoves([]);
  }

  function initiateMove(from: string, to: string) {
    if (!chess) return;
    // Detect pawn promotion
    const piece = chess.get(from as Parameters<typeof chess.get>[0]);
    const isPawnPromo =
      piece?.type === 'p' &&
      ((piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1'));

    if (isPawnPromo) {
      setSelected(null);
      setLegalMoves([]);
      setPendingPromo({ from, to });
      // Auto-queen after 10 s
      if (promoTimer) clearTimeout(promoTimer);
      setPromoTimer(setTimeout(() => confirmMove(from, to, 'q'), 10_000));
      return;
    }
    confirmMove(from, to);
  }

  function confirmMove(from: string, to: string, promotion?: string) {
    if (promoTimer) { clearTimeout(promoTimer); setPromoTimer(null); }
    setPendingPromo(null);
    setSelected(null);
    setLegalMoves([]);
    setErrMsg(null);

    // Optimistic update
    const prevGame = game;
    try {
      const optimistic = new Chess(game!.boardFen);
      optimistic.move({ from, to, promotion: (promotion as 'q' | 'r' | 'b' | 'n') ?? undefined });
      setGame(g => g ? { ...g, boardFen: optimistic.fen(), lastMove: { from, to } } : g);
    } catch { /* leave as-is */ }

    apiFetch(`/api/chess/${connectionId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, promotion }),
    })
      .then(r => r.json())
      .then((data: ChessGameState) => setGame(data))
      .catch(err => {
        setGame(prevGame); // revert
        setErrMsg(err?.message ?? 'Move failed — please try again.');
      });
  }

  function handleReset() {
    setResetting(true);
    apiFetch(`/api/chess/${connectionId}/reset`, { method: 'POST' })
      .then(r => r.json())
      .then((data: ChessGameState) => {
        setGame(data);
        setInReview(false);
        setReviewStep(0);
      })
      .finally(() => setResetting(false));
  }

  // ── Review mode helpers ─────────────────────────────────────────────────────
  function enterReview() {
    setInReview(true);
    setReviewStep(game?.moveHistory?.length ?? 0);
  }
  function exitReview() {
    setInReview(false);
    setReviewStep(0);
  }

  // Auto-scroll move list when reviewStep changes
  useEffect(() => {
    if (!inReview || !moveListRef.current) return;
    const el = moveListRef.current.querySelector(`[data-step="${reviewStep}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [reviewStep, inReview]);

  // ── Board render ────────────────────────────────────────────────────────────
  function renderBoard() {
    if (!chess) return null;
    const board = chess.board();
    const inCheck  = chess.isCheck();
    const kingColor = chess.turn();
    const checkKing = inCheck ? findKingSquare(chess, kingColor) : null;

    const squares: JSX.Element[] = [];

    for (let dRow = 0; dRow < 8; dRow++) {
      for (let dCol = 0; dCol < 8; dCol++) {
        const sq   = displayToSquare(dRow, dCol, isFlipped);
        const { row: bRow, col: bCol } = squareToBoardIdx(sq);
        const piece = board[bRow][bCol];
        const light = isLightSquare(dRow, dCol, isFlipped);
        const baseBg = light ? LIGHT_SQ : DARK_SQ;

        const isLastFrom = game?.lastMove?.from === sq && !inReview;
        const isLastTo   = game?.lastMove?.to   === sq && !inReview;
        const isSel      = selected === sq;
        const isLegal    = legalMoves.includes(sq);
        const isCheck    = checkKing === sq;

        squares.push(
          <div
            key={sq}
            onClick={() => handleSquareClick(sq)}
            style={{
              position:   'relative',
              width:      sqSize,
              height:     sqSize,
              background: baseBg,
              cursor:     isMyTurn && !inReview ? 'pointer' : 'default',
              flexShrink: 0,
            }}
          >
            {/* Last-move highlight */}
            {(isLastFrom || isLastTo) && (
              <div style={{ position: 'absolute', inset: 0, background: LAST_MOVE, pointerEvents: 'none' }} />
            )}

            {/* Check highlight */}
            {isCheck && (
              <div style={{
                position: 'absolute', inset: 0, background: CHECK_RED, pointerEvents: 'none',
                boxShadow: 'inset 0 0 8px 2px rgba(200,0,0,0.5)',
              }} />
            )}

            {/* Selected highlight */}
            {isSel && (
              <div style={{ position: 'absolute', inset: 0, background: SELECTED, pointerEvents: 'none' }} />
            )}

            {/* Legal move: dot for empty, ring for occupied */}
            {isLegal && !piece && (
              <div style={{
                position:     'absolute',
                top:          '50%',
                left:         '50%',
                transform:    'translate(-50%, -50%)',
                width:        sqSize * 0.32,
                height:       sqSize * 0.32,
                borderRadius: '50%',
                background:   LEGAL_DOT,
                pointerEvents:'none',
              }} />
            )}
            {isLegal && piece && (
              <div style={{
                position:     'absolute',
                inset:        2,
                borderRadius: '50%',
                border:       `${Math.max(3, sqSize * 0.08)}px solid ${LEGAL_DOT}`,
                pointerEvents:'none',
              }} />
            )}

            {/* Piece */}
            {piece && (
              <div style={{
                position:   'absolute',
                inset:      0,
                display:    'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize:   sqSize * 0.78,
                lineHeight: 1,
                fontFamily: PIECE_FONT,
                color:      piece.color === 'w' ? '#ffffff' : '#1a1a1a',
                textShadow: piece.color === 'w'
                  ? '-1px -1px 0 #444, 1px -1px 0 #444, -1px 1px 0 #444, 1px 1px 0 #444'
                  : '0 0 2px rgba(255,255,255,0.4)',
                userSelect: 'none',
                pointerEvents: 'none',
              }}>
                {PIECE_GLYPH[`${piece.color}${piece.type}`]}
              </div>
            )}

            {/* Coordinate labels (corner of edge squares) */}
            {dRow === 7 && (
              <span style={{
                position:   'absolute',
                bottom:     1,
                right:      3,
                fontSize:   Math.max(7, sqSize * 0.22),
                fontWeight: 700,
                color:      light ? DARK_SQ : LIGHT_SQ,
                lineHeight: 1,
                userSelect: 'none',
                pointerEvents: 'none',
              }}>
                {isFlipped ? 'abcdefgh'[7 - dCol] : 'abcdefgh'[dCol]}
              </span>
            )}
            {dCol === 0 && (
              <span style={{
                position:   'absolute',
                top:        1,
                left:       3,
                fontSize:   Math.max(7, sqSize * 0.22),
                fontWeight: 700,
                color:      light ? DARK_SQ : LIGHT_SQ,
                lineHeight: 1,
                userSelect: 'none',
                pointerEvents: 'none',
              }}>
                {isFlipped ? dRow + 1 : 8 - dRow}
              </span>
            )}
          </div>
        );
      }
    }

    return (
      <div
        style={{
          display:       'grid',
          gridTemplateColumns: `repeat(8, ${sqSize}px)`,
          gridTemplateRows:    `repeat(8, ${sqSize}px)`,
          border:        '2px solid #705030',
          borderRadius:  2,
          overflow:      'hidden',
          userSelect:    'none',
        }}
      >
        {squares}
      </div>
    );
  }

  // ── Promotion picker ────────────────────────────────────────────────────────
  function renderPromotionPicker() {
    if (!pendingPromo) return null;
    const color = myColor === 'white' ? 'w' : 'b';
    return (
      <div style={{
        position:   'absolute',
        inset:      0,
        zIndex:     50,
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
        borderRadius: 2,
      }}>
        <div style={{
          background:   'var(--surface)',
          border:       '1px solid var(--border)',
          borderRadius: 12,
          padding:      '12px 16px',
          textAlign:    'center',
        }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 10 }}>
            Promote pawn to:
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {PROMO_PIECES.map(p => (
              <button
                key={p}
                onClick={() => confirmMove(pendingPromo.from, pendingPromo.to, p)}
                title={PROMO_LABEL[p]}
                style={{
                  width:      sqSize * 0.9,
                  height:     sqSize * 0.9,
                  fontSize:   sqSize * 0.6,
                  fontFamily: PIECE_FONT,
                  background: 'var(--surface2)',
                  border:     '1px solid var(--border)',
                  borderRadius: 8,
                  cursor:     'pointer',
                  display:    'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: color === 'w' ? '#fff' : '#1a1a1a',
                  textShadow: color === 'w'
                    ? '-1px -1px 0 #444, 1px -1px 0 #444, -1px 1px 0 #444, 1px 1px 0 #444'
                    : '0 0 2px rgba(255,255,255,0.4)',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface2)')}
              >
                {PIECE_GLYPH[`${color}${p}`]}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Player info row ─────────────────────────────────────────────────────────
  function renderPlayerRow(side: 'top' | 'bottom') {
    if (!game) return null;
    const isTopPlayer = (side === 'top') !== isFlipped;
    // Top = opponent (flipped: white, not flipped: black)
    const playerColor: 'white' | 'black' = isTopPlayer
      ? (isFlipped ? 'white' : 'black')
      : (isFlipped ? 'black' : 'white');
    const isMe = playerColor === myColor;
    const isActiveTurn = game.currentTurn === playerColor && game.status === 'active';

    const displayName = isMe
      ? (user?.user_metadata?.displayName ?? user?.email?.split('@')[0] ?? 'You')
      : (partner?.displayName ?? partner?.username ?? 'Opponent');
    const online = isMe ? true : isOnline;
    const pieceSym = playerColor === 'white' ? '♔' : '♚';
    const pieceColor = playerColor === 'white' ? '#e0c080' : '#888';

    const dotSz = Math.max(5, uiFs * 0.55);
    return (
      <div style={{
        display:    'flex',
        alignItems: 'center',
        gap:        uiGap * 3,
        padding:    `${uiGap}px ${uiGap * 2}px`,
        background: isActiveTurn ? 'rgba(255,255,255,0.04)' : 'transparent',
        borderRadius: 6,
        transition: 'background 0.2s',
      }}>
        {/* Online dot */}
        <div style={{
          width:      dotSz,
          height:     dotSz,
          borderRadius: '50%',
          background: online ? '#22c55e' : 'var(--text-faint)',
          flexShrink: 0,
          boxShadow:  online && !isMe ? '0 0 4px #22c55e' : 'none',
        }} />

        {/* Piece color icon */}
        <span style={{ fontSize: uiFs + 1, color: pieceColor, fontFamily: PIECE_FONT, lineHeight: 1 }}>
          {pieceSym}
        </span>

        {/* Name */}
        <span style={{ fontSize: uiFs, color: 'var(--text)', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName}
          {isMe && !condensed && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> (you)</span>}
        </span>

        {/* Turn pulse */}
        {isActiveTurn && !inReview && (
          <div style={{
            width:      dotSz,
            height:     dotSz,
            borderRadius: '50%',
            background: '#c0a060',
            animation:  'chessTurnPulse 1.4s ease-in-out infinite',
            flexShrink: 0,
          }} />
        )}
      </div>
    );
  }

  // ── Replay controls ─────────────────────────────────────────────────────────
  function renderReplayControls() {
    if (!inReview || !game) return null;
    const total = game.moveHistory?.length ?? 0;
    const pairs = [];
    for (let i = 0; i < total; i += 2) {
      pairs.push({ wMove: game.moveHistory[i], bMove: game.moveHistory[i + 1], idx: i });
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: uiGap * 2 }}>
        {/* Prev / Next */}
        <div style={{ display: 'flex', gap: uiGap * 2, alignItems: 'center' }}>
          <button onClick={() => setReviewStep(0)} disabled={reviewStep === 0}
            style={navBtnStyle(reviewStep === 0)}>«</button>
          <button onClick={() => setReviewStep(s => Math.max(0, s - 1))} disabled={reviewStep === 0}
            style={navBtnStyle(reviewStep === 0)}>‹</button>
          <span style={{ color: 'var(--text-muted)', fontSize: uiFs - 1, flex: 1, textAlign: 'center' }}>
            {reviewStep === 0 ? 'Start' : `${reviewStep} / ${total}`}
          </span>
          <button onClick={() => setReviewStep(s => Math.min(total, s + 1))} disabled={reviewStep === total}
            style={navBtnStyle(reviewStep === total)}>›</button>
          <button onClick={() => setReviewStep(total)} disabled={reviewStep === total}
            style={navBtnStyle(reviewStep === total)}>»</button>
        </div>

        {/* Move list (scrollable) — height scales with available chrome space */}
        {!condensed && (
          <div
            ref={moveListRef}
            style={{
              maxHeight:  Math.max(40, wrapperMin * 0.18),
              overflowY:  'auto',
              background: 'var(--surface2)',
              borderRadius: 6,
              padding:    `${uiGap}px ${uiGap * 2}px`,
              fontSize:   uiFs - 1,
              color:      'var(--text-muted)',
            }}
          >
            {pairs.map(({ wMove, bMove, idx }) => (
              <span key={idx} style={{ display: 'inline-flex', gap: 2, marginRight: uiGap * 3 }}>
                <span style={{ color: 'var(--text-faint)' }}>{idx / 2 + 1}.</span>
                <button
                  data-step={idx + 1}
                  onClick={() => setReviewStep(idx + 1)}
                  style={moveChipStyle(reviewStep === idx + 1)}
                >{wMove}</button>
                {bMove && (
                  <button
                    data-step={idx + 2}
                    onClick={() => setReviewStep(idx + 2)}
                    style={moveChipStyle(reviewStep === idx + 2)}
                  >{bMove}</button>
                )}
              </span>
            ))}
          </div>
        )}

        <button
          onClick={exitReview}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-muted)',
            fontSize: uiFs - 1,
            padding: `${uiGap}px ${uiGap * 4}px`,
            cursor: 'pointer',
          }}
        >
          ✕ Exit Review
        </button>
      </div>
    );
  }

  // ── Tiny style helpers ──────────────────────────────────────────────────────
  function navBtnStyle(disabled: boolean): React.CSSProperties {
    return {
      background:   'var(--surface2)',
      border:       '1px solid var(--border)',
      borderRadius: 5,
      color:        disabled ? 'var(--text-faint)' : 'var(--text)',
      cursor:       disabled ? 'default' : 'pointer',
      fontSize:     uiFs,
      padding:      `${uiGap}px ${uiGap * 3}px`,
      opacity:      disabled ? 0.4 : 1,
    };
  }

  function moveChipStyle(active: boolean): React.CSSProperties {
    return {
      background:   active ? '#c0a060' : 'transparent',
      color:        active ? '#fff' : 'var(--text-muted)',
      border:       'none',
      borderRadius: 3,
      cursor:       'pointer',
      padding:      `0 ${uiGap}px`,
      fontSize:     uiFs - 1,
      fontWeight:   active ? 700 : 400,
    };
  }

  // ── Dissolved state ─────────────────────────────────────────────────────────
  if (dissolved) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 32 }}>♟️</div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
          This chess game is no longer available — the connection was dissolved.
        </p>
        <button
          onClick={onClose}
          style={{ background: 'var(--color-danger)', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
        >
          Remove widget
        </button>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading || !game || !chess) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>Loading chess game…</div>
      </div>
    );
  }

  const gameOver = ['white_wins', 'black_wins', 'draw', 'stalemate'].includes(game.status);
  const totalMoves = game.moveHistory?.length ?? 0;

  // ── Full render ─────────────────────────────────────────────────────────────
  return (
    <>
      {/* Pulse animation for turn indicator */}
      <style>{`
        @keyframes chessTurnPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.75); }
        }
      `}</style>

      <div ref={wrapperRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', padding: uiPad, gap: uiGap }}>

        {/* Shared header — hide when widget is too small */}
        {!hideChrome && (
          <div style={{ display: 'flex', alignItems: 'center', gap: uiGap * 2, flexShrink: 0 }}>
            <span style={{ fontSize: uiFs - 1 }}>♟️</span>
            <span style={{ fontSize: uiFs - 1, color: 'var(--text-faint)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              vs <strong style={{ color: 'var(--text-muted)' }}>@{partner?.username ?? '…'}</strong>
            </span>
            <div style={{
              width: Math.max(5, uiFs * 0.5), height: Math.max(5, uiFs * 0.5), borderRadius: '50%',
              background: isOnline ? '#22c55e' : 'var(--text-faint)',
              boxShadow: isOnline ? '0 0 4px #22c55e' : 'none',
            }} />
          </div>
        )}

        {/* Opponent row */}
        {!hideChrome && <div style={{ flexShrink: 0 }}>{renderPlayerRow('top')}</div>}

        {/* Board area */}
        <div
          ref={containerRef}
          style={{ flex: '1 1 0', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{ position: 'relative' }}>
            {renderBoard()}
            {renderPromotionPicker()}

            {/* Game-over overlay banner */}
            {gameOver && !inReview && (
              <div style={{
                position:   'absolute',
                top:        '50%',
                left:       '50%',
                transform:  'translate(-50%, -50%)',
                background: 'rgba(0,0,0,0.82)',
                borderRadius: 10,
                padding:    '12px 20px',
                textAlign:  'center',
                minWidth:   160,
                zIndex:     10,
              }}>
                <div style={{ color: '#e0c080', fontSize: 15, fontWeight: 700 }}>
                  {statusBanner(game.status)}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4 }}>
                  Game over in {totalMoves} move{totalMoves !== 1 ? 's' : ''}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* My row */}
        {!hideChrome && <div style={{ flexShrink: 0 }}>{renderPlayerRow('bottom')}</div>}

        {/* Status / turn indicator — hide in condensed mode to save space */}
        {!gameOver && !inReview && !hideChrome && !condensed && (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: uiFs - 1, flexShrink: 0 }}>
            {isMyTurn ? '🟡 Your turn' : '⏳ Waiting for opponent…'}
          </div>
        )}

        {/* Error message */}
        {errMsg && (
          <div style={{ color: '#f87171', fontSize: uiFs - 1, textAlign: 'center', flexShrink: 0 }}>
            {errMsg}
          </div>
        )}

        {/* Controls */}
        {!hideChrome && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: uiGap * 2 }}>
            {inReview ? renderReplayControls() : (
              <div style={{ display: 'flex', gap: uiGap * 3 }}>
                {gameOver && (
                  <button
                    onClick={handleReset}
                    disabled={resetting}
                    style={{
                      flex: 1,
                      background: '#c0a060',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 7,
                      padding: `${uiGap * 2}px 0`,
                      fontSize: uiFs,
                      fontWeight: 600,
                      cursor: resetting ? 'default' : 'pointer',
                      opacity: resetting ? 0.6 : 1,
                    }}
                  >
                    {resetting ? 'Starting…' : condensed ? '🔄' : '🔄 Play Again'}
                  </button>
                )}
                {gameOver && totalMoves > 0 && !condensed && (
                  <button
                    onClick={enterReview}
                    style={{
                      flex: 1,
                      background: 'var(--surface2)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                      borderRadius: 7,
                      padding: `${uiGap * 2}px 0`,
                      fontSize: uiFs,
                      cursor: 'pointer',
                    }}
                  >
                    📋 Review
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
