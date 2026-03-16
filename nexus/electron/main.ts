import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Menu,
  shell,
  nativeTheme,
} from 'electron';
import * as path from 'path';
import Store from 'electron-store';
import { buildMenu } from './menu';
import { setupTray } from './tray';
import { setupUpdater } from './updater';
import { sendNotification } from './notifications';

// ── Constants ────────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV === 'development';
// In production the React SPA is bundled into the app as an extraResource
// and lives at <app>/Contents/Resources/frontend/dist/index.html.
// process.resourcesPath points to that Resources directory at runtime.
const FRONTEND_URL = isDev
  ? 'http://localhost:5173'
  : `file://${path.join(process.resourcesPath, 'frontend/dist/index.html')}`;

const PRODUCTION_HOST = 'nexus.lj-buchmiller.com';

// ── Window state persistence ─────────────────────────────────────────────────

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

const store = new Store<{ windowBounds: WindowBounds }>({
  defaults: { windowBounds: { width: 1400, height: 900 } },
});

// ── Deep link buffer ─────────────────────────────────────────────────────────
// Holds a nexus:// URL that arrived before the window was ready.

let pendingDeepLink: string | null = null;
let mainWindow: BrowserWindow | null = null;

// ── Protocol registration ─────────────────────────────────────────────────────

// Must be called before app is ready on macOS
app.setAsDefaultProtocolClient('nexus');

// ── Handle deep links (macOS open-url event) ─────────────────────────────────

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deep-link', url);
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  } else {
    pendingDeepLink = url;
  }
});

// ── Create main window ───────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const bounds = store.get('windowBounds');

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Allow loading local files in production
      allowRunningInsecureContent: false,
    },
    show: false,
    icon: path.join(__dirname, 'build/icon.png'),
  });

  // ── Load frontend ───────────────────────────────────────────────────────────

  win.loadURL(FRONTEND_URL).catch(console.error);

  // ── Show without flash ──────────────────────────────────────────────────────

  win.once('ready-to-show', () => {
    win.show();
    // Deliver any deep link that arrived before the window was ready
    if (pendingDeepLink) {
      win.webContents.send('deep-link', pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  // ── Persist window bounds ───────────────────────────────────────────────────

  win.on('close', () => {
    if (!win.isDestroyed()) {
      const b = win.getBounds();
      store.set('windowBounds', { x: b.x, y: b.y, width: b.width, height: b.height });
    }
  });

  // ── Spotify / Google OAuth redirect interception ────────────────────────────
  // The deployed backend redirects to nexus.lj-buchmiller.com after OAuth.
  // We intercept that navigation and forward the query params to the renderer
  // so ConnectServicesPage.tsx can process them without leaving the Electron app.

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === PRODUCTION_HOST && !isDev) {
        // Don't intercept the initial page load in dev (which lands on localhost)
        event.preventDefault();
        win.webContents.send('oauth-params', parsed.search);
      }
    } catch {
      // Malformed URL — ignore
    }
  });

  // Allow external links to open in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  mainWindow = createMainWindow();

  // Native menu
  buildMenu(mainWindow);

  // Tray icon
  setupTray(mainWindow);

  // Auto-updater (polls every 4 hours)
  setupUpdater(mainWindow);

  // Global shortcut: Cmd+Shift+N — toggle window visibility
  const shortcutRegistered = globalShortcut.register('CommandOrControl+Shift+N', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
      return;
    }
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (!shortcutRegistered) {
    console.warn('[NEXUS] Could not register global shortcut Cmd+Shift+N — already in use');
  }

  // Dock menu (macOS only)
  if (process.platform === 'darwin') {
    app.dock.setMenu(
      Menu.buildFromTemplate([
        {
          label: 'New Page',
          click: () => mainWindow?.webContents.send('new-page'),
        },
        {
          label: 'Start Focus Session',
          click: () => mainWindow?.webContents.send('start-pomodoro'),
        },
      ])
    );
  }

  // Update dock/taskbar icon based on system theme (aesthetic only)
  nativeTheme.on('updated', () => {
    // Icon updates handled by the template image mechanism
  });
});

// macOS: keep app alive when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// macOS: re-open window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  } else if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// Dock badge
ipcMain.on('set-dock-badge', (_, count: number | null) => {
  if (process.platform === 'darwin') {
    app.dock.setBadge(count ? count.toString() : '');
  }
});

// Native notification via renderer request
ipcMain.on('show-notification', (_, { title, body, widgetType }: { title: string; body: string; widgetType?: string }) => {
  sendNotification(title, body, widgetType, mainWindow);
});

// Window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

// App version
ipcMain.on('get-version', (event) => {
  event.returnValue = app.getVersion();
});

// Open Nexus deep link in main window and focus it
ipcMain.on('open-main-window', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
});

// Dock/menu actions forwarded from tray
ipcMain.on('new-page', () => mainWindow?.webContents.send('new-page'));
ipcMain.on('start-pomodoro', () => mainWindow?.webContents.send('start-pomodoro'));

// Auto-update trigger from renderer
ipcMain.on('check-for-updates', () => {
  // setupUpdater handles this via autoUpdater
});

// Export for use in tray.ts / notifications.ts
export { mainWindow };
