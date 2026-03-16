import { app, Menu, shell, BrowserWindow } from 'electron';

export function buildMenu(mainWindow: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    // ── App menu ─────────────────────────────────────────────────────────────
    {
      label: app.name, // "NEXUS"
      submenu: [
        {
          label: `About ${app.name}`,
          role: 'about',
        },
        {
          label: 'Check for Updates…',
          click: () => mainWindow.webContents.send('check-for-updates-menu'),
        },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'Cmd+,',
          click: () => mainWindow.webContents.send('open-settings'),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },

    // ── File ─────────────────────────────────────────────────────────────────
    {
      label: 'File',
      submenu: [
        {
          label: 'New Page',
          accelerator: 'Cmd+T',
          click: () => mainWindow.webContents.send('new-page'),
        },
        {
          label: 'Close Window',
          accelerator: 'Cmd+W',
          click: () => mainWindow.close(),
        },
      ],
    },

    // ── Edit ─────────────────────────────────────────────────────────────────
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    // ── View ─────────────────────────────────────────────────────────────────
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'Cmd+R',
          click: () => mainWindow.webContents.reload(),
        },
        {
          label: 'Toggle Full Screen',
          accelerator: 'Ctrl+Cmd+F',
          click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()),
        },
        { type: 'separator' },
        {
          label: 'Next Page',
          accelerator: 'Cmd+]',
          click: () => mainWindow.webContents.send('next-page'),
        },
        {
          label: 'Previous Page',
          accelerator: 'Cmd+[',
          click: () => mainWindow.webContents.send('prev-page'),
        },
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'Cmd+0',
          click: () => mainWindow.webContents.setZoomLevel(0),
        },
        {
          label: 'Zoom In',
          accelerator: 'Cmd+Plus',
          click: () => {
            const current = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(Math.min(current + 0.5, 3));
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'Cmd+-',
          click: () => {
            const current = mainWindow.webContents.getZoomLevel();
            mainWindow.webContents.setZoomLevel(Math.max(current - 0.5, -2));
          },
        },
      ],
    },

    // ── Window ────────────────────────────────────────────────────────────────
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },

    // ── Help ──────────────────────────────────────────────────────────────────
    {
      role: 'help',
      submenu: [
        {
          label: 'NEXUS Help',
          click: () =>
            shell.openExternal('https://nexus.lj-buchmiller.com'),
        },
        {
          label: 'Report a Bug',
          click: () =>
            shell.openExternal(
              'https://github.com/Deer-Leeon/AICommandCenter/issues/new'
            ),
        },
        { type: 'separator' },
        {
          label: 'Visit nexus.lj-buchmiller.com',
          click: () =>
            shell.openExternal('https://nexus.lj-buchmiller.com'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
