// 画面の上に重ねるもの: お知らせ（トースト）・メッセージ窓・えらぶ窓・名前入力（かなキーボード）

import { C, win, button, text, measure, LINE_H, dim, moreMark } from './widgets.js';
import { wrap } from '../gfx/font.js';

export function drawToasts(app, fb) {
  const px = app.px;
  let y = px.safe.t + 30;
  for (const t of app.toasts) {
    const w = Math.min(px.VW - 16, measure(t.text) + 14);
    const x = Math.round((px.VW - w) / 2);
    const slide = Math.min(1, t.t / 0.15);
    const yy = Math.round(y - (1 - slide) * 8);
    fb.rrect(x, yy, w, 15, C.ink);
    fb.rect(x + 1, yy + 1, w - 2, 13, C.navy);
    fb.rect(x + 1, yy + 1, 2, 13, t.color);
    text(fb, t.text, x + 8, yy + 2, t.color);
    y += 17;
  }
}

// メッセージ窓
// opts: { title, lines | text, sprite, spriteScale, buttons: [{label, onTap, accent}], tapClose, auto(秒), sfx, color }
export class MessageModal {
  constructor(app, opts) {
    this.app = app;
    this.o = opts;
    this.t = 0;
  }
  open() { if (this.o.sfx) this.app.sfx(this.o.sfx); }
  close() { this.app.closeModal(this); if (this.o.onClose) this.o.onClose(); }
  update(dt) {
    this.t += dt;
    if (this.o.auto && this.t > this.o.auto) this.close();
  }
  draw(fb, top) {
    const app = this.app, px = app.px, o = this.o;
    const VW = px.VW;
    dim(fb, 0, 0, VW, px.VH);
    const w = Math.min(VW - 12, o.width || 180);
    const lines = o.lines || wrap(o.text || '', w - 18);
    const sprH = o.sprite ? o.sprite.h * (o.spriteScale || 3) + 8 : 0;
    const btnH = o.buttons && o.buttons.length ? 20 : 0;
    const h = 16 + sprH + lines.length * LINE_H + btnH + (o.title ? 6 : 0) + (o.extraH || 0);
    const x = Math.round((VW - w) / 2);
    const y = Math.round(o.y ?? Math.max(px.safe.t + 20, (px.VH - h) / 2 - 10));
    // 開くアニメ（縦にのびる）
    const k = Math.min(1, this.t / 0.12);
    if (k < 1) { win(fb, x, y + Math.round(h / 2 * (1 - k)), w, Math.max(8, Math.round(h * k))); return; }
    if (top) app.ui.btn('modal_bg', 0, 0, VW, px.VH, () => { if (o.tapClose) this.close(); });
    win(fb, x, y, w, h, { title: o.title, titleCenter: true, titleFill: o.color ?? C.white });
    let cy = y + 8 + (o.title ? 4 : 0);
    if (o.sprite) {
      const sc = o.spriteScale || 3;
      const sx = Math.round(x + w / 2 - o.sprite.w * sc / 2);
      const bob = Math.round(Math.sin(this.t * 5) * 1.5);
      fb.sprite(o.sprite, sx, cy + bob, o.sprite.cols, sc);
      cy += sprH;
    }
    for (const ln of lines) {
      text(fb, ln, x + w / 2, cy, C.white, { align: o.align === 'left' ? undefined : 'center' });
      cy += LINE_H;
    }
    if (o.extraDraw) { o.extraDraw(fb, x, cy, w); cy += o.extraH || 0; }
    if (btnH && top) {
      const n = o.buttons.length, bw = Math.floor((w - 16 - (n - 1) * 4) / n);
      o.buttons.forEach((b, i) => {
        button(app, 'modal_b' + i, x + 8 + i * (bw + 4), cy + 3, bw, 15, b.label, () => {
          if (!b.keep) this.close();
          if (b.onTap) b.onTap();
        }, { accent: b.accent, immediate: !!b.immediate });
      });
    } else if (o.tapClose && top) moreMark(fb, x + w - 12, y + h - 9, this.t);
  }
}

export function message(app, opts) { const m = new MessageModal(app, opts); app.openModal(m); return m; }
export function confirm(app, title, textStr, onYes, yesLabel = 'はい', noLabel = 'いいえ') {
  return message(app, {
    title, text: textStr,
    buttons: [{ label: noLabel }, { label: yesLabel, onTap: onYes, accent: C.magenta }],
  });
}

// えらぶ窓: items = [{ label, sub, onTap, active, accent }]
export class SheetModal {
  constructor(app, opts) { this.app = app; this.o = opts; this.t = 0; }
  update(dt) { this.t += dt; }
  close() { this.app.closeModal(this); }
  draw(fb, top) {
    const app = this.app, px = app.px, o = this.o;
    const VW = px.VW;
    dim(fb, 0, 0, VW, px.VH);
    const rowH = o.rowH || 18;
    const w = Math.min(VW - 12, o.width || 176);
    const h = 18 + o.items.length * rowH + 22 + (o.note ? LINE_H * wrap(o.note, w - 16).length : 0);
    const x = Math.round((VW - w) / 2), y = Math.round(Math.max(px.safe.t + 16, (px.VH - h) / 2));
    if (top) app.ui.btn('sheet_bg', 0, 0, VW, px.VH, () => this.close());
    win(fb, x, y, w, h, { title: o.title, titleCenter: true });
    let cy = y + 10;
    if (o.note) {
      for (const ln of wrap(o.note, w - 16)) { text(fb, ln, x + 8, cy, C.silver); cy += LINE_H; }
      cy += 2;
    }
    o.items.forEach((it, i) => {
      if (top) {
        button(app, 'sheet_i' + i, x + 6, cy, w - 12, rowH - 3, '', () => {
          if (!o.keepOpen) this.close();
          if (it.onTap) it.onTap();
        }, { active: !!it.active, disabled: !!it.disabled, immediate: !!it.immediate });
      }
      const fg = it.active ? C.ink : it.disabled ? C.steel : C.white;
      text(fb, it.label, x + 12, cy + Math.round((rowH - 3 - 11) / 2), fg);
      if (it.sub) text(fb, it.sub, x + w - 12, cy + Math.round((rowH - 3 - 11) / 2), it.active ? C.navy : C.gray, { align: 'right' });
      cy += rowH;
    });
    if (top) button(app, 'sheet_close', x + w / 2 - 30, cy + 2, 60, 15, 'とじる', () => this.close());
  }
}
export function sheet(app, opts) { const m = new SheetModal(app, opts); app.openModal(m); return m; }

// ── 名前入力（かなキーボード）──
const HIRA = [
  'あかさたなはまやらわ',
  'いきしちにひみゆりを',
  'うくすつぬふむよるん',
  'えけせてねへめゃれー',
  'おこそとのほもょろ！',
];
const KATA = HIRA.map(r => [...r].map(ch => {
  const c = ch.charCodeAt(0);
  return c >= 0x3041 && c <= 0x3096 ? String.fromCharCode(c + 0x60) : ch;
}).join(''));
const ABC = ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ・♪★', '0123456789', 'abcdefghij'];
const DAKU = {};
const pairs = 'かがきぎくぐけげこごさざしじすずせぜそぞただちぢつづてでとどはばひびふぶへべほぼ';
for (let i = 0; i < pairs.length; i += 2) { DAKU[pairs[i]] = pairs[i + 1]; }
const HANDAKU = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };
const SMALL = { あ: 'ぁ', い: 'ぃ', う: 'ぅ', え: 'ぇ', お: 'ぉ', つ: 'っ', や: 'ゃ', ゆ: 'ゅ', よ: 'ょ' };
function toKata(s) { const c = s.charCodeAt(0); return c >= 0x3041 && c <= 0x3096 ? String.fromCharCode(c + 0x60) : s; }
function toHira(s) { const c = s.charCodeAt(0); return c >= 0x30A1 && c <= 0x30F6 ? String.fromCharCode(c - 0x60) : s; }

// 濁点・半濁点を順番に切りかえる（か→が→か、は→ば→ぱ→は）
function cycleDaku(ch) {
  const kata = toHira(ch) !== ch;
  const h = toHira(ch);
  let out = h;
  const base = Object.keys(DAKU).find(k => DAKU[k] === h) || Object.keys(HANDAKU).find(k => HANDAKU[k] === h) || h;
  if (h === base && DAKU[base]) out = DAKU[base];
  else if (DAKU[base] === h && HANDAKU[base]) out = HANDAKU[base];
  else out = base;
  return kata ? toKata(out) : out;
}
function cycleSmall(ch) {
  const kata = toHira(ch) !== ch;
  const h = toHira(ch);
  const big = Object.keys(SMALL).find(k => SMALL[k] === h);
  const out = big || SMALL[h] || h;
  return kata ? toKata(out) : out;
}

export class KanaKeyboard {
  constructor(app, opts) {
    this.app = app;
    this.o = opts;
    this.value = Array.from(opts.value || '').slice(0, opts.max || 8);
    this.page = 1;   // 0:ひらがな 1:カタカナ 2:英数
    this.t = 0;
  }
  update(dt) { this.t += dt; }
  close() { this.app.closeModal(this); }
  draw(fb, top) {
    const app = this.app, px = app.px, o = this.o, VW = px.VW;
    const max = o.max || 8;
    dim(fb, 0, 0, VW, px.VH);
    const kw = Math.min(17, Math.floor((VW - 16) / 10)), kh = 14;
    const w = kw * 10 + 12;
    const h = 30 + kh * 5 + 4 + 18 + 20;
    const x = Math.round((VW - w) / 2), y = Math.round(Math.max(px.safe.t + 16, (px.VH - h) / 2 - 20));
    if (top) app.ui.btn('kb_bg', 0, 0, VW, px.VH, () => {});
    win(fb, x, y, w, h, { title: o.title || 'なまえを いれてね', titleCenter: true });
    // 入力欄
    const fx = x + 8, fy = y + 9;
    fb.rect(fx, fy, w - 16, 14, C.ink);
    let cx = fx + 4;
    for (let i = 0; i < max; i++) {
      const ch = this.value[i];
      if (ch) { text(fb, ch, cx, fy + 1, C.white); }
      else if (i === this.value.length && Math.floor(this.t * 2) % 2 === 0) fb.rect(cx, fy + 10, 8, 1, C.yellow);
      else fb.rect(cx, fy + 11, 8, 1, C.slate);
      cx += 11;
    }
    // キー
    const rows = [HIRA, KATA, ABC][this.page];
    const ky = y + 28;
    for (let r = 0; r < 5; r++) {
      const row = Array.from(rows[r]);
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        const kx = x + 6 + c * kw, kyy = ky + r * kh;
        const id = `kb_${r}_${c}`;
        const pressed = top && app.ui.btn(id, kx, kyy, kw, kh, () => {
          if (this.value.length < max) { this.value.push(ch); app.sfx('tap'); }
          else app.sfx('error');
        });
        fb.rect(kx + 1, kyy + 1, kw - 2, kh - 2, pressed ? C.cyan : C.slate);
        text(fb, ch, kx + Math.floor(kw / 2), kyy + 1, pressed ? C.ink : C.white, { align: 'center' });
      }
    }
    // 機能キー
    const by = ky + kh * 5 + 4;
    const fw = Math.floor((w - 12 - 4 * 3) / 4);
    const pages = ['ひら', 'カナ', 'ABC'];
    button(app, 'kb_page', x + 6, by, fw, 15, pages[(this.page + 1) % 3], () => { this.page = (this.page + 1) % 3; });
    button(app, 'kb_daku', x + 6 + (fw + 4), by, fw, 15, '゛゜小', () => {
      const n = this.value.length;
      if (!n) return;
      const last = this.value[n - 1];
      let nx = cycleDaku(last);
      if (nx === last) nx = cycleSmall(last);
      this.value[n - 1] = nx;
    });
    button(app, 'kb_del', x + 6 + (fw + 4) * 2, by, fw, 15, 'けす', () => { this.value.pop(); });
    button(app, 'kb_rand', x + 6 + (fw + 4) * 3, by, fw, 15, 'おまかせ', () => {
      if (o.randomName) this.value = Array.from(o.randomName()).slice(0, max);
    });
    const ey = by + 19;
    button(app, 'kb_cancel', x + 6, ey, Math.floor((w - 16) / 2), 15, 'やめる', () => { this.close(); app.sfx('back'); });
    button(app, 'kb_ok', x + 10 + Math.floor((w - 16) / 2), ey, Math.ceil((w - 16) / 2), 15, 'けってい', () => {
      const v = this.value.join('').trim();
      if (!v) { app.sfx('error'); return; }
      this.close();
      if (o.onDone) o.onDone(v);
    }, { accent: C.lime });
  }
}
export function askName(app, opts) { const m = new KanaKeyboard(app, opts); app.openModal(m); return m; }
