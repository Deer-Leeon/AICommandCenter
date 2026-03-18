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

function migrateV2toV3(v2: LayoutV2, existingPages?: Page[]): PagesLayout {
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
  const { setPages } = useStore();

  const loadedRef        = useRef(false);
  const saveTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUserIdRef    = useRef<string | undefined>(undefined);
  const localModifiedRef = useRef(false);
  /**
   * Set to true immediately before calling setPages() for a server/SSE-sourced
   * layout. The store subscription reads this flag synchronously (Zustand fires
   * subscribers synchronously) and skips the save — preventing the "SSE triggers
   * re-save" ping-pong that was causing widgets to disappear.
   */
  const remoteAppliedRef = useRef(false);

  // ── Reset + reload whenever the logged-in user changes ────────────────────
  useEffect(() => {
    if (userId === prevUserIdRef.current) return;
    prevUserIdRef.current = userId;

    if (!userId) {
      useStore.setState({
        pages: [], activePage: '', grid: {}, gridSpans: {},
        gridConnections: {}, layoutLoaded: false,
      });
      loadedRef.current        = false;
      localModifiedRef.current = false;
      remoteAppliedRef.current = false;
      return;
    }

    loadedRef.current        = false;
    localModifiedRef.current = false;
    remoteAppliedRef.current = false;

    // 1. Instant paint from v3 localStorage cache (loadedRef is still false
    //    so the subscription below will skip this call — no spurious save)
    const cached = readCachedLayoutV3(userId);
    if (cached && cached.pages.length > 0) {
      setPages(cached.pages, cached.activePage || cached.pages[0].id);
      loadedRef.current = true;
      // Mark layout as loaded immediately from cache so the reveal overlay
      // doesn't block on the network. The API call still runs and updates
      // the layout in the background, but we don't wait for it.
      useStore.getState().setLayoutLoaded(true);
    } else {
      useStore.setState({
        pages: [], activePage: '', grid: {}, gridSpans: {},
        gridConnections: {}, layoutLoaded: false,
      });
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
            const v3 = payload as unknown as PagesLayout;
            if (Array.isArray(v3.pages) && v3.pages.length > 0) resolved = v3;
          } else if (payload.v === 2) {
            const localCache = readCachedLayoutV3(userId);
            resolved = migrateV2toV3(payload as unknown as LayoutV2, localCache?.pages);
          } else if (Object.keys(payload).length > 0) {
            const legacyV2: LayoutV2 = {
              v: 2, widgets: raw as Record<string, WidgetType>, spans: {}, connections: {},
            };
            const localCache = readCachedLayoutV3(userId);
            resolved = migrateV2toV3(legacyV2, localCache?.pages);
          }
        }
        if (!resolved || resolved.pages.length === 0) {
          const starterPages = makeStarterPages();
          resolved = { v: 3, pages: starterPages, activePage: starterPages[0].id };
        }
        writeCachedLayoutV3(userId, resolved);
        remoteAppliedRef.current = true;
        setPages(resolved.pages, resolved.activePage || resolved.pages[0].id);
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
        useStore.getState().setLayoutLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Local change detection + debounced save ───────────────────────────────
  // Uses a Zustand subscription instead of a useEffect([pages]) so we can
  // distinguish local edits from remote SSE applications via remoteAppliedRef.
  //
  // Leading debounce (not trailing): the timer starts on the FIRST change and
  // fires 150ms later reading the LATEST store state. This means:
  //   - Fast drags save 150ms after they START, not 150ms after they END
  //   - No 2-3s delay from continuous drag events resetting the timer
  //   - The final position is still captured because we read useStore.getState()
  //     at fire time, not the stale closure value
  useEffect(() => {
    if (!userId) return;

    const unsub = useStore.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      if (state.pages === prev.pages && state.activePage === prev.activePage) return;

      // Remote SSE update — skip save, reset flag
      if (remoteAppliedRef.current) {
        remoteAppliedRef.current = false;
        return;
      }

      // Local edit
      localModifiedRef.current = true;

      // Leading debounce: only start a timer if one isn't already running.
      // The timer callback reads the LATEST state from the store, so it always
      // captures the final position even if many intermediate states arrived.
      if (saveTimerRef.current) return;
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const { pages, activePage } = useStore.getState();
        const payload: PagesLayout = { v: 3, pages, activePage };
        writeCachedLayoutV3(userId, payload);
        apiFetch('/api/layout', {
          method: 'PUT',
          body: JSON.stringify({ grid: payload }),
        })
          .then(() => { localModifiedRef.current = false; })
          .catch(() => {});
      }, 150);
    });

    return () => {
      unsub();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [userId]);

  // ── Real-time cross-session sync ──────────────────────────────────────────
  // Receives layout:update events from other sessions (browser ↔ desktop app).
  // The full layout is embedded in the event — no extra GET round-trip needed.
  // remoteAppliedRef prevents the setPages() call from triggering a re-save.
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
        remoteAppliedRef.current = true; // Suppress re-save on receiving end
        setPages(resolved.pages, resolved.activePage || resolved.pages[0].id);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
