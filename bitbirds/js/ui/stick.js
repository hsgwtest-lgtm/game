// バーチャルスティック（画面のどこをドラッグしても操縦できる）＋ キーボード操作（PC用）

import { C } from './widgets.js';

export class Stick {
  constructor(radius = 22) {
    this.R = radius;
    this.active = false;
    this.ox = 0; this.oy = 0;   // 指を置いた位置
    this.px = 0; this.py = 0;   // 今の指の位置
    this.x = 0; this.y = 0;     // 出力 -1..1（y は上が +）
    this.keys = { l: 0, r: 0, u: 0, d: 0 };
    this.usedKeys = false;
    this._kd = (e) => this._key(e, 1);
    this._ku = (e) => this._key(e, 0);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
  }

  _key(e, v) {
    const k = e.key;
    let hit = true;
    if (k === 'ArrowLeft' || k === 'a') this.keys.l = v;
    else if (k === 'ArrowRight' || k === 'd') this.keys.r = v;
    else if (k === 'ArrowUp' || k === 'w') this.keys.u = v;
    else if (k === 'ArrowDown' || k === 's') this.keys.d = v;
    else hit = false;
    if (hit) { this.usedKeys = true; e.preventDefault(); }
  }

  get keyActive() { const k = this.keys; return !!(k.l || k.r || k.u || k.d); }

  // 人が操縦しているか（指 or キー）
  get touching() { return this.active || this.keyActive; }

  handlers() {
    return {
      down: (x, y) => { this.active = true; this.ox = x; this.oy = y; this.px = x; this.py = y; this._calc(); },
      move: (x, y) => { this.px = x; this.py = y; this._calc(); },
      up: () => { this.active = false; this.x = 0; this.y = 0; },
    };
  }

  _calc() {
    let dx = (this.px - this.ox) / this.R, dy = -(this.py - this.oy) / this.R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    if (l < 0.06) { dx = 0; dy = 0; }
    this.x = dx; this.y = dy;
  }

  // 現在の操縦値
  value() {
    if (this.active) return { x: this.x, y: this.y };
    const k = this.keys;
    if (this.keyActive) {
      let x = k.r - k.l, y = k.u - k.d;
      const l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      return { x, y };
    }
    return { x: 0, y: 0 };
  }

  reset() { this.active = false; this.x = 0; this.y = 0; this.keys = { l: 0, r: 0, u: 0, d: 0 }; }

  draw(fb) {
    if (!this.active) return;
    const R = this.R;
    fb.circle(this.ox | 0, this.oy | 0, R, C.white);
    fb.circle(this.ox | 0, this.oy | 0, R + 1, C.ink);
    const kx = Math.round(this.ox + this.x * R), ky = Math.round(this.oy - this.y * R);
    fb.disc(kx, ky, 6, C.ink);
    fb.disc(kx, ky, 5, C.white);
    fb.disc(kx, ky, 3, C.silver);
  }
}
