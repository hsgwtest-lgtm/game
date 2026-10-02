// ゲーム全体の定数・ステージ定義・パレット
// ここを書き換えるとゲームバランスや見た目を調整できる。

// ── パレット（Endesga 32）。3D描画もUIもすべてこの32色に減色される ──
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

// ── 画面（仮想ピクセル）──
export const SCREEN = {
  targetW: 195,      // iPhone 12 で 1仮想px = 2pt(6物理px) になる幅
  minH: 400,         // UIが収まる最低の高さ
};

// ── 飛行の物理 ──
export const WORLD = {
  XMIN: -7, XMAX: 7,      // 谷の左右の壁
  YMIN: 0, YMAX: 10,      // 地面と雲の天井（天井はぶつからず押し戻されるだけ）
  R: 0.3,                 // 鳥の当たり判定の半径
  VLAT: 8,                // 上下左右の最高速度 (m/s)
  RESP: 7,                // 操作への反応の速さ
  DT: 1 / 30,             // シミュレーションの1ステップ (s)
  DMAX: 30,               // 目が見える距離 (m)
  START_Y: 5,
};

// ── ヒナの目：横7×縦5ピクセルの「奥行き画像」──
export const EYE = {
  cols: 7, rows: 5,
  sub: 2,                 // 1ピクセルあたり 2×2本の光線で平均する
  fovX: 84, fovY: 60,     // 視野角（度）
  lambda: 5,              // 「近さ」= exp(-距離/lambda)。近いほど明るい(1)、遠いと暗い(0)
};
export const N_EXTRA = 4; // 目以外の入力：横速度・縦速度・横位置・高さ
export const NET = { hid: 10, out: 2 };

// ── ステージ ──
// rows: そのステージに出てくる障害物の列の種類（w = 出やすさ）
export const STAGES = [
  {
    id: 1, name: 'はじめてのゲート', short: 'ゲート', desc: '大きな穴をくぐろう',
    goal: 300, speed: 9, theme: 0, first: 26,
    rows: [{ t: 'gate', w: 1, sp: [18, 22] }],
    gate: { hw: [6.2, 7.2], hh: [5.2, 6], shift: 5 },
  },
  {
    id: 2, name: 'せまいすきま', short: 'すきま', desc: '穴が小さく、遠くへずれる',
    goal: 400, speed: 10, theme: 1, first: 26,
    rows: [{ t: 'gate', w: 1, sp: [16, 20] }],
    gate: { hw: [4.6, 5.4], hh: [4.0, 4.6], shift: 7 },
  },
  {
    id: 3, name: 'はしらのもり', short: 'はしら', desc: '柱をよけて進め',
    goal: 400, speed: 10.5, theme: 2, first: 24,
    rows: [{ t: 'pillars', w: 1, sp: [8, 11] }],
    pillars: { n: [3, 5], r: [0.8, 1.2], gap: 3.0 },
  },
  {
    id: 4, name: 'まるたのかわ', short: 'まるた', desc: '丸太は上か下へ',
    goal: 500, speed: 11, theme: 3, first: 24,
    rows: [
      { t: 'logs', w: 1, sp: [9, 12] },
      { t: 'pillars', w: 1, sp: [9, 12] },
      { t: 'cross', w: 0.7, sp: [11, 13] },
    ],
    pillars: { n: [2, 3], r: [0.7, 1.0], gap: 3.2 },
    logs: { n: [1, 2], r: [0.55, 0.85], gap: 3.0 },
  },
  {
    id: 5, name: 'うごくゲート', short: 'うごく', desc: '穴が上下左右にゆれる',
    goal: 500, speed: 10.5, theme: 4, first: 26,
    rows: [{ t: 'mgate', w: 1, sp: [17, 21] }],
    gate: { hw: [4.6, 5.4], hh: [4.0, 4.6], shift: 6, amp: [1.8, 3.2], period: [2.4, 3.8] },
  },
  {
    id: 6, name: 'さいごのしれん', short: 'しれん', desc: 'ぜんぶまざった夜の空',
    goal: 800, speed: 12, theme: 5, first: 26,
    rows: [
      { t: 'gate', w: 1, sp: [16, 19] },
      { t: 'mgate', w: 0.8, sp: [17, 20] },
      { t: 'pillars', w: 1, sp: [11, 14] },
      { t: 'logs', w: 1, sp: [11, 14] },
      { t: 'cross', w: 0.6, sp: [13, 15] },
    ],
    gate: { hw: [4.6, 5.6], hh: [4.0, 4.8], shift: 6, amp: [1.2, 2.4], period: [2.8, 4.2] },
    pillars: { n: [2, 3], r: [0.7, 1.0], gap: 3.2 },
    logs: { n: [1, 2], r: [0.55, 0.8], gap: 3.0 },
  },
];

// ── ステージごとの空気感（3D表示）──
export const THEMES = [
  { // 0 草原の朝
    name: 'meadow', zenith: 0x0099db, horizon: 0xc0cbdc, fog: 0xc0cbdc, fogNear: 30, fogFar: 95,
    ground: [0x63c74d, 0x3e8948], cliff: [0xb86f50, 0x733e39], gate: 0xead4aa, gate2: 0xc28569,
    frame: 0xfeae34, pillar: 0x8b9bb4, log: 0x733e39, sun: 0xfee761, hemi: 0.75, dir: 0.9, stars: false,
  },
  { // 1 赤い渓谷
    name: 'canyon', zenith: 0x124e89, horizon: 0xe4a672, fog: 0xe4a672, fogNear: 28, fogFar: 90,
    ground: [0xd77643, 0xbe4a2f], cliff: [0xbe4a2f, 0x733e39], gate: 0xead4aa, gate2: 0xb86f50,
    frame: 0x2ce8f5, pillar: 0x8b9bb4, log: 0x733e39, sun: 0xfee761, hemi: 0.7, dir: 1.0, stars: false,
  },
  { // 2 深い森
    name: 'forest', zenith: 0x193c3e, horizon: 0x63c74d, fog: 0x3e8948, fogNear: 18, fogFar: 75,
    ground: [0x265c42, 0x193c3e], cliff: [0x3e8948, 0x265c42], gate: 0xc28569, gate2: 0x733e39,
    frame: 0xfee761, pillar: 0x733e39, log: 0x733e39, sun: 0xfee761, hemi: 0.7, dir: 0.8, stars: false,
  },
  { // 3 夕焼けの川
    name: 'river', zenith: 0x68386c, horizon: 0xf6757a, fog: 0xf6757a, fogNear: 26, fogFar: 88,
    ground: [0x0099db, 0x124e89], cliff: [0x5a6988, 0x3a4466], gate: 0xe8b796, gate2: 0xc28569,
    frame: 0xfee761, pillar: 0x8b9bb4, log: 0xb86f50, sun: 0xfeae34, hemi: 0.65, dir: 0.9, stars: false,
  },
  { // 4 天空の遺跡
    name: 'ruins', zenith: 0x262b44, horizon: 0x8b9bb4, fog: 0x8b9bb4, fogNear: 24, fogFar: 85,
    ground: [0x5a6988, 0x3a4466], cliff: [0x8b9bb4, 0x5a6988], gate: 0xc0cbdc, gate2: 0x8b9bb4,
    frame: 0xff0044, pillar: 0xc0cbdc, log: 0x733e39, sun: 0xffffff, hemi: 0.7, dir: 0.8, stars: false,
  },
  { // 5 ネオンの夜
    name: 'night', zenith: 0x181425, horizon: 0x3a4466, fog: 0x262b44, fogNear: 20, fogFar: 80,
    ground: [0x262b44, 0x181425], cliff: [0x3a4466, 0x262b44], gate: 0x5a6988, gate2: 0x3a4466,
    frame: 0x2ce8f5, pillar: 0x68386c, log: 0x5a6988, sun: 0xc0cbdc, hemi: 0.55, dir: 0.6, stars: true,
  },
];

// ── 家系（ヒナの「家」。色で血筋が分かる）──
export const FAMILIES = [
  { name: 'ピヨ', color: PAL.yellow, dark: PAL.gold },
  { name: 'アカネ', color: PAL.orange, dark: PAL.rust },
  { name: 'ベニ', color: PAL.red, dark: PAL.crimson },
  { name: 'モモ', color: PAL.pink, dark: PAL.orchid },
  { name: 'フジ', color: PAL.orchid, dark: PAL.plum },
  { name: 'ルリ', color: PAL.sky, dark: PAL.blue },
  { name: 'ソラ', color: PAL.cyan, dark: PAL.sky },
  { name: 'ヒワ', color: PAL.lime, dark: PAL.green },
  { name: 'ユキ', color: PAL.white, dark: PAL.silver },
  { name: 'チュン', color: PAL.tan, dark: PAL.brown },
  { name: 'マネ', color: PAL.gold, dark: PAL.orange },   // 10: おしえたヒナの子孫
];
export const TEACH_FAMILY = 10;

// ── 突然変異の強さ ──
export const MUTATION = [
  { key: 'low', label: 'ひくい', pm: 0.02, sigma: 0.12 },
  { key: 'mid', label: 'ふつう', pm: 0.05, sigma: 0.2 },
  { key: 'high', label: 'たかい', pm: 0.12, sigma: 0.4 },
];

export const POP_SIZES = [30, 50, 80];
// プレイヤーやおしえたヒナの見た目
export const PLAYER_LOOK = { color: PAL.white, dark: PAL.red };
export const CHICK_LOOK = { color: PAL.gold, dark: PAL.orange };
export const VERSION = '1.0.0';
