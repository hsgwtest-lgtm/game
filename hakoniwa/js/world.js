// world.js — 島の地形、植物（草・木・木の実）、昼夜と気温・天気
import { RNG, makeNoise2D, clamp, smoothstep, r1, r2, bytesToB64, b64ToBytes } from './util.js';

export const GW = 44;
export const GH = 44;
export const LEVEL_H = 0.5; // 地形1段の高さ
export const WATER_Y = 1.2; // 水面の高さ（段2の上面1.0と段3の上面1.5のあいだ）
export const DAY_LEN = 120; // 1日の長さ（1倍速で120秒）
export const EVENT_LEN = 80; // 熱波・寒波の長さ（秒）
export const MAX_TREES = 44;
export const MAX_FRUITS = 110;
export const FRUIT_ROT = 100; // 木の実が腐るまでの秒数
export const CARC_ROT = 50; // 亡きがらが土に還るまでの秒数

export const T = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FOREST: 4, ROCK: 5, PEAK: 6 };
export const T_JA = ['深い海', '浅瀬', '砂浜', '草原', '森', '岩場', '山頂'];
export const FERT = [0, 0, 0.15, 1, 0.75, 0.1, 0]; // 草の育ちやすさ
export const MOVE = [0, 0, 0.9, 1, 0.85, 0.72, 0.6]; // 歩きやすさ

export class World {
  constructor(seed, opt = {}) {
    this.seed = seed >>> 0;
    const n = GW * GH;
    this.level = new Uint8Array(n);
    this.type = new Uint8Array(n);
    this.grass = new Float32Array(n);
    this.boost = new Float32Array(n); // 亡きがらが土に還った養分
    this.trees = [];
    this.fruits = [];
    this.carcs = []; // 亡きがら（肉食が食べられる）
    this.time = DAY_LEN * 0.3; // 1日目の朝7時ごろから
    this.ev = { rain: 0, heat: 0, cold: 0 }; // 残り秒数
    this.rainI = 0;
    this.heatI = 0;
    this.coldI = 0;
    this.snow = 0;
    this.tempBase = opt.tempBase ?? 18;
    this.growth = opt.growth ?? 1;
    this.naturalRain = opt.naturalRain ?? true;
    this.plantAcc = 0;
    this.gVersion = 0; // 草が変わるたびに増える（描画の更新合図）
    this.treeVersion = 0;
    this.generate();
    this.updateClimate();
  }

  // ---- 地形（シードだけで決まる。保存データからも同じ島が作れる）
  generate() {
    const rng = new RNG(this.seed);
    const n1 = makeNoise2D(rng);
    const n2 = makeNoise2D(rng);
    const nf = makeNoise2D(rng);
    const ox = rng.range(0, 200);
    const oz = rng.range(0, 200);
    const fbm = (x, y) => {
      let s = 0;
      let a = 0.5;
      let f = 1;
      for (let o = 0; o < 4; o++) {
        s += a * n1(x * f, y * f);
        a *= 0.5;
        f *= 2.03;
      }
      return s / 0.9375;
    };
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const nx = ((i + 0.5) / GW) * 2 - 1;
        const nz = ((j + 0.5) / GH) * 2 - 1;
        const wx = nx + (n2(i * 0.08 + ox, j * 0.08) - 0.5) * 0.4;
        const wz = nz + (n2(i * 0.08, j * 0.08 + oz) - 0.5) * 0.4;
        const d = Math.sqrt(wx * wx + wz * wz);
        const e = 1.0 - 1.2 * d * d + (fbm(i * 0.085 + ox, j * 0.085 + oz) - 0.5) * 0.8 + 0.3 * Math.exp(-(nx * nx + nz * nz) / 0.05);
        let lv = clamp(Math.floor(e * 7.4), 0, 9);
        if (i === 0 || j === 0 || i === GW - 1 || j === GH - 1) lv = Math.min(lv, 1);
        this.level[j * GW + i] = lv;
      }
    }
    // いちばん大きな陸地だけ残す（離れ小島は浅瀬に）
    const land = (k) => this.level[k] >= 3;
    const comp = new Int32Array(GW * GH).fill(-1);
    let bestC = -1;
    let bestN = 0;
    let cid = 0;
    const stack = [];
    for (let k = 0; k < GW * GH; k++) {
      if (!land(k) || comp[k] >= 0) continue;
      let cnt = 0;
      stack.push(k);
      comp[k] = cid;
      while (stack.length) {
        const q = stack.pop();
        cnt++;
        const qi = q % GW;
        const qj = (q / GW) | 0;
        const nb = [qi > 0 ? q - 1 : -1, qi < GW - 1 ? q + 1 : -1, qj > 0 ? q - GW : -1, qj < GH - 1 ? q + GW : -1];
        for (const m of nb) {
          if (m >= 0 && land(m) && comp[m] < 0) {
            comp[m] = cid;
            stack.push(m);
          }
        }
      }
      if (cnt > bestN) {
        bestN = cnt;
        bestC = cid;
      }
      cid++;
    }
    for (let k = 0; k < GW * GH; k++) if (land(k) && comp[k] !== bestC) this.level[k] = 2;
    // 種類
    this.landCount = 0;
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const k = j * GW + i;
        const lv = this.level[k];
        let t;
        if (lv <= 1) t = T.DEEP;
        else if (lv === 2) t = T.SHALLOW;
        else if (lv === 3) t = T.SAND;
        else if (lv <= 6) t = nf(i * 0.13 + 7, j * 0.13 + 3) > 0.56 || (lv === 6 && nf(i * 0.13 + 7, j * 0.13 + 3) > 0.45) ? T.FOREST : T.GRASS;
        else if (lv <= 8) t = T.ROCK;
        else t = T.PEAK;
        this.type[k] = t;
        if (t >= T.SAND) this.landCount++;
      }
    }
  }

  // ---- 初期の草と木（新しいゲームのときだけ）
  populate(rng, opt = {}) {
    const g0 = opt.grass0 ?? 0.6;
    for (let k = 0; k < GW * GH; k++) {
      this.grass[k] = FERT[this.type[k]] > 0 ? clamp(g0 * rng.range(0.6, 1.1), 0, 1) : 0;
    }
    const want = opt.trees ?? 18;
    const cand = [];
    for (let k = 0; k < GW * GH; k++) {
      const t = this.type[k];
      if (t === T.FOREST) cand.push(k, k, k);
      else if (t === T.GRASS) cand.push(k);
    }
    let tries = 0;
    while (this.trees.length < want && tries < 2000 && cand.length) {
      tries++;
      const k = rng.pick(cand);
      const x = (k % GW) + 0.5;
      const z = ((k / GW) | 0) + 0.5;
      if (this.trees.some((tr) => (tr.x - x) ** 2 + (tr.z - z) ** 2 < 2.6 * 2.6)) continue;
      this.trees.push({ x, z, timer: rng.range(2, 14), grow: 1, kind: rng.int(2), n: 0 });
    }
    // 最初から少し実がなっている
    for (let i = 0; i < this.trees.length; i++) {
      const c = opt.fruit0 ?? 2;
      for (let m = 0; m < c; m++) this.spawnFruit(rng, this.trees[i].x, this.trees[i].z, 1.9, this.trees[i].kind, i);
    }
    this.treeVersion++;
    this.gVersion++;
  }

  // ---- 座標まわり
  cellIndex(x, z) {
    const i = Math.floor(x);
    const j = Math.floor(z);
    if (i < 0 || j < 0 || i >= GW || j >= GH) return -1;
    return j * GW + i;
  }
  walkable(x, z) {
    const k = this.cellIndex(x, z);
    return k >= 0 && this.type[k] >= T.SAND;
  }
  walkIdx(k) {
    return this.type[k] >= T.SAND;
  }
  topY(k) {
    return this.level[k] * LEVEL_H;
  }
  groundY(x, z) {
    const k = this.cellIndex(x, z);
    return k < 0 ? 0 : this.level[k] * LEVEL_H;
  }

  // ---- 時間と気候
  updateClimate() {
    const tod = (((this.time % DAY_LEN) + DAY_LEN) % DAY_LEN) / DAY_LEN;
    this.tod = tod;
    this.sunA = (tod - 0.25) * Math.PI * 2;
    this.sunElev = Math.sin(this.sunA);
    this.daylight = smoothstep(-0.12, 0.22, this.sunElev);
    this.temp = this.tempBase + 5 * this.sunElev - 3 * this.rainI + 10 * this.heatI - 10 * this.coldI;
  }
  get day() {
    return Math.floor(this.time / DAY_LEN) + 1;
  }
  clockText() {
    const m = Math.floor(this.tod * 24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  step(dt, rng) {
    this.time += dt;
    const ev = this.ev;
    if (ev.rain > 0) ev.rain = Math.max(0, ev.rain - dt);
    if (ev.heat > 0) ev.heat = Math.max(0, ev.heat - dt);
    if (ev.cold > 0) ev.cold = Math.max(0, ev.cold - dt);
    if (this.naturalRain && ev.rain <= 0 && rng.next() < dt / 260) ev.rain = rng.range(25, 55);
    this.rainI += ((ev.rain > 0 ? 1 : 0) - this.rainI) * Math.min(1, dt * 0.5);
    const ramp = Math.min(1, dt * 0.12);
    this.heatI += ((ev.heat > 0 ? 1 : 0) - this.heatI) * ramp;
    this.coldI += ((ev.cold > 0 ? 1 : 0) - this.coldI) * ramp;
    this.updateClimate();
    // 寒波のあいだは雪が積もる（とけるのは暖かくなってから）
    if (this.temp < 6 && this.coldI > 0.5) this.snow = Math.min(1, this.snow + dt * 0.03);
    else if (this.temp > 8 || this.coldI < 0.2) this.snow = Math.max(0, this.snow - dt * 0.025);
    this.plantAcc += dt;
    if (this.plantAcc >= 0.5) {
      this.growPlants(this.plantAcc);
      this.plantAcc = 0;
      this.gVersion++;
    }
    this.stepTrees(dt, rng);
  }

  growthTempFactor(width = 16) {
    return clamp(1 - ((this.temp - 20) / width) ** 2, 0.06, 1);
  }

  growPlants(dt) {
    const light = 0.3 + 0.7 * this.daylight;
    const R = 0.025 * this.growth * light * this.growthTempFactor(16) * (1 + 1.3 * this.rainI) * (1 - 0.6 * this.snow);
    const wither = this.heatI * (1 - this.rainI) * 0.006;
    const g = this.grass;
    const b = this.boost;
    for (let k = 0; k < g.length; k++) {
      const f = FERT[this.type[k]];
      if (f === 0) continue;
      let v = g[k];
      // 食べられて短いほど早く伸びる（伸びしろに比例）
      v += R * f * (1 + b[k]) * (1 - v) * dt - wither * v * dt;
      g[k] = v < 0 ? 0 : v > 1 ? 1 : v;
      if (b[k] > 0) b[k] = Math.max(0, b[k] - 0.004 * dt);
    }
  }

  stepTrees(dt, rng) {
    const prod = (0.45 + 0.55 * this.daylight) * this.growthTempFactor(18) * (1 + 0.6 * this.rainI) * (1 - 0.7 * this.snow) * this.growth;
    for (let i = 0; i < this.trees.length; i++) {
      const tr = this.trees[i];
      if (tr.grow < 1) {
        const before = tr.grow;
        tr.grow = Math.min(1, tr.grow + dt / (DAY_LEN * 0.8));
        if (Math.floor(before * 20) !== Math.floor(tr.grow * 20)) this.treeVersion++;
      }
      if (tr.grow < 0.6) continue;
      tr.timer -= dt * prod;
      if (tr.timer <= 0) {
        tr.timer = rng.range(9, 15);
        if (tr.n < 5 && this.fruits.length < MAX_FRUITS) this.spawnFruit(rng, tr.x, tr.z, 1.9, tr.kind, i);
      }
    }
    for (let i = this.carcs.length - 1; i >= 0; i--) {
      const cc = this.carcs[i];
      cc.age += dt;
      if (cc.age > CARC_ROT) {
        cc.dead = true;
        this.carcs.splice(i, 1);
      }
    }
    for (let i = this.fruits.length - 1; i >= 0; i--) {
      const f = this.fruits[i];
      f.age += dt;
      if (f.age > FRUIT_ROT) {
        const k = this.cellIndex(f.x, f.z);
        if (k >= 0 && FERT[this.type[k]] > 0) {
          this.grass[k] = Math.min(1, this.grass[k] + 0.1);
          this.boost[k] = Math.min(2, this.boost[k] + 0.05);
        }
        this.removeFruit(i);
      }
    }
  }

  addCarc(x, z, e) {
    if (this.carcs.length >= 40) this.carcs.shift().dead = true;
    this.carcs.push({ x, z, e, age: 0, dead: false });
  }
  eatCarc(cc) {
    const i = this.carcs.indexOf(cc);
    if (i >= 0) this.carcs.splice(i, 1);
    cc.dead = true;
  }

  spawnFruit(rng, x, z, r, kind, treeIdx) {
    for (let t = 0; t < 8; t++) {
      const a = rng.next() * Math.PI * 2;
      const rr = 0.5 + rng.next() * (r - 0.5);
      const fx = x + Math.cos(a) * rr;
      const fz = z + Math.sin(a) * rr;
      if (!this.walkable(fx, fz)) continue;
      this.fruits.push({ x: fx, z: fz, age: 0, kind, t: treeIdx, dead: false });
      if (treeIdx >= 0 && this.trees[treeIdx]) this.trees[treeIdx].n++;
      return true;
    }
    return false;
  }

  removeFruit(i) {
    const f = this.fruits[i];
    f.dead = true;
    if (f.t >= 0 && this.trees[f.t]) this.trees[f.t].n = Math.max(0, this.trees[f.t].n - 1);
    const last = this.fruits.pop();
    if (i < this.fruits.length) this.fruits[i] = last;
  }

  eatFruit(f) {
    const i = this.fruits.indexOf(f);
    if (i >= 0) this.removeFruit(i);
  }

  grassMean() {
    let s = 0;
    let n = 0;
    for (let k = 0; k < this.grass.length; k++) {
      if (FERT[this.type[k]] > 0.5) {
        s += this.grass[k];
        n++;
      }
    }
    return n ? s / n : 0;
  }

  // ---- 保存
  toJSON() {
    const g = new Uint8Array(GW * GH);
    const b = new Uint8Array(GW * GH);
    for (let k = 0; k < GW * GH; k++) {
      g[k] = Math.round(clamp(this.grass[k], 0, 1) * 255);
      b[k] = Math.round(clamp(this.boost[k], 0, 2.55) * 100);
    }
    return {
      seed: this.seed,
      time: r2(this.time),
      ev: { rain: r1(this.ev.rain), heat: r1(this.ev.heat), cold: r1(this.ev.cold) },
      rainI: r2(this.rainI),
      heatI: r2(this.heatI),
      coldI: r2(this.coldI),
      snow: r2(this.snow),
      tempBase: this.tempBase,
      growth: this.growth,
      naturalRain: this.naturalRain,
      grass: bytesToB64(g),
      boost: bytesToB64(b),
      trees: this.trees.map((t) => [r2(t.x), r2(t.z), r1(t.timer), r2(t.grow), t.kind]),
      fruits: this.fruits.map((f) => [r2(f.x), r2(f.z), r1(f.age), f.kind, f.t]),
      carcs: this.carcs.map((c) => [r2(c.x), r2(c.z), r1(c.e), r1(c.age)]),
    };
  }

  static fromJSON(o) {
    const w = new World(o.seed, { tempBase: o.tempBase, growth: o.growth, naturalRain: o.naturalRain });
    w.time = o.time;
    Object.assign(w.ev, o.ev);
    w.rainI = o.rainI;
    w.heatI = o.heatI;
    w.coldI = o.coldI;
    w.snow = o.snow;
    const g = b64ToBytes(o.grass);
    const b = b64ToBytes(o.boost);
    for (let k = 0; k < GW * GH; k++) {
      w.grass[k] = FERT[w.type[k]] > 0 ? (g[k] || 0) / 255 : 0;
      w.boost[k] = (b[k] || 0) / 100;
    }
    w.trees = o.trees.map((a) => ({ x: a[0], z: a[1], timer: a[2], grow: a[3], kind: a[4], n: 0 }));
    w.fruits = o.fruits.map((a) => ({ x: a[0], z: a[1], age: a[2], kind: a[3], t: a[4], dead: false }));
    for (const f of w.fruits) if (f.t >= 0 && w.trees[f.t]) w.trees[f.t].n++;
    w.carcs = (o.carcs || []).map((a) => ({ x: a[0], z: a[1], e: a[2], age: a[3], dead: false }));
    w.updateClimate();
    w.gVersion++;
    w.treeVersion++;
    return w;
  }
}
