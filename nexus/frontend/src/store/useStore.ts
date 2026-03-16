import { create } from 'zustand';
import type {
  WidgetType,
  GridSpan,
  AIResponse,
  CalendarEvent,
  SlackMessage,
  DocFile,
  TodoItem,
  ServiceConnectionState,
  Page,
  PagesLayout,
} from '../types';
import { API_BASE_URL } from '../config';
import { apiFetch } from '../lib/api';
import { wcRead, WC_KEY } from '../lib/widgetCache';

const CONNECTION_TIMEOUT = 90_000;

const SERVICES = [
  'ollama',
  'googleCalendar',
  'googleTasks',
  'googleDocs',
  'googleDrive',
  'slack',
  'obsidian',
  'plaid',
] as const;
type ServiceKey = typeof SERVICES[number];

const API_KEY_MAP: Record<ServiceKey, string> = {
  ollama: 'ollama',
  googleCalendar: 'googleCalendar',
  googleTasks: 'googleTasks',
  googleDocs: 'googleDocs',
  googleDrive: 'googleDrive',
  slack: 'slack',
  obsidian: 'obsidian',
  plaid: 'plaid',
};

function initialState(): ServiceConnectionState {
  return { connected: false, lastConfirmedAt: null, checking: true };
}

function makeInitialStates(): Record<string, ServiceConnectionState> {
  return Object.fromEntries(SERVICES.map((s) => [s, initialState()]));
}

// ── Default starter pages for brand-new users ─────────────────────────────
export function makeStarterPages(): Page[] {
  const now = new Date().toISOString();
  return [
    { id: crypto.randomUUID(), name: 'Home',     emoji: '🏠', grid: {}, spans: {}, connections: {}, createdAt: now },
    { id: crypto.randomUUID(), name: 'Work',     emoji: '💼', grid: {}, spans: {}, connections: {}, createdAt: now },
    { id: crypto.randomUUID(), name: 'Personal', emoji: '🎮', grid: {}, spans: {}, connections: {}, createdAt: now },
  ];
}

interface NexusStore {
  // ── Multi-page system ────────────────────────────────────────────────────
  pages: Page[];
  activePage: string;
  pageTransitionDir: 'left' | 'right' | null;

  setActivePage: (id: string) => void;
  addPage: (name: string, emoji: string) => string; // returns new page id
  deletePage: (id: string) => void;
  renamePage: (id: string, name: string, emoji: string) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  setPages: (pages: Page[], activePage: string) => void;

  // Widget placement (writes to active page automatically)
  grid: Record<string, WidgetType | null>;
  setGrid: (grid: Record<string, WidgetType | null>) => void;
  placeWidget: (widgetId: WidgetType, row: number, col: number) => void;
  removeWidget: (key: string) => void;

  // Grid zone spans
  gridSpans: Record<string, GridSpan>;
  setGridSpans: (spans: Record<string, GridSpan>) => void;
  mergeZone: (rowStart: number, colStart: number, rowSpan: number, colSpan: number) => void;
  splitZone: (key: string) => void;
  resizeZone: (oldKey: string, rowStart: number, colStart: number, rowSpan: number, colSpan: number) => void;
  moveWidget: (fromKey: string, toKey: string) => void;
  swapWidgets: (keyA: string, keyB: string) => void;

  // Shared widget connection bindings
  gridConnections: Record<string, string>;
  setGridConnections: (conns: Record<string, string>) => void;
  setWidgetConnection: (key: string, connectionId: string) => void;
  removeWidgetConnection: (key: string) => void;

  // Widget swap notification
  swapNotifyEnabled: boolean;
  setSwapNotifyEnabled: (v: boolean) => void;

  // Layout persistence
  layoutLoaded: boolean;
  setLayoutLoaded: (loaded: boolean) => void;

  // AI
  isAILoading: boolean;
  lastAIResponse: AIResponse | null;
  setAILoading: (loading: boolean) => void;
  setLastAIResponse: (response: AIResponse | null) => void;

  // Active contexts
  activeContexts: string[];
  toggleContext: (context: string) => void;

  // Service connection states
  serviceStates: Record<string, ServiceConnectionState>;
  refreshServiceStatus: () => Promise<void>;

  // Widget data
  calendarEvents: CalendarEvent[];
  setCalendarEvents: (events: CalendarEvent[]) => void;
  slackMessages: SlackMessage[];
  setSlackMessages: (messages: SlackMessage[]) => void;
  obsidianContent: string;
  setObsidianContent: (content: string) => void;
  recentDocs: DocFile[];
  setRecentDocs: (docs: DocFile[]) => void;
  todos: TodoItem[];
  setTodos: (todos: TodoItem[]) => void;
  addTodo: (todo: TodoItem) => void;
  updateTodo: (id: string, updates: Partial<TodoItem>) => void;
  deleteTodo: (id: string) => void;
  toggleTodo: (id: string) => void;

  // Flashing widget
  flashingWidget: string | null;
  flashWidget: (widgetId: string) => void;

  // Refetch triggers
  calendarRefetchKey: number;
  triggerCalendarRefetch: () => void;
  todosRefetchKey: number;
  triggerTodosRefetch: () => void;

  pendingCalendarEventIds: Record<string, number>;
  addPendingCalendarEventId: (id: string) => void;
  clearPendingCalendarEventId: (id: string) => void;
}

// ── Helper: sync the flat grid/spans/connections back into the pages array ──
// Called by every write operation so both representations stay in sync.
function syncToPages(
  pages: Page[],
  activePage: string,
  grid: Record<string, WidgetType | null>,
  gridSpans: Record<string, GridSpan>,
  gridConnections: Record<string, string>,
): Page[] {
  return pages.map((p) =>
    p.id === activePage
      ? { ...p, grid: grid as Record<string, WidgetType>, spans: gridSpans, connections: gridConnections }
      : p
  );
}

// ── Synchronous localStorage bootstrap ───────────────────────────────────────
function getBootUserId(): string | null {
  try {
    const raw = localStorage.getItem('nexus-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { id?: string } };
    return parsed?.user?.id ?? null;
  } catch {
    return null;
  }
}

// v2 key (legacy, for migration)
export function layoutCacheKey(userId: string) {
  return `nexus_layout_v2_${userId}`;
}
// v3 key (current)
export function layoutCacheKeyV3(userId: string) {
  return `nexus_layout_v3_${userId}`;
}

interface BootResult {
  grid: Record<string, WidgetType | null>;
  gridSpans: Record<string, GridSpan>;
  gridConnections: Record<string, string>;
  pages: Page[];
  activePage: string;
  layoutLoaded: boolean;
}

interface LayoutV2 {
  v: 2;
  widgets: Record<string, WidgetType>;
  spans: Record<string, GridSpan>;
  connections: Record<string, string>;
}

function bootLayout(): BootResult {
  const empty: BootResult = {
    grid: {}, gridSpans: {}, gridConnections: {}, pages: [], activePage: '', layoutLoaded: false,
  };
  try {
    const userId = getBootUserId();
    if (!userId) return empty;

    // Try v3 first
    const rawV3 = localStorage.getItem(layoutCacheKeyV3(userId));
    if (rawV3) {
      const parsed = JSON.parse(rawV3) as PagesLayout;
      if (parsed?.v === 3 && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
        const activeId = parsed.activePage || parsed.pages[0].id;
        const activePg = parsed.pages.find((p) => p.id === activeId) ?? parsed.pages[0];
        return {
          grid:            activePg.grid ?? {},
          gridSpans:       activePg.spans ?? {},
          gridConnections: activePg.connections ?? {},
          pages:           parsed.pages,
          activePage:      activePg.id,
          layoutLoaded:    true,
        };
      }
    }

    // Try v2 migration — wrap existing single layout into a "Main" page
    const rawV2 = localStorage.getItem(layoutCacheKey(userId));
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as LayoutV2;
      if (parsed?.v === 2 && parsed.widgets) {
        const page: Page = {
          id:          crypto.randomUUID(),
          name:        'Main',
          emoji:       '🏠',
          grid:        parsed.widgets,
          spans:       parsed.spans ?? {},
          connections: parsed.connections ?? {},
          createdAt:   new Date().toISOString(),
        };
        // Save v3 immediately so subsequent loads use the stable page id
        const v3: PagesLayout = { v: 3, pages: [page], activePage: page.id };
        try { localStorage.setItem(layoutCacheKeyV3(userId), JSON.stringify(v3)); } catch { /* quota */ }
        return {
          grid:            parsed.widgets,
          gridSpans:       parsed.spans ?? {},
          gridConnections: parsed.connections ?? {},
          pages:           [page],
          activePage:      page.id,
          layoutLoaded:    true,
        };
      }
    }
  } catch { /* ignore — fall through to defaults */ }
  return empty;
}

const _boot = bootLayout();

// ── Synchronous widget-data bootstrap ─────────────────────────────────────────
function bootWidgetData() {
  return {
    calendarEvents: wcRead<CalendarEvent[]>(WC_KEY.CALENDAR_EVENTS)?.data ?? [],
    slackMessages:  wcRead<SlackMessage[]>(WC_KEY.SLACK_MESSAGES)?.data  ?? [],
    recentDocs:     wcRead<DocFile[]>(WC_KEY.DOCS_LIST)?.data            ?? [],
    todos:          wcRead<TodoItem[]>(WC_KEY.TODOS)?.data               ?? [],
  };
}

const _widgetBoot = bootWidgetData();

export const useStore = create<NexusStore>((set, get) => ({
  // ── Multi-page ─────────────────────────────────────────────────────────────
  pages:               _boot.pages,
  activePage:          _boot.activePage,
  pageTransitionDir:   null,

  setActivePage: (id) => {
    const { pages, activePage } = get();
    if (id === activePage) return;
    const targetPage = pages.find((p) => p.id === id);
    if (!targetPage) return;

    const fromIdx = pages.findIndex((p) => p.id === activePage);
    const toIdx   = pages.findIndex((p) => p.id === id);
    const dir: 'left' | 'right' = toIdx > fromIdx ? 'right' : 'left';

    set({
      activePage:        id,
      pageTransitionDir: dir,
      grid:              targetPage.grid ?? {},
      gridSpans:         targetPage.spans ?? {},
      gridConnections:   targetPage.connections ?? {},
    });

    // Clear transition direction after animation completes
    setTimeout(() => set({ pageTransitionDir: null }), 250);
  },

  addPage: (name, emoji) => {
    const { pages } = get();
    const newPage: Page = {
      id:          crypto.randomUUID(),
      name,
      emoji,
      grid:        {},
      spans:       {},
      connections: {},
      createdAt:   new Date().toISOString(),
    };
    const newPages = [...pages, newPage];
    const fromIdx = pages.findIndex((p) => p.id === get().activePage);
    const toIdx   = newPages.length - 1;
    const dir: 'left' | 'right' = toIdx > fromIdx ? 'right' : 'left';

    set({
      pages:             newPages,
      activePage:        newPage.id,
      pageTransitionDir: dir,
      grid:              {},
      gridSpans:         {},
      gridConnections:   {},
    });
    setTimeout(() => set({ pageTransitionDir: null }), 250);
    return newPage.id;
  },

  deletePage: (id) => {
    const { pages, activePage } = get();
    if (pages.length <= 1) return;
    const idx      = pages.findIndex((p) => p.id === id);
    const newPages = pages.filter((p) => p.id !== id);
    let newActive  = activePage;
    let dir: 'left' | 'right' | null = null;

    if (activePage === id) {
      const newIdx = Math.min(idx, newPages.length - 1);
      newActive    = newPages[newIdx].id;
      dir          = idx > 0 ? 'left' : 'right';
    }

    const targetPage = newPages.find((p) => p.id === newActive)!;
    set({
      pages:             newPages,
      activePage:        newActive,
      pageTransitionDir: dir,
      grid:              activePage === id ? (targetPage.grid ?? {}) : get().grid,
      gridSpans:         activePage === id ? (targetPage.spans ?? {}) : get().gridSpans,
      gridConnections:   activePage === id ? (targetPage.connections ?? {}) : get().gridConnections,
    });
    if (dir) setTimeout(() => set({ pageTransitionDir: null }), 250);
  },

  renamePage: (id, name, emoji) =>
    set((state) => ({
      pages: state.pages.map((p) => (p.id === id ? { ...p, name, emoji } : p)),
    })),

  reorderPages: (fromIndex, toIndex) =>
    set((state) => {
      const newPages = [...state.pages];
      const [moved]  = newPages.splice(fromIndex, 1);
      newPages.splice(toIndex, 0, moved);
      return { pages: newPages };
    }),

  setPages: (pages, activePage) => {
    const targetPage = pages.find((p) => p.id === activePage) ?? pages[0];
    if (!targetPage) return;
    set({
      pages,
      activePage:      targetPage.id,
      grid:            targetPage.grid ?? {},
      gridSpans:       targetPage.spans ?? {},
      gridConnections: targetPage.connections ?? {},
      layoutLoaded:    true,
    });
  },

  // ── Grid (writes to active page simultaneously) ────────────────────────────
  grid: _boot.grid,

  setGrid: (grid) =>
    set((state) => ({
      grid,
      pages: syncToPages(state.pages, state.activePage, grid, state.gridSpans, state.gridConnections),
    })),

  placeWidget: (widgetId, row, col) =>
    set((state) => {
      const newGrid = { ...state.grid, [`${row},${col}`]: widgetId };
      return {
        grid:  newGrid,
        pages: syncToPages(state.pages, state.activePage, newGrid, state.gridSpans, state.gridConnections),
      };
    }),

  removeWidget: (key) =>
    set((state) => {
      const newGrid  = { ...state.grid };
      const newConns = { ...state.gridConnections };
      delete newGrid[key];
      delete newConns[key];
      return {
        grid:            newGrid,
        gridConnections: newConns,
        pages:           syncToPages(state.pages, state.activePage, newGrid, state.gridSpans, newConns),
      };
    }),

  gridSpans: _boot.gridSpans,

  setGridSpans: (spans) =>
    set((state) => ({
      gridSpans: spans,
      pages: syncToPages(state.pages, state.activePage, state.grid, spans, state.gridConnections),
    })),

  mergeZone: (rowStart, colStart, rowSpan, colSpan) =>
    set((state) => {
      const newGrid  = { ...state.grid };
      const newSpans = { ...state.gridSpans };
      let preservedWidget: WidgetType | null = null;
      for (let r = rowStart; r < rowStart + rowSpan; r++) {
        for (let c = colStart; c < colStart + colSpan; c++) {
          const k = `${r},${c}`;
          if (newGrid[k]) preservedWidget = newGrid[k] ?? null;
          delete newGrid[k];
          if (r !== rowStart || c !== colStart) delete newSpans[k];
        }
      }
      newSpans[`${rowStart},${colStart}`] = { rowSpan, colSpan };
      if (preservedWidget) newGrid[`${rowStart},${colStart}`] = preservedWidget;
      return {
        grid:      newGrid,
        gridSpans: newSpans,
        pages:     syncToPages(state.pages, state.activePage, newGrid, newSpans, state.gridConnections),
      };
    }),

  splitZone: (key) =>
    set((state) => {
      const newGrid  = { ...state.grid };
      const newSpans = { ...state.gridSpans };
      delete newGrid[key];
      delete newSpans[key];
      return {
        grid:      newGrid,
        gridSpans: newSpans,
        pages:     syncToPages(state.pages, state.activePage, newGrid, newSpans, state.gridConnections),
      };
    }),

  moveWidget: (fromKey, toKey) =>
    set((state) => {
      const newGrid  = { ...state.grid };
      const newSpans = { ...state.gridSpans };
      const newConns = { ...state.gridConnections };
      const widget = newGrid[fromKey];
      const span   = newSpans[fromKey] ?? { rowSpan: 1, colSpan: 1 };
      const conn   = newConns[fromKey];
      delete newGrid[fromKey];
      delete newSpans[fromKey];
      delete newConns[fromKey];

      const [toR, toC] = toKey.split(',').map(Number);
      for (let r = toR; r < toR + span.rowSpan; r++) {
        for (let c = toC; c < toC + span.colSpan; c++) {
          delete newSpans[`${r},${c}`];
        }
      }

      if (widget != null) newGrid[toKey] = widget;
      if (span.rowSpan > 1 || span.colSpan > 1) newSpans[toKey] = span;
      if (conn !== undefined) newConns[toKey] = conn;
      return {
        grid:            newGrid,
        gridSpans:       newSpans,
        gridConnections: newConns,
        pages:           syncToPages(state.pages, state.activePage, newGrid, newSpans, newConns),
      };
    }),

  swapWidgets: (keyA, keyB) =>
    set((state) => {
      const newGrid  = { ...state.grid };
      const newConns = { ...state.gridConnections };
      const widgetA = newGrid[keyA];
      const widgetB = newGrid[keyB];
      if (widgetB != null) newGrid[keyA] = widgetB; else delete newGrid[keyA];
      if (widgetA != null) newGrid[keyB] = widgetA; else delete newGrid[keyB];
      const connA = newConns[keyA];
      const connB = newConns[keyB];
      if (connB !== undefined) newConns[keyA] = connB; else delete newConns[keyA];
      if (connA !== undefined) newConns[keyB] = connA; else delete newConns[keyB];
      return {
        grid:            newGrid,
        gridConnections: newConns,
        pages:           syncToPages(state.pages, state.activePage, newGrid, state.gridSpans, newConns),
      };
    }),

  gridConnections: _boot.gridConnections,

  setGridConnections: (conns) =>
    set((state) => ({
      gridConnections: conns,
      pages:           syncToPages(state.pages, state.activePage, state.grid, state.gridSpans, conns),
    })),

  setWidgetConnection: (key, connectionId) =>
    set((state) => {
      const newConns = { ...state.gridConnections, [key]: connectionId };
      return {
        gridConnections: newConns,
        pages:           syncToPages(state.pages, state.activePage, state.grid, state.gridSpans, newConns),
      };
    }),

  removeWidgetConnection: (key) =>
    set((state) => {
      const newConns = { ...state.gridConnections };
      delete newConns[key];
      return {
        gridConnections: newConns,
        pages:           syncToPages(state.pages, state.activePage, state.grid, state.gridSpans, newConns),
      };
    }),

  swapNotifyEnabled: localStorage.getItem('nexus_swap_notify') !== 'false',
  setSwapNotifyEnabled: (v) => {
    localStorage.setItem('nexus_swap_notify', v ? 'true' : 'false');
    set({ swapNotifyEnabled: v });
  },

  resizeZone: (oldKey, rowStart, colStart, rowSpan, colSpan) =>
    set((state) => {
      const newGrid  = { ...state.grid };
      const newSpans = { ...state.gridSpans };
      const preservedWidget = newGrid[oldKey] ?? null;
      const oldSpan = newSpans[oldKey] ?? { rowSpan: 1, colSpan: 1 };
      const [oldR, oldC] = oldKey.split(',').map(Number);

      for (let r = oldR; r < oldR + oldSpan.rowSpan; r++) {
        for (let c = oldC; c < oldC + oldSpan.colSpan; c++) {
          delete newGrid[`${r},${c}`];
          delete newSpans[`${r},${c}`];
        }
      }

      const newKey = `${rowStart},${colStart}`;
      newSpans[newKey] = { rowSpan, colSpan };
      if (preservedWidget) newGrid[newKey] = preservedWidget;
      return {
        grid:      newGrid,
        gridSpans: newSpans,
        pages:     syncToPages(state.pages, state.activePage, newGrid, newSpans, state.gridConnections),
      };
    }),

  layoutLoaded: _boot.layoutLoaded,
  setLayoutLoaded: (loaded) => set({ layoutLoaded: loaded }),

  isAILoading: false,
  lastAIResponse: null,
  setAILoading: (loading) => set({ isAILoading: loading }),
  setLastAIResponse: (response) => set({ lastAIResponse: response }),

  activeContexts: ['calendar', 'slack', 'obsidian', 'docs', 'todo'],

  toggleContext: (context) =>
    set((state) => ({
      activeContexts: state.activeContexts.includes(context)
        ? state.activeContexts.filter((c) => c !== context)
        : [...state.activeContexts, context],
    })),

  serviceStates: makeInitialStates(),

  refreshServiceStatus: async () => {
    set((state) => ({
      serviceStates: Object.fromEntries(
        Object.entries(state.serviceStates).map(([k, v]) => [k, { ...v, checking: true }])
      ),
    }));

    const now = Date.now();

    const [
      healthResult,
      googleCalResult,
      googleTasksResult,
      googleDocsResult,
      googleDriveResult,
      slackResult,
      plaidResult,
    ] = await Promise.allSettled([
      fetch(`${API_BASE_URL}/api/health`),
      apiFetch('/api/auth/google-calendar/status'),
      apiFetch('/api/auth/google-tasks/status'),
      apiFetch('/api/auth/google-docs/status'),
      apiFetch('/api/auth/google-drive/status'),
      apiFetch('/api/auth/slack/status'),
      apiFetch('/api/plaid/status'),
    ]);

    if (healthResult.status === 'fulfilled' && healthResult.value.ok) {
      const data = (await healthResult.value.json()) as Record<string, boolean>;
      const perUserServices = new Set(['googleCalendar', 'googleTasks', 'googleDocs', 'googleDrive', 'slack', 'plaid']);
      set((state) => ({
        serviceStates: Object.fromEntries(
          SERVICES.map((key) => {
            const prev = state.serviceStates[key] ?? initialState();
            if (perUserServices.has(key)) return [key, prev];
            const isConnected = data[API_KEY_MAP[key]] === true;
            return [key, { connected: isConnected, lastConfirmedAt: isConnected ? now : prev.lastConfirmedAt, checking: false }];
          })
        ),
      }));
    } else {
      applyTimeoutLogic(now, ['ollama', 'obsidian']);
    }

    function applyGoogleStatus(
      result: PromiseSettledResult<Response>,
      storeKey: 'googleCalendar' | 'googleTasks' | 'googleDocs' | 'googleDrive'
    ) {
      if (result.status === 'fulfilled' && result.value.ok) {
        result.value.json().then((d) => {
          const { connected } = d as { connected: boolean };
          set((state) => ({
            serviceStates: {
              ...state.serviceStates,
              [storeKey]: {
                connected,
                lastConfirmedAt: connected ? now : (state.serviceStates[storeKey] ?? initialState()).lastConfirmedAt,
                checking: false,
              },
            },
          }));
        });
      } else {
        applyTimeoutLogic(now, [storeKey]);
      }
    }

    applyGoogleStatus(googleCalResult,   'googleCalendar');
    applyGoogleStatus(googleTasksResult, 'googleTasks');
    applyGoogleStatus(googleDocsResult,  'googleDocs');
    applyGoogleStatus(googleDriveResult, 'googleDrive');

    if (plaidResult.status === 'fulfilled' && plaidResult.value.ok) {
      plaidResult.value.json().then((d) => {
        const { connected } = d as { connected: boolean };
        set((state) => ({
          serviceStates: {
            ...state.serviceStates,
            plaid: {
              connected,
              lastConfirmedAt: connected ? now : (state.serviceStates.plaid ?? initialState()).lastConfirmedAt,
              checking: false,
            },
          },
        }));
      });
    } else {
      applyTimeoutLogic(now, ['plaid']);
    }

    if (slackResult.status === 'fulfilled' && slackResult.value.ok) {
      const { connected } = (await slackResult.value.json()) as { connected: boolean };
      set((state) => ({
        serviceStates: {
          ...state.serviceStates,
          slack: {
            connected,
            lastConfirmedAt: connected ? now : (state.serviceStates.slack ?? initialState()).lastConfirmedAt,
            checking: false,
          },
        },
      }));
    } else {
      applyTimeoutLogic(now, ['slack']);
    }

    function applyTimeoutLogic(ts: number, keys: string[] = [...SERVICES]) {
      set((state) => ({
        serviceStates: Object.fromEntries(
          keys.map((key) => {
            const prev = state.serviceStates[key];
            const withinTimeout =
              prev.lastConfirmedAt !== null && ts - prev.lastConfirmedAt < CONNECTION_TIMEOUT;
            return [
              key,
              {
                connected: withinTimeout ? prev.connected : false,
                lastConfirmedAt: prev.lastConfirmedAt,
                checking: false,
              },
            ];
          })
        ),
      }));
    }
  },

  calendarEvents: _widgetBoot.calendarEvents,
  setCalendarEvents: (events) => set({ calendarEvents: events }),

  slackMessages: _widgetBoot.slackMessages,
  setSlackMessages: (messages) => set({ slackMessages: messages }),

  obsidianContent: '',
  setObsidianContent: (content) => set({ obsidianContent: content }),

  recentDocs: _widgetBoot.recentDocs,
  setRecentDocs: (docs) => set({ recentDocs: docs }),

  todos: _widgetBoot.todos,
  setTodos: (todos) => set({ todos }),
  addTodo: (todo) => set((state) => ({ todos: [...state.todos, todo] })),
  updateTodo: (id, updates) =>
    set((state) => ({
      todos: state.todos.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  deleteTodo: (id) =>
    set((state) => ({ todos: state.todos.filter((t) => t.id !== id) })),
  toggleTodo: (id) =>
    set((state) => ({
      todos: state.todos.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
    })),

  flashingWidget: null,
  flashWidget: (widgetId) => {
    set({ flashingWidget: widgetId });
    setTimeout(() => set({ flashingWidget: null }), 2500);
  },

  calendarRefetchKey: 0,
  triggerCalendarRefetch: () => set((s) => ({ calendarRefetchKey: s.calendarRefetchKey + 1 })),

  todosRefetchKey: 0,
  triggerTodosRefetch: () => set((s) => ({ todosRefetchKey: s.todosRefetchKey + 1 })),

  pendingCalendarEventIds: {},
  addPendingCalendarEventId: (id) =>
    set((s) => ({ pendingCalendarEventIds: { ...s.pendingCalendarEventIds, [id]: Date.now() } })),
  clearPendingCalendarEventId: (id) =>
    set((s) => {
      const next = { ...s.pendingCalendarEventIds };
      delete next[id];
      return { pendingCalendarEventIds: next };
    }),
}));

// ─── Convenience selector ───────────────────────────────────────────────────
export function useServiceState(service: string) {
  const state = useStore((s) => s.serviceStates[service] ?? initialState());
  const neverConnected = state.lastConfirmedAt === null && !state.connected;
  const isStale = !state.connected && state.lastConfirmedAt !== null;
  return { isConnected: state.connected, neverConnected, isStale, isChecking: state.checking };
}
