// 決定論的な数学関数
// Math.sin / Math.exp / Math.tanh などは端末（ブラウザ）ごとに最後の1ビットが違うことがある。
// 物理と脳の計算をどの端末でも「寸分違わず」同じにするため、四則演算と sqrt（IEEE で丸めが決まっている）
// だけで作った関数を使う。共有コードで受け取った生物が、相手の端末でも同じ動きをするのはこのおかげ。

const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const LOG2E = 1.4426950408889634;
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;

// sin: [-π/2, π/2] に寄せてテイラー展開（r^15 まで、誤差 < 1e-11）
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

// 2^k（k は整数）: 2のべき乗どうしの掛け算は誤差なし
function pow2(k) {
  let r = 1, b = k < 0 ? 0.5 : 2, e = k < 0 ? -k : k;
  while (e > 0) { if (e & 1) r *= b; b *= b; e >>= 1; }
  return r;
}

// exp: e^x = 2^k · e^r（|r| ≤ ln2/2）
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
