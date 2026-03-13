import { useState, useEffect, useRef } from 'react';

const SEARCH_ENGINES: Record<string, string> = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
};

interface Props { onClose: () => void; }

export function MobileSearchOverlay({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      setVisible(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    });
  }, []);

  const dismiss = () => { setVisible(false); setTimeout(onClose, 250); };

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    const base = SEARCH_ENGINES['google'];
    window.open(`${base}${encodeURIComponent(q)}`, '_blank');
    dismiss();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
      paddingTop: `calc(env(safe-area-inset-top) + 60px)`,
      padding: `calc(env(safe-area-inset-top) + 60px) 20px 20px`,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.25s ease',
    }}
      onClick={dismiss}
    >
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: 500, width: '100%', margin: '0 auto' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'rgba(240,240,248,0.9)',
          borderRadius: 14, padding: '0 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <span style={{ fontSize: 18, opacity: 0.5 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') dismiss();
            }}
            placeholder="Search the web…"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 17, color: '#0d0d18', padding: '16px 0',
              fontFamily: 'inherit',
            }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, opacity: 0.5 }}>✕</button>
          )}
        </div>

        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 16, fontFamily: 'var(--font-mono)' }}>
          Press Enter to search · Tap outside to close
        </div>
      </div>
    </div>
  );
}
