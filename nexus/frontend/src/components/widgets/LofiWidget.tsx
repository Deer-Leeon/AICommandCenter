import { useState, useEffect, useRef, useCallback } from 'react';

const STREAM_KEY  = 'nexus_lofi_stream';
const VOLUME_KEY  = 'nexus_lofi_volume';

const BASE_W = 1280;
const BASE_H = 720;

const STREAMS = [
  { id: 'hiphop',    label: 'hip hop',   videoId: '28KRPhVzCus' },
  { id: 'synthwave', label: 'synthwave', videoId: '4xDzrJKXOOY' },
  { id: 'sleep',     label: 'lofi girl', videoId: 'jfKfPfyJRdk'  },
] as const;

type StreamId = typeof STREAMS[number]['id'];

function buildSrc(videoId: string) {
  // youtube-nocookie.com is YouTube's privacy-enhanced mode — strips most tracking
  // calls so ad blockers don't spam ERR_BLOCKED_BY_CLIENT errors in the console.
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&controls=0&disablekb=1&fs=0&modestbranding=1&rel=0&iv_load_policy=3&enablejsapi=1&mute=1`;
}

function volumeIcon(muted: boolean, vol: number) {
  if (muted || vol === 0) return '🔇';
  if (vol < 40) return '🔈';
  if (vol < 70) return '🔉';
  return '🔊';
}

export function LofiWidget({ onClose: _onClose }: { onClose: () => void }) {
  const [streamIdx, setStreamIdx] = useState<number>(() => {
    const saved = localStorage.getItem(STREAM_KEY) as StreamId | null;
    const idx = STREAMS.findIndex((s) => s.id === saved);
    return idx >= 0 ? idx : 0;
  });

  // Always start muted — browser autoplay policy requires it regardless of saved
  // preference. The user clicks the icon once per session to hear audio.
  const [muted, setMuted]               = useState(true);
  const [volume, setVolume]             = useState<number>(() => {
    const raw = parseInt(localStorage.getItem(VOLUME_KEY) ?? '70', 10);
    return isNaN(raw) ? 70 : Math.max(0, Math.min(100, raw));
  });
  const [loaded, setLoaded]             = useState(false);
  const [labelFading, setLabelFading]   = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [scale, setScale]               = useState(1);

  const wrapperRef        = useRef<HTMLDivElement>(null);
  const iframeRef         = useRef<HTMLIFrameElement>(null);
  const hideTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayVisibleRef = useRef(false);
  // Always reflect live values so stable closures (onReady handler) can read
  // them without going stale across stream switches.
  const mutedRef          = useRef(muted);
  const volumeRef         = useRef(volume);

  const activeStream = STREAMS[streamIdx];
  // src is fixed to the initially-selected stream and never changes.
  // Switching streams uses loadVideoById postMessage so the iframe is never
  // remounted — a remount creates a new browser context that Chrome blocks
  // audio in because the user gesture has expired by the time onReady fires.
  const initialVideoId = useRef(activeStream.videoId);
  const src = buildSrc(initialVideoId.current);

  // ResizeObserver: scale the fixed-size iframe to cover the widget like object-fit:cover
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      setScale(Math.max(width / BASE_W, height / BASE_H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep refs in sync with state.
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const sendPlayerCommand = useCallback((func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*',
    );
  }, []);

  // Listen for YouTube postMessages and keep the player in the right state.
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;

        // onReady: fires once on initial load — start playing and apply saved prefs.
        if (data?.event === 'onReady') {
          sendPlayerCommand('playVideo');
          sendPlayerCommand('setVolume', [volumeRef.current]);
          if (!mutedRef.current) sendPlayerCommand('unMute');
        }

        // onStateChange info=1 means the player just started/resumed playing.
        // This fires every time loadVideoById begins playback — the right moment
        // to re-apply volume and unmute for the new stream.
        if (data?.event === 'onStateChange' && data?.info === 1) {
          sendPlayerCommand('setVolume', [volumeRef.current]);
          if (!mutedRef.current) sendPlayerCommand('unMute');
        }
      } catch {
        // non-JSON frames from other origins — ignore
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sendPlayerCommand]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (next) {
        sendPlayerCommand('mute');
      } else {
        // Restore to saved volume (ensure > 0 so unmuting is audible).
        const vol = volumeRef.current > 0 ? volumeRef.current : 70;
        sendPlayerCommand('setVolume', [vol]);
        sendPlayerCommand('unMute');
      }
      return next;
    });
  }, [sendPlayerCommand]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value, 10);
    setVolume(vol);
    volumeRef.current = vol;
    localStorage.setItem(VOLUME_KEY, String(vol));
    sendPlayerCommand('setVolume', [vol]);
    if (vol === 0) {
      setMuted(true);
      sendPlayerCommand('mute');
    } else {
      setMuted(false);
      sendPlayerCommand('unMute');
    }
  }, [sendPlayerCommand]);

  const handleCycleStream = useCallback(() => {
    setLabelFading(true);
    setTimeout(() => {
      setStreamIdx((prev) => {
        const next = (prev + 1) % STREAMS.length;
        const nextVideoId = STREAMS[next].videoId;
        localStorage.setItem(STREAM_KEY, STREAMS[next].id);
        // Load the new video inside the existing player — no remount, so Chrome
        // preserves the audio permission granted by the original user interaction.
        // Mute state is restored via the onStateChange(1) handler above, which
        // fires at exactly the right moment when the new stream starts playing.
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: 'command', func: 'loadVideoById', args: [nextVideoId] }),
          '*',
        );
        return next;
      });
      setLabelFading(false);
    }, 180);
  }, []);

  // ── Overlay show/hide ──────────────────────────────────────────────────────
  // Show immediately on pointer enter/move; hide only when the pointer leaves.
  // No auto-hide timer while the mouse is inside — the overlay stays up as long
  // as the cursor is in the widget so the switcher is always reachable.
  const handlePointerMove = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (!overlayVisibleRef.current) {
      overlayVisibleRef.current = true;
      setOverlayVisible(true);
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      overlayVisibleRef.current = false;
      setOverlayVisible(false);
    }, 400);
  }, []);

  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'inherit' }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* ── Loading placeholder ──────────────────────────────────────────── */}
      {!loaded && (
        <div style={{
          position:     'absolute', inset: 0,
          display:      'flex', flexDirection: 'column',
          alignItems:   'center', justifyContent: 'center', gap: '10px',
          background:   'linear-gradient(145deg, #0f0b1e 0%, #130d28 60%, #0a0a14 100%)',
          zIndex:       2,
          borderRadius: 'inherit',
        }}>
          <style>{`
            @keyframes lofi-bar1 { 0%,100%{height:8px} 40%{height:22px} }
            @keyframes lofi-bar2 { 0%,100%{height:18px} 30%{height:6px} 70%{height:24px} }
            @keyframes lofi-bar3 { 0%,100%{height:12px} 55%{height:26px} }
          `}</style>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '28px' }}>
            {(['lofi-bar1','lofi-bar2','lofi-bar3'] as const).map((anim, i) => (
              <div key={i} style={{
                width:          '5px',
                height:         '14px',
                borderRadius:   '3px',
                background:     'var(--accent, #7c6aff)',
                animation:      `${anim} 1.1s ease-in-out infinite`,
                animationDelay: `${i * 0.18}s`,
              }} />
            ))}
          </div>
          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-faint, #555)', letterSpacing: '0.1em' }}>
            lofi girl
          </span>
        </div>
      )}

      {/* ── YouTube iframe — fixed 16:9 size, scaled to cover ───────────── */}
      <iframe
        ref={iframeRef}
        src={src}
        title="Lofi Girl 24/7"
        allow="autoplay; encrypted-media"
        allowFullScreen={false}
        onLoad={() => setLoaded(true)}
        style={{
          position:        'absolute',
          top:             '50%',
          left:            '50%',
          width:           `${BASE_W}px`,
          height:          `${BASE_H}px`,
          border:          'none',
          transform:       `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
          opacity:         loaded ? 1 : 0,
          transition:      'opacity 0.6s ease',
          pointerEvents:   'none',
        }}
      />

      {/* ── Hover overlay ────────────────────────────────────────────────── */}
      <div
        style={{
          position:      'absolute', inset: 0,
          opacity:       overlayVisible ? 1 : 0,
          transition:    'opacity 0.25s ease',
          pointerEvents: overlayVisible ? 'auto' : 'none',
          zIndex:        3,
        }}
      >
        {/* Branding — top right */}
        <div style={{
          position:       'absolute', top: '10px', right: '10px',
          padding:        '4px 10px',
          background:     'rgba(10,10,20,0.72)',
          backdropFilter: 'blur(8px)',
          border:         '1px solid rgba(255,255,255,0.08)',
          borderRadius:   '20px',
          fontFamily:     'monospace',
          fontSize:       '10px',
          color:          'var(--text-faint, #666)',
          letterSpacing:  '0.08em',
          lineHeight:     1,
          userSelect:     'none',
        }}>
          lofi girl 📻
        </div>

        {/* Stream switcher — centered */}
        <button
          onClick={handleCycleStream}
          style={{
            position:       'absolute',
            top:            '50%', left: '50%',
            transform:      'translate(-50%, -50%)',
            display:        'flex', flexDirection: 'column',
            alignItems:     'center', gap: '6px',
            padding:        '12px 22px',
            background:     'rgba(10,10,20,0.78)',
            backdropFilter: 'blur(12px)',
            border:         '1px solid rgba(255,255,255,0.18)',
            borderRadius:   '14px',
            cursor:         'pointer',
            lineHeight:     1,
            whiteSpace:     'nowrap',
          }}
        >
          <span style={{
            fontFamily:   'monospace',
            fontSize:     '18px',
            fontWeight:   700,
            letterSpacing: '0.06em',
            color:        'var(--text, #e0e0e8)',
            opacity:      labelFading ? 0 : 1,
            transition:   'opacity 0.18s ease',
          }}>
            {activeStream.label}
          </span>
          <span style={{
            fontFamily:  'monospace',
            fontSize:    '10px',
            color:       'var(--text-faint, #666)',
            letterSpacing: '0.1em',
          }}>
            tap to switch ›
          </span>
        </button>

        {/* Volume control — bottom left */}
        <style>{`
          .nlv-slider {
            -webkit-appearance: none;
            appearance: none;
            width: 100%;
            height: 3px;
            border-radius: 999px;
            outline: none;
            cursor: pointer;
            background: transparent;
            display: block;
            /* Prevent text cursor and focus rings */
            caret-color: transparent;
            user-select: none;
            -webkit-user-select: none;
          }
          .nlv-slider:focus { outline: none; box-shadow: none; }
          .nlv-slider:focus-visible { outline: none; box-shadow: none; }
          .nlv-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 13px;
            height: 13px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 0 6px rgba(200,160,80,0.7), 0 0 12px rgba(200,160,80,0.35);
            cursor: pointer;
            /* Center the 13px thumb on the 3px track: (3 - 13) / 2 = -5px */
            margin-top: -5px;
            transition: transform 0.12s ease, box-shadow 0.12s ease;
          }
          .nlv-slider:hover::-webkit-slider-thumb {
            transform: scale(1.3);
            box-shadow: 0 0 10px rgba(220,170,80,1), 0 0 20px rgba(220,170,80,0.5);
          }
          .nlv-slider:active::-webkit-slider-thumb {
            transform: scale(1.15);
          }
          .nlv-slider::-moz-range-thumb {
            width: 13px;
            height: 13px;
            border-radius: 50%;
            background: #fff;
            border: none;
            box-shadow: 0 0 6px rgba(200,160,80,0.7);
            cursor: pointer;
          }
          .nlv-slider::-webkit-slider-runnable-track {
            height: 3px;
            border-radius: 999px;
            cursor: pointer;
          }
          .nlv-slider::-moz-range-track { height: 3px; border-radius: 999px; background: rgba(255,255,255,0.12); }
          .nlv-slider::-moz-range-progress { border-radius: 999px; background: linear-gradient(to right, #c8a050, #e0b860); }
        `}</style>
        <div
          style={{
            position:       'absolute', bottom: '10px', left: '10px',
            display:        'flex', alignItems: 'center', gap: '8px',
            padding:        '6px 12px',
            background:     'rgba(10,10,20,0.75)',
            backdropFilter: 'blur(12px)',
            border:         '1px solid rgba(255,255,255,0.1)',
            borderRadius:   '24px',
            width:          '168px',
            cursor:         'pointer',
            userSelect:     'none',
          }}
        >
          {/* Icon — click to toggle mute */}
          <button
            onClick={handleToggleMute}
            title={muted ? 'Unmute' : 'Mute'}
            style={{
              background: 'none', border: 'none', padding: 0,
              fontSize: '15px', lineHeight: 1, cursor: 'pointer',
              flexShrink: 0, userSelect: 'none',
            }}
          >
            {volumeIcon(muted, volume)}
          </button>

          {/* Volume slider — wrapper gives the thumb room to be visually
              centered without the 3px input bounding-box messing up flexbox */}
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center',
            height: '20px', cursor: 'pointer',
          }}>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={handleVolumeChange}
              className="nlv-slider"
              style={{
                width: '100%',
                background: muted
                  ? `linear-gradient(to right, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.25) ${volume}%, rgba(255,255,255,0.08) ${volume}%, rgba(255,255,255,0.08) 100%)`
                  : `linear-gradient(to right, #c8a050 0%, #e0b860 ${volume}%, rgba(255,255,255,0.12) ${volume}%, rgba(255,255,255,0.12) 100%)`,
                transition: 'background 0.1s ease',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
