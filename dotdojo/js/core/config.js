// ゲーム全体の定数・流派・見た目のテーマ
// 画面に出るものは 3D もUIも、すべてこの32色（Endesga 32）のドットになる。

export const PAL = {
  rust: 0xbe4a2f, copper: 0xd77643, cream: 0xead4aa, sand: 0xe4a672,
  clay: 0xb86f50, brown: 0x733e39, dkbrown: 0x3e2731, crimson: 0xa22633,
  red: 0xe43b44, orange: 0xf77622, gold: 0xfeae34, yellow: 0xfee761,
  lime: 0x63c74d, green: 0x3e8948, forest: 0x265c42, deep: 0x193c3e,
  blue: 0x124e89, sky: 0x0099db, cyan: 0x2ce8f5, white: 0xffffff,
  silver: 0xc0cbdc, gray: 0x8b9bb4, steel: 0x5a6988, slate: 0x3a4466,
  navy: 0x262b44, ink: 0x181425, magenta: 0xff0044, plum: 0x68386c,
  orchid: 0xb55088, pink: 0xf6757a, peach: 0xe8b796, tan: 0xc28569,
};
export const PALETTE = [
  PAL.rust, PAL.copper, PAL.cream, PAL.sand, PAL.clay, PAL.brown, PAL.dkbrown, PAL.crimson,
  PAL.red, PAL.orange, PAL.gold, PAL.yellow, PAL.lime, PAL.green, PAL.forest, PAL.deep,
  PAL.blue, PAL.sky, PAL.cyan, PAL.white, PAL.silver, PAL.gray, PAL.steel, PAL.slate,
  PAL.navy, PAL.ink, PAL.magenta, PAL.plum, PAL.orchid, PAL.pink, PAL.peach, PAL.tan,
];

// ── 画面（仮想ピクセル）── iPhone 12 で 1仮想px = 2pt（6物理px）
export const SCREEN = { targetW: 195, minH: 400 };

// ── 3つの流派 ──
export const SCHOOLS = {
  ga: {
    key: 'ga', name: '進化流', yomi: 'しんかりゅう', method: '遺伝的アルゴリズム',
    master: 'カメ仙人', color: PAL.lime, dark: PAL.green,
    motto: '強い子が親になり、世代をこえて強くなる',
    unit: '世代', pupil: '群れ',
  },
  rl: {
    key: 'rl', name: '強化流', yomi: 'きょうかりゅう', method: '強化学習',
    master: 'サル師範', color: PAL.orange, dark: PAL.rust,
    motto: 'ごほうびとばつで、試して試して強くなる',
    unit: 'ラウンド', pupil: '分身',
  },
  il: {
    key: 'il', name: '模倣流', yomi: 'もほうりゅう', method: '模倣学習',
    master: 'オウム先生', color: PAL.cyan, dark: PAL.sky,
    motto: 'お手本をよく見て、そっくりマネして強くなる',
    unit: 'お手本', pupil: 'でし',
  },
};
export const SCHOOL_KEYS = ['ga', 'rl', 'il'];

// ── 進化流の家系（色で血筋がわかる）──
export const FAMILIES = [
  { name: 'ミドリ', color: PAL.lime, dark: PAL.green },
  { name: 'キイロ', color: PAL.yellow, dark: PAL.gold },
  { name: 'アカ', color: PAL.red, dark: PAL.crimson },
  { name: 'アオ', color: PAL.sky, dark: PAL.blue },
  { name: 'モモ', color: PAL.pink, dark: PAL.orchid },
  { name: 'フジ', color: PAL.orchid, dark: PAL.plum },
  { name: 'シロ', color: PAL.silver, dark: PAL.gray },
  { name: 'ダイダイ', color: PAL.gold, dark: PAL.orange },
  { name: 'チャ', color: PAL.tan, dark: PAL.brown },
  { name: 'ミズ', color: PAL.cyan, dark: PAL.sky },
  { name: 'マネ', color: PAL.cream, dark: PAL.peach },   // 10: 模倣流から入った子の家系
];

// ── 修行場の空気感（3D表示）──
export const THEMES = [
  { // 0 朝の庭
    name: 'asa', zenith: PAL.sky, horizon: PAL.silver, low: PAL.blue, fog: PAL.silver,
    floor: [PAL.lime, PAL.green], side: [PAL.clay, PAL.brown, PAL.dkbrown], wall: [PAL.gray, PAL.steel], wallTop: PAL.green,
    cloud: PAL.white, petal: [PAL.pink, PAL.peach], hemi: 0.58, dir: 0.55, stars: false, wallStyle: 'rock',
  },
  { // 1 夕焼けの谷
    name: 'yuu', zenith: PAL.plum, horizon: PAL.gold, low: PAL.plum, fog: PAL.sand,
    floor: [PAL.sand, PAL.tan], side: [PAL.rust, PAL.brown, PAL.dkbrown], wall: [PAL.clay, PAL.brown], wallTop: PAL.copper,
    cloud: PAL.peach, petal: [PAL.red, PAL.orange], hemi: 0.56, dir: 0.6, stars: false, wallStyle: 'rock',
  },
  { // 2 竹林
    name: 'take', zenith: PAL.deep, horizon: PAL.lime, low: PAL.deep, fog: PAL.green,
    floor: [PAL.green, PAL.forest], side: [PAL.brown, PAL.dkbrown, PAL.ink], wall: [PAL.lime, PAL.green], wallTop: PAL.yellow,
    cloud: PAL.lime, petal: [PAL.lime, PAL.yellow], hemi: 0.6, dir: 0.5, stars: false, wallStyle: 'bamboo',
  },
  { // 3 月夜の庭
    name: 'tsuki', zenith: PAL.ink, horizon: PAL.slate, low: PAL.navy, fog: PAL.navy,
    floor: [PAL.steel, PAL.slate], side: [PAL.slate, PAL.navy, PAL.ink], wall: [PAL.gray, PAL.steel], wallTop: PAL.silver,
    cloud: PAL.slate, petal: [PAL.yellow, PAL.gold], hemi: 0.62, dir: 0.45, stars: true, wallStyle: 'lantern',
  },
];

// ── ごほうびの設定（強化流・進化流で使う）。値の候補 ──
export const REWARD_KNOBS = [
  { key: 'shaping', label: 'ゴールに近づくとほめる', opts: [0, 0.3], names: ['なし', 'あり'] },
  { key: 'explore', label: 'はじめての場所をほめる', opts: [0, 0.3], names: ['なし', 'あり'] },
  { key: 'key', label: 'カギのごほうび', opts: [0, 3], names: ['0', '+3'], need: 'hasKey' },
  { key: 'coin', label: '小判のごほうび', opts: [0, 1, 3], names: ['0', '+1', '+3'], need: 'hasCoin' },
  { key: 'death', label: 'やられた時のばつ', opts: [0, -1, -5], names: ['0', '-1', '-5'] },
];

export const VERSION = '1.0.0';
