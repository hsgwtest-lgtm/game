// 端末差の出ない数学関数。
// Math.exp などは端末（JSエンジン）によって最後の桁がちがうことがある。
// 四則演算と Math.round だけで作った exp を使い、どの端末でも同じ「行動の確率」を出す。

const POW2 = new Float64Array(161);
{
  let v = 1;
  for (let i = 80; i <= 160; i++) { POW2[i] = v; v *= 2; }
  v = 1;
  for (let i = 80; i >= 0; i--) { POW2[i] = v; v /= 2; }
}
const LN2 = 0.6931471805599453;
const INV_LN2 = 1.4426950408889634;
const C3 = 1 / 6, C4 = 1 / 24, C5 = 1 / 120, C6 = 1 / 720, C7 = 1 / 5040, C8 = 1 / 40320, C9 = 1 / 362880;

export function expx(x) {
  if (x < -50) return 0;
  if (x > 50) x = 50;
  const n = Math.round(x * INV_LN2);
  const r = x - n * LN2;
  const p = 1 + r * (1 + r * (0.5 + r * (C3 + r * (C4 + r * (C5 + r * (C6 + r * (C7 + r * (C8 + r * C9))))))));
  return p * POW2[n + 80];
}

// logits → 確率（temp: 温度。小さいほど迷わない）
export function softmax(logits, n, out, temp = 1) {
  let mx = -Infinity;
  for (let i = 0; i < n; i++) if (logits[i] > mx) mx = logits[i];
  let s = 0;
  const it = 1 / temp;
  for (let i = 0; i < n; i++) { const e = expx((logits[i] - mx) * it); out[i] = e; s += e; }
  for (let i = 0; i < n; i++) out[i] /= s;
  return out;
}

// 確率から1つ選ぶ（u は [0,1) の乱数）
export function sampleIndex(probs, n, u) {
  let c = 0;
  for (let i = 0; i < n - 1; i++) { c += probs[i]; if (u < c) return i; }
  return n - 1;
}

export function argmax(a, n) {
  let bi = 0, bv = a[0];
  for (let i = 1; i < n; i++) if (a[i] > bv) { bv = a[i]; bi = i; }
  return bi;
}
