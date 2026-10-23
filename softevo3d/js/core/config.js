// 全体の定数・パレット・素材の色
// 画面に出るものは 3D も UI も、すべてこの32色（Endesga 32）のドットになる。

export const VERSION = '1.0.0';

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

// 仮想ピクセル: iPhone 12 で 1仮想px = 2pt（6物理px）
export const SCREEN = { targetW: 195, minH: 400 };

// 素材の見た目（3D の色・UI の色）
export const MAT_LOOK = {
  1: { name: 'ほね', color: PAL.cream, dark: PAL.tan, desc: 'かたくて おもい' },
  2: { name: 'やわらか', color: PAL.pink, dark: PAL.orchid, desc: 'ぷにぷに。すべりにくい' },
  3: { name: 'ツルツル', color: PAL.silver, dark: PAL.gray, desc: 'かたくて よくすべる' },
  4: { name: '筋肉A', color: PAL.red, dark: PAL.crimson, ch: 'あか' },
  5: { name: '筋肉B', color: PAL.sky, dark: PAL.blue, ch: 'あお' },
  6: { name: '筋肉C', color: PAL.yellow, dark: PAL.gold, ch: 'きいろ' },
  7: { name: '筋肉D', color: PAL.lime, dark: PAL.green, ch: 'みどり' },
  8: { name: '筋肉E', color: PAL.orchid, dark: PAL.plum, ch: 'むらさき' },
  9: { name: '筋肉F', color: PAL.orange, dark: PAL.rust, ch: 'オレンジ' },
};
// 筋肉の色（チャンネル番号 0..5）
export const CH_COLOR = [PAL.red, PAL.sky, PAL.yellow, PAL.lime, PAL.orchid, PAL.orange];
export const CH_DARK = [PAL.crimson, PAL.blue, PAL.gold, PAL.green, PAL.plum, PAL.rust];
export const CH_NAME = ['あか', 'あお', 'きいろ', 'みどり', 'むらさき', 'オレンジ'];

// 名前の候補（ランダムにつける）
export const NAMES = [
  'ポチ', 'ピコ', 'モコ', 'ドット', 'ブロッコ', 'キューブ', 'ポリゴン', 'ピクセル', 'ボクセ', 'ムニ',
  'ぷるる', 'カクカク', 'トコ', 'ペタ', 'ゴロ', 'ポヨ', 'ズン', 'ミニ', 'チップ', 'ビット',
];
