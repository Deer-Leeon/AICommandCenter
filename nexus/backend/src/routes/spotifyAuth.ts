import { Router, type Request, type Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const spotifyAuthRouter = Router();

const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-top-read',
  'streaming',
  'user-read-email',
  'user-read-private',
].join(' ');

// ── Step 1: Return the Spotify OAuth URL ─────────────────────────────────────

spotifyAuthRouter.post('/initiate', requireAuth, (req: AuthRequest, res: Response) => {
  const clientId   = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(500).json({ error: 'Spotify OAuth not configured — add SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI to .env' });
    return;
  }
  const url =
    `https://accounts.spotify.com/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SPOTIFY_SCOPES)}` +
    `&state=${encodeURIComponent(req.user!.id)}` +
    `&show_dialog=true`;
  res.json({ url });
});

// ── Step 2: Spotify redirects here with ?code=...&state=userId ───────────────

spotifyAuthRouter.get('/callback', async (req: Request, res: Response) => {
  const { code, state: userId, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error) {
    res.redirect(`${frontendUrl}?spotify_error=${encodeURIComponent(error)}`);
    return;
  }
  if (!code || !userId) {
    res.status(400).send('Missing code or state parameter');
    return;
  }

  try {
    const clientId     = process.env.SPOTIFY_CLIENT_ID!;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
    const redirectUri  = process.env.SPOTIFY_REDIRECT_URI!;

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    const data = await tokenRes.json() as {
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
      error?:        string;
    };

    if (data.error) throw new Error(data.error);

    const expiresAt = Date.now() + data.expires_in * 1000;

    await supabase.from('user_tokens').upsert(
      {
        user_id:       userId,
        provider:      'spotify',
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    expiresAt,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );

    console.log(`✅ Spotify tokens saved — user ${userId}`);
    res.redirect(`${frontendUrl}?spotify_connected=true`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Spotify OAuth failed';
    console.error('Spotify OAuth callback error:', msg);
    res.redirect(`${frontendUrl}?spotify_error=${encodeURIComponent(msg)}`);
  }
});

// ── Status ────────────────────────────────────────────────────────────────────

spotifyAuthRouter.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data } = await supabase
    .from('user_tokens')
    .select('id')
    .eq('user_id', req.user!.id)
    .eq('provider', 'spotify')
    .single();
  res.json({ connected: !!data });
});
