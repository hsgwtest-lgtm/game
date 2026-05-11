/**
 * icon-gen.js — standalone script to generate Terra Tower β PWA icons via Canvas API.
 *
 * Usage (browser console):
 *   import { generateIcon } from './src/icon-gen.js';
 *   generateIcon(512).then(blob => /* save *\/null);
 */

export async function generateIcon(size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  drawIcon(ctx, size);
  return canvas.convertToBlob({ type: 'image/png' });
}

export function drawIcon(ctx, size) {
  const s  = size;
  const cx = s / 2;
  const cy = s / 2;

  // Background gradient
  const bg = ctx.createRadialGradient(cx, cy * 0.7, 0, cx, cy, s * 0.6);
  bg.addColorStop(0, '#1c2333');
  bg.addColorStop(1, '#0d1117');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, s, s, s * 0.18);
  ctx.fill();

  // WebXR reticle ring
  const unit   = s * 0.1;
  const ringCy = cy - unit * 0.8;

  ctx.strokeStyle = '#7ee787';
  ctx.lineWidth   = s * 0.025;
  ctx.beginPath();
  ctx.arc(cx, ringCy, s * 0.30, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(126,231,135,0.3)';
  ctx.lineWidth   = s * 0.01;
  ctx.beginPath();
  ctx.arc(cx, ringCy, s * 0.22, 0, Math.PI * 2);
  ctx.stroke();

  // Stacked blocks inside the ring
  function drawBlock(x, y, w, h, hue) {
    ctx.fillStyle = `hsl(${hue},70%,55%)`;
    ctx.fillRect(x, y, w, h * 0.35);
    ctx.fillStyle = `hsl(${hue},60%,42%)`;
    ctx.fillRect(x, y + h * 0.35, w, h * 0.65);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w * 0.15, h);
  }

  drawBlock(s * 0.36, ringCy - unit * 1.8, s * 0.28, unit * 0.9, 200);
  drawBlock(s * 0.32, ringCy - unit * 0.9, s * 0.36, unit * 0.9, 35);
  drawBlock(s * 0.28, ringCy,              s * 0.44, unit * 0.85, 270);

  // Corner brackets (AR reticle corners)
  const br = s * 0.37;
  const bl = s * 0.06;
  ctx.strokeStyle = '#7ee787';
  ctx.lineWidth   = s * 0.02;
  ctx.lineCap     = 'round';
  for (const [sx, sy, ex1, ey1, ex2, ey2] of [
    [cx - br, ringCy - br, cx - br + bl, ringCy - br, cx - br, ringCy - br + bl],
    [cx + br, ringCy - br, cx + br - bl, ringCy - br, cx + br, ringCy - br + bl],
    [cx - br, ringCy + br, cx - br + bl, ringCy + br, cx - br, ringCy + br - bl],
    [cx + br, ringCy + br, cx + br - bl, ringCy + br, cx + br, ringCy + br - bl],
  ]) {
    ctx.beginPath();
    ctx.moveTo(ex1, ey1);
    ctx.lineTo(sx, sy);
    ctx.lineTo(ex2, ey2);
    ctx.stroke();
  }

  // "β" badge at bottom
  ctx.fillStyle = 'rgba(126,231,135,0.15)';
  const bw = s * 0.35, bh = s * 0.16, bx = cx - bw / 2, by = s * 0.80;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, bh / 2);
  ctx.fill();

  ctx.fillStyle = '#7ee787';
  ctx.font      = `bold ${s * 0.12}px Helvetica, Arial, sans-serif`;
  ctx.textAlign     = 'center';
  ctx.textBaseline  = 'middle';
  ctx.fillText('β', cx, by + bh / 2);
}
