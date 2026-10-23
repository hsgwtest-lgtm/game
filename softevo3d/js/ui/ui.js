// 入力とボタン判定（イミディエイト方式）
// 画面は毎フレーム ui.btn(...) / ui.area(...) で「押せる場所」を登録し、
// タッチはひとつ前のフレームの登録内容で判定する。
// area は2本指のピンチ（handlers.pinch(倍率, 中心x, 中心y, 中心の移動dx, dy)）にも対応。

export class UI {
  constructor(app) {
    this.app = app;
    this.regions = [];
    this.next = [];
    this.pressId = null;
    this.capture = null;
    this.pointerId = null;
    this.px = -1; this.py = -1;
    this.down = false;
    this.tapQueue = [];
    this.onFirstTouch = null;
    this.onTouchEnd = null;
    this.pointers = new Map();     // id → {x, y}
    this.pinch = null;             // { d, cx, cy }
    this.wheelHandler = null;
    const c = app.canvas;
    const opt = { passive: false };
    c.addEventListener('pointerdown', (e) => this._down(e), opt);
    c.addEventListener('pointermove', (e) => this._move(e), opt);
    c.addEventListener('pointerup', (e) => this._up(e), opt);
    c.addEventListener('pointercancel', (e) => this._cancel(e), opt);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this._pos(e);
      const r = this._find(p.x, p.y);
      if (r && r.kind === 'area' && r.handlers.pinch) r.handlers.pinch(Math.exp(-e.deltaY * 0.0015), p.x, p.y, 0, 0);
    }, opt);
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'gesturechange', 'dblclick', 'contextmenu']) {
      c.addEventListener(ev, (e) => e.preventDefault(), opt);
    }
  }

  begin() {
    this.regions = this.next;
    this.next = [];
  }

  // ボタン。押されている間 true を返す（見た目用）
  btn(id, x, y, w, h, onTap, opts = null) {
    this.next.push({ kind: 'btn', id, x, y, w, h, onTap, immediate: !!(opts && opts.immediate) });
    return this.pressId === id && this.down && this._inside({ x, y, w, h }, this.px, this.py);
  }

  // ドラッグできるエリア（handlers: {down(x,y), move(x,y), up(x,y,moved), pinch(...)}）
  area(id, x, y, w, h, handlers) {
    this.next.push({ kind: 'area', id, x, y, w, h, handlers });
  }

  isPressed(id) { return this.pressId === id && this.down; }

  _inside(r, x, y) { return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h; }

  _find(x, y) {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (this._inside(r, x, y)) return r;
    }
    return null;
  }

  _cur() { return this.capture ? (this.regions.find(r => r.id === this.capture.id) || this.capture) : null; }

  _pos(e) { return this.app.px.toVirtual(e.clientX, e.clientY); }

  _down(e) {
    e.preventDefault();
    if (this.onFirstTouch) { const f = this.onFirstTouch; this.onFirstTouch = null; f(); }
    const p = this._pos(e);
    this.pointers.set(e.pointerId, p);
    try { this.app.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    if (this.pointerId !== null) {
      // 2本目の指: ピンチを始める
      const cur = this._cur();
      if (cur && cur.handlers.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        if (cur.handlers.cancelTap) cur.handlers.cancelTap();
      }
      return;
    }
    this.pointerId = e.pointerId;
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
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const p = this._pos(e);
    this.pointers.set(e.pointerId, p);
    if (this.pinch) {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const cur = this._cur();
      if (cur && cur.handlers.pinch) cur.handlers.pinch(d / this.pinch.d, cx, cy, cx - this.pinch.cx, cy - this.pinch.cy);
      this.pinch.d = d; this.pinch.cx = cx; this.pinch.cy = cy;
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    this.px = p.x; this.py = p.y;
    const cur = this._cur();
    if (cur) cur.handlers.move && cur.handlers.move(p.x, p.y);
  }

  _up(e) {
    if (this.onTouchEnd) this.onTouchEnd();
    this.pointers.delete(e.pointerId);
    e.preventDefault();
    if (this.pinch) {
      // ピンチ中に指が離れたら、全部の指が離れるまで何もしない
      if (this.pointers.size === 0) this._endGesture(false);
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    const p = this._pos(e);
    this.px = p.x; this.py = p.y;
    if (this.capture) {
      const cur = this._cur();
      cur.handlers.up && cur.handlers.up(p.x, p.y);
      this.capture = null;
    } else if (this.pressId !== null) {
      const r = this.regions.find(rr => rr.id === this.pressId);
      if (r && this._inside(r, p.x, p.y) && r.onTap) {
        // クリップボード・共有・ファイル選択は「指を離したその場」で実行する必要がある（iOS）
        if (r.immediate) { try { r.onTap(); } catch (err) { console.error(err); } }
        else this.tapQueue.push(r.onTap);
      }
    }
    this.pressId = null;
    this.down = false;
    this.pointerId = null;
  }

  _endGesture(callUp) {
    const cur = this._cur();
    if (cur && callUp && cur.handlers.up) cur.handlers.up(this.px, this.py);
    if (cur && cur.handlers.pinchEnd) cur.handlers.pinchEnd();
    this.capture = null; this.pinch = null; this.pressId = null; this.down = false; this.pointerId = null;
  }

  _cancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size === 0) this._endGesture(false); return; }
    if (e.pointerId !== this.pointerId) return;
    const cur = this._cur();
    if (cur && cur.handlers.cancelTap) cur.handlers.cancelTap();
    if (cur && cur.handlers.up) cur.handlers.up(this.px, this.py);
    this.capture = null; this.pressId = null; this.down = false; this.pointerId = null;
  }

  flush() {
    const q = this.tapQueue;
    this.tapQueue = [];
    for (const f of q) f();
  }

  reset() {
    this.capture = null; this.pressId = null; this.tapQueue = []; this.pinch = null;
  }
}
