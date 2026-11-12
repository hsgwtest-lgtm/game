// 進み具合の保存（この端末の中だけ）
import { STAGES } from './stages.js';
import { METHOD_ORDER } from '../ml/models.js';

const KEY = 'monban-save-v1';
const blank = () => ({ stars: {}, best: {}, stamps: {}, daily: {}, streak: 0, lastDaily: null, nightBest: 0, nightBestWave: 0, plays: 0, seenHow: false, seenCards: {} });
let data = blank();
try { const raw = localStorage.getItem(KEY); if (raw) data = Object.assign(blank(), JSON.parse(raw)); } catch (e) { /* 保存が使えなくても遊べる */ }
const flush = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 同上 */ } };

export const save = {
  get data() { return data; },
  stars: (id) => data.stars[id] || 0,
  cleared: (id) => (data.stars[id] || 0) > 0,
  // 開いているステージ: 1つ前を合格していれば遊べる
  open: (id) => id === 0 || (data.stars[id - 1] || 0) > 0,
  nextStage() { for (const s of STAGES) if (!save.cleared(s.id)) return s.id; return STAGES.length - 1; },
  unlocked() {
    const set = new Set(['linear']);
    for (const s of STAGES) if (s.reward && save.cleared(s.id)) set.add(s.reward);
    return METHOD_ORDER.filter((m) => set.has(m));
  },
  totalStars() { return Object.values(data.stars).reduce((a, b) => a + b, 0); },
  stampCount() { return Object.values(data.stamps).reduce((a, o) => a + Object.keys(o).length, 0); },
  stampTotal() { return STAGES.reduce((a, s) => a + s.cards.length, 0); },
  recordStage(id, { stars, acc, used, method }) {
    const first = !save.cleared(id) && stars > 0;
    if (stars > (data.stars[id] || 0)) data.stars[id] = stars;
    const b = data.best[id];
    if (stars > 0 && (!b || acc > b.acc || (acc === b.acc && used < b.used))) data.best[id] = { acc, used, method };
    let newStamp = false;
    if (stars > 0) { data.stamps[id] = data.stamps[id] || {}; if (!data.stamps[id][method]) { data.stamps[id][method] = 1; newStamp = true; } }
    data.plays++; flush();
    return { first, newStamp };
  },
  recordDaily(key, score, passed) {
    const prev = data.daily[key];
    const better = !prev || score > prev.score;
    if (better) data.daily[key] = { score, passed: passed || (prev && prev.passed) || false };
    if (passed && data.lastDaily !== key) {
      const y = new Date(key + 'T00:00:00'); y.setDate(y.getDate() - 1);
      const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
      data.streak = data.lastDaily === yk ? data.streak + 1 : 1;
      data.lastDaily = key;
    }
    // 古い記録は30日ぶんだけ残す
    const keys = Object.keys(data.daily).sort(); while (keys.length > 30) delete data.daily[keys.shift()];
    data.plays++; flush();
    return better;
  },
  recordNight(score, wave) {
    const better = score > data.nightBest;
    if (better) { data.nightBest = score; data.nightBestWave = wave; }
    data.plays++; flush(); return better;
  },
  mark(key) { data[key] = true; flush(); },
  markCard(m) { data.seenCards[m] = 1; flush(); },
  reset() { data = blank(); flush(); },
};
