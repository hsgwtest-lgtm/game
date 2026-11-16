// マス目上の経路探索（A*）と、経路のなめらか化。Three.js 非依存。

import { N, CELL, MAX_STEP } from './terrain.js';

class MinHeap {
  constructor() {
    this.keys = [];
    this.vals = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, val) {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }
  pop() {
    const { keys, vals } = this;
    const top = vals[0];
    const key = keys.pop();
    const val = vals.pop();
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

export function createPathfinder(terrain, nav) {
  const { idx, cellOf, cellCenter } = terrain;
  const g = new Float32Array(N * N);
  const came = new Int32Array(N * N);
  const stamp = new Uint32Array(N * N);
  const closed = new Uint32Array(N * N);
  let gen = 0;
  const buf = [];
  const cache = new Map();

  // マスの並びを返す（見つからなければ null）
  function findCells(from, to) {
    if (from === to) return [from];
    if (!nav.walk[from] || !nav.walk[to]) return null;
    gen++;
    const ti = to % N;
    const tj = Math.floor(to / N);
    const heur = (k) => {
      const dx = Math.abs((k % N) - ti);
      const dy = Math.abs(Math.floor(k / N) - tj);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const heap = new MinHeap();
    g[from] = 0;
    stamp[from] = gen;
    came[from] = -1;
    heap.push(heur(from), from);
    while (heap.size) {
      const k = heap.pop();
      if (closed[k] === gen) continue;
      closed[k] = gen;
      if (k === to) {
        const out = [];
        for (let c = to; c !== -1; c = came[c]) out.push(c);
        return out.reverse();
      }
      nav.neighbors(k % N, Math.floor(k / N), buf);
      for (let n = 0; n < buf.length; n += 3) {
        const nk = idx(buf[n], buf[n + 1]);
        if (closed[nk] === gen) continue;
        // 段差は少しだけ遠回りしてでも避ける
        const cost = g[k] + buf[n + 2] + Math.abs(nav.walkY[nk] - nav.walkY[k]) * 0.35;
        if (stamp[nk] !== gen || cost < g[nk]) {
          g[nk] = cost;
          stamp[nk] = gen;
          came[nk] = k;
          heap.push(cost + heur(nk), nk);
        }
      }
    }
    return null;
  }

  // 線分 a→b が通るマスをすべて順にたどり、歩けて段差も越えられるかを調べる
  function segmentOK(ax, az, bx, bz) {
    let i = Math.floor(ax / CELL + N / 2);
    let j = Math.floor(az / CELL + N / 2);
    const iEnd = Math.floor(bx / CELL + N / 2);
    const jEnd = Math.floor(bz / CELL + N / 2);
    const dx = bx - ax;
    const dz = bz - az;
    const si = dx > 0 ? 1 : -1;
    const sj = dz > 0 ? 1 : -1;
    let tx = dx !== 0 ? ((i + (si > 0 ? 1 : 0) - N / 2) * CELL - ax) / dx : Infinity;
    let tz = dz !== 0 ? ((j + (sj > 0 ? 1 : 0) - N / 2) * CELL - az) / dz : Infinity;
    const ddx = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
    const ddz = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
    let prev = -1;
    for (let guard = 0; guard < N * 4; guard++) {
      if (i < 0 || j < 0 || i >= N || j >= N) return false;
      const k = idx(i, j);
      if (!nav.walk[k]) return false;
      if (prev >= 0 && Math.abs(nav.walkY[k] - nav.walkY[prev]) > MAX_STEP) return false;
      prev = k;
      if (i === iEnd && j === jEnd) return true;
      if (tx > 1 && tz > 1) return true;
      if (tx < tz) {
        i += si;
        tx += ddx;
      } else {
        j += sj;
        tz += ddz;
      }
    }
    return false;
  }

  // a→b をまっすぐ歩けるか（少し幅を持たせて、木や建物の角をかすめないようにする）
  function lineOK(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return true;
    if (!segmentOK(a.x, a.z, b.x, b.z)) return false;
    if (len < 1.5) return true;
    const px = (-dz / len) * 0.5;
    const pz = (dx / len) * 0.5;
    const ux = (dx / len) * 0.6;
    const uz = (dz / len) * 0.6;
    return (
      segmentOK(a.x + ux + px, a.z + uz + pz, b.x - ux + px, b.z - uz + pz) &&
      segmentOK(a.x + ux - px, a.z + uz - pz, b.x - ux - px, b.z - uz - pz)
    );
  }

  function measure(pts) {
    const cum = [0];
    for (let n = 1; n < pts.length; n++) cum.push(cum[n - 1] + Math.hypot(pts[n].x - pts[n - 1].x, pts[n].z - pts[n - 1].z));
    return { pts, cum, len: cum[cum.length - 1] };
  }

  // 実座標どうしの経路（折れ線）。from / to は歩ける位置であること。
  function findPath(from, to) {
    const cf = cellOf(from.x, from.z);
    const ct = cellOf(to.x, to.z);
    const kf = idx(cf.i, cf.j);
    const kt = idx(ct.i, ct.j);
    const key = `${kf}:${kt}:${Math.round(from.x * 4)}:${Math.round(from.z * 4)}:${Math.round(to.x * 4)}:${Math.round(to.z * 4)}`;
    const hit = cache.get(key);
    if (hit) return hit;

    let result;
    const cells = findCells(kf, kt);
    if (!cells) {
      result = measure([from, to]); // 念のための保険（通常は到達可能なマスしか使わない）
      result.fallback = true;
    } else {
      const raw = cells.map((k) => cellCenter(k % N, Math.floor(k / N)));
      raw[0] = { x: from.x, z: from.z };
      if (raw.length > 1) raw[raw.length - 1] = { x: to.x, z: to.z };
      else raw.push({ x: to.x, z: to.z });
      const pts = [raw[0]];
      let a = 0;
      while (a < raw.length - 1) {
        let next = a + 1;
        const far = Math.min(raw.length - 1, a + 40);
        for (let b = far; b > a + 1; b--) {
          if (lineOK(raw[a], raw[b])) {
            next = b;
            break;
          }
        }
        pts.push(raw[next]);
        a = next;
      }
      result = measure(pts);
    }
    if (cache.size > 800) cache.clear();
    cache.set(key, result);
    return result;
  }

  // 経路上の位置（進んだ距離 s）
  function pointAt(path, s) {
    const { pts, cum, len } = path;
    if (s <= 0 || pts.length === 1) {
      const b = pts[Math.min(1, pts.length - 1)];
      return { x: pts[0].x, z: pts[0].z, dx: b.x - pts[0].x, dz: b.z - pts[0].z };
    }
    if (s >= len) {
      const a = pts[pts.length - 2] || pts[0];
      const b = pts[pts.length - 1];
      return { x: b.x, z: b.z, dx: b.x - a.x, dz: b.z - a.z };
    }
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: b.x - a.x, dz: b.z - a.z };
  }

  return { findCells, findPath, pointAt, lineOK };
}
