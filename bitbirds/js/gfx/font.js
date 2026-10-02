// ドット文字の描画（PixelMplus10 のアトラス + 自作の 3x5 ミニ数字フォント）

import { FONT_H, FONT_ASC, FONT_CHARS, FONT_W, FONT_BITS } from './fontdata.js';

export const LINE_H = 12;     // 行の高さ
export const GLYPH_H = FONT_H;

let glyphs = null;
function load() {
  if (glyphs) return glyphs;
  glyphs = new Map();
  const bin = atob(FONT_BITS);
  const chars = Array.from(FONT_CHARS);
  let p = 0;
  for (let i = 0; i < chars.length; i++) {
    const rows = new Uint16Array(FONT_H);
    for (let r = 0; r < FONT_H; r++) {
      rows[r] = bin.charCodeAt(p) | (bin.charCodeAt(p + 1) << 8);
      p += 2;
    }
    glyphs.set(chars[i], { w: FONT_W[i], rows });
  }
  return glyphs;
}

function glyph(ch) {
  const g = load();
  let gl = g.get(ch);
  if (gl) return gl;
  // 全角英数字などは半角に寄せる
  const code = ch.charCodeAt(0);
  if (code >= 0xFF01 && code <= 0xFF5E) gl = g.get(String.fromCharCode(code - 0xFEE0));
  return gl || g.get('?');
}

export function measure(str) {
  let w = 0;
  for (const ch of str) w += glyph(ch).w;
  return w;
}

function drawRaw(fb, str, x, y, c, scale) {
  let cx = x | 0;
  y |= 0;
  for (const ch of str) {
    const g = glyph(ch);
    const rows = g.rows;
    for (let r = 0; r < FONT_H; r++) {
      let bits = rows[r];
      if (!bits) continue;
      for (let i = 0; bits; i++, bits >>= 1) {
        if (bits & 1) {
          if (scale === 1) fb.px(cx + i, y + r, c);
          else fb.rect(cx + i * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    cx += g.w * scale;
  }
  return cx;
}

// opts: { align: 'left'|'center'|'right', shadow: 色, outline: 色, scale: 1, bold: false }
export function text(fb, str, x, y, c, opts = null) {
  str = String(str);
  const scale = (opts && opts.scale) || 1;
  if (opts && opts.align) {
    const w = measure(str) * scale;
    if (opts.align === 'center') x -= Math.floor(w / 2);
    else if (opts.align === 'right') x -= w;
  }
  if (opts && opts.outline !== undefined) {
    const o = opts.outline;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      drawRaw(fb, str, x + dx * scale, y + dy * scale, o, scale);
      if (opts.bold) drawRaw(fb, str, x + dx * scale + scale, y + dy * scale, o, scale);
    }
  } else if (opts && opts.shadow !== undefined) {
    drawRaw(fb, str, x + scale, y + scale, opts.shadow, scale);
    if (opts.bold) drawRaw(fb, str, x + scale * 2, y + scale, opts.shadow, scale);
  }
  if (opts && opts.bold) drawRaw(fb, str, x + scale, y, c, scale);
  return drawRaw(fb, str, x, y, c, scale);
}

// 指定幅で折り返す（日本語向け：文字単位＋かんたんな禁則）
const NO_START = '、。，．・：；？！ー～）」』】ぁぃぅぇぉっゃゅょァィゥェォッャュョ…,.!?)';
export function wrap(str, maxW) {
  const lines = [];
  for (const para of String(str).split('\n')) {
    let line = '', w = 0;
    const chars = Array.from(para);
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const cw = glyph(ch).w;
      if (w + cw > maxW && line.length > 0) {
        if (NO_START.includes(ch)) {
          // 行頭禁則：前の行にぶら下げる
          line += ch; lines.push(line); line = ''; w = 0; continue;
        }
        lines.push(line); line = ''; w = 0;
        if (ch === ' ' || ch === '　') continue;
      }
      line += ch; w += cw;
    }
    lines.push(line);
  }
  return lines;
}

export function textBlock(fb, str, x, y, maxW, c, opts = null, lineH = LINE_H) {
  const lines = wrap(str, maxW);
  for (let i = 0; i < lines.length; i++) text(fb, lines[i], x, y + i * lineH, c, opts);
  return lines.length * lineH;
}

// ── 3x5 ミニフォント（数字・英大文字・記号）──
const MINI_SRC = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111', 'A': '010101111101101', 'B': '110101110101110',
  'C': '011100100100011', 'D': '110101101101110', 'E': '111100110100111', 'F': '111100110100100',
  'G': '011100101101011', 'H': '101101111101101', 'I': '111010010010111', 'J': '001001001101010',
  'K': '101101110101101', 'L': '100100100100111', 'M': '101111111101101', 'N': '110101101101101',
  'O': '010101101101010', 'P': '110101110100100', 'Q': '010101101110011', 'R': '110101110101101',
  'S': '011100010001110', 'T': '111010010010010', 'U': '101101101101111', 'V': '101101101101010',
  'W': '101101111111101', 'X': '101101010101101', 'Y': '101101010010010', 'Z': '111001010100111',
  '.': '000000000000010', ',': '000000000010100', ':': '000010000010000', '/': '001001010100100',
  '-': '000000111000000', '+': '000010111010000', '%': '101001010100101', 'x': '000101010101000',
  '(': '010100100100010', ')': '010001001001010', '!': '010010010000010', '?': '110001010000010',
  '>': '100010001010100', '<': '001010100010001', '#': '101111101111101', '=': '000111000111000',
  'm': '000000110111101', ' ': '000000000000000', "'": '010010000000000', '_': '000000000000111',
};
const MINI = {};
for (const k in MINI_SRC) MINI[k] = MINI_SRC[k];

export function miniMeasure(str, scale = 1) { return (String(str).length * 4 - 1) * scale; }

// scale: 拡大率, rowColors: 行ごとの色（5要素。タイトルロゴのグラデーション用）
export function mini(fb, str, x, y, c, align = 'left', scale = 1, rowColors = null) {
  str = String(str);
  if (align !== 'left') {
    const w = miniMeasure(str, scale);
    x -= align === 'center' ? Math.floor(w / 2) : w;
  }
  x |= 0; y |= 0;
  for (const ch of str) {
    const bits = MINI[ch] || MINI[ch.toUpperCase()] || MINI[' '];
    for (let i = 0; i < 15; i++) {
      if (bits.charCodeAt(i) !== 49) continue;
      const r = (i / 3) | 0;
      const col = rowColors ? rowColors[r] : c;
      if (scale === 1) fb.px(x + (i % 3), y + r, col);
      else fb.rect(x + (i % 3) * scale, y + r * scale, scale, scale, col);
    }
    x += 4 * scale;
  }
  return x;
}

export { FONT_ASC };
