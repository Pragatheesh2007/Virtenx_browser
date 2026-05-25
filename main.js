const { app, BrowserWindow } = require('electron');
const { updateElectronApp } = require('update-electron-app');

// Initialize the auto-updater (Must be called before app.whenReady)
updateElectronApp();
if (require('electron-squirrel-startup')) {
  return; // Quits the app immediately during startup events so the installer can do its job
}
  
const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut, shell, dialog } = require('electron');
const path = require('path'); 
const fs = require('fs'); 

let win;
let tabs = {}; 
let currentTabId = 0;
let isSidebarOpen = false;
let isDownloadPopupOpen = false;
let activeDownloads = new Set();

const UI_HEIGHT = 83; 
const SIDEBAR_WIDTH = 260;

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

let settings = {
  downloadPath: app.getPath('downloads'),
  askEverytime: false,
  showFinished: true,
  memorySaver: true,
  memoryLevel: 'balanced',
  energySaver: true,
  energyMode: 'battery',
  autofillPrivate: true,
  passwords: []
};

function loadSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      settings = { ...settings, ...JSON.parse(data) };
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// Initial load
loadSettings();

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,             
    titleBarStyle: 'hidden',  
    autoHideMenuBar: true,
    backgroundColor: '#35363a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: true
    }
  });

  win.loadFile('index.html');

  // Ensure UI is always on top (handled by z-index in index.html mainly)
  win.webContents.on('dom-ready', () => {
    // Rely on index.html z-index
  });

  win.on('close', (e) => {
    if (activeDownloads.size > 0) {
      e.preventDefault();
      win.webContents.send('confirm-close-download');
    }
  });

  win.on('resize', () => {
    if (tabs[currentTabId]) updateViewBounds(tabs[currentTabId].view);
  });
}



function createTab(id, isPrivate = false, targetWin = win) {
  const view = new BrowserView({
    webPreferences: {
      partition: isPrivate ? `private_${Date.now()}` : 'persist:main',
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  tabs[id] = { view, isPrivate, targetWin };
  
  view.webContents.on('did-navigate', (event, url) => {
    if (!isPrivate && !url.startsWith('file://')) {
      const historyPath = path.join(__dirname, 'history.html');
      const timestamp = new Date().toLocaleString();
      const title = view.webContents.getTitle() || url;
      const entry = `<div class="entry"><span class="time">${timestamp}</span><a href="${url}" class="link">${title}</a></div>\n`;
      fs.appendFile(historyPath, entry, (err) => { if (err) console.error(err); });
    }
    targetWin.webContents.send('url-changed', { id, url });
  });

  view.webContents.on('page-favicon-updated', (event, favicons) => {
    if (favicons && favicons.length > 0) {
      targetWin.webContents.send('favicon-changed', { id, favUrl: favicons[0] });
    }
  });

  view.webContents.on('did-start-loading', () => {
    targetWin.webContents.send('loading-state', { id, isLoading: true });
  });

  view.webContents.on('did-stop-loading', () => {
    targetWin.webContents.send('loading-state', { id, isLoading: false });
  });

  view.webContents.on('did-navigate-in-page', (event, url) => {
    targetWin.webContents.send('url-changed', { id, url });
  });

  view.webContents.session.on('will-download', (event, item, webContents) => {
    const fileName = item.getFilename();
    const url = item.getURL();
    const timestamp = new Date().toLocaleString();
    const downloadPath = path.join(settings.downloadPath, fileName);
    
    if (settings.askEverytime) {
      // User will be prompted by Electron's default dialog behavior if savePath is not set immediately
    } else {
      item.setSavePath(downloadPath);
    }
    activeDownloads.add(item);

    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const progress = total > 0 ? (received / total) : 0;
        
        // Simple ETA calculation
        // item.getLastModifiedTime() is not for ETA. Electron's DownloadItem doesn't have native ETA.
        // We'll send raw data to frontend.
        // Broadcast to ALL windows so every tab's popup stays synced
        BrowserWindow.getAllWindows().forEach(w => {
          w.webContents.send('download-progress', {
            id: item.getStartTime(),
            fileName,
            received,
            total,
            progress,
            state,
            startTime: item.getStartTime(),
            savePath: downloadPath
          });
        });
      }
    });

    item.once('done', (event, state) => {
      activeDownloads.delete(item);
      BrowserWindow.getAllWindows().forEach(w => {
        w.webContents.send('download-progress', {
          id: item.getStartTime(),
          state: 'completed'
        });
      });
      if (state === 'completed') {
        const downloadsPath = path.join(__dirname, 'downloads.html');
        // Ensure the file exists with a basic template if it doesn't
        if (!fs.existsSync(downloadsPath)) {
          const initTemplate = `<!DOCTYPE html><html><head><style>
            body { background: #202124; color: #e8eaed; font-family: 'Segoe UI', sans-serif; padding: 40px; max-width: 800px; margin: auto; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #3c4043; padding-bottom: 20px; margin-bottom: 20px; }
            h1 { margin: 0; font-weight: 400; }
            .clear-btn { background: #3c4043; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; }
            .clear-btn:hover { background: #4b4f53; }
            .entry { padding: 15px; border-bottom: 1px solid #3c4043; display: flex; flex-direction: column; cursor: pointer; transition: background 0.2s; border-radius: 8px; margin-bottom: 5px; position: relative; }
            .entry:hover { background: #292a2d; }
            .name { color: #8ab4f8; font-size: 16px; margin-bottom: 5px; font-weight: 500; }
            .info { color: #9aa0a6; font-size: 12px; }
            .progress-container { width: 100%; height: 4px; background: #3c4043; border-radius: 2px; margin-top: 10px; display: none; }
            .progress-bar { height: 100%; background: #8ab4f8; border-radius: 2px; width: 0%; transition: width 0.3s; }
            .status { font-size: 11px; margin-top: 5px; color: #9aa0a6; }
          </style></head><body>
          <div class="header"><h1>Downloads</h1><button class="clear-btn" onclick="clearAll()">Clear List</button></div>
          <div id="list"></div>
          <script>
            function openFile(path) { window.electronAPI.showItemInFolder(path); }
            function clearAll() { if(confirm("Clear download history?")) window.electronAPI.clearDownloads(); }
            window.electronAPI.onDownloadProgress((data) => {
                let item = document.getElementById('dl-' + data.id);
                if (!item && data.state !== 'completed') {
                    item = document.createElement('div');
                    item.id = 'dl-' + data.id;
                    item.className = 'entry';
                    item.innerHTML = '<span class="name">' + data.fileName + '</span><span class="info">' + data.state + '</span><div class="progress-container" style="display:block"><div class="progress-bar"></div></div><div class="status"></div>';
                    document.getElementById('list').prepend(item);
                }
                if (item) {
                    if (data.state === 'completed') { window.location.reload(); return; }
                    const bar = item.querySelector('.progress-bar');
                    const status = item.querySelector('.status');
                    bar.style.width = (data.progress * 100) + '%';
                    let eta = "";
                    if (data.progress > 0 && data.progress < 1) {
                        const elapsed = (Date.now() / 1000) - data.startTime;
                        const speed = data.received / elapsed;
                        const remaining = data.total - data.received;
                        const secondsLeft = Math.round(remaining / speed);
                        if (isFinite(secondsLeft)) {
                            const mins = Math.floor(secondsLeft / 60);
                            const secs = secondsLeft % 60;
                            eta = " - " + (mins > 0 ? mins + "m " : "") + secs + "s remaining";
                        }
                    }
                    status.innerText = Math.round(data.progress * 100) + '% - ' + (data.received / (1024*1024)).toFixed(1) + 'MB / ' + (data.total / (1024*1024)).toFixed(1) + 'MB' + eta;
                }
            });
          </script></body></html>`;
          fs.writeFileSync(downloadsPath, initTemplate);
        }

        const entry = `<div class="entry" onclick="openFile('${downloadPath.replace(/\\/g, '\\\\')}')">
          <span class="name">${fileName}</span>
          <span class="info">${timestamp} - ${url}</span>
        </div>\n`;
        
        // Simple way to append to the list in our static HTML
        let content = fs.readFileSync(downloadsPath, 'utf8');
        if (content.includes('<div id="list">')) {
          content = content.replace('<div id="list">', '<div id="list">\n' + entry);
          fs.writeFileSync(downloadsPath, content);
        } else {
          fs.appendFile(downloadsPath, entry, (err) => { if (err) console.error(err); });
        }
      }
    });
  });

  return view;
}

function createPrivateWindow() {
  const privateWin = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#35363a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  privateWin.loadFile('index.html');

  // Ensure UI is on top
  privateWin.webContents.on('dom-ready', () => {
    // Rely on index.html z-index
  });
  
  privateWin.on('close', (e) => {
    if (activeDownloads.size > 0) {
      e.preventDefault();
      privateWin.webContents.send('confirm-close-download');
    }
  });

  // Tag this window as starting in private mode
  privateWin.webContents.on('did-finish-load', () => {
    privateWin.webContents.send('init-private-mode');
  });

  return privateWin;
}

function updateViewBoundsForWindow(view, targetWin) {
  if (!view || !targetWin) return;
  const bounds = targetWin.getContentBounds();
  
  // When the sidebar is open, we shrink the web view width by 260px.
  // When the download popup is open, we shrink the height or move the view down.
  // This physically moves the website content out of the way so the UI stays visible.
  const sidebarOffset = isSidebarOpen ? SIDEBAR_WIDTH : 0;
  const popupPadding = isDownloadPopupOpen ? 420 : 0; // The max height of the popup list
  
  view.setBounds({ 
    x: 0, 
    y: UI_HEIGHT, 
    width: bounds.width - sidebarOffset, 
    height: bounds.height - UI_HEIGHT 
  });
  view.setAutoResize({ width: true, height: true });
}

function updateViewBounds(view) {
  updateViewBoundsForWindow(view, win);
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+T', () => { win.webContents.send('execute-shortcut', 'new-tab'); });
  globalShortcut.register('CommandOrControl+W', () => { win.webContents.send('execute-shortcut', 'close-tab'); });
  globalShortcut.register('CommandOrControl+L', () => { win.webContents.send('execute-shortcut', 'focus-url'); });
  globalShortcut.register('CommandOrControl+R', () => { if (tabs[currentTabId]) tabs[currentTabId].view.webContents.reload(); });
}

ipcMain.handle('get-settings', () => settings);

ipcMain.on('update-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveSettings();
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('settings-updated', settings));
});

ipcMain.handle('select-download-folder', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory']
  });
  if (!result.canceled) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.on('sidebar-state', (event, { sidebarOpen, popupOpen }) => {
  isSidebarOpen = (sidebarOpen !== undefined) ? sidebarOpen : isSidebarOpen;
  isDownloadPopupOpen = (popupOpen !== undefined) ? popupOpen : isDownloadPopupOpen;
  
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin && tabs[currentTabId]) {
    updateViewBoundsForWindow(tabs[currentTabId].view, senderWin);
    if (isSidebarOpen || isDownloadPopupOpen) senderWin.webContents.focus();
    else tabs[currentTabId].view.webContents.focus();
  }
});

// --- PASSWORD MANAGER ---
ipcMain.on('save-password', async (event, { url, username, password }) => {
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Save', 'Never', 'Not Now'],
    defaultId: 0,
    title: 'Save Password?',
    message: `Do you want to save the password for ${username} at ${url}?`,
    checkboxLabel: 'Always ask',
    checkboxChecked: true
  });

  if (result.response === 0) { // Save
    settings.passwords.push({ url, username, password });
    saveSettings();
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('settings-updated', settings));
  }
});

ipcMain.handle('get-passwords', () => settings.passwords);


// --- FINAL FIX FOR CLEARING HISTORY ---
ipcMain.on('show-item-in-folder', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.on('clear-history', (event) => {
  const historyPath = path.join(__dirname, 'history.html');
  const emptyTemplate = `<!DOCTYPE html>
<html>
<head>
    <style>
        body { background: #202124; color: #e8eaed; font-family: 'Segoe UI', sans-serif; padding: 40px; max-width: 800px; margin: auto; }
        .header-container { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #3c4043; padding-bottom: 20px; margin-bottom: 20px; }
        h1 { margin: 0; font-weight: 400; }
        .clear-btn { background: #ff4d4d; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; }
        .clear-btn:hover { background: #ff3333; }
        .entry { padding: 12px; border-bottom: 1px solid #3c4043; display: flex; align-items: center; }
        .time { color: #9aa0a6; font-size: 12px; margin-right: 15px; min-width: 150px; }
        .link { color: #8ab4f8; text-decoration: none; }
    </style>
</head>
<body>
    <div class="header-container">
        <h1>History</h1>
        <button class="clear-btn" onclick="clearAll()">Clear History</button>
    </div>
    <script>
        function clearAll() {
            if(confirm("Are you sure you want to clear all history?")) {
                window.electronAPI.clearHistory();
            }
        }
        window.electronAPI.onHistoryCleared(() => {
            window.location.reload();
        });
    </script>
</body>
</html>`;

  fs.writeFile(historyPath, emptyTemplate, (err) => { 
    if (err) {
      console.error("Failed to clear history:", err); 
    } else {
      // CLEAR CACHE AND STORAGE: Forces Electron to load the empty file from disk
      event.sender.session.clearStorageData({
        storages: ['cachestorage', 'cookies', 'filesystem']
      }).then(() => {
          event.reply('history-cleared'); // Notify the page to reload
      });
    }
  });
});

ipcMain.on('new-tab', (event, { id, isPrivate }) => { 
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  createTab(id, isPrivate, senderWin); 
});

ipcMain.on('open-private-window', () => {
  createPrivateWindow();
});

ipcMain.on('switch-tab', (event, id) => {
  currentTabId = id;
  const tabEntry = tabs[id];
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin && tabEntry && tabEntry.view && tabEntry.view.webContents.getURL() !== "" && tabEntry.view.webContents.getURL() !== 'about:blank') {
    senderWin.setBrowserView(tabEntry.view);
    updateViewBoundsForWindow(tabEntry.view, senderWin);
    senderWin.webContents.send('url-changed', { id, url: tabEntry.view.webContents.getURL() });
  } else if (senderWin) {
    senderWin.setBrowserView(null);
  }
});

ipcMain.on('load-url', (event, { id, url, isPrivate }) => {
  let targetUrl = (url.includes('.') || url.startsWith('http')) ? (url.startsWith('http') ? url : `https://${url}`) : `https://www.google.com/search?q=${url}`;
  if (url.includes('internal://')) targetUrl = `file://${path.join(__dirname, url.split('//')[1] + '.html')}`;
  
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin) {
    if (!tabs[id]) createTab(id, isPrivate, senderWin);
    currentTabId = id;
    senderWin.setBrowserView(tabs[id].view);
    updateViewBoundsForWindow(tabs[id].view, senderWin);
    tabs[id].view.webContents.loadURL(targetUrl);
  }
});

ipcMain.on('clear-downloads', (event) => {
  const downloadsPath = path.join(__dirname, 'downloads.html');
  const emptyTemplate = `<!DOCTYPE html>
<html>
<head>
    <style>
        body { background: #202124; color: #e8eaed; font-family: 'Segoe UI', sans-serif; padding: 40px; max-width: 800px; margin: auto; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #3c4043; padding-bottom: 20px; margin-bottom: 20px; }
        h1 { margin: 0; font-weight: 400; }
        .clear-btn { background: #3c4043; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px; }
        .clear-btn:hover { background: #4b4f53; }
        .entry { padding: 15px; border-bottom: 1px solid #3c4043; display: flex; flex-direction: column; cursor: pointer; transition: background 0.2s; border-radius: 8px; margin-bottom: 5px; position: relative; }
        .entry:hover { background: #292a2d; }
        .name { color: #8ab4f8; font-size: 16px; margin-bottom: 5px; font-weight: 500; }
        .info { color: #9aa0a6; font-size: 12px; }
        .progress-container { width: 100%; height: 4px; background: #3c4043; border-radius: 2px; margin-top: 10px; display: none; }
        .progress-bar { height: 100%; background: #8ab4f8; border-radius: 2px; width: 0%; transition: width 0.3s; }
        .status { font-size: 11px; margin-top: 5px; color: #9aa0a6; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Downloads</h1>
        <button class="clear-btn" onclick="clearAll()">Clear List</button>
    </div>
    <div id="list"></div>
    <script>
        function openFile(path) { window.electronAPI.showItemInFolder(path); }
        function clearAll() { window.electronAPI.clearDownloads(); }
        
        window.electronAPI.onDownloadProgress((data) => {
            let item = document.getElementById('dl-' + data.id);
            if (!item && data.state !== 'completed') {
                item = document.createElement('div');
                item.id = 'dl-' + data.id;
                item.className = 'entry';
                item.innerHTML = '<span class="name">' + data.fileName + '</span><span class="info">' + data.state + '</span><div class="progress-container" style="display:block"><div class="progress-bar"></div></div><div class="status"></div>';
                document.getElementById('list').prepend(item);
            }
            if (item) {
                if (data.state === 'completed') { window.location.reload(); return; }
                const bar = item.querySelector('.progress-bar');
                const status = item.querySelector('.status');
                bar.style.width = (data.progress * 100) + '%';
                
                let eta = "";
                if (data.progress > 0 && data.progress < 1) {
                    const elapsed = (Date.now() / 1000) - data.startTime;
                    const speed = data.received / elapsed;
                    const remaining = data.total - data.received;
                    const secondsLeft = Math.round(remaining / speed);
                    if (isFinite(secondsLeft)) {
                        const mins = Math.floor(secondsLeft / 60);
                        const secs = secondsLeft % 60;
                        eta = " - " + (mins > 0 ? mins + "m " : "") + secs + "s remaining";
                    }
                }
                status.innerText = Math.round(data.progress * 100) + '% - ' + (data.received / (1024*1024)).toFixed(1) + 'MB / ' + (data.total / (1024*1024)).toFixed(1) + 'MB' + eta;
            }
        });
    </script>
</body>
</html>`;
  fs.writeFile(downloadsPath, emptyTemplate, (err) => {
    if (err) console.error(err);
    else event.reply('downloads-cleared');
  });
});

ipcMain.on('cancel-downloads-and-close', () => {
  activeDownloads.forEach(item => item.cancel());
  activeDownloads.clear();
  app.quit();
});

ipcMain.on('window-control', (event, action) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (!senderWin) return;
  switch (action) {
    case 'minimize': senderWin.minimize(); break;
    case 'maximize': senderWin.isMaximized() ? senderWin.unmaximize() : senderWin.maximize(); break;
    case 'close': senderWin.close(); break;
  }
});

ipcMain.on('go-back', () => { if (tabs[currentTabId]) tabs[currentTabId].view.webContents.navigationHistory.goBack(); });
ipcMain.on('go-forward', () => { if (tabs[currentTabId]) tabs[currentTabId].view.webContents.navigationHistory.goForward(); });
ipcMain.on('reload', () => { if (tabs[currentTabId]) tabs[currentTabId].view.webContents.reload(); });

app.whenReady().then(() => { createWindow(); registerShortcuts(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });