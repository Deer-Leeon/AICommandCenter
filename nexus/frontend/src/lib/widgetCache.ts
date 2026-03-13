/**
 * User-scoped, localStorage-backed widget data cache.
 *
 * Keys are namespaced with the Supabase user ID so two users sharing
 * a browser never see each other's cached data.
 *
 * This module has ZERO external project imports so it can safely be used
 * during Zustand store initialisation (module-eval time).
 */

const CACHE_PREFIX = 'nexus_wc_';

export interface WCEntry<T> {
  data: T;
  ts: number; // Date.now() when written
}

/** Read the Supabase user ID synchronously from localStorage. */
function getUserId(): string {
  try {
    const raw = localStorage.getItem('nexus-auth');
    if (!raw) return 'anon';
    const session = JSON.parse(raw) as { user?: { id?: string } };
    return session?.user?.id ?? 'anon';
  } catch {
    return 'anon';
  }
}

/** Read a widget cache entry. Returns null on miss or parse error. */
export function wcRead<T>(key: string): WCEntry<T> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${getUserId()}_${key}`);
    return raw ? (JSON.parse(raw) as WCEntry<T>) : null;
  } catch {
    return null;
  }
}

/** Write widget data to the user-scoped cache. Silently ignores quota errors. */
export function wcWrite<T>(key: string, data: T): void {
  try {
    const entry: WCEntry<T> = { data, ts: Date.now() };
    localStorage.setItem(
      `${CACHE_PREFIX}${getUserId()}_${key}`,
      JSON.stringify(entry),
    );
  } catch {
    // Quota exceeded or private-browsing restrictions — non-fatal
  }
}

/** Returns how old a cache entry is in milliseconds, or Infinity if absent. */
export function wcAge(key: string): number {
  const entry = wcRead(key);
  return entry ? Date.now() - entry.ts : Infinity;
}

/**
 * Returns true if a cache entry exists AND is older than `ttlMs`.
 * Returns false for a cache miss (no entry = cold load, not stale).
 */
export function wcIsStale(key: string, ttlMs: number): boolean {
  const entry = wcRead(key);
  if (!entry) return false;
  return Date.now() - entry.ts > ttlMs;
}

/**
 * Returns all widget cache entries for the current user — useful for dev tooling.
 * Only call this when you actually need to inspect the full cache.
 */
export function wcInspect(): Record<string, WCEntry<unknown>> {
  const uid = getUserId();
  const prefix = `${CACHE_PREFIX}${uid}_`;
  const result: Record<string, WCEntry<unknown>> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) {
        const shortKey = k.slice(prefix.length);
        try {
          result[shortKey] = JSON.parse(localStorage.getItem(k)!) as WCEntry<unknown>;
        } catch {
          // Skip corrupt entries
        }
      }
    }
  } catch {
    // ignore (e.g. storage access denied)
  }
  return result;
}

/**
 * Consume a prefetched Response promise from window.__nexusPrefetch.
 * Returns the promise and removes it from the map (single-use).
 *
 * The promise type is `Promise<Response | null>` because the prefetch
 * script in index.html wraps each fetch in `.catch(() => null)` — a
 * null means the prefetch itself failed with a network error.
 *
 * In DEV builds, records consumed endpoint to window.__nexusPrefetchLog.
 */
export function consumePrefetch(
  endpointKey: string,
): Promise<Response | null> | null {
  try {
    const w = window as typeof window & {
      __nexusPrefetch?: Record<string, Promise<Response | null>>;
      __nexusPrefetchLog?: string[];
    };
    if (w.__nexusPrefetch?.[endpointKey]) {
      const p = w.__nexusPrefetch[endpointKey];
      delete w.__nexusPrefetch[endpointKey];
      if (import.meta.env.DEV) {
        if (!w.__nexusPrefetchLog) w.__nexusPrefetchLog = [];
        w.__nexusPrefetchLog.push(endpointKey);
      }
      return p;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Robust fetch helper: tries the prefetch first, then falls back to `fallback()`.
 *
 * Handles all failure modes so callers never hang:
 *   • No prefetch in window.__nexusPrefetch  → calls fallback() directly
 *   • Prefetch resolved with null             → network error, calls fallback()
 *   • Prefetch resolved with non-ok response → e.g. 401 expired token, calls fallback()
 *   • Prefetch promise rejected (unexpected)  → calls fallback()
 *
 * `fallback` is always `() => apiFetch(endpoint)` — it re-runs auth via Supabase,
 * so a fresh token is used if the cached token was expired.
 */
export async function awaitPrefetchOrFetch(
  endpoint: string,
  fallback: () => Promise<Response>,
): Promise<Response> {
  const prefetch = consumePrefetch(endpoint);
  if (prefetch) {
    try {
      const res = await prefetch;
      // null = prefetch network error (from .catch(() => null) in HTML script)
      if (res !== null && res.ok) return res;
      // Non-ok (e.g. 401 expired token) or null → fall through to fresh fetch
    } catch {
      // Unexpected rejection — fall through
    }
  }
  return fallback();
}

// ── Max-age constants (ms) ────────────────────────────────────────────────────
export const WC_TTL = {
  CALENDAR:       10 * 60_000,   // 10 min (backend also caches 5 min — no point refreshing sooner)
  WEATHER:        15 * 60_000,   // 15 min
  SLACK:           5 * 60_000,   // 5 min (backend caches 2 min; frontend TTL > backend TTL intentionally)
  TODOS:           5 * 60_000,   // 5 min
  TASKS:           5 * 60_000,   // 5 min
  DOCS:            5 * 60_000,   // 5 min
  STOCKS:          2 * 60_000,   // 2 min
  PLAID:          10 * 60_000,   // 10 min
  LINKS:          30 * 60_000,   // 30 min (links rarely change)
  NOTES:           5 * 60_000,   // 5 min
  POMODORO_STATS:  5 * 60_000,   // 5 min (stats page, refreshed after each session anyway)
  NEWS:           10 * 60_000,   // 10 min (SSE keeps it live; cache gives instant first paint)
  FOOTBALL_LIVE:          60_000,   // 1 min
  FOOTBALL_TODAY:    5 * 60_000,   // 5 min
  FOOTBALL_STANDINGS: 60 * 60_000, // 1 hour
  FOOTBALL_FIXTURES: 30 * 60_000,  // 30 min
  F1_STATUS:           60_000,   // 1 min
  F1_STANDINGS:  30 * 60_000,   // 30 min
  F1_SCHEDULE:   24 * 60 * 60_000, // 24 hours
  F1_LAST_RACE:   1 * 60 * 60_000, // 1 hour
} as const;

// ── Cache key constants ───────────────────────────────────────────────────────
export const WC_KEY = {
  CALENDAR_EVENTS: 'calendar:events',
  WEATHER:         'weather',
  SLACK_MESSAGES:  'slack:messages',
  TODOS:           'todos',
  TASKS:           'tasks',
  DOCS_LIST:       'docs:list',
  STOCKS_OVERVIEW: 'stocks:overview',
  PLAID_ACCOUNTS:  'plaid:accounts',
  PLAID_TXNS:      'plaid:transactions',
  LINKS:           'quick-links',
  NOTES:           'notes',
  POMODORO_STATS:  'pomodoro:stats',
  NEWS_ARTICLES:   'news:articles',  // ArticleMap keyed by category
  FOOTBALL_LIVE:       'football:live',
  FOOTBALL_TODAY:      'football:today',
  F1_STATUS:           'f1:status',
  F1_STANDINGS:    'f1:standings',
  F1_SCHEDULE:     'f1:schedule',
  F1_LAST_RACE:    'f1:last-race',
} as const;
