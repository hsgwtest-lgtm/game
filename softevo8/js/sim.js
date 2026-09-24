/* =====================================================================
   SoftEvo 8 — sim.js
   決定論的シミュレーション・コア (Worker とメインスレッドで共有)
   ---------------------------------------------------------------------
   ・同じゲノム + 同じ環境 → 必ず同じ結果。
     だから Worker で評価した個体を、画面上で「完全に再現」できる。
   ・単位: 1 = 1cm、1ステップ = 1/60 秒、y は上向き。
   ===================================================================== */

export const FPS = 60;
export const NODE_R = 6;
export const MUSCLE_RANGE = 0.32;      // 筋肉の伸縮幅 (±32%)
const G_EARTH = 980 / (FPS * FPS);     // cm / step²
const ITER = 8;
const DRAG = 0.998;
const MUSCLE_K = 0.2;       // 筋肉のバネ強さ
const MUSCLE_SPEED = 0.15;  // 筋肉の反応速度 (ローパス)
const EDGE_DAMP = 0.2;      // 内部減衰
const SPAWN_FLAT = 160;                // スタート付近は必ず平地

export const DEFAULT_SETTINGS = {
  population: 48,
  evalSeconds: 12,
  hidden: 12,
  hidden2: 0,
  mutationRate: 0.08,
  mutationSize: 0.35,
  terrain: 'flat',
  objective: 'distance',
  gravity: 1.0,
  friction: 0.85,
};

export const TERRAINS = {
  flat:   { name: '平地', icon: '▁' },
  hills:  { name: '丘陵', icon: '⛰' },
  bumps:  { name: 'でこぼこ', icon: '◠' },
  stairs: { name: '階段', icon: '⌐' },
};

export const OBJECTIVES = {
  distance:   { name: '移動距離', icon: '➡', unit: 'm' },
  efficiency: { name: '省エネ移動', icon: '🍃', unit: 'pt' },
  jump:       { name: '跳躍の高さ', icon: '⤒', unit: 'cm' },
};

export function formatFitness(v, objective) {
  if (objective === 'jump') return `${v.toFixed(1)} cm`;
  if (objective === 'efficiency') return `${(v / 100).toFixed(2)} pt`;
  return `${(v / 100).toFixed(2)} m`;
}

// ─── 地形 (高さ関数) ───────────────────────────────────────────
function hash01(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

export function groundY(terrain, x) {
  if (terrain === 'flat') return 0;
  const ramp = smooth((Math.abs(x) - SPAWN_FLAT) / 200);
  if (ramp <= 0) return 0;
  switch (terrain) {
    case 'hills':
      return ramp * (26 * Math.sin(x * 0.0042) + 12 * Math.sin(x * 0.011 + 1.3) + 5 * Math.sin(x * 0.027 + 0.7) - 5 * Math.sin(0.7));
    case 'bumps': {
      const P = 110, k = Math.floor(x / P), c = k * P + P / 2, d = Math.abs(x - c);
      const h = 5 + 11 * hash01(k);
      return d < 16 ? ramp * h * (0.5 + 0.5 * Math.cos(Math.PI * d / 16)) : 0;
    }
    case 'stairs': {
      if (x < SPAWN_FLAT) return 0;
      const P = 75, H = 11, u = x - SPAWN_FLAT, k = Math.floor(u / P), f = u - k * P;
      return k * H + H * smooth((f - (P - 10)) / 10);
    }
  }
  return 0;
}

// ─── ブループリント ─────────────────────────────────────────────
//  { nodes: [{x,y}], edges: [{a,b,type:'bone'|'muscle'}] }
export function blueprintStats(bp) {
  const muscles = bp.edges.filter(e => e.type === 'muscle').length;
  return { nodes: bp.nodes.length, bones: bp.edges.length - muscles, muscles };
}

export function validateBlueprint(bp) {
  const s = blueprintStats(bp);
  if (s.nodes < 2) return 'ノードを2つ以上置いてください';
  if (s.muscles < 1) return '筋肉が1本以上必要です（動力源）';
  // 連結チェック
  const adj = bp.nodes.map(() => []);
  for (const e of bp.edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const seen = new Set([0]); const st = [0];
  while (st.length) { const v = st.pop(); for (const w of adj[v]) if (!seen.has(w)) { seen.add(w); st.push(w); } }
  if (seen.size !== bp.nodes.length) return 'バラバラの部品があります。すべてつなげてください';
  return null;
}

// ─── 脳の構造 (入力の意味づけ) ──────────────────────────────────
export function brainLayout(bp, settings) {
  const inputs = [];
  let mi = 0;
  bp.edges.forEach((e, ei) => {
    if (e.type === 'muscle') { inputs.push({ group: 'stretch', label: `筋${mi + 1} 伸び`, kind: 'muscle', idx: mi, edge: ei }); mi++; }
  });
  bp.nodes.forEach((n, i) => inputs.push({ group: 'touch', label: `点${i + 1} 接地`, kind: 'node', idx: i }));
  inputs.push({ group: 'body', label: '傾き sin', kind: 'body', idx: 0 });
  inputs.push({ group: 'body', label: '傾き cos', kind: 'body', idx: 1 });
  inputs.push({ group: 'body', label: '速度 →', kind: 'body', idx: 2 });
  inputs.push({ group: 'body', label: '速度 ↑', kind: 'body', idx: 3 });
  inputs.push({ group: 'clock', label: 'リズム sin', kind: 'clock', idx: 0 });
  inputs.push({ group: 'clock', label: 'リズム cos', kind: 'clock', idx: 1 });
  const outputs = [];
  mi = 0;
  bp.edges.forEach((e, ei) => { if (e.type === 'muscle') { outputs.push({ label: `筋${mi + 1}`, kind: 'muscle', idx: mi, edge: ei }); mi++; } });
  const sizes = [inputs.length, settings.hidden];
  if (settings.hidden2 > 0) sizes.push(settings.hidden2);
  sizes.push(outputs.length);
  return { sizes, inputs, outputs };
}

export function genomeLength(sizes) {
  let n = 0;
  for (let l = 1; l < sizes.length; l++) n += sizes[l - 1] * sizes[l] + sizes[l];
  return n + 1; // + リズム周波数遺伝子
}

// ゲノム上の位置: layer l (1..) の neuron j への入力 i の重み
export function weightIndex(sizes, l, j, i) {
  let off = 0;
  for (let k = 1; k < l; k++) off += sizes[k - 1] * sizes[k] + sizes[k];
  return off + j * sizes[l - 1] + i;
}
export function biasIndex(sizes, l, j) {
  let off = 0;
  for (let k = 1; k < l; k++) off += sizes[k - 1] * sizes[k] + sizes[k];
  return off + sizes[l - 1] * sizes[l] + j;
}
export function rhythmHz(genome) {
  const g = genome[genome.length - 1];
  return 0.5 + 2.5 / (1 + Math.exp(-g));
}

// ─── 乱数 (シード付き) ─────────────────────────────────────────
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  rnd.gauss = () => {
    let u; do { u = rnd(); } while (u < 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  return rnd;
}

export function randomGenome(sizes, rng) {
  const g = new Float32Array(genomeLength(sizes));
  let off = 0;
  for (let l = 1; l < sizes.length; l++) {
    const nIn = sizes[l - 1], nOut = sizes[l], sc = 1.4 / Math.sqrt(nIn);
    for (let k = 0; k < nIn * nOut; k++) g[off++] = rng.gauss() * sc;
    for (let k = 0; k < nOut; k++) g[off++] = rng.gauss() * 0.2;
  }
  g[off] = rng.gauss();
  return g;
}

// ─── ニューラルネット (活動の記録つき) ───────────────────────────
export class Brain {
  constructor(sizes, genome) {
    this.sizes = sizes;
    this.genome = genome;
    this.acts = sizes.map(n => new Float64Array(n));
    this.knock = sizes.map(n => new Uint8Array(n)); // ノックアウト (脳の手術)
  }
  forward(input) {
    const { sizes, genome: g, acts, knock } = this;
    const a0 = acts[0], k0 = knock[0];
    for (let i = 0; i < sizes[0]; i++) a0[i] = k0[i] ? 0 : input[i];
    let off = 0;
    for (let l = 1; l < sizes.length; l++) {
      const nIn = sizes[l - 1], nOut = sizes[l], prev = acts[l - 1], cur = acts[l], kl = knock[l];
      const bOff = off + nIn * nOut;
      for (let j = 0; j < nOut; j++) {
        let s = g[bOff + j];
        const w = off + j * nIn;
        for (let i = 0; i < nIn; i++) s += g[w + i] * prev[i];
        cur[j] = kl[j] ? 0 : Math.tanh(s);
      }
      off = bOff + nOut;
    }
    return acts[sizes.length - 1];
  }
}

// ─── 生物 ───────────────────────────────────────────────────────
export class Creature {
  constructor(bp, layout, genome, env) {
    this.env = env;
    const n = bp.nodes.length;
    this.n = n;
    let cx = 0, minY = Infinity;
    for (const p of bp.nodes) { cx += p.x; minY = Math.min(minY, p.y); }
    cx /= n;
    const lift = -minY + NODE_R + 2;
    this.x = new Float64Array(n); this.y = new Float64Array(n);
    this.px = new Float64Array(n); this.py = new Float64Array(n);
    this.contact = new Uint8Array(n);
    this.rx = new Float64Array(n); this.ry = new Float64Array(n); // 重心からの静止オフセット
    for (let i = 0; i < n; i++) {
      this.x[i] = this.px[i] = bp.nodes[i].x - cx;
      this.y[i] = this.py[i] = bp.nodes[i].y + lift;
    }
    const c0 = this.centroid();
    for (let i = 0; i < n; i++) { this.rx[i] = this.x[i] - c0[0]; this.ry[i] = this.y[i] - c0[1]; }
    this.startX = c0[0]; this.startY = c0[1];

    const m = bp.edges.length;
    this.ea = new Int32Array(m); this.eb = new Int32Array(m);
    this.rest = new Float64Array(m); this.len = new Float64Array(m);
    this.isMuscle = new Uint8Array(m);
    this.muscleEdge = [];
    bp.edges.forEach((e, k) => {
      this.ea[k] = e.a; this.eb[k] = e.b;
      const dx = this.x[e.b] - this.x[e.a], dy = this.y[e.b] - this.y[e.a];
      this.rest[k] = this.len[k] = Math.hypot(dx, dy) || 1;
      if (e.type === 'muscle') { this.isMuscle[k] = 1; this.muscleEdge.push(k); }
    });
    this.target = Float64Array.from(this.rest);
    this.boneEdges = Int32Array.from([...bp.edges.keys()].filter(k => !this.isMuscle[k]));
    this.vxs = new Float64Array(n); this.vys = new Float64Array(n);
    this.out = new Float64Array(this.muscleEdge.length);

    this.brain = new Brain(layout.sizes, genome);
    this.input = new Float64Array(layout.sizes[0]);
    this.hz = rhythmHz(genome);
    this.t = 0;
    this.tilt = 0;
    this.vx = 0; this.vy = 0;
    this.effort = 0;
    this.maxH = 0;
    this.broken = false;
  }

  centroid() {
    let sx = 0, sy = 0;
    for (let i = 0; i < this.n; i++) { sx += this.x[i]; sy += this.y[i]; }
    return [sx / this.n, sy / this.n];
  }

  step() {
    const { n, x, y, px, py, env } = this;
    const [cx, cy] = this.centroid();

    // 最小二乗の回転角 = 体の傾き
    let sc = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - cx, dy = y[i] - cy;
      sc += this.rx[i] * dx + this.ry[i] * dy;
      ss += this.rx[i] * dy - this.ry[i] * dx;
    }
    this.tilt = Math.atan2(ss, sc);

    // ── 感覚入力 ──
    const inp = this.input; let k = 0;
    for (const e of this.muscleEdge) {
      const v = (this.len[e] / this.rest[e] - 1) * 3;
      inp[k++] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    for (let i = 0; i < n; i++) inp[k++] = this.contact[i];
    inp[k++] = Math.sin(this.tilt);
    inp[k++] = Math.cos(this.tilt);
    inp[k++] = Math.max(-1, Math.min(1, this.vx * 0.3));
    inp[k++] = Math.max(-1, Math.min(1, this.vy * 0.3));
    const ph = 2 * Math.PI * this.hz * this.t / FPS;
    inp[k++] = Math.sin(ph);
    inp[k++] = Math.cos(ph);

    // ── 思考 → 筋肉 ──
    const o = this.brain.forward(inp);
    let eff = 0;
    for (let j = 0; j < this.muscleEdge.length; j++) {
      // 筋肉は瞬時には動けない (ローパス) → 有機的な動き & 振動の悪用を防ぐ
      const a = this.out[j] += (o[j] - this.out[j]) * MUSCLE_SPEED;
      this.target[this.muscleEdge[j]] = this.rest[this.muscleEdge[j]] * (1 + MUSCLE_RANGE * a);
      eff += Math.abs(a);
    }
    this.effort += eff / Math.max(1, this.muscleEdge.length);

    // ── 力: 筋肉はバネ (中心力なので運動量・角運動量を保存する) ──
    const vx = this.vxs, vy = this.vys, m = this.ea.length;
    for (let i = 0; i < n; i++) { vx[i] = (x[i] - px[i]) * DRAG; vy[i] = (y[i] - py[i]) * DRAG; }
    for (let e = 0; e < m; e++) {
      const a = this.ea[e], b = this.eb[e];
      let dx = x[b] - x[a], dy = y[b] - y[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-6; dx /= d; dy /= d;
      // 内部減衰: 辺に沿った相対速度を弱める
      let f = ((vx[b] - vx[a]) * dx + (vy[b] - vy[a]) * dy) * EDGE_DAMP * 0.5;
      if (this.isMuscle[e]) f += (d - this.target[e]) * MUSCLE_K * 0.5;
      vx[a] += dx * f; vy[a] += dy * f;
      vx[b] -= dx * f; vy[b] -= dy * f;
    }

    // ── Verlet 積分 ──
    const g = G_EARTH * env.gravity;
    for (let i = 0; i < n; i++) {
      px[i] = x[i]; py[i] = y[i];
      x[i] += vx[i]; y[i] += vy[i] - g;
    }

    // ── 骨 (剛体拘束) + 地面 ──
    const bones = this.boneEdges, nb = bones.length;
    for (let it = 0; it < ITER; it++) {
      for (let q = 0; q < nb; q++) {
        const e = bones[q], a = this.ea[e], b = this.eb[e];
        const dx = x[b] - x[a], dy = y[b] - y[a];
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const f = (d - this.rest[e]) / d * 0.5;
        x[a] += dx * f; y[a] += dy * f;
        x[b] -= dx * f; y[b] -= dy * f;
      }
      for (let i = 0; i < n; i++) {
        const gy = groundY(env.terrain, x[i]);
        if (y[i] < gy + NODE_R) y[i] = gy + NODE_R;
      }
    }

    // ── 接地と摩擦 ──
    const fr = env.friction;
    for (let i = 0; i < n; i++) {
      const gy = groundY(env.terrain, x[i]);
      if (y[i] <= gy + NODE_R + 0.05) {
        this.contact[i] = 1;
        let nx = -(groundY(env.terrain, x[i] + 0.5) - groundY(env.terrain, x[i] - 0.5));
        let ny = 1; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
        const vx = x[i] - px[i], vy = y[i] - py[i];
        let vn = vx * nx + vy * ny;
        let vt = vx * ny - vy * nx;
        if (vn < 0) vn = 0;
        vt *= (1 - fr);
        px[i] = x[i] - (vt * ny + vn * nx);
        py[i] = y[i] - (-vt * nx + vn * ny);
      } else this.contact[i] = 0;
    }

    for (let e = 0; e < m; e++) {
      const dx = x[this.eb[e]] - x[this.ea[e]], dy = y[this.eb[e]] - y[this.ea[e]];
      this.len[e] = Math.sqrt(dx * dx + dy * dy);
    }
    const [nx2, ny2] = this.centroid();
    this.vx = nx2 - cx; this.vy = ny2 - cy;
    if (this.t > FPS) this.maxH = Math.max(this.maxH, ny2 - this.startY);
    if (!(nx2 === nx2)) this.broken = true;
    this.t++;
  }

  distance() { return this.centroid()[0] - this.startX; }

  fitness(objective) {
    if (this.broken) return -1000;
    if (objective === 'jump') return this.maxH;
    const d = this.distance();
    if (objective === 'efficiency') {
      const E = this.effort / Math.max(1, this.t);
      return d > 0 ? d * (1 - 0.75 * E) : d;
    }
    return d;
  }
}

// ─── 評価 (Worker 用) ──────────────────────────────────────────
export function evaluate(bp, layout, genome, env, opts = {}) {
  const c = new Creature(bp, layout, genome, env);
  const steps = Math.round(env.evalSeconds * FPS);
  const rec = opts.gait;
  const M = c.muscleEdge.length;
  let sum, sq, cs, cc, touch;
  if (rec) { sum = new Float64Array(M); sq = new Float64Array(M); cs = new Float64Array(M); cc = new Float64Array(M); touch = new Float64Array(c.n); }
  for (let s = 0; s < steps; s++) {
    c.step();
    if (c.broken) break;
    if (rec && s > FPS) {
      const ph = 2 * Math.PI * c.hz * s / FPS, sn = Math.sin(ph), cn = Math.cos(ph);
      for (let j = 0; j < M; j++) { const v = c.out[j]; sum[j] += v; sq[j] += v * v; cs[j] += v * sn; cc[j] += v * cn; }
      for (let i = 0; i < c.n; i++) touch[i] += c.contact[i];
    }
  }
  const res = { fitness: c.fitness(env.objective), distance: c.distance(), height: c.maxH };
  if (rec) {
    const T = Math.max(1, steps - FPS - 1), sig = [];
    for (let j = 0; j < M; j++) {
      const mu = sum[j] / T;
      sig.push(mu, Math.sqrt(Math.max(0, sq[j] / T - mu * mu)), 2 * cs[j] / T, 2 * cc[j] / T);
    }
    for (let i = 0; i < c.n; i++) sig.push(touch[i] / T);
    res.gait = sig;
  }
  return res;
}

export function gaitDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

// ─── プリセット生物 ─────────────────────────────────────────────
function mk(nodes, bones, muscles) {
  return {
    nodes: nodes.map(([x, y]) => ({ x, y })),
    edges: [...bones.map(([a, b]) => ({ a, b, type: 'bone' })), ...muscles.map(([a, b]) => ({ a, b, type: 'muscle' }))],
  };
}

export const PRESETS = {
  inchworm: { name: 'シャクトリ', icon: '🐛', bp: mk(
    [[-60, 0], [-30, 22], [0, 30], [30, 22], [60, 0], [-30, 0], [30, 0]],
    [[0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [3, 6], [0, 5], [4, 6]],
    [[5, 6], [0, 2], [2, 4], [5, 2], [6, 2]]) },
  quad: { name: 'よつあし', icon: '🐕', bp: mk(
    [[-45, 45], [0, 50], [45, 45], [-55, 0], [-25, 0], [25, 0], [55, 0]],
    [[0, 1], [1, 2], [0, 3], [0, 4], [2, 5], [2, 6]],
    [[3, 4], [5, 6], [1, 4], [1, 5], [1, 3], [1, 6], [0, 2]]) },
  biped: { name: 'にそく', icon: '🚶', bp: mk(
    [[0, 90], [0, 62], [-14, 32], [14, 32], [-20, 0], [20, 0]],
    [[0, 1], [1, 2], [1, 3], [2, 4], [3, 5]],
    [[0, 2], [0, 3], [2, 3], [4, 5], [1, 4], [1, 5]]) },
  snake: { name: 'ヘビ', icon: '🐍', bp: (() => {
    const nodes = [], bones = [], muscles = [], K = 6;
    for (let i = 0; i < K; i++) { nodes.push([i * 24 - 60, 0]); nodes.push([i * 24 - 48, 18]); }
    for (let i = 0; i < K; i++) {
      const b = i * 2, t = i * 2 + 1;
      bones.push([b, t]);
      if (i < K - 1) { bones.push([t, b + 2]); muscles.push([b, b + 2]); muscles.push([t, t + 2]); }
    }
    return mk(nodes, bones, muscles);
  })() },
  wheel: { name: 'ころころ', icon: '⚙', bp: (() => {
    const nodes = [[0, 32]], bones = [], muscles = [], K = 7;
    for (let i = 0; i < K; i++) { const a = i / K * Math.PI * 2; nodes.push([Math.round(Math.sin(a) * 30), Math.round(32 + Math.cos(a) * 30)]); }
    for (let i = 0; i < K; i++) { bones.push([1 + i, 1 + (i + 1) % K]); muscles.push([0, 1 + i]); }
    return mk(nodes, bones, muscles);
  })() },
};

export function cloneBlueprint(bp) { return JSON.parse(JSON.stringify(bp)); }
