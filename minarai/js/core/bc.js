// 模倣学習（ビヘイビア・クローニング）: お手本の「この画像のとき、この行動」をそのまま当てる練習
import { SNAP, Env, expertAction } from './env.js';
import { Raster, OBS } from './raster.js';
import { Adam, PROP } from './nn.js';
import { NOUT, HEAD_OFF, HEAD_N, probs } from './policy.js';
import { makeRng } from './rng.js';

// お手本の記録。画像そのものではなく「場面の状態」を覚えておき、学習のたびに描き直す（軽い・カメラのゆれも毎回かけ直せる）
export class DemoSet {
  constructor() { this.snaps = new Float32Array(1024 * SNAP); this.acts = new Uint8Array(1024 * 3); this.n = 0; this.demos = []; this._start = 0; }
  _grow() {
    const cap = this.acts.length / 3 * 2;
    const s = new Float32Array(cap * SNAP); s.set(this.snaps); this.snaps = s;
    const a = new Uint8Array(cap * 3); a.set(this.acts); this.acts = a;
  }
  // いまの場面と、そのとき選んだ行動（j1, j2 は 0..2、g は 0..1）を1歩ぶん足す
  add(env, j1, j2, g) {
    if ((this.n + 1) * 3 > this.acts.length) this._grow();
    env.snapshot(this.snaps, this.n * SNAP);
    const o = this.n * 3; this.acts[o] = j1; this.acts[o + 1] = j2; this.acts[o + 2] = g;
    this.n++;
  }
  // 記録中の1本を確定（src: 'human' 自分 / 'robot' お手本ロボ / 'fix' 手直し）
  commit(src) {
    const len = this.n - this._start;
    if (len > 0) this.demos.push({ start: this._start, len, src });
    this._start = this.n;
    return len;
  }
  // 記録中の1本を捨てる
  cancel() { this.n = this._start; }
  pending() { return this.n - this._start; }
  removeLast() {
    const d = this.demos.pop();
    if (d) { this.n = d.start; this._start = d.start; }
    return d;
  }
  clear() { this.n = 0; this._start = 0; this.demos = []; }
  count(src) { return src ? this.demos.filter((d) => d.src === src).length : this.demos.length; }
  toJSON() {
    return { n: this._start, snaps: this.snaps.slice(0, this._start * SNAP), acts: this.acts.slice(0, this._start * 3), demos: this.demos };
  }
  static from(o) {
    const d = new DemoSet();
    if (!o) return d;
    while (d.acts.length < o.n * 3) d._grow();
    d.snaps.set(o.snaps); d.acts.set(o.acts); d.n = o.n; d._start = o.n; d.demos = o.demos.slice();
    return d;
  }
}

// お手本ロボに n 本やってもらう。noise > 0 なら、ときどきわざと違う動きをさせ（記録するのは「本当はこう動く」）、
// 立て直し方もお手本に入るようにする
export function addRobotDemos(set, stage, n, seed, noise = 0) {
  const env = new Env(stage, seed), rng = makeRng(seed ^ 0x9e3779b9), a = [0, 0, 0];
  let made = 0, guard = 0;
  while (made < n && guard++ < n * 4) {
    env.reset();
    while (!env.done) {
      expertAction(env, a);
      set.add(env, a[0] + 1, a[1] + 1, a[2]);
      let u1 = a[0], u2 = a[1], g = a[2];
      if (noise > 0) {
        if (rng() < noise) { u1 = rng.int(3) - 1; u2 = rng.int(3) - 1; }
        if (rng() < noise * 0.25) g = 1 - g;
      }
      env.step(u1, u2, g);
    }
    if (env.success) { set.commit('robot'); made++; } else set.cancel();
  }
  return made;
}

// 水増し: 机ごと土台のまわりに好きな角度だけ回しても、左右を裏返しても、正しい行動は変わらない
// （裏返したときだけ、関節の −/＋ が入れ替わる）。スナップショットを書き換え、裏返したら 1 を返す
export function augmentSnap(s, rng) {
  const phi = rng.range(-Math.PI, Math.PI), c = Math.cos(phi), sn = Math.sin(phi);
  const mirror = rng() < 0.5 ? 1 : 0;
  if (mirror) { s[0] = -s[0]; s[1] = -s[1]; }
  s[0] += phi;
  for (let i = 0; i < 2; i++) {
    const o = 6 + i * 4;
    let x = s[o], y = s[o + 1], th = s[o + 2];
    if (mirror) { y = -y; th = -th; }
    s[o] = x * c - y * sn; s[o + 1] = x * sn + y * c; s[o + 2] = th + phi;
    const q = 14 + i * 2;
    x = s[q]; y = s[q + 1];
    if (mirror) y = -y;
    s[q] = x * c - y * sn; s[q + 1] = x * sn + y * c;
  }
  return mirror;
}

export class BCTrainer {
  constructor(net, set, stage, opts = {}) {
    this.net = net; this.set = set; this.stage = stage;
    this.batch = opts.batch || 32;
    this.opt = new Adam(net.params, opts.lr || 1e-3, 5);
    this.rng = makeRng(opts.seed || 1);
    this.ras = new Raster();
    this.obs = new Uint8Array(this.batch * OBS);
    this.offs = Int32Array.from({ length: this.batch }, (_, i) => i * OBS);
    this.dz = new Float32Array(this.batch * NOUT);
    this.p = new Float64Array(NOUT);
    this.tmp = new Float32Array(SNAP);
    this.flip = new Uint8Array(this.batch);
    this.prop = new Float32Array(this.batch * PROP);
    this.augment = opts.augment !== false;
    this.order = new Int32Array(0);
    this.pos = 0; this.epoch = 0;
    this.lossSum = 0; this.hit = 0; this.seen = 0;
  }
  _shuffle() {
    const n = this.set._start;
    if (this.order.length !== n) this.order = Int32Array.from({ length: n }, (_, i) => i);
    const o = this.order, r = this.rng;
    for (let i = n - 1; i > 0; i--) { const j = r.int(i + 1), t = o[i]; o[i] = o[j]; o[j] = t; }
    this.pos = 0;
  }
  // ミニバッチ1つぶん学習する。エポック（お手本ひと回り）が終わったら { epoch, loss, acc } を返す
  step() {
    const set = this.set, n = set._start;
    if (n === 0) return null;
    if (this.order.length !== n || this.pos >= n) this._shuffle();
    const B = Math.min(this.batch, n - this.pos), shake = this.stage.shake || 0, tmp = this.tmp, rng = this.rng, aug = this.augment;
    const flip = this.flip;
    for (let b = 0; b < B; b++) {
      const i = this.order[this.pos + b];
      flip[b] = 0;
      if (shake > 0 || aug) {
        tmp.set(set.snaps.subarray(i * SNAP, (i + 1) * SNAP));
        if (aug) flip[b] = augmentSnap(tmp, rng);
        if (shake > 0) { tmp[18] = rng.range(-shake, shake); tmp[19] = rng.range(-shake, shake); }
        this.ras.render(tmp, 0, this.obs, b * OBS);
        this.prop[b * PROP] = tmp[0]; this.prop[b * PROP + 1] = tmp[1]; this.prop[b * PROP + 2] = tmp[2];
      } else {
        const o = i * SNAP;
        this.ras.render(set.snaps, o, this.obs, b * OBS);
        this.prop[b * PROP] = set.snaps[o]; this.prop[b * PROP + 1] = set.snaps[o + 1]; this.prop[b * PROP + 2] = set.snaps[o + 2];
      }
    }
    const z = this.net.forward(this.obs, this.offs, B, this.prop), dz = this.dz, p = this.p;
    for (let b = 0; b < B; b++) {
      const i = this.order[this.pos + b];
      probs(z, b * NOUT, p);
      let allHit = 1;
      for (let h = 0; h < 3; h++) {
        const o = HEAD_OFF[h];
        let a = set.acts[i * 3 + h];
        if (flip[b] && h < 2) a = 2 - a;
        let best = 0;
        for (let k = 0; k < HEAD_N[h]; k++) { dz[b * NOUT + o + k] = (p[o + k] - (k === a ? 1 : 0)) / B; if (p[o + k] > p[o + best]) best = k; }
        this.lossSum -= Math.log(p[o + a] + 1e-12);
        if (best !== a) allHit = 0;
      }
      this.hit += allHit;
    }
    this.seen += B;
    this.opt.zero(); this.net.backward(dz); this.opt.step();
    if (this.net.clampBias) this.net.clampBias();
    this.pos += B;
    if (this.pos >= n) {
      this.epoch++;
      const res = { epoch: this.epoch, loss: this.lossSum / this.seen, acc: this.hit / this.seen };
      this.lossSum = 0; this.hit = 0; this.seen = 0;
      return res;
    }
    return null;
  }
}
