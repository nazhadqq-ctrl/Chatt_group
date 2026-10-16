const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// Path to user config for saving server URL
const userDataPath = app.getPath('userData');
const configFilePath = path.join(userDataPath, 'chatflow-config.json');

function getServerUrl() {
  try {
    if (fs.existsSync(configFilePath)) {
      const data = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
      if (data && data.serverUrl) return data.serverUrl;
    }
  } catch (err) {
    console.error('Config read error:', err);
  }
  return 'http://62.201.232.190:3000';
}

function saveServerUrl(url) {
  try {
    fs.writeFileSync(configFilePath, JSON.stringify({ serverUrl: url }), 'utf8');
  } catch (err) {
    console.error('Config save error:', err);
  }
}

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let localServerProcess = null;

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
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true
    }
  });

  const serverUrl = getServerUrl();

  // Try to load server URL
  loadApp(serverUrl);

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

function loadApp(url) {
  mainWindow.loadURL(url).catch((err) => {
    console.log('Failed to load server URL, loading fallback screen:', err.message);
    mainWindow.loadFile(path.join(__dirname, 'public', 'offline.html'));
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL && !validatedURL.includes('offline.html')) {
      console.log('Load failed:', errorCode, errorDescription);
      mainWindow.loadFile(path.join(__dirname, 'public', 'offline.html'));
    }
  });
}

// IPC Handlers
ipcMain.handle('get-server-url', () => {
  return getServerUrl();
});

ipcMain.handle('set-server-url', (event, url) => {
  saveServerUrl(url);
  loadApp(url);
  return true;
});

ipcMain.handle('retry-connection', () => {
  const url = getServerUrl();
  loadApp(url);
  return true;
});

ipcMain.handle('start-local-server', async () => {
  try {
    if (!localServerProcess) {
      const { fork } = require('child_process');
      const serverScript = path.join(__dirname, 'server.js');
      localServerProcess = fork(serverScript, [], {
        cwd: __dirname,
        env: { ...process.env, PORT: '3000' }
      });
      // Wait 2 seconds for server to start
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    saveServerUrl('http://localhost:3000');
    loadApp('http://localhost:3000');
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// App Lifecycle
app.whenReady().then(() => {
  createWindow();

  // System Tray
  try {
    const iconPath = path.join(__dirname, 'public', 'icon.png');
    if (fs.existsSync(iconPath)) {
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        { label: '???????? ChatFlow', click: () => { mainWindow.show(); mainWindow.focus(); } },
        { label: '??????????? ?? ????????', click: () => { loadApp(getServerUrl()); } },
        { type: 'separator' },
        { label: '??????? ?? ??????', click: () => { app.isQuitting = true; app.quit(); } }
      ]);
      tray.setToolTip('ChatFlow Messenger');
      tray.setContextMenu(contextMenu);
      tray.on('double-click', () => {
        mainWindow.show();
        mainWindow.focus();
      });
    }
  } catch (err) {
    console.error('Tray creation error:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (localServerProcess) {
    localServerProcess.kill();
  }
});
