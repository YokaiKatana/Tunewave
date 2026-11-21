// Tunewave — main process
// A Spotify-style desktop shell around YouTube Music (uses your own YouTube Music / Premium login).

const { app, BrowserWindow, ipcMain, session, shell, nativeImage, net, Menu, Tray, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const YTM_ORIGIN = 'https://music.youtube.com';
const PARTITION = 'persist:ytm';

// Present ourselves as a normal desktop Chrome so Google sign-in works inside the app.
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = CHROME_UA;

// Hosts that may load inside the in-app YouTube Music view (sign-in + consent flow).
const ALLOWED_IN_APP = [
  /^music\.youtube\.com$/,
  /^(www\.|m\.)?youtube\.com$/,
  /^accounts\.google\.[a-z.]+$/,
  /^accounts\.youtube\.com$/,
  /^consent\.youtube\.com$/,
  /^consent\.google\.com$/,
  /^myaccount\.google\.com$/,
  /^(www\.)?google\.[a-z.]+$/,
  /^gds\.google\.com$/,
];
const isAllowedInApp = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_IN_APP.some((re) => re.test(u.hostname));
  } catch { return false; }
};

let win = null;
let tray = null;
let isQuitting = false;
let trayBehavior = { closeToTray: true, minimizeToTray: false };
let notifiedTray = false;
let lastNowPlaying = { playing: false, hasTrack: false };

// ---- single instance ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

// ---- window state (size/position) ----
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return { width: 1380, height: 860 }; }
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try { fs.writeFileSync(statePath(), JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch {}
}

const icon = (name) => nativeImage.createFromPath(path.join(__dirname, 'assets', name));

function createWindow() {
  const st = loadWindowState();
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1380, height: st.height || 860,
    minWidth: 900, minHeight: 600,
    backgroundColor: '#000000',
    title: 'Tunewave',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    titleBarStyle: isWin || isMac ? 'hidden' : 'default',
    titleBarOverlay: isWin ? { color: '#000000', symbolColor: '#ffffff', height: 56 } : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 20 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  if (st.maximized) win.maximize();
  Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    saveWindowState();
    if (!isQuitting && trayBehavior.closeToTray && tray) {
      e.preventDefault();
      win.hide();
      if (!notifiedTray && process.platform === 'win32') {
        notifiedTray = true;
        try { tray.displayBalloon({ title: 'Still playing', content: 'Tunewave is here in the tray. Right-click for controls.' }); } catch {}
      }
      updateTrayMenu();
    }
  });
  win.on('minimize', (e) => {
    if (trayBehavior.minimizeToTray && tray) { e.preventDefault(); win.hide(); updateTrayMenu(); }
  });
  win.on('show', () => updateTrayMenu());
  win.on('hide', () => updateTrayMenu());
  win.on('focus', () => resyncLogin());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Lock down the <webview>: only YouTube Music, no node, no custom preload.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!params.src.startsWith(YTM_ORIGIN)) event.preventDefault();
  });

  win.webContents.on('did-attach-webview', (_e, wc) => {
    wc.setUserAgent(CHROME_UA);
    // Popups: sign-in style flows stay in-app, everything else opens in the default browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (isGoogleSignIn(url)) { startBrowserSignIn(url); }
      else if (isAllowedInApp(url)) { wc.loadURL(url); }
      else if (/^https?:/.test(url)) { shell.openExternal(url); }
      return { action: 'deny' };
    });
    // Forward app shortcuts even while YouTube Music has keyboard focus.
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown' || !win) return;
      const ctrl = input.control || input.meta;
      const k = input.key.toLowerCase();
      let name = null;
      if (ctrl && (k === 'k' || k === 'l')) name = 'search';
      else if (ctrl && k === 'r') name = 'reload';
      else if (input.alt && k === 'arrowleft') name = 'back';
      else if (input.alt && k === 'arrowright') name = 'forward';
      else if (ctrl && k === 'arrowright') name = 'next';
      else if (ctrl && k === 'arrowleft') name = 'prev';
      else if (ctrl && k === 'arrowup') name = 'volUp';
      else if (ctrl && k === 'arrowdown') name = 'volDown';
      if (name) { e.preventDefault(); win.webContents.send('shortcut', name); }
    });
    wc.on('will-navigate', (e, url) => {
      // YouTube Music's own "sign in" prompts jump to Google's page, which Google blocks
      // inside the app. Intercept those and refresh the login from the user's browser instead.
      if (isGoogleSignIn(url)) { e.preventDefault(); startBrowserSignIn(url); return; }
      if (!isAllowedInApp(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
    });
  });

  // The shell page itself never navigates anywhere.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  updateThumbar();
}

// ---- Windows taskbar thumbnail buttons (prev / play-pause / next) ----
function updateThumbar() {
  if (process.platform !== 'win32' || !win) return;
  const send = (cmd) => () => win && win.webContents.send('player-command', cmd);
  const hasTrack = !!lastNowPlaying.hasTrack;
  try {
    win.setThumbarButtons([
      { tooltip: 'Previous', icon: icon('thumb-prev.png'), click: send('prev'), flags: hasTrack ? [] : ['disabled'] },
      lastNowPlaying.playing
        ? { tooltip: 'Pause', icon: icon('thumb-pause.png'), click: send('playPause'), flags: hasTrack ? [] : ['disabled'] }
        : { tooltip: 'Play', icon: icon('thumb-play.png'), click: send('playPause'), flags: hasTrack ? [] : ['disabled'] },
      { tooltip: 'Next', icon: icon('thumb-next.png'), click: send('next'), flags: hasTrack ? [] : ['disabled'] },
    ]);
  } catch {}
}

// ---- System tray ----
const sendPlayer = (cmd) => { if (win) win.webContents.send('player-command', cmd); };
function showWindow() { if (!win) return; win.show(); if (win.isMinimized()) win.restore(); win.focus(); }
function toggleWindow() { if (!win) return; (win.isVisible() && !win.isMinimized()) ? win.hide() : showWindow(); }

function updateTrayMenu() {
  if (!tray) return;
  const np = lastNowPlaying;
  const nowLine = np.hasTrack && np.title ? `${np.title}${np.artist ? ' — ' + np.artist : ''}` : 'Nothing playing';
  const visible = win && win.isVisible() && !win.isMinimized();
  try {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: nowLine.length > 60 ? nowLine.slice(0, 57) + '…' : nowLine, enabled: false },
      { type: 'separator' },
      { label: np.playing ? 'Pause' : 'Play', click: () => sendPlayer('playPause') },
      { label: 'Previous', click: () => sendPlayer('prev') },
      { label: 'Next', click: () => sendPlayer('next') },
      { type: 'separator' },
      { label: visible ? 'Hide Tunewave' : 'Show Tunewave', click: () => toggleWindow() },
      { label: 'Quit Tunewave', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.setToolTip(np.hasTrack && np.title ? `${np.title} — ${np.artist || ''}` : 'Tunewave');
  } catch {}
}

function createTray() {
  if (tray) return;
  try {
    let img = icon('tray.png');
    if (!img || img.isEmpty()) img = icon('icon.png');
    tray = new Tray(img);
    tray.setToolTip('Tunewave');
    tray.on('click', () => { if (process.platform !== 'darwin') toggleWindow(); });
    tray.on('double-click', () => showWindow());
    updateTrayMenu();
  } catch (e) { tray = null; } // some Linux desktops have no tray; fail quietly
}

// ---- Global media keys (work even when the app isn't focused) ----
let mediaKeysOn = false;
function setMediaKeys(enabled) {
  if (enabled === mediaKeysOn) return;
  mediaKeysOn = enabled;
  try {
    if (enabled) {
      globalShortcut.register('MediaPlayPause', () => sendPlayer('playPause'));
      globalShortcut.register('MediaNextTrack', () => sendPlayer('next'));
      globalShortcut.register('MediaPreviousTrack', () => sendPlayer('prev'));
    } else {
      for (const k of ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack']) globalShortcut.unregister(k);
    }
  } catch {}
}

// ---- IPC from the shell renderer ----
ipcMain.on('tray-behavior', (_e, b) => { trayBehavior = { ...trayBehavior, ...(b || {}) }; });
ipcMain.on('media-keys', (_e, enabled) => setMediaKeys(!!enabled));

let savedBounds = null;
ipcMain.on('mini-mode', (_e, on) => {
  if (!win) return;
  try {
    if (on) {
      savedBounds = win.getNormalBounds();
      win.unmaximize();
      win.setMinimumSize(240, 300);
      const b = savedBounds || { x: 100, y: 100, width: 1200, height: 800 };
      const w = 300, h = 380;
      win.setBounds({ width: w, height: h, x: b.x + Math.max(0, b.width - w - 24), y: b.y + 48 });
      win.setAlwaysOnTop(true, 'floating');
    } else {
      win.setAlwaysOnTop(false);
      win.setMinimumSize(900, 600);
      if (savedBounds) win.setBounds(savedBounds);
    }
  } catch {}
});

ipcMain.on('titlebar-colors', (_e, { color, symbolColor }) => {
  if (process.platform === 'win32' && win) {
    try { win.setTitleBarOverlay({ color, symbolColor, height: 56 }); } catch {}
  }
});

ipcMain.on('now-playing', (_e, np) => {
  const changed = np.playing !== lastNowPlaying.playing || np.hasTrack !== lastNowPlaying.hasTrack;
  lastNowPlaying = np;
  if (win) win.setTitle(np.hasTrack && np.title ? `${np.title} · ${np.artist || ''} — Tunewave` : 'Tunewave');
  if (changed) updateThumbar();
  updateTrayMenu();
});

// ---- Sign-in window ----
// Google sign-in opens in its own small window (sharing the app's login storage).
// It closes by itself once Google sends you back to YouTube Music.
let signInWin = null;
const DEFAULT_SIGNIN = 'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=' +
  encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=' + encodeURIComponent(YTM_ORIGIN + '/'));

const { signInWithBrowser, silentResync } = require('./browser-signin');

// Keep the app's borrowed login in step with the browser so Google doesn't sign it out.
let lastResync = 0;
async function resyncLogin(force) {
  if (!force && Date.now() - lastResync < 45000) return;
  lastResync = Date.now();
  try { await silentResync({ partition: PARTITION }); } catch {}
}
const sendSignin = (state, info = {}) => { if (win && !win.isDestroyed()) win.webContents.send('signin-status', { state, ...info }); };

// A Google sign-in / account page (which Google blocks inside the app).
const isGoogleSignIn = (url) => {
  try {
    const u = new URL(url);
    if (u.hostname === 'accounts.google.com' || u.hostname === 'accounts.youtube.com') return true;
    if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && /(servicelogin|signin|accountchooser|addsession|logout)/i.test(u.pathname)) return true;
    return false;
  } catch { return false; }
};

// Sign in (or refresh the login) through the user's own browser, reusing their existing
// session where possible. Used by the sidebar button and by YouTube Music's own sign-in prompts.
function startBrowserSignIn(url) {
  const start = typeof url === 'string' && isAllowedInApp(url) && isGoogleSignIn(url) ? url : DEFAULT_SIGNIN;
  signInWithBrowser({
    url: start, partition: PARTITION,
    onStatus: (state, info) => {
      if (state === 'no-browser') { sendSignin('fallback'); openSignInWindow(start); return; }
      if (state === 'done') { sendSignin('done', info); if (win) { if (win.isMinimized()) win.restore(); win.focus(); win.webContents.send('signed-in'); } return; }
      sendSignin(state, info);
    },
  });
}

ipcMain.on('open-signin', (_e, url) => startBrowserSignIn(url));

// Fallback: Google's page in an app window (Google may refuse this; used only when no browser is found).
function openSignInWindow(start) {
  if (signInWin && !signInWin.isDestroyed()) { signInWin.focus(); return; }
  signInWin = new BrowserWindow({
    width: 500, height: 720, parent: win, modal: false, resizable: true,
    title: 'Sign in with Google', backgroundColor: '#ffffff', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const wc = signInWin.webContents;
  wc.setUserAgent(CHROME_UA);
  // Always show which site you're on, so you can check it's really Google.
  const showHost = () => {
    try { signInWin.setTitle(`Sign in with Google — ${new URL(wc.getURL()).hostname}`); } catch {}
  };
  wc.on('page-title-updated', (e) => { e.preventDefault(); showHost(); });
  wc.on('did-navigate', (_ev, navUrl) => {
    showHost();
    try {
      if (new URL(navUrl).hostname === 'music.youtube.com') {
        // Signed in: Google has redirected back to YouTube Music.
        signInWin.close();
        if (win) win.webContents.send('signed-in');
      }
    } catch {}
  });
  wc.on('will-navigate', (ev, navUrl) => {
    if (!isAllowedInApp(navUrl)) { ev.preventDefault(); if (/^https?:/.test(navUrl)) shell.openExternal(navUrl); }
  });
  wc.setWindowOpenHandler(({ url: u }) => {
    if (isAllowedInApp(u)) wc.loadURL(u); else if (/^https?:/.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  signInWin.on('closed', () => { signInWin = null; });
  signInWin.loadURL(start);
}

// ---- Updates ----
// Installed version: downloads updates in the background from GitHub Releases and installs on restart.
// Portable version (can't replace itself): tells you a new version is out and links to the download.
const RELEASES_API = 'https://api.github.com/repos/YokaiKatana/Tunewave/releases/latest';
const RELEASES_PAGE = 'https://github.com/YokaiKatana/Tunewave/releases/latest';
let updater = null;
let updateState = { state: 'idle', current: app.getVersion() };
const sendUpdate = (patch) => {
  updateState = { ...updateState, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('update-status', updateState);
};
const newer = (a, b) => { // is a > b ?
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
};

async function checkPortable(manual) {
  try {
    const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tunewave' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rel = await res.json();
    if (newer(rel.tag_name, app.getVersion())) sendUpdate({ state: 'available-portable', version: rel.tag_name.replace(/^v/, ''), url: rel.html_url || RELEASES_PAGE });
    else sendUpdate({ state: manual ? 'latest' : 'idle' });
  } catch (e) {
    sendUpdate({ state: manual ? 'error' : 'idle', error: String(e.message || e) });
  }
}

function checkForUpdates(manual = false) {
  if (!app.isPackaged) { if (manual) sendUpdate({ state: 'dev' }); return; }
  if (updater) {
    sendUpdate({ state: 'checking' });
    updater.checkForUpdates().catch((e) => sendUpdate({ state: manual ? 'error' : 'idle', error: String(e.message || e) }));
  } else {
    checkPortable(manual);
  }
}

function setupUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    if (autoUpdater.isUpdaterActive()) {
      updater = autoUpdater;
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('update-available', (info) => sendUpdate({ state: 'downloading', version: info.version, percent: 0 }));
      autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
      autoUpdater.on('update-not-available', () => sendUpdate({ state: updateState.state === 'checking' ? 'latest' : 'idle' }));
      autoUpdater.on('error', (e) => sendUpdate({ state: 'error', error: String((e && e.message) || e) }));
    }
  } catch { updater = null; }
  setTimeout(() => checkForUpdates(false), 8000);
  setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000);
}

ipcMain.handle('update-get', () => updateState);
ipcMain.on('update-check', () => checkForUpdates(true));
ipcMain.on('update-install', () => {
  if (updater && updateState.state === 'ready') { setImmediate(() => updater.quitAndInstall(false, true)); }
  else if (updateState.url) shell.openExternal(updateState.url);
  else shell.openExternal(RELEASES_PAGE);
});

ipcMain.on('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.handle('clear-session', async () => {
  await session.fromPartition(PARTITION).clearStorageData();
  return true;
});

// Pull a vivid colour out of album art (done here to avoid cross-origin canvas limits).
const colorCache = new Map();
ipcMain.handle('artwork-color', async (_e, url) => {
  if (typeof url !== 'string' || !/^https:\/\/([a-z0-9-]+\.)*(googleusercontent|ytimg|ggpht)\.com\//.test(url)) return null;
  if (colorCache.has(url)) return colorCache.get(url);
  try {
    const res = await net.fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const img = nativeImage.createFromBuffer(buf).resize({ width: 24, height: 24, quality: 'good' });
    const bmp = img.toBitmap(); // BGRA
    let best = null; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < bmp.length; i += 4) {
      const B = bmp[i], G = bmp[i + 1], R = bmp[i + 2];
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (max + min) / 510;
      const score = sat * (1 - Math.abs(lum - 0.55) * 1.4);
      r += R; g += G; b += B; n++;
      if (!best || score > best.score) best = { score, R, G, B };
    }
    let out;
    if (best && best.score > 0.18) out = [best.R, best.G, best.B];
    else out = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    const hex = '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
    colorCache.set(url, hex);
    if (colorCache.size > 200) colorCache.delete(colorCache.keys().next().value);
    return hex;
  } catch { return null; }
});

app.whenReady().then(() => {
  const ytm = session.fromPartition(PARTITION);
  ytm.setUserAgent(CHROME_UA);
  // Drop the "Electron" brand from client hints so Google treats this like Chrome.
  ytm.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    for (const k of Object.keys(h)) {
      if (/^sec-ch-ua(-full-version-list)?$/i.test(k)) {
        h[k] = h[k].replace(/,?\s*"Electron";v="[^"]*"/g, '');
      }
    }
    h['User-Agent'] = CHROME_UA;
    cb({ requestHeaders: h });
  });
  // No permission prompts needed beyond media playback / fullscreen / notifications.
  ytm.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'fullscreen', 'notifications', 'clipboard-sanitized-write'].includes(permission));
  });

  createWindow();
  createTray();
  setMediaKeys(true);
  setupUpdates();
  setTimeout(() => resyncLogin(true), 20000);
  setInterval(() => resyncLogin(true), 10 * 60 * 1000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
