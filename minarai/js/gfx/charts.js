// 小さな折れ線グラフ（Canvas 2D）
// opt = { series: [{ pts: [[x, y], …], color, dash, width }], hlines: [{ y, color, dash, label }],
//         xMax, yMin, yMax, yFmt(v), xFmt(v), yTicks: [..], empty: 'データがないときの文' }
export function drawChart(canvas, opt) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const L = 34, R = 8, T = 8, B = 18, pw = w - L - R, ph = h - T - B;
  const yMin = opt.yMin ?? 0, yMax = opt.yMax ?? 1;
  let xMax = opt.xMax || 0;
  for (const s of opt.series || []) for (const p of s.pts) if (p[0] > xMax) xMax = p[0];
  if (xMax <= 0) xMax = 1;
  const X = (x) => L + (x / xMax) * pw, Y = (y) => T + (1 - (y - yMin) / (yMax - yMin)) * ph;
  g.font = '10px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
  const ticks = opt.yTicks || [yMin, (yMin + yMax) / 2, yMax];
  for (const t of ticks) {
    g.strokeStyle = 'rgba(120,150,220,0.16)'; g.lineWidth = 1; g.setLineDash([]);
    g.beginPath(); g.moveTo(L, Y(t) + 0.5); g.lineTo(w - R, Y(t) + 0.5); g.stroke();
    g.fillStyle = '#7f8db5'; g.textAlign = 'right';
    g.fillText(opt.yFmt ? opt.yFmt(t) : String(t), L - 5, Y(t));
  }
  g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillStyle = '#7f8db5';
  g.fillText(opt.xFmt ? opt.xFmt(xMax) : String(xMax), w - R, h - 4);
  g.textAlign = 'left'; g.fillText(opt.xFmt ? opt.xFmt(0) : '0', L, h - 4);
  for (const hl of opt.hlines || []) {
    g.strokeStyle = hl.color; g.lineWidth = 1.5; g.setLineDash(hl.dash || [5, 4]);
    g.beginPath(); g.moveTo(L, Y(hl.y)); g.lineTo(w - R, Y(hl.y)); g.stroke();
    if (hl.label) { g.setLineDash([]); g.fillStyle = hl.color; g.textAlign = 'right'; g.fillText(hl.label, w - R - 2, Y(hl.y) < T + 14 ? Y(hl.y) + 12 : Y(hl.y) - 4); }
  }
  let any = (opt.hlines || []).length > 0;
  for (const s of opt.series || []) {
    if (!s.pts.length) continue;
    any = true;
    g.strokeStyle = s.color; g.lineWidth = s.width || 2; g.setLineDash(s.dash || []); g.lineJoin = 'round';
    g.shadowColor = s.color; g.shadowBlur = 6;
    g.beginPath();
    s.pts.forEach((p, i) => { const x = X(p[0]), y = Y(Math.max(yMin, Math.min(yMax, p[1]))); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.shadowBlur = 0;
    if (s.pts.length === 1) { g.fillStyle = s.color; g.beginPath(); g.arc(X(s.pts[0][0]), Y(s.pts[0][1]), 3, 0, 7); g.fill(); }
  }
  g.setLineDash([]);
  if (!any && opt.empty) { g.fillStyle = '#7f8db5'; g.textAlign = 'center'; g.font = '12px sans-serif'; g.fillText(opt.empty, L + pw / 2, T + ph / 2); }
}
