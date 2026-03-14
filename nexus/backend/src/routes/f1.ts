import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const f1Router = Router();

// ── In-memory TTL cache ───────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; ts: number }

function makeCache<T>() {
  const m = new Map<string, CacheEntry<T>>();
  return {
    get: (k: string, ttl: number): T | null => {
      const e = m.get(k);
      if (!e || Date.now() - e.ts > ttl) { m.delete(k); return null; }
      return e.data;
    },
    set: (k: string, d: T) => m.set(k, { data: d, ts: Date.now() }),
  };
}

const C = {
  status:    makeCache<unknown>(),
  standings: makeCache<unknown>(),
  schedule:  makeCache<unknown>(),
  lastRace:  makeCache<unknown>(),
  live:      makeCache<unknown>(),
  circuit:   makeCache<unknown>(),
};

const TTL = {
  status:    30_000,        // 30 sec — shorter during live sessions
  standings: 1_800_000,    // 30 min
  schedule:  86_400_000,   // 24 hours
  lastRace:  3_600_000,    // 1 hour
  live:      3_000,        // 3 sec
  circuit:   86_400_000,   // 24 hours
};

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function ergast<T>(path: string): Promise<T> {
  // Ergast API was retired Dec 31 2024; jolpica-f1 is the community drop-in mirror
  const res = await fetch(`https://api.jolpi.ca/ergast/f1${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Ergast/jolpica ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

async function openf1<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.openf1.org/v1${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`OpenF1 ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

// ── Ergast response types ─────────────────────────────────────────────────────

interface ErgastLocation { country: string; locality: string }
interface ErgastCircuit { circuitId: string; circuitName: string; Location: ErgastLocation }
interface ErgastSession { date: string; time: string }

interface ErgastRace {
  season: string;
  round: string;
  raceName: string;
  Circuit: ErgastCircuit;
  date: string;
  time?: string;
  FirstPractice?: ErgastSession;
  SecondPractice?: ErgastSession;
  ThirdPractice?: ErgastSession;
  Qualifying?: ErgastSession;
  Sprint?: ErgastSession;
}

interface ErgastDriver {
  driverId: string;
  permanentNumber?: string;
  code: string;
  givenName: string;
  familyName: string;
}

interface ErgastConstructor { constructorId: string; name: string }

interface ErgastDriverStanding {
  position: string;
  points: string;
  wins: string;
  Driver: ErgastDriver;
  Constructors: ErgastConstructor[];
}

interface ErgastConstructorStanding {
  position: string;
  points: string;
  wins: string;
  Constructor: ErgastConstructor;
}

interface ErgastResult {
  position: string;
  grid: string;
  laps: string;
  status: string;
  points: string;
  Driver: ErgastDriver;
  Constructor: ErgastConstructor;
  FastestLap?: { rank: string; lap: string; Time: { time: string } };
  Time?: { time: string };
}

// ── OpenF1 response types ─────────────────────────────────────────────────────

interface OF1Session {
  session_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  date_end: string | null;
  status?: string;
  circuit_short_name: string;
  country_name: string;
  meeting_name: string;
}

interface OF1Position { driver_number: number; position: number; date: string }
interface OF1Lap {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
}
interface OF1Stint {
  driver_number: number;
  stint_number: number;
  compound: string;
  lap_start: number;
  lap_end: number | null;
}
interface OF1Pit { driver_number: number; lap_number: number; date: string }
interface OF1RaceControl {
  date: string;
  flag: string;
  message: string;
  category: string;
  lap_number: number | null;
}
interface OF1Weather {
  air_temperature: number;
  track_temperature: number;
  humidity: number;
  rainfall: number;
  wind_speed: number;
}
interface OF1Driver {
  driver_number: number;
  full_name: string;
  name_acronym: string;
  team_name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLapTime(sec: number | null): string {
  if (!sec || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

function normalizeTeamId(name: string): string {
  const l = name.toLowerCase();
  if (l.includes('mclaren'))  return 'mclaren';
  if (l.includes('ferrari'))  return 'ferrari';
  if (l.includes('red bull')) return 'redbull';
  if (l.includes('mercedes')) return 'mercedes';
  if (l.includes('aston'))    return 'aston_martin';
  if (l.includes('alpine'))   return 'alpine';
  if (l.includes('williams')) return 'williams';
  if (l.includes('racing bulls') || l.includes('toro')) return 'racing_bulls';
  if (l.includes('haas'))     return 'haas';
  if (l.includes('audi') || l.includes('sauber')) return 'audi';
  if (l.includes('cadillac') || l.includes('andretti')) return 'cadillac';
  return '';
}

function isWithinRaceWeekend(race: ErgastRace): boolean {
  const now = Date.now();
  const raceMs = new Date(race.date + 'T00:00:00Z').getTime();
  return now >= raceMs - 4 * 86_400_000 && now <= raceMs + 86_400_000;
}

function daysUntilRace(race: ErgastRace): number {
  const ms = new Date(race.date + 'T00:00:00Z').getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

interface NextSessionSlot {
  type: 'fp1' | 'fp2' | 'fp3' | 'qualifying' | 'sprint' | 'race';
  label: string;
  date: string;
  round: number;
  raceName: string;
  circuit: string;
  country: string;
}

function allSessionSlots(races: ErgastRace[]): NextSessionSlot[] {
  const slots: NextSessionSlot[] = [];
  for (const r of races) {
    const round = parseInt(r.round, 10);
    const circuit = r.Circuit.circuitName;
    const country = r.Circuit.Location.country;
    if (r.FirstPractice)  slots.push({ type: 'fp1',       label: 'Practice 1',  date: r.FirstPractice.date + 'T' + (r.FirstPractice.time ?? '00:00:00Z'), round, raceName: r.raceName, circuit, country });
    if (r.SecondPractice) slots.push({ type: 'fp2',       label: 'Practice 2',  date: r.SecondPractice.date + 'T' + (r.SecondPractice.time ?? '00:00:00Z'), round, raceName: r.raceName, circuit, country });
    if (r.ThirdPractice)  slots.push({ type: 'fp3',       label: 'Practice 3',  date: r.ThirdPractice.date + 'T' + (r.ThirdPractice.time ?? '00:00:00Z'), round, raceName: r.raceName, circuit, country });
    if (r.Qualifying)     slots.push({ type: 'qualifying', label: 'Qualifying', date: r.Qualifying.date + 'T' + (r.Qualifying.time ?? '00:00:00Z'), round, raceName: r.raceName, circuit, country });
    if (r.Sprint)         slots.push({ type: 'sprint',     label: 'Sprint',     date: r.Sprint.date + 'T' + (r.Sprint.time ?? '00:00:00Z'), round, raceName: r.raceName, circuit, country });
    slots.push({ type: 'race', label: 'Grand Prix', date: r.date + 'T' + (r.time ?? '00:00:00Z'), round, raceName: r.raceName, circuit, country });
  }
  return slots.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

// ── GET /api/f1/status ────────────────────────────────────────────────────────

f1Router.get('/status', requireAuth, async (_req: AuthRequest, res: Response) => {
  const cached = C.status.get('status', TTL.status);
  if (cached) { res.json(cached); return; }

  try {
    const [scheduleData, sessions] = await Promise.all([
      ergast<{ MRData: { RaceTable: { Races: ErgastRace[] } } }>('/2026.json').catch(() => null),
      openf1<OF1Session[]>('/sessions?year=2026&is_latest=true').catch(() => null),
    ]);

    const races  = scheduleData?.MRData?.RaceTable?.Races ?? [];
    const now    = Date.now();

    const nextRace = races.find(r => {
      const raceEnd = new Date(r.date + 'T23:59:59Z').getTime();
      return raceEnd >= now;
    }) ?? null;

    const days = nextRace ? daysUntilRace(nextRace) : 999;

    const session = sessions?.[0] ?? null;
    let currentSession: { type: string; name: string; status: string; sessionKey: number } | null = null;
    let isLive = false;

    if (session) {
      const startMs  = new Date(session.date_start).getTime();
      const endMs    = session.date_end ? new Date(session.date_end).getTime() : startMs + 3 * 3_600_000;
      const sixHoursAgo  = now - 6 * 3_600_000;
      const oneHourAhead = now + 3_600_000;
      const sessionStatus = (session.status ?? '').toLowerCase();

      // A session is "current" if it started within 6 h ago or starts within 1 h
      const isTimingWindow = startMs >= sixHoursAgo && startMs <= oneHourAhead;
      // OpenF1 marks active sessions as 'started'; also consider it live if we're
      // between its scheduled start and end time
      const isActiveByStatus = ['started', 'active', 'live'].some(s => sessionStatus.includes(s));
      const isActiveByTime   = startMs <= now && now <= endMs + 30 * 60_000; // 30 min grace after end

      if (isTimingWindow || isActiveByStatus) {
        currentSession = {
          type:       session.session_type,
          name:       session.session_name,
          status:     session.status ?? 'unknown',
          sessionKey: session.session_key,
        };
        isLive = isActiveByStatus || isActiveByTime || (startMs <= now && startMs >= sixHoursAgo);
      }
    }

    let mode: 'off_season' | 'race_weekend' | 'between_races' = 'between_races';
    if (days > 90)                                            mode = 'off_season';
    else if (nextRace && (isWithinRaceWeekend(nextRace) || isLive)) mode = 'race_weekend';
    else                                                      mode = 'between_races';

    const allSlots = allSessionSlots(races);
    const nextSessionSlot = allSlots.find(s => new Date(s.date).getTime() > now) ?? null;
    const nextSession = nextSessionSlot ? {
      type:    nextSessionSlot.type,
      label:   nextSessionSlot.label,
      date:    nextSessionSlot.date,
      round:   nextSessionSlot.round,
      raceName: nextSessionSlot.raceName,
      circuit:  nextSessionSlot.circuit,
      country:  nextSessionSlot.country,
    } : null;

    const result = {
      mode,
      nextRace: nextRace ? {
        name:    nextRace.raceName,
        circuit: nextRace.Circuit.circuitName,
        country: nextRace.Circuit.Location.country,
        date:    nextRace.date + (nextRace.time ? `T${nextRace.time}` : 'T00:00:00Z'),
        round:   parseInt(nextRace.round, 10),
      } : null,
      nextSession,
      currentSession,
      isLive,
      daysUntilNextRace: days,
    };

    C.status.set('status', result);
    res.json(result);
  } catch (err) {
    console.error('[f1/status]', err);
    res.status(500).json({ error: 'Failed to fetch F1 status' });
  }
});

// ── GET /api/f1/standings ─────────────────────────────────────────────────────

f1Router.get('/standings', requireAuth, async (_req: AuthRequest, res: Response) => {
  const cached = C.standings.get('standings', TTL.standings);
  if (cached) { res.json(cached); return; }

  try {
    const [driverData, constructorData] = await Promise.all([
      ergast<{ MRData: { StandingsTable: { StandingsLists: Array<{ DriverStandings: ErgastDriverStanding[] }> } } }>('/2026/driverStandings.json'),
      ergast<{ MRData: { StandingsTable: { StandingsLists: Array<{ ConstructorStandings: ErgastConstructorStanding[] }> } } }>('/2026/constructorStandings.json'),
    ]);

    const driverList      = driverData.MRData.StandingsTable.StandingsLists[0]?.DriverStandings ?? [];
    const constructorList = constructorData.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings ?? [];

    const leaderPoints = parseFloat(driverList[0]?.points ?? '0');
    const cLeaderPts   = parseFloat(constructorList[0]?.points ?? '0');

    const result = {
      drivers: driverList.map((d, i) => ({
        position:        parseInt(d.position, 10),
        points:          parseFloat(d.points),
        wins:            parseInt(d.wins, 10),
        driverId:        d.Driver.driverId,
        code:            d.Driver.code,
        givenName:       d.Driver.givenName,
        familyName:      d.Driver.familyName,
        constructorId:   d.Constructors[0]?.constructorId ?? '',
        constructorName: d.Constructors[0]?.name ?? '',
        gapToLeader:     i === 0 ? 0 : leaderPoints - parseFloat(d.points),
      })),
      constructors: constructorList.map((c, i) => ({
        position:      parseInt(c.position, 10),
        points:        parseFloat(c.points),
        wins:          parseInt(c.wins, 10),
        constructorId: c.Constructor.constructorId,
        name:          c.Constructor.name,
        gapToLeader:   i === 0 ? 0 : cLeaderPts - parseFloat(c.points),
      })),
    };

    C.standings.set('standings', result);
    res.json(result);
  } catch (err) {
    console.error('[f1/standings]', err);
    res.status(500).json({ error: 'Failed to fetch F1 standings' });
  }
});

// ── GET /api/f1/schedule ──────────────────────────────────────────────────────

f1Router.get('/schedule', requireAuth, async (_req: AuthRequest, res: Response) => {
  const cached = C.schedule.get('schedule', TTL.schedule);
  if (cached) { res.json(cached); return; }

  try {
    const data = await ergast<{ MRData: { RaceTable: { Races: ErgastRace[] } } }>('/2026.json');
    const races = data.MRData.RaceTable.Races;

    const result = {
      season: '2026',
      races: races.map(r => ({
        round:    parseInt(r.round, 10),
        name:     r.raceName,
        circuit:  r.Circuit.circuitName,
        country:  r.Circuit.Location.country,
        locality: r.Circuit.Location.locality,
        date:     r.date,
        time:     r.time ?? null,
        sessions: {
          fp1:        r.FirstPractice  ?? null,
          fp2:        r.SecondPractice ?? null,
          fp3:        r.ThirdPractice  ?? null,
          qualifying: r.Qualifying     ?? null,
          sprint:     r.Sprint         ?? null,
        },
      })),
    };

    C.schedule.set('schedule', result);
    res.json(result);
  } catch (err) {
    console.error('[f1/schedule]', err);
    res.status(500).json({ error: 'Failed to fetch F1 schedule' });
  }
});

// ── GET /api/f1/last-race ─────────────────────────────────────────────────────

f1Router.get('/last-race', requireAuth, async (_req: AuthRequest, res: Response) => {
  const cached = C.lastRace.get('last-race', TTL.lastRace);
  if (cached) { res.json(cached); return; }

  try {
    const data = await ergast<{
      MRData: {
        RaceTable: {
          Races: Array<{
            raceName: string;
            Circuit: ErgastCircuit;
            date: string;
            round: string;
            Results: ErgastResult[];
          }>;
        };
      };
    }>('/2026/last/results.json');

    const race = data.MRData.RaceTable.Races[0];
    if (!race) { res.json(null); return; }

    const result = {
      round:   parseInt(race.round, 10),
      name:    race.raceName,
      circuit: race.Circuit.circuitName,
      country: race.Circuit.Location.country,
      date:    race.date,
      results: race.Results.slice(0, 20).map(r => ({
        position:        parseInt(r.position, 10),
        driverCode:      r.Driver.code,
        givenName:       r.Driver.givenName,
        familyName:      r.Driver.familyName,
        constructorId:   r.Constructor.constructorId,
        constructorName: r.Constructor.name,
        points:          parseFloat(r.points),
        grid:            parseInt(r.grid, 10),
        laps:            parseInt(r.laps, 10),
        status:          r.status,
        time:            r.Time?.time ?? null,
        hasFastestLap:   r.FastestLap?.rank === '1',
      })),
      fastestLap: (() => {
        const fl = race.Results.find(r => r.FastestLap?.rank === '1');
        return fl ? { driverCode: fl.Driver.code, time: fl.FastestLap!.Time.time } : null;
      })(),
    };

    C.lastRace.set('last-race', result);
    res.json(result);
  } catch (err) {
    console.error('[f1/last-race]', err);
    res.status(500).json({ error: 'Failed to fetch last race' });
  }
});

// ── GET /api/f1/live ──────────────────────────────────────────────────────────

f1Router.get('/live', requireAuth, async (_req: AuthRequest, res: Response) => {
  const cached = C.live.get('live', TTL.live);
  if (cached) { res.json(cached); return; }

  try {
    const [positions, laps, stints, pits, rcMsgs, weather, drivers, sessionArr] =
      await Promise.all([
        openf1<OF1Position[]>('/position?session_key=latest').catch(() => [] as OF1Position[]),
        openf1<OF1Lap[]>('/laps?session_key=latest').catch(() => [] as OF1Lap[]),
        openf1<OF1Stint[]>('/stints?session_key=latest').catch(() => [] as OF1Stint[]),
        openf1<OF1Pit[]>('/pit?session_key=latest').catch(() => [] as OF1Pit[]),
        openf1<OF1RaceControl[]>('/race_control?session_key=latest').catch(() => [] as OF1RaceControl[]),
        openf1<OF1Weather[]>('/weather?session_key=latest').catch(() => [] as OF1Weather[]),
        openf1<OF1Driver[]>('/drivers?session_key=latest').catch(() => [] as OF1Driver[]),
        openf1<OF1Session[]>('/sessions?session_key=latest').catch(() => [] as OF1Session[]),
      ]);

    const session = sessionArr[0] ?? null;

    const latestPos = new Map<number, number>();
    for (const p of positions) latestPos.set(p.driver_number, p.position);

    const latestLap = new Map<number, OF1Lap>();
    for (const l of laps) {
      const cur = latestLap.get(l.driver_number);
      if (!cur || l.lap_number > cur.lap_number) latestLap.set(l.driver_number, l);
    }

    const currentStint = new Map<number, OF1Stint>();
    for (const s of stints) {
      const cur = currentStint.get(s.driver_number);
      if (!cur || s.stint_number > cur.stint_number) currentStint.set(s.driver_number, s);
    }

    const pitCount = new Map<number, number>();
    for (const p of pits) pitCount.set(p.driver_number, (pitCount.get(p.driver_number) ?? 0) + 1);

    const driverMap = new Map<number, OF1Driver>();
    for (const d of drivers) driverMap.set(d.driver_number, d);

    const latestWeather = weather.length > 0 ? weather[weather.length - 1] : null;
    const maxLap = Math.max(...Array.from(latestLap.values()).map(l => l.lap_number), 0);

    const leaderNum = Array.from(latestPos.entries()).find(([, pos]) => pos === 1)?.[0];
    const leaderLap = leaderNum !== undefined ? latestLap.get(leaderNum) : null;

    // Find fastest lap
    let fastestSec = Infinity;
    let fastestDriver = -1;
    for (const [num, lap] of latestLap) {
      if (lap.lap_duration && lap.lap_duration > 0 && lap.lap_duration < fastestSec) {
        fastestSec   = lap.lap_duration;
        fastestDriver = num;
      }
    }

    const driverNumbers = Array.from(new Set([...latestPos.keys(), ...driverMap.keys()]));

    const driverList = driverNumbers
      .map(num => {
        const pos   = latestPos.get(num) ?? 99;
        const lap   = latestLap.get(num);
        const stint = currentStint.get(num);
        const info  = driverMap.get(num);
        const pits_ = pitCount.get(num) ?? 0;
        const lapsOnTire = stint ? Math.max(0, maxLap - stint.lap_start + 1) : 0;
        return {
          position:    pos,
          driverNumber: num,
          driverCode:  info?.name_acronym ?? `#${num}`,
          driverName:  info?.full_name ?? `Driver ${num}`,
          teamId:      normalizeTeamId(info?.team_name ?? ''),
          lastLapTime: formatLapTime(lap?.lap_duration ?? null),
          lapDurationSec: lap?.lap_duration ?? null,
          gapToLeader:    pos === 1 ? 'LEADER' : '—',
          intervalToAhead: '—',
          currentTire: { compound: stint?.compound ?? 'UNKNOWN', lapsOnTire },
          inPit:       false,
          pitStops:    pits_,
          sector1:     lap?.duration_sector_1 != null ? lap.duration_sector_1.toFixed(3) : '—',
          sector2:     lap?.duration_sector_2 != null ? lap.duration_sector_2.toFixed(3) : '—',
          sector3:     lap?.duration_sector_3 != null ? lap.duration_sector_3.toFixed(3) : '—',
          speed:       0,
          isPersonalBest:  false,
          isFastestLap:    num === fastestDriver,
        };
      })
      .filter(d => d.position <= 22)
      .sort((a, b) => a.position - b.position);

    // Compute gaps
    const leaderLapSec = leaderLap?.lap_duration ?? null;
    for (let i = 0; i < driverList.length; i++) {
      const d = driverList[i];
      if (d.position !== 1 && leaderLapSec && d.lapDurationSec) {
        const delta = d.lapDurationSec - leaderLapSec;
        d.gapToLeader = delta > 0 ? `+${delta.toFixed(3)}` : '—';
      }
      if (i > 0) {
        const ahead = driverList[i - 1];
        if (d.lapDurationSec && ahead.lapDurationSec) {
          const interval = d.lapDurationSec - ahead.lapDurationSec;
          d.intervalToAhead = interval > 0 ? `+${interval.toFixed(3)}` : '—';
        }
      }
    }

    const result = {
      sessionType:   session?.session_type ?? 'Unknown',
      sessionName:   session?.session_name ?? 'Session',
      sessionStatus: session?.status ?? 'unknown',
      circuitName:   session?.circuit_short_name ?? '',
      meetingName:   session?.meeting_name ?? '',
      currentLap:    maxLap,
      fastestLapDriver: fastestDriver,
      weather: latestWeather ? {
        trackTemp: latestWeather.track_temperature,
        airTemp:   latestWeather.air_temperature,
        humidity:  latestWeather.humidity,
        rainfall:  latestWeather.rainfall,
        windSpeed: latestWeather.wind_speed,
      } : null,
      raceControlMessages: rcMsgs.slice(-15).reverse().map(m => ({
        message:   m.message,
        flag:      m.flag,
        category:  m.category,
        timestamp: m.date,
        lap:       m.lap_number,
      })),
      drivers: driverList,
    };

    C.live.set('live', result);
    res.json(result);
  } catch (err) {
    console.error('[f1/live]', err);
    res.status(500).json({ error: 'Failed to fetch live F1 data' });
  }
});

// ── GET /api/f1/circuit/:round ────────────────────────────────────────────────

f1Router.get('/circuit/:round', requireAuth, async (req: AuthRequest, res: Response) => {
  const { round } = req.params;
  const cached = C.circuit.get(round, TTL.circuit);
  if (cached) { res.json(cached); return; }

  try {
    const data = await ergast<{ MRData: { RaceTable: { Races: ErgastRace[] } } }>(`/2026/${round}.json`);
    const race = data.MRData.RaceTable.Races[0];
    if (!race) { res.json(null); return; }

    const result = {
      round:    parseInt(round, 10),
      name:     race.raceName,
      circuit:  race.Circuit.circuitName,
      country:  race.Circuit.Location.country,
      locality: race.Circuit.Location.locality,
    };

    C.circuit.set(round, result);
    res.json(result);
  } catch (err) {
    console.error(`[f1/circuit/${round}]`, err);
    res.status(500).json({ error: 'Failed to fetch circuit info' });
  }
});
