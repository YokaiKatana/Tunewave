// Background patterns. Each draws a small tile in whatever colour is passed in, so the
// pattern recolours with the theme. Kept subtle; the colour comes from the theme accent.
window.TW_PATTERNS = [
  { id: 'none', name: 'None' },
  { id: 'dots', name: 'Dots', w: 20, h: 20, svg: (c) => `<circle cx="3" cy="3" r="1.5" fill="${c}"/>` },
  { id: 'grid', name: 'Grid', w: 26, h: 26, svg: (c) => `<path d="M26 0H0V26" fill="none" stroke="${c}" stroke-width="1"/>` },
  { id: 'diagonal', name: 'Diagonal', w: 16, h: 16, svg: (c) => `<path d="M-2 2L2 -2M0 16L16 0M14 18L18 14" stroke="${c}" stroke-width="1.5"/>` },
  { id: 'waves', name: 'Waves', w: 40, h: 20, svg: (c) => `<path d="M0 10c5-10 15-10 20 0s15 10 20 0" fill="none" stroke="${c}" stroke-width="1.4"/>` },
  { id: 'rings', name: 'Rings', w: 34, h: 34, svg: (c) => `<circle cx="17" cy="17" r="11" fill="none" stroke="${c}" stroke-width="1.3"/><circle cx="0" cy="0" r="11" fill="none" stroke="${c}" stroke-width="1.3"/><circle cx="34" cy="34" r="11" fill="none" stroke="${c}" stroke-width="1.3"/>` },
  { id: 'cross', name: 'Plus', w: 24, h: 24, svg: (c) => `<path d="M12 7v10M7 12h10" stroke="${c}" stroke-width="1.4"/>` },
  { id: 'triangles', name: 'Peaks', w: 30, h: 26, svg: (c) => `<path d="M0 26L15 2l15 24" fill="none" stroke="${c}" stroke-width="1.3"/>` },
];

window.twPatternUrl = (p, color) => {
  if (!p || p.id === 'none' || !p.svg) return 'none';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${p.w}' height='${p.h}' viewBox='0 0 ${p.w} ${p.h}'>${p.svg(color)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
