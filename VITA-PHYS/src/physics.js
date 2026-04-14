// ── Verlet Physics Engine ──
// Handles nodes (particles) and springs (constraints) using Verlet integration.

class PhysNode {
  constructor(pos, mass = 1) {
    this.pos = pos.clone();
    this.prev = pos.clone();
    this.acc = new Vec2();
    this.mass = mass;
    this.radius = 4;
    this.pinned = false;
  }
  applyForce(f) {
    this.acc.x += f.x / this.mass;
    this.acc.y += f.y / this.mass;
  }
  integrate(dt, damping) {
    if (this.pinned) return;
    const vx = (this.pos.x - this.prev.x) * damping;
    const vy = (this.pos.y - this.prev.y) * damping;
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
    this.pos.x += vx + this.acc.x * dt * dt;
    this.pos.y += vy + this.acc.y * dt * dt;
    this.acc.x = 0;
    this.acc.y = 0;
  }
}

class PhysSpring {
  constructor(a, b, restLen, stiffness = 0.5) {
    this.a = a;
    this.b = b;
    this.restLen = restLen;
    this.stiffness = stiffness;
    this.broken = false;
    this.maxStretch = 2.5; // breaks if stretched beyond this ratio
  }
  solve() {
    if (this.broken) return;
    const dx = this.b.pos.x - this.a.pos.x;
    const dy = this.b.pos.y - this.a.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const ratio = dist / this.restLen;

    if (ratio > this.maxStretch) {
      this.broken = true;
      return;
    }

    const diff = (this.restLen - dist) / dist * this.stiffness;
    const ox = dx * diff * 0.5;
    const oy = dy * diff * 0.5;

    if (!this.a.pinned) { this.a.pos.x -= ox; this.a.pos.y -= oy; }
    if (!this.b.pinned) { this.b.pos.x += ox; this.b.pos.y += oy; }
  }
}

class PhysWall {
  constructor(x1, y1, x2, y2) {
    this.a = new Vec2(x1, y1);
    this.b = new Vec2(x2, y2);
  }
  // Returns the closest point on the wall segment to point p
  closestPoint(p) {
    const ab = this.b.sub(this.a);
    const ap = p.sub(this.a);
    let t = ap.dot(ab) / ab.lenSq();
    t = Math.max(0, Math.min(1, t));
    return this.a.add(ab.mul(t));
  }
}

class PhysicsEngine {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.gravity = new Vec2(0, 150);
    this.damping = 0.98;
    this.iterations = 4;
    this.walls = [];
  }

  step(nodes, springs, dt) {
    // Apply gravity
    for (const n of nodes) {
      n.applyForce(this.gravity.mul(n.mass));
    }

    // Integrate
    for (const n of nodes) {
      n.integrate(dt, this.damping);
    }

    // Solve constraints
    for (let i = 0; i < this.iterations; i++) {
      for (const s of springs) {
        s.solve();
      }
      this.solveBounds(nodes);
      this.solveWalls(nodes);
    }
  }

  solveBounds(nodes) {
    for (const n of nodes) {
      if (n.pinned) continue;
      const r = n.radius;
      if (n.pos.x < r) { n.pos.x = r; }
      if (n.pos.x > this.width - r) { n.pos.x = this.width - r; }
      if (n.pos.y < r) { n.pos.y = r; }
      if (n.pos.y > this.height - r) { n.pos.y = this.height - r; }
    }
  }

  solveWalls(nodes) {
    for (const wall of this.walls) {
      for (const n of nodes) {
        if (n.pinned) continue;
        const cp = wall.closestPoint(n.pos);
        const dx = n.pos.x - cp.x;
        const dy = n.pos.y - cp.y;
        const distSq = dx * dx + dy * dy;
        const minDist = n.radius + 3;
        if (distSq < minDist * minDist && distSq > 0.001) {
          const dist = Math.sqrt(distSq);
          const push = (minDist - dist) / dist;
          n.pos.x += dx * push;
          n.pos.y += dy * push;
        }
      }
    }
  }
}
