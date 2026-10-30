// 試練（ステージ）の環境。make(seed) が1回分の環境（餌場の位置などは種で変わる）を返す。
import { RNG } from './rng.js';
import { buildEnv } from './sdf.js';

export function baseCfg() {
  return {
    env: null,
    spawn: [0.5, 0.75, 0.3, 0],
    energy0: 0.5,
    phys: [0.004, 0.25, 0.08, 0.00006],   // 最高速, 最大旋回, ゆらぎ, おしあい
    sensor: [0.045, 0.7, 4, 0],           // 触角の長さ, 角度, 差の倍率
    energy: [0.001, 0.0012, 0.0008, 0.2], // 基礎代謝, 泳ぐ代謝, 光る代謝, 食べた量→元気
    foodP: [0.02, 0, 0, 0],               // 1歩で食べる量
    rew: [1, 1, 0, 0],                    // 生存, 元気, 高さ, 食べた
    rew2: [0, 0, 9, 0],                   // ゴール, 道しるべ, ゴールの高さ, 光る罰
    predP: [0, 0.025, 0.25, 0.15],        // 数, 食べる半径, 食べる確率, 気配の半径
    predM: [0.0045, 0.06, 0.25, 0],       // 速さ, 小回り, 見える距離, 光をこわがる強さ
    predSpawns: [],
    light: [1, 0, 0, 0.08],               // 外の光の強さ, しきい値, 道しるべ, 道しるべの半径
    flow: [0, 0, 0, 0],
    glowP: [0.9, 0.5, 1, 0],              // 減衰, 拡散, 発光の倍率
    foodR: [0.012, 0, 0, 0],              // 餌の再生
    foodFill: 1,
    patches: [],
    heat: [0, 0, 1, 0],
    moon: null,
    steps: 600,
  };
}

const envCache = new Map();
export function envFor(key, shapes, lightOpts) {
  if (!envCache.has(key)) envCache.set(key, buildEnv(shapes, lightOpts));
  return envCache.get(key);
}

export function randomPatches(rng, n, rMin, rMax, { avoid = [], yMin = 0, yMax = 1.5, xMin = 0, xMax = 1, cap = 1, env = null } = {}) {
  const out = [];
  for (let t = 0; t < 400 && out.length < n; t++) {
    const r = rng.range(rMin, rMax);
    const x = rng.range(Math.max(xMin, r * 0.7), Math.min(xMax, 1 - r * 0.7));
    const y = rng.range(Math.max(yMin, r * 0.7), Math.min(yMax, 1.5 - r * 0.7));
    if (out.some((q) => Math.hypot(q[0] - x, q[1] - y) < (q[2] + r) * 0.9)) continue;
    if (avoid.some((a) => Math.hypot(a[0] - x, a[1] - y) < a[2] + r)) continue;
    if (env && sdfAt(env, x, y) < r * 0.5) continue;
    out.push([x, y, r, cap]);
  }
  return out;
}

function sdfAt(env, x, y) {
  const i = Math.max(0, Math.min(127, Math.floor(x * 128)));
  const j = Math.max(0, Math.min(191, Math.floor(y / 1.5 * 192)));
  return env.sdf[j * 128 + i];
}

// --- 岩の形
const box = (x, y, hw, hh, a = 0, rr = 0.012) => ({ t: 'b', x, y, hw, hh, a, rr });
const circ = (x, y, r) => ({ t: 'c', x, y, r });

const MAZE = [
  box(0.31, 0.45, 0.31, 0.022), box(0.89, 0.45, 0.11, 0.022),
  box(0.09, 0.90, 0.09, 0.022), box(0.67, 0.90, 0.33, 0.022),
  circ(0.2, 0.68, 0.04), circ(0.82, 0.7, 0.05), circ(0.55, 1.28, 0.04), circ(0.12, 0.2, 0.035), circ(0.9, 0.18, 0.03),
];

const CAVE = [
  // 天井（まんなかに穴）
  box(0.17, 1.39, 0.19, 0.11, 0.0, 0.03),
  box(0.83, 1.39, 0.19, 0.11, 0.0, 0.03),
  // 洞窟の岩
  circ(0.15, 0.55, 0.07), circ(0.85, 0.75, 0.08), circ(0.5, 0.32, 0.05), circ(0.28, 1.0, 0.05), circ(0.74, 1.06, 0.045),
];

const REEF = [circ(0.25, 0.95, 0.05), circ(0.78, 0.42, 0.06), circ(0.6, 1.2, 0.035)];

// 試練の定義（物語の情報は story.js）
export const STAGE_DEFS = {
  // 1. 熱水の揺りかご: 餌をさがして生きのびる
  cradle: {
    senses: ['food'],
    hidden: 8,
    passMetric: 'alive',
    make(seed) {
      const rng = new RNG(seed);
      const c = baseCfg();
      c.env = envFor('open', [], { mode: 'open', exp: 1 });
      c.spawn = [0.5, 0.75, 0, 1];
      c.energy0 = 0.42;
      c.patches = randomPatches(rng, 5, 0.09, 0.13);
      return c;
    },
  },

  // 2. 岩の迷路: 上から差す光をめざす
  maze: {
    senses: ['food', 'touch', 'light'],
    hidden: 8,
    passMetric: 'goal',
    make(seed) {
      const rng = new RNG(seed);
      const c = baseCfg();
      c.env = envFor('maze3', MAZE, { mode: 'path', exp: 1, att: 2.0 });
      c.spawn = [0.5, 0.1, 0.1, 2];
      c.energy0 = 0.85;
      c.energy = [0.0005, 0.0006, 0.0008, 0.2];
      c.patches = [
        [rng.range(0.25, 0.75), 0.15, 0.1, 1],
        [rng.range(0.35, 0.6), 0.66, 0.07, 0.6],
        [rng.range(0.3, 0.7), 1.32, 0.11, 1],
      ];
      c.rew = [0.3, 0.2, 1.5, 0];
      c.rew2 = [1.5, 0, 1.15, 0];
      c.steps = 900;
      return c;
    },
  },

  // 3. クラゲの影: 捕食者から逃げる
  jelly: {
    senses: ['food', 'touch', 'light', 'vibe', 'crowd'],
    hidden: 12,
    passMetric: 'alive',
    make(seed) {
      const rng = new RNG(seed);
      const c = baseCfg();
      c.env = envFor('reef', REEF, { mode: 'open', exp: 1 });
      c.spawn = [0.5, 0.75, 0, 1];
      c.energy0 = 0.6;
      c.energy = [0.0007, 0.0008, 0.0003, 0.2];
      c.foodR = [0.02, 0, 0, 0];
      c.patches = randomPatches(rng, 5, 0.1, 0.13, { env: c.env });
      c.predP = [2, 0.03, 0.35, 0.16];
      c.predM = [0.0046, 0.07, 0.3, 0];
      c.predSpawns = [[rng.range(0.1, 0.9), 1.45, 0, -0.003], [rng.range(0.1, 0.9), 0.05, 0, 0.003]];
      return c;
    },
  },

  // 4. 光のことば: 闇の中で、光で知らせあう
  signal: {
    senses: ['food', 'touch', 'light', 'vibe', 'crowd', 'glow'],
    hidden: 12,
    passMetric: 'alive',
    make(seed) {
      const rng = new RNG(seed);
      const c = baseCfg();
      c.env = envFor('reef', REEF, { mode: 'open', exp: 1 });
      c.light = [0.3, 0, 0, 0.08];
      c.spawn = [0.5, 0.75, 0, 1];
      c.energy0 = 0.6;
      c.energy = [0.0007, 0.0008, 0.0003, 0.2];
      c.foodR = [0.02, 0, 0, 0];
      c.patches = randomPatches(rng, 5, 0.1, 0.13, { env: c.env });
      c.predP = [3, 0.03, 0.35, 0.06];
      c.predM = [0.0053, 0.07, 0.3, 6];
      c.predSpawns = [[0.1, 1.45, 0.002, -0.003], [0.9, 0.05, -0.002, 0.003], [rng.range(0.2, 0.8), 0.75, 0.003, 0]];
      c.defense = [0.8, 8, 0.95, 0];
      c.energy = [0.0007, 0.0008, 0.0025, 0.2];   // 光るのは高くつく（ずっと光っていると飢える）
      return c;
    },
  },

  // 5. 月のリズム: 洞窟の穴から差す月の光の明滅に、群れ全体で光をそろえる
  moon: {
    senses: ['food', 'touch', 'light', 'vibe', 'crowd', 'glow'],
    hidden: 16,
    passMetric: 'sync',
    inheritOld: 0.25,   // 新しい感覚がないので、受けついだ重みも大きめにゆらす
    make(seed) {
      const rng = new RNG(seed);
      const c = baseCfg();
      c.env = envFor('cave3', CAVE, { mode: 'cast', exp: 0.7, att: 0.997, spread: 10, holes: [[0.36, 0.64]] });
      c.light = [1, 0, 0, 0.08];
      c.spawn = [0.5, 0.65, 0.5, 2];
      // 餌場は、月の光が差すところに2つ、届かないところに4つ
      c.patches = [
        ...randomPatches(rng, 2, 0.08, 0.1, { env: c.env, xMin: 0.36, xMax: 0.64, yMin: 0.3, yMax: 1.15 }),
        ...randomPatches(rng, 4, 0.08, 0.11, { env: c.env, yMax: 1.2, avoid: [[0.5, 0.75, 0.22]] }),
      ];
      c.moon = { period: rng.range(110, 170), phase: rng.next(), sharp: 2, floor: 0.08, weight: 6.0, mean: 0.375 };
      c.energy0 = 0.8;
      c.energy = [0.0004, 0.0005, 0.0002, 0.2];
      c.foodR = [0.02, 0, 0, 0];
      c.rew = [0.2, 0.1, 0, 0];   // 生きのびるのはやさしく、成績はほぼリズムで決まる
      return c;
    },
  },
};

export const STAGE_ORDER = ['cradle', 'maze', 'jelly', 'signal', 'moon'];
