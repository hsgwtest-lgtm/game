// 本能の見える化: 「くせ」の表と、脳の重みの地図
import { prep, COL } from './charts.js';
import { probe } from '../game/observer.js';
import { E, O, idxWe, idxWo, idxHB, idxTW, idxOW, idxDE, idxDT, SENSES } from '../sim/brain.js';
import { SENSE_INFO } from '../game/story.js';

const LAT = { food: O.FOOD, light: O.LIGHT, touch: O.WALL, vibe: O.DANGER, crowd: O.CROWD, glow: O.GLOW };
const LEV = { food: E.FOOD, light: E.LIGHT, touch: E.WALL, vibe: E.DANGER, crowd: E.CROWD, glow: E.GLOW };
const FWD = { food: E.FOOD_F, light: E.LIGHT_F, touch: E.WALL_F, vibe: E.DANGER_F, crowd: E.CROWD_F, glow: E.GLOW_F };
const ORDER = ['food', 'light', 'touch', 'crowd', 'vibe', 'glow'];

export function instinctRows(row, layout) {
  const base = probe(row, layout);
  const rows = [];
  for (const s of ORDER) {
    if (!layout.senses.includes(s)) continue;
    const lev = s === 'touch' ? 0.6 : 0.35;
    const t = probe(row, layout, (e, o) => { e[LEV[s]] = lev; if (s === 'touch') e[FWD[s]] = 0.5; o[LAT[s]] = 0.5; }).turn;
    const hi = probe(row, layout, (e) => { e[LEV[s]] = 0.7; if (s === 'touch') e[FWD[s]] = 0.6; });
    rows.push({ s, turn: t, speed: (hi.speed - base.speed) * 2.5, glow: layout.outMask[1] ? (hi.glow - base.glow) * 2.5 : null });
  }
  // おなかがすいたとき（元気が少ない）
  const lo = probe(row, layout, (e) => { e[E.ENERGY] = 0.1; });
  const hiE = probe(row, layout, (e) => { e[E.ENERGY] = 0.9; });
  rows.push({ s: 'hunger', turn: null, speed: (lo.speed - hiE.speed) * 2.5, glow: layout.outMask[1] ? (lo.glow - hiE.glow) * 2.5 : null });
  return rows;
}

// くせの表: 感覚ごとに「曲がる（近づく/離れる）」「速さ」「光る」
export function drawInstinct(cv, row, layout, prevRows = null) {
  const { ctx, w, h } = prep(cv);
  const rows = instinctRows(row, layout);
  const hasGlow = layout.outMask[1] > 0;
  const cols = hasGlow ? [['turn', '離れる ・ 近づく'], ['speed', '遅く ・ 速く'], ['glow', '消える ・ 光る']] : [['turn', '離れる ・ 近づく'], ['speed', '遅く ・ 速く']];
  const L = 66, T = 20, rh = Math.min(19, (h - T - 6) / Math.max(1, rows.length));
  const cw = (w - L - 8) / cols.length;
  ctx.font = '10px -apple-system, "Hiragino Sans", sans-serif';
  ctx.textAlign = 'center';
  cols.forEach(([, label], c) => {
    ctx.fillStyle = COL.cur;
    ctx.fillText(label, L + cw * c + cw / 2, 12);
    ctx.strokeStyle = COL.line;
    const x0 = L + cw * c + cw / 2;
    ctx.beginPath(); ctx.moveTo(x0, T - 2); ctx.lineTo(x0, T + rh * rows.length); ctx.stroke();
  });
  ctx.textAlign = 'left';
  rows.forEach((r, i) => {
    const y = T + rh * i;
    const info = SENSE_INFO[r.s] || { color: '#e2f3ff', icon: '◌', name: '空腹' };
    ctx.fillStyle = info.color;
    ctx.font = '11px -apple-system, "Hiragino Sans", sans-serif';
    ctx.fillText(`${info.icon} ${info.name}`, 6, y + rh * 0.68);
    cols.forEach(([key], c) => {
      const v = r[key];
      if (v === null || v === undefined) return;
      const x0 = L + cw * c + cw / 2;
      const half = cw / 2 - 6;
      const vv = Math.max(-1, Math.min(1, v));
      const bw = vv * half;
      ctx.fillStyle = vv >= 0 ? 'rgba(73,200,255,0.85)' : 'rgba(255,95,168,0.8)';
      ctx.fillRect(Math.min(x0, x0 + bw), y + rh * 0.25, Math.abs(bw), rh * 0.5);
      if (prevRows && prevRows[i] && prevRows[i].s === r.s && prevRows[i][key] !== null) {
        const pv = Math.max(-1, Math.min(1, prevRows[i][key])) * half;
        ctx.fillStyle = 'rgba(226,243,255,0.6)';
        ctx.fillRect(x0 + pv - 0.5, y + rh * 0.15, 1.5, rh * 0.7);
      }
    });
  });
  return rows;
}

// 脳の重みの地図: 行 = 神経、列 = 入力（感覚ごと）＋ 出力
export function drawBrain(cv, row, layout, prevRow = null) {
  const { ctx, w, h } = prep(cv);
  const cols = [];
  for (const s of ['food', 'light', 'touch', 'crowd', 'vibe', 'glow']) {
    if (!layout.senses.includes(s)) continue;
    const d = SENSES[s];
    d.e.forEach((i) => cols.push({ s, kind: 'e', i }));
    d.o.forEach((i) => cols.push({ s, kind: 'o', i }));
  }
  cols.push({ s: 'self', kind: 'e', i: E.SPEED }, { s: 'self', kind: 'e', i: E.ENERGY });
  const outs = [{ n: '曲', f: (j) => idxTW(j) }, { n: '速', f: (j) => idxOW(0, j) }];
  if (layout.outMask[1]) outs.push({ n: '光', f: (j) => idxOW(1, j) });
  const H = layout.hidden;
  const T = 16, Lm = 22, gap = 10;
  const totalCols = cols.length + 1 + outs.length;
  const directRows = layout.outMask[1] ? 3 : 2;
  const cwid = Math.min(22, (w - Lm - 8 - gap) / totalCols);
  const rhh = Math.min(12, (h - T - 8) / (H + directRows + 0.6));
  const color = (v) => {
    const a = Math.min(1, Math.abs(v) / 1.2);
    return v >= 0 ? `rgba(73,200,255,${0.08 + a * 0.92})` : `rgba(255,95,168,${0.08 + a * 0.92})`;
  };
  ctx.font = '9px -apple-system, "Hiragino Sans", sans-serif';
  ctx.textAlign = 'center';
  let lastS = null;
  cols.forEach((c, ci) => {
    const x = Lm + ci * cwid;
    if (c.s !== lastS) {
      const info = SENSE_INFO[c.s];
      ctx.fillStyle = info ? info.color : COL.cur;
      ctx.fillText(info ? info.icon : '自', x + cwid / 2, 11);
      lastS = c.s;
    }
    for (let j = 0; j < H; j++) {
      const idx = c.kind === 'e' ? idxWe(j, c.i) : idxWo(j, c.i);
      ctx.fillStyle = color(row[idx]);
      ctx.fillRect(x + 0.5, T + j * rhh + 0.5, cwid - 1, rhh - 1);
      if (prevRow && Math.abs(prevRow[idx] - row[idx]) > 0.05) {
        ctx.strokeStyle = 'rgba(242,195,91,0.9)';
        ctx.strokeRect(x + 0.5, T + j * rhh + 0.5, cwid - 1, rhh - 1);
      }
    }
  });
  // 近道（入力 → 出力に直接）の行
  const dy0 = T + (H + 0.6) * rhh;
  const drows = [{ n: '速', f: (c) => (c.kind === 'e' ? idxDE(0, c.i) : -1) }];
  if (layout.outMask[1]) drows.push({ n: '光', f: (c) => (c.kind === 'e' ? idxDE(1, c.i) : -1) });
  drows.push({ n: '曲', f: (c) => (c.kind === 'o' ? idxDT(c.i) : -1) });
  ctx.textAlign = 'right';
  drows.forEach((d, r) => {
    const y = dy0 + r * rhh;
    ctx.fillStyle = COL.cur;
    ctx.fillText(d.n, Lm - 4, y + rhh * 0.8);
    cols.forEach((c, ci) => {
      const idx = d.f(c);
      if (idx < 0) return;
      ctx.fillStyle = color(row[idx]);
      ctx.fillRect(Lm + ci * cwid + 0.5, y + 0.5, cwid - 1, rhh - 1);
    });
  });
  ctx.fillStyle = COL.cur;
  ctx.fillText('神経', Lm - 4, T + rhh * 0.9);
  ctx.textAlign = 'center';
  const ox = Lm + (cols.length + 1) * cwid + gap - cwid;
  outs.forEach((o, k) => {
    const x = ox + k * cwid;
    ctx.fillStyle = COL.foam;
    ctx.fillText(o.n, x + cwid / 2, 11);
    for (let j = 0; j < H; j++) {
      ctx.fillStyle = color(row[o.f(j)]);
      ctx.fillRect(x + 0.5, T + j * rhh + 0.5, cwid - 1, rhh - 1);
    }
  });
  ctx.textAlign = 'right';
  ctx.fillStyle = COL.cur;
  ctx.fillText(`神経 ${H}・重み ${layout.idx.length}`, w - 6, h - 6);
  ctx.textAlign = 'left';
  void idxHB;
}
