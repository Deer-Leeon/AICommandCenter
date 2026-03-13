import { useState, useEffect } from 'react';
import type { StocksOverview } from '../../types';
import { apiFetch } from '../../lib/api';
import { wcRead, wcWrite, WC_KEY } from '../../lib/widgetCache';

function fmtPrice(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

// Mini sparkline using SVG polyline
function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 60; const h = 24;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  const color = positive ? '#3de8b0' : '#ef4444';
  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MobileStocksCard() {
  const [overview, setOverview] = useState<StocksOverview | null>(
    () => (wcRead<StocksOverview>(WC_KEY.STOCKS_OVERVIEW) as { data: StocksOverview } | null)?.data ?? null,
  );

  useEffect(() => {
    apiFetch('/api/stocks/overview').then(async r => {
      if (!r.ok) return;
      const d: StocksOverview = await r.json();
      setOverview(d);
      wcWrite(WC_KEY.STOCKS_OVERVIEW, d);
    }).catch(() => {});

    const iv = setInterval(() => {
      apiFetch('/api/stocks/overview').then(async r => {
        if (r.ok) { const d: StocksOverview = await r.json(); setOverview(d); }
      }).catch(() => {});
    }, 60_000);
    return () => clearInterval(iv);
  }, []);

  const quotes = overview?.quotes ?? [];
  const sparklines = overview?.sparklines ?? {};

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '20px 20px 12px' }}>
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
        Stocks
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {quotes.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
        )}
        {quotes.map(q => {
          const up = q.regularMarketChangePercent >= 0;
          const pctColor = up ? '#3de8b0' : '#ef4444';
          const spark = sparklines[q.symbol] ?? [];
          return (
            <div key={q.symbol} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', borderRadius: 12,
              background: 'rgba(255,255,255,0.04)',
            }}>
              {/* Ticker + name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {q.symbol}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {q.shortName}
                </div>
              </div>

              {/* Sparkline */}
              <Sparkline data={spark} positive={up} />

              {/* Price + change */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                  {fmtPrice(q.regularMarketPrice)}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                  padding: '2px 7px', borderRadius: 10, display: 'inline-block',
                  background: up ? 'rgba(61,232,176,0.12)' : 'rgba(239,68,68,0.12)',
                  color: pctColor,
                }}>
                  {up ? '+' : ''}{q.regularMarketChangePercent.toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
