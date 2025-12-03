// main.js
// Demo-only: remote assist + window capture for a single BrowserWindow.
// NOTE: nodeIntegration/contextIsolation are relaxed here for simplicity.
// main.js
const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer
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

  console.log('desktopCapturer sources in main:', sources.map(s => s.name));

  const src = sources.find(s => s.name.includes('Electron Remote Assist Demo'));
  return src ? src.id : null;
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

  // For a normal framed window, content.y is usually win.y + titlebarHeight
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
    // Mouse path – unchanged
    mainWindow.webContents.sendInputEvent({
      type: data.subtype,        // 'mouseDown', 'mouseUp', 'mouseMove'
      x: Math.round(data.x),
      y: Math.round(data.y),
      button: data.button || 'left',
      clickCount: 1
    });

  } 
});

// Mouse injection (content coordinates)
function handleRemoteMouse(win, data) {
  const { subtype, x, y, button } = data;

  const mouseEvent = {
    type: subtype,            // 'mouseDown' | 'mouseUp' | 'mouseMove'
    x: Math.round(x),
    y: Math.round(y),
    button: button || 'left',
    clickCount: 1
  };

  console.log('MAIN injecting mouse event:', mouseEvent);
  win.webContents.sendInputEvent(mouseEvent);
}

// Keyboard injection
function handleRemoteKeyboard(win, ev) {
  console.log('MAIN injecting keyboard event:', ev);

  // Build Electron-style modifiers array
  const modifiers = [];
  if (ev.altKey)   modifiers.push('alt');
  if (ev.shiftKey) modifiers.push('shift');
  if (ev.ctrlKey)  modifiers.push('control');
  if (ev.metaKey)  modifiers.push('meta');

  // Map DOM key → Electron keyCode
  let keyCode;

  if (ev.key && ev.key.length === 1) {
    // Single character: 'a', 'A', '1', etc.
    keyCode = ev.key;
  } else {
    // Some common non-character keys
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

    keyCode = map[ev.key] || ev.key || ev.code || '';
  }

  // Inject keyDown / keyUp
  win.webContents.sendInputEvent({
    type: ev.subtype,     // 'keyDown' or 'keyUp'
    keyCode,
    modifiers
  });
}