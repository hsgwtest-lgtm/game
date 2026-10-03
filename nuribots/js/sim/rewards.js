// ごほうびカード（報酬関数のパーツ）。
// 1手ごとに起きた「できごと」× カードの値 を足したものが、ロボがもらう報酬になる。
// 値はレベル -3〜+3 × 単位。＋ならごほうび、− なら罰。

import { EV, N_EV } from './env.js';

export const CARDS = [
  { id: 'paint',    ev: EV.PAINT,    unit: 0.5,  def: 2,  icon: 'brush',  name: 'ぬる',     per: '1マス',
    desc: 'まっさらな床を1マスぬるごとに', hint: 'まずはこれ。ぬる量がふえる' },
  { id: 'steal',    ev: EV.STEAL,    unit: 0.5,  def: 2,  icon: 'swap',   name: 'うばう',   per: '1マス',
    desc: '相手の色をぬりかえるごとに', hint: '相手の通った後を追うようになる' },
  { id: 'win',      ev: EV.WIN,      unit: 5,    def: 2,  icon: 'crown',  name: 'かつ',     per: '試合',
    desc: '試合の最後に、勝ったら＋ 負けたら−', hint: '本当の目的。でも最後にしかもらえないので学びにくい' },
  { id: 'idle',     ev: EV.IDLE,     unit: 0.1,  def: -1, icon: 'zzz',    name: 'ムダ足',   per: '1手',
    desc: '何もぬれなかった手ごとに', hint: '−にすると、ぬれる場所へ急ぐ' },
  { id: 'lost',     ev: EV.LOST,     unit: 0.5,  def: -2, icon: 'crack',  name: 'ぬられた', per: '1マス',
    desc: '自分の色をぬりかえられるごとに', hint: '−にすると、陣地を守る・相手を止める' },
  { id: 'hit',      ev: EV.HIT,      unit: 2,    def: 1,  icon: 'target', name: '命中',     per: '1回',
    desc: 'ペンキ弾を相手に当てるごとに', hint: '相手を追いかけて撃つハンターに' },
  { id: 'stunned',  ev: EV.STUNNED,  unit: 2,    def: -1, icon: 'dizzy',  name: 'ピヨった', per: '1回',
    desc: 'ペンキ弾を当てられるごとに', hint: '−にすると、相手の射線をよける' },
  { id: 'item',     ev: EV.ITEM,     unit: 2,    def: 1,  icon: 'bomb',   name: 'ばくだん', per: '1こ',
    desc: 'ペンキ爆弾を拾うごとに', hint: '大きすぎると爆弾を待ちぶせするだけに…' },
  { id: 'explore',  ev: EV.EXPLORE,  unit: 0.2,  def: 1,  icon: 'flag',   name: 'たんけん', per: '1マス',
    desc: 'この試合ではじめて入るマスごとに', hint: '遠くまで行くようになる' },
  { id: 'approach', ev: EV.APPROACH, unit: 0.2,  def: 1,  icon: 'arrow',  name: 'ちかづく', per: '1歩',
    desc: '相手に1歩近づくごとに（はなれても罰なし）', hint: 'ワナあり。行ったり来たりで稼ぐかも？' },
  { id: 'lead',     ev: EV.LEAD,     unit: 0.1,  def: 1,  icon: 'chart',  name: 'リード',   per: '毎手',
    desc: '毎手、(自分のマス−相手のマス)の割合だけ', hint: '「かつ」を毎手すこしずつ。学びやすい' },
  { id: 'shot',     ev: EV.SHOT,     unit: 0.25, def: 1,  icon: 'drop',   name: 'うつ',     per: '1発',
    desc: 'ペンキ弾をうつごとに', hint: 'うつだけで稼ぐ「撃ちまくり」になるかも' },
  { id: 'bump',     ev: EV.BUMP,     unit: 0.25, def: -1, icon: 'wall',   name: 'かべ',     per: '1回',
    desc: 'かべにぶつかるごとに', hint: '−にすると、かべ際でもたつかなくなる' },
];

export const CARD = Object.fromEntries(CARDS.map(c => [c.id, c]));
export const LEVELS = [-3, -2, -1, 0, 1, 2, 3];

// デッキ（[{id, lv}]）から、できごとごとの重みを作る
export function deckWeights(deck) {
  const w = new Float32Array(N_EV);
  for (const d of deck || []) {
    const c = CARD[d.id];
    if (!c) continue;
    w[c.ev] += c.unit * d.lv;
  }
  return w;
}

export function cardValue(id, lv) { const c = CARD[id]; return c ? c.unit * lv : 0; }

export function fmtValue(v) {
  const a = Math.abs(v);
  const s = a >= 10 ? a.toFixed(0) : a >= 1 ? (Number.isInteger(a) ? a.toFixed(0) : a.toFixed(1)) : a.toFixed(2).replace(/0$/, '');
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + s;
}

// 1手分の報酬（できごと ev × 重み w）
export function rewardOf(ev, w) {
  let r = 0;
  for (let k = 0; k < N_EV; k++) if (w[k] !== 0) r += w[k] * ev[k];
  return r;
}

export const STARTER_DECK = [
  { id: 'paint', lv: 2 },
  { id: 'steal', lv: 2 },
  { id: 'win', lv: 2 },
];

// デッキを安全な形にそろえる（保存データ・相手から受け取ったデータ用）
export function cleanDeck(deck, maxSlots = 8) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(deck)) return out;
  for (const d of deck) {
    if (!d || typeof d.id !== 'string' || !CARD[d.id] || seen.has(d.id)) continue;
    const lv = Math.max(-3, Math.min(3, Math.round(Number(d.lv) || 0)));
    seen.add(d.id);
    out.push({ id: d.id, lv });
    if (out.length >= maxSlots) break;
  }
  return out;
}
