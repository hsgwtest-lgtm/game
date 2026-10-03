// 即時モードのドットUI。毎フレーム「描く」ことがそのまま「ボタンを置く」ことになる。
// 押した瞬間に一番上にあったボタンが「つかむ」→ 指を離した時にその上ならクリック。

import { rgb } from '../gfx/fb.js';
import { text, measure, mini, LINE_H, wrap, textBlock } from '../gfx/font.js';
import { ICONS, CARD_ICONS, bitmap } from '../gfx/sprites.js';
import { C, UI as T } from '../core/const.js';

// 色（32bit）の作り置き
const cache = new Map();
export function col(hex) {
  let v = cache.get(hex);
  if (v === undefined) { v = rgb(hex); cache.set(hex, v); }
  return v;
}

// 明るい色・暗い色の組
const SHADE = new Map([
  [C.night, [C.dusk, C.ink]], [C.navy, [C.indigo, C.ink]], [C.indigo, [C.cobalt, C.navy]],
  [C.blue, [C.sky, C.cobalt]], [C.cobalt, [C.blue, C.navy]], [C.green, [C.emerald, C.pine]],
  [C.emerald, [C.leaf, C.green]], [C.orange, [C.sand, C.brick]], [C.amber, [C.gold, C.clay]],
  [C.scarlet, [C.flesh, C.crimson]], [C.ruby, [C.hotpink, C.magenta]], [C.purple, [C.lavender, C.violet]],
  [C.violet, [C.purple, C.grape]], [C.sea, [C.aqua, C.teal]], [C.teal, [C.sea, C.coal]], [C.aqua, [C.mint, C.sea]],
  [C.dusk, [C.lilac, C.night]], [C.lilac, [C.mist, C.dusk]], [C.gold, [C.cream, C.amber]], [C.mint, [C.ice, C.aqua]],
  [C.brick, [C.salmon, C.blood]], [C.coal, [C.slate, C.ink]], [C.slate, [C.sage, C.coal]], [C.sage, [C.fern, C.slate]],
  [C.rose, [C.coral, C.berry]], [C.mist, [C.pale, C.lilac]], [C.pale, [C.white, C.mist]], [C.white, [C.white, C.pale]],
  [C.clay, [C.tan, C.rust]], [C.crimson, [C.scarlet, C.wine]], [C.magenta, [C.ruby, C.grape]],
]);
export function shades(face) { return SHADE.get(face) || [C.white, C.ink]; }

export class UI {
  constructor(fb, input, sound) {
    this.fb = fb;
    this.in = input;
    this.sound = sound;
    this.regs = [];         // このフレームに置いたボタン [id, x, y, w, h]
    this.active = null;     // つかんでいるボタン
    this.blocked = 0;
    this.clips = [];        // 当たり判定用のクリップ
    this.scrolls = new Map();
    this.dragScroll = null;
    this.toasts = [];
    this.time = 0;
    this.safe = { t: 0, b: 0, l: 0, r: 0 };
  }

  get W() { return this.fb.w; }
  get H() { return this.fb.h; }

  begin(dt) {
    this.time += dt;
    this.dt = dt;
    this.regs.length = 0;
    this.clips.length = 0;
    this.blocked = 0;
    // スクロールの慣性
    for (const [id, s] of this.scrolls) {
      if (this.dragScroll === id) continue;
      if (Math.abs(s.vel) > 0.05) {
        s.off += s.vel;
        s.vel *= Math.pow(0.9, dt * 60);
      } else s.vel = 0;
      const max = Math.max(0, s.content - s.h);
      if (s.off < 0) { s.off += (0 - s.off) * 0.3; s.vel = 0; }
      if (s.off > max) { s.off += (max - s.off) * 0.3; s.vel = 0; }
    }
    if (!this.in.down && this.dragScroll) this.dragScroll = null;
  }

  end() {
    const inp = this.in;
    if (inp.pressed) {
      this.active = null;
      for (let i = this.regs.length - 1; i >= 0; i--) {
        const r = this.regs[i];
        if (inp.x >= r[1] && inp.y >= r[2] && inp.x < r[1] + r[3] && inp.y < r[2] + r[4]) { this.active = r[0]; break; }
      }
    }
    if (inp.released) this.active = null;
    this._drawToasts();
  }

  _clipOk() {
    const inp = this.in;
    for (const c of this.clips) if (inp.x < c[0] || inp.y < c[1] || inp.x >= c[0] + c[2] || inp.y >= c[1] + c[3]) return false;
    return true;
  }

  // 当たり判定だけ。{ down: 押している, click: クリックした }
  hit(id, x, y, w, h) {
    const inp = this.in;
    const res = { down: false, click: false };
    if (this.blocked > 0) return res;
    const inside = inp.x >= x && inp.y >= y && inp.x < x + w && inp.y < y + h && this._clipOk();
    if (inside) this.regs.push([id, x, y, w, h]);
    if (this.active === id && !this.dragScroll) {
      if (inp.down && inside && inp.moved < 10) res.down = true;
      if (inp.released && inside && inp.moved < 10) res.click = true;
    }
    return res;
  }

  block() { this.blocked++; }
  unblock() { this.blocked = Math.max(0, this.blocked - 1); }

  // ── 部品 ──

  // opt: { face, fg, icon, disabled, sel, sub, hot, cardIcon, align, small }
  button(id, x, y, w, h, label, opt = {}) {
    const fb = this.fb;
    const h0 = this.hit(id, x, y, w, h);
    const dis = !!opt.disabled;
    let face = opt.face !== undefined ? opt.face : T.panel2;
    if (dis) face = C.night;
    const [hi, lo] = shades(face);
    const pressed = h0.down && !dis;
    const oy = pressed ? 1 : 0;
    // 影
    fb.rrect(x, y + 1, w, h, col(C.ink));
    fb.bevel(x, y + oy, w, h, col(pressed ? lo : face), col(pressed ? face : hi), col(lo));
    if (opt.sel) fb.rframe(x - 1, y - 1 + oy, w + 2, h + 2, col(opt.selColor || T.sel));
    if (opt.hot && !dis && Math.floor(this.time * 3) % 2 === 0) fb.rframe(x - 1, y - 1 + oy, w + 2, h + 2, col(C.white));
    const fg = dis ? C.lilac : (opt.fg !== undefined ? opt.fg : T.text);
    let tx = x + Math.floor(w / 2);
    const lh = opt.sub ? 22 : 11;
    let ty = y + oy + Math.floor((h - lh) / 2) + 1;
    const iconRows = opt.icon ? ICONS[opt.icon] : (opt.cardIcon ? CARD_ICONS[opt.cardIcon] : null);
    if (opt.sub && iconRows) {
      // アイコン左・2行の文字
      const bm = bitmap(iconRows);
      const ix = x + 7;
      fb.icon(bm, ix, y + oy + Math.floor((h - bm.h) / 2), col(opt.iconColor || fg));
      const lx = ix + bm.w + 5;
      text(fb, label, lx, ty, col(fg), { maxW: x + w - lx - 3 });
      text(fb, opt.sub, lx, ty + 11, col(dis ? C.dusk : (opt.subColor || C.pale)), { maxW: x + w - lx - 3 });
    } else if (iconRows) {
      const bm = bitmap(iconRows);
      if (label) {
        const tw = measure(label) + bm.w + 3;
        const ix = opt.align === 'left' ? x + 6 : tx - Math.floor(tw / 2);
        fb.icon(bm, ix, y + oy + Math.floor((h - bm.h) / 2), col(opt.iconColor || fg));
        text(fb, label, ix + bm.w + 3, ty, col(fg));
      } else {
        fb.icon(bm, tx - Math.floor(bm.w / 2), y + oy + Math.floor((h - bm.h) / 2), col(opt.iconColor || fg));
      }
    } else if (label) {
      if (opt.align === 'left') text(fb, label, x + 6, ty, col(fg), { maxW: w - 8 });
      else text(fb, label, tx, ty, col(fg), { align: 'center', maxW: w - 6 });
    }
    if (opt.sub && !iconRows) {
      const sx = opt.align === 'left' ? x + 6 : tx;
      text(fb, opt.sub, sx, ty + 11, col(dis ? C.dusk : (opt.subColor || C.pale)), { align: opt.align === 'left' ? undefined : 'center', maxW: w - 8 });
    }
    if (h0.click && !dis) { if (this.sound) this.sound.play(opt.sfx || 'click'); return true; }
    if (h0.click && dis && this.sound) this.sound.play('deny');
    return false;
  }

  iconBtn(id, x, y, w, h, icon, opt = {}) { return this.button(id, x, y, w, h, '', { ...opt, icon }); }

  // オン/オフのチップ
  chip(id, x, y, w, h, label, on, opt = {}) {
    return this.button(id, x, y, w, h, label, {
      face: on ? (opt.onFace || C.sea) : C.night, fg: on ? C.white : C.mist, sel: on && opt.ring, ...opt,
    });
  }

  // [−] 値 [＋]  → -1 / 0 / +1
  stepper(id, x, y, w, h, label, opt = {}) {
    const fb = this.fb;
    const bw = h + 2;
    let r = 0;
    if (this.button(id + '-', x, y, bw, h, '', { icon: 'minus', face: opt.face || C.night, disabled: opt.minDis, sfx: 'tick' })) r = -1;
    if (this.button(id + '+', x + w - bw, y, bw, h, '', { icon: 'plus', face: opt.face || C.night, disabled: opt.maxDis, sfx: 'tick' })) r = 1;
    fb.rect(x + bw + 1, y, w - bw * 2 - 2, h, col(C.ink));
    text(fb, label, x + Math.floor(w / 2), y + Math.floor((h - 11) / 2) + 1, col(opt.fg || C.white), { align: 'center' });
    return r;
  }

  // タブ → 新しい番号
  tabs(id, x, y, w, h, labels, cur, opt = {}) {
    const fb = this.fb;
    const n = labels.length;
    const tw = Math.floor(w / n);
    let out = cur;
    fb.rect(x, y + h - 1, w, 1, col(C.dusk));
    for (let i = 0; i < n; i++) {
      const bx = x + i * tw, bw = i === n - 1 ? w - tw * (n - 1) : tw;
      const on = i === cur;
      const h0 = this.hit(id + i, bx, y, bw, h);
      if (on) {
        fb.rect(bx + 1, y, bw - 2, h, col(opt.face || C.navy));
        fb.rect(bx + 1, y, bw - 2, 1, col(opt.accent || C.mint));
      } else if (h0.down) fb.rect(bx + 1, y + 1, bw - 2, h - 1, col(C.night));
      const lab = labels[i];
      const fg = on ? C.white : C.mist;
      if (typeof lab === 'object' && lab.icon) {
        const bm = bitmap(ICONS[lab.icon]);
        const tw2 = (lab.text ? measure(lab.text) + 2 : 0) + bm.w;
        const ix = bx + Math.floor((bw - tw2) / 2);
        fb.icon(bm, ix, y + Math.floor((h - bm.h) / 2), col(on ? (opt.accent || C.mint) : C.lilac));
        if (lab.text) text(fb, lab.text, ix + bm.w + 2, y + Math.floor((h - 11) / 2) + 1, col(fg));
      } else text(fb, lab, bx + Math.floor(bw / 2), y + Math.floor((h - 11) / 2) + 1, col(fg), { align: 'center', maxW: bw - 2 });
      if (h0.click && !on) { out = i; if (this.sound) this.sound.play('tick'); }
    }
    return out;
  }

  // パネル（枠つき）
  panel(x, y, w, h, face = C.night, border = C.dusk) {
    const fb = this.fb;
    fb.rrect(x, y, w, h, col(face));
    fb.rframe(x, y, w, h, col(border));
  }

  // 見出しの帯
  header(x, y, w, label, color = C.mint) {
    const fb = this.fb;
    fb.rect(x, y + 5, 3, 3, col(color));
    text(fb, label, x + 6, y, col(color));
    const tw = measure(label);
    fb.dline(x + 10 + tw, y + 6, x + w - 1, y + 6, col(C.dusk), 1, 1);
  }

  // スクロール領域。beginScroll → 中身を y + off で描く → endScroll(中身の高さ)
  beginScroll(id, x, y, w, h) {
    let s = this.scrolls.get(id);
    if (!s) { s = { off: 0, vel: 0, content: h, h }; this.scrolls.set(id, s); }
    s.x = x; s.y = y; s.w = w; s.h = h;
    const inp = this.in;
    const inside = inp.x >= x && inp.y >= y && inp.x < x + w && inp.y < y + h;
    if (this.blocked === 0 && inp.down && inside && !this.dragScroll && inp.moved > 6 && Math.abs(inp.y - inp.sy) > Math.abs(inp.x - inp.sx)) {
      this.dragScroll = id;
      this.active = null;
    }
    if (this.dragScroll === id) {
      s.off -= inp.dy;
      s.vel = -inp.dy;
    }
    if (inside && inp.wheel && this.blocked === 0) { s.off += inp.wheel * 0.5; s.vel = 0; }
    this.fb.pushClip(x, y, w, h);
    this.clips.push([x, y, w, h]);
    return -Math.round(s.off);
  }

  endScroll(id, contentH) {
    const s = this.scrolls.get(id);
    this.fb.popClip();
    this.clips.pop();
    if (!s) return;
    s.content = contentH;
    const max = Math.max(0, contentH - s.h);
    if (this.dragScroll !== id) {
      if (s.off < -40) s.off = -40;
      if (s.off > max + 40) s.off = max + 40;
    }
    // スクロールバー
    if (contentH > s.h + 2) {
      const fb = this.fb;
      const bh = Math.max(10, Math.floor(s.h * s.h / contentH));
      const by = s.y + Math.floor((s.h - bh) * Math.max(0, Math.min(1, s.off / max)));
      fb.rect(s.x + s.w - 2, s.y, 1, s.h, col(C.night));
      fb.rect(s.x + s.w - 2, by, 1, bh, col(C.lilac));
    }
  }

  scrollTo(id, off) { const s = this.scrolls.get(id); if (s) { s.off = off; s.vel = 0; } }
  scrollOf(id) { const s = this.scrolls.get(id); return s ? s.off : 0; }

  // 暗い幕（モーダルの後ろ）
  dim(y0 = 0, y1 = this.H) {
    this.fb.checker(0, y0, this.W, y1 - y0, col(C.ink));
  }

  // 下からのシート
  sheet(h, title) {
    const fb = this.fb;
    this.dim();
    const y = this.H - h;
    fb.rect(0, y, this.W, h, col(C.night));
    fb.rect(0, y, this.W, 1, col(C.mint));
    fb.rect(0, y + 1, this.W, 1, col(C.dusk));
    if (title) text(fb, title, Math.floor(this.W / 2), y + 5, col(C.white), { align: 'center' });
    return y;
  }

  toast(msg, color = C.mint, sec = 2.4) {
    this.toasts.push({ msg, color, t: sec, max: sec });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  _drawToasts() {
    const fb = this.fb;
    let y = this.safe.t + 18;
    for (const t of this.toasts) {
      t.t -= this.dt || 1 / 60;
      const lines = wrap(t.msg, this.W - 28);
      const h = lines.length * LINE_H + 6;
      const w = Math.min(this.W - 16, Math.max(...lines.map(l => measure(l))) + 14);
      const x = Math.floor((this.W - w) / 2);
      fb.rrect(x, y, w, h, col(C.ink));
      fb.rframe(x, y, w, h, col(t.color));
      lines.forEach((l, i) => text(fb, l, x + 7, y + 3 + i * LINE_H, col(C.white)));
      y += h + 3;
    }
    this.toasts = this.toasts.filter(t => t.t > 0);
  }

  // ちいさな数値ラベル
  mini(str, x, y, c, align = 'left', scale = 1) { mini(this.fb, str, x, y, col(c), align, scale); }
  text(str, x, y, c = C.white, opt = null) { return text(this.fb, str, x, y, col(c), opt); }
  textBlock(str, x, y, w, c = C.white, opt = null, lh = LINE_H) { return textBlock(this.fb, str, x, y, w, col(c), opt, lh); }
}
