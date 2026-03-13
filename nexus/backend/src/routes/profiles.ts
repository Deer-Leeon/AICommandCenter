import { Router, type Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const profilesRouter = Router();

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

// ── GET /api/profiles/me — full profile for current user ───────────────────────
profilesRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, username, display_name, created_at')
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No row — create from auth user (handles existing users pre-profile)
      const { data: user } = await supabase.auth.admin.getUserById(userId);
      if (!user?.user) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      const u = user.user;
      const dn = (u.user_metadata?.full_name as string)?.trim() || u.email?.split('@')[0] || 'User';
      const displayName = dn.slice(0, 40) || 'User';

      const { data: inserted, error: insertErr } = await supabase
        .from('profiles')
        .insert({ user_id: userId, display_name: displayName, username: null })
        .select('user_id, username, display_name, created_at')
        .single();

      if (insertErr) {
        res.status(500).json({ error: insertErr.message });
        return;
      }
      res.json({
        userId: inserted!.user_id,
        username: inserted!.username,
        displayName: inserted!.display_name,
        createdAt: inserted!.created_at,
      });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({
    userId: data.user_id,
    username: data.username,
    displayName: data.display_name,
    createdAt: data.created_at,
  });
});

// ── PATCH /api/profiles/me/username — update username ─────────────────────────
profilesRouter.patch('/me/username', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { username } = req.body as { username?: string };

  if (typeof username !== 'string' || !username.trim()) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }

  const normalized = username.trim().toLowerCase();
  if (!USERNAME_REGEX.test(normalized)) {
    res.status(400).json({ error: 'Username must be 3–20 characters, letters, numbers, and underscores only' });
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ username: normalized, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('user_id, username, display_name, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({
    userId: data!.user_id,
    username: data!.username,
    displayName: data!.display_name,
    createdAt: data!.created_at,
  });
});

// ── GET /api/profiles/check?username= — availability check (for onboarding + settings) ─
profilesRouter.get('/check', requireAuth, async (req: AuthRequest, res: Response) => {
  const raw = (req.query.username as string)?.trim()?.toLowerCase();
  if (!raw) {
    res.json({ available: false, reason: 'empty' });
    return;
  }
  if (!USERNAME_REGEX.test(raw)) {
    res.json({ available: false, reason: 'invalid_format' });
    return;
  }

  const { data } = await supabase
    .from('profiles')
    .select('user_id')
    .ilike('username', raw)
    .maybeSingle();

  const currentUserId = req.user!.id;
  const isOwn = data?.user_id === currentUserId;
  res.json({ available: !data || isOwn, reason: data && !isOwn ? 'taken' : null });
});

// ── GET /api/profiles/lookup?q= — find user by username or email ──────────────
profilesRouter.get('/lookup', requireAuth, async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string)?.trim();
  if (!q) {
    res.status(400).json({ error: 'Query parameter q is required' });
    return;
  }

  const isEmail = q.includes('@');
  let result: { user_id: string; username: string | null; display_name: string } | null = null;

  if (isEmail) {
    const { data: userId } = await supabase.rpc('get_user_id_by_email', { em: q });
    if (userId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('user_id, username, display_name')
        .eq('user_id', userId)
        .single();
      if (prof) result = prof;
    }
  } else {
    const normalized = q.toLowerCase().replace(/^@/, '');
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, display_name')
      .ilike('username', normalized)
      .maybeSingle();
    if (data) result = data;
  }

  if (!result) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    userId: result.user_id,
    username: result.username,
    displayName: result.display_name,
  });
});
