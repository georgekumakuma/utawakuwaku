const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const express = require('express');

const serverApp = express();
const publicDir = path.join(__dirname);
serverApp.use(express.static(publicDir));
const SERVER_PORT = 3000;

serverApp.listen(SERVER_PORT, () => {
  console.log(`Express server running at http://localhost:${SERVER_PORT}`);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 720,
    height: 1080,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon.png')
  });

  // ★ サブメニュー非表示
  Menu.setApplicationMenu(null);

  win.loadURL(`http://localhost:${SERVER_PORT}/index.html`);

  // DevTools: open only when explicitly enabled (keeps production UX unchanged)
  // Enable via: UWK_DEVTOOLS=1
  const shouldOpenDevTools =
    process.env.UWK_DEVTOOLS === '1' ||
    process.env.UWK_DEVTOOLS === 'true' ||
    (!app.isPackaged && process.env.NODE_ENV !== 'production');

  if (shouldOpenDevTools) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
