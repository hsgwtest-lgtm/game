// input.js — 島のカメラをタッチで動かす（ブラウザ用）
//   1本指: 回す / 2本指: つまんでズーム＋平行移動 / マウスホイール: ズーム / タップ: 生き物を選ぶ
export class Gestures {
  constructor(el, view, onTap) {
    this.el = el;
    this.view = view;
    this.onTap = onTap;
    this.pts = new Map();
    this.down = null;
    this.pinch = null;
    el.addEventListener('pointerdown', (e) => this.pd(e));
    el.addEventListener('pointermove', (e) => this.pm(e));
    el.addEventListener('pointerup', (e) => this.pu(e));
    el.addEventListener('pointercancel', (e) => this.pu(e, true));
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.view.orbit.rad *= Math.exp(e.deltaY * 0.0012);
      },
      { passive: false }
    );
  }
  pd(e) {
    this.el.setPointerCapture?.(e.pointerId);
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pts.size === 1) this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    else {
      this.down = null;
      this.pinch = this.pinchState();
    }
  }
  pinchState() {
    const [a, b] = [...this.pts.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
  pm(e) {
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const o = this.view.orbit;
    if (this.pts.size === 1 && this.down) {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8) this.down.moved = true;
      if (this.down.moved) {
        o.az += dx * 0.008;
        o.pol -= dy * 0.006;
      }
    } else if (this.pts.size === 2 && this.pinch) {
      const s = this.pinchState();
      o.rad *= this.pinch.d / s.d;
      // 画面上の移動を、カメラの向きにそって地面の移動にする
      const mx = s.cx - this.pinch.cx;
      const my = s.cy - this.pinch.cy;
      const k = o.rad * 0.0018;
      o.tx += (-Math.sin(o.az) * mx - Math.cos(o.az) * my) * k;
      o.tz += (Math.cos(o.az) * mx - Math.sin(o.az) * my) * k;
      this.pinch = s;
    }
  }
  pu(e, cancel = false) {
    this.pts.delete(e.pointerId);
    if (this.down && !cancel && !this.down.moved && performance.now() - this.down.t < 450) this.onTap(e.clientX, e.clientY);
    this.down = null;
    if (this.pts.size === 2) this.pinch = this.pinchState();
    else this.pinch = null;
  }
}
