// sim.js — 実験（Lab）と島（Island）。描画に依存しない純粋モジュール（Node でもそのまま動く）
//
//   1世代 = 1シーズン（設定の日数ぶん。1日48ターン）。
//   シーズンのはじめに、各方式の learner が「創始者」を作る。草は毎回同じ状態に戻り、
//   創始者は同じ場所から出発する（＝同じ世界ルール・同じ初期条件でくらべられる）。
//   シーズン中、生き物は食べて体力を得て、体力が多ければ子を産み（子は親と同じ脳・表・サイコロを持つ）、
//   体力がつきるか寿命で死ぬ。家族（創始者とその子孫）が集めた草の量がその創始者の「適応度」。
//   シーズンが終わると learner が結果を受けとり、次の世代を作る（世代交代）。
import { G, NC, RULES, DAY_TICKS, DX, DY, nightAt, growGrass, makeTerrain } from './world.js';
import { ACT, N_OBS, M, METHODS, N_METHODS } from './defs.js';
import { RNG, hash32, mean, r3, f32ToB64, b64ToF32 } from './util.js';
import { makeLearner, actorFromSnap, skillScores, SKILLS, diceCum } from './methods.js';
import { REWARD_SCALE } from './qlearn.js';
import { N_HID, N_OUT } from './nn.js';

export const MODE = { SEPARATE: 'separate', ARENA: 'arena' };
export const MODE_JA = { separate: '別々の島でくらべる', arena: '同じ島で競争' };
export const CAUSE_JA = { starve: '餓死', old: '寿命', owl: 'フクロウ' };
export const SKILL_GOT = 0.8; // 行動テストでこの割合をこえたら「おぼえた」
const LINEAGE_KEEP = 60; // 系図に残す世代数
const EVENT_KEEP = 160;

export const DEFAULT_CFG = {
  mode: MODE.SEPARATE,
  methods: [M.RULE, M.NN, M.Q, M.DICE],
  seed: 7,
  founders: 16, // 方式ごとの創始者数（競争モードでは全体で founders×2.5 を取り合う）
  days: 3, // 1世代の日数
  arenaMin: 3, // 競争モードで、どの方式にも最低これだけの創始者を残す
  nn: { rate: 0.12, sigma: 0.3, cx: 0.6, elite: 2, tour: 3, init: 1 },
  q: { alpha: 0.03, gamma: 0.9, eps0: 0.3, epsDecay: 0.92, epsMin: 0.02 },
  dice: { sigma: 0.08, elite: 2, tour: 3 },
};

const num = (v, d, lo, hi) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return d;
  return Math.min(hi, Math.max(lo, x));
};
export function normalizeCfg(c = {}) {
  const D = DEFAULT_CFG;
  const methods = Array.isArray(c.methods) ? [...new Set(c.methods.map(Number).filter((m) => m >= 0 && m < N_METHODS))].sort() : D.methods.slice();
  const mode = c.mode === MODE.ARENA && methods.length >= 2 ? MODE.ARENA : MODE.SEPARATE;
  const nn = { ...D.nn, ...(c.nn || {}) };
  const q = { ...D.q, ...(c.q || {}) };
  const dice = { ...D.dice, ...(c.dice || {}) };
  return {
    mode,
    methods: methods.length ? methods : D.methods.slice(),
    seed: (num(c.seed, D.seed, 0, 4294967295) >>> 0) || 1,
    founders: Math.round(num(c.founders, D.founders, 4, 40)),
    days: Math.round(num(c.days, D.days, 1, 6)),
    arenaMin: Math.round(num(c.arenaMin, D.arenaMin, 1, 8)),
    nn: {
      rate: num(nn.rate, D.nn.rate, 0, 1),
      sigma: num(nn.sigma, D.nn.sigma, 0, 2),
      cx: num(nn.cx, D.nn.cx, 0, 1),
      elite: Math.round(num(nn.elite, D.nn.elite, 0, 8)),
      tour: Math.round(num(nn.tour, D.nn.tour, 1, 8)),
      init: num(nn.init, D.nn.init, 0.05, 3),
    },
    q: {
      alpha: num(q.alpha, D.q.alpha, 0, 1),
      gamma: num(q.gamma, D.q.gamma, 0, 0.999),
      eps0: num(q.eps0, D.q.eps0, 0, 1),
      epsDecay: num(q.epsDecay, D.q.epsDecay, 0.5, 1),
      epsMin: num(q.epsMin, D.q.epsMin, 0, 1),
    },
    dice: {
      sigma: num(dice.sigma, D.dice.sigma, 0, 2),
      elite: Math.round(num(dice.elite, D.dice.elite, 0, 8)),
      tour: Math.round(num(dice.tour, D.dice.tour, 1, 8)),
    },
  };
}

// においの届く範囲（前方の三角形）。距離が近いほど重い
function buildCone(R) {
  const res = [];
  for (let d = 0; d < 4; d++) {
    const fx = DX[d];
    const fy = DY[d];
    const sx = DX[(d + 1) % 4];
    const sy = DY[(d + 1) % 4];
    const dx = [];
    const dy = [];
    const w = [];
    let ws = 0;
    for (let dist = 1; dist <= R; dist++) {
      for (let s = -(dist - 1); s <= dist - 1; s++) {
        dx.push(fx * dist + sx * s);
        dy.push(fy * dist + sy * s);
        w.push(1 / dist);
        ws += 1 / dist;
      }
    }
    res.push({ dx: Int8Array.from(dx), dy: Int8Array.from(dy), w: Float32Array.from(w), n: dx.length, ws });
  }
  return res;
}
const CONES = [null, buildCone(1), buildCone(2), buildCone(3), buildCone(4)];

// ======================================================= 島（1シーズン分の世界）
export class Island {
  constructor(lab, idx, methods) {
    this.lab = lab;
    this.terr = lab.terrain;
    this.idx = idx;
    this.methods = methods.slice();
    this.grass = new Float32Array(NC);
    this.cnt = new Uint8Array(NC);
    this.cs = [];
    this.fams = [];
    this.order = [];
    this.born = [];
    this.tick = 0;
    this.rng = new RNG(1);
    this.actors = [];
    this.pop = new Array(N_METHODS).fill(0);
    this.cap = new Array(N_METHODS).fill(0);
    this.stat = null;
    this.fx = null; // 描画するときだけ配列にする（できごとの粒）
    this.anyDead = false;
    this.cid = 1;
    this.snap = null;
  }

  begin(snap, actors) {
    this.snap = snap;
    this.tick = 0;
    this.grass.set(this.terr.grass0);
    this.cs = [];
    this.fams = [];
    this.cid = 1;
    this.anyDead = false;
    this.rng = new RNG(snap.seed);
    this.actors = actors;
    this.pop.fill(0);
    this.cap.fill(0);
    this.stat = [];
    for (let m = 0; m < N_METHODS; m++) this.stat.push({ births: 0, starve: 0, old: 0, owl: 0 });
    for (const m of this.methods) this.cap[m] = Math.max(6, (snap.counts[m] || 0) * RULES.CAP_MULT);
    const starts = snap.starts;
    snap.founders.forEach((f, i) => {
      const k = starts[i % starts.length];
      const fam = {
        slot: f.slot,
        m: f.m,
        gid: f.gid,
        g: f.g,
        sp: f.sp,
        cum: f.m === M.DICE ? diceCum(f.g) : null,
        food: 0,
        births: 0,
        members: 0,
        alive: 0,
        founderLife: 0,
        founderId: 0,
        cause: '',
        elite: !!f.elite,
      };
      this.fams.push(fam);
      const c = this.newCreature(fam, true, 0, 0, k % G, (k / G) | 0, RULES.E_START);
      fam.founderId = c.id;
      this.cs.push(c);
    });
  }

  newCreature(fam, founder, depth, parent, x, y, e) {
    const m = fam.m;
    const c = {
      id: this.cid++,
      m,
      fam,
      founder,
      depth,
      parent,
      x,
      y,
      k: y * G + x,
      px: x,
      py: y,
      dir: this.rng.int(4),
      e,
      age: 0,
      life: Math.round(RULES.LIFE_DAYS * DAY_TICKS * (1 + (this.rng.next() * 2 - 1) * RULES.LIFE_JITTER)),
      alive: true,
      born: this.tick,
      died: -1,
      cause: '',
      lastBirth: this.tick,
      kids: 0,
      eaten: 0,
      bumps: 0,
      act: ACT.EAT,
      rule: -1,
      explore: false,
      obs: new Float32Array(N_OBS),
      hid: m === M.NN ? new Float32Array(N_HID) : null,
      out: m === M.NN ? new Float32Array(N_OUT) : null,
      g: fam.g,
      cum: fam.cum,
      qs: -1,
      qa: 0,
      qr: 0,
    };
    fam.members++;
    fam.alive++;
    this.pop[m]++;
    return c;
  }

  // 9つの感覚を c.obs に書く
  sense(c, night) {
    const o = c.obs;
    const grass = this.grass;
    const walk = this.terr.walk;
    o[0] = c.e / RULES.E_MAX;
    o[1] = grass[c.k];
    const cone = CONES[night ? RULES.VIS_NIGHT : RULES.VIS_DAY];
    for (let d = 0; d < 4; d++) {
      const nx = c.x + DX[d];
      const ny = c.y + DY[d];
      if (nx < 0 || ny < 0 || nx >= G || ny >= G || !walk[ny * G + nx]) {
        o[2 + d] = -1;
        continue;
      }
      const cd = cone[d];
      let s = 0;
      for (let q = 0; q < cd.n; q++) {
        const xx = c.x + cd.dx[q];
        const yy = c.y + cd.dy[q];
        if (xx >= 0 && yy >= 0 && xx < G && yy < G) s += cd.w[q] * grass[yy * G + xx];
      }
      // 重みつき平均の草の量を 0〜1 に広げる（少しの草でも感じとれるように）
      o[2 + d] = 1 - Math.exp(-5 * (s / cd.ws));
    }
    o[6] = night ? 1 : 0;
    let n = -1;
    const cnt = this.cnt;
    const x0 = c.x > 2 ? c.x - 2 : 0;
    const x1 = c.x < G - 3 ? c.x + 2 : G - 1;
    const y0 = c.y > 2 ? c.y - 2 : 0;
    const y1 = c.y < G - 3 ? c.y + 2 : G - 1;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) n += cnt[yy * G + xx];
    o[7] = n <= 0 ? 0 : n >= 6 ? 1 : n / 6;
    o[8] = this.rng.next() * 2 - 1;
  }

  step() {
    const R = RULES;
    const t = this.tick;
    const night = nightAt(t);
    const rng = this.rng;
    const grass = this.grass;
    const walk = this.terr.walk;
    const fx = this.fx;
    growGrass(grass, this.terr, night);
    if (this.anyDead) {
      this.cs = this.cs.filter((c) => c.alive);
      this.anyDead = false;
    }
    const cs = this.cs;
    const cnt = this.cnt;
    cnt.fill(0);
    for (let i = 0; i < cs.length; i++) cnt[cs[i].k]++;
    const order = this.order;
    order.length = cs.length;
    for (let i = 0; i < cs.length; i++) order[i] = i;
    rng.shuffle(order);
    const born = this.born;
    born.length = 0;
    for (let n = 0; n < order.length; n++) {
      const c = cs[order[n]];
      c.px = c.x;
      c.py = c.y;
      this.sense(c, night);
      const actor = this.actors[c.m];
      const a = actor.act(c, c.obs, rng);
      c.act = a;
      const e0 = c.e;
      let cost = R.BASAL;
      if (a === ACT.EAT) {
        const g = grass[c.k];
        const room = (R.E_MAX - c.e) / R.E_PER_GRASS;
        const bmax = night ? R.BITE * R.NIGHT_EAT : R.BITE;
        let bite = g < bmax ? g : bmax;
        if (bite > room) bite = room;
        if (bite > 0) {
          grass[c.k] = g - bite;
          c.e += bite * R.E_PER_GRASS;
          c.eaten += bite;
          c.fam.food += bite;
          if (fx && bite > 0.05) fx.push({ t: 'eat', x: c.x, y: c.y, m: c.m });
        }
      } else if (a === ACT.SLEEP) {
        cost = night ? R.SLEEP_NIGHT : R.SLEEP_DAY;
      } else {
        const d = a - 1;
        c.dir = d;
        cost += R.MOVE + (night ? R.NIGHT_MOVE : 0);
        const nx = c.x + DX[d];
        const ny = c.y + DY[d];
        if (nx >= 0 && ny >= 0 && nx < G && ny < G && walk[ny * G + nx]) {
          cnt[c.k]--;
          c.x = nx;
          c.y = ny;
          c.k = ny * G + nx;
          cnt[c.k]++;
        } else {
          c.bumps++;
          if (fx) fx.push({ t: 'bump', x: c.x, y: c.y, m: c.m, d });
        }
      }
      c.e -= cost;
      c.age++;
      if (actor.reward) actor.reward(c, (c.e - e0) * REWARD_SCALE);
      if (c.e <= 0) this.die(c, 'starve');
      else if (c.age >= c.life) this.die(c, 'old');
      else if (night && a !== ACT.SLEEP && rng.next() < (a === ACT.EAT ? R.OWL_AWAKE : R.OWL_MOVE)) this.die(c, 'owl');
      else if (c.e >= R.REPRO_E && c.age >= R.REPRO_AGE && t - c.lastBirth >= R.REPRO_CD && this.pop[c.m] < this.cap[c.m]) {
        // 子を産む（となりの歩けるマスか、同じマスに）
        let bx = c.x;
        let by = c.y;
        const d0 = rng.int(4);
        for (let q = 0; q < 4; q++) {
          const d = (d0 + q) % 4;
          const nx = c.x + DX[d];
          const ny = c.y + DY[d];
          if (nx >= 0 && ny >= 0 && nx < G && ny < G && walk[ny * G + nx]) {
            bx = nx;
            by = ny;
            break;
          }
        }
        const ch = this.newCreature(c.fam, false, c.depth + 1, c.id, bx, by, R.CHILD_E);
        c.e -= R.CHILD_E + R.BIRTH_COST;
        c.lastBirth = t;
        c.kids++;
        c.fam.births++;
        this.stat[c.m].births++;
        born.push(ch);
        if (fx) fx.push({ t: 'birth', x: bx, y: by, m: c.m });
      }
    }
    for (let i = 0; i < born.length; i++) {
      cs.push(born[i]);
      cnt[born[i].k]++;
    }
    this.tick++;
  }

  die(c, cause) {
    c.alive = false;
    c.died = this.tick;
    c.cause = cause;
    this.cnt[c.k]--;
    this.pop[c.m]--;
    c.fam.alive--;
    if (c.founder) {
      c.fam.founderLife = c.age;
      c.fam.cause = cause;
    }
    const actor = this.actors[c.m];
    if (actor.death) actor.death(c);
    this.stat[c.m][cause]++;
    this.anyDead = true;
    if (this.fx) this.fx.push({ t: 'death', x: c.x, y: c.y, m: c.m, cause });
  }

  // シーズンの終わり: まだ生きている創始者の生存期間を確定
  finish() {
    for (const c of this.cs) if (c.alive && c.founder) c.fam.founderLife = c.age;
  }

  living() {
    return this.cs.filter((c) => c.alive);
  }
  foodBy(m) {
    let s = 0;
    for (const f of this.fams) if (f.m === m) s += f.food;
    return s;
  }
}

// ======================================================= 実験全体
function newHist() {
  return { fit: [], best: [], life: [], births: [], endPop: [], starve: [], old: [], owl: [], founders: [], share: [], sk: SKILLS.map(() => []), eps: [], nsp: [], known: [] };
}

export class Lab {
  constructor(cfg = {}, opts = {}) {
    this.cfg = normalizeCfg(cfg);
    this.terrain = makeTerrain(this.cfg.seed);
    this.seasonTicks = this.cfg.days * DAY_TICKS;
    this.gen = 0;
    this.gidN = 1;
    this.fxOn = !!opts.fx;
    const ms = this.cfg.methods;
    this.islands = this.cfg.mode === MODE.ARENA ? [new Island(this, 0, ms)] : ms.map((m, i) => new Island(this, i, [m]));
    this.learners = this.islands.map((isl) => {
      const o = [];
      for (const m of isl.methods) o[m] = makeLearner(m, this.cfg);
      return o;
    });
    this.hist = [];
    for (let m = 0; m < N_METHODS; m++) this.hist.push(newHist());
    this.arenaTotal = Math.round(this.cfg.founders * 2.5);
    this.alloc = new Array(N_METHODS).fill(0);
    if (this.cfg.mode === MODE.ARENA) this.resetAlloc();
    this.events = [];
    this.best = new Array(N_METHODS).fill(null);
    this.latest = new Array(N_METHODS).fill(null);
    this.gotSkill = [];
    for (let m = 0; m < N_METHODS; m++) this.gotSkill.push(SKILLS.map(() => -1));
    this.lineage = [];
    for (let m = 0; m < N_METHODS; m++) this.lineage.push([]);
    this.snaps = [];
    this.genEvents = [];
    this.firstSnap = []; // 世代0の遺伝子（腕前テストで「学習前」とくらべるため）
    if (!opts.noStart) this.startSeason();
  }

  newGid() {
    return this.gidN++;
  }
  islandOf(m) {
    for (const isl of this.islands) if (isl.methods.includes(m)) return isl;
    return null;
  }
  learnerOf(m) {
    const isl = this.islandOf(m);
    return isl ? this.learners[isl.idx][m] : null;
  }
  get tick() {
    return this.islands[0].tick;
  }

  resetAlloc() {
    const ms = this.cfg.methods;
    const base = Math.floor(this.arenaTotal / ms.length);
    let rem = this.arenaTotal - base * ms.length;
    for (const m of ms) {
      this.alloc[m] = base + (rem > 0 ? 1 : 0);
      rem--;
    }
  }

  foundersFor(m) {
    return this.cfg.mode === MODE.ARENA ? this.alloc[m] : this.cfg.founders;
  }

  // シーズンごとの出発地点（全部の島・全部の方式で同じ並び）
  startCells(gen) {
    const rng = new RNG(hash32(this.cfg.seed, gen, 0x57a7));
    const land = Array.from(this.terrain.land);
    rng.shuffle(land);
    const need = this.cfg.mode === MODE.ARENA ? this.arenaTotal + 4 : this.cfg.founders;
    return Int32Array.from(land.slice(0, Math.min(land.length, need)));
  }

  startSeason() {
    const gen = this.gen;
    const starts = this.startCells(gen);
    for (let ii = 0; ii < this.islands.length; ii++) {
      const isl = this.islands[ii];
      const founders = [];
      const states = {};
      const counts = {};
      for (const m of isl.methods) {
        const L = this.learners[ii][m];
        const n = this.foundersFor(m);
        counts[m] = n;
        const fs = L.makeFounders(n, gen, new RNG(hash32(this.cfg.seed, gen, m, 0xf0)), this);
        fs.forEach((f, s) => founders.push({ m, slot: s, gid: f.gid, g: f.g, sp: f.sp, parents: f.parents, elite: f.elite }));
        states[m] = L.snapState();
        if (gen === 0 && (m === M.NN || m === M.DICE)) this.firstSnap[m] = fs.map((f) => f.g);
      }
      founders.sort((a, b) => a.slot - b.slot || a.m - b.m);
      // 島の乱数は「その島にいる方式」で決める（ほかにどの方式を一緒に走らせても、同じ方式なら同じ結果になる）
      const key = isl.methods.reduce((h, m) => hash32(h, m + 1), 0x15a);
      const snap = { gen, seed: hash32(this.cfg.seed, gen, key), island: ii, methods: isl.methods.slice(), founders, states, counts, starts };
      this.snaps[ii] = snap;
      this.beginIsland(isl, snap);
    }
  }

  beginIsland(isl, snap) {
    const actors = [];
    for (const m of isl.methods) actors[m] = this.learners[isl.idx][m].liveActor(snap.states[m]);
    isl.fx = this.fxOn ? isl.fx || [] : null;
    isl.begin(snap, actors);
  }

  setFx(on) {
    this.fxOn = on;
    for (const isl of this.islands) isl.fx = on ? isl.fx || [] : null;
  }

  // 1ターン進める。世代が変わったら true
  step() {
    for (const isl of this.islands) isl.step();
    if (this.islands[0].tick >= this.seasonTicks) {
      this.endSeason();
      return true;
    }
    return false;
  }

  // ヘッドレスで世代をまとめて進める（テスト・最大速モード用）
  runGenerations(n) {
    const target = this.gen + n;
    while (this.gen < target) this.step();
  }

  endSeason() {
    const gen = this.gen;
    const events = [];
    const foodBy = new Array(N_METHODS).fill(0);
    let totalFood = 0;
    for (let ii = 0; ii < this.islands.length; ii++) {
      const isl = this.islands[ii];
      isl.finish();
      for (const m of isl.methods) {
        const fams = isl.fams.filter((f) => f.m === m);
        const results = fams.map((f) => ({ g: f.g, gid: f.gid, fit: f.food, sp: f.sp, life: f.founderLife, slot: f.slot }));
        const L = this.learners[ii][m];
        const sp = L.endSeason(results, gen);
        const fits = results.map((r) => r.fit);
        let bi = 0;
        for (let i = 1; i < fits.length; i++) if (fits[i] > fits[bi]) bi = i;
        const fsum = fits.reduce((a, b) => a + b, 0);
        foodBy[m] += fsum;
        totalFood += fsum;
        const H = this.hist[m];
        const sk = skillScores(L);
        const ex = L.extraStats();
        H.fit.push(r3(mean(fits)));
        H.best.push(r3(fits[bi] ?? 0));
        H.life.push(r3(mean(results.map((r) => r.life)) / DAY_TICKS));
        H.births.push(isl.stat[m].births);
        H.endPop.push(isl.pop[m]);
        H.starve.push(isl.stat[m].starve);
        H.old.push(isl.stat[m].old);
        H.owl.push(isl.stat[m].owl);
        H.founders.push(fams.length);
        sk.forEach((v, k) => H.sk[k].push(r3(v)));
        H.eps.push(ex.eps !== undefined ? r3(ex.eps) : 0);
        H.nsp.push(ex.nsp ?? 0);
        H.known.push(ex.known ?? 0);
        // ベスト家族（リプレイ用に、その世代のはじめの状態を指しておく）
        const bf = fams[bi];
        if (bf) {
          const entry = { m, gen, fit: bf.food, slot: bf.slot, island: ii, snap: this.snaps[ii], kids: bf.births, members: bf.members, life: bf.founderLife };
          this.latest[m] = entry;
          const prev = this.best[m];
          if (!prev || bf.food > prev.fit) {
            this.best[m] = entry;
            if (prev && gen >= 3 && bf.food > prev.fit * 1.05) events.push({ gen, m, type: 'record', text: `${METHODS[m].ja}が新記録！ 1家族で草${bf.food.toFixed(1)}` });
          }
        }
        // 行動の獲得
        sk.forEach((v, k) => {
          if (this.gotSkill[m][k] < 0 && v >= SKILL_GOT) {
            this.gotSkill[m][k] = gen;
            events.push({ gen, m, type: 'skill', k, text: `${METHODS[m].ja}が「${SKILLS[k].ja}」をおぼえた` });
          }
        });
        // 種の分岐・絶滅
        if (sp.born.length) events.push({ gen, m, type: 'species', text: `${METHODS[m].ja}に新しい種「${sp.born.map((s) => s.name).slice(0, 3).join('・')}」${sp.born.length > 3 ? `ほか${sp.born.length - 3}種` : ''}が生まれた` });
        if (sp.extinct.length && gen > 0) events.push({ gen, m, type: 'extinct', text: `${METHODS[m].ja}の「${sp.extinct.map((s) => s.name).slice(0, 3).join('・')}」${sp.extinct.length > 3 ? `ほか${sp.extinct.length - 3}種` : ''}が絶えた` });
        // 系図（進化する2方式だけ。遺伝子を持たない方式は世代をこえた親子がない）
        if (m === M.NN || m === M.DICE) {
          const lin = this.lineage[m];
          lin.push({ gen, ids: L.current.map((f) => f.gid), parents: L.current.map((f) => f.parents), sp: L.current.map((f) => f.sp), elite: L.current.map((f) => (f.elite ? 1 : 0)), fit: L.current.map((f) => r3(results.find((r) => r.gid === f.gid)?.fit ?? 0)) });
          if (lin.length > LINEAGE_KEEP) lin.shift();
        }
      }
    }
    // 競争モード: 集めた草の割合で、次の世代の創始者の数（なわばり）が決まる
    if (this.cfg.mode === MODE.ARENA) {
      const ms = this.cfg.methods;
      for (const m of ms) this.hist[m].share.push(r3(totalFood > 0 ? foodBy[m] / totalFood : 1 / ms.length));
      const before = ms.map((m) => this.alloc[m]);
      this.realloc(foodBy, totalFood);
      ms.forEach((m, i) => {
        if (this.alloc[m] > this.arenaTotal / 2 && before[i] <= this.arenaTotal / 2) events.push({ gen, m, type: 'lead', text: `${METHODS[m].ja}が島の半分以上をしめた` });
      });
    }
    for (const e of events) this.events.push(e);
    if (this.events.length > EVENT_KEEP) this.events.splice(0, this.events.length - EVENT_KEEP);
    this.genEvents = events;
    this.gen++;
    this.startSeason();
  }

  realloc(foodBy, totalFood) {
    const ms = this.cfg.methods;
    const total = this.arenaTotal;
    const min = Math.min(this.cfg.arenaMin, Math.floor(total / ms.length));
    const target = ms.map((m) => 0.5 * (this.alloc[m] / total) + 0.5 * (totalFood > 0 ? foodBy[m] / totalFood : 1 / ms.length));
    const free = total - min * ms.length;
    const raw = target.map((t) => t * free);
    const base = raw.map((v) => Math.floor(v));
    let rem = free - base.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => [v - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [, i] of order) {
      if (rem <= 0) break;
      base[i]++;
      rem--;
    }
    ms.forEach((m, i) => (this.alloc[m] = min + base[i]));
  }

  // ---- いまのシーズンの様子（画面の上の表示用）
  liveStats() {
    const out = [];
    for (const m of this.cfg.methods) {
      const isl = this.islandOf(m);
      let alive = 0;
      for (const c of isl.cs) if (c.alive && c.m === m) alive++;
      const fams = isl.fams.filter((f) => f.m === m);
      out.push({ m, alive, founders: fams.length, food: isl.foodBy(m), perFam: fams.length ? isl.foodBy(m) / fams.length : 0 });
    }
    return out;
  }

  // ================= 保存と読みこみ（世代のはじめの状態を保存し、読みこむとその世代のはじめから再開する）
  toJSON() {
    const encSnap = (s) => encodeSnap(s);
    const snapIds = new Map();
    const snapList = [];
    const ref = (s) => {
      if (!s) return -1;
      if (!snapIds.has(s)) {
        snapIds.set(s, snapList.length);
        snapList.push(encSnap(s));
      }
      return snapIds.get(s);
    };
    const entry = (e) => (e ? { m: e.m, gen: e.gen, fit: e.fit, slot: e.slot, island: e.island, kids: e.kids, members: e.members, life: e.life, snap: ref(e.snap) } : null);
    return {
      v: 1,
      cfg: this.cfg,
      gen: this.gen,
      gidN: this.gidN,
      alloc: this.alloc,
      hist: this.hist,
      events: this.events,
      gotSkill: this.gotSkill,
      lineage: this.lineage,
      learners: this.learners.map((o) => o.map((L) => (L ? L.toJSON() : null))),
      cur: this.snaps.map((s) => ref(s)),
      best: this.best.map(entry),
      latest: this.latest.map(entry),
      snaps: snapList,
    };
  }

  static fromJSON(o, opts = {}) {
    if (!o || o.v !== 1) throw new Error('保存データの形式がちがいます');
    const lab = new Lab(o.cfg, { ...opts, noStart: true });
    lab.gen = o.gen;
    lab.gidN = o.gidN;
    lab.alloc = o.alloc;
    for (let m = 0; m < N_METHODS; m++) lab.hist[m] = { ...newHist(), ...(o.hist[m] || {}) };
    lab.events = o.events || [];
    lab.gotSkill = o.gotSkill || lab.gotSkill;
    lab.lineage = o.lineage || lab.lineage;
    const snaps = o.snaps.map((s) => decodeSnap(s));
    o.learners.forEach((arr, ii) => arr.forEach((j, m) => j && lab.learners[ii][m] && lab.learners[ii][m].loadJSON(j)));
    const entry = (e) => (e ? { ...e, snap: snaps[e.snap] } : null);
    lab.best = o.best.map(entry);
    lab.latest = o.latest.map(entry);
    for (let ii = 0; ii < lab.islands.length; ii++) {
      const snap = snaps[o.cur[ii]];
      lab.snaps[ii] = snap;
      // 学習中の状態を、世代のはじめにそろえる
      for (const m of snap.methods) {
        const L = lab.learners[ii][m];
        if (m === M.Q) {
          L.q.set(snap.states[m].q);
          L.eps = snap.states[m].eps;
        }
        if (L.current !== undefined) L.current = snap.founders.filter((f) => f.m === m).map((f) => ({ gid: f.gid, g: f.g, sp: f.sp, parents: f.parents || [], elite: !!f.elite }));
      }
      lab.beginIsland(lab.islands[ii], snap);
    }
    return lab;
  }
}

function encodeSnap(s) {
  const states = {};
  for (const k of Object.keys(s.states)) {
    const st = s.states[k];
    states[k] = st ? { ...st, q: st.q ? f32ToB64(st.q) : undefined } : null;
  }
  return {
    gen: s.gen,
    seed: s.seed,
    island: s.island,
    methods: s.methods,
    counts: s.counts,
    starts: Array.from(s.starts),
    states,
    founders: s.founders.map((f) => ({ m: f.m, slot: f.slot, gid: f.gid, sp: f.sp, elite: f.elite ? 1 : 0, parents: f.parents || [], g: f.g ? f32ToB64(f.g) : null })),
  };
}
function decodeSnap(s) {
  const states = {};
  for (const k of Object.keys(s.states)) {
    const st = s.states[k];
    states[k] = st ? { ...st, q: st.q ? b64ToF32(st.q) : undefined } : null;
  }
  return {
    gen: s.gen,
    seed: s.seed,
    island: s.island,
    methods: s.methods,
    counts: s.counts,
    starts: Int32Array.from(s.starts),
    states,
    founders: s.founders.map((f) => ({ m: f.m, slot: f.slot, gid: f.gid, sp: f.sp, elite: !!f.elite, parents: f.parents || [], g: f.g ? b64ToF32(f.g) : null })),
  };
}

export { actorFromSnap };
