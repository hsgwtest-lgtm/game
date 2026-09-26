/* =====================================================================
   SoftEvo 8 — charts.js
   ・TimelineChart : 世代ごとの適応度 (最高 / 中央値 / 上位10%〜下位10%の帯)
                     物語のアイコン、環境変化。タップでその世代へジャンプ
   ・GaitChart     : 歩容図 — 筋肉の収縮と足の接地を時間方向に並べる
   ・CladeChart    : 系統の盛衰 (ミュラー図)
   ===================================================================== */
import { fitCanvas, clamp, muscleHue } from './ui.js';
import { TERRAINS, isBattle } from './sim.js';

const unitDiv = obj => obj === 'jump' || isBattle(obj) ? 1 : 100;
const unitName = obj => isBattle(obj) ? '点' : obj === 'jump' ? 'cm' : obj === 'efficiency' ? 'pt' : 'm';

export class TimelineChart {
  constructor(canvas, { onPick }) {
    this.canvas = canvas; this.onPick = onPick;
    this.run = null; this.selected = null; this.hoverX = null;
    const pick = e => {
      const g = this.genAt(e); if (g != null) this.onPick(g);
    };
    let dragging = false;
    canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); pick(e); });
    canvas.addEventListener('pointermove', e => { this.hoverX = e.clientX - canvas.getBoundingClientRect().left; if (dragging) pick(e); });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointerleave', () => { this.hoverX = null; });
  }
  genAt(e) {
    const H = this.run && this.run.history; if (!H || !H.length) return null;
    const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left;
    const t = clamp((x - this.px0) / (this.pw || 1), 0, 1);
    return H[0].gen + Math.round(t * (H[H.length - 1].gen - H[0].gen));
  }

  render() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.fillStyle = '#0a1122'; ctx.fillRect(0, 0, w, h);
    const run = this.run, H = run && run.history;
    if (!H || H.length < 1) {
      ctx.fillStyle = 'rgba(200,220,255,0.5)'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('世代が進むとここに進化の軌跡が描かれます', w / 2, h / 2); return;
    }
    const obj = run.settings.objective, ud = unitDiv(obj);
    const px0 = 44, px1 = w - 12, py0 = 26, py1 = h - 22;
    this.px0 = px0; this.pw = px1 - px0;
    const g0 = H[0].gen, g1 = Math.max(g0 + 1, H[H.length - 1].gen);
    // 縦軸は「今の目標」の世代だけで決める (単位の違う過去の時代ははみ出してよい)
    let lo = Infinity, hi = -Infinity;
    for (const e of H) {
      if (e.env && e.env.objective !== obj) continue;
      lo = Math.min(lo, e.p10, e.median); hi = Math.max(hi, e.bestEver ?? e.best, e.best);
    }
    if (!isFinite(lo)) { lo = 0; hi = 10; }
    lo = Math.min(0, lo); hi = Math.max(hi, lo + 10);
    const pad = (hi - lo) * 0.08; hi += pad;
    const X = g => px0 + (g - g0) / (g1 - g0) * (px1 - px0);
    const Y = v => py1 - (v - lo) / (hi - lo) * (py1 - py0);

    // 目盛
    ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(180,200,240,0.55)';
    ctx.strokeStyle = 'rgba(120,150,220,0.12)'; ctx.lineWidth = 1;
    const range = (hi - lo) / ud, step = niceStep(range / 4) * ud;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(px0, y); ctx.lineTo(px1, y); ctx.stroke();
      ctx.fillText(`${+(v / ud).toFixed(2)}${unitName(obj)}`, px0 - 4, y + 3);
    }
    ctx.textAlign = 'center';
    const gs = niceStep((g1 - g0) / 6);
    for (let g = Math.ceil(g0 / gs) * gs; g <= g1; g += gs) ctx.fillText(g, X(g), h - 6);

    // 環境の変化
    for (const ch of run.envChanges || []) {
      if (ch.gen <= g0) continue;
      const x = X(ch.gen);
      ctx.strokeStyle = 'rgba(141,255,176,0.45)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, py0 - 4); ctx.lineTo(x, py1); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#8dffb0'; ctx.font = '10px system-ui';
      ctx.fillText(ch.promo ? '🎖' : TERRAINS[ch.env.terrain]?.icon || '🌍', x, py0 - 8);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(px0, py0 - 2, px1 - px0, py1 - py0 + 4); ctx.clip();
    // バケット化 (1px あたり1点)
    const cols = Math.max(2, Math.floor(px1 - px0));
    const B = [];
    if (H.length <= cols) for (const e of H) B.push({ g: e.gen, best: e.best, be: e.bestEver ?? e.best, med: e.median, lo: e.p10, hi: e.p90 });
    else {
      let k = 0;
      for (let c = 0; c < cols; c++) {
        const end = Math.floor((c + 1) * H.length / cols);
        if (k >= end) continue;
        const b = { g: H[k].gen, best: -Infinity, be: -Infinity, med: 0, lo: Infinity, hi: -Infinity }; let n = 0;
        for (; k < end; k++) { const e = H[k]; b.best = Math.max(b.best, e.best); b.be = Math.max(b.be, e.bestEver ?? e.best); b.med += e.median; b.lo = Math.min(b.lo, e.p10); b.hi = Math.max(b.hi, e.p90); n++; }
        b.med /= n; B.push(b);
      }
    }
    // 帯 (上位10%〜下位10%)
    ctx.fillStyle = 'rgba(90,140,255,0.16)';
    ctx.beginPath();
    B.forEach((b, i) => { const x = X(b.g), y = Y(b.hi); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    for (let i = B.length - 1; i >= 0; i--) ctx.lineTo(X(B[i].g), Y(B[i].lo));
    ctx.fill();
    const line = (key, col, lw, dash) => {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash || []);
      ctx.beginPath(); B.forEach((b, i) => { const x = X(b.g), y = Y(b[key]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
      ctx.setLineDash([]);
    };
    line('med', 'rgba(140,180,255,0.9)', 1.2, [4, 3]);
    line('best', 'rgba(255,209,102,0.45)', 1);
    line('be', '#ffd166', 2.2);

    ctx.restore();
    // 物語マーカー
    let lastX = -99;
    ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    for (const j of run.journal) {
      if (!j.major || j.gen < g0) continue;
      const x = X(j.gen); if (x - lastX < 16) continue; lastX = x;
      const e = H[Math.min(H.length - 1, Math.max(0, j.gen - g0))];
      const y = e ? Y(e.bestEver ?? e.best) : py0;
      ctx.fillText(j.icon, x, Math.max(py0 + 4, y - 8));
    }

    // 選択中の世代
    if (this.selected != null && this.selected >= g0) {
      const x = X(this.selected);
      ctx.strokeStyle = '#ff5fd2'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, py0); ctx.lineTo(x, py1); ctx.stroke();
      ctx.fillStyle = '#ff5fd2'; ctx.font = '600 10px system-ui';
      ctx.fillText(`▶ 第${this.selected}世代`, clamp(x, px0 + 30, px1 - 30), py0 - 12);
    }
    // ホバー
    if (this.hoverX != null && this.hoverX > px0) {
      const g = g0 + Math.round(clamp((this.hoverX - px0) / (px1 - px0), 0, 1) * (g1 - g0));
      const e = H[g - g0];
      if (e) {
        const x = X(g);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, py0); ctx.lineTo(x, py1); ctx.stroke();
        const dg = isBattle(obj) ? 0 : 2;
        const txt = `第${g}世代  最高 ${(e.best / ud).toFixed(dg)}  中央 ${(e.median / ud).toFixed(dg)}${unitName(obj)}`;
        ctx.font = '11px system-ui';
        const tw = ctx.measureText(txt).width + 12, tx = clamp(x + 8, px0, w - tw - 4);
        ctx.fillStyle = 'rgba(10,17,34,0.92)'; ctx.fillRect(tx, py0, tw, 18);
        ctx.fillStyle = '#e8eefc'; ctx.textAlign = 'left'; ctx.fillText(txt, tx + 6, py0 + 13);
      }
    }
    // 凡例
    ctx.font = '10px system-ui'; ctx.textAlign = 'left';
    const lg = [['#ffd166', '最高記録'], ['rgba(140,180,255,0.9)', '中央値'], ['rgba(90,140,255,0.5)', '上位〜下位10%']];
    let lx = px0 + 4;
    for (const [c, t] of lg) { ctx.fillStyle = c; ctx.fillRect(lx, 8, 10, 3); ctx.fillStyle = 'rgba(200,220,255,0.7)'; ctx.fillText(t, lx + 14, 13); lx += ctx.measureText(t).width + 30; }
  }
}

function niceStep(x) {
  if (x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

export class GaitChart {
  constructor(canvas) { this.canvas = canvas; }
  render(th) {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.fillStyle = '#0a1122'; ctx.fillRect(0, 0, w, h);
    if (!th || !th.main || !th.gaitOut) return;
    const HIST = th.gaitOut[0] ? th.gaitOut[0].length : 240;
    const M = th.M;
    // 接地したことのある点だけ (足)
    const feet = [];
    th.gaitTouch.forEach((row, i) => { let s = 0; for (let k = 0; k < HIST; k++) s += row[k]; if (s > 0) feet.push(i); });
    const rows = M + feet.length;
    const LW = 42, top = 18, gap = feet.length ? 8 : 0;
    const rh = Math.max(4, Math.min(18, (h - top - 6 - gap) / Math.max(1, rows)));
    const cw = (w - LW - 8) / HIST;
    ctx.font = '600 10px system-ui'; ctx.fillStyle = 'rgba(180,200,240,0.6)'; ctx.textAlign = 'left';
    ctx.fillText('筋肉の収縮 (明るい=縮む)', LW, 12);
    ctx.textAlign = 'right'; ctx.fillText('← 4秒前   いま →', w - 8, 12);
    const n = th.filled, head = th.head;
    for (let j = 0; j < M; j++) {
      const y = top + j * rh, hue = muscleHue(j), row = th.gaitOut[j];
      ctx.fillStyle = `hsl(${hue},75%,62%)`; ctx.textAlign = 'right'; ctx.font = `${Math.min(10, rh)}px system-ui`;
      ctx.fillText(`筋${j + 1}`, LW - 6, y + rh * 0.75);
      for (let k = 0; k < n; k++) {
        const idx = (head - n + k + HIST) % HIST, v = row[idx];
        const con = Math.max(0, -v), ext = Math.max(0, v);
        ctx.fillStyle = `hsl(${hue},${40 + 50 * con}%,${10 + 50 * con + 6 * (1 - ext)}%)`;
        ctx.fillRect(LW + (HIST - n + k) * cw, y, cw + 0.6, rh - 1);
      }
    }
    const y0 = top + M * rh + gap;
    feet.forEach((i, r) => {
      const y = y0 + r * rh, row = th.gaitTouch[i];
      ctx.fillStyle = '#ffd166'; ctx.textAlign = 'right'; ctx.font = `${Math.min(10, rh)}px system-ui`;
      ctx.fillText(`点${i + 1}`, LW - 6, y + rh * 0.75);
      ctx.fillStyle = 'rgba(255,209,102,0.07)'; ctx.fillRect(LW, y, w - LW - 8, rh - 1);
      ctx.fillStyle = '#ffd166';
      for (let k = 0; k < n; k++) {
        const idx = (head - n + k + HIST) % HIST;
        if (row[idx]) ctx.fillRect(LW + (HIST - n + k) * cw, y + 1, cw + 0.6, rh - 3);
      }
    });
    if (feet.length) {
      ctx.fillStyle = 'rgba(255,209,102,0.7)'; ctx.textAlign = 'left'; ctx.font = '600 9px system-ui';
      ctx.fillText('接地 (歩容図)', LW, y0 - 1);
    }
  }
}

export class CladeChart {
  constructor(canvas, { onPick }) {
    this.canvas = canvas; this.onPick = onPick;
    this.run = null; this.hits = [];
    canvas.addEventListener('pointerup', e => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const hit = this.hits.find(hh => hh.x0 <= x && x <= hh.x1 && hh.fn(y, x));
      if (hit) this.onPick(hit.id);
    });
  }
  render() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    ctx.fillStyle = '#0a1122'; ctx.fillRect(0, 0, w, h);
    const run = this.run; this.hits = [];
    if (!run || run.cladeHist.length < 2) {
      ctx.fillStyle = 'rgba(200,220,255,0.5)'; ctx.font = '13px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('大きく記録を更新した個体は新しい系統の祖になります', w / 2, h / 2); return;
    }
    // 系統樹の深さ優先順 (子は親のすぐ上に積む)
    const clades = run.clades;
    const kids = new Map();
    for (const c of Object.values(clades)) { const p = c.parent ?? -1; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(c.id); }
    const order = [];
    const dfs = id => { order.push(id); for (const k of (kids.get(id) || []).sort((a, b) => a - b)) dfs(k); };
    for (const r of (kids.get(-1) || []).sort((a, b) => a - b)) dfs(r);
    for (const c of Object.values(clades)) if (!order.includes(c.id)) order.push(c.id);

    const CH = run.cladeHist;
    const px0 = 8, px1 = w - 70, py0 = 10, py1 = h - 20;
    const cols = Math.min(CH.length, Math.floor((px1 - px0) / 2));
    const samples = [];
    for (let c = 0; c < cols; c++) samples.push(CH[Math.floor(c * (CH.length - 1) / Math.max(1, cols - 1))]);
    const X = i => px0 + i / Math.max(1, samples.length - 1) * (px1 - px0);
    const tops = samples.map(() => 0);
    const total = samples.map(s => Object.values(s.c).reduce((a, b) => a + b, 0) || 1);
    const bands = [];
    for (const id of order) {
      const lower = tops.slice();
      let any = false;
      samples.forEach((s, i) => { const v = (s.c[id] || 0) / total[i]; if (v > 0) any = true; tops[i] += v; });
      if (!any) continue;
      bands.push({ id, lower, upper: tops.slice() });
    }
    const Y = v => py1 - v * (py1 - py0);
    for (const b of bands) {
      const c = clades[b.id];
      ctx.fillStyle = `hsl(${c.hue},62%,${run.champClade === b.id ? 58 : 44}%)`;
      ctx.beginPath();
      samples.forEach((_, i) => { const x = X(i), y = Y(b.upper[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      for (let i = samples.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(b.lower[i]));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(8,13,26,0.5)'; ctx.lineWidth = 0.6; ctx.stroke();
      this.hits.push({ id: b.id, x0: px0, x1: px1, fn: (y, x) => { const i = Math.round((x - px0) / (px1 - px0) * (samples.length - 1)); return i >= 0 && i < samples.length && y <= Y(b.lower[i]) && y >= Y(b.upper[i]); } });
      // 右端ラベル
      const L = samples.length - 1, share = b.upper[L] - b.lower[L];
      if (share > 0.07) {
        const y = Y((b.upper[L] + b.lower[L]) / 2);
        ctx.fillStyle = `hsl(${c.hue},70%,70%)`; ctx.font = '600 11px system-ui'; ctx.textAlign = 'left';
        ctx.fillText(`${c.label} ${Math.round(share * 100)}%`, px1 + 6, y + 4);
      }
    }
    ctx.fillStyle = 'rgba(180,200,240,0.6)'; ctx.font = '10px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(`第${samples[0].g}世代`, px0, h - 6);
    ctx.textAlign = 'right'; ctx.fillText(`第${samples[samples.length - 1].g}世代`, px1, h - 6);
  }
}
