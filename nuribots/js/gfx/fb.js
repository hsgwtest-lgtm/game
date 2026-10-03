// UI 用のソフトウェア・フレームバッファ。
// 文字・ボタン・グラフはすべてここへ 1ピクセルずつ描き、3D の上に重ねる。
// 色は 32bit (ABGR)。アルファは 0 か 255 だけ（半透明なし＝ドット絵らしさ）。

export function rgb(hex) {
  return ((255 << 24) | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0;
}

export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export class FB {
  constructor(w, h) { this.resize(w, h); }

  resize(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint8Array(w * h * 4);
    this.u32 = new Uint32Array(this.data.buffer);
    this.clipStack = [];
    this.resetClip();
  }

  clear() { this.u32.fill(0); }

  setClip(x, y, w, h) {
    this.cx0 = Math.max(0, x | 0); this.cy0 = Math.max(0, y | 0);
    this.cx1 = Math.min(this.w, (x + w) | 0); this.cy1 = Math.min(this.h, (y + h) | 0);
  }
  resetClip() { this.cx0 = 0; this.cy0 = 0; this.cx1 = this.w; this.cy1 = this.h; }
  pushClip(x, y, w, h) {
    this.clipStack.push([this.cx0, this.cy0, this.cx1, this.cy1]);
    const x0 = Math.max(this.cx0, x | 0), y0 = Math.max(this.cy0, y | 0);
    const x1 = Math.min(this.cx1, (x + w) | 0), y1 = Math.min(this.cy1, (y + h) | 0);
    this.cx0 = x0; this.cy0 = y0; this.cx1 = Math.max(x0, x1); this.cy1 = Math.max(y0, y1);
  }
  popClip() {
    const c = this.clipStack.pop();
    if (c) { this.cx0 = c[0]; this.cy0 = c[1]; this.cx1 = c[2]; this.cy1 = c[3]; } else this.resetClip();
  }

  px(x, y, c) {
    x |= 0; y |= 0;
    if (x < this.cx0 || y < this.cy0 || x >= this.cx1 || y >= this.cy1) return;
    this.u32[y * this.w + x] = c;
  }

  rect(x, y, w, h, c) {
    const x0 = Math.max(this.cx0, x | 0), y0 = Math.max(this.cy0, y | 0);
    const x1 = Math.min(this.cx1, (x + w) | 0), y1 = Math.min(this.cy1, (y + h) | 0);
    if (x1 <= x0 || y1 <= y0) return;
    const u = this.u32, W = this.w;
    for (let yy = y0; yy < y1; yy++) u.fill(c, yy * W + x0, yy * W + x1);
  }

  frame(x, y, w, h, c) {
    this.rect(x, y, w, 1, c); this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y + 1, 1, h - 2, c); this.rect(x + w - 1, y + 1, 1, h - 2, c);
  }

  // 角を1ドット落とした四角
  rrect(x, y, w, h, c) {
    this.rect(x + 1, y, w - 2, 1, c);
    this.rect(x, y + 1, w, h - 2, c);
    this.rect(x + 1, y + h - 1, w - 2, 1, c);
  }
  rframe(x, y, w, h, c) {
    this.rect(x + 1, y, w - 2, 1, c); this.rect(x + 1, y + h - 1, w - 2, 1, c);
    this.rect(x, y + 1, 1, h - 2, c); this.rect(x + w - 1, y + 1, 1, h - 2, c);
  }

  // 立体的なパネル（上と左が明るく、下と右が暗い）
  bevel(x, y, w, h, face, hi, lo) {
    this.rrect(x, y, w, h, face);
    this.rect(x + 1, y, w - 2, 1, hi);
    this.rect(x, y + 1, 1, h - 3, hi);
    this.rect(x + 1, y + h - 1, w - 2, 1, lo);
    this.rect(x + w - 1, y + 2, 1, h - 3, lo);
  }

  hline(x0, x1, y, c) { if (x1 < x0) { const t = x0; x0 = x1; x1 = t; } this.rect(x0, y, x1 - x0 + 1, 1, c); }
  vline(x, y0, y1, c) { if (y1 < y0) { const t = y0; y0 = y1; y1 = t; } this.rect(x, y0, 1, y1 - y0 + 1, c); }

  line(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 4000; n++) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // 点線
  dline(x0, y0, x1, y1, c, on = 1, off = 1) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, i = 0;
    for (let n = 0; n < 4000; n++) {
      if (i % (on + off) < on) this.px(x0, y0, c);
      i++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // ベイヤーディザで塗る（level 0〜16）
  dither(x, y, w, h, c, level) {
    if (level <= 0) return;
    if (level >= 16) { this.rect(x, y, w, h, c); return; }
    const x0 = Math.max(this.cx0, x | 0), y0 = Math.max(this.cy0, y | 0);
    const x1 = Math.min(this.cx1, (x + w) | 0), y1 = Math.min(this.cy1, (y + h) | 0);
    const u = this.u32, W = this.w;
    for (let yy = y0; yy < y1; yy++) {
      const row = (yy & 3) * 4;
      for (let xx = x0; xx < x1; xx++) if (BAYER[row + (xx & 3)] < level) u[yy * W + xx] = c;
    }
  }

  // 市松模様（半透明のかわり）
  checker(x, y, w, h, c, phase = 0) {
    const x0 = Math.max(this.cx0, x | 0), y0 = Math.max(this.cy0, y | 0);
    const x1 = Math.min(this.cx1, (x + w) | 0), y1 = Math.min(this.cy1, (y + h) | 0);
    const u = this.u32, W = this.w;
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0 + ((yy + x0 + phase) & 1); xx < x1; xx += 2) u[yy * W + xx] = c;
  }

  // 斜めのしま模様
  stripes(x, y, w, h, c, period = 4, phase = 0) {
    const x0 = Math.max(this.cx0, x | 0), y0 = Math.max(this.cy0, y | 0);
    const x1 = Math.min(this.cx1, (x + w) | 0), y1 = Math.min(this.cy1, (y + h) | 0);
    const u = this.u32, W = this.w;
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) if (((xx + yy + phase) % period + period) % period === 0) u[yy * W + xx] = c;
  }

  circle(cx, cy, r, c) {
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      this.px(cx + x, cy + y, c); this.px(cx + y, cy + x, c);
      this.px(cx - y, cy + x, c); this.px(cx - x, cy + y, c);
      this.px(cx - x, cy - y, c); this.px(cx - y, cy - x, c);
      this.px(cx + y, cy - x, c); this.px(cx + x, cy - y, c);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }
  disc(cx, cy, r, c) {
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
      this.rect(cx - w, cy + y, w * 2 + 1, 1, c);
    }
  }

  // 文字列で描くドット絵 ['..xx..', ...] と色表 {x: 色}
  art(rows, x, y, colors, scale = 1, flip = false) {
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j];
      const n = r.length;
      for (let i = 0; i < n; i++) {
        const ch = r[flip ? n - 1 - i : i];
        if (ch === '.' || ch === ' ') continue;
        const c = colors[ch];
        if (c === undefined) continue;
        if (scale === 1) this.px(x + i, y + j, c);
        else this.rect(x + i * scale, y + j * scale, scale, scale, c);
      }
    }
  }

  // 1色アイコン（ビット行の配列 {w,h,d}）
  icon(ic, x, y, c, scale = 1) {
    const { w, h, d } = ic;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++)
        if (d[j * w + i]) {
          if (scale === 1) this.px(x + i, y + j, c);
          else this.rect(x + i * scale, y + j * scale, scale, scale, c);
        }
  }
}
