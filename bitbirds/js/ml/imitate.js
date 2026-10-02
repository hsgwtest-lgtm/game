// 模倣学習（ビヘイビア・クローニング）
// あなたの操縦（お手本）を「目の画像 → 操縦」のデータとしてためて、
// ニューラルネットの出力がお手本に近づくように誤差逆伝播(Adam)で少しずつ直していく。

import { MLP, AdamTrainer, f32ToB64, b64ToF32 } from './nn.js';
import { N_IN } from '../sim/flight.js';
import { NET } from '../core/config.js';
import { RNG } from '../core/rng.js';

export class Imitator {
  constructor(cap = 6000, seed) {
    this.cap = cap;
    this.nIn = N_IN;
    this.X = new Float32Array(cap * N_IN);
    this.Y = new Float32Array(cap * 2);
    this.W = new Float32Array(cap);
    this.count = 0;
    this.head = 0;
    this.added = 0;          // これまでに集めた総数
    this.rng = new RNG(seed);
    this.net = new MLP(N_IN, NET.hid, 2).randomize(this.rng, 0.6);
    this.trainer = new AdamTrainer(this.net, 0.004);
    this.steps = 0;          // 学習した回数（ミニバッチ数）
    this.loss = null;        // 直近の誤差（移動平均）
    this.lossHist = [];      // グラフ用
    this.agree = null;       // 一致度（移動平均）
    this.idx = new Int32Array(64);
    this.tmpOut = new Float32Array(2);
    this.clears = 0;         // AIだけでクリアした回数
  }

  add(x, y0, y1, w = 1) {
    const i = this.head;
    this.X.set(x, i * this.nIn);
    this.Y[i * 2] = y0; this.Y[i * 2 + 1] = y1;
    this.W[i] = w;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    this.added++;
    // 予測とお手本の一致度
    const p = this.net.forward(x, this.tmpOut);
    const a = 1 - (Math.abs(p[0] - y0) + Math.abs(p[1] - y1)) / 4;
    this.agree = this.agree == null ? a : this.agree * 0.985 + a * 0.015;
  }

  // 直近 n 個を捨てる（ぶつかる直前の「まずいお手本」を消す）
  dropLast(n) {
    n = Math.min(n, this.count);
    this.head = (this.head - n + this.cap) % this.cap;
    this.count -= n;
    this.added = Math.max(0, this.added - n);
  }

  train(nSteps = 4, batch = 32) {
    if (this.count < 48) return null;
    const idx = this.idx;
    const start = (this.head - this.count + this.cap) % this.cap;
    let l = 0;
    for (let s = 0; s < nSteps; s++) {
      for (let j = 0; j < batch; j++) idx[j] = (start + Math.floor(this.rng.float() * this.count)) % this.cap;
      l = this.trainer.step(this.X, this.Y, this.W, idx, batch);
      this.loss = this.loss == null ? l : this.loss * 0.97 + l * 0.03;
      this.steps++;
      if (this.steps % 20 === 0) {
        this.lossHist.push(this.loss);
        if (this.lossHist.length > 240) {
          // 古い記録は間引いて長期の流れを残す
          const h = [];
          for (let i = 0; i < this.lossHist.length; i += 2) h.push(this.lossHist[i]);
          this.lossHist = h;
        }
      }
    }
    return l;
  }

  predict(x, out) { return this.net.forward(x, out); }

  // ためたデータからランダムに選んで「お手本とどれだけ同じ操縦をするか」を測る
  evalAgree(n = 64) {
    if (this.count < 20) return this.agree;
    const start = (this.head - this.count + this.cap) % this.cap;
    let acc = 0;
    for (let j = 0; j < n; j++) {
      const i = (start + Math.floor(this.rng.float() * this.count)) % this.cap;
      // 重みは共有、活動の記録は別（脳の表示がちらつかないように）
      if (!this.evalNet || this.evalNet.w !== this.net.w) this.evalNet = new MLP(this.nIn, this.net.nHid, 2, this.net.w);
      const p = this.evalNet.forward(this.X.subarray(i * this.nIn, i * this.nIn + this.nIn), this.tmpOut);
      acc += 1 - (Math.abs(p[0] - this.Y[i * 2]) + Math.abs(p[1] - this.Y[i * 2 + 1])) / 4;
    }
    this.agree = acc / n;
    return this.agree;
  }

  clearData() { this.count = 0; this.head = 0; this.added = 0; this.agree = null; }

  resetBrain() {
    this.net.randomize(this.rng, 0.6);
    this.trainer.reset();
    this.steps = 0; this.loss = null; this.lossHist = []; this.agree = null; this.clears = 0;
  }

  serialize() {
    // データは新しい方から最大 2500 個だけ保存
    const n = Math.min(this.count, 2500);
    const X = new Float32Array(n * this.nIn), Y = new Float32Array(n * 2), W = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const i = (this.head - n + k + this.cap) % this.cap;
      X.set(this.X.subarray(i * this.nIn, i * this.nIn + this.nIn), k * this.nIn);
      Y[k * 2] = this.Y[i * 2]; Y[k * 2 + 1] = this.Y[i * 2 + 1]; W[k] = this.W[i];
    }
    return {
      v: 1, w: f32ToB64(this.net.w), steps: this.steps, loss: this.loss, hist: this.lossHist,
      added: this.added, clears: this.clears, n, X: f32ToB64(X), Y: f32ToB64(Y), W: f32ToB64(W),
    };
  }

  static deserialize(d) {
    const im = new Imitator();
    const w = b64ToF32(d.w);
    if (w.length !== im.net.size) return null;
    im.net.w.set(w);
    im.steps = d.steps || 0; im.loss = d.loss ?? null; im.lossHist = d.hist || [];
    im.clears = d.clears || 0;
    if (d.n) {
      const X = b64ToF32(d.X), Y = b64ToF32(d.Y), W = b64ToF32(d.W);
      if (X.length === d.n * im.nIn) {
        for (let k = 0; k < d.n; k++) {
          im.X.set(X.subarray(k * im.nIn, (k + 1) * im.nIn), k * im.nIn);
          im.Y[k * 2] = Y[k * 2]; im.Y[k * 2 + 1] = Y[k * 2 + 1]; im.W[k] = W[k];
        }
        im.count = d.n; im.head = d.n % im.cap;
      }
    }
    im.added = d.added || im.count;
    return im;
  }
}
