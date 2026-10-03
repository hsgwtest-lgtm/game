// ボスの脳を取り出す
import { BOSS_DATA } from './bosses.js';
import { unpackQ8 } from './net.js';

const cache = {};
export function bossNet(key) {
  if (cache[key]) return cache[key];
  const d = BOSS_DATA[key];
  if (!d) return null;
  try { cache[key] = unpackQ8(d.brain); } catch (e) { return null; }
  return cache[key];
}
export function bossInfo(key) { const d = BOSS_DATA[key]; return d ? { deck: d.deck, steps: d.steps } : null; }
