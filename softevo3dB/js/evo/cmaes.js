// CMA-ES（共分散行列適応進化戦略）
// 1世代に λ 匹の「きょうだい」を、平均（親の遺伝子）のまわりに生み、
// 成績のよい半分の重みつき平均で親を更新する。うまくいった変化の「方向」と「大きさ」を覚えるので、
// 何十〜何百もの遺伝子を同時に調整しても、ふつうの遺伝的アルゴリズムよりずっと早く上達する。
// （この中の計算は端末ごとに最後の桁が違ってもよい: 結果の遺伝子は物理で決定論的に評価される）

export class RNG {
  constructor(seed = (Math.random() * 4294967296) >>> 0) { this.s = seed >>> 0; }
  next() {
    let a = this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  gauss() {
    let u = 0;
    while (u === 0) u = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
}

export class CMAES {
  // opts: { mean, sigma, lambda, seed, state }
  constructor(n, opts = {}) {
    this.n = n;
    const lam = this.lambda = opts.lambda || (4 + Math.floor(3 * Math.log(n)));
    const mu = this.mu = Math.floor(lam / 2);
    const w = [];
    for (let i = 0; i < mu; i++) w.push(Math.log(mu + 0.5) - Math.log(i + 1));
    const ws = w.reduce((a, b) => a + b, 0);
    this.w = w.map(x => x / ws);
    this.mueff = 1 / this.w.reduce((a, b) => a + b * b, 0);
    const me = this.mueff;
    this.cs = (me + 2) / (n + me + 5);
    this.ds = 1 + 2 * Math.max(0, Math.sqrt((me - 1) / (n + 1)) - 1) + this.cs;
    this.cc = (4 + me / n) / (n + 4 + 2 * me / n);
    this.c1 = 2 / ((n + 1.3) * (n + 1.3) + me);
    this.cmu = Math.min(1 - this.c1, 2 * (me - 2 + 1 / me) / ((n + 2) * (n + 2) + me));
    this.chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
    this.rng = new RNG(opts.seed);
    if (opts.state) { this.load(opts.state); return; }
    this.m = Float64Array.from(opts.mean || new Float64Array(n));
    this.sigma = opts.sigma || 0.5;
    this.C = new Float64Array(n * n);
    for (let i = 0; i < n; i++) this.C[i * n + i] = 1;
    this.B = Float64Array.from(this.C);
    this.D = new Float64Array(n).fill(1);
    this.ps = new Float64Array(n);
    this.pc = new Float64Array(n);
    this.gen = 0;
    this.eigenGen = 0;
  }

  // λ 匹分の遺伝子を生む（z: 標準正規, y = B D z, x = m + σ y）
  ask() {
    const n = this.n, out = [];
    for (let k = 0; k < this.lambda; k++) {
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) z[i] = this.rng.gauss();
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += this.B[i * n + j] * this.D[j] * z[j];
        y[i] = s;
      }
      const x = new Float64Array(n);
      for (let i = 0; i < n; i++) x[i] = this.m[i] + this.sigma * y[i];
      out.push({ x, y });
    }
    return out;
  }

  // 成績（大きいほどよい）を受けとって更新
  tell(samples, fits) {
    const n = this.n, lam = samples.length, mu = this.mu;
    const idx = [...Array(lam).keys()].sort((a, b) => fits[b] - fits[a]);
    const yw = new Float64Array(n);
    for (let k = 0; k < mu; k++) {
      const y = samples[idx[k]].y, wk = this.w[k];
      for (let i = 0; i < n; i++) yw[i] += wk * y[i];
    }
    for (let i = 0; i < n; i++) this.m[i] += this.sigma * yw[i];
    // C^{-1/2} yw = B D^{-1} B^T yw
    const t = new Float64Array(n);
    for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += this.B[i * n + j] * yw[i]; t[j] = s / this.D[j]; }
    const cy = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += this.B[i * n + j] * t[j]; cy[i] = s; }
    const csn = Math.sqrt(this.cs * (2 - this.cs) * this.mueff);
    let psn = 0;
    for (let i = 0; i < n; i++) { this.ps[i] = (1 - this.cs) * this.ps[i] + csn * cy[i]; psn += this.ps[i] * this.ps[i]; }
    psn = Math.sqrt(psn);
    this.gen++;
    const hs = psn / Math.sqrt(1 - Math.pow(1 - this.cs, 2 * this.gen)) / this.chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    const ccn = Math.sqrt(this.cc * (2 - this.cc) * this.mueff);
    for (let i = 0; i < n; i++) this.pc[i] = (1 - this.cc) * this.pc[i] + hs * ccn * yw[i];
    const c1 = this.c1, cmu = this.cmu, C = this.C;
    const keep = 1 - c1 - cmu + (1 - hs) * c1 * this.cc * (2 - this.cc);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let r = 0;
        for (let k = 0; k < mu; k++) { const y = samples[idx[k]].y; r += this.w[k] * y[i] * y[j]; }
        const v = keep * C[i * n + j] + c1 * this.pc[i] * this.pc[j] + cmu * r;
        C[i * n + j] = v; C[j * n + i] = v;
      }
    }
    this.sigma *= Math.exp((this.cs / this.ds) * (psn / this.chiN - 1));
    if (this.sigma > 3) this.sigma = 3;
    if (this.sigma < 1e-4) this.sigma = 1e-4;
    // 固有値分解（ときどき）
    if (this.gen - this.eigenGen > lam / (c1 + cmu) / n / 10) this.decompose();
    return idx;
  }

  decompose() {
    const n = this.n;
    const { V, d } = jacobiEigen(this.C, n);
    for (let i = 0; i < n; i++) this.D[i] = Math.sqrt(Math.max(1e-20, d[i]));
    this.B = V;
    this.eigenGen = this.gen;
  }

  // 停滞したときの「ゆさぶり」: 歩幅（σ）を大きくする
  kick(f = 2) { this.sigma = Math.min(1.5, this.sigma * f); }

  save() {
    return {
      n: this.n, lambda: this.lambda, m: Array.from(this.m), sigma: this.sigma, C: Array.from(this.C, v => Math.fround(v)),
      ps: Array.from(this.ps), pc: Array.from(this.pc), gen: this.gen, rng: this.rng.s,
    };
  }
  load(s) {
    this.m = Float64Array.from(s.m);
    this.sigma = s.sigma;
    this.C = Float64Array.from(s.C);
    this.ps = Float64Array.from(s.ps);
    this.pc = Float64Array.from(s.pc);
    this.gen = s.gen;
    this.rng.s = s.rng >>> 0;
    this.B = new Float64Array(this.n * this.n);
    this.D = new Float64Array(this.n);
    this.decompose();
  }
}

// 対称行列の固有値分解（ヤコビ法）。V の列が固有ベクトル
export function jacobiEigen(Cin, n) {
  const A = Float64Array.from(Cin);
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-14) continue;
        const app = A[p * n + p], aqq = A[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p], akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k], aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = A[i * n + i];
  return { V, d };
}
