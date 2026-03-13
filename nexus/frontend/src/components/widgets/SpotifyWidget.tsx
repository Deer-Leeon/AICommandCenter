import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiFetch } from '../../lib/api';
import { useWidgetReady } from '../../hooks/useWidgetReady';

// ── Local recently-played history (localStorage) ───────────────────────────────
// We build the recent-tracks list locally from SDK playback events so the Recent
// tab works even when the Spotify API is rate-limited. The list persists across
// page refreshes and is seeded from the API once on first load.

const LOCAL_RECENT_KEY = 'nexus-spotify-recent-v1';
const MAX_LOCAL_RECENT = 50;

interface LocalRecentTrack {
  playedAt: string;
  id:       string;
  name:     string;
  artists:  string;
  albumArt: string;
  duration: number;
  uri:      string;
}

function readLocalRecent(): LocalRecentTrack[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_RECENT_KEY) ?? '[]'); }
  catch { return []; }
}

function writeLocalRecent(tracks: LocalRecentTrack[]): void {
  try { localStorage.setItem(LOCAL_RECENT_KEY, JSON.stringify(tracks.slice(0, MAX_LOCAL_RECENT))); }
  catch { /* storage quota exceeded — ignore */ }
}

function pushLocalRecent(track: LocalRecentTrack): void {
  const existing = readLocalRecent();
  // Don't re-add if the same track was already recorded within the last 30 s
  if (existing[0]?.id === track.id &&
      Date.now() - new Date(existing[0].playedAt).getTime() < 30_000) return;
  writeLocalRecent([track, ...existing.filter(t => t.id !== track.id)]);
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface SpotifyTrack {
  id:         string;
  name:       string;
  artists:    string;
  album:      string;
  albumArt:   string;
  duration:   number;
  uri:        string;
  isExplicit: boolean;
}

interface NowPlaying {
  isPlaying:      boolean;
  noActiveDevice?: boolean;
  progress:       number;
  duration:       number;
  shuffleState:   boolean;
  repeatState:    'off' | 'track' | 'context';
  volume:         number;
  isSaved:        boolean;
  device:         { id: string; name: string; type: string } | null;
  track:          SpotifyTrack | null;
}

interface SpotifyPlaylist {
  id:         string;
  name:       string;
  coverArt:   string;
  trackCount: number;
  owner:      string;
  isPublic?:  boolean;
}

interface SpotifyDevice {
  id:            string;
  name:          string;
  type:          string;
  isActive:      boolean;
  volumePercent: number;
}

interface SearchResults {
  tracks:    (SpotifyTrack & { album: string; albumArt: string })[];
  artists:   { id: string; name: string; image: string }[];
  albums:    { id: string; name: string; artists: string; image: string }[];
  playlists: SpotifyPlaylist[];
}

type Tab = 'now-playing' | 'library' | 'search' | 'recent';
type LayoutTier = 'micro' | 'compact' | 'standard' | 'expanded';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function deviceIcon(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('phone') || t.includes('smartphone')) return '📱';
  if (t.includes('speaker'))                            return '🔊';
  if (t.includes('tv'))                                 return '📺';
  return '💻';
}

async function extractDominantColor(imageUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 40; canvas.height = 40;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve('#1a1a2e'); return; }
        ctx.drawImage(img, 0, 0, 40, 40);
        const data = ctx.getImageData(0, 0, 40, 40).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        resolve(`rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`);
      } catch { resolve('#1a1a2e'); }
    };
    img.onerror = () => resolve('#1a1a2e');
    img.src = imageUrl;
  });
}

const GREEN = '#1db954';
const pill: React.CSSProperties = {
  background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px',
  padding: '5px 12px', cursor: 'pointer', color: 'var(--text)',
  fontFamily: 'inherit', fontSize: '12px', lineHeight: 1,
  display: 'flex', alignItems: 'center', gap: '6px',
};

// ── Main component ─────────────────────────────────────────────────────────────

export function SpotifyWidget({ onClose: _onClose }: { onClose: () => void }) {
  // connection & data
  const [connected,      setConnected]      = useState<boolean | null>(null);
  const [devModeBlocked, setDevModeBlocked] = useState(false); // Spotify dev mode: account not approved
  const [nowPlaying,     setNowPlaying]     = useState<NowPlaying | null>(null);
  const [progress,     setProgress]     = useState(0);
  const [dominantColor, setDominantColor] = useState('');
  const [albumArtKey,  setAlbumArtKey]  = useState(''); // track prev art URL for cross-fade

  // library
  const [activeTab,      setActiveTab]      = useState<Tab>('now-playing');
  const [playlists,             setPlaylists]             = useState<SpotifyPlaylist[]>([]);
  const [openPlaylist,          setOpenPlaylist]          = useState<SpotifyPlaylist | null>(null);
  const [playlistTracks,        setPlaylistTracks]        = useState<SpotifyTrack[]>([]);
  const [playlistTracksLoading, setPlaylistTracksLoading] = useState(false);
  const [playlistTracksError,   setPlaylistTracksError]   = useState<string | null>(null);
  const [playlistTracksPartial, setPlaylistTracksPartial] = useState(false);
  const [libLoading,            setLibLoading]            = useState(false);
  const [libError,              setLibError]              = useState(false);

  // search
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching,     setSearching]     = useState(false);
  const [searchError,   setSearchError]   = useState(false);

  // recent — sourced from localStorage (populated by SDK events + seeded from API)
  const [recent, setRecent] = useState<LocalRecentTrack[]>(() => readLocalRecent());

  // devices
  const [devices,          setDevices]          = useState<SpotifyDevice[]>([]);
  const [showDevicePicker, setShowDevicePicker] = useState(false);

  // Web Playback SDK
  const [sdkDeviceId, setSdkDeviceId] = useState<string | null>(null);
  const [sdkReady,    setSdkReady]    = useState(false);
  const [sdkError,    setSdkError]    = useState<string | null>(null);
  const sdkPlayerRef          = useRef<Spotify.Player | null>(null);
  const sdkScriptRef          = useRef<HTMLScriptElement | null>(null);
  const sdkAutoTransferredRef = useRef(false); // fire auto-transfer only once per mount
  const sdkLastRecordedIdRef  = useRef<string>(''); // avoid duplicate recent entries

  // layout
  const [size, setSize] = useState({ w: 300, h: 300 });
  const wrapperRef          = useRef<HTMLDivElement>(null);
  const pollTimerRef        = useRef<ReturnType<typeof setInterval>>();
  const progTimerRef        = useRef<ReturnType<typeof setInterval>>();
  const searchDebRef        = useRef<ReturnType<typeof setTimeout>>();
  const nowPlayingRef       = useRef<NowPlaying | null>(null);
  const suppressPollUntilRef = useRef(0);
  nowPlayingRef.current = nowPlaying;

  // Layout tier
  const tier: LayoutTier = useMemo(() => {
    const { w, h } = size;
    if (w < 160 || h < 160)               return 'micro';
    if (w < 310 || h < 270)               return 'compact';
    if (w >= 430 && h >= 480)             return 'expanded';
    return 'standard';
  }, [size]);

  const showTabs    = tier !== 'micro';
  const showVolume  = tier !== 'micro';
  const showDevice  = tier !== 'micro';
  const labelTabs   = tier === 'expanded';

  useWidgetReady('spotify', connected !== null);

  // ── ResizeObserver ──────────────────────────────────────────────────────────

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      if (w && h) setSize({ w, h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Spotify Web Playback SDK ─────────────────────────────────────────────────
  // Creates a "NEXUS Player" device in Spotify that plays audio through the browser.
  // Requires Spotify Premium. Falls back gracefully if not available.

  useEffect(() => {
    if (!connected) return;

    // Shared cleanup — always disconnect the player on unmount so that a
    // remount after a drag-and-drop doesn't try to create a second instance
    // while the first one is still live.
    const cleanup = () => {
      sdkPlayerRef.current?.disconnect();
      sdkPlayerRef.current = null;
    };

    // SDK script already loaded from a previous mount — init directly.
    if (sdkScriptRef.current || window.Spotify) {
      initSdkPlayer();
      return cleanup; // ← was missing before; caused remount crashes
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    sdkScriptRef.current = script;

    window.onSpotifyWebPlaybackSDKReady = initSdkPlayer;
    document.head.appendChild(script);

    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  function initSdkPlayer() {
    if (sdkPlayerRef.current) return; // already initialised

    // Guard: SDK Player constructor can throw if the script loaded but the
    // AudioContext is in a bad state (e.g. called too soon after a previous
    // player was disconnected during a drag-and-drop remount).
    let player: Spotify.Player;
    try {
      player = new window.Spotify.Player({
        name: 'NEXUS Player',
        getOAuthToken: async (cb) => {
          try {
            const res = await apiFetch('/api/spotify/token');
            if (!res.ok) return;
            const { token } = await res.json() as { token: string };
            cb(token);
          } catch { /* ignore */ }
        },
        volume: 0.8,
      });
    } catch (err) {
      console.warn('Spotify SDK Player init failed — will retry on next mount:', err);
      setSdkError('init_failed');
      return;
    }

    player.addListener('ready', ({ device_id }) => {
      setSdkDeviceId(device_id);
      setSdkReady(true);
      setSdkError(null);
    });

    player.addListener('not_ready', () => {
      setSdkReady(false);
    });

    player.addListener('initialization_error', ({ message }) => {
      setSdkError(`Init error: ${message}`);
    });

    player.addListener('authentication_error', ({ message }) => {
      setSdkError(`Auth error: ${message}`);
    });

    player.addListener('account_error', () => {
      // Premium required — set a clear message but don't break anything
      setSdkError('premium_required');
    });

    player.addListener('player_state_changed', (state) => {
      if (!state) return;
      // Suppress next poll — SDK state is fresher than API polling
      suppressPollUntilRef.current = Date.now() + 3000;

      // When Spotify transfers playback TO this device from an external source
      // (e.g. the user selects "NEXUS Player" from their phone), the SDK receives
      // the session but the browser's audio context may not activate automatically.
      // Calling resume() guarantees audio actually starts — it's a no-op if already
      // playing and safe to call whenever Spotify says we should be playing.
      if (!state.paused) {
        player.resume().catch(() => {});
      }

      const t = state.track_window.current_track;

      // Record to local recently-played history whenever the track changes
      if (t && t.id && t.id !== sdkLastRecordedIdRef.current) {
        sdkLastRecordedIdRef.current = t.id;
        const entry: LocalRecentTrack = {
          playedAt: new Date().toISOString(),
          id:       t.id,
          name:     t.name,
          artists:  t.artists.map(a => a.name).join(', '),
          albumArt: t.album.images[0]?.url ?? '',
          duration: t.duration_ms,
          uri:      t.uri,
        };
        pushLocalRecent(entry);
        setRecent(readLocalRecent());
      }
      setNowPlaying(prev => prev ? {
        ...prev,
        isPlaying:   !state.paused,
        progress:    state.position,
        duration:    state.duration,
        shuffleState: state.shuffle,
        repeatState: (['off', 'context', 'track'] as const)[state.repeat_mode] ?? 'off',
        device: { id: sdkDeviceId ?? '', name: 'NEXUS Player', type: 'Computer' },
        noActiveDevice: false,
        track: t ? {
          id:         t.id,
          name:       t.name,
          artists:    t.artists.map(a => a.name).join(', '),
          album:      t.album.name,
          albumArt:   t.album.images[0]?.url ?? '',
          duration:   t.duration_ms,
          uri:        t.uri,
          isExplicit: false,
        } : prev.track,
      } : prev);
      setProgress(state.position);
    });

    player.connect();
    sdkPlayerRef.current = player;
  }

  // ── Auto-transfer to NEXUS Player on startup ─────────────────────────────────
  // Fires once when both the SDK device is ready AND we have the first now-playing
  // response. If something is already actively playing on a phone or speaker, we
  // leave it alone. Otherwise we silently set NEXUS Player as the active device so
  // the next Play lands in the browser instead of a stale computer entry.

  useEffect(() => {
    if (!sdkReady || !sdkDeviceId) return;
    if (nowPlaying === null) return;         // wait for first poll result
    if (sdkAutoTransferredRef.current) return; // only once per mount
    sdkAutoTransferredRef.current = true;

    const device = nowPlaying.device;
    const isPlayingOnNonComputer =
      nowPlaying.isPlaying &&
      device &&
      device.type?.toLowerCase() !== 'computer';

    // A phone/speaker is actively playing → don't interrupt
    if (isPlayingOnNonComputer) return;

    // Nothing playing, or the last device was a computer → claim NEXUS Player
    apiFetch('/api/spotify/transfer', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: sdkDeviceId }),
    });
    // Optimistically update the device label immediately
    setNowPlaying(prev => prev ? {
      ...prev,
      device: { id: sdkDeviceId, name: 'NEXUS Player', type: 'Computer' },
    } : prev);
  }, [sdkReady, sdkDeviceId, nowPlaying]);

  // ── Polling ─────────────────────────────────────────────────────────────────

  const fetchNowPlaying = useCallback(async () => {
    if (Date.now() < suppressPollUntilRef.current) return;
    try {
      const res = await apiFetch('/api/spotify/now-playing');
      if (res.status === 403) {
        try {
          const body = await res.json() as { error?: string };
          if (body.error === 'spotify_dev_mode') setDevModeBlocked(true);
        } catch { /* ignore */ }
        return;
      }
      if (!res.ok) return;
      setDevModeBlocked(false);
      const data = await res.json() as NowPlaying;
      setNowPlaying(data);
      setProgress(data.progress ?? 0);
    } catch { /* ignore */ }
  }, []);

  const checkConnected = useCallback(async () => {
    try {
      const res = await apiFetch('/api/spotify/status');
      if (!res.ok) { setConnected(false); return; }
      const { connected: c } = await res.json() as { connected: boolean };
      setConnected(c);
      if (c) fetchNowPlaying();
    } catch { setConnected(false); }
  }, [fetchNowPlaying]);

  useEffect(() => { checkConnected(); }, [checkConnected]);

  useEffect(() => {
    if (!connected) return;
    const interval = document.hidden ? 30_000 : 5_000;
    pollTimerRef.current = setInterval(fetchNowPlaying, interval);
    const handleVisibility = () => {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(fetchNowPlaying, document.hidden ? 30_000 : 5_000);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(pollTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [connected, fetchNowPlaying]);

  // Local progress increment
  useEffect(() => {
    clearInterval(progTimerRef.current);
    if (!nowPlaying?.isPlaying) return;
    progTimerRef.current = setInterval(() => {
      setProgress(p => Math.min(p + 1000, nowPlaying.duration));
    }, 1000);
    return () => clearInterval(progTimerRef.current);
  }, [nowPlaying?.isPlaying, nowPlaying?.duration]);

  // Album art color extraction
  useEffect(() => {
    const art = nowPlaying?.track?.albumArt;
    if (!art || art === albumArtKey) return;
    setAlbumArtKey(art);
    extractDominantColor(art).then(setDominantColor);
  }, [nowPlaying?.track?.albumArt, albumArtKey]);

  // ── Controls ────────────────────────────────────────────────────────────────

  const optimistic = useCallback((patch: Partial<NowPlaying>) => {
    setNowPlaying(prev => prev ? { ...prev, ...patch } : prev);
    // Suppress API polls for 2.5s so Spotify has time to process the command
    // before we sync — prevents the API overriding the optimistic state
    suppressPollUntilRef.current = Date.now() + 2500;
    setTimeout(fetchNowPlaying, 2500);
  }, [fetchNowPlaying]);

  const handlePlay = useCallback(async (trackUri?: string, contextUri?: string) => {
    optimistic({ isPlaying: true, noActiveDevice: false });

    // Prefer the in-browser NEXUS Player when no device is active — instant playback
    let deviceId: string | undefined;
    if (nowPlaying?.noActiveDevice || !nowPlaying?.device) {
      if (sdkReady && sdkDeviceId) {
        deviceId = sdkDeviceId;
      } else {
        try {
          const devRes = await apiFetch('/api/spotify/devices');
          if (devRes.ok) {
            const devList = await devRes.json() as { id: string; isActive: boolean }[];
            const target = devList.find(d => d.isActive) ?? devList[0];
            if (target) deviceId = target.id;
          }
        } catch { /* ignore */ }
      }
    }

    await apiFetch('/api/spotify/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackUri, contextUri, deviceId }),
    });
    setTimeout(fetchNowPlaying, 1000);
  }, [optimistic, nowPlaying?.noActiveDevice, nowPlaying?.device, fetchNowPlaying, sdkReady, sdkDeviceId]);

  const handlePause = useCallback(async () => {
    optimistic({ isPlaying: false });
    await apiFetch('/api/spotify/pause', { method: 'POST' });
  }, [optimistic]);

  const handleNext = useCallback(async () => {
    await apiFetch('/api/spotify/next', { method: 'POST' });
    setTimeout(fetchNowPlaying, 500);
  }, [fetchNowPlaying]);

  const handlePrev = useCallback(async () => {
    await apiFetch('/api/spotify/previous', { method: 'POST' });
    setTimeout(fetchNowPlaying, 500);
  }, [fetchNowPlaying]);

  const handleSeek = useCallback(async (positionMs: number) => {
    setProgress(positionMs);
    await apiFetch('/api/spotify/seek', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionMs }),
    });
  }, []);

  const handleVolume = useCallback(async (volumePercent: number) => {
    optimistic({ volume: volumePercent });
    await apiFetch('/api/spotify/volume', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volumePercent }),
    });
  }, [optimistic]);

  const handleShuffle = useCallback(async () => {
    const next = !nowPlayingRef.current?.shuffleState;
    optimistic({ shuffleState: next });
    await apiFetch('/api/spotify/shuffle', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: next }),
    });
  }, [optimistic]);

  const handleRepeat = useCallback(async () => {
    const cur = nowPlayingRef.current?.repeatState ?? 'off';
    const next = cur === 'off' ? 'context' : cur === 'context' ? 'track' : 'off';
    optimistic({ repeatState: next });
    await apiFetch('/api/spotify/repeat', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: next }),
    });
  }, [optimistic]);

  const handleSave = useCallback(async () => {
    if (!nowPlayingRef.current?.track) return;
    const next = !nowPlayingRef.current.isSaved;
    optimistic({ isSaved: next });
    await apiFetch('/api/spotify/save', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: nowPlayingRef.current.track.id, saved: next }),
    });
  }, [optimistic]);

  const handleTransfer = useCallback(async (deviceId: string) => {
    setShowDevicePicker(false);
    // If transferring to the NEXUS Player, use the SDK directly
    if (deviceId === sdkDeviceId && sdkPlayerRef.current) {
      await sdkPlayerRef.current.resume().catch(() => {});
    }
    await apiFetch('/api/spotify/transfer', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, play: true }),
    });
    setTimeout(fetchNowPlaying, 1000);
  }, [fetchNowPlaying, sdkDeviceId]);

  // Resume on the last known / first available device when no active device.
  // Prefers the NEXUS Player (browser) so music starts immediately.
  const handleResume = useCallback(async () => {
    // If the SDK player is ready, transfer to it first — instant in-browser playback
    if (sdkReady && sdkDeviceId) {
      setNowPlaying(prev => prev ? {
        ...prev, noActiveDevice: false, isPlaying: true,
        device: { id: sdkDeviceId, name: 'NEXUS Player', type: 'Computer' },
      } : prev);
      suppressPollUntilRef.current = Date.now() + 3000;
      await apiFetch('/api/spotify/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: sdkDeviceId }),
      });
      return;
    }
    const devRes = await apiFetch('/api/spotify/devices');
    if (!devRes.ok) return;
    const devs = await devRes.json() as SpotifyDevice[];
    const target = devs.find(d => d.isActive) ?? devs[0];
    if (!target) return;
    // Optimistically clear noActiveDevice so the UI switches immediately
    setNowPlaying(prev => prev ? { ...prev, noActiveDevice: false, isPlaying: true, device: target } : prev);
    suppressPollUntilRef.current = Date.now() + 3000;
    await apiFetch('/api/spotify/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: target.id }),
    });
    setTimeout(fetchNowPlaying, 3000);
  }, [fetchNowPlaying]);

  const loadDevices = useCallback(async () => {
    const res = await apiFetch('/api/spotify/devices');
    if (res.ok) setDevices(await res.json() as SpotifyDevice[]);
    setShowDevicePicker(true);
  }, []);

  // ── Library loading ─────────────────────────────────────────────────────────

  const loadLibrary = useCallback(async () => {
    setLibLoading(true);
    setLibError(false);
    try {
      const plRes = await apiFetch('/api/spotify/playlists');
      if (plRes.ok) {
        setPlaylists(await plRes.json() as SpotifyPlaylist[]);
      } else {
        if (plRes.status === 403) {
          try {
            const body = await plRes.json() as { error?: string };
            if (body.error === 'spotify_dev_mode') setDevModeBlocked(true);
          } catch { /* ignore */ }
        }
        setLibError(true);
      }
    } catch { setLibError(true); }
    finally { setLibLoading(false); }
  }, []);

  const loadPlaylistTracks = useCallback(async (pl: SpotifyPlaylist) => {
    setOpenPlaylist(pl);
    setPlaylistTracks([]);
    setPlaylistTracksError(null);
    setPlaylistTracksPartial(false);
    setPlaylistTracksLoading(true);
    try {
      const res = await apiFetch(`/api/spotify/playlist/${pl.id}/tracks`);
      if (res.ok) {
        const data = await res.json() as { total: number; tracks: SpotifyTrack[]; source?: string };
        setPlaylists(prev => prev.map(p => p.id === pl.id ? { ...p, trackCount: data.total } : p));
        setOpenPlaylist(prev => prev ? { ...prev, trackCount: data.total } : prev);
        setPlaylistTracks(data.tracks);
        setPlaylistTracksPartial(data.source === 'recently_played');
      } else {
        try {
          const body = await res.json() as { error?: string };
          setPlaylistTracksError(body.error === 'private_playlist' ? 'private' : 'dev_mode');
        } catch {
          setPlaylistTracksError('dev_mode');
        }
      }
    } catch {
      setPlaylistTracksError('dev_mode');
    } finally {
      setPlaylistTracksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'library' && playlists.length === 0 && !libError && connected) {
      loadLibrary();
    }
  }, [activeTab, playlists.length, libError, connected, loadLibrary]);

  // ── Search ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    clearTimeout(searchDebRef.current);
    if (!searchQuery.trim()) { setSearchResults(null); setSearchError(false); return; }
    searchDebRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const res = await apiFetch(`/api/spotify/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) setSearchResults(await res.json() as SearchResults);
        else        setSearchError(true);
      } catch { setSearchError(true); }
      finally { setSearching(false); }
    }, 300);
  }, [searchQuery]);

  // ── Recent — seed from API once, then rely on localStorage + SDK events ────────
  // We only call the API once per session to backfill history from before this
  // page load. After that, the SDK's player_state_changed events keep the list
  // current with zero additional API calls.
  const recentSeededRef = useRef(false);

  useEffect(() => {
    if (!connected || recentSeededRef.current) return;
    recentSeededRef.current = true;

    apiFetch('/api/spotify/recent')
      .then(async r => {
        if (!r.ok) return; // silently ignore — localStorage data is shown already
        const apiItems = await r.json() as { playedAt: string; id: string; name: string; artists: string; albumArt: string; duration: number; uri: string }[];
        if (!Array.isArray(apiItems) || apiItems.length === 0) return;

        // Merge API results into localStorage without overwriting more-recent SDK entries
        const local = readLocalRecent();
        const localIds = new Set(local.map(t => t.id));
        const merged = [...local];
        for (const item of apiItems) {
          if (!localIds.has(item.id)) {
            merged.push({ ...item });
            localIds.add(item.id);
          }
        }
        // Sort by playedAt descending
        merged.sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());
        writeLocalRecent(merged);
        setRecent(readLocalRecent());
      })
      .catch(() => { /* silently ignore — localStorage still shows */ });
  }, [connected]);

  // ── Connect handler (from not-connected state) ───────────────────────────────

  const handleConnect = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/spotify/initiate', { method: 'POST' });
      if (!res.ok) return;
      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch { /* ignore */ }
  }, []);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const np = nowPlaying;
  const track = np?.track;

  const ctrlBtn = (
    onClick: () => void,
    content: React.ReactNode,
    active = false,
    large = false,
    badge?: string,
  ) => (
    <button
      onClick={onClick}
      style={{
        background:  large ? 'rgba(255,255,255,0.95)' : 'transparent',
        border:      'none',
        color:       active ? GREEN : large ? '#000' : 'var(--text-muted)',
        cursor:      'pointer',
        borderRadius: large ? '50%' : '6px',
        width:       large ? (tier === 'compact' ? 36 : 44) : (tier === 'compact' ? 26 : 32),
        height:      large ? (tier === 'compact' ? 36 : 44) : (tier === 'compact' ? 26 : 32),
        fontSize:    large ? (tier === 'compact' ? 17 : 20) : (tier === 'compact' ? 13 : 16),
        display:     'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink:  0,
        position:    'relative',
        transition:  'transform 0.1s',
        boxShadow:   large && np?.isPlaying ? `0 0 16px ${GREEN}55` : 'none',
      }}
      onMouseDown={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.94)'; }}
      onMouseUp={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
    >
      {content}
      {badge && (
        <span style={{
          position: 'absolute', top: -2, right: -2,
          background: GREEN, color: '#000', borderRadius: '50%',
          width: 12, height: 12, fontSize: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700,
        }}>{badge}</span>
      )}
    </button>
  );

  // ── Not connected ────────────────────────────────────────────────────────────

  if (connected === false) {
    return (
      <div ref={wrapperRef} style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        background: 'var(--surface)', padding: 20, boxSizing: 'border-box',
        textAlign: 'center',
      }}>
        <svg viewBox="0 0 496 512" width={52} height={52} xmlns="http://www.w3.org/2000/svg">
          <path fill="#1DB954" d="M248 8C111.1 8 0 119.1 0 256s111.1 248 248 248 248-111.1 248-248S384.9 8 248 8zm100.7 364.9c-4.2 0-6.8-1.3-10.7-3.6-62.4-37.6-135-39.2-206.7-24.5-3.9 1-9 2.6-11.9 2.6-9.7 0-15.8-7.7-15.8-15.8 0-10.3 6.1-15.2 13.6-16.8 81.9-18.1 165.6-16.5 237 26.2 6.1 3.9 9.7 7.4 9.7 16.5s-7.1 15.4-15.2 15.4zm26.9-65.6c-5.2 0-8.7-2.3-12.3-4.2-62.5-37-155.7-51.9-238.6-29.4-4.8 1.3-7.4 2.6-11.9 2.6-10.7 0-19.4-8.7-19.4-19.4s5.2-17.8 15.5-20.7c27.8-7.8 56.2-13.6 97.8-13.6 64.9 0 127.6 16.1 177 45.5 8.1 4.8 11.3 11 11.3 19.7-.1 10.8-8.5 19.5-19.4 19.5zm31-76.2c-5.2 0-8.4-1.3-12.9-3.9-71.2-42.5-198.5-52.7-280.9-29.7-3.9 1-6.1 2.6-10.3 2.6-13.5 0-23.5-10-23.5-23.5s6.8-21.9 17.8-24.8c33.2-9.3 71.6-14.6 114.1-14.6 78.8 0 155.4 18.5 212.9 52.7 8.4 4.9 12.9 11 12.9 22.5-.1 13.5-10.1 23.5-20.1 23.7z"/>
        </svg>
        <div>
          <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 15, margin: '0 0 4px' }}>Connect Spotify</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>Control your music from NEXUS</p>
        </div>
        <button onClick={handleConnect} style={{
          background: GREEN, color: '#000', border: 'none',
          borderRadius: 20, padding: '9px 22px',
          fontWeight: 700, fontSize: 13, cursor: 'pointer',
          transition: 'filter 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.1)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = 'none'; }}
        >
          Connect
        </button>
      </div>
    );
  }

  if (connected === null) {
    return <div ref={wrapperRef} style={{ width: '100%', height: '100%', background: 'var(--surface)' }} />;
  }

  // ── Micro layout ─────────────────────────────────────────────────────────────

  if (tier === 'micro') {
    return (
      <div ref={wrapperRef} style={{
        position: 'relative', width: '100%', height: '100%',
        overflow: 'hidden', borderRadius: 'inherit',
      }}>
        {track?.albumArt ? (
          <img src={track.albumArt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#111' }} />
        )}
        {dominantColor && (
          <div style={{
            position: 'absolute', inset: 0,
            background: `radial-gradient(circle at center, ${dominantColor}30 0%, transparent 70%)`,
          }} />
        )}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: 0, transition: 'opacity 0.2s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
        >
          {ctrlBtn(np?.isPlaying ? handlePause : () => handlePlay(), np?.isPlaying ? '⏸' : '▶', false, true)}
        </div>
      </div>
    );
  }

  // ── Track row (used in library / search / recent lists) ─────────────────────

  const TrackRow = ({
    track: t, index, onPlay, playingUri,
  }: { track: SpotifyTrack; index: number; onPlay: (uri: string) => void; playingUri?: string }) => {
    const isActive = t.uri === playingUri && np?.isPlaying;
    return (
      <div
        onClick={() => onPlay(t.uri)}
        style={{
          display: 'grid', gridTemplateColumns: '24px 1fr auto auto',
          alignItems: 'center', gap: 8,
          padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
          background: isActive ? 'rgba(29,185,84,0.08)' : 'transparent',
          borderLeft: isActive ? `2px solid ${GREEN}` : '2px solid transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span style={{ color: isActive ? GREEN : 'var(--text-faint)', fontSize: 11, textAlign: 'center' }}>
          {isActive ? '♪' : index + 1}
        </span>
        <div style={{ minWidth: 0 }}>
          <p style={{
            margin: 0, fontSize: 12, fontWeight: 600,
            color: isActive ? GREEN : 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{t.name}</p>
          <p style={{
            margin: 0, fontSize: 11, color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{t.artists}</p>
        </div>
        <span style={{ color: 'var(--text-faint)', fontSize: 10, fontFamily: 'monospace' }}>
          {fmtMs(t.duration)}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onPlay(t.uri); }}
          style={{
            background: 'none', border: `1px solid ${isActive ? GREEN : 'var(--border)'}`,
            borderRadius: '50%', width: 22, height: 22, display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            color: isActive ? GREEN : 'var(--text-muted)', fontSize: 8, flexShrink: 0, padding: 0,
          }}
        >▶</button>
      </div>
    );
  };

  // ── Now Playing content ───────────────────────────────────────────────────────

  // Defined as a plain function (not a React component) so React does NOT
  // unmount/remount the subtree on every parent render (which would retrigger
  // the album art fade animation every second via the progress interval).
  const renderNowPlaying = () => {
    // Spotify Development Mode: account not in the approved 25-user list.
    // Show a clear explanation instead of the generic "no device" placeholder.
    if (devModeBlocked) {
      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '0 12px',
        }}>
          <span style={{ fontSize: 28 }}>🔒</span>
          <p style={{
            color: 'var(--text)', fontWeight: 700, fontSize: 13,
            textAlign: 'center', margin: 0,
          }}>
            Account not approved
          </p>
          <p style={{
            color: 'var(--text-muted)', fontSize: 11, textAlign: 'center',
            margin: 0, lineHeight: 1.5,
          }}>
            This Spotify app is in Development Mode. Ask the app owner to add your
            Spotify email as a test user in the{' '}
            <a
              href="https://developer.spotify.com/dashboard"
              target="_blank"
              rel="noreferrer"
              style={{ color: '#1db954', textDecoration: 'underline' }}
            >
              Spotify Dashboard
            </a>
            .
          </p>
        </div>
      );
    }

    if (!np || np.noActiveDevice || !track) {
      const isNoDevice = np?.noActiveDevice;
      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 10,
        }}>
          <svg viewBox="0 0 496 512" width={36} height={36} xmlns="http://www.w3.org/2000/svg"
            style={{ opacity: 0.5, animation: 'nexusFade 2s ease-in-out infinite alternate' }}>
            <path fill="#1DB954" d="M248 8C111.1 8 0 119.1 0 256s111.1 248 248 248 248-111.1 248-248S384.9 8 248 8zm100.7 364.9c-4.2 0-6.8-1.3-10.7-3.6-62.4-37.6-135-39.2-206.7-24.5-3.9 1-9 2.6-11.9 2.6-9.7 0-15.8-7.7-15.8-15.8 0-10.3 6.1-15.2 13.6-16.8 81.9-18.1 165.6-16.5 237 26.2 6.1 3.9 9.7 7.4 9.7 16.5s-7.1 15.4-15.2 15.4zm26.9-65.6c-5.2 0-8.7-2.3-12.3-4.2-62.5-37-155.7-51.9-238.6-29.4-4.8 1.3-7.4 2.6-11.9 2.6-10.7 0-19.4-8.7-19.4-19.4s5.2-17.8 15.5-20.7c27.8-7.8 56.2-13.6 97.8-13.6 64.9 0 127.6 16.1 177 45.5 8.1 4.8 11.3 11 11.3 19.7-.1 10.8-8.5 19.5-19.4 19.5zm31-76.2c-5.2 0-8.4-1.3-12.9-3.9-71.2-42.5-198.5-52.7-280.9-29.7-3.9 1-6.1 2.6-10.3 2.6-13.5 0-23.5-10-23.5-23.5s6.8-21.9 17.8-24.8c33.2-9.3 71.6-14.6 114.1-14.6 78.8 0 155.4 18.5 212.9 52.7 8.4 4.9 12.9 11 12.9 22.5-.1 13.5-10.1 23.5-20.1 23.7z"/>
          </svg>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', margin: 0 }}>
            {isNoDevice ? 'No active device' : 'Open Spotify on any device to start listening'}
          </p>
          {isNoDevice && (
            <button
              onClick={handleResume}
              style={{
                background: GREEN, color: '#000', border: 'none',
                borderRadius: 20, padding: '7px 18px',
                fontWeight: 700, fontSize: 12, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'filter 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.1)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = 'none'; }}
            >
              ▶ Resume
            </button>
          )}
        </div>
      );
    }

    const pct = np.duration > 0 ? (progress / np.duration) * 100 : 0;

    return (
      <>
        {/* Album art is rendered in the outer wrapper (full-width, 1:1) for standard/expanded,
            and in the compact container for compact. Nothing to render here. */}

        {/* Track info + heart */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 6,
          width: '100%', minWidth: 0,
          padding: tier === 'compact' ? '0' : '0 4px',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              margin: 0, fontWeight: 700, fontSize: tier === 'compact' ? 12 : 14,
              color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{track.name}</p>
            <p style={{
              margin: '2px 0 0', fontSize: tier === 'compact' ? 11 : 12,
              color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{track.artists}</p>
          </div>
          <button onClick={handleSave} style={{
            background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
            color: np.isSaved ? GREEN : 'var(--text-faint)',
            fontSize: 16, lineHeight: 1, padding: '2px',
            transition: 'color 0.2s',
          }}>
            {np.isSaved ? '♥' : '♡'}
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ width: '100%', padding: tier === 'compact' ? '0' : '0 4px' }}>
          <div
            style={{ width: '100%', height: 3, background: 'var(--border)', borderRadius: 2, cursor: 'pointer', position: 'relative' }}
            onClick={e => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              handleSeek(((e.clientX - rect.left) / rect.width) * np.duration);
            }}
          >
            <div style={{ width: `${pct}%`, height: '100%', background: GREEN, borderRadius: 2, transition: 'width 0.3s linear' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'monospace' }}>{fmtMs(progress)}</span>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'monospace' }}>-{fmtMs(np.duration - progress)}</span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: tier === 'compact' ? 2 : 8, width: '100%' }}>
          {ctrlBtn(handleShuffle, '⇄', np.shuffleState)}
          {ctrlBtn(handlePrev, '⏮')}
          {ctrlBtn(np.isPlaying ? handlePause : () => handlePlay(), np.isPlaying ? '⏸' : '▶', false, true)}
          {ctrlBtn(handleNext, '⏭')}
          {ctrlBtn(handleRepeat, '↺', np.repeatState !== 'off', false, np.repeatState === 'track' ? '1' : undefined)}
        </div>

        {/* Volume */}
        {showVolume && (
          <div style={{ display: 'flex', alignItems: 'center', gap: tier === 'compact' ? 4 : 8, width: '100%', padding: '0 4px' }}>
            <button onClick={() => handleVolume(np.volume > 0 ? 0 : 50)} style={{
              background: 'none', border: 'none', color: 'var(--text-faint)',
              cursor: 'pointer', fontSize: 14, padding: 0, flexShrink: 0,
            }}>
              {np.volume === 0 ? '🔇' : np.volume < 50 ? '🔉' : '🔊'}
            </button>
            <div
              style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2, cursor: 'pointer' }}
              onClick={e => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                handleVolume(Math.round(((e.clientX - rect.left) / rect.width) * 100));
              }}
            >
              <div style={{ width: `${np.volume}%`, height: '100%', background: GREEN, borderRadius: 2 }} />
            </div>
          </div>
        )}

        {/* Device indicator — marginTop: auto pins it to the bottom of the controls area */}
        {showDevice && np.device && (
          <div style={{ position: 'relative', width: '100%', padding: '0 4px', marginTop: 'auto' }}>
            <button
              onClick={loadDevices}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-faint)', fontSize: 11, padding: 0,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span>{(np.device.id === sdkDeviceId || np.device.name === 'NEXUS Player') ? '🌐' : deviceIcon(np.device.type)}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(np.device.id === sdkDeviceId || np.device.name === 'NEXUS Player') ? 'Playing in NEXUS' : `Listening on ${np.device.name}`}
              </span>
            </button>

            {showDevicePicker && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, zIndex: 10,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, padding: 8, minWidth: 200,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                <p style={{ margin: '0 0 6px 4px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                  Connect to a device
                </p>
                {/* NEXUS Player — in-browser playback via Web Playback SDK */}
                {sdkDeviceId && sdkError !== 'premium_required' && (
                  <button
                    onClick={() => handleTransfer(sdkDeviceId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%',
                      background: np.device?.id === sdkDeviceId ? 'rgba(29,185,84,0.1)' : 'rgba(29,185,84,0.05)',
                      border: '1px solid rgba(29,185,84,0.3)', borderRadius: 6, padding: '6px 8px',
                      color: np.device?.id === sdkDeviceId ? GREEN : 'var(--text)', cursor: 'pointer', textAlign: 'left',
                      marginBottom: 4,
                    }}
                  >
                    <span>🌐</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>NEXUS Player</span>
                      <span style={{ fontSize: 10, color: 'var(--text-faint)', display: 'block' }}>Play in this browser tab</span>
                    </div>
                    {np.device?.id === sdkDeviceId && <span style={{ fontSize: 10, color: GREEN }}>✓</span>}
                    {sdkReady && np.device?.id !== sdkDeviceId && <span style={{ fontSize: 10, color: GREEN }}>●</span>}
                  </button>
                )}
                {devices
                  // Hide all Computer-type devices — NEXUS Player is the browser option,
                  // and desktop Spotify apps shouldn't be shown when they can't play.
                  .filter(d => d.type.toLowerCase() !== 'computer')
                  .map(d => (
                  <button
                    key={d.id}
                    onClick={() => handleTransfer(d.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', background: d.isActive ? 'rgba(29,185,84,0.1)' : 'none',
                      border: 'none', borderRadius: 6, padding: '6px 8px',
                      color: d.isActive ? GREEN : 'var(--text)', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span>{deviceIcon(d.type)}</span>
                    <span style={{ fontSize: 12, flex: 1 }}>{d.name}</span>
                    {d.isActive && <span style={{ fontSize: 10, color: GREEN }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  };  // end renderNowPlaying

  // ── Library tab ───────────────────────────────────────────────────────────────

  const renderLibrary = () => {
    if (libLoading) return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, fontFamily: 'monospace' }} className="animate-pulse">Loading…</p>
      </div>
    );

    if (libError) return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 12px' }}>
        {devModeBlocked ? (
          <>
            <span style={{ fontSize: 22 }}>🔒</span>
            <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: 12, textAlign: 'center', margin: 0 }}>Account not approved</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
              Ask the app owner to add your Spotify email in the{' '}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer"
                style={{ color: '#1db954' }}>Spotify Dashboard</a>.
            </p>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: 0 }}>Could not load library</p>
            <button onClick={() => { setLibError(false); loadLibrary(); }} style={{
              background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text)', fontSize: 11, padding: '4px 12px', cursor: 'pointer',
            }}>Retry</button>
          </>
        )}
      </div>
    );

    if (openPlaylist) return (
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
          <button onClick={() => setOpenPlaylist(null)} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: 0,
          }}>←</button>
          {openPlaylist.coverArt && (
            <img src={openPlaylist.coverArt} style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover' }} />
          )}
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {openPlaylist.name}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)' }}>
              {playlistTracksLoading ? '…' : `${openPlaylist.trackCount || playlistTracks.length} tracks`}
            </p>
          </div>
          <button onClick={() => handlePlay(undefined, `spotify:playlist:${openPlaylist.id}`)} style={{
            ...pill, marginLeft: 'auto', background: GREEN, color: '#000', border: 'none', fontWeight: 700,
          }}>▶ Play</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {playlistTracksLoading && (
            <p style={{ color: 'var(--text-faint)', fontSize: 12, padding: 8, fontFamily: 'monospace' }} className="animate-pulse">Loading tracks…</p>
          )}
          {!playlistTracksLoading && playlistTracksPartial && playlistTracks.length > 0 && (
            <div style={{ padding: '6px 8px', marginBottom: 4, background: 'rgba(29,185,84,0.08)', borderRadius: 6, border: '1px solid rgba(29,185,84,0.2)' }}>
              <p style={{ margin: 0, fontSize: 11, color: '#1db954', lineHeight: 1.4 }}>
                🕐 Showing recently played tracks only.{' '}
                <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer"
                  style={{ color: '#1db954', fontWeight: 700 }}>Apply for Extended Access</a> to unlock full playlists.
              </p>
            </div>
          )}
          {!playlistTracksLoading && playlistTracksError === 'private' && (
            <p style={{ color: 'var(--text-faint)', fontSize: 12, padding: 12, textAlign: 'center', lineHeight: 1.5 }}>
              🔒 This playlist is private. You can still play it, but track listing requires Extended Access.
            </p>
          )}
          {!playlistTracksLoading && playlistTracksError === 'dev_mode' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                <b style={{ color: 'var(--text)' }}>Playlist tracks can't be loaded here.</b> Spotify restricts third-party apps from reading playlist contents — to browse or edit a playlist, open it in the Spotify app or on your phone.
              </p>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.6 }}>
                You can still <b style={{ color: 'var(--text)' }}>play this playlist</b> using the Play button above — the tracks just can't be listed.
              </p>
              <a href="https://open.spotify.com" target="_blank" rel="noreferrer" style={{
                background: '#1db954', borderRadius: 20, color: '#000', fontSize: 11, fontWeight: 700,
                padding: '6px 14px', cursor: 'pointer', textDecoration: 'none', display: 'inline-block', alignSelf: 'flex-start',
              }}>Open Spotify App →</a>
            </div>
          )}
          {!playlistTracksLoading && !playlistTracksError && playlistTracks.map((t, i) => (
            <TrackRow
              key={t.id + i}
              track={t} index={i}
              onPlay={() => handlePlay(t.uri, `spotify:playlist:${openPlaylist.id}`)}
              playingUri={np?.track?.uri}
            />
          ))}
        </div>
      </div>
    );

    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {playlists.map(pl => (
          <div
            key={pl.id}
            onClick={() => loadPlaylistTracks(pl)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <img src={pl.coverArt || 'data:image/svg+xml,<svg/>'} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover', flexShrink: 0, background: 'var(--surface2)' }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.name}</p>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)' }}>{pl.isPublic === false ? '🔒 ' : ''}{pl.trackCount > 0 ? `${pl.trackCount} tracks · ` : ''}{pl.owner}</p>
            </div>
            <button
              onClick={e => { e.stopPropagation(); handlePlay(undefined, `spotify:playlist:${pl.id}`); }}
              style={{
                background: GREEN, border: 'none', borderRadius: 20,
                color: '#000', fontSize: 11, fontWeight: 700, padding: '4px 10px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
              }}
            >▶ Play</button>
          </div>
        ))}
      </div>
    );
  };

  // ── Search tab ────────────────────────────────────────────────────────────────

  const renderSearch = () => (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        autoFocus
        type="text"
        placeholder="Search songs, artists, albums…"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        style={{
          background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 12px', color: 'var(--text)', fontSize: 13, outline: 'none', width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {searching && <p style={{ color: 'var(--text-faint)', fontSize: 12, padding: '8px', fontFamily: 'monospace' }} className="animate-pulse">Searching…</p>}
        {searchError && !searching && (
          <p style={{ color: 'var(--text-faint)', fontSize: 12, padding: '8px', textAlign: 'center' }}>Search failed — try again</p>
        )}
        {searchResults && !searchError && (
          <>
            {searchResults.tracks.length > 0 && (
              <>
                <p style={{ margin: '4px 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Tracks</p>
                {searchResults.tracks.map((t, i) => (
                  <TrackRow key={t.id} track={{ ...t, album: t.album, albumArt: t.albumArt, isExplicit: false }} index={i}
                    onPlay={uri => handlePlay(uri)} playingUri={np?.track?.uri} />
                ))}
              </>
            )}
            {searchResults.playlists.length > 0 && (
              <>
                <p style={{ margin: '8px 8px 4px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Playlists</p>
                {searchResults.playlists.map(pl => (
                  <div
                    key={pl.id}
                    onClick={() => loadPlaylistTracks(pl)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    {pl.coverArt && <img src={pl.coverArt} style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.name}</p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-faint)' }}>{pl.trackCount > 0 ? `${pl.trackCount} tracks` : pl.owner}</p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handlePlay(undefined, `spotify:playlist:${pl.id}`); }}
                      style={{
                        background: GREEN, border: 'none', borderRadius: 20,
                        color: '#000', fontSize: 11, fontWeight: 700, padding: '4px 10px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                      }}
                    >▶ Play</button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );

  // ── Recent tab ────────────────────────────────────────────────────────────────
  // Data comes from localStorage (populated by SDK events + seeded from API).
  // No loading state: if localStorage is empty we show a friendly hint.

  const renderRecent = () => (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {recent.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 12 }}>
            No history yet — start playing and tracks will appear here instantly.
          </p>
        </div>
      )}
      {recent.map((item, i) => {
        const isActive = item.uri === np?.track?.uri && np?.isPlaying;
        return (
          <div
            key={item.id + i}
            onClick={() => handlePlay(item.uri)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
              background: isActive ? 'rgba(29,185,84,0.08)' : 'transparent',
              borderLeft: isActive ? `2px solid ${GREEN}` : '2px solid transparent',
            }}
            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface2)'; }}
            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            {item.albumArt && <img src={item.albumArt} style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: isActive ? GREEN : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</p>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.artists}</p>
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'monospace', flexShrink: 0 }}>{timeAgo(item.playedAt)}</span>
            <button
              onClick={e => { e.stopPropagation(); handlePlay(item.uri); }}
              style={{
                background: 'none', border: `1px solid ${isActive ? GREEN : 'var(--border)'}`,
                borderRadius: '50%', width: 22, height: 22, display: 'flex',
                alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                color: isActive ? GREEN : 'var(--text-muted)', fontSize: 8, flexShrink: 0, padding: 0,
              }}
            >▶</button>
          </div>
        );
      })}
    </div>
  );

  // ── Shared tab bar definition ─────────────────────────────────────────────────

  const TABS: { id: Tab; icon: string; label: string }[] = [
    { id: 'now-playing', icon: '🎵', label: 'Now Playing' },
    { id: 'library',     icon: '📚', label: 'Library'     },
    { id: 'search',      icon: '🔍', label: 'Search'      },
    { id: 'recent',      icon: '🕐', label: 'Recent'      },
  ];

  const renderTabBar = (height = 36) => (
    <div style={{
      display: 'flex', height, flexShrink: 0,
      borderTop: '1px solid var(--border)', background: 'var(--surface)',
    }}>
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={e => { e.stopPropagation(); setActiveTab(t.id); }}
          style={{
            flex: 1, background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            color: activeTab === t.id ? 'var(--text)' : 'var(--text-faint)',
            fontSize: activeTab === t.id ? 14 : 13,
            transition: 'color 0.15s', padding: 0,
          }}
        >
          <span>{t.icon}</span>
          {labelTabs && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em' }}>{t.label}</span>}
        </button>
      ))}
    </div>
  );

  // ── Compact layout (defined here so renderLibrary/Search/Recent are in scope) ─

  if (tier === 'compact') {
    const isLandscape = size.w > size.h;
    return (
      <div
        ref={wrapperRef}
        style={{
          position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
          background: dominantColor
            ? `radial-gradient(circle at ${isLandscape ? '20% 50%' : '50% 30%'}, ${dominantColor}22, var(--surface) 70%)`
            : 'var(--surface)',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={() => showDevicePicker && setShowDevicePicker(false)}
      >
        {/* Main content area */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isLandscape ? 'row' : 'column', overflow: 'hidden' }}>
          {/* Album art fills all remaining space; objectFit:cover crops to fit */}
          {activeTab === 'now-playing' && track && !np?.noActiveDevice && (
            isLandscape ? (
              <div style={{ height: '100%', aspectRatio: '1', flexShrink: 0, overflow: 'hidden' }}>
                <img key={track.albumArt} src={track.albumArt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ) : (
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
                <img key={track.albumArt} src={track.albumArt} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            )
          )}
          {/* Tab content — auto height when art is shown (controls take only what they need),
              flex:1 otherwise so library/search/recent lists can scroll */}
          <div style={{
            flex: (activeTab === 'now-playing' && track && !np?.noActiveDevice) ? '0 0 auto' : 1,
            minHeight: 0, minWidth: 0,
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: isLandscape ? '8px' : '6px 10px', overflow: 'hidden',
          }}>
            {activeTab === 'now-playing' && renderNowPlaying()}
            {activeTab === 'library'     && renderLibrary()}
            {activeTab === 'search'      && renderSearch()}
            {activeTab === 'recent'      && renderRecent()}
          </div>
        </div>
        {/* Tab bar */}
        {renderTabBar(36)}
      </div>
    );
  }

  // ── Standard / Expanded layout ────────────────────────────────────────────────

  return (
    <div
      ref={wrapperRef}
      style={{
        position:   'relative',
        width:      '100%',
        height:     '100%',
        overflow:   'hidden',
        display:    'flex',
        flexDirection: 'column',
        background: dominantColor
          ? `radial-gradient(circle at 50% 30%, ${dominantColor}22, var(--surface) 70%)`
          : 'var(--surface)',
        transition: 'background 0.6s ease',
      }}
      onClick={() => showDevicePicker && setShowDevicePicker(false)}
    >
      {/* Album art fills all remaining space above the controls.
          objectFit:cover crops the image to fit — it is never distorted or scaled down. */}
      {activeTab === 'now-playing' && track && !np?.noActiveDevice && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          <img
            key={track.albumArt}
            src={track.albumArt}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      )}

      {/* Controls area — auto height when art is visible so every control is always shown;
          flex:1 on other tabs so library/search/recent lists can scroll */}
      <div style={{
        flex: (activeTab === 'now-playing' && track && !np?.noActiveDevice) ? '0 0 auto' : 1,
        minHeight: 0, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        padding: tier === 'expanded' ? '10px 12px 8px' : '8px 10px 6px',
        gap: tier === 'expanded' ? 10 : 8,
      }}>
        {activeTab === 'now-playing' && renderNowPlaying()}
        {activeTab === 'library'     && renderLibrary()}
        {activeTab === 'search'      && renderSearch()}
        {activeTab === 'recent'      && renderRecent()}
      </div>

      {/* Tab bar */}
      {showTabs && renderTabBar(40)}
    </div>
  );
}
