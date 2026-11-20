// Everything that talks to the YouTube Music page lives here.
// Scripts are run in the page with webview.executeJavaScript(); CSS is applied with webview.insertCSS().
// If YouTube changes its page, this is the file to adjust.

window.YTM = (() => {
  const C = window.TW_COLOR;

  // Hide YouTube Music's own top bar / sidebar / player bar (the shell replaces them).
  const layoutCSS = `
    ytmusic-app-layout {
      --ytmusic-nav-bar-height: 0px !important;
      --ytmusic-guide-width: 0px !important;
      --ytmusic-mini-guide-width: 0px !important;
      --ytmusic-player-bar-height: 0px !important;
    }
    ytmusic-nav-bar, #nav-bar-background, #nav-bar-divider,
    tp-yt-app-drawer#guide, #mini-guide, #mini-guide-background, #guide-spacer, #mini-guide-spacer {
      display: none !important;
    }
    ytmusic-player-bar, #player-bar-background {
      opacity: 0 !important; pointer-events: none !important;
      position: fixed !important; bottom: -400px !important;
    }
    ytmusic-player-page { padding-top: 24px !important; }
    ytmusic-app-layout[player-page-open] ytmusic-player-page { padding-bottom: 0 !important; }
  `;

  function themeCSS(t, accent) {
    const a = accent || t.accent;
    return `
      html, body, ytmusic-app, ytmusic-app-layout {
        --ytmusic-background: ${t.surface} !important;
        --ytmusic-general-background-a: ${t.elevated} !important;
        --ytmusic-general-background-b: ${t.surface} !important;
        --ytmusic-general-background-c: ${t.surface} !important;
        --ytmusic-brand-background-solid: ${t.elevated} !important;
        --ytmusic-brand-background-translucent: ${C.rgba(t.elevated, 0.9)} !important;
        --ytmusic-player-page-background: ${t.surface} !important;
        --ytmusic-text-primary: ${t.text} !important;
        --ytmusic-text-secondary: ${t.subtext} !important;
        --ytmusic-play-button-icon-color: ${C.onColor(a)} !important;
        --paper-slider-active-color: ${a} !important;
        --paper-slider-knob-color: ${a} !important;
        --paper-progress-active-color: ${a} !important;
        --yt-spec-call-to-action: ${a} !important;
        --yt-spec-themed-blue: ${a} !important;
        --yt-spec-brand-button-background: ${a} !important;
        --yt-spec-static-brand-red: ${a} !important;
        --yt-spec-base-background: ${t.surface} !important;
        --yt-spec-raised-background: ${t.elevated} !important;
        --yt-spec-menu-background: ${t.elevated} !important;
        --yt-spec-text-primary: ${t.text} !important;
        --yt-spec-text-secondary: ${t.subtext} !important;
      }
      html, body { background: ${t.surface} !important; }
      ytmusic-app-layout, #content { background: transparent !important; }
      ytmusic-player-page { background: ${t.surface} !important; }
      tp-yt-paper-listbox, ytmusic-menu-popup-renderer, tp-yt-iron-dropdown #contentWrapper > * { background: ${t.elevated} !important; }
      ytmusic-chip-cloud-chip-renderer[chip-style="STYLE_PRIMARY"] a,
      ytmusic-chip-cloud-chip-renderer[is-selected] a, ytmusic-chip-cloud-chip-renderer[is-selected] .gradient-box {
        background: ${a} !important; color: ${C.onColor(a)} !important;
      }
      ytmusic-play-button-renderer { --ytmusic-play-button-background-color: ${a} !important; --ytmusic-play-button-active-background-color: ${a} !important; --ytmusic-play-button-icon-color: ${C.onColor(a)} !important; }
      #progress-bar.ytmusic-player-bar, ytmusic-player-page #progress-bar { --paper-slider-active-color: ${a} !important; }
      ::selection { background: ${C.rgba(a, 0.35)}; }
      ::-webkit-scrollbar { width: 12px; height: 12px; background: transparent; }
      ::-webkit-scrollbar-thumb { background: ${C.rgba(t.text, 0.18)}; border: 3px solid transparent; background-clip: content-box; border-radius: 8px; }
      ::-webkit-scrollbar-thumb:hover { background: ${C.rgba(t.text, 0.32)}; background-clip: content-box; border: 3px solid transparent; }
      ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
    `;
  }

  // Read the current playback state. Returns a plain object.
  const stateScript = `(() => {
    try {
      const mp = document.getElementById('movie_player');
      const video = document.querySelector('video');
      const pb = document.querySelector('ytmusic-player-bar');
      const layout = document.querySelector('ytmusic-app-layout');
      const md = navigator.mediaSession && navigator.mediaSession.metadata;
      const q = (s) => pb ? pb.querySelector(s) : null;
      const txt = (el) => el ? (el.textContent || '').trim() : '';

      let title = md && md.title || txt(q('.title'));
      let artist = md && md.artist || '';
      let album = md && md.album || '';
      if (!artist) { const by = txt(q('.byline')); artist = by.split('•')[0].trim(); }
      let art = '';
      if (md && md.artwork && md.artwork.length) art = md.artwork[md.artwork.length - 1].src;
      if (!art) { const img = q('img.image'); art = img && img.src || ''; }

      const vd = mp && mp.getVideoData ? mp.getVideoData() : {};
      const hasTrack = !!(title && (vd && vd.video_id || (video && video.src)));
      const ps = mp && mp.getPlayerState ? mp.getPlayerState() : -1;
      const playing = ps === 1 || ps === 3 ? true : (video ? !video.paused : false);

      const rep = q('yt-icon-button.repeat');
      const repLabel = rep ? (rep.getAttribute('title') || rep.querySelector('button')?.getAttribute('aria-label') || '') : '';
      const repeat = /one/i.test(repLabel) ? 'one' : /all/i.test(repLabel) ? 'all' : 'off';

      const likeR = q('ytmusic-like-button-renderer');
      const likeStatus = likeR ? (likeR.getAttribute('like-status') || '') : '';

      const cfg = window.ytcfg && window.ytcfg.get ? window.ytcfg : null;
      const loggedIn = cfg ? !!cfg.get('LOGGED_IN') : null;

      return {
        ok: true,
        url: location.href,
        hasTrack, playing, title, artist, album, art,
        videoId: vd && vd.video_id || '',
        time: mp && mp.getCurrentTime ? mp.getCurrentTime() : (video ? video.currentTime : 0),
        duration: mp && mp.getDuration ? mp.getDuration() : (video ? video.duration : 0),
        volume: mp && mp.getVolume ? mp.getVolume() : (video ? Math.round(video.volume * 100) : 100),
        muted: mp && mp.isMuted ? mp.isMuted() : (video ? video.muted : false),
        repeat, likeStatus,
        playerPageOpen: layout ? layout.hasAttribute('player-page-open') : false,
        loggedIn,
        accountPhoto: (document.querySelector('ytmusic-settings-button img, #avatar img, ytmusic-nav-bar img#img') || {}).src || '',
      };
    } catch (e) { return { ok: false, error: String(e) }; }
  })()`;

  // Click a button inside the (hidden) YouTube Music player bar.
  const clickPB = (sel) => `(() => {
    const el = document.querySelector('ytmusic-player-bar ${sel}');
    if (!el) return false;
    (el.querySelector('button') || el).click();
    return true;
  })()`;

  const commands = {
    playPause: () => `(() => {
      const b = document.querySelector('ytmusic-player-bar .play-pause-button');
      if (b) { (b.querySelector('button') || b).click(); return true; }
      const mp = document.getElementById('movie_player');
      if (mp) { mp.getPlayerState() === 1 ? mp.pauseVideo() : mp.playVideo(); return true; }
      return false;
    })()`,
    next: () => clickPB('.next-button'),
    prev: () => clickPB('.previous-button'),
    shuffle: () => clickPB('yt-icon-button.shuffle'),
    repeat: () => clickPB('yt-icon-button.repeat'),
    togglePlayerPage: () => clickPB('.toggle-player-page-button'),
    like: () => `(() => {
      const r = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer');
      if (!r) return false;
      const btns = [...r.querySelectorAll('button')];
      const like = btns.find(b => /like/i.test(b.getAttribute('aria-label') || '') && !/dislike/i.test(b.getAttribute('aria-label') || '')) || btns[btns.length - 1];
      if (like) { like.click(); return true; }
      return false;
    })()`,
    seek: (sec) => `(() => { const mp = document.getElementById('movie_player'); if (mp) mp.seekTo(${Number(sec) || 0}, true); return true; })()`,
    volume: (v) => `(() => {
      const val = ${Math.max(0, Math.min(100, Math.round(Number(v) || 0)))};
      const mp = document.getElementById('movie_player');
      if (mp) { mp.setVolume(val); if (val > 0 && mp.isMuted()) mp.unMute(); }
      const s = document.querySelector('ytmusic-player-bar #volume-slider');
      if (s) { try { s.value = val; s.dispatchEvent(new CustomEvent('immediate-value-change', { bubbles: true })); s.dispatchEvent(new CustomEvent('value-change', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
      return true;
    })()`,
    mute: () => `(() => { const mp = document.getElementById('movie_player'); if (!mp) return false; mp.isMuted() ? mp.unMute() : mp.mute(); return true; })()`,
    // In-app navigation without reloading the page (so music keeps playing)
    navigate: (endpoint) => `(() => {
      const app = document.querySelector('ytmusic-app');
      if (!app) return false;
      app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint: ${JSON.stringify(endpoint)} } }));
      return true;
    })()`,
    playQueueItem: (i) => `(() => {
      const items = [...document.querySelectorAll('ytmusic-player-page ytmusic-player-queue-item, ytmusic-player-page #contents > ytmusic-playlist-panel-video-renderer')];
      const it = items[${Number(i) || 0}];
      if (!it) return false;
      const target = it.querySelector('.song-info') || it.querySelector('.song-title') || it;
      target.click();
      return true;
    })()`,
    signInUrl: () => `(() => {
      const a = document.querySelector('a.sign-in-link, ytmusic-nav-bar a[href*="ServiceLogin"], a[href*="accounts.google.com"]');
      return a ? a.href : '';
    })()`,
  };

  // Read the play queue ("Up next").
  const queueScript = `(() => {
    const items = [...document.querySelectorAll('ytmusic-player-page ytmusic-player-queue-item, ytmusic-player-page #contents > ytmusic-playlist-panel-video-renderer')];
    return items.slice(0, 80).map((it, i) => ({
      i,
      title: (it.querySelector('.song-title') || {}).textContent?.trim() || '',
      artist: (it.querySelector('.byline') || {}).textContent?.trim() || '',
      duration: (it.querySelector('.duration') || {}).textContent?.trim() || '',
      art: (it.querySelector('img') || {}).src || '',
      current: it.hasAttribute('selected') || it.getAttribute('play-button-state') === 'playing' || it.getAttribute('play-button-state') === 'paused',
    })).filter(x => x.title);
  })()`;

  // Fetch the signed-in user's playlists through YouTube Music's own web API, using the page's session.
  const playlistsScript = `(async () => {
    try {
      const cfg = window.ytcfg; if (!cfg || !cfg.get) return { loggedIn: null, items: [] };
      if (!cfg.get('LOGGED_IN')) return { loggedIn: false, items: [] };
      const ck = (n) => { const p = document.cookie.split('; ').find(c => c.startsWith(n + '=')); return p ? p.slice(n.length + 1) : null; };
      const sapisid = ck('SAPISID') || ck('__Secure-3PAPISID') || ck('__Secure-1PAPISID');
      const origin = 'https://music.youtube.com';
      const headers = { 'Content-Type': 'application/json', 'X-Origin': origin, 'X-Goog-AuthUser': String(cfg.get('SESSION_INDEX') || 0) };
      const ctx = cfg.get('INNERTUBE_CONTEXT');
      if (ctx && ctx.client) {
        headers['X-Youtube-Client-Name'] = String(cfg.get('INNERTUBE_CONTEXT_CLIENT_NAME') || 67);
        headers['X-Youtube-Client-Version'] = ctx.client.clientVersion || cfg.get('INNERTUBE_CLIENT_VERSION') || '';
        if (ctx.client.visitorData) headers['X-Goog-Visitor-Id'] = ctx.client.visitorData;
      }
      if (sapisid) {
        const ts = Math.floor(Date.now() / 1000);
        const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ts + ' ' + sapisid + ' ' + origin));
        const hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
        headers['Authorization'] = 'SAPISIDHASH ' + ts + '_' + hash;
      }
      const res = await fetch('/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST', credentials: 'include', headers,
        body: JSON.stringify({ context: ctx, browseId: 'FEmusic_liked_playlists' }),
      });
      const json = await res.json();
      const out = []; const seen = new Set();
      const runs = (o) => (o && o.runs ? o.runs.map(r => r.text).join('') : (o && o.simpleText) || '');
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        const r = o.musicTwoRowItemRenderer || o.musicResponsiveListItemRenderer;
        if (r) {
          const nav = r.navigationEndpoint || (r.title && r.title.runs && r.title.runs[0] && r.title.runs[0].navigationEndpoint) || {};
          const id = nav.browseEndpoint && nav.browseEndpoint.browseId;
          const title = runs(r.title) || (r.flexColumns && runs(r.flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text)) || '';
          const thumbs = r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails || r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          if (id && title && !seen.has(id)) {
            seen.add(id);
            out.push({ id, title, subtitle: runs(r.subtitle) || (r.flexColumns && runs(r.flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text)) || '', art: thumbs.length ? thumbs[Math.min(1, thumbs.length - 1)].url : '' });
          }
          return;
        }
        for (const k in o) walk(o[k]);
      })(json);
      return { loggedIn: true, items: out };
    } catch (e) { return { loggedIn: null, items: [], error: String(e) }; }
  })()`;

  return { layoutCSS, themeCSS, stateScript, commands, queueScript, playlistsScript };
})();
