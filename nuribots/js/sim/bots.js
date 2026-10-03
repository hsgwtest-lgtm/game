// CPUロボ（ルールで動く相手）。学習の「スパーリング相手」や CPU リーグの対戦相手になる。
// 乱数は渡された Rng だけを使うので、同じ seed なら同じ動きになる（決定論）。

import { GW, GH, GN } from './arenas.js';
import { WALL, DX, DY, RULE } from './env.js';

const Q = new Int16Array(GN);
const FIRST = new Int8Array(GN);
const SEEN = new Int32Array(GN);
let stamp = 1;

// 幅優先探索: goal(c) を満たす一番近いマスへ向かう最初の一歩の向き（なければ -1）
function bfs(env, i, goal, rng, maxDepth = 64) {
  const me = env.bots[i], en = env.bots[1 - i];
  const g = env.grid;
  const start = me.y * GW + me.x;
  const block = en.y * GW + en.x;
  stamp++;
  if (stamp > 2000000000) { SEEN.fill(0); stamp = 1; }
  SEEN[start] = stamp;
  FIRST[start] = -1;
  let qh = 0, qt = 0;
  Q[qt++] = start;
  const rot = rng.int(4);
  let depthEnd = qt, depth = 0;
  while (qh < qt) {
    if (qh === depthEnd) { depth++; depthEnd = qt; if (depth > maxDepth) break; }
    const c = Q[qh++];
    if (c !== start && goal(c)) return FIRST[c];
    const x = c % GW, y = (c / GW) | 0;
    for (let k = 0; k < 4; k++) {
      const d = (k + rot) & 3;
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx;
      if (SEEN[n] === stamp || g[n] === WALL || n === block) continue;
      SEEN[n] = stamp;
      FIRST[n] = c === start ? d : FIRST[c];
      Q[qt++] = n;
    }
  }
  return -1;
}

function canMove(env, i, d) {
  const b = env.bots[i], o = env.bots[1 - i];
  const nx = b.x + DX[d], ny = b.y + DY[d];
  if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) return false;
  if (env.grid[ny * GW + nx] === WALL) return false;
  if (nx === o.x && ny === o.y) return false;
  return true;
}

function randomMove(env, i, rng) {
  const opts = [];
  for (let d = 0; d < 4; d++) if (canMove(env, i, d)) opts.push(d);
  if (!opts.length) return 0;
  return rng.pick(opts) + 1;
}

// 向いている方向の射線に相手がいるか
function enemyInSight(env, i) {
  const b = env.bots[i], o = env.bots[1 - i];
  if (o.stun > 0 || o.inv > 0) return false;
  return env._inLine(b.x, b.y, b.dir, o.x, o.y);
}

// 向いている方向に、まだ自分の色でないマスがいくつあるか（弾でぬる価値）
function aheadValue(env, i) {
  const b = env.bots[i], g = env.grid;
  let x = b.x, y = b.y, n = 0;
  for (let s = 1; s <= RULE.RANGE; s++) {
    x += DX[b.dir]; y += DY[b.dir];
    if (x < 0 || y < 0 || x >= GW || y >= GH) break;
    const v = g[y * GW + x];
    if (v === WALL) break;
    if (v !== i + 1) n++;
  }
  return n;
}

// 相手が自分を狙っている（射線にいて、相手の弾が撃てる）
function inDanger(env, i) {
  const b = env.bots[i], o = env.bots[1 - i];
  if (o.cd > 1 || o.stun > 0 || b.inv > 0) return false;
  return env._inLine(o.x, o.y, o.dir, b.x, b.y);
}

// ── 種類ごとの考え方 ──
const KINDS = {
  // コロコロ: 気まぐれに転がる
  wander(env, i, rng, p) {
    const b = env.bots[i];
    if (b.cd === 0 && rng.next() < p.shoot) return 5;
    if (rng.next() < 0.65 && canMove(env, i, b.dir)) return b.dir + 1;
    return randomMove(env, i, rng);
  },

  // ヌリオ: 一番近い「自分の色でないマス」へまっしぐら
  painter(env, i, rng, p) {
    const b = env.bots[i];
    if (rng.next() < p.eps) return randomMove(env, i, rng);
    if (b.cd === 0) {
      if (p.aim && enemyInSight(env, i)) return 5;
      if (p.burst && aheadValue(env, i) >= 3 && rng.next() < p.burst) return 5;
    }
    if (p.dodge && inDanger(env, i) && rng.next() < p.dodge) {
      // 射線から横へよける
      const side = [(b.dir + 1) & 3, (b.dir + 3) & 3];
      const o = env.bots[1 - i];
      const dirs = (o.x === b.x) ? [1, 3] : [0, 2];
      for (const d of rng.next() < 0.5 ? dirs : dirs.slice().reverse()) if (canMove(env, i, d)) return d + 1;
      for (const d of side) if (canMove(env, i, d)) return d + 1;
    }
    const col = i + 1, g = env.grid;
    if (p.items && env.items.length) {
      const d = bfs(env, i, c => env.item[c] === 1, rng, p.items);
      if (d >= 0) return d + 1;
    }
    const pref = p.steal ? (c => g[c] === 3 - col) : null;
    if (pref) {
      const d = bfs(env, i, pref, rng, p.steal);
      if (d >= 0) return d + 1;
    }
    const d = bfs(env, i, c => g[c] !== col, rng);
    if (d >= 0) return d + 1;
    return randomMove(env, i, rng);
  },

  // オイカケ: 相手を追いかけてペンキ弾を当てにくる
  chaser(env, i, rng, p) {
    const b = env.bots[i], o = env.bots[1 - i];
    if (rng.next() < p.eps) return randomMove(env, i, rng);
    if (b.cd === 0 && enemyInSight(env, i)) return 5;
    const col = i + 1, g = env.grid;
    // 相手がピヨっている・無敵の間は、近くの相手の色をぬりかえる
    if (o.stun > 0 || o.inv > 0 || b.cd > 4) {
      const d = bfs(env, i, c => g[c] === 3 - col, rng, 6);
      if (d >= 0) return d + 1;
      const d2 = bfs(env, i, c => g[c] !== col, rng, 8);
      if (d2 >= 0) return d2 + 1;
    }
    // 相手と同じ列か行に並べるマスを目指す
    const tx = o.x, ty = o.y;
    const d = bfs(env, i, c => {
      const x = c % GW, y = (c / GW) | 0;
      if (x !== tx && y !== ty) return false;
      const dist = Math.abs(x - tx) + Math.abs(y - ty);
      return dist >= 1 && dist <= RULE.RANGE;
    }, rng);
    if (d >= 0) return d + 1;
    // 並んでいるなら相手の方を向く
    if (b.x === tx || b.y === ty) {
      let want = -1;
      if (b.x === tx) want = ty < b.y ? 0 : 2;
      else want = tx > b.x ? 1 : 3;
      if (want !== b.dir) return want + 1;
      if (b.cd === 0) return 5;
    }
    const d3 = bfs(env, i, c => g[c] !== col, rng);
    return d3 >= 0 ? d3 + 1 : randomMove(env, i, rng);
  },

  // ガード: 自分の陣地に入ってきた相手の色をすぐぬりかえし、近づいたら撃つ
  guard(env, i, rng, p) {
    const b = env.bots[i];
    if (rng.next() < p.eps) return randomMove(env, i, rng);
    if (b.cd === 0 && enemyInSight(env, i)) return 5;
    if (p.dodge && inDanger(env, i) && rng.next() < p.dodge) {
      const o = env.bots[1 - i];
      const dirs = (o.x === b.x) ? [1, 3] : [0, 2];
      for (const d of dirs) if (canMove(env, i, d)) return d + 1;
    }
    const col = i + 1, g = env.grid;
    if (env.items.length) {
      const d = bfs(env, i, c => env.item[c] === 1, rng, 5);
      if (d >= 0) return d + 1;
    }
    const d = bfs(env, i, c => g[c] === 3 - col, rng, 5);
    if (d >= 0) return d + 1;
    if (b.cd === 0 && aheadValue(env, i) >= 3 && rng.next() < 0.5) return 5;
    const d2 = bfs(env, i, c => g[c] !== col, rng);
    return d2 >= 0 ? d2 + 1 : randomMove(env, i, rng);
  },
};

// CPUの一覧。lv が大きいほど強い
export const CPU_DEFS = {
  koro:   { kind: 'wander',  name: 'コロコロ', p: { shoot: 0.06 } },
  nurio:  { kind: 'painter', name: 'ヌリオ',   p: { eps: 0.35, aim: false, burst: 0, dodge: 0 } },
  oikake: { kind: 'chaser',  name: 'オイカケ', p: { eps: 0.15 } },
  nurio2: { kind: 'painter', name: 'ヌリオMk2', p: { eps: 0.06, aim: true, burst: 0.6, dodge: 0.5, items: 8 } },
  guard:  { kind: 'guard',   name: 'ガード',   p: { eps: 0.04, dodge: 0.7 } },
  ace:    { kind: 'painter', name: 'エース',   p: { eps: 0.02, aim: true, burst: 0.8, dodge: 0.9, items: 10, steal: 3 } },
};

export class CpuController {
  constructor(key, rng) {
    const def = CPU_DEFS[key];
    if (!def) throw new Error('unknown cpu ' + key);
    this.key = key;
    this.def = def;
    this.fn = KINDS[def.kind];
    this.rng = rng;
    this.isNet = false;
  }
  act(env, i) { return this.fn(env, i, this.rng, this.def.p); }
}
