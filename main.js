const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, nativeImage, ipcMain } = require('electron');
const path = require('path');

const NOTE_WINDOW_WIDTH = 350;
const NOTE_WINDOW_HEIGHT = 450;
const BUBBLE_SIZE = 64;

const DASHBOARD_WIDTH = 1400;
const DASHBOARD_HEIGHT = 900;
const DASHBOARD_URL = 'http://localhost:3000/dashboard';

let mainWindow = null; // full web dashboard — normal, resizable app window
let noteWindow = null; // floating always-on-top quick-note widget
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

function getServerDownErrorUrl() {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Braindump</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1e1e1e;
        color: #eee;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .card { text-align: center; max-width: 440px; padding: 32px; }
      h1 { font-size: 20px; margin-bottom: 12px; }
      p { color: #aaa; line-height: 1.5; }
      code {
        background: #2d2d2d;
        padding: 2px 6px;
        border-radius: 4px;
        color: #7ee787;
      }
      button {
        margin-top: 20px;
        padding: 8px 18px;
        border-radius: 6px;
        border: none;
        background: #4f7cff;
        color: white;
        font-size: 14px;
        cursor: pointer;
      }
      button:hover { background: #3f66db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Braindump server not running</h1>
      <p>Please start the web app with <code>npm run dev</code>, then retry.</p>
      <button onclick="window.location.href='${DASHBOARD_URL}'">Retry</button>
    </div>
  </body>
</html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: DASHBOARD_WIDTH,
    height: DASHBOARD_HEIGHT,
    minWidth: 900,
    minHeight: 600,
    center: true,
    title: 'Braindump',
    frame: true,
    resizable: true,
    alwaysOnTop: false,
    show: false,
    webPreferences: {
      // This window loads remote content from the local dev server, so it
      // must not have Node access.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(DASHBOARD_URL);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED, e.g. a deliberate navigation/retry
    mainWindow.loadURL(getServerDownErrorUrl());
  });

  // Clerk's OAuth flow (e.g. "Continue with Google") bounces the top-level
  // window back to the site root after a successful sign-in before our own
  // client-side redirect to /dashboard has a chance to run. Since this
  // window only ever hosts the signed-in dashboard or the sign-in page,
  // landing back on root here means the login just completed — send it on
  // to the dashboard instead of leaving the user stuck on the landing page.
  const redirectRootToDashboard = (_event, url) => {
    if (url === 'http://localhost:3000/' || url === 'http://localhost:3000') {
      mainWindow.loadURL(DASHBOARD_URL);
    }
  };
  mainWindow.webContents.on('did-navigate', redirectRootToDashboard);
  mainWindow.webContents.on('did-navigate-in-page', redirectRootToDashboard);

  // Allow OAuth popups (Google sign-in, Clerk's own auth domains) to open in
  // a new window instead of being blocked; deny everything else.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { hostname } = new URL(url);
      const isGoogleAuth = hostname === 'accounts.google.com';
      const isClerk = hostname === 'clerk.com' || hostname.endsWith('.clerk.com') || hostname.endsWith('.clerk.accounts.dev');
      if (isGoogleAuth || isClerk) {
        return { action: 'allow' };
      }
    } catch (_err) {
      // Malformed URL — fall through to deny.
    }
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Keep running in the tray instead of destroying the window on close.
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

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createNoteWindow() {
  const { x, y } = getTopRightPosition(NOTE_WINDOW_WIDTH, NOTE_WINDOW_HEIGHT);

  noteWindow = new BrowserWindow({
    width: NOTE_WINDOW_WIDTH,
    height: NOTE_WINDOW_HEIGHT,
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
  noteWindow.setAlwaysOnTop(true, 'screen-saver');
  noteWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  noteWindow.loadFile('index.html');

  noteWindow.once('ready-to-show', () => {
    noteWindow.show();
  });

  // Hide instead of close when the user clicks the close/hide button or the
  // window's native close is triggered, unless we're actually quitting.
  noteWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      noteWindow.hide();
    }
  });

  noteWindow.on('closed', () => {
    noteWindow = null;
  });
}

function toggleNoteWindow() {
  if (!noteWindow) {
    createNoteWindow();
    return;
  }
  if (noteWindow.isVisible()) {
    noteWindow.hide();
  } else {
    noteWindow.show();
    noteWindow.focus();
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
      label: 'Open Braindump',
      accelerator: 'Cmd+Shift+D',
      click: () => showMainWindow(),
    },
    {
      label: 'Quick Note',
      accelerator: 'Cmd+Shift+N',
      click: () => toggleNoteWindow(),
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
  tray.on('click', () => showMainWindow());
}

// --- IPC handlers for window chrome controls driven from the renderer ---
// These apply to the floating quick-note widget.

ipcMain.on('window:hide', () => {
  if (noteWindow) noteWindow.hide();
});

ipcMain.on('window:minimize-to-bubble', () => {
  if (!noteWindow) return;
  const bounds = noteWindow.getBounds();
  const display = screen.getPrimaryDisplay();
  const { x: workX, y: workY } = display.workArea;
  noteWindow.setResizable(true);
  noteWindow.setMinimumSize(BUBBLE_SIZE, BUBBLE_SIZE);
  noteWindow.setBounds({
    x: bounds.x,
    y: Math.max(workY, bounds.y),
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
  });
});

ipcMain.on('window:restore-from-bubble', () => {
  if (!noteWindow) return;
  const bounds = noteWindow.getBounds();
  noteWindow.setMinimumSize(260, 200);
  noteWindow.setBounds({
    x: bounds.x - (NOTE_WINDOW_WIDTH - bounds.width),
    y: bounds.y,
    width: NOTE_WINDOW_WIDTH,
    height: NOTE_WINDOW_HEIGHT,
  });
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  }

  // Open the main dashboard window by default; the floating note widget is
  // created lazily on first use (tray menu or Cmd+Shift+N).
  createMainWindow();
  createTray();

  const dashboardShortcutRegistered = globalShortcut.register('Command+Shift+D', () => {
    toggleMainWindow();
  });
  if (!dashboardShortcutRegistered) {
    console.error('Failed to register global shortcut Cmd+Shift+D');
  }

  const noteShortcutRegistered = globalShortcut.register('Command+Shift+N', () => {
    toggleNoteWindow();
  });
  if (!noteShortcutRegistered) {
    console.error('Failed to register global shortcut Cmd+Shift+N');
  }

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
    else showMainWindow();
  });
});

app.on('window-all-closed', (event) => {
  // Keep running in the tray on macOS even if both windows are closed.
  event.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
