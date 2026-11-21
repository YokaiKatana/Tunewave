// Mini player window. Gets playback state from the main window (via the main process)
// and sends control commands back. Shares localStorage with the main window, so it can
// read the saved theme, but colours are also pushed in each state update to stay in sync
// (including the dynamic album-art tint).
(() => {
  const $ = (s) => document.querySelector(s);
  const api = window.tunewave || {};
  const C = window.TW_COLOR;

  const setIcon = (el, name) => { if (el && el.dataset.iconNow !== name) { el.innerHTML = window.twIcon(name); el.dataset.iconNow = name; } };
  document.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));

  const root = $('#mini-root');
  const bigArt = (u) => u ? u.replace(/=w\d+-h\d+[^&]*$/, '=w800-h800-l90-rj').replace(/\/(hq|mq|sd)?default\.jpg/, '/maxresdefault.jpg') : '';

  // Apply theme from saved settings at startup so first paint is themed.
  try {
    const s = JSON.parse(localStorage.getItem('tw-settings') || '{}');
    const t = (window.TW_THEMES || []).find((x) => x.id === s.theme);
    if (t) {
      const r = document.documentElement.style;
      r.setProperty('--bg', t.bg); r.setProperty('--surface', t.surface); r.setProperty('--elevated', t.elevated);
      r.setProperty('--hover', t.hover); r.setProperty('--text', t.text); r.setProperty('--subtext', t.subtext);
      const a = s.customAccent || t.accent;
      r.setProperty('--accent', a); r.setProperty('--on-accent', C.onColor(a));
      r.setProperty('--tint-strong', C.rgba(t.elevated, 0.9));
    }
  } catch {}

  let st = { playing: false, hasTrack: false, time: 0, duration: 0 };
  let stamp = performance.now();
  let lastArt = '', lastKey = '';
  const fmt = (x) => { x = Math.max(0, Math.floor(x || 0)); const m = Math.floor(x / 60), s = x % 60; return `${m}:${String(s).padStart(2, '0')}`; };

  function applyColors(c) {
    if (!c) return;
    const r = document.documentElement.style;
    for (const k of ['bg', 'surface', 'elevated', 'hover', 'text', 'subtext', 'accent', 'onAccent', 'tint', 'tintStrong']) {
      if (c[k]) r.setProperty('--' + k.replace(/([A-Z])/g, '-$1').toLowerCase(), c[k]);
    }
  }

  function onState(s) {
    st = s; stamp = performance.now();
    applyColors(s.css);
    root.classList.toggle('no-track', !s.hasTrack);
    const key = `${s.title}|${s.artist}|${s.art}`;
    if (key !== lastKey) {
      lastKey = key;
      $('#m-title').textContent = s.hasTrack ? s.title : 'Nothing playing';
      $('#m-artist').textContent = s.hasTrack ? s.artist : '';
      if (s.art !== lastArt) {
        lastArt = s.art;
        const img = $('#m-art'), wrap = $('.m-art-wrap');
        if (s.art) { img.onload = () => wrap.classList.add('has-art'); img.onerror = () => { if (img.src !== s.art) img.src = s.art; }; img.src = bigArt(s.art); }
        else { img.removeAttribute('src'); wrap.classList.remove('has-art'); }
      }
    }
    setIcon($('#m-play'), s.playing ? 'pause' : 'play');
    const likeBtn = $('#m-like');
    setIcon(likeBtn, s.liked ? 'heart' : 'heartOutline');
    likeBtn.classList.toggle('liked', !!s.liked);
  }

  function tick() {
    const d = st.duration || 0;
    const t = st.playing ? Math.min(d || Infinity, st.time + (performance.now() - stamp) / 1000) : st.time;
    $('.m-fill').style.width = (d ? Math.min(100, (t / d) * 100) : 0) + '%';
    requestAnimationFrame(tick);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mcmd) { api.miniCmd && api.miniCmd(b.dataset.mcmd); return; }
    if (b.id === 'mini-min') { api.miniMinimize && api.miniMinimize(); return; }
    if (b.id === 'mini-back' || b.id === 'mini-exit') { api.miniBackToFull && api.miniBackToFull(); return; }
  });

  if (api.onMiniState) api.onMiniState(onState);
  requestAnimationFrame(tick);
})();
