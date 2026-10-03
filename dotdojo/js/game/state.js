// 進み具合・記録・脳の保存
// 修行場ごと・流派ごとに：脳（学習の途中経過）、ごほうびの設定、免許皆伝の記録 を持つ。

import { store } from '../core/storage.js';
import { STAGES } from '../sim/stages.js';
import { BASE_REWARD } from '../sim/env.js';

export const DEFAULT_SETTINGS = { sound: true, bgm: true, outline: true, dither: 0.08, tempo: 1 };

export class GameState {
  constructor() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.progress = { unlocked: 1, seen: {} };
    this.records = {};   // records[stageId][school] = { got, cost, steps, demos, at }
    this.dirty = new Set();
    this.brains = {};    // キャッシュ: brains[stageId:school] = 保存データ
  }

  load() {
    const s = store.get('settings');
    if (s) Object.assign(this.settings, s);
    const p = store.get('progress');
    if (p) this.progress = Object.assign({ unlocked: 1, seen: {} }, p);
    this.records = store.get('records') || {};
    this._recalcUnlock();
  }

  saveSettings() { store.set('settings', this.settings); }
  saveProgress() { store.set('progress', this.progress); store.set('records', this.records); }

  // ── 記録 ──
  rec(stageId, school) {
    const r = this.records[stageId];
    return r ? r[school] || null : null;
  }

  // 免許皆伝（印）を記録する。初めてなら true
  award(stageId, school, info) {
    if (!this.records[stageId]) this.records[stageId] = {};
    const old = this.records[stageId][school];
    const first = !old || !old.got;
    const r = Object.assign({}, old || {}, { got: true, at: Date.now() });
    // コスト（かかった回数）は少ないほど良い記録。最初の皆伝時の値を残し、より少なければ更新
    if (first || (info.cost != null && info.cost < (old.cost ?? Infinity))) r.cost = info.cost;
    if (info.steps && (!r.steps || info.steps < r.steps)) r.steps = info.steps;
    if (info.human != null && (first || info.human < (old.human ?? Infinity))) r.human = info.human;
    if (info.unit) r.unit = info.unit;
    this.records[stageId][school] = r;
    this._recalcUnlock();
    this.saveProgress();
    return first;
  }

  medalCount() {
    let n = 0;
    for (const id in this.records) for (const k in this.records[id]) if (this.records[id][k].got) n++;
    return n;
  }

  stageMedals(stageId) {
    const r = this.records[stageId] || {};
    return { ga: !!(r.ga && r.ga.got), rl: !!(r.rl && r.rl.got), il: !!(r.il && r.il.got) };
  }

  _recalcUnlock() {
    let u = 1;
    for (let i = 0; i < STAGES.length; i++) {
      const m = this.stageMedals(STAGES[i].id);
      if (m.ga || m.rl || m.il) u = Math.max(u, i + 2);
    }
    if (this.progress.allOpen) u = STAGES.length;
    this.progress.unlocked = Math.min(STAGES.length, Math.max(this.progress.unlocked || 1, u));
  }

  isUnlocked(i) { return i < this.progress.unlocked; }

  // ── 脳（学習の途中経過）──
  loadBrain(stageId, school) {
    const k = stageId + ':' + school;
    if (this.brains[k] !== undefined) return this.brains[k];
    const v = store.get('brain.' + k);
    this.brains[k] = v || null;
    return this.brains[k];
  }

  saveBrain(stageId, school, data) {
    const k = stageId + ':' + school;
    this.brains[k] = data;
    if (!store.set('brain.' + k, data)) {
      // 容量オーバーなら、データを減らしてもう一度
      if (data && data.X) { const d2 = Object.assign({}, data); delete d2.X; delete d2.Y; delete d2.W; d2.n = 0; store.set('brain.' + k, d2); }
    }
  }

  clearBrain(stageId, school) {
    const k = stageId + ':' + school;
    this.brains[k] = null;
    store.remove('brain.' + k);
  }

  // ── ごほうびの設定（修行場×流派）──
  rewards(stageId, school) {
    const def = STAGES.find((s) => s.id === stageId);
    const saved = store.get('rw.' + stageId + ':' + school);
    return Object.assign({}, BASE_REWARD, (def && def.rewards) || {}, saved || {});
  }
  saveRewards(stageId, school, rw) {
    const def = STAGES.find((s) => s.id === stageId);
    const base = Object.assign({}, BASE_REWARD, (def && def.rewards) || {});
    const diff = {};
    for (const k in rw) if (rw[k] !== base[k]) diff[k] = rw[k];
    store.set('rw.' + stageId + ':' + school, diff);
  }

  resetAll() {
    store.clearAll();
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.progress = { unlocked: 1, seen: {} };
    this.records = {};
    this.brains = {};
  }
}
