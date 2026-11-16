// 島の地形（高度マップ）・地区・植生・歩ける範囲を決定的に生成する。
// Three.js には依存しない（Node でもそのまま検証できる）。
//
// 座標系：x = 東が＋、z = 南が＋、y = 上。島の中心が (0, 0)。
// 1マス = CELL ワールド単位、高さは 1 単位きざみの段々（ドット絵的な見た目のため）。

import { makeNoise2D, hash01 } from './rng.js';

export const N = 128; // マス数（1辺）
export const CELL = 2; // 1マスの大きさ
export const HALF = (N * CELL) / 2; // 島の座標は -HALF 〜 +HALF
export const SEA_Y = 0.45; // 海面の高さ
export const MIN_Y = -5; // 海底の下限
export const TERRAIN_SEED = 20261116;

export const BIOME = {
  SEABED: 0,
  SAND: 1,
  GRASS: 2,
  FOREST: 3,
  HIGH: 4,
  ROCK: 5,
  PLAZA: 6,
  PATH: 7,
};

// 地区。u, v は島の正規化座標（-1〜1）での中心。state.json の districts[].id と対応する。
//   safe: 公開時から島民の行動範囲に入っている安全な場所か（森・高原は自然の障壁があって範囲外）
// 島の真ん中は、拠点が決まるまではただの「平原」。拠点（広場）は最初の投票の結果として生まれる。
export const DISTRICTS = [
  { id: 'plain', name: '平原', u: 0.0, v: 0.04, safe: true },
  { id: 'cove', name: '入り江', u: -0.1, v: 0.5, safe: true },
  { id: 'beach', name: '砂浜', u: 0.56, v: 0.3, safe: true },
  { id: 'forest', name: '森', u: -0.48, v: -0.14, safe: false },
  { id: 'highland', name: '高原', u: 0.24, v: -0.44, safe: false },
];
export const DISTRICT_INDEX = Object.fromEntries(DISTRICTS.map((d, i) => [d.id, i]));
// 以前のデータとの互換：真ん中の地区は 'plaza' と書かれていても受けつける
export const DISTRICT_ALIASES = { plaza: 'plain' };
export const NO_DISTRICT = 255;
const PLAIN_RADIUS = 0.15; // 真ん中の平原地区の半径（正規化）
const PLAZA_PAVED = 0.105; // 拠点の広場（踏み固められた地面）の半径

// 島の真ん中（平らにならされた平原の中心。拠点の第一候補）
export const PLAIN_CENTER = { x: DISTRICTS[0].u * HALF, z: DISTRICTS[0].v * HALF };
// 漂流者が打ち上がる東の砂浜。拠点が決まるまでは、ここが島民の仮の集まり場。
export const LANDING = { x: 75, z: 43, name: '漂着した砂浜' };

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (du, dv, s) => Math.exp(-(du * du + dv * dv) / (s * s));

function rawHeight(u, v, nz) {
  const r = Math.hypot(u, v);
  const a = Math.atan2(v, u);
  const wBeach = gauss(u - 0.56, v - 0.3, 0.26);

  // 海岸線：角度とノイズでいびつな形にする。砂浜側は少し張り出す。
  const coast =
    0.74 +
    0.06 * Math.sin(a * 3 + 1.3) +
    0.04 * Math.sin(a * 5 + 0.4) +
    0.07 * nz.fbm(u * 2.2 + 10, v * 2.2 + 10, 3) +
    0.05 * wBeach;
  const e = 1 - r / coast; // >0 が陸

  let h;
  if (e <= 0) {
    h = e * 26;
  } else {
    const inland = smoothstep(0.04, 0.3, e);
    h = 0.6 + 5.2 * smoothstep(0, 0.4, e) + 1.6 * e + 1.5 * nz.fbm(u * 4, v * 4, 4) * inland;
    // 高原（北東）と岩の峰
    h += 9 * gauss(u - 0.24, v + 0.42, 0.27) * inland;
    h += 5 * gauss(u - 0.33, v + 0.5, 0.09) * inland;
    // 森（西）はゆるい起伏
    h += 2.2 * nz.fbm(u * 6 + 3, v * 6 + 3, 3) * gauss(u + 0.46, v + 0.12, 0.32) * inland;
    // 砂浜（東）は低く平らに
    h = lerp(h, Math.min(h, 0.9 + e * 5), Math.min(1, wBeach * 1.2));
  }

  // 入り江（南）：海が島の内側へ食い込む
  const cu = (u + 0.1) / 0.1;
  const cv = (v - 0.66) / 0.24;
  h -= 13 * Math.exp(-(cu * cu + cv * cv));

  // 中央の広場は平らにならす
  const wPlaza = smoothstep(0.22, 0.1, Math.hypot(u, v - 0.04));
  h = lerp(h, 4, wPlaza);
  return h;
}

// base: 拠点（{ x, z }）。拠点が決まっていれば、そのまわりを踏み固められた広場の地面にする。
// 地形（高さ）は拠点があってもなくても変わらない。
export function generateTerrain(seed = TERRAIN_SEED, { base = null } = {}) {
  const nz = makeNoise2D(seed);
  const h = new Int8Array(N * N);
  const biome = new Uint8Array(N * N);
  const district = new Uint8Array(N * N).fill(NO_DISTRICT);

  const idx = (i, j) => j * N + i;
  const inGrid = (i, j) => i >= 0 && j >= 0 && i < N && j < N;
  const cellCenter = (i, j) => ({ x: (i - N / 2 + 0.5) * CELL, z: (j - N / 2 + 0.5) * CELL });
  const cellOf = (x, z) => ({
    i: clamp(Math.floor(x / CELL + N / 2), 0, N - 1),
    j: clamp(Math.floor(z / CELL + N / 2), 0, N - 1),
  });

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = cellCenter(i, j);
      const y = Math.round(rawHeight(c.x / HALF, c.z / HALF, nz));
      h[idx(i, j)] = clamp(y, MIN_Y, 40);
    }
  }

  const heightAtCell = (i, j) => (inGrid(i, j) ? h[idx(i, j)] : MIN_Y);

  // 地区とバイオーム
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = idx(i, j);
      const y = h[k];
      if (y < 1) {
        biome[k] = BIOME.SEABED;
        continue;
      }
      const c = cellCenter(i, j);
      const u = c.x / HALF;
      const v = c.z / HALF;

      // 地区：真ん中の平原は半径で、ほかは最寄りの中心で分ける
      let d = 0;
      const dPlain = Math.hypot(u - DISTRICTS[0].u, v - DISTRICTS[0].v);
      const dBase = base ? Math.hypot(u - base.x / HALF, v - base.z / HALF) : Infinity;
      if (dPlain > PLAIN_RADIUS) {
        let best = Infinity;
        for (let n = 1; n < DISTRICTS.length; n++) {
          const dd = Math.hypot(u - DISTRICTS[n].u, v - DISTRICTS[n].v);
          if (dd < best) {
            best = dd;
            d = n;
          }
        }
      }
      district[k] = d;

      let steep = 0;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ny = heightAtCell(i + di, j + dj);
        if (ny >= 1) steep = Math.max(steep, Math.abs(ny - y));
      }

      const id = DISTRICTS[d].id;
      const speck = hash01(i, j, seed + 5);
      let b = BIOME.GRASS;
      if (y === 1) b = BIOME.SAND;
      else if (id === 'beach' && y <= 2) b = BIOME.SAND;
      else if (dBase < PLAZA_PAVED + (speck - 0.5) * 0.02) b = BIOME.PLAZA;
      else if (steep >= 3) b = BIOME.ROCK;
      else if (id === 'highland') b = y >= 13 || (y >= 11 && speck < 0.5) ? BIOME.ROCK : y >= 6 ? BIOME.HIGH : BIOME.GRASS;
      else if (id === 'forest' && y >= 3) b = BIOME.FOREST;
      biome[k] = b;
    }
  }

  // 連続した高さ（クリック位置の補助などに使う）
  const heightAt = (x, z) => {
    const c = cellOf(x, z);
    return h[idx(c.i, c.j)];
  };

  return { N, CELL, HALF, seed, h, biome, district, idx, inGrid, cellCenter, cellOf, heightAt, heightAtCell };
}

// 木・岩・草花を決定的に配置する。reserved(i, j) が true のマスには置かない。
export function generateDeco(terrain, reserved = () => false) {
  const { h, biome, district, idx, cellCenter, seed } = terrain;
  const items = [];
  for (let j = 1; j < N - 1; j++) {
    for (let i = 1; i < N - 1; i++) {
      const k = idx(i, j);
      const y = h[k];
      const roll = hash01(i, j, seed + 11);
      const r2 = hash01(i, j, seed + 12);
      const r3 = hash01(i, j, seed + 13);
      const c = cellCenter(i, j);
      const base = {
        i,
        j,
        x: c.x + (r2 - 0.5) * 0.8,
        z: c.z + (r3 - 0.5) * 0.8,
        y,
        scale: 0.8 + r2 * 0.5,
        variant: Math.floor(r3 * 4),
        district: district[k],
      };

      if (y < 1) {
        // 浅瀬の岩
        if (y >= -2 && roll < 0.006 && !reserved(i, j)) items.push({ ...base, kind: 'searock', blocks: true });
        continue;
      }
      if (reserved(i, j)) continue;

      const b = biome[k];
      const dId = DISTRICTS[district[k]].id;
      let kind = null;
      let blocks = true;
      if (b === BIOME.FOREST) {
        if (roll < 0.2) kind = 'tree';
        else if (roll < 0.24) (kind = 'flower'), (blocks = false);
      } else if (b === BIOME.GRASS) {
        if (roll < 0.016) kind = 'tree';
        else if (roll < 0.07) (kind = 'flower'), (blocks = false);
        else if (roll < 0.075) kind = 'rock';
      } else if (b === BIOME.HIGH) {
        if (roll < 0.04) kind = 'pine';
        else if (roll < 0.06) kind = 'rock';
        else if (roll < 0.1) (kind = 'flower'), (blocks = false);
      } else if (b === BIOME.ROCK) {
        if (roll < 0.08) kind = 'rock';
      } else if (b === BIOME.SAND) {
        if ((dId === 'beach' || dId === 'cove') && roll < 0.024) kind = 'palm';
        else if (roll < 0.032) kind = 'rock';
        else if (roll < 0.05) (kind = 'shell'), (blocks = false);
      }
      if (kind) items.push({ ...base, kind, blocks });
    }
  }
  return items;
}

// 歩ける範囲を作る。
//  blocked: Set<cellIndex>（建物の敷地など）
//  decks: Map<cellIndex, y>（桟橋など、水上でも歩ける床）
//  outOfRange: Set<districtIndex>（島民の行動範囲の外。森・高原などの自然の障壁の向こう側は、日常の移動に使わない）
//  origin: 到達可能性の起点（島民の集まり場）
export function buildNav(terrain, { blocked = new Set(), decks = new Map(), outOfRange = new Set(), deco = [], origin = { x: 0, z: 0 } } = {}) {
  const { h, district, idx, cellOf, cellCenter, inGrid } = terrain;
  const open = new Uint8Array(N * N);
  const walkY = new Float32Array(N * N);
  const treeCells = new Set();
  for (const d of deco) if (d.blocks) treeCells.add(idx(d.i, d.j));

  for (let k = 0; k < N * N; k++) {
    walkY[k] = h[k];
    if (decks.has(k)) {
      open[k] = 1;
      walkY[k] = decks.get(k);
      continue;
    }
    if (h[k] < 1) continue;
    if (blocked.has(k) || treeCells.has(k)) continue;
    if (outOfRange.has(district[k])) continue;
    open[k] = 1;
  }

  const canStep = (a, b) => open[a] && open[b] && Math.abs(walkY[a] - walkY[b]) <= MAX_STEP;

  // 8方向の隣接（角抜けは禁止）
  function neighbors(i, j, out) {
    out.length = 0;
    const k = idx(i, j);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (!inGrid(ni, nj)) continue;
        const nk = idx(ni, nj);
        if (!canStep(k, nk)) continue;
        if (di && dj) {
          const k1 = idx(i + di, j);
          const k2 = idx(i, j + dj);
          if (!canStep(k, k1) || !canStep(k, k2) || !canStep(k1, nk) || !canStep(k2, nk)) continue;
        }
        out.push(ni, nj, di && dj ? Math.SQRT2 : 1);
      }
    }
    return out;
  }

  // 起点から歩いて行けるマスだけを残す
  const start = nearestOpen(origin.x, origin.z, open);
  const walk = new Uint8Array(N * N);
  if (start >= 0) {
    const queue = [start];
    walk[start] = 1;
    const buf = [];
    while (queue.length) {
      const k = queue.pop();
      neighbors(k % N, Math.floor(k / N), buf);
      for (let n = 0; n < buf.length; n += 3) {
        const nk = idx(buf[n], buf[n + 1]);
        if (!walk[nk]) {
          walk[nk] = 1;
          queue.push(nk);
        }
      }
    }
  }
  // 以降は「到達可能」なマスだけを歩行可とする
  for (let k = 0; k < N * N; k++) open[k] = walk[k];

  function nearestOpen(x, z, grid = walk, maxRing = 40) {
    const c = cellOf(x, z);
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const i = c.i + di;
          const j = c.j + dj;
          if (!inGrid(i, j) || !grid[idx(i, j)]) continue;
          const cc = cellCenter(i, j);
          const d = (cc.x - x) ** 2 + (cc.z - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = idx(i, j);
          }
        }
      }
      if (best >= 0 && ring >= 1) break;
    }
    return best;
  }

  const isWalkable = (x, z) => {
    const c = cellOf(x, z);
    return walk[idx(c.i, c.j)] === 1;
  };
  const yAt = (x, z) => {
    const c = cellOf(x, z);
    return walkY[idx(c.i, c.j)];
  };
  // 歩ける位置へ寄せる（すでに歩けるならそのまま）
  const snap = (x, z) => {
    if (isWalkable(x, z)) return { x, z };
    const k = nearestOpen(x, z);
    if (k < 0) return { x, z };
    return cellCenter(k % N, Math.floor(k / N));
  };

  return { walk, walkY, neighbors, nearestOpen, isWalkable, yAt, snap, canStep };
}

export const MAX_STEP = 1; // 1歩で上り下りできる段差
