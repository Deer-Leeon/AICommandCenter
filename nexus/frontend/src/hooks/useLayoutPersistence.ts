import { useEffect, useRef } from 'react';
import { useStore, layoutCacheKeyV3, makeStarterPages } from '../store/useStore';
import { apiFetch } from '../lib/api';
import { nexusSSE } from '../lib/nexusSSE';
import type { WidgetType, GridSpan, Page, PagesLayout } from '../types';

// ── Legacy v2 shape (for migration) ──────────────────────────────────────────
interface LayoutV2 {
  v: 2;
  widgets: Record<string, WidgetType>;
  spans: Record<string, GridSpan>;
  connections: Record<string, string>;
}

function readCachedLayoutV3(userId: string): PagesLayout | null {
  try {
    const raw = localStorage.getItem(layoutCacheKeyV3(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PagesLayout>;
    if (parsed?.v === 3 && Array.isArray(parsed.pages)) return parsed as PagesLayout;
    return null;
  } catch {
    return null;
  }
}

function writeCachedLayoutV3(userId: string, layout: PagesLayout) {
  try {
    localStorage.setItem(layoutCacheKeyV3(userId), JSON.stringify(layout));
  } catch { /* storage quota exceeded — non-fatal */ }
}

// Migrate a v2 payload from the server into a v3 PagesLayout.
// Wraps the existing single-page data in a "Main" page.
function migrateV2toV3(v2: LayoutV2, existingPages?: Page[]): PagesLayout {
  // If the user already has a v3 layout locally (e.g. a Main page from a previous
  // migration), update that page's data instead of creating a duplicate.
  if (existingPages && existingPages.length > 0) {
    const mainPage = existingPages[0];
    const updated: Page = {
      ...mainPage,
      grid:        v2.widgets,
      spans:       v2.spans ?? {},
      connections: v2.connections ?? {},
    };
    return { v: 3, pages: [updated, ...existingPages.slice(1)], activePage: mainPage.id };
  }

  const page: Page = {
    id:          crypto.randomUUID(),
    name:        'Main',
    emoji:       '🏠',
    grid:        v2.widgets,
    spans:       v2.spans ?? {},
    connections: v2.connections ?? {},
    createdAt:   new Date().toISOString(),
  };
  return { v: 3, pages: [page], activePage: page.id };
}

export function useLayoutPersistence(userId?: string) {
  const { pages, activePage, setPages } = useStore();

  const loadedRef         = useRef(false);
  const saveTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUserIdRef     = useRef<string | undefined>(undefined);
  const localModifiedRef  = useRef(false);

  // Track local modifications so we don't overwrite mid-flight edits with
  // a stale server response. Any change to pages (which mirrors all grid writes)
  // counts as a local modification once loading is complete.
  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      if (state.pages !== prev.pages) localModifiedRef.current = true;
    });
    return unsub;
  }, []);

  // ── Reset + reload whenever the logged-in user changes ────────────────────
  useEffect(() => {
    if (userId === prevUserIdRef.current) return;
    prevUserIdRef.current = userId;

    if (!userId) {
      // Logged out — clear all grid state
      useStore.setState({ pages: [], activePage: '', grid: {}, gridSpans: {}, gridConnections: {}, layoutLoaded: false });
      loadedRef.current = false;
      localModifiedRef.current = false;
      return;
    }

    loadedRef.current = false;
    localModifiedRef.current = false;

    // 1. Instant paint from v3 localStorage cache
    const cached = readCachedLayoutV3(userId);
    if (cached && cached.pages.length > 0) {
      setPages(cached.pages, cached.activePage || cached.pages[0].id);
      loadedRef.current = true;
    } else {
      // No v3 cache — clear any leftover state
      useStore.setState({ pages: [], activePage: '', grid: {}, gridSpans: {}, gridConnections: {}, layoutLoaded: false });
    }

    // 2. Background server sync — always authoritative
    apiFetch('/api/layout')
      .then((r) => r.json())
      .then(({ grid: raw }: { grid: unknown }) => {
        if (localModifiedRef.current) return;

        let resolved: PagesLayout | null = null;

        if (raw && typeof raw === 'object') {
          const payload = raw as Record<string, unknown>;

          if (payload.v === 3) {
            // Server already has v3 data
            const v3 = payload as unknown as PagesLayout;
            if (Array.isArray(v3.pages) && v3.pages.length > 0) {
              resolved = v3;
            }
          } else if (payload.v === 2) {
            // Server has v2 — migrate, preserving existing local pages if any
            const localCache = readCachedLayoutV3(userId);
            resolved = migrateV2toV3(payload as unknown as LayoutV2, localCache?.pages);
          } else if (Object.keys(payload).length > 0) {
            // Legacy un-versioned format
            const legacyV2: LayoutV2 = { v: 2, widgets: raw as Record<string, WidgetType>, spans: {}, connections: {} };
            const localCache = readCachedLayoutV3(userId);
            resolved = migrateV2toV3(legacyV2, localCache?.pages);
          }
        }

        // Empty server response → create starter pages for new users
        if (!resolved || resolved.pages.length === 0) {
          const starterPages = makeStarterPages();
          resolved = { v: 3, pages: starterPages, activePage: starterPages[0].id };
        }

        writeCachedLayoutV3(userId, resolved);
        setPages(resolved.pages, resolved.activePage || resolved.pages[0].id);
      })
      .catch(() => {
        // Server unavailable — local cache is already shown, nothing more to do
      })
      .finally(() => {
        loadedRef.current = true;
        useStore.getState().setLayoutLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Save on every change to pages (debounced 800 ms) ─────────────────────
  useEffect(() => {
    if (!loadedRef.current || !userId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      const payload: PagesLayout = { v: 3, pages, activePage };
      writeCachedLayoutV3(userId, payload);
      apiFetch('/api/layout', {
        method: 'PUT',
        body: JSON.stringify({ grid: payload }),
      })
        .then(() => {
          // Mark clean so subsequent remote changes from other sessions apply
          // cleanly instead of being blocked by a stale localModified flag.
          localModifiedRef.current = false;
        })
        .catch(() => {});
    }, 150); // 150ms — fast enough for instant feel, slow enough to batch drags

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  // pages and activePage are the source of truth for all grid changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, activePage, userId]);

  // ── Real-time cross-session sync ──────────────────────────────────────────
  // The backend embeds the full layout payload in the layout:update event so
  // we can apply it immediately — no extra GET round-trip, ~0ms perceived lag.
  useEffect(() => {
    if (!userId) return;

    return nexusSSE.subscribe((event) => {
      if (event.type !== 'layout:update') return;
      if (localModifiedRef.current) return; // local edit in flight — skip

      const raw = event.grid as Record<string, unknown> | undefined;
      if (!raw) return;

      let resolved: PagesLayout | null = null;

      if (raw.v === 3) {
        const v3 = raw as unknown as PagesLayout;
        if (Array.isArray(v3.pages) && v3.pages.length > 0) resolved = v3;
      } else if (raw.v === 2) {
        const localCache = readCachedLayoutV3(userId);
        resolved = migrateV2toV3(raw as unknown as LayoutV2, localCache?.pages);
      }

      if (resolved) {
        writeCachedLayoutV3(userId, resolved);
        setPages(resolved.pages, resolved.activePage || resolved.pages[0].id);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
