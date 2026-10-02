// ドット絵のスプライトとアイコン（文字列で描いておき、起動時に変換する）

import { PAL } from '../core/config.js';
import { rgb } from './fb.js';

// 文字 → 色番号（0 は透明）
const KEYS = { '.': 0, ' ': 0, '#': 1, 'k': 2, 'w': 3, 's': 4, 'c': 5, 'd': 6, 'o': 7, 'r': 8, 'b': 9, 'g': 10, 'y': 11, 'p': 12, 'e': 13 };

export function parse(rows) {
  const h = rows.length;
  const w = Math.max(...rows.map(r => r.length));
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < rows[y].length; x++) d[y * w + x] = KEYS[rows[y][x]] ?? 0;
  return { w, h, d };
}

// 共通の色表（スプライト用）。c/d は呼ぶ側で差し替える
export function colors(over = {}) {
  const t = [];
  t[1] = rgb(PAL.white); t[2] = rgb(PAL.ink); t[3] = rgb(PAL.white); t[4] = rgb(PAL.peach);
  t[5] = rgb(PAL.yellow); t[6] = rgb(PAL.gold); t[7] = rgb(PAL.orange); t[8] = rgb(PAL.red);
  t[9] = rgb(PAL.sky); t[10] = rgb(PAL.gray); t[11] = rgb(PAL.yellow); t[12] = rgb(PAL.pink);
  t[13] = rgb(PAL.silver);
  for (const k in over) t[KEYS[k]] = over[k];
  return t;
}

export const ICON = {
  back: parse([
    '..#....',
    '.##....',
    '#######',
    '.##....',
    '..#....',
  ]),
  next: parse([
    '....#..',
    '....##.',
    '#######',
    '....##.',
    '....#..',
  ]),
  play: parse([
    '#....',
    '##...',
    '###..',
    '####.',
    '###..',
    '##...',
    '#....',
  ]),
  pause: parse([
    '##.##',
    '##.##',
    '##.##',
    '##.##',
    '##.##',
    '##.##',
    '##.##',
  ]),
  turbo: parse([
    '#...#..#',
    '##..##.#',
    '###.####',
    '########',
    '###.####',
    '##..##.#',
    '#...#..#',
  ]),
  sound: parse([
    '...#....',
    '..##..#.',
    '####.#.#',
    '####.#.#',
    '####.#.#',
    '..##..#.',
    '...#....',
  ]),
  mute: parse([
    '...#....',
    '..##....',
    '####.#.#',
    '####..#.',
    '####.#.#',
    '..##....',
    '...#....',
  ]),
  gear: parse([
    '..#.#..',
    '.#####.',
    '##...##',
    '.#...#.',
    '##...##',
    '.#####.',
    '..#.#..',
  ]),
  camera: parse([
    '.###....',
    '########',
    '#.###..#',
    '#.#.#..#',
    '#.###..#',
    '########',
  ]),
  heart: parse([
    '.##.##.',
    '#######',
    '#######',
    '.#####.',
    '..###..',
    '...#...',
  ]),
  heartO: parse([
    '.##.##.',
    '#..#..#',
    '#.....#',
    '.#...#.',
    '..#.#..',
    '...#...',
  ]),
  crown: parse([
    '#..#..#',
    '##.#.##',
    '#######',
    '#.#.#.#',
    '#######',
  ]),
  star: parse([
    '...#...',
    '...#...',
    '#######',
    '.#####.',
    '..###..',
    '.##.##.',
    '##...##',
  ]),
  lock: parse([
    '.###.',
    '#...#',
    '#...#',
    '#####',
    '##.##',
    '##.##',
    '#####',
  ]),
  check: parse([
    '......#',
    '.....##',
    '#...##.',
    '##.##..',
    '.###...',
    '..#....',
  ]),
  cross: parse([
    '#...#',
    '.#.#.',
    '..#..',
    '.#.#.',
    '#...#',
  ]),
  eye: parse([
    '..###..',
    '.#...#.',
    '#..#..#',
    '.#...#.',
    '..###..',
  ]),
  flag: parse([
    '#####',
    '#####',
    '###..',
    '#....',
    '#....',
    '#....',
  ]),
  up: parse([
    '..#..',
    '.###.',
    '#####',
  ]),
  down: parse([
    '#####',
    '.###.',
    '..#..',
  ]),
  hand: parse([
    '..#.#..',
    '.##.##.',
    '.#####.',
    '#######',
    '#######',
    '.#####.',
    '..###..',
  ]),
  robot: parse([
    '...#...',
    '.#####.',
    '#.#.#.#',
    '#######',
    '.#...#.',
    '.#####.',
  ]),
  trash: parse([
    '.###.',
    '#####',
    '.#.#.',
    '.#.#.',
    '.#.#.',
    '.###.',
  ]),
  plus: parse([
    '..#..',
    '..#..',
    '#####',
    '..#..',
    '..#..',
  ]),
  save: parse([
    '######.',
    '#.##.##',
    '#.##..#',
    '#.....#',
    '#.###.#',
    '#.###.#',
    '#######',
  ]),
  dna: parse([
    '#...#',
    '.#.#.',
    '..#..',
    '.#.#.',
    '#...#',
    '.#.#.',
    '..#..',
  ]),
  medal: parse([
    '#...#',
    '.#.#.',
    '..#..',
    '.###.',
    '#####',
    '#####',
    '.###.',
  ]),
};

// 博士（解説役）16x16
export const PROF = parse([
  '....kkkkkkkk....',
  '..kkwwwwwwwwkk..',
  '.kwwwwwwwwwwwwk.',
  '.kwwssssssssswk.',
  'kwwssssssssssswk',
  'kwskkkkskkkkkswk',
  'kwkbbbkkkbbbkskk',
  'kwkbbwkskbbwkswk',
  '.kskkkssskkkssk.',
  '.ksssssosssssk..',
  '..kswwwwwwwwsk..',
  '..kwwwwkkwwwwk..',
  '...kwwwwwwwwk...',
  '..kkrkwwwwkrkk..',
  '.kcckrrkkrrkcck.',
  '.kcccckkkkcccck.',
]);

// ヒナ（横向き）9x7。c=体の色 d=羽の色
export const CHICK = parse([
  '...kkkk..',
  '..kcccck.',
  '.kccckwko',
  'kddccccko',
  'kdddccck.',
  '.kkdcck..',
  '...kkk...',
]);
export const CHICK_DEAD = parse([
  '...kkkk..',
  '..kcccck.',
  '.kcckckko',
  'kddcckcko',
  'kdddccck.',
  '.kkdcck..',
  '...kkk...',
]);

// タイトルの大きなヒナ 16x13
export const BIG_CHICK = parse([
  '.....kkkkk......',
  '....kcccccck....',
  '...kcccccccck...',
  '..kcccccckwwk...',
  '..kcccccckwkk...',
  '.kdddcccccccckoo',
  'kddddccccccckooo',
  'kdddddccccccck..',
  'kddddddcccccck..',
  '.kddddcccccck...',
  '..kkddccccckk...',
  '....kkkkkkk.....',
  '.....o...o......',
]);
