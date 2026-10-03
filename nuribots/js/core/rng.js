// 決定論的な乱数。
// 整数演算（Math.imul とビット演算）だけで作っているので、
// iPhone でも PC でも、同じ seed なら必ず同じ並びになる（オンライン対戦の同期に必要）。

export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 0x9e3779b9; }

  // 0 〜 2^32-1 の整数
  u32() {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  // [0, 1) の小数（2^32 で割るだけなので端末差なし）
  next() { return this.u32() / 4294967296; }

  // 0 〜 n-1 の整数
  int(n) { return n <= 1 ? 0 : Math.floor(this.next() * n); }

  pick(arr) { return arr[this.int(arr.length)]; }

  // 学習（重みの初期化など）専用。端末差が出てもかまわない所だけで使う
  normal() {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
}

// 文字列などから seed を作る（FNV-1a）
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function randomSeed() {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] >>> 0 || 1;
  } catch (e) {
    return (Math.floor(Math.random() * 4294967295) >>> 0) || 1;
  }
}
