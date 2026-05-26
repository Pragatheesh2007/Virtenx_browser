const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut, shell, dialog } = require('electron');
const { updateElectronApp } = require('update-electron-app');
const path = require('path'); 
const fs = require('fs'); 

// Initialize the auto-updater (Must be called before app.whenReady)
updateElectronApp({ notifyUser: true });

// --- DEEP INTEGRATION WINDOWS SQUIRREL SHORTCUT & BROWSER REGISTRATION HANDLER ---
if (process.platform === 'win32') {
  const handleSquirrelEvent = () => {
    if (process.argv.length === 1) return false;

    const ChildProcess = require('child_process');
    const appFolder = path.resolve(process.execPath, '..');
    const rootAtomFolder = path.resolve(appFolder, '..');
    const updateDotExe = path.resolve(path.join(rootAtomFolder, 'Update.exe'));
    const exeName = path.basename(process.execPath);

    const escapedExecPath = `\\"${process.execPath}\\"`;

    const spawn = (command, args) => {
      let spawnedProcess;
      try {
        spawnedProcess = ChildProcess.spawn(command, args, { detached: true });
      } catch (error) {
        console.error("Squirrel Spawn Error:", error);
      }
      return spawnedProcess;
    };

    const spawnReg = (args) => {
      try {
        const sysRoot = process.env.SystemRoot || 'C:\\Windows';
        const regExePath = path.join(sysRoot, 'System32', 'reg.exe');
        ChildProcess.spawnSync(regExePath, args, { stdio: 'ignore' });
      } catch (error) {
        console.error("Registry Registration Error:", error);
      }
    };

    const squirrelEvent = process.argv[1];
    const regPath = `HKCU\\Software\\Clients\\StartMenuInternet\\Virtenx`;
    const openCommand = `${escapedExecPath} \\"%1\\"`;

    switch (squirrelEvent) {
      case '--squirrel-install':
      case '--squirrel-updated':
        spawn(updateDotExe, ['--createShortcut', exeName]);

        spawnReg(['add', regPath, '/ve', '/d', 'Virtenx Browser', '/f']);
        spawnReg(['add', `${regPath}\\DefaultIcon`, '/ve', '/d', `${process.execPath},0`, '/f']);
        spawnReg(['add', `${regPath}\\shell\\open\\command`, '/ve', '/d', openCommand, '/f']);

        spawnReg(['add', `${regPath}\\Capabilities`, '/v', 'ApplicationName', '/d', 'Virtenx', '/f']);
        spawnReg(['add', `${regPath}\\Capabilities`, '/v', 'ApplicationDescription', '/d', 'A modern, secure, memory saving web browser', '/f']);
        spawnReg(['add', `${regPath}\\Capabilities\\FileAssociations`, '/v', '.html', '/d', 'VirtenxHTML', '/f']);
        spawnReg(['add', `${regPath}\\Capabilities\\FileAssociations`, '/v', '.htm', '/d', 'VirtenxHTML', '/f']);
        spawnReg(['add', `${regPath}\\Capabilities\\URLAssociations`, '/v', 'http', '/d', 'VirtenxHTML', '/f']);
        spawnReg(['add', `${regPath}\\Capabilities\\URLAssociations`, '/v', 'https', '/d', 'VirtenxHTML', '/f']);

        spawnReg(['add', `HKCU\\Software\\Classes\\VirtenxHTML`, '/ve', '/d', 'Virtenx HTML Document', '/f']);
        spawnReg(['add', `HKCU\\Software\\Classes\\VirtenxHTML\\Application`, '/v', 'ApplicationName', '/d', 'Virtenx', '/f']);
        spawnReg(['add', `HKCU\\Software\\Classes\\VirtenxHTML\\DefaultIcon`, '/ve', '/d', `${process.execPath},0`, '/f']);
        spawnReg(['add', `HKCU\\Software\\Classes\\VirtenxHTML\\shell\\open\\command`, '/ve', '/d', openCommand, '/f']);

        spawnReg(['add', `HKCU\\Software\\RegisteredApplications`, '/v', 'Virtenx', '/d', `${regPath}\\Capabilities`, '/f']);

        setTimeout(app.quit, 1500);
        return true;

      case '--squirrel-uninstall':
        spawn(updateDotExe, ['--removeShortcut', exeName]);
        spawnReg(['delete', regPath, '/f']);
        spawnReg(['delete', `HKCU\\Software\\Classes\\VirtenxHTML`, '/f']);
        spawnReg(['delete', `HKCU\\Software\\RegisteredApplications`, '/v', 'Virtenx', '/f']);
        
        setTimeout(app.quit, 1500);
        return true;

      case '--squirrel-obsolete':
        setTimeout(app.quit, 1000);
        return true;
    }
  };

  if (handleSquirrelEvent()) {
    return; 
  }
}

if (require('electron-squirrel-startup')) return;
  
let win;
let tabs = {}; 
let currentTabId = 0;
let isSidebarOpen = false;
let isDownloadPopupOpen = false;
let activeDownloads = new Set();

const UI_HEIGHT = 83; 
const SIDEBAR_WIDTH = 260;

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const HISTORY_FILE = path.join(app.getPath('userData'), 'history.html');

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

const emptyHistoryTemplate = `<!DOCTYPE html>
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
    <div id="list"></div>
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

function initHistoryFile() {
  if (!fs.existsSync(HISTORY_FILE)) {
    try {
      fs.writeFileSync(HISTORY_FILE, emptyHistoryTemplate, 'utf8');
    } catch (e) {
      console.error("Failed to initialize history storage profile file:", e);
    }
  }
}

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

loadSettings();
initHistoryFile();

function checkDefaultBrowser() {
  if (process.platform !== 'win32') return;
  if (!win || win.isDestroyed()) return;

  const isDefaultHttp = app.isDefaultProtocolClient('http');
  const isDefaultHttps = app.isDefaultProtocolClient('https');

  if (!isDefaultHttp || !isDefaultHttps) {
    dialog.showMessageBox({
      type: 'question',
      buttons: ['Set as Default', 'Later'],
      title: 'Set Default Browser',
      message: 'Virtenx is not your default browser. Would you like to make it your primary web browser?',
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        app.setAsDefaultProtocolClient('http');
        app.setAsDefaultProtocolClient('https');
        shell.openExternal('ms-settings:defaultapps');
      }
    }).catch(err => console.error("Default browser dialog error:", err));
  }
}

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

  win.on('close', (e) => {
    if (activeDownloads.size > 0) {
      e.preventDefault();
      win.webContents.send('confirm-close-download');
      return;
    }

    // FIXED: Manually un-attach and destroy active views on shutdown to prevent background thread object race conditions
    win.setBrowserView(null);
    Object.keys(tabs).forEach(id => {
      if (tabs[id] && tabs[id].view) {
        tabs[id].view.webContents.close();
        tabs[id] = null;
      }
    });
    tabs = {};
  });

  win.on('resize', () => {
    if (tabs[currentTabId] && tabs[currentTabId].view) updateViewBounds(tabs[currentTabId].view);
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
    // Safety check: Don't process file writing or pipe IPC calls if parent layout engine is turning off
    if (!targetWin || targetWin.isDestroyed()) return;

    if (!isPrivate && !url.startsWith('file://')) {
      const timestamp = new Date().toLocaleString();
      const title = view.webContents.getTitle() || url;
      const entry = `<div class="entry"><span class="time">${timestamp}</span><a href="${url}" class="link">${title}</a></div>\n`;
      
      try {
        let currentContent = fs.readFileSync(HISTORY_FILE, 'utf8');
        if (currentContent.includes('<div id="list">')) {
          currentContent = currentContent.replace('<div id="list">', '<div id="list">\n' + entry);
          fs.writeFileSync(HISTORY_FILE, currentContent, 'utf8');
        } else {
          fs.appendFileSync(HISTORY_FILE, entry, 'utf8');
        }
      } catch (e) {
        console.error("History file sync error:", e);
      }
    }
    if (!targetWin.isDestroyed()) {
      targetWin.webContents.send('url-changed', { id, url });
    }
  });

  view.webContents.on('page-favicon-updated', (event, favicons) => {
    if (targetWin && !targetWin.isDestroyed() && favicons && favicons.length > 0) {
      targetWin.webContents.send('favicon-changed', { id, favUrl: favicons[0] });
    }
  });

  view.webContents.on('did-start-loading', () => {
    if (targetWin && !targetWin.isDestroyed()) targetWin.webContents.send('loading-state', { id, isLoading: true });
  });

  view.webContents.on('did-stop-loading', () => {
    if (targetWin && !targetWin.isDestroyed()) targetWin.webContents.send('loading-state', { id, isLoading: false });
  });

  view.webContents.on('did-navigate-in-page', (event, url) => {
    if (targetWin && !targetWin.isDestroyed()) targetWin.webContents.send('url-changed', { id, url });
  });

  view.webContents.session.on('will-download', (event, item, webContents) => {
    const fileName = item.getFilename();
    const url = item.getURL();
    const timestamp = new Date().toLocaleString();
    const downloadPath = path.join(settings.downloadPath, fileName);
    
    if (!settings.askEverytime) {
      item.setSavePath(downloadPath);
    }
    activeDownloads.add(item);

    item.on('updated', (event, state) => {
      if (state === 'progressing') {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const progress = total > 0 ? (received / total) : 0;
        
        BrowserWindow.getAllWindows().forEach(w => {
          if (!w.isDestroyed()) {
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
          }
        });
      }
    });

    item.once('done', (event, state) => {
      activeDownloads.delete(item);
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) {
          w.webContents.send('download-progress', {
            id: item.getStartTime(),
            state: 'completed'
          });
        }
      });
      if (state === 'completed') {
        const downloadsPath = path.join(__dirname, 'downloads.html');
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

  privateWin.on('close', (e) => {
    if (activeDownloads.size > 0) {
      e.preventDefault();
      privateWin.webContents.send('confirm-close-download');
    }
  });

  privateWin.webContents.on('did-finish-load', () => {
    privateWin.webContents.send('init-private-mode');
  });

  return privateWin;
}

function updateViewBoundsForWindow(view, targetWin) {
  if (!view || !targetWin || targetWin.isDestroyed()) return;
  const bounds = targetWin.getContentBounds();
  const sidebarOffset = isSidebarOpen ? SIDEBAR_WIDTH : 0;
  
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
  globalShortcut.register('CommandOrControl+T', () => { if (win && !win.isDestroyed()) win.webContents.send('execute-shortcut', 'new-tab'); });
  globalShortcut.register('CommandOrControl+W', () => { if (win && !win.isDestroyed()) win.webContents.send('execute-shortcut', 'close-tab'); });
  globalShortcut.register('CommandOrControl+L', () => { if (win && !win.isDestroyed()) win.webContents.send('execute-shortcut', 'focus-url'); });
  globalShortcut.register('CommandOrControl+R', () => { if (tabs[currentTabId] && tabs[currentTabId].view) tabs[currentTabId].view.webContents.reload(); });
}

ipcMain.handle('get-settings', () => settings);

ipcMain.on('update-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveSettings();
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('settings-updated', settings);
  });
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
  if (senderWin && !senderWin.isDestroyed() && tabs[currentTabId] && tabs[currentTabId].view) {
    updateViewBoundsForWindow(tabs[currentTabId].view, senderWin);
    if (isSidebarOpen || isDownloadPopupOpen) senderWin.webContents.focus();
    else tabs[currentTabId].view.webContents.focus();
  }
});

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

  if (result.response === 0) { 
    settings.passwords.push({ url, username, password });
    saveSettings();
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('settings-updated', settings);
    });
  }
});

ipcMain.handle('get-passwords', () => settings.passwords);

ipcMain.on('show-item-in-folder', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.on('clear-history', (event) => {
  fs.writeFile(HISTORY_FILE, emptyHistoryTemplate, 'utf8', (err) => { 
    if (err) {
      console.error("Failed to clear history file:", err); 
    } else {
      const sessionToClear = event.sender.session;
      sessionToClear.clearStorageData({
        storages: ['cachestorage', 'cookies', 'shadercache']
      }).then(() => {
        if (!event.sender.isDestroyed()) event.reply('history-cleared'); 
        
        BrowserWindow.getAllWindows().forEach(w => {
          if (w && !w.isDestroyed()) {
            w.webContents.send('history-cleared');
          }
        });
      }).catch(err => console.error("Session clear failure:", err));
    }
  });
});

ipcMain.on('new-tab', (event, { id, isPrivate }) => { 
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin && !senderWin.isDestroyed()) createTab(id, isPrivate, senderWin); 
});

ipcMain.on('open-private-window', () => {
  createPrivateWindow();
});

ipcMain.on('switch-tab', (event, id) => {
  currentTabId = id;
  const tabEntry = tabs[id];
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin && !senderWin.isDestroyed() && tabEntry && tabEntry.view && tabEntry.view.webContents.getURL() !== "" && tabEntry.view.webContents.getURL() !== 'about:blank') {
    senderWin.setBrowserView(tabEntry.view);
    updateViewBoundsForWindow(tabEntry.view, senderWin);
    senderWin.webContents.send('url-changed', { id, url: tabEntry.view.webContents.getURL() });
  } else if (senderWin && !senderWin.isDestroyed()) {
    senderWin.setBrowserView(null);
  }
});

ipcMain.on('load-url', (event, { id, url, isPrivate }) => {
  let targetUrl = (url.includes('.') || url.startsWith('http')) ? (url.startsWith('http') ? url : `https://${url}`) : `https://www.google.com/search?q=${url}`;
  
  if (url.includes('internal://')) {
    const pageName = url.split('//')[1];
    if (pageName === 'history') {
      targetUrl = `file://${HISTORY_FILE}`; 
    } else {
      targetUrl = `file://${path.join(__dirname, pageName + '.html')}`; 
    }
  }
  
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (senderWin && !senderWin.isDestroyed()) {
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
    else if (event.sender && !event.sender.isDestroyed()) event.reply('downloads-cleared');
  });
});

ipcMain.on('cancel-downloads-and-close', () => {
  activeDownloads.forEach(item => item.cancel());
  activeDownloads.clear();
  app.quit();
});

ipcMain.on('window-control', (event, action) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  if (!senderWin || senderWin.isDestroyed()) return;
  switch (action) {
    case 'minimize': senderWin.minimize(); break;
    case 'maximize': senderWin.isMaximized() ? senderWin.unmaximize() : senderWin.maximize(); break;
    case 'close': senderWin.close(); break;
  }
});

ipcMain.on('go-back', () => { if (tabs[currentTabId] && tabs[currentTabId].view) tabs[currentTabId].view.webContents.navigationHistory.goBack(); });
ipcMain.on('go-forward', () => { if (tabs[currentTabId] && tabs[currentTabId].view) tabs[currentTabId].view.webContents.navigationHistory.goForward(); });
ipcMain.on('reload', () => { if (tabs[currentTabId] && tabs[currentTabId].view) tabs[currentTabId].view.webContents.reload(); });

app.whenReady().then(() => { 
  createWindow(); 
  registerShortcuts(); 
  
  setTimeout(checkDefaultBrowser, 3000);
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });