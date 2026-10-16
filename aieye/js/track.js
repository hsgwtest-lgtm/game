// コース定義と、コース上の位置計算（Three.js に依存しない純粋なモジュール）
// 座標は地面の XZ 平面。1 単位 = 1 m として扱う。

// 左右どちらのカーブも出てくる、閉じたコースの制御点 (x, z)
// （一周 約410 m、いちばん急なカーブで半径 約12 m）
export const TRACK_POINTS = [
  [0, -60], [31, -60], [55, -49], [62, -26], [55, -5],
  [44, 13], [42, 31], [29, 52], [5, 60], [-16, 55],
  [-29, 42], [-47, 38], [-62, 35], [-73, 21], [-71, 0],
  [-58, -16], [-47, -27], [-42, -44], [-23, -57],
];

export const HALF_WIDTH = 3.5;   // 舗装路の半幅
export const CURB_WIDTH = 0.7;   // 縁石の幅（舗装の外側）
export const OFF_MARGIN = 0.6;   // 縁石を越えてからコースアウト判定までの余裕

// 求心的 Catmull-Rom スプライン（ループや尖りが出にくい）
function centripetal(p0, p1, p2, p3, steps, out) {
  const a = 0.5;
  const d = (p, q) => Math.pow(Math.hypot(q[0] - p[0], q[1] - p[1]), a) || 1e-4;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  for (let s = 0; s < steps; s++) {
    const t = t1 + (t2 - t1) * (s / steps);
    const lerp = (p, q, ta, tb) => {
      const u = (t - ta) / (tb - ta);
      return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
    };
    const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
    const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
    out.push(lerp(B1, B2, t1, t2));
  }
}

// コースを等間隔の点列にする。返す配列はすべて N 点ぶん（閉路）。
export function buildTrack(points = TRACK_POINTS, N = 720) {
  const n = points.length;
  const dense = [];
  for (let i = 0; i < n; i++) {
    centripetal(points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n], 60, dense);
  }
  // 弧長で等間隔に取り直す
  const m = dense.length;
  const acc = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const a = dense[i], b = dense[(i + 1) % m];
    acc[i + 1] = acc[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const length = acc[m];
  const px = new Float32Array(N), pz = new Float32Array(N);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const target = (k / N) * length;
    while (acc[j + 1] < target) j++;
    const u = (target - acc[j]) / (acc[j + 1] - acc[j] || 1);
    const a = dense[j], b = dense[(j + 1) % m];
    px[k] = a[0] + (b[0] - a[0]) * u;
    pz[k] = a[1] + (b[1] - a[1]) * u;
  }
  // 接線（進行方向）と右向き法線
  const tx = new Float32Array(N), tz = new Float32Array(N);
  const rx = new Float32Array(N), rz = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const a = (k - 1 + N) % N, b = (k + 1) % N;
    let dx = px[b] - px[a], dz = pz[b] - pz[a];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    tx[k] = dx; tz[k] = dz;
    // 進行方向 f=(sinθ, cosθ) に対して右は (-cosθ, sinθ) = (-dz, dx)
    rx[k] = -dz; rz[k] = dx;
  }
  return { N, px, pz, tx, tz, rx, rz, length, step: length / N };
}

// 進行方向 θ（ラジアン）。f = (sin θ, cos θ)
export function headingAt(track, i) {
  return Math.atan2(track.tx[i], track.tz[i]);
}

// 最寄りの中心線の点。hint があれば前後だけ探す（毎フレーム呼ぶので軽く）
export function nearest(track, x, z, hint = -1) {
  const { N, px, pz, rx, rz } = track;
  let best = -1, bestD = Infinity;
  if (hint >= 0) {
    for (let o = -40; o <= 40; o++) {
      const i = (hint + o + N) % N;
      const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  if (best < 0 || bestD > 64) {
    for (let i = 0; i < N; i++) {
      const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  const lateral = (x - px[best]) * rx[best] + (z - pz[best]) * rz[best];
  return { i: best, lateral, dist: Math.sqrt(bestD) };
}

// 進んだ距離（点の番号の差を、周回をまたいでも正しく）
export function indexDelta(track, from, to) {
  let d = to - from;
  if (d > track.N / 2) d -= track.N;
  if (d < -track.N / 2) d += track.N;
  return d;
}

// ---- 車の動き（自転車モデルの簡易版。速度は一定） ----
export const CAR = {
  wheelBase: 2.4,
  maxSteer: 0.55,   // ラジアン
  steerRate: 5.0,   // ハンドルが目標値に近づく速さ（1/秒）
};

export function stepCar(car, steerTarget, dt) {
  const ds = Math.max(-CAR.steerRate * dt, Math.min(CAR.steerRate * dt, steerTarget - car.steer));
  car.steer += ds;
  const omega = (car.speed / CAR.wheelBase) * Math.tan(car.steer * CAR.maxSteer);
  car.heading -= omega * dt; // 右に切る（steer > 0）と θ が減る
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
}

export function placeOnTrack(track, car, i) {
  car.x = track.px[i];
  car.z = track.pz[i];
  car.heading = headingAt(track, i);
  car.steer = 0;
  car.idx = i;
}

// お手本ドライバー（純追従法をボタン操作と同じ 3 段階に丸めたもの）。
// アプリの通常操作では使わない。?expert=1 のときと自動テストでだけ使う。
export function expertAction(track, car, prev = 0) {
  const look = Math.max(5, car.speed * 0.75);
  const ahead = Math.round(look / track.step);
  const i = (car.idx + ahead) % track.N;
  const dx = track.px[i] - car.x, dz = track.pz[i] - car.z;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const rx = -Math.cos(car.heading), rz = Math.sin(car.heading);
  const alpha = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
  const ld = Math.hypot(dx, dz) || 1;
  const delta = Math.atan2(2 * CAR.wheelBase * Math.sin(alpha), ld);
  const s = delta / CAR.maxSteer;
  // ヒステリシス付きで 左(-1) / 直進(0) / 右(+1) に丸める
  const on = 0.3, off = 0.12;
  if (prev === 1) return s > off ? 1 : (s < -on ? -1 : 0);
  if (prev === -1) return s < -off ? -1 : (s > on ? 1 : 0);
  return s > on ? 1 : (s < -on ? -1 : 0);
}
