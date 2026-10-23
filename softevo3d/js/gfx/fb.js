// UI用のソフトウェア・フレームバッファ。
// すべての文字・ボタン・グラフはここに1ピクセルずつ描かれ、3D画面の上に重ねられる。
// 色は 32bit (ABGR, リトルエンディアン) で持つ。アルファは 0 か 255 のみ（中間なし＝ドット絵らしさ）。

export function rgb(hex) {
  return ((255 << 24) | ((hex & 0xff) << 16) | (hex & 0xff00) | ((hex >> 16) & 0xff)) >>> 0;
}

// 4x4 ベイヤー行列（ディザ・フェードに使う）
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export class FB {
  constructor(w, h) { this.resize(w, h); }

  resize(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint8Array(w * h * 4);
    this.u32 = new Uint32Array(this.data.buffer);
    this.resetClip();
  }

  clear() { this.u32.fill(0); }

  setClip(x, y, w, h) {
    this.cx0 = Math.max(0, x | 0); this.cy0 = Math.max(0, y | 0);
    this.cx1 = Math.min(this.w, (x + w) | 0); this.cy1 = Math.min(this.h, (y + h) | 0);
  }
  resetClip() { this.cx0 = 0; this.cy0 = 0; this.cx1 = this.w; this.cy1 = this.h; }

  px(x, y, c) {
    x |= 0; y |= 0;
    if (x < this.cx0 || y < this.cy0 || x >= this.cx1 || y >= this.cy1) return;
    this.u32[y * this.w + x] = c;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.u32[(y | 0) * this.w + (x | 0)];
  }

  rect(x, y, w, h, c) {
    let x0 = Math.max(this.cx0, x | 0), y0 = Math.max(this.cy0, y | 0);
    const x1 = Math.min(this.cx1, (x + w) | 0), y1 = Math.min(this.cy1, (y + h) | 0);
    if (x1 <= x0 || y1 <= y0) return;
    const u = this.u32, W = this.w;
    for (let yy = y0; yy < y1; yy++) u.fill(c, yy * W + x0, yy * W + x1);
  }

  frame(x, y, w, h, c) {
    this.rect(x, y, w, 1, c); this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y + 1, 1, h - 2, c); this.rect(x + w - 1, y + 1, 1, h - 2, c);
  }

  // 角を1ドット削った四角（ドット絵のボタンらしく）
  rrect(x, y, w, h, c) {
    this.rect(x + 1, y, w - 2, 1, c);
    this.rect(x, y + 1, w, h - 2, c);
    this.rect(x + 1, y + h - 1, w - 2, 1, c);
  }
  rframe(x, y, w, h, c) {
    this.rect(x + 1, y, w - 2, 1, c); this.rect(x + 1, y + h - 1, w - 2, 1, c);
    this.rect(x, y + 1, 1, h - 2, c); this.rect(x + w - 1, y + 1, 1, h - 2, c);
  }

  hline(x0, x1, y, c) { if (x1 < x0) [x0, x1] = [x1, x0]; this.rect(x0, y, x1 - x0 + 1, 1, c); }
  vline(x, y0, y1, c) { if (y1 < y0) [y0, y1] = [y1, y0]; this.rect(x, y0, 1, y1 - y0 + 1, c); }

  // ブレゼンハムの直線（アンチエイリアスなし）
  line(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      this.px(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // 点線（2つおき）
  dline(x0, y0, x1, y1, c, on = 1, off = 1) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, i = 0;
    for (let n = 0; n < 2000; n++) {
      if (i % (on + off) < on) this.px(x0, y0, c);
      i++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // ベイヤーディザで塗る（level: 0=なし … 16=全部）
  dither(x, y, w, h, c, level) {
    if (level <= 0) return;
    if (level >= 16) { this.rect(x, y, w, h, c); return; }
    const x0 = Math.max(this.cx0, x | 0), y0 = Math.max(this.cy0, y | 0);
    const x1 = Math.min(this.cx1, (x + w) | 0), y1 = Math.min(this.cy1, (y + h) | 0);
    const u = this.u32, W = this.w;
    for (let yy = y0; yy < y1; yy++) {
      const row = (yy & 3) * 4;
      for (let xx = x0; xx < x1; xx++) if (BAYER4[row + (xx & 3)] < level) u[yy * W + xx] = c;
    }
  }

  // 市松模様（半透明の代わり）
  checker(x, y, w, h, c, phase = 0) {
    const x0 = Math.max(this.cx0, x | 0), y0 = Math.max(this.cy0, y | 0);
    const x1 = Math.min(this.cx1, (x + w) | 0), y1 = Math.min(this.cy1, (y + h) | 0);
    const u = this.u32, W = this.w;
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0 + ((yy + x0 + phase) & 1); xx < x1; xx += 2) u[yy * W + xx] = c;
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

  // スプライト（{w,h,d: Uint8Array(パレット番号, 0=透明)}）を色表で描く
  sprite(spr, x, y, colors, scale = 1, flip = false) {
    x |= 0; y |= 0;
    const w = spr.w, h = spr.h, d = spr.d;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const v = d[j * w + (flip ? w - 1 - i : i)];
        if (!v) continue;
        const c = colors[v];
        if (c === undefined || c === 0) continue;
        if (scale === 1) this.px(x + i, y + j, c);
        else this.rect(x + i * scale, y + j * scale, scale, scale, c);
      }
    }
  }

  // 1色のスプライト（アイコン）
  icon(spr, x, y, c, scale = 1) {
    x |= 0; y |= 0;
    const w = spr.w, h = spr.h, d = spr.d;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++)
        if (d[j * w + i]) {
          if (scale === 1) this.px(x + i, y + j, c);
          else this.rect(x + i * scale, y + j * scale, scale, scale, c);
        }
  }
}
