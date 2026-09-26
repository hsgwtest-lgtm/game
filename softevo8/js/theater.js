/* =====================================================================
   SoftEvo 8 — theater.js
   「劇場」: Worker が評価した個体を決定論的に再生する
   ・single : チャンピオン + 同世代の上位個体をゴーストで
   ・match  : 対戦 (すもう / つなひき)。2体が同じ世界で押し合い、引き合う
   ・lanes  : レーンに並べて同時に走らせる (進化のパレード / 闘技場のかけっこ)
   ・脳の手術 (ノックアウト) をリアルタイムに適用
   ===================================================================== */
import { Creature, Match, FPS, groundY, formatFitness, RING_R } from './sim.js';
import { Camera, drawCreature, drawWorld, drawRope } from './world.js';
import { fitCanvas, clamp } from './ui.js';

const HIST = 240; // 記録するフレーム数 (4秒)
const POST = 50;  // 決着後の余韻 (フレーム)
export const WEST = '#5cc8ff', EAST = '#ff7b8a';

function sizeOf(bp) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of bp.nodes) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return Math.max(40, x1 - x0, y1 - y0);
}
const mainOf = u => (u instanceof Match ? u.A : u);
const unitDone = u => (u instanceof Match ? u.done && u.post >= POST : u.t >= u.steps || u.broken);

export class Theater {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.cam = new Camera();
    this.userZoom = 1;
    this.speed = 1;
    this.acc = 0;
    this.spec = null;
    this.units = [];
    this.ghosts = [];
    this.main = null;
    this.knock = null;
    this.finished = false;
    this.holdT = 0;
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
    this.size = sizeOf(bp);
  }

  knockCount() { return this.knock ? this.knock.reduce((s, k) => s + k.reduce((a, b) => a + b, 0), 0) : 0; }

  makeUnit(l) {
    const bp = l.bp || this.bp, layout = l.layout || this.layout;
    if (l.rival) {
      const m = new Match(l.env.objective, { bp, layout, genome: l.genome }, l.rival, l.env, l.opening);
      m.lane = l; m.post = 0;
      return m;
    }
    const c = new Creature(bp, layout, l.genome, l.env);
    c.lane = l; c.steps = Math.round(l.env.evalSeconds * FPS);
    return c;
  }

  play(spec) {
    this.spec = spec;
    this.finished = false; this.holdT = 0; this.acc = 0;
    this.trail = [];
    this.head = 0; this.filled = 0;
    this.ghosts = [];
    if (spec.kind === 'lanes') {
      this.units = spec.lanes.map(l => this.makeUnit(l));
      this.main = mainOf(this.units[spec.main ?? this.units.length - 1]);
    } else {
      this.units = [this.makeUnit(spec)];
      this.main = mainOf(this.units[0]);
      if (spec.kind === 'single') this.ghosts = (spec.ghosts || []).map(g => { const c = new Creature(this.bp, this.layout, g.genome, spec.env); c.hue = g.hue; return c; });
    }
    if (this.main.brain.sizes.length === this.knock.length) this.main.brain.knock = this.knock;
    let size = 0;
    for (const u of this.units) {
      if (u instanceof Match) size = Math.max(size, sizeOf(u.lane.bp || this.bp), sizeOf(u.lane.rival.bp));
      else size = Math.max(size, sizeOf(u.lane.bp || this.bp));
    }
    this.size = size;
    const [cx, cy] = this.main.centroid();
    this.cam.x = spec.kind === 'match' ? 0 : cx; this.cam.y = cy + 20;
  }

  get match() { return this.spec && this.spec.kind === 'match' ? this.units[0] : null; }

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
    const units = this.units;
    while (n-- > 0 && !units.every(unitDone)) {
      for (const u of units) {
        if (unitDone(u)) continue;
        u.step();
        if (u instanceof Match && u.done) {
          if (!u.announced) { u.announced = true; this.hooks.onDecision && this.hooks.onDecision(u); }
          u.post++;
        }
      }
      if (this.spec.kind === 'single' && this.showGhosts) for (const g of this.ghosts) if (g.t < units[0].steps) g.step();
      this.record();
    }
    if (units.every(unitDone)) this.finished = true;
  }

  record() {
    const m = this.main, h = this.head;
    for (let j = 0; j < this.M && j < m.out.length; j++) this.gaitOut[j][h] = m.out[j];
    for (let i = 0; i < m.n && i < this.gaitTouch.length; i++) this.gaitTouch[i][h] = m.contact[i];
    const acts = m.brain.acts;
    if (acts.length === this.actHist.length) for (let l = 0; l < acts.length; l++) for (let i = 0; i < acts[l].length; i++) this.actHist[l][i][h] = acts[l][i];
    this.head = (h + 1) % HIST; this.filled = Math.min(HIST, this.filled + 1);
    if (m.t % 4 === 0) { const [cx, cy] = m.centroid(); this.trail.push(cx, cy); if (this.trail.length > 600) this.trail.splice(0, 2); }
  }

  progress() {
    if (!this.main) return 0;
    let p = 0;
    for (const u of this.units) p = Math.max(p, u instanceof Match ? (u.done ? 1 : u.t / u.T) : u.t / u.steps);
    return clamp(p, 0, 1);
  }

  liveScore() {
    if (!this.main || this.spec.kind !== 'single') return '';
    const env = this.spec.env;
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
    if (!this.main || this.spec.kind === 'lanes' || !this.hooks.onTapBody) return;
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
    this.hooks.onTapBody(best);
  }

  // ─── 描画 ───
  render() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    if (!this.main) { ctx.fillStyle = '#070b16'; ctx.fillRect(0, 0, w, h); return; }
    if (this.spec.kind === 'lanes') return this.renderLanes(ctx, w, h);
    if (this.spec.kind === 'match') return this.renderMatch(ctx, w, h);
    const env = this.spec.env;
    const [cx, cy] = this.main.centroid();
    const baseZoom = clamp(Math.min(w, h * 1.4) / (this.size * 4.2), 0.35, 4);
    const Z = baseZoom * this.userZoom;
    this.cam.zoom = Z;
    this.cam.x += (cx - this.cam.x) * 0.12;
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
    drawCreature(ctx, this.main, this.glow());
    ctx.restore();

    // 生物の頭上ラベル
    const [hx, hy] = [this.cam.sx(cx, w), this.cam.sy(cy, h)];
    ctx.font = '700 12px system-ui'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(this.liveScore(), hx, hy - this.size * 0.75 * Z - 12);
  }

  glow() {
    const glowNodes = new Set(), glowEdges = new Set();
    if (this.highlight) {
      for (const n of this.highlight.nodes) glowNodes.add(n);
      for (const e of this.highlight.edges) glowEdges.add(e);
    }
    return { glowNodes, glowEdges };
  }

  /** 対戦の1番を大きく */
  renderMatch(ctx, w, h) {
    const m = this.units[0], A = m.A, B = m.B, sp = this.spec;
    const sumo = m.mode === 'sumo';
    const span = Math.abs(A.cx - B.cx);
    const viewW = clamp(span + this.size * 2.6, this.size * 3.2, sumo ? 2 * RING_R + 120 : 1e9);
    const Z = clamp(Math.min(w / viewW, h * 1.25 / (this.size * 3)), 0.2, 4) * this.userZoom;
    this.cam.zoom = Z;
    this.cam.x += ((A.cx + B.cx) / 2 - this.cam.x) * 0.12;
    this.cam.y += (h * 0.27 / Z - this.cam.y) * 0.1;

    drawWorld(ctx, this.cam, w, h, m.env.terrain, { battle: m.mode });
    ctx.save(); this.cam.apply(ctx, w, h);
    drawCreature(ctx, B, sp.tintRival === false ? {} : { tint: sp.rival.hue ?? 0 });
    drawCreature(ctx, A, this.glow());
    if (m.mode === 'tug') drawRope(ctx, A.x[A.front], A.y[A.front], B.x[B.front], B.y[B.front], m.ropeL);
    ctx.restore();

    // 名札
    const tag = (c, name, col) => {
      let top = -Infinity; for (let i = 0; i < c.n; i++) top = Math.max(top, c.y[i]);
      const sx = this.cam.sx(c.cx, w), sy = Math.max(16, this.cam.sy(top, h) - 12);
      ctx.font = '700 12px system-ui'; ctx.textAlign = 'center';
      const tw = ctx.measureText(name).width + 14;
      ctx.fillStyle = 'rgba(7,11,22,0.75)'; ctx.fillRect(sx - tw / 2, sy - 13, tw, 18);
      ctx.fillStyle = col; ctx.fillRect(sx - tw / 2, sy + 3, tw, 2);
      ctx.fillStyle = '#e8eefc'; ctx.fillText(name, sx, sy);
    };
    tag(A, sp.meName || '西', WEST);
    tag(B, sp.rival.name || '東', EAST);

    // 決着の垂れ幕
    if (m.done && sp.banner !== false) {
      const a = clamp(m.post / 12, 0, 1);
      const winName = m.winner === 0 ? sp.meName || '西' : m.winner === 1 ? sp.rival.name || '東' : null;
      ctx.save(); ctx.globalAlpha = a;
      const bw = Math.min(w - 24, 340), bh = 70, bx = (w - bw) / 2, by = h * 0.36 - bh / 2;
      ctx.fillStyle = 'rgba(7,11,22,0.86)'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = m.winner === 0 ? WEST : m.winner === 1 ? EAST : '#ffd166';
      ctx.fillRect(bx, by, 4, bh); ctx.fillRect(bx + bw - 4, by, 4, bh);
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffd166'; ctx.font = '900 26px system-ui';
      ctx.fillText(m.kimarite, w / 2, by + 32);
      ctx.fillStyle = '#e8eefc'; ctx.font = '700 14px system-ui';
      ctx.fillText(winName ? `${winName} の勝ち` : '勝負つかず', w / 2, by + 55);
      ctx.restore();
    }
  }

  /** レーン: パレード / かけっこ / 対戦のパレード */
  renderLanes(ctx, w, h) {
    const TOP = this.spec.top ?? 46;
    ctx.fillStyle = '#070b16'; ctx.fillRect(0, 0, w, TOP);
    ctx.save(); ctx.translate(0, TOP); h -= TOP;
    const units = this.units, L = units.length, lh = h / L;
    const bodies = units.filter(u => !(u instanceof Match));
    const cam = this.cam;
    if (bodies.length) {
      const lead = bodies.reduce((a, b) => (b.centroid()[0] > a.centroid()[0] ? b : a));
      const Z = clamp(Math.min(w / (this.size * 4.5), lh / (this.size * 1.5)), 0.25, 3) * this.userZoom;
      cam.zoom = Z;
      cam.x += (lead.centroid()[0] - w * 0.12 / Z - cam.x) * 0.1;
    }
    units.forEach((u, i) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, i * lh, w, lh); ctx.clip();
      ctx.translate(0, i * lh);
      const l = u.lane;
      let label = l.label;
      if (u instanceof Match) {
        const lc = new Camera();
        lc.zoom = clamp(Math.min(w / (u.mode === 'sumo' ? 2 * RING_R + 90 : Math.abs(u.A.cx - u.B.cx) + this.size * 3), lh / (this.size * 1.7)), 0.2, 3);
        lc.x = u.mode === 'sumo' ? 0 : (u.A.cx + u.B.cx) / 2;
        lc.y = lh * 0.28 / lc.zoom;
        drawWorld(ctx, lc, w, lh, u.env.terrain, { battle: u.mode });
        ctx.save(); lc.apply(ctx, w, lh);
        drawCreature(ctx, u.B, { tint: l.rival.hue ?? 0 });
        drawCreature(ctx, u.A, {});
        if (u.mode === 'tug') drawRope(ctx, u.A.x[u.A.front], u.A.y[u.A.front], u.B.x[u.B.front], u.B.y[u.B.front], u.ropeL);
        ctx.restore();
        if (u.done) label += u.winner === 0 ? `  ○ ${u.kimarite}` : u.winner === 1 ? `  ● ${u.kimarite}` : `  △ ${u.kimarite}`;
      } else {
        const savedY = cam.y;
        cam.y = groundY(l.env.terrain, u.centroid()[0]) + lh * 0.25 / cam.zoom;
        drawWorld(ctx, cam, w, lh, l.env.terrain, { startX: u.startX });
        ctx.save(); cam.apply(ctx, w, lh);
        drawCreature(ctx, u, {});
        ctx.restore();
        cam.y = savedY;
        label += `  ${formatFitness(u.fitness(l.env.objective), l.env.objective)}`;
        if (l.rank) label = `${l.rank} ${label}`;
      }
      ctx.font = '700 12px system-ui'; ctx.textAlign = 'left';
      const tw = Math.min(w - 16, ctx.measureText(label).width + 24);
      ctx.fillStyle = 'rgba(7,11,22,0.7)'; ctx.fillRect(8, 8, tw, 22);
      ctx.fillStyle = `hsl(${l.hue ?? 200},80%,70%)`; ctx.fillRect(8, 8, 4, 22);
      ctx.fillStyle = '#e8eefc';
      ctx.fillText(label, 18, 23);
      ctx.restore();
      ctx.fillStyle = 'rgba(120,160,255,0.25)'; ctx.fillRect(0, (i + 1) * lh - 1, w, 1);
    });
    ctx.restore();
  }
}
