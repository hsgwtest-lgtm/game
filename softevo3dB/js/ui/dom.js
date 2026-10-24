// 小さな DOM の道具
// append / replaceChildren に null や false を渡したら無視する（条件つきの子を書きやすくするため）
for (const name of ['append', 'replaceChildren']) {
  const orig = Element.prototype[name];
  if (orig && !orig.__filtered) {
    const f = function (...kids) { return orig.apply(this, kids.filter(k => k !== null && k !== undefined && k !== false)); };
    f.__filtered = true;
    Element.prototype[name] = f;
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('div.cls#id', { onclick, style, ... }, ...子)
export function h(tag, props, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
    }
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat(3)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// 小さなお知らせ
let toastBox = null;
export function toast(msg, { kind = '', ms = 2600, icon = '' } = {}) {
  if (!toastBox) { toastBox = h('div.toasts'); document.body.appendChild(toastBox); }
  const t = h('div.toast' + (kind ? '.' + kind : ''), icon ? h('span.ticon', icon) : null, h('span', msg));
  toastBox.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, ms);
}

// モーダル: { title, body(Node|string), actions:[{ label, kind, value }], dismiss } → Promise(value)
export function modal({ title, body, actions = [{ label: 'とじる', value: null }], dismiss = true, cls = '' }) {
  return new Promise((res) => {
    const close = (v) => { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 220); res(v); };
    const box = h('div.modal' + (cls ? '.' + cls : ''),
      title ? h('h2', title) : null,
      typeof body === 'string' ? h('p', body) : body,
      actions.length ? h('div.modal-actions', actions.map(a => h('button.btn' + (a.kind ? '.' + a.kind : ''), { onclick: () => close(a.value) }, a.label))) : null,
    );
    const wrap = h('div.modal-wrap', { onclick: (e) => { if (dismiss && e.target === wrap) close(null); } }, box);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    box._close = close;
  });
}

// 文字の入力
export function ask(title, value = '', { max = 12, placeholder = '' } = {}) {
  const input = h('input.text', { value, maxLength: max, placeholder });
  const p = modal({ title, body: h('div', input), actions: [{ label: 'やめる', value: null }, { label: '決める', kind: 'primary', value: 'ok' }] })
    .then(v => (v === 'ok' ? input.value.trim() : null));
  setTimeout(() => { input.focus(); input.select(); }, 60);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.closest('.modal')._close('ok'); });
  return p;
}

export function confirmBox(title, text, ok = 'はい', kind = 'primary') {
  return modal({ title, body: text, actions: [{ label: 'やめる', value: false }, { label: ok, kind, value: true }] });
}

export const fmtM = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${x.toFixed(2)}m`);
export const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// 押しっぱなし・ドラッグ・ピンチ（1本指 / 2本指）を扱う
export function gestures(el, { onDrag, onPinch, onTap, onDown, onUp }) {
  const pts = new Map();
  let moved = false, startX = 0, startY = 0, lastD = 0, t0 = 0;
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { moved = false; startX = e.clientX; startY = e.clientY; t0 = performance.now(); if (onDown) onDown(e); }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; lastD = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6) moved = true;
      if (moved && onDrag) onDrag(dx, dy, e);
    } else if (pts.size === 2 && onPinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastD > 0) onPinch(d / lastD);
      lastD = d; moved = true;
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0) {
      if (!moved && onTap && performance.now() - t0 < 600) onTap(e);
      if (onUp) onUp(e, moved);
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { if (onPinch) { e.preventDefault(); onPinch(e.deltaY < 0 ? 1.08 : 1 / 1.08); } }, { passive: false });
}
