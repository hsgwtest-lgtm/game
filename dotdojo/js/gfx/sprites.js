// ドット絵のスプライトとアイコン（文字で描いて、起動時に配列にする）

import { PAL } from '../core/config.js';
import { rgb } from './fb.js';

// 色つきスプライト: rows の各文字を map の色に。'.' は透明
function S(rows, map) {
  const h = rows.length, w = rows[0].length;
  const keys = Object.keys(map);
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y][x];
    const k = keys.indexOf(ch);
    d[y * w + x] = k >= 0 ? k + 1 : 0;
  }
  const cols = [0, ...keys.map((k) => rgb(map[k]))];
  return { w, h, d, cols };
}
// 1色アイコン
function I(rows) {
  const h = rows.length, w = rows[0].length;
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = rows[y][x] === '#' ? 1 : 0;
  return { w, h, d };
}

// ── 師範たち（16×16）──
export const MASTER = {
  // カメ仙人（進化流）: 白いまゆと長いひげ、甲羅
  ga: S([
    '................',
    '.....kkkkkk.....',
    '....kggggggk....',
    '...kggggggggk...',
    '..kgwwwggwwwgk..',
    '..kggkgggkggk...',
    '..kgggggggggk...',
    '..kggggppgggk...',
    '...kgwwwwwwgk...',
    '..bbkwwwwwwkbb..',
    '.bdbbkwwwwkbbdb.',
    '.bbdbbkwwkbbdbb.',
    'bdbbdbbkkbbdbbdb',
    'bbdbbdbbbbdbbdbb',
    '.bbbbbbbbbbbbbb.',
    '..kkkkkkkkkkkk..',
  ], { k: PAL.ink, g: PAL.lime, w: PAL.white, p: PAL.green, b: PAL.green, d: PAL.forest }),
  // サル師範（強化流）: 茶色の顔、肌色の口元、オレンジの鉢巻
  rl: S([
    '................',
    '.....kkkkkk.....',
    '....kbbbbbbk....',
    '..kkbbbbbbbbkk..',
    '.kookkkkkkkkook.',
    '.kbkooooooookbk.',
    '.kbbttttttttbbk.',
    '..kbtkttttktbk..',
    '..kbttttttttbk..',
    '...kttttttttk...',
    '...kttkkkkttk...',
    '....kttttttk....',
    '...kbkkkkkkbk...',
    '..kbbbbbbbbbbk..',
    '..kbbbooobbbbk..',
    '...kkkkkkkkkk...',
  ], { k: PAL.ink, b: PAL.brown, o: PAL.orange, t: PAL.peach }),
  // オウム先生（模倣流）: 水色の体、黄色いくちばし、赤いとさか
  il: S([
    '.......rr.......',
    '......rrrk......',
    '.....kccccck....',
    '....kccccccck...',
    '...kcccwwcccck..',
    '...kccwkkwccck..',
    '...kccwkkwcyyk..',
    '...kcccwwccyyyk.',
    '...kcccccccyyk..',
    '...kssccccccck..',
    '..kssssccccck...',
    '..kssssscccck...',
    '..ksssssscck....',
    '...ksssssck.....',
    '....kkyykk......',
    '.....yy.yy......',
  ], { k: PAL.ink, c: PAL.cyan, w: PAL.white, y: PAL.gold, r: PAL.red, s: PAL.sky }),
};

// でしの顔（10×10）
export const PUPIL = S([
  '.kkkkkkkk.',
  'kbbbbbbbbk',
  'kddddddddk',
  'kbbbbbbbbk',
  'kbwwbbwwbk',
  'kbwkbbwkbk',
  'kbbbbbbbbk',
  'kbbbkkbbbk',
  'kbbbbbbbbk',
  '.kkkkkkkk.',
], { k: PAL.ink, b: PAL.white, d: PAL.lime, w: PAL.white });

// でしを好きな色で描くための色表
export function pupilColors(body, band) {
  return [0, rgb(PAL.ink), rgb(body), rgb(band), rgb(PAL.white)];
}

// ── 1色アイコン ──
export const ICON = {
  back: I(['...#...', '..##...', '.######', '#######', '.######', '..##...', '...#...']),
  play: I(['#....', '##...', '###..', '####.', '###..', '##...', '#....']),
  pause: I(['##.##', '##.##', '##.##', '##.##', '##.##', '##.##', '##.##']),
  ff: I(['#...#....', '##..##...', '###.###..', '########.', '###.###..', '##..##...', '#...#....']),
  gear: I(['..#.#..', '.#####.', '##...##', '.#.#.#.', '##...##', '.#####.', '..#.#..']),
  sound: I(['...#...', '..##.#.', '###..#.', '###..#.', '###..#.', '..##.#.', '...#...']),
  mute: I(['...#...', '..##...', '###.#.#', '###..#.', '###.#.#', '..##...', '...#...']),
  medal: I(['.#####.', '##...##', '#.###.#', '#.#.#.#', '#.###.#', '##...##', '.#####.']),
  lock: I(['.###.', '#...#', '#...#', '#####', '##.##', '##.##', '#####']),
  check: I(['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....']),
  cross: I(['#...#', '##.##', '.###.', '..#..', '.###.', '##.##', '#...#']),
  star: I(['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '##...##']),
  eye: I(['.#####.', '#.....#', '#..#..#', '#.###.#', '#..#..#', '#.....#', '.#####.']),
  brain: I(['.##.##.', '#..#..#', '#.##..#', '#..#.##', '#.##..#', '#..#..#', '.##.##.']),
  key: I(['.##....', '#..#...', '#..####', '.##.#.#']),
  coin: I(['.###.', '#.#.#', '#.#.#', '#.#.#', '.###.']),
  scroll: I(['#######', '.#...#.', '.#.#.#.', '.#...#.', '#######']),
  arrow: I(['...#...', '..###..', '.#####.', '...#...', '...#...', '...#...']),
  heat: I(['#.#.#.#', '.#.#.#.', '#.#.#.#', '.#.#.#.', '#.#.#.#']),
  foot: I(['.#...', '###..', '.#.#.', '...##', '..#..']),
  reset: I(['.###.#.', '#...##.', '#..###.', '#......', '#.....#', '.#...#.', '..###..']),
  up: I(['...#...', '..###..', '.#####.', '#######', '..###..', '..###..']),
  down: I(['..###..', '..###..', '#######', '.#####.', '..###..', '...#...']),
  left: I(['...#..', '..##..', '.#####', '######', '.#####', '..##..', '...#..']),
  right: I(['..#...', '..##..', '#####.', '######', '#####.', '..##..', '..#...']),
  wait: I(['.###.', '#...#', '#.#.#', '#..##', '#...#', '.###.']),
  hand: I(['.#.#.#.', '.#.#.#.', '.#####.', '######.', '.#####.', '..###..']),
  trophy: I(['#######', '#.###.#', '.#####.', '..###..', '...#...', '..###..', '.#####.']),
  book: I(['###.###', '#..#..#', '#..#..#', '#..#..#', '#..#..#', '###.###']),
  clone: I(['##.##..', '##.##..', '.......', '..##.##', '..##.##']),
  dna: I(['#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.#.#.', '..#..']),
  heart: I(['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...']),
};

// 鳥居のマーク（タイトル用 11×9）
export const TORII = S([
  'rrrrrrrrrrr',
  'kkkkkkkkkkk',
  '.r.......r.',
  'rrrrrrrrrrr',
  '.r.......r.',
  '.r.......r.',
  '.r.......r.',
  '.r.......r.',
  'kk.......kk',
], { r: PAL.red, k: PAL.dkbrown });
