// Sign in with Google in a real browser, then copy the YouTube login into Tunewave.
//
// Google blocks sign-in inside apps' built-in browser windows ("This browser or app may
// not be secure"). So Tunewave opens your browser (your default one if it's supported:
// Firefox, Chrome, Edge, Brave, Vivaldi, Opera or Chromium) with a fresh, temporary
// profile. You sign in on Google's real page there (passwords, passkeys, QR codes and
// phone prompts all work). Once YouTube has logged you in, Tunewave copies only the
// youtube.com / google.com login cookies into its own storage, closes that window and
// deletes the temporary profile.
//
//  - Chromium browsers: cookies are read over the DevTools protocol.
//  - Firefox: cookies are read from the temporary profile's cookies.sqlite file.

const { app, session } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TIMEOUT_MS = 10 * 60 * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
const run = (cmd, args) => new Promise((res) => execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, out) => res(err ? '' : String(out))));

// ---------- which browser ----------
function kindOf(exe) {
  const b = path.basename(exe).toLowerCase();
  if (/firefox|librewolf|waterfox|floorp|zen/.test(b)) return 'firefox';
  if (/chrome|chromium|msedge|microsoft-edge|edge|brave|vivaldi|opera/.test(b)) return 'chromium';
  return null;
}
function nameOf(exe) {
  const b = exe.toLowerCase();
  if (b.includes('firefox')) return 'Firefox';
  if (b.includes('librewolf')) return 'LibreWolf';
  if (b.includes('edge')) return 'Microsoft Edge';
  if (b.includes('brave')) return 'Brave';
  if (b.includes('vivaldi')) return 'Vivaldi';
  if (b.includes('opera')) return 'Opera';
  if (b.includes('chromium')) return 'Chromium';
  if (b.includes('chrome')) return 'Google Chrome';
  return path.basename(exe);
}

async function defaultBrowser() {
  try {
    if (process.platform === 'win32') {
      const q = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']);
      const progId = (q.match(/ProgId\s+REG_SZ\s+(\S+)/) || [])[1];
      if (!progId) return null;
      const c = await run('reg', ['query', `HKCR\\${progId}\\shell\\open\\command`, '/ve']);
      const cmd = (c.match(/REG_(?:EXPAND_)?SZ\s+(.+)/) || [])[1] || '';
      const exe = (cmd.match(/^"([^"]+)"/) || cmd.match(/^(\S+\.exe)/i) || [])[1];
      return exe && exists(exe) ? exe : null;
    }
    if (process.platform === 'darwin') {
      const out = await run('defaults', ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers']);
      const chunk = out.split('},').find((s) => /LSHandlerURLScheme = https;/.test(s)) || '';
      const id = ((chunk.match(/LSHandlerRoleAll = "?([^";]+)"?;/) || [])[1] || '').toLowerCase();
      const map = {
        'org.mozilla.firefox': '/Applications/Firefox.app/Contents/MacOS/firefox',
        'com.google.chrome': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        'com.microsoft.edgemac': '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        'com.brave.browser': '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        'com.vivaldi.vivaldi': '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
        'org.chromium.chromium': '/Applications/Chromium.app/Contents/MacOS/Chromium',
        'io.gitlab.librewolf-community': '/Applications/LibreWolf.app/Contents/MacOS/librewolf',
      };
      return exists(map[id]) ? map[id] : null;
    }
    // Linux
    const desktop = (await run('xdg-settings', ['get', 'default-web-browser'])).trim();
    if (!desktop) return null;
    const dirs = [path.join(os.homedir(), '.local/share/applications'), '/usr/local/share/applications', '/usr/share/applications', '/var/lib/snapd/desktop/applications'];
    for (const d of dirs) {
      const f = path.join(d, desktop);
      if (!exists(f)) continue;
      const execLine = (fs.readFileSync(f, 'utf8').match(/^Exec=(.+)$/m) || [])[1] || '';
      let exe = execLine.split(/\s+/).find((t) => t && !t.includes('=') && t !== 'env');
      if (exe && !exe.startsWith('/')) exe = await whichBin(exe);
      if (exe && exists(exe)) return exe;
    }
  } catch {}
  return null;
}

async function whichBin(bin) {
  for (const d of (process.env.PATH || '').split(':').concat(['/usr/bin', '/usr/local/bin', '/snap/bin'])) {
    const p = path.join(d, bin); if (exists(p)) return p;
  }
  return null;
}

function installedBrowsers() {
  const env = process.env; const list = [];
  if (process.platform === 'win32') {
    const pf = env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = env['LOCALAPPDATA'] || '';
    list.push(
      path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'), path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'), path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(pf, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'), path.join(local, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      path.join(pf, 'Mozilla Firefox\\firefox.exe'), path.join(pf86, 'Mozilla Firefox\\firefox.exe'),
    );
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Firefox.app/Contents/MacOS/firefox', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    const dirs = (env.PATH || '').split(':').concat(['/usr/bin', '/usr/local/bin', '/snap/bin']);
    for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'brave', 'firefox'])
      for (const d of dirs) list.push(path.join(d, b));
  }
  return list.filter(exists);
}

// Your default browser if supported, otherwise the first supported one installed.
async function pickBrowser() {
  const def = await defaultBrowser();
  const exe = (def && kindOf(def)) ? def : installedBrowsers().find((e) => kindOf(e));
  return exe ? { exe, kind: kindOf(exe), name: nameOf(exe), isDefault: exe === def } : null;
}

// ---------- shared helpers ----------
const bare = (d) => String(d || '').replace(/^\./, '');
const KEEP = (domain) => /(^|\.)youtube\.com$/.test(bare(domain)) || /(^|\.)google\.com$/.test(bare(domain));
const isLoggedIn = (cookies) => {
  const yt = cookies.filter((c) => /(^|\.)youtube\.com$/.test(bare(c.domain)));
  const has = (n) => yt.some((c) => c.name === n && c.value);
  return has('LOGIN_INFO') && (has('SAPISID') || has('__Secure-3PAPISID'));
};

// cookies: [{ name, value, domain, path, expires(sec), session, secure, httpOnly, sameSite: 'Strict'|'Lax'|'None'|undefined }]
async function importCookies(cookies, partition) {
  const ses = session.fromPartition(partition);
  const yearFromNow = Date.now() / 1000 + 365 * 24 * 3600;
  let n = 0;
  for (const c of cookies) {
    if (!KEEP(c.domain)) continue;
    let sameSite = c.sameSite === 'Strict' ? 'strict' : c.sameSite === 'Lax' ? 'lax' : c.sameSite === 'None' ? 'no_restriction' : 'unspecified';
    if (sameSite === 'no_restriction' && !c.secure) sameSite = 'unspecified';
    const details = {
      url: `https://${bare(c.domain)}${c.path || '/'}`,
      name: c.name, value: c.value, path: c.path || '/',
      secure: !!c.secure, httpOnly: !!c.httpOnly,
      expirationDate: c.session || !c.expires || c.expires < 0 ? yearFromNow : c.expires,
      sameSite,
    };
    // __Host- cookies must not carry a Domain attribute; host-only cookies don't start with a dot.
    if (!c.name.startsWith('__Host-') && String(c.domain).startsWith('.')) details.domain = c.domain;
    try { await ses.cookies.set(details); n++; } catch {}
  }
  await ses.cookies.flushStore();
  return n;
}

function rmrf(dir) {
  for (let i = 0; i < 12; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch {}
    const t = Date.now(); while (Date.now() - t < 300) { /* wait for the browser to release its files */ }
  }
}

// Snap-packaged browsers on Linux can only write to non-hidden folders in your home.
function profileDir(exe, tag) {
  if (process.platform === 'linux' && exe.startsWith('/snap/')) {
    const snapName = path.basename(exe).replace(/-browser$/, '');
    return path.join(os.homedir(), 'snap', snapName, 'common', `tunewave-${tag}`);
  }
  return path.join(app.getPath('userData'), `signin-${tag}`);
}

// Kill any browser process started with our temporary profile (some browsers hand off to a child process).
async function killByProfile(dir) {
  if (process.platform === 'win32') {
    const esc = dir.replace(/'/g, "''");
    await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${esc}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  } else {
    await run('pkill', ['-f', dir]);
  }
}
async function runningByProfile(dir) {
  if (process.platform === 'win32') {
    const esc = dir.replace(/'/g, "''");
    const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${esc}') }).Count`]);
    return parseInt(out.trim(), 10) > 0;
  }
  return (await run('pgrep', ['-f', dir])).trim().length > 0;
}

// ---------- Chromium (Chrome / Edge / Brave / Vivaldi / Opera) ----------
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

async function readDevToolsPort(dir, proc) {
  const file = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 150; i++) {
    try {
      const [port, wsPath] = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      if (port && wsPath) return `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
    } catch {}
    if (proc.exitCode !== null && i > 25) throw new Error('The browser closed before sign-in started');
    await wait(200);
  }
  throw new Error('The browser did not start in time');
}

const fromCDP = (c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, session: c.session, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite });

async function chromiumFlow(browser, url, partition, ctx) {
  const dir = profileDir(browser.exe, 'chromium');
  ctx.dir = dir;
  rmrf(dir); fs.mkdirSync(dir, { recursive: true });
  const proc = spawn(browser.exe, [
    `--user-data-dir=${dir}`,
    '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--disable-sync',
    '--disable-features=msEdgeFRE,msImplicitSignin,SigninInterceptBubble',
    '--new-window', '--window-size=520,760',
    ...(ctx.extraArgs || []),
    url,
  ], { stdio: 'ignore' });
  ctx.proc = proc;
  proc.on('error', (e) => ctx.finish('error', { message: e.message }));

  ctx.cdp = await connectCDP(await readDevToolsPort(dir, proc));
  ctx.onStatus('opened', { browser: browser.name });
  ctx.closeBrowser = async () => { try { await ctx.cdp.send('Browser.close'); } catch {} setTimeout(() => ctx.cdp && ctx.cdp.close(), 500); };
  const started = Date.now();
  while (!ctx.finished && Date.now() - started < TIMEOUT_MS) {
    await wait(1500);
    let res; try { res = await ctx.cdp.send('Storage.getCookies'); } catch { return ctx.finish('cancelled'); }
    const cookies = (res && res.cookies || []).map(fromCDP);
    if (isLoggedIn(cookies)) {
      await wait(2000); // let the last cookies land
      const all = ((await ctx.cdp.send('Storage.getCookies')).cookies || []).map(fromCDP);
      const n = await importCookies(all, partition);
      return ctx.finish('done', { browser: browser.name, count: n });
    }
  }
  if (!ctx.finished) ctx.finish('error', { message: 'Sign-in timed out' });
}

// ---------- Firefox ----------
const FIREFOX_PREFS = `
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.startup.firstrunSkipsHomepage", true);
user_pref("startup.homepage_welcome_url", "");
user_pref("startup.homepage_welcome_url.additional", "");
user_pref("trailhead.firstrun.didSeeAboutWelcome", true);
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("datareporting.policy.firstRunURL", "");
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("signon.rememberSignons", false);
user_pref("extensions.autoDisableScopes", 15);
`;

function readFirefoxCookies(dir) {
  const src = path.join(dir, 'cookies.sqlite');
  if (!exists(src)) return [];
  const { DatabaseSync } = require('node:sqlite');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-ffc-'));
  try {
    // Copy the database and its write-ahead log so we see cookies Firefox hasn't merged yet.
    fs.copyFileSync(src, path.join(tmp, 'c.sqlite'));
    if (exists(src + '-wal')) fs.copyFileSync(src + '-wal', path.join(tmp, 'c.sqlite-wal'));
    const db = new DatabaseSync(path.join(tmp, 'c.sqlite'));
    let rows = [];
    try { rows = db.prepare('SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies').all(); }
    finally { db.close(); }
    return rows.map((r) => {
      let exp = Number(r.expiry) || 0;
      if (exp > 1e11) exp = exp / 1000; // newer Firefox stores milliseconds
      return {
        name: r.name, value: r.value, domain: r.host, path: r.path, expires: exp, session: false,
        secure: !!r.isSecure, httpOnly: !!r.isHttpOnly,
        sameSite: r.sameSite === 2 ? 'Strict' : r.sameSite === 1 ? 'Lax' : r.sameSite === 0 ? 'None' : undefined,
      };
    });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

const dirExists = (p) => { try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } };

function parseIni(text) {
  const sections = []; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { cur = { name: m[1], kv: {} }; sections.push(cur); continue; }
    const eq = line.indexOf('=');
    if (cur && eq > 0) cur.kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

// Where Firefox keeps its profiles for this install.
function firefoxRoots(exe) {
  const roots = [];
  if (process.platform === 'win32') roots.push(path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox'));
  else if (process.platform === 'darwin') roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Firefox'));
  else {
    if (exe && exe.startsWith('/snap/')) roots.push(path.join(os.homedir(), 'snap', 'firefox', 'common', '.mozilla', 'firefox'));
    roots.push(path.join(os.homedir(), '.mozilla', 'firefox'));
    roots.push(path.join(os.homedir(), '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'));
  }
  return roots.filter(dirExists);
}

// The user's normal (default) Firefox profile folder, read from profiles.ini.
function defaultFirefoxProfile(exe) {
  for (const root of firefoxRoots(exe)) {
    const ini = path.join(root, 'profiles.ini');
    if (!exists(ini)) continue;
    let sections; try { sections = parseIni(fs.readFileSync(ini, 'utf8')); } catch { continue; }
    let rel = null, isRel = '1';
    // Preferred: the [Install...] section names the default profile.
    for (const s of sections) { if (/^Install/i.test(s.name) && s.kv.Default) { rel = s.kv.Default; isRel = s.kv.IsRelative || '1'; break; } }
    if (!rel) { // Otherwise a [Profile...] marked Default=1, else a *.default-release folder.
      let fallback = null;
      for (const s of sections) {
        if (!/^Profile/i.test(s.name) || !s.kv.Path) continue;
        if (s.kv.Default === '1') { rel = s.kv.Path; isRel = s.kv.IsRelative || '1'; break; }
        if (!fallback && /default-release|\.default$/i.test(s.kv.Path)) fallback = { p: s.kv.Path, r: s.kv.IsRelative || '1' };
      }
      if (!rel && fallback) { rel = fallback.p; isRel = fallback.r; }
    }
    if (!rel) continue;
    const dir = isRel === '0' ? rel : path.join(root, rel.replace(/\//g, path.sep));
    if (dirExists(dir)) return dir;
  }
  return null;
}

// Firefox: reuse the user's normal profile, so their saved Google login is already there.
async function firefoxFlow(browser, url, partition, ctx) {
  const profile = defaultFirefoxProfile(browser.exe);
  if (profile) {
    // Already signed in to Google in their everyday Firefox? Just use that, no window.
    let have = []; try { have = readFirefoxCookies(profile); } catch {}
    if (isLoggedIn(have)) {
      const n = await importCookies(have, partition);
      return ctx.finish('done', { browser: browser.name, count: n, reused: true });
    }
    // Not signed in yet: open their real Firefox (saved passwords/passkeys available) and wait.
    ctx.onStatus('opened', { browser: browser.name, real: true });
    try { const p = spawn(browser.exe, [url], { stdio: 'ignore', detached: true }); p.on('error', () => {}); p.unref(); } catch {}
    const started = Date.now();
    while (!ctx.finished && Date.now() - started < TIMEOUT_MS) {
      await wait(2000);
      let c = []; try { c = readFirefoxCookies(profile); } catch {}
      if (isLoggedIn(c)) {
        await wait(2500); // let the last cookies land
        let all = c; try { all = readFirefoxCookies(profile); } catch {}
        const n = await importCookies(all, partition);
        return ctx.finish('done', { browser: browser.name, count: n, reused: false });
      }
    }
    if (!ctx.finished) ctx.finish('error', { message: 'Sign-in timed out' });
    return;
  }
  // No normal profile found: fall back to a clean temporary profile.
  return firefoxTempFlow(browser, url, partition, ctx);
}

async function firefoxTempFlow(browser, url, partition, ctx) {
  const dir = profileDir(browser.exe, 'firefox');
  ctx.dir = dir;
  rmrf(dir); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'user.js'), FIREFOX_PREFS);
  const proc = spawn(browser.exe, ['-profile', dir, '-no-remote', '-new-instance', '-new-window', url], { stdio: 'ignore' });
  ctx.proc = proc;
  proc.on('error', (e) => ctx.finish('error', { message: e.message }));
  ctx.closeBrowser = async () => { try { proc.kill(); } catch {} await killByProfile(dir); };
  ctx.onStatus('opened', { browser: browser.name });

  const started = Date.now(); let notRunning = 0; let tick = 0;
  while (!ctx.finished && Date.now() - started < TIMEOUT_MS) {
    await wait(2000); tick++;
    let cookies = [];
    try { cookies = readFirefoxCookies(dir); } catch {}
    if (isLoggedIn(cookies)) {
      await wait(2500); // let the last cookies land
      let all = cookies; try { all = readFirefoxCookies(dir); } catch {}
      const n = await importCookies(all, partition);
      return ctx.finish('done', { browser: browser.name, count: n });
    }
    // Detect the window being closed (Firefox may hand off to a child process, so check by profile).
    if (tick >= 4 && tick % 3 === 0) {
      const alive = proc.exitCode === null || await runningByProfile(dir);
      notRunning = alive ? 0 : notRunning + 1;
      if (notRunning >= 2) return ctx.finish('cancelled');
    }
  }
  if (!ctx.finished) ctx.finish('error', { message: 'Sign-in timed out' });
}

// ---------- entry point ----------
let active = null;

// onStatus(state, info) states: 'opened' | 'done' | 'cancelled' | 'error' | 'no-browser'
async function signInWithBrowser({ url, partition, onStatus, extraArgs }) {
  if (active) { onStatus('opened', { browser: active.name, again: true }); return; }
  const browser = await pickBrowser();
  if (!browser) { onStatus('no-browser'); return; }

  const ctx = { name: browser.name, onStatus, extraArgs, finished: false, proc: null, cdp: null, dir: null, closeBrowser: null };
  active = ctx;
  ctx.finish = (state, info) => {
    if (ctx.finished) return; ctx.finished = true;
    active = null;
    const dir = ctx.dir;
    (async () => {
      if (ctx.closeBrowser) await ctx.closeBrowser();
      await wait(1500);
      try { if (ctx.proc && ctx.proc.exitCode === null) ctx.proc.kill(); } catch {}
      if (dir) { if (state !== 'cancelled') await killByProfile(dir); rmrf(dir); }
    })();
    onStatus(state, info);
  };
  try {
    if (browser.kind === 'firefox') await firefoxFlow(browser, url, partition, ctx);
    else await chromiumFlow(browser, url, partition, ctx);
  } catch (e) {
    ctx.finish('error', { message: e.message });
  }
}

// Silently refresh the login from the user's browser, without opening any window.
// Keeps the app's shared session in step with the browser's (which rotates over time),
// so Google doesn't invalidate it. Only Firefox exposes its cookies unencrypted, so for
// Chromium browsers this is a no-op (they stay as signed in at import time).
async function silentResync({ partition }) {
  let browser; try { browser = await pickBrowser(); } catch { return { ok: false, reason: 'no-browser' }; }
  if (!browser || browser.kind !== 'firefox') return { ok: false, reason: 'unsupported-browser' };
  const profile = defaultFirefoxProfile(browser.exe);
  if (!profile) return { ok: false, reason: 'no-profile' };
  let cookies = []; try { cookies = readFirefoxCookies(profile); } catch { return { ok: false, reason: 'read-failed' }; }
  if (!isLoggedIn(cookies)) return { ok: false, reason: 'not-logged-in' };
  const n = await importCookies(cookies, partition);
  return { ok: true, count: n };
}

module.exports = { signInWithBrowser, pickBrowser, silentResync, defaultFirefoxProfile };
