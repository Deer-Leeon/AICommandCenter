import { Router, type Response } from 'express';
import * as ct from 'countries-and-timezones';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

interface City { name: string; aliases: string[]; timezone: string; country: string }

// Inlined so the compiled dist/ output is self-contained (TSC doesn't copy .json files).
const cities: City[] = [
  { name: 'New York', aliases: ['nyc', 'new york city', 'ny'], timezone: 'America/New_York', country: 'US' },
  { name: 'Los Angeles', aliases: ['la', 'l.a.', 'lax'], timezone: 'America/Los_Angeles', country: 'US' },
  { name: 'Chicago', aliases: ['chi'], timezone: 'America/Chicago', country: 'US' },
  { name: 'Houston', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'Phoenix', aliases: [], timezone: 'America/Phoenix', country: 'US' },
  { name: 'Philadelphia', aliases: ['philly'], timezone: 'America/New_York', country: 'US' },
  { name: 'San Antonio', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'San Diego', aliases: [], timezone: 'America/Los_Angeles', country: 'US' },
  { name: 'Dallas', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'San Jose', aliases: [], timezone: 'America/Los_Angeles', country: 'US' },
  { name: 'Austin', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'Jacksonville', aliases: [], timezone: 'America/New_York', country: 'US' },
  { name: 'Fort Worth', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'Columbus', aliases: [], timezone: 'America/New_York', country: 'US' },
  { name: 'Charlotte', aliases: [], timezone: 'America/New_York', country: 'US' },
  { name: 'San Francisco', aliases: ['sf', 'frisco'], timezone: 'America/Los_Angeles', country: 'US' },
  { name: 'Indianapolis', aliases: [], timezone: 'America/Indiana/Indianapolis', country: 'US' },
  { name: 'Seattle', aliases: [], timezone: 'America/Los_Angeles', country: 'US' },
  { name: 'Denver', aliases: [], timezone: 'America/Denver', country: 'US' },
  { name: 'Nashville', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'Washington DC', aliases: ['washington', 'dc', 'd.c.'], timezone: 'America/New_York', country: 'US' },
  { name: 'Boston', aliases: [], timezone: 'America/New_York', country: 'US' },
  { name: 'Miami', aliases: [], timezone: 'America/New_York', country: 'US' },
  { name: 'Las Vegas', aliases: ['vegas'], timezone: 'America/Los_Angeles', country: 'US' },
  { name: 'Atlanta', aliases: [], timezone: 'America/New_York', country: 'US' },
  { name: 'Minneapolis', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'Portland', aliases: [], timezone: 'America/Los_Angeles', country: 'US' },
  { name: 'Anchorage', aliases: [], timezone: 'America/Anchorage', country: 'US' },
  { name: 'Honolulu', aliases: ['hawaii'], timezone: 'Pacific/Honolulu', country: 'US' },
  { name: 'Detroit', aliases: [], timezone: 'America/Detroit', country: 'US' },
  { name: 'Memphis', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'New Orleans', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'Salt Lake City', aliases: ['slc'], timezone: 'America/Denver', country: 'US' },
  { name: 'Kansas City', aliases: [], timezone: 'America/Chicago', country: 'US' },
  { name: 'Toronto', aliases: [], timezone: 'America/Toronto', country: 'CA' },
  { name: 'Vancouver', aliases: [], timezone: 'America/Vancouver', country: 'CA' },
  { name: 'Montreal', aliases: [], timezone: 'America/Toronto', country: 'CA' },
  { name: 'Calgary', aliases: [], timezone: 'America/Edmonton', country: 'CA' },
  { name: 'Edmonton', aliases: [], timezone: 'America/Edmonton', country: 'CA' },
  { name: 'Ottawa', aliases: [], timezone: 'America/Toronto', country: 'CA' },
  { name: 'Winnipeg', aliases: [], timezone: 'America/Winnipeg', country: 'CA' },
  { name: 'Mexico City', aliases: ['cdmx'], timezone: 'America/Mexico_City', country: 'MX' },
  { name: 'Guadalajara', aliases: [], timezone: 'America/Mexico_City', country: 'MX' },
  { name: 'Monterrey', aliases: [], timezone: 'America/Monterrey', country: 'MX' },
  { name: 'São Paulo', aliases: ['sao paulo', 'sp'], timezone: 'America/Sao_Paulo', country: 'BR' },
  { name: 'Rio de Janeiro', aliases: ['rio'], timezone: 'America/Sao_Paulo', country: 'BR' },
  { name: 'Brasília', aliases: ['brasilia'], timezone: 'America/Sao_Paulo', country: 'BR' },
  { name: 'Salvador', aliases: [], timezone: 'America/Bahia', country: 'BR' },
  { name: 'Fortaleza', aliases: [], timezone: 'America/Fortaleza', country: 'BR' },
  { name: 'Manaus', aliases: [], timezone: 'America/Manaus', country: 'BR' },
  { name: 'Buenos Aires', aliases: [], timezone: 'America/Argentina/Buenos_Aires', country: 'AR' },
  { name: 'Córdoba', aliases: ['cordoba'], timezone: 'America/Argentina/Cordoba', country: 'AR' },
  { name: 'Santiago', aliases: [], timezone: 'America/Santiago', country: 'CL' },
  { name: 'Lima', aliases: [], timezone: 'America/Lima', country: 'PE' },
  { name: 'Bogotá', aliases: ['bogota'], timezone: 'America/Bogota', country: 'CO' },
  { name: 'Caracas', aliases: [], timezone: 'America/Caracas', country: 'VE' },
  { name: 'Quito', aliases: [], timezone: 'America/Guayaquil', country: 'EC' },
  { name: 'La Paz', aliases: [], timezone: 'America/La_Paz', country: 'BO' },
  { name: 'Asunción', aliases: ['asuncion'], timezone: 'America/Asuncion', country: 'PY' },
  { name: 'Montevideo', aliases: [], timezone: 'America/Montevideo', country: 'UY' },
  { name: 'Panama City', aliases: ['panama'], timezone: 'America/Panama', country: 'PA' },
  { name: 'Havana', aliases: [], timezone: 'America/Havana', country: 'CU' },
  { name: 'London', aliases: ['uk', 'england'], timezone: 'Europe/London', country: 'GB' },
  { name: 'Paris', aliases: [], timezone: 'Europe/Paris', country: 'FR' },
  { name: 'Berlin', aliases: [], timezone: 'Europe/Berlin', country: 'DE' },
  { name: 'Madrid', aliases: [], timezone: 'Europe/Madrid', country: 'ES' },
  { name: 'Rome', aliases: ['roma'], timezone: 'Europe/Rome', country: 'IT' },
  { name: 'Amsterdam', aliases: [], timezone: 'Europe/Amsterdam', country: 'NL' },
  { name: 'Brussels', aliases: ['bruxelles'], timezone: 'Europe/Brussels', country: 'BE' },
  { name: 'Vienna', aliases: ['wien'], timezone: 'Europe/Vienna', country: 'AT' },
  { name: 'Zurich', aliases: ['zürich'], timezone: 'Europe/Zurich', country: 'CH' },
  { name: 'Geneva', aliases: ['genève', 'genf'], timezone: 'Europe/Zurich', country: 'CH' },
  { name: 'Stockholm', aliases: [], timezone: 'Europe/Stockholm', country: 'SE' },
  { name: 'Oslo', aliases: [], timezone: 'Europe/Oslo', country: 'NO' },
  { name: 'Copenhagen', aliases: ['københavn'], timezone: 'Europe/Copenhagen', country: 'DK' },
  { name: 'Helsinki', aliases: [], timezone: 'Europe/Helsinki', country: 'FI' },
  { name: 'Warsaw', aliases: ['warszawa'], timezone: 'Europe/Warsaw', country: 'PL' },
  { name: 'Prague', aliases: ['praha'], timezone: 'Europe/Prague', country: 'CZ' },
  { name: 'Budapest', aliases: [], timezone: 'Europe/Budapest', country: 'HU' },
  { name: 'Bucharest', aliases: ['bucurești'], timezone: 'Europe/Bucharest', country: 'RO' },
  { name: 'Athens', aliases: ['athina'], timezone: 'Europe/Athens', country: 'GR' },
  { name: 'Lisbon', aliases: ['lisboa'], timezone: 'Europe/Lisbon', country: 'PT' },
  { name: 'Dublin', aliases: [], timezone: 'Europe/Dublin', country: 'IE' },
  { name: 'Edinburgh', aliases: [], timezone: 'Europe/London', country: 'GB' },
  { name: 'Manchester', aliases: [], timezone: 'Europe/London', country: 'GB' },
  { name: 'Birmingham', aliases: [], timezone: 'Europe/London', country: 'GB' },
  { name: 'Barcelona', aliases: ['barna'], timezone: 'Europe/Madrid', country: 'ES' },
  { name: 'Milan', aliases: ['milano'], timezone: 'Europe/Rome', country: 'IT' },
  { name: 'Naples', aliases: ['napoli'], timezone: 'Europe/Rome', country: 'IT' },
  { name: 'Hamburg', aliases: [], timezone: 'Europe/Berlin', country: 'DE' },
  { name: 'Munich', aliases: ['münchen'], timezone: 'Europe/Berlin', country: 'DE' },
  { name: 'Frankfurt', aliases: [], timezone: 'Europe/Berlin', country: 'DE' },
  { name: 'Cologne', aliases: ['köln'], timezone: 'Europe/Berlin', country: 'DE' },
  { name: 'Lyon', aliases: [], timezone: 'Europe/Paris', country: 'FR' },
  { name: 'Marseille', aliases: [], timezone: 'Europe/Paris', country: 'FR' },
  { name: 'Moscow', aliases: ['moskva'], timezone: 'Europe/Moscow', country: 'RU' },
  { name: 'Saint Petersburg', aliases: ['st petersburg', 'spb'], timezone: 'Europe/Moscow', country: 'RU' },
  { name: 'Novosibirsk', aliases: [], timezone: 'Asia/Novosibirsk', country: 'RU' },
  { name: 'Yekaterinburg', aliases: ['ekaterinburg'], timezone: 'Asia/Yekaterinburg', country: 'RU' },
  { name: 'Vladivostok', aliases: [], timezone: 'Asia/Vladivostok', country: 'RU' },
  { name: 'Kyiv', aliases: ['kiev'], timezone: 'Europe/Kyiv', country: 'UA' },
  { name: 'Minsk', aliases: [], timezone: 'Europe/Minsk', country: 'BY' },
  { name: 'Riga', aliases: [], timezone: 'Europe/Riga', country: 'LV' },
  { name: 'Tallinn', aliases: [], timezone: 'Europe/Tallinn', country: 'EE' },
  { name: 'Vilnius', aliases: [], timezone: 'Europe/Vilnius', country: 'LT' },
  { name: 'Sofia', aliases: [], timezone: 'Europe/Sofia', country: 'BG' },
  { name: 'Belgrade', aliases: ['beograd'], timezone: 'Europe/Belgrade', country: 'RS' },
  { name: 'Zagreb', aliases: [], timezone: 'Europe/Zagreb', country: 'HR' },
  { name: 'Ljubljana', aliases: [], timezone: 'Europe/Ljubljana', country: 'SI' },
  { name: 'Reykjavik', aliases: [], timezone: 'Atlantic/Reykjavik', country: 'IS' },
  { name: 'Tokyo', aliases: [], timezone: 'Asia/Tokyo', country: 'JP' },
  { name: 'Osaka', aliases: [], timezone: 'Asia/Tokyo', country: 'JP' },
  { name: 'Yokohama', aliases: [], timezone: 'Asia/Tokyo', country: 'JP' },
  { name: 'Nagoya', aliases: [], timezone: 'Asia/Tokyo', country: 'JP' },
  { name: 'Sapporo', aliases: [], timezone: 'Asia/Tokyo', country: 'JP' },
  { name: 'Beijing', aliases: ['peking'], timezone: 'Asia/Shanghai', country: 'CN' },
  { name: 'Shanghai', aliases: [], timezone: 'Asia/Shanghai', country: 'CN' },
  { name: 'Guangzhou', aliases: ['canton'], timezone: 'Asia/Shanghai', country: 'CN' },
  { name: 'Shenzhen', aliases: [], timezone: 'Asia/Shanghai', country: 'CN' },
  { name: 'Chengdu', aliases: [], timezone: 'Asia/Shanghai', country: 'CN' },
  { name: 'Chongqing', aliases: [], timezone: 'Asia/Shanghai', country: 'CN' },
  { name: 'Wuhan', aliases: [], timezone: 'Asia/Shanghai', country: 'CN' },
  { name: 'Tianjin', aliases: [], timezone: 'Asia/Shanghai', country: 'CN' },
  { name: "Xi'an", aliases: ['xian'], timezone: 'Asia/Shanghai', country: 'CN' },
  { name: 'Hong Kong', aliases: ['hk', 'hongkong'], timezone: 'Asia/Hong_Kong', country: 'HK' },
  { name: 'Macau', aliases: [], timezone: 'Asia/Macau', country: 'MO' },
  { name: 'Seoul', aliases: [], timezone: 'Asia/Seoul', country: 'KR' },
  { name: 'Busan', aliases: [], timezone: 'Asia/Seoul', country: 'KR' },
  { name: 'Mumbai', aliases: ['bombay'], timezone: 'Asia/Kolkata', country: 'IN' },
  { name: 'Delhi', aliases: ['new delhi'], timezone: 'Asia/Kolkata', country: 'IN' },
  { name: 'Bangalore', aliases: ['bengaluru'], timezone: 'Asia/Kolkata', country: 'IN' },
  { name: 'Hyderabad', aliases: [], timezone: 'Asia/Kolkata', country: 'IN' },
  { name: 'Chennai', aliases: ['madras'], timezone: 'Asia/Kolkata', country: 'IN' },
  { name: 'Kolkata', aliases: ['calcutta'], timezone: 'Asia/Kolkata', country: 'IN' },
  { name: 'Ahmedabad', aliases: [], timezone: 'Asia/Kolkata', country: 'IN' },
  { name: 'Pune', aliases: [], timezone: 'Asia/Kolkata', country: 'IN' },
  { name: 'Jaipur', aliases: [], timezone: 'Asia/Kolkata', country: 'IN' },
  { name: 'Karachi', aliases: [], timezone: 'Asia/Karachi', country: 'PK' },
  { name: 'Lahore', aliases: [], timezone: 'Asia/Karachi', country: 'PK' },
  { name: 'Islamabad', aliases: [], timezone: 'Asia/Karachi', country: 'PK' },
  { name: 'Dhaka', aliases: [], timezone: 'Asia/Dhaka', country: 'BD' },
  { name: 'Chittagong', aliases: [], timezone: 'Asia/Dhaka', country: 'BD' },
  { name: 'Colombo', aliases: [], timezone: 'Asia/Colombo', country: 'LK' },
  { name: 'Kathmandu', aliases: [], timezone: 'Asia/Kathmandu', country: 'NP' },
  { name: 'Bangkok', aliases: [], timezone: 'Asia/Bangkok', country: 'TH' },
  { name: 'Singapore', aliases: ['sg', 'sgp'], timezone: 'Asia/Singapore', country: 'SG' },
  { name: 'Kuala Lumpur', aliases: ['kl'], timezone: 'Asia/Kuala_Lumpur', country: 'MY' },
  { name: 'Jakarta', aliases: [], timezone: 'Asia/Jakarta', country: 'ID' },
  { name: 'Surabaya', aliases: [], timezone: 'Asia/Jakarta', country: 'ID' },
  { name: 'Bali', aliases: ['denpasar'], timezone: 'Asia/Makassar', country: 'ID' },
  { name: 'Manila', aliases: [], timezone: 'Asia/Manila', country: 'PH' },
  { name: 'Ho Chi Minh City', aliases: ['saigon', 'hcmc'], timezone: 'Asia/Ho_Chi_Minh', country: 'VN' },
  { name: 'Hanoi', aliases: [], timezone: 'Asia/Bangkok', country: 'VN' },
  { name: 'Yangon', aliases: ['rangoon'], timezone: 'Asia/Yangon', country: 'MM' },
  { name: 'Phnom Penh', aliases: [], timezone: 'Asia/Phnom_Penh', country: 'KH' },
  { name: 'Taipei', aliases: [], timezone: 'Asia/Taipei', country: 'TW' },
  { name: 'Dubai', aliases: [], timezone: 'Asia/Dubai', country: 'AE' },
  { name: 'Abu Dhabi', aliases: [], timezone: 'Asia/Dubai', country: 'AE' },
  { name: 'Riyadh', aliases: [], timezone: 'Asia/Riyadh', country: 'SA' },
  { name: 'Jeddah', aliases: [], timezone: 'Asia/Riyadh', country: 'SA' },
  { name: 'Mecca', aliases: ['makkah'], timezone: 'Asia/Riyadh', country: 'SA' },
  { name: 'Kuwait City', aliases: ['kuwait'], timezone: 'Asia/Kuwait', country: 'KW' },
  { name: 'Doha', aliases: [], timezone: 'Asia/Qatar', country: 'QA' },
  { name: 'Manama', aliases: [], timezone: 'Asia/Bahrain', country: 'BH' },
  { name: 'Muscat', aliases: [], timezone: 'Asia/Muscat', country: 'OM' },
  { name: 'Istanbul', aliases: ['constantinople'], timezone: 'Europe/Istanbul', country: 'TR' },
  { name: 'Ankara', aliases: [], timezone: 'Europe/Istanbul', country: 'TR' },
  { name: 'Tehran', aliases: [], timezone: 'Asia/Tehran', country: 'IR' },
  { name: 'Baghdad', aliases: [], timezone: 'Asia/Baghdad', country: 'IQ' },
  { name: 'Beirut', aliases: [], timezone: 'Asia/Beirut', country: 'LB' },
  { name: 'Damascus', aliases: [], timezone: 'Asia/Damascus', country: 'SY' },
  { name: 'Amman', aliases: [], timezone: 'Asia/Amman', country: 'JO' },
  { name: 'Jerusalem', aliases: [], timezone: 'Asia/Jerusalem', country: 'IL' },
  { name: 'Tel Aviv', aliases: [], timezone: 'Asia/Jerusalem', country: 'IL' },
  { name: 'Kabul', aliases: [], timezone: 'Asia/Kabul', country: 'AF' },
  { name: 'Tashkent', aliases: [], timezone: 'Asia/Tashkent', country: 'UZ' },
  { name: 'Almaty', aliases: [], timezone: 'Asia/Almaty', country: 'KZ' },
  { name: 'Baku', aliases: [], timezone: 'Asia/Baku', country: 'AZ' },
  { name: 'Tbilisi', aliases: [], timezone: 'Asia/Tbilisi', country: 'GE' },
  { name: 'Yerevan', aliases: [], timezone: 'Asia/Yerevan', country: 'AM' },
  { name: 'Cairo', aliases: ['al-qahirah'], timezone: 'Africa/Cairo', country: 'EG' },
  { name: 'Lagos', aliases: [], timezone: 'Africa/Lagos', country: 'NG' },
  { name: 'Kinshasa', aliases: [], timezone: 'Africa/Kinshasa', country: 'CD' },
  { name: 'Luanda', aliases: [], timezone: 'Africa/Luanda', country: 'AO' },
  { name: 'Nairobi', aliases: [], timezone: 'Africa/Nairobi', country: 'KE' },
  { name: 'Dar es Salaam', aliases: [], timezone: 'Africa/Dar_es_Salaam', country: 'TZ' },
  { name: 'Addis Ababa', aliases: [], timezone: 'Africa/Addis_Ababa', country: 'ET' },
  { name: 'Khartoum', aliases: [], timezone: 'Africa/Khartoum', country: 'SD' },
  { name: 'Casablanca', aliases: [], timezone: 'Africa/Casablanca', country: 'MA' },
  { name: 'Algiers', aliases: [], timezone: 'Africa/Algiers', country: 'DZ' },
  { name: 'Tunis', aliases: [], timezone: 'Africa/Tunis', country: 'TN' },
  { name: 'Accra', aliases: [], timezone: 'Africa/Accra', country: 'GH' },
  { name: 'Dakar', aliases: [], timezone: 'Africa/Dakar', country: 'SN' },
  { name: 'Abidjan', aliases: [], timezone: 'Africa/Abidjan', country: 'CI' },
  { name: 'Johannesburg', aliases: ['joburg', 'jozi'], timezone: 'Africa/Johannesburg', country: 'ZA' },
  { name: 'Cape Town', aliases: [], timezone: 'Africa/Johannesburg', country: 'ZA' },
  { name: 'Durban', aliases: [], timezone: 'Africa/Johannesburg', country: 'ZA' },
  { name: 'Harare', aliases: [], timezone: 'Africa/Harare', country: 'ZW' },
  { name: 'Kampala', aliases: [], timezone: 'Africa/Kampala', country: 'UG' },
  { name: 'Lusaka', aliases: [], timezone: 'Africa/Lusaka', country: 'ZM' },
  { name: 'Maputo', aliases: [], timezone: 'Africa/Maputo', country: 'MZ' },
  { name: 'Sydney', aliases: [], timezone: 'Australia/Sydney', country: 'AU' },
  { name: 'Melbourne', aliases: [], timezone: 'Australia/Melbourne', country: 'AU' },
  { name: 'Brisbane', aliases: [], timezone: 'Australia/Brisbane', country: 'AU' },
  { name: 'Perth', aliases: [], timezone: 'Australia/Perth', country: 'AU' },
  { name: 'Adelaide', aliases: [], timezone: 'Australia/Adelaide', country: 'AU' },
  { name: 'Canberra', aliases: [], timezone: 'Australia/Sydney', country: 'AU' },
  { name: 'Auckland', aliases: [], timezone: 'Pacific/Auckland', country: 'NZ' },
  { name: 'Wellington', aliases: [], timezone: 'Pacific/Auckland', country: 'NZ' },
  { name: 'Christchurch', aliases: [], timezone: 'Pacific/Auckland', country: 'NZ' },
  { name: 'Suva', aliases: [], timezone: 'Pacific/Fiji', country: 'FJ' },
  { name: 'Port Moresby', aliases: [], timezone: 'Pacific/Port_Moresby', country: 'PG' },
  { name: 'Ulaanbaatar', aliases: [], timezone: 'Asia/Ulaanbaatar', country: 'MN' },
  { name: 'Male', aliases: [], timezone: 'Indian/Maldives', country: 'MV' },
  { name: 'Thimphu', aliases: [], timezone: 'Asia/Thimphu', country: 'BT' },
  { name: 'Bishkek', aliases: [], timezone: 'Asia/Bishkek', country: 'KG' },
  { name: 'Nicosia', aliases: [], timezone: 'Asia/Nicosia', country: 'CY' },
  { name: 'Nuuk', aliases: [], timezone: 'America/Nuuk', country: 'GL' },
  { name: 'Kingston', aliases: [], timezone: 'America/Jamaica', country: 'JM' },
  { name: 'Havana', aliases: [], timezone: 'America/Havana', country: 'CU' },
  { name: 'San Juan', aliases: ['puerto rico'], timezone: 'America/Puerto_Rico', country: 'PR' },
  { name: 'Nassau', aliases: [], timezone: 'America/Nassau', country: 'BS' },
  { name: 'Santo Domingo', aliases: [], timezone: 'America/Santo_Domingo', country: 'DO' },
];

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

      // Deduplicate by current UTC offset — e.g. Germany has Europe/Berlin + Europe/Busingen
      // but both share the same offset (CET/CEST), so they are effectively one timezone.
      const seenOffsets = new Set<string>();
      const uniqueTzs = tzs.filter(tz => {
        const off = getUtcOffset(tz);
        if (seenOffsets.has(off)) return false;
        seenOffsets.add(off);
        return true;
      });

      if (uniqueTzs.length <= 1) {
        const tz = uniqueTzs[0] ?? tzs[0];
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
        // Multiple distinct timezones — find city suggestions for this country
        const citySuggestions = cities
          .filter(c => c.country === country.id)
          .slice(0, 6)
          .map(c => c.name);
        const msg = citySuggestions.length > 0
          ? `${country.name} spans ${uniqueTzs.length} timezones. Try: ${citySuggestions.join(', ')}`
          : `${country.name} spans ${uniqueTzs.length} timezones — please search for a specific city`;
        results.push({
          name:             country.name,
          type:             'country',
          timezone:         null,
          timezones:        uniqueTzs,
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
