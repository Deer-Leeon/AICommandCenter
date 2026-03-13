/**
 * DevCacheOverlay — development-only panel showing per-widget cache diagnostics.
 *
 * Renders a small collapsible table in the bottom-right corner of the app.
 * Completely absent from production builds: the outer component returns null
 * when import.meta.env.DEV is false, and Vite's dead-code elimination removes
 * the entire module from the bundle.
 */

import { useState, useEffect } from 'react';
import type { CacheDiag } from '../lib/devUtils';
import { devGetDiags } from '../lib/devUtils';

// ── Inner component (has hooks) ───────────────────────────────────────────────

function DevCacheOverlayInner() {
  const [diags, setDiags] = useState<CacheDiag[]>(() => devGetDiags());
  const [open, setOpen]   = useState(false);

  useEffect(() => {
    // Refresh the list whenever a widget records a new diagnostic
    function onDiag() { setDiags(devGetDiags()); }
    window.addEventListener('nexus:cache-diag', onDiag);
    // Also poll every 2 s to catch any widgets that don't fire the event
    const tid = setInterval(() => setDiags(devGetDiags()), 2000);
    return () => {
      window.removeEventListener('nexus:cache-diag', onDiag);
      clearInterval(tid);
    };
  }, []);

  const toggleStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 88,
    right: 12,
    zIndex: 9999,
    background: 'rgba(10,10,15,0.92)',
    border: '1px solid rgba(61,232,176,0.3)',
    borderRadius: open ? '8px 8px 6px 6px' : 6,
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#3de8b0',
    userSelect: 'none',
  };

  if (!open) {
    return (
      <button style={toggleStyle} onClick={() => setOpen(true)} title="Open cache diagnostics">
        ⚡ cache
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 88,
        right: 12,
        zIndex: 9999,
        background: 'rgba(10,10,15,0.96)',
        border: '1px solid rgba(61,232,176,0.3)',
        borderRadius: 8,
        fontFamily: 'monospace',
        fontSize: 10,
        color: '#e8e8f0',
        minWidth: 320,
        maxWidth: 420,
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px 4px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span style={{ color: '#3de8b0', fontWeight: 700 }}>⚡ Cache Diagnostics</span>
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7a7a90', fontSize: 12 }}
        >
          ✕
        </button>
      </div>

      {/* Table */}
      <div style={{ padding: '4px 0', maxHeight: 300, overflowY: 'auto' }}>
        {diags.length === 0 ? (
          <div style={{ padding: '8px 10px', color: '#7a7a90' }}>No diagnostics yet — widgets haven&apos;t reported in.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#7a7a90' }}>
                <th style={th}>Widget</th>
                <th style={th}>Source</th>
                <th style={th}>Cache age</th>
                <th style={th}>Fetch ms</th>
              </tr>
            </thead>
            <tbody>
              {diags.map((d) => (
                <tr key={d.widget} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={td}>{d.widget}</td>
                  <td style={{ ...td, color: sourceColor(d.source) }}>{d.source}</td>
                  <td style={{ ...td, color: d.wasStale ? '#f59e0b' : '#7a7a90' }}>
                    {d.cacheAgeMs !== null
                      ? d.cacheAgeMs < 60_000
                        ? `${Math.round(d.cacheAgeMs / 1000)}s${d.wasStale ? ' ⚠️' : ''}`
                        : `${(d.cacheAgeMs / 60_000).toFixed(1)}m${d.wasStale ? ' ⚠️' : ''}`
                      : '—'}
                  </td>
                  <td style={td}>{d.fetchMs !== null ? `${Math.round(d.fetchMs)}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer legend */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          padding: '4px 10px 6px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          color: '#7a7a90',
          fontSize: 9,
        }}
      >
        <span style={{ color: sourceColor('cache-only') }}>■ cache</span>
        <span style={{ color: sourceColor('prefetch') }}>■ prefetch</span>
        <span style={{ color: sourceColor('fresh-fetch') }}>■ fresh</span>
        <span style={{ color: '#f59e0b' }}>⚠ stale</span>
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '2px 10px',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '3px 10px',
  whiteSpace: 'nowrap',
};

function sourceColor(source: CacheDiag['source']): string {
  switch (source) {
    case 'cache-only':  return '#3de8b0';
    case 'prefetch':    return '#7c6aff';
    case 'fresh-fetch': return '#f59e0b';
    default:            return '#7a7a90';
  }
}

// ── Public component (gate on DEV) ────────────────────────────────────────────

/**
 * Mount this once in App.tsx.
 * It renders nothing in production builds.
 */
export function DevCacheOverlay() {
  // import.meta.env.DEV is a compile-time boolean.
  // In production: always false → early return → component is tree-shaken.
  // No hooks are called before this return, so rules-of-hooks are satisfied.
  if (!import.meta.env.DEV) return null;
  return <DevCacheOverlayInner />;
}
