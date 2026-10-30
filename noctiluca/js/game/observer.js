// 観測: 本能（ニューラルネット）に「こんなとき、どうする？」と聞いて、身についたくせを見つける
import { forward, NE, NO, E, O } from '../sim/brain.js';

const res = {};
// 基準の状況: ふつうの元気・中くらいの速さ・何も感じていない
export function probe(row, layout, setFn) {
  const xe = new Float32Array(NE);
  const xo = new Float32Array(NO);
  xe[E.SPEED] = 0.5;
  xe[E.ENERGY] = 0.6;
  if (setFn) setFn(xe, xo);
  for (let i = 0; i < NE; i++) xe[i] *= layout.maskE[i];
  for (let i = 0; i < NO; i++) xo[i] *= layout.maskO[i];
  const r = forward(row, xe, xo, layout.hidden, res);
  return { turn: r.turn, speed: r.speed, glow: layout.outMask[1] ? r.glow : 0, h: r.h, hm: r.hm };
}

const has = (layout, s) => layout.senses.includes(s);

// くせの数値（反応の強さ）
export function traits(row, layout) {
  const t = {};
  const base = probe(row, layout);
  t.baseSpeed = base.speed;
  t.baseGlow = base.glow;
  if (has(layout, 'food')) {
    t.foodTurn = probe(row, layout, (e, o) => { o[O.FOOD] = 0.5; }).turn;
    const on = probe(row, layout, (e) => { e[E.FOOD] = 0.8; });
    t.foodSlow = base.speed - on.speed;
  }
  if (has(layout, 'light')) {
    t.lightTurn = probe(row, layout, (e, o) => { e[E.LIGHT] = 0.3; o[O.LIGHT] = 0.5; }).turn;
  }
  if (has(layout, 'touch')) {
    const w = probe(row, layout, (e, o) => { e[E.WALL] = 0.6; e[E.WALL_F] = 0.6; o[O.WALL] = 0.3; });
    t.wallTurn = -w.turn; // 壁が左にあるとき右へ曲がれば +
  }
  if (has(layout, 'vibe')) {
    const d = probe(row, layout, (e, o) => { e[E.DANGER] = 0.4; o[O.DANGER] = 0.5; });
    t.dangerTurn = -d.turn; // 危険の反対へ曲がれば +
    t.dangerSpeed = probe(row, layout, (e) => { e[E.DANGER] = 0.6; }).speed - base.speed;
    if (layout.outMask[1]) t.dangerGlow = probe(row, layout, (e) => { e[E.DANGER] = 0.6; }).glow - base.glow;
  }
  if (has(layout, 'crowd')) {
    t.crowdTurn = probe(row, layout, (e, o) => { e[E.CROWD] = 0.3; o[O.CROWD] = 0.5; }).turn;
  }
  if (has(layout, 'glow')) {
    const g = probe(row, layout, (e) => { e[E.GLOW] = 0.6; });
    t.glowRelay = g.glow - base.glow;
    t.glowSpeed = g.speed - base.speed;
    t.glowTurn = -probe(row, layout, (e, o) => { e[E.GLOW] = 0.3; o[O.GLOW] = 0.5; }).turn; // 光から離れれば +
    if (has(layout, 'light')) {
      t.lightGlow = probe(row, layout, (e) => { e[E.LIGHT] = 0.8; }).glow - probe(row, layout, (e) => { e[E.LIGHT] = 0.05; }).glow;
    }
  }
  return t;
}

// 見つけたくせ（id, 条件, ことば）
export const FINDINGS = [
  { id: 'foodTurn', when: (t) => t.foodTurn > 0.25, text: '餌のにおいがする方へ曲がるようになった' },
  { id: 'foodSlow', when: (t) => t.foodSlow > 0.12, text: '餌の上では、ゆっくり泳いで食べるようになった' },
  { id: 'foodAvoid', when: (t) => t.foodTurn < -0.25, text: '餌の方を避けて曲がっている…？（まだ迷っている）' },
  { id: 'lightTurn', when: (t) => t.lightTurn > 0.25, text: '光の差す方へ曲がるようになった' },
  { id: 'wallTurn', when: (t) => t.wallTurn > 0.25, text: '岩の前で、反対側へ向きを変えるようになった' },
  { id: 'dangerTurn', when: (t) => t.dangerTurn > 0.25, text: 'クラゲの振動から遠ざかる向きへ曲がるようになった' },
  { id: 'dangerSpeed', when: (t) => t.dangerSpeed > 0.12, text: '振動を感じると、速く泳いで逃げるようになった' },
  { id: 'crowdNear', when: (t) => t.crowdTurn > 0.3, text: '仲間の多い方へ寄っていくようになった（群れる）' },
  { id: 'crowdFar', when: (t) => t.crowdTurn < -0.3, text: '仲間の少ない方へ散らばるようになった（混雑をさける）' },
  { id: 'dangerGlow', when: (t) => t.dangerGlow > 0.2, text: 'クラゲを感じると光るようになった ── 光のことばの始まり' },
  { id: 'glowRelay', when: (t) => t.glowRelay > 0.2, text: '仲間の光を見ると、自分も光るようになった ── 光が伝わっていく' },
  { id: 'glowFlee', when: (t) => t.glowTurn > 0.25 || t.glowSpeed > 0.12, text: '仲間の光を見ると逃げるようになった ── 光が「危ない」の意味になった' },
  { id: 'lightGlow', when: (t) => t.lightGlow > 0.25, text: '月の光が明るいときに光るようになった' },
];

export function newFindings(row, layout, known) {
  const t = traits(row, layout);
  const out = [];
  for (const f of FINDINGS) {
    if (known.includes(f.id)) continue;
    try { if (f.when(t)) out.push(f); } catch (e) { /* その感覚がない */ }
  }
  return { traits: t, found: out };
}
