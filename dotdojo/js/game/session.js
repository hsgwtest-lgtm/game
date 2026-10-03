// 修行の進行（流派ごと）
// 画面はここが出す「できごと（events）」を受け取って、3D・効果音・実況を動かす。
//   reset  … 新しい挑戦（エピソード）が始まった
//   step   … 1歩すすんだ
//   gen / round / trained / airun … 学びの区切り（グラフ・実況用）
//   medal  … 免許皆伝（その流派の印）

import { Stage, Episode, N_IN, EV_BUMP, C_GOAL } from '../sim/env.js';
import { evalPolicy } from '../sim/evaluate.js';
import { Population, Member } from '../ml/ga.js';
import { PPOAgent } from '../ml/ppo.js';
import { Imitator } from '../ml/bc.js';
import { MLP, argmax } from '../ml/nn.js';
import { RNG } from '../core/rng.js';
import { FAMILIES, PAL } from '../core/config.js';

export const BASE_STEP = 0.24;     // 1倍速で1歩にかける秒数
export const SPEEDS = [1, 2, 4, 8];
const FAST_BUDGET_MS = 10;          // 高速修行で1フレームに使う時間
const FAST_MAX = { ga: 150, rl: 120 };

class BaseSession {
  constructor(app, def, school) {
    this.app = app;
    this.def = def;
    this.school = school;
    this.stage = new Stage(def);
    this.rw = app.game.rewards(def.id, school);
    this.speedIdx = 0;
    this.paused = false;
    this.fast = false;
    this.fastCount = 0;
    this.timer = 0;
    this.ep = null;
    this.events = [];
    this.phase = 'run';
    this.phaseT = 0;
    this.focus = 0;
    const rec = app.game.rec(def.id, school);
    this.medal = !!(rec && rec.got);
    this.rng = new RNG();
    this.obs = new Float32Array(N_IN);
    this.paths = [];          // でしごとの足あと（注目しているでし用）
    this.saveCounter = 0;
  }

  get speed() { return SPEEDS[this.speedIdx]; }
  get stepDur() { return BASE_STEP / this.speed; }
  get frac() { return this.phase === 'run' ? Math.min(1, this.timer / this.stepDur) : 1; }
  emit(type, data = {}) { data.type = type; this.events.push(data); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  pickStart() { return this.stage.multiStart ? this.rng.int(0, this.stage.starts.length - 1) : 0; }

  setRewards(rw) {
    this.rw = Object.assign({}, rw);
    this.app.game.saveRewards(this.def.id, this.school, this.rw);
  }

  // でしの見た目の色
  colorOf() { return { color: PAL.white, band: PAL.white }; }

  agentList() {
    const ep = this.ep, list = [];
    if (!ep) return list;
    for (let i = 0; i < ep.n; i++) {
      const c = this.colorOf(i);
      list.push({ x: ep.x[i], y: ep.y[i], px: ep.px[i], py: ep.py[i], done: ep.done[i], cause: ep.cause[i], color: c.color, band: c.band, key: ep.key[i], hi: i === this.focus });
    }
    return list;
  }

  _beginPaths() {
    const ep = this.ep;
    this.paths = [];
    for (let i = 0; i < ep.n; i++) this.paths.push([[ep.x[i], ep.y[i]]]);
  }
  _pushPaths() {
    const ep = this.ep;
    for (let i = 0; i < ep.n; i++) {
      if (ep.px[i] === ep.x[i] && ep.py[i] === ep.y[i]) continue;
      if (this.paths[i] && this.paths[i].length < 200) this.paths[i].push([ep.x[i], ep.y[i]]);
    }
  }

  update(dt) {
    if (this.paused) return;
    this.phaseT += dt;
    if (this.fast) { this._runFast(); return; }
    if (this.phase === 'run' && this.ep) {
      this.timer += dt;
      let guard = 0;
      while (this.timer >= this.stepDur && this.phase === 'run' && guard++ < 8) {
        this.timer -= this.stepDur;
        this._doStep(false);
      }
      if (this.phase !== 'run') this.timer = 0;
    } else {
      this._updatePhase(dt);
    }
  }

  setFast(on) {
    if (on === this.fast) return;
    this.fast = on;
    this.fastCount = 0;
    if (!on) this._afterFast();
  }

  _afterFast() { this._newEpisode(); }

  save() { /* 流派ごと */ }

  _award(info) {
    const first = this.app.game.award(this.def.id, this.school, info);
    if (first) this.emit('medal', info);
    this.medal = true;
    return first;
  }
}

// ── 進化流 ──
export class GASession extends BaseSession {
  constructor(app, def) {
    super(app, def, 'ga');
    const saved = app.game.loadBrain(def.id, 'ga');
    this.pop = (saved && Population.deserialize(saved)) || new Population({ size: 40 }).initRandom();
    this.acts = new Int8Array(96);
    this.lastChamp = null;
    this.focus = 0;
    this._newEpisode();
  }

  colorOf(i) {
    const m = this.pop.members[i];
    if (!m) return { color: PAL.white, band: PAL.lime };
    const f = FAMILIES[m.family] || FAMILIES[0];
    return { color: f.color, band: m.id === this.pop.oshiId ? PAL.magenta : (m.elite ? PAL.yellow : PAL.lime) };
  }

  _newEpisode() {
    this.ep = new Episode(this.stage, this.pop.members.length, this.rw, this.pickStart());
    this.phase = 'run'; this.phaseT = 0; this.timer = 0;
    if (this.focus >= this.pop.members.length) this.focus = 0;
    this._beginPaths();
    this.emit('reset');
  }

  _doStep(fast) {
    const ep = this.ep, obs = this.obs, acts = this.acts, pop = this.pop;
    for (let i = 0; i < ep.n; i++) {
      if (ep.done[i]) continue;
      ep.observe(i, obs);
      acts[i] = pop.act(i, obs);
    }
    ep.step(acts);
    if (!fast) { this._pushPaths(); this.emit('step'); }
    if (ep.allDone) this._endGeneration(fast);
  }

  _endGeneration(fast) {
    const pop = this.pop, ep = this.ep;
    pop.setResults(ep);
    // この世代のチャンピオン（成績1位）
    let ci = 0;
    for (let i = 1; i < pop.members.length; i++) if (pop.members[i].fitness > pop.members[ci].fitness) ci = i;
    const champ = pop.members[ci];
    let cleared = !!champ.succ;
    let evalRes = null;
    if (cleared && this.stage.multiStart) {
      const net = new MLP(N_IN, 16, 5, champ.genome);
      evalRes = evalPolicy(this.stage, this.rw, (o) => argmax(net.forward(o)));
      cleared = evalRes.succ;
    }
    this.lastChamp = { id: champ.id, family: champ.family, fitness: champ.fitness, succ: champ.succ, steps: champ.steps, path: this.paths[ci] || null, coins: champ.coins };
    const summary = pop.evolve();
    summary.cleared = cleared;
    summary.champSteps = champ.steps;
    if (cleared) {
      this._award({ cost: pop.evals, steps: evalRes ? evalRes.maxSteps : champ.steps, unit: '人', gen: summary.gen });
    }
    this.emit('gen', { summary, fast });
    this.saveCounter++;
    if (this.saveCounter % 5 === 0) this.save();
    this.phase = 'between'; this.phaseT = 0;
  }

  _updatePhase() {
    if (this.phase === 'between' && this.phaseT > 1.2 / Math.sqrt(this.speed)) this._newEpisode();
  }

  _runFast() {
    const t0 = performance.now();
    const hadMedal = this.medal;
    while (performance.now() - t0 < FAST_BUDGET_MS) {
      if (this.phase !== 'run') { this.ep = new Episode(this.stage, this.pop.members.length, this.rw, this.pickStart()); this.phase = 'run'; this._beginPaths(); }
      let guard = 0;
      while (this.phase === 'run' && guard++ < 400) this._doStep(true);
      this.fastCount++;
      if ((!hadMedal && this.medal) || this.fastCount >= FAST_MAX.ga) { this.setFast(false); return; }
    }
  }

  setPopSize(n) {
    if (n === this.pop.size) return;
    const p = this.pop;
    p.size = n;
    if (p.members.length > n) {
      p.members.sort((a, b) => (b.elite - a.elite) || (b.fitness - a.fitness));
      p.members.length = n;
    } else {
      while (p.members.length < n) {
        const src = p.members[p.members.length % Math.max(1, p.members.length)] || p.members[0];
        const net = new MLP(N_IN, 16, 5).randomize(p.rng, 1, 1);
        if (src && p.rng.float() < 0.5) { net.w.set(src.genome); for (let q = 0; q < net.w.length; q++) if (p.rng.float() < 0.08) net.w[q] += p.rng.gauss() * 0.3; }
        p.members.push(new Member(net.w, src ? src.family : 0, { born: p.gen }));
      }
    }
    p._buildNets();
    this._newEpisode();
  }

  // ほかの流派の脳を群れに入れる
  injectGenome(genome) {
    const m = this.pop.inject(genome, 10);
    this._newEpisode();
    return m;
  }

  resetBrain() {
    this.app.game.clearBrain(this.def.id, 'ga');
    const size = this.pop.size, mutIdx = this.pop.mutIdx;
    this.pop = new Population({ size, mutIdx }).initRandom();
    this.focus = 0;
    this._newEpisode();
  }

  // 注目しているでしの脳
  brainOf(i = this.focus) { return this.pop.nets[i] || this.pop.nets[0]; }
  actFn(i = this.focus) { const net = this.brainOf(i); return (o) => argmax(net.forward(o)); }
  championNet() {
    let best = 0;
    for (let i = 1; i < this.pop.members.length; i++) {
      const a = this.pop.members[i], b = this.pop.members[best];
      if ((a.elite && !b.elite) || (a.elite === b.elite && a.fitness > b.fitness)) best = i;
    }
    return this.pop.nets[best];
  }

  save() { this.app.game.saveBrain(this.def.id, 'ga', this.pop.serialize(8)); }
  get episodes() { return this.pop.evals; }
}

// ── 強化流 ──
export class RLSession extends BaseSession {
  constructor(app, def) {
    super(app, def, 'rl');
    const saved = app.game.loadBrain(def.id, 'rl');
    this.agent = (saved && PPOAgent.deserialize(saved)) || new PPOAgent({});
    this.acts = new Int8Array(64);
    this.greedyRes = null;
    this.retHist = [];
    this._newEpisode();
  }

  colorOf(i) {
    if (this.exam) return { color: PAL.orange, band: PAL.white };
    return { color: PAL.orange, band: i === this.focus ? PAL.yellow : PAL.rust };
  }

  _newEpisode() {
    this.ep = new Episode(this.stage, this.agent.clones, this.rw, this.pickStart());
    this.agent.beginRound(this.ep);
    this.phase = 'run'; this.phaseT = 0; this.timer = 0;
    if (this.focus >= this.ep.n) this.focus = 0;
    this._beginPaths();
    this.emit('reset');
  }

  _doStep(fast) {
    const ep = this.ep;
    if (this.exam) {
      ep.observe(0, this.obs);
      ep.step([this.agent.greedy(this.obs)]);
      this._pushPaths();
      this.emit('step');
      if (ep.allDone) {
        const info = this.exam;
        this.exam = null;
        if (ep.succ[0]) this._award(info);
        this.phase = 'between'; this.phaseT = 0;
      }
      return;
    }
    this.agent.actAll(ep, this.acts);
    ep.step(this.acts);
    this.agent.afterStep(ep);
    if (!fast) { this._pushPaths(); this.emit('step'); }
    if (ep.allDone) {
      const summary = this.agent.endRound(ep);
      this.lastSummary = summary;
      this.phase = 'learn'; this.phaseT = 0;
      if (!fast) this.emit('learnStart', { summary });
    }
  }

  _finishRound(fast) {
    const ag = this.agent;
    const res = evalPolicy(this.stage, this.rw, (o) => ag.greedy(o), { path: !fast });
    this.greedyRes = res;
    const summary = this.lastSummary;
    summary.cleared = res.succ;
    summary.greedySteps = res.steps;
    this.emit('round', { summary, fast });
    this.saveCounter++;
    if (this.saveCounter % 5 === 0) this.save();
    if (res.succ && !this.medal) {
      const info = { cost: ag.episodes, steps: res.maxSteps, unit: '回', round: ag.round };
      if (fast) { this._award(info); this.phase = 'between'; this.phaseT = 0; return; }
      // 本番テスト：迷いのない一番自信のある動きだけで、ひとりで挑む
      this.exam = info;
      this.phase = 'run'; this.phaseT = 0; this.timer = 0;
      this.ep = new Episode(this.stage, 1, this.rw, 0);
      this.focus = 0;
      this._beginPaths();
      this.emit('reset');
      this.emit('examStart');
      return;
    }
    this.phase = 'between'; this.phaseT = 0;
  }

  _updatePhase() {
    if (this.phase === 'learn') {
      const done = this.agent.updateStep(3);
      // 学習の様子を少し見せる（1倍速で最低 0.5 秒）
      if (done && this.phaseT > 0.5 / this.speed) this._finishRound(false);
    } else if (this.phase === 'between' && this.phaseT > 1.1 / Math.sqrt(this.speed)) this._newEpisode();
  }

  // 高速修行：1歩ずつ・ミニバッチ少しずつ進めて、1フレームの時間を守る（画面がカクつかないように）
  _runFast() {
    const t0 = performance.now();
    const hadMedal = this.medal;
    while (performance.now() - t0 < FAST_BUDGET_MS) {
      if (this.phase === 'learn') {
        if (this.agent.updateStep(2)) {
          this._finishRound(true);
          this.fastCount++;
          if ((!hadMedal && this.medal) || this.fastCount >= FAST_MAX.rl) { this.setFast(false); return; }
        }
        continue;
      }
      if (this.phase !== 'run' || this.exam) {
        this.exam = null;
        this.ep = new Episode(this.stage, this.agent.clones, this.rw, this.pickStart());
        this.agent.beginRound(this.ep);
        this.phase = 'run';
        this._beginPaths();
      }
      this._doStep(true);
    }
  }

  setClones(idx) {
    this.agent.clonesIdx = idx;
    if (this.phase === 'run') this._newEpisode();
  }

  loadPolicy(w) { this.agent.loadPolicy(w); this._newEpisode(); }

  resetBrain() {
    this.app.game.clearBrain(this.def.id, 'rl');
    const a = this.agent;
    this.agent = new PPOAgent({ entIdx: a.entIdx, lrIdx: a.lrIdx, clonesIdx: a.clonesIdx });
    this.greedyRes = null;
    this._newEpisode();
  }

  actFn() { const ag = this.agent; return (o) => ag.greedy(o); }
  save() { this.app.game.saveBrain(this.def.id, 'rl', this.agent.serialize()); }
  get episodes() { return this.agent.episodes; }
}

// ── 模倣流 ──
export class ILSession extends BaseSession {
  constructor(app, def) {
    super(app, def, 'il');
    const saved = app.game.loadBrain(def.id, 'il');
    this.im = (saved && Imitator.deserialize(saved)) || new Imitator({});
    this.mode = 'idle';        // idle / demo / train / auto
    this.startIdx = 0;
    this.demoPath = null;
    this.demoAdded = 0;
    this.pending = -1;          // まかせ中に人が押した操作（手助け）
    this.usedHelp = false;
    this.trainLeft = 0;
    this.trainTotal = 0;
    this.lastEval = null;
    this.autoStart = 0;
    this.holdDir = -1; this.holdT = 0;
    this._newEpisode();
    this.phase = 'idle';
  }

  colorOf() { return { color: PAL.cyan, band: PAL.red }; }

  _newEpisode(si = this.startIdx) {
    this.ep = new Episode(this.stage, 1, this.rw, si);
    this.timer = 0;
    this._beginPaths();
    this.emit('reset');
  }

  // ── お手本 ──
  startDemo(si = this.startIdx) {
    this.mode = 'demo';
    this.phase = 'demo';
    this.startIdx = si;
    this._newEpisode(si);
    this.demoPath = [[this.ep.x[0], this.ep.y[0]]];
    this.demoAdded = 0;
    this.demoSteps0 = this.im.demoSteps;
    this.emit('demoStart');
  }

  // 人の操作（お手本中は1歩すすむ、まかせ中は手助け）
  input(a) {
    if (this.mode === 'demo') this._demoStep(a);
    else if (this.mode === 'auto') this.pending = a;
  }

  _demoStep(a) {
    const ep = this.ep;
    if (ep.allDone) return;
    ep.observe(0, this.obs);
    const obs = this.obs.slice();
    ep.step([a]);
    const bumped = (ep.ev[0] & EV_BUMP) !== 0;
    if (!bumped) {
      // ぶつかった操作はすぐ言い直すので、お手本としては使わない
      this.im.add(obs, a, 1);
      this.demoAdded++;
      this.im.demoSteps++;
    }
    this._pushPaths();
    this.demoPath.push([ep.x[0], ep.y[0]]);
    this.phaseT = 0;
    this.emit('step', { human: true, bumped });
    if (ep.allDone) {
      if (!ep.succ[0]) {
        // 落ちた・やられた直前のお手本は「まずいお手本」なので捨てる
        const drop = Math.min(this.demoAdded, 2);
        this.im.dropLast(drop);
        this.im.demoSteps -= drop;
        this.demoAdded -= drop;
      }
      this.im.demos++;
      this.emit('demoEnd', { succ: ep.succ[0], cause: ep.cause[0], added: this.demoAdded });
      this.mode = 'idle'; this.phase = 'idle';
      if (this.demoAdded > 0) this.startTraining(300);
    }
  }

  cancelDemo() {
    if (this.mode !== 'demo') return;
    this.mode = 'idle'; this.phase = 'idle';
    if (this.demoAdded > 0) { this.im.demos++; this.startTraining(300); }
    else this._newEpisode();
  }

  // ── 学習（数フレームに分けて進める）──
  startTraining(steps = 300) {
    if (this.im.count < 4) return;
    this.mode = 'train'; this.phase = 'train'; this.phaseT = 0;
    this.trainLeft = steps; this.trainTotal = steps;
    this.emit('trainStart');
  }

  get trainProgress() { return this.trainTotal ? 1 - this.trainLeft / this.trainTotal : 1; }

  _finishTraining() {
    this.im.evalAcc();
    const res = evalPolicy(this.stage, this.rw, (o) => this.im.greedy(o));
    this.lastEval = res;
    this.emit('trained', { res });
    // 免許皆伝は、このあとAIだけで実際にゴールした時に渡す
    this.pendingMedal = res.succ && !this.medal ? { cost: this.im.demoSteps + this.im.fixes, human: this.im.demoSteps + this.im.fixes, steps: res.maxSteps, unit: '歩' } : null;
    this.save();
    // 覚えたら、そのままAIにまかせて見せる
    this.startAuto();
  }

  // ── AIにまかせる ──
  startAuto(si = null) {
    if (si == null) {
      // スタートが複数ある時は、まだ失敗している地点を優先して見せる
      si = this.startIdx;
      if (this.stage.multiStart && this.lastEval) {
        const bad = this.lastEval.per.findIndex((r) => !r.succ);
        si = bad >= 0 ? bad : (this.autoStart++ % this.stage.starts.length);
      }
    }
    this.mode = 'auto'; this.phase = 'run';
    this.pending = -1; this.usedHelp = false; this.autoFixes = 0;
    this._newEpisode(si);
    this.emit('autoStart', { si });
  }

  stop() {
    if (this.mode === 'auto' || this.mode === 'demo') { this.mode = 'idle'; this.phase = 'idle'; this._newEpisode(); }
  }

  _doStep() {
    if (this.mode !== 'auto') return;
    const ep = this.ep;
    ep.observe(0, this.obs);
    let a, helped = false;
    if (this.pending >= 0) {
      a = this.pending; this.pending = -1; helped = true;
      // 手助け（DAgger）：AIがこの場面で迷ったので、正解として重く覚える
      this.im.add(this.obs, a, 3);
      this.im.fixes++;
      this.autoFixes++;
      this.usedHelp = true;
    } else a = this.im.greedy(this.obs);
    ep.step([a]);
    this._pushPaths();
    this.emit('step', { helped });
    if (ep.allDone) {
      this.im.aiRuns++;
      if (!this.usedHelp && ep.succ[0]) this.im.aiClears++;
      this.im.history.push({ n: this.im.aiRuns, succ: ep.succ[0] && !this.usedHelp ? 1 : 0, helped: this.usedHelp ? 1 : 0 });
      if (this.im.history.length > 100) this.im.history.shift();
      this.emit('airun', { succ: ep.succ[0], helped: this.usedHelp, cause: ep.cause[0], fixes: this.autoFixes });
      if (this.pendingMedal && ep.succ[0] && !this.usedHelp) { this._award(this.pendingMedal); this.pendingMedal = null; }
      this.mode = 'idle'; this.phase = 'idle';
      if (this.usedHelp) this.startTraining(200);   // 手助けしたデータで学び直す
      else this.save();
    }
  }

  update(dt) {
    if (this.paused) return;
    this.phaseT += dt;
    if (this.mode === 'train') {
      // 1フレームに少しずつ
      const n = Math.min(this.trainLeft, 12);
      this.im.train(n, 32);
      this.trainLeft -= n;
      if (this.trainLeft <= 0 && this.phaseT > 0.8) this._finishTraining();
      return;
    }
    if (this.mode === 'demo' && this.holdDir >= 0) {
      this.holdT += dt;
      if (this.holdT > 0.32) { this.holdT -= 0.16; this._demoStep(this.holdDir); }
    }
    if (this.mode === 'auto') {
      this.timer += dt;
      if (this.timer >= this.stepDur) { this.timer -= this.stepDur; this._doStep(); }
    }
  }

  get frac() {
    if (this.mode === 'auto') return Math.min(1, this.timer / this.stepDur);
    if (this.mode === 'demo') return Math.min(1, this.phaseT / 0.14);
    return 1;
  }

  // お手本中のボタン長押し
  hold(a) { this.holdDir = a; this.holdT = 0; }
  release() { this.holdDir = -1; }

  clearData() {
    this.im.clearData();
    this.im.demos = 0; this.im.demoSteps = 0; this.im.fixes = 0;
    this.save();
  }

  resetBrain() {
    this.app.game.clearBrain(this.def.id, 'il');
    this.im = new Imitator({});
    this.lastEval = null;
    this.mode = 'idle'; this.phase = 'idle';
    this._newEpisode();
  }

  actFn() { const im = this.im; return (o) => im.greedy(o); }
  save() { this.app.game.saveBrain(this.def.id, 'il', this.im.serialize(600)); }
  get episodes() { return this.im.demos; }
}
