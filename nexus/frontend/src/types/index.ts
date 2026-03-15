export type WidgetType = 'calendar' | 'slack' | 'obsidian' | 'docs' | 'todo' | 'weather' | 'tasks' | 'plaid' | 'stocks' | 'links' | 'notes' | 'wordle' | 'news' | 'typing' | 'shared_chess' | 'pomodoro' | 'lofi' | 'spotify' | 'f1' | 'football' | 'timezone' | 'currency' | 'shared_photo';

// Describes how many grid cells a zone occupies beyond the default 1×1
export interface GridSpan {
  colSpan: number; // ≥ 1
  rowSpan: number; // ≥ 1
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** Raw ISO-8601 datetime from Google Calendar (e.g. "2026-03-05T17:00:00Z").
   *  Null for all-day events. The frontend converts this to local time. */
  startDateTime?: string | null;
  date: string;   // kept for all-day events; timed events derive date from startDateTime
  time: string;   // deprecated — use startDateTime
  duration: number;
  description?: string;
  colorId?: string;
}

export interface SlackMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  timestamp: string;
  channel: string;
}

export interface SlackChannel {
  id: string;
  name: string;
}

export interface SlackUser {
  id: string;
  name: string;
  realName: string;
}

export interface ObsidianNote {
  path: string;
  content: string;
  items: string[];
}

export interface DocFile {
  id: string;
  name: string;
  modifiedTime: string;
  url: string;
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string; // ISO date string: "2026-03-05"
  dueTime?: string; // 24h time string: "14:30"
}

// ── Chess ──────────────────────────────────────────────────────────────────────

export interface ChessGameState {
  id:           string;
  connectionId: string;
  boardFen:     string;
  whiteUserId:  string | null;
  blackUserId:  string | null;
  currentTurn:  'white' | 'black';
  status:       'waiting' | 'active' | 'white_wins' | 'black_wins' | 'draw' | 'stalemate';
  moveHistory:  string[]; // SAN notation
  lastMove:     { from: string; to: string } | null;
  createdAt:    string;
  updatedAt:    string;
}

export interface SharedTodoItem {
  id:           string;
  connectionId: string;
  text:         string;
  completed:    boolean;
  createdBy:    string; // userId of the creator — used for per-user badges
  position:     number;
  createdAt:    string;
}

export interface PlaidAccount {
  id: string;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  balanceCurrent: number | null;
  balanceAvailable: number | null;
  balanceLimit: number | null;
  currency: string;
}

export interface PlaidTransaction {
  id: string;
  name: string;
  amount: number;       // positive = debit (money out), negative = credit (money in)
  date: string;         // YYYY-MM-DD
  category: string | null;
  pending: boolean;
  accountId: string;
  logoUrl: string | null;
}

export interface PlaidHolding {
  id: string;
  name: string;
  ticker: string | null;
  value: number;
  quantity: number;
  price: number | null;
  pctOfPortfolio: number;
  accountName: string | null;
}

export interface TaskItem {
  id: string;
  title: string;
  due?: string | null;    // RFC 3339 from Google (date only: "YYYY-MM-DDT00:00:00.000Z")
  notes?: string | null;
  status: 'needsAction' | 'completed';
}

// ── Stocks ─────────────────────────────────────────────────────────────────────

export interface StockQuote {
  symbol: string;
  shortName: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export interface StockBar {
  time: string;        // ISO-8601
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface StockSearchResult {
  symbol: string;
  shortName: string;
  typeDisp: string;
  exchDisp: string;
}

export interface StocksOverview {
  quotes: StockQuote[];
  sparklines: Record<string, number[]>;
}

export interface StockDetail extends StockQuote {
  bars: StockBar[];
}

// ── Weather ────────────────────────────────────────────────────────────────────

export interface WeatherData {
  city: string;
  temp: number;
  feelsLike: number;
  description: string;
  humidity: number;
  icon: string;
}

export interface AIResponse {
  intent: string;
  humanResponse: string;
  params: Record<string, unknown>;
  result?: unknown;
  suggestedActions: string[];
  widgetToFlash?: WidgetType;
}

export type ServiceStatus = 'connected' | 'disconnected' | 'loading';

export interface ServiceConnectionState {
  connected: boolean;
  lastConfirmedAt: number | null; // null = never successfully connected
  checking: boolean;              // background check in progress — don't flash UI
}

export interface ServiceHealthMap {
  ollama: boolean;
  googleCalendar: boolean;
  slack: boolean;
  obsidian: boolean;
  googleDocs: boolean;
}

export interface WidgetConfig {
  id: WidgetType;
  label: string;
  icon: string;
  accentColor: string;
  serviceTag: 'MCP' | 'API' | 'LOCAL' | 'CLOUD' | 'SHARED';
  category: 'Work' | 'Music' | 'Finance' | 'Games' | 'Info' | 'Tools';
}

// ── Quick Notes ────────────────────────────────────────────────────────────────

export interface QuickNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// ── Quick Links ────────────────────────────────────────────────────────────────

export interface QuickLink {
  slotIndex: number;
  url: string;
  displayName: string;
  faviconUrl: string;
}

export const WIDGET_CONFIGS: WidgetConfig[] = [
  // Work
  { id: 'calendar',    label: 'Calendar',     icon: '📅', accentColor: '#4285f4', serviceTag: 'API',   category: 'Work'    },
  { id: 'tasks',       label: 'Google Tasks', icon: '☑️', accentColor: '#1a73e8', serviceTag: 'API',   category: 'Work'    },
  { id: 'todo',        label: 'To-Do',        icon: '✅', accentColor: '#3de8b0', serviceTag: 'CLOUD', category: 'Work'    },
  { id: 'pomodoro',    label: 'Pomodoro',     icon: '🍅', accentColor: '#7c6aff', serviceTag: 'CLOUD', category: 'Work'    },
  { id: 'docs',        label: 'Google Docs',  icon: '📄', accentColor: '#34a853', serviceTag: 'API',   category: 'Work'    },
  { id: 'slack',       label: 'Slack',        icon: '💬', accentColor: '#e8693f', serviceTag: 'API',   category: 'Work'    },
  // Music
  { id: 'spotify',     label: 'Spotify',      icon: '🎵', accentColor: '#1db954', serviceTag: 'API',   category: 'Music'   },
  { id: 'lofi',        label: 'Lofi Girl',    icon: '📻', accentColor: '#a78bfa', serviceTag: 'API',   category: 'Music'   },
  // Finance
  { id: 'plaid',       label: 'Finance',      icon: '💳', accentColor: '#00b140', serviceTag: 'API',   category: 'Finance' },
  { id: 'stocks',      label: 'Stocks',       icon: '📈', accentColor: '#3de8b0', serviceTag: 'API',   category: 'Finance' },
  // Games
  { id: 'wordle',      label: 'Wordle',       icon: '🟩', accentColor: '#538d4e', serviceTag: 'API',   category: 'Games'   },
  { id: 'shared_chess', label: 'Chess',         icon: '♟️', accentColor: '#c0a060', serviceTag: 'SHARED', category: 'Games'   },
  { id: 'shared_photo', label: 'Photo Frame',   icon: '📷', accentColor: '#a855f7', serviceTag: 'SHARED', category: 'Tools'   },
  { id: 'typing',      label: 'Typing',       icon: '⌨️', accentColor: '#7c6aff', serviceTag: 'CLOUD', category: 'Games'   },
  // Info
  { id: 'weather',     label: 'Weather',      icon: '🌤', accentColor: '#f59e0b', serviceTag: 'API',   category: 'Info'    },
  { id: 'news',        label: 'News',         icon: '📰', accentColor: '#e8693f', serviceTag: 'API',   category: 'Info'    },
  { id: 'f1',          label: 'Formula 1',    icon: '🏎️', accentColor: '#E8002D', serviceTag: 'API',   category: 'Info'    },
  { id: 'football',    label: 'Football',     icon: '⚽', accentColor: '#3D195B', serviceTag: 'API',   category: 'Info'    },
  // Tools
  { id: 'notes',       label: 'Quick Notes',  icon: '📝', accentColor: '#a78bfa', serviceTag: 'CLOUD', category: 'Tools'   },
  { id: 'links',       label: 'Quick Links',  icon: '🔗', accentColor: '#7c6aff', serviceTag: 'CLOUD', category: 'Tools'   },
  { id: 'obsidian',    label: 'Obsidian',     icon: '🔮', accentColor: '#8b5cf6', serviceTag: 'LOCAL', category: 'Tools'   },
  { id: 'timezone',    label: 'Time Zones',   icon: '🌐', accentColor: '#7c6aff', serviceTag: 'LOCAL', category: 'Tools'   },
  { id: 'currency',    label: 'Currency',     icon: '💱', accentColor: '#3de8b0', serviceTag: 'API',   category: 'Finance' },
];
