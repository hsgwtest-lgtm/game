// 3人の師範の実況・ヒント（吹き出し＋1文字ずつ表示）

import { C, text } from '../ui/widgets.js';
import { wrap, LINE_H } from '../gfx/font.js';
import { MASTER } from '../gfx/sprites.js';
import { SCHOOLS } from '../core/config.js';
import { rgb } from '../gfx/fb.js';

export class Masters {
  constructor(app) {
    this.app = app;
    this.cur = null;      // { who, text, t, dur, prio, shown }
    this.queue = [];
    this.typeAcc = 0;
  }

  // who: 'ga' | 'rl' | 'il'
  say(who, msg, opts = {}) {
    const m = { who, text: msg, t: 0, dur: opts.dur ?? Math.max(4, msg.length * 0.11 + 2), prio: opts.prio ?? 1, shown: 0, key: opts.key || null };
    if (m.key && ((this.cur && this.cur.key === m.key) || this.queue.some((q) => q.key === m.key))) return;
    if (!this.cur || m.prio > this.cur.prio || (this.cur.shown >= this.cur.text.length && this.cur.t > 1.5 && m.prio >= this.cur.prio)) {
      this.cur = m;
    } else {
      this.queue.push(m);
      this.queue.sort((a, b) => b.prio - a.prio);
      if (this.queue.length > 4) this.queue.length = 4;
    }
  }

  clear() { this.cur = null; this.queue = []; }

  get busy() { return !!this.cur; }

  update(dt) {
    const m = this.cur;
    if (!m) return;
    m.t += dt;
    if (m.shown < m.text.length) {
      this.typeAcc += dt * 40;
      while (this.typeAcc >= 1 && m.shown < m.text.length) {
        this.typeAcc -= 1; m.shown++;
        if (m.shown % 3 === 0) this.app.sfx('type');
      }
    }
    if (m.t > m.dur) {
      this.cur = this.queue.shift() || null;
    }
  }

  skip() {
    const m = this.cur;
    if (!m) return;
    if (m.shown < m.text.length) m.shown = m.text.length;
    else this.cur = this.queue.shift() || null;
  }

  // 吹き出しを描く。戻り値は高さ（何もなければ 0）
  draw(fb, x, y, w, maxLines = 3, opts = {}) {
    const m = this.cur;
    if (!m) return 0;
    const portrait = MASTER[m.who];
    const pw = portrait ? portrait.w + 4 : 0;
    const tw = w - pw - 10;
    const lines = wrap(m.text, tw);
    const n = Math.min(maxLines, lines.length);
    // 長い文は流れるように後ろの行を見せる
    let start = 0;
    let shownChars = m.shown, acc = 0, lastLine = 0;
    for (let i = 0; i < lines.length; i++) { acc += lines[i].length; if (acc <= shownChars) lastLine = i + 1; }
    if (lastLine >= n) start = Math.min(lines.length - n, lastLine - n + 1);
    const h = Math.max(portrait ? portrait.h + 6 : 0, n * LINE_H + 6);
    const by = opts.anchorBottom ? y - h : y;
    const sc = SCHOOLS[m.who] ? rgb(SCHOOLS[m.who].color) : C.white;
    // 吹き出し
    fb.rrect(x + pw, by, w - pw, h, C.ink);
    fb.rect(x + pw + 1, by + 1, w - pw - 2, h - 2, C.cream);
    fb.rect(x + pw + 1, by + 1, 2, h - 2, sc);
    // しっぽ
    fb.rect(x + pw - 2, by + 6, 3, 1, C.ink);
    fb.rect(x + pw - 1, by + 7, 2, 1, C.ink);
    fb.px(x + pw, by + 7, C.cream);
    if (portrait) {
      fb.rect(x - 1, by + (h - portrait.h) / 2 - 1, portrait.w + 2, portrait.h + 2, C.ink);
      fb.sprite(portrait, x, by + (h - portrait.h) / 2, portrait.cols, 1);
    }
    // 文字（1文字ずつ）
    let left = m.shown;
    for (let i = 0; i < start; i++) left -= lines[i].length;
    for (let i = 0; i < n; i++) {
      const line = lines[start + i];
      if (left <= 0) break;
      const s = left >= line.length ? line : line.slice(0, left);
      left -= line.length;
      text(fb, s, x + pw + 6, by + 3 + i * LINE_H - 1, C.ink);
    }
    // 続きがある印
    if (m.shown >= m.text.length && (this.queue.length || start + n < lines.length) && Math.floor(m.t * 3) % 2 === 0) {
      fb.rect(x + w - 6, by + h - 5, 3, 2, C.steel);
    }
    // タップで送る
    this.app.ui.btn('masters_skip', x, by, w, h, () => this.skip());
    return h;
  }
}
