// 乱数（シード付き・状態を保存できる）
// mulberry32: 32bitの軽量PRNG。state を保存すれば、続きから同じ乱数列を再開できる。

export class RNG {
  constructor(seed = randomSeed()) {
    this.state = seed >>> 0;
  }
  next() {
    let a = this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float() { return this.next(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor((b - a + 1) * this.next()); }   // a..b を含む
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  // 正規分布（Box-Muller）。余りを取っておかないので、状態は state だけ（保存して再開できる）
  gauss() {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export function randomSeed() {
  return (Math.random() * 4294967296) >>> 0;
}
