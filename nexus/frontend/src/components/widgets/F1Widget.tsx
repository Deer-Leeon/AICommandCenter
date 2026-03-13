import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../../lib/api';
import { wcRead, wcWrite, WC_KEY } from '../../lib/widgetCache';
import { useWidgetReady } from '../../hooks/useWidgetReady';

// ── Team data ─────────────────────────────────────────────────────────────────

const F1_TEAMS = [
  { id: 'mclaren',      name: 'McLaren',          short: 'MCL', primary: '#FF8000', secondary: '#000000', drivers: ['Lando Norris', 'Oscar Piastri'] },
  { id: 'ferrari',      name: 'Ferrari',           short: 'FER', primary: '#E8002D', secondary: '#FFFFFF', drivers: ['Charles Leclerc', 'Lewis Hamilton'] },
  { id: 'redbull',      name: 'Red Bull Racing',   short: 'RBR', primary: '#3671C6', secondary: '#CC1E4A', drivers: ['Max Verstappen', 'Isack Hadjar'] },
  { id: 'mercedes',     name: 'Mercedes',          short: 'MER', primary: '#27F4D2', secondary: '#000000', drivers: ['George Russell', 'Kimi Antonelli'] },
  { id: 'aston_martin', name: 'Aston Martin',      short: 'AMR', primary: '#229971', secondary: '#B0C414', drivers: ['Fernando Alonso', 'Lance Stroll'] },
  { id: 'alpine',       name: 'Alpine',            short: 'ALP', primary: '#0090FF', secondary: '#FF87BC', drivers: ['Pierre Gasly', 'Jack Doohan'] },
  { id: 'williams',     name: 'Williams',          short: 'WIL', primary: '#1B3A6B', secondary: '#64C8FF', drivers: ['Alex Albon', 'Carlos Sainz'] },
  { id: 'racing_bulls', name: 'Racing Bulls',      short: 'RBB', primary: '#FFFFFF', secondary: '#4B72CC', drivers: ['Liam Lawson', 'Arvid Lindblad'] },
  { id: 'haas',         name: 'Haas',              short: 'HAS', primary: '#E8002D', secondary: '#FFFFFF', drivers: ['Ollie Bearman', 'Esteban Ocon'] },
  { id: 'audi',         name: 'Audi',              short: 'AUD', primary: '#9B9B9B', secondary: '#BB0000', drivers: ['Nico Hülkenberg', 'Gabriel Bortoleto'] },
  { id: 'cadillac',     name: 'Cadillac',          short: 'CAD', primary: '#FFFFFF', secondary: '#000000', drivers: ['Sergio Perez', 'Valtteri Bottas'] },
] as const;

type TeamId = typeof F1_TEAMS[number]['id'];

function getTeamByDriverName(name: string) {
  const lower = name.toLowerCase();
  return F1_TEAMS.find(t =>
    t.drivers.some(d => lower.includes(d.toLowerCase().split(' ').pop()!))
  ) ?? null;
}

function getTeamByConstructorId(id: string): typeof F1_TEAMS[number] | null {
  const lower = id.toLowerCase();
  if (lower.includes('mclaren'))    return F1_TEAMS[0];
  if (lower.includes('ferrari'))    return F1_TEAMS[1];
  if (lower.includes('red_bull') || lower.includes('redbull')) return F1_TEAMS[2];
  if (lower.includes('mercedes'))   return F1_TEAMS[3];
  if (lower.includes('aston'))      return F1_TEAMS[4];
  if (lower.includes('alpine') || lower.includes('renault')) return F1_TEAMS[5];
  if (lower.includes('williams'))   return F1_TEAMS[6];
  if (lower.includes('racing_bulls') || lower.includes('alphatauri') || lower.includes('toro')) return F1_TEAMS[7];
  if (lower.includes('haas'))       return F1_TEAMS[8];
  if (lower.includes('sauber') || lower.includes('audi') || lower.includes('alfa')) return F1_TEAMS[9];
  if (lower.includes('cadillac') || lower.includes('andretti')) return F1_TEAMS[10];
  return null;
}

function getTeamById(id: string): typeof F1_TEAMS[number] | null {
  return F1_TEAMS.find(t => t.id === id) ?? null;
}

// ── API types ─────────────────────────────────────────────────────────────────

interface F1NextRace { name: string; circuit: string; country: string; date: string; round: number }
interface F1NextSession {
  type: 'fp1' | 'fp2' | 'fp3' | 'qualifying' | 'sprint' | 'race';
  label: string;
  date: string;
  round: number;
  raceName: string;
  circuit: string;
  country: string;
}
interface F1CurrentSession { type: string; name: string; status: string; sessionKey: number }
interface F1Status {
  mode: 'off_season' | 'race_weekend' | 'between_races';
  nextRace: F1NextRace | null;
  nextSession: F1NextSession | null;
  currentSession: F1CurrentSession | null;
  isLive: boolean;
  daysUntilNextRace: number;
}

interface F1DriverStanding {
  position: number; points: number; wins: number;
  driverId: string; code: string; givenName: string; familyName: string;
  constructorId: string; constructorName: string; gapToLeader: number;
}
interface F1ConstructorStanding {
  position: number; points: number; wins: number;
  constructorId: string; name: string; gapToLeader: number;
}
interface F1Standings { drivers: F1DriverStanding[]; constructors: F1ConstructorStanding[] }

interface F1RaceEntry {
  round: number; name: string; circuit: string; country: string;
  locality: string; date: string; time: string | null;
  sessions: { fp1: { date: string; time: string } | null; fp2: { date: string; time: string } | null; fp3: { date: string; time: string } | null; qualifying: { date: string; time: string } | null; sprint: { date: string; time: string } | null };
}
interface F1Schedule { season: string; races: F1RaceEntry[] }

interface F1RaceResult {
  position: number; driverCode: string; givenName: string; familyName: string;
  constructorId: string; constructorName: string; points: number;
  grid: number; laps: number; status: string; time: string | null; hasFastestLap: boolean;
}
interface F1LastRace {
  round: number; name: string; circuit: string; country: string; date: string;
  results: F1RaceResult[];
  fastestLap: { driverCode: string; time: string } | null;
}

interface LiveDriver {
  position: number; driverNumber: number; driverCode: string; driverName: string;
  teamId: string; lastLapTime: string; lapDurationSec: number | null;
  gapToLeader: string; intervalToAhead: string;
  currentTire: { compound: string; lapsOnTire: number };
  inPit: boolean; pitStops: number;
  sector1: string; sector2: string; sector3: string;
  speed: number; isFastestLap: boolean;
}
interface F1Live {
  sessionType: string; sessionName: string; sessionStatus: string;
  circuitName: string; meetingName: string; currentLap: number; fastestLapDriver: number;
  weather: { trackTemp: number; airTemp: number; humidity: number; rainfall: number; windSpeed: number } | null;
  raceControlMessages: { message: string; flag: string; category: string; timestamp: string; lap: number | null }[];
  drivers: LiveDriver[];
}

// ── Layout modes ──────────────────────────────────────────────────────────────

type LayoutMode = 'micro' | 'slim' | 'compact' | 'standard' | 'expanded';

function getLayoutMode(w: number, _h: number): LayoutMode {
  if (w < 255)  return 'micro';
  if (w < 390)  return 'slim';
  if (w < 540)  return 'compact';
  if (w < 780)  return 'standard';
  return 'expanded';
}

// ── Tire badge ────────────────────────────────────────────────────────────────

const TIRE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  SOFT:         { bg: '#E8002D', text: '#fff', label: 'S' },
  MEDIUM:       { bg: '#FFD700', text: '#111', label: 'M' },
  HARD:         { bg: '#CCCCCC', text: '#111', label: 'H' },
  INTERMEDIATE: { bg: '#39B54A', text: '#fff', label: 'I' },
  WET:          { bg: '#0067FF', text: '#fff', label: 'W' },
  UNKNOWN:      { bg: '#444',    text: '#aaa', label: '?' },
};

function TireBadge({ compound, laps, small }: { compound: string; laps?: number; small?: boolean }) {
  const tc = TIRE_COLORS[compound] ?? TIRE_COLORS.UNKNOWN;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <div style={{
        width: small ? 18 : 22, height: small ? 18 : 22, borderRadius: '50%',
        background: tc.bg, color: tc.text,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: small ? 9 : 11, fontWeight: 700, fontFamily: 'monospace',
        flexShrink: 0,
      }}>
        {tc.label}
      </div>
      {laps !== undefined && laps > 0 && (
        <span style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'monospace', lineHeight: 1 }}>
          {laps}L
        </span>
      )}
    </div>
  );
}

// ── Track status pill ─────────────────────────────────────────────────────────

function getTrackStatus(messages: F1Live['raceControlMessages']) {
  if (!messages.length) return { color: '#00D2BE', label: '● GREEN' };
  const latest = messages[0];
  const flag = latest.flag?.toUpperCase() ?? '';
  if (flag === 'RED')                          return { color: '#E8002D', label: '● RED FLAG', pulse: true };
  if (flag === 'SAFETY_CAR')                   return { color: '#FFA500', label: '🚗 SAFETY CAR' };
  if (flag === 'VIRTUAL_SAFETY_CAR')           return { color: '#FFA500', label: '🚗 VSC' };
  if (flag === 'YELLOW' || flag === 'YELLOW_FLAG') return { color: '#FFD700', label: '⚠ YELLOW' };
  if (flag === 'GREEN' || flag === 'GREEN_FLAG')    return { color: '#00D2BE', label: '● GREEN' };
  if (flag === 'CHEQUERED')                    return { color: '#fff', label: '🏁 CHEQUERED' };
  return { color: '#00D2BE', label: '● GREEN' };
}

// ── Countdown helper ──────────────────────────────────────────────────────────

function useCountdown(targetDate: string | null, format: false | 'short' | 'medium' = false): string {
  const [display, setDisplay] = useState('');
  useEffect(() => {
    if (!targetDate) { setDisplay(''); return; }
    const update = () => {
      const ms = new Date(targetDate).getTime() - Date.now();
      if (ms <= 0) { setDisplay('00d 00h 00m 00s'); return; }
      const d = Math.floor(ms / 86_400_000);
      const h = Math.floor((ms % 86_400_000) / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1000);
      if (format === 'short') {
        setDisplay(`${d}d ${h.toString().padStart(2,'0')}h`);
      } else if (format === 'medium') {
        setDisplay(`${d}d ${h.toString().padStart(2,'0')}h ${m.toString().padStart(2,'0')}m`);
      } else {
        setDisplay(
          `${d.toString().padStart(2,'0')}d  ${h.toString().padStart(2,'0')}h  ${m.toString().padStart(2,'0')}m  ${s.toString().padStart(2,'0')}s`
        );
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [targetDate, format]);
  return display;
}

// ── Country flag emoji ────────────────────────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  Australia: '🇦🇺', Bahrain: '🇧🇭', 'Saudi Arabia': '🇸🇦', Japan: '🇯🇵', China: '🇨🇳',
  USA: '🇺🇸', 'United States': '🇺🇸', Monaco: '🇲🇨', Canada: '🇨🇦', Spain: '🇪🇸',
  Austria: '🇦🇹', UK: '🇬🇧', 'United Kingdom': '🇬🇧', Hungary: '🇭🇺', Belgium: '🇧🇪',
  Netherlands: '🇳🇱', Italy: '🇮🇹', Azerbaijan: '🇦🇿', Singapore: '🇸🇬', Mexico: '🇲🇽',
  Brazil: '🇧🇷', 'Abu Dhabi': '🇦🇪', UAE: '🇦🇪', Qatar: '🇶🇦',
};
const flagFor = (c: string) => COUNTRY_FLAGS[c] ?? '🏁';

// ── Format date ───────────────────────────────────────────────────────────────

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtSessionDay(dateStr: string): string {
  // dateStr may already be a full ISO string — don't re-append 'T'
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00Z');
  if (isNaN(d.getTime())) return '?';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()}`;
}

function fmtSessionTime(dateStr: string): string {
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '';
  return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')}`;
}

function weekendRange(race: F1RaceEntry): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sessionDates = [race.sessions.fp1, race.sessions.fp2, race.sessions.fp3, race.sessions.qualifying, race.sessions.sprint]
    .filter(Boolean).map(s => s!.date);
  const allDates = [...sessionDates, race.date].sort();
  const start = new Date(allDates[0] + 'T12:00:00Z');
  const end   = new Date(race.date + 'T12:00:00Z');
  const sm = MONTHS[start.getUTCMonth()], em = MONTHS[end.getUTCMonth()];
  return sm === em
    ? `${sm} ${start.getUTCDate()}–${end.getUTCDate()}`
    : `${sm} ${start.getUTCDate()} – ${em} ${end.getUTCDate()}`;
}

// Build ordered session list — sprint weekends use different labels
function raceSessionsInOrder(race: F1RaceEntry): { label: string; date: string; color: string; dimmed: boolean }[] {
  const out: { label: string; date: string; color: string; dimmed: boolean }[] = [];
  const isSprint = !!race.sessions.sprint;
  const add = (s: { date: string; time: string } | null, label: string, color: string, dimmed: boolean) => {
    if (s) out.push({ label, date: s.date + 'T' + (s.time ?? '00:00:00Z'), color, dimmed });
  };
  if (isSprint) {
    add(race.sessions.fp1,        'Practice',   'rgba(255,255,255,0.38)', true);
    add(race.sessions.fp2,        'Sprint Q',   '#9B8FFF',                false);
    add(race.sessions.sprint,     'Sprint',     '#FF8000',                false);
    add(race.sessions.qualifying, 'Qualifying', '#FFD700',                false);
  } else {
    add(race.sessions.fp1,        'Practice 1', 'rgba(255,255,255,0.35)', true);
    add(race.sessions.fp2,        'Practice 2', 'rgba(255,255,255,0.35)', true);
    add(race.sessions.fp3,        'Practice 3', 'rgba(255,255,255,0.35)', true);
    add(race.sessions.qualifying, 'Qualifying', '#FFD700',                false);
  }
  out.push({ label: 'Race', date: race.date + 'T' + (race.time ?? '00:00:00Z'), color: '#E8002D', dimmed: false });
  return out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ── CSS animations ────────────────────────────────────────────────────────────

const F1_CSS = `
  @keyframes f1-flash-up   { 0%,100%{background:transparent} 25%{background:rgba(0,210,190,0.35)} }
  @keyframes f1-flash-down { 0%,100%{background:transparent} 25%{background:rgba(232,0,45,0.3)} }
  @keyframes f1-pit-pulse  { 0%,100%{background:rgba(255,215,0,0.05)} 50%{background:rgba(255,215,0,0.14)} }
  @keyframes f1-red-pulse  { 0%,100%{opacity:1} 50%{opacity:0.5} }
  .f1-row-up   { animation: f1-flash-up   0.8s ease; }
  .f1-row-down { animation: f1-flash-down 0.8s ease; }
  .f1-pit-row  { animation: f1-pit-pulse  1.5s infinite; }
  .f1-red-pill { animation: f1-red-pulse  1.2s infinite; }
  .f1-scroll { overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
  .f1-scroll::-webkit-scrollbar { width: 3px; }
  .f1-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
  .f1-tab-pill { cursor: pointer; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-family: monospace; transition: background 0.15s, color 0.15s; }
`;

// ── Sub-tab pill toggle ───────────────────────────────────────────────────────

function PillToggle<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '3px 12px', borderRadius: 999, fontSize: 11,
            fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer',
            border: '1px solid',
            borderColor: value === o.id ? 'rgba(232,0,45,0.6)' : 'var(--border)',
            background: value === o.id ? 'rgba(232,0,45,0.12)' : 'transparent',
            color: value === o.id ? '#E8002D' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Now Tab ───────────────────────────────────────────────────────────────────

function NowTab({
  status, standings, lastRace, live, mode, compact,
}: {
  status: F1Status | null;
  standings: F1Standings | null;
  lastRace: F1LastRace | null;
  live: F1Live | null;
  mode: LayoutMode;
  compact: boolean;
}) {
  const nextTarget = status?.nextSession ?? status?.nextRace;
  const countdown = useCountdown(
    nextTarget ? ('date' in nextTarget ? nextTarget.date : status?.nextRace?.date ?? null) : null,
    mode === 'slim'
  );
  const countdownToGP = useCountdown(status?.nextRace?.date ?? null, 'medium');
  const showGPCountdown = status?.nextSession && status.nextSession.type !== 'race' && status.nextRace;

  if (status?.isLive && live) {
    return <LiveTimingContent live={live} mode={mode} compact={compact} />;
  }

  if (status?.mode === 'off_season') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, padding: '12px 8px', textAlign: 'center' }}>
        <span style={{ fontSize: 32 }}>🏎️</span>
        <span style={{ fontFamily: '"DM Serif Display", Georgia, serif', fontSize: mode === 'micro' ? 14 : 18, color: 'var(--text)', fontWeight: 400 }}>Off Season</span>
        {nextTarget && (
          <>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)' }}>
              {status.nextSession ? status.nextSession.label : 'Next race'}
            </span>
            <span style={{ fontFamily: 'monospace', fontSize: mode === 'micro' ? 20 : 28, fontWeight: 700, color: '#E8002D', letterSpacing: '-0.5px' }}>{countdown}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {status.nextSession ? `${status.nextSession.raceName} · ${status.nextSession.label}` : status.nextRace?.name}
            </span>
          </>
        )}
      </div>
    );
  }

  const top5 = standings?.drivers.slice(0, compact ? 3 : 5) ?? [];
  const podium = lastRace?.results.slice(0, 3) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Countdown card — big = next session (qualifying, sprint, or GP); small = next GP when different */}
      {nextTarget && (
        <div style={{ padding: compact ? '8px 10px 6px' : '10px 12px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 11 }}>{flagFor('country' in nextTarget ? nextTarget.country : status?.nextRace?.country ?? '')}</span>
            <span style={{ fontFamily: '"DM Serif Display", Georgia, serif', fontSize: compact ? 13 : 15, color: 'var(--text)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {status?.nextSession
                ? `${status.nextSession.raceName.replace(' Grand Prix', '')} · ${status.nextSession.label}`
                : status?.nextRace?.name}
            </span>
          </div>
          <span style={{ fontFamily: 'monospace', fontSize: compact ? 22 : 28, fontWeight: 700, color: '#E8002D', letterSpacing: '-1px', display: 'block' }}>
            {countdown}
          </span>
          {showGPCountdown && (
            <div style={{ marginTop: 6, padding: '8px 10px', background: 'rgba(255,255,255,0.08)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'monospace', fontWeight: 600 }}>
                  Next GP:
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.5px' }}>
                  {countdownToGP}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'monospace', marginTop: 4, lineHeight: 1.4, fontWeight: 500 }}>
                Rd {('round' in nextTarget ? nextTarget.round : status?.nextRace?.round) ?? ''} · {('circuit' in nextTarget ? nextTarget.circuit : status?.nextRace?.circuit) ?? ''}
              </div>
            </div>
          )}
          {!showGPCountdown && (
            <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'monospace', display: 'block', marginTop: 2 }}>
              Rd {('round' in nextTarget ? nextTarget.round : status?.nextRace?.round) ?? ''} · {('circuit' in nextTarget ? nextTarget.circuit : status?.nextRace?.circuit) ?? ''}
            </span>
          )}
        </div>
      )}

      {/* Top standings */}
      {top5.length > 0 && (
        <div className="f1-scroll" style={{ flex: 1, overflow: 'hidden auto', padding: '4px 0' }}>
          {top5.map((d, i) => {
            const team = getTeamByConstructorId(d.constructorId);
            const color = team?.primary ?? '#888';
            return (
              <div key={d.driverId} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: compact ? '3px 10px' : '4px 12px',
                background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
              }}>
                <div style={{ width: 4, height: compact ? 26 : 30, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: d.position === 1 ? 'rgba(255,215,0,0.9)' : 'var(--text)', width: 18, textAlign: 'right', flexShrink: 0 }}>
                  {d.position}
                </span>
                <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.givenName}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.familyName}</span>
                    {d.position === 1 && <span style={{ fontSize: 9 }}>🏆</span>}
                  </div>
                  {!compact && <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'monospace' }}>{d.constructorName}</span>}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--text)', display: 'block' }}>{d.points}</span>
                  {d.gapToLeader > 0 && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(232,0,45,0.8)' }}>–{d.gapToLeader}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Last race strip */}
      {lastRace && !compact && podium.length > 0 && (
        <div style={{ padding: '5px 12px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface2)' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Last Race · {lastRace.name}
          </span>
          <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
            {podium.map(r => {
              const team = getTeamByConstructorId(r.constructorId);
              return (
                <div key={r.position} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: ['#FFD700', '#C0C0C0', '#CD7F32'][r.position - 1] }}>P{r.position}</span>
                  <div style={{ width: 2, height: 12, borderRadius: 1, background: team?.primary ?? '#888' }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{r.familyName}</span>
                </div>
              );
            })}
            {lastRace.fastestLap && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}>
                <span style={{ fontSize: 10 }}>💜</span>
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#bf00ff' }}>{lastRace.fastestLap.driverCode} {lastRace.fastestLap.time}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Standings Tab ─────────────────────────────────────────────────────────────

function StandingsTab({ standings, mode }: { standings: F1Standings | null; mode: LayoutMode }) {
  const [sub, setSub] = useState<'drivers' | 'constructors'>('drivers');
  const isCompact = mode === 'micro' || mode === 'slim' || mode === 'compact';

  if (!standings) return <CenteredMsg icon="🏆" text="Loading standings…" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '4px 10px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        <PillToggle
          options={[{ id: 'drivers', label: 'Drivers' }, { id: 'constructors', label: 'Constructors' }]}
          value={sub}
          onChange={setSub}
        />
      </div>

      <div className="f1-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {sub === 'drivers' && standings.drivers.map((d, i) => {
          const team = getTeamByConstructorId(d.constructorId);
          const color = d.position === 1 ? 'rgba(255,215,0,0.85)' : (team?.primary ?? '#888');
          return (
            <div key={d.driverId} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: isCompact ? '4px 10px' : '5px 12px',
              background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
            }}>
              <div style={{ width: 4, height: isCompact ? 28 : 34, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: d.position === 1 ? 'rgba(255,215,0,0.9)' : 'var(--text)', width: 18, textAlign: 'right', flexShrink: 0 }}>
                {d.position}
              </span>
              <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.givenName}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.familyName}</span>
                  {d.position === 1 && <span style={{ fontSize: 9 }}>🏆</span>}
                </div>
                {!isCompact && <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'monospace' }}>{d.constructorName}</span>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--text)', display: 'block' }}>{d.points}</span>
                {d.gapToLeader > 0 && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(232,0,45,0.8)' }}>–{d.gapToLeader}</span>}
              </div>
            </div>
          );
        })}

        {sub === 'constructors' && standings.constructors.map((c, i) => {
          const team = getTeamByConstructorId(c.constructorId);
          const color = team?.primary ?? '#888';
          const drivers = team?.drivers ?? [];
          return (
            <div key={c.constructorId} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: isCompact ? '4px 10px' : '5px 12px',
              background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
            }}>
              <div style={{ width: 4, height: isCompact ? 30 : 44, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: 'var(--text)', width: 18, textAlign: 'right', flexShrink: 0 }}>{c.position}</span>
              <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                {!isCompact && drivers.length > 0 && (
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'monospace' }}>
                    {drivers.join(' · ')}
                  </span>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--text)', display: 'block' }}>{c.points}</span>
                {c.gapToLeader > 0 && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(232,0,45,0.8)' }}>–{c.gapToLeader}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Live Timing content ───────────────────────────────────────────────────────

function LiveTimingContent({ live, mode, compact }: { live: F1Live; mode: LayoutMode; compact: boolean }) {
  const trackStatus = getTrackStatus(live.raceControlMessages);
  const prevPosRef = useRef<Map<number, number>>(new Map());
  const [flashMap, setFlashMap] = useState<Map<number, 'up' | 'down'>>(new Map());

  useEffect(() => {
    const newFlash = new Map<number, 'up' | 'down'>();
    for (const d of live.drivers) {
      const prev = prevPosRef.current.get(d.driverNumber);
      if (prev !== undefined && prev !== d.position) {
        newFlash.set(d.driverNumber, d.position < prev ? 'up' : 'down');
      }
    }
    if (newFlash.size > 0) {
      setFlashMap(newFlash);
      const id = setTimeout(() => setFlashMap(new Map()), 900);
      return () => clearTimeout(id);
    }
    for (const d of live.drivers) prevPosRef.current.set(d.driverNumber, d.position);
  }, [live.drivers]);

  useEffect(() => {
    for (const d of live.drivers) prevPosRef.current.set(d.driverNumber, d.position);
  });

  const showAll     = mode === 'standard' || mode === 'expanded';
  const showSectors = mode === 'expanded';
  const rowLimit    = mode === 'micro' ? 3 : mode === 'slim' ? 5 : mode === 'compact' ? 10 : 20;
  const rowH        = mode === 'micro' ? 22 : mode === 'compact' ? 26 : 30;

  const latestMsg   = live.raceControlMessages[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Session header */}
      <div style={{ padding: compact ? '4px 8px' : '5px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <div
          className={trackStatus.pulse ? 'f1-red-pill' : ''}
          style={{
            padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
            fontFamily: 'monospace', background: trackStatus.color + '22',
            color: trackStatus.color, border: `1px solid ${trackStatus.color}55`, flexShrink: 0,
          }}
        >
          {trackStatus.label}
        </div>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {live.sessionType.toUpperCase()} — {live.meetingName}
        </span>
        {live.currentLap > 0 && (
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#E8002D', fontWeight: 700, flexShrink: 0 }}>
            LAP {live.currentLap}
          </span>
        )}
      </div>

      {/* Weather strip */}
      {live.weather && !compact && (
        <div style={{ padding: '3px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: 10 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)' }}>🌡 Trk {live.weather.trackTemp.toFixed(0)}°</span>
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)' }}>Air {live.weather.airTemp.toFixed(0)}°</span>
          {live.weather.rainfall > 0 && <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#4FC3F7' }}>🌧 Rain</span>}
          {showAll && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)' }}>💧 {live.weather.humidity.toFixed(0)}%</span>}
          {showAll && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)' }}>💨 {live.weather.windSpeed.toFixed(1)} m/s</span>}
        </div>
      )}

      {/* Timing tower header row */}
      {showAll && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '2px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 22, textAlign: 'right' }}>POS</span>
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', flex: 1, paddingLeft: 10 }}>DRIVER</span>
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 52, textAlign: 'right' }}>GAP</span>
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 52, textAlign: 'right' }}>INT</span>
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 26, textAlign: 'center' }}>TIRE</span>
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 62, textAlign: 'right' }}>LAP</span>
          <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 20, textAlign: 'center' }}>PIT</span>
        </div>
      )}

      {/* Driver rows */}
      <div className="f1-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {live.drivers.slice(0, rowLimit).map((d, i) => {
          const team   = getTeamById(d.teamId as TeamId) ?? getTeamByDriverName(d.driverName);
          const color  = team?.primary ?? '#888';
          const flash  = flashMap.get(d.driverNumber);
          const isFl   = d.isFastestLap;
          const lapColor = isFl ? '#bf00ff' : 'var(--text)';
          return (
            <div
              key={d.driverNumber}
              className={d.inPit ? 'f1-pit-row' : flash === 'up' ? 'f1-row-up' : flash === 'down' ? 'f1-row-down' : ''}
              style={{
                display: 'flex', alignItems: 'center', gap: 0,
                height: rowH,
                padding: showAll ? '0 10px' : '0 8px',
                background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
                transition: 'background 0.1s',
              }}
            >
              {/* Team color bar */}
              <div style={{ width: 3, height: rowH - 6, borderRadius: 2, background: color, flexShrink: 0, marginRight: showAll ? 5 : 4 }} />

              {/* Position */}
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: compact ? 11 : 13, color: 'var(--text)', width: 18, textAlign: 'right', flexShrink: 0 }}>
                {d.position}
              </span>

              {/* Driver */}
              <div style={{ flex: 1, overflow: 'hidden', paddingLeft: showAll ? 6 : 5, minWidth: 0 }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: compact ? 10 : 12, color: 'var(--text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.driverCode}
                  {!showAll && <span style={{ fontWeight: 400, color: 'var(--text-faint)', fontSize: 9, marginLeft: 3 }}>#{d.driverNumber}</span>}
                </span>
              </div>

              {showAll && (
                <>
                  {/* Gap */}
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: d.gapToLeader === 'LEADER' ? '#E8002D' : 'rgba(200,100,100,0.9)', width: 52, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.gapToLeader === 'LEADER' ? <strong style={{ color: '#E8002D' }}>LDR</strong> : d.gapToLeader}
                  </span>
                  {/* Interval */}
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', width: 52, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.intervalToAhead}
                  </span>
                </>
              )}

              {/* Tire */}
              {(mode === 'compact' || showAll) && (
                <div style={{ width: showAll ? 26 : 24, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                  <TireBadge compound={d.currentTire.compound} laps={showAll ? d.currentTire.lapsOnTire : undefined} small />
                </div>
              )}

              {showAll && (
                <>
                  {/* Lap time */}
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: lapColor, width: 62, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.lastLapTime}
                  </span>
                  {/* Pit stops */}
                  <div style={{ width: 20, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    {d.pitStops > 0 && (
                      <span style={{
                        fontFamily: 'monospace', fontSize: 9, padding: '1px 4px',
                        borderRadius: 4, background: 'rgba(255,255,255,0.08)',
                        color: 'var(--text-muted)',
                      }}>{d.pitStops}</span>
                    )}
                  </div>
                </>
              )}

              {showSectors && (
                <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
                  {[d.sector1, d.sector2, d.sector3].map((s, si) => (
                    <span key={si} style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', width: 38, textAlign: 'right' }}>{s}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Race control ticker */}
      {latestMsg && !compact && (
        <div style={{
          padding: '4px 10px', borderTop: '1px solid var(--border)', flexShrink: 0,
          background: 'var(--surface2)', overflow: 'hidden',
        }}>
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)' }}>
            {latestMsg.lap ? `LAP ${latestMsg.lap} — ` : ''}{latestMsg.message}
          </span>
          {mode === 'expanded' && live.raceControlMessages[1] && (
            <div>
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', opacity: 0.6 }}>
                {live.raceControlMessages[1].message}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Live Timing Tab ───────────────────────────────────────────────────────────

function TimingTab({ live, isLive, status, mode }: { live: F1Live | null; isLive: boolean; status: F1Status | null; mode: LayoutMode }) {
  const nextSessionDate = status?.nextSession?.date ?? status?.nextRace?.date ?? null;
  const countdown = useCountdown(nextSessionDate);
  const nextSessionLabel = status?.nextSession?.label ?? 'Grand Prix';

  if (!isLive || !live) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, padding: 16, textAlign: 'center' }}>
        <span style={{ fontSize: 28 }}>📡</span>
        <span style={{ fontFamily: '"DM Serif Display", Georgia, serif', fontSize: 14, color: 'var(--text)' }}>Live timing activates during race weekend sessions</span>
        {nextSessionDate && (
          <div style={{ marginTop: 8 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', display: 'block' }}>Next: {nextSessionLabel}</span>
            <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: '#E8002D', display: 'block', marginTop: 4 }}>{countdown}</span>
          </div>
        )}
      </div>
    );
  }

  return <LiveTimingContent live={live} mode={mode} compact={false} />;
}

// ── Session countdown box (used in micro calendar) ────────────────────────────

function SessionCountdownBox({ label, date, color }: { label: string; date: string; color: string }) {
  const isPast = new Date(date).getTime() < Date.now();
  const countdown = useCountdown(isPast ? null : date);
  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: 8,
      background: isPast ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
      border: `1px solid ${isPast ? 'rgba(255,255,255,0.07)' : color + '30'}`,
      borderLeft: `3px solid ${isPast ? 'rgba(255,255,255,0.12)' : color}`,
      opacity: isPast ? 0.55 : 1,
      transition: 'opacity 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: isPast ? 'var(--text-faint)' : color, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)' }}>
          {fmtSessionDay(date)} · {fmtSessionTime(date)} <span style={{ fontSize: 7, opacity: 0.6 }}>UTC</span>
        </span>
      </div>
      <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: isPast ? 9 : 13, fontWeight: 700, color: isPast ? 'var(--text-faint)' : 'var(--text)', letterSpacing: isPast ? 0 : '0.5px' }}>
        {isPast ? '✓ Completed' : countdown}
      </div>
    </div>
  );
}

// ── Micro calendar — single-race paginated view ────────────────────────────────

function MicroCalendarView({ schedule, status }: { schedule: F1Schedule | null; status: F1Status | null }) {
  const nextRound = status?.nextRace?.round ?? -1;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!schedule) return;
    const i = schedule.races.findIndex(r => r.round === nextRound);
    if (i >= 0) setIdx(i);
  }, [nextRound, schedule]);

  if (!schedule) return <CenteredMsg icon="📅" text="Loading…" />;

  const races = schedule.races;
  const race  = races[idx];
  if (!race) return null;

  const isSprint = !!race.sessions.sprint;
  const sessions = raceSessionsInOrder(race).filter(s => !s.dimmed);
  const range     = weekendRange(race);
  const isNext    = race.round === nextRound;
  const raceMs    = new Date(race.date + 'T00:00:00Z').getTime();
  const isPastRace = raceMs < Date.now() - 86_400_000;

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    width: 28, height: 28, borderRadius: '50%',
    border: `1px solid ${disabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.18)'}`,
    background: disabled ? 'transparent' : 'rgba(255,255,255,0.07)',
    color: disabled ? 'rgba(255,255,255,0.2)' : 'var(--text)',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 16, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'background 0.15s, border-color 0.15s',
    userSelect: 'none' as const,
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '8px 10px', gap: 6 }}>
      {/* Navigation header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button style={btnStyle(idx === 0)} onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>‹</button>

        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14 }}>{flagFor(race.country)}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: isNext ? '#fff' : isPastRace ? 'var(--text-muted)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
              {race.name.replace(' Grand Prix', ' GP')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)' }}>R{race.round} · {range}</span>
            {isSprint && (
              <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 999, background: 'rgba(255,128,0,0.15)', color: '#FF8000', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.5px' }}>SPRINT</span>
            )}
            {isNext && !isPastRace && (
              <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 999, background: 'rgba(232,0,45,0.2)', color: '#FF4444', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.5px' }}>NEXT</span>
            )}
            {isPastRace && (
              <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 999, background: 'rgba(61,232,176,0.08)', color: '#3de8b0', fontFamily: 'monospace' }}>done</span>
            )}
          </div>
        </div>

        <button style={btnStyle(idx === races.length - 1)} onClick={() => setIdx(i => Math.min(races.length - 1, i + 1))} disabled={idx === races.length - 1}>›</button>
      </div>

      {/* Session boxes */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, overflowY: 'auto', minHeight: 0 }} className="f1-scroll">
        {sessions.map(s => (
          <SessionCountdownBox key={s.label} label={s.label} date={s.date} color={s.color} />
        ))}
      </div>

      {/* Page dots */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 2 }}>
        {races.map((r, i) => (
          <button
            key={r.round}
            onClick={() => setIdx(i)}
            style={{
              width: i === idx ? 14 : 5, height: 5, borderRadius: 3,
              background: i === idx ? '#E8002D' : r.round === nextRound ? 'rgba(232,0,45,0.5)' : 'rgba(255,255,255,0.15)',
              border: 'none', cursor: 'pointer', padding: 0,
              transition: 'width 0.2s, background 0.2s',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Calendar Tab ──────────────────────────────────────────────────────────────

function CalendarTab({ schedule, lastRace, status, mode }: { schedule: F1Schedule | null; lastRace: F1LastRace | null; status: F1Status | null; mode: LayoutMode }) {
  const calRef = useRef<HTMLDivElement>(null);
  const nextRound = status?.nextRace?.round ?? -1;

  useEffect(() => {
    if (!calRef.current || nextRound < 0) return;
    const nextEl = calRef.current.querySelector(`[data-round="${nextRound}"]`) as HTMLElement | null;
    nextEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [nextRound, schedule]);

  if (!schedule) return <CenteredMsg icon="📅" text="Loading calendar…" />;

  if (mode === 'micro') return <MicroCalendarView schedule={schedule} status={status} />;

  const isCompact = mode === 'slim' || mode === 'compact';
  const today = Date.now();

  return (
    <div className="f1-scroll" ref={calRef} style={{ height: '100%', overflowY: 'auto', padding: '4px 0' }}>
      {schedule.races.map(race => {
        const raceMs   = new Date(race.date + 'T00:00:00Z').getTime();
        const isPast   = raceMs < today - 86_400_000;
        const isNext   = race.round === nextRound;
        const isSprint = !!race.sessions.sprint;
        const winner   = isPast && lastRace?.round === race.round ? lastRace.results[0] : null;
        const sessions = raceSessionsInOrder(race);
        const range    = weekendRange(race);

        return (
          <div
            key={race.round}
            data-round={race.round}
            style={{
              padding: isCompact ? '7px 10px' : '10px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              background: isNext
                ? 'linear-gradient(90deg, rgba(232,0,45,0.09) 0%, transparent 100%)'
                : isPast ? 'rgba(255,255,255,0.01)' : 'transparent',
              borderLeft: isNext ? '3px solid #E8002D'
                : isPast ? '3px solid rgba(61,232,176,0.25)'
                : '3px solid rgba(255,255,255,0.06)',
            }}
          >
            {/* ── Row: round + content ── */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', width: 18, flexShrink: 0, paddingTop: 3 }}>
                R{race.round}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Race name + badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12 }}>{flagFor(race.country)}</span>
                  <span style={{
                    fontSize: isCompact ? 11 : 13, fontWeight: 700, letterSpacing: '-0.2px',
                    color: isNext ? '#fff' : isPast ? 'var(--text-muted)' : 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {race.name.replace(' Grand Prix', ' GP')}
                  </span>
                  {isSprint && (
                    <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 999, background: 'rgba(255,128,0,0.14)', color: '#FF8000', fontFamily: 'monospace', fontWeight: 700, flexShrink: 0, letterSpacing: '0.4px' }}>
                      SPRINT
                    </span>
                  )}
                  {isNext && (
                    <span style={{ fontSize: 8, padding: '1px 6px', borderRadius: 999, background: 'rgba(232,0,45,0.22)', color: '#FF4444', fontFamily: 'monospace', fontWeight: 700, flexShrink: 0, letterSpacing: '0.6px' }}>
                      NEXT
                    </span>
                  )}
                  {isPast && (
                    <span style={{ fontSize: 8, padding: '1px 6px', borderRadius: 999, background: 'rgba(61,232,176,0.09)', color: '#3de8b0', fontFamily: 'monospace', flexShrink: 0 }}>
                      ✓ done
                    </span>
                  )}
                </div>

                {/* Circuit + range */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' }}>
                  {!isCompact && (
                    <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                      {race.circuit}
                    </span>
                  )}
                  {!isCompact && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)' }}>·</span>}
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {range}
                  </span>
                </div>

                {/* Winner (past races) */}
                {isPast && winner && (
                  <div style={{ marginTop: 3, fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>🏆</span>
                    <span style={{ fontFamily: 'monospace' }}>{winner.givenName} {winner.familyName}</span>
                  </div>
                )}

                {/* Sessions schedule — hidden for past and compact */}
                {!isPast && !isCompact && sessions.length > 0 && (
                  <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {sessions.map(s => (
                      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        {/* Color dot */}
                        <span style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: s.color, flexShrink: 0,
                          boxShadow: s.dimmed ? 'none' : `0 0 4px ${s.color}55`,
                        }} />
                        {/* Label */}
                        <span style={{
                          fontFamily: 'monospace', fontSize: 9, width: 72, flexShrink: 0,
                          color: s.dimmed ? 'var(--text-faint)' : 'var(--text-muted)',
                          fontWeight: s.dimmed ? 400 : 600,
                        }}>
                          {s.label}
                        </span>
                        {/* Day */}
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', width: 44, flexShrink: 0 }}>
                          {fmtSessionDay(s.date)}
                        </span>
                        {/* Time */}
                        <span style={{
                          fontFamily: 'monospace', fontSize: 9,
                          color: s.dimmed ? 'var(--text-faint)' : 'var(--text-muted)',
                        }}>
                          {fmtSessionTime(s.date)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Compact: just show key sessions in one row (qualifying + race) */}
                {!isPast && isCompact && (
                  <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {sessions.filter(s => !s.dimmed).map(s => (
                      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 4, height: 4, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)' }}>
                          {s.label} {fmtSessionDay(s.date)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Shared utility ────────────────────────────────────────────────────────────

function CenteredMsg({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, textAlign: 'center' }}>
      <span style={{ fontSize: 24 }}>{icon}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{text}</span>
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

type Tab = 'now' | 'standings' | 'timing' | 'calendar';
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'now',       icon: '🏁', label: 'Now'      },
  { id: 'standings', icon: '🏆', label: 'Standings' },
  { id: 'timing',    icon: '📡', label: 'Live'      },
  { id: 'calendar',  icon: '📅', label: 'Calendar'  },
];

// ── Main component ────────────────────────────────────────────────────────────

export function F1Widget({ onClose: _onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tab, setTab] = useState<Tab>('now');

  const [status,    setStatus]    = useState<F1Status | null>(() => wcRead<F1Status>(WC_KEY.F1_STATUS)?.data ?? null);
  const [standings, setStandings] = useState<F1Standings | null>(() => wcRead<F1Standings>(WC_KEY.F1_STANDINGS)?.data ?? null);
  const [schedule,  setSchedule]  = useState<F1Schedule | null>(() => wcRead<F1Schedule>(WC_KEY.F1_SCHEDULE)?.data ?? null);
  const [lastRace,  setLastRace]  = useState<F1LastRace | null>(() => wcRead<F1LastRace>(WC_KEY.F1_LAST_RACE)?.data ?? null);
  const [live,      setLive]      = useState<F1Live | null>(null);
  const [hasLoaded, setHasLoaded] = useState(() => wcRead(WC_KEY.F1_STATUS) !== null);

  const isLive = status?.isLive ?? false;
  const isRaceWeekend = status?.mode === 'race_weekend';

  useWidgetReady('f1', hasLoaded);

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

  // Tab auto-switch to 'now' when live session starts
  useEffect(() => {
    if (isLive) setTab('now');
  }, [isLive]);

  // ── Fetch helpers ───────────────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/f1/status');
      if (!res.ok) return;
      const data: F1Status = await res.json();
      setStatus(data);
      wcWrite(WC_KEY.F1_STATUS, data);
      setHasLoaded(true);
    } catch { setHasLoaded(true); }
  }, []);

  const fetchStandings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/f1/standings');
      if (!res.ok) return;
      const data: F1Standings = await res.json();
      setStandings(data);
      wcWrite(WC_KEY.F1_STANDINGS, data);
    } catch { /* non-fatal */ }
  }, []);

  const fetchSchedule = useCallback(async () => {
    try {
      const res = await apiFetch('/api/f1/schedule');
      if (!res.ok) return;
      const data: F1Schedule = await res.json();
      setSchedule(data);
      wcWrite(WC_KEY.F1_SCHEDULE, data);
    } catch { /* non-fatal */ }
  }, []);

  const fetchLastRace = useCallback(async () => {
    try {
      const res = await apiFetch('/api/f1/last-race');
      if (!res.ok) return;
      const data: F1LastRace | null = await res.json();
      if (data) { setLastRace(data); wcWrite(WC_KEY.F1_LAST_RACE, data); }
    } catch { /* non-fatal */ }
  }, []);

  const fetchLive = useCallback(async () => {
    try {
      const res = await apiFetch('/api/f1/live');
      if (!res.ok) return;
      const data: F1Live = await res.json();
      setLive(data);
    } catch { /* non-fatal */ }
  }, []);

  // ── Tab-visibility tracking ─────────────────────────────────────────────────
  const isVisibleRef = useRef(true);
  useEffect(() => {
    const onVis = () => { isVisibleRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // ── Polling ─────────────────────────────────────────────────────────────────

  // Mount: load all static data once
  useEffect(() => {
    fetchStatus();
    fetchStandings();
    fetchSchedule();
    fetchLastRace();
  }, [fetchStatus, fetchStandings, fetchSchedule, fetchLastRace]);

  // Status polling
  useEffect(() => {
    const interval = isRaceWeekend ? 60_000 : 10 * 60_000;
    const id = setInterval(() => {
      if (!isVisibleRef.current) return;
      fetchStatus();
    }, interval);
    return () => clearInterval(id);
  }, [isRaceWeekend, fetchStatus]);

  // Standings & schedule polling
  useEffect(() => {
    const id = setInterval(() => {
      if (!isVisibleRef.current) return;
      fetchStandings();
      fetchSchedule();
    }, 30 * 60_000);
    return () => clearInterval(id);
  }, [fetchStandings, fetchSchedule]);

  // Last race polling
  useEffect(() => {
    const id = setInterval(() => {
      if (!isVisibleRef.current) return;
      fetchLastRace();
    }, 60 * 60_000);
    return () => clearInterval(id);
  }, [fetchLastRace]);

  // Live polling — 3 sec when live, else stopped
  useEffect(() => {
    if (!isLive) return;
    fetchLive();
    const id = setInterval(() => {
      if (!isVisibleRef.current) return;
      fetchLive();
    }, 3_000);
    return () => clearInterval(id);
  }, [isLive, fetchLive]);

  // Slow all polling when tab hidden
  useEffect(() => {
    const id = setInterval(() => {
      if (!isVisibleRef.current) fetchStatus();
    }, 60_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // ── Layout ──────────────────────────────────────────────────────────────────

  const mode      = getLayoutMode(size.w, size.h);
  const isCompact = mode === 'compact' || mode === 'slim' || mode === 'micro';
  const tabBarH   = mode === 'micro' || mode === 'slim' ? 26 : 40;
  const btnH      = mode === 'micro' || mode === 'slim' ? 22 : 30;

  return (
    <div ref={containerRef} style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{F1_CSS}</style>

      {/* Content area */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'now' && (
          <NowTab
            status={status}
            standings={standings}
            lastRace={lastRace}
            live={live}
            mode={mode}
            compact={isCompact}
          />
        )}
        {tab === 'standings' && (
          <StandingsTab standings={standings} mode={mode} />
        )}
        {tab === 'timing' && (
          <TimingTab live={live} isLive={isLive} status={status} mode={mode} />
        )}
        {tab === 'calendar' && (
          <CalendarTab schedule={schedule} lastRace={lastRace} status={status} mode={mode} />
        )}
      </div>

      {/* Tab bar — always visible, compact in micro/slim */}
      <div style={{
        height: tabBarH, flexShrink: 0, display: 'flex', alignItems: 'center',
        borderTop: '1px solid var(--border)', background: 'var(--surface2)',
        padding: '0 4px', gap: 2,
      }}>
        {TABS.map(t => {
          const isActive = tab === t.id;
          const isLiveTab = t.id === 'timing';
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, height: btnH, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 1,
                borderRadius: 6, border: 'none', cursor: 'pointer',
                background: isActive ? 'rgba(232,0,45,0.12)' : 'transparent',
                color: isActive ? '#E8002D' : 'var(--text-muted)',
                transition: 'background 0.15s, color 0.15s',
                position: 'relative',
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: isCompact ? 11 : 12, lineHeight: 1 }}>{t.icon}</span>
              {!isCompact && <span style={{ fontSize: 8, fontFamily: 'monospace', letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1 }}>{t.label}</span>}
              {isLiveTab && isLive && (
                <div style={{ position: 'absolute', top: 3, right: 5, width: 5, height: 5, borderRadius: '50%', background: '#E8002D', boxShadow: '0 0 4px #E8002D' }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
