import { useState, useEffect, useCallback, useRef } from 'react';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import {
  LineChart, Line,
  AreaChart, Area,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { apiFetch } from '../../lib/api';
import type { StocksOverview, StockDetail, StockSearchResult } from '../../types';
import { wcRead, wcWrite, wcIsStale, WC_KEY, WC_TTL, awaitPrefetchOrFetch } from '../../lib/widgetCache';

interface Props {
  onClose: () => void;
}

type Range   = '1D' | '1W' | '1M' | '3M' | '1Y';
type TabView = 'all' | 'favorites';


// Gold used for star icons — warm, readable against both dark and light NEXUS backgrounds
const STAR_COLOR = '#f59e0b';

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtChange(n: number | null | undefined): string {
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${fmtPrice(n)}`;
}

function fmtCap(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtAxisTick(isoTime: string, range: Range): string {
  const d = new Date(isoTime);
  if (range === '1D') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (range === '1W') return d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
  if (range === '1M' || range === '3M') return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { month: 'short', year: '2-digit' });
}

function tickCount(range: Range): number {
  return ({ '1D': 5, '1W': 5, '1M': 5, '3M': 5, '1Y': 6 } as Record<Range, number>)[range];
}

// ── Sparkline (tiny read-only inline chart) ───────────────────────────────────

function Sparkline({ closes, positive }: { closes: number[]; positive: boolean }) {
  if (!closes.length) return <div style={{ width: 72, height: 28 }} />;
  const data  = closes.map((close, i) => ({ i, close }));
  const color = positive ? '#22c55e' : '#ef4444';
  return (
    <div style={{ width: 72, height: 28, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="close" dot={false} stroke={color} strokeWidth={1.5} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Custom chart tooltip ──────────────────────────────────────────────────────

interface TooltipPayload { value: number; payload: { time: string } }
interface CustomTooltipProps { active?: boolean; payload?: TooltipPayload[]; range: Range }

function ChartTooltip({ active, payload, range }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const { value, payload: bar } = payload[0];
  return (
    <div style={{
      background: 'var(--surface2)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '6px 10px', fontFamily: 'inherit', fontSize: 11, color: 'var(--text)',
    }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>{fmtAxisTick(bar.time, range)}</div>
      <div style={{ fontWeight: 600 }}>{fmtPrice(value)}</div>
    </div>
  );
}

// ── Detail price chart ────────────────────────────────────────────────────────

function DetailChart({ bars, range, isUp }: { bars: StockDetail['bars']; range: Range; isUp: boolean }) {
  if (!bars.length) return (
    <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
      No chart data available
    </div>
  );

  const color  = isUp ? '#22c55e' : '#ef4444';
  const gradId = isUp ? 'priceGradUp' : 'priceGradDown';

  const maxPoints = 120;
  const step  = Math.max(1, Math.ceil(bars.length / maxPoints));
  const data  = bars.filter((_, i) => i % step === 0).map((b) => ({ time: b.time, close: b.close }));
  const closes     = data.map((d) => d.close);
  const minClose   = Math.min(...closes);
  const maxClose   = Math.max(...closes);
  const padding    = (maxClose - minClose) * 0.05 || 1;

  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
            <stop offset="95%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="time" tickFormatter={(v) => fmtAxisTick(v, range)} tickCount={tickCount(range)}
          interval="preserveStartEnd" tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'inherit' }}
          axisLine={false} tickLine={false} />
        <YAxis domain={[minClose - padding, maxClose + padding]} tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          tick={{ fill: 'var(--text-muted)', fontSize: 9, fontFamily: 'inherit' }}
          axisLine={false} tickLine={false} width={42} tickCount={4} />
        <Tooltip content={<ChartTooltip range={range} />} />
        <Area type="monotone" dataKey="close" stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Star button ───────────────────────────────────────────────────────────────

// Dim gold used for unfavorited stars — visible enough to be an obvious affordance,
// distinct from the full-gold filled state
const STAR_DIM = 'rgba(245, 158, 11, 0.45)';

function StarButton({
  symbol,
  isFav,
  onToggle,
  size = 15,
}: {
  symbol: string;
  isFav: boolean;
  onToggle: (sym: string, e: React.MouseEvent) => void;
  size?: number;
}) {
  return (
    <button
      onClick={(e) => onToggle(symbol, e)}
      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '5px 6px',
        flexShrink: 0,
        lineHeight: 1,
        fontSize: size,
        color: isFav ? STAR_COLOR : STAR_DIM,
        transition: 'color 0.15s, transform 0.1s',
        display: 'flex',
        alignItems: 'center',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = STAR_COLOR; e.currentTarget.style.transform = 'scale(1.2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = isFav ? STAR_COLOR : STAR_DIM; e.currentTarget.style.transform = 'scale(1)'; }}
    >
      {isFav ? '★' : '☆'}
    </button>
  );
}

// ── Stock row (shared between All and Favorites tabs) ─────────────────────────

function StockRow({
  q,
  spark,
  isFav,
  onOpen,
  onToggleFav,
}: {
  q: StocksOverview['quotes'][number];
  spark: number[];
  isFav: boolean;
  onOpen: (sym: string) => void;
  onToggleFav: (sym: string, e: React.MouseEvent) => void;
}) {
  const isUp  = q.regularMarketChangePercent >= 0;
  const color = isUp ? '#22c55e' : '#ef4444';

  return (
    <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => onOpen(q.symbol)}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 6px 8px 6px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text)',
          fontFamily: 'inherit',
          textAlign: 'left',
          transition: 'background 0.12s',
          borderRadius: 4,
          minWidth: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--row-bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
      >
        {/* Symbol + name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.04em', color: 'var(--text)' }}>
            {q.symbol}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
            {q.shortName}
          </div>
        </div>

        {/* Price + change */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 11 }}>{fmtPrice(q.regularMarketPrice)}</div>
          <div style={{ fontSize: 9, color, marginTop: 2, fontWeight: 500 }}>{fmtPct(q.regularMarketChangePercent)}</div>
        </div>

        {/* Sparkline */}
        <Sparkline closes={spark} positive={isUp} />
      </button>

      {/* Star — outside the nav button so clicks don't trigger openDetail */}
      <StarButton symbol={q.symbol} isFav={isFav} onToggle={onToggleFav} />
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function StocksWidget({ onClose }: Props) {
  // ── Core data ─────────────────────────────────────────────────────────────
  const [overview, setOverview]           = useState<StocksOverview | null>(
    () => wcRead<StocksOverview>(WC_KEY.STOCKS_OVERVIEW)?.data ?? null,
  );
  const [detail, setDetail]               = useState<StockDetail | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [range, setRange]                 = useState<Range>('1M');
  const [loadingOverview, setLoadingOverview] = useState(
    () => wcRead(WC_KEY.STOCKS_OVERVIEW) === null,
  );
  const hasLoaded = !loadingOverview;
  useWidgetReady('stocks', hasLoaded);
  const [isStale, setIsStale] = useState(
    () => wcIsStale(WC_KEY.STOCKS_OVERVIEW, WC_TTL.STOCKS),
  );
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [detailError, setDetailError]     = useState<string | null>(null);

  // ── Favorites ──────────────────────────────────────────────────────────────
  const [favorites, setFavorites]         = useState<string[]>([]);
  const [activeTab, setActiveTab]         = useState<TabView>('all');
  const [favOverview, setFavOverview]     = useState<StocksOverview | null>(null);
  const [loadingFavs, setLoadingFavs]     = useState(false);
  // Tracks which symbol list was last fetched for the favorites tab
  const lastFavKeyRef = useRef('');
  // Debounce timer for syncing favorites to backend
  const favSyncRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Search ─────────────────────────────────────────────────────────────────
  const [query, setQuery]                 = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [searching, setSearching]         = useState(false);
  const [showDropdown, setShowDropdown]   = useState(false);
  const searchRef                         = useRef<HTMLDivElement>(null);
  const debounceRef                       = useRef<ReturnType<typeof setTimeout> | null>(null);

  const RANGES: Range[] = ['1D', '1W', '1M', '3M', '1Y'];

  // ── Fetch: overview (All tab) ──────────────────────────────────────────────
  const fetchOverview = useCallback(async () => {
    // Keep showing cached data while refreshing (only show spinner if no cache)
    if (overview === null) setLoadingOverview(true);
    setError(null);
    try {
      const res = await awaitPrefetchOrFetch('/api/stocks/overview', () => apiFetch('/api/stocks/overview'));
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const data = await res.json() as StocksOverview;
      if (!data || !Array.isArray(data.quotes)) throw new Error('Unexpected response from stocks API');
      setOverview(data);
      wcWrite(WC_KEY.STOCKS_OVERVIEW, data);
      setIsStale(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stocks');
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // ── Fetch: detail chart ────────────────────────────────────────────────────
  const fetchDetail = useCallback(async (symbol: string, r: Range) => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await apiFetch(`/api/stocks/history/${symbol}?range=${r}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error || `Server error ${res.status}`);
      }
      const data = await res.json() as StockDetail;
      if (!data || !Array.isArray(data.bars)) throw new Error('Unexpected response');
      setDetail(data);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load stock detail');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // ── Fetch: favorites list from backend ────────────────────────────────────
  const fetchFavorites = useCallback(async () => {
    try {
      const res = await apiFetch('/api/stocks/favorites');
      if (!res.ok) return;
      const data = await res.json() as { symbols: string[] };
      if (Array.isArray(data.symbols)) setFavorites(data.symbols);
    } catch {
      // non-fatal — favorites just stay empty
    }
  }, []);

  // ── Fetch: overview for the Favorites tab ─────────────────────────────────
  const fetchFavOverview = useCallback(async (syms: string[]) => {
    if (!syms.length) return;
    const key = syms.join(',');
    if (key === lastFavKeyRef.current) return; // already up to date
    lastFavKeyRef.current = key;
    setLoadingFavs(true);
    try {
      const res = await apiFetch(`/api/stocks/overview?symbols=${encodeURIComponent(key)}`);
      if (!res.ok) return;
      const data = await res.json() as StocksOverview;
      if (data && Array.isArray(data.quotes)) setFavOverview(data);
    } catch {
      // non-fatal
    } finally {
      setLoadingFavs(false);
    }
  }, []);

  // ── Optimistic favorite toggle ────────────────────────────────────────────
  const toggleFavorite = useCallback((symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(symbol)
        ? prev.filter((s) => s !== symbol)
        : [...prev, symbol];

      // Invalidate cached fav overview whenever the set changes
      lastFavKeyRef.current = '';
      setFavOverview(null);

      // Debounced sync to backend (500 ms after last change)
      if (favSyncRef.current) clearTimeout(favSyncRef.current);
      favSyncRef.current = setTimeout(() => {
        apiFetch('/api/stocks/favorites', {
          method: 'PUT',
          body: JSON.stringify({ symbols: next }),
        }).catch(() => {});
      }, 500);

      return next;
    });
  }, []);

  // ── Init on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchOverview();
    fetchFavorites();
  }, [fetchOverview, fetchFavorites]);

  // ── Re-fetch detail when symbol or range changes ───────────────────────────
  useEffect(() => {
    if (selectedSymbol) fetchDetail(selectedSymbol, range);
  }, [selectedSymbol, range, fetchDetail]);

  // ── Fetch favorites tab data when switching to it ─────────────────────────
  useEffect(() => {
    if (activeTab === 'favorites' && favorites.length > 0) {
      fetchFavOverview(favorites);
    }
  }, [activeTab, favorites, fetchFavOverview]);

  // ── Search debounce ────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults([]); setShowDropdown(false); return; }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/api/stocks/search?q=${encodeURIComponent(query.trim())}`);
        if (!res.ok) { setSearchResults([]); return; }
        const data = await res.json() as { results: StockSearchResult[] };
        const results = Array.isArray(data?.results) ? data.results : [];
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query]);

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Navigation helpers ─────────────────────────────────────────────────────
  const openDetail = (symbol: string) => {
    setSelectedSymbol(symbol);
    setQuery('');
    setShowDropdown(false);
    setSearchResults([]);
    setRange('1M');
  };

  const backToOverview = () => {
    setSelectedSymbol(null);
    setDetail(null);
    setDetailError(null);
  };

  // ── Derived data for Favorites tab ────────────────────────────────────────
  // Prefer the dedicated favOverview fetch; fall back to filtering the all-overview
  const favQuotes = favOverview?.quotes ?? overview?.quotes?.filter((q) => favorites.includes(q.symbol)) ?? [];
  const favSparklines = favOverview?.sparklines ?? overview?.sparklines ?? {};

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
      fontFamily: 'var(--font-mono, monospace)',
      color: 'var(--text)',
      fontSize: 12,
    }}>
      {/* ── Widget header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px 6px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {selectedSymbol && (
            <button
              onClick={backToOverview}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', padding: '0 4px 0 0', fontSize: 14, lineHeight: 1 }}
              title="Back to overview"
            >←</button>
          )}
          <span style={{ color: 'var(--teal)', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em' }}>
            {selectedSymbol || 'MARKETS'}
          </span>
          {!selectedSymbol && (
            <span style={{ color: 'var(--text-faint)', fontSize: 10 }}>
              {activeTab === 'favorites' ? 'FAVORITES' : 'OVERVIEW'}
            </span>
          )}
          {isStale && !selectedSymbol && (
            <span title="Showing cached data — refreshing" style={{ fontSize: 9, color: 'var(--text-faint)', opacity: 0.7 }}>↻</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Show star in detail header for quick toggling */}
          {selectedSymbol && (
            <StarButton symbol={selectedSymbol} isFav={favorites.includes(selectedSymbol)} onToggle={toggleFavorite} size={18} />
          )}
          {!selectedSymbol && (
            <button
              onClick={fetchOverview}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 2, borderRadius: 4, lineHeight: 1 }}
              title="Refresh"
            >↻</button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '0 0 0 2px', lineHeight: 1 }}
          >×</button>
        </div>
      </div>

      {/* ── Tab switcher (overview only, not in detail mode) ── */}
      {!selectedSymbol && (
        <div style={{
          display: 'flex',
          gap: 4,
          padding: '6px 10px 4px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {(['all', 'favorites'] as TabView[]).map((tab) => {
            const isActive = activeTab === tab;
            const label    = tab === 'all' ? 'All' : `★ Favorites${favorites.length ? ` (${favorites.length})` : ''}`;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '3px 10px',
                  fontSize: 10,
                  fontFamily: 'inherit',
                  fontWeight: isActive ? 700 : 400,
                  background: isActive ? (tab === 'favorites' ? 'rgba(245,158,11,0.1)' : 'var(--teal-btn-bg)') : 'none',
                  border: `1px solid ${isActive ? (tab === 'favorites' ? 'rgba(245,158,11,0.4)' : 'var(--teal-btn-border)') : 'var(--border)'}`,
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: isActive ? (tab === 'favorites' ? STAR_COLOR : 'var(--teal)') : 'var(--text-muted)',
                  transition: 'all 0.12s',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Search bar ── */}
      <div ref={searchRef} style={{ position: 'relative', padding: '8px 10px 6px', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px',
        }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>{searching ? '⟳' : '⌕'}</span>
          <input
            type="text"
            placeholder="Search ticker or company…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => searchResults.length && setShowDropdown(true)}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 11, fontFamily: 'inherit', minWidth: 0 }}
          />
          {query && (
            <button onClick={() => { setQuery(''); setShowDropdown(false); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 0 }}>×</button>
          )}
        </div>

        {/* Search dropdown */}
        {showDropdown && (
          <div style={{
            position: 'absolute', top: '100%', left: 10, right: 10,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, boxShadow: 'var(--shadow-popup)', zIndex: 100, overflow: 'hidden',
          }}>
            {searchResults.map((r) => (
              <button
                key={r.symbol}
                onClick={() => openDetail(r.symbol)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 10px', background: 'none', border: 'none',
                  borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  color: 'var(--text)', fontFamily: 'inherit', fontSize: 11, textAlign: 'left', transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--row-bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--teal)' }}>{r.symbol}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 1 }}>{r.shortName}</div>
                </div>
                <span style={{ fontSize: 9, color: 'var(--text-faint)', background: 'var(--surface2)', borderRadius: 3, padding: '2px 4px' }}>
                  {r.typeDisp || r.exchDisp}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>

        {/* Error banner (overview only) */}
        {error && !selectedSymbol && (
          <div style={{ margin: '16px 12px', padding: '10px 12px', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)', borderRadius: 6, color: 'var(--color-danger)', fontSize: 11 }}>
            {error}
            <button onClick={fetchOverview} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', textDecoration: 'underline', fontSize: 11, fontFamily: 'inherit' }}>
              Retry
            </button>
          </div>
        )}

        {/* ── ALL TAB ── */}
        {!selectedSymbol && activeTab === 'all' && overview && (
          <div style={{ padding: '0 10px 8px' }}>
            {(overview.quotes ?? []).map((q) => (
              <StockRow
                key={q.symbol}
                q={q}
                spark={overview.sparklines?.[q.symbol] ?? []}
                isFav={favorites.includes(q.symbol)}
                onOpen={openDetail}
                onToggleFav={toggleFavorite}
              />
            ))}
          </div>
        )}

        {/* ── FAVORITES TAB ── */}
        {!selectedSymbol && activeTab === 'favorites' && (
          <div style={{ padding: '0 10px 8px' }}>
            {/* Loading */}
            {loadingFavs && !favQuotes.length && (
              <div style={{ padding: '0 0' }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                    <div className="skeleton" style={{ width: 36, height: 10, borderRadius: 4 }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ width: '55%', height: 9, borderRadius: 4, marginBottom: 4 }} />
                      <div className="skeleton" style={{ width: '30%', height: 8, borderRadius: 4 }} />
                    </div>
                    <div className="skeleton" style={{ width: 72, height: 28, borderRadius: 4 }} />
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loadingFavs && favorites.length === 0 && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '32px 20px', gap: 8, textAlign: 'center',
              }}>
                <span style={{ fontSize: 28, color: 'var(--text-faint)', lineHeight: 1 }}>☆</span>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5 }}>
                  Star a stock to add it<br />to your favorites
                </div>
                <div style={{ color: 'var(--text-faint)', fontSize: 10, marginTop: 4 }}>
                  Tap ☆ next to any ticker
                </div>
              </div>
            )}

            {/* Favorites list */}
            {favQuotes.map((q) => (
              <StockRow
                key={q.symbol}
                q={q}
                spark={favSparklines?.[q.symbol] ?? []}
                isFav={true}
                onOpen={openDetail}
                onToggleFav={toggleFavorite}
              />
            ))}

            {/* Favorited symbols not yet loaded in overview */}
            {!loadingFavs && favorites.length > 0 && favQuotes.length === 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                Loading favorites…
              </div>
            )}
          </div>
        )}

        {/* ── DETAIL VIEW ── */}
        {selectedSymbol && (
          <div style={{ padding: '0 12px 12px' }}>
            {loadingDetail && !detail && (
              <div style={{ paddingTop: 16 }}>
                <div className="skeleton" style={{ width: '50%', height: 24, borderRadius: 6, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: '30%', height: 13, borderRadius: 4, marginBottom: 20 }} />
                <div className="skeleton" style={{ width: '100%', height: 140, borderRadius: 6 }} />
              </div>
            )}

            {detailError && !detail && (
              <div style={{ margin: '16px 0', padding: '10px 12px', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)', borderRadius: 6, color: 'var(--color-danger)', fontSize: 11 }}>
                {detailError}
                <button
                  onClick={() => fetchDetail(selectedSymbol, range)}
                  style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', textDecoration: 'underline', fontSize: 11, fontFamily: 'inherit' }}
                >Retry</button>
              </div>
            )}

            {detail && (() => {
              const isUp  = detail.regularMarketChangePercent >= 0;
              const color = isUp ? '#22c55e' : '#ef4444';
              return (
                <>
                  {/* Price hero */}
                  <div style={{ paddingTop: 10, paddingBottom: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {detail.shortName}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>
                        {fmtPrice(detail.regularMarketPrice)}
                      </span>
                      <span style={{ fontSize: 11, color, fontWeight: 600 }}>
                        {fmtChange(detail.regularMarketChange)}&nbsp;({fmtPct(detail.regularMarketChangePercent)})
                      </span>
                    </div>
                  </div>

                  {/* Range selector */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    {RANGES.map((r) => (
                      <button
                        key={r}
                        onClick={() => setRange(r)}
                        style={{
                          padding: '3px 8px', fontSize: 10, fontFamily: 'inherit',
                          fontWeight: range === r ? 700 : 400,
                          background: range === r ? 'var(--teal-btn-bg)' : 'none',
                          border: `1px solid ${range === r ? 'var(--teal-btn-border)' : 'var(--border)'}`,
                          borderRadius: 4, cursor: 'pointer',
                          color: range === r ? 'var(--teal)' : 'var(--text-muted)',
                          transition: 'all 0.12s',
                        }}
                      >{r}</button>
                    ))}
                    {loadingDetail && (
                      <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 10, alignSelf: 'center' }}>updating…</span>
                    )}
                  </div>

                  {/* Chart */}
                  <div style={{ background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)', padding: '8px 4px 4px', marginBottom: 10 }}>
                    <DetailChart bars={detail.bars} range={range} isUp={isUp} />
                  </div>

                  {/* Fundamentals */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {[
                      { label: 'Market Cap',   value: fmtCap(detail.marketCap) },
                      { label: '52W High',     value: fmtPrice(detail.fiftyTwoWeekHigh) },
                      { label: '52W Low',      value: fmtPrice(detail.fiftyTwoWeekLow) },
                      { label: "Today's Chg",  value: fmtChange(detail.regularMarketChange), color },
                    ].map(({ label, value, color: c }) => (
                      <div key={label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px' }}>
                        <div style={{ color: 'var(--text-faint)', fontSize: 9, marginBottom: 3 }}>{label}</div>
                        <div style={{ color: c ?? 'var(--text)', fontWeight: 600, fontSize: 11 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
