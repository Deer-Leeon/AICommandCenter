/**
 * Development-only cache diagnostics.
 *
 * All functions are no-ops in production — import.meta.env.DEV is a
 * compile-time constant that Vite replaces with `false`, so dead-code
 * elimination removes all implementation code from the production bundle.
 */

import { wcInspect, WC_KEY, WC_TTL } from './widgetCache';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CacheDiag {
  widget: string;
  cacheKey: string;
  /** Was real cached data present when the widget first rendered? */
  hadCacheHit: boolean;
  /** Age of the cache entry in ms when the widget rendered (null = no cache) */
  cacheAgeMs: number | null;
  /** Is the cached data older than the widget's TTL? */
  wasStale: boolean;
  /** Where did the initial data come from? */
  source: 'cache-only' | 'prefetch' | 'fresh-fetch' | 'pending';
  /** How long the network fetch took in ms (null = not yet complete) */
  fetchMs: number | null;
}

type DiagMap = Record<string, CacheDiag>;

// ── Global map on window ──────────────────────────────────────────────────────

function getDiagMap(): DiagMap {
  const w = window as typeof window & { __nexusCacheDiag?: DiagMap };
  if (!w.__nexusCacheDiag) w.__nexusCacheDiag = {};
  return w.__nexusCacheDiag;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Record a cache diagnostic event. No-op in production. */
export function devRecord(diag: CacheDiag): void {
  if (!import.meta.env.DEV) return;
  getDiagMap()[diag.widget] = diag;
  window.dispatchEvent(new CustomEvent('nexus:cache-diag', { detail: diag }));
}

/** Get all recorded diagnostics. Returns [] in production. */
export function devGetDiags(): CacheDiag[] {
  if (!import.meta.env.DEV) return [];
  return Object.values(getDiagMap());
}

// ── Endpoint / key maps ───────────────────────────────────────────────────────

const WIDGET_ENDPOINT_MAP: Record<string, string> = {
  calendar: '/api/calendar/events?days=7',
  weather:  '/api/weather',
  slack:    '/api/slack/messages?limit=10',
  todo:     '/api/todos',
  tasks:    '/api/tasks',
  docs:     '/api/docs/list',
  stocks:   '/api/stocks/overview',
  plaid:    '/api/plaid/accounts',
};

const WIDGET_CACHE_KEY_MAP: Record<string, string> = {
  calendar: WC_KEY.CALENDAR_EVENTS,
  weather:  WC_KEY.WEATHER,
  slack:    WC_KEY.SLACK_MESSAGES,
  todo:     WC_KEY.TODOS,
  tasks:    WC_KEY.TASKS,
  docs:     WC_KEY.DOCS_LIST,
  stocks:   WC_KEY.STOCKS_OVERVIEW,
  plaid:    WC_KEY.PLAID_ACCOUNTS,
};

const WIDGET_TTL_MAP: Record<string, number> = {
  calendar: WC_TTL.CALENDAR,
  weather:  WC_TTL.WEATHER,
  slack:    WC_TTL.SLACK,
  todo:     WC_TTL.TODOS,
  tasks:    WC_TTL.TASKS,
  docs:     WC_TTL.DOCS,
  stocks:   WC_TTL.STOCKS,
  plaid:    WC_TTL.PLAID,
};

// ── Boot-time console checklist ───────────────────────────────────────────────

/**
 * Logs a structured cache boot report to the console.
 * Pass the list of widget types currently on the dashboard.
 * Called from App.tsx in DEV mode after the first render.
 */
export function devBootCheck(dashboardWidgets: string[]): void {
  if (!import.meta.env.DEV) return;

  // Wait one tick so widgets have had a chance to consume prefetches
  setTimeout(() => {
    const cacheEntries = wcInspect();
    const now = Date.now();

    const w = window as typeof window & {
      __nexusPrefetch?: Record<string, Promise<Response | null>>;
      __nexusPrefetchLog?: string[];
    };
    const remainingPrefetches = Object.keys(w.__nexusPrefetch ?? {});
    const consumedPrefetches  = w.__nexusPrefetchLog ?? [];

    const cacheHits:    string[] = [];
    const staleCache:   string[] = [];
    const cacheMisses:  string[] = [];
    const prefetchUsed: string[] = [];
    const wasted:       string[] = [];

    for (const widgetType of dashboardWidgets) {
      const cacheKey = WIDGET_CACHE_KEY_MAP[widgetType];
      const ttl      = WIDGET_TTL_MAP[widgetType];
      const endpoint = WIDGET_ENDPOINT_MAP[widgetType];
      if (!cacheKey) continue;

      const entry = cacheEntries[cacheKey];
      if (entry) {
        const ageMs  = now - (entry.ts as number);
        const ageFmt = ageMs < 60_000
          ? `${Math.round(ageMs / 1000)}s`
          : `${(ageMs / 60_000).toFixed(1)}m`;
        if (ttl && ageMs > ttl) {
          staleCache.push(`${widgetType} (${ageFmt} old, TTL=${Math.round(ttl / 60_000)}m)`);
        } else {
          cacheHits.push(`${widgetType} (${ageFmt} old)`);
        }
      } else {
        cacheMisses.push(widgetType);
      }

      if (endpoint && consumedPrefetches.includes(endpoint)) {
        prefetchUsed.push(widgetType);
      }
    }

    // Prefetches that fired but no widget consumed them
    for (const ep of remainingPrefetches) {
      const widget = Object.entries(WIDGET_ENDPOINT_MAP).find(([, e]) => e === ep)?.[0];
      wasted.push(widget ? `${widget} (${ep})` : ep);
    }

    console.groupCollapsed(
      '%c[NEXUS] Cache Boot Report',
      'color:#3de8b0;font-weight:700;font-size:12px',
    );
    console.log('%cDashboard widgets:', 'font-weight:600', dashboardWidgets.join(', ') || '(none)');
    if (cacheHits.length)    console.log('%c✅ Cache hits:',          'color:#22c55e;font-weight:600', cacheHits.join(', '));
    if (staleCache.length)   console.log('%c⚠️  Stale cache (used):',  'color:#f59e0b;font-weight:600', staleCache.join(', '));
    if (cacheMisses.length)  console.log('%c❌ Cache misses:',         'color:#ef4444;font-weight:600', cacheMisses.join(', '));
    if (prefetchUsed.length) console.log('%c⚡ Prefetch consumed:',    'color:#7c6aff;font-weight:600', prefetchUsed.join(', '));
    if (wasted.length)       console.log('%c🗑️  Prefetch not consumed:', 'color:#7a7a90;font-weight:600', wasted.join(', '));
    console.log('%cCache snapshot:', 'font-weight:600', cacheEntries);
    console.groupEnd();
  }, 500);
}
