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
export const RING_R = 190;             // 土俵の半径
const RING_DROP = 160;
export const TUG_WIN = 50;             // 綱の中心をこれだけ引き込めば勝ち
const HIT_R = NODE_R + 5;              // 生物どうしの当たり判定 (節点 vs 辺カプセル)

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

/** 対戦種目。senses は脳に追加される「対戦感覚」入力 (自分の前方 = +) */
export const BATTLES = {
  sumo: {
    name: 'すもう', icon: '🤼', terrain: 'ring',
    desc: '土俵の外へ相手を押し出すか落とせば勝ち。押す力・低い重心・踏ん張りが試される',
    senses: ['相手 前後', '相手 上下', '相手の勢い', '相手に接触', '土俵の位置'],
  },
  tug: {
    name: 'つなひき', icon: '🪢', terrain: 'flat',
    desc: `綱の中心を自分の側へ ${TUG_WIN}cm 引き込めば勝ち。前に歩くだけでは勝てない。後ずさりと足の踏ん張りが試される`,
    senses: ['綱の張り', '綱の位置', '相手の勢い'],
  },
};
export const ARENA_MODES = {
  race: { name: 'かけっこ', icon: '🏃', desc: '同じ条件で横一列に並んで走る。体の設計と脳の完成度がそのまま出る。最大6体' },
  sumo: BATTLES.sumo,
  tug: BATTLES.tug,
};
export const isBattle = obj => !!BATTLES[obj];
export const objectiveInfo = obj => OBJECTIVES[obj] || BATTLES[obj] || OBJECTIVES.distance;

const SUMO_RANKS = ['序ノ口', '序二段', '三段目', '幕下', '十両', '前頭', '小結', '関脇', '大関', '横綱'];
/** 昇段戦の段階 → 番付 */
export function rankName(mode, stage) {
  if (mode === 'sumo') return stage < SUMO_RANKS.length ? SUMO_RANKS[stage] : `横綱 (${stage - SUMO_RANKS.length + 2}代目)`;
  return stage === 0 ? '見習い' : stage <= 10 ? `${'初二三四五六七八九十'[stage - 1]}段` : `名人 (${stage - 10}代目)`;
}

/**
 * 立ち合いのバリエーション (開始時の間合い)。特訓も闘技場の三番勝負も同じ3つ
 * → 特訓で勝てるようになった相手には、闘技場でも必ず同じように勝てる (決定論)
 */
export const OPENINGS = [{ gap: 10 }, { gap: 26 }, { gap: 42 }];

export function formatFitness(v, objective) {
  if (isBattle(objective)) return `${Math.round(v)}点`;
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
  if (terrain === 'ring') {
    const d = Math.abs(x) - RING_R;
    return d <= 0 ? 0 : -RING_DROP * smooth(d / 10);
  }
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
  if (BATTLES[settings.objective]) BATTLES[settings.objective].senses.forEach((label, i) => inputs.push({ group: 'foe', label, kind: 'foe', idx: i }));
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
/**
 * 別の脳の構造へゲノムを移植する (入力は名前で対応づけ、新しい感覚は配線ゼロから)。
 * 隠れ層・出力の大きさが違う場合は移植できない (null)。
 */
export function adaptGenome(g, from, to) {
  const a = from.sizes, b = to.sizes;
  if (a.length !== b.length || g.length !== genomeLength(a)) return null;
  for (let l = 1; l < a.length; l++) if (a[l] !== b[l]) return null;
  if (a[0] === b[0] && from.inputs.every((p, i) => p.label === to.inputs[i].label)) return g;
  const map = to.inputs.map(p => from.inputs.findIndex(q => q.label === p.label));
  const out = new Float32Array(genomeLength(b));
  const H = b[1], n0 = a[0], n1 = b[0];
  for (let j = 0; j < H; j++) for (let i = 0; i < n1; i++) out[j * n1 + i] = map[i] >= 0 ? g[j * n0 + map[i]] : 0;
  for (let j = 0; j < H; j++) out[n1 * H + j] = g[n0 * H + j];
  out.set(g.subarray(n0 * H + H), n1 * H + H);
  return out;
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
  /**
   * opts.dir   : 1 = 右向き (既定), -1 = 左右反転して左向き。脳には「自分の前方 = +」で世界が見える
   * opts.front : 最も前にある節点をこの x に置く (対戦の立ち位置)
   */
  constructor(bp, layout, genome, env, opts = null) {
    this.env = env;
    const n = bp.nodes.length;
    this.n = n;
    let cx = 0, minY = Infinity;
    for (const p of bp.nodes) { cx += p.x; minY = Math.min(minY, p.y); }
    cx /= n;
    const lift = -minY + NODE_R + 2;
    const dir = opts && opts.dir === -1 ? -1 : 1;
    this.dir = dir;
    this.x = new Float64Array(n); this.y = new Float64Array(n);
    this.px = new Float64Array(n); this.py = new Float64Array(n);
    this.contact = new Uint8Array(n);
    this.rx = new Float64Array(n); this.ry = new Float64Array(n); // 重心からの静止オフセット
    for (let i = 0; i < n; i++) {
      this.x[i] = this.px[i] = dir === 1 ? bp.nodes[i].x - cx : cx - bp.nodes[i].x;
      this.y[i] = this.py[i] = bp.nodes[i].y + lift;
    }
    // 先端の節点 (対戦で綱を結ぶ場所)
    let f = 0;
    for (let i = 1; i < n; i++) if (this.x[i] * dir > this.x[f] * dir + 0.5 || (Math.abs(this.x[i] - this.x[f]) <= 0.5 && this.y[i] > this.y[f])) f = i;
    this.front = f;
    if (opts && opts.front != null) {
      const sh = opts.front - this.x[f];
      for (let i = 0; i < n; i++) { this.x[i] += sh; this.px[i] = this.x[i]; }
    }
    const c0 = this.centroid();
    for (let i = 0; i < n; i++) { this.rx[i] = this.x[i] - c0[0]; this.ry[i] = this.y[i] - c0[1]; }
    this.startX = c0[0]; this.startY = c0[1];
    this.cx = c0[0]; this.cy = c0[1];

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
    this.senses = new Float64Array(layout.inputs.filter(p => p.group === 'foe').length);
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
    this.think();
    this.integrate();
    for (let it = 0; it < ITER; it++) this.relax();
    this.post();
  }

  /** 感じて、考えて、筋肉の目標長を決める */
  think() {
    const { n, x, y } = this;
    const [cx, cy] = this.centroid();
    this._cx = cx; this._cy = cy;

    // 最小二乗の回転角 = 体の傾き
    let sc = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - cx, dy = y[i] - cy;
      sc += this.rx[i] * dx + this.ry[i] * dy;
      ss += this.rx[i] * dy - this.ry[i] * dx;
    }
    this.tilt = Math.atan2(ss, sc);

    // ── 感覚入力 ──
    const inp = this.input, d = this.dir; let k = 0;
    for (const e of this.muscleEdge) {
      const v = (this.len[e] / this.rest[e] - 1) * 3;
      inp[k++] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
    for (let i = 0; i < n; i++) inp[k++] = this.contact[i];
    inp[k++] = Math.sin(this.tilt) * d;
    inp[k++] = Math.cos(this.tilt);
    inp[k++] = Math.max(-1, Math.min(1, this.vx * d * 0.3));
    inp[k++] = Math.max(-1, Math.min(1, this.vy * 0.3));
    const ph = 2 * Math.PI * this.hz * this.t / FPS;
    inp[k++] = Math.sin(ph);
    inp[k++] = Math.cos(ph);
    for (let s = 0; s < this.senses.length; s++) inp[k++] = this.senses[s];

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
  }

  /** 力: 筋肉はバネ (中心力なので運動量・角運動量を保存する) → Verlet 積分 */
  integrate() {
    const { n, x, y, px, py, env } = this;
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
    const g = G_EARTH * env.gravity;
    for (let i = 0; i < n; i++) {
      px[i] = x[i]; py[i] = y[i];
      x[i] += vx[i]; y[i] += vy[i] - g;
    }
  }

  /** 拘束の1反復: 骨 (剛体) + 地面 */
  relax() {
    const { n, x, y, env } = this;
    const bones = this.boneEdges, nb = bones.length;
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

  /** 接地と摩擦、状態の更新 */
  post() {
    const { n, x, y, px, py, env } = this;
    const fr = env.friction, m = this.ea.length;
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
    this.vx = nx2 - this._cx; this.vy = ny2 - this._cy;
    this.cx = nx2; this.cy = ny2;
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

// ─── 対戦 ───────────────────────────────────────────────────────
const clamp1 = v => v > 1 ? 1 : v < -1 ? -1 : v;

/** 2体の生物が同じ世界にいる 1 番の取組。A (西, 右向き) と B (東, 左向き) */
export class Match {
  /** a, b: { bp, layout, genome } (layout は対戦種目の脳構造) */
  constructor(mode, a, b, env, opening = OPENINGS[0]) {
    this.mode = mode; this.env = env;
    const half = mode === 'tug' ? opening.gap / 2 + 40 : opening.gap / 2;
    this.A = new Creature(a.bp, a.layout, a.genome, env, { dir: 1, front: -half });
    this.B = new Creature(b.bp, b.layout, b.genome, env, { dir: -1, front: half });
    this.C = [this.A, this.B];
    this.T = Math.round(env.evalSeconds * FPS);
    this.t = 0; this.done = false; this.ko = false;
    this.winner = -1; this.kimarite = ''; this.endT = 0;
    this.touching = false; this.lastTouch = -999;
    this.tension = 0;
    if (mode === 'tug') {
      const A = this.A, B = this.B, fa = A.front, fb = B.front;
      this.ropeL = Math.hypot(B.x[fb] - A.x[fa], B.y[fb] - A.y[fa]);
    }
  }

  /** 綱の中心を自分の側へ引き込んだ量 (cm) */
  pull(s) {
    const A = this.A, B = this.B;
    const mid = (A.x[A.front] + B.x[B.front]) / 2;
    return s === 0 ? -mid : mid;
  }

  sense() {
    for (let s = 0; s < 2; s++) {
      const me = this.C[s], op = this.C[1 - s], v = me.senses, d = me.dir;
      if (!v.length) continue;
      if (this.mode === 'sumo') {
        v[0] = clamp1((op.cx - me.cx) * d / 100);
        v[1] = clamp1((op.cy - me.cy) / 60);
        v[2] = clamp1((op.vx - me.vx) * d * 0.5);
        v[3] = this.touching ? 1 : 0;
        v[4] = clamp1(me.cx * d / RING_R);
      } else {
        v[0] = Math.min(1, this.tension * 0.4);
        v[1] = clamp1(this.pull(s) / TUG_WIN);
        v[2] = clamp1((op.vx - me.vx) * d * 0.5);
      }
    }
  }

  step() {
    const A = this.A, B = this.B;
    this.sense();
    A.think(); B.think();
    A.integrate(); B.integrate();
    this.touching = false; this.tension = 0;
    for (let it = 0; it < ITER; it++) {
      if ((it & 1) === 0) this.collide();
      if (this.mode === 'tug') this.rope();
      A.relax(); B.relax();
    }
    A.post(); B.post();
    if (this.touching) this.lastTouch = this.t;
    this.t++;
    if (!this.done) this.judge();
  }

  run() { while (!this.done) this.step(); return this; }

  /** 綱: 伸びきったら引っぱる (たるむ時は力なし)。両端に等しく反対向き → 運動量を保存 */
  rope() {
    const A = this.A, B = this.B, a = A.front, b = B.front;
    const dx = B.x[b] - A.x[a], dy = B.y[b] - A.y[a];
    const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    if (d <= this.ropeL) return;
    this.tension += d - this.ropeL;
    const f = (d - this.ropeL) / d * 0.5;
    A.x[a] += dx * f; A.y[a] += dy * f;
    B.x[b] -= dx * f; B.y[b] -= dy * f;
  }

  /** 生物どうしの衝突: 節点 vs 相手の辺 (太さのあるカプセル)。押し返しは作用・反作用 */
  collide() {
    const A = this.A, B = this.B;
    let ax0 = Infinity, ax1 = -Infinity, bx0 = Infinity, bx1 = -Infinity;
    let ay0 = Infinity, ay1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (let i = 0; i < A.n; i++) { const x = A.x[i], y = A.y[i]; if (x < ax0) ax0 = x; if (x > ax1) ax1 = x; if (y < ay0) ay0 = y; if (y > ay1) ay1 = y; }
    for (let i = 0; i < B.n; i++) { const x = B.x[i], y = B.y[i]; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    if (ax1 + HIT_R < bx0 || bx1 + HIT_R < ax0 || ay1 + HIT_R < by0 || by1 + HIT_R < ay0) return;
    // 両方向の押し返しを同じ瞬間の位置から計算してから適用する (西/東で結果が変わらない = 鏡像で完全に同じ試合)
    if (!this.dN) this.dN = [0, 1].map(s => [new Float64Array(this.C[s].n), new Float64Array(this.C[s].n)]);
    if (!this.dE) this.dE = [0, 1].map(s => [new Float64Array(this.C[s].n), new Float64Array(this.C[s].n)]);
    for (const b of [...this.dN, ...this.dE]) { b[0].fill(0); b[1].fill(0); }
    const hA = this.pushNodes(A, B, this.dN[0], this.dE[1]);
    const hB = this.pushNodes(B, A, this.dN[1], this.dE[0]);
    if (!hA && !hB) return;
    this.touching = true;
    for (let s = 0; s < 2; s++) {
      const c = this.C[s], [nx, ny] = this.dN[s], [ex, ey] = this.dE[s];
      for (let i = 0; i < c.n; i++) { c.x[i] += nx[i] + ex[i]; c.y[i] += ny[i] + ey[i]; }
    }
  }

  /** P の節点が Q の辺にめり込んだ分の押し戻し量を dP (節点側) / dQ (辺側) に積む */
  pushNodes(P, Q, dP, dQ) {
    let hit = false;
    const qx = Q.x, qy = Q.y, m = Q.ea.length;
    const [px, py] = dP, [qdx, qdy] = dQ;
    for (let i = 0; i < P.n; i++) {
      const x = P.x[i], y = P.y[i];
      for (let e = 0; e < m; e++) {
        const a = Q.ea[e], b = Q.eb[e];
        const ex = qx[b] - qx[a], ey = qy[b] - qy[a];
        const L2 = ex * ex + ey * ey || 1e-9;
        let t = ((x - qx[a]) * ex + (y - qy[a]) * ey) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = qx[a] + ex * t, cy = qy[a] + ey * t;
        let dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= HIT_R * HIT_R) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) { dx = 0; dy = 1; } else { dx /= d; dy /= d; }
        const pen = (HIT_R - d) * 0.5;
        // 節点を半分、辺上の接触点を半分 (端点に重み配分) 押し戻す
        const wa = 1 - t, wb = t, k = pen / (wa * wa + wb * wb);
        px[i] += dx * pen; py[i] += dy * pen;
        qdx[a] -= dx * k * wa; qdy[a] -= dy * k * wa;
        qdx[b] -= dx * k * wb; qdy[b] -= dy * k * wb;
        hit = true;
      }
    }
    return hit;
  }

  judge() {
    const A = this.A, B = this.B;
    const finish = (winner, kimarite, ko) => { this.done = true; this.ko = ko; this.winner = winner; this.kimarite = kimarite; this.endT = this.t; };
    if (A.broken || B.broken) return finish(A.broken && B.broken ? -1 : A.broken ? 1 : 0, '反則', !(A.broken && B.broken));
    if (this.mode === 'sumo') {
      const fell = c => c.cy < -15, out = c => fell(c) || Math.abs(c.cx) > RING_R;
      const oA = out(A), oB = out(B);
      if (oA || oB) {
        if (oA && oB) return finish(-1, '同体', false);
        const L = oA ? A : B;
        let k;
        if (this.t - this.lastTouch > 45) k = '勇み足';
        else if (Math.abs(L.tilt) > 1.6) k = '投げ';
        else if (fell(L) && Math.abs(L.cx) <= RING_R) k = '突き落とし';
        else k = '押し出し';
        return finish(oA ? 1 : 0, k, true);
      }
    } else {
      const p = this.pull(0);
      if (p >= TUG_WIN) return finish(0, '引き寄せ', true);
      if (p <= -TUG_WIN) return finish(1, '引き寄せ', true);
    }
    if (this.t >= this.T) {
      const m = this.margin(0);
      finish(m > 12 ? 0 : m < -12 ? 1 : -1, Math.abs(m) > 12 ? '判定' : '引き分け', false);
    }
  }

  /** 判定の材料: + なら s 側が優勢 (cm)。すもうは「どれだけ相手側へ押し込んだか」 */
  margin(s) {
    if (this.mode === 'tug') return this.pull(s);
    const me = this.C[s], op = this.C[1 - s];
    return me.cx * me.dir - op.cx * op.dir;
  }

  /** s 側の得点。決着 > 判定の優勢 > 決着負け (長く粘るほど良い) */
  score(s) {
    const T = this.T, t = this.endT;
    if (this.ko) return this.winner === s ? 1000 + 500 * (1 - t / T) : -1000 + 500 * (t / T);
    const lim = this.mode === 'tug' ? TUG_WIN : 200;
    const m = Math.max(-lim, Math.min(lim, this.margin(s)));
    return m / lim * 400;
  }
}

/** 対戦相手の脳を、この種目の脳構造へ合わせる */
export function prepareFighter(f, mode) {
  const settings = { hidden: f.hidden, hidden2: f.hidden2 || 0 };
  const from = brainLayout(f.bp, { ...settings, objective: f.obj || 'distance' });
  const layout = brainLayout(f.bp, { ...settings, objective: mode });
  const genome = adaptGenome(f.g, from, layout) || randomGenome(layout.sizes, makeRng(1));
  return { bp: f.bp, layout, genome, name: f.name, hue: f.hue };
}

/** 複数の相手 × 立ち合いで戦わせた平均得点 */
export function evaluateBattle(me, rivals, env, openings = OPENINGS, opts = {}) {
  let sum = 0, wins = 0, losses = 0, draws = 0;
  const bouts = [];
  const foeIdx = opts.blind ? me.layout.inputs.map((p, i) => p.group === 'foe' ? i : -1).filter(i => i >= 0) : null;
  rivals.forEach((r, ri) => openings.forEach((op, oi) => {
    const m = new Match(env.objective, me, r, env, op);
    if (foeIdx) for (const i of foeIdx) m.A.brain.knock[0][i] = 1;
    m.run();
    const s = m.score(0);
    sum += s;
    if (m.winner === 0) wins++; else if (m.winner === 1) losses++; else draws++;
    if (opts.detail) bouts.push({ r: ri, o: oi, winner: m.winner, kimarite: m.kimarite, t: m.endT, score: s });
  }));
  const n = rivals.length * openings.length;
  return { fitness: sum / Math.max(1, n), wins, losses, draws, n, bouts };
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
