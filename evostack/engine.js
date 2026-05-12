/* ═══════════════════════════════════════════════════════════════════════
   EvoStack — エヴォスタック
   軟体生物が進化してブロックをゴールへ積み上げる

   ■ SoftEvo7 から受け継いだもの
       Verlet 物理、ニューラルネット筋肉制御、遺伝的アルゴリズム、
       リアルタイム進化可視化

   ■ TerraTower から受け継いだもの
       物理ブロックの積み重ね、ゴールシャフト高さスコア、
       動的ブロック追加、重力落下によるタワー成長

   ゼロ依存: 自作 Verlet 物理 + 自作 NN + GA
═══════════════════════════════════════════════════════════════════════ */

(function () {
'use strict';

// ── Configuration ─────────────────────────────────────────────────────────────
const CFG = {
  // World
  WORLD_W:   280,
  WORLD_H:   185,
  GROUND_Y:  132,     // main ground level

  // Goal pit (right side of world)
  GOAL_X:    258,     // pit entrance x (= WORLD_W - GOAL_W)
  GOAL_W:     22,     // pit width  (just over 1 block wide)
  PIT_Y:     175,     // pit floor y

  // Blocks
  BLOCK_W:    16,
  BLOCK_H:    16,
  NUM_BLOCKS:  9,

  // Block physics
  GRAVITY:    820,
  BLOCK_BOUNCE: 0.15,
  BLOCK_X_DAMP: 0.968,
  SLEEP_V:    0.11,
  SLEEP_WAIT:  24,

  // Creature (5-node worm)
  NUM_NODES:   5,
  NODE_R:      5,
  BONE_LEN:   14,
  MUSCLE_AMP:  5,
  DAMP:        0.983,
  PUSH_RATIO:  0.32,

  // Neural net  (8 → 12 → 4)
  NN_IN:  8,
  NN_H:  12,
  NN_OUT:  4,

  // GA
  POP:    20,
  ELITE:   4,
  MUT_R:  0.16,
  MUT_S:  0.42,
  EVAL_S: 14,

  // Camera / render
  CAM_EASE: 0.07,
};

const G_SIZE = CFG.NN_IN * CFG.NN_H + CFG.NN_H
             + CFG.NN_H  * CFG.NN_OUT + CFG.NN_OUT;

// ── Utilities ─────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const lerp   = (a, b, t)  => a + (b - a) * t;
const rng    = (lo, hi)   => lo + Math.random() * (hi - lo);

function randNorm() {
  let u, v;
  do { u = Math.random(); } while (!u);
  do { v = Math.random(); } while (!v);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Neural Network ─────────────────────────────────────────────────────────────
class NeuralNet {
  constructor(genome) {
    const { NN_IN: I, NN_H: H, NN_OUT: O } = CFG;
    let g = 0;
    this.W1 = Array.from({ length: H }, () =>
      Float64Array.from({ length: I }, () => genome[g++]));
    this.b1 = Float64Array.from({ length: H }, () => genome[g++]);
    this.W2 = Array.from({ length: O }, () =>
      Float64Array.from({ length: H }, () => genome[g++]));
    this.b2 = Float64Array.from({ length: O }, () => genome[g++]);
    this._h = new Float64Array(H);
  }

  forward(inputs) {
    const { NN_H: H, NN_OUT: O } = CFG;
    const h = this._h;
    for (let i = 0; i < H; i++) {
      let s = this.b1[i];
      const row = this.W1[i];
      for (let j = 0; j < inputs.length; j++) s += row[j] * inputs[j];
      h[i] = Math.tanh(s);
    }
    const out = new Float64Array(O);
    for (let i = 0; i < O; i++) {
      let s = this.b2[i];
      const row = this.W2[i];
      for (let j = 0; j < H; j++) s += row[j] * h[j];
      out[i] = Math.tanh(s);
    }
    return out;
  }

  static randomGenome() {
    return Float64Array.from({ length: G_SIZE }, () => randNorm() * 0.55);
  }
}

// ── Genetic Algorithm ──────────────────────────────────────────────────────────
function gaEvolve(creatures) {
  const sorted = [...creatures].sort((a, b) => b.fitness - a.fitness);
  const genomes = [];
  for (let i = 0; i < CFG.ELITE; i++) genomes.push(new Float64Array(sorted[i].genome));
  while (genomes.length < CFG.POP) {
    const pa = _tournament(sorted);
    const pb = _tournament(sorted);
    const child = _cross(pa.genome, pb.genome);
    _mutate(child);
    genomes.push(child);
  }
  return genomes;
}

function _tournament(sorted) {
  let best = null;
  for (let i = 0; i < 3; i++) {
    const c = sorted[(Math.random() * sorted.length) | 0];
    if (!best || c.fitness > best.fitness) best = c;
  }
  return best;
}

function _cross(gA, gB) {
  return Float64Array.from(gA, (v, i) => Math.random() < 0.5 ? v : gB[i]);
}

function _mutate(g) {
  for (let i = 0; i < g.length; i++) {
    if (Math.random() < CFG.MUT_R) g[i] += randNorm() * CFG.MUT_S;
  }
}

// ── Block ─────────────────────────────────────────────────────────────────────
const BLOCK_PALETTE = [
  '#ef4444','#f97316','#eab308',
  '#22c55e','#06b6d4','#3b82f6',
  '#a855f7','#ec4899','#f43f5e',
];

class Block {
  constructor(x, y, colorIdx) {
    this.x = x;  this.px = x;
    this.y = y;  this.py = y;
    this.w = CFG.BLOCK_W;
    this.h = CFG.BLOCK_H;
    this.colorIdx = colorIdx;
    this.sleep    = 0;
    this.sleeping = false;
    this.pushedBy = -1;
    this.inPit    = false;   // inside the goal pit
  }
  get vx() { return this.x - this.px; }
  get vy() { return this.y - this.py; }
  L() { return this.x - this.w / 2; }
  R() { return this.x + this.w / 2; }
  T() { return this.y - this.h / 2; }
  B() { return this.y + this.h / 2; }
}

// ── Creature Node ─────────────────────────────────────────────────────────────
class CNode {
  constructor(x, y) {
    this.x = x; this.px = x;
    this.y = y; this.py = y;
    this.r = CFG.NODE_R;
    this.onGround = false;
  }
}

// ── Creature ──────────────────────────────────────────────────────────────────
const CREATURE_COLORS = [
  '#60a5fa','#f472b6','#34d399','#fb923c','#a78bfa',
  '#38bdf8','#f9a8d4','#86efac','#fcd34d','#c4b5fd',
  '#67e8f9','#fca5a5','#6ee7b7','#fdba74','#818cf8',
  '#e879f9','#22d3ee','#4ade80','#facc15','#fb7185',
];

class Creature {
  constructor(id, startX, startY, genome) {
    this.id      = id;
    this.color   = CREATURE_COLORS[id % CREATURE_COLORS.length];
    this.genome  = genome || NeuralNet.randomGenome();
    this.nn      = new NeuralNet(this.genome);
    this.fitness = 0;
    this.time    = 0;
    this.maxX    = startX;
    this.trail   = [];

    const half = (CFG.NUM_NODES - 1) * CFG.BONE_LEN / 2;
    this.nodes = Array.from({ length: CFG.NUM_NODES }, (_, i) => {
      const nx = startX - half + i * CFG.BONE_LEN;
      return new CNode(nx, startY);
    });

    this.muscles = Array.from({ length: CFG.NUM_NODES - 1 }, (_, i) => ({
      a: i, b: i + 1,
      baseLen: CFG.BONE_LEN,
      act: 0,
    }));
  }

  centerX() { return this.nodes.reduce((s, n) => s + n.x, 0) / this.nodes.length; }
  centerY() { return this.nodes.reduce((s, n) => s + n.y, 0) / this.nodes.length; }
}

// ── Physics ───────────────────────────────────────────────────────────────────

function stepPhysics(creatures, blocks, dt) {
  // Update inPit first so all downstream code uses current state
  for (const b of blocks) {
    b.inPit = b.x > CFG.GOAL_X && b.x < CFG.GOAL_X + CFG.GOAL_W;
  }
  _stepCreatures(creatures, blocks, dt);
  _stepBlocks(blocks, dt);
  _resolveBlockBlock(blocks);
  _resolvePitWalls(blocks);
  _resolveCreatureBlock(creatures, blocks);
  // Final flag refresh after all position corrections
  for (const b of blocks) {
    b.inPit = b.x > CFG.GOAL_X && b.x < CFG.GOAL_X + CFG.GOAL_W;
  }
}

// Ground Y for a given block X (main ground vs pit floor)
function groundYForBlock(bx) {
  return (bx > CFG.GOAL_X && bx < CFG.GOAL_X + CFG.GOAL_W)
    ? CFG.PIT_Y
    : CFG.GROUND_Y;
}

// Verlet integration for all creature nodes
function _stepCreatures(creatures, blocks, dt) {
  const G   = CFG.GRAVITY;
  const D   = CFG.DAMP;
  const GY  = CFG.GROUND_Y;
  const GF  = 0.60;
  const WL  = 2;
  const WR  = CFG.GOAL_X - 2;   // creatures stay left of pit

  for (const c of creatures) {
    c.time += dt;

    // ── NN inputs ────────────────────────────────────────────────────────
    const cx = c.centerX();
    const cy = c.centerY();
    let nbDX = 0, nbDY = 0;
    let bestDist = Infinity;
    for (const b of blocks) {
      if (b.inPit) continue;
      const d = Math.hypot(b.x - cx, b.y - cy);
      if (d < bestDist) {
        bestDist = d;
        nbDX = clamp((b.x - cx) / 100, -1, 1);
        nbDY = clamp((b.y - cy) / 50,  -1, 1);
      }
    }
    const avgVX = c.nodes.reduce((s, n) => s + (n.x - n.px), 0) / c.nodes.length;
    const anyGnd = c.nodes.some(n => n.onGround) ? 1 : -1;

    const inputs = [
      Math.sin(c.time * (2 * Math.PI / 1.6)),
      Math.cos(c.time * (2 * Math.PI / 1.6)),
      Math.sin(c.time * (2 * Math.PI / 0.75)),
      Math.cos(c.time * (2 * Math.PI / 0.75)),
      nbDX,
      nbDY,
      clamp(avgVX / 6, -1, 1),
      anyGnd,
    ];

    const acts = c.nn.forward(inputs);
    for (let i = 0; i < c.muscles.length; i++) c.muscles[i].act = acts[i];

    // ── Integrate nodes ───────────────────────────────────────────────────
    for (const n of c.nodes) {
      const vx = (n.x - n.px) * D;
      const vy = (n.y - n.py) * D;
      n.px = n.x; n.py = n.y;
      n.x += vx;
      n.y += vy + G * dt * dt;
      n.onGround = false;
    }

    // ── Constraints (8 iterations) ────────────────────────────────────────
    for (let iter = 0; iter < 8; iter++) {
      for (const m of c.muscles) {
        const nA = c.nodes[m.a], nB = c.nodes[m.b];
        const dx = nB.x - nA.x, dy = nB.y - nA.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const tgt  = m.baseLen + m.act * CFG.MUSCLE_AMP;
        const diff = (dist - tgt) / dist * 0.5;
        nA.x += dx * diff;  nA.y += dy * diff;
        nB.x -= dx * diff;  nB.y -= dy * diff;
      }

      for (const n of c.nodes) {
        if (n.x - n.r < WL) { n.x = WL + n.r; n.px = n.x + (n.x - n.px) * 0.4; }
        if (n.x + n.r > WR) { n.x = WR - n.r; n.px = n.x + (n.x - n.px) * 0.4; }
        if (n.y - n.r < 2)  { n.y = 2  + n.r; n.py = n.y; }

        if (n.y + n.r > GY) {
          const slip = n.x - n.px;
          n.y  = GY - n.r;
          const vy2 = n.y - n.py;
          n.py = n.y + vy2 * 0.12;
          n.x -= slip * GF;
          n.px = n.x - slip * (1 - GF);
          n.onGround = true;
        }
      }
    }

    // Track max X
    const headX = c.nodes[c.nodes.length - 1].x;
    if (headX > c.maxX) c.maxX = headX;

    // Trail
    c.trail.push({ x: cx, y: cy });
    if (c.trail.length > 30) c.trail.shift();
  }
}

// Verlet for blocks — uses dynamic ground height
function _stepBlocks(blocks, dt) {
  const G  = CFG.GRAVITY;

  for (const b of blocks) {
    if (b.sleeping) continue;

    const pvx = b.x - b.px;
    const pvy = b.y - b.py;

    b.px = b.x; b.py = b.y;
    b.x += pvx * CFG.BLOCK_X_DAMP;
    b.y += pvy + G * dt * dt;

    // Ground — uses per-block ground height
    const gY = groundYForBlock(b.x);
    if (b.B() > gY) {
      const pen = b.B() - gY;
      b.y -= pen;
      const vy2 = b.y - b.py;
      b.py = b.y + vy2 * (1 - CFG.BLOCK_BOUNCE * 2);
      const vx2 = b.x - b.px;
      b.px = b.x - vx2 * CFG.BLOCK_X_DAMP * 0.80;
    }

    // World left / right walls
    if (b.L() < 0) {
      b.x = b.w / 2;
      const vx2 = b.x - b.px;
      b.px = b.x + vx2 * CFG.BLOCK_BOUNCE;
    }
    if (b.R() > CFG.WORLD_W) {
      b.x = CFG.WORLD_W - b.w / 2;
      const vx2 = b.x - b.px;
      b.px = b.x + vx2 * CFG.BLOCK_BOUNCE;
    }

    // Sleep detection — only when near ground
    const atGround = b.B() >= gY - 0.8;
    const spd = Math.abs(b.x - b.px) + Math.abs(b.y - b.py);
    if (atGround && spd < CFG.SLEEP_V) {
      if (++b.sleep > CFG.SLEEP_WAIT) {
        b.sleeping = true;
        b.x = b.px; // snap still
      }
    } else {
      b.sleep = 0;
    }
  }
}

// Block ↔ Block AABB
function _resolveBlockBlock(blocks) {
  const n = blocks.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = blocks[i], b = blocks[j];

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const ox = (a.w + b.w) / 2 - Math.abs(dx);
      const oy = (a.h + b.h) / 2 - Math.abs(dy);

      if (ox <= 0 || oy <= 0) continue;

      const aW = !a.sleeping, bW = !b.sleeping;
      const wa = bW ? 0.5 : (aW ? 1.0 : 0);
      const wb = aW ? 0.5 : (bW ? 1.0 : 0);

      if (ox < oy) {
        // Horizontal
        const sign = dx > 0 ? 1 : -1;
        if (aW) { a.x -= sign * ox * wa; a.sleeping = false; a.sleep = 0; }
        if (bW) { b.x += sign * ox * wb; b.sleeping = false; b.sleep = 0; }

        const avx = a.x - a.px, bvx = b.x - b.px;
        const rel = (avx - bvx) * sign;
        if (rel > 0) {
          const imp = rel * 0.35;
          if (aW) a.px = a.x - (avx - sign * imp);
          if (bW) b.px = b.x - (bvx + sign * imp);
        }
      } else {
        // Vertical
        const sign = dy > 0 ? 1 : -1;
        if (aW) { a.y -= sign * oy * wa; a.sleeping = false; a.sleep = 0; }
        if (bW) { b.y += sign * oy * wb; b.sleeping = false; b.sleep = 0; }

        const avy = a.y - a.py, bvy = b.y - b.py;
        const rel = (avy - bvy) * sign;
        if (rel > 0) {
          const imp = rel * (1 + CFG.BLOCK_BOUNCE);
          if (aW) a.py = a.y - (avy - sign * imp * 0.5);
          if (bW) b.py = b.y - (bvy + sign * imp * 0.5);
        }
      }
    }
  }
}

// Pit walls: left step wall + ensure pit blocks stay inside horizontally
function _resolvePitWalls(blocks) {
  const gL  = CFG.GOAL_X;
  const gR  = CFG.GOAL_X + CFG.GOAL_W;    // = WORLD_W
  const GY  = CFG.GROUND_Y;
  const PY  = CFG.PIT_Y;

  for (const b of blocks) {
    if (!b.inPit) continue;

    // Left step wall — blocks in pit can't go back over the step edge
    if (b.L() < gL) {
      b.x = gL + b.w / 2;
      const vx2 = b.x - b.px;
      b.px = b.x + vx2 * CFG.BLOCK_BOUNCE;
      b.sleeping = false; b.sleep = 0;
    }

    // Right wall (= world right wall, already handled in _stepBlocks)
    // Nothing extra needed.

    // Pit floor extra collision (in case block.x changed above)
    if (b.B() > PY) {
      b.y = PY - b.h / 2;
      const vy2 = b.y - b.py;
      b.py = b.y + vy2 * (1 - CFG.BLOCK_BOUNCE * 2);
    }
  }
}

// Creature nodes ↔ Blocks (circle vs AABB)
function _resolveCreatureBlock(creatures, blocks) {
  const pr = CFG.PUSH_RATIO;

  for (const c of creatures) {
    for (const b of blocks) {
      if (b.inPit) continue;  // don't interact with blocks in pit
      for (const n of c.nodes) {
        const cpx = clamp(n.x, b.L(), b.R());
        const cpy = clamp(n.y, b.T(), b.B());
        const dx  = n.x - cpx, dy = n.y - cpy;
        const d2  = dx * dx + dy * dy;
        if (d2 >= n.r * n.r || d2 < 1e-8) continue;

        const dist = Math.sqrt(d2);
        const nx2 = dx / dist, ny2 = dy / dist;
        const pen  = n.r - dist;

        n.x += nx2 * pen * (1 - pr);
        n.y += ny2 * pen * (1 - pr);
        b.x -= nx2 * pen * pr;
        b.y -= ny2 * pen * pr;

        const nVx = n.x - n.px, nVy = n.y - n.py;
        const bVx = b.x - b.px, bVy = b.y - b.py;
        const relV = (nVx - bVx) * nx2 + (nVy - bVy) * ny2;
        if (relV < 0) {
          const imp = -relV * 0.5;
          n.px = n.x - (nVx + nx2 * imp);
          n.py = n.y - (nVy + ny2 * imp);
          b.px = b.x - (bVx - nx2 * imp);
          b.py = b.y - (bVy - ny2 * imp);
        }

        b.sleeping = false; b.sleep = 0;
        b.pushedBy = c.id;
      }
    }
  }
}

// ── Fitness ───────────────────────────────────────────────────────────────────
function calcFitness(creatures, blocks) {
  for (const c of creatures) {
    const moveFit = Math.max(0, c.maxX - 60) * 0.35;

    let blockFit = 0;
    for (const b of blocks) {
      if (b.pushedBy === c.id && b.inPit) {
        blockFit += 120;
        // stacking height bonus: higher up in pit = more score
        const heightInPit = CFG.PIT_Y - b.y;
        blockFit += Math.max(0, heightInPit) * 5;
      }
    }

    c.fitness = moveFit + blockFit;
  }
}

// ── Score (shared tower display) ──────────────────────────────────────────────
function calcScore(blocks) {
  let count = 0;
  let topY  = CFG.PIT_Y;
  for (const b of blocks) {
    if (b.inPit) {
      count++;
      if (b.T() < topY) topY = b.T();
    }
  }
  if (count === 0) return 0;
  // Score = tower height in world units (from pit floor to topmost block top)
  const towerH = Math.max(0, CFG.PIT_Y - topY);
  return Math.floor(towerH * 0.8) + count * 5;
}

// ── Block factory ─────────────────────────────────────────────────────────────
function makeBlocks() {
  const GY = CFG.GROUND_Y;
  const BH = CFG.BLOCK_H;
  const BW = CFG.BLOCK_W;

  // Pyramid stack on the left
  const layout = [
    { x: 28,              y: GY - BH / 2 },
    { x: 28 + BW + 2,     y: GY - BH / 2 },
    { x: 28 + (BW+2)*2,   y: GY - BH / 2 },
    { x: 28 + BW/2 + 1,   y: GY - BH*1.5 - 2 },
    { x: 28 + BW*1.5 + 3, y: GY - BH*1.5 - 2 },
    { x: 28 + BW + 2,     y: GY - BH*2.5 - 4 },
    { x: 50,              y: GY - BH/2 - 36 },
    { x: 20,              y: GY - BH/2 - 24 },
    { x: 38,              y: GY - BH/2 - 52 },
  ];

  return Array.from({ length: CFG.NUM_BLOCKS }, (_, i) => {
    const pos = layout[i] || { x: rng(15, 65), y: GY - BH/2 - rng(0, 40) };
    return new Block(pos.x, pos.y, i % BLOCK_PALETTE.length);
  });
}

// ── Renderer ──────────────────────────────────────────────────────────────────
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.zoom   = 1;
    this.offX   = 0;   // horizontal centering offset
    this.offY   = 0;   // vertical centering offset
    this.fitToWindow();
    window.addEventListener('resize', () => this.fitToWindow());
  }

  fitToWindow() {
    const w = window.innerWidth;
    const h = window.innerHeight - 82;
    this.canvas.width  = Math.max(w, 200);
    this.canvas.height = Math.max(h, 150);
    const z = Math.min(this.canvas.width / CFG.WORLD_W,
                       this.canvas.height / CFG.WORLD_H);
    this.zoom = z;
    this.offX = (this.canvas.width  - CFG.WORLD_W * z) / 2;
    this.offY = (this.canvas.height - CFG.WORLD_H * z) / 2;
  }

  wx(x) { return this.offX + x * this.zoom; }
  wy(y) { return this.offY + y * this.zoom; }
  ws(s) { return s * this.zoom; }

  draw(creatures, blocks) {
    const { ctx, canvas } = this;
    const cw = canvas.width, ch = canvas.height;

    // Background
    ctx.fillStyle = '#070b18';
    ctx.fillRect(0, 0, cw, ch);

    this._drawGrid();
    this._drawPitGlow();
    this._drawGround();
    this._drawPitShaft();

    for (const c of creatures) this._drawTrail(c);
    for (const b of blocks) this._drawBlock(b);
    for (const c of creatures) this._drawCreature(c);

    this._drawPitLabel();
  }

  _drawGrid() {
    const { ctx } = this;
    const step = 20;
    ctx.fillStyle = 'rgba(25,50,90,0.35)';
    for (let gx = 0; gx <= CFG.WORLD_W; gx += step) {
      for (let gy = 0; gy <= CFG.WORLD_H; gy += step) {
        ctx.fillRect(this.wx(gx) - 1, this.wy(gy) - 1, 2, 2);
      }
    }
  }

  _drawPitGlow() {
    const { ctx } = this;
    const px = this.wx(CFG.GOAL_X);
    const pw = this.ws(CFG.GOAL_W);
    const ph = this.wy(CFG.PIT_Y) - this.wy(0);

    const grad = ctx.createLinearGradient(px, 0, px + pw, 0);
    grad.addColorStop(0,   'rgba(34,197,94,0.05)');
    grad.addColorStop(0.5, 'rgba(34,197,94,0.12)');
    grad.addColorStop(1,   'rgba(34,197,94,0.05)');
    ctx.fillStyle = grad;
    ctx.fillRect(px, this.wy(0), pw, ph);
  }

  _drawGround() {
    const { ctx, canvas } = this;
    const gy  = this.wy(CFG.GROUND_Y);
    const pit = this.wx(CFG.GOAL_X);
    const pw  = this.ws(CFG.GOAL_W);
    const pf  = this.wy(CFG.PIT_Y);
    const cw  = canvas.width;
    const ch  = canvas.height;

    // Main ground fill (left of pit)
    const gGrad = ctx.createLinearGradient(0, gy, 0, ch);
    gGrad.addColorStop(0,    '#1e3a5f');
    gGrad.addColorStop(0.08, '#0d1f3c');
    gGrad.addColorStop(1,    '#070b18');
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, gy, pit, ch - gy);

    // Ground line
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = 6;
    ctx.shadowColor = '#3b82f6';
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(pit, gy);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Pit walls fill
    const pitGrad = ctx.createLinearGradient(0, pf, 0, ch);
    pitGrad.addColorStop(0,   '#0d2010');
    pitGrad.addColorStop(1,   '#070b18');
    ctx.fillStyle = pitGrad;
    // Left pit wall fill
    ctx.fillRect(0, gy, pit - this.ws(2), ch - gy);   // under left ground (repeat fill for safety)
    // Pit interior sides
    ctx.fillRect(pit, gy, pw, ch - gy);

    // Pit floor line
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = 5;
    ctx.shadowColor = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(pit, pf);
    ctx.lineTo(pit + pw, pf);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _drawPitShaft() {
    const { ctx } = this;
    const px = this.wx(CFG.GOAL_X);
    const py = this.wy(0);
    const pg = this.wy(CFG.GROUND_Y);
    const pf = this.wy(CFG.PIT_Y);
    const pw = this.ws(CFG.GOAL_W);

    // Left shaft wall (step edge)
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth   = 2;
    ctx.shadowBlur  = 10;
    ctx.shadowColor = '#22c55e';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, pf);  // full height left wall
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Horizontal step (top of pit entrance)
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, pg);
    ctx.lineTo(px + pw * 0.5, pg);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawPitLabel() {
    const { ctx } = this;
    const px = this.wx(CFG.GOAL_X);
    const pw = this.ws(CFG.GOAL_W);
    const py = this.wy(5);

    ctx.save();
    ctx.font        = `bold ${this.ws(5)}px sans-serif`;
    ctx.fillStyle   = 'rgba(34,197,94,0.55)';
    ctx.textAlign   = 'center';
    ctx.shadowBlur  = 8;
    ctx.shadowColor = '#22c55e';
    ctx.fillText('GOAL', px + pw / 2, py + this.ws(5));
    ctx.restore();
  }

  _drawTrail(c) {
    const { ctx } = this;
    const t = c.trail;
    if (t.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(this.wx(t[0].x), this.wy(t[0].y));
    for (let i = 1; i < t.length; i++) ctx.lineTo(this.wx(t[i].x), this.wy(t[i].y));
    ctx.strokeStyle = c.color + '28';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }

  _drawBlock(b) {
    const { ctx } = this;
    const bx = this.wx(b.x), by = this.wy(b.y);
    const bw = this.ws(b.w), bh = this.ws(b.h);
    const r  = Math.min(3, this.ws(1.8));
    const col = BLOCK_PALETTE[b.colorIdx];

    ctx.save();
    if (b.inPit) {
      ctx.shadowBlur  = 16;
      ctx.shadowColor = col;
    }

    // Body gradient
    ctx.beginPath();
    this._rRect(bx - bw/2, by - bh/2, bw, bh, r);
    const gr = ctx.createLinearGradient(bx - bw/2, by - bh/2, bx + bw/2, by + bh/2);
    gr.addColorStop(0, col + 'ee');
    gr.addColorStop(1, col + '88');
    ctx.fillStyle = gr;
    ctx.fill();

    // Border
    ctx.strokeStyle = col;
    ctx.lineWidth   = 1.2;
    ctx.stroke();

    // Top shine
    ctx.beginPath();
    this._rRect(bx - bw/2 + 2, by - bh/2 + 2, bw - 4, bh * 0.38, r * 0.7);
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fill();

    ctx.restore();
  }

  _drawCreature(c) {
    const { ctx } = this;
    const col = c.color;

    // Bones
    for (const m of c.muscles) {
      const a = c.nodes[m.a], b = c.nodes[m.b];
      ctx.beginPath();
      ctx.moveTo(this.wx(a.x), this.wy(a.y));
      ctx.lineTo(this.wx(b.x), this.wy(b.y));
      ctx.strokeStyle = col + '88';
      ctx.lineWidth   = this.ws(2.8);
      ctx.lineCap     = 'round';
      ctx.stroke();
    }

    // Nodes
    for (let i = 0; i < c.nodes.length; i++) {
      const n  = c.nodes[i];
      const nx = this.wx(n.x), ny = this.wy(n.y);
      const nr = this.ws(n.r);

      ctx.save();
      ctx.shadowBlur  = i === c.nodes.length - 1 ? 14 : 8;
      ctx.shadowColor = col;

      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, 2 * Math.PI);
      const gr = ctx.createRadialGradient(nx - nr*0.3, ny - nr*0.3, nr*0.1, nx, ny, nr);
      gr.addColorStop(0, col);
      gr.addColorStop(1, col + '66');
      ctx.fillStyle = gr;
      ctx.fill();

      // Head ring
      if (i === c.nodes.length - 1) {
        ctx.beginPath();
        ctx.arc(nx, ny, nr * 1.55, 0, 2 * Math.PI);
        ctx.strokeStyle = col + '55';
        ctx.lineWidth   = 1;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  _rRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

// ── Fitness Graph ──────────────────────────────────────────────────────────────
class FitnessGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.bestH  = [];
    this.avgH   = [];
    this.scoreH = [];
  }

  push(best, avg, score) {
    this.bestH.push(best);
    this.avgH.push(avg);
    this.scoreH.push(score);
  }

  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#070b18';
    ctx.fillRect(0, 0, W, H);

    if (this.bestH.length < 2) {
      ctx.fillStyle = '#475569';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('世代データを収集中...', W / 2, H / 2);
      return;
    }

    const maxB = Math.max(...this.bestH, 1);
    const maxS = Math.max(...this.scoreH, 1);
    const len  = this.bestH.length;

    // Grid
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth   = 1;
    for (let q = 0.25; q < 1; q += 0.25) {
      ctx.beginPath();
      ctx.moveTo(0,   H - q * (H - 10) - 5);
      ctx.lineTo(W,   H - q * (H - 10) - 5);
      ctx.stroke();
    }

    const line = (data, maxVal, color) => {
      if (data.length < 2) return;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (len - 1)) * W;
        const y = H - (data[i] / maxVal) * (H - 10) - 5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.8;
      ctx.stroke();
    };

    line(this.avgH,   maxB, '#60a5fa88');
    line(this.bestH,  maxB, '#f59e0b');
    line(this.scoreH, maxS, '#22c55e');

    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    [['● 最高適応度', '#f59e0b', 0],
     ['● 平均適応度', '#60a5fa', 90],
     ['● スコア',     '#22c55e', 170]].forEach(([l, c2, ox]) => {
      ctx.fillStyle = c2;
      ctx.fillText(l, ox + 4, H - 4);
    });
  }
}

// ── Tower Visualization (live right-side minimap) ─────────────────────────────
function drawTowerOverlay(ctx, blocks, canvasW, canvasH) {
  const pitBlocks = blocks.filter(b => b.inPit);
  if (pitBlocks.length === 0) return;

  const W  = 52, H = canvasH - 100;
  const ox = canvasW - W - 8, oy = 50;

  // Background
  ctx.fillStyle = 'rgba(7,11,24,0.80)';
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.roundRect?.(ox, oy, W, H, 6);
  ctx.fill();
  ctx.stroke();

  // Title
  ctx.font      = 'bold 10px sans-serif';
  ctx.fillStyle = 'rgba(34,197,94,0.8)';
  ctx.textAlign = 'center';
  ctx.fillText('🧱 タワー', ox + W / 2, oy + 12);

  // Scale: PIT_Y = 175, world min stack top = ~20 → range 155 units
  const towerRange = CFG.PIT_Y;     // from y=0 to pit floor
  const scale = (H - 28) / towerRange;
  const bx0  = ox + 6;
  const bw2  = W - 12;

  for (const b of pitBlocks) {
    const col = BLOCK_PALETTE[b.colorIdx];
    const ty  = oy + 20 + b.T() * scale;
    const bh2 = CFG.BLOCK_H * scale;
    ctx.fillStyle   = col + 'cc';
    ctx.strokeStyle = col;
    ctx.lineWidth   = 0.5;
    ctx.fillRect(bx0, ty, bw2, bh2);
    ctx.strokeRect(bx0, ty, bw2, bh2);
  }
}

// ── Game Controller ───────────────────────────────────────────────────────────
class Game {
  constructor() {
    this.canvas    = document.getElementById('gameCanvas');
    this.renderer  = new Renderer(this.canvas);
    this.graph     = new FitnessGraph(document.getElementById('graphCanvas'));

    this.creatures = [];
    this.blocks    = [];
    this.gen       = 0;
    this.evalTimer = 0;
    this.speed     = 1;
    this.paused    = false;
    this.score     = 0;
    this.bestScore = 0;

    this._lastRAF  = 0;
    this._rafId    = null;
  }

  start() {
    this._spawnGeneration();
    this._loop(0);
  }

  _spawnGeneration(genomes) {
    this.evalTimer = 0;
    this.blocks    = makeBlocks();
    this.creatures = [];

    const startX = 85;
    const startY = CFG.GROUND_Y - CFG.NODE_R - 0.5;

    for (let i = 0; i < CFG.POP; i++) {
      const sx = startX + rng(-12, 12);
      this.creatures.push(
        new Creature(i, sx, startY, genomes ? genomes[i] : null)
      );
    }
    this.gen++;
  }

  _evolve() {
    calcFitness(this.creatures, this.blocks);
    const sorted = [...this.creatures].sort((a, b) => b.fitness - a.fitness);
    const bestFit = sorted[0].fitness;
    const avgFit  = this.creatures.reduce((s, c) => s + c.fitness, 0) / this.creatures.length;
    this.score    = calcScore(this.blocks);
    if (this.score > this.bestScore) this.bestScore = this.score;

    this.graph.push(bestFit, avgFit, this.score);
    this._flashGen(bestFit);

    const newGenomes = gaEvolve(this.creatures);
    this._spawnGeneration(newGenomes);
    this._updateHUD(bestFit, avgFit);
  }

  _loop(now) {
    this._rafId = requestAnimationFrame(t => this._loop(t));

    const rawDT = Math.min((now - this._lastRAF) / 1000, 0.05);
    this._lastRAF = now;
    if (this.paused || rawDT <= 0) return;

    const steps = Math.max(1, Math.round(this.speed));
    const dt    = rawDT / steps;

    for (let s = 0; s < steps; s++) {
      stepPhysics(this.creatures, this.blocks, dt);
      this.evalTimer += dt;
      if (this.evalTimer >= CFG.EVAL_S) {
        this._evolve();
        break;
      }
    }

    this._updateEvalBar();
    this.score = calcScore(this.blocks);
    document.getElementById('score-pill').textContent = `🧱 ${this.score}`;

    this.renderer.draw(this.creatures, this.blocks);

    // Tower overlay on main canvas
    drawTowerOverlay(
      this.renderer.ctx,
      this.blocks,
      this.canvas.width,
      this.canvas.height
    );

    if (document.getElementById('graph-panel').classList.contains('visible')) {
      this.graph.draw();
    }
  }

  addBlock() {
    if (this.blocks.length >= 20) return;
    const b = new Block(
      rng(15, 80),
      rng(20, 60),
      this.blocks.length % BLOCK_PALETTE.length
    );
    this.blocks.push(b);
  }

  setSpeed(s) { this.speed = s; }
  togglePause() { this.paused = !this.paused; }

  _flashGen(bestFit) {
    const el = document.getElementById('gen-flash');
    el.textContent = `🧬 世代 ${this.gen} 完了 — 🏆 ${bestFit.toFixed(0)}`;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  _updateHUD(bestFit, avgFit) {
    document.getElementById('gen-pill').textContent  = `🧬 世代 ${this.gen}`;
    document.getElementById('best-pill').textContent = `🏆 ${bestFit.toFixed(0)}`;
    document.getElementById('avg-pill').textContent  = `📊 ${avgFit.toFixed(0)}`;
    document.getElementById('score-pill').textContent = `🧱 ${this.score}`;
  }

  _updateEvalBar() {
    const pct = Math.min(this.evalTimer / CFG.EVAL_S, 1) * 100;
    document.getElementById('eval-fill').style.width = pct + '%';
    document.getElementById('eval-time').textContent =
      `⏱ ${this.evalTimer.toFixed(1)} / ${CFG.EVAL_S}s`;
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
let game = null;

document.addEventListener('DOMContentLoaded', () => {
  // Speed buttons
  document.querySelectorAll('.ctrl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ctrl-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      game?.setSpeed(Number(btn.dataset.speed));
    });
  });

  // Add block
  document.getElementById('btn-add-block').addEventListener('click', () => game?.addBlock());

  // Graph toggle
  const gPanel = document.getElementById('graph-panel');
  document.getElementById('btn-toggle-graph').addEventListener('click', () => {
    gPanel.classList.toggle('visible');
    if (gPanel.classList.contains('visible')) game?.graph.draw();
  });
  document.getElementById('close-graph').addEventListener('click', () => {
    gPanel.classList.remove('visible');
  });

  // Start
  document.getElementById('btn-start-game').addEventListener('click', () => {
    document.getElementById('start-screen').style.display = 'none';
    game = new Game();
    game.start();
  });

  // Keyboard
  window.addEventListener('keydown', e => {
    if (e.key === ' ')                  { e.preventDefault(); game?.togglePause(); }
    if (e.key === '1')                  document.querySelector('[data-speed="1"]')?.click();
    if (e.key === '2')                  document.querySelector('[data-speed="2"]')?.click();
    if (e.key === '4')                  document.querySelector('[data-speed="4"]')?.click();
    if (e.key === 'b' || e.key === 'B') game?.addBlock();
    if (e.key === 'g' || e.key === 'G') document.getElementById('btn-toggle-graph')?.click();
  });
});

})();
