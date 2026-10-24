// 決定論的な数学関数
// Math.sin / Math.exp / Math.atan2 などは端末（ブラウザ）ごとに最後の1ビットが違うことがある。
// 物理と神経の計算を、どの端末でも「寸分違わず」同じにするため、
// 四則演算と sqrt（IEEE 754 で丸めが決まっている）だけで作った関数を使う。
// → 公開された生き物は、だれの端末で再生してもまったく同じ動きになる（オンライン対戦の土台）。

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const LOG2E = 1.4426950408889634;
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;

// sin: [-π/2, π/2] に寄せてテイラー展開（誤差 < 1e-11）
export function dsin(x) {
  const k = Math.floor(x / TWO_PI + 0.5);
  let r = x - k * TWO_PI;
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 +
    r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000))))))));
}
export function dcos(x) { return dsin(x + HALF_PI); }

function pow2(k) {
  let r = 1, b = k < 0 ? 0.5 : 2, e = k < 0 ? -k : k;
  while (e > 0) { if (e & 1) r *= b; b *= b; e >>= 1; }
  return r;
}

export function dexp(x) {
  if (x > 700) x = 700;
  if (x < -700) return 0;
  const k = Math.floor(x * LOG2E + 0.5);
  const r = (x - k * LN2_HI) - k * LN2_LO;
  const p = 1 + r * (1 + r * (1 / 2 + r * (1 / 6 + r * (1 / 24 + r * (1 / 120 + r * (1 / 720 +
    r * (1 / 5040 + r * (1 / 40320 + r * (1 / 362880 + r * (1 / 3628800 + r * (1 / 39916800 +
    r / 479001600)))))))))));
  return p * pow2(k);
}

export function dtanh(x) {
  if (x > 9) return 1;
  if (x < -9) return -1;
  const e = dexp(2 * x);
  return (e - 1) / (e + 1);
}
export function dsigmoid(x) { return 1 / (1 + dexp(-x)); }

// atan: 2回の半角公式で |y| ≤ tan(π/16) にしてから級数（誤差 < 1e-15）
const A3 = -1 / 3, A5 = 1 / 5, A7 = -1 / 7, A9 = 1 / 9, A11 = -1 / 11, A13 = 1 / 13, A15 = -1 / 15, A17 = 1 / 17, A19 = -1 / 19;
export function datan(x) {
  let s = 1;
  if (x < 0) { x = -x; s = -1; }
  let inv = false;
  if (x > 1) { x = 1 / x; inv = true; }
  let y = x / (1 + Math.sqrt(1 + x * x));
  y = y / (1 + Math.sqrt(1 + y * y));
  const y2 = y * y;
  const p = y * (1 + y2 * (A3 + y2 * (A5 + y2 * (A7 + y2 * (A9 + y2 * (A11 + y2 * (A13 + y2 * (A15 + y2 * (A17 + y2 * A19)))))))));
  let r = 4 * p;
  if (inv) r = HALF_PI - r;
  return s * r;
}
export function datan2(y, x) {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}
export function dasin(x) {
  if (x >= 1) return HALF_PI;
  if (x <= -1) return -HALF_PI;
  return datan2(x, Math.sqrt(1 - x * x));
}
export function dacos(x) {
  if (x >= 1) return 0;
  if (x <= -1) return PI;
  return datan2(Math.sqrt(1 - x * x), x);
}

export const fr = Math.fround;
export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
