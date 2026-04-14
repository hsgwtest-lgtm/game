// ── Vector2D utility ──
class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  clone() { return new Vec2(this.x, this.y); }
  set(x, y) { this.x = x; this.y = y; return this; }
  add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
  mul(s) { return new Vec2(this.x * s, this.y * s); }
  div(s) { return s ? new Vec2(this.x / s, this.y / s) : this.clone(); }
  dot(v) { return this.x * v.x + this.y * v.y; }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y); }
  lenSq() { return this.x * this.x + this.y * this.y; }
  norm() { const l = this.len(); return l > 0 ? this.div(l) : new Vec2(); }
  dist(v) { return this.sub(v).len(); }
  distSq(v) { const dx = this.x - v.x, dy = this.y - v.y; return dx * dx + dy * dy; }
  rot(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Vec2(this.x * c - this.y * s, this.x * s + this.y * c);
  }
  static rand(xMax, yMax) { return new Vec2(Math.random() * xMax, Math.random() * yMax); }
  static fromAngle(a, r = 1) { return new Vec2(Math.cos(a) * r, Math.sin(a) * r); }
}
