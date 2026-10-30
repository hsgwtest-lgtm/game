// 試練ごとの進化（学習）の流れ: 本能の受けつぎ・保存・成績の読み取り
import { activeLayout, randomRow, ROW_FLOATS, idxWe, idxWo, idxOB, NE, NO, HMAX } from '../sim/brain.js';
import { STAGE_DEFS } from '../sim/stages.js';
import { Evolution } from '../ml/evolve.js';
import { RNG, hashSeed } from '../sim/rng.js';
import { TRIALS, TRIAL_BY_ID, trialIndex } from './story.js';
import { writeSave } from './save.js';

export function layoutFor(id) {
  const d = STAGE_DEFS[id];
  return activeLayout(d.senses, d.hidden);
}

// 月のリズム: 完全にそろったときの値（成績を 0..1 にそろえるため）
export const SYNC_IDEAL = (() => {
  let s = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const c = 0.5 + 0.5 * Math.cos((i / n) * Math.PI * 2);
    s += Math.max(0, c * c - 0.375);
  }
  return s / n;
})();

// 前の試練の本能を受けつぐ。ふえた神経には小さな入力の重みだけ入れる（出力は0なので、ふるまいは変わらない）
export function growRow(row, fromLayout, toLayout, rng) {
  const out = Float32Array.from(row);
  for (let j = fromLayout.hidden; j < toLayout.hidden; j++) {
    for (let i = 0; i < NE; i++) if (toLayout.maskE[i]) out[idxWe(j, i)] = rng.gauss() * 0.25;
    for (let i = 0; i < NO; i++) if (toLayout.maskO[i]) out[idxWo(j, i)] = rng.gauss() * 0.25;
  }
  // 新しく光れるようになったら、光の出口は「ほんの少し光らない」から始める
  if (!fromLayout.outMask[1] && toLayout.outMask[1]) out[idxOB(1)] = -0.15;
  // 使えなくなった重みは0に（形をそろえる）
  const keep = new Uint8Array(ROW_FLOATS);
  toLayout.idx.forEach((i) => { keep[i] = 1; });
  for (let i = 0; i < ROW_FLOATS; i++) if (!keep[i]) out[i] = 0;
  return out;
}

// 受けついだ本能のゆらぎ: 前からある重みは小さく、新しくふえた重みは大きく
export function inheritSigma(fromLayout, toLayout, { oldS = 0.1, newS = 0.4 } = {}) {
  const had = new Set(fromLayout.idx);
  return Float32Array.from(toLayout.idx, (ix, i) => {
    const isNew = !had.has(ix);
    const direct = toLayout.kind[i] === 4;
    return isNew ? (direct ? newS * 2 : newS) : (direct ? oldS * 1.5 : oldS);
  });
}

export function initialRowInfo(id, save) {
  const L = layoutFor(id);
  const t = save.trials[id];
  if (t && t.champion && t.champion.length === ROW_FLOATS) return { row: Float32Array.from(t.champion), from: null };
  const idx = trialIndex(id);
  const rng = new RNG(hashSeed('init', id, save.created || 1));
  for (let i = idx - 1; i >= 0; i--) {
    const prev = TRIALS[i].id;
    const pt = save.trials[prev];
    if (pt && pt.champion && pt.champion.length === ROW_FLOATS) {
      const fromL = layoutFor(prev);
      return { row: growRow(Float32Array.from(pt.champion), fromL, L, rng), from: fromL };
    }
  }
  return { row: randomRow(L, rng), from: null };
}

export function initialRow(id, save) {
  return initialRowInfo(id, save).row;
}

export function metricOf(kind, { alive, goal, sync }, k) {
  if (kind === 'goal') return goal[k];
  if (kind === 'sync') return Math.max(0, sync[k] / SYNC_IDEAL);
  return alive[k];
}

// 1つの試練の学習セッション
export class TrialSession {
  constructor(app, id) {
    this.app = app;
    this.id = id;
    this.trial = TRIAL_BY_ID[id];
    this.def = STAGE_DEFS[id];
    this.layout = layoutFor(id);
    this.kind = 'trial';
    this.metric = this.trial.metric;
    this.metricName = this.trial.metricName;
    this.pass = this.trial.pass;
  }

  makeCfg(seed) { return this.def.make(seed); }

  attach(swarm) {
    const save = this.app.save;
    const st = save.trials[this.id] || (save.trials[this.id] = {});
    const info = initialRowInfo(this.id, save);
    const row0 = info.row;
    this.inherited = !!info.from;
    this.evo = new Evolution(swarm, {
      stage: this.def, layout: this.layout, row0,
      seed: hashSeed(this.id, save.created || 1, st.restarts || 0),
      makeCfg: (s) => this.makeCfg(s),
      sigmaVec: info.from ? inheritSigma(info.from, this.layout, { oldS: this.def.inheritOld ?? 0.1 }) : null,
    });
    if (st.evo && st.evo.es && st.evo.es.mu && st.evo.es.mu.length === this.layout.idx.length) {
      try { this.evo.load(st.evo); } catch (e) { /* 読めなければ最初から */ }
    }
    this.findings = st.findings || (st.findings = []);
    this.metricHist = st.metricHist || (st.metricHist = []);
    return this.evo;
  }

  // 世代が終わったとき
  onGeneration(ev) {
    const save = this.app.save;
    const st = save.trials[this.id];
    const n = 2 + this.evo.pairs * 2;
    const m = [];
    for (let k = 0; k < n; k++) m.push(metricOf(this.metric, ev, k));
    const rec = { g: ev.rec.gen, c: m[0], e: m[1], b: Math.max(...m), f: ev.rec.center };
    this.metricHist.push(rec);
    if (this.metricHist.length > 600) this.metricHist.splice(0, this.metricHist.length - 600);
    st.champion = Array.from(this.evo.eliteRow());
    st.evo = this.evo.toJSON();
    writeSave(save);
    return { metrics: m, rec };
  }

  championRow() { return this.evo ? this.evo.eliteRow() : initialRow(this.id, this.app.save); }

  restart() {
    const save = this.app.save;
    const st = save.trials[this.id] || {};
    st.restarts = (st.restarts || 0) + 1;
    delete st.evo; delete st.champion; st.findings = []; st.metricHist = [];
    save.trials[this.id] = st;
    writeSave(save, true);
  }
}

export { HMAX };
