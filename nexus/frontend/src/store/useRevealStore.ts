/**
 * Reveal orchestration store.
 *
 * Lifecycle:
 *  1. App.tsx calls initPending([...widgetTypes]) once the layout is known.
 *  2. Each widget/hook calls markReady(widgetType) when its first data arrives
 *     (or when it has a cache hit at mount time).
 *  3. Once every pending widget has reported ready — OR after a 4-second
 *     hard timeout set in App.tsx — startReveal() is called.
 *  4. The RevealOverlay component plays the wave animation (1.5 s).
 *  5. finishReveal() is called, revealed = true, overlay unmounts.
 *
 * Race-condition safety:
 *  Widgets may call markReady() before initPending() runs (children's
 *  useEffects fire before parents' in React's bottom-up order). Every early
 *  markReady() is recorded in readyWidgets; initPending() then checks
 *  whether all are already satisfied and starts the reveal immediately.
 */

import { create } from 'zustand';

const ANIMATION_KEY = 'nexus_animation_enabled';

function readAnimationEnabled(): boolean {
  try {
    const val = localStorage.getItem(ANIMATION_KEY);
    return val === null ? true : val === 'true'; // default ON
  } catch {
    return true;
  }
}

interface RevealState {
  pendingWidgets: string[];
  readyWidgets: Record<string, boolean>;
  revealing: boolean;       // wave animation is running
  revealed: boolean;        // animation complete — permanent for session
  animationEnabled: boolean; // user preference, persisted to localStorage

  initPending: (widgets: string[]) => void;
  markReady: (widgetType: string) => void;
  startReveal: () => void;
  finishReveal: () => void;
  setAnimationEnabled: (enabled: boolean) => void;
}

export const useRevealStore = create<RevealState>((set, get) => ({
  pendingWidgets: [],
  readyWidgets: {},
  revealing: false,
  revealed: false,
  animationEnabled: readAnimationEnabled(),

  initPending: (widgets) => {
    const state = get();
    // Already running or done — nothing to do
    if (state.revealing || state.revealed) return;

    const unique = [...new Set(widgets)];

    if (unique.length === 0) {
      // Empty dashboard — nothing to wait for
      set({ pendingWidgets: [] });
      get().startReveal();
      return;
    }

    set({ pendingWidgets: unique });

    // Widgets may have already called markReady() before us (race-condition path)
    const alreadyReady = state.readyWidgets;
    const allReady = unique.every((w) => alreadyReady[w]);
    if (allReady) get().startReveal();
  },

  markReady: (widgetType) => {
    const state = get();
    if (state.revealing || state.revealed) return;

    const newReady = { ...state.readyWidgets, [widgetType]: true };
    set({ readyWidgets: newReady });

    // Only check if initPending has already established the list
    if (state.pendingWidgets.length > 0) {
      const allReady = state.pendingWidgets.every((w) => newReady[w]);
      if (allReady) get().startReveal();
    }
    // Otherwise the early markReady() is stored in readyWidgets and
    // initPending() will notice when it runs.
  },

  startReveal: () => {
    const state = get();
    if (state.revealing || state.revealed) return;
    if (!state.animationEnabled) {
      // Animation disabled — skip directly to revealed, no overlay shown
      set({ revealed: true });
    } else {
      set({ revealing: true });
    }
  },

  finishReveal: () => set({ revealing: false, revealed: true }),

  setAnimationEnabled: (enabled: boolean) => {
    try { localStorage.setItem(ANIMATION_KEY, String(enabled)); } catch { /* quota */ }
    set({ animationEnabled: enabled });
  },
}));
