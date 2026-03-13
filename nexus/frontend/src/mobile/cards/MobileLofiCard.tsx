import { useState } from 'react';

const STREAMS = [
  { label: 'Lofi Girl', url: 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?autoplay=0&controls=0&rel=0&modestbranding=1' },
  { label: 'Chill Hop', url: 'https://www.youtube-nocookie.com/embed/7NOSDKb0HlU?autoplay=0&controls=0&rel=0&modestbranding=1' },
];

export function MobileLofiCard() {
  const [streamIdx, setStreamIdx] = useState(0);
  const [muted, setMuted] = useState(false);

  const src = STREAMS[streamIdx].url + (muted ? '&mute=1' : '');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <iframe
        src={src}
        title="Lofi"
        allow="autoplay; encrypted-media"
        style={{ flex: 1, border: 'none', width: '100%', display: 'block' }}
        sandbox="allow-scripts allow-same-origin allow-presentation"
      />

      {/* Controls overlay */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'linear-gradient(to top, rgba(10,10,15,0.9), transparent)',
      }}>
        {/* Stream picker */}
        <div style={{ display: 'flex', gap: 6 }}>
          {STREAMS.map((s, i) => (
            <button key={i} onClick={() => setStreamIdx(i)} style={{
              padding: '4px 10px', borderRadius: 12,
              background: streamIdx === i ? 'rgba(167,139,250,0.3)' : 'rgba(255,255,255,0.1)',
              border: streamIdx === i ? '1px solid rgba(167,139,250,0.5)' : '1px solid transparent',
              color: streamIdx === i ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Mute toggle */}
        <button onClick={() => setMuted(m => !m)} style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)', border: 'none',
          fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>
  );
}
