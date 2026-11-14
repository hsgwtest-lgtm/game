// replay.js — ベスト個体のリプレイ（純粋モジュール）
//   シミュレーションは種つき乱数で決まるので、「その世代のはじめの状態（スナップショット）」さえあれば、
//   同じシーズンを1ターンも違わずにもう一度起こせる。それを全ターン記録して、巻き戻し・早送りできるようにする
import { NC } from './world.js';
import { Island, actorFromSnap } from './sim.js';

// 1ターン分の記録: 草（0〜255）と、生き物の [id, 方式, x, y, 前のx, 前のy, 行動, 体力, 生きている, 世代内の深さ, 家族番号, 試し行動]
export const REC = { ID: 0, M: 1, X: 2, Y: 3, PX: 4, PY: 5, ACT: 6, E: 7, ALIVE: 8, DEPTH: 9, SLOT: 10, EXPLORE: 11 };
export const REC_N = 12;

function capture(isl, famIndex) {
  const g = new Uint8Array(NC);
  for (let k = 0; k < NC; k++) g[k] = Math.round(isl.grass[k] * 255);
  const cs = isl.cs;
  const rec = new Int16Array(cs.length * REC_N);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const o = i * REC_N;
    rec[o] = c.id;
    rec[o + 1] = c.m;
    rec[o + 2] = c.x;
    rec[o + 3] = c.y;
    rec[o + 4] = c.px;
    rec[o + 5] = c.py;
    rec[o + 6] = c.act;
    rec[o + 7] = Math.round(Math.max(0, c.e));
    rec[o + 8] = c.alive ? 1 : 0;
    rec[o + 9] = c.depth;
    rec[o + 10] = famIndex.get(c.fam);
    rec[o + 11] = c.explore ? 1 : 0;
  }
  return { grass: g, rec, n: cs.length };
}

// entry: lab.best[m] か lab.latest[m]（{ m, gen, fit, slot, island, snap }）
export function recordReplay(lab, entry) {
  const snap = entry.snap;
  const fakeLab = { terrain: lab.terrain };
  const isl = new Island(fakeLab, snap.island, snap.methods);
  const actors = [];
  for (const m of snap.methods) actors[m] = actorFromSnap(m, snap.states[m]);
  isl.begin(snap, actors);
  const famIndex = new Map(isl.fams.map((f, i) => [f, i]));
  const focusFam = isl.fams.find((f) => f.m === entry.m && f.slot === entry.slot);
  const T = lab.seasonTicks;
  const frames = [capture(isl, famIndex)];
  const famFood = new Float32Array(T + 1);
  const famAlive = new Uint8Array(T + 1);
  famAlive[0] = focusFam ? focusFam.alive : 0;
  for (let t = 0; t < T; t++) {
    isl.step();
    frames.push(capture(isl, famIndex));
    famFood[t + 1] = focusFam ? focusFam.food : 0;
    famAlive[t + 1] = focusFam ? focusFam.alive : 0;
  }
  isl.finish();
  return {
    m: entry.m,
    gen: entry.gen,
    island: snap.island,
    methods: snap.methods.slice(),
    ticks: T,
    frames,
    famFood,
    famAlive,
    focusIndex: focusFam ? famIndex.get(focusFam) : -1,
    focusId: focusFam ? focusFam.founderId : -1,
    finalFood: focusFam ? focusFam.food : 0,
    expectedFood: entry.fit,
    births: focusFam ? focusFam.births : 0,
    members: focusFam ? focusFam.members : 0,
    fams: isl.fams.map((f) => ({ m: f.m, slot: f.slot, food: f.food, births: f.births, members: f.members })),
  };
}

// 記録の中から、ある生き物の足あと（t ターン目まで）
export function trailOf(rep, id, t, maxLen = 40) {
  const out = [];
  for (let i = Math.max(0, t - maxLen); i <= t && i < rep.frames.length; i++) {
    const f = rep.frames[i];
    for (let j = 0; j < f.n; j++) {
      const o = j * REC_N;
      if (f.rec[o] === id) {
        if (f.rec[o + 8]) out.push([f.rec[o + 2], f.rec[o + 3]]);
        break;
      }
    }
  }
  return out;
}
