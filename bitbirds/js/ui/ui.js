// 入力とボタン判定（イミディエイト方式）
// 画面は毎フレーム ui.btn(...) / ui.area(...) で「押せる場所」を登録し、
// タッチはひとつ前のフレームの登録内容で判定する。

export class UI {
  constructor(app) {
    this.app = app;
    this.regions = [];   // 判定に使う（前フレーム）
    this.next = [];      // このフレームで登録中
    this.pressId = null;
    this.capture = null; // ドラッグ中のエリア
    this.pointerId = null;
    this.px = -1; this.py = -1;
    this.down = false;
    this.tapQueue = [];
    this.onFirstTouch = null;
    this.onTouchEnd = null;    // iOS は指を離した時に音を有効にする必要がある場合がある
    const c = app.canvas;
    const opt = { passive: false };
    c.addEventListener('pointerdown', (e) => this._down(e), opt);
    c.addEventListener('pointermove', (e) => this._move(e), opt);
    c.addEventListener('pointerup', (e) => this._up(e), opt);
    c.addEventListener('pointercancel', (e) => this._cancel(e), opt);
    // iOS のスクロール・拡大・長押しメニューを止める
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'dblclick', 'contextmenu']) {
      c.addEventListener(ev, (e) => e.preventDefault(), opt);
    }
  }

  begin() {
    this.regions = this.next;
    this.next = [];
  }

  // ボタン。押されている間 true を返す（見た目用）
  btn(id, x, y, w, h, onTap, opts = null) {
    this.next.push({ kind: 'btn', id, x, y, w, h, onTap, repeat: opts && opts.repeat });
    return this.pressId === id && this.down && this._inside({ x, y, w, h }, this.px, this.py);
  }

  // ドラッグできるエリア（handlers: {down(x,y), move(x,y), up(x,y)}）
  area(id, x, y, w, h, handlers) {
    this.next.push({ kind: 'area', id, x, y, w, h, handlers });
  }

  isPressed(id) { return this.pressId === id && this.down; }

  _inside(r, x, y) { return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h; }

  _find(x, y) {
    // 後から登録したもの（上に描かれたもの）が優先
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (this._inside(r, x, y)) return r;
    }
    return null;
  }

  _pos(e) { return this.app.px.toVirtual(e.clientX, e.clientY); }

  _down(e) {
    e.preventDefault();
    if (this.onFirstTouch) { const f = this.onFirstTouch; this.onFirstTouch = null; f(); }
    if (this.pointerId !== null) return;   // マルチタッチは最初の指だけ
    this.pointerId = e.pointerId;
    try { this.app.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    const p = this._pos(e);
    this.px = p.x; this.py = p.y; this.down = true;
    const r = this._find(p.x, p.y);
    if (!r) return;
    if (r.kind === 'btn') {
      this.pressId = r.id;
    } else if (r.kind === 'area') {
      this.capture = r;
      r.handlers.down && r.handlers.down(p.x, p.y);
    }
  }

  _move(e) {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const p = this._pos(e);
    this.px = p.x; this.py = p.y;
    if (this.capture) {
      // 最新の登録内容のハンドラを使う
      const cur = this.regions.find(r => r.id === this.capture.id) || this.capture;
      cur.handlers.move && cur.handlers.move(p.x, p.y);
    }
  }

  _up(e) {
    if (this.onTouchEnd) this.onTouchEnd();
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const p = this._pos(e);
    this.px = p.x; this.py = p.y;
    if (this.capture) {
      const cur = this.regions.find(r => r.id === this.capture.id) || this.capture;
      cur.handlers.up && cur.handlers.up(p.x, p.y);
      this.capture = null;
    } else if (this.pressId !== null) {
      const r = this.regions.find(rr => rr.id === this.pressId);
      if (r && this._inside(r, p.x, p.y) && r.onTap) this.tapQueue.push(r.onTap);
    }
    this.pressId = null;
    this.down = false;
    this.pointerId = null;
  }

  _cancel(e) {
    if (e.pointerId !== this.pointerId) return;
    if (this.capture) {
      const cur = this.regions.find(r => r.id === this.capture.id) || this.capture;
      cur.handlers.up && cur.handlers.up(this.px, this.py);
      this.capture = null;
    }
    this.pressId = null; this.down = false; this.pointerId = null;
  }

  // update の最初に呼ぶ：たまったタップを実行
  flush() {
    const q = this.tapQueue;
    this.tapQueue = [];
    for (const f of q) f();
  }

  // 画面切り替え時に入力状態をリセット
  reset() {
    this.capture = null; this.pressId = null; this.tapQueue = [];
  }
}
