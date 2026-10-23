// 育成セッション: 1匹の生き物の「進化」と「成長の記録」をまとめて管理する
//
//  ・ゆっくり成長（標準）: 画面で見ている世代の1つ先まで計算して待つ。1世代ずつチャンピオンの走りを見られる
//  ・急成長: 休まず世代を進める（ワーカーを全部使う）
//  ・世代ごとに: チャンピオンを記録（成長アルバム）、レベル・わざ・記録の判定、ぼうけんのしょ

import { GA, DEFAULT_POP } from './ga.js';
import { compileBody, normalizeVoxels } from '../sim/body.js';
import { brainLayout, DEFAULT_HIDDEN, transplantGenome } from '../sim/brain.js';
import { normalizeEnv, envKey, GRAVITIES, OBJECTIVES } from '../sim/creature.js';
import { TERRAINS } from '../sim/terrain.js';
import { scoreOf, levelFor, titleFor, classifyMove, MOVES, formatFit, formatDelta } from './growth.js';
import { db, makeId } from '../core/db.js';
import { randomSeed } from '../core/rng.js';

const MILESTONES = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];
const KEEP_INFOS = 8;
const MAX_JOURNAL = 400;
const MAX_CHAMPS = 1500;

export function envLabel(env) {
  const e = normalizeEnv(env);
  return `${TERRAINS[e.terrain].name}・${GRAVITIES[e.gravity].name}・${OBJECTIVES[e.objective].name}`;
}

export function newRecord({ name, voxels, env, hidden = DEFAULT_HIDDEN, popSize = DEFAULT_POP, seedGenomes = null, parent = null }) {
  const e = normalizeEnv(env);
  const rec = {
    v: 1, id: makeId(), name: name || 'ナナシ', created: Date.now(), updated: Date.now(),
    voxels: normalizeVoxels(voxels), hidden, popSize, seed: randomSeed(),
    env: e, envs: [e], ga: null, gen: 0,
    history: [], journal: [], level: 1, scores: { distance: 0, jump: 0 }, base: { distance: null, jump: null },
    moves: {}, bests: {}, flags: {}, last: null, parent, seedGenomes,
  };
  rec.journal.push({ gen: 0, kind: 'born', text: parent ? `${parent.name} を かいぞうして うまれた！` : `${rec.name} が うまれた！` });
  return rec;
}

// 体を改造: 脳はできるだけ引きつぎ、新しい記録として始める
export function remodelRecord(oldRec, oldSession, voxels, name) {
  const body = compileBody(voxels);
  const L = brainLayout(body, oldRec.hidden);
  const from = oldSession ? oldSession.L : brainLayout(compileBody(oldRec.voxels), oldRec.hidden);
  let seeds = [];
  if (oldSession) {
    const ranked = oldSession.ga.pop.slice().sort((a, b) => (b.fit ?? -9) - (a.fit ?? -9));
    seeds = ranked.slice(0, 6).map(i => transplantGenome(i.g, from, L));
  } else if (oldRec.ga) {
    seeds = oldRec.ga.pop.slice(0, 6).map(i => transplantGenome(Float64Array.from(i.g), from, L));
  }
  const rec = newRecord({
    name: name || oldRec.name, voxels, env: oldRec.env, hidden: oldRec.hidden, popSize: oldRec.popSize,
    seedGenomes: seeds.length ? seeds.map(g => Float32Array.from(g)) : null,
    parent: { id: oldRec.id, name: oldRec.name, gen: oldRec.gen },
  });
  return rec;
}

export class Session {
  constructor(rec, champs, pool) {
    this.rec = rec;
    this.pool = pool;
    this.body = compileBody(rec.voxels);
    this.L = brainLayout(this.body, rec.hidden);
    if (rec.ga) this.ga = GA.fromJSON(this.L, rec.ga);
    else {
      const seeds = rec.seedGenomes ? rec.seedGenomes.map(g => Float64Array.from(g)) : null;
      this.ga = new GA(this.L, { size: rec.popSize, seed: rec.seed, seedGenomes: seeds });
      rec.seedGenomes = null;
    }
    this.champs = champs || [];
    this.infos = new Map();
    this.mode = 'slow';
    this.paused = false;
    this.viewGen = this.champs.length ? this.champs[this.champs.length - 1].gen : -1;
    this.busy = false;
    this.epoch = 0;
    this.error = null;
    this.onInfo = null;
    this.dirty = false;
    this.pendingChamps = [];
    this.lastSave = 0;
    this.genTimes = [];
    this.envIdx = this._envIndex(rec.env);
  }

  get lastGen() { return this.champs.length ? this.champs[this.champs.length - 1].gen : -1; }
  get latest() { return this.infos.get(this.lastGen) || null; }
  champAt(gen) {
    // gen 以下でいちばん新しいチャンピオン
    let lo = 0, hi = this.champs.length - 1, ans = null;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (this.champs[m].gen <= gen) { ans = this.champs[m]; lo = m + 1; } else hi = m - 1;
    }
    return ans;
  }
  envOf(e) { return this.rec.envs[e] || this.rec.env; }

  _envIndex(env) {
    const k = envKey(env);
    let i = this.rec.envs.findIndex(x => envKey(x) === k);
    if (i < 0) { this.rec.envs.push(normalizeEnv(env)); i = this.rec.envs.length - 1; }
    return i;
  }

  get task() {
    return { voxels: this.rec.voxels, bodyKey: this.body.key, hidden: this.rec.hidden, env: this.rec.env };
  }

  // 毎フレーム呼ぶ: 必要なら次の世代の計算を始める
  update() {
    if (this.busy || this.paused || this.error) return;
    const ahead = this.mode === 'fast' ? Infinity : 1;
    if (this.lastGen >= this.viewGen + ahead) return;
    this._runGeneration();
  }

  async _runGeneration() {
    this.busy = true;
    const epoch = this.epoch;
    const t0 = performance.now();
    try {
      const pend = this.ga.pending();
      const parallel = (this.mode === 'fast' || this.lastGen < 0) ? this.pool.maxWorkers : Math.min(2, this.pool.maxWorkers);
      const res = await this.pool.evaluate(this.task, pend.map(i => i.g), parallel);
      if (epoch !== this.epoch) return;
      pend.forEach((ind, k) => { ind.fit = res[k].fitness; ind.res = res[k]; });
      const summary = this.ga.breed();
      const info = this._process(summary);
      this.genTimes.push(performance.now() - t0);
      if (this.genTimes.length > 10) this.genTimes.shift();
      this.dirty = true;
      if (this.onInfo) this.onInfo(info);
      this.save();
    } catch (e) {
      console.error(e);
      if (epoch === this.epoch) this.error = String(e && e.message || e);
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }

  // 1世代分のまとめ → 成長の判定
  _process(summary) {
    const rec = this.rec, env = rec.env, e = this.envIdx;
    const gen = summary.gen;
    const best = summary.best;
    const prev = this.champs.length ? this.champs[this.champs.length - 1] : null;
    const prevSame = prev && prev.e === e ? prev : null;
    const delta = prevSame ? best.fit - prevSame.fit : null;
    const move = classifyMove(best.res, env, this.body.size.y);
    const champ = {
      cid: rec.id, gen, g: Float32Array.from(best.g), fit: best.fit, res: best.res, e, move,
      id: best.id, kind: best.kind, mean: summary.mean,
    };
    rec.history.push({ gen, best: best.fit, mean: summary.mean, e });
    const events = [];
    const obj = env.objective;
    // はじめて前に
    if (obj === 'distance' && rec.flags.first === undefined && best.fit >= 0.1) {
      rec.flags.first = gen;
      events.push({ kind: 'first' });
    }
    // 記録
    const k = envKey(env);
    const old = rec.bests[k];
    let isRecord = false;
    if (!old || best.fit > old.fit + 1e-9) {
      isRecord = !!old;
      const gain = old ? best.fit - old.fit : 0;
      rec.bests[k] = { fit: best.fit, gen };
      if (old && gain >= Math.max(0.05, Math.abs(old.fit) * 0.15)) events.push({ kind: 'record', fit: best.fit, gain });
    }
    // レベル = 生まれたときから どれだけ のびたか（成長）。最初の世代は LV1
    if (!rec.base) rec.base = { distance: null, jump: null };
    const sc = scoreOf(env, best.fit);
    if (rec.base[obj] === null || rec.base[obj] === undefined) rec.base[obj] = sc;
    const growth = Math.max(0, sc - rec.base[obj]);
    if (growth > (rec.scores[obj] || 0)) rec.scores[obj] = growth;
    const lv = Math.max(rec.level, levelFor('distance', rec.scores.distance || 0), levelFor('jump', rec.scores.jump || 0));
    if (lv > rec.level) {
      const before = rec.level;
      const t0 = titleFor(before), t1 = titleFor(lv);
      rec.level = lv;
      events.push({ kind: 'level', from: before, lv, title: t1, newTitle: t0 !== t1 });
    }
    // わざ
    if (move && rec.moves[move] === undefined) {
      rec.moves[move] = gen;
      events.push({ kind: 'move', key: move });
    }
    if (summary.boosted) events.push({ kind: 'boost' });
    if (MILESTONES.includes(gen)) events.push({ kind: 'milestone' });
    for (const ev of events) {
      ev.gen = gen;
      ev.text = eventText(ev, rec, env);
      rec.journal.push({ gen, kind: ev.kind, text: ev.text });
    }
    if (rec.journal.length > MAX_JOURNAL) rec.journal.splice(1, rec.journal.length - MAX_JOURNAL);
    champ.level = rec.level;
    champ.score = rec.scores[obj] || 0;
    this.champs.push(champ);
    this.pendingChamps.push(champ);
    rec.gen = gen + 1;
    rec.last = { gen, fit: best.fit, move, obj };
    rec.updated = Date.now();
    const ranked = summary.ranked.map(i => ({ id: i.id, fit: i.fit, kind: i.kind, g: i.g, res: i.res, pa: i.pa }));
    const challenger = ranked.find(i => i.kind !== 'elite' && i.id !== best.id) || null;
    const info = {
      gen, env, e, champ, fit: best.fit, delta, mean: summary.mean, ranked, challenger,
      events, level: rec.level, move, isRecord, prevFit: prevSame ? prevSame.fit : null,
      newChamp: !prev || prev.id !== best.id,
    };
    this.infos.set(gen, info);
    for (const g of this.infos.keys()) if (g < gen - KEEP_INFOS) this.infos.delete(g);
    this._thin();
    return info;
  }

  _thin() {
    if (this.champs.length <= MAX_CHAMPS) return;
    const keep = new Set(this.rec.journal.map(j => j.gen));
    const drop = [];
    const last = this.lastGen;
    this.champs = this.champs.filter(c => {
      if (c.gen % 5 === 0 || keep.has(c.gen) || c.gen > last - 200) return true;
      drop.push(c.gen);
      return false;
    });
    db.deleteChamps(this.rec.id, drop);
  }

  setMode(m) {
    this.mode = m;
  }

  // 環境を変える（地形・重力・目的）
  setEnv(env) {
    const e = normalizeEnv(env);
    if (envKey(e) === envKey(this.rec.env)) return false;
    this.epoch++;
    this.busy = false;
    this.rec.env = e;
    this.envIdx = this._envIndex(e);
    this.ga.invalidate();
    const ev = { gen: this.lastGen + 1, kind: 'env', text: `かんきょうを かえた: ${envLabel(e)}` };
    this.rec.journal.push(ev);
    this.dirty = true;
    this.save(true);
    return true;
  }

  rename(name) {
    this.rec.name = name;
    this.dirty = true;
    this.save(true);
  }

  // ゆっくり保存（4秒に1回まで）。force で今すぐ
  save(force = false) {
    const now = Date.now();
    if (!force && now - this.lastSave < 4000) return;
    if (!this.dirty && !this.pendingChamps.length) return;
    this.lastSave = now;
    this.rec.ga = this.ga.toJSON();
    const champs = this.pendingChamps;
    this.pendingChamps = [];
    this.dirty = false;
    db.putChamps(champs);
    db.putCreature(this.rec);
  }

  destroy() {
    this.save(true);
    this.epoch++;
    this.onInfo = null;
  }

  // 1世代あたりの計算時間（秒）
  get genSeconds() {
    if (!this.genTimes.length) return 0;
    return this.genTimes.reduce((a, b) => a + b, 0) / this.genTimes.length / 1000;
  }
}

function eventText(ev, rec, env) {
  switch (ev.kind) {
    case 'first': return 'はじめて まえに すすんだ！';
    case 'record': return `きろく ${formatFit(env.objective, ev.fit)}（${formatDelta(env.objective, ev.gain)}）`;
    case 'level': return ev.newTitle ? `レベル${ev.lv}！ しょうごう「${ev.title}」` : `レベル${ev.lv} に あがった！`;
    case 'move': return `わざ「${MOVES[ev.key].name}」を おぼえた！`;
    case 'boost': return 'のびなやみ… へんいを つよくして ためす';
    case 'milestone': return `${ev.gen}せだいめ に とうたつ`;
    default: return '';
  }
}
