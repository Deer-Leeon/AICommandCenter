import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Platform detection ──────────────────────────────────────────────────────
  platform: process.platform,
  isElectron: true as const,

  // ── Deep link handling (Google / Supabase OAuth) ────────────────────────────
  // Called by AuthCallback.tsx to process nexus://auth/callback?code=...
  onDeepLink: (callback: (url: string) => void) => {
    ipcRenderer.on('deep-link', (_event, url: string) => callback(url));
  },

  // ── OAuth query-param forwarding (Spotify and other backend-initiated flows) ─
  // Called by ConnectServicesPage.tsx to process ?spotify_connected=true etc.
  onOAuthParams: (callback: (queryString: string) => void) => {
    ipcRenderer.on('oauth-params', (_event, qs: string) => callback(qs));
  },

  // ── IPC action forwarding from main process ──────────────────────────────────
  onNewPage: (callback: () => void) => {
    ipcRenderer.on('new-page', () => callback());
  },
  onStartPomodoro: (callback: () => void) => {
    ipcRenderer.on('start-pomodoro', () => callback());
  },
  onNotificationClick: (callback: (data: { widgetType?: string }) => void) => {
    ipcRenderer.on('notification-click', (_event, data) => callback(data));
  },

  // ── Native notifications ────────────────────────────────────────────────────
  showNotification: (title: string, body: string, widgetType?: string) => {
    ipcRenderer.send('show-notification', { title, body, widgetType });
  },

  // ── Dock badge ──────────────────────────────────────────────────────────────
  setDockBadge: (count: number | null) => {
    ipcRenderer.send('set-dock-badge', count);
  },

  // ── Window controls ─────────────────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  openMainWindow: () => ipcRenderer.send('open-main-window'),

  // ── App info ─────────────────────────────────────────────────────────────────
  getVersion: (): string => ipcRenderer.sendSync('get-version') as string,

  // ── Auto-update ──────────────────────────────────────────────────────────────
  onUpdateAvailable: (callback: () => void) => {
    ipcRenderer.on('update-available', () => callback());
  },
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on('update-downloaded', () => callback());
  },
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  restartAndInstall: () => ipcRenderer.send('restart-and-install'),
});
