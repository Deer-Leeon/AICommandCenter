import { Notification, BrowserWindow } from 'electron';
import * as path from 'path';

const ICON_PATH = path.join(__dirname, 'build/icon.png');

export function sendNotification(
  title: string,
  body: string,
  widgetType: string | undefined,
  mainWindow: BrowserWindow | null,
): void {
  if (!Notification.isSupported()) return;

  const notif = new Notification({
    title,
    body,
    icon: ICON_PATH,
    silent: false,
  });

  notif.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    if (widgetType) {
      mainWindow.webContents.send('notification-click', { widgetType });
    }
  });

  notif.show();
}

// ── Convenience helpers ───────────────────────────────────────────────────────

export function notifyPomodoro(
  type: 'focus-complete' | 'break-complete',
  mainWindow: BrowserWindow | null,
): void {
  if (type === 'focus-complete') {
    sendNotification('Focus session complete 🎯', 'Take a well-earned break.', 'pomodoro', mainWindow);
  } else {
    sendNotification('Break over ⚡', 'Ready to focus again?', 'pomodoro', mainWindow);
  }
}

export function notifyCalendar(
  eventName: string,
  minutesUntil: number,
  mainWindow: BrowserWindow | null,
): void {
  sendNotification(
    'Upcoming event',
    `${eventName} starts in ${minutesUntil} minute${minutesUntil === 1 ? '' : 's'}`,
    'calendar',
    mainWindow,
  );
}

export function notifySharedPhoto(
  uploaderUsername: string,
  mainWindow: BrowserWindow | null,
): void {
  sendNotification(
    'New photo',
    `@${uploaderUsername} just shared a photo`,
    'shared_photo',
    mainWindow,
  );
}

export function notifyConnectionInvite(
  fromUsername: string,
  mainWindow: BrowserWindow | null,
): void {
  sendNotification(
    'Connection invite',
    `@${fromUsername} wants to connect on NEXUS`,
    undefined,
    mainWindow,
  );
}

export function notifyChessMove(
  fromUsername: string,
  mainWindow: BrowserWindow | null,
): void {
  sendNotification(
    'Your turn',
    `@${fromUsername} made a move`,
    'shared_chess',
    mainWindow,
  );
}
