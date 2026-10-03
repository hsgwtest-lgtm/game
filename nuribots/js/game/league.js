// CPU リーグ: 9人のライバル。勝つと新しいごほうびカードやアリーナが手に入る。

import { C } from '../core/const.js';

export const LEAGUE = [
  {
    id: 'koro', name: 'コロコロ', opp: { type: 'cpu', key: 'koro' }, arena: 0,
    look: { b: C.mint, l: C.ice, d: C.aqua, a: C.gold }, portrait: 'koro',
    desc: '気まぐれに転がるだけのロボ。まずは勝ってみよう',
    tip: '「ぬる」のごほうびだけでも勝てる相手',
    unlock: { cards: ['explore'], arenas: [1] },
  },
  {
    id: 'nurio', name: 'ヌリオ', opp: { type: 'cpu', key: 'nurio' }, arena: 1,
    look: { b: C.leaf, l: C.cream, d: C.green, a: C.salmon }, portrait: 'nurio',
    desc: '近くのまっさらな床をぬりに行く。ときどき迷う',
    tip: '「ムダ足」の罰で、ぬれる場所へ急がせよう',
    unlock: { cards: ['hit', 'shot'] },
  },
  {
    id: 'oikake', name: 'オイカケ', opp: { type: 'cpu', key: 'oikake' }, arena: 1,
    look: { b: C.scarlet, l: C.flesh, d: C.crimson, a: C.gold }, portrait: 'oikake',
    desc: 'しつこく追いかけてペンキ弾を撃ってくる',
    tip: '「命中」や「ピヨった」で撃ち合いを教えよう',
    unlock: { cards: ['stunned', 'lost'], arenas: [2], slots: 5 },
  },
  {
    id: 'nurio2', name: 'ヌリオMk2', opp: { type: 'cpu', key: 'nurio2' }, arena: 2,
    look: { b: C.emerald, l: C.leaf, d: C.pine, a: C.hotpink }, portrait: 'nurio2',
    desc: 'むだなく床をぬり、弾をよけ、爆弾も拾う',
    tip: '学習の量がものをいう。じっくり育てよう',
    unlock: { cards: ['item', 'approach'], arenas: [3] },
  },
  {
    id: 'guard', name: 'ガード', opp: { type: 'cpu', key: 'guard' }, arena: 3,
    look: { b: C.cobalt, l: C.blue, d: C.navy, a: C.gold }, portrait: 'guard',
    desc: '自分の陣地をすぐぬりかえす守りの名人',
    tip: '「うばう」を強めて攻めるか、広くぬって逃げきるか',
    unlock: { cards: ['lead', 'bump'], arenas: [4], slots: 6 },
  },
  {
    id: 'ace', name: 'エース', opp: { type: 'cpu', key: 'ace' }, arena: 4,
    look: { b: C.purple, l: C.lavender, d: C.violet, a: C.gold }, portrait: 'ace',
    desc: 'CPUロボの頂点。ぬる・撃つ・よけるが全部うまい',
    tip: 'スパーリング相手に強いCPUを混ぜよう',
    unlock: { arenas: [5] },
  },
  {
    id: 'senpai', name: 'ロボ先輩', opp: { type: 'boss', key: 'senpai' }, arena: 5,
    look: { b: C.sea, l: C.mint, d: C.teal, a: C.amber }, portrait: 'senpai',
    desc: '強化学習で育った先輩ロボ。人間の作ったルールでは動かない',
    tip: 'AIどうしの戦い。自分との対戦（分身）で鍛えるのも手',
    unlock: {},
  },
  {
    id: 'mirror', name: 'ミラー', opp: { type: 'boss', key: 'mirror' }, arena: -1,
    look: { b: C.pale, l: C.white, d: C.mist, a: C.lavender }, portrait: 'mirror',
    desc: '自分自身と何百万回も戦って強くなった',
    tip: 'どのアリーナでも勝てるように、いろんな場所で学習しよう',
    unlock: {},
  },
  {
    id: 'king', name: 'NURI-KING', opp: { type: 'boss', key: 'king' }, arena: -1,
    look: { b: C.gold, l: C.cream, d: C.amber, a: C.hotpink }, portrait: 'king',
    desc: 'ぬりバトルの王様。たおせば NURI MASTER の称号',
    tip: 'ごほうびの設計と学習量、両方の力が試される',
    unlock: { title: 'NURI MASTER' },
  },
];

export const LEAGUE_BY_ID = Object.fromEntries(LEAGUE.map(l => [l.id, l]));
