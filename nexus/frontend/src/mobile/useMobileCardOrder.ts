import { useState, useCallback } from 'react';
import type { WidgetType } from '../types';

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

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMobileCardOrder() {
  const [order, setOrderState] = useState<WidgetType[]>(loadOrder);

  const setOrder = useCallback((next: WidgetType[]) => {
    setOrderState(next);
    saveOrder(next);
  }, []);

  return { order, setOrder };
}
