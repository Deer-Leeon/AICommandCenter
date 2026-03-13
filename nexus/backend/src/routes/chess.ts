/**
 * /api/chess — Real-time chess routes.
 *
 * GET  /:connectionId          — get or create the game for this connection
 * GET  /:connectionId/peek     — check if a game exists (returns null if not, never creates)
 * POST /:connectionId/move     — validate & apply a move, broadcast via SSE
 * POST /:connectionId/reset    — start a new game (swap colors), broadcast
 * GET  /:connectionId/history  — return full move history array
 */
import { Router, type Response } from 'express';
import { Chess } from 'chess.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { broadcastToConnection } from '../lib/sseRegistry.js';

export const chessRouter = Router();

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

interface SharedChessRow {
  id:            string;
  connection_id: string;
  board_fen:     string;
  white_user_id: string | null;
  black_user_id: string | null;
  current_turn:  'white' | 'black';
  status:        'waiting' | 'active' | 'white_wins' | 'black_wins' | 'draw' | 'stalemate';
  move_history:  string[];
  last_move:     { from: string; to: string } | null;
  created_at:    string;
  updated_at:    string;
}

function toClient(row: SharedChessRow) {
  return {
    id:           row.id,
    connectionId: row.connection_id,
    boardFen:     row.board_fen,
    whiteUserId:  row.white_user_id,
    blackUserId:  row.black_user_id,
    currentTurn:  row.current_turn,
    status:       row.status,
    moveHistory:  (row.move_history ?? []) as string[],
    lastMove:     row.last_move ?? null,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

async function assertParticipant(
  connectionId: string,
  userId: string,
): Promise<{ ok: boolean; partnerId: string }> {
  const { data } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .eq('status', 'accepted')
    .single();
  if (!data) return { ok: false, partnerId: '' };
  const ok = data.user_id_a === userId || data.user_id_b === userId;
  const partnerId = data.user_id_a === userId ? data.user_id_b : data.user_id_a;
  return { ok, partnerId };
}

// ── GET /api/chess/:connectionId ──────────────────────────────────────────────
chessRouter.get('/:connectionId', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId           = req.user!.id;
  const { connectionId } = req.params;

  const { ok, partnerId } = await assertParticipant(connectionId, userId);
  if (!ok) { res.status(403).json({ error: 'Unauthorized' }); return; }

  // Return existing game if present
  const { data: existing } = await supabase
    .from('shared_chess')
    .select('*')
    .eq('connection_id', connectionId)
    .maybeSingle();

  if (existing) {
    res.json(toClient(existing as SharedChessRow));
    return;
  }

  // Create — the requesting user (who placed the widget first) plays white
  const { data: newGame, error } = await supabase
    .from('shared_chess')
    .insert({
      connection_id: connectionId,
      white_user_id: userId,
      black_user_id: partnerId,
      status:        'active',
    })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(toClient(newGame as SharedChessRow));
});

// ── POST /api/chess/:connectionId/move ────────────────────────────────────────
chessRouter.post('/:connectionId/move', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId           = req.user!.id;
  const { connectionId } = req.params;
  const { from, to, promotion } = req.body as {
    from?: string; to?: string; promotion?: string;
  };

  if (!from || !to) { res.status(400).json({ error: 'from and to are required' }); return; }

  const { ok } = await assertParticipant(connectionId, userId);
  if (!ok) { res.status(403).json({ error: 'Unauthorized' }); return; }

  const { data: game } = await supabase
    .from('shared_chess')
    .select('*')
    .eq('connection_id', connectionId)
    .single();

  if (!game) { res.status(404).json({ error: 'Game not found' }); return; }
  const g = game as SharedChessRow;

  if (g.status !== 'active') {
    res.status(400).json({ error: 'Game is not active' }); return;
  }

  const myColor = g.white_user_id === userId ? 'white' : g.black_user_id === userId ? 'black' : null;
  if (!myColor) { res.status(403).json({ error: 'Unauthorized' }); return; }
  if (g.current_turn !== myColor) {
    res.status(400).json({ error: 'Not your turn' }); return;
  }

  // Server-side validation via chess.js
  const chess = new Chess(g.board_fen);
  let result;
  try {
    result = chess.move({ from, to, promotion: (promotion as 'q' | 'r' | 'b' | 'n') ?? undefined });
  } catch {
    res.status(400).json({ error: 'Illegal move' }); return;
  }

  const newFen      = chess.fen();
  const newTurn     = chess.turn() === 'w' ? 'white' : 'black';
  const newHistory  = [...(g.move_history ?? []), result.san];
  const newLastMove = { from, to };

  let newStatus: SharedChessRow['status'] = 'active';
  if (chess.isCheckmate()) {
    newStatus = myColor === 'white' ? 'white_wins' : 'black_wins';
  } else if (chess.isStalemate()) {
    newStatus = 'stalemate';
  } else if (chess.isDraw()) {
    newStatus = 'draw';
  }

  const { data: updated, error } = await supabase
    .from('shared_chess')
    .update({
      board_fen:    newFen,
      current_turn: newTurn,
      status:       newStatus,
      move_history: newHistory,
      last_move:    newLastMove,
      updated_at:   new Date().toISOString(),
    })
    .eq('connection_id', connectionId)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  const clientGame = toClient(updated as SharedChessRow);

  await broadcastToConnection(connectionId, {
    type:       'chess:move',
    connectionId,
    widgetType: 'shared_chess',
    payload:    clientGame,
    sentBy:     userId,
    timestamp:  new Date().toISOString(),
  });

  res.json(clientGame);
});

// ── POST /api/chess/:connectionId/reset ───────────────────────────────────────
chessRouter.post('/:connectionId/reset', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId           = req.user!.id;
  const { connectionId } = req.params;

  const { ok } = await assertParticipant(connectionId, userId);
  if (!ok) { res.status(403).json({ error: 'Unauthorized' }); return; }

  const { data: game } = await supabase
    .from('shared_chess')
    .select('white_user_id, black_user_id')
    .eq('connection_id', connectionId)
    .single();

  if (!game) { res.status(404).json({ error: 'Game not found' }); return; }

  const { white_user_id, black_user_id } = game as Pick<SharedChessRow, 'white_user_id' | 'black_user_id'>;

  const { data: updated, error } = await supabase
    .from('shared_chess')
    .update({
      board_fen:     STARTING_FEN,
      white_user_id: black_user_id, // swap colors each new game
      black_user_id: white_user_id,
      current_turn:  'white',
      status:        'active',
      move_history:  [],
      last_move:     null,
      updated_at:    new Date().toISOString(),
    })
    .eq('connection_id', connectionId)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  const clientGame = toClient(updated as SharedChessRow);

  await broadcastToConnection(connectionId, {
    type:       'chess:reset',
    connectionId,
    widgetType: 'shared_chess',
    payload:    clientGame,
    sentBy:     userId,
    timestamp:  new Date().toISOString(),
  });

  res.json(clientGame);
});

// ── GET /api/chess/:connectionId/peek ────────────────────────────────────────
// Returns the game if one exists, or null — never creates a new game.
// Used by the setup modal to show whether a game is already in progress.
chessRouter.get('/:connectionId/peek', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId           = req.user!.id;
  const { connectionId } = req.params;

  const { ok } = await assertParticipant(connectionId, userId);
  if (!ok) { res.status(403).json({ error: 'Unauthorized' }); return; }

  const { data } = await supabase
    .from('shared_chess')
    .select('*')
    .eq('connection_id', connectionId)
    .maybeSingle();

  res.json(data ? toClient(data as SharedChessRow) : null);
});

// ── GET /api/chess/:connectionId/history ──────────────────────────────────────
chessRouter.get('/:connectionId/history', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId           = req.user!.id;
  const { connectionId } = req.params;

  const { ok } = await assertParticipant(connectionId, userId);
  if (!ok) { res.status(403).json({ error: 'Unauthorized' }); return; }

  const { data: game } = await supabase
    .from('shared_chess')
    .select('move_history')
    .eq('connection_id', connectionId)
    .single();

  if (!game) { res.status(404).json({ error: 'Game not found' }); return; }

  res.json({ history: (game as { move_history: string[] }).move_history ?? [] });
});
