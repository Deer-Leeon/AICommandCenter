import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const spotifyRouter = Router();

// ── Token management ──────────────────────────────────────────────────────────

async function refreshSpotifyToken(userId: string, refreshToken: string): Promise<string | null> {
  try {
    const clientId     = process.env.SPOTIFY_CLIENT_ID!;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });

    const data = await res.json() as {
      access_token:   string;
      refresh_token?: string;
      expires_in:     number;
      error?:         string;
    };

    if (data.error) throw new Error(data.error);

    const expiresAt = Date.now() + data.expires_in * 1000;

    await supabase.from('user_tokens').upsert(
      {
        user_id:       userId,
        provider:      'spotify',
        access_token:  data.access_token,
        refresh_token: data.refresh_token ?? refreshToken,
        expires_at:    expiresAt,
        updated_at:    new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' },
    );

    return data.access_token;
  } catch (err) {
    console.error('Spotify token refresh failed:', err);
    return null;
  }
}

async function getSpotifyToken(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'spotify')
    .single();

  if (!data) return null;

  // Refresh if token expires within the next 60 seconds
  const needsRefresh = !data.expires_at || (data.expires_at - Date.now()) < 60_000;
  if (needsRefresh && data.refresh_token) {
    return refreshSpotifyToken(userId, data.refresh_token);
  }

  return data.access_token;
}

// ── In-flight request deduplication ──────────────────────────────────────────
// If two widget instances call the same Spotify endpoint at the same time
// (e.g. both polling /now-playing at the 5-second tick), we share the single
// in-flight fetch instead of making two identical Spotify API calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inFlight = new Map<string, Promise<any>>();

async function spotifyFetch(
  userId: string,
  path: string,
  options: RequestInit = {},
): Promise<globalThis.Response> {
  // Only deduplicate read-only (GET) requests; mutations always go through.
  const method = (options.method ?? 'GET').toUpperCase();
  const dedupeKey = method === 'GET' ? `${userId}:${path}` : null;

  if (dedupeKey && inFlight.has(dedupeKey)) {
    return inFlight.get(dedupeKey)!;
  }

  const doFetch = async (): Promise<globalThis.Response> => {
    let token = await getSpotifyToken(userId);
    if (!token) throw new Error('No Spotify token');

    const makeRequest = (tok: string) =>
      fetch(`https://api.spotify.com/v1${path}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${tok}`,
          'Content-Type':  'application/json',
          ...(options.headers as Record<string, string> ?? {}),
        },
      });

    let res = await makeRequest(token);

    // Auto-refresh and retry once on 401
    if (res.status === 401) {
      const { data: row } = await supabase
        .from('user_tokens')
        .select('refresh_token')
        .eq('user_id', userId)
        .eq('provider', 'spotify')
        .single();

      if (row?.refresh_token) {
        token = await refreshSpotifyToken(userId, row.refresh_token);
        if (token) res = await makeRequest(token);
      }
    }

    return res;
  };

  const promise = doFetch().finally(() => { if (dedupeKey) inFlight.delete(dedupeKey); });
  if (dedupeKey) inFlight.set(dedupeKey, promise);
  return promise;
}

// ── Client Credentials token (app-level, bypasses Dev Mode user restrictions) ─
let ccToken: { token: string; expiresAt: number } | null = null;

async function getClientCredentialsToken(): Promise<string | null> {
  if (ccToken && Date.now() < ccToken.expiresAt - 60_000) return ccToken.token;
  try {
    const clientId     = process.env.SPOTIFY_CLIENT_ID!;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });
    if (!res.ok) { console.error('Spotify CC token error:', res.status); return null; }
    const d = await res.json() as { access_token: string; expires_in: number };
    ccToken = { token: d.access_token, expiresAt: Date.now() + d.expires_in * 1000 };
    return ccToken.token;
  } catch (err) {
    console.error('Spotify CC token exception:', err);
    return null;
  }
}

async function spotifyFetchPublic(path: string): Promise<globalThis.Response> {
  const token = await getClientCredentialsToken();
  if (!token) throw new Error('No Spotify client credentials token');
  return fetch(`https://api.spotify.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

// ── Simple in-memory cache for expensive/frequent endpoints ──────────────────
const cache = new Map<string, { data: unknown; expiresAt: number }>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.data as T;
  return null;
}

// Returns stale data even after TTL expires — used as 429 fallback
function cacheGetStale<T>(key: string): T | null {
  const hit = cache.get(key);
  return hit ? hit.data as T : null;
}

function cacheSet(key: string, data: unknown, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/spotify/status
spotifyRouter.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data } = await supabase
    .from('user_tokens')
    .select('id')
    .eq('user_id', req.user!.id)
    .eq('provider', 'spotify')
    .single();
  res.json({ connected: !!data });
});

// GET /api/spotify/token — provides a fresh access token for the Web Playback SDK
// The SDK needs the raw Spotify token (not our backend JWT) to initialise the player.
spotifyRouter.get('/token', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const token = await getSpotifyToken(req.user!.id);
    if (!token) { res.status(401).json({ error: 'No Spotify token' }); return; }
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/spotify/now-playing
spotifyRouter.get('/now-playing', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId   = req.user!.id;
  const cacheKey = `now-playing:${userId}`;
  try {
    // now-playing is NEVER blocked by the data rate-limit breaker —
    // the widget must always stay in sync with Spotify.
    const spotifyRes = await spotifyFetch(userId, '/me/player?additional_types=track');

    if (spotifyRes.status === 204 || spotifyRes.status === 404) {
      res.json({ isPlaying: false, noActiveDevice: true });
      return;
    }
    // On 429 from Spotify itself, serve stale cache if available
    if (spotifyRes.status === 429) {
      const stale = cacheGetStale(cacheKey);
      if (stale) { res.json(stale); return; }
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    // Spotify Development Mode: non-approved accounts get 403 on all user
    // endpoints. Return a specific code so the frontend can show a clear message
    // instead of the generic "Open Spotify on any device" placeholder.
    if (spotifyRes.status === 403) {
      res.status(403).json({ error: 'spotify_dev_mode' });
      return;
    }
    if (!spotifyRes.ok) {
      res.status(spotifyRes.status).json({ error: 'Spotify API error' });
      return;
    }

    const player = await spotifyRes.json() as {
      is_playing:    boolean;
      progress_ms:   number;
      item:          SpotifyApiTrack | null;
      shuffle_state: boolean;
      repeat_state:  'off' | 'track' | 'context';
      device: {
        id:             string;
        name:           string;
        type:           string;
        volume_percent: number;
      } | null;
    };

    if (!player?.item) {
      res.json({ isPlaying: false, noActiveDevice: true });
      return;
    }

    const track = player.item;

    // Check if track is saved in library
    const savedRes = await spotifyFetch(userId, `/me/tracks/contains?ids=${track.id}`);
    const savedArr = savedRes.ok ? await savedRes.json() as boolean[] : [false];

    const nowPlayingResult = {
      isPlaying:    player.is_playing,
      progress:     player.progress_ms,
      duration:     track.duration_ms,
      shuffleState: player.shuffle_state,
      repeatState:  player.repeat_state,
      volume:       player.device?.volume_percent ?? 50,
      isSaved:      savedArr[0] ?? false,
      noActiveDevice: false,
      device: player.device ? {
        id:   player.device.id,
        name: player.device.name,
        type: player.device.type,
      } : null,
      track: {
        id:         track.id,
        name:       track.name,
        artists:    track.artists.map((a: { name: string }) => a.name).join(', '),
        album:      track.album.name,
        albumArt:   track.album.images?.[0]?.url ?? '',
        duration:   track.duration_ms,
        uri:        track.uri,
        isExplicit: track.explicit,
      },
    };
    cacheSet(cacheKey, nowPlayingResult, 10_000); // 10 s stale-cache window
    res.json(nowPlayingResult);
  } catch (err) {
    console.error('Spotify now-playing error:', err);
    const stale = cacheGetStale(cacheKey);
    if (stale) { res.json(stale); return; }
    res.status(500).json({ error: 'Failed to fetch now playing' });
  }
});

interface SpotifyApiTrack {
  id:          string;
  name:        string;
  uri:         string;
  duration_ms: number;
  explicit:    boolean;
  artists:     { name: string }[];
  album: {
    name:   string;
    images: { url: string }[];
  };
}

// POST /api/spotify/play
spotifyRouter.post('/play', requireAuth, async (req: AuthRequest, res: Response) => {
  const { contextUri, trackUri, deviceId } = req.body as {
    contextUri?: string;
    trackUri?:   string;
    deviceId?:   string;
  };
  const qs = deviceId ? `?device_id=${deviceId}` : '';
  const body: Record<string, unknown> = {};
  if (contextUri) body.context_uri = contextUri;
  if (trackUri)   body.uris = [trackUri];
  try {
    await spotifyFetch(req.user!.id, `/me/player/play${qs}`, {
      method: 'PUT',
      body:   JSON.stringify(Object.keys(body).length ? body : undefined),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/spotify/pause
spotifyRouter.post('/pause', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await spotifyFetch(req.user!.id, '/me/player/pause', { method: 'PUT' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/spotify/next
spotifyRouter.post('/next', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await spotifyFetch(req.user!.id, '/me/player/next', { method: 'POST' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/spotify/previous
spotifyRouter.post('/previous', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await spotifyFetch(req.user!.id, '/me/player/previous', { method: 'POST' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/spotify/seek
spotifyRouter.post('/seek', requireAuth, async (req: AuthRequest, res: Response) => {
  const { positionMs } = req.body as { positionMs: number };
  try {
    await spotifyFetch(req.user!.id, `/me/player/seek?position_ms=${Math.round(positionMs)}`, { method: 'PUT' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/spotify/volume
spotifyRouter.put('/volume', requireAuth, async (req: AuthRequest, res: Response) => {
  const { volumePercent } = req.body as { volumePercent: number };
  try {
    await spotifyFetch(req.user!.id, `/me/player/volume?volume_percent=${Math.round(volumePercent)}`, { method: 'PUT' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/spotify/shuffle
spotifyRouter.put('/shuffle', requireAuth, async (req: AuthRequest, res: Response) => {
  const { state } = req.body as { state: boolean };
  try {
    await spotifyFetch(req.user!.id, `/me/player/shuffle?state=${state}`, { method: 'PUT' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/spotify/repeat
spotifyRouter.put('/repeat', requireAuth, async (req: AuthRequest, res: Response) => {
  const { state } = req.body as { state: 'off' | 'track' | 'context' };
  try {
    await spotifyFetch(req.user!.id, `/me/player/repeat?state=${state}`, { method: 'PUT' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/spotify/devices
spotifyRouter.get('/devices', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const r = await spotifyFetch(req.user!.id, '/me/player/devices');
    const d = await r.json() as {
      devices: {
        id:             string;
        name:           string;
        type:           string;
        is_active:      boolean;
        volume_percent: number;
      }[];
    };
    res.json(d.devices.map(dev => ({
      id:            dev.id,
      name:          dev.name,
      type:          dev.type,
      isActive:      dev.is_active,
      volumePercent: dev.volume_percent,
    })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/spotify/transfer
// play defaults to false so transferring device on page load doesn't auto-start playback.
// Callers that want to resume (e.g. manual Play) pass play:true explicitly.
spotifyRouter.put('/transfer', requireAuth, async (req: AuthRequest, res: Response) => {
  const { deviceId, play = false } = req.body as { deviceId: string; play?: boolean };
  try {
    await spotifyFetch(req.user!.id, '/me/player', {
      method: 'PUT',
      body:   JSON.stringify({ device_ids: [deviceId], play }),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/spotify/playlists
spotifyRouter.get('/playlists', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId  = req.user!.id;
  const cacheKey = `playlists:${userId}`;
  const cached  = cacheGet(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const r = await spotifyFetch(userId, '/me/playlists?limit=50');
    if (r.status === 429) { const stale = cacheGetStale(cacheKey); if (stale) { res.json(stale); return; } res.status(429).json({ error: 'rate_limited' }); return; }
    if (r.status === 403) { res.status(403).json({ error: 'spotify_dev_mode' }); return; }
    if (!r.ok) {
      console.error('Spotify playlists error:', r.status, await r.text().catch(() => ''));
      res.status(r.status).json({ error: 'Spotify API error' });
      return;
    }
    const d = await r.json() as {
      items: ({
        id:     string;
        name:   string;
        images: { url: string }[];
        tracks: { href?: string; total?: number } | number | null;
        owner:  { display_name: string } | null;
      } | null)[];
    };
    const result = (d.items ?? [])
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map(p => {
        const tracks = (p as { tracks: unknown }).tracks;
        const trackCount =
          typeof tracks === 'number' ? tracks :
          (tracks && typeof tracks === 'object' && 'total' in tracks)
            ? Number((tracks as { total: unknown }).total ?? 0)
            : 0;
        return {
          id:         p.id,
          name:       p.name,
          coverArt:   p.images?.[0]?.url ?? '',
          trackCount,
          owner:      p.owner?.display_name ?? '',
          isPublic:   (p as { public?: boolean | null }).public === true,
        };
      });
    cacheSet(cacheKey, result, 5 * 60_000);
    res.json(result);
  } catch (err) {
    console.error('Spotify playlists exception:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/spotify/playlist/:playlistId/tracks
spotifyRouter.get('/playlist/:playlistId/tracks', requireAuth, async (req: AuthRequest, res: Response) => {
  const { playlistId } = req.params;
  const userId   = req.user!.id;
  const cacheKey = `playlist-tracks:${userId}:${playlistId}`;
  const cached   = cacheGet(cacheKey);
  if (cached) { res.json(cached); return; }

  const mapTrack = (t: SpotifyApiTrack) => ({
    id:         t.id,
    name:       t.name,
    artists:    t.artists.map(a => a.name).join(', '),
    album:      t.album.name,
    albumArt:   t.album.images?.[0]?.url ?? '',
    duration:   t.duration_ms,
    uri:        t.uri,
    isExplicit: t.explicit,
  });

  const parseTrackItems = (items: ({ track: SpotifyApiTrack | null } | null)[]) =>
    items
      .filter((i): i is NonNullable<typeof i> => i !== null && i.track !== null)
      .map(i => mapTrack(i.track!));

  try {
    // 1. Try dedicated /tracks endpoint with user token
    const r = await spotifyFetch(userId, `/playlists/${playlistId}/tracks?limit=100`);
    if (r.ok) {
      const d = await r.json() as { total: number; items: ({ track: SpotifyApiTrack | null } | null)[] };
      const tracks = parseTrackItems(d.items ?? []);
      const result = { total: d.total ?? tracks.length, tracks, source: 'api' };
      cacheSet(cacheKey, result, 2 * 60_000);
      res.json(result);
      return;
    }

    // 2. Try client credentials (works if app has Extended Access)
    const rc = await spotifyFetchPublic(`/playlists/${playlistId}/tracks?limit=100`);
    if (rc.ok) {
      const dc = await rc.json() as { total: number; items: ({ track: SpotifyApiTrack | null } | null)[] };
      const tracks = parseTrackItems(dc.items ?? []);
      const result = { total: dc.total ?? tracks.length, tracks, source: 'api' };
      cacheSet(cacheKey, result, 2 * 60_000);
      res.json(result);
      return;
    }

    // 3. Fallback: recently-played filtered by this playlist's context URI.
    //    Reuse the shared recently-played cache to avoid extra API calls that
    //    burn rate-limit quota. Only fetch fresh if nothing is cached at all.
    type RecentRaw = { played_at: string; context: { type: string; uri: string } | null; track: SpotifyApiTrack }[];
    const recentCacheKey = `recent-raw:${userId}`;
    let recentItems = cacheGetStale<RecentRaw>(recentCacheKey);
    if (!recentItems) {
      const recentRes = await spotifyFetch(userId, '/me/player/recently-played?limit=50');
      if (recentRes.ok) {
        const rd = await recentRes.json() as { items?: RecentRaw };
        recentItems = rd.items ?? [];
        cacheSet(recentCacheKey, recentItems, 5 * 60_000);
      }
    }
    if (recentItems && recentItems.length > 0) {
      const playlistUri = `spotify:playlist:${playlistId}`;
      const seen = new Set<string>();
      const tracks = recentItems
        .filter(i => i.context?.uri === playlistUri && i.track?.id)
        .map(i => mapTrack(i.track))
        .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

      if (tracks.length > 0) {
        const result = { total: tracks.length, tracks, source: 'recently_played' };
        cacheSet(cacheKey, result, 60_000);
        res.json(result);
        return;
      }
    }

    // 4. Nothing worked — Spotify Development Mode is blocking all access.
    res.status(403).json({ error: 'spotify_dev_mode', status: 403 });
  } catch (err) {
    console.error('Spotify playlist tracks exception:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/spotify/liked-songs
spotifyRouter.get('/liked-songs', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId   = req.user!.id;
  const cacheKey = `liked:${userId}`;
  const cached   = cacheGet(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const r = await spotifyFetch(userId, '/me/tracks?limit=50');
    if (r.status === 429) { const stale = cacheGetStale(cacheKey); if (stale) { res.json(stale); return; } res.status(429).json({ error: 'rate_limited' }); return; }
    if (r.status === 403) {
      // Spotify Dev Mode may block library reads — try recently-played as fallback
      console.warn('Spotify liked-songs 403 — falling back to recently-played');
      const recentCacheKey = `recent-raw:${userId}`;
      let recentItems = cacheGetStale<{ track: SpotifyApiTrack }[]>(recentCacheKey);
      if (!recentItems) {
        const rr = await spotifyFetch(userId, '/me/player/recently-played?limit=50');
        if (rr.ok) {
          const rd = await rr.json() as { items?: { track: SpotifyApiTrack }[] };
          recentItems = rd.items ?? [];
          cacheSet(recentCacheKey, recentItems, 5 * 60_000);
        }
      }
      if (recentItems && recentItems.length > 0) {
        const seen = new Set<string>();
        const tracks = recentItems
          .filter(i => i.track?.id && !seen.has(i.track.id) && seen.add(i.track.id))
          .map(i => ({
            id:         i.track.id,
            name:       i.track.name,
            artists:    i.track.artists.map(a => a.name).join(', '),
            album:      i.track.album.name,
            albumArt:   i.track.album.images?.[0]?.url ?? '',
            duration:   i.track.duration_ms,
            uri:        i.track.uri,
            isExplicit: i.track.explicit,
          }));
        const result = { tracks, source: 'recently_played' };
        cacheSet(cacheKey, result, 5 * 60_000);
        res.json(result);
        return;
      }
      res.status(403).json({ error: 'spotify_dev_mode' });
      return;
    }
    if (!r.ok) {
      console.error('Spotify liked-songs error:', r.status);
      res.status(r.status).json({ error: 'Spotify API error' });
      return;
    }
    const d = await r.json() as {
      items: ({ track: SpotifyApiTrack } | null)[];
    };
    const tracks = (d.items ?? [])
      .filter((i): i is NonNullable<typeof i> => i !== null && i.track !== null)
      .map(i => ({
        id:         i.track.id,
        name:       i.track.name,
        artists:    i.track.artists.map(a => a.name).join(', '),
        album:      i.track.album.name,
        albumArt:   i.track.album.images?.[0]?.url ?? '',
        duration:   i.track.duration_ms,
        uri:        i.track.uri,
        isExplicit: i.track.explicit,
      }));
    const result = { tracks, source: 'api' };
    cacheSet(cacheKey, result, 2 * 60_000);
    res.json(result);
  } catch (err) {
    console.error('Spotify liked-songs exception:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/spotify/recent
spotifyRouter.get('/recent', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId   = req.user!.id;
  const cacheKey = `recent:${userId}`;
  const cached   = cacheGet(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const r = await spotifyFetch(userId, '/me/player/recently-played?limit=30');
    if (r.status === 429) {
      const stale = cacheGetStale(cacheKey);
      if (stale) { res.json(stale); return; }
      res.status(429).json({ error: 'rate_limited' }); return;
    }
    if (!r.ok) {
      console.error('Spotify recently-played error:', r.status);
      res.status(r.status).json({ error: 'Spotify API error', status: r.status });
      return;
    }
    const d = await r.json() as {
      items?: {
        played_at: string;
        track:     SpotifyApiTrack | null;
      }[];
    };
    const rawItems = d.items ?? [];
    // Populate the shared raw cache used by the playlist-tracks fallback
    cacheSet(`recent-raw:${userId}`, rawItems, 5 * 60_000);

    const result = rawItems
      .filter(i => i.track?.id)
      .map(i => ({
        playedAt:   i.played_at,
        id:         i.track!.id,
        name:       i.track!.name,
        artists:    i.track!.artists.map(a => a.name).join(', '),
        albumArt:   i.track!.album.images?.[0]?.url ?? '',
        duration:   i.track!.duration_ms,
        uri:        i.track!.uri,
      }));
    cacheSet(cacheKey, result, 5 * 60_000);  // 5 min — recently-played rarely changes
    res.json(result);
  } catch (err) {
    console.error('Spotify recently-played exception:', err);
    const stale = cacheGetStale(cacheKey);
    if (stale) { res.json(stale); return; }
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/spotify/search?q=
spotifyRouter.get('/search', requireAuth, async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string || '').trim();
  if (!q) { res.json({ tracks: [], artists: [], albums: [], playlists: [] }); return; }

  const cacheKey = `search:${req.user!.id}:${q}`;
  const cached   = cacheGet(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    let r = await spotifyFetch(req.user!.id, `/search?q=${encodeURIComponent(q)}&type=track,artist,album,playlist&limit=5`);

    // Spotify Development Mode blocks user tokens from non-approved accounts.
    // The search endpoint is public catalog data, so we can fall back to Client
    // Credentials — this bypasses the dev mode restriction entirely and lets
    // any connected (or even non-connected) user search the Spotify catalog.
    if (!r.ok) {
      console.warn(`Spotify search user-token failed (${r.status}) — falling back to client credentials`);
      r = await spotifyFetchPublic(`/search?q=${encodeURIComponent(q)}&type=track,artist,album,playlist&limit=5`);
    }

    if (!r.ok) {
      console.error('Spotify search error:', r.status, await r.text().catch(() => ''));
      res.status(r.status).json({ error: 'Spotify search API error' });
      return;
    }
    const d = await r.json() as {
      tracks?:    { items: (SpotifyApiTrack | null)[] };
      artists?:   { items: ({ id: string; name: string; images: { url: string }[] } | null)[] };
      albums?:    { items: ({ id: string; name: string; artists: { name: string }[]; images: { url: string }[] } | null)[] };
      playlists?: { items: ({ id: string; name: string; images: { url: string }[]; tracks: { total: number }; owner: { display_name: string } } | null)[] };
    };
    const result = {
      tracks: (d.tracks?.items ?? [])
        .filter((t): t is NonNullable<typeof t> => t !== null)
        .map(t => ({
          id:       t.id,
          name:     t.name,
          artists:  t.artists.map(a => a.name).join(', '),
          album:    t.album.name,
          albumArt: t.album.images?.[0]?.url ?? '',
          duration: t.duration_ms,
          uri:      t.uri,
        })),
      artists: (d.artists?.items ?? [])
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .map(a => ({
          id:    a.id,
          name:  a.name,
          image: a.images?.[0]?.url ?? '',
        })),
      albums: (d.albums?.items ?? [])
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .map(a => ({
          id:      a.id,
          name:    a.name,
          artists: a.artists.map(x => x.name).join(', '),
          image:   a.images?.[0]?.url ?? '',
        })),
      playlists: (d.playlists?.items ?? [])
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map(p => ({
          id:         p.id,
          name:       p.name,
          coverArt:   p.images?.[0]?.url ?? '',
          trackCount: p.tracks?.total ?? 0,
          owner:      p.owner?.display_name ?? '',
        })),
    };
    cacheSet(cacheKey, result, 30_000);
    res.json(result);
  } catch (err) {
    console.error('Spotify search exception:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/spotify/queue
spotifyRouter.post('/queue', requireAuth, async (req: AuthRequest, res: Response) => {
  const { trackUri } = req.body as { trackUri: string };
  try {
    await spotifyFetch(req.user!.id, `/me/player/queue?uri=${encodeURIComponent(trackUri)}`, { method: 'POST' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PUT /api/spotify/save
spotifyRouter.put('/save', requireAuth, async (req: AuthRequest, res: Response) => {
  const { trackId, saved } = req.body as { trackId: string; saved: boolean };
  try {
    await spotifyFetch(req.user!.id, `/me/tracks?ids=${trackId}`, {
      method: saved ? 'PUT' : 'DELETE',
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
