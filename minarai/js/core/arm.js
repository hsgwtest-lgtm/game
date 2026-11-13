// アームの形と動き（2つの関節 + グリッパー）。机を真上から見た平面の中で動く。
//   a1: 肩の角度（+x 軸から反時計回り、ぐるりと一周できる）
//   a2: ひじの角度（上腕に対する前腕の曲がり、±A2_MAX まで）

export const L1 = 0.95;       // 上腕の長さ
export const L2 = 0.95;       // 前腕の長さ（手先 = グリッパーの中心まで）
export const A2_MAX = 2.6;    // ひじが曲がる範囲
export const STEP = 0.1;      // 1歩で動かせる関節角（ラジアン）
export const VIEW = 2.2;      // 「AIの目」に映る範囲（中心から ±VIEW）
export const R_MAX = L1 + L2;
export const R_MIN = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(A2_MAX));
export const HOME_A1 = Math.PI / 2;
export const HOME_A2 = 2.3;

export function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

// 関節角 → ひじと手先の位置。out = [ex, ey, tx, ty]
export function fk(a1, a2, out) {
  const ex = L1 * Math.cos(a1), ey = L1 * Math.sin(a1);
  out[0] = ex; out[1] = ey;
  out[2] = ex + L2 * Math.cos(a1 + a2);
  out[3] = ey + L2 * Math.sin(a1 + a2);
  return out;
}

// 手先を (x, y) へ持っていく関節角（逆運動学）。届かない点は届く範囲へ寄せる。
// 解は「ひじを左に曲げる／右に曲げる」の2つあり、いまの姿勢から早く着くほうを選ぶ。out = [a1, a2]
export function ik(x, y, a1cur, a2cur, out) {
  let r = Math.hypot(x, y);
  const lo = R_MIN + 0.01, hi = R_MAX - 0.005;
  if (r < 1e-6) { x = lo; y = 0; r = lo; }
  if (r < lo) { x *= lo / r; y *= lo / r; r = lo; }
  if (r > hi) { x *= hi / r; y *= hi / r; r = hi; }
  let c = (r * r - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  if (c > 1) c = 1; if (c < -1) c = -1;
  const q = Math.acos(c);
  const base = Math.atan2(y, x);
  let best = Infinity;
  for (let s = -1; s <= 1; s += 2) {
    const a2 = s * q;
    const a1 = base - Math.atan2(L2 * Math.sin(a2), L1 + L2 * Math.cos(a2));
    const cost = Math.max(Math.abs(wrapPi(a1 - a1cur)), Math.abs(a2 - a2cur));
    if (cost < best) { best = cost; out[0] = a1; out[1] = a2; }
  }
  return out;
}

// 目標の関節角へ向けて、各関節を「−・止・＋」のどれで動かすか（-1 / 0 / +1）
export function jointMove(cur, target, isWrap) {
  const d = isWrap ? wrapPi(target - cur) : target - cur;
  if (d > STEP / 2) return 1;
  if (d < -STEP / 2) return -1;
  return 0;
}
