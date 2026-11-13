// sim.js — 生態系シミュレーション本体（描画とは独立。Node でも動く）
//   植物 → 草食動物 → 肉食動物 の食物連鎖。全個体が自分の脳（brain.js）で行動を選び、
//   形質と脳の重みを子へ受け継ぐ。祖先から形質が離れた系統は新しい種になる。
import { RNG, clamp, wrapAngle, r1, r2, r3 } from './util.js';
import { N_IN, N_HID, N_OUT, IN, ACT, forward, priorBrain, mutateBrain, crossoverBrain, encodeBrain, decodeBrain } from './brain.js';
import { TR, mutateTraits, crossTraits, traitDist, makeSpeciesName, TRAIT_N } from './genetics.js';
import { World, GW, GH, T, MOVE, FERT, DAY_LEN, EVENT_LEN } from './world.js';

export const HERB = 0;
export const CARN = 1;
export const CLS_JA = ['草食', '肉食'];
export const MAX_ANIMALS = 120;
export const CLASS_CAP = [96, 30];
export const SPEC_T = 0.3; // 祖先（種の始祖）からこれ以上離れたら新種

// 種類ごとの体のつくり
export const PARAM = [
  { baseSpeed: 1.7, basal: 0.75, move: 0.38, vis: 0.045, maxE: 90, maturity: 55, cooldown: 100, life: 340, childFrac: 0.45, reproMin: 0.7, staDrain: 0.08, staRec: 0.1 },
  { baseSpeed: 1.8, basal: 0.5, move: 0.3, vis: 0.04, maxE: 125, maturity: 80, cooldown: 70, life: 500, childFrac: 0.45, reproMin: 0.75, staDrain: 0.22, staRec: 0.08 },
];
const GRASS_E = 32;
const FRUIT_E = 38;
const MEAT_E = 70;
const DIGEST = 25; // 獲物を食べたあと次に狩れるまでの秒数（獲物の大きさ1あたり）
const TERRITORY = 8; // 肉食はこの距離に仲間が3匹以上いると子を作らない（なわばり）
const HUNGRY = 0.65; // 肉食は体力がこれより下がったときだけ狩りをする
const PREY_PER_PRED = 4.5; // 肉食が子育てできるのは、草食がこの数×肉食の数より多いとき
const BITE = 0.35;

export const STARTERS = [
  { key: 'rabbit', name: 'ノハラウサギ', cls: HERB, hue: 0.11, sat: 0.3, light: 0.72, traits: [1.0, 0.9, 5.0, 0.15, 0.4] },
  { key: 'deer', name: 'モリジカ', cls: HERB, hue: 0.07, sat: 0.5, light: 0.44, traits: [0.9, 1.35, 5.5, 0.8, 0.45] },
  { key: 'fox', name: 'アカギツネ', cls: CARN, hue: 0.03, sat: 0.78, light: 0.52, traits: [1.15, 1.1, 6.5, 0.8, 0.4] },
];

export const TOOL_COST = { grass: 6, fruit: 8, tree: 18, herb: 12, carn: 20, rain: 25, heat: 30, cold: 30 };
export const DEATH_JA = { age: '寿命', starve: '餓死', eaten: '捕食', cold: '凍え', heat: '暑さ' };

const BK = 4;
const BW = Math.ceil(GW / BK);
const BH = Math.ceil(GH / BK);

export const grassEff = (c) => (c.cls === HERB ? 1 - 0.75 * c.t[TR.DIET] : 0);
export const fruitEff = (c) => (c.cls === HERB ? 0.15 + 0.85 * c.t[TR.DIET] : 0.6 * Math.pow(1 - c.t[TR.DIET], 1.5));
export const meatEff = (c) => (c.cls === CARN ? 0.35 + 0.65 * c.t[TR.DIET] : 0);
export const maxEnergy = (c) => PARAM[c.cls].maxE * c.t[TR.SIZE];
export const comfortTemp = (c) => 27 - 22 * c.t[TR.COLD];
// 狩りの成功率: 体の大きさの差がものを言う（小さな獲物ほどつかまりやすい）
export const huntChance = (pred, prey) => clamp(0.5 + 0.6 * (pred.t[TR.SIZE] - prey.t[TR.SIZE]), 0.05, 0.95);
// 大きな体ほど大人になるのも、次の子を作るのも遅い
export const sizeSlow = (c) => 0.6 + 0.4 * c.t[TR.SIZE];
export const maturityOf = (c) => PARAM[c.cls].maturity * sizeSlow(c);
// 体が大きいほど暑さ寒さに強い（ベルクマンの法則）
export const comfortBand = (c) => 5 + 2.5 * (c.t[TR.SIZE] - 1);
export const tempStress = (c, temp) => clamp((Math.abs(temp - comfortTemp(c)) - comfortBand(c)) / 14, 0, 1.5);

function newCreature(id, cls, sp, traits, brain, hue, x, z, gen, energy, age, rng) {
  const p = PARAM[cls];
  return {
    id,
    cls,
    sp,
    t: traits,
    w: brain,
    hue,
    x,
    z,
    h: rng.next() * Math.PI * 2,
    e: energy,
    age,
    gen,
    life: p.life * (0.85 + 0.3 * rng.next()) * (0.8 + 0.2 * traits[TR.SIZE]),
    lastRep: -999,
    act: ACT.WANDER,
    actT: 0,
    brainT: rng.next() * 0.25,
    turn: 0,
    food: null,
    thr: null,
    mate: null,
    atkCD: 0,
    panic: 0,
    sta: 1,
    tired: false,
    digest: 0,
    terr: 0,
    crowd: 0,
    v: 0,
    alive: true,
    kids: 0,
    kills: 0,
    stress: 0,
    inp: new Float32Array(N_IN),
    hid: new Float32Array(N_HID),
    out: new Float32Array(N_OUT),
  };
}

export class Sim {
  constructor() {
    this.creatures = [];
    this.pending = [];
    this.species = [];
    this.hist = [];
    this.log = [];
    this.events = [];
    this.deaths = {};
    this.births = 0;
    this.nCls = [0, 0];
    this.nextId = 1;
    this.sampleEvery = 3;
    this.sampleAcc = 0;
    this.deadCount = 0;
    this.grid = Array.from({ length: BW * BH }, () => []);
    this.clsGone = [false, false];
    this.records = { maxGen: [0, 0], speciesTotal: 0, atk: 0, hit: 0 };
  }

  static create(opt = {}) {
    const s = new Sim();
    s.seed = (opt.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
    s.rng = new RNG(s.seed ^ 0x5bd1e995);
    s.world = new World(s.seed, opt.world || {});
    s.world.populate(s.rng, opt.world || {});
    s.mode = opt.mode || 'sandbox';
    s.mut = opt.mut ?? 1;
    s.god = { pow: opt.godStart ?? 60, max: 100, regen: opt.godRegen ?? 1.2, inf: s.mode === 'sandbox' };
    s.costs = Object.assign({}, TOOL_COST, opt.costs || {});
    s.mission = opt.mission ? { id: opt.mission, status: 'play', start: s.world.time, hold: 0, best: 0, progress: 0, text: '' } : null;
    const counts = Object.assign({ rabbit: 28, deer: 12, fox: 5 }, opt.counts || {});
    for (const st of STARTERS) {
      const sp = s.newSpecies(st.cls, st.traits, -1, st.name, st.hue, st.sat, st.light);
      sp.starter = st.key;
      const n = counts[st.key] || 0;
      for (let k = 0; k < n; k++) s.spawnStarter(sp, null, null, true);
      if (n === 0) sp.ext = s.world.time;
    }
    s.addLog('🏝️ はこにわ島の観察をはじめた');
    s.sample();
    return s;
  }

  get nTotal() {
    return this.nCls[0] + this.nCls[1];
  }

  addLog(text) {
    this.log.push({ t: r1(this.world.time), text });
    if (this.log.length > 60) this.log.shift();
    this.events.push({ type: 'log', text });
    this.trimEvents();
  }
  trimEvents() {
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  newSpecies(cls, traits, parent, name, hue, sat, light) {
    const id = this.species.length;
    const sp = {
      id,
      cls,
      name: name || makeSpeciesName(cls, traits, this.species.map((s) => s.name), this.rng),
      hue,
      sat,
      light,
      founder: traits.map(r3),
      parent,
      born: r1(this.world.time),
      ext: null,
      n: 0,
      maxN: 0,
      total: 0,
      maxGen: 0,
      starter: null,
    };
    this.species.push(sp);
    this.records.speciesTotal = this.species.length;
    return sp;
  }

  addCreature(c, pendingList) {
    (pendingList || this.creatures).push(c);
    this.nCls[c.cls]++;
    const sp = this.species[c.sp];
    sp.n++;
    sp.total++;
    if (sp.n > sp.maxN) sp.maxN = sp.n;
    if (c.gen > sp.maxGen) sp.maxGen = c.gen;
    if (c.gen > this.records.maxGen[c.cls]) this.records.maxGen[c.cls] = c.gen;
    if (sp.ext !== null) sp.ext = null;
    this.clsGone[c.cls] = false;
  }

  randomLand(prefer) {
    const w = this.world;
    for (let t = 0; t < 400; t++) {
      const x = 1 + this.rng.next() * (GW - 2);
      const z = 1 + this.rng.next() * (GH - 2);
      const k = w.cellIndex(x, z);
      if (k < 0 || !w.walkIdx(k)) continue;
      if (prefer && t < 300 && !prefer.includes(w.type[k])) continue;
      return [x, z];
    }
    return [GW / 2, GH / 2];
  }

  findSpot(x, z, r) {
    const w = this.world;
    if (w.walkable(x, z)) {
      for (let t = 0; t < 10; t++) {
        const a = this.rng.next() * Math.PI * 2;
        const d = this.rng.next() * r;
        const nx = x + Math.cos(a) * d;
        const nz = z + Math.sin(a) * d;
        if (w.walkable(nx, nz)) return [nx, nz];
      }
      return [x, z];
    }
    return null;
  }

  spawnStarter(sp, x, z, initial) {
    let pos;
    if (x == null) {
      pos = this.randomLand(sp.starter === 'deer' ? [T.FOREST] : sp.starter === 'rabbit' ? [T.GRASS, T.SAND] : [T.GRASS, T.FOREST, T.SAND, T.ROCK]);
    } else {
      pos = this.findSpot(x, z, 1.4);
      if (!pos) return null;
    }
    const traits = mutateTraits(sp.founder, this.rng, 0.6);
    const brain = priorBrain(this.rng, 0.15);
    const p = PARAM[sp.cls];
    const age = initial ? this.rng.next() * p.life * 0.55 : p.maturity;
    const c = newCreature(this.nextId++, sp.cls, sp.id, traits, brain, sp.hue, pos[0], pos[1], 0, 0, age, this.rng);
    c.e = maxEnergy(c) * (initial ? this.rng.range(0.55, 0.85) : 0.75);
    if (initial) c.lastRep = c.age - this.rng.next() * p.cooldown;
    this.addCreature(c);
    return c;
  }

  // ---- 空間の区画（近くの個体をすばやく探す）
  buildGrid() {
    for (const b of this.grid) b.length = 0;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const bx = clamp(Math.floor(c.x / BK), 0, BW - 1);
      const bz = clamp(Math.floor(c.z / BK), 0, BH - 1);
      this.grid[bz * BW + bx].push(c);
    }
  }
  query(x, z, r, fn) {
    const bx0 = Math.max(0, Math.floor((x - r) / BK));
    const bx1 = Math.min(BW - 1, Math.floor((x + r) / BK));
    const bz0 = Math.max(0, Math.floor((z - r) / BK));
    const bz1 = Math.min(BH - 1, Math.floor((z + r) / BK));
    const r2v = r * r;
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const b = this.grid[bz * BW + bx];
        for (let k = 0; k < b.length; k++) {
          const o = b[k];
          if (!o.alive) continue;
          const dx = o.x - x;
          const dz = o.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2v) fn(o, d2);
        }
      }
    }
  }

  // ---- 時間を進める（大きな dt は細かく刻む）
  update(dtGame) {
    let rem = dtGame;
    while (rem > 1e-6) {
      const dt = Math.min(0.05, rem);
      this.step(dt);
      rem -= dt;
    }
  }

  step(dt) {
    const w = this.world;
    w.step(dt, this.rng);
    if (!this.god.inf) this.god.pow = Math.min(this.god.max, this.god.pow + this.god.regen * dt);
    this.buildGrid();
    const arr = this.creatures;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (c.alive) this.tick(c, dt);
    }
    if (this.pending.length) {
      for (const c of this.pending) this.creatures.push(c);
      this.pending.length = 0;
    }
    if (this.deadCount) {
      this.creatures = this.creatures.filter((c) => c.alive);
      this.deadCount = 0;
    }
    for (let k = 0; k < 2; k++) {
      if (this.nCls[k] === 0 && !this.clsGone[k]) {
        this.clsGone[k] = true;
        this.addLog(k === HERB ? '⚠️ 草食動物が島から一匹もいなくなった' : '⚠️ 肉食動物が島から一匹もいなくなった');
      }
    }
    this.sampleAcc += dt;
    if (this.sampleAcc >= this.sampleEvery) {
      this.sampleAcc = 0;
      this.sample();
    }
  }

  canRepro(c) {
    const p = PARAM[c.cls];
    const slow = sizeSlow(c);
    return (
      c.age >= p.maturity * slow &&
      c.stress < 0.35 &&
      c.e >= p.reproMin * maxEnergy(c) &&
      c.age - c.lastRep >= p.cooldown * slow &&
      this.nCls[c.cls] < CLASS_CAP[c.cls] &&
      this.nTotal < MAX_ANIMALS &&
      (c.cls === HERB ? c.crowd < 7 : c.terr < 3 && this.nCls[CARN] < Math.max(2, this.nCls[HERB] / PREY_PER_PRED))
    );
  }

  tick(c, dt) {
    const p = PARAM[c.cls];
    const w = this.world;
    c.age += dt;
    c.actT += dt;
    if (c.atkCD > 0) c.atkCD -= dt;
    if (c.panic > 0) c.panic -= dt;
    if (c.digest > 0) c.digest -= dt;
    if (c.age > c.life) {
      this.kill(c, 'age');
      return;
    }
    c.brainT -= dt;
    if (c.brainT <= 0) {
      c.brainT = 0.22 + this.rng.next() * 0.06;
      this.think(c);
    }
    this.act(c, dt);
    if (!c.alive) return;
    const sz = c.t[TR.SIZE];
    const stress = tempStress(c, w.temp);
    c.stress = stress;
    const base = p.basal * Math.pow(sz, 0.75) * (c.act === ACT.REST ? 0.55 : 1);
    const cost = base * (1 + 1.4 * stress) + p.move * c.v * c.v * sz + p.vis * c.t[TR.VISION];
    c.e -= cost * dt;
    if (c.e <= 0) {
      const tempPart = (base * 1.4 * stress) / cost;
      this.kill(c, tempPart > 0.35 ? (w.temp < comfortTemp(c) ? 'cold' : 'heat') : 'starve');
    }
  }

  // ---- 感じて考える（脳の入力をつくり、行動を選ぶ）
  think(c) {
    const w = this.world;
    const rng = this.rng;
    const dark = 1 - w.daylight;
    const vis = c.t[TR.VISION] * (c.cls === HERB ? 1 - 0.3 * dark : 1);
    let thr = null;
    let thrD = 1e9;
    let mate = null;
    let mateD = 1e9;
    let crowd = 0;
    let prey = null;
    let preyS = 0;
    let preyD = 0;
    let preyN = 0;
    let terr = 0;
    const mat = PARAM[c.cls].maturity;
    const me = meatEff(c);
    // (仲間の「大人」判定は種の標準の成熟年齢で見る)
    const hungry = c.cls === CARN && c.digest <= 0 && c.e < HUNGRY * maxEnergy(c);
    this.query(c.x, c.z, c.cls === HERB ? vis * 1.5 : Math.max(vis, TERRITORY), (o, d2) => {
      if (o === c) return;
      const d = Math.sqrt(d2);
      if (o.cls === c.cls) {
        if (d < 3) crowd++;
        if (d < TERRITORY) terr++;
        if (d > vis) return;
        if (o.sp === c.sp && o.age >= mat && d < mateD) {
          mateD = d;
          mate = o;
        }
        if (c.cls === CARN && o.sp !== c.sp && o.t[TR.SIZE] > c.t[TR.SIZE] * 1.2 && d < thrD) {
          thrD = d;
          thr = o;
        }
      } else if (c.cls === HERB) {
        // 食べたばかりで満腹の肉食は、すぐそばに来ない限り気にしない
        if ((o.digest > 0 || o.act === ACT.REST) && d > 1.5) return;
        if (d < thrD) {
          thrD = d;
          thr = o;
        }
      } else if (hungry) {
        let det = vis;
        if (o.act === ACT.REST) det *= 0.6;
        const k = w.cellIndex(o.x, o.z);
        if (k >= 0 && w.type[k] === T.FOREST) det *= 0.7;
        if (d > det) return;
        preyN++;
        const ps = huntChance(c, o);
        const val = (MEAT_E * o.t[TR.SIZE] * me * ps * (o.t[TR.SPEED] < c.t[TR.SPEED] ? 1 : 0.6)) / (1 + 0.3 * d);
        if (val > preyS) {
          preyS = val;
          prey = o;
          preyD = d;
        }
      }
    });
    c.terr = terr;
    c.crowd = crowd;
    // 群れでいると見張りの目が増えて、敵に早く気づける
    if (c.cls === HERB && thr && thrD > vis * (1 + 0.12 * Math.min(crowd, 4))) {
      thr = null;
      thrD = 1e9;
    }
    if (c.panic > 0 && c.thr && c.thr.alive) {
      thr = c.thr;
      const dx = thr.x - c.x;
      const dz = thr.z - c.z;
      thrD = Math.min(Math.sqrt(dx * dx + dz * dz), vis * 0.5);
    }

    // 食べ物さがし
    let food = null;
    let foodS = 0;
    let foodD = 0;
    const here = w.cellIndex(c.x, c.z);
    if (c.cls === HERB) {
      const ge = grassEff(c) * (1 - 0.35 * w.snow);
      if (here >= 0 && w.grass[here] > 0.14) {
        foodS = w.grass[here] * GRASS_E * ge;
        food = { k: 'g', x: c.x, z: c.z, ci: here };
      }
      if (c.food && c.food.k === 'g' && c.food.ci !== here) {
        const g = w.grass[c.food.ci];
        const dx = c.food.x - c.x;
        const dz = c.food.z - c.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const s = (g * GRASS_E * ge) / (1 + 0.22 * d);
        if (g > 0.16 && d < vis && s > foodS) {
          foodS = s;
          food = c.food;
          foodD = d;
        }
      }
      for (let k = 0; k < 10; k++) {
        const a = rng.next() * Math.PI * 2;
        const r = 0.8 + rng.next() * Math.max(0, vis - 0.8);
        const ci = w.cellIndex(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r);
        if (ci < 0 || !w.walkIdx(ci)) continue;
        const g = w.grass[ci];
        if (g < 0.16) continue;
        const s = (g * GRASS_E * ge) / (1 + 0.22 * r);
        if (s > foodS) {
          foodS = s;
          food = { k: 'g', x: (ci % GW) + 0.5, z: ((ci / GW) | 0) + 0.5, ci };
          foodD = r;
        }
      }
    } else if (hungry) {
      if (prey) {
        food = { k: 'p', c: prey };
        foodS = preyS;
        foodD = preyD;
      }
      // 亡きがらも食べる（狩りより楽）
      const v2 = vis * vis;
      for (const cc of w.carcs) {
        const dx = cc.x - c.x;
        const dz = cc.z - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > v2) continue;
        const d = Math.sqrt(d2);
        const s = (cc.e * me) / (1 + 0.22 * d);
        if (s > foodS) {
          foodS = s;
          food = { k: 'c', cc, x: cc.x, z: cc.z };
          foodD = d;
        }
      }
    }
    const fe = fruitEff(c);
    if (fe > 0.12) {
      const v2 = vis * vis;
      for (const f of w.fruits) {
        const dx = f.x - c.x;
        const dz = f.z - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > v2) continue;
        const d = Math.sqrt(d2);
        const s = (FRUIT_E * fe) / (1 + 0.22 * d);
        if (s > foodS) {
          foodS = s;
          food = { k: 'f', f, x: f.x, z: f.z };
          foodD = d;
        }
      }
    }

    const canRep = this.canRepro(c);
    const stress = tempStress(c, w.temp);
    const inp = c.inp;
    inp[IN.ENERGY] = c.e / maxEnergy(c);
    inp[IN.FOOD] = food ? clamp(1 - foodD / vis, 0, 1) * Math.min(1, foodS / 20) : 0;
    inp[IN.THREAT] = thr ? clamp(1 - thrD / vis, 0, 1) : 0;
    inp[IN.MATE] = mate ? clamp(1 - mateD / vis, 0, 1) : 0;
    inp[IN.CROWD] = Math.min(1, crowd / 5);
    inp[IN.LOCAL] = c.cls === HERB ? (here >= 0 ? w.grass[here] : 0) : Math.min(1, preyN / 4);
    inp[IN.DARK] = dark;
    inp[IN.TEMP] = Math.min(1, stress);
    inp[IN.AGE] = c.age / c.life;
    inp[IN.CANREP] = canRep ? 1 : 0;
    inp[IN.RAIN] = w.rainI;
    inp[IN.NOISE] = rng.next() * 2 - 1;
    forward(c.w, inp, c.hid, c.out);

    const o = c.out;
    let best = 0;
    let bv = -1e9;
    for (let a = 0; a < N_OUT; a++) {
      let v = o[a] + (a === c.act ? 0.25 : 0);
      if (a === ACT.REPRO && !canRep) v = -1e9;
      if (v > bv) {
        bv = v;
        best = a;
      }
    }
    if (c.panic > 0) best = ACT.FLEE;
    if (best !== c.act) {
      c.act = best;
      c.actT = 0;
    }
    c.food = food;
    c.thr = thr;
    c.mate = mate;
    if (rng.next() < 0.35) c.turn = (rng.next() * 2 - 1) * 1.4;
  }

  // ---- 体を動かす
  act(c, dt) {
    let speedF = 0;
    let desired = null;
    switch (c.act) {
      case ACT.WANDER:
        c.h += c.turn * dt;
        speedF = 0.45;
        break;
      case ACT.EAT: {
        const f = c.food;
        if (!f || (f.k === 'f' && f.f.dead) || (f.k === 'c' && f.cc.dead) || (f.k === 'p' && !f.c.alive)) {
          c.food = null;
          c.h += c.turn * 0.4 * dt;
          speedF = 0.6;
          break;
        }
        const tx = f.k === 'p' ? f.c.x : f.x;
        const tz = f.k === 'p' ? f.c.z : f.z;
        const dx = tx - c.x;
        const dz = tz - c.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (f.k === 'g') {
          if (d < 0.35 || this.world.cellIndex(c.x, c.z) === f.ci) {
            this.graze(c, f, dt);
          } else {
            desired = Math.atan2(dz, dx);
            speedF = 0.75;
          }
        } else if (f.k === 'c') {
          if (d < 0.5) {
            this.world.eatCarc(f.cc);
            this.gain(c, f.cc.e * meatEff(c));
            c.digest = 8;
            this.events.push({ type: 'eat', x: f.x, z: f.z });
            c.food = null;
          } else {
            desired = Math.atan2(dz, dx);
            speedF = 0.75;
          }
        } else if (f.k === 'f') {
          if (d < 0.45) {
            this.world.eatFruit(f.f);
            this.gain(c, FRUIT_E * fruitEff(c));
            this.events.push({ type: 'eat', x: f.x, z: f.z });
            c.food = null;
          } else {
            desired = Math.atan2(dz, dx);
            speedF = 0.8;
          }
        } else {
          const prey = f.c;
          const reach = 0.4 + 0.2 * (c.t[TR.SIZE] + prey.t[TR.SIZE]);
          if (d < reach) {
            this.attack(c, prey);
            speedF = 0.2;
            desired = Math.atan2(dz, dx);
          } else {
            desired = Math.atan2(dz, dx);
            speedF = d < 4 ? 1 : 0.7;
          }
        }
        break;
      }
      case ACT.FLEE: {
        const t = c.thr;
        if (t && t.alive) {
          desired = Math.atan2(c.z - t.z, c.x - t.x);
          speedF = 1;
        } else {
          c.h += c.turn * dt;
          speedF = 0.5;
        }
        break;
      }
      case ACT.REPRO: {
        if (!this.canRepro(c)) {
          c.act = ACT.WANDER;
          break;
        }
        const m = c.mate;
        if (m && m.alive && m.sp === c.sp) {
          const dx = m.x - c.x;
          const dz = m.z - c.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < 1.6) this.reproduce(c, m);
          else if (c.actT < 4) {
            desired = Math.atan2(dz, dx);
            speedF = 0.6;
          } else this.reproduce(c, null);
        } else this.reproduce(c, null);
        break;
      }
      case ACT.REST:
      default:
        speedF = 0;
        break;
    }
    if (desired !== null) {
      const diff = wrapAngle(desired - c.h);
      const m = 7 * dt;
      c.h += diff > m ? m : diff < -m ? -m : diff;
    }
    this.move(c, speedF, dt);
  }

  // 肉食は山頂に登れない（草食の逃げ場）。山頂にいるときは降りることだけできる
  canWalk(c, x, z) {
    const w = this.world;
    const k = w.cellIndex(x, z);
    if (k < 0) return false;
    const t = w.type[k];
    if (t < T.SAND) return false;
    if (c.cls === CARN && t === T.PEAK) {
      const here = w.cellIndex(c.x, c.z);
      return here >= 0 && w.type[here] === T.PEAK;
    }
    return true;
  }

  move(c, speedF, dt) {
    const w = this.world;
    const pp = PARAM[c.cls];
    // スタミナ: 全力で走れるのは少しのあいだだけ
    if (c.tired) speedF = Math.min(speedF, 0.55);
    if (speedF >= 0.9) {
      c.sta -= pp.staDrain * dt;
      if (c.sta <= 0) {
        c.sta = 0;
        c.tired = true;
      }
    } else {
      c.sta = Math.min(1, c.sta + pp.staRec * (speedF === 0 ? 2 : 1) * dt);
      if (c.tired && c.sta >= 0.35) c.tired = false;
    }
    const k = w.cellIndex(c.x, c.z);
    const terr = k >= 0 ? MOVE[w.type[k]] : 1;
    const v = PARAM[c.cls].baseSpeed * c.t[TR.SPEED] * (1.1 - 0.1 * c.t[TR.SIZE]) * speedF * terr * (1 - 0.15 * w.snow) * (1 - 0.25 * Math.min(1, c.stress));
    c.v = v;
    if (v <= 0) return;
    const st = v * dt;
    let nx = c.x + Math.cos(c.h) * st;
    let nz = c.z + Math.sin(c.h) * st;
    if (!this.canWalk(c, c.x + Math.cos(c.h) * 0.7, c.z + Math.sin(c.h) * 0.7) || !this.canWalk(c, nx, nz)) {
      const sgn = c.id & 1 ? 1 : -1;
      let ok = false;
      for (const o of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6, 3.14]) {
        const hh = c.h + o * sgn;
        if (this.canWalk(c, c.x + Math.cos(hh) * 0.7, c.z + Math.sin(hh) * 0.7)) {
          c.h = hh;
          nx = c.x + Math.cos(hh) * st;
          nz = c.z + Math.sin(hh) * st;
          ok = true;
          break;
        }
      }
      if (!ok || !this.canWalk(c, nx, nz)) {
        nx = c.x;
        nz = c.z;
        c.h += Math.PI * 0.5;
      }
    }
    c.x = nx;
    c.z = nz;
    if (c.h > Math.PI * 4 || c.h < -Math.PI * 4) c.h = wrapAngle(c.h);
  }

  gain(c, amt) {
    c.e = Math.min(maxEnergy(c), c.e + amt);
  }

  graze(c, f, dt) {
    const w = this.world;
    const k = w.cellIndex(c.x, c.z);
    if (k < 0) return;
    const g = w.grass[k];
    // 根っこは残す（食べ尽くさないので草がまた生える）
    if (g < 0.1) {
      c.food = null;
      return;
    }
    const take = Math.min(g - 0.09, BITE * (0.4 + 0.6 * c.t[TR.SIZE]) * dt);
    w.grass[k] = g - take;
    this.gain(c, take * GRASS_E * grassEff(c) * (1 - 0.35 * w.snow));
  }

  attack(c, prey) {
    if (c.atkCD > 0 || !prey.alive || c.digest > 0) return;
    if (c.e > maxEnergy(c) * (HUNGRY + 0.05)) return; // お腹がすいていないときは狩らない
    c.atkCD = 0.9;
    let p = huntChance(c, prey);
    if (prey.act === ACT.FLEE) p -= 0.12;
    if (prey.act === ACT.REST) p += 0.12;
    p = clamp(p, 0.05, 0.95);
    this.records.atk++;
    if (this.rng.next() < p) {
      this.records.hit++;
      this.kill(prey, 'eaten');
      this.gain(c, MEAT_E * prey.t[TR.SIZE] * meatEff(c));
      c.kills++;
      c.food = null;
      c.digest = DIGEST * prey.t[TR.SIZE];
    } else {
      prey.panic = 1.5;
      prey.thr = c;
      if (prey.t[TR.SIZE] > c.t[TR.SIZE]) c.e -= 5 * prey.t[TR.SIZE];
      this.events.push({ type: 'miss', x: prey.x, z: prey.z });
    }
  }

  reproduce(c, mate) {
    if (!this.canRepro(c)) return false;
    const p = PARAM[c.cls];
    const rng = this.rng;
    const childE = c.e * p.childFrac;
    let traits;
    let brain;
    let hue = c.hue;
    let gen = c.gen + 1;
    if (mate && mate.alive && mate.sp === c.sp && mate.e > childE * 0.3) {
      traits = crossTraits(c.t, mate.t, rng);
      brain = crossoverBrain(c.w, mate.w, rng);
      hue = rng.next() < 0.5 ? c.hue : mate.hue;
      gen = Math.max(c.gen, mate.gen) + 1;
      c.e -= childE * 0.8 + 2;
      mate.e -= childE * 0.2;
    } else {
      traits = c.t.slice();
      brain = new Float32Array(c.w);
      c.e -= childE + 3;
    }
    traits = mutateTraits(traits, rng, this.mut);
    mutateBrain(brain, rng, this.mut);
    hue = (hue + rng.gauss() * 0.008 + 1) % 1;
    const sp = this.assignSpecies(c.cls, traits, c.sp);
    if (sp !== c.sp) hue = this.species[sp].hue;
    const pos = this.findSpot(c.x, c.z, 0.6) || [c.x, c.z];
    const child = newCreature(this.nextId++, c.cls, sp, traits, brain, hue, pos[0], pos[1], gen, childE, 0, rng);
    child.h = c.h + rng.range(-1, 1);
    this.addCreature(child, this.pending);
    c.lastRep = c.age;
    c.kids++;
    this.births++;
    this.events.push({ type: 'birth', x: pos[0], z: pos[1], cls: c.cls });
    this.trimEvents();
    return true;
  }

  assignSpecies(cls, traits, parentSp) {
    const ps = this.species[parentSp];
    if (traitDist(traits, ps.founder) <= SPEC_T) return ps.id;
    let best = null;
    let bd = SPEC_T * 0.85;
    for (const s of this.species) {
      if (s.parent !== ps.id || s.cls !== cls || s.n <= 0) continue;
      const d = traitDist(traits, s.founder);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) return best.id;
    const rng = this.rng;
    const sp = this.newSpecies(cls, traits, ps.id, null, (ps.hue + 0.18 + rng.next() * 0.64) % 1, 0.35 + rng.next() * 0.4, 0.45 + rng.next() * 0.25);
    this.addLog(`🧬 新種「${sp.name}」が「${ps.name}」から分かれた`);
    this.events.push({ type: 'speciate', sp: sp.id });
    return sp.id;
  }

  kill(c, cause) {
    if (!c.alive) return;
    c.alive = false;
    c.cause = cause;
    this.deadCount++;
    this.nCls[c.cls]--;
    const sp = this.species[c.sp];
    sp.n--;
    if (sp.n <= 0) {
      sp.n = 0;
      sp.ext = r1(this.world.time);
      this.addLog(`💀「${sp.name}」が絶滅した`);
      this.events.push({ type: 'extinct', sp: sp.id });
    }
    const w = this.world;
    const k = w.cellIndex(c.x, c.z);
    if (k >= 0) {
      w.boost[k] = Math.min(2, w.boost[k] + 0.35 * c.t[TR.SIZE]);
      if (FERT[w.type[k]] > 0) w.grass[k] = Math.min(1, w.grass[k] + 0.15);
    }
    if (cause !== 'eaten') w.addCarc(c.x, c.z, (c.cls === HERB ? 30 : 24) * c.t[TR.SIZE]);
    this.deaths[cause] = (this.deaths[cause] || 0) + 1;
    this.events.push({ type: 'death', cause, x: c.x, z: c.z, cls: c.cls, id: c.id });
    this.trimEvents();
  }

  // ---- 記録（グラフ用）
  sample() {
    const sum = [new Float64Array(TRAIT_N), new Float64Array(TRAIT_N)];
    const sq = [new Float64Array(TRAIT_N), new Float64Array(TRAIT_N)];
    const cnt = [0, 0];
    const gen = [0, 0];
    const spc = {};
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const k = c.cls;
      cnt[k]++;
      gen[k] += c.gen;
      for (let i = 0; i < TRAIT_N; i++) {
        sum[k][i] += c.t[i];
        sq[k][i] += c.t[i] * c.t[i];
      }
      spc[c.sp] = (spc[c.sp] || 0) + 1;
    }
    const mean = (k) => (cnt[k] ? Array.from(sum[k], (s) => r3(s / cnt[k])) : null);
    const sd = (k) => (cnt[k] ? Array.from(sq[k], (s, i) => r3(Math.sqrt(Math.max(0, s / cnt[k] - (sum[k][i] / cnt[k]) ** 2)))) : null);
    this.hist.push({
      t: r1(this.world.time),
      h: cnt[0],
      c: cnt[1],
      g: r3(this.world.grassMean()),
      f: this.world.fruits.length,
      sp: spc,
      mh: mean(0),
      mc: mean(1),
      sh: sd(0),
      sc: sd(1),
      gh: cnt[0] ? r1(gen[0] / cnt[0]) : 0,
      gc: cnt[1] ? r1(gen[1] / cnt[1]) : 0,
    });
    if (this.hist.length > 480) {
      const last = this.hist.length - 1;
      this.hist = this.hist.filter((_, i) => i % 2 === 0 || i === last);
      this.sampleEvery *= 2;
    }
  }

  // ---- 集計（画面用）
  speciesStats(spId) {
    const sum = new Float64Array(TRAIT_N);
    let n = 0;
    let gmin = 1e9;
    let gmax = 0;
    for (const c of this.creatures) {
      if (!c.alive || c.sp !== spId) continue;
      n++;
      for (let i = 0; i < TRAIT_N; i++) sum[i] += c.t[i];
      if (c.gen < gmin) gmin = c.gen;
      if (c.gen > gmax) gmax = c.gen;
    }
    return { n, mean: n ? Array.from(sum, (s) => s / n) : null, gmin: n ? gmin : 0, gmax };
  }
  classMean(cls, ti) {
    let s = 0;
    let n = 0;
    for (const c of this.creatures) {
      if (c.alive && c.cls === cls) {
        s += c.t[ti];
        n++;
      }
    }
    return n ? s / n : 0;
  }
  livingSpecies(minN = 1) {
    return this.species.filter((s) => s.n >= minN);
  }
  maxGen(cls) {
    let g = 0;
    for (const c of this.creatures) if (c.alive && c.cls === cls && c.gen > g) g = c.gen;
    return g;
  }
  byId(id) {
    for (const c of this.creatures) if (c.id === id) return c.alive ? c : null;
    return null;
  }

  // ---- 神さまの手（プレイヤーの介入）
  canPay(tool) {
    return this.god.inf || this.god.pow >= this.costs[tool];
  }

  useTool(tool, x, z, opt = {}) {
    const placed = ['grass', 'fruit', 'tree', 'herb', 'carn'].includes(tool);
    if (placed && (x == null || this.world.cellIndex(x, z) < 0)) return { ok: false, msg: '島の上をタップしてください' };
    if (!this.canPay(tool)) return { ok: false, msg: `神の力が足りません（必要 ${this.costs[tool]}）` };
    let r;
    switch (tool) {
      case 'grass':
        r = this.sowGrass(x, z);
        break;
      case 'fruit':
        r = this.dropFruit(x, z);
        break;
      case 'tree':
        r = this.plantTree(x, z);
        break;
      case 'herb':
      case 'carn':
        r = this.addAnimals(tool === 'herb' ? HERB : CARN, opt.sp, x, z);
        break;
      case 'rain':
      case 'heat':
      case 'cold':
        r = this.weather(tool);
        break;
      default:
        r = { ok: false, msg: '' };
    }
    if (r.ok && !this.god.inf) this.god.pow -= this.costs[tool];
    return r;
  }

  sowGrass(x, z) {
    const w = this.world;
    let n = 0;
    const R = 2.6;
    for (let j = Math.floor(z - R); j <= Math.ceil(z + R); j++) {
      for (let i = Math.floor(x - R); i <= Math.ceil(x + R); i++) {
        const k = w.cellIndex(i + 0.5, j + 0.5);
        if (k < 0 || FERT[w.type[k]] === 0) continue;
        const d = Math.hypot(i + 0.5 - x, j + 0.5 - z);
        if (d > R) continue;
        w.grass[k] = Math.min(1, w.grass[k] + 0.75 * (1 - d / (R + 0.3)));
        w.boost[k] = Math.min(2, w.boost[k] + 0.25);
        n++;
      }
    }
    if (!n) return { ok: false, msg: 'ここでは草が育ちません（水や山頂）' };
    w.gVersion++;
    return { ok: true, msg: '🌱 草の種をまいた' };
  }

  dropFruit(x, z) {
    const w = this.world;
    if (!w.walkable(x, z)) return { ok: false, msg: '水の上には置けません' };
    let n = 0;
    for (let k = 0; k < 6; k++) if (w.fruits.length < 140 && w.spawnFruit(this.rng, x, z, 1.6, this.rng.int(2), -1)) n++;
    if (!n) return { ok: false, msg: '木の実を置けませんでした' };
    return { ok: true, msg: `🍎 木の実を${n}こ置いた` };
  }

  plantTree(x, z) {
    const w = this.world;
    const k = w.cellIndex(x, z);
    if (k < 0 || ![T.SAND, T.GRASS, T.FOREST].includes(w.type[k])) return { ok: false, msg: '木は砂浜・草原・森に植えられます' };
    if (w.trees.length >= 44) return { ok: false, msg: '木はもう植えられません（最大44本）' };
    const cx = (k % GW) + 0.5;
    const cz = ((k / GW) | 0) + 0.5;
    if (w.trees.some((t) => (t.x - cx) ** 2 + (t.z - cz) ** 2 < 1.8 * 1.8)) return { ok: false, msg: '近くに木があります' };
    w.trees.push({ x: cx, z: cz, timer: this.rng.range(6, 12), grow: 0.15, kind: this.rng.int(2), n: 0 });
    w.treeVersion++;
    return { ok: true, msg: '🌳 木の苗を植えた（育つと実がなる）' };
  }

  defaultSpecies(cls) {
    const living = this.species.filter((s) => s.cls === cls && s.n > 0).sort((a, b) => b.n - a.n);
    if (living.length) return living[0].id;
    const st = this.species.find((s) => s.cls === cls && s.starter);
    return st ? st.id : null;
  }

  addAnimals(cls, spId, x, z) {
    if (spId == null || !this.species[spId] || this.species[spId].cls !== cls) spId = this.defaultSpecies(cls);
    const sp = this.species[spId];
    if (!sp) return { ok: false, msg: '放せる種がいません' };
    if (!this.world.walkable(x, z)) return { ok: false, msg: '水の上には放せません' };
    if (this.nTotal >= MAX_ANIMALS || this.nCls[cls] >= CLASS_CAP[cls]) return { ok: false, msg: `数が上限です（全体${MAX_ANIMALS}匹）` };
    const src = this.creatures.filter((c) => c.alive && c.sp === spId);
    if (!src.length && !sp.starter) return { ok: false, msg: 'この種はもういません' };
    const wasExt = sp.n === 0;
    const n = cls === HERB ? 3 : 1;
    let made = 0;
    for (let k = 0; k < n; k++) {
      if (this.nTotal >= MAX_ANIMALS || this.nCls[cls] >= CLASS_CAP[cls]) break;
      if (src.length) {
        const pos = this.findSpot(x, z, 1.4);
        if (!pos) break;
        const m = this.rng.pick(src);
        const traits = mutateTraits(m.t, this.rng, 0.5 * this.mut);
        const brain = new Float32Array(m.w);
        mutateBrain(brain, this.rng, 0.5 * this.mut);
        const c = newCreature(this.nextId++, cls, spId, traits, brain, m.hue, pos[0], pos[1], m.gen, 0, PARAM[cls].maturity, this.rng);
        c.e = maxEnergy(c) * 0.75;
        this.addCreature(c, this.pending);
      } else if (!this.spawnStarter(sp, x, z, false)) break;
      made++;
    }
    if (!made) return { ok: false, msg: '放せませんでした' };
    if (wasExt) this.addLog(`🔁「${sp.name}」を島にもう一度放した`);
    return { ok: true, msg: `${cls === HERB ? '🐇' : '🦊'}「${sp.name}」を${made}匹放した` };
  }

  weather(kind) {
    const ev = this.world.ev;
    if (kind === 'rain') {
      ev.rain = Math.min(150, ev.rain + 60);
      this.addLog('🌧️ 神さまが雨をふらせた');
      return { ok: true, msg: '🌧️ 雨がふりはじめた（草がよく育つ）' };
    }
    if (kind === 'heat') {
      ev.heat = EVENT_LEN;
      ev.cold = 0;
      this.addLog('🔥 熱波がやってきた');
      return { ok: true, msg: '🔥 熱波がやってきた（暑さに弱い個体が苦しむ）' };
    }
    ev.cold = EVENT_LEN;
    ev.heat = 0;
    this.addLog('❄️ 寒波がやってきた');
    return { ok: true, msg: '❄️ 寒波がやってきた（寒さに弱い個体が苦しむ）' };
  }

  // ---- 保存と復元
  toJSON() {
    const enc = (c) => [
      c.id,
      c.cls,
      c.sp,
      r2(c.x),
      r2(c.z),
      r2(wrapAngle(c.h)),
      r1(c.e),
      r1(c.age),
      c.gen,
      r1(c.life),
      r1(c.lastRep),
      c.t.map(r3),
      r3(c.hue),
      c.kids,
      c.kills,
      encodeBrain(c.w),
    ];
    return {
      v: 1,
      seed: this.seed,
      mode: this.mode,
      mut: this.mut,
      rng: this.rng.s,
      nextId: this.nextId,
      god: this.god,
      costs: this.costs,
      mission: this.mission,
      world: this.world.toJSON(),
      species: this.species,
      creatures: this.creatures.filter((c) => c.alive).map(enc),
      hist: this.hist,
      sampleEvery: this.sampleEvery,
      log: this.log,
      deaths: this.deaths,
      births: this.births,
      records: this.records,
      clsGone: this.clsGone,
    };
  }

  static fromJSON(o) {
    const s = new Sim();
    s.seed = o.seed;
    s.mode = o.mode;
    s.mut = o.mut;
    s.rng = new RNG(1);
    s.rng.s = o.rng >>> 0;
    s.nextId = o.nextId;
    s.god = o.god;
    s.costs = Object.assign({}, TOOL_COST, o.costs);
    s.mission = o.mission;
    s.world = World.fromJSON(o.world);
    s.species = o.species.map((sp) => Object.assign({}, sp, { n: 0 }));
    s.hist = o.hist || [];
    s.sampleEvery = o.sampleEvery || 3;
    s.log = o.log || [];
    s.deaths = o.deaths || {};
    s.births = o.births || 0;
    s.records = o.records || s.records;
    s.clsGone = o.clsGone || [false, false];
    for (const a of o.creatures) {
      const c = newCreature(a[0], a[1], a[2], a[11].slice(), decodeBrain(a[15]), a[12], a[3], a[4], a[8], a[6], a[7], s.rng);
      c.h = a[5];
      c.life = a[9];
      c.lastRep = a[10];
      c.kids = a[13];
      c.kills = a[14];
      s.creatures.push(c);
      s.nCls[c.cls]++;
      if (s.species[c.sp]) s.species[c.sp].n++;
    }
    return s;
  }
}
