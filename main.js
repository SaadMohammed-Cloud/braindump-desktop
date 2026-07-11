const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, nativeImage, ipcMain } = require('electron');
const path = require('path');

const WINDOW_WIDTH = 350;
const WINDOW_HEIGHT = 450;
const BUBBLE_SIZE = 64;

let mainWindow = null;
let tray = null;
let isQuitting = false;

function getTopRightPosition(width, height) {
  const display = screen.getPrimaryDisplay();
  const { x, y, width: screenWidth } = display.workArea;
  const margin = 20;
  return {
    x: Math.round(x + screenWidth - width - margin),
    y: Math.round(y + margin),
  };
}

function createWindow() {
  const { x, y } = getTopRightPosition(WINDOW_WIDTH, WINDOW_HEIGHT);

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x,
    y,
    minWidth: 260,
    minHeight: 200,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    vibrancy: 'sidebar', // macOS glass/vibrancy effect
    visualEffectState: 'active',
    roundedCorners: true,
    webPreferences: {
      // This window only ever loads our own local index.html (no remote
      // content), so nodeIntegration is safe here and lets renderer.js
      // `require()` the Supabase client and config directly.
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Keep the window above everything, including fullscreen apps & the dock.
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Hide instead of close when the user clicks the close/hide button or the
  // window's native close is triggered, unless we're actually quitting.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'trayIconTemplate.png');
  const trayIcon = nativeImage.createFromPath(iconPath);
  trayIcon.setTemplateImage(true);

  tray = new Tray(trayIcon);
  tray.setToolTip('Braindump');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide Braindump',
      accelerator: 'Cmd+Shift+N',
      click: () => toggleWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => toggleWindow());
}

// --- IPC handlers for window chrome controls driven from the renderer ---

ipcMain.on('window:hide', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.on('window:minimize-to-bubble', () => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const display = screen.getPrimaryDisplay();
  const { x: workX, y: workY } = display.workArea;
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(BUBBLE_SIZE, BUBBLE_SIZE);
  mainWindow.setBounds({
    x: bounds.x,
    y: Math.max(workY, bounds.y),
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
  });
});

ipcMain.on('window:restore-from-bubble', () => {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  mainWindow.setMinimumSize(260, 200);
  mainWindow.setBounds({
    x: bounds.x - (WINDOW_WIDTH - bounds.width),
    y: bounds.y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  });
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  }

  createWindow();
  createTray();

  const registered = globalShortcut.register('Command+Shift+N', () => {
    toggleWindow();
  });

  if (!registered) {
    console.error('Failed to register global shortcut Cmd+Shift+N');
  }

  app.on('activate', () => {
    if (!mainWindow) createWindow();
    else toggleWindow();
  });
});

app.on('window-all-closed', (event) => {
  // Keep running in the tray on macOS even if the window is closed.
  event.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
