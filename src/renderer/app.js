// Tunewave — shell UI logic
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const api = window.tunewave || {
    platform: 'web', setTitlebarColors() {}, nowPlaying() {}, openExternal() {}, artworkColor: async () => null,
    clearSession: async () => true, onPlayerCommand() {}, onShortcut() {},
  };
  const C = window.TW_COLOR;
  const YTM_HOME = 'https://music.youtube.com/';
  const wv = $('#ytm');
  const app = $('#app');

  // ---------- settings ----------
  const DEFAULTS = { theme: 'classic', customAccent: '', pattern: 'none', dynamic: true, dynamicAccent: false, autoClose: true, showNP: true, compact: false, original: false, volume: 100, closeToTray: true, minimizeToTray: false, mediaKeys: true };
  const settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('tw-settings') || '{}') }; } catch { return { ...DEFAULTS }; } })();
  const save = () => { try { localStorage.setItem('tw-settings', JSON.stringify(settings)); } catch {} };

  // ---------- icons ----------
  const setIcon = (el, name) => { if (el && el.dataset.iconNow !== name) { el.innerHTML = window.twIcon(name); el.dataset.iconNow = name; } };
  $$('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));
  // Sleep button keeps a badge child, so add its icon without clobbering it.
  $('#btn-sleep').insertAdjacentHTML('afterbegin', window.twIcon('moon'));

  document.documentElement.classList.add('platform-' + api.platform);
  if (api.platform === 'win32') document.documentElement.style.setProperty('--wc-space', '144px');

  // ---------- toast ----------
  let toastTimer;
  function toastLong(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 6000);
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- webview state ----------
  let wvReady = false;
  const onYTM = () => { try { return wvReady && wv.getURL().startsWith('https://music.youtube.com'); } catch { return false; } };
  // userGesture=true so in-app navigation counts as user-initiated (keeps Back/Forward history working)
  async function run(script, userGesture = false) {
    if (!wvReady) return null;
    try { return await wv.executeJavaScript(script, userGesture); } catch { return null; }
  }
  async function cmd(name, arg) {
    if (!onYTM()) return null;
    const r = await run(window.YTM.commands[name](arg), true);
    setTimeout(poll, 120);
    return r;
  }

  // ---------- theming ----------
  let dynColor = null;
  const theme = () => window.TW_THEMES.find((t) => t.id === settings.theme) || window.TW_THEMES[0];
  const accent = () => (settings.dynamicAccent && dynColor ? C.liftForDark(dynColor) : settings.customAccent || theme().accent);

  function applyTheme() {
    const t = theme(); const a = accent();
    const r = document.documentElement.style;
    r.setProperty('--bg', t.bg); r.setProperty('--surface', t.surface); r.setProperty('--elevated', t.elevated);
    r.setProperty('--hover', t.hover); r.setProperty('--text', t.text); r.setProperty('--subtext', t.subtext);
    r.setProperty('--accent', a); r.setProperty('--on-accent', C.onColor(a));
    applyTint();
    api.setTitlebarColors(t.bg, t.subtext);
    renderThemeGrid();
    applyPattern();
    renderPatternGrid();
    injectYtmCss();
  }
  function applyTint() {
    const r = document.documentElement.style;
    if (settings.dynamic && dynColor) {
      r.setProperty('--tint', C.rgba(dynColor, 0.32));
      r.setProperty('--tint-strong', C.rgba(dynColor, 0.55));
    } else {
      r.setProperty('--tint', 'transparent');
      r.setProperty('--tint-strong', C.rgba(theme().elevated, 0.9));
    }
  }

  function applyPattern() {
    const p = (window.TW_PATTERNS || []).find((x) => x.id === settings.pattern) || window.TW_PATTERNS[0];
    const col = C.rgba(accent(), 0.10);
    document.documentElement.style.setProperty('--pattern', window.twPatternUrl(p, col));
  }
  function renderPatternGrid() {
    const g = $('#pattern-grid'); if (!g) return;
    const col = C.rgba(accent(), 0.55);
    g.innerHTML = window.TW_PATTERNS.map((p) => `
      <button class="pat-card${p.id === settings.pattern ? ' active' : ''}" data-pattern="${p.id}" title="${p.name}">
        <div class="pat-prev" style="background-image:${p.id === 'none' ? 'none' : window.twPatternUrl(p, col)}">${p.id === 'none' ? '<span>None</span>' : ''}</div>
        <span class="pat-name">${p.name}</span>
      </button>`).join('');
  }

  let cssKeys = []; let cssChain = Promise.resolve();
  function injectYtmCss() {
    cssChain = cssChain.then(async () => {
      if (!onYTM()) return;
      for (const k of cssKeys) { try { await wv.removeInsertedCSS(k); } catch {} }
      cssKeys = [];
      try {
        if (!settings.original) cssKeys.push(await wv.insertCSS(window.YTM.layoutCSS));
        cssKeys.push(await wv.insertCSS(window.YTM.themeCSS(theme(), accent())));
      } catch {}
    });
    return cssChain;
  }

  // ---------- layout toggles ----------
  function applyLayout() {
    app.classList.toggle('np-hidden', !settings.showNP);
    app.classList.toggle('compact', settings.compact);
    $('#btn-np').classList.toggle('on', settings.showNP);
  }

  // ---------- navigation ----------
  const PAGE_TYPE = (id) => id.startsWith('VL') ? 'MUSIC_PAGE_TYPE_PLAYLIST' : id.startsWith('MPRE') ? 'MUSIC_PAGE_TYPE_ALBUM' : id.startsWith('UC') ? 'MUSIC_PAGE_TYPE_ARTIST' : null;
  const browse = (id) => {
    const pt = PAGE_TYPE(id);
    return pt ? { browseEndpoint: { browseId: id, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: pt } } } } : { browseEndpoint: { browseId: id } };
  };
  const ROUTES = {
    home: { ep: browse('FEmusic_home'), url: '' },
    explore: { ep: browse('FEmusic_explore'), url: 'explore' },
    library: { ep: browse('FEmusic_library_landing'), url: 'library' },
    'lib-playlists': { ep: browse('FEmusic_liked_playlists'), url: 'library/playlists' },
    'lib-songs': { ep: browse('FEmusic_liked_videos'), url: 'library/songs' },
    'lib-albums': { ep: browse('FEmusic_liked_albums'), url: 'library/albums' },
    'lib-artists': { ep: browse('FEmusic_library_corpus_track_artists'), url: 'library/artists' },
  };
  async function go(endpoint, fallbackPath) {
    if (onYTM()) {
      await closePlayerPageIfOpen();
      const ok = await cmd('navigate', endpoint);
      if (ok) return;
    }
    wv.loadURL(YTM_HOME + fallbackPath);
  }
  function nav(key) {
    if (key === 'search-focus') { $('#search-input').focus(); $('#search-input').select(); return; }
    const r = ROUTES[key]; if (r) go(r.ep, r.url);
  }
  function openPlaylist(id) {
    const fallback = id.startsWith('VL') ? 'playlist?list=' + encodeURIComponent(id.slice(2)) : 'browse/' + encodeURIComponent(id);
    go(browse(id), fallback);
  }
  function search(q) {
    q = q.trim(); if (!q) return;
    go({ searchEndpoint: { query: q } }, 'search?q=' + encodeURIComponent(q));
  }
  async function closePlayerPageIfOpen() {
    if (state.playerPageOpen) { userWantsPlayer = false; await run(window.YTM.commands.togglePlayerPage()); state.playerPageOpen = false; }
  }

  function updateNavState() {
    let url; try { url = new URL(wv.getURL()); } catch { return; }
    const onMusic = url.hostname === 'music.youtube.com';
    $('#login-banner').hidden = onMusic || !wvReady;
    $('#btn-back').disabled = !wv.canGoBack();
    $('#btn-forward').disabled = !wv.canGoForward();
    const p = url.pathname;
    const key = p === '/' ? 'home' : p.startsWith('/explore') ? 'explore' : p.startsWith('/search') ? 'search-focus' : null;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.nav === key));
    $('#btn-home').classList.toggle('active', key === 'home');
    const libMap = { '/library/playlists': 'lib-playlists', '/library/songs': 'lib-songs', '/library/albums': 'lib-albums', '/library/artists': 'lib-artists' };
    $$('.chip').forEach((c) => c.classList.toggle('active', libMap[p] === c.dataset.nav));
    const list = url.searchParams.get('list');
    activePlaylist = p === '/playlist' && list ? 'VL' + list : p.startsWith('/browse/') ? p.slice(8) : null;
    $$('.pl-item').forEach((el) => el.classList.toggle('active', el.dataset.id === activePlaylist));
    if (p.startsWith('/search')) { const q = url.searchParams.get('q'); if (q && document.activeElement !== $('#search-input')) $('#search-input').value = q; }
  }

  // ---------- playlists ----------
  let playlists = { loggedIn: null, items: [] };
  let activePlaylist = null;
  async function refreshPlaylists(showToast) {
    if (!onYTM()) return;
    const r = await run(window.YTM.playlistsScript);
    if (r) { playlists = r; renderPlaylists(); if (showToast) toast(r.loggedIn ? `Library refreshed · ${r.items.length} playlists` : 'Sign in to see your playlists'); }
  }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function renderPlaylists() {
    const box = $('#playlist-list');
    const f = $('#lib-filter').value.trim().toLowerCase();
    if (playlists.loggedIn === false) {
      box.innerHTML = `<div class="lib-empty"><strong>Sign in to YouTube Music</strong><p>Use the Google account that has YouTube Premium. Your playlists, likes and library will show up here.</p><button class="pill" data-act="signin">Sign in</button></div>`;
      return;
    }
    const liked = { id: 'VLLM', title: 'Liked Music', subtitle: 'Auto playlist', liked: true };
    const items = [liked, ...playlists.items.filter((p) => p.id !== 'VLLM')].filter((p) => !f || p.title.toLowerCase().includes(f) || (p.subtitle || '').toLowerCase().includes(f));
    box.innerHTML = items.map((p) => `
      <button class="pl-item${p.id === activePlaylist ? ' active' : ''}" data-id="${esc(p.id)}" title="${esc(p.title)}">
        ${p.liked ? `<div class="pl-thumb liked">${window.twIcon('heart')}</div>` : p.art ? `<img class="pl-thumb" src="${esc(p.art)}" alt="" loading="lazy" />` : `<div class="pl-thumb">${window.twIcon('note')}</div>`}
        <div class="pl-info"><div class="pl-name">${esc(p.title)}</div><div class="pl-sub">${esc(p.subtitle)}</div></div>
      </button>`).join('') || `<div class="q-empty">No matches.</div>`;
  }

  // ---------- player state ----------
  let state = { hasTrack: false, playing: false, time: 0, duration: 0, volume: 100, muted: false, repeat: 'off', likeStatus: '', playerPageOpen: false };
  let stamp = performance.now();
  let lastKey = ''; let lastArt = ''; let polling = false;
  let userWantsPlayer = false; let lastPlayerToggle = 0;
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
  const bigArt = (u) => u ? u.replace(/=w\d+-h\d+[^&]*$/, '=w800-h800-l90-rj').replace(/\/(hq|mq|sd)?default\.jpg/, '/maxresdefault.jpg') : '';

  async function poll() {
    if (polling || !onYTM()) return;
    polling = true;
    try {
      const s = await run(window.YTM.stateScript);
      if (s && s.ok) applyState(s);
    } finally { polling = false; }
  }

  function applyState(s) {
    const prev = state;
    state = s; stamp = performance.now();
    app.classList.toggle('no-track', !s.hasTrack);
    $('#mini').classList.toggle('no-track', !s.hasTrack);

    // track info
    const key = `${s.title}|${s.artist}|${s.art}`;
    if (key !== lastKey) {
      lastKey = key;
      $('#pl-title').textContent = s.hasTrack ? s.title : '';
      $('#pl-artist').textContent = s.hasTrack ? s.artist : '';
      $('#np-title').textContent = s.hasTrack ? s.title : 'Nothing playing';
      $('#np-artist').textContent = s.hasTrack ? [s.artist, s.album].filter(Boolean).join(' · ') : 'Pick something to listen to';
      $('#mini-title').textContent = s.hasTrack ? s.title : 'Nothing playing';
      $('#mini-artist').textContent = s.hasTrack ? s.artist : '';
      setArt(s.hasTrack ? s.art : '');
      api.nowPlaying({ hasTrack: s.hasTrack, playing: s.playing, title: s.title, artist: s.artist });
      setTimeout(refreshQueue, 600);
    }
    if (prev.playing !== s.playing || prev.hasTrack !== s.hasTrack) {
      api.nowPlaying({ hasTrack: s.hasTrack, playing: s.playing, title: s.title, artist: s.artist });
    }
    setIcon($('#btn-play'), s.playing ? 'pause' : 'play');
    setIcon($('#mini-play'), s.playing ? 'pause' : 'play');
    $('#btn-play').title = s.playing ? 'Pause (Space)' : 'Play (Space)';

    // volume
    if (!volSlider.dragging) volSlider.set(s.muted ? 0 : s.volume / 100);
    setIcon($('#btn-mute'), s.muted || s.volume === 0 ? 'volOff' : s.volume < 50 ? 'volDown' : 'volUp');

    // repeat / like
    setIcon($('#btn-repeat'), s.repeat === 'one' ? 'repeatOne' : 'repeat');
    $('#btn-repeat').classList.toggle('on', s.repeat !== 'off');
    $('#btn-repeat').title = s.repeat === 'one' ? 'Repeat one' : s.repeat === 'all' ? 'Repeat all' : 'Repeat off';
    const liked = s.likeStatus === 'LIKE';
    for (const b of [$('#pl-like'), $('#np-like'), $('#mini-like')]) { setIcon(b, liked ? 'heart' : 'heartOutline'); b.classList.toggle('liked', liked); b.title = liked ? 'Remove from Liked Music' : 'Save to Liked Music'; }

    // YouTube Music's own full-screen player page
    setIcon($('#btn-fullplayer'), s.playerPageOpen ? 'closeFull' : 'openFull');
    $('#btn-fullplayer').classList.toggle('on', s.playerPageOpen);
    if (s.playerPageOpen && !prev.playerPageOpen && settings.autoClose && !userWantsPlayer && Date.now() - lastPlayerToggle > 1200) {
      run(window.YTM.commands.togglePlayerPage());
    }
    if (!s.playerPageOpen && prev.playerPageOpen) userWantsPlayer = false;

    // account
    if (s.loggedIn !== prev.loggedIn) {
      if (s.loggedIn !== null && playlists.loggedIn !== s.loggedIn) refreshPlaylists();
      $('#account-status').textContent = s.loggedIn ? "You're signed in to YouTube Music. Premium features (no ads, background play, high quality audio) come from your account." : s.loggedIn === false ? 'Not signed in. Sign in with the Google account that has YouTube Premium.' : 'Checking…';
      $('#btn-signin').hidden = !!s.loggedIn;
    }
    if (s.accountPhoto && $('#btn-account').dataset.photo !== s.accountPhoto) {
      $('#btn-account').dataset.photo = s.accountPhoto;
      $('#btn-account').innerHTML = `<img src="${esc(s.accountPhoto)}" alt="" />`;
    }
  }

  function setArt(url) {
    if (url === lastArt) return; lastArt = url;
    for (const [img, wrap, big] of [[$('#pl-art'), $('#pl-art-wrap'), false], [$('#np-art'), $('.np-art-wrap'), true], [$('#mini-art'), $('.mini-art-wrap'), true]]) {
      if (!url) { img.removeAttribute('src'); wrap.classList.remove('has-art'); continue; }
      const src = big ? bigArt(url) : url;
      img.onerror = () => { if (big && img.src !== url) img.src = url; };
      img.onload = () => wrap.classList.add('has-art');
      img.src = src;
    }
    if (!url) { dynColor = null; applyTint(); if (settings.dynamicAccent) applyTheme(); return; }
    if (settings.dynamic || settings.dynamicAccent) {
      api.artworkColor(url).then((c) => {
        if (url !== lastArt) return;
        dynColor = c; applyTint(); if (settings.dynamicAccent) applyTheme();
      });
    }
  }

  // smooth progress between polls
  function tick() {
    if (!progSlider.dragging) {
      const d = state.duration || 0;
      const t = state.playing ? Math.min(d || Infinity, state.time + (performance.now() - stamp) / 1000) : state.time;
      progSlider.set(d ? t / d : 0);
      $('#t-cur').textContent = fmt(t);
      $('#t-dur').textContent = fmt(d);
      const mf = $('.mini-fill'); if (mf) mf.style.width = (d ? Math.min(100, (t / d) * 100) : 0) + '%';
    }
    updateSleepUI();
    requestAnimationFrame(tick);
  }

  // ---------- queue ----------
  let lastQueueJSON = '';
  async function refreshQueue() {
    if (!settings.showNP || !onYTM()) return;
    const q = await run(window.YTM.queueScript);
    if (!Array.isArray(q)) return;
    const json = JSON.stringify(q);
    if (json === lastQueueJSON) return; lastQueueJSON = json;
    const box = $('#np-queue');
    const cur = q.findIndex((x) => x.current);
    const upcoming = (cur >= 0 ? q.slice(cur + 1) : q).slice(0, 25);
    if (!state.hasTrack || !upcoming.length) {
      box.innerHTML = `<div class="q-empty">${state.hasTrack ? 'Nothing queued after this song.' : 'Play something and the queue will show up here.'}</div>`;
      return;
    }
    box.innerHTML = upcoming.map((x) => `
      <button class="q-item" data-qi="${x.i}" title="Play ${esc(x.title)}">
        ${x.art ? `<img src="${esc(x.art)}" alt="" loading="lazy" />` : '<div class="q-ph"></div>'}
        <div class="q-info"><div class="q-title">${esc(x.title)}</div><div class="q-artist">${esc(x.artist)}</div></div>
        <span class="q-dur">${esc(x.duration)}</span>
      </button>`).join('');
  }

  // ---------- sliders ----------
  function makeSlider(el, { onInput, onCommit }) {
    const s = { dragging: false, value: 0 };
    const frac = (e) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    s.set = (v) => { s.value = v; el.style.setProperty('--pct', (Math.max(0, Math.min(1, v || 0)) * 100).toFixed(3) + '%'); };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      s.dragging = true; el.classList.add('dragging'); el.setPointerCapture(e.pointerId);
      s.set(frac(e)); onInput && onInput(s.value);
    });
    el.addEventListener('pointermove', (e) => { if (!s.dragging) return; s.set(frac(e)); onInput && onInput(s.value); });
    const end = (e) => { if (!s.dragging) return; s.dragging = false; el.classList.remove('dragging'); onCommit && onCommit(s.value); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    return s;
  }
  const progSlider = makeSlider($('#progress'), {
    onInput: (v) => { $('#t-cur').textContent = fmt(v * (state.duration || 0)); },
    onCommit: (v) => { const t = v * (state.duration || 0); state.time = t; stamp = performance.now(); cmd('seek', t); },
  });
  let volThrottle = 0;
  const setVolume = (v, commit) => {
    const val = Math.round(v * 100);
    state.volume = val; state.muted = false;
    settings.volume = val; save();
    const now = Date.now();
    if (commit || now - volThrottle > 60) { volThrottle = now; cmd('volume', val); }
  };
  const volSlider = makeSlider($('#volume'), { onInput: (v) => setVolume(v, false), onCommit: (v) => setVolume(v, true) });
  $('#volume').addEventListener('wheel', (e) => { e.preventDefault(); const v = Math.max(0, Math.min(1, volSlider.value + (e.deltaY < 0 ? 0.05 : -0.05))); volSlider.set(v); setVolume(v, true); }, { passive: false });
  function nudgeVolume(d) { const v = Math.max(0, Math.min(1, (state.muted ? 0 : state.volume / 100) + d)); volSlider.set(v); setVolume(v, true); toast(`Volume ${Math.round(v * 100)}%`); }

  // ---------- modal ----------
  function openModal(tab) {
    $('#modal').hidden = false;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    syncSettingsUI();
  }
  const closeModal = () => ($('#modal').hidden = true);
  function renderThemeGrid() {
    const g = $('#theme-grid'); if (!g) return;
    g.innerHTML = window.TW_THEMES.map((t) => `
      <button class="theme-card${t.id === settings.theme ? ' active' : ''}" data-theme="${t.id}" style="--tp-accent:${t.accent}">
        <div class="theme-prev" style="background:${t.bg}">
          <div class="tp-side" style="background:${t.surface}"></div>
          <div class="tp-main" style="background:linear-gradient(180deg, ${t.elevated}, ${t.surface})"></div>
          <div class="tp-bar" style="background:${t.bg}"><i></i></div>
        </div>
        <div class="theme-name"><span>${esc(t.name)}</span>${t.id === settings.theme ? window.twIcon('check') : ''}</div>
      </button>`).join('');
  }
  function syncSettingsUI() {
    $('#accent-picker').value = settings.customAccent || theme().accent;
    $('#opt-dynamic').checked = settings.dynamic;
    $('#opt-dynamic-accent').checked = settings.dynamicAccent;
    $('#opt-autoclose').checked = settings.autoClose;
    $('#opt-np').checked = settings.showNP;
    $('#opt-compact').checked = settings.compact;
    $('#opt-original').checked = settings.original;
    $('#opt-close-tray').checked = settings.closeToTray;
    $('#opt-min-tray').checked = settings.minimizeToTray;
    $('#opt-media-keys').checked = settings.mediaKeys;
  }

  // ---------- account ----------
  async function signIn() {
    closeModal();
    if (!localStorage.getItem(PRIVACY_KEY)) { openPrivacy(); return; }
    const url = onYTM() ? await run(window.YTM.commands.signInUrl()) : '';
    if (api.openSignIn) { api.openSignIn(url || ''); toast('Opening your browser to sign in…'); }
    else wv.loadURL(url || YTM_HOME);
  }
  function afterSignIn() {
    wv.loadURL(YTM_HOME);
    toastLong('Signed in with your Google account. Loading your library…');
    setTimeout(() => refreshPlaylists(), 4000);
  }
  async function signOut() {
    if (!confirm('Sign out of YouTube Music and clear all saved data in Tunewave?')) return;
    await api.clearSession();
    playlists = { loggedIn: false, items: [] }; renderPlaylists();
    $('#btn-account').dataset.photo = ''; $('#btn-account').innerHTML = `<span>${window.twIcon('person')}</span>`;
    wv.loadURL(YTM_HOME); closeModal(); toast('Signed out');
  }

  // ---------- events: webview ----------
  wv.addEventListener('dom-ready', () => {
    wvReady = true;
    injectYtmCss().then(() => setTimeout(() => $('#loader').classList.add('gone'), onYTM() ? 350 : 0));
    updateNavState();
    if (onYTM()) {
      setTimeout(() => refreshPlaylists(), 2500);
      // restore last volume once the player exists
      setTimeout(() => { if (settings.volume !== undefined && !state.hasTrack) run(window.YTM.commands.volume(settings.volume)); }, 3000);
    }
  });
  wv.addEventListener('did-start-loading', () => { if (!wvReady) $('#loader').classList.remove('gone'); });
  wv.addEventListener('did-navigate', () => { updateNavState(); });
  wv.addEventListener('did-navigate-in-page', () => updateNavState());
  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3 || !e.isMainFrame) return;
    const l = $('#loader');
    l.classList.remove('gone');
    l.innerHTML = `<p>Couldn't reach YouTube Music (${esc(e.errorDescription || e.errorCode)}).</p><button class="pill" id="btn-retry">Try again</button>`;
    $('#btn-retry').onclick = () => { l.innerHTML = '<div class="spinner"></div><p>Loading YouTube Music…</p>'; wv.loadURL(YTM_HOME); };
  });
  wv.addEventListener('page-title-updated', updateNavState);

  // ---------- events: shell ----------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-act], .pl-art-wrap');
    if (!t) return;
    if (t.tagName === 'BUTTON' && !t.closest('#modal')) t.blur();
    if (t.dataset.nav) return nav(t.dataset.nav);
    if (t.dataset.act === 'signin') return signIn();
    if (t.classList.contains('pl-item')) return openPlaylist(t.dataset.id);
    if (t.classList.contains('q-item')) return cmd('playQueueItem', Number(t.dataset.qi));
    if (t.dataset.sleep) { setSleep(t.dataset.sleep); closeSleepMenu(); return; }
    if (t.dataset.mcmd) return cmd(t.dataset.mcmd);
    if (t.dataset.theme) { settings.theme = t.dataset.theme; settings.customAccent = ''; save(); applyTheme(); syncSettingsUI(); return; }
    if (t.dataset.pattern) { settings.pattern = t.dataset.pattern; save(); applyPattern(); renderPatternGrid(); return; }
    if (t.dataset.tab) return openModal(t.dataset.tab);
    switch (t.id) {
      case 'btn-back': wv.canGoBack() && wv.goBack(); break;
      case 'btn-forward': wv.canGoForward() && wv.goForward(); break;
      case 'btn-home': nav('home'); break;
      case 'btn-themes': openModal('themes'); break;
      case 'btn-settings': openModal('settings'); break;
      case 'btn-account': openModal('account'); break;
      case 'btn-modal-close': closeModal(); break;
      case 'btn-play': cmd('playPause'); break;
      case 'btn-next': cmd('next'); break;
      case 'btn-prev': cmd('prev'); break;
      case 'btn-shuffle': cmd('shuffle').then(() => toast('Queue shuffled')); break;
      case 'btn-repeat': cmd('repeat'); break;
      case 'pl-like': case 'np-like': cmd('like'); break;
      case 'btn-mute': cmd('mute'); break;
      case 'btn-sleep': $('#sleep-menu').hidden ? openSleepMenu() : closeSleepMenu(); break;
      case 'btn-mini': enterMini(); break;
      case 'btn-mini-restore': exitMini(); break;
      case 'pl-art-wrap': case 'btn-fullplayer': case 'btn-open-queue':
        lastPlayerToggle = Date.now(); userWantsPlayer = !state.playerPageOpen; cmd('togglePlayerPage'); break;
      case 'btn-np': case 'btn-np-close': settings.showNP = t.id === 'btn-np' ? !settings.showNP : false; save(); applyLayout(); lastQueueJSON = ''; refreshQueue(); break;
      case 'btn-update': if (!t.classList.contains('busy')) api.installUpdate && api.installUpdate(); break;
      case 'btn-check-update': api.checkUpdate && api.checkUpdate(); break;
      case 'btn-refresh-lib': refreshPlaylists(true); break;
      case 'btn-accent-reset': settings.customAccent = ''; save(); applyTheme(); syncSettingsUI(); break;
      case 'btn-signin': signIn(); break;
      case 'btn-signout': signOut(); break;
      case 'btn-reload': case 'btn-cancel-login': wv.loadURL(YTM_HOME); closeModal(); break;
    }
  });
  $('.modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('mousedown', (e) => { if (!$('#sleep-menu').hidden && !e.target.closest('#sleep-menu') && !e.target.closest('#btn-sleep')) closeSleepMenu(); });
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); search($('#search-input').value); $('#search-input').blur(); });
  $('#lib-filter').addEventListener('input', renderPlaylists);
  $('#accent-picker').addEventListener('input', (e) => { settings.customAccent = e.target.value; settings.dynamicAccent = false; save(); applyTheme(); $('#opt-dynamic-accent').checked = false; });
  const bindOpt = (id, key, after) => $(id).addEventListener('change', (e) => { settings[key] = e.target.checked; save(); after && after(); });
  bindOpt('#opt-dynamic', 'dynamic', () => { if (settings.dynamic && lastArt && !dynColor) { const a = lastArt; lastArt = ''; setArt(a); } applyTint(); });
  bindOpt('#opt-dynamic-accent', 'dynamicAccent', () => { if (settings.dynamicAccent && lastArt && !dynColor) { const a = lastArt; lastArt = ''; setArt(a); } applyTheme(); });
  bindOpt('#opt-autoclose', 'autoClose');
  bindOpt('#opt-np', 'showNP', () => { applyLayout(); lastQueueJSON = ''; refreshQueue(); });
  bindOpt('#opt-compact', 'compact', applyLayout);
  bindOpt('#opt-original', 'original', injectYtmCss);
  const pushTray = () => api.setTrayBehavior && api.setTrayBehavior({ closeToTray: settings.closeToTray, minimizeToTray: settings.minimizeToTray });
  bindOpt('#opt-close-tray', 'closeToTray', pushTray);
  bindOpt('#opt-min-tray', 'minimizeToTray', pushTray);
  bindOpt('#opt-media-keys', 'mediaKeys', () => api.setMediaKeys && api.setMediaKeys(settings.mediaKeys));

  function shortcut(name) {
    switch (name) {
      case 'search': $('#search-input').focus(); $('#search-input').select(); break;
      case 'back': wv.canGoBack() && wv.goBack(); break;
      case 'forward': wv.canGoForward() && wv.goForward(); break;
      case 'reload': wv.reload(); break;
      case 'next': cmd('next'); break;
      case 'prev': cmd('prev'); break;
      case 'volUp': nudgeVolume(0.05); break;
      case 'volDown': nudgeVolume(-0.05); break;
    }
  }
  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches('input, textarea');
    if (e.key === 'Escape') { if (!$('#sleep-menu').hidden) { closeSleepMenu(); return; } if (!$('#privacy').hidden) { if (localStorage.getItem(PRIVACY_KEY)) closePrivacy(); return; } if (!$('#modal').hidden) closeModal(); else if (typing) e.target.blur(); return; }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'k' || e.key === 'l')) { e.preventDefault(); return shortcut('search'); }
    if (ctrl && e.key === 'r') { e.preventDefault(); return shortcut('reload'); }
    if (e.altKey && e.key === 'ArrowLeft') return shortcut('back');
    if (e.altKey && e.key === 'ArrowRight') return shortcut('forward');
    if (typing) return;
    if (ctrl && e.key === 'ArrowRight') return shortcut('next');
    if (ctrl && e.key === 'ArrowLeft') return shortcut('prev');
    if (ctrl && e.key === 'ArrowUp') { e.preventDefault(); return shortcut('volUp'); }
    if (ctrl && e.key === 'ArrowDown') { e.preventDefault(); return shortcut('volDown'); }
    if (e.key === ' ' && !e.target.closest('#modal')) { e.preventDefault(); cmd('playPause'); }
    if (e.key === 'm' || e.key === 'M') cmd('mute');
  });
  // mouse back/forward buttons
  window.addEventListener('mouseup', (e) => { if (e.button === 3) shortcut('back'); if (e.button === 4) shortcut('forward'); });

  api.onPlayerCommand((c) => cmd(c));
  if (api.onShortcut) api.onShortcut(shortcut);
  if (api.onSignedIn) api.onSignedIn(afterSignIn);
  if (api.onSigninStatus) api.onSigninStatus((s) => {
    const msg = {
      opened: s.real
        ? `Opening ${s.browser || 'your browser'}. If you're already signed in to Google there, Tunewave will pick it up; otherwise sign in and it'll continue automatically.`
        : `Sign in with Google in the ${s.browser || 'browser'} window. It closes by itself when you're done.`,
      cancelled: 'Sign-in cancelled.',
      error: `Sign-in didn't finish${s.message ? ': ' + s.message : ''}. Try again.`,
      fallback: "Couldn't find a supported browser (Firefox, Chrome, Edge, Brave), so trying sign-in inside Tunewave instead.",
    }[s.state];
    if (msg) toastLong(msg);
  });

  // ---------- privacy notice ----------
  const PRIVACY_KEY = 'tw-privacy-ack-v1';
  function openPrivacy() { $('#privacy').hidden = false; }
  function closePrivacy() { $('#privacy').hidden = true; try { localStorage.setItem(PRIVACY_KEY, '1'); } catch {} }
  $('#btn-privacy-ok').addEventListener('click', closePrivacy);
  $('#privacy-backdrop').addEventListener('click', () => { if (localStorage.getItem(PRIVACY_KEY)) closePrivacy(); });
  $('#btn-privacy-source').addEventListener('click', () => api.openExternal && api.openExternal('https://github.com/YokaiKatana/Tunewave'));
  $('#btn-privacy-show').addEventListener('click', () => { closeModal(); openPrivacy(); });
  let privacyShown = false;
  try { if (!localStorage.getItem(PRIVACY_KEY)) { privacyShown = true; setTimeout(openPrivacy, 600); } } catch {}

  // ---------- mini player ----------
  function enterMini() { $('#mini').hidden = false; closeSleepMenu(); closeModal(); if (api.setMiniMode) api.setMiniMode(true); }
  function exitMini() { $('#mini').hidden = true; if (api.setMiniMode) api.setMiniMode(false); }

  // ---------- sleep timer ----------
  let sleep = { endsAt: 0, timer: null, mode: null };
  function clearSleep(announce) {
    if (sleep.timer) clearTimeout(sleep.timer);
    sleep = { endsAt: 0, timer: null, mode: null };
    $('#btn-sleep').classList.remove('on');
    $('#sleep-badge').hidden = true;
    $('#btn-sleep').title = 'Sleep timer';
    if (announce) toast('Sleep timer off');
  }
  function fireSleep() {
    if (state.playing) cmd('playPause');
    clearSleep(false);
    toast('Sleep timer — paused');
  }
  function setSleep(val) {
    if (val === 'off') { clearSleep(true); return; }
    if (sleep.timer) clearTimeout(sleep.timer);
    let ms;
    if (val === 'endoftrack') {
      const rem = (state.duration || 0) - (state.time || 0);
      ms = Math.max(3, rem) * 1000;
      sleep.mode = 'track';
    } else {
      ms = Number(val) * 60 * 1000;
      sleep.mode = 'min';
    }
    sleep.endsAt = Date.now() + ms;
    sleep.timer = setTimeout(fireSleep, ms);
    $('#btn-sleep').classList.add('on');
    toast(val === 'endoftrack' ? 'Sleep timer: end of this song' : `Sleep timer: ${val} min`);
  }
  function openSleepMenu() {
    const m = $('#sleep-menu'); const b = $('#btn-sleep').getBoundingClientRect();
    m.hidden = false;
    const mr = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(b.left + b.width / 2 - mr.width / 2, window.innerWidth - mr.width - 8)) + 'px';
    m.style.top = (b.top - mr.height - 8) + 'px';
    $('.pop-off', m) && ($('#sleep-menu .pop-off').hidden = !sleep.endsAt);
  }
  const closeSleepMenu = () => ($('#sleep-menu').hidden = true);
  function updateSleepUI() {
    if (!sleep.endsAt) return;
    const remSec = Math.max(0, Math.round((sleep.endsAt - Date.now()) / 1000));
    const mm = Math.floor(remSec / 60), ss = remSec % 60;
    const badge = $('#sleep-badge');
    badge.hidden = false;
    badge.textContent = mm >= 1 ? mm + 'm' : ss + 's';
    $('#btn-sleep').title = `Sleep timer — ${mm}:${String(ss).padStart(2, '0')} left`;
  }

  // ---------- updates ----------
  function showUpdate(u) {
    if (!u) return;
    const pill = $('#btn-update'); const txt = $('#update-status-text');
    $('#app-version').textContent = u.current ? 'v' + u.current : '';
    pill.classList.remove('busy');
    switch (u.state) {
      case 'downloading':
        pill.hidden = false; pill.classList.add('busy');
        pill.textContent = `Downloading update${u.percent ? ' ' + u.percent + '%' : '…'}`;
        txt.textContent = `Downloading version ${u.version || ''}…`; break;
      case 'ready':
        pill.hidden = false; pill.textContent = 'Restart to update';
        pill.title = `Version ${u.version} is ready. Restart Tunewave to install it.`;
        txt.textContent = `Version ${u.version} is downloaded. It installs when you restart Tunewave.`; break;
      case 'available-portable':
        pill.hidden = false; pill.textContent = `Update ${u.version} available`;
        pill.title = 'This is the portable version, so download the new one from GitHub.';
        txt.textContent = `Version ${u.version} is out. The portable version can't update itself, so download the new zip (or switch to the installer to get automatic updates).`; break;
      case 'checking': txt.textContent = 'Checking for updates…'; break;
      case 'latest': pill.hidden = true; txt.textContent = "You're on the latest version."; break;
      case 'error': txt.textContent = "Couldn't check for updates right now. Tunewave will try again later."; break;
      case 'dev': txt.textContent = 'Update checks only run in the packaged app.'; break;
      default: break;
    }
  }
  if (api.onUpdate) {
    api.onUpdate(showUpdate);
    api.getUpdate().then(showUpdate);
  }

  // ---------- start ----------
  if (api.setTrayBehavior) api.setTrayBehavior({ closeToTray: settings.closeToTray, minimizeToTray: settings.minimizeToTray });
  if (api.setMediaKeys) api.setMediaKeys(settings.mediaKeys);
  applyLayout();
  applyTheme();
  renderPlaylists();
  setInterval(poll, 450);
  setInterval(refreshQueue, 3000);
  setInterval(() => refreshPlaylists(), 5 * 60 * 1000);
  requestAnimationFrame(tick);
})();
