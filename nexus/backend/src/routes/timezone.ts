import { Router, type Response } from 'express';
import * as ct from 'countries-and-timezones';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cities: Array<{ name: string; aliases: string[]; timezone: string; country: string }> =
  require('../data/cities.json');

export const timezoneRouter = Router();

interface CTCountry {
  id: string;
  name: string;
  timezones: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCache<T>() {
  const store = new Map<string, { data: T; ts: number }>();
  return {
    get(k: string, ttl: number): T | null {
      const e = store.get(k);
      if (!e || Date.now() - e.ts > ttl) return null;
      return e.data;
    },
    set(k: string, data: T) { store.set(k, { data, ts: Date.now() }); },
  };
}

const cache = {
  search:  makeCache<unknown>(),
  convert: makeCache<unknown>(),
  current: makeCache<unknown>(),
};

/** Get the UTC offset string (e.g. "+05:30") for a timezone at a given date. */
function getUtcOffset(tz: string, date = new Date()): string {
  try {
    const fmt = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = fmt.formatToParts(date);
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
    // offsetPart looks like "GMT+5:30" or "GMT-4" — strip "GMT"
    const raw = offsetPart.replace(/^GMT/, '') || '+0';
    // Normalise to "+HH:MM"
    const match = raw.match(/^([+-]?)(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return raw;
    const sign   = match[1] || '+';
    const hh     = match[2].padStart(2, '0');
    const mm     = match[3] ?? '00';
    return `${sign}${hh}:${mm}`;
  } catch { return '+00:00'; }
}

/** Format current time in a timezone as { time, date } strings. */
function currentInTz(tz: string) {
  const now = new Date();
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(now);
  return { time, date };
}

/** Detect whether DST is active in a timezone right now. */
function isDST(tz: string): boolean {
  try {
    const jan = new Date(new Date().getFullYear(), 0, 1);
    const jul = new Date(new Date().getFullYear(), 6, 1);
    const janOff = getUtcOffset(tz, jan);
    const julOff = getUtcOffset(tz, jul);
    if (janOff === julOff) return false; // No DST in this timezone
    const nowOff = getUtcOffset(tz);
    // DST is active if the offset is the more-positive one (summer time)
    const toMin = (s: string) => {
      const m = s.match(/^([+-])(\d{2}):(\d{2})$/);
      if (!m) return 0;
      return (m[1] === '+' ? 1 : -1) * (parseInt(m[2]) * 60 + parseInt(m[3]));
    };
    return toMin(nowOff) === Math.max(toMin(janOff), toMin(julOff));
  } catch { return false; }
}

/** Flag emoji from ISO 3166-1 alpha-2 country code. */
function flagEmoji(cc: string): string {
  if (!cc || cc.length !== 2) return '🌐';
  const base = 0x1F1A5;
  return String.fromCodePoint(
    cc.toUpperCase().charCodeAt(0) + base,
    cc.toUpperCase().charCodeAt(1) + base,
  );
}

// ── Aliases for common shortcuts ─────────────────────────────────────────────
const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'GB', 'united kingdom': 'GB', england: 'GB', britain: 'GB',
  usa: 'US', uae: 'AE', 'united states': 'US',
};

// ── GET /api/timezone/search?q= ───────────────────────────────────────────────
timezoneRouter.get('/search', requireAuth, (req: AuthRequest, res: Response) => {
  const q = ((req.query.q as string) ?? '').trim().toLowerCase();
  if (!q || q.length < 1) { res.json({ results: [] }); return; }

  const cacheKey = `search:${q}`;
  const cached = cache.search.get(cacheKey, 60_000);
  if (cached) { res.json(cached); return; }

  const results: Array<{
    name: string;
    type: 'city' | 'country' | 'region';
    timezone: string | null;
    timezones: string[] | null;
    ambiguous: boolean;
    ambiguousMessage: string | null;
    countryCode: string;
    flag: string;
    utcOffset: string | null;
    currentTime: string | null;
  }> = [];
  const seen = new Set<string>();

  // 1. Check alias shortcuts first (uk → GB, etc.)
  const aliasCode = COUNTRY_ALIASES[q];
  const expandedQ = aliasCode ? aliasCode.toLowerCase() : q;

  // 2. City search
  for (const city of cities) {
    const match =
      city.name.toLowerCase().includes(expandedQ) ||
      city.aliases.some(a => a.toLowerCase().includes(expandedQ));
    if (!match) continue;
    const key = `city:${city.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const offset = getUtcOffset(city.timezone);
    const { time } = currentInTz(city.timezone);
    results.push({
      name:             city.name,
      type:             'city',
      timezone:         city.timezone,
      timezones:        null,
      ambiguous:        false,
      ambiguousMessage: null,
      countryCode:      city.country,
      flag:             flagEmoji(city.country),
      utcOffset:        `UTC${offset}`,
      currentTime:      time,
    });
    if (results.length >= 6) break;
  }

  // 3. Country search (fill remaining slots up to 6)
  if (results.length < 6) {
    const allCountries = ct.getAllCountries() as Record<string, CTCountry>;
    for (const country of Object.values(allCountries)) {
      if (results.length >= 6) break;
      const nameMatch = country.name.toLowerCase().includes(expandedQ) ||
        (aliasCode && country.id === aliasCode.toUpperCase());
      if (!nameMatch) continue;
      const key = `country:${country.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const tzs = country.timezones ?? [];
      if (tzs.length === 0) continue;
      if (tzs.length === 1) {
        const tz = tzs[0];
        const offset = getUtcOffset(tz);
        const { time } = currentInTz(tz);
        results.push({
          name:             country.name,
          type:             'country',
          timezone:         tz,
          timezones:        null,
          ambiguous:        false,
          ambiguousMessage: null,
          countryCode:      country.id,
          flag:             flagEmoji(country.id),
          utcOffset:        `UTC${offset}`,
          currentTime:      time,
        });
      } else {
        // Multiple timezones — find city suggestions for this country
        const citySuggestions = cities
          .filter(c => c.country === country.id)
          .slice(0, 6)
          .map(c => c.name);
        const msg = citySuggestions.length > 0
          ? `${country.name} spans ${tzs.length} timezones. Try: ${citySuggestions.join(', ')}`
          : `${country.name} spans ${tzs.length} timezones — please search for a specific city`;
        results.push({
          name:             country.name,
          type:             'country',
          timezone:         null,
          timezones:        tzs,
          ambiguous:        true,
          ambiguousMessage: msg,
          countryCode:      country.id,
          flag:             flagEmoji(country.id),
          utcOffset:        null,
          currentTime:      null,
        });
      }
    }
  }

  const out = { results };
  cache.search.set(cacheKey, out);
  res.json(out);
});

// ── GET /api/timezone/convert ─────────────────────────────────────────────────
// Query params: from, to (IANA strings), time (HH:MM), date (YYYY-MM-DD)
timezoneRouter.get('/convert', requireAuth, (req: AuthRequest, res: Response) => {
  const { from, to, time, date } = req.query as Record<string, string>;
  if (!from || !to || !time || !date) {
    res.status(400).json({ error: 'from, to, time, date are required' });
    return;
  }

  const cacheKey = `convert:${from}:${to}:${time}:${date}`;
  const cached = cache.convert.get(cacheKey, 5_000);
  if (cached) { res.json(cached); return; }

  try {
    const [hh, mm] = time.split(':').map(Number);
    const [yyyy, mo, dd] = date.split('-').map(Number);

    // Build a Date object representing the input time in the "from" timezone.
    // We parse it as if it were UTC, then use Intl to re-interpret in the
    // from timezone — the cleanest way to handle DST edge cases.
    const utcDate = new Date(Date.UTC(yyyy, mo - 1, dd, hh, mm, 0));

    const fmtOpts: Intl.DateTimeFormatOptions = {
      timeZone: from, hour: '2-digit', minute: '2-digit', second: '2-digit',
      year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
    };

    // Get the wall-clock time in "from" timezone for the given UTC moment.
    // We treat the input HH:MM/date as local "from" time, so we need the
    // inverse: find the UTC moment whose "from" representation is (date HH:MM).
    // Use a simple approximation via offset arithmetic.
    const fromOffset = getUtcOffset(from, utcDate);
    const toOffset   = getUtcOffset(to,   utcDate);

    const offsetToMinutes = (s: string) => {
      const m = s.match(/^([+-])(\d{2}):(\d{2})$/);
      if (!m) return 0;
      return (m[1] === '+' ? 1 : -1) * (parseInt(m[2]) * 60 + parseInt(m[3]));
    };

    const fromMins = offsetToMinutes(fromOffset);
    const toMins   = offsetToMinutes(toOffset);

    // The input time (hh:mm on date) is local in "from" timezone.
    // UTC equivalent:
    const fromTotalMins = yyyy * 525600 + (mo - 1) * 43200 + (dd - 1) * 1440 + hh * 60 + mm;
    const toTotalMins   = fromTotalMins - fromMins + toMins;

    const diffDays = Math.floor(toTotalMins / 1440) - Math.floor((fromTotalMins - fromMins) / 1440 + Math.floor(fromMins / 1440));

    // Compute actual UTC moment from the "from" local time
    const inputUtc = new Date(Date.UTC(yyyy, mo - 1, dd, hh - Math.floor(fromMins / 60), mm - (fromMins % 60)));

    // Format the "from" time
    const fromFmt = new Intl.DateTimeFormat('en-GB', {
      ...fmtOpts, timeZone: from,
    });
    const toFmt = new Intl.DateTimeFormat('en-GB', {
      ...fmtOpts, timeZone: to,
    });

    const fromParts = fromFmt.formatToParts(inputUtc);
    const toParts   = toFmt.formatToParts(inputUtc);

    const getPart = (parts: Intl.DateTimeFormatPart[], type: string) =>
      parts.find(p => p.type === type)?.value ?? '';

    const fromTimeStr = `${getPart(fromParts, 'hour')}:${getPart(fromParts, 'minute')}`;
    const toTimeStr   = `${getPart(toParts, 'hour')}:${getPart(toParts, 'minute')}`;

    const fromDateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: from, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    }).format(inputUtc);
    const toDateStr = new Intl.DateTimeFormat('en-US', {
      timeZone: to, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    }).format(inputUtc);

    // Offset difference
    const diffMin = toMins - fromMins;
    const absDiff = Math.abs(diffMin);
    const diffHours = Math.floor(absDiff / 60);
    const diffMinutes = absDiff % 60;
    let offsetDifference: string;
    if (diffMin === 0) offsetDifference = '0 hours';
    else {
      const sign = diffMin > 0 ? '+' : '-';
      offsetDifference = diffMinutes > 0
        ? `${sign}${diffHours}h ${diffMinutes}m`
        : `${sign}${diffHours}h`;
    }

    // Day crossing: compare date parts
    const fromDay = parseInt(getPart(fromParts, 'day'));
    const toDay   = parseInt(getPart(toParts,   'day'));
    const fromMo  = parseInt(getPart(fromParts, 'month'));
    const toMo    = parseInt(getPart(toParts,   'month'));

    let crossesDay: 'forward' | 'backward' | null = null;
    const crossesMidnight = fromDay !== toDay || fromMo !== toMo;
    if (crossesMidnight) {
      // Compare year + month + day numerically
      const fromN = parseInt(getPart(fromParts, 'year')) * 10000 + fromMo * 100 + fromDay;
      const toN   = parseInt(getPart(toParts, 'year')) * 10000 + toMo * 100 + toDay;
      crossesDay = toN > fromN ? 'forward' : 'backward';
    }

    // Day difference in integer days
    const fromDate2 = new Date(inputUtc);
    fromDate2.setUTCHours(0, 0, 0, 0);
    const toInTz = new Intl.DateTimeFormat('en-CA', { timeZone: to, year: 'numeric', month: '2-digit', day: '2-digit' }).format(inputUtc);
    const fromInTz = new Intl.DateTimeFormat('en-CA', { timeZone: from, year: 'numeric', month: '2-digit', day: '2-digit' }).format(inputUtc);
    const toDayMs = new Date(toInTz).getTime();
    const fromDayMs = new Date(fromInTz).getTime();
    const dayDiff = Math.round((toDayMs - fromDayMs) / 86400000);

    const result = {
      fromTime:         fromTimeStr,
      toTime:           toTimeStr,
      fromDate:         fromDateStr,
      toDate:           toDateStr,
      offsetDifference,
      diffMinutes:      diffMin,
      dayDiff,
      crossesMidnight,
      crossesDay,
      fromOffset:       `UTC${fromOffset}`,
      toOffset:         `UTC${toOffset}`,
      fromDST:          isDST(from),
      toDST:            isDST(to),
    };
    cache.convert.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Conversion failed' });
  }
});

// ── GET /api/timezone/current?tz= ─────────────────────────────────────────────
timezoneRouter.get('/current', requireAuth, (req: AuthRequest, res: Response) => {
  const tz = ((req.query.tz as string) ?? '').trim();
  if (!tz) { res.status(400).json({ error: 'tz is required' }); return; }

  const cached = cache.current.get(tz, 1_000);
  if (cached) { res.json(cached); return; }

  try {
    const now = new Date();
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(now);
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).format(now);
    const offset = getUtcOffset(tz);
    const dst    = isDST(tz);
    const result = { time, date, utcOffset: `UTC${offset}`, isDST: dst };
    cache.current.set(tz, result);
    res.json(result);
  } catch {
    res.status(400).json({ error: `Invalid timezone: ${tz}` });
  }
});
