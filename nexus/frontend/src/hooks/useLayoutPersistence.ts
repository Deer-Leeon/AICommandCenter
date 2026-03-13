import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { apiFetch } from '../lib/api';
import type { WidgetType, GridSpan } from '../types';

interface LayoutV2 {
  v: 2;
  widgets: Record<string, WidgetType>;
  spans: Record<string, GridSpan>;
  connections: Record<string, string>; // "row,col" → connectionId (only shared widget slots)
}

const LAYOUT_CACHE_KEY = 'nexus_layout_v2';

function readCachedLayout(): LayoutV2 | null {
  try {
    const raw = localStorage.getItem(LAYOUT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LayoutV2>;
    if (parsed?.v === 2) return { ...parsed, connections: parsed.connections ?? {} } as LayoutV2;
    return null;
  } catch {
    return null;
  }
}

function writeCachedLayout(layout: LayoutV2) {
  try {
    localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(layout));
  } catch { /* storage quota exceeded — non-fatal */ }
}

export function useLayoutPersistence() {
  const { grid, setGrid, gridSpans, setGridSpans, gridConnections, setGridConnections, setLayoutLoaded } = useStore();
  const loadedRef    = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks whether the user has made any layout change after the initial load.
  // Zustand's subscribe fires SYNCHRONOUSLY inside set(), so this is set before
  // any Promise callback can execute — preventing the background server-sync from
  // stomping on a freshly placed widget.
  const localModifiedRef = useRef(false);

  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      // Only count changes that happen AFTER the initial load phase
      if (!loadedRef.current) return;
      if (state.grid !== prev.grid || state.gridConnections !== prev.gridConnections) {
        localModifiedRef.current = true;
      }
    });
    return unsub;
  }, []);

  // ── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    // 1. Instant render from localStorage — zero network wait
    const cached = readCachedLayout();
    if (cached) {
      if (Object.keys(cached.widgets).length > 0) setGrid(cached.widgets);
      if (Object.keys(cached.spans).length > 0) setGridSpans(cached.spans);
      setGridConnections(cached.connections);
      loadedRef.current = true;
      setLayoutLoaded(true);
    }

    // 2. Background server sync — reconcile with any cross-device changes.
    //    IMPORTANT: if the user placed/removed a widget while this request was
    //    in-flight, localModifiedRef is already true (set synchronously by the
    //    Zustand subscriber above) and we must NOT overwrite local state.
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
        } else {
          widgets = raw as Record<string, WidgetType>;
        }

        // If the user modified the layout while we were fetching, their in-flight
        // save (debounced 800 ms) already has the authoritative state — applying
        // an older server snapshot here would lose those changes.
        if (localModifiedRef.current) return;

        // Persist freshest layout to localStorage for next visit
        writeCachedLayout({ v: 2, widgets, spans, connections });

        // Update Zustand — React will only re-render if values actually differ
        if (Object.keys(widgets).length > 0) setGrid(widgets);
        if (Object.keys(spans).length > 0) setGridSpans(spans);
        setGridConnections(connections);
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
        setLayoutLoaded(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save on every change to widgets, spans, or connections (debounced 800 ms)
  useEffect(() => {
    if (!loadedRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      const payload: LayoutV2 = {
        v: 2,
        widgets:     grid as Record<string, WidgetType>,
        spans:       gridSpans,
        connections: gridConnections,
      };
      // Keep localStorage in sync with every save
      writeCachedLayout(payload);
      apiFetch('/api/layout', {
        method: 'PUT',
        body: JSON.stringify({ grid: payload }),
      }).catch(() => {});
    }, 800);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [grid, gridSpans, gridConnections]);
}
