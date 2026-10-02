// UI部品（ドット絵スタイル）。暗い紺の地にネオン色のアクセント。

import { PAL } from '../core/config.js';
import { rgb } from '../gfx/fb.js';
import { text, measure, mini, miniMeasure, LINE_H } from '../gfx/font.js';

export const C = {};
for (const k in PAL) C[k] = rgb(PAL[k]);

export function panel(fb, x, y, w, h, opts = {}) {
  const fill = opts.fill ?? C.navy;
  const border = opts.border ?? C.ink;
  fb.rect(x, y, w, h, border);
  fb.rect(x + 1, y + 1, w - 2, h - 2, fill);
  if (!opts.flat) {
    fb.rect(x + 1, y + 1, w - 2, 1, opts.hi ?? C.slate);
  }
  if (opts.title) {
    const tw = measure(opts.title) + 8;
    fb.rect(x + 4, y - 5, tw, 11, border);
    fb.rect(x + 5, y - 4, tw - 2, 9, opts.titleFill ?? C.slate);
    text(fb, opts.title, x + 8, y - 5, opts.titleColor ?? C.white);
  }
}

// 半透明の代わりに市松模様で暗くする
export function dim(fb, x, y, w, h, c = C.ink) { fb.checker(x, y, w, h, c); }

export function button(app, id, x, y, w, h, label, onTap, opts = {}) {
  const fb = app.px.fb;
  const disabled = !!opts.disabled;
  // 見た目より少し広い範囲で反応させる（小さなボタンでも押しやすく）
  const pad = opts.pad ?? (label ? 1 : 3);
  const pressed = !disabled && app.ui.btn(id, x - pad, y - pad, w + pad * 2, h + pad * 2, disabled ? null : () => { app.sfx('tap'); onTap(); });
  const accent = opts.accent;
  const active = !!opts.active;
  let fill = accent ?? (active ? C.cyan : C.slate);
  let fg = (accent || active) ? C.ink : C.white;
  if (disabled) { fill = C.navy; fg = C.steel; }
  const oy = pressed ? 1 : 0;
  fb.rrect(x, y + 1, w, h - 1, C.ink);            // 影
  fb.rrect(x, y + oy, w, h - 1, C.ink);
  fb.rect(x + 1, y + oy + 1, w - 2, h - 3, fill);
  if (!pressed && !disabled) fb.rect(x + 1, y + oy + 1, w - 2, 1, accent || active ? C.white : C.steel);
  let cx = x + w / 2;
  const icon = opts.icon;
  const lw = label ? (opts.mini ? miniMeasure(label) : measure(label)) : 0;
  const iw = icon ? icon.w + (label ? 3 : 0) : 0;
  let sx = Math.round(cx - (lw + iw) / 2);
  const th = opts.mini ? 5 : 10;
  if (icon) {
    fb.icon(icon, sx, Math.round(y + oy + (h - 1 - icon.h) / 2), opts.iconColor ?? fg);
    sx += iw;
  }
  if (label) {
    const ty = Math.round(y + oy + (h - 1 - th) / 2) - (opts.mini ? 0 : 1);
    if (opts.mini) mini(fb, label, sx, ty, fg);
    else text(fb, label, sx, ty, fg);
  }
  return pressed;
}

export function bar(fb, x, y, w, h, frac, color, bg = C.ink, border = null) {
  frac = Math.max(0, Math.min(1, frac || 0));
  if (border !== null) { fb.rect(x - 1, y - 1, w + 2, h + 2, border); }
  fb.rect(x, y, w, h, bg);
  const fw = Math.round(w * frac);
  if (fw > 0) fb.rect(x, y, fw, h, color);
}

export function tabs(app, id, x, y, w, h, labels, active, onChange) {
  const fb = app.px.fb;
  const n = labels.length;
  const tw = Math.floor(w / n);
  for (let i = 0; i < n; i++) {
    const tx = x + i * tw;
    const ww = i === n - 1 ? w - tw * (n - 1) : tw;
    const on = i === active;
    app.ui.btn(`${id}_${i}`, tx, y, ww, h, () => { if (!on) { app.sfx('tap'); onChange(i); } });
    fb.rect(tx, y, ww, h, C.ink);
    fb.rect(tx + 1, y + (on ? 0 : 2), ww - 2, h - (on ? 0 : 2), on ? C.navy : C.slate);
    if (on) fb.rect(tx + 1, y, ww - 2, 1, C.cyan);
    text(fb, labels[i], tx + ww / 2, y + Math.floor((h - 10) / 2) + (on ? 0 : 1), on ? C.cyan : C.silver, { align: 'center' });
  }
}

// 吹き出し
export function bubble(fb, x, y, w, h, tailX = null, tailUp = false) {
  fb.rrect(x, y, w, h, C.ink);
  fb.rect(x + 1, y + 1, w - 2, h - 2, C.cream);
  if (tailX !== null) {
    if (tailUp) {
      for (let i = 0; i < 4; i++) { fb.rect(tailX - i, y - 4 + i, 1 + i * 2, 1, C.ink); if (i > 0) fb.rect(tailX - i + 1, y - 4 + i, i * 2 - 1, 1, C.cream); }
      fb.rect(tailX - 3, y, 7, 1, C.cream);
    } else {
      for (let i = 0; i < 4; i++) { fb.rect(tailX - (3 - i), y + h - 1 + i, 1 + (3 - i) * 2, 1, C.ink); if (3 - i > 0) fb.rect(tailX - (3 - i) + 1, y + h - 1 + i, (3 - i) * 2 - 1, 1, C.cream); }
    }
  }
}

// 小さなラベル（見出し）
export function label(fb, str, x, y, color = C.gray) { text(fb, str, x, y, color); }

// トグル（ON/OFF）
export function toggle(app, id, x, y, on, onTap) {
  const fb = app.px.fb;
  app.ui.btn(id, x - 2, y - 2, 26, 14, () => { app.sfx('tap'); onTap(); });
  fb.rrect(x, y, 22, 10, C.ink);
  fb.rect(x + 1, y + 1, 20, 8, on ? C.lime : C.slate);
  fb.rect(on ? x + 12 : x + 2, y + 2, 8, 6, on ? C.white : C.steel);
}

// メニュー用の大きなボタン（タイトル＋説明）
export function bigButton(app, id, x, y, w, h, title, sub, onTap, opts = {}) {
  const fb = app.px.fb;
  const disabled = !!opts.disabled;
  const pressed = !disabled && app.ui.btn(id, x, y, w, h, () => { app.sfx('tap'); onTap(); });
  const oy = pressed ? 1 : 0;
  const accent = opts.accent ?? C.cyan;
  fb.rrect(x, y + 1, w, h - 1, C.ink);
  fb.rrect(x, y + oy, w, h - 1, C.ink);
  fb.rect(x + 1, y + oy + 1, w - 2, h - 3, disabled ? C.navy : C.slate);
  fb.rect(x + 1, y + oy + 1, 3, h - 3, disabled ? C.steel : accent);
  if (!pressed) fb.rect(x + 4, y + oy + 1, w - 5, 1, C.steel);
  let tx = x + 10;
  if (opts.sprite) {
    fb.sprite(opts.sprite, x + 9, y + oy + Math.round((h - 1 - opts.sprite.h * (opts.spriteScale || 1)) / 2), opts.spriteColors, opts.spriteScale || 1);
    tx = x + 14 + opts.sprite.w * (opts.spriteScale || 1);
  } else if (opts.icon) {
    fb.icon(opts.icon, x + 10, y + oy + Math.round((h - 1 - opts.icon.h) / 2), accent);
    tx = x + 14 + opts.icon.w;
  }
  const ty = y + oy + Math.round((h - 1 - (sub ? 23 : 11)) / 2);
  text(fb, title, tx, ty, disabled ? C.steel : C.white, { bold: true });
  if (sub) text(fb, sub, tx, ty + 12, disabled ? C.steel : C.silver);
  if (opts.badge) text(fb, opts.badge, x + w - 6, ty, opts.badgeColor ?? C.yellow, { align: 'right' });
  return pressed;
}

export { text, measure, mini, miniMeasure, LINE_H };
