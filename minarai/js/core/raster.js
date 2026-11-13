// 「AIの目」: 机を真上から見た 32×32 ピクセルのカラー画像を描く。
// 学習はワーカーの中で何十万枚も描くので、WebGL を使わない小さな自前の描画にしている
// （64×64 で描いて 2×2 を平均 → 輪郭がなめらかになり、1画素より細かい位置も色の濃さで伝わる）。
// 何もない所は真っ黒（0）にしてある。ニューラルネット側が「0 の所は計算を飛ばす」ので、これが速さの決め手。
import { L1, L2, VIEW } from './arm.js';

export const IMG = 32;
export const OBS = IMG * IMG * 3;
const SS = 2, HI = IMG * SS;
const SCALE = HI / (2 * VIEW);

export const PALETTE = {
  base: [96, 100, 124], link1: [72, 104, 255], link2: [40, 200, 255], joint: [190, 196, 220],
  gripOpen: [240, 240, 250], gripClosed: [255, 64, 200],
  blocks: [[255, 150, 20], [90, 255, 70], [255, 40, 60]],   // だいだい / みどり / 赤（ニセモノ）
  goals: [[120, 62, 0], [28, 110, 22]],
  goalDone: [44, 46, 58],                                   // 運び終わった置き場（灰色）
};
export const BLOCK_HALF = 0.2;
export const GOAL_DRAW_R = 0.42;
export const GRIP = { open: 0.52, hold: 0.42, shut: 0.04, finger: 0.15, len: 0.22, wrist: 0.24 };

export class Raster {
  constructor() {
    this.hi = new Uint8Array(HI * HI * 3);
    this.ox = 0; this.oy = 0;
  }

  _disc(x, y, r, col) {
    const cx = (x + VIEW) * SCALE + this.ox, cy = (VIEW - y) * SCALE + this.oy, rr = r * SCALE;
    let x0 = Math.floor(cx - rr), x1 = Math.ceil(cx + rr), y0 = Math.floor(cy - rr), y1 = Math.ceil(cy + rr);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > HI) x1 = HI; if (y1 > HI) y1 = HI;
    const hi = this.hi, r2 = rr * rr, c0 = col[0], c1 = col[1], c2 = col[2];
    for (let py = y0; py < y1; py++) {
      const dy = py + 0.5 - cy;
      for (let px = x0; px < x1; px++) {
        const dx = px + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) { const o = (py * HI + px) * 3; hi[o] = c0; hi[o + 1] = c1; hi[o + 2] = c2; }
      }
    }
  }

  // 向きのある長方形。中心 (x, y)、向き th、長さの半分 hl、幅の半分 hw
  _rect(x, y, th, hl, hw, col) {
    const cx = (x + VIEW) * SCALE + this.ox, cy = (VIEW - y) * SCALE + this.oy;
    const ux = Math.cos(th), uy = -Math.sin(th);
    const L = hl * SCALE, W = hw * SCALE;
    const ex = Math.abs(ux) * L + Math.abs(uy) * W, ey = Math.abs(uy) * L + Math.abs(ux) * W;
    let x0 = Math.floor(cx - ex), x1 = Math.ceil(cx + ex), y0 = Math.floor(cy - ey), y1 = Math.ceil(cy + ey);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > HI) x1 = HI; if (y1 > HI) y1 = HI;
    const hi = this.hi, c0 = col[0], c1 = col[1], c2 = col[2];
    for (let py = y0; py < y1; py++) {
      const dy = py + 0.5 - cy;
      for (let px = x0; px < x1; px++) {
        const dx = px + 0.5 - cx;
        const a = dx * ux + dy * uy, b = dy * ux - dx * uy;
        if (a <= L && a >= -L && b <= W && b >= -W) { const o = (py * HI + px) * 3; hi[o] = c0; hi[o + 1] = c1; hi[o + 2] = c2; }
      }
    }
  }

  // スナップショット（env.snapshot の形）から 32×32×3 を out[outOff..] に描く
  render(s, off, out, outOff = 0) {
    const hi = this.hi;
    hi.fill(0);
    this.ox = s[off + 18] * SS; this.oy = s[off + 19] * SS;
    const a1 = s[off], a2 = s[off + 1], grip = s[off + 2], held = s[off + 3], nb = s[off + 4], ng = s[off + 5];
    // 置き場に届けたブロックは回収されて消え、その置き場は灰色になる
    for (let i = 0; i < ng; i++) {
      let fin = false;
      for (let b = 0; b < nb; b++) { const f = s[off + 9 + b * 4]; if (f >= 4 && (f & 3) === i) fin = true; }
      this._disc(s[off + 14 + i * 2], s[off + 15 + i * 2], GOAL_DRAW_R, fin ? PALETTE.goalDone : PALETTE.goals[i]);
    }
    for (let i = 0; i < nb; i++) {
      const o = off + 6 + i * 4;
      if (i === held || s[o + 3] >= 4) continue;
      this._rect(s[o], s[o + 1], s[o + 2], BLOCK_HALF, BLOCK_HALF, PALETTE.blocks[s[o + 3] & 3]);
    }
    const ex = L1 * Math.cos(a1), ey = L1 * Math.sin(a1);
    const th = a1 + a2, ux = Math.cos(th), uy = Math.sin(th);
    const tx = ex + L2 * ux, ty = ey + L2 * uy;
    const l2 = L2 - GRIP.wrist;
    this._disc(0, 0, 0.2, PALETTE.base);
    this._rect(ex / 2, ey / 2, a1, L1 / 2, 0.13, PALETTE.link1);
    this._rect(ex + ux * l2 / 2, ey + uy * l2 / 2, th, l2 / 2, 0.11, PALETTE.link2);
    this._disc(ex, ey, 0.15, PALETTE.joint);
    if (held >= 0) {
      const o = off + 6 + held * 4;
      this._rect(tx, ty, th, BLOCK_HALF, BLOCK_HALF, PALETTE.blocks[s[o + 3] & 3]);
    }
    const gap = grip ? (held >= 0 ? GRIP.hold : GRIP.shut) : GRIP.open;
    const gc = grip ? PALETTE.gripClosed : PALETTE.gripOpen;
    const wx = ex + ux * l2, wy = ey + uy * l2, nx = -uy, ny = ux;
    this._rect(wx, wy, th + Math.PI / 2, gap / 2 + GRIP.finger, 0.07, gc);
    const fo = gap / 2 + GRIP.finger / 2, fcx = tx - ux * 0.02, fcy = ty - uy * 0.02;
    this._rect(fcx + nx * fo, fcy + ny * fo, th, GRIP.len, GRIP.finger / 2, gc);
    this._rect(fcx - nx * fo, fcy - ny * fo, th, GRIP.len, GRIP.finger / 2, gc);
    // 2×2 を平均して 32×32 へ
    for (let y = 0; y < IMG; y++) {
      const r0 = (y * 2) * HI * 3, r1 = r0 + HI * 3;
      let o = outOff + y * IMG * 3;
      for (let x = 0; x < IMG; x++) {
        const p = x * 6;
        out[o++] = (hi[r0 + p] + hi[r0 + p + 3] + hi[r1 + p] + hi[r1 + p + 3] + 2) >> 2;
        out[o++] = (hi[r0 + p + 1] + hi[r0 + p + 4] + hi[r1 + p + 1] + hi[r1 + p + 4] + 2) >> 2;
        out[o++] = (hi[r0 + p + 2] + hi[r0 + p + 5] + hi[r1 + p + 2] + hi[r1 + p + 5] + 2) >> 2;
      }
    }
    return out;
  }
}
