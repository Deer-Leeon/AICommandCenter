import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/api';

interface NowPlaying {
  isPlaying: boolean;
  noActiveDevice?: boolean;
  track: { id: string; name: string; artists: string; albumArt: string } | null;
}

const SPOTIFY_APP_SCHEME  = 'spotify://';
const SPOTIFY_APP_STORE   = 'https://apps.apple.com/app/spotify-music-and-podcasts/id324684580';

function openSpotify() {
  // Try to open the native Spotify app via its URL scheme.
  // If Spotify is not installed the browser won't navigate away, so
  // document.hidden stays false → after 1.5 s we redirect to the App Store.
  window.location.href = SPOTIFY_APP_SCHEME;
  const t = setTimeout(() => {
    if (!document.hidden) {
      window.open(SPOTIFY_APP_STORE, '_blank');
    }
  }, 1500);
  // Cancel the fallback if the user switches apps (Spotify opened successfully).
  const cleanup = () => { clearTimeout(t); document.removeEventListener('visibilitychange', cleanup); };
  document.addEventListener('visibilitychange', cleanup, { once: true });
}

// ── Spotify wordmark SVG ──────────────────────────────────────────────────────
function SpotifyLogo({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 496 512" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <path fill="#1DB954" d="M248 8C111.1 8 0 119.1 0 256s111.1 248 248 248 248-111.1 248-248S384.9 8 248 8zm100.7 364.9c-4.2 0-6.8-1.3-10.7-3.6-62.4-37.6-135-39.2-206.7-24.5-3.9 1-9 2.6-11.9 2.6-9.7 0-15.8-7.7-15.8-15.8 0-10.3 6.1-15.2 13.6-16.8 81.9-18.1 165.6-16.5 237 26.2 6.1 3.9 9.7 7.4 9.7 16.5s-7.1 15.4-15.2 15.4zm26.9-65.6c-5.2 0-8.7-2.3-12.3-4.2-62.5-37-155.7-51.9-238.6-29.4-4.8 1.3-7.4 2.6-11.9 2.6-10.7 0-19.4-8.7-19.4-19.4s5.2-17.8 15.5-20.7c27.8-7.8 56.2-13.6 97.8-13.6 64.9 0 127.6 16.1 177 45.5 8.1 4.8 11.3 11 11.3 19.7-.1 10.8-8.5 19.5-19.4 19.5zm31-76.2c-5.2 0-8.4-1.3-12.9-3.9-71.2-42.5-198.5-52.7-280.9-29.7-3.9 1-6.1 2.6-10.3 2.6-13.5 0-23.5-10-23.5-23.5s6.8-21.9 17.8-24.8c33.2-9.3 71.6-14.6 114.1-14.6 78.8 0 155.4 18.5 212.9 52.7 8.4 4.9 12.9 11 12.9 22.5-.1 13.5-10.1 23.5-20.1 23.7z"/>
    </svg>
  );
}

export function MobileSpotifyCard() {
  const [np, setNp] = useState<NowPlaying | null>(null);

  const fetchNp = useCallback(async () => {
    try {
      const r = await apiFetch('/api/spotify/now-playing');
      if (r.ok) setNp(await r.json());
    } catch { /* keep previous */ }
  }, []);

  useEffect(() => {
    fetchNp();
    const iv = setInterval(fetchNp, 10_000);
    return () => clearInterval(iv);
  }, [fetchNp]);

  const track = np?.track;
  const hasArt = !!track?.albumArt;

  return (
    <div
      onPointerDown={openSpotify}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Album art background */}
      {hasArt && (
        <img
          src={track!.albumArt}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            filter: 'brightness(0.38) saturate(1.2)',
          }}
        />
      )}

      {/* Dark gradient overlay so text is always legible */}
      <div style={{
        position: 'absolute', inset: 0,
        background: hasArt
          ? 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0.15) 100%)'
          : 'linear-gradient(135deg, #121212 0%, #1a1a2e 100%)',
      }} />

      {/* Content */}
      <div style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
        gap: 20,
        textAlign: 'center',
      }}>

        {/* Logo */}
        <SpotifyLogo size={52} />

        {/* Now playing info */}
        {track ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: '100%' }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: '#fff',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 220,
            }}>
              {track.name}
            </div>
            <div style={{
              fontSize: 12, color: 'rgba(255,255,255,0.6)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: 220,
            }}>
              {track.artists}
            </div>
            {np?.isPlaying && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 2 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    width: 3, borderRadius: 2,
                    background: '#1DB954',
                    animation: `spotifyBar${i} 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
                  }} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
            {np === null ? 'Loading…' : 'Nothing playing'}
          </div>
        )}

        {/* Open button */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#1DB954',
          borderRadius: 999,
          padding: '11px 24px',
          fontSize: 14, fontWeight: 700, color: '#000',
          boxShadow: '0 4px 20px rgba(29,185,84,0.45)',
        }}>
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5,3 19,12 5,21" />
          </svg>
          Open Spotify
        </div>
      </div>

      <style>{`
        @keyframes spotifyBar0 { from { height: 6px } to { height: 18px } }
        @keyframes spotifyBar1 { from { height: 12px } to { height: 6px }  }
        @keyframes spotifyBar2 { from { height: 8px } to { height: 16px }  }
      `}</style>
    </div>
  );
}
