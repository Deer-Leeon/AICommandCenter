/**
 * Type declarations for window.electronAPI — exposed by electron/preload.ts
 * via Electron's contextBridge. Only present when running inside the Electron wrapper.
 */

interface ElectronAPI {
  // ── Platform ──────────────────────────────────────────────────────────────
  readonly platform: NodeJS.Platform;
  readonly isElectron: true;

  // ── OAuth / Deep links ────────────────────────────────────────────────────
  /** Called by AuthCallback.tsx to receive nexus://auth/callback?code=… */
  onDeepLink: (callback: (url: string) => void) => void;

  /** Called by ConnectServicesPage to receive Spotify / backend OAuth redirects */
  onOAuthParams: (callback: (queryString: string) => void) => void;

  // ── IPC events from main process ──────────────────────────────────────────
  onNewPage: (callback: () => void) => void;
  onStartPomodoro: (callback: () => void) => void;
  onNotificationClick: (callback: (data: { widgetType?: string }) => void) => void;

  // ── Native notifications ──────────────────────────────────────────────────
  showNotification: (title: string, body: string, widgetType?: string) => void;

  // ── Dock badge ────────────────────────────────────────────────────────────
  setDockBadge: (count: number | null) => void;

  // ── External URL ─────────────────────────────────────────────────────────
  openExternalUrl: (url: string) => Promise<void>;

  // ── Window controls ───────────────────────────────────────────────────────
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  openMainWindow: () => void;

  // ── App info ──────────────────────────────────────────────────────────────
  getVersion: () => string;

  // ── Auto-update ───────────────────────────────────────────────────────────
  onUpdateAvailable: (callback: () => void) => void;
  onUpdateDownloaded: (callback: () => void) => void;
  checkForUpdates: () => void;
  restartAndInstall: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
