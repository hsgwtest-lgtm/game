// input.js — タッチ操作（1本指で回転、2本指でズーム・移動、タップで道具を使う）
export class Gestures {
  constructor(el, view, onTap) {
    this.el = el;
    this.view = view;
    this.onTap = onTap;
    this.pts = new Map();
    this.drag = false;
    this.downAt = 0;
    this.start = null;
    this.pinch = null;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.cancel(e));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.view.zoom(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari のページ拡大を止める
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
  }

  down(e) {
    this.el.setPointerCapture?.(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pts.size === 1) {
      this.drag = false;
      this.downAt = performance.now();
      this.start = { x: e.clientX, y: e.clientY };
      this.button = e.button;
    } else if (this.pts.size === 2) {
      this.drag = true;
      this.pinch = this.pinchState();
    }
  }

  pinchState() {
    const [a, b] = [...this.pts.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  move(e) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pts.size === 1) {
      if (!this.drag && Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > 8) this.drag = true;
      if (this.drag) {
        if (this.button === 2 || e.shiftKey) this.view.pan(dx, dy);
        else this.view.rotate(dx, dy);
      }
    } else if (this.pts.size === 2 && this.pinch) {
      const s = this.pinchState();
      this.view.zoom(this.pinch.d / s.d);
      this.view.pan(s.mx - this.pinch.mx, s.my - this.pinch.my);
      this.pinch = s;
    }
  }

  up(e) {
    const wasSingle = this.pts.size === 1;
    this.pts.delete(e.pointerId);
    if (this.pts.size < 2) this.pinch = null;
    if (wasSingle && !this.drag && performance.now() - this.downAt < 500) this.onTap(e.clientX, e.clientY);
    if (this.pts.size === 0) this.drag = false;
  }

  cancel(e) {
    this.pts.delete(e.pointerId);
    this.pinch = null;
    if (this.pts.size === 0) this.drag = false;
  }
}
