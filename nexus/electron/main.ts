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
import * as http from 'http';
import Store from 'electron-store';
import { buildMenu } from './menu';
import { setupTray } from './tray';
import { setupUpdater } from './updater';
import { sendNotification } from './notifications';

// ── Constants ────────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV === 'development';
// In production load the live web app so that the Supabase session is stored
// under the nexus.lj-buchmiller.com origin and persists across app restarts.
// (file:// localStorage is less reliable due to Chromium origin isolation.)
const PRODUCTION_URL = 'https://nexus.lj-buchmiller.com';
const FRONTEND_URL = isDev ? 'http://localhost:5173' : PRODUCTION_URL;

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

// ── OAuth loopback server ─────────────────────────────────────────────────────
// Only one server at a time. We always use the same fixed port (54321) so the
// URL never changes and Supabase's whitelist entry stays stable.
// Tracking the instance lets us close a leftover server from a previous
// sign-in attempt before starting a fresh one.
let activeOAuthServer: http.Server | null = null;
const OAUTH_PORT = 54321;

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

  // ── OAuth redirect interception (dev only) ──────────────────────────────────
  // In dev the window loads from localhost:5173.  After Google OAuth the backend
  // redirects to nexus.lj-buchmiller.com — we intercept that navigation and
  // forward the query params back to the renderer so the app stays on localhost.
  //
  // In production the window already loads FROM nexus.lj-buchmiller.com, so
  // the OAuth redirect back to that host is just a normal same-origin navigation
  // handled naturally by App.tsx.  No interception needed.

  if (isDev) {
    win.webContents.on('will-navigate', (event, url) => {
      try {
        const parsed = new URL(url);
        if (parsed.hostname === PRODUCTION_HOST) {
          event.preventDefault();
          win.webContents.send('oauth-params', parsed.search);
        }
      } catch {
        // Malformed URL — ignore
      }
    });
  }

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

// Open a URL in the system default browser (Safari / Chrome / etc.)
ipcMain.handle('open-external-url', (_, url: string) => {
  shell.openExternal(url);
});

// ── RFC 8252 loopback OAuth server ────────────────────────────────────────────
// Google blocks sign-in inside embedded webviews. Instead we:
//   1. Spin up a temporary local HTTP server on port 54321 (falls back to any
//      free port if 54321 is occupied).
//   2. Use http://localhost:PORT/auth/callback as the OAuth redirect URI.
//   3. The renderer opens the Google auth URL in the system browser.
//   4. After the user signs in, the browser is redirected to localhost — our
//      server receives the PKCE code, sends it to the renderer via IPC, and
//      shows a "you can close this tab" page.
//
// Supabase redirect URL whitelist requirement:
//   Add  http://localhost:54321/auth/callback  to your Supabase project's
//   Authentication → URL Configuration → Redirect URLs.
//   (If port 54321 is unavailable, also add http://localhost:*/auth/callback)

ipcMain.handle('start-oauth-server', async (): Promise<number> => {
  // Close any leftover server from a previous attempt so port 54321 is always
  // free. This handles the case where the user clicked "Sign in" but the
  // browser redirected to the wrong URL — the server stayed alive on 54321
  // and the next attempt would have fallen back to a random (un-whitelisted) port.
  if (activeOAuthServer?.listening) {
    await new Promise<void>(resolve => activeOAuthServer!.close(() => resolve()));
    activeOAuthServer = null;
  }

  const server = await new Promise<http.Server>((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(OAUTH_PORT, '127.0.0.1', () => resolve(s));
  });

  activeOAuthServer = server;

  // Auto-close after 5 minutes if the user abandons the flow
  const closeTimer = setTimeout(() => {
    server.close();
    activeOAuthServer = null;
  }, 5 * 60 * 1000);

  function finish(code: string | null, error: string | null) {
    clearTimeout(closeTimer);
    server.close();
    activeOAuthServer = null;

    if (code && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deep-link', `nexus://auth/callback?code=${code}`);
      mainWindow.show();
      mainWindow.focus();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('oauth-cancelled');
    }
  }

  server.on('request', (req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://localhost:${OAUTH_PORT}`);
    const code   = reqUrl.searchParams.get('code');
    const error  = reqUrl.searchParams.get('error');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>NEXUS</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#e8e8f0;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  .card{text-align:center;max-width:340px}
  .icon{font-size:52px;margin-bottom:16px}
  h1{font-size:20px;margin:0 0 8px;font-weight:700}
  p{color:#7a7a90;font-size:14px;line-height:1.5}
</style></head><body>
<div class="card">
  <div class="icon">${code ? '✅' : '❌'}</div>
  <h1>${code ? "You're signed in to NEXUS" : 'Sign-in failed'}</h1>
  <p>${code
    ? 'Return to the NEXUS app — this tab will close automatically.'
    : `Error: ${error ?? 'Something went wrong. Please try again.'}`}</p>
</div>
<script>setTimeout(()=>window.close(),1800)</script>
</body></html>`);

    finish(code, error);
  });

  return OAUTH_PORT;
});

// Auto-update trigger from renderer
ipcMain.on('check-for-updates', () => {
  // setupUpdater handles this via autoUpdater
});

// Export for use in tray.ts / notifications.ts
export { mainWindow };
