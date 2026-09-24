/* SoftEvo 8 — ui.js : 小さなUIヘルパー */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

/** キャンバスを CSS サイズ × DPR に合わせる。{ctx, w, h} (CSS px) を返す */
export function fitCanvas(canvas) {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

let toastTimer = null;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function confirmDialog(title, body, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    const back = el('div', { class: 'modal-back' });
    const done = v => { back.remove(); resolve(v); };
    const box = el('div', { class: 'modal' },
      el('h3', {}, title),
      el('p', {}, body),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn ghost', onclick: () => done(false) }, 'キャンセル'),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, okLabel)));
    back.append(box);
    back.addEventListener('pointerdown', e => { if (e.target === back) done(false); });
    document.body.append(back);
  });
}

export function infoDialog(title, html) {
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: 'modal wide' }, el('h3', {}, title));
  const body = el('div', { class: 'modal-body' }); body.innerHTML = html;
  box.append(body, el('div', { class: 'modal-actions' }, el('button', { class: 'btn primary', onclick: () => back.remove() }, 'とじる')));
  back.append(box);
  back.addEventListener('pointerdown', e => { if (e.target === back) back.remove(); });
  document.body.append(back);
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;

/** 値 -1..1 → 色 (負: 青, 正: 橙) */
export function signedColor(v, alpha = 1) {
  const t = clamp(Math.abs(v), 0, 1);
  if (v >= 0) return `rgba(${Math.round(60 + 195 * t)},${Math.round(70 + 110 * t)},${Math.round(90 - 30 * t)},${alpha})`;
  return `rgba(${Math.round(60 - 20 * t)},${Math.round(70 + 120 * t)},${Math.round(90 + 165 * t)},${alpha})`;
}
export const POS = '#ffae42', NEG = '#3fc1ff';
export const muscleHue = i => (i * 137.508 + 330) % 360;
