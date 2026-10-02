// 乱数ユーティリティ（シード付き）
// mulberry32: 32bitの軽量PRNG。同じシードなら同じコースが生成される。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
    this._spare = null;
  }
  float() { return this.next(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor((b - a + 1) * this.next()); } // a..b を含む
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  // 正規分布（Box-Muller）
  gauss() {
    if (this._spare !== null) { const s = this._spare; this._spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * v;
    this._spare = r * Math.sin(th);
    return r * Math.cos(th);
  }
  weighted(items, key = 'w') {
    let total = 0;
    for (const it of items) total += (it[key] ?? 1);
    let r = this.next() * total;
    for (const it of items) { r -= (it[key] ?? 1); if (r <= 0) return it; }
    return items[items.length - 1];
  }
}

export function randomSeed() {
  return (Math.random() * 2 ** 32) >>> 0;
}
