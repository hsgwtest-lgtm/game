// ボクセルの体を、ななめ上から見たドット絵で描く（カード・図鑑用）

import { MAT_LOOK, PALETTE } from '../core/config.js';
import { rgb } from '../gfx/fb.js';
import { C } from './widgets.js';

// 8×9 の立方体（T=上面, L=右側面(+z), R=前面(+x)）
const CUBE = [
  '...TT...',
  '.TTTTTT.',
  'LTTTTTTR',
  'LLLTTRRR',
  'LLLLRRRR',
  'LLLLRRRR',
  'LLLLRRRR',
  '.LLLRRR.',
  '...LR...',
];

function nearest(r, g, b) {
  let best = PALETTE[0], bd = 1e9;
  for (const p of PALETTE) {
    const pr = (p >> 16) & 255, pg = (p >> 8) & 255, pb = p & 255;
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
const SHADES = {};
for (const k in MAT_LOOK) {
  const c = MAT_LOOK[k].color, d = MAT_LOOK[k].dark;
  const mid = nearest((((c >> 16) & 255) + ((d >> 16) & 255)) / 2, (((c >> 8) & 255) + ((d >> 8) & 255)) / 2, ((c & 255) + (d & 255)) / 2);
  SHADES[k] = { T: rgb(c), L: rgb(mid === c ? d : mid), R: rgb(d) };
}

// 描いたときの大きさ（ピクセル）を返す
export function isoSize(vox, s = 1) {
  if (!vox.length) return { w: 0, h: 0 };
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const [x, y, z] of vox) {
    const sx = (x - z) * 4, sy = (x + z) * 2 - y * 5;
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx + 8);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy + 9);
  }
  return { w: (maxX - minX) * s, h: (maxY - minY) * s, minX, minY };
}

// (cx, cy) を中心に描く。maxW, maxH に入るよう拡大率を選ぶ（1か2）
export function drawIso(fb, vox, cx, cy, maxW = 60, maxH = 40, opts = {}) {
  if (!vox || !vox.length) return;
  const sz1 = isoSize(vox, 1);
  let s = opts.scale || ((sz1.w * 2 <= maxW && sz1.h * 2 <= maxH) ? 2 : 1);
  const w = sz1.w * s, h = sz1.h * s;
  const ox = Math.round(cx - w / 2) - sz1.minX * s, oy = Math.round(cy - h / 2) - sz1.minY * s;
  const list = vox.slice().sort((a, b) => ((a[0] + a[2]) - (b[0] + b[2])) || (a[1] - b[1]) || (b[2] - a[2]));
  const put = (x0, y0, color, shape) => {
    for (let r = 0; r < 9; r++) {
      const row = CUBE[r];
      for (let c = 0; c < 8; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        const col = shape ? color : color[ch];
        if (s === 1) fb.px(x0 + c, y0 + r, col);
        else fb.rect(x0 + c * s, y0 + r * s, s, s, col);
      }
    }
  };
  // ふちどり（全体のシルエットを1ドット外側に）
  const ink = opts.outline ?? C.ink;
  for (const [x, y, z] of list) {
    const bx = ox + ((x - z) * 4) * s, by = oy + ((x + z) * 2 - y * 5) * s;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) put(bx + dx * s, by + dy * s, ink, true);
  }
  for (const [x, y, z, m] of list) {
    const bx = ox + ((x - z) * 4) * s, by = oy + ((x + z) * 2 - y * 5) * s;
    put(bx, by, opts.mono ?? SHADES[m] ?? SHADES[1], opts.mono !== undefined);
  }
}
