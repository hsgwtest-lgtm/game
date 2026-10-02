// ゲームの進行状況（保存・読み込み）

import { store } from '../core/storage.js';
import { STAGES } from '../core/config.js';
import { Flock } from '../ml/ga.js';
import { Imitator } from '../ml/imitate.js';

export class GameState {
  constructor() {
    this.settings = { sound: true, bgm: true, cam: 0, speedIdx: 0 };
    // ステージごとの記録: evo=しんかでクリア, teach=おしえたヒナでクリア, race=レースで勝った
    this.progress = { unlocked: 1, stages: {} };
    this.flock = null;
    this.chick = null;
    this.stageIdx = 0;          // そだてるで選んでいるステージ
    this.seen = {};             // 解説を一度見たか
  }

  load() {
    const s = store.get('settings');
    if (s) Object.assign(this.settings, s);
    const p = store.get('progress');
    if (p) Object.assign(this.progress, p);
    const seen = store.get('seen');
    if (seen) this.seen = seen;
    this.stageIdx = Math.min(store.get('stageIdx', 0) || 0, this.progress.unlocked - 1);
    const f = store.get('flock');
    if (f) { try { this.flock = Flock.deserialize(f); } catch (e) { this.flock = null; } }
    const c = store.get('chick');
    if (c) { try { this.chick = Imitator.deserialize(c); } catch (e) { this.chick = null; } }
  }

  saveSettings() { store.set('settings', this.settings); }
  saveProgress() { store.set('progress', this.progress); store.set('seen', this.seen); store.set('stageIdx', this.stageIdx); }
  saveFlock() { if (this.flock) store.set('flock', this.flock.serialize()); }
  saveChick() { if (this.chick) store.set('chick', this.chick.serialize()); }
  saveAll() { this.saveSettings(); this.saveProgress(); this.saveFlock(); this.saveChick(); this._lastSave = Date.now(); }

  // 高速しんか中に毎世代書き込むと重いので、数秒に1回にまとめる
  saveSoon(force = false) {
    const now = Date.now();
    if (force || !this._lastSave || now - this._lastSave > 4000) {
      this.saveProgress();
      this.saveFlock();
      this._lastSave = now;
    }
  }

  ensureFlock(size = 50) {
    if (!this.flock) this.flock = new Flock({ size }).initRandom();
    return this.flock;
  }
  newFlock(size) {
    const old = this.flock;
    this.flock = new Flock({ size: size || (old ? old.size : 50) }).initRandom();
    if (old) { this.flock.mutIdx = old.mutIdx; this.flock.keepOshi = old.keepOshi; }
    this.saveFlock();
    return this.flock;
  }
  ensureChick() {
    if (!this.chick) this.chick = new Imitator();
    return this.chick;
  }

  stageRec(id) {
    if (!this.progress.stages[id]) this.progress.stages[id] = { evo: false, teach: false, race: false, best: 0, teachBest: 0 };
    return this.progress.stages[id];
  }

  // クリアしたら次のステージを開放。新しく開いたら true
  markClear(stageIdx, kind) {
    const st = STAGES[stageIdx];
    const rec = this.stageRec(st.id);
    const first = !rec[kind];
    rec[kind] = true;
    let unlockedNew = false;
    if ((kind === 'evo' || kind === 'teach') && this.progress.unlocked < STAGES.length && stageIdx + 1 >= this.progress.unlocked) {
      this.progress.unlocked = stageIdx + 2;
      unlockedNew = true;
    }
    this.saveProgress();
    return { first, unlockedNew };
  }

  resetAll() {
    store.clearAll();
    this.settings = { sound: true, bgm: true, cam: 0, speedIdx: 0 };
    this.progress = { unlocked: 1, stages: {} };
    this.flock = null; this.chick = null; this.stageIdx = 0; this.seen = {};
  }
}
