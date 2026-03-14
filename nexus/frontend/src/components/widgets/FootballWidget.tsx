import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../../lib/api';
import { wcRead, wcWrite, WC_KEY } from '../../lib/widgetCache';
import { useWidgetReady } from '../../hooks/useWidgetReady';

// ── Competition metadata ───────────────────────────────────────────────────────

// football-data.org free tier — 12 competitions, full current season data
const COMPETITIONS = [
  { id: 2021, name: 'Premier League',    country: 'England',       flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', color: '#3D195B' },
  { id: 2014, name: 'La Liga',           country: 'Spain',         flag: '🇪🇸', color: '#EE1523' },
  { id: 2002, name: 'Bundesliga',        country: 'Germany',       flag: '🇩🇪', color: '#D3010C' },
  { id: 2019, name: 'Serie A',           country: 'Italy',         flag: '🇮🇹', color: '#024494' },
  { id: 2015, name: 'Ligue 1',           country: 'France',        flag: '🇫🇷', color: '#091C3E' },
  { id: 2001, name: 'Champions League',  country: 'Europe',        flag: '🇪🇺', color: '#001489' },
  { id: 2003, name: 'Eredivisie',        country: 'Netherlands',   flag: '🇳🇱', color: '#FF4F00' },
  { id: 2017, name: 'Primeira Liga',     country: 'Portugal',      flag: '🇵🇹', color: '#006600' },
  { id: 2013, name: 'Brasileirão',       country: 'Brazil',        flag: '🇧🇷', color: '#009C3B' },
  { id: 2000, name: 'World Cup',         country: 'World',         flag: '🌍',  color: '#C8A21A' },
  { id: 2018, name: 'Euro Championship', country: 'Europe',        flag: '🇪🇺', color: '#003DA5' },
  { id: 2152, name: 'Copa Libertadores', country: 'South America', flag: '🌎',  color: '#CF142B' },
] as const;

type CompId = typeof COMPETITIONS[number]['id'];
const COMP_MAP = new Map(COMPETITIONS.map(c => [c.id, c]));

// ── Layout modes ──────────────────────────────────────────────────────────────

type LayoutMode = 'micro' | 'slim' | 'compact' | 'standard' | 'expanded';

function getMode(w: number): LayoutMode {
  if (w < 255)  return 'micro';
  if (w < 390)  return 'slim';
  if (w < 540)  return 'compact';
  if (w < 780)  return 'standard';
  return 'expanded';
}

// ── Status helpers ────────────────────────────────────────────────────────────

// football-data.org statuses: SCHEDULED, TIMED, IN_PLAY, PAUSED, FINISHED, SUSPENDED, POSTPONED, CANCELLED, AWARDED
function isLiveStatus(s: string) { return s === 'IN_PLAY' || s === 'PAUSED'; }
function isFinished(s: string) { return s === 'FINISHED' || s === 'AWARDED'; }

const STATUS_LABEL: Record<string, string> = {
  'IN_PLAY':   'In Play',
  'PAUSED':    'Half Time',
  'FINISHED':  'Full Time',
  'AWARDED':   'Awarded',
  'SCHEDULED': 'Not Started',
  'TIMED':     'Not Started',
  'POSTPONED': 'Postponed',
  'CANCELLED': 'Cancelled',
  'SUSPENDED': 'Suspended',
};

function statusLabel(s: string) { return STATUS_LABEL[s] ?? s; }

function fmtTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const tom = new Date(); tom.setDate(today.getDate() + 1);
  if (d.toDateString() === tom.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompMeta { id: number; name: string; color: string; flag: string }
interface TeamInfo { id: number; name: string; logo: string }
interface LiveEvent { elapsed: number; minute?: number; teamId: number; type: string; detail: string; player: string; assist: string | null }

interface LiveMatch {
  fixtureId: number;
  date: string;
  competition: CompMeta;
  home: TeamInfo & { score: number };
  away: TeamInfo & { score: number };
  minute: number | null;
  status: { short: string; long: string };
  events: LiveEvent[];
}

interface FixtureItem {
  fixtureId: number;
  date: string;
  round: string;
  status: { short: string; long: string; elapsed: number | null };
  home: TeamInfo & { score: number | null };
  away: TeamInfo & { score: number | null };
}

interface TodayGroup { competition: CompMeta; matches: FixtureItem[] }

interface StandingRow {
  rank: number;
  team: TeamInfo;
  played: number; won: number; drawn: number; lost: number;
  goalsFor: number; goalsAgainst: number; goalsDiff: number;
  points: number;
  form: string;
  description: string | null;
}

interface StandingsData { leagueId: number; season: number; standings: StandingRow[]; stale: boolean }
interface FixturesData { leagueId: number; last: FixtureItem[]; next: FixtureItem[]; stale: boolean }

interface PlayerInfo { id: number; name: string; number: number; pos: string; grid: string | null }
interface TeamLineup { formation: string; coach: string; startXI: PlayerInfo[]; substitutes: PlayerInfo[] }
interface MatchStat { type: string; home: string | number | null; away: string | number | null }

interface MatchDetailData {
  fixtureId: number;
  date: string;
  isLive: boolean;
  competition: CompMeta & { round: string };
  status: { short: string; long: string; elapsed: number | null };
  home: TeamInfo & { score: number | null };
  away: TeamInfo & { score: number | null };
  score: { halftime: { home: number | null; away: number | null }; extratime: { home: number | null; away: number | null }; penalty: { home: number | null; away: number | null } };
  events: (LiveEvent & { extra: number | null; minute: number })[]; 
  statistics: MatchStat[];
  lineups: { home: TeamLineup | null; away: TeamLineup | null };
  stale: boolean;
}

interface FavoriteTeam { teamId: number; name: string; logoUrl: string | null }
interface FavoriteComp { leagueId: number; name: string }
interface FavoritesData { teams: FavoriteTeam[]; competitions: FavoriteComp[] }
interface SearchResult { teamId: number; name: string; logo: string; country: string }
interface GoalNotif { id: number; text: string }

// ── CSS ───────────────────────────────────────────────────────────────────────

const FB_CSS = `
  @keyframes fb-live-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
  @keyframes fb-goal-in { from{transform:translateY(-100%);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes fb-detail-in { from{transform:translateX(100%)} to{transform:translateX(0)} }
  @keyframes fb-event-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes fb-score-flash { 0%,100%{color:inherit} 40%{color:#22c55e} }
  .fb-live-dot { animation: fb-live-pulse 1.2s infinite; }
  .fb-goal-banner { animation: fb-goal-in 0.3s ease; }
  .fb-detail-panel { animation: fb-detail-in 0.28s cubic-bezier(0.25,0.46,0.45,0.94); }
  .fb-scroll { overflow-y:auto; scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.08) transparent; }
  .fb-scroll::-webkit-scrollbar { width:3px; }
  .fb-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:3px; }
  .fb-hscroll { overflow-x:auto; scrollbar-width:none; }
  .fb-hscroll::-webkit-scrollbar { display:none; }
`;

// ── TeamLogo ──────────────────────────────────────────────────────────────────

function TeamLogo({ logo, name, size = 24 }: { logo: string; name: string; size?: number }) {
  const [err, setErr] = useState(false);
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  if (err || !logo) {
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.32, fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>
        {initials.slice(0, 2)}
      </div>
    );
  }
  return <img src={logo} alt={name} width={size} height={size} style={{ objectFit: 'contain', flexShrink: 0 }} onError={() => setErr(true)} />;
}

// ── FormDots ──────────────────────────────────────────────────────────────────

function FormDots({ form, count = 5 }: { form: string; count?: number }) {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
      {form.slice(-count).split('').map((c, i) => (
        <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: c === 'W' ? '#22c55e' : c === 'D' ? '#6b7280' : '#ef4444', flexShrink: 0 }} />
      ))}
    </div>
  );
}

// ── EventIcon ────────────────────────────────────────────────────────────────

function eventIcon(type: string, detail: string): string {
  const d = detail.toLowerCase();
  if (type === 'Goal') { if (d.includes('own')) return '🥅'; if (d.includes('penalty')) return '⚽'; return '⚽'; }
  if (type === 'Card') { if (d.includes('red card')) return '🟥'; if (d.includes('yellow card') && d.includes('red')) return '🟨🟥'; return '🟨'; }
  if (type === 'subst') return '↕';
  return '📋';
}

// ── Standings position border color ──────────────────────────────────────────
// football-data.org doesn't provide description/qualification zone text,
// so we use standard positional rules for domestic leagues.

const DOMESTIC_COMPS: Set<number> = new Set([2021, 2014, 2002, 2019, 2015, 2003, 2017, 2013]);

function positionBorderColor(_desc: string | null, compId?: number, position?: number, totalTeams?: number): string | null {
  if (!compId || !position || !totalTeams) return null;
  if (DOMESTIC_COMPS.has(compId)) {
    if (position <= 4) return '#001489'; // UCL
    if (position <= 6) return '#F77F00'; // UEL
    if (position > totalTeams - 3) return '#E8002D'; // relegation
  }
  return null;
}

// ── Competition pills ─────────────────────────────────────────────────────────

function CompPills({ selected, onChange, favComps }: { selected: number; onChange: (id: number) => void; favComps: FavoriteComp[] }) {
  const favIds = new Set(favComps.map(c => c.leagueId));
  const ordered = [
    ...COMPETITIONS.filter(c => favIds.has(c.id)),
    ...COMPETITIONS.filter(c => !favIds.has(c.id)),
  ];
  return (
    <div className="fb-hscroll" style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      {ordered.map(c => {
        const active = selected === c.id;
        return (
          <button key={c.id} onClick={() => onChange(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 999, border: '1px solid', flexShrink: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, fontWeight: active ? 700 : 400, transition: 'all 0.15s', borderColor: active ? c.color : 'var(--border)', background: active ? c.color + '22' : 'transparent', color: active ? c.color : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            <span>{c.flag}</span>
            <span>{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Match score card ──────────────────────────────────────────────────────────

function MatchCard({ match, onOpen, compact, flashHomeScore, flashAwayScore }: {
  match: FixtureItem | LiveMatch;
  onOpen: (id: number) => void;
  compact: boolean;
  flashHomeScore?: boolean;
  flashAwayScore?: boolean;
}) {
  const isLive = isLiveStatus(match.status.short);
  const done = isFinished(match.status.short);
  const homeScore = 'score' in match.home ? match.home.score : null;
  const awayScore = 'score' in match.away ? match.away.score : null;
  const minute = 'minute' in match ? match.minute : match.status.elapsed;
  const compMeta = 'competition' in match ? match.competition : null;

  return (
    <div
      onClick={() => onOpen(match.fixtureId)}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: compact ? '8px 10px' : '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', borderLeft: compMeta ? `3px solid ${compMeta.color}` : '3px solid transparent', background: isLive ? 'rgba(34,197,94,0.04)' : 'transparent', transition: 'background 0.15s' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--row-bg-hover)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isLive ? 'rgba(34,197,94,0.04)' : 'transparent'; }}
    >
      {compMeta && !compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10 }}>{compMeta.flag}</span>
          <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{compMeta.name}</span>
          {isLive && minute && <span className="fb-live-dot" style={{ fontSize: 9, fontFamily: 'monospace', color: '#22c55e', marginLeft: 'auto', padding: '1px 5px', borderRadius: 999, background: 'rgba(34,197,94,0.15)' }}>{minute}'</span>}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <TeamLogo logo={match.home.logo} name={match.home.name} size={compact ? 18 : 22} />
        <span style={{ flex: 1, fontSize: compact ? 11 : 13, fontWeight: 600, color: done && (homeScore ?? 0) > (awayScore ?? 0) ? 'var(--text)' : done && (homeScore ?? 0) < (awayScore ?? 0) ? 'var(--text-faint)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {match.home.name}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {homeScore !== null && awayScore !== null ? (
            <>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: compact ? 16 : 20, color: flashHomeScore ? '#22c55e' : 'var(--text)', transition: 'color 0.2s', minWidth: 14, textAlign: 'center' }}>{homeScore}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 300, fontSize: compact ? 14 : 18, color: 'var(--text-faint)' }}>—</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: compact ? 16 : 20, color: flashAwayScore ? '#22c55e' : 'var(--text)', transition: 'color 0.2s', minWidth: 14, textAlign: 'center' }}>{awayScore}</span>
            </>
          ) : (
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{'date' in match ? fmtTime(match.date) : ''}</span>
          )}
        </div>
        <span style={{ flex: 1, fontSize: compact ? 11 : 13, fontWeight: 600, color: done && (awayScore ?? 0) > (homeScore ?? 0) ? 'var(--text)' : done && (awayScore ?? 0) < (homeScore ?? 0) ? 'var(--text-faint)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
          {match.away.name}
        </span>
        <TeamLogo logo={match.away.logo} name={match.away.name} size={compact ? 18 : 22} />
      </div>
      {!compact && isLive && 'events' in match && match.events.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
          {match.events.slice(-3).map((ev, i) => (
            <span key={i} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 999, background: ev.type === 'Goal' ? 'rgba(34,197,94,0.15)' : ev.detail.includes('Red') ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.07)', color: ev.type === 'Goal' ? '#22c55e' : ev.detail.includes('Red') ? '#ef4444' : 'var(--text-faint)', fontFamily: 'monospace', flexShrink: 0 }}>
              {eventIcon(ev.type, ev.detail)} {(ev.elapsed ?? ev.minute ?? '')}' {ev.player.split(' ').pop()}
            </span>
          ))}
        </div>
      )}
      {!compact && !isLive && homeScore === null && 'date' in match && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-faint)' }}>{fmtDate(match.date)}</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{fmtTime(match.date)}</span>
          {'round' in match && match.round && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', marginLeft: 'auto' }}>{match.round}</span>}
        </div>
      )}
    </div>
  );
}

// ── Live Tab ──────────────────────────────────────────────────────────────────

function LiveTab({ liveMatches, todayGroups, onOpen, flashMap, mode }: {
  liveMatches: LiveMatch[];
  todayGroups: TodayGroup[];
  onOpen: (id: number) => void;
  flashMap: Map<number, 'home' | 'away'>;
  mode: LayoutMode;
}) {
  const compact = mode === 'compact';
  const limit = mode === 'micro' ? 1 : mode === 'slim' ? 3 : mode === 'compact' ? 4 : 20;

  if (liveMatches.length > 0) {
    return (
      <div className="fb-scroll" style={{ height: '100%', overflowY: 'auto' }}>
        {liveMatches.slice(0, limit).map(m => (
          <MatchCard key={m.fixtureId} match={m} onOpen={onOpen} compact={compact} flashHomeScore={flashMap.get(m.fixtureId) === 'home'} flashAwayScore={flashMap.get(m.fixtureId) === 'away'} />
        ))}
      </div>
    );
  }

  if (todayGroups.length > 0) {
    return (
      <div className="fb-scroll" style={{ height: '100%', overflowY: 'auto' }}>
        {todayGroups.map(g => (
          <div key={g.competition.id}>
            {!compact && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${g.competition.color}` }}>
                <span style={{ fontSize: 12 }}>{g.competition.flag}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{g.competition.name}</span>
              </div>
            )}
            {g.matches.slice(0, limit).map(m => (
              <MatchCard key={m.fixtureId} match={{ ...m, competition: g.competition }} onOpen={onOpen} compact={compact} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, padding: 16, textAlign: 'center' }}>
      <span style={{ fontSize: 28 }}>⚽</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: '"DM Serif Display", Georgia, serif' }}>No matches today</span>
    </div>
  );
}

// ── Standings Tab ─────────────────────────────────────────────────────────────

function StandingsTab({ selected, onSelectComp, favComps, standingsMap, onLoad, onOpen, mode }: {
  selected: number;
  onSelectComp: (id: number) => void;
  favComps: FavoriteComp[];
  standingsMap: Record<number, StandingsData>;
  onLoad: (id: number) => void;
  onOpen: (teamId: number, name: string) => void;
  mode: LayoutMode;
}) {
  useEffect(() => { onLoad(selected); }, [selected, onLoad]);

  const data = standingsMap[selected];
  const compact = mode === 'compact' || mode === 'slim' || mode === 'micro';
  const showForm = mode === 'standard' || mode === 'expanded';
  const rowLimit = mode === 'micro' ? 5 : mode === 'slim' ? 8 : compact ? 10 : 20;
  const hidePills = mode === 'micro';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {!hidePills && <CompPills selected={selected} onChange={onSelectComp} favComps={favComps} />}

      {!data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'monospace' }}>Loading…</span>
        </div>
      ) : (
        <>
          {data.stale && <div style={{ padding: '2px 10px', background: 'rgba(245,158,11,0.08)', flexShrink: 0 }}><span style={{ fontSize: 9, color: 'rgba(245,158,11,0.8)', fontFamily: 'monospace' }}>⚠ Data may be delayed</span></div>}
          {/* Column headers */}
          {!compact && (
            <div style={{ display: 'flex', alignItems: 'center', padding: '3px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: 4 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 20 }}>#</span>
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', flex: 1 }}>TEAM</span>
              {['P','W','D','L'].map(h => <span key={h} style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 18, textAlign: 'center' }}>{h}</span>)}
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 30, textAlign: 'right' }}>GD</span>
              <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 26, textAlign: 'right' }}>PTS</span>
              {showForm && <span style={{ fontFamily: 'monospace', fontSize: 8, color: 'var(--text-faint)', width: 52, textAlign: 'right' }}>FORM</span>}
            </div>
          )}
          <div className="fb-scroll" style={{ flex: 1, overflowY: 'auto' }}>
            {data.standings.slice(0, rowLimit).map((r, i) => {
              const borderColor = positionBorderColor(r.description, selected, r.rank, data.standings.length);
              return (
                <div
                  key={r.rank}
                  onClick={() => onOpen(r.team.id, r.team.name)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: compact ? '4px 10px' : '5px 10px', borderLeft: `3px solid ${borderColor ?? 'transparent'}`, background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--row-bg-hover)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)'; }}
                >
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--text-muted)', width: 20, textAlign: 'right', flexShrink: 0 }}>{r.rank}</span>
                  <TeamLogo logo={r.team.logo} name={r.team.name} size={compact ? 18 : 22} />
                  <span style={{ flex: 1, fontSize: compact ? 11 : 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 4 }}>{r.team.name}</span>
                  {!compact && (
                    <>
                      {[r.played, r.won, r.drawn, r.lost].map((v, j) => (
                        <span key={j} style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', width: 18, textAlign: 'center', flexShrink: 0 }}>{v}</span>
                      ))}
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: r.goalsDiff > 0 ? '#22c55e' : r.goalsDiff < 0 ? '#ef4444' : 'var(--text-muted)', width: 30, textAlign: 'right', flexShrink: 0 }}>{r.goalsDiff > 0 ? '+' : ''}{r.goalsDiff}</span>
                    </>
                  )}
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: 'var(--text)', width: 26, textAlign: 'right', flexShrink: 0 }}>{r.points}</span>
                  {showForm && r.form && <div style={{ width: 52, display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}><FormDots form={r.form} /></div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── Fixtures Tab ──────────────────────────────────────────────────────────────

function FixturesTab({ selected, onSelectComp, favComps, fixturesMap, onLoad, onOpen, mode }: {
  selected: number;
  onSelectComp: (id: number) => void;
  favComps: FavoriteComp[];
  fixturesMap: Record<number, FixturesData>;
  onLoad: (id: number) => void;
  onOpen: (id: number) => void;
  mode: LayoutMode;
}) {
  const [sub, setSub] = useState<'upcoming' | 'results'>('upcoming');
  useEffect(() => { onLoad(selected); }, [selected, onLoad]);

  const data = fixturesMap[selected];
  const compact = mode === 'compact' || mode === 'slim' || mode === 'micro';
  const limit = mode === 'micro' ? 3 : mode === 'slim' ? 5 : compact ? 5 : 10;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {mode !== 'micro' && <CompPills selected={selected} onChange={onSelectComp} favComps={favComps} />}
      <div style={{ display: 'flex', gap: 4, padding: '3px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {(['upcoming', 'results'] as const).map(s => (
          <button key={s} onClick={() => setSub(s)} style={{ padding: mode === 'micro' ? '2px 8px' : '3px 12px', borderRadius: 999, fontSize: mode === 'micro' ? 9 : 11, fontFamily: 'monospace', fontWeight: 600, cursor: 'pointer', border: '1px solid', borderColor: sub === s ? 'var(--teal)' : 'var(--border)', background: sub === s ? 'rgba(61,232,176,0.1)' : 'transparent', color: sub === s ? 'var(--teal)' : 'var(--text-muted)', transition: 'all 0.15s', textTransform: 'capitalize' }}>
            {s}
          </button>
        ))}
      </div>
      {!data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'monospace' }}>Loading…</span>
        </div>
      ) : (
        <div className="fb-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {(sub === 'upcoming' ? data.next : [...data.last].reverse()).slice(0, limit).map(m => (
            <MatchCard key={m.fixtureId} match={m} onOpen={onOpen} compact={compact} />
          ))}
          {((sub === 'upcoming' ? data.next : data.last).length === 0) && (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'monospace' }}>No fixtures found</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pitch SVG ─────────────────────────────────────────────────────────────────

function PitchSVG({ home, away }: { home: TeamLineup; away: TeamLineup }) {
  const W = 100, H = 154;

  function computePositions(lineup: TeamLineup, isHome: boolean) {
    const rows = new Map<number, { col: number; p: PlayerInfo }[]>();
    let maxRow = 1;
    for (const p of lineup.startXI) {
      if (!p.grid) continue;
      const parts = p.grid.split(':').map(Number);
      if (parts.length !== 2) continue;
      const [r, c] = parts;
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r)!.push({ col: c, p });
      if (r > maxRow) maxRow = r;
    }
    const result: { name: string; number: number; x: number; y: number }[] = [];
    for (const [row, players] of rows) {
      const sorted = [...players].sort((a, b) => a.col - b.col);
      const n = sorted.length;
      const progress = maxRow <= 1 ? 0 : (row - 1) / (maxRow - 1);
      const y = isHome ? H - 8 - progress * 58 : 8 + progress * 58;
      sorted.forEach((item, i) => {
        const x = n === 1 ? W / 2 : 10 + (i / (n - 1)) * 80;
        const shortName = item.p.name.split(' ').pop() ?? item.p.name;
        result.push({ name: shortName.slice(0, 6), number: item.p.number, x, y });
      });
    }
    return result;
  }

  const homePlayers = computePositions(home, true);
  const awayPlayers = computePositions(away, false);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Pitch */}
      <rect width={W} height={H} fill="#1e5c1e" />
      {/* Alternating stripes */}
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={0} y={i * (H / 10)} width={W} height={H / 10} fill={i % 2 === 0 ? '#1e5c1e' : '#1a541a'} />
      ))}
      {/* Border */}
      <rect x={2} y={2} width={W - 4} height={H - 4} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.6} />
      {/* Center line */}
      <line x1={2} y1={H / 2} x2={W - 2} y2={H / 2} stroke="rgba(255,255,255,0.45)" strokeWidth={0.6} />
      {/* Center circle */}
      <circle cx={W / 2} cy={H / 2} r={11} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={0.6} />
      <circle cx={W / 2} cy={H / 2} r={0.8} fill="rgba(255,255,255,0.6)" />
      {/* Penalty box top */}
      <rect x={27} y={2} width={46} height={22} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.5} />
      <rect x={37} y={2} width={26} height={9} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.5} />
      {/* Penalty box bottom */}
      <rect x={27} y={H - 24} width={46} height={22} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.5} />
      <rect x={37} y={H - 11} width={26} height={9} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={0.5} />
      {/* Players */}
      {homePlayers.map((p, i) => (
        <g key={`h${i}`} transform={`translate(${p.x},${p.y})`}>
          <circle r={5} fill="#3B82F6" stroke="rgba(255,255,255,0.6)" strokeWidth={0.6} />
          <text fontSize={3.2} fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="bold">{p.number}</text>
        </g>
      ))}
      {awayPlayers.map((p, i) => (
        <g key={`a${i}`} transform={`translate(${p.x},${p.y})`}>
          <circle r={5} fill="#F97316" stroke="rgba(255,255,255,0.6)" strokeWidth={0.6} />
          <text fontSize={3.2} fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="bold">{p.number}</text>
        </g>
      ))}
      {/* Formation labels */}
      <text x={W - 3} y={H - 5} fontSize={4} fill="rgba(255,255,255,0.4)" textAnchor="end">{home.formation}</text>
      <text x={3} y={9} fontSize={4} fill="rgba(255,255,255,0.4)">{away.formation}</text>
    </svg>
  );
}

// ── Match Detail Panel ────────────────────────────────────────────────────────

const DISPLAY_STATS = ['Ball Possession', 'Total Shots', 'Shots on Goal', 'Corner Kicks', 'Fouls', 'Offsides', 'Goalkeeper Saves'];

function MatchDetailPanel({ detail, onClose, mode }: { detail: MatchDetailData; onClose: () => void; mode: LayoutMode }) {
  const [view, setView] = useState<'events' | 'stats' | 'lineups'>('events');
  const showLineups = mode === 'standard' || mode === 'expanded';
  const sideBy = mode === 'expanded';


  function parseStatNum(v: string | number | null): number {
    if (v === null || v === undefined) return 0;
    return parseFloat(String(v).replace('%', '')) || 0;
  }

  return (
    <div className="fb-detail-panel" style={{ position: 'absolute', inset: 0, background: 'var(--surface)', zIndex: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}>←</button>
          <span style={{ fontSize: 10 }}>{detail.competition.flag}</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail.competition.name} · {detail.competition.round}</span>
          {detail.isLive && detail.status.elapsed && (
            <span className="fb-live-dot" style={{ fontSize: 10, fontFamily: 'monospace', color: '#22c55e', padding: '1px 6px', borderRadius: 999, background: 'rgba(34,197,94,0.15)', flexShrink: 0 }}>{detail.status.elapsed}'</span>
          )}
        </div>
        {/* Score */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1, minWidth: 0 }}>
            <TeamLogo logo={detail.home.logo} name={detail.home.name} size={32} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{detail.home.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 28, color: 'var(--text)', minWidth: 22, textAlign: 'center' }}>{detail.home.score ?? '–'}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 300, fontSize: 24, color: 'var(--text-faint)' }}>—</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 28, color: 'var(--text)', minWidth: 22, textAlign: 'center' }}>{detail.away.score ?? '–'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1, minWidth: 0 }}>
            <TeamLogo logo={detail.away.logo} name={detail.away.name} size={32} />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{detail.away.name}</span>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-faint)' }}>
            {statusLabel(detail.status.short)}
            {detail.score.halftime.home !== null ? ` · HT ${detail.score.halftime.home}–${detail.score.halftime.away}` : ''}
          </span>
        </div>
        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {(['events', 'stats', ...(showLineups ? ['lineups'] : [])] as const).map(v => (
            <button key={v} onClick={() => setView(v as typeof view)} style={{ flex: 1, padding: '4px 0', borderRadius: 6, border: '1px solid', borderColor: view === v ? 'rgba(61,232,176,0.5)' : 'var(--border)', background: view === v ? 'rgba(61,232,176,0.08)' : 'transparent', color: view === v ? 'var(--teal)' : 'var(--text-muted)', fontFamily: 'monospace', fontSize: 10, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.15s' }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="fb-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {/* Events */}
        {view === 'events' && (
          <div style={{ padding: '6px 0' }}>
            {detail.events.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center' }}><span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'monospace' }}>No events yet</span></div>
            )}
            {detail.events.map((ev, i) => {
              const isHome = ev.teamId === detail.home.id;
              const evMin = ev.elapsed ?? ev.minute ?? 0;
              const evExtra = ev.extra;
              return (
                <div key={i} className="fb-event-in" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', animationDelay: `${i * 40}ms`, animationFillMode: 'both' }}>
                  {isHome ? (
                    <>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: ev.type === 'Goal' ? '#22c55e' : 'var(--text)', flex: 1 }}>
                        {eventIcon(ev.type, ev.detail)} {ev.player}{ev.assist ? ` (${ev.assist})` : ''}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>{evMin}{evExtra ? `+${evExtra}` : ''}'</span>
                      <div style={{ width: '40%' }} />
                    </>
                  ) : (
                    <>
                      <div style={{ width: '40%' }} />
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-faint)', flexShrink: 0 }}>{evMin}{evExtra ? `+${evExtra}` : ''}'</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: ev.type === 'Goal' ? '#22c55e' : 'var(--text)', flex: 1, textAlign: 'right' }}>
                        {eventIcon(ev.type, ev.detail)} {ev.player}{ev.assist ? ` (${ev.assist})` : ''}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Stats */}
        {view === 'stats' && (
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {DISPLAY_STATS.map(type => {
              const stat = detail.statistics.find(s => s.type === type);
              if (!stat) return null;
              const h = parseStatNum(stat.home);
              const a = parseStatNum(stat.away);
              const total = h + a || 1;
              const hPct = (h / total) * 100;
              return (
                <div key={type}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11, color: 'var(--text)' }}>{stat.home ?? '0'}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-faint)' }}>{type}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11, color: 'var(--text)' }}>{stat.away ?? '0'}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: 'var(--surface3)', overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${hPct}%`, background: '#3B82F6', transition: 'width 0.4s ease', borderRadius: '999px 0 0 999px' }} />
                    <div style={{ flex: 1, background: '#F97316', borderRadius: '0 999px 999px 0' }} />
                  </div>
                </div>
              );
            })}
            {detail.statistics.length === 0 && <div style={{ textAlign: 'center', padding: 16 }}><span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'monospace' }}>No statistics available</span></div>}
          </div>
        )}

        {/* Lineups */}
        {view === 'lineups' && (
          <div style={{ padding: '6px 0' }}>
            {!detail.lineups.home && !detail.lineups.away ? (
              <div style={{ padding: 20, textAlign: 'center' }}><span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'monospace' }}>Lineups not available yet</span></div>
            ) : (
              <div style={{ display: sideBy ? 'grid' : 'block', gridTemplateColumns: sideBy ? '1fr 1fr' : undefined, gap: sideBy ? 8 : 0, padding: '0 8px' }}>
                {/* Pitch diagram */}
                {!sideBy && detail.lineups.home && detail.lineups.away && (
                  <div style={{ margin: '0 4px 8px', borderRadius: 8, overflow: 'hidden' }}>
                    <PitchSVG home={detail.lineups.home} away={detail.lineups.away} />
                  </div>
                )}
                {/* Bench */}
                {[
                  { label: detail.home.name, lineup: detail.lineups.home },
                  { label: detail.away.name, lineup: detail.lineups.away },
                ].map(({ label, lineup }) => lineup && (
                  <div key={label} style={{ marginBottom: 8 }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)', padding: '4px 6px', fontWeight: 700 }}>{label} — {lineup.formation}</div>
                    {lineup.substitutes.length > 0 && (
                      <>
                        <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', padding: '2px 6px' }}>Bench</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 6px' }}>
                          {lineup.substitutes.map(p => (
                            <span key={p.id} style={{ fontFamily: 'monospace', fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              #{p.number} {p.name.split(' ').pop()}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── My Teams Tab ──────────────────────────────────────────────────────────────

function MyTeamsTab({ favorites, onAddTeam, onRemoveTeam, onAddComp, onRemoveComp, onMoveComp, mode }: {
  favorites: FavoritesData;
  onAddTeam: (r: SearchResult) => void;
  onRemoveTeam: (id: number) => void;
  onAddComp: (c: { id: number; name: string }) => void;
  onRemoveComp: (id: number) => void;
  onMoveComp: (from: number, to: number) => void;
  mode: LayoutMode;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const favTeamIds = new Set(favorites.teams.map(t => t.teamId));
  const favCompIds = new Set(favorites.competitions.map(c => c.leagueId));

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/api/football/search?q=${encodeURIComponent(query)}`);
        if (res.ok) { const d = await res.json(); setResults(d.results ?? []); }
      } catch { /* ignore */ }
      setSearching(false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const compact = mode === 'compact' || mode === 'slim';

  return (
    <div className="fb-scroll" style={{ height: '100%', overflowY: 'auto', padding: '8px 0' }}>
      {/* Search */}
      <div style={{ padding: '0 10px 8px', borderBottom: '1px solid var(--border)' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search teams…"
          style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
        />
        {searching && <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', display: 'block', marginTop: 3 }}>Searching…</span>}
        {results.map(r => (
          <div key={r.teamId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
            <TeamLogo logo={r.logo} name={r.name} size={20} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)' }}>{r.country}</span>
            </div>
            <button onClick={() => favTeamIds.has(r.teamId) ? onRemoveTeam(r.teamId) : onAddTeam(r)} style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid', borderColor: favTeamIds.has(r.teamId) ? 'rgba(239,68,68,0.5)' : 'rgba(61,232,176,0.5)', background: 'transparent', color: favTeamIds.has(r.teamId) ? '#ef4444' : 'var(--teal)', fontSize: 10, fontFamily: 'monospace', cursor: 'pointer' }}>
              {favTeamIds.has(r.teamId) ? '– Remove' : '+ Save'}
            </button>
          </div>
        ))}
      </div>

      {/* Saved teams */}
      {favorites.teams.length > 0 && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>My Teams</div>
          {favorites.teams.map(t => (
            <div key={t.teamId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '4px 0' : '5px 0', borderBottom: '1px solid var(--border)' }}>
              <TeamLogo logo={t.logoUrl ?? ''} name={t.name} size={20} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <button onClick={() => onRemoveTeam(t.teamId)} style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#ef4444', fontSize: 9, fontFamily: 'monospace', cursor: 'pointer' }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Favorite competitions */}
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Favorite Competitions</div>
        {favorites.competitions.map((c, i) => (
          <div key={c.leagueId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>{COMP_MAP.get(c.leagueId as CompId)?.flag ?? '⚽'}</span>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <button onClick={() => i > 0 && onMoveComp(i, i - 1)} disabled={i === 0} style={{ width: 20, height: 20, borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: i === 0 ? 'var(--text-faint)' : 'var(--text-muted)', fontSize: 10, cursor: i === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↑</button>
              <button onClick={() => i < favorites.competitions.length - 1 && onMoveComp(i, i + 1)} disabled={i === favorites.competitions.length - 1} style={{ width: 20, height: 20, borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: i === favorites.competitions.length - 1 ? 'var(--text-faint)' : 'var(--text-muted)', fontSize: 10, cursor: i === favorites.competitions.length - 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↓</button>
              <button onClick={() => onRemoveComp(c.leagueId)} style={{ width: 20, height: 20, borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#ef4444', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          </div>
        ))}
        {/* Add competitions */}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--text-faint)', marginBottom: 4 }}>Add competitions</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {COMPETITIONS.filter(c => !favCompIds.has(c.id)).map(c => (
              <button key={c.id} onClick={() => onAddComp({ id: c.id, name: c.name })} style={{ padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 9, fontFamily: 'monospace', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                <span>{c.flag}</span><span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = 'live' | 'standings' | 'fixtures' | 'my_teams';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'live',       icon: '⚽', label: 'Live'      },
  { id: 'standings',  icon: '📊', label: 'Standings' },
  { id: 'fixtures',   icon: '📅', label: 'Fixtures'  },
  { id: 'my_teams',   icon: '⭐', label: 'My Teams'  },
];

// ── Main widget ───────────────────────────────────────────────────────────────

export function FootballWidget({ onClose: _onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Tab + drill-down state
  const [tab, setTab] = useState<Tab>('live');
  const [drillDownId, setDrillDownId] = useState<number | null>(null);
  const [selectedComp, setSelectedComp] = useState<number>(2021); // Premier League (football-data.org ID)

  // Data state — seed from cache where applicable
  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>(() => wcRead<LiveMatch[]>(WC_KEY.FOOTBALL_LIVE)?.data ?? []);
  const [todayGroups, setTodayGroups] = useState<TodayGroup[]>(() => wcRead<TodayGroup[]>(WC_KEY.FOOTBALL_TODAY)?.data ?? []);
  const [standingsMap, setStandingsMap] = useState<Record<number, StandingsData>>({});
  const [fixturesMap, setFixturesMap] = useState<Record<number, FixturesData>>({});
  const [matchDetail, setMatchDetail] = useState<MatchDetailData | null>(null);
  const [favorites, setFavorites] = useState<FavoritesData>({ teams: [], competitions: [] });
  const [hasLoaded, setHasLoaded] = useState(() => wcRead(WC_KEY.FOOTBALL_LIVE) !== null);

  // Goal notification
  const [goalNotif, setGoalNotif] = useState<GoalNotif | null>(null);
  const [flashMap, setFlashMap] = useState<Map<number, 'home' | 'away'>>(new Map());
  const prevScoresRef = useRef<Map<number, [number, number]>>(new Map());
  const notifIdRef = useRef(0);

  useWidgetReady('football', hasLoaded);

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

  // Tab visibility
  const isVisibleRef = useRef(true);
  useEffect(() => {
    const h = () => { isVisibleRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);

  // ── Fetch helpers ───────────────────────────────────────────────────────────

  const fetchLive = useCallback(async () => {
    try {
      const res = await apiFetch('/api/football/live');
      if (!res.ok) return;
      const d = await res.json() as { matches: LiveMatch[] };
      const matches = d.matches ?? [];

      // Goal detection
      const newFlash = new Map<number, 'home' | 'away'>();
      for (const m of matches) {
        const prev = prevScoresRef.current.get(m.fixtureId);
        if (prev) {
          if (m.home.score > prev[0]) {
            newFlash.set(m.fixtureId, 'home');
            const id = ++notifIdRef.current;
            setGoalNotif({ id, text: `⚽ GOAL — ${m.home.name} ${m.home.score}–${m.away.score} ${m.away.name}` });
            setTimeout(() => setGoalNotif(n => n?.id === id ? null : n), 4000);
          } else if (m.away.score > prev[1]) {
            newFlash.set(m.fixtureId, 'away');
            const id = ++notifIdRef.current;
            setGoalNotif({ id, text: `⚽ GOAL — ${m.away.name} ${m.home.score}–${m.away.score} ${m.home.name}` });
            setTimeout(() => setGoalNotif(n => n?.id === id ? null : n), 4000);
          }
        }
        prevScoresRef.current.set(m.fixtureId, [m.home.score, m.away.score]);
      }
      if (newFlash.size > 0) {
        setFlashMap(newFlash);
        setTimeout(() => setFlashMap(new Map()), 2000);
      }

      setLiveMatches(matches);
      wcWrite(WC_KEY.FOOTBALL_LIVE, matches);
      setHasLoaded(true);
    } catch { setHasLoaded(true); }
  }, []);

  const fetchToday = useCallback(async () => {
    try {
      const res = await apiFetch('/api/football/today');
      if (!res.ok) return;
      const d = await res.json() as { groups: TodayGroup[] };
      const groups = d.groups ?? [];
      setTodayGroups(groups);
      wcWrite(WC_KEY.FOOTBALL_TODAY, groups);
    } catch { /* non-fatal */ }
  }, []);

  const fetchStandings = useCallback(async (leagueId: number) => {
    if (standingsMap[leagueId]) return;
    try {
      const res = await apiFetch(`/api/football/standings/${leagueId}`);
      if (!res.ok) return;
      const d = await res.json() as StandingsData;
      setStandingsMap(prev => ({ ...prev, [leagueId]: d }));
    } catch { /* non-fatal */ }
  }, [standingsMap]);

  const fetchFixtures = useCallback(async (leagueId: number) => {
    if (fixturesMap[leagueId]) return;
    try {
      const res = await apiFetch(`/api/football/fixtures/${leagueId}`);
      if (!res.ok) return;
      const d = await res.json() as FixturesData;
      setFixturesMap(prev => ({ ...prev, [leagueId]: d }));
    } catch { /* non-fatal */ }
  }, [fixturesMap]);

  const fetchMatchDetail = useCallback(async (fixtureId: number) => {
    try {
      const res = await apiFetch(`/api/football/match/${fixtureId}`);
      if (!res.ok) return;
      const d = await res.json() as MatchDetailData;
      setMatchDetail(d);
    } catch { /* non-fatal */ }
  }, []);

  const fetchFavorites = useCallback(async () => {
    try {
      const res = await apiFetch('/api/football/favorites');
      if (!res.ok) return;
      const d = await res.json() as FavoritesData;
      setFavorites(d);
      // If has favorites, switch to my_teams as default
    } catch { /* non-fatal */ }
  }, []);

  // ── Polling ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchLive();
    fetchToday();
    fetchFavorites();
  }, [fetchLive, fetchToday, fetchFavorites]);

  useEffect(() => {
    const hasLive = liveMatches.length > 0;
    const isOnTab = tab === 'live';
    const baseInterval = hasLive && isOnTab && isVisibleRef.current ? 60_000 : 5 * 60_000;
    const id = setInterval(() => {
      if (!isVisibleRef.current) return;
      fetchLive();
      if (isOnTab) fetchToday();
    }, baseInterval);
    return () => clearInterval(id);
  }, [liveMatches.length, tab, fetchLive, fetchToday]);

  // Refresh match detail when open and live
  useEffect(() => {
    if (!drillDownId || !matchDetail?.isLive) return;
    const id = setInterval(() => fetchMatchDetail(drillDownId), 60_000);
    return () => clearInterval(id);
  }, [drillDownId, matchDetail?.isLive, fetchMatchDetail]);

  // Open match detail
  const openMatch = useCallback((fixtureId: number) => {
    setDrillDownId(fixtureId);
    setMatchDetail(null);
    fetchMatchDetail(fixtureId);
  }, [fetchMatchDetail]);

  // ── Favorites mutations ─────────────────────────────────────────────────────

  const addTeam = useCallback(async (r: SearchResult) => {
    setFavorites(prev => ({ ...prev, teams: [...prev.teams, { teamId: r.teamId, name: r.name, logoUrl: r.logo }] }));
    try { await apiFetch('/api/football/favorites/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teamId: r.teamId, name: r.name, logoUrl: r.logo }) }); } catch { /* non-fatal */ }
  }, []);

  const removeTeam = useCallback(async (teamId: number) => {
    setFavorites(prev => ({ ...prev, teams: prev.teams.filter(t => t.teamId !== teamId) }));
    try { await apiFetch(`/api/football/favorites/team/${teamId}`, { method: 'DELETE' }); } catch { /* non-fatal */ }
  }, []);

  const addComp = useCallback(async (c: { id: number; name: string }) => {
    setFavorites(prev => ({ ...prev, competitions: [...prev.competitions, { leagueId: c.id, name: c.name }] }));
    try { await apiFetch('/api/football/favorites/competition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagueId: c.id, name: c.name }) }); } catch { /* non-fatal */ }
  }, []);

  const removeComp = useCallback(async (leagueId: number) => {
    setFavorites(prev => ({ ...prev, competitions: prev.competitions.filter(c => c.leagueId !== leagueId) }));
    try { await apiFetch(`/api/football/favorites/competition/${leagueId}`, { method: 'DELETE' }); } catch { /* non-fatal */ }
  }, []);

  const moveComp = useCallback((from: number, to: number) => {
    setFavorites(prev => {
      const comps = [...prev.competitions];
      const [item] = comps.splice(from, 1);
      comps.splice(to, 0, item);
      return { ...prev, competitions: comps };
    });
  }, []);

  // ── Layout ──────────────────────────────────────────────────────────────────

  const mode      = getMode(size.w);
  const isSmall   = mode === 'micro' || mode === 'slim';
  const tabBarH   = isSmall ? 26 : 40;
  const btnH      = isSmall ? 22 : 32;

  return (
    <div ref={containerRef} style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <style>{FB_CSS}</style>

      {/* Goal notification banner */}
      {goalNotif && (
        <div className="fb-goal-banner" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, padding: '6px 12px', background: 'rgba(34,197,94,0.18)', borderBottom: '1px solid rgba(34,197,94,0.35)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#22c55e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{goalNotif.text}</span>
          <button onClick={() => setGoalNotif(null)} style={{ background: 'none', border: 'none', color: 'rgba(34,197,94,0.6)', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* Tab content — always rendered */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'live' && <LiveTab liveMatches={liveMatches} todayGroups={todayGroups} onOpen={openMatch} flashMap={flashMap} mode={mode} />}
        {tab === 'standings' && <StandingsTab selected={selectedComp} onSelectComp={setSelectedComp} favComps={favorites.competitions} standingsMap={standingsMap} onLoad={fetchStandings} onOpen={openMatch} mode={mode} />}
        {tab === 'fixtures' && <FixturesTab selected={selectedComp} onSelectComp={setSelectedComp} favComps={favorites.competitions} fixturesMap={fixturesMap} onLoad={fetchFixtures} onOpen={openMatch} mode={mode} />}
        {tab === 'my_teams' && <MyTeamsTab favorites={favorites} onAddTeam={addTeam} onRemoveTeam={removeTeam} onAddComp={addComp} onRemoveComp={removeComp} onMoveComp={moveComp} mode={mode} />}
      </div>

      {/* Tab bar — always visible, compact in micro/slim */}
      <div style={{ height: tabBarH, flexShrink: 0, display: 'flex', alignItems: 'center', borderTop: '1px solid var(--border)', background: 'var(--surface2)', padding: '0 4px', gap: 2 }}>
        {TABS.map(t => {
          const isActive = tab === t.id;
          const hasLiveDot = t.id === 'live' && liveMatches.length > 0;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, height: btnH, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 6, border: 'none', cursor: 'pointer', background: isActive ? 'rgba(61,232,176,0.1)' : 'transparent', color: isActive ? 'var(--teal)' : 'var(--text-muted)', transition: 'background 0.15s, color 0.15s', position: 'relative' }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: isSmall ? 11 : 13, lineHeight: 1 }}>{t.icon}</span>
              {!isSmall && mode !== 'compact' && <span style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 }}>{t.label}</span>}
              {hasLiveDot && (
                <div className="fb-live-dot" style={{ position: 'absolute', top: 3, right: 5, width: 5, height: 5, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 4px #22c55e' }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Match detail panel — overlays content */}
      {drillDownId !== null && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
          {!matchDetail ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => setDrillDownId(null)} style={{ position: 'absolute', top: 10, left: 10, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer' }}>←</button>
              <span style={{ fontSize: 20 }}>⚽</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-faint)' }}>Loading…</span>
            </div>
          ) : (
            <MatchDetailPanel detail={matchDetail} onClose={() => setDrillDownId(null)} mode={mode} />
          )}
        </div>
      )}
    </div>
  );
}
