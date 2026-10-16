const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow = null;
let tray = null;

// Function to check if local server is listening
function checkServer(port = 3000) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Function to start server in-process if not already running
async function ensureServerRunning() {
  const isRunning = await checkServer(3000);
  if (!isRunning) {
    console.log('Starting internal server...');
    try {
      require('./server.js');
      // Wait up to 10 seconds for server to be responsive
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const ready = await checkServer(3000);
        if (ready) {
          console.log('Server is ready on port 3000');
          break;
        }
      }
    } catch (err) {
      console.error('Error starting internal server:', err);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 600,
    title: 'ChatFlow - Messenger',
    backgroundColor: '#0F0E17',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'public', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true
    }
  });

  // Load the login screen directly from local server
  mainWindow.loadURL('http://localhost:3000').catch((err) => {
    console.error('Failed to load localhost:3000:', err);
    mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links safely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    await ensureServerRunning();
    createWindow();

    // Tray
    try {
      const iconPath = path.join(__dirname, 'public', 'icon.png');
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        { label: 'کردنەوەی ChatFlow', click: () => { mainWindow.show(); mainWindow.focus(); } },
        { type: 'separator' },
        { label: 'دەرچوون', click: () => { app.isQuitting = true; app.quit(); } }
      ]);
      tray.setToolTip('ChatFlow Messenger');
      tray.setContextMenu(contextMenu);
      tray.on('double-click', () => {
        mainWindow.show();
        mainWindow.focus();
      });
    } catch (err) {
      console.log('Tray setup skipped:', err.message);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
  });
}