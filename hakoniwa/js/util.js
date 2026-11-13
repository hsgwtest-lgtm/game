// util.js — 乱数・ノイズ・小さな道具（描画に依存しないので Node でも動く）

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;
export const r3 = (v) => Math.round(v * 1000) / 1000;

// 種（シード）つき乱数 mulberry32。状態は整数1つなので保存・復元できる
export class RNG {
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  chance(p) {
    return this.next() < p;
  }
  gauss() {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  pick(a) {
    return a[this.int(a.length)];
  }
}

// 値ノイズ（なめらかな補間つき）。地形づくりに使う
export function makeNoise2D(rng) {
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const val = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    perm[i] = i;
    val[i] = rng.next();
  }
  for (let i = N - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const h = (x, y) => val[perm[(perm[x & 255] + (y & 255)) & 511]];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi);
    const b = h(xi + 1, yi);
    const c = h(xi, yi + 1);
    const d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// バイト列 ⇔ base64（保存データを小さくするため）
export function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
export function b64ToBytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
