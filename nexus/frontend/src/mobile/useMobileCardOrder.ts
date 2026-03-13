import { useState, useEffect, useCallback, useRef } from 'react';
import type { WidgetType } from '../types';
import { WIDGET_CONFIGS } from '../types';
import type { CalendarEvent } from '../types';
import { useStore } from '../store/useStore';

// ── Default stack order ───────────────────────────────────────────────────────

export const MOBILE_DEFAULT_ORDER: WidgetType[] = [
  'calendar',
  'spotify',
  'todo',
  'weather',
  'news',
  'stocks',
  'pomodoro',
  'notes',
  'wordle',
  'lofi',
  'shared_chess',
  'tasks',
  'slack',
  'plaid',
  'docs',
  'obsidian',
  'links',
  'typing',
];

const STORAGE_KEY = 'nexus_mobile_card_order_v1';

function loadOrder(): WidgetType[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WidgetType[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Merge with default to ensure all widgets present
        const set = new Set(parsed);
        const merged = [...parsed];
        for (const w of MOBILE_DEFAULT_ORDER) {
          if (!set.has(w)) merged.push(w);
        }
        return merged;
      }
    }
  } catch { /* ignore */ }
  return [...MOBILE_DEFAULT_ORDER];
}

function saveOrder(order: WidgetType[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); } catch { /* quota */ }
}

// ── Priority scoring ──────────────────────────────────────────────────────────

function scoreWidget(widget: WidgetType, calendarEvents: CalendarEvent[]): number {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun, 6=Sat

  switch (widget) {
    case 'calendar': {
      // Check for upcoming events
      const upcoming = calendarEvents.filter(e => {
        if (!e.startDateTime) return false;
        const start = new Date(e.startDateTime).getTime();
        const diff = (start - now.getTime()) / 60000; // minutes
        return diff >= 0 && diff <= 120;
      });
      if (upcoming.some(e => {
        const diff = (new Date(e.startDateTime!).getTime() - now.getTime()) / 60000;
        return diff <= 30;
      })) return 100;
      if (upcoming.length > 0) return 50;
      return 15;
    }
    case 'pomodoro': {
      try {
        const raw = localStorage.getItem('nexus_pomodoro_v1');
        if (raw) {
          const s = JSON.parse(raw);
          if (s?.isRunning) return 90;
        }
      } catch { /* ignore */ }
      return 10;
    }
    case 'shared_chess':
      return 10; // Will be higher if it's the user's turn — hard to detect without subscription here
    case 'spotify': {
      // Boost during typical listening hours
      return (hour >= 8 && hour <= 23) ? 40 : 20;
    }
    case 'stocks': {
      // Market hours 9:30am–4pm EST weekdays
      const estOffset = -5 * 60; // EST offset in minutes (rough)
      const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      const estMins = ((utcMins + estOffset) + 24 * 60) % (24 * 60);
      const isWeekday = day >= 1 && day <= 5;
      if (isWeekday && estMins >= 9 * 60 + 30 && estMins < 16 * 60) return 60;
      return 10;
    }
    case 'weather':
      return (hour >= 6 && hour <= 10) ? 40 : 20;
    case 'news':
      return 30;
    case 'todo':
      return 25;
    default:
      return 10;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMobileCardOrder() {
  const [order, setOrderState] = useState<WidgetType[]>(loadOrder);
  const [lastAutoReorder, setLastAutoReorder] = useState<string | null>(null);
  const calendarEvents = useStore(s => s.calendarEvents);
  const prevScoresRef = useRef<Record<WidgetType, number>>({} as Record<WidgetType, number>);

  const setOrder = useCallback((next: WidgetType[]) => {
    setOrderState(next);
    saveOrder(next);
  }, []);

  const autoScore = useCallback(() => {
    const scores = {} as Record<WidgetType, number>;
    for (const w of MOBILE_DEFAULT_ORDER) {
      scores[w] = scoreWidget(w, calendarEvents);
    }

    // Find the widget with the highest score
    const top = [...MOBILE_DEFAULT_ORDER].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0))[0];
    const prev = prevScoresRef.current;
    prevScoresRef.current = scores;

    // Only reorder if the top scorer changed AND it's a significant bump
    const currentTop = order[0];
    if (top !== currentTop && (scores[top] ?? 0) >= 40) {
      // Move top scorer to front
      const newOrder = [top, ...order.filter(w => w !== top)];
      setOrder(newOrder);

      // Build a human-readable toast message
      const cfg = WIDGET_CONFIGS.find(c => c.id === top);
      const label = cfg?.icon ? `${cfg.icon} ${cfg.label}` : top;
      let reason = '';
      if (top === 'calendar' && scores[top] >= 100) reason = ' — meeting soon';
      else if (top === 'calendar' && scores[top] >= 50) reason = ' — event in 2h';
      else if (top === 'pomodoro' && scores[top] >= 90) reason = ' — session running';
      else if (top === 'stocks' && scores[top] >= 60) reason = ' — market open';
      setLastAutoReorder(`${label} moved to front${reason}`);
      setTimeout(() => setLastAutoReorder(null), 4000);
      return;
    }

    // Silence unused prev reference
    void prev;
  }, [order, calendarEvents, setOrder]);

  // Score on mount and every 60 seconds
  useEffect(() => {
    autoScore();
    const iv = setInterval(autoScore, 60_000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarEvents]); // re-score when calendar data arrives

  return { order, setOrder, lastAutoReorder };
}
