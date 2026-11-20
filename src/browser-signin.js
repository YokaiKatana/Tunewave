// Sign in with Google in a real browser (Chrome / Edge / Brave), then copy the
// YouTube login into Tunewave.
//
// Google blocks sign-in inside apps' built-in browser windows ("This browser or app may
// not be secure"). So instead we open your installed browser with a fresh, temporary
// profile. You sign in on Google's real page there (passwords, passkeys, QR codes and
// phone prompts all work). Once YouTube Music has logged you in, Tunewave copies the
// youtube.com / google.com login cookies into its own storage, closes that browser
// window and deletes the temporary profile.

const { app, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TIMEOUT_MS = 10 * 60 * 1000;

function findBrowser() {
  const env = process.env;
  const candidates = [];
  if (process.platform === 'win32') {
    const pf = env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = env['LOCALAPPDATA'] || '';
    candidates.push(
      { name: 'Google Chrome', exe: path.join(pf, 'Google\\Chrome\\Application\\chrome.exe') },
      { name: 'Google Chrome', exe: path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe') },
      { name: 'Google Chrome', exe: path.join(local, 'Google\\Chrome\\Application\\chrome.exe') },
      { name: 'Microsoft Edge', exe: path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe') },
      { name: 'Microsoft Edge', exe: path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe') },
      { name: 'Brave', exe: path.join(pf, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
      { name: 'Brave', exe: path.join(local, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      { name: 'Google Chrome', exe: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'Microsoft Edge', exe: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { name: 'Brave', exe: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
      { name: 'Chromium', exe: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
    );
  } else {
    const dirs = (env.PATH || '/usr/bin:/usr/local/bin').split(':').concat(['/usr/bin', '/snap/bin', '/var/lib/flatpak/exports/bin']);
    for (const [name, bins] of [['Google Chrome', ['google-chrome', 'google-chrome-stable']], ['Chromium', ['chromium', 'chromium-browser']], ['Microsoft Edge', ['microsoft-edge', 'microsoft-edge-stable']], ['Brave', ['brave-browser', 'brave']]]) {
      for (const b of bins) for (const d of dirs) candidates.push({ name, exe: path.join(d, b) });
    }
  }
  return candidates.find((c) => { try { return c.exe && fs.statSync(c.exe).isFile(); } catch { return false; } }) || null;
}

// Minimal Chrome DevTools Protocol client over WebSocket (Node's built-in WebSocket).
function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    };
    ws.onerror = () => reject(new Error('Could not connect to the browser'));
    ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('Browser closed')); pending.clear(); };
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
      close: () => { try { ws.close(); } catch {} },
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function readDevToolsPort(dir, proc) {
  const file = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('The browser closed before sign-in started');
    try {
      const [port, wsPath] = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      if (port && wsPath) return `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
    } catch {}
    await wait(200);
  }
  throw new Error('The browser did not start in time');
}

const KEEP = (domain) => /(^|\.)youtube\.com$/.test(domain.replace(/^\./, '')) || /(^|\.)google\.com$/.test(domain.replace(/^\./, ''));
const isLoggedIn = (cookies) => {
  const yt = cookies.filter((c) => /(^|\.)youtube\.com$/.test(c.domain.replace(/^\./, '')));
  const has = (n) => yt.some((c) => c.name === n && c.value);
  return has('LOGIN_INFO') && (has('SAPISID') || has('__Secure-3PAPISID'));
};

async function importCookies(cookies, partition) {
  const ses = session.fromPartition(partition);
  const yearFromNow = Date.now() / 1000 + 365 * 24 * 3600;
  let n = 0;
  for (const c of cookies) {
    if (!KEEP(c.domain)) continue;
    const host = c.domain.replace(/^\./, '');
    const details = {
      url: `https://${host}${c.path || '/'}`,
      name: c.name, value: c.value, path: c.path || '/',
      secure: !!c.secure, httpOnly: !!c.httpOnly,
      expirationDate: c.session || !c.expires || c.expires < 0 ? yearFromNow : c.expires,
      sameSite: c.sameSite === 'Strict' ? 'strict' : c.sameSite === 'Lax' ? 'lax' : c.sameSite === 'None' ? 'no_restriction' : 'unspecified',
    };
    // __Host- cookies must not carry a Domain attribute; host-only cookies don't start with a dot.
    if (!c.name.startsWith('__Host-') && c.domain.startsWith('.')) details.domain = c.domain;
    try { await ses.cookies.set(details); n++; } catch {}
  }
  await ses.cookies.flushStore();
  return n;
}

function rmrf(dir) {
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch {}
    const t = Date.now(); while (Date.now() - t < 300) { /* brief wait for the browser to release files */ }
  }
}

let active = null;

// onStatus(state, info) states: 'opened' | 'done' | 'cancelled' | 'error' | 'no-browser'
async function signInWithBrowser({ url, partition, onStatus }) {
  if (active) { onStatus('opened', { browser: active.name, again: true }); return; }
  const browser = findBrowser();
  if (!browser) { onStatus('no-browser'); return; }

  const dir = path.join(app.getPath('userData'), 'signin-browser');
  rmrf(dir); fs.mkdirSync(dir, { recursive: true });

  const proc = spawn(browser.exe, [
    `--user-data-dir=${dir}`,
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--disable-features=msEdgeFRE,msImplicitSignin,SigninInterceptBubble',
    '--new-window', '--window-size=520,760',
    url,
  ], { detached: false, stdio: 'ignore' });
  active = { name: browser.name, proc };

  let cdp = null; let finished = false;
  const finish = (state, info) => {
    if (finished) return; finished = true;
    if (cdp) { cdp.send('Browser.close').catch(() => {}); setTimeout(() => cdp && cdp.close(), 500); }
    setTimeout(() => { try { if (proc.exitCode === null) proc.kill(); } catch {} rmrf(dir); }, 1500);
    active = null;
    onStatus(state, info);
  };
  proc.on('exit', () => { if (!finished) finish('cancelled'); });
  proc.on('error', (e) => finish('error', { message: e.message }));

  try {
    cdp = await connectCDP(await readDevToolsPort(dir, proc));
    onStatus('opened', { browser: browser.name });
    const started = Date.now();
    while (!finished && Date.now() - started < TIMEOUT_MS) {
      await wait(1500);
      let res; try { res = await cdp.send('Storage.getCookies'); } catch { break; }
      if (res && res.cookies && isLoggedIn(res.cookies)) {
        await wait(2000); // let the last cookies land
        const all = (await cdp.send('Storage.getCookies')).cookies;
        const n = await importCookies(all, partition);
        finish('done', { browser: browser.name, count: n });
        return;
      }
    }
    if (!finished) finish(Date.now() - started >= TIMEOUT_MS ? 'error' : 'cancelled', { message: 'Sign-in timed out' });
  } catch (e) {
    finish('error', { message: e.message });
  }
}

module.exports = { signInWithBrowser, findBrowser };
