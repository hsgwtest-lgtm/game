// 模倣流：模倣学習（ビヘイビア・クローニング ＋ DAgger）
// あなたのお手本を「目に映ったもの → 押したボタン」のデータとしてためて、
// 脳の答えがお手本と同じになるように誤差逆伝播（Adam）で少しずつ直していく。
// AIにまかせている時にあなたが手を出した場面は「苦手な場面」として重く学ぶ（DAgger）。

import { MLP, Adam, softmax, argmax, f32ToB64, b64ToF32, u8ToB64, b64ToU8 } from './nn.js';
import { RNG } from '../core/rng.js';
import { N_IN, N_ACT } from '../sim/env.js';
import { HID } from './ga.js';

export const BC_CAP = 1200;

// 観測は 0/1 がほとんどなので、保存は 1バイト（-1..1 → 0..254）にする
function q8(v) { return Math.max(0, Math.min(254, Math.round((v + 1) * 127))); }
function dq8(b) { return b / 127 - 1; }

export class Imitator {
  constructor(opts = {}) {
    this.rng = new RNG(opts.seed);
    this.cap = opts.cap || BC_CAP;
    this.X = new Float32Array(this.cap * N_IN);
    this.Y = new Int8Array(this.cap);
    this.W = new Float32Array(this.cap);
    this.count = 0;
    this.head = 0;
    this.added = 0;          // これまでに集めた総数
    this.demos = 0;          // お手本の回数
    this.demoSteps = 0;      // お手本の歩数（人の手間）
    this.fixes = 0;          // 手助け（DAgger）の回数
    this.net = new MLP(N_IN, HID, N_ACT).randomize(this.rng, 1, 0.3);
    this.adam = new Adam(this.net.size, 0.006);
    this.g = new Float32Array(this.net.size);
    this.p = new Float32Array(N_ACT);
    this.z = new Float32Array(N_ACT);
    this.dz = new Float32Array(N_ACT);
    this.steps = 0;
    this.loss = null;
    this.lossHist = [];
    this.acc = null;         // 一致度（お手本と同じボタンを選ぶ割合）
    this.aiRuns = 0;         // AIだけで挑戦した回数
    this.aiClears = 0;
    this.history = [];       // AIだけの挑戦の記録 {n, succ}
    this.idx = new Int32Array(64);
    this.dirty = 0;          // まだ学んでいない新しいデータの数
  }

  add(obs, action, w = 1) {
    const i = this.head;
    this.X.set(obs, i * N_IN);
    this.Y[i] = action;
    this.W[i] = w;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    this.added++;
    this.dirty++;
  }

  // 直近 n 個を捨てる（落ちる直前のまずいお手本を消す）
  dropLast(n) {
    n = Math.min(n, this.count);
    this.head = (this.head - n + this.cap) % this.cap;
    this.count -= n;
    this.added = Math.max(0, this.added - n);
  }

  // 学習（ミニバッチの勾配降下を nSteps 回）。戻り値は平均の誤差
  train(nSteps = 8, batch = 32) {
    if (this.count < 4) return null;
    const net = this.net, g = this.g, p = this.p, dz = this.dz, idx = this.idx;
    const start = (this.head - this.count + this.cap) % this.cap;
    const B = Math.min(batch, this.count);
    let lastL = 0;
    for (let s = 0; s < nSteps; s++) {
      g.fill(0);
      let L = 0, wsum = 0;
      for (let j = 0; j < B; j++) idx[j] = (start + Math.floor(this.rng.float() * this.count)) % this.cap;
      for (let j = 0; j < B; j++) {
        const k = idx[j];
        const x = this.X.subarray(k * N_IN, k * N_IN + N_IN);
        softmax(net.forward(x, this.z), p);
        const y = this.Y[k], w = this.W[k];
        L += -Math.log(Math.max(1e-8, p[y])) * w;
        wsum += w;
        for (let a = 0; a < N_ACT; a++) dz[a] = (p[a] - (a === y ? 1 : 0)) * w;
        net.backward(x, dz, g);
      }
      const inv = 1 / wsum;
      // 少しだけ重みを小さく保つ（覚えすぎ防止）
      for (let q = 0; q < g.length; q++) g[q] = g[q] * inv + 0.0005 * net.w[q];
      this.adam.step(net.w, g, 2.0);
      lastL = L * inv;
      this.loss = this.loss == null ? lastL : this.loss * 0.9 + lastL * 0.1;
      this.steps++;
      if (this.steps % 10 === 0) {
        this.lossHist.push(this.loss);
        if (this.lossHist.length > 200) {
          const h = [];
          for (let i = 0; i < this.lossHist.length; i += 2) h.push(this.lossHist[i]);
          this.lossHist = h;
        }
      }
    }
    this.dirty = Math.max(0, this.dirty - nSteps * 4);
    return lastL;
  }

  // ためたデータで一致度を測る
  evalAcc(n = 128) {
    if (this.count === 0) { this.acc = null; return null; }
    const start = (this.head - this.count + this.cap) % this.cap;
    const m = Math.min(n, this.count);
    let ok = 0;
    for (let j = 0; j < m; j++) {
      const k = (start + (this.count <= n ? j : Math.floor(this.rng.float() * this.count))) % this.cap;
      const x = this.X.subarray(k * N_IN, k * N_IN + N_IN);
      if (argmax(this.net.forward(x, this.z)) === this.Y[k]) ok++;
    }
    this.acc = ok / m;
    return this.acc;
  }

  policyProbs(obs, out = this.p) { return softmax(this.net.forward(obs, this.z), out); }
  greedy(obs) { return argmax(this.net.forward(obs, this.z)); }

  // 行動ごとのデータの数
  actionCounts() {
    const c = new Array(N_ACT).fill(0);
    const start = (this.head - this.count + this.cap) % this.cap;
    for (let j = 0; j < this.count; j++) c[this.Y[(start + j) % this.cap]]++;
    return c;
  }

  clearData() { this.count = 0; this.head = 0; this.added = 0; this.dirty = 0; }

  resetBrain() {
    this.net.randomize(this.rng, 1, 0.3);
    this.adam.reset();
    this.steps = 0; this.loss = null; this.lossHist = []; this.acc = null;
  }

  serialize(maxN = 600) {
    const n = Math.min(this.count, maxN);
    const X = new Uint8Array(n * N_IN), Y = new Int8Array(n), W = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const i = (this.head - n + k + this.cap) % this.cap;
      for (let q = 0; q < N_IN; q++) X[k * N_IN + q] = q8(this.X[i * N_IN + q]);
      Y[k] = this.Y[i]; W[k] = this.W[i];
    }
    return {
      v: 1, w: f32ToB64(this.net.w), steps: this.steps, loss: this.loss, hist: this.lossHist,
      added: this.added, demos: this.demos, demoSteps: this.demoSteps, fixes: this.fixes,
      aiRuns: this.aiRuns, aiClears: this.aiClears, history: this.history.slice(-100),
      n, X: u8ToB64(X), Y: u8ToB64(new Uint8Array(Y.buffer)), W: f32ToB64(W),
    };
  }

  static deserialize(d, seed) {
    if (!d || !d.w) return null;
    const im = new Imitator({ seed });
    const w = b64ToF32(d.w);
    if (w.length !== im.net.size) return null;
    im.net.w.set(w);
    im.steps = d.steps || 0; im.loss = d.loss ?? null; im.lossHist = d.hist || [];
    im.demos = d.demos || 0; im.demoSteps = d.demoSteps || 0; im.fixes = d.fixes || 0;
    im.aiRuns = d.aiRuns || 0; im.aiClears = d.aiClears || 0; im.history = d.history || [];
    if (d.n) {
      const X = b64ToU8(d.X), Y = new Int8Array(b64ToU8(d.Y).buffer), W = b64ToF32(d.W);
      if (X.length === d.n * N_IN) {
        for (let k = 0; k < d.n; k++) {
          for (let q = 0; q < N_IN; q++) im.X[k * N_IN + q] = dq8(X[k * N_IN + q]);
          im.Y[k] = Y[k]; im.W[k] = W[k];
        }
        im.count = d.n; im.head = d.n % im.cap;
      }
    }
    im.added = d.added || im.count;
    im.dirty = 0;
    return im;
  }
}
