import { create } from 'zustand';
import { apiFetch } from '../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OmnibarSettings {
  searchEngine:    string;   // 'google' | 'duckduckgo' | 'bing' | 'perplexity' | 'brave'
  smartUrl:        boolean;
  openNewTab:      boolean;
  showSuggestions: boolean;
  quickLaunch:     boolean;
}

export interface OmnibarShortcut {
  id:      string;
  trigger: string;
  url:     string;
}

export interface OmnibarHistoryEntry {
  id:          string;
  domain:      string;
  url:         string;
  visitCount:  number;
  lastVisited: string;
}

const DEFAULT_SETTINGS: OmnibarSettings = {
  searchEngine:    'google',
  smartUrl:        true,
  openNewTab:      false,
  showSuggestions: true,
  quickLaunch:     false,
};

// ── Store ─────────────────────────────────────────────────────────────────────

interface OmnibarStore {
  settings:  OmnibarSettings;
  shortcuts: OmnibarShortcut[];
  history:   OmnibarHistoryEntry[];
  loaded:    boolean;
  loading:   boolean;

  load:           () => Promise<void>;
  saveSettings:   (partial: Partial<OmnibarSettings>) => Promise<void>;
  addShortcut:    (trigger: string, url: string) => Promise<OmnibarShortcut | null>;
  updateShortcut: (id: string, trigger: string, url: string) => Promise<void>;
  deleteShortcut: (id: string) => Promise<void>;
  recordHistory:  (url: string) => void;  // optimistic + fire-and-forget
  clearHistory:   () => Promise<void>;
}

export const useOmnibarStore = create<OmnibarStore>((set, get) => ({
  settings:  DEFAULT_SETTINGS,
  shortcuts: [],
  history:   [],
  loaded:    false,
  loading:   false,

  // ── Load all omnibar data once ────────────────────────────────────────────
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const res = await apiFetch('/api/omnibar/data');
      if (!res.ok) { set({ loading: false }); return; }
      const data = await res.json() as {
        settings:  Partial<OmnibarSettings>;
        shortcuts: OmnibarShortcut[];
        history:   OmnibarHistoryEntry[];
      };
      set({
        settings:  { ...DEFAULT_SETTINGS, ...data.settings },
        shortcuts: data.shortcuts ?? [],
        history:   data.history   ?? [],
        loaded:    true,
        loading:   false,
      });
    } catch {
      set({ loading: false });
    }
  },

  // ── Persist settings (optimistic) ────────────────────────────────────────
  saveSettings: async (partial) => {
    const next = { ...get().settings, ...partial };
    set({ settings: next });
    try {
      await apiFetch('/api/omnibar/settings', {
        method: 'PUT',
        body:   JSON.stringify(next),
      });
    } catch { /* ignore */ }
  },

  // ── Shortcut CRUD ─────────────────────────────────────────────────────────
  addShortcut: async (trigger, url) => {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    try {
      const res = await apiFetch('/api/omnibar/shortcuts', {
        method: 'POST',
        body:   JSON.stringify({ trigger: trigger.toLowerCase().trim(), url: normalizedUrl }),
      });
      if (!res.ok) return null;
      const sc = await res.json() as OmnibarShortcut;
      set((s) => ({ shortcuts: [...s.shortcuts, sc] }));
      return sc;
    } catch { return null; }
  },

  updateShortcut: async (id, trigger, url) => {
    const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
    const clean = trigger.toLowerCase().trim();
    set((s) => ({
      shortcuts: s.shortcuts.map((sc) =>
        sc.id === id ? { ...sc, trigger: clean, url: normalizedUrl } : sc,
      ),
    }));
    try {
      await apiFetch(`/api/omnibar/shortcuts/${id}`, {
        method: 'PUT',
        body:   JSON.stringify({ trigger: clean, url: normalizedUrl }),
      });
    } catch { /* ignore */ }
  },

  deleteShortcut: async (id) => {
    set((s) => ({ shortcuts: s.shortcuts.filter((sc) => sc.id !== id) }));
    try {
      await apiFetch(`/api/omnibar/shortcuts/${id}`, { method: 'DELETE' });
    } catch { /* ignore */ }
  },

  // ── Navigation history ────────────────────────────────────────────────────
  recordHistory: (url) => {
    let domain: string;
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch { return; }

    // Optimistic in-memory update
    set((s) => {
      const existing = s.history.find((h) => h.domain === domain);
      const now = new Date().toISOString();
      let next: OmnibarHistoryEntry[];
      if (existing) {
        next = s.history.map((h) =>
          h.domain === domain
            ? { ...h, visitCount: h.visitCount + 1, lastVisited: now, url }
            : h,
        );
      } else {
        next = [
          { id: crypto.randomUUID(), domain, url, visitCount: 1, lastVisited: now },
          ...s.history,
        ];
      }
      // Keep sorted by frequency desc then recency desc
      next.sort((a, b) =>
        b.visitCount - a.visitCount || b.lastVisited.localeCompare(a.lastVisited),
      );
      return { history: next };
    });

    // Persist asynchronously
    apiFetch('/api/omnibar/history', {
      method: 'POST',
      body:   JSON.stringify({ url }),
    }).catch(() => {});
  },

  clearHistory: async () => {
    set({ history: [] });
    try {
      await apiFetch('/api/omnibar/history', { method: 'DELETE' });
    } catch { /* ignore */ }
  },
}));
