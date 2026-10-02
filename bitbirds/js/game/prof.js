// ドット博士の実況（学習の様子を言葉で解説する）

import { PROF, colors } from '../gfx/sprites.js';
import { wrap, text } from '../gfx/font.js';
import { C, bubble } from '../ui/widgets.js';

export class Prof {
  constructor(app) {
    this.app = app;
    this.queue = [];
    this.cur = null;
    this.t = 0;
    this.lastLen = 0;
    this.colors = colors();
    this.recent = new Map();   // key → 最後に言った時刻（同じことを何度も言わない）
    this.clock = 0;
  }

  say(msg, opts = {}) {
    const prio = opts.prio ?? 1;
    if (opts.key) {
      const last = this.recent.get(opts.key);
      if (last !== undefined && this.clock - last < (opts.cool ?? 20)) return;
      this.recent.set(opts.key, this.clock);
    }
    // 長い文は「。」で区切って順番に表示する（吹き出しは3行まで）
    const items = splitMsg(msg, 46).map(m => ({ msg: m, prio, dur: opts.dur ? Math.max(2.5, opts.dur * m.length / msg.length + 1) : Math.min(8, 2.4 + Array.from(m).length * 0.075) }));
    if (!this.cur || prio > this.cur.prio) {
      this.cur = items.shift(); this.t = 0; this.lastLen = 0;
      this.queue.unshift(...items);
    } else {
      this.queue.push(...items);
    }
    this.queue.sort((a, b) => b.prio - a.prio);
    if (this.queue.length > 6) this.queue.length = 6;
  }

  skip() {
    if (!this.cur) return;
    const n = Array.from(this.cur.msg).length;
    if (this.t * 32 < n) this.t = n / 32;   // まず全文表示
    else { this.cur = this.queue.shift() || null; this.t = 0; }
  }

  clear() { this.cur = null; this.queue = []; this.t = 0; }

  get busy() { return !!this.cur; }

  update(dt) {
    this.clock += dt;
    if (!this.cur) return;
    this.t += dt;
    const shown = Math.floor(this.t * 32);
    if (shown > this.lastLen && shown <= Array.from(this.cur.msg).length) this.app.sfx('type');
    this.lastLen = shown;
    if (this.t > this.cur.dur) { this.cur = this.queue.shift() || null; this.t = 0; this.lastLen = 0; }
  }

  // x,y: 左上。w: 幅。戻り値: 使った高さ（何も言っていなければ 0）
  draw(fb, x, y, w, lines = 2, tappable = true) {
    if (!this.cur) return 0;
    const bw = w - 20;
    const wrapped = wrap(this.cur.msg, bw - 8).slice(0, lines);
    const bh = wrapped.length * 12 + 5;
    const by = y;
    bubble(fb, x + 20, by, bw, bh);
    // しっぽ
    fb.rect(x + 18, by + bh - 7, 3, 1, C.ink); fb.rect(x + 17, by + bh - 6, 2, 1, C.ink);
    fb.rect(x + 19, by + bh - 6, 2, 1, C.cream);
    // 表示済みの文字だけ描く（タイプライター風）
    let n = Math.floor(this.t * 32);
    for (let i = 0; i < wrapped.length && n > 0; i++) {
      const arr = Array.from(wrapped[i]);
      text(fb, arr.slice(0, n).join(''), x + 24, by + 2 + i * 12, C.ink);
      n -= arr.length;
    }
    fb.sprite(PROF, x, by + bh - 16, this.colors);
    if (tappable) this.app.ui.btn('prof_skip', x, by, w, bh, () => this.skip());
    return bh;
  }
}

function splitMsg(msg, maxLen) {
  const sentences = [];
  let buf = '';
  for (const ch of msg) {
    buf += ch;
    if (ch === '。' || ch === '！' || ch === '？') { sentences.push(buf); buf = ''; }
  }
  if (buf.trim()) sentences.push(buf);
  const out = [];
  let cur = '';
  for (const sn of sentences) {
    if (cur && Array.from(cur + sn).length > maxLen) { out.push(cur); cur = sn; }
    else cur += sn;
  }
  if (cur) out.push(cur);
  return out.length ? out : [msg];
}
