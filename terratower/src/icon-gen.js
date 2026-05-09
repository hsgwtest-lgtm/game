/**
 * icon-gen.js — standalone script to generate Terra Tower PWA icons via Canvas API.
 * Run in a browser or Node.js with canvas package.
 *
 * Usage (browser console, or open icon-gen.html):
 *   import { generateIcon } from './src/icon-gen.js';
 *   generateIcon(512).then(blob => /* save */null);
 */

/**
 * Draw the Terra Tower icon on an OffscreenCanvas of the given size.
 * @param {number} size  - 192 or 512
 * @returns {Promise<Blob>} PNG blob
 */
export async function generateIcon(size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  drawIcon(ctx, size);
  return canvas.convertToBlob({ type: 'image/png' });
}

export function drawIcon(ctx, size) {
  const s = size;
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

  // Draw stacked blocks (isometric-ish perspective)
  const unit = s * 0.1;

  function drawBlock(x, y, w, h, hue) {
    // Top face
    ctx.fillStyle = `hsl(${hue},70%,55%)`;
    ctx.fillRect(x, y, w, h * 0.35);
    // Front face
    ctx.fillStyle = `hsl(${hue},60%,42%)`;
    ctx.fillRect(x, y + h * 0.35, w, h * 0.65);
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w * 0.15, h);
  }

  // Base platform
  const bx = s * 0.15, by = s * 0.72, bw = s * 0.7, bh = unit * 0.8;
  ctx.fillStyle = '#1c2333';
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = s * 0.005;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeRect(bx, by, bw, bh);

  // Block 1 (bottom, wide)
  drawBlock(s * 0.22, s * 0.60, s * 0.56, unit * 1.2, 35);
  // Block 2 (mid left)
  drawBlock(s * 0.24, s * 0.48, s * 0.25, unit * 1.1, 200);
  // Block 3 (mid right, cylinder sim)
  drawBlock(s * 0.53, s * 0.49, s * 0.23, unit * 1.0, 270);
  // Block 4 (top)
  drawBlock(s * 0.34, s * 0.37, s * 0.22, unit * 1.0, 45);

  // Hand / pinch icon at top-right
  const hx = s * 0.74, hy = s * 0.12, hr = s * 0.1;
  const grd = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
  grd.addColorStop(0, '#ffd700');
  grd.addColorStop(1, '#ff6b35');
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  // "TT" text
  ctx.fillStyle = '#e6edf3';
  ctx.font = `bold ${s * 0.12}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TT', cx, s * 0.17);
}
