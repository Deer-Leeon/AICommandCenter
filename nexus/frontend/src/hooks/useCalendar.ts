import { useEffect, useCallback, useState } from 'react';
import { useStore } from '../store/useStore';
import type { CalendarEvent } from '../types';
import { apiFetch } from '../lib/api';
import { wcRead, wcWrite, wcIsStale, wcAge, WC_KEY, WC_TTL, awaitPrefetchOrFetch } from '../lib/widgetCache';

const GRACE_PERIOD_MS = 30_000;
const ENDPOINT = '/api/calendar/events?days=7';

// Progressive rendering: if cached data is younger than this, delay the first
// background refresh so the user never sees a visible content swap on load.
const DEFER_THRESHOLD_MS = 30 * 60_000;
const DEFER_DELAY_MS     = 10_000;

export function useCalendar() {
  const {
    calendarEvents,
    setCalendarEvents,
    calendarRefetchKey,
    clearPendingCalendarEventId,
  } = useStore();

  // True when the initially-rendered data came from a cache entry older than TTL.
  const [isCacheStale, setIsCacheStale] = useState(
    () => wcIsStale(WC_KEY.CALENDAR_EVENTS, WC_TTL.CALENDAR),
  );

  // hasLoaded: true the moment we have ANY data — either from the localStorage
  // cache (immediate) or from the first API response.
  const [hasLoaded, setHasLoaded] = useState(
    () => wcRead(WC_KEY.CALENDAR_EVENTS) !== null,
  );

  const fetchEvents = useCallback(async () => {
    try {
      const res = await awaitPrefetchOrFetch(ENDPOINT, () => apiFetch(ENDPOINT));
      if (!res.ok) return;

      const apiData: CalendarEvent[] = await res.json();
      const apiIdSet = new Set(apiData.map((e) => e.id));

      const { pendingCalendarEventIds, calendarEvents: currentEvents } =
        useStore.getState();

      const now = Date.now();
      const stillPending: CalendarEvent[] = [];

      for (const [id, addedAt] of Object.entries(pendingCalendarEventIds)) {
        if (apiIdSet.has(id)) {
          clearPendingCalendarEventId(id);
        } else if (now - addedAt < GRACE_PERIOD_MS) {
          const optimisticEvent = currentEvents.find((e) => e.id === id);
          if (optimisticEvent) stillPending.push(optimisticEvent);
        } else {
          clearPendingCalendarEventId(id);
        }
      }

      const merged = [...apiData, ...stillPending];
      setCalendarEvents(merged);
      wcWrite(WC_KEY.CALENDAR_EVENTS, merged);
      setIsCacheStale(false);
      setHasLoaded(true);
    } catch {
      // Keep cached data on transient errors; still mark as loaded
      setHasLoaded(true);
    }
  }, [setCalendarEvents, clearPendingCalendarEventId]);

  // Initial fetch + polling with progressive-rendering deferral.
  useEffect(() => {
    const cacheAge = wcAge(WC_KEY.CALENDAR_EVENTS);
    const deferMs = cacheAge < DEFER_THRESHOLD_MS ? DEFER_DELAY_MS : 0;

    let delay: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      fetchEvents();
      interval = setInterval(fetchEvents, 10_000);
    }

    if (deferMs > 0) {
      delay = setTimeout(startPolling, deferMs);
    } else {
      startPolling();
    }

    return () => {
      if (delay !== null) clearTimeout(delay);
      if (interval !== null) clearInterval(interval);
    };
  }, [fetchEvents]);

  // Immediate refetch when AI triggers one — bypasses the deferral
  useEffect(() => {
    if (calendarRefetchKey > 0) fetchEvents();
  }, [calendarRefetchKey, fetchEvents]);

  return { events: calendarEvents, refetch: fetchEvents, isCacheStale, hasLoaded };
}
