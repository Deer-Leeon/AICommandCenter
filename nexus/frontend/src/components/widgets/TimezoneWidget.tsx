import {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import { apiFetch } from '../../lib/api';
import { useWidgetReady } from '../../hooks/useWidgetReady';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TZCitySuggestion {
  name: string;
  timezone: string;
  countryCode: string;
  flag: string;
  utcOffset: string;
}

interface TZResult {
  name: string;
  type: 'city' | 'country' | 'region';
  timezone: string | null;
  timezones: string[] | null;
  ambiguous: boolean;
  ambiguousMessage: string | null;
  citySuggestions: TZCitySuggestion[] | null;
  countryCode: string;
  flag: string;
  utcOffset: string | null;
  currentTime: string | null;
}

interface SelectedLocation {
  name: string;
  timezone: string;
  countryCode: string;
  flag: string;
  utcOffset: string;
}

interface ConvertResult {
  fromTime: string;
  toTime: string;
  fromDate: string;
  toDate: string;
  offsetDifference: string;
  diffMinutes: number;
  dayDiff: number;
  crossesMidnight: boolean;
  crossesDay: 'forward' | 'backward' | null;
  fromOffset: string;
  toOffset: string;
  fromDST: boolean;
  toDST: boolean;
}

interface LiveClock {
  time: string;
  date: string;
  isDST: boolean;
}

type LayoutMode = 'micro' | 'slim' | 'compact' | 'standard' | 'expanded';

// ── Persistence ───────────────────────────────────────────────────────────────

const LS_KEY = 'nexus_tz_widget';

interface Persisted {
  from: SelectedLocation | null;
  to: SelectedLocation | null;
  recentPairs: Array<{ from: SelectedLocation; to: SelectedLocation }>;
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { from: null, to: null, recentPairs: [] };
    return JSON.parse(raw) as Persisted;
  } catch { return { from: null, to: null, recentPairs: [] }; }
}

function writePersisted(p: Persisted) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

// ── Layout detection ──────────────────────────────────────────────────────────

function getLayoutMode(w: number, h: number): LayoutMode {
  if (w < 200 || h < 200) return 'micro';
  if (w < 380 || h < 280) return 'slim';
  if (w < 520 || h < 360) return 'compact';
  if (w < 700) return 'standard';
  return 'expanded';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowTimeStr() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateLabel(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    }).format(new Date(y, m - 1, d));
  } catch { return dateStr; }
}

function splitTime(t: string): [string, string, string] {
  const parts = t.split(':');
  return [parts[0] ?? '00', parts[1] ?? '00', parts[2] ?? '00'];
}

// ── SearchInput ───────────────────────────────────────────────────────────────

interface SearchInputProps {
  placeholder?: string;
  selected: SelectedLocation | null;
  onSelect: (loc: SelectedLocation) => void;
  onClear: () => void;
  autoFocus?: boolean;
  compact?: boolean;
}

function SearchInput({ placeholder, selected, onSelect, onClear, autoFocus, compact }: SearchInputProps) {
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<TZResult[]>([]);
  const [focused, setFocused]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [ambiguous, setAmbiguous] = useState<TZResult | null>(null);
  const [dropPos, setDropPos]     = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef    = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 50);
  }, [autoFocus]);

  // Measure anchor whenever dropdown should be visible
  useEffect(() => {
    if (focused && containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
  }, [focused, results, ambiguous]);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setAmbiguous(null); return; }
    setLoading(true);
    try {
      const res = await apiFetch(`/api/timezone/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json() as { results: TZResult[] };
        setResults(data.results);
      }
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    setAmbiguous(null);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(v), 300);
  }

  function handleSelect(r: TZResult) {
    if (r.ambiguous) { setAmbiguous(r); return; }
    if (!r.timezone) return;
    onSelect({ name: r.name, timezone: r.timezone, countryCode: r.countryCode, flag: r.flag, utcOffset: r.utcOffset ?? '' });
    setQuery('');
    setResults([]);
    setAmbiguous(null);
    setFocused(false);
  }

  function handleBlur() {
    setTimeout(() => { setFocused(false); setAmbiguous(null); }, 220);
  }

  const showDropdown = focused && dropPos && (results.length > 0 || loading || ambiguous !== null);
  const fs = compact ? 12 : 13;

  if (selected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: compact ? 14 : 16 }}>{selected.flag}</span>
        <span style={{
          flex: 1, fontSize: fs, fontWeight: 600, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={selected.name}>{selected.name}</span>
        <button
          onClick={onClear}
          style={{
            flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 14, padding: '0 2px', lineHeight: 1,
          }}
          title="Clear"
        >✕</button>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ minWidth: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--surface3)', borderRadius: 8,
        border: `1px solid ${focused ? 'rgba(124,106,255,0.4)' : 'var(--border)'}`,
        padding: compact ? '4px 8px' : '6px 10px',
        transition: 'border-color 0.2s',
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          placeholder={placeholder ?? 'City or country…'}
          style={{
            flex: 1, background: 'none', border: 'none', outline: 'none',
            fontSize: fs, color: 'var(--text)', fontFamily: 'inherit', minWidth: 0,
          }}
        />
        {loading && (
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            border: '1.5px solid var(--text-faint)',
            borderTopColor: 'var(--accent)',
            animation: 'tz-spin 0.7s linear infinite', flexShrink: 0,
          }} />
        )}
      </div>

      {/* Dropdown rendered at fixed position to escape overflow:hidden.
          onMouseDown preventDefault on the container prevents the input from losing
          focus when the user clicks anywhere inside the dropdown. */}
      {showDropdown && dropPos && (
        <div
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'fixed',
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 10, overflow: 'hidden', zIndex: 9999,
            boxShadow: 'var(--shadow-popup)',
            animation: 'tz-drop 0.18s ease-out both',
            maxHeight: 280, overflowY: 'auto',
          }}
        >
          {ambiguous ? (
            <div style={{ padding: '12px 14px' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                {ambiguous.flag} {ambiguous.ambiguousMessage}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ambiguous.citySuggestions?.map(city => (
                  <button
                    key={city.name}
                    onMouseDown={e => {
                      e.preventDefault();
                      // Select immediately — no second API call needed
                      onSelect({ name: city.name, timezone: city.timezone, countryCode: city.countryCode, flag: city.flag, utcOffset: city.utcOffset });
                      setQuery('');
                      setResults([]);
                      setAmbiguous(null);
                      setFocused(false);
                    }}
                    style={{
                      background: 'rgba(124,106,255,0.12)',
                      border: '1px solid rgba(124,106,255,0.3)',
                      borderRadius: 20, padding: '4px 12px', fontSize: 12,
                      color: 'var(--accent)', cursor: 'pointer', fontFamily: 'inherit',
                      fontWeight: 500, transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,106,255,0.22)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(124,106,255,0.12)')}
                  >{city.name}</button>
                ))}
              </div>
            </div>
          ) : results.length === 0 && !loading ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
              No results found
            </div>
          ) : (
            results.map((r, i) => (
              <div
                key={i}
                onMouseDown={e => { e.preventDefault(); handleSelect(r); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', cursor: 'pointer',
                  borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{r.flag}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {r.name}
                  </div>
                  {r.ambiguous ? (
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', fontStyle: 'italic' }}>
                      select a city →
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {r.utcOffset}
                      {r.currentTime && <span style={{ marginLeft: 6 }}>{r.currentTime}</span>}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── LiveClock display ─────────────────────────────────────────────────────────

interface ClockDisplayProps {
  timezone: string;
  isResult?: boolean;
  mode: LayoutMode;
  showSeconds?: boolean;
}

function ClockDisplay({ timezone, isResult, mode, showSeconds }: ClockDisplayProps) {
  const [now, setNow] = useState(() => new Date());
  const [tick, setTick] = useState(false);
  const prevSec = useRef(-1);

  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      const sec = d.getSeconds();
      if (sec !== prevSec.current) {
        prevSec.current = sec;
        setTick(t => !t);
      }
      setNow(new Date());
    }, 200);
    return () => clearInterval(id);
  }, []);

  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined, hour12: false,
  }).format(now);

  const dateStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: mode === 'micro' ? undefined : 'short',
    month: 'short', day: 'numeric',
    year: mode === 'expanded' ? 'numeric' : undefined,
  }).format(now);

  const [h, m, s] = splitTime(timeStr);

  const color = isResult ? 'var(--accent)' : 'var(--text)';
  const timeFontSize = mode === 'micro' ? 22 : mode === 'slim' ? 26 : mode === 'compact' ? 30 : mode === 'standard' ? 36 : 42;

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontFamily: "'Space Mono', monospace", fontWeight: 700,
        fontSize: timeFontSize, color, lineHeight: 1.1,
        display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 1,
      }}>
        <span>{h}</span>
        <span style={{ color: isResult ? 'rgba(124,106,255,0.6)' : 'var(--text-muted)', margin: '0 1px' }}>:</span>
        <span>{m}</span>
        {showSeconds && s && (
          <>
            <span style={{ color: isResult ? 'rgba(124,106,255,0.6)' : 'var(--text-muted)', margin: '0 1px' }}>:</span>
            <span style={{
              fontSize: timeFontSize * 0.6,
              color: isResult ? 'rgba(124,106,255,0.7)' : 'var(--text-muted)',
              display: 'inline-block',
              animation: tick ? 'tz-tick 0.1s ease-out' : undefined,
            }}>{s}</span>
          </>
        )}
      </div>
      {mode !== 'micro' && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{dateStr}</div>
      )}
    </div>
  );
}

// ── Time picker ───────────────────────────────────────────────────────────────

interface TimePickerProps {
  time: string;
  date: string;
  onChange: (time: string, date: string) => void;
  compact?: boolean;
}

function TimePicker({ time, date, onChange, compact }: TimePickerProps) {
  const [h, m] = time.split(':').map(Number);

  function adjustHour(delta: number) {
    const nh = ((h + delta) + 24) % 24;
    onChange(`${pad(nh)}:${pad(m)}`, date);
  }
  function adjustMin(delta: number) {
    const nm = ((m + delta) + 60) % 60;
    const carry = m + delta < 0 ? -1 : m + delta >= 60 ? 1 : 0;
    const nh = ((h + carry) + 24) % 24;
    onChange(`${pad(nh)}:${pad(nm)}`, date);
  }
  function adjustDate(delta: number) {
    const [y, mo, d] = date.split('-').map(Number);
    const nd = new Date(y, mo - 1, d + delta);
    onChange(time, `${nd.getFullYear()}-${pad(nd.getMonth() + 1)}-${pad(nd.getDate())}`);
  }

  function handleHourWheel(e: React.WheelEvent) { e.preventDefault(); adjustHour(e.deltaY > 0 ? -1 : 1); }
  function handleMinWheel(e: React.WheelEvent) { e.preventDefault(); adjustMin(e.deltaY > 0 ? -1 : 1); }

  const isToday = date === todayStr();
  const isNow   = isToday && time === nowTimeStr();

  const numStyle: React.CSSProperties = {
    fontFamily: "'Space Mono', monospace", fontWeight: 700,
    fontSize: compact ? 20 : 26, color: 'var(--text)', lineHeight: 1,
    cursor: 'ns-resize', userSelect: 'none', padding: '0 2px',
    transition: 'color 0.1s',
  };
  const arrStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', fontSize: compact ? 9 : 11, padding: '1px 4px',
    lineHeight: 1,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 4 : 6 }}>
      {/* HH : MM */}
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 2 : 4 }}>
        {/* Hours */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <button style={arrStyle} onClick={() => adjustHour(1)}>▲</button>
          <span style={numStyle} onWheel={handleHourWheel}>{pad(h)}</span>
          <button style={arrStyle} onClick={() => adjustHour(-1)}>▼</button>
        </div>
        <span style={{
          fontFamily: "'Space Mono', monospace", fontWeight: 700,
          fontSize: compact ? 20 : 26, color: 'var(--text-muted)',
        }}>:</span>
        {/* Minutes */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <button style={arrStyle} onClick={() => adjustMin(1)}>▲</button>
          <span style={numStyle} onWheel={handleMinWheel}>{pad(m)}</span>
          <button style={arrStyle} onClick={() => adjustMin(-1)}>▼</button>
        </div>
        {/* Now pill */}
        {!isNow && (
          <button
            onClick={() => onChange(nowTimeStr(), todayStr())}
            style={{
              marginLeft: compact ? 4 : 8, padding: '3px 8px', borderRadius: 20,
              background: 'var(--accent-dim)', border: '1px solid rgba(124,106,255,0.3)',
              color: 'var(--accent)', fontSize: 10, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >Now</button>
        )}
      </div>

      {/* Date row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 4 : 8 }}>
        <button
          onClick={() => adjustDate(-1)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 14, padding: '2px 4px',
          }}
        >‹</button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
          {formatDateLabel(date)}
        </span>
        <button
          onClick={() => adjustDate(1)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 14, padding: '2px 4px',
          }}
        >›</button>
      </div>
    </div>
  );
}

// ── Offset pill ───────────────────────────────────────────────────────────────

function OffsetPill({ diff, dayDiff }: { diff: string; dayDiff: number }) {
  const isSame = diff === '0 hours' || diff === '0h';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {dayDiff !== 0 && (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10,
          background: dayDiff > 0 ? 'rgba(61,232,176,0.15)' : 'rgba(245,158,11,0.15)',
          color: dayDiff > 0 ? 'var(--teal)' : 'var(--color-warning)',
          border: `1px solid ${dayDiff > 0 ? 'rgba(61,232,176,0.3)' : 'rgba(245,158,11,0.3)'}`,
        }}>
          {dayDiff > 0 ? `+${dayDiff}d` : `${dayDiff}d`}
        </span>
      )}
      <span style={{
        fontSize: 13, fontWeight: 700, padding: '4px 10px', borderRadius: 12,
        background: isSame ? 'var(--surface3)' : 'var(--accent-dim)',
        color: isSame ? 'var(--text-muted)' : 'var(--accent)',
        border: `1px solid ${isSame ? 'var(--border)' : 'rgba(124,106,255,0.3)'}`,
        whiteSpace: 'nowrap', fontFamily: "'Space Mono', monospace",
      }}>
        {isSame ? '= same' : diff}
      </span>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export function TimezoneWidget({ onClose: _onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize]     = useState({ w: 0, h: 0 });

  const persisted = useMemo(() => readPersisted(), []);
  const [fromLoc, setFromLoc] = useState<SelectedLocation | null>(persisted.from);
  const [toLoc,   setToLoc]   = useState<SelectedLocation | null>(persisted.to);
  const [recentPairs, setRecentPairs] = useState(persisted.recentPairs);
  const [swapping, setSwapping] = useState(false);

  const [isManualTime, setIsManualTime] = useState(false);
  const [inputTime, setInputTime] = useState(nowTimeStr);
  const [inputDate, setInputDate] = useState(todayStr);
  const [conversion, setConversion] = useState<ConvertResult | null>(null);

  // Keep inputTime/inputDate in sync with the FROM timezone's current time
  // unless the user has manually overridden the picker.
  function getFromTzTime(tz: string): { time: string; date: string } {
    const now = new Date();
    const t = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now);
    const d = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    return { time: t, date: d };
  }

  const [hasLoaded, setHasLoaded] = useState(() => persisted.from !== null || persisted.to !== null);
  useWidgetReady('timezone', hasLoaded);

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

  // Mark ready immediately (no required data fetch)
  useEffect(() => { setHasLoaded(true); }, []);

  // Persist whenever locations change
  useEffect(() => {
    const p: Persisted = { from: fromLoc, to: toLoc, recentPairs };
    writePersisted(p);
  }, [fromLoc, toLoc, recentPairs]);

  // Trigger conversion whenever any input changes
  const convertRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!fromLoc || !toLoc) { setConversion(null); return; }
    clearTimeout(convertRef.current);
    convertRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(
          `/api/timezone/convert?from=${encodeURIComponent(fromLoc.timezone)}` +
          `&to=${encodeURIComponent(toLoc.timezone)}` +
          `&time=${encodeURIComponent(inputTime)}` +
          `&date=${encodeURIComponent(inputDate)}`,
        );
        if (res.ok) setConversion(await res.json() as ConvertResult);
      } catch { /* silent */ }
    }, 200);
    return () => clearTimeout(convertRef.current);
  }, [fromLoc, toLoc, inputTime, inputDate]);

  function handleSwap() {
    setSwapping(true);
    setTimeout(() => {
      setFromLoc(toLoc);
      setToLoc(fromLoc);
      setSwapping(false);
    }, 150);
  }

  // Sync time picker to FROM timezone whenever it changes (or on a 30s tick)
  useEffect(() => {
    if (!fromLoc || isManualTime) return;
    const sync = () => {
      const { time, date } = getFromTzTime(fromLoc.timezone);
      setInputTime(time);
      setInputDate(date);
    };
    sync();
    const id = setInterval(sync, 30_000);
    return () => clearInterval(id);
  }, [fromLoc, isManualTime]);

  function handleFromSelect(loc: SelectedLocation) {
    setFromLoc(loc);
    if (!isManualTime) {
      const { time, date } = getFromTzTime(loc.timezone);
      setInputTime(time);
      setInputDate(date);
    }
    if (toLoc) addRecentPair(loc, toLoc);
  }
  function handleToSelect(loc: SelectedLocation) {
    setToLoc(loc);
    if (fromLoc) addRecentPair(fromLoc, loc);
  }
  function addRecentPair(from: SelectedLocation, to: SelectedLocation) {
    setRecentPairs(prev => {
      const key = `${from.timezone}:${to.timezone}`;
      const filtered = prev.filter(p => `${p.from.timezone}:${p.to.timezone}` !== key);
      return [{ from, to }, ...filtered].slice(0, 5);
    });
  }

  const mode = getLayoutMode(size.w, size.h);
  const compact = mode === 'micro' || mode === 'slim' || mode === 'compact';
  const showSeconds = mode === 'expanded' || mode === 'standard';
  const showRecentPairs = (mode === 'expanded' || mode === 'standard') && recentPairs.length > 0;

  // ── Micro mode ─────────────────────────────────────────────────────────────
  if (mode === 'micro') {
    if (!fromLoc && !toLoc) {
      return (
        <div ref={containerRef} style={rootStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 6, padding: 12 }}>
            <span style={{ fontSize: 28 }}>🕐</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              Resize to set up
            </span>
          </div>
        </div>
      );
    }
    return (
      <div ref={containerRef} style={rootStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 10px', gap: 4 }}>
          {fromLoc && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 14 }}>{fromLoc.flag}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{fromLoc.name}</div>
              <ClockDisplay timezone={fromLoc.timezone} mode="micro" />
            </div>
          )}
          {fromLoc && toLoc && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              {conversion ? (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                  background: 'var(--accent-dim)', color: 'var(--accent)',
                  fontFamily: "'Space Mono', monospace",
                }}>
                  {conversion.offsetDifference === '0 hours' ? '= same' : conversion.offsetDifference}
                </span>
              ) : <div style={{ height: 1, width: '60%', background: 'var(--border)' }} />}

            </div>
          )}
          {toLoc && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 14 }}>{toLoc.flag}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{toLoc.name}</div>
              <ClockDisplay timezone={toLoc.timezone} mode="micro" isResult />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Slim / Compact / Standard / Expanded ──────────────────────────────────
  const panelStyle: React.CSSProperties = {
    flex: 1, background: 'var(--surface2)', borderRadius: 10,
    border: '1px solid var(--border)', padding: compact ? '10px 10px' : '14px 14px',
    display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8, minWidth: 0,
    overflow: 'hidden',
  };

  const panelAnim: React.CSSProperties = swapping ? {
    animation: 'tz-swap-out 0.15s ease-in both',
  } : {};

  return (
    <div ref={containerRef} style={rootStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: compact ? 6 : 8, padding: compact ? 8 : 12, boxSizing: 'border-box' }}>

        {/* ── Two panels ── */}
        <div style={{
          display: 'flex',
          flexDirection: mode === 'slim' ? 'column' : 'row',
          gap: compact ? 6 : 10, flex: 1, minHeight: 0,
        }}>

          {/* FROM panel */}
          <div style={{ ...panelStyle, ...panelAnim }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>From</div>
            <SearchInput
              selected={fromLoc}
              onSelect={handleFromSelect}
              onClear={() => setFromLoc(null)}
              autoFocus={!fromLoc}
              compact={compact}
            />
            {fromLoc && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <ClockDisplay timezone={fromLoc.timezone} mode={mode} showSeconds={showSeconds} />
                {(mode === 'standard' || mode === 'expanded') && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fromLoc.utcOffset}</span>
                    {conversion?.fromDST && (
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                        background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                        border: '1px solid rgba(245,158,11,0.3)',
                      }}>DST</span>
                    )}
                  </div>
                )}
              </div>
            )}
            {!fromLoc && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 28 }}>🕐</span>
              </div>
            )}
          </div>

          {/* Center column: swap + time picker */}
          {mode !== 'slim' && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: compact ? 8 : 12, flexShrink: 0,
              minWidth: compact ? 50 : 80,
            }}>
              {/* Swap button */}
              <button
                onClick={handleSwap}
                title="Swap locations"
                style={{
                  background: 'var(--surface3)', border: '1px solid var(--border)',
                  borderRadius: '50%', width: compact ? 28 : 34, height: compact ? 28 : 34,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: compact ? 14 : 16, color: 'var(--text-muted)', flexShrink: 0,
                  transition: 'background 0.15s, color 0.15s, transform 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.color = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface3)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >⇄</button>

              {/* Offset pill — show always once loaded; in live mode dayDiff is 0 */}
              {conversion && (
                <OffsetPill
                  diff={conversion.offsetDifference}
                  dayDiff={isManualTime ? conversion.dayDiff : 0}
                />
              )}

              {/* Time picker */}
              {(mode === 'standard' || mode === 'expanded') && (
                <TimePicker
                  time={inputTime}
                  date={inputDate}
                  onChange={(t, d) => {
                    // Check if user pressed "Now" (matches current from-tz time)
                    const fromNow = fromLoc ? getFromTzTime(fromLoc.timezone) : null;
                    const isNowReset = fromNow && t === fromNow.time && d === fromNow.date;
                    setIsManualTime(!isNowReset);
                    setInputTime(t);
                    setInputDate(d);
                  }}
                  compact={mode === 'standard'}
                />
              )}
            </div>
          )}

          {/* TO panel */}
          <div style={{ ...panelStyle, ...panelAnim }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-faint)', textTransform: 'uppercase' }}>To</div>
            <SearchInput
              selected={toLoc}
              onSelect={handleToSelect}
              onClear={() => setToLoc(null)}
              compact={compact}
            />
            {toLoc && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                {/* Live mode: always show ClockDisplay — stable size, no API-load flicker.
                    Manual mode: show the converted time from the API. */}
                {isManualTime && conversion ? (
                  <>
                    <div style={{
                      fontFamily: "'Space Mono', monospace", fontWeight: 700,
                      fontSize: mode === 'compact' ? 30 : mode === 'standard' ? 36 : 42,
                      color: 'var(--accent)', lineHeight: 1.1, textAlign: 'center',
                    }}>
                      {conversion.toTime}
                    </div>
                    {mode !== 'compact' && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{conversion.toDate}</div>
                    )}
                    {(mode === 'standard' || mode === 'expanded') && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{conversion.toOffset}</span>
                        {conversion.toDST && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                            background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                            border: '1px solid rgba(245,158,11,0.3)',
                          }}>DST</span>
                        )}
                        {conversion.fromDST !== conversion.toDST && (
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            ⚠️ Offset includes DST
                          </span>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <ClockDisplay timezone={toLoc.timezone} mode={mode} showSeconds={showSeconds} isResult />
                    {(mode === 'standard' || mode === 'expanded') && conversion && (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{conversion.toOffset}</span>
                        {conversion.toDST && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                            background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                            border: '1px solid rgba(245,158,11,0.3)',
                          }}>DST</span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {!toLoc && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 28 }}>🕑</span>
              </div>
            )}
          </div>
        </div>

        {/* Slim mode: swap + offset pill row */}
        {mode === 'slim' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <button
              onClick={handleSwap}
              style={{
                background: 'var(--surface3)', border: '1px solid var(--border)',
                borderRadius: '50%', width: 26, height: 26, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: 'var(--text-muted)', transform: 'rotate(90deg)',
              }}
            >⇄</button>
            {conversion && <OffsetPill diff={conversion.offsetDifference} dayDiff={isManualTime ? conversion.dayDiff : 0} />}
          </div>
        )}

        {/* Compact mode: time picker row */}
        {mode === 'compact' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <TimePicker
              time={inputTime}
              date={inputDate}
              onChange={(t, d) => {
                const fromNow = fromLoc ? getFromTzTime(fromLoc.timezone) : null;
                const isNowReset = fromNow && t === fromNow.time && d === fromNow.date;
                setIsManualTime(!isNowReset);
                setInputTime(t);
                setInputDate(d);
              }}
              compact
            />
          </div>
        )}

        {/* Recent pairs */}
        {showRecentPairs && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingTop: 4 }}>
            {recentPairs.map((pair, i) => (
              <button
                key={i}
                onClick={() => { setFromLoc(pair.from); setToLoc(pair.to); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '3px 8px', fontSize: 11,
                  color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit',
                  whiteSpace: 'nowrap', transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface2)'; }}
              >
                {pair.from.flag} {pair.from.name} ⇄ {pair.to.flag} {pair.to.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes tz-spin { to { transform: rotate(360deg); } }
        @keyframes tz-drop {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes tz-tick {
          from { transform: scaleY(0.85); }
          to   { transform: scaleY(1); }
        }
        @keyframes tz-swap-out {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(20px); }
        }
      `}</style>
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column',
  boxSizing: 'border-box',
};
