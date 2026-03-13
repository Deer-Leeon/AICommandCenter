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

interface NexusStore {
  // Widget placement
  grid: Record<string, WidgetType | null>;
  setGrid: (grid: Record<string, WidgetType | null>) => void;
  placeWidget: (widgetId: WidgetType, row: number, col: number) => void;
  removeWidget: (key: string) => void;

  // Grid zone spans (key = "row,col" top-left of merged zone)
  gridSpans: Record<string, GridSpan>;
  setGridSpans: (spans: Record<string, GridSpan>) => void;
  mergeZone: (rowStart: number, colStart: number, rowSpan: number, colSpan: number) => void;
  splitZone: (key: string) => void;
  resizeZone: (oldKey: string, rowStart: number, colStart: number, rowSpan: number, colSpan: number) => void;
  moveWidget: (fromKey: string, toKey: string) => void;
  swapWidgets: (keyA: string, keyB: string) => void;

  // Shared widget connection bindings (key = "row,col" → connectionId)
  // Only present for shared widgets; personal widgets have no entry here.
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

  // Service connection states (stale-while-revalidate)
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

  // Refetch triggers — increment to force an immediate data refresh in the relevant hook
  calendarRefetchKey: number;
  triggerCalendarRefetch: () => void;
  todosRefetchKey: number;
  triggerTodosRefetch: () => void;

  // Optimistic calendar events buffer:
  // maps event-id → timestamp it was added so we never overwrite an
  // optimistically-added event with a stale API response during propagation delay.
  pendingCalendarEventIds: Record<string, number>;
  addPendingCalendarEventId: (id: string) => void;
  clearPendingCalendarEventId: (id: string) => void;
}

// ── Synchronous localStorage bootstrap ───────────────────────────────────────
// Read the cached layout before the store is created so the very FIRST render
// already has the correct grid and layoutLoaded=true. This eliminates the
// null → App flash caused by the async useEffect in useLayoutPersistence.
function bootLayout(): { grid: Record<string, WidgetType | null>; gridSpans: Record<string, GridSpan>; gridConnections: Record<string, string>; layoutLoaded: boolean } {
  try {
    const raw = localStorage.getItem('nexus_layout_v2');
    if (!raw) return { grid: {}, gridSpans: {}, gridConnections: {}, layoutLoaded: false };
    const parsed = JSON.parse(raw) as { v?: number; widgets?: Record<string, WidgetType>; spans?: Record<string, GridSpan>; connections?: Record<string, string> };
    if (parsed?.v === 2 && parsed.widgets) {
      return {
        grid:            parsed.widgets,
        gridSpans:       parsed.spans ?? {},
        gridConnections: parsed.connections ?? {},
        layoutLoaded:    true,
      };
    }
  } catch { /* ignore — fall through to defaults */ }
  return { grid: {}, gridSpans: {}, gridConnections: {}, layoutLoaded: false };
}

const _boot = bootLayout();

// ── Synchronous widget-data bootstrap ─────────────────────────────────────────
// Pre-populate Zustand with the user's last-known data so widgets render
// immediately with real content instead of skeletons.
function bootWidgetData() {
  return {
    calendarEvents: wcRead<CalendarEvent[]>(WC_KEY.CALENDAR_EVENTS)?.data ?? [],
    slackMessages:  wcRead<SlackMessage[]>(WC_KEY.SLACK_MESSAGES)?.data  ?? [],
    recentDocs:     wcRead<DocFile[]>(WC_KEY.DOCS_LIST)?.data            ?? [],
    todos:          wcRead<TodoItem[]>(WC_KEY.TODOS)?.data               ?? [],
  };
}

const _widgetBoot = bootWidgetData();

export const useStore = create<NexusStore>((set) => ({
  grid: _boot.grid,

  setGrid: (grid) => set({ grid }),

  placeWidget: (widgetId, row, col) =>
    set((state) => ({
      grid: { ...state.grid, [`${row},${col}`]: widgetId },
    })),

  removeWidget: (key) =>
    set((state) => {
      const newGrid  = { ...state.grid };
      const newConns = { ...state.gridConnections };
      delete newGrid[key];
      delete newConns[key];
      return { grid: newGrid, gridConnections: newConns };
    }),

  gridSpans: _boot.gridSpans,
  setGridSpans: (spans) => set({ gridSpans: spans }),

  mergeZone: (rowStart, colStart, rowSpan, colSpan) =>
    set((state) => {
      const newGrid = { ...state.grid };
      const newSpans = { ...state.gridSpans };

      // If one cell in the area already has a widget (expand-occupied-zone case),
      // preserve it by moving it to the new top-left key.
      let preservedWidget: WidgetType | null = null;
      for (let r = rowStart; r < rowStart + rowSpan; r++) {
        for (let c = colStart; c < colStart + colSpan; c++) {
          const k = `${r},${c}`;
          if (newGrid[k]) preservedWidget = newGrid[k] ?? null;
          delete newGrid[k];
          if (r !== rowStart || c !== colStart) delete newSpans[k];
        }
      }

      // Record the new span on the top-left cell
      newSpans[`${rowStart},${colStart}`] = { rowSpan, colSpan };
      if (preservedWidget) newGrid[`${rowStart},${colStart}`] = preservedWidget;

      return { grid: newGrid, gridSpans: newSpans };
    }),

  splitZone: (key) =>
    set((state) => {
      const newGrid = { ...state.grid };
      const newSpans = { ...state.gridSpans };
      delete newGrid[key];        // remove widget from the zone being split
      delete newSpans[key];       // revert to 1×1
      return { grid: newGrid, gridSpans: newSpans };
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

      // Clear any pre-existing span records in the entire target area so that
      // dropping a 2×1 widget onto two plain 1×1 cells (or a differently-sized
      // pre-merged empty zone) always leaves a clean slate before placing the widget.
      const [toR, toC] = toKey.split(',').map(Number);
      for (let r = toR; r < toR + span.rowSpan; r++) {
        for (let c = toC; c < toC + span.colSpan; c++) {
          delete newSpans[`${r},${c}`];
        }
      }

      if (widget != null) newGrid[toKey] = widget;
      if (span.rowSpan > 1 || span.colSpan > 1) newSpans[toKey] = span;
      if (conn !== undefined) newConns[toKey] = conn; // connection binding follows the widget
      return { grid: newGrid, gridSpans: newSpans, gridConnections: newConns };
    }),

  // Swap the widget types at two positions; spans stay fixed so each widget
  // inherits the zone it moves into (this is intentional for different-size swaps).
  swapWidgets: (keyA, keyB) =>
    set((state) => {
      const newGrid  = { ...state.grid };
      const newConns = { ...state.gridConnections };
      const widgetA = newGrid[keyA];
      const widgetB = newGrid[keyB];
      if (widgetB != null) newGrid[keyA] = widgetB; else delete newGrid[keyA];
      if (widgetA != null) newGrid[keyB] = widgetA; else delete newGrid[keyB];
      // Connection bindings follow their respective widgets through the swap
      const connA = newConns[keyA];
      const connB = newConns[keyB];
      if (connB !== undefined) newConns[keyA] = connB; else delete newConns[keyA];
      if (connA !== undefined) newConns[keyB] = connA; else delete newConns[keyB];
      return { grid: newGrid, gridConnections: newConns };
    }),

  gridConnections: _boot.gridConnections,
  setGridConnections: (conns) => set({ gridConnections: conns }),
  setWidgetConnection: (key, connectionId) =>
    set((state) => ({ gridConnections: { ...state.gridConnections, [key]: connectionId } })),
  removeWidgetConnection: (key) =>
    set((state) => {
      const next = { ...state.gridConnections };
      delete next[key];
      return { gridConnections: next };
    }),

  swapNotifyEnabled: localStorage.getItem('nexus_swap_notify') !== 'false',
  setSwapNotifyEnabled: (v) => {
    localStorage.setItem('nexus_swap_notify', v ? 'true' : 'false');
    set({ swapNotifyEnabled: v });
  },

  resizeZone: (oldKey, rowStart, colStart, rowSpan, colSpan) =>
    set((state) => {
      const newGrid = { ...state.grid };
      const newSpans = { ...state.gridSpans };

      // Preserve the widget sitting at the old top-left key (may move to new key)
      const preservedWidget = newGrid[oldKey] ?? null;
      const oldSpan = newSpans[oldKey] ?? { rowSpan: 1, colSpan: 1 };
      const [oldR, oldC] = oldKey.split(',').map(Number);

      // Clear every cell the old span covered
      for (let r = oldR; r < oldR + oldSpan.rowSpan; r++) {
        for (let c = oldC; c < oldC + oldSpan.colSpan; c++) {
          delete newGrid[`${r},${c}`];
          delete newSpans[`${r},${c}`];
        }
      }

      // Apply new span at the (possibly different) top-left key
      const newKey = `${rowStart},${colStart}`;
      newSpans[newKey] = { rowSpan, colSpan };
      if (preservedWidget) newGrid[newKey] = preservedWidget;

      return { grid: newGrid, gridSpans: newSpans };
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
    // Mark checking=true for all services but DO NOT change connected/lastConfirmedAt —
    // this prevents any UI flash during routine background polls
    set((state) => ({
      serviceStates: Object.fromEntries(
        Object.entries(state.serviceStates).map(([k, v]) => [k, { ...v, checking: true }])
      ),
    }));

    const now = Date.now();

    // Run health check + all 4 Google services + Slack in parallel
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

    // --- Health check (ollama, obsidian — server-level services) ---
    if (healthResult.status === 'fulfilled' && healthResult.value.ok) {
      const data = (await healthResult.value.json()) as Record<string, boolean>;
      const perUserServices = new Set(['googleCalendar', 'googleTasks', 'googleDocs', 'googleDrive', 'slack', 'plaid']);
      set((state) => ({
        serviceStates: Object.fromEntries(
          SERVICES.map((key) => {
            if (perUserServices.has(key)) return [key, state.serviceStates[key]];
            const isConnected = data[API_KEY_MAP[key]] === true;
            const prev = state.serviceStates[key];
            return [key, { connected: isConnected, lastConfirmedAt: isConnected ? now : prev.lastConfirmedAt, checking: false }];
          })
        ),
      }));
    } else {
      applyTimeoutLogic(now, ['ollama', 'obsidian']);
    }

    // Helper to apply a single per-user Google service result
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
                lastConfirmedAt: connected ? now : state.serviceStates[storeKey].lastConfirmedAt,
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

    // --- Plaid status ---
    if (plaidResult.status === 'fulfilled' && plaidResult.value.ok) {
      plaidResult.value.json().then((d) => {
        const { connected } = d as { connected: boolean };
        set((state) => ({
          serviceStates: {
            ...state.serviceStates,
            plaid: {
              connected,
              lastConfirmedAt: connected ? now : state.serviceStates.plaid.lastConfirmedAt,
              checking: false,
            },
          },
        }));
      });
    } else {
      applyTimeoutLogic(now, ['plaid']);
    }

    // --- Per-user Slack status ---
    if (slackResult.status === 'fulfilled' && slackResult.value.ok) {
      const { connected } = (await slackResult.value.json()) as { connected: boolean };
      set((state) => ({
        serviceStates: {
          ...state.serviceStates,
          slack: {
            connected,
            lastConfirmedAt: connected ? now : state.serviceStates.slack.lastConfirmedAt,
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
                // Keep showing connected if we confirmed recently — it might be a transient error
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
// Returns display state for a single service:
// neverConnected = true  → show "not connected" empty state
// isStale = true         → show last good data + subtle reconnecting badge
// isConnected = true     → normal
export function useServiceState(service: string) {
  const state = useStore((s) => s.serviceStates[service] ?? initialState());
  const neverConnected = state.lastConfirmedAt === null && !state.connected;
  const isStale = !state.connected && state.lastConfirmedAt !== null;
  return { isConnected: state.connected, neverConnected, isStale, isChecking: state.checking };
}
