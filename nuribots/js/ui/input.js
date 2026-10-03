// タッチ・マウス・キーボード入力。
// イベントをためておき、1フレームに「押した」「離した」を1回ずつ取り出す
// （すばやいタップでも取りこぼさない）。

export class Input {
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.r = renderer;
    this.queue = [];
    this.x = -999; this.y = -999;
    this.down = false;
    this.pressed = false; this.released = false;
    this.sx = 0; this.sy = 0;       // 押しはじめの位置
    this.moved = 0;                 // 押してから動いた最大距離（仮想px）
    this.dx = 0; this.dy = 0;       // このフレームの移動量
    this.wheel = 0;
    this.keys = [];                 // このフレームに押されたキー
    this.pid = null;
    this.onFirstGesture = null;
    const opt = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this._ev(e, 'down'), opt);
    window.addEventListener('pointermove', (e) => this._ev(e, 'move'), opt);
    window.addEventListener('pointerup', (e) => this._ev(e, 'up'), opt);
    window.addEventListener('pointercancel', (e) => this._ev(e, 'up'), opt);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.wheel += e.deltaY; }, opt);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey) return;
      this.keys.push(e.key);
      if (['ArrowUp', 'ArrowDown', ' ', 'Backspace'].includes(e.key)) e.preventDefault();
    });
    // iOS のダブルタップ拡大・長押しメニューを止める
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  _ev(e, type) {
    if (type === 'down') {
      if (this.pid !== null && this.pid !== e.pointerId) return;
      this.pid = e.pointerId;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (this.onFirstGesture) { const f = this.onFirstGesture; this.onFirstGesture = null; f(); }
    } else if (e.pointerId !== this.pid) return;
    if (type === 'up') this.pid = null;
    e.preventDefault();
    const v = this.r.toVirtual(e.clientX, e.clientY);
    this.queue.push({ type, x: v.x, y: v.y });
  }

  // フレームのはじめに呼ぶ
  frame() {
    this.pressed = false; this.released = false;
    this.dx = 0; this.dy = 0;
    let n = 0;
    while (this.queue.length) {
      const e = this.queue[0];
      if (e.type === 'move') {
        this.queue.shift();
        if (this.down) {
          this.dx += e.x - this.x; this.dy += e.y - this.y;
          this.moved = Math.max(this.moved, Math.hypot(e.x - this.sx, e.y - this.sy));
        }
        this.x = e.x; this.y = e.y;
        continue;
      }
      // 押す/離すは1フレームに1つまで
      if (n > 0) break;
      this.queue.shift();
      n++;
      if (e.type === 'down') {
        this.down = true; this.pressed = true;
        this.x = this.sx = e.x; this.y = this.sy = e.y;
        this.moved = 0;
      } else {
        if (!this.down) continue;
        this.down = false; this.released = true;
        this.x = e.x; this.y = e.y;
        this.moved = Math.max(this.moved, Math.hypot(e.x - this.sx, e.y - this.sy));
      }
    }
  }

  endFrame() { this.wheel = 0; this.keys.length = 0; }

  get tap() { return this.released && this.moved < 6; }

  in(x, y, w, h) { return this.x >= x && this.y >= y && this.x < x + w && this.y < y + h; }
}
