// 記録（★・最高の合格率・最少のお手本数や練習量）。この端末の中（localStorage）だけに保存する
import { STAGES, METHODS, starsFor } from '../core/stages.js';

const KEY = 'minarai.v1';

export function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
  if (!s || s.v !== 1) s = { v: 1, st: {}, models: {}, last: {}, help: false, reward: null, augment: true };
  s.st = s.st || {}; s.models = s.models || {}; s.last = s.last || {};
  return s;
}

export function persist(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 保存できなくても遊べる */ }
}

export function rec(s, stageId, method) {
  const a = s.st[stageId] || (s.st[stageId] = {});
  return a[method] || (a[method] = { best: 0, stars: 0, tries: 0, cost: null, min: {}, inherit: false, solo: 0 });
}

export function stageStars(s, stageId) {
  let n = 0;
  for (const m of METHODS) n += (s.st[stageId] && s.st[stageId][m.id] ? s.st[stageId][m.id].stars : 0);
  return n;
}

export function totalStars(s) {
  let n = 0;
  for (const st of STAGES) n += stageStars(s, st.id);
  return n;
}

// 現場が開いているか: 1つめ、または 前の現場でどれかの学び方が★1以上
export function unlocked(s, idx) {
  if (idx <= 0) return true;
  return stageStars(s, STAGES[idx - 1].id) > 0 || stageStars(s, STAGES[idx].id) > 0;
}

// かかった手間の大小（少ないほど良い記録）。模倣はお手本の本数、強化は練習量、模倣→強化は練習量→本数の順で比べる
function costKey(method, c) {
  if (method === 'bc') return c.demos;
  if (method === 'rl') return c.steps;
  return c.steps + c.demos * 1e-3;
}

// 検定の結果を記録する。戻り値 { stars, newBest, gained, records: [★の数…]（最少記録を更新した★）, unlockedNext }
export function recordExam(s, stageId, method, rate, cost, inherit) {
  const r = rec(s, stageId, method);
  const idx = STAGES.findIndex((x) => x.id === stageId);
  const wasOpen = idx + 1 < STAGES.length ? unlocked(s, idx + 1) : true;
  const stars = starsFor(rate);
  r.tries++;
  const out = { stars, newBest: false, gained: Math.max(0, stars - r.stars), records: [], unlockedNext: null };
  if (rate > r.best + 1e-9) { r.best = rate; r.cost = cost; r.inherit = !!inherit; out.newBest = true; }
  if (stars > r.stars) r.stars = stars;
  // 自力: お手本ロボを1本も使わず、引き継ぎもなしで取った★
  if (method !== 'rl' && !inherit && cost.robot === 0 && cost.demos > 0 && stars > (r.solo || 0)) { r.solo = stars; out.solo = stars; }
  if (!inherit) {
    for (let k = 1; k <= stars; k++) {
      const old = r.min[k];
      if (!old || costKey(method, cost) < costKey(method, old)) { r.min[k] = cost; if (old) out.records.push(k); }
    }
  }
  if (!wasOpen && idx + 1 < STAGES.length && unlocked(s, idx + 1)) out.unlockedNext = STAGES[idx + 1];
  persist(s);
  return out;
}

export function noteModels(s, stageId, slots) {
  const m = s.models[stageId] || (s.models[stageId] = {});
  for (const k of Object.keys(slots)) m[k] = { ready: !!slots[k].ready, steps: slots[k].rlSteps || 0, demos: slots[k].bcDemos || 0, est: slots[k].estimate };
  persist(s);
}
