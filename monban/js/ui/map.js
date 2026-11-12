// 「頭の中の地図」: レンズ2つを横と縦にとり、門番が止める場所・通す場所を塗り分ける
import { FEATS } from '../game/rules.js';
import { COL } from '../gfx/util.js';

const PASS = [31, 163, 106], STOP = [214, 36, 143];
const N = 36;

export function drawMap(canvas, { model, pool, picks, axes, focus }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = canvas.clientWidth || 100;
  if (canvas.width !== size * dpr) { canvas.width = canvas.height = size * dpr; }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  if (!axes) return;
  const [fx, fy] = axes;
  const base = focus ? focus.slice() : new Array(6).fill(0.5);
  const cell = size / N;
  if (model) {
    const x = base.slice();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      x[fx] = (i + 0.5) / N; if (fy !== null) x[fy] = 1 - (j + 0.5) / N;
      const p = model.predict(x);
      const c = p >= 0.5 ? STOP : PASS;
      const a = 0.16 + 0.34 * Math.min(1, Math.abs(p - 0.5) * 2);
      g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
    }
  }
  const px = (c) => c.x[fx] * (size - 12) + 6;
  const py = (c) => (fy === null ? size / 2 : (1 - c.x[fy]) * (size - 12) + 6);
  pool.forEach((c, i) => {
    const on = picks.includes(i);
    const X = px(c), Y = py(c);
    g.lineWidth = on ? 2.4 : 1.4;
    g.strokeStyle = c.badge ? COL.stop : COL.pass;
    g.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.55)';
    if (on) { g.beginPath(); g.arc(X, Y, 6.2, 0, 7); g.fillStyle = COL.key; g.fill(); g.fillStyle = '#fff'; }
    g.beginPath(); g.arc(X, Y, 3.6, 0, 7); g.fill();
    if (c.badge) { g.beginPath(); g.moveTo(X - 2.6, Y - 2.6); g.lineTo(X + 2.6, Y + 2.6); g.moveTo(X + 2.6, Y - 2.6); g.lineTo(X - 2.6, Y + 2.6); g.stroke(); }
    else { g.beginPath(); g.arc(X, Y, 2.8, 0, 7); g.stroke(); }
  });
  if (focus) {
    const c = { x: focus };
    g.strokeStyle = COL.ink; g.lineWidth = 1.5; g.setLineDash([3, 2]);
    g.beginPath(); g.arc(px(c), py(c), 8.5, 0, 7); g.stroke(); g.setLineDash([]);
  }
}
export function axisCaption(axes) {
  if (!axes) return 'レンズなし';
  return axes[1] === null ? `地図 ${FEATS[axes[0]].name}` : `${FEATS[axes[0]].name}→ ${FEATS[axes[1]].name}↑`;
}
// レンズの組み合わせを順に切り替える
export function axisPairs(active) {
  if (!active.length) return [null];
  if (active.length === 1) return [[active[0], null]];
  const out = [];
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) out.push([active[i], active[j]]);
  return out;
}
