import {
  useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect,
} from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../lib/api';
import { useWidgetReady } from '../../hooks/useWidgetReady';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CurrencyMeta {
  code: string;
  name: string;
  flag: string;
  symbol: string;
}

interface ConvertResult {
  from: string;
  to: string;
  amount: number;
  rate: number;
  converted: number;
  inverseRate: number;
  ratesTimestamp: string;
  stale: boolean;
  withFees: Record<string, {
    label: string;
    fee: number;
    feeAmount: number;
    received: number;
    youLose: number;
  }>;
}

type LayoutMode = 'micro' | 'slim' | 'standard' | 'expanded';

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = 'nexus_currency_widget';
interface Persisted {
  from: string;
  to: string;
  amount: string;
  feesOpen: boolean;
  feeMethod: string;
  recentPairs: Array<{ from: string; to: string }>;
}
function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { from: 'USD', to: 'EUR', amount: '1000', feesOpen: false, feeMethod: 'wise', recentPairs: [] };
    return { from: 'USD', to: 'EUR', amount: '1000', feesOpen: false, feeMethod: 'wise', recentPairs: [], ...JSON.parse(raw) };
  } catch { return { from: 'USD', to: 'EUR', amount: '1000', feesOpen: false, feeMethod: 'wise', recentPairs: [] }; }
}
function writePersisted(p: Persisted) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

// ── Currency metadata ─────────────────────────────────────────────────────────

const MAJOR_CURRENCIES: CurrencyMeta[] = [
  { code: 'USD', name: 'US Dollar',           flag: '🇺🇸', symbol: '$'   },
  { code: 'EUR', name: 'Euro',                flag: '🇪🇺', symbol: '€'   },
  { code: 'GBP', name: 'British Pound',       flag: '🇬🇧', symbol: '£'   },
  { code: 'JPY', name: 'Japanese Yen',        flag: '🇯🇵', symbol: '¥'   },
  { code: 'CHF', name: 'Swiss Franc',         flag: '🇨🇭', symbol: 'Fr'  },
  { code: 'CAD', name: 'Canadian Dollar',     flag: '🇨🇦', symbol: '$'   },
  { code: 'AUD', name: 'Australian Dollar',   flag: '🇦🇺', symbol: '$'   },
  { code: 'CNY', name: 'Chinese Yuan',        flag: '🇨🇳', symbol: '¥'   },
  { code: 'INR', name: 'Indian Rupee',        flag: '🇮🇳', symbol: '₹'   },
  { code: 'MXN', name: 'Mexican Peso',        flag: '🇲🇽', symbol: '$'   },
  { code: 'BRL', name: 'Brazilian Real',      flag: '🇧🇷', symbol: 'R$'  },
  { code: 'KRW', name: 'South Korean Won',    flag: '🇰🇷', symbol: '₩'   },
  { code: 'SGD', name: 'Singapore Dollar',    flag: '🇸🇬', symbol: '$'   },
  { code: 'HKD', name: 'Hong Kong Dollar',    flag: '🇭🇰', symbol: '$'   },
  { code: 'NOK', name: 'Norwegian Krone',     flag: '🇳🇴', symbol: 'kr'  },
  { code: 'SEK', name: 'Swedish Krona',       flag: '🇸🇪', symbol: 'kr'  },
  { code: 'DKK', name: 'Danish Krone',        flag: '🇩🇰', symbol: 'kr'  },
  { code: 'NZD', name: 'New Zealand Dollar',  flag: '🇳🇿', symbol: '$'   },
  { code: 'ZAR', name: 'South African Rand',  flag: '🇿🇦', symbol: 'R'   },
  { code: 'AED', name: 'UAE Dirham',          flag: '🇦🇪', symbol: 'د.إ' },
  { code: 'SAR', name: 'Saudi Riyal',         flag: '🇸🇦', symbol: '﷼'  },
  { code: 'TRY', name: 'Turkish Lira',        flag: '🇹🇷', symbol: '₺'   },
  { code: 'RUB', name: 'Russian Ruble',       flag: '🇷🇺', symbol: '₽'   },
  { code: 'PLN', name: 'Polish Złoty',        flag: '🇵🇱', symbol: 'zł'  },
  { code: 'THB', name: 'Thai Baht',           flag: '🇹🇭', symbol: '฿'   },
  { code: 'IDR', name: 'Indonesian Rupiah',   flag: '🇮🇩', symbol: 'Rp'  },
  { code: 'MYR', name: 'Malaysian Ringgit',   flag: '🇲🇾', symbol: 'RM'  },
  { code: 'PHP', name: 'Philippine Peso',     flag: '🇵🇭', symbol: '₱'   },
  { code: 'CZK', name: 'Czech Koruna',        flag: '🇨🇿', symbol: 'Kč'  },
  { code: 'HUF', name: 'Hungarian Forint',    flag: '🇭🇺', symbol: 'Ft'  },
  { code: 'ILS', name: 'Israeli Shekel',      flag: '🇮🇱', symbol: '₪'   },
  { code: 'CLP', name: 'Chilean Peso',        flag: '🇨🇱', symbol: '$'   },
  { code: 'COP', name: 'Colombian Peso',      flag: '🇨🇴', symbol: '$'   },
  { code: 'ARS', name: 'Argentine Peso',      flag: '🇦🇷', symbol: '$'   },
  { code: 'EGP', name: 'Egyptian Pound',      flag: '🇪🇬', symbol: '£'   },
  { code: 'NGN', name: 'Nigerian Naira',      flag: '🇳🇬', symbol: '₦'   },
  { code: 'PKR', name: 'Pakistani Rupee',     flag: '🇵🇰', symbol: '₨'   },
  { code: 'BDT', name: 'Bangladeshi Taka',    flag: '🇧🇩', symbol: '৳'   },
  { code: 'VND', name: 'Vietnamese Dong',     flag: '🇻🇳', symbol: '₫'   },
  { code: 'UAH', name: 'Ukrainian Hryvnia',   flag: '🇺🇦', symbol: '₴'   },
];

const MAJOR_CODES = new Set(MAJOR_CURRENCIES.map(c => c.code));

const META_MAP: Record<string, CurrencyMeta> = Object.fromEntries(
  MAJOR_CURRENCIES.map(c => [c.code, c]),
);

function getCurrencyMeta(code: string): CurrencyMeta {
  return META_MAP[code] ?? { code, name: code, flag: '🏳️', symbol: code };
}

// ── Number formatting ─────────────────────────────────────────────────────────

const NO_DECIMALS = new Set(['JPY', 'KRW', 'CLP', 'IDR', 'VND', 'HUF', 'MGA', 'PYG', 'XAF', 'XOF']);

function formatAmount(amount: number, code: string): string {
  const dec = NO_DECIMALS.has(code) ? 0 : 2;
  if (Math.abs(amount) >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(amount) >= 1_000_000)     return `${(amount / 1_000_000).toFixed(2)}M`;
  return amount.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function formatRate(rate: number): string {
  if (rate === 0) return '0';
  if (rate < 0.0001) return rate.toFixed(6);
  if (rate < 0.01)   return rate.toFixed(5);
  if (rate < 1)      return rate.toFixed(4);
  if (rate < 100)    return rate.toFixed(4);
  return rate.toFixed(2);
}

function formatAge(ts: string): string {
  try {
    const d = new Date(ts);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch { return ''; }
}

function getCurrencyTint(code: string): string {
  if (['USD', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'BBD', 'BMD'].includes(code)) return 'rgba(59,130,246,0.05)';
  if (['EUR', 'CHF'].includes(code)) return 'rgba(30,58,138,0.05)';
  if (['GBP'].includes(code)) return 'rgba(139,92,246,0.05)';
  if (['JPY', 'CNY', 'KRW'].includes(code)) return 'rgba(239,68,68,0.05)';
  if (['AED', 'SAR', 'QAR', 'KWD'].includes(code)) return 'rgba(245,158,11,0.05)';
  return 'transparent';
}

function getLayoutMode(w: number, h: number): LayoutMode {
  if (w < 200 || h < 160) return 'micro';
  if (w < 420 || h < 280) return 'slim';
  if (w >= 520 && h >= 420) return 'expanded';
  return 'standard';
}

// ── CurrencyDropdown ──────────────────────────────────────────────────────────

function CurrencyDropdown({
  anchorRef, allCurrencies, selectedCode, recentPairs, onSelect, onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  allCurrencies: CurrencyMeta[];
  selectedCode: string;
  recentPairs: Array<{ from: string; to: string }>;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef  = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const dropH = 280;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const top = spaceBelow >= dropH ? r.bottom + 4 : r.top - dropH - 4;
    setPos({ top, left: r.left, width: Math.max(r.width, 240) });
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [anchorRef]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onClose]);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return allCurrencies;
    return allCurrencies.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q),
    );
  }, [allCurrencies, q]);

  const major   = filtered.filter(c => MAJOR_CODES.has(c.code));
  const others  = filtered.filter(c => !MAJOR_CODES.has(c.code));

  const recentCodes = useMemo(() => {
    const s = new Set<string>();
    recentPairs.forEach(p => { s.add(p.from); s.add(p.to); });
    return [...s].slice(0, 6);
  }, [recentPairs]);

  function row(c: CurrencyMeta) {
    const active = c.code === selectedCode;
    return (
      <button
        key={c.code}
        onClick={() => { onSelect(c.code); onClose(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '7px 10px', background: active ? 'rgba(124,106,255,0.12)' : 'none',
          border: 'none', cursor: 'pointer', borderRadius: 7, textAlign: 'left',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface3)'; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none'; }}
      >
        <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: active ? 'var(--accent)' : 'var(--text)', flexShrink: 0 }}>{c.code}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
        {active && <span style={{ color: 'var(--accent)', fontSize: 12, flexShrink: 0 }}>✓</span>}
      </button>
    );
  }

  function sectionHead(label: string) {
    return (
      <div style={{ padding: '6px 10px 2px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
        {label}
      </div>
    );
  }

  if (!pos) return null;

  return createPortal(
    <div
      ref={dropRef}
      style={{
        position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        zIndex: 9999, overflow: 'hidden',
        animation: 'cx-drop 0.15s ease-out both',
      }}
    >
      {/* Search */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface3)', borderRadius: 8, padding: '5px 8px' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search currency…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit' }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', fontSize: 12 }}>✕</button>
          )}
        </div>
      </div>

      <div style={{ maxHeight: 240, overflowY: 'auto', scrollbarWidth: 'none', padding: '4px 4px 6px' }}>
        {/* Recent chips when empty search */}
        {!q && recentCodes.length > 0 && (
          <>
            {sectionHead('Recent')}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 6px 4px' }}>
              {recentCodes.map(code => {
                const c = getCurrencyMeta(code);
                return (
                  <button
                    key={code}
                    onClick={() => { onSelect(code); onClose(); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      background: code === selectedCode ? 'rgba(124,106,255,0.15)' : 'var(--surface2)',
                      border: `1px solid ${code === selectedCode ? 'rgba(124,106,255,0.4)' : 'var(--border)'}`,
                      borderRadius: 6, padding: '3px 8px', fontSize: 11,
                      color: code === selectedCode ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {c.flag} {code}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {/* Major currencies */}
        {major.length > 0 && (
          <>
            {!q && sectionHead('Major Currencies')}
            {major.map(row)}
          </>
        )}
        {/* All others */}
        {others.length > 0 && (
          <>
            {sectionHead(q ? 'Results' : 'All Currencies')}
            {others.map(row)}
          </>
        )}
        {filtered.length === 0 && (
          <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
            No currencies found
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── CurrencySelector ──────────────────────────────────────────────────────────

function CurrencySelector({
  code, allCurrencies, recentPairs, compact, onChange,
}: {
  code: string;
  allCurrencies: CurrencyMeta[];
  recentPairs: Array<{ from: string; to: string }>;
  compact?: boolean;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const meta = getCurrencyMeta(code);
  const tint = getCurrencyTint(code);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: compact ? 6 : 8,
          background: open ? 'var(--surface3)' : tint || 'var(--surface2)',
          border: `1px solid ${open ? 'rgba(124,106,255,0.4)' : 'var(--border)'}`,
          borderRadius: 10, padding: compact ? '6px 8px' : '8px 12px',
          cursor: 'pointer', transition: 'all 0.15s', minWidth: 0,
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        <span style={{ fontSize: compact ? 20 : 24, lineHeight: 1, flexShrink: 0 }}>{meta.flag}</span>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontWeight: 700, fontSize: compact ? 13 : 15, color: 'var(--text)', lineHeight: 1.2 }}>{meta.code}</div>
          {!compact && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.name}</div>
          )}
        </div>
        <span style={{ color: 'var(--text-faint)', fontSize: 10, flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <CurrencyDropdown
          anchorRef={btnRef}
          allCurrencies={allCurrencies}
          selectedCode={code}
          recentPairs={recentPairs}
          onSelect={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── AnimatedAmount ─────────────────────────────────────────────────────────────

function AnimatedAmount({ value, code, fontSize }: { value: number; code: string; fontSize: number }) {
  const [displayed, setDisplayed] = useState(value);
  const prevRef   = useRef(value);
  const rafRef    = useRef<number>(0);
  const startRef  = useRef(0);
  const fromRef   = useRef(value);

  useEffect(() => {
    const from = prevRef.current;
    const to   = value;
    if (from === to) return;
    prevRef.current = to;
    fromRef.current = from;
    startRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);

    function step(now: number) {
      const t = Math.min((now - startRef.current) / 200, 1);
      setDisplayed(fromRef.current + (to - fromRef.current) * t);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else setDisplayed(to);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return (
    <span style={{
      fontFamily: "'Space Mono', monospace", fontWeight: 700,
      fontSize, color: 'var(--accent)', lineHeight: 1, letterSpacing: '-0.02em',
    }}>
      {formatAmount(displayed, code)}
    </span>
  );
}

// ── FeeBreakdown ──────────────────────────────────────────────────────────────

function FeeBreakdown({
  result, fromMeta, toMeta, feeMethod, onFeeMethodChange, compact,
}: {
  result: ConvertResult;
  fromMeta: CurrencyMeta;
  toMeta: CurrencyMeta;
  feeMethod: string;
  onFeeMethodChange: (m: string) => void;
  compact?: boolean;
}) {
  const feeOrder = ['wise', 'revolut', 'credit_card', 'bank_transfer', 'atm_abroad', 'paypal', 'cash_exchange', 'no_fee'];
  const selected = result.withFees[feeMethod] ?? result.withFees['wise'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Fee method pills */}
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
        {feeOrder.map(method => {
          const f = result.withFees[method];
          if (!f) return null;
          const active = method === feeMethod;
          return (
            <button
              key={method}
              onClick={() => onFeeMethodChange(method)}
              style={{
                flexShrink: 0, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                background: active ? 'var(--accent-dim)' : 'var(--surface3)',
                border: `1px solid ${active ? 'rgba(124,106,255,0.4)' : 'var(--border)'}`,
                color: active ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 11, fontWeight: active ? 700 : 400, fontFamily: 'inherit',
                transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
            >
              {f.label} {(f.fee * 100).toFixed(1)}%
            </button>
          );
        })}
      </div>

      {/* Fee card */}
      <div style={{
        background: 'var(--surface2)', borderRadius: 10,
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--accent)',
        padding: compact ? '10px 12px' : '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 5,
      }}>
        <FeeRow label="You send" value={`${fromMeta.symbol}${formatAmount(result.amount, result.from)} ${result.from}`} />
        <FeeRow
          label={`Exchange fee (${(selected.fee * 100).toFixed(1)}%)`}
          value={`-${fromMeta.symbol}${formatAmount(selected.feeAmount, result.from)}`}
          red
        />
        <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>You receive</span>
          <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: compact ? 16 : 18, color: 'var(--accent)' }}>
            {toMeta.symbol}{formatAmount(selected.received, result.to)} {result.to}
          </span>
        </div>
        <FeeRow
          label="You lose to fees"
          value={`${fromMeta.symbol}${formatAmount(selected.youLose, result.from)} (${toMeta.symbol}${formatAmount(selected.youLose * result.rate, result.to)})`}
          red
          small
        />
      </div>
    </div>
  );
}

function FeeRow({ label, value, red, small }: { label: string; value: string; red?: boolean; small?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: small ? 10 : 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{
        fontFamily: "'Space Mono', monospace", fontSize: small ? 10 : 12,
        color: red ? '#ef4444' : 'var(--text)', fontWeight: 500, flexShrink: 0,
      }}>{value}</span>
    </div>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export function CurrencyWidget({ onClose: _onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const persisted = useMemo(() => readPersisted(), []);

  const [fromCode, setFromCode]       = useState(persisted.from);
  const [toCode, setToCode]           = useState(persisted.to);
  const [amountStr, setAmountStr]     = useState(persisted.amount);
  const [feesOpen, setFeesOpen]       = useState(persisted.feesOpen);
  const [feeMethod, setFeeMethod]     = useState(persisted.feeMethod);
  const [recentPairs, setRecentPairs] = useState(persisted.recentPairs);
  const [result, setResult]           = useState<ConvertResult | null>(null);
  const [loading, setLoading]         = useState(false);
  const [allCurrencies, setAllCurrencies] = useState<CurrencyMeta[]>(MAJOR_CURRENCIES);
  const [showFloating, setShowFloating]   = useState(false);
  const [swapping, setSwapping]           = useState(false);
  const [hasLoaded, setHasLoaded]         = useState(false);

  useWidgetReady('currency', hasLoaded);

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Load full currency list from backend once
  useEffect(() => {
    apiFetch('/api/currency/list').then(r => {
      if (r.ok) r.json().then((d: { currencies: CurrencyMeta[] }) => setAllCurrencies(d.currencies));
    }).catch(() => { /* use defaults */ });
  }, []);

  // Persist
  useEffect(() => {
    writePersisted({ from: fromCode, to: toCode, amount: amountStr, feesOpen, feeMethod, recentPairs });
  }, [fromCode, toCode, amountStr, feesOpen, feeMethod, recentPairs]);

  // Convert
  const convertTimer = useRef<ReturnType<typeof setTimeout>>();
  const doConvert = useCallback(() => {
    const amount = parseFloat(amountStr.replace(/,/g, '')) || 0;
    if (!fromCode || !toCode || amount <= 0) return;
    clearTimeout(convertTimer.current);
    convertTimer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await apiFetch(
          `/api/currency/convert?from=${fromCode}&to=${toCode}&amount=${amount}`,
        );
        if (r.ok) {
          const data = await r.json() as ConvertResult;
          setResult(data);
          setHasLoaded(true);
          // Track recent pair
          setRecentPairs(prev => {
            const key = `${fromCode}:${toCode}`;
            const filtered = prev.filter(p => `${p.from}:${p.to}` !== key);
            return [{ from: fromCode, to: toCode }, ...filtered].slice(0, 8);
          });
        }
      } catch { /* silent */ } finally { setLoading(false); }
    }, 200);
  }, [fromCode, toCode, amountStr]);

  useEffect(() => {
    doConvert();
    return () => clearTimeout(convertTimer.current);
  }, [doConvert]);

  // Mark ready if we have persisted data
  useEffect(() => { if (persisted.from && persisted.to) setHasLoaded(true); }, [persisted]);

  function handleSwap() {
    setSwapping(true);
    // Instantly flip result using already-known inverse rate — no API wait
    if (result) {
      const flipped: ConvertResult = {
        ...result,
        from: result.to,
        to: result.from,
        rate: result.inverseRate,
        converted: result.amount * result.inverseRate,
        inverseRate: result.rate,
        withFees: Object.fromEntries(
          Object.entries(result.withFees).map(([method, f]) => [method, {
            ...f,
            feeAmount: result.amount * f.fee,
            received: (result.amount - result.amount * f.fee) * result.inverseRate,
            youLose: result.amount * f.fee,
          }]),
        ),
      };
      setResult(flipped);
    }
    setTimeout(() => {
      setFromCode(toCode);
      setToCode(fromCode);
      setSwapping(false);
    }, 140);
  }

  function handleAmountInput(raw: string) {
    // Strip non-numeric except dot
    const clean = raw.replace(/[^0-9.]/g, '');
    setAmountStr(clean);
  }

  // Format display amount (add commas)
  const displayAmount = useMemo(() => {
    const n = parseFloat(amountStr.replace(/,/g, ''));
    if (isNaN(n)) return amountStr;
    const parts = amountStr.split('.');
    const intPart = parseInt(parts[0]).toLocaleString('en-US');
    return parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
  }, [amountStr]);

  const fromMeta = getCurrencyMeta(fromCode);
  const toMeta   = getCurrencyMeta(toCode);
  const mode     = getLayoutMode(size.w, size.h);
  const compact  = mode === 'micro' || mode === 'slim';

  // ── Micro mode ─────────────────────────────────────────────────────────────
  if (mode === 'micro') {
    return (
      <div ref={containerRef} style={rootStyle} onClick={() => setShowFloating(true)}>
        {result ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 10px', gap: 3, cursor: 'pointer' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 16 }}>{fromMeta.flag}</span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                {formatAmount(result.amount, fromCode)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{fromCode}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: "'Space Mono', monospace" }}>
                1 {fromCode} = {formatRate(result.rate)} {toCode}
              </span>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 16 }}>{toMeta.flag}</span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
                {formatAmount(result.converted, toCode)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{toCode}</span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 4, cursor: 'pointer' }}>
            <span style={{ fontSize: 24 }}>💱</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Tap to convert</span>
          </div>
        )}

        {showFloating && (
          <FloatingPanel
            fromCode={fromCode} toCode={toCode} amountStr={amountStr}
            result={result} loading={loading} feesOpen={feesOpen} feeMethod={feeMethod}
            allCurrencies={allCurrencies} recentPairs={recentPairs} swapping={swapping}
            onFromChange={setFromCode} onToChange={setToCode}
            onAmountChange={handleAmountInput} onSwap={handleSwap}
            onFeesOpen={setFeesOpen} onFeeMethod={setFeeMethod}
            onClose={() => setShowFloating(false)}
          />
        )}

        <style>{CX_STYLES}</style>
      </div>
    );
  }

  // ── Slim / Standard / Expanded ────────────────────────────────────────────
  return (
    <div ref={containerRef} style={rootStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: compact ? 8 : 12, gap: compact ? 8 : 10, boxSizing: 'border-box', overflowY: 'auto', scrollbarWidth: 'none' }}>

        {/* Selector row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 6 : 8, flexShrink: 0 }}>
          <CurrencySelector code={fromCode} allCurrencies={allCurrencies} recentPairs={recentPairs} compact={compact} onChange={setFromCode} />

          {/* Swap + direction */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
              <line x1="1" y1="5" x2="15" y2="5" stroke="rgba(124,106,255,0.4)" strokeWidth="1.4" strokeLinecap="round"/>
              <polyline points="12,2 16,5 12,8" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <button
              onClick={handleSwap}
              title="Swap currencies"
              style={{
                background: 'var(--surface3)', border: '1px solid var(--border)',
                borderRadius: '50%', width: compact ? 26 : 30, height: compact ? 26 : 30,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: 'var(--text-muted)', transition: 'all 0.15s',
                animation: swapping ? 'cx-swap 0.28s ease-in-out' : 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface3)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >⇄</button>
          </div>

          <CurrencySelector code={toCode} allCurrencies={allCurrencies} recentPairs={recentPairs} compact={compact} onChange={setToCode} />
        </div>

        {/* Amount input */}
        <div style={{ flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 10, padding: compact ? '8px 10px' : '10px 14px',
            transition: 'border-color 0.15s',
          }}
            onFocus={() => {}}
          >
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: compact ? 16 : 20, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>
              {fromMeta.symbol}
            </span>
            <input
              value={displayAmount}
              onChange={e => handleAmountInput(e.target.value)}
              onFocus={e => (e.currentTarget.parentElement!.style.borderColor = 'rgba(124,106,255,0.5)')}
              onBlur={e => (e.currentTarget.parentElement!.style.borderColor = 'var(--border)')}
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                fontFamily: "'Space Mono', monospace", fontSize: compact ? 16 : 20,
                fontWeight: 700, color: 'var(--text)', minWidth: 0,
              }}
              placeholder="0"
              inputMode="decimal"
            />
            <span style={{ fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>{fromCode}</span>
          </div>
        </div>

        {/* Result */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: compact ? 4 : 6, minHeight: 0,
        }}>
          {result ? (
            <>
              {/* Big converted amount */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: compact ? 22 : 28 }}>{toMeta.flag}</span>
                <AnimatedAmount
                  value={result.converted}
                  code={toCode}
                  fontSize={compact ? 28 : mode === 'expanded' ? 48 : 38}
                />
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: compact ? 12 : 15, color: 'var(--text-muted)', fontWeight: 600 }}>
                  {toCode}
                </span>
              </div>

              {/* Rate display */}
              {!compact && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'var(--text-muted)' }}>
                    1 {fromCode} = {formatRate(result.rate)} {toCode}
                  </span>
                  <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: 'var(--text-faint)' }}>
                    1 {toCode} = {formatRate(result.inverseRate)} {fromCode}
                  </span>
                  <span style={{ fontSize: 10, color: result.stale ? '#f59e0b' : 'var(--text-faint)', marginTop: 2 }}>
                    {result.stale ? '⚠️ Using cached rates · ' : ''}Rates updated {formatAge(result.ratesTimestamp)}
                  </span>
                </div>
              )}

              {compact && (
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: 'var(--text-faint)' }}>
                  1 {fromCode} = {formatRate(result.rate)} {toCode}
                </span>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {loading && <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'cx-spin 0.8s linear infinite' }} />}
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                {loading ? 'Fetching rates…' : 'Enter an amount to convert'}
              </span>
            </div>
          )}
        </div>

        {/* Fee breakdown — hidden in micro/slim unless expanded */}
        {result && (mode === 'standard' || mode === 'expanded') && (
          <div style={{ flexShrink: 0 }}>
            <button
              onClick={() => setFeesOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '4px 0', color: 'var(--text-muted)', fontSize: 11,
                fontFamily: 'inherit', justifyContent: 'center',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <span>{feesOpen ? '▴' : '▾'}</span>
              <span>After exchange fees</span>
            </button>

            {feesOpen && (
              <FeeBreakdown
                result={result} fromMeta={fromMeta} toMeta={toMeta}
                feeMethod={feeMethod} onFeeMethodChange={setFeeMethod}
                compact={mode === 'standard'}
              />
            )}
          </div>
        )}

        {/* Slim: compact fees link */}
        {result && mode === 'slim' && (
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <button
              onClick={() => setShowFloating(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-faint)', fontFamily: 'inherit' }}
            >
              fees ▾
            </button>
          </div>
        )}
      </div>

      {showFloating && (
        <FloatingPanel
          fromCode={fromCode} toCode={toCode} amountStr={amountStr}
          result={result} loading={loading} feesOpen={feesOpen} feeMethod={feeMethod}
          allCurrencies={allCurrencies} recentPairs={recentPairs} swapping={swapping}
          onFromChange={setFromCode} onToChange={setToCode}
          onAmountChange={handleAmountInput} onSwap={handleSwap}
          onFeesOpen={setFeesOpen} onFeeMethod={setFeeMethod}
          onClose={() => setShowFloating(false)}
        />
      )}

      <style>{CX_STYLES}</style>
    </div>
  );
}

// ── FloatingPanel (used from micro mode) ─────────────────────────────────────

function FloatingPanel({
  fromCode, toCode, amountStr, result, loading, feesOpen, feeMethod,
  allCurrencies, recentPairs, swapping,
  onFromChange, onToChange, onAmountChange, onSwap,
  onFeesOpen, onFeeMethod, onClose,
}: {
  fromCode: string; toCode: string; amountStr: string;
  result: ConvertResult | null; loading: boolean;
  feesOpen: boolean; feeMethod: string;
  allCurrencies: CurrencyMeta[]; recentPairs: Array<{ from: string; to: string }>;
  swapping: boolean;
  onFromChange: (c: string) => void; onToChange: (c: string) => void;
  onAmountChange: (v: string) => void; onSwap: () => void;
  onFeesOpen: (v: boolean) => void; onFeeMethod: (m: string) => void;
  onClose: () => void;
}) {
  const fromMeta = getCurrencyMeta(fromCode);
  const toMeta   = getCurrencyMeta(toCode);

  const displayAmount = useMemo(() => {
    const n = parseFloat(amountStr.replace(/,/g, ''));
    if (isNaN(n)) return amountStr;
    const parts = amountStr.split('.');
    const intPart = parseInt(parts[0]).toLocaleString('en-US');
    return parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
  }, [amountStr]);

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'rgba(0,0,0,0.4)' }}
      />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 320, maxHeight: '80vh',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 16, zIndex: 9991, overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
        animation: 'cx-float-in 0.2s ease-out both',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Currency Converter</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12, scrollbarWidth: 'none' }}>
          {/* Selectors */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CurrencySelector code={fromCode} allCurrencies={allCurrencies} recentPairs={recentPairs} compact onChange={onFromChange} />
            <button onClick={onSwap} style={{ background: 'var(--surface3)', border: '1px solid var(--border)', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--text-muted)', flexShrink: 0, animation: swapping ? 'cx-swap 0.28s ease-in-out' : 'none' }}>⇄</button>
            <CurrencySelector code={toCode} allCurrencies={allCurrencies} recentPairs={recentPairs} compact onChange={onToChange} />
          </div>

          {/* Amount */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 16, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>{fromMeta.symbol}</span>
            <input
              value={displayAmount}
              onChange={e => onAmountChange(e.target.value)}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontFamily: "'Space Mono', monospace", fontSize: 16, fontWeight: 700, color: 'var(--text)', minWidth: 0 }}
              placeholder="0" inputMode="decimal" autoFocus
            />
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{fromCode}</span>
          </div>

          {/* Result */}
          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '4px 0' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 22 }}>{toMeta.flag}</span>
                <AnimatedAmount value={result.converted} code={toCode} fontSize={32} />
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>{toCode}</span>
              </div>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: 'var(--text-faint)' }}>
                1 {fromCode} = {formatRate(result.rate)} {toCode}
              </span>
            </div>
          )}
          {loading && !result && (
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>Fetching rates…</div>
          )}

          {/* Fees */}
          {result && (
            <div>
              <button
                onClick={() => onFeesOpen(!feesOpen)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'inherit', justifyContent: 'center' }}
              >
                <span>{feesOpen ? '▴' : '▾'}</span>
                <span>After exchange fees</span>
              </button>
              {feesOpen && (
                <FeeBreakdown result={result} fromMeta={fromMeta} toMeta={toMeta} feeMethod={feeMethod} onFeeMethodChange={onFeeMethod} compact />
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const rootStyle: React.CSSProperties = {
  height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column',
  boxSizing: 'border-box',
};

const CX_STYLES = `
  @keyframes cx-spin { to { transform: rotate(360deg); } }
  @keyframes cx-drop {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes cx-float-in {
    from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }
  @keyframes cx-swap {
    0%   { transform: rotate(0deg) scale(1); }
    50%  { transform: rotate(180deg) scale(1.2); }
    100% { transform: rotate(360deg) scale(1); }
  }
`;
