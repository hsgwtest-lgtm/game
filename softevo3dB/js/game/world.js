// 惑星の地方と時代
//   地方ごとに地形・水・すべりやすさが違い、「ぬし」（その地方でいちばん速い先住の生き物）がいる。
//   ぬしの記録を破ると、あなたの種はその地方に「定着」する。定着した地方のとなりへ枝分かれして広がっていく。
//   定着した地方の数に応じて時代がうつり、地方の環境が変わる（氷河期・大乾燥・大海進）。
//   変わった環境でぬしに負ける種は「危機」になり、次の時代までに適応できなければ絶滅する。

export const RACE_T = 10;   // 試練（かけっこ）の時間（秒）
export const TRIAL_MIN = 1.0;  // ぬしでさえ進めない環境でも、試練はこれだけは進むこと

export const REGIONS = {
  sea: {
    name: 'うみ', icon: '🌊', biome: 'sea', env: { terrain: 'flat', water: true },
    desc: '深い水の中。体をくねらせたり、水をかいたりして進む。浮かぶので、倒れる心配はない。',
    adj: ['shore'], map: [16, 70],
  },
  shore: {
    name: 'あさせ', icon: '🏝', biome: 'shore', env: { terrain: 'beach' },
    desc: '浅い水から陸へ上がる坂。水の中と陸の上、どちらでも動ける体が有利。',
    adj: ['sea', 'plain', 'dune'], map: [34, 56],
  },
  plain: {
    name: 'そうげん', icon: '🌾', biome: 'plain', env: { terrain: 'flat' },
    desc: 'まっ平らな大地。純粋な速さの勝負。',
    adj: ['shore', 'forest', 'dune'], map: [55, 44],
  },
  dune: {
    name: 'さきゅう', icon: '🏜', biome: 'desert', env: { terrain: 'hills', friction: 0.6 },
    desc: 'すべりやすい砂の丘。のぼってはくだる。',
    adj: ['shore', 'plain', 'rock'], map: [50, 76],
  },
  forest: {
    name: 'もり', icon: '🌲', biome: 'forest', env: { terrain: 'rough' },
    desc: '木の根で地面がでこぼこ。つまずかずに進めるか。',
    adj: ['plain', 'rock'], map: [74, 30],
  },
  rock: {
    name: 'いわやま', icon: '⛰', biome: 'rock', env: { terrain: 'steps' },
    desc: '岩の段差が続く山道。足を高く上げないとのぼれない。',
    adj: ['forest', 'dune', 'ice'], map: [76, 62],
  },
  ice: {
    name: 'ひょうげん', icon: '❄', biome: 'ice', env: { terrain: 'ice' },
    desc: 'つるつるの氷の原。ふんばりがきかない。',
    adj: ['rock'], map: [90, 46],
  },
};
export const REGION_KEYS = Object.keys(REGIONS);

// 時代: at = 定着した地方の数（この数に達すると次の時代へ）
export const ERAS = [
  {
    key: 'dawn', name: 'はじまりの時代', at: 0,
    story: 'まだだれも歩いたことのない若い惑星。海と陸のあちこちに、ぬしと呼ばれる先住の生き物がいる。',
    changes: {},
  },
  {
    key: 'glacial', name: '氷河期', at: 2,
    story: '空が冷え、そうげんともりが氷におおわれた。すべる地面に適応できない種は、生きのびられない。',
    changes: {
      plain: { name: '凍ったそうげん', biome: 'ice', env: { terrain: 'flat', friction: 0.3 } },
      forest: { name: '雪のもり', biome: 'ice', env: { terrain: 'rough', friction: 0.45 } },
    },
  },
  {
    key: 'arid', name: '大乾燥', at: 4,
    story: '氷がとけたあと、雨がふらなくなった。あさせは干あがって砂の坂に、もりは岩だらけの荒れ地になった。',
    changes: {
      plain: { name: 'そうげん', biome: 'plain', env: { terrain: 'flat' } },
      shore: { name: '干あがった浜', biome: 'desert', env: { terrain: 'slope', friction: 0.6 } },
      forest: { name: '荒れ地', biome: 'rock', env: { terrain: 'rough', friction: 0.8 } },
      dune: { name: '大砂丘', biome: 'desert', env: { terrain: 'hills', friction: 0.45 } },
    },
  },
  {
    key: 'flood', name: '大海進', at: 6,
    story: '海がふくらみ、低い土地がしずんだ。そうげんは水びたしになり、陸と水の両方で動ける体が求められる。',
    changes: {
      plain: { name: '水びたしのそうげん', biome: 'shore', env: { terrain: 'flat', shallow: 0.16 } },
      shore: { name: 'しずんだ浜', biome: 'sea', env: { terrain: 'beach', deep: true } },
      dune: { name: 'さきゅう', biome: 'desert', env: { terrain: 'hills', friction: 0.6 } },
    },
  },
];

export function eraIndexFor(settledCount) {
  let e = 0;
  for (let i = 0; i < ERAS.length; i++) if (settledCount >= ERAS[i].at) e = i;
  return e;
}

// その時代のその地方（名前・見た目・環境）。それまでの時代の変化を順に重ねる
export function regionAt(key, era) {
  const base = REGIONS[key];
  let r = { key, name: base.name, icon: base.icon, biome: base.biome, env: { ...base.env }, desc: base.desc, changed: false };
  for (let i = 1; i <= era && i < ERAS.length; i++) {
    const ch = ERAS[i].changes[key];
    if (ch) r = { ...r, name: ch.name, biome: ch.biome, env: { ...ch.env }, changed: i === era, changedAt: i };
  }
  return r;
}

// 物理の環境（sim.js の env）
export function envOf(region, extra = {}) {
  const e = region.env;
  return {
    terrain: e.terrain, water: !!e.water, friction: e.friction || 1,
    shallow: e.shallow || 0, deep: !!e.deep,
    T: RACE_T, ...extra,
  };
}

// オンラインの公式コース（時代に関係なく、はじまりの時代の環境）
export function officialEnv(key, extra = {}) { return envOf(regionAt(key, 0), extra); }

// 時代が変わったとき、変化した地方
export function changedRegions(era) {
  return era > 0 && ERAS[era] ? Object.keys(ERAS[era].changes) : [];
}

// 「めざす動き」による環境の違い（神経の「めざす速さ」も変わるので、記録・対戦・公開でも必ず同じものを使う）
export function goalEnv(goal, model) {
  if (goal === 'walk' || goal === 'human') {
    const vc = Math.sqrt(1.2 * Math.max(0.05, model.size.h));
    return { goal, vcap: vc, vstar: 0.9 * vc };
  }
  return { goal: 'distance' };
}
