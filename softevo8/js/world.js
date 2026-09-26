/* =====================================================================
   SoftEvo 8 — world.js
   世界と生物の描画 (理論座標: cm, y上向き)
   ===================================================================== */
import { groundY, NODE_R, RING_R, TUG_WIN } from './sim.js';
import { muscleHue } from './ui.js';

export class Camera {
  constructor() { this.x = 0; this.y = 40; this.zoom = 2; }
  sx(wx, w) { return (wx - this.x) * this.zoom + w / 2; }
  sy(wy, h) { return h / 2 - (wy - this.y) * this.zoom; }
  wx(sx, w) { return (sx - w / 2) / this.zoom + this.x; }
  wy(sy, h) { return (h / 2 - sy) / this.zoom + this.y; }
  apply(ctx, w, h) {
    ctx.translate(w / 2 - this.x * this.zoom, h / 2 + this.y * this.zoom);
    ctx.scale(this.zoom, -this.zoom);
  }
}

/** 静的な体 (設計図やサムネ用) を Creature と同じ形に */
export function staticBody(bp) {
  const n = bp.nodes.length, m = bp.edges.length;
  const b = {
    n, x: new Float64Array(n), y: new Float64Array(n), contact: new Uint8Array(n),
    ea: new Int32Array(m), eb: new Int32Array(m), isMuscle: new Uint8Array(m), muscleEdge: [],
    out: null, vx: 0, vy: 0, tilt: 0,
  };
  bp.nodes.forEach((p, i) => { b.x[i] = p.x; b.y[i] = p.y; });
  bp.edges.forEach((e, k) => { b.ea[k] = e.a; b.eb[k] = e.b; if (e.type === 'muscle') { b.isMuscle[k] = 1; b.muscleEdge.push(k); } });
  b.out = new Float64Array(b.muscleEdge.length);
  return b;
}

function prep(c) {
  if (c._mOf) return;
  c._mOf = new Int32Array(c.ea.length).fill(-1);
  c.muscleEdge.forEach((e, j) => { c._mOf[e] = j; });
  // 頭 = 静止形で一番上のノード (同じ高さなら前側)
  const ry = c.ry || c.y, rx = c.rx || c.x, d = c.dir || 1;
  let h = 0;
  for (let i = 1; i < c.n; i++) if (ry[i] > ry[h] + 0.5 || (Math.abs(ry[i] - ry[h]) <= 0.5 && rx[i] * d > rx[h] * d)) h = i;
  c._head = h;
}

/**
 * 生物を描く (ctx は Camera.apply 済み)
 * o: { ghost: hue|null, tint: hue|null, alpha, selEdge, selNode, eyes, glowNodes:Set, glowEdges:Set }
 *   ghost … 半透明の影 (筋肉の動きは描かない) / tint … 対戦相手 (色味を変えるが筋肉の動きも目も描く)
 */
export function drawCreature(ctx, c, o = {}) {
  prep(c);
  const { x, y, ea, eb, isMuscle, out } = c;
  const ghost = o.ghost != null, tint = o.tint;
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 筋肉
  for (let e = 0; e < ea.length; e++) {
    if (!isMuscle[e]) continue;
    const j = c._mOf[e], a = out ? out[j] : 0;
    const con = Math.max(0, -a), ext = Math.max(0, a);
    const sel = o.selEdge === e || (o.glowEdges && o.glowEdges.has(e));
    if (sel) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 7 + 4 * con;
      ctx.beginPath(); ctx.moveTo(x[ea[e]], y[ea[e]]); ctx.lineTo(x[eb[e]], y[eb[e]]); ctx.stroke();
    }
    ctx.strokeStyle = ghost ? `hsl(${o.ghost},70%,60%)`
      : tint != null ? `hsl(${tint},${45 + 45 * con}%,${36 + 30 * con - 8 * ext}%)`
      : `hsl(${muscleHue(j)},${60 + 35 * con}%,${38 + 30 * con - 8 * ext}%)`;
    ctx.lineWidth = 1.6 + 3.6 * con + (1 - ext) * 0.6;
    ctx.beginPath(); ctx.moveTo(x[ea[e]], y[ea[e]]); ctx.lineTo(x[eb[e]], y[eb[e]]); ctx.stroke();
  }

  // 骨
  ctx.strokeStyle = ghost ? `hsl(${o.ghost},40%,75%)` : tint != null ? `hsl(${tint},45%,82%)` : '#dfe8fb';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  for (let e = 0; e < ea.length; e++) {
    if (isMuscle[e]) continue;
    ctx.moveTo(x[ea[e]], y[ea[e]]); ctx.lineTo(x[eb[e]], y[eb[e]]);
  }
  ctx.stroke();

  // 節点
  for (let i = 0; i < c.n; i++) {
    const glow = o.selNode === i || (o.glowNodes && o.glowNodes.has(i));
    if (glow) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(x[i], y[i], NODE_R * 2.1, 0, 7); ctx.fill();
    }
    ctx.fillStyle = ghost ? `hsl(${o.ghost},35%,22%)` : tint != null ? `hsl(${tint},40%,18%)` : '#172036';
    ctx.strokeStyle = c.contact[i] ? '#ffd166' : ghost ? `hsl(${o.ghost},50%,70%)` : tint != null ? `hsl(${tint},55%,78%)` : '#dfe8fb';
    ctx.lineWidth = c.contact[i] ? 2.4 : 1.6;
    ctx.beginPath(); ctx.arc(x[i], y[i], NODE_R, 0, 7); ctx.fill(); ctx.stroke();
  }

  // 目 — 動く方向を見る
  if (o.eyes !== false && !ghost) {
    const h = c._head, hx = x[h], hy = y[h];
    const sp = Math.hypot(c.vx, c.vy);
    const lx = sp > 0.05 ? c.vx / sp : (c.dir || 1), ly = sp > 0.05 ? c.vy / sp : 0;
    const ca = Math.cos(c.tilt || 0), sa = Math.sin(c.tilt || 0);
    for (const s of [-1, 1]) {
      const ox = s * 3.2, oy = 2.2;
      const ex = hx + ox * ca - oy * sa, ey = hy + ox * sa + oy * ca;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, 3.3, 0, 7); ctx.fill();
      ctx.fillStyle = '#0a0f1c';
      ctx.beginPath(); ctx.arc(ex + lx * 1.4, ey + ly * 1.4, 1.7, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}

/** 背景と地面 (ctx は通常のスクリーン座標) */
export function drawWorld(ctx, cam, w, h, terrain, deco = {}) {
  // 空
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#070b16'); sky.addColorStop(1, '#0f1a31');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

  // 遠景 (視差)
  for (const [par, alpha, amp, base] of [[0.25, 0.25, 60, 140], [0.5, 0.35, 40, 70]]) {
    ctx.fillStyle = `rgba(40,70,120,${alpha})`;
    ctx.beginPath(); ctx.moveTo(0, h);
    for (let sx = 0; sx <= w + 8; sx += 8) {
      const wx = (sx - w / 2) / cam.zoom + cam.x * par;
      const wy = base + amp * (Math.sin(wx * 0.006) * 0.6 + Math.sin(wx * 0.017 + 2) * 0.4);
      ctx.lineTo(sx, h / 2 - (wy - cam.y * par) * cam.zoom);
    }
    ctx.lineTo(w, h); ctx.fill();
  }

  const x0 = cam.wx(0, w) - 20, x1 = cam.wx(w, w) + 20;
  const Z = cam.zoom;
  // 1m ごとの縦線
  const startX = deco.startX ?? 0;
  ctx.lineWidth = 1;
  for (let k = Math.floor((x0 - startX) / 100); k <= Math.ceil((x1 - startX) / 100) && !deco.battle; k++) {
    const sx = cam.sx(startX + k * 100, w);
    ctx.strokeStyle = k % 5 === 0 ? 'rgba(120,160,255,0.10)' : 'rgba(120,160,255,0.045)';
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
  }

  // 地面
  const step = Math.max(2, 4 / Z);
  ctx.beginPath();
  ctx.moveTo(cam.sx(x0, w), h + 5);
  for (let wx = x0; wx <= x1; wx += step) ctx.lineTo(cam.sx(wx, w), cam.sy(groundY(terrain, wx), h));
  ctx.lineTo(cam.sx(x1, w), h + 5);
  ctx.closePath();
  const gg = ctx.createLinearGradient(0, cam.sy(0, h), 0, h);
  gg.addColorStop(0, '#133a36'); gg.addColorStop(1, '#0a1716');
  ctx.fillStyle = gg; ctx.fill();
  ctx.strokeStyle = '#3de0b0'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let wx = x0; wx <= x1; wx += step) {
    const sx = cam.sx(wx, w), sy = cam.sy(groundY(terrain, wx), h);
    if (wx === x0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.stroke();

  if (deco.battle) return drawArenaMarks(ctx, cam, w, h, deco.battle);

  // 距離マーカー
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const every = Z < 0.6 ? 5 : 1;
  for (let k = Math.ceil((x0 - startX) / 100); k <= Math.floor((x1 - startX) / 100); k++) {
    if (k % every) continue;
    const wx = startX + k * 100, sx = cam.sx(wx, w), sy = cam.sy(groundY(terrain, wx), h);
    ctx.fillStyle = k === 0 ? '#ffd166' : k % 5 === 0 ? 'rgba(200,230,255,0.85)' : 'rgba(200,230,255,0.5)';
    ctx.fillRect(sx - 1, sy, 2, k % 5 === 0 ? 10 : 6);
    ctx.fillText(k === 0 ? 'START' : `${k}m`, sx, sy + 24);
  }

  // 記録の旗
  if (deco.record && deco.record.x > x0 && deco.record.x < x1) {
    const rx = deco.record.x, sx = cam.sx(rx, w), sy = cam.sy(groundY(terrain, rx), h);
    const top = sy - Math.max(50, 90 * Z);
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, top); ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx + 22, top + 7); ctx.lineTo(sx, top + 14); ctx.fill();
    ctx.font = '600 11px system-ui, sans-serif';
    const tw = ctx.measureText(deco.record.label).width;
    const right = sx + 26 + tw < w - 6;
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillText(deco.record.label, right ? sx + 26 : sx - 6, top + 11);
  }
}

/** 土俵 / 綱引きの場の目印 */
function drawArenaMarks(ctx, cam, w, h, mode) {
  const Z = cam.zoom, gy = cam.sy(0, h);
  ctx.save();
  if (mode === 'sumo') {
    // 土俵の表面と俵
    const l = cam.sx(-RING_R, w), r = cam.sx(RING_R, w);
    ctx.fillStyle = 'rgba(214,176,120,0.13)';
    ctx.fillRect(l, gy, r - l, Math.max(4, 10 * Z));
    ctx.fillStyle = '#c9a15e';
    for (const s of [-1, 1]) {
      const bx = cam.sx(s * (RING_R - 4), w);
      ctx.beginPath(); ctx.ellipse(bx, gy, Math.max(3, 6 * Z), Math.max(2, 3.5 * Z), 0, Math.PI, 0); ctx.fill();
    }
    // 仕切り線
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = Math.max(1.5, 2 * Z);
    for (const s of [-1, 1]) {
      const sx = cam.sx(s * 10, w);
      ctx.beginPath(); ctx.moveTo(sx, gy + 1); ctx.lineTo(sx, gy + Math.max(3, 5 * Z)); ctx.stroke();
    }
    ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,209,102,0.7)';
    ctx.fillText('土俵際', l + 18, gy + 22); ctx.fillText('土俵際', r - 18, gy + 22);
  } else if (mode === 'tug') {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    const cx = cam.sx(0, w);
    ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx, gy + 10); ctx.stroke();
    ctx.font = '700 11px system-ui'; ctx.textAlign = 'center';
    const narrow = 2 * TUG_WIN * Z < 230;
    for (const [s, col, label] of [[-1, '#3fc1ff', narrow ? '◀西' : '◀ 西の勝ちライン'], [1, '#ff7b8a', narrow ? '東▶' : '東の勝ちライン ▶']]) {
      const sx = cam.sx(s * TUG_WIN, w);
      ctx.strokeStyle = col; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx, gy + 12); ctx.lineTo(sx, gy - Math.max(40, 70 * Z)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.fillText(label, sx, gy + 24);
    }
  }
  ctx.restore();
}

/** 綱 (たるんでいれば垂れる)。中央の赤い印の位置で勝負が決まる */
export function drawRope(ctx, ax, ay, bx, by, L) {
  const d = Math.hypot(bx - ax, by - ay), sag = d < L ? Math.sqrt(L * L - d * d) * 0.45 : 0;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#d8b98a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my - sag * 2, bx, by); ctx.stroke();
  ctx.fillStyle = '#ff4d5e';
  const ry = my - sag;
  ctx.beginPath(); ctx.moveTo(mx, ry); ctx.lineTo(mx - 5, ry - 16); ctx.lineTo(mx + 5, ry - 16); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** 設計図のサムネイル */
export function drawThumb(canvas, bp) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 160, h = canvas.clientHeight || 100;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!bp.nodes.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of bp.nodes) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const cam = new Camera();
  cam.zoom = Math.min((w - 30) / Math.max(40, maxX - minX + 20), (h - 24) / Math.max(40, maxY - minY + 20));
  cam.x = (minX + maxX) / 2; cam.y = (minY + maxY) / 2;
  ctx.save(); cam.apply(ctx, w, h);
  const b = staticBody(bp);
  b.ry = b.y; b.rx = b.x;
  drawCreature(ctx, b, {});
  ctx.restore();
}
