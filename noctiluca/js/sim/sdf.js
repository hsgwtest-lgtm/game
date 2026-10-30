// 岩（壁）の形 → 「いちばん近い壁までの距離」の表（SDF）。正 = 水の中、負 = 岩の中。
export const SDF_W = 128;
export const SDF_H = 192;

function sdCircle(px, py, s) { return Math.hypot(px - s.x, py - s.y) - s.r; }

function sdBox(px, py, s) {
  // 回転つきの箱（中心 x,y、半幅 hw、半高 hh、角度 a、角の丸み rr）
  const ca = Math.cos(-(s.a || 0)), sa = Math.sin(-(s.a || 0));
  const dx0 = px - s.x, dy0 = py - s.y;
  const lx = dx0 * ca - dy0 * sa, ly = dx0 * sa + dy0 * ca;
  const rr = s.rr || 0;
  const qx = Math.abs(lx) - (s.hw - rr), qy = Math.abs(ly) - (s.hh - rr);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - rr;
}

function sdCapsule(px, py, s) {
  const ax = s.x1, ay = s.y1, bx = s.x2, by = s.y2;
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - s.r;
}

function sdPoly(px, py, s) {
  const v = s.pts;
  let d = Infinity;
  let sign = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const [xi, yi] = v[i];
    const [xj, yj] = v[j];
    const ex = xj - xi, ey = yj - yi;
    const wx = px - xi, wy = py - yi;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const bx = wx - ex * t, by = wy - ey * t;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= yi, c2 = py < yj, c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
  }
  return sign * Math.sqrt(d);
}

export function shapeDist(px, py, s) {
  switch (s.t) {
    case 'c': return sdCircle(px, py, s);
    case 'b': return sdBox(px, py, s);
    case 'k': return sdCapsule(px, py, s);
    case 'p': return sdPoly(px, py, s);
    default: return Infinity;
  }
}

// shapes の和集合が岩。世界のふちも壁。
export function buildSDF(shapes, worldW = 1, worldH = 1.5, w = SDF_W, h = SDF_H) {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const py = (j + 0.5) / h * worldH;
    for (let i = 0; i < w; i++) {
      const px = (i + 0.5) / w * worldW;
      let d = Math.min(px, worldW - px, py, worldH - py);
      for (const s of shapes) d = Math.min(d, shapeDist(px, py, s));
      out[j * w + i] = d;
    }
  }
  return out;
}

export function sampleSDF(sdf, x, y, worldW = 1, worldH = 1.5, w = SDF_W, h = SDF_H) {
  const fx = Math.max(0, Math.min(w - 1.001, x / worldW * w - 0.5));
  const fy = Math.max(0, Math.min(h - 1.001, y / worldH * h - 0.5));
  const i = Math.floor(fx), j = Math.floor(fy);
  const tx = fx - i, ty = fy - j;
  const a = sdf[j * w + i], b = sdf[j * w + i + 1], c = sdf[(j + 1) * w + i], d = sdf[(j + 1) * w + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// 外の光の地図: 海面（上）から差しこむ光が岩でさえぎられ、すきまから横へ広がる
//   mode 'open' … 深さだけで決まる  (y/H)^exp
//   mode 'cast' … 上から下へ光を流し、岩で止め、横へにじませる
export function buildLight(sdf, { mode = 'open', exp = 2, att = 0.994, spread = 3, holes = null } = {}, w = SDF_W, h = SDF_H) {
  const L = new Float32Array(w * h);
  if (mode === 'path') {
    // 海面までの「水の中を通る道のり」が短いほど明るい（光はすきまを通ってくる）
    const INF = 1e9;
    const dist = new Float64Array(w * h).fill(INF);
    const cs = 1 / w; // 1マスの長さ（世界の幅 = 1）
    const heap = [];
    const push = (d, k) => {
      heap.push([d, k]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    for (let i = 0; i < w; i++) { const k = (h - 1) * w + i; if (sdf[k] > 0) { dist[k] = 0; push(0, k); } }
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.length) {
      const [d, k] = pop();
      if (d > dist[k]) continue;
      const i = k % w, j = (k - i) / w;
      for (const [dx, dy, c] of nb) {
        const ii = i + dx, jj = j + dy;
        if (ii < 0 || ii >= w || jj < 0 || jj >= h) continue;
        const kk = jj * w + ii;
        if (sdf[kk] <= 0) continue;
        const nd = d + c * cs;
        if (nd < dist[kk]) { dist[kk] = nd; push(nd, kk); }
      }
    }
    const dmax = att > 0.05 ? att : 2.6;
    for (let k = 0; k < w * h; k++) L[k] = dist[k] >= INF ? 0 : Math.max(0, 1 - dist[k] / dmax);
    if (exp !== 1) for (let k = 0; k < L.length; k++) L[k] = Math.pow(L[k], exp);
    return L;
  }
  if (mode === 'diffuse') {
    // 海面（上のふち）から光がしみこみ、岩に吸われる（定常の拡散を解く）
    const free = new Uint8Array(w * h);
    for (let k = 0; k < w * h; k++) free[k] = sdf[k] > 0 ? 1 : 0;
    for (let k = 0; k < w * h; k++) L[k] = free[k] ? (Math.floor(k / w) / h) : 0;
    const a = att;
    const omega = 1.9;
    for (let it = 0; it < 1200; it++) {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const k = j * w + i;
          if (!free[k]) continue;
          // 岩は光をはね返す（ふちで値をそろえる）。上のふちは海面 = 1
          const up = j === h - 1 ? 1 : (free[k + w] ? L[k + w] : L[k]);
          const dn = j === 0 ? L[k] : (free[k - w] ? L[k - w] : L[k]);
          const lf = i === 0 ? L[k] : (free[k - 1] ? L[k - 1] : L[k]);
          const rt = i === w - 1 ? L[k] : (free[k + 1] ? L[k + 1] : L[k]);
          const v = (1 - a) * 0.25 * (up + dn + lf + rt);
          L[k] += omega * (v - L[k]);
        }
      }
    }
    for (let k = 0; k < w * h; k++) L[k] = Math.max(0, Math.min(1, L[k]));
    if (exp !== 1) for (let k = 0; k < L.length; k++) L[k] = Math.pow(L[k], exp);
    return L;
  }
  if (mode === 'open') {
    for (let j = 0; j < h; j++) {
      const v = Math.pow((j + 0.5) / h, exp);
      for (let i = 0; i < w; i++) L[j * w + i] = sdf[j * w + i] > 0 ? v : 0;
    }
    return L;
  }
  const row = new Float32Array(w);
  const tmp = new Float32Array(w);
  for (let j = h - 1; j >= 0; j--) {
    for (let i = 0; i < w; i++) {
      const free = sdf[j * w + i] > 0;
      if (!free) { row[i] = 0; continue; }
      if (j === h - 1) {
        row[i] = holes ? (holes.some(([a, b]) => (i + 0.5) / w >= a && (i + 0.5) / w <= b) ? 1 : 0) : 1;
      } else {
        const up = L[(j + 1) * w + i];
        const ul = i > 0 ? L[(j + 1) * w + i - 1] : up;
        const ur = i < w - 1 ? L[(j + 1) * w + i + 1] : up;
        row[i] = att * (0.5 * up + 0.25 * (ul + ur));
      }
    }
    for (let it = 0; it < spread; it++) {
      for (let i = 0; i < w; i++) {
        if (sdf[j * w + i] <= 0) { tmp[i] = 0; continue; }
        const a = i > 0 && sdf[j * w + i - 1] > 0 ? row[i - 1] : row[i];
        const b = i < w - 1 && sdf[j * w + i + 1] > 0 ? row[i + 1] : row[i];
        tmp[i] = 0.5 * row[i] + 0.25 * (a + b);
      }
      row.set(tmp);
    }
    L.set(row, j * w);
  }
  if (exp !== 1) for (let k = 0; k < L.length; k++) L[k] = Math.pow(L[k], exp);
  return L;
}

// 環境テクスチャ (R=壁までの距離, G=外の光, B,A=予備)
export function buildEnv(shapes, lightOpts = {}) {
  const sdf = buildSDF(shapes);
  const light = buildLight(sdf, lightOpts);
  const env = new Float32Array(SDF_W * SDF_H * 4);
  for (let k = 0; k < SDF_W * SDF_H; k++) {
    env[k * 4] = sdf[k];
    env[k * 4 + 1] = light[k];
  }
  env.sdf = sdf;
  env.light = light;
  return env;
}
