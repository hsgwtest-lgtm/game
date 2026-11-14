// icons.js — ドット絵アイコンと 3×5 のドット文字（ブラウザ用）
//   アイコンは 9×9 の文字列で描き、塗ったマスのまわりに自動で 1 ドットの黒いふちを付ける。
//   canvas に等倍で描いて画像（data URL）にし、CSS の image-rendering: pixelated で拡大して使う

export const PAL = {
  k: '#0b1020', // ふち・黒
  w: '#f4f6fa',
  l: '#c7d3e3',
  g: '#7d8aa0',
  y: '#ffd84a',
  o: '#ff9a3c',
  r: '#ff5a5a',
  p: '#ff6fd8',
  c: '#5fe6ff',
  G: '#63d36a',
  d: '#2f8a3a',
  b: '#3d7bd6',
  n: '#9a6a3a',
  v: '#a98bff',
  K: '#26304a', // 濃い灰（模様用。ふちとは別）
};

// '.' は透明。ほかの文字は PAL の色
export const ICONS = {
  play: ['.........', '..w......', '..ww.....', '..www....', '..wwww...', '..www....', '..ww.....', '..w......', '.........'],
  pause: ['.........', '.........', '..ww.ww..', '..ww.ww..', '..ww.ww..', '..ww.ww..', '..ww.ww..', '.........', '.........'],
  ff: ['.........', '.........', '.w...w...', '.ww..ww..', '.www.www.', '.ww..ww..', '.w...w...', '.........', '.........'],
  fff: ['.........', '.........', 'y..y..y..', 'yy.yy.yy.', 'yyyyyyyyy', 'yy.yy.yy.', 'y..y..y..', '.........', '.........'],
  bolt: ['.........', '....yyy..', '...yyy...', '..yyy....', '.yyyyyy..', '...yyy...', '..yyy....', '.yy......', '.........'],
  chart: ['.........', '.w.......', '.w....yy.', '.w...y...', '.w.pp....', '.wp..cc..', '.w.....c.', '.wwwwwww.', '.........'],
  tree: ['.........', '....y....', '....w....', '..wwwww..', '..w...w..', '.www.www.', '.w.w.w.w.', '.p.c.G.y.', '.........'],
  replay: ['.........', '...yyy...', '..y...y..', '.y.....y.', 'yyy....y.', '.y.....y.', '.......y.', '..y...y..', '...yyy...'],
  book: ['.........', '.lllllll.', '.lKKlKKl.', '.lllllll.', '.lKKlKKl.', '.lllllll.', '.lKKlKKl.', '.lllllll.', '.........'],
  gear: ['.........', '...l.l...', '.lllllll.', '..lKKKl..', '.llK.Kll.', '..lKKKl..', '.lllllll.', '...l.l...', '.........'],
  flask: ['.........', '...lll...', '....l....', '....l....', '...lcl...', '..lcccl..', '.lcGcGcl.', '.lllllll.', '.........'],
  rule: ['.........', '...nnn...', '.lllllll.', '.lKKKKll.', '.lllllll.', '.lKKKKKl.', '.lllllll.', '.lKKKlll.', '.lllllll.'],
  brain: ['.........', '..ppppp..', '.pp.p.pp.', '.p.ppp.p.', '.pp.p.pp.', '.ppppppp.', '...p.p...', '...p.p...', '.........'],
  qtable: ['.........', '.ccccccc.', '.c.c.c.c.', '.ccccccc.', '.c.cyc.c.', '.ccccccc.', '.c.c.c.c.', '.ccccccc.', '.........'],
  dice: ['.........', '.yyyyyyy.', '.yKyyyKy.', '.yyyyyyy.', '.yyyKyyy.', '.yyyyyyy.', '.yKyyyKy.', '.yyyyyyy.', '.........'],
  eat: ['.........', '....G....', '.G..G..G.', '..G.G.G..', '..GGGGG..', '...GdG...', '.nnnnnnn.', '.........', '.........'],
  sleep: ['.........', '...yyy...', '..yy.....', '.yy...ww.', '.yy....w.', '.yy...ww.', '..yy.....', '...yyyy..', '.........'],
  nose: ['.........', '.........', '......w..', '......ww.', '.c.c.wwww', '......ww.', '......w..', '.........', '.........'],
  up: ['.........', '....w....', '...www...', '..wwwww..', '.wwwwwww.', '...www...', '...www...', '...www...', '.........'],
  right: ['.........', '....w....', '....ww...', '.wwwwww..', '.wwwwwww.', '.wwwwww..', '....ww...', '....w....', '.........'],
  down: ['.........', '...www...', '...www...', '...www...', '.wwwwwww.', '..wwwww..', '...www...', '....w....', '.........'],
  left: ['.........', '....w....', '...ww....', '..wwwwww.', '.wwwwwww.', '..wwwwww.', '...ww....', '....w....', '.........'],
  star: ['.........', '....y....', '....y....', '.yyyyyyy.', '..yyyyy..', '...yyy...', '..yy.yy..', '.y.....y.', '.........'],
  skull: ['.........', '..lllll..', '.lllllll.', '.lKllKll.', '.lKllKll.', '.lllllll.', '..lKlKl..', '..lllll..', '.........'],
  heart: ['.........', '.........', '.pp...pp.', 'ppppppppp', 'ppppppppp', '.ppppppp.', '..ppppp..', '...ppp...', '....p....'],
  owl: ['.........', '.n.....n.', '.nnnnnnn.', '.nwynwyn.', '.nnnonnn.', '.nnnnnnn.', '..nnnnn..', '..o...o..', '.........'],
  save: ['.........', '.bbbbbbb.', '.bwwwwbb.', '.bwwwwbb.', '.bbbbbbb.', '.bllllbb.', '.bllllbb.', '.bbbbbbb.', '.........'],
  close: ['.........', '.r.....r.', '..r...r..', '...r.r...', '....r....', '...r.r...', '..r...r..', '.r.....r.', '.........'],
  island: ['.........', '....G....', '...GdG...', '..GGnGG..', '..yyyyy..', '.bbbbbbb.', 'b.b.b.b.b', '.........', '.........'],
  eye: ['.........', '.........', '...www...', '.ww.c.ww.', 'ww.ccc.ww', '.ww.c.ww.', '...www...', '.........', '.........'],
  sword: ['.........', '.......w.', '......w..', '.....w...', '..y.w....', '...y.....', '..y.y....', '.n.......', '.........'],
  rewind: ['.........', '.........', '.w..w...w', '.w.ww..ww', '.wwwwwwww', '.w.ww..ww', '.w..w...w', '.........', '.........'],
  sun: ['.........', '....y....', '.y.yyy.y.', '..yyyyy..', '.yyyyyyy.', '..yyyyy..', '.y.yyy.y.', '....y....', '.........'],
  moon: ['.........', '...lll...', '..ll.....', '.ll......', '.ll......', '.ll......', '..ll.....', '...lll...', '.........'],
  help: ['.........', '..yyyyy..', '.yy...yy.', '......yy.', '....yyy..', '....yy...', '.........', '....yy...', '.........'],
  trash: ['.........', '..lllll..', '.lllllll.', '..lKlKl..', '..lKlKl..', '..lKlKl..', '..lKlKl..', '..lllll..', '.........'],
};

const cache = new Map();

// アイコンを等倍の canvas に描く（ふち付き）
export function iconCanvas(name) {
  const rows = ICONS[name] || ICONS.help;
  const h = rows.length;
  const w = rows[0].length;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rows[y][x] !== '.';
  ctx.fillStyle = PAL.k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      ctx.fillStyle = PAL[ch] || PAL.w;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

export function iconURL(name) {
  if (!cache.has(name)) cache.set(name, iconCanvas(name).toDataURL('image/png'));
  return cache.get(name);
}

// <i class="ico" data-icon="名前"> をアイコン画像にする
export function iconHTML(name, cls = '') {
  return `<i class="ico ${cls}" aria-hidden="true" style="background-image:url(${iconURL(name)})"></i>`;
}
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    el.classList.add('ico');
    el.setAttribute('aria-hidden', 'true');
    el.style.backgroundImage = `url(${iconURL(el.dataset.icon)})`;
  }
}

// ---- 3×5 のドット文字（グラフの目盛り・HUD の数字用）
const GLYPHS = {
  0: '111101101101111',
  1: '010110010010111',
  2: '111001111100111',
  3: '111001111001111',
  4: '101101111001001',
  5: '111100111001111',
  6: '111100111101111',
  7: '111001010010010',
  8: '111101111101111',
  9: '111101111001111',
  '.': '000000000000010',
  ',': '000000000010100',
  '-': '000000111000000',
  '+': '000010111010000',
  '%': '101001010100101',
  '/': '001001010100100',
  ':': '000010000010000',
  x: '000101010101000',
  '×': '000101010101000',
  '#': '101111101111101',
  '(': '010100100100010',
  ')': '010001001001010',
  '=': '000111000111000',
  '>': '100010001010100',
  '<': '001010100010001',
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  ' ': '000000000000000',
};

export function textWidth(s, scale = 1) {
  return Math.max(0, String(s).length * 4 - 1) * scale;
}

// ctx に s を描く（左上が x, y）。scale 倍のドットで
export function pixText(ctx, s, x, y, color, scale = 1) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const raw of String(s).toUpperCase()) {
    const gl = GLYPHS[raw] || GLYPHS[' '];
    for (let i = 0; i < 15; i++) {
      if (gl[i] === '1') ctx.fillRect(cx + (i % 3) * scale, cy + Math.floor(i / 3) * scale, scale, scale);
    }
    cx += 4 * scale;
  }
}

// 数字だけの小さな canvas（HUD 用）。同じ文字列なら描き直さない
export function pixNumber(cv, s, color = PAL.w, shadow = PAL.k) {
  if (cv.dataset.v === s && cv.dataset.c === color) return;
  cv.dataset.v = s;
  cv.dataset.c = color;
  const w = textWidth(s) + 1;
  cv.width = Math.max(1, w);
  cv.height = 6;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  pixText(ctx, s, 1, 1, shadow);
  pixText(ctx, s, 0, 0, color);
  cv.style.width = `${cv.width * 3}px`;
  cv.style.height = `${cv.height * 3}px`;
}
