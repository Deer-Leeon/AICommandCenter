import { Router, type Request, type Response } from 'express';
import { google } from 'googleapis';
import { supabase } from '../lib/supabase.js';
import { saveTokensForProvider } from '../services/tokenService.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const authRouter = Router();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// ── Individual scopes (one per service) ───────────────────────────────────────

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TASKS_SCOPES    = ['https://www.googleapis.com/auth/tasks'];
const DOCS_SCOPES     = ['https://www.googleapis.com/auth/documents'];
const DRIVE_SCOPES    = ['https://www.googleapis.com/auth/drive.readonly'];
const GMAIL_SCOPES    = ['https://www.googleapis.com/auth/gmail.modify'];

/** Legacy combined scope set — kept so the old /google/initiate route still works */
const GOOGLE_SCOPES = [...CALENDAR_SCOPES, ...TASKS_SCOPES, ...DOCS_SCOPES, ...DRIVE_SCOPES];

// ── Helper: check whether a user has a usable token for a given Google service ─
// Mirrors the GOOGLE_TOKEN_FALLBACKS logic in tokenService so status checks
// correctly reflect existing broader tokens.

type GoogleServiceKey = 'google-calendar' | 'google-tasks' | 'google-docs' | 'google-drive' | 'google-gmail';

const TOKEN_FALLBACKS: Record<GoogleServiceKey, string[]> = {
  'google-calendar': ['google-calendar', 'google'],
  'google-tasks':    ['google-tasks', 'google-calendar', 'google'],
  'google-docs':     ['google-docs', 'google'],
  'google-drive':    ['google-drive', 'google-docs', 'google'],
  'google-gmail':    ['google-gmail'],
};

async function hasGoogleServiceToken(userId: string, service: GoogleServiceKey): Promise<boolean> {
  for (const provider of TOKEN_FALLBACKS[service]) {
    const { data } = await supabase
      .from('user_tokens')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();
    if (data) return true;
  }
  return false;
}

// ── Per-service Google OAuth initiate ─────────────────────────────────────────
// State encodes "userId:service" so the single callback can route correctly.

authRouter.post('/google-calendar/initiate', requireAuth, (req: AuthRequest, res: Response) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: CALENDAR_SCOPES,
    state: `${req.user!.id}:google-calendar`,
  });
  res.json({ url });
});

authRouter.post('/google-tasks/initiate', requireAuth, (req: AuthRequest, res: Response) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: TASKS_SCOPES,
    state: `${req.user!.id}:google-tasks`,
  });
  res.json({ url });
});

authRouter.post('/google-docs/initiate', requireAuth, (req: AuthRequest, res: Response) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DOCS_SCOPES,
    state: `${req.user!.id}:google-docs`,
  });
  res.json({ url });
});

authRouter.post('/google-drive/initiate', requireAuth, (req: AuthRequest, res: Response) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DRIVE_SCOPES,
    state: `${req.user!.id}:google-drive`,
  });
  res.json({ url });
});

authRouter.post('/google-gmail/initiate', requireAuth, (req: AuthRequest, res: Response) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state: `${req.user!.id}:google-gmail`,
  });
  res.json({ url });
});

// ── Per-service status checks ──────────────────────────────────────────────────

authRouter.get('/google-calendar/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const connected = await hasGoogleServiceToken(req.user!.id, 'google-calendar');
  res.json({ connected });
});

authRouter.get('/google-tasks/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const connected = await hasGoogleServiceToken(req.user!.id, 'google-tasks');
  res.json({ connected });
});

authRouter.get('/google-docs/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const connected = await hasGoogleServiceToken(req.user!.id, 'google-docs');
  res.json({ connected });
});

authRouter.get('/google-drive/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const connected = await hasGoogleServiceToken(req.user!.id, 'google-drive');
  res.json({ connected });
});

authRouter.get('/google-gmail/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const connected = await hasGoogleServiceToken(req.user!.id, 'google-gmail');
  res.json({ connected });
});

// ── Legacy combined initiate (kept for backward compat) ───────────────────────
// Step 1a (preferred): POST with Bearer token in Authorization header.
// Frontend calls this via apiFetch, gets back { url }, then redirects.
authRouter.post(
  '/google/initiate',
  requireAuth,
  (req: AuthRequest, res: Response) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      state: req.user!.id,   // no service suffix → saves as provider 'google'
    });
    res.json({ url });
  }
);

// Step 1b (legacy): GET with ?token= for backward compatibility.
authRouter.get('/google', async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized — missing token query param' });
    return;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state: user.id,
  });
  res.redirect(url);
});

// Step 2: Google callback — handles all Google OAuth flows (per-service + legacy).
// State format: "userId" (legacy combined) or "userId:service" (per-service).
authRouter.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state: rawState, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error) {
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code || !rawState) {
    res.status(400).send('Missing code or state parameter');
    return;
  }

  // Parse "userId" or "userId:google-calendar" / "userId:google-docs"
  const colonIdx = rawState.lastIndexOf(':');
  const userId = colonIdx > 0 ? rawState.slice(0, colonIdx) : rawState;
  const serviceKey = colonIdx > 0 ? rawState.slice(colonIdx + 1) : 'google';

  // Map service key → provider stored in user_tokens
  const validServices = ['google-calendar', 'google-tasks', 'google-docs', 'google-drive'];
  const provider = validServices.includes(serviceKey) ? serviceKey : 'google';

  // Build the success redirect param
  const successParam =
    provider === 'google-calendar' ? 'google_calendar_connected=true' :
    provider === 'google-tasks'    ? 'google_tasks_connected=true'    :
    provider === 'google-docs'     ? 'google_docs_connected=true'     :
    provider === 'google-drive'    ? 'google_drive_connected=true'    :
    'google_connected=true';

  try {
    const { tokens } = await oauth2Client.getToken(code);
    await saveTokensForProvider(userId, provider, {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token ?? null,
      expiry_date: tokens.expiry_date ?? null,
    });
    console.log(`✅ Google tokens saved — user ${userId}, provider ${provider}`);
    res.redirect(`${frontendUrl}?${successParam}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OAuth failed';
    console.error('Google OAuth callback error:', msg);
    res.redirect(`${frontendUrl}?google_error=${encodeURIComponent(msg)}`);
  }
});

// Legacy combined status — connected if the user has at least the core google-calendar token
authRouter.get(
  '/google/status',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const connected = await hasGoogleServiceToken(req.user!.id, 'google-calendar');
    res.json({ connected });
  }
);

// ─── Slack OAuth ──────────────────────────────────────────────────────────────

const SLACK_USER_SCOPES = [
  'channels:history',
  'channels:read',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:read',
  'mpim:history',
  'chat:write',
  'users:read',
].join(',');

// Step 1: POST — return OAuth URL as JSON (frontend redirects)
authRouter.post(
  '/slack/initiate',
  requireAuth,
  (req: AuthRequest, res: Response) => {
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUri = process.env.SLACK_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      res.status(500).json({ error: 'Slack OAuth not configured — add SLACK_CLIENT_ID and SLACK_REDIRECT_URI to .env' });
      return;
    }
    const url =
      `https://slack.com/oauth/v2/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&user_scope=${encodeURIComponent(SLACK_USER_SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(req.user!.id)}`;
    res.json({ url });
  },
);

// Step 2: Slack redirects here with ?code=...&state=userId
authRouter.get('/slack/callback', async (req: Request, res: Response) => {
  const { code, state: userId, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error) {
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(error)}`);
    return;
  }
  if (!code || !userId) {
    res.status(400).send('Missing code or state parameter');
    return;
  }

  try {
    const params = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? '',
      client_secret: process.env.SLACK_CLIENT_SECRET ?? '',
      code,
      redirect_uri: process.env.SLACK_REDIRECT_URI ?? '',
    });

    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = (await tokenRes.json()) as {
      ok: boolean;
      error?: string;
      authed_user?: { access_token?: string };
    };

    if (!data.ok) throw new Error(data.error ?? 'Slack token exchange failed');

    const userToken = data.authed_user?.access_token;
    if (!userToken) throw new Error('No user token returned from Slack');

    await supabase.from('user_tokens').upsert(
      {
        user_id: userId,
        provider: 'slack',
        access_token: userToken,
        refresh_token: null,
        expires_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );

    console.log(`✅ Slack token saved for user ${userId}`);
    res.redirect(`${frontendUrl}?slack_connected=true`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Slack OAuth failed';
    console.error('Slack OAuth callback error:', msg);
    res.redirect(`${frontendUrl}?slack_error=${encodeURIComponent(msg)}`);
  }
});

// Check whether the current user has connected their Slack account
authRouter.get(
  '/slack/status',
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const { data } = await supabase
      .from('user_tokens')
      .select('id, updated_at')
      .eq('user_id', req.user!.id)
      .eq('provider', 'slack')
      .single();
    res.json({ connected: !!data, updatedAt: data?.updated_at ?? null });
  },
);

// ─── Disconnect a service — revoke on the provider side, then delete locally ───

const DISCONNECTABLE_PROVIDERS = new Set([
  'google-calendar', 'google-tasks', 'google-docs', 'google-drive', 'slack', 'plaid', 'spotify',
]);

/**
 * Revoke a Google token.
 * We prefer the refresh_token (revoking it instantly invalidates ALL access
 * tokens derived from it and removes the app from the user's Google account
 * "Third-party apps" list). Falls back to the access_token if no refresh
 * token is stored.
 * Errors are swallowed — an already-expired or already-revoked token returns
 * HTTP 400 from Google, but we still want to clean up our DB row.
 */
async function revokeGoogleToken(
  accessToken: string,
  refreshToken?: string | null
): Promise<void> {
  const token = refreshToken ?? accessToken;
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    // network errors are non-fatal — we proceed with local deletion
  }
}

/**
 * Revoke a Slack user token via auth.revoke.
 * Same swallow-on-error strategy.
 */
async function revokeSlackToken(accessToken: string): Promise<void> {
  try {
    await fetch('https://slack.com/api/auth.revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(accessToken)}`,
    });
  } catch {
    // non-fatal
  }
}

authRouter.delete('/token/:provider', requireAuth, async (req: AuthRequest, res: Response) => {
  const { provider } = req.params;
  if (!DISCONNECTABLE_PROVIDERS.has(provider)) {
    res.status(400).json({ error: `Unknown provider: ${provider}` });
    return;
  }

  // 1. Fetch the stored token so we can revoke it remotely
  const { data: row } = await supabase
    .from('user_tokens')
    .select('access_token, refresh_token')
    .eq('user_id', req.user!.id)
    .eq('provider', provider)
    .single();

  // 2. Revoke on the provider side (best-effort — we always delete locally)
  if (row) {
    const isGoogle = provider.startsWith('google-');
    if (isGoogle) {
      await revokeGoogleToken(row.access_token, row.refresh_token);
    } else if (provider === 'slack') {
      await revokeSlackToken(row.access_token);
    } else if (provider === 'plaid') {
      // Plaid item removal — import lazily to avoid circular dep
      try {
        const { plaidClient } = await import('../services/plaidClient.js');
        await plaidClient.itemRemove({ access_token: row.access_token });
      } catch { /* non-fatal */ }
    }
  }

  // 3. Delete the local token row regardless of revocation outcome
  const { error } = await supabase
    .from('user_tokens')
    .delete()
    .eq('user_id', req.user!.id)
    .eq('provider', provider);

  if (error) {
    console.error(`Disconnect ${provider}:`, error.message);
    res.status(500).json({ error: error.message });
    return;
  }

  console.log(`🔌 Fully disconnected ${provider} for user ${req.user!.id}`);
  res.json({ success: true });
});

// ─── General auth status (public) ─────────────────────────────────────────────

authRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    slack: !!(process.env.SLACK_BOT_TOKEN && process.env.SLACK_BOT_TOKEN !== 'xoxb-'),
    obsidian: !!process.env.OBSIDIAN_API_KEY,
  });
});
