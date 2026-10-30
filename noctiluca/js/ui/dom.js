// DOM の小道具
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function pct(v, d = 0) { return `${(Math.max(0, v) * 100).toFixed(d)}%`; }

export function starsHTML(n, max = 3) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < n ? '★' : '<span class="off">★</span>';
  return s;
}

// タップ（指を動かさずに離した）を拾う
export function onTap(el, fn) {
  let sx = 0, sy = 0, t0 = 0;
  el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; t0 = performance.now(); });
  el.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) < 12 && performance.now() - t0 < 600) fn(e);
  });
}
