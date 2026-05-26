const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let timerWindow = null;
let settingsWindow = null;
let isRebuildingWindow = false;

// Default settings
let currentSettings = {
  mode: 'circular',
  duration: 60,
  sound: true,
  zones: [
    { label: 'Exam Topper',     threshold: 75, color: '#27ae60' },
    { label: 'Exam Qualifier',  threshold: 50, color: '#f39c12' },
    { label: '50-50 Chance',    threshold: 25, color: '#e67e22' },
    { label: 'Need To Improve', threshold: 0,  color: '#e74c3c' }
  ]
};

function createTimerWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const isBar = currentSettings.mode === 'bar';

  const MIN_WINDOW_WIDTH = 460; // keep in sync with timer.js
  const BAR_CONTROLS_H   = 40;  // height reserved for the bar's controls row
  const dialSize = currentSettings.circularSize || 320;
  const stripH   = currentSettings.barHeight || 56;
  timerWindow = new BrowserWindow({
    width:  isBar ? screenWidth : Math.max(MIN_WINDOW_WIDTH, dialSize),
    height: isBar ? (stripH + BAR_CONTROLS_H) : (dialSize + 70),
    x: isBar ? 0 : 40,
    y: isBar ? 0 : 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  timerWindow.loadFile(path.join(__dirname, 'src/timer.html'));
  timerWindow.setAlwaysOnTop(true, 'screen-saver');

  timerWindow.on('closed', () => {
    timerWindow = null;
    // Only quit if we are NOT rebuilding the window
    if (!isRebuildingWindow) {
      app.quit();
    }
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 620,
    frame: true,
    resizable: false,
    alwaysOnTop: false,
    title: 'Timer Settings',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'src/settings.html'));

  // Send current settings once page is ready
  settingsWindow.webContents.on('did-finish-load', () => {
    settingsWindow.webContents.send('load-settings', currentSettings);
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (timerWindow) {
      timerWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });
}

// ── IPC Handlers ──

ipcMain.on('open-settings', () => {
  createSettingsWindow();
});

ipcMain.on('get-settings', (event) => {
  event.reply('apply-settings', currentSettings);
});

ipcMain.on('save-settings', (event, newSettings) => {
  const modeChanged = newSettings.mode !== currentSettings.mode;
  currentSettings = newSettings;

  // Close settings first
  if (settingsWindow) {
    settingsWindow.destroy();
    settingsWindow = null;
  }

  if (modeChanged) {
    // Flag so the closed event doesn't trigger app.quit()
    isRebuildingWindow = true;

    if (timerWindow) {
      timerWindow.destroy();
      timerWindow = null;
    }

    // Small delay to let destroy complete cleanly
    setTimeout(() => {
      isRebuildingWindow = false;
      createTimerWindow();
    }, 150);

  } else {
    // Same mode — just push new settings to timer
    if (timerWindow) {
      timerWindow.webContents.send('apply-settings', currentSettings);
    }
  }
});

ipcMain.on('cancel-settings', () => {
  if (settingsWindow) {
    settingsWindow.destroy();
    settingsWindow = null;
  }
});

ipcMain.on('switch-mode', (event, newSettings) => {
  currentSettings = newSettings;
  isRebuildingWindow = true;
  if (timerWindow) {
    timerWindow.destroy();
    timerWindow = null;
  }
  setTimeout(() => {
    isRebuildingWindow = false;
    createTimerWindow();
  }, 150);
});

ipcMain.on('resize-window', (event, { width, height }) => {
  if (timerWindow) {
    timerWindow.setSize(Math.round(width), Math.round(height));
  }
});

ipcMain.on('resize-bar-window', (event, { height }) => {
  if (timerWindow) {
    const BAR_CONTROLS_H = 40; // matches createTimerWindow
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    timerWindow.setSize(screenWidth, Math.round(height) + BAR_CONTROLS_H);
    timerWindow.setPosition(0, 0);
  }
});

ipcMain.on('exit-app', () => {
  isRebuildingWindow = false; // clear flag so quit isn't blocked
  if (settingsWindow) settingsWindow.destroy();
  if (timerWindow) timerWindow.destroy();
  app.exit(0); // force exit
});

app.whenReady().then(() => {
  createTimerWindow();
});

app.on('window-all-closed', () => {
  if (!isRebuildingWindow) {
    app.exit(0);
  }
});