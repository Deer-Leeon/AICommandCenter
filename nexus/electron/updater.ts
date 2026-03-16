import { BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function setupUpdater(mainWindow: BrowserWindow): void {
  // Suppress the default dialog — we show our own in-app banner
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (_info) => {
    mainWindow.webContents.send('update-available');
  });

  autoUpdater.on('update-downloaded', (_info) => {
    mainWindow.webContents.send('update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    // Silently log — don't surface update errors to the user unless needed
    console.warn('[NEXUS updater]', err.message);
  });

  // Check on launch (small delay so the window can fully load first)
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 5000);

  // Check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, UPDATE_INTERVAL_MS);

  // Allow renderer to trigger a manual check
  ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  });

  // Restart and install when the user clicks "Restart" in the in-app banner
  ipcMain.on('restart-and-install', () => {
    autoUpdater.quitAndInstall(false, true);
  });
}
