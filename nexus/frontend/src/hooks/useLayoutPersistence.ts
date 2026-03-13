import { useEffect, useRef } from 'react';
import { useStore, layoutCacheKey } from '../store/useStore';
import { apiFetch } from '../lib/api';
import type { WidgetType, GridSpan } from '../types';

interface LayoutV2 {
  v: 2;
  widgets: Record<string, WidgetType>;
  spans: Record<string, GridSpan>;
  connections: Record<string, string>;
}

function readCachedLayout(userId: string): LayoutV2 | null {
  try {
    const raw = localStorage.getItem(layoutCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LayoutV2>;
    if (parsed?.v === 2) return { ...parsed, connections: parsed.connections ?? {} } as LayoutV2;
    return null;
  } catch {
    return null;
  }
}

function writeCachedLayout(userId: string, layout: LayoutV2) {
  try {
    localStorage.setItem(layoutCacheKey(userId), JSON.stringify(layout));
  } catch { /* storage quota exceeded — non-fatal */ }
}

// userId comes from the authenticated user — when it changes (account switch)
// the layout is cleared and reloaded from the server for the new account.
export function useLayoutPersistence(userId?: string) {
  const { grid, setGrid, gridSpans, setGridSpans, gridConnections, setGridConnections, setLayoutLoaded } = useStore();
  const loadedRef       = useRef(false);
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevUserIdRef   = useRef<string | undefined>(undefined);

  const localModifiedRef = useRef(false);

  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      if (state.grid !== prev.grid || state.gridConnections !== prev.gridConnections) {
        localModifiedRef.current = true;
      }
    });
    return unsub;
  }, []);

  // ── Reset + reload whenever the logged-in user changes ────────────────────
  useEffect(() => {
    if (userId === prevUserIdRef.current) return;
    prevUserIdRef.current = userId;

    // No user (logged out) — clear the grid so stale widgets don't show
    if (!userId) {
      setGrid({});
      setGridSpans({});
      setGridConnections({});
      setLayoutLoaded(false);
      loadedRef.current = false;
      localModifiedRef.current = false;
      return;
    }

    // New user — reset dirty flag, then load their layout
    loadedRef.current = false;
    localModifiedRef.current = false;

    // 1. Instant paint from this user's localStorage cache
    const cached = readCachedLayout(userId);
    if (cached) {
      setGrid(cached.widgets);
      setGridSpans(cached.spans);
      setGridConnections(cached.connections);
      loadedRef.current = true;
      setLayoutLoaded(true);
    } else {
      // No local cache for this user yet — clear any leftover state from
      // a previous account so we show an empty grid, not someone else's.
      setGrid({});
      setGridSpans({});
      setGridConnections({});
    }

    // 2. Background server sync — always authoritative for the account
    apiFetch('/api/layout')
      .then((r) => r.json())
      .then(({ grid: raw }: { grid: unknown }) => {
        if (!raw || typeof raw !== 'object') return;
        const payload = raw as Record<string, unknown>;
        let widgets: Record<string, WidgetType> = {};
        let spans: Record<string, GridSpan> = {};
        let connections: Record<string, string> = {};

        if (payload.v === 2) {
          const p = payload as unknown as LayoutV2;
          widgets     = p.widgets;
          spans       = p.spans;
          connections = p.connections ?? {};
        } else if (Object.keys(payload).length > 0) {
          widgets = raw as Record<string, WidgetType>;
        }

        // Skip if the user made changes while we were fetching
        if (localModifiedRef.current) return;

        writeCachedLayout(userId, { v: 2, widgets, spans, connections });
        setGrid(widgets);
        setGridSpans(spans);
        setGridConnections(connections);
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
        setLayoutLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Save on every change to widgets/spans/connections (debounced 800 ms) ──
  useEffect(() => {
    if (!loadedRef.current || !userId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      const payload: LayoutV2 = {
        v: 2,
        widgets:     grid as Record<string, WidgetType>,
        spans:       gridSpans,
        connections: gridConnections,
      };
      writeCachedLayout(userId, payload);
      apiFetch('/api/layout', {
        method: 'PUT',
        body: JSON.stringify({ grid: payload }),
      }).catch(() => {});
    }, 800);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [grid, gridSpans, gridConnections, userId]);
}
