// Theme definitions. Every theme sets the same handful of colours;
// the shell and the restyled YouTube Music page both read from them.
window.TW_THEMES = [
  { id: 'classic',  name: 'Classic Green', bg: '#000000', surface: '#121212', elevated: '#1f1f1f', hover: '#2a2a2a', accent: '#1ed760', text: '#ffffff', subtext: '#b3b3b3' },
  { id: 'redline',  name: 'Redline',       bg: '#050505', surface: '#0f0f0f', elevated: '#1d1d1d', hover: '#282828', accent: '#ff2e4d', text: '#ffffff', subtext: '#aaaaaa' },
  { id: 'midnight', name: 'Midnight',      bg: '#07050f', surface: '#120e22', elevated: '#1d1734', hover: '#2a2247', accent: '#a78bfa', text: '#f5f3ff', subtext: '#a9a3c4' },
  { id: 'ocean',    name: 'Deep Ocean',    bg: '#020c12', surface: '#081a24', elevated: '#0f2a38', hover: '#16384a', accent: '#22d3ee', text: '#ecfeff', subtext: '#94b8c4' },
  { id: 'sunset',   name: 'Sunset',        bg: '#0f0705', surface: '#1e100b', elevated: '#2e1912', hover: '#3d2319', accent: '#fb923c', text: '#fff7ed', subtext: '#c9a993' },
  { id: 'sakura',   name: 'Sakura',        bg: '#10070c', surface: '#1f0f18', elevated: '#2f1825', hover: '#3e2132', accent: '#f472b6', text: '#fdf2f8', subtext: '#c9a2b6' },
  { id: 'forest',   name: 'Forest',        bg: '#050b07', surface: '#0e1a12', elevated: '#17281c', hover: '#203627', accent: '#86efac', text: '#f0fdf4', subtext: '#9db8a5' },
  { id: 'dracula',  name: 'Dracula',       bg: '#191a21', surface: '#21222c', elevated: '#2c2e3b', hover: '#383a4a', accent: '#bd93f9', text: '#f8f8f2', subtext: '#a4a8c6' },
  { id: 'nord',     name: 'Nord',          bg: '#1f232b', surface: '#2a2f3a', elevated: '#353b48', hover: '#414858', accent: '#88c0d0', text: '#eceff4', subtext: '#a8b1c2' },
  { id: 'gruvbox',  name: 'Gruvbox',       bg: '#161819', surface: '#1f2122', elevated: '#2c2a28', hover: '#3a3633', accent: '#fabd2f', text: '#ebdbb2', subtext: '#a89984' },
  { id: 'oled',     name: 'OLED Mono',     bg: '#000000', surface: '#060606', elevated: '#141414', hover: '#1f1f1f', accent: '#ffffff', text: '#ffffff', subtext: '#9a9a9a' },
  { id: 'synth',    name: 'Synthwave',     bg: '#0d0221', surface: '#1a0b3a', elevated: '#261450', hover: '#331d66', accent: '#ff3cac', text: '#fdf4ff', subtext: '#b9a3d9' },
];

// Small colour helpers
window.TW_COLOR = {
  hexToRgb(hex) {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  },
  rgba(hex, a) { const [r, g, b] = this.hexToRgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})`; },
  luminance(hex) {
    const [r, g, b] = this.hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  },
  // Text colour that reads on top of the accent (e.g. the play button icon)
  onColor(hex) { return this.luminance(hex) > 0.35 ? '#000000' : '#ffffff'; },
  // Nudge a colour so it reads well on a dark background
  liftForDark(hex) {
    let [r, g, b] = this.hexToRgb(hex);
    const lum = this.luminance(hex);
    if (lum < 0.12) { const k = 0.12 / Math.max(lum, 0.01); const f = Math.min(Math.sqrt(k), 4); r = Math.min(255, r * f + 30); g = Math.min(255, g * f + 30); b = Math.min(255, b * f + 30); }
    return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  },
};
