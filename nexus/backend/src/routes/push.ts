/**
 * Push notification routes
 *
 * POST /api/push/register  — store a device push token for the current user
 * sendPushToUser()         — internal helper, called by notification triggers
 *                            throughout the codebase (Pomodoro, Gmail, etc.)
 *
 * APNs setup (iOS) — add to .env:
 *   APNS_KEY_ID      — 10-char key ID from Apple Developer Portal
 *   APNS_TEAM_ID     — 10-char team ID from your Apple Developer account
 *   APNS_KEY_PATH    — path to the .p8 AuthKey file (e.g. ./AuthKey_XXXXXX.p8)
 *   APNS_BUNDLE_ID   — com.nexus.app
 */
import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const pushRouter = Router();

// ── POST /api/push/register ───────────────────────────────────────────────────
// Called on every Capacitor app launch after the user is authenticated.
// Upserts the device token so the server always has a fresh token per device.

pushRouter.post('/register', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { token, platform } = req.body as { token?: string; platform?: string };

  if (!token || !platform) {
    res.status(400).json({ error: 'token and platform are required' });
    return;
  }

  const validPlatforms = ['ios', 'android', 'web'];
  if (!validPlatforms.includes(platform)) {
    res.status(400).json({ error: `platform must be one of: ${validPlatforms.join(', ')}` });
    return;
  }

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, token, platform },
      { onConflict: 'token' },   // token is UNIQUE — update user_id + platform if token re-registers
    );

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ ok: true });
});

// ── DELETE /api/push/unregister ───────────────────────────────────────────────
// Called when the user signs out from Capacitor so stale tokens are cleaned up.

pushRouter.delete('/unregister', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { token } = req.body as { token?: string };

  if (!token) { res.status(400).json({ error: 'token required' }); return; }

  await supabase
    .from('push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('token', token);

  res.json({ ok: true });
});

// ── sendPushToUser (internal) ─────────────────────────────────────────────────
// Call this wherever you currently call broadcastToUser() for notification
// events — it fires a native APNs push so the user gets the notification even
// when the app is backgrounded or closed.
//
// Example usage (e.g. in pomodoro.ts when a session ends):
//   import { sendPushToUser } from './push.js';
//   await sendPushToUser(userId, { title: '🍅 Focus complete!', body: 'Time for a break.' });

interface PushPayload {
  title: string;
  body: string;
  badge?: number;
  data?: Record<string, unknown>;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  // Get all tokens for this user
  const { data: rows } = await supabase
    .from('push_tokens')
    .select('token, platform')
    .eq('user_id', userId);

  if (!rows?.length) return;

  const iosTokens = rows.filter((r) => r.platform === 'ios').map((r) => r.token);
  if (!iosTokens.length) return;

  // APNs requires: APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_PATH, APNS_BUNDLE_ID
  const keyId    = process.env.APNS_KEY_ID;
  const teamId   = process.env.APNS_TEAM_ID;
  const keyPath  = process.env.APNS_KEY_PATH;
  const bundleId = process.env.APNS_BUNDLE_ID || 'com.nexus.app';

  if (!keyId || !teamId || !keyPath) {
    // APNs not configured — silently skip (push is an enhancement, not critical)
    return;
  }

  // Dynamically import node-apn only when APNs is configured to avoid
  // startup errors on environments without the .p8 key file present.
  // node-apn is CommonJS — the dynamic import resolves to the module directly
  // (no .default wrapper). Cast via any to avoid TS interop complaints.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let apn: any;
  try {
    apn = await import('node-apn');
  } catch {
    return;
  }

  const ApnProvider     = apn.Provider     ?? apn.default?.Provider;
  const ApnNotification = apn.Notification ?? apn.default?.Notification;

  if (!ApnProvider || !ApnNotification) return;

  const provider = new ApnProvider({
    token: { key: keyPath, keyId, teamId },
    production: process.env.NODE_ENV === 'production',
  });

  const note = new ApnNotification();
  note.expiry    = Math.floor(Date.now() / 1000) + 3600;
  note.badge     = payload.badge ?? 0;
  note.sound     = 'default';
  note.alert     = { title: payload.title, body: payload.body };
  note.payload   = payload.data ?? {};
  note.topic     = bundleId;

  await Promise.all(
    iosTokens.map((token) => provider.send(note, token)),
  );

  provider.shutdown();
}
