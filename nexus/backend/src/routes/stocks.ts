import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const stocksRouter = Router();

// ── Finnhub config ────────────────────────────────────────────────────────────

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function fhKey(): string {
  const key = process.env.FINNHUB_API_KEY ?? '';
  if (!key) throw new Error('FINNHUB_API_KEY is not configured');
  return key;
}

async function fhFetch<T>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FINNHUB_BASE}${path}${sep}token=${fhKey()}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Finnhub ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

// ── In-memory TTL cache ───────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; ts: number }

function makeCache<T>() {
  const map = new Map<string, CacheEntry<T>>();
  return {
    get(key: string, ttlMs: number): T | null {
      const entry = map.get(key);
      if (!entry) return null;
      if (Date.now() - entry.ts > ttlMs) { map.delete(key); return null; }
      return entry.data;
    },
    set(key: string, data: T) { map.set(key, { data, ts: Date.now() }); },
  };
}

const quoteCache   = makeCache<unknown>();
const historyCache = makeCache<unknown>();
const searchCache  = makeCache<unknown>();
const profileCache = makeCache<unknown>();

const QUOTE_TTL   =    60_000; // 1 min  — live prices
const HISTORY_TTL =   900_000; // 15 min — historical bars
const SEARCH_TTL  =   300_000; // 5 min  — autocomplete
const PROFILE_TTL = 3_600_000; // 1 hour — company names / market cap

const DEFAULT_SYMBOLS = ['AAPL', 'TSLA', 'GOOGL', 'MSFT', 'NVDA', 'AMZN', 'META', 'SPY'];

// Finnhub candle resolution + lookback days per range key
const RANGE_CONFIG: Record<string, { resolution: string; days: number }> = {
  '1D': { resolution: '5',  days: 2   },
  '1W': { resolution: '60', days: 7   },
  '1M': { resolution: 'D',  days: 30  },
  '3M': { resolution: 'D',  days: 90  },
  '1Y': { resolution: 'W',  days: 365 },
};

// Yahoo Finance interval + range per range key (used as fallback when Finnhub candles fail)
const YF_RANGE_CONFIG: Record<string, { interval: string; range: string }> = {
  '1D': { interval: '5m',  range: '1d'  },
  '1W': { interval: '60m', range: '5d'  },
  '1M': { interval: '1d',  range: '1mo' },
  '3M': { interval: '1d',  range: '3mo' },
  '1Y': { interval: '1wk', range: '1y'  },
};

// Browser-like headers let this pass through any User-Agent checks Yahoo Finance applies.
// The Docker container NATing through a residential Mac IP is not in Yahoo's cloud-IP block list.
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

interface YFBar { time: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null }

async function fetchYahooCandles(symbol: string, rangeKey: string): Promise<YFBar[]> {
  const cfg = YF_RANGE_CONFIG[rangeKey] ?? YF_RANGE_CONFIG['1M'];
  const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`;
  const res  = await fetch(url, { headers: YF_HEADERS });
  if (!res.ok) throw new Error(`Yahoo Finance ${res.status} for ${symbol}`);
  const json = await res.json() as {
    chart?: { result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: (number|null)[]; high?: (number|null)[]; low?: (number|null)[]; close?: (number|null)[]; volume?: (number|null)[] }> };
    }> };
  };
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('Empty Yahoo Finance response');
  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  return timestamps
    .map((ts, i) => ({
      time:   new Date(ts * 1000).toISOString(),
      open:   q.open?.[i]   ?? null,
      high:   q.high?.[i]   ?? null,
      low:    q.low?.[i]    ?? null,
      close:  q.close?.[i]  ?? 0,
      volume: q.volume?.[i] ?? null,
    }))
    .filter((b) => b.close != null && b.close !== 0);
}

// ── Finnhub response types ────────────────────────────────────────────────────

interface FHQuote {
  c: number;   // current price
  d: number;   // change
  dp: number;  // change percent
  h: number;   // day high
  l: number;   // day low
  t: number;   // unix timestamp
}

interface FHCandle {
  s: 'ok' | 'no_data';
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  t: number[];
  v: number[];
}

interface FHProfile {
  name: string;
  marketCapitalization: number; // millions
}

interface FHMetric {
  metric: {
    '52WeekHigh'?: number;
    '52WeekLow'?: number;
  };
}

interface FHSearchResult {
  description: string;
  displaySymbol: string;
  symbol: string;
  type: string;
}

interface FHSearch { result: FHSearchResult[] }

// ── Per-symbol helpers ────────────────────────────────────────────────────────

async function fetchProfile(symbol: string): Promise<FHProfile> {
  const cached = profileCache.get(symbol, PROFILE_TTL) as FHProfile | null;
  if (cached) return cached;
  const data = await fhFetch<FHProfile>(`/stock/profile2?symbol=${symbol}`);
  profileCache.set(symbol, data);
  return data;
}

async function fetchSparkline(symbol: string): Promise<number[]> {
  const cacheKey = `spark_${symbol}`;
  const cached = historyCache.get(cacheKey, HISTORY_TTL) as number[] | null;
  if (cached) return cached;

  // Try Yahoo Finance first (5-day daily bars work great for sparklines)
  try {
    const bars = await fetchYahooCandles(symbol, '1W');
    const closes = bars.map((b) => b.close);
    if (closes.length > 0) {
      historyCache.set(cacheKey, closes);
      return closes;
    }
  } catch { /* fall through to Finnhub */ }

  // Finnhub fallback
  const to   = Math.floor(Date.now() / 1000);
  const from = to - 8 * 86400;
  try {
    const data = await fhFetch<FHCandle>(
      `/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}`,
    );
    const closes = data.s === 'ok' ? data.c : [];
    historyCache.set(cacheKey, closes);
    return closes;
  } catch {
    return [];
  }
}

async function fetchMetrics(symbol: string): Promise<{ fiftyTwoWeekHigh: number | null; fiftyTwoWeekLow: number | null }> {
  const cacheKey = `metric_${symbol}`;
  const cached = historyCache.get(cacheKey, HISTORY_TTL);
  if (cached) return cached as { fiftyTwoWeekHigh: number | null; fiftyTwoWeekLow: number | null };

  try {
    const data = await fhFetch<FHMetric>(`/stock/metric?symbol=${symbol}&metric=price`);
    const result = {
      fiftyTwoWeekHigh: data.metric?.['52WeekHigh'] ?? null,
      fiftyTwoWeekLow:  data.metric?.['52WeekLow']  ?? null,
    };
    historyCache.set(cacheKey, result);
    return result;
  } catch {
    return { fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null };
  }
}

// ── GET /api/stocks/overview ──────────────────────────────────────────────────

stocksRouter.get('/overview', requireAuth, async (req: AuthRequest, res: Response) => {
  const symbolsParam = (req.query.symbols as string) || DEFAULT_SYMBOLS.join(',');
  const symbols = symbolsParam
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);

  const cacheKey = symbols.join(',');
  const cached = quoteCache.get(cacheKey, QUOTE_TTL);
  if (cached) { res.json(cached); return; }

  try {
    // All quotes + profiles + sparklines fetched in parallel
    const [quoteResults, profileResults, sparkResults] = await Promise.all([
      Promise.all(symbols.map((sym) => fhFetch<FHQuote>(`/quote?symbol=${sym}`)
        .then((q) => ({ symbol: sym, q }))
        .catch(() => ({ symbol: sym, q: null })))),
      Promise.all(symbols.map((sym) => fetchProfile(sym).catch(() => ({ name: sym, marketCapitalization: 0 })))),
      Promise.all(symbols.map((sym) => fetchSparkline(sym))),
    ]);

    const quotes = quoteResults.map(({ symbol, q }, i) => {
      const profile = profileResults[i];
      return {
        symbol,
        shortName:                  profile?.name || symbol,
        regularMarketPrice:         q?.c ?? 0,
        regularMarketChange:        q?.d ?? 0,
        regularMarketChangePercent: q?.dp ?? 0,
        marketCap:                  profile?.marketCapitalization ? profile.marketCapitalization * 1_000_000 : null,
        fiftyTwoWeekHigh:           null,
        fiftyTwoWeekLow:            null,
      };
    });

    const sparklines: Record<string, number[]> = {};
    for (let i = 0; i < symbols.length; i++) sparklines[symbols[i]] = sparkResults[i];

    const result = { quotes, sparklines };
    quoteCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch stocks overview';
    console.error('[stocks/overview] ERROR:', err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/stocks/favorites ─────────────────────────────────────────────────

stocksRouter.get('/favorites', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data } = await supabase
    .from('user_stock_favorites')
    .select('symbols')
    .eq('user_id', req.user!.id)
    .single();

  res.json({ symbols: (data?.symbols as string[]) ?? [] });
});

// ── PUT /api/stocks/favorites ─────────────────────────────────────────────────

stocksRouter.put('/favorites', requireAuth, async (req: AuthRequest, res: Response) => {
  const { symbols } = req.body as { symbols: unknown };

  if (!Array.isArray(symbols)) {
    res.status(400).json({ error: 'symbols must be an array' });
    return;
  }

  const clean = (symbols as unknown[])
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 50);

  const { error } = await supabase.from('user_stock_favorites').upsert(
    { user_id: req.user!.id, symbols: clean, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  );

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ symbols: clean });
});

// ── GET /api/stocks/history/:symbol?range=1D|1W|1M|3M|1Y ─────────────────────

stocksRouter.get('/history/:symbol', requireAuth, async (req: AuthRequest, res: Response) => {
  const symbol = req.params.symbol.toUpperCase();
  const range  = ((req.query.range as string) || '1M').toUpperCase();
  const cfg    = RANGE_CONFIG[range] ?? RANGE_CONFIG['1M'];

  const cacheKey = `hist_${symbol}_${range}`;
  const cached = historyCache.get(cacheKey, HISTORY_TTL);
  if (cached) { res.json(cached); return; }

  const to   = Math.floor(Date.now() / 1000);
  const from = to - cfg.days * 86400;

  try {
    // Quote, profile, and metrics are always fetched — these power the price hero and fundamentals.
    const [quote, profile, metrics] = await Promise.all([
      fhFetch<FHQuote>(`/quote?symbol=${symbol}`),
      fetchProfile(symbol).catch(() => ({ name: symbol, marketCapitalization: 0 })),
      fetchMetrics(symbol),
    ]);

    // Fetch bar data. Primary source is Yahoo Finance (via browser-like headers so the Docker
    // container on a residential Mac IP is not blocked). Finnhub candles are a secondary
    // fallback — the free tier doesn't include them, but we try anyway.
    let bars: YFBar[] = [];

    try {
      bars = await fetchYahooCandles(symbol, range);
    } catch (yfErr) {
      console.warn(`[stocks/history/${symbol}] Yahoo Finance failed (${yfErr instanceof Error ? yfErr.message : yfErr}), trying Finnhub candles`);

      const buildBars = (candle: FHCandle): YFBar[] =>
        candle.s === 'ok'
          ? candle.t.map((ts, i) => ({
              time:   new Date(ts * 1000).toISOString(),
              open:   candle.o[i] ?? null,
              high:   candle.h[i] ?? null,
              low:    candle.l[i] ?? null,
              close:  candle.c[i],
              volume: candle.v[i] ?? null,
            }))
          : [];

      try {
        const candle = await fhFetch<FHCandle>(
          `/stock/candle?symbol=${symbol}&resolution=${cfg.resolution}&from=${from}&to=${to}`,
        );
        bars = buildBars(candle);
      } catch {
        // Both sources failed — chart shows "No chart data available", price/fundamentals still render
      }
    }

    const result = {
      symbol,
      bars,
      shortName:                  profile?.name ?? symbol,
      regularMarketPrice:         quote.c,
      regularMarketChange:        quote.d,
      regularMarketChangePercent: quote.dp,
      marketCap:                  profile?.marketCapitalization ? profile.marketCapitalization * 1_000_000 : null,
      fiftyTwoWeekHigh:           metrics.fiftyTwoWeekHigh,
      fiftyTwoWeekLow:            metrics.fiftyTwoWeekLow,
    };

    historyCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch history';
    console.error(`[stocks/history/${symbol}] ERROR:`, err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/stocks/search?q=... ──────────────────────────────────────────────

stocksRouter.get('/search', requireAuth, async (req: AuthRequest, res: Response) => {
  const q = ((req.query.q as string) || '').trim();
  if (!q) { res.json({ results: [] }); return; }

  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey, SEARCH_TTL);
  if (cached) { res.json(cached); return; }

  try {
    const data = await fhFetch<FHSearch>(`/search?q=${encodeURIComponent(q)}`);
    const results = (data.result || [])
      .filter((r) => r.type === 'Common Stock' || r.type === 'ETP' || r.type === '')
      .slice(0, 8)
      .map((r) => ({
        symbol:    r.symbol,
        shortName: r.description || r.displaySymbol || r.symbol,
        typeDisp:  r.type || 'Stock',
        exchDisp:  '',
      }));

    const response = { results };
    searchCache.set(cacheKey, response);
    res.json(response);
  } catch {
    res.json({ results: [] });
  }
});
