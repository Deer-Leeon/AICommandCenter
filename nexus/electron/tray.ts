import { Tray, BrowserWindow, app, screen, nativeImage } from 'electron';
import * as path from 'path';

const isDev = process.env.NODE_ENV === 'development';

// The tray panel URL — hash route rendered by TrayApp.tsx
const TRAY_URL = isDev
  ? 'http://localhost:5173/#/tray'
  : `file://${path.join(process.resourcesPath, 'frontend/dist/index.html')}#/tray`;

const TRAY_WIDTH  = 320;
const TRAY_HEIGHT = 440;

let tray: Tray | null = null;
let trayWindow: BrowserWindow | null = null;

function createTrayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: TRAY_WIDTH,
    height: TRAY_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Rounded corners + frosted glass
    vibrancy: 'popover',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.loadURL(TRAY_URL).catch(console.error);

  // Dismiss on blur (clicking outside)
  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible()) {
      win.hide();
    }
  });

  return win;
}

function positionTrayWindow(win: BrowserWindow): void {
  if (!tray) return;

  const trayBounds = tray.getBounds();
  const displayBounds = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  }).workArea;

  // Center horizontally on the tray icon, position below it
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - TRAY_WIDTH / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 4);

  // Keep within screen bounds
  x = Math.max(displayBounds.x + 8, Math.min(x, displayBounds.x + displayBounds.width - TRAY_WIDTH - 8));
  y = Math.min(y, displayBounds.y + displayBounds.height - TRAY_HEIGHT - 8);

  win.setPosition(x, y, false);
}

function toggleTrayWindow(): void {
  if (!trayWindow || trayWindow.isDestroyed()) {
    trayWindow = createTrayWindow();
  }

  if (trayWindow.isVisible()) {
    trayWindow.hide();
  } else {
    positionTrayWindow(trayWindow);
    trayWindow.show();
    trayWindow.focus();
  }
}

export function setupTray(mainWindow: BrowserWindow): void {
  // Load template image (monochrome, adapts to light/dark menu bar)
  const iconPath = path.join(__dirname, 'build/iconTemplate.png');

  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    // Fallback: create an empty 22×22 image if the file doesn't exist yet
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('NEXUS');

  // Click: toggle the popover panel
  tray.on('click', () => toggleTrayWindow());
  tray.on('right-click', () => toggleTrayWindow());

  // Context menu on right-click (macOS also supports double-click)
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Expose a way for the tray renderer to open the main window
  // (handled via IPC in main.ts → ipcMain.on('open-main-window'))
}

export function hideTrayWindow(): void {
  trayWindow?.hide();
}
