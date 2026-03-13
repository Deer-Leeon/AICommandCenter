/**
 * Signals the reveal orchestrator that a widget has finished its first data load.
 *
 * Usage — call this in every widget component:
 *   useWidgetReady('calendar', hasLoaded);
 *
 * `isReady` should be:
 *   - true immediately  → widget had a localStorage cache hit (no fetch needed)
 *   - true after fetch  → first API call resolved (success OR graceful error)
 *   - false             → still loading for the first time
 *
 * The hook is idempotent: only the FIRST false → true transition fires markReady().
 */

import { useLayoutEffect, useRef } from 'react';
import { useRevealStore } from '../store/useRevealStore';
import type { WidgetType } from '../types';

export function useWidgetReady(widgetType: WidgetType, isReady: boolean): void {
  const markReady = useRevealStore((s) => s.markReady);
  const hasFired = useRef(false);

  // useLayoutEffect fires synchronously after DOM mutations, before the browser
  // paints — saves ~1 frame (~16 ms) compared to useEffect for cache-hit widgets.
  useLayoutEffect(() => {
    if (isReady && !hasFired.current) {
      hasFired.current = true;
      markReady(widgetType);
    }
  }, [isReady, widgetType, markReady]);
}
