// main.js
// Demo-only: remote assist + window capture for a single BrowserWindow.
// NOTE: nodeIntegration/contextIsolation are relaxed here for simplicity.

const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen
} = require('electron');

const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Electron Remote Assist Demo',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,   // demo-only
      contextIsolation: false  // demo-only
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// -----------------------------------------
// IPC: window / content geometry + capture
// -----------------------------------------

// Used by renderer to find this window's desktopCapturer source
ipcMain.handle('get-app-window-source-id', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 400, height: 300 }
  });

  console.log('desktopCapturer window sources:', sources.map(s => s.name));

  const src = sources.find(s => s.name.includes('Electron Remote Assist Demo'));
  return src ? src.id : null;
});

// OLD: returns first screen source (not safe for multi-monitor)
// Keeping it for reference, but you should use get-desktop-source-for-window instead.
ipcMain.handle('get-desktop-source-id', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 400, height: 300 }
  });
  const primaryScreen = sources[0];
  return primaryScreen ? primaryScreen.id : null;
});

// ✅ NEW: choose the screen source that matches the display where this window lives
ipcMain.handle('get-desktop-source-for-window', async () => {
  if (!mainWindow) return null;

  const winBounds = mainWindow.getBounds(); // DIP
  const display = screen.getDisplayMatching(winBounds);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 400, height: 300 }
  });

  // Electron provides source.display_id for screen sources (string)
  // screen.getDisplayMatching provides display.id (number)
  const displayIdStr = String(display.id);

  const matching = sources.find(s => s.display_id === displayIdStr) || null;

  console.log('get-desktop-source-for-window:',
    'display.id=', display.id,
    'scaleFactor=', display.scaleFactor,
    'bounds=', display.bounds,
    'matchedSource=', matching ? { id: matching.id, name: matching.name, display_id: matching.display_id } : null
  );

  if (!matching) {
    // fallback: primary
    const fallback = sources[0] || null;
    return fallback ? {
      sourceId: fallback.id,
      scaleFactor: display.scaleFactor || 1,
      bounds: display.bounds
    } : null;
  }

  return {
    sourceId: matching.id,
    scaleFactor: display.scaleFactor || 1,
    bounds: display.bounds // DIP global origin of that display
  };
});

// Full window bounds (what the captured video shows)
ipcMain.handle('get-window-bounds', () => {
  if (!mainWindow) return { width: 0, height: 0, x: 0, y: 0 };
  const b = mainWindow.getBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
});

// Content bounds (what sendInputEvent uses)
ipcMain.handle('get-content-bounds', () => {
  if (!mainWindow) return { width: 0, height: 0, x: 0, y: 0 };
  const b = mainWindow.getContentBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height };
});

// Offset between window top and content top (titlebar height etc.)
ipcMain.handle('get-window-offset', () => {
  if (!mainWindow) return { offsetTop: 0 };

  const win = mainWindow.getBounds();
  const content = mainWindow.getContentBounds();

  const offsetTop = content.y - win.y;
  return { offsetTop };
});

// Focus helper
ipcMain.on('focus-window', () => {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
});

// -----------------------------------------
// Remote control events from renderer
// -----------------------------------------
ipcMain.on('remote-control-event', (event, data) => {
  if (!mainWindow) return;

  if (data.type === 'mouse') {
    if (data.subtype === 'mouseWheel') {
      const x = Math.round(data.x || 0);
      const y = Math.round(data.y || 0);

      const deltaX = data.deltaX || 0;
      const deltaY = data.deltaY || 0;

      const wheelEvent = {
        type: 'mouseWheel',
        x,
        y,
        deltaX,
        deltaY,
        wheelTicksX: deltaX,
        wheelTicksY: deltaY,
        accelerationRatioX: 1,
        accelerationRatioY: 1,
        hasPreciseScrollingDeltas: true,
        canScroll: true
      };

      mainWindow.webContents.sendInputEvent(wheelEvent);
      return;
    }

    // normal mouse events
    mainWindow.webContents.sendInputEvent({
      type: data.subtype, // mouseDown/mouseUp/mouseMove
      x: Math.round(data.x),
      y: Math.round(data.y),
      button: data.button || 'left',
      clickCount: 1
    });
    return;
  }

  if (data.type === 'keyboard') {
    const modifiers = [];
    if (data.altKey) modifiers.push('alt');
    if (data.shiftKey) modifiers.push('shift');
    if (data.ctrlKey) modifiers.push('control');
    if (data.metaKey) modifiers.push('meta');

    let keyCode;
    if (data.key && data.key.length === 1) keyCode = data.key;
    else {
      const map = {
        Enter: 'Enter',
        Backspace: 'Backspace',
        Tab: 'Tab',
        Escape: 'Escape',
        ArrowUp: 'Up',
        ArrowDown: 'Down',
        ArrowLeft: 'Left',
        ArrowRight: 'Right',
        Delete: 'Delete',
        Home: 'Home',
        End: 'End',
        PageUp: 'PageUp',
        PageDown: 'PageDown'
      };
      keyCode = map[data.key] || data.key || data.code || '';
    }

    mainWindow.webContents.sendInputEvent({
      type: data.subtype, // keyDown/keyUp
      keyCode,
      modifiers
    });
    return;
  }
});