import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../../lib/api';

interface SpotifyTrack {
  id: string; name: string; artists: string;
  albumArt: string; duration: number; uri: string;
}
interface NowPlaying {
  isPlaying: boolean; noActiveDevice?: boolean;
  progress: number; duration: number;
  shuffleState: boolean; repeatState: 'off' | 'track' | 'context';
  volume: number; track: SpotifyTrack | null;
  device: { id: string; name: string; type: string } | null;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const CTRL_BTN = {
  background: 'none', border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 8, borderRadius: '50%', minWidth: 44, minHeight: 44,
};

export function MobileSpotifyCard() {
  const [np, setNp] = useState<NowPlaying | null>(null);
  const [progress, setProgress] = useState(0);
  const [connected, setConnected] = useState(true);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const suppressUntilRef = useRef(0);

  const fetchNp = useCallback(async () => {
    if (Date.now() < suppressUntilRef.current) return;
    try {
      const r = await apiFetch('/api/spotify/now-playing');
      if (r.status === 401) { setConnected(false); return; }
      if (!r.ok) return;
      const d: NowPlaying = await r.json();
      setNp(d);
      setProgress(d.progress);
      setConnected(true);
    } catch { /* network error — keep previous */ }
  }, []);

  useEffect(() => { fetchNp(); const iv = setInterval(fetchNp, 5000); return () => clearInterval(iv); }, [fetchNp]);

  // Smooth progress ticker
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (np?.isPlaying) {
      tickRef.current = setInterval(() => setProgress(p => p + 1000), 1000);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [np?.isPlaying, np?.track?.id]);

  const ctrl = async (action: string, body?: object) => {
    suppressUntilRef.current = Date.now() + 2000;
    await apiFetch(`/api/spotify/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    setTimeout(fetchNp, 500);
  };

  if (!connected) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24 }}>
      <div style={{ fontSize: 40 }}>🎵</div>
      <div style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 14 }}>Connect Spotify to see what's playing</div>
      <button onClick={() => apiFetch('/api/spotify/auth', { method: 'GET' }).then(async r => { const d = await r.json(); if (d.url) window.open(d.url); })}
        style={{ background: '#1db954', border: 'none', borderRadius: 20, padding: '10px 20px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
        Connect Spotify
      </button>
    </div>
  );

  const track = np?.track;
  const dur = np?.duration ?? 1;
  const prog = Math.min(progress, dur);
  const pct = dur > 0 ? (prog / dur) * 100 : 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Album art — top 45% */}
      <div style={{ flex: '0 0 45%', overflow: 'hidden', position: 'relative', backgroundColor: 'rgba(255,255,255,0.04)' }}>
        {track?.albumArt
          ? <img src={track.albumArt} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 60 }}>🎵</div>
        }
      </div>

      {/* Controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 20px 12px', gap: 10 }}>
        {/* Track info */}
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {track?.name ?? (np?.noActiveDevice ? 'No active device' : 'Not playing')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {track?.artists ?? '—'}
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.12)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#1db954', borderRadius: 2, transition: 'width 0.5s linear' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            <span>{fmtMs(prog)}</span>
            <span>{fmtMs(dur)}</span>
          </div>
        </div>

        {/* Playback controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button style={{ ...CTRL_BTN, color: np?.shuffleState ? '#1db954' : 'var(--text-muted)', fontSize: 16 }}
            onClick={() => ctrl('shuffle', { state: !np?.shuffleState })}>⇄</button>
          <button style={{ ...CTRL_BTN, color: 'var(--text)', fontSize: 22 }}
            onClick={() => ctrl('previous')}>⏮</button>
          <button onClick={() => ctrl(np?.isPlaying ? 'pause' : 'play')} style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#1db954', border: 'none', cursor: 'pointer',
            fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(29,185,84,0.4)',
          }}>
            {np?.isPlaying ? '⏸' : '▶'}
          </button>
          <button style={{ ...CTRL_BTN, color: 'var(--text)', fontSize: 22 }}
            onClick={() => ctrl('next')}>⏭</button>
          <button style={{ ...CTRL_BTN, color: np?.repeatState !== 'off' ? '#1db954' : 'var(--text-muted)', fontSize: 16 }}
            onClick={() => ctrl('repeat', { state: np?.repeatState === 'off' ? 'context' : 'off' })}>⇆</button>
        </div>
      </div>
    </div>
  );
}
