/* =====================================================================
   SoftEvo 8 — theater.js
   「劇場」: Worker が評価した個体を決定論的に再生する
   ・チャンピオン + 同世代の上位個体をゴーストで
   ・パレード: 過去の節目の世代をレーンに並べて同時に走らせる
   ・脳の手術 (ノックアウト) をリアルタイムに適用
   ===================================================================== */
import { Creature, FPS, groundY, formatFitness } from './sim.js';
import { Camera, drawCreature, drawWorld } from './world.js';
import { fitCanvas, clamp } from './ui.js';

const HIST = 240; // 記録するフレーム数 (4秒)

export class Theater {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.cam = new Camera();
    this.userZoom = 1;
    this.speed = 1;
    this.acc = 0;
    this.spec = null;
    this.bodies = [];
    this.main = null;
    this.knock = null;
    this.finished = false;
    this.holdT = 0;
    this.sel = { edge: -1, node: -1 };
    this.showGhosts = true;
    this.trail = [];
    this.bindInput();
  }

  setRun(bp, layout) {
    this.bp = bp; this.layout = layout;
    this.knock = layout.sizes.map(n => new Uint8Array(n));
    this.M = layout.outputs.length;
    this.gaitOut = Array.from({ length: this.M }, () => new Float32Array(HIST));
    this.gaitTouch = Array.from({ length: bp.nodes.length }, () => new Uint8Array(HIST));
    this.actHist = layout.sizes.map(n => Array.from({ length: n }, () => new Float32Array(HIST)));
    this.head = 0; this.filled = 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of bp.nodes) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    this.size = Math.max(40, x1 - x0, y1 - y0);
  }

  knockCount() { return this.knock ? this.knock.reduce((s, k) => s + k.reduce((a, b) => a + b, 0), 0) : 0; }

  make(genome, env) {
    const c = new Creature(this.bp, this.layout, genome, env);
    c.brain.knock = this.knock;
    return c;
  }

  play(spec) {
    this.spec = spec;
    this.finished = false; this.holdT = 0; this.acc = 0;
    this.trail = [];
    this.head = 0; this.filled = 0;
    if (spec.kind === 'parade') {
      this.bodies = spec.lanes.map(l => { const c = new Creature(this.bp, this.layout, l.genome, l.env); c.lane = l; return c; });
      this.main = this.bodies[this.bodies.length - 1];
      this.main.brain.knock = this.knock;
    } else {
      this.main = this.make(spec.genome, spec.env);
      this.bodies = [this.main];
      this.ghosts = (spec.ghosts || []).map(g => { const c = new Creature(this.bp, this.layout, g.genome, spec.env); c.hue = g.hue; return c; });
    }
    const [cx, cy] = this.main.centroid();
    this.cam.x = cx; this.cam.y = cy + 20;
    this.steps = Math.round((spec.kind === 'parade' ? spec.lanes[0].env : spec.env).evalSeconds * FPS);
  }

  update(dt) {
    if (!this.main) return;
    if (this.finished) {
      this.holdT += dt;
      if (this.holdT > 1.6 / Math.max(1, this.speed * 0.5)) { const f = this.hooks.onFinish; this.holdT = -1e9; f && f(); }
      return;
    }
    this.acc += dt * FPS * this.speed;
    let n = Math.min(Math.floor(this.acc), 40);
    this.acc -= Math.floor(this.acc);
    while (n-- > 0 && this.main.t < this.steps) {
      for (const b of this.bodies) if (b.t < this.steps) b.step();
      if (this.spec.kind !== 'parade' && this.showGhosts) for (const g of this.ghosts) if (g.t < this.steps) g.step();
      this.record();
    }
    if (this.main.t >= this.steps) this.finished = true;
  }

  record() {
    const m = this.main, h = this.head;
    for (let j = 0; j < this.M; j++) this.gaitOut[j][h] = m.out[j];
    for (let i = 0; i < m.n; i++) this.gaitTouch[i][h] = m.contact[i];
    const acts = m.brain.acts;
    for (let l = 0; l < acts.length; l++) for (let i = 0; i < acts[l].length; i++) this.actHist[l][i][h] = acts[l][i];
    this.head = (h + 1) % HIST; this.filled = Math.min(HIST, this.filled + 1);
    if (m.t % 4 === 0) { const [cx, cy] = m.centroid(); this.trail.push(cx, cy); if (this.trail.length > 600) this.trail.splice(0, 2); }
  }

  progress() { return this.main ? clamp(this.main.t / this.steps, 0, 1) : 0; }

  liveScore() {
    if (!this.main) return '';
    const env = this.spec.kind === 'parade' ? this.spec.lanes[0].env : this.spec.env;
    return formatFitness(this.main.fitness(env.objective), env.objective);
  }

  // ─── 入力: ズーム / 筋肉タップ ───
  bindInput() {
    const c = this.canvas;
    const ptrs = new Map(); let pinch = null, down = null;
    c.addEventListener('wheel', e => { e.preventDefault(); this.userZoom = clamp(this.userZoom * Math.exp(-e.deltaY * 0.0015), 0.25, 5); }, { passive: false });
    c.addEventListener('pointerdown', e => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.userZoom }; }
      else down = { x: e.clientX, y: e.clientY };
    });
    c.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; this.userZoom = clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(10, pinch.d), 0.25, 5); }
    });
    const end = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (down && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) this.tap(e);
      down = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  tap(e) {
    if (!this.main || this.spec.kind === 'parade') return;
    const r = this.canvas.getBoundingClientRect(), w = r.width, h = r.height;
    const px = this.cam.wx(e.clientX - r.left, w), py = this.cam.wy(e.clientY - r.top, h);
    const m = this.main, R = 16 / this.cam.zoom;
    let best = null, bd = R;
    for (let i = 0; i < m.n; i++) { const d = Math.hypot(m.x[i] - px, m.y[i] - py); if (d < bd) { bd = d; best = { node: i }; } }
    if (!best) {
      m.muscleEdge.forEach((e2, j) => {
        const A = m.ea[e2], B = m.eb[e2];
        const dx = m.x[B] - m.x[A], dy = m.y[B] - m.y[A], L = dx * dx + dy * dy || 1;
        const t = clamp(((px - m.x[A]) * dx + (py - m.y[A]) * dy) / L, 0, 1);
        const d = Math.hypot(m.x[A] + dx * t - px, m.y[A] + dy * t - py);
        if (d < bd) { bd = d; best = { muscle: j }; }
      });
    }
    this.hooks.onTapBody && this.hooks.onTapBody(best);
  }

  // ─── 描画 ───
  render() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    if (!this.main) { ctx.fillStyle = '#070b16'; ctx.fillRect(0, 0, w, h); return; }
    if (this.spec.kind === 'parade') return this.renderParade(ctx, w, h);
    const env = this.spec.env;
    const [cx, cy] = this.main.centroid();
    const baseZoom = clamp(Math.min(w, h * 1.4) / (this.size * 4.2), 0.35, 4);
    const Z = baseZoom * this.userZoom;
    this.cam.zoom = Z;
    this.cam.x += (cx + 40 / Z * 0 - this.cam.x) * 0.12;
    const gy = groundY(env.terrain, cx);
    const targetY = env.objective === 'jump' ? Math.max(cy, gy + h * 0.28 / Z) : gy + h * 0.22 / Z;
    this.cam.y += (targetY - this.cam.y) * 0.08;

    drawWorld(ctx, this.cam, w, h, env.terrain, { startX: this.main.startX, record: this.spec.record });

    ctx.save(); this.cam.apply(ctx, w, h);
    // 軌跡
    if (this.trail.length > 4) {
      ctx.strokeStyle = 'rgba(255,209,102,0.25)'; ctx.lineWidth = 1.5 / Z; ctx.setLineDash([3 / Z, 5 / Z]);
      ctx.beginPath(); ctx.moveTo(this.trail[0], this.trail[1]);
      for (let i = 2; i < this.trail.length; i += 2) ctx.lineTo(this.trail[i], this.trail[i + 1]);
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.showGhosts) for (const g of this.ghosts) drawCreature(ctx, g, { ghost: g.hue, alpha: 0.28, eyes: false });
    const glowNodes = new Set(), glowEdges = new Set();
    if (this.highlight) {
      for (const n of this.highlight.nodes) glowNodes.add(n);
      for (const e of this.highlight.edges) glowEdges.add(e);
    }
    drawCreature(ctx, this.main, { glowNodes, glowEdges });
    ctx.restore();

    // 生物の頭上ラベル
    const [hx, hy] = [this.cam.sx(cx, w), this.cam.sy(cy, h)];
    ctx.font = '700 12px system-ui'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(this.liveScore(), hx, hy - this.size * 0.75 * Z - 12);
  }

  renderParade(ctx, w, h) {
    const TOP = 46;
    ctx.fillStyle = '#070b16'; ctx.fillRect(0, 0, w, TOP);
    ctx.save(); ctx.translate(0, TOP); h -= TOP;
    const lanes = this.bodies, L = lanes.length, lh = h / L;
    const lead = lanes.reduce((a, b) => (b.centroid()[0] > a.centroid()[0] ? b : a));
    const Z = clamp(Math.min(w / (this.size * 4.5), lh / (this.size * 1.5)), 0.25, 3) * this.userZoom;
    this.cam.zoom = Z;
    this.cam.x += (lead.centroid()[0] - w * 0.12 / Z - this.cam.x) * 0.1;
    lanes.forEach((b, i) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, i * lh, w, lh); ctx.clip();
      ctx.translate(0, i * lh);
      const cam = this.cam;
      const savedY = cam.y;
      cam.y = groundY(b.lane.env.terrain, b.centroid()[0]) + lh * 0.25 / Z;
      drawWorld(ctx, cam, w, lh, b.lane.env.terrain, { startX: b.startX });
      ctx.save(); cam.apply(ctx, w, lh);
      drawCreature(ctx, b, {});
      ctx.restore();
      cam.y = savedY;
      // ラベル
      ctx.fillStyle = 'rgba(7,11,22,0.7)'; ctx.fillRect(8, 8, 190, 22);
      ctx.fillStyle = `hsl(${b.lane.hue},80%,70%)`; ctx.fillRect(8, 8, 4, 22);
      ctx.fillStyle = '#e8eefc'; ctx.font = '700 12px system-ui'; ctx.textAlign = 'left';
      ctx.fillText(`${b.lane.label}  ${formatFitness(b.fitness(b.lane.env.objective), b.lane.env.objective)}`, 18, 23);
      ctx.restore();
      ctx.fillStyle = 'rgba(120,160,255,0.25)'; ctx.fillRect(0, (i + 1) * lh - 1, w, 1);
    });
    ctx.restore();
  }
}
