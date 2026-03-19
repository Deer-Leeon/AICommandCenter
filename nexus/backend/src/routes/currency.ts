import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const currencyRouter = Router();

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CachedRates {
  base: string;
  rates: Record<string, number>;
  time_last_update_utc: string;
  ts: number;
}

const rateCache = new Map<string, CachedRates>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── Constants ─────────────────────────────────────────────────────────────────

const EXCHANGE_FEES: Record<string, { label: string; fee: number }> = {
  wise:          { label: 'Wise',            fee: 0.007 },
  revolut:       { label: 'Revolut',         fee: 0.005 },
  credit_card:   { label: 'Credit Card',     fee: 0.028 },
  bank_transfer: { label: 'Bank Transfer',   fee: 0.035 },
  atm_abroad:    { label: 'ATM Abroad',      fee: 0.030 },
  paypal:        { label: 'PayPal',          fee: 0.044 },
  cash_exchange: { label: 'Cash Exchange',   fee: 0.055 },
  no_fee:        { label: 'No Fee / Crypto', fee: 0.000 },
};

const CURRENCY_META: Record<string, { name: string; flag: string; symbol: string }> = {
  USD: { name: 'US Dollar',           flag: '🇺🇸', symbol: '$'    },
  EUR: { name: 'Euro',                flag: '🇪🇺', symbol: '€'    },
  GBP: { name: 'British Pound',       flag: '🇬🇧', symbol: '£'    },
  JPY: { name: 'Japanese Yen',        flag: '🇯🇵', symbol: '¥'    },
  CHF: { name: 'Swiss Franc',         flag: '🇨🇭', symbol: 'Fr'   },
  CAD: { name: 'Canadian Dollar',     flag: '🇨🇦', symbol: '$'    },
  AUD: { name: 'Australian Dollar',   flag: '🇦🇺', symbol: '$'    },
  CNY: { name: 'Chinese Yuan',        flag: '🇨🇳', symbol: '¥'    },
  INR: { name: 'Indian Rupee',        flag: '🇮🇳', symbol: '₹'    },
  MXN: { name: 'Mexican Peso',        flag: '🇲🇽', symbol: '$'    },
  BRL: { name: 'Brazilian Real',      flag: '🇧🇷', symbol: 'R$'   },
  KRW: { name: 'South Korean Won',    flag: '🇰🇷', symbol: '₩'    },
  SGD: { name: 'Singapore Dollar',    flag: '🇸🇬', symbol: '$'    },
  HKD: { name: 'Hong Kong Dollar',    flag: '🇭🇰', symbol: '$'    },
  NOK: { name: 'Norwegian Krone',     flag: '🇳🇴', symbol: 'kr'   },
  SEK: { name: 'Swedish Krona',       flag: '🇸🇪', symbol: 'kr'   },
  DKK: { name: 'Danish Krone',        flag: '🇩🇰', symbol: 'kr'   },
  NZD: { name: 'New Zealand Dollar',  flag: '🇳🇿', symbol: '$'    },
  ZAR: { name: 'South African Rand',  flag: '🇿🇦', symbol: 'R'    },
  AED: { name: 'UAE Dirham',          flag: '🇦🇪', symbol: 'د.إ'  },
  SAR: { name: 'Saudi Riyal',         flag: '🇸🇦', symbol: '﷼'   },
  TRY: { name: 'Turkish Lira',        flag: '🇹🇷', symbol: '₺'    },
  RUB: { name: 'Russian Ruble',       flag: '🇷🇺', symbol: '₽'    },
  PLN: { name: 'Polish Złoty',        flag: '🇵🇱', symbol: 'zł'   },
  THB: { name: 'Thai Baht',           flag: '🇹🇭', symbol: '฿'    },
  IDR: { name: 'Indonesian Rupiah',   flag: '🇮🇩', symbol: 'Rp'   },
  MYR: { name: 'Malaysian Ringgit',   flag: '🇲🇾', symbol: 'RM'   },
  PHP: { name: 'Philippine Peso',     flag: '🇵🇭', symbol: '₱'    },
  CZK: { name: 'Czech Koruna',        flag: '🇨🇿', symbol: 'Kč'   },
  HUF: { name: 'Hungarian Forint',    flag: '🇭🇺', symbol: 'Ft'   },
  ILS: { name: 'Israeli Shekel',      flag: '🇮🇱', symbol: '₪'    },
  CLP: { name: 'Chilean Peso',        flag: '🇨🇱', symbol: '$'    },
  COP: { name: 'Colombian Peso',      flag: '🇨🇴', symbol: '$'    },
  ARS: { name: 'Argentine Peso',      flag: '🇦🇷', symbol: '$'    },
  EGP: { name: 'Egyptian Pound',      flag: '🇪🇬', symbol: '£'    },
  NGN: { name: 'Nigerian Naira',      flag: '🇳🇬', symbol: '₦'    },
  PKR: { name: 'Pakistani Rupee',     flag: '🇵🇰', symbol: '₨'    },
  BDT: { name: 'Bangladeshi Taka',    flag: '🇧🇩', symbol: '৳'    },
  VND: { name: 'Vietnamese Dong',     flag: '🇻🇳', symbol: '₫'    },
  UAH: { name: 'Ukrainian Hryvnia',   flag: '🇺🇦', symbol: '₴'    },
};

const MAJOR_CODES = Object.keys(CURRENCY_META);

// ── Helper ────────────────────────────────────────────────────────────────────

async function fetchRates(base: string): Promise<{
  rates: Record<string, number>;
  time_last_update_utc: string;
  stale: boolean;
}> {
  const upper = base.toUpperCase();
  const cached = rateCache.get(upper);
  const now = Date.now();

  if (cached && now - cached.ts < CACHE_TTL) {
    return { rates: cached.rates, time_last_update_utc: cached.time_last_update_utc, stale: false };
  }

  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${upper}`, {
      headers: { 'User-Agent': 'NEXUS-Dashboard/1.0' },
    });
    const data = await res.json() as {
      result: string;
      base_code: string;
      rates: Record<string, number>;
      time_last_update_utc: string;
    };
    if (data.result !== 'success') throw new Error('API returned non-success');
    rateCache.set(upper, {
      base: data.base_code,
      rates: data.rates,
      time_last_update_utc: data.time_last_update_utc,
      ts: now,
    });
    return { rates: data.rates, time_last_update_utc: data.time_last_update_utc, stale: false };
  } catch {
    if (cached) {
      return { rates: cached.rates, time_last_update_utc: cached.time_last_update_utc, stale: true };
    }
    throw new Error('Unable to fetch exchange rates');
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/currency/rates?base=USD
currencyRouter.get('/rates', requireAuth, async (req: AuthRequest, res) => {
  const base = ((req.query.base as string) || 'USD').toUpperCase();
  try {
    const data = await fetchRates(base);
    res.json({ base, ...data });
  } catch {
    res.status(503).json({ error: 'Unable to fetch exchange rates' });
  }
});

// GET /api/currency/convert?from=USD&to=EUR&amount=1000
currencyRouter.get('/convert', requireAuth, async (req: AuthRequest, res) => {
  const from   = ((req.query.from   as string) || 'USD').toUpperCase();
  const to     = ((req.query.to     as string) || 'EUR').toUpperCase();
  const amount = Math.max(0, parseFloat(req.query.amount as string) || 1);

  try {
    const { rates, time_last_update_utc, stale } = await fetchRates(from);
    const rate = rates[to];
    if (!rate) return res.status(400).json({ error: `Unknown currency code: ${to}` });

    const converted   = amount * rate;
    const inverseRate = 1 / rate;

    const withFees: Record<string, {
      label: string; fee: number;
      feeAmount: number; received: number; youLose: number;
    }> = {};
    for (const [method, { label, fee }] of Object.entries(EXCHANGE_FEES)) {
      const feeAmount = amount * fee;
      withFees[method] = {
        label, fee, feeAmount,
        received: (amount - feeAmount) * rate,
        youLose: feeAmount,
      };
    }

    res.json({ from, to, amount, rate, converted, inverseRate, ratesTimestamp: time_last_update_utc, stale, withFees });
  } catch {
    res.status(503).json({ error: 'Unable to convert currency' });
  }
});

// GET /api/currency/list
currencyRouter.get('/list', requireAuth, (_req: AuthRequest, res) => {
  const currencies = MAJOR_CODES.map(code => ({ code, ...CURRENCY_META[code] }));
  res.json({ currencies, majorCodes: MAJOR_CODES });
});

// ── Historical rates (frankfurter.app — free, no API key, ECB data) ───────────
//
// frankfurter.app provides daily FX rates from 1999 to present for ~30 major
// currencies. Weekend / holiday gaps are normal — the API only returns business
// days. Results are cached for 4 hours to avoid hammering the free service.

interface HistoryEntry { rates: Array<{ date: string; rate: number }>; ts: number; }
const histCache = new Map<string, HistoryEntry>();
const HIST_TTL  = 4 * 60 * 60 * 1000; // 4 hours

// GET /api/currency/history?from=USD&to=EUR&days=30
currencyRouter.get('/history', requireAuth, async (req: AuthRequest, res) => {
  const from = ((req.query.from as string) || 'USD').toUpperCase();
  const to   = ((req.query.to   as string) || 'EUR').toUpperCase();
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));

  const key    = `${from}:${to}:${days}`;
  const cached = histCache.get(key);
  if (cached && Date.now() - cached.ts < HIST_TTL) {
    return res.json({ from, to, days, rates: cached.rates });
  }

  try {
    const now   = new Date();
    const start = new Date(now.getTime() - days * 86_400_000);
    const fmt   = (d: Date) => d.toISOString().slice(0, 10);

    const apiRes = await fetch(
      `https://api.frankfurter.app/${fmt(start)}..${fmt(now)}?from=${from}&to=${to}`,
      { headers: { 'User-Agent': 'NEXUS-Dashboard/1.0' } },
    );
    if (!apiRes.ok) throw new Error(`frankfurter.app returned ${apiRes.status}`);

    const d = await apiRes.json() as { rates: Record<string, Record<string, number>> };
    const rates = Object.entries(d.rates)
      .map(([date, rateObj]) => ({ date, rate: rateObj[to] ?? 0 }))
      .filter(p => p.rate > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    histCache.set(key, { rates, ts: Date.now() });
    return res.json({ from, to, days, rates });
  } catch {
    if (cached) return res.json({ from, to, days, rates: cached.rates, stale: true });
    return res.status(503).json({ error: 'Unable to fetch historical rates' });
  }
});
