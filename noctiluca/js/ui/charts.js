// 学習曲線などの小さなグラフ（canvas 2D）
export const COL = {
  noc: '#49c8ff', gold: '#f2c35b', jelly: '#ff5fa8', foam: '#e2f3ff', cur: '#6f86a3', line: 'rgba(140,190,230,0.16)',
};

export function prep(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function smooth(arr, k = 0.25) {
  const out = [];
  let s = null;
  for (const v of arr) { s = s === null ? v : s + (v - s) * k; out.push(s); }
  return out;
}

// hist: [{g, c(いまの本能), e(最高記録), b(その世代の最高)}], 値は 0..1
export function drawLearning(cv, hist, { pass = [], label = '' } = {}) {
  const { ctx, w, h } = prep(cv);
  const L = 30, R = 10, T = 12, B = 18;
  const pw = w - L - R, ph = h - T - B;
  ctx.font = '10px -apple-system, "Hiragino Sans", sans-serif';
  ctx.fillStyle = COL.cur;
  ctx.strokeStyle = COL.line;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = T + ph * (1 - i / 4);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.fillText(`${i * 25}%`, 2, y + 3);
  }
  // 合格ライン
  pass.forEach((p, i) => {
    const y = T + ph * (1 - p);
    ctx.strokeStyle = i === 0 ? 'rgba(242,195,91,0.7)' : 'rgba(242,195,91,0.28)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(242,195,91,0.8)';
    ctx.fillText('★'.repeat(i + 1), L + pw - 8 - i * 9, y - 3);
  });
  if (!hist.length) {
    ctx.fillStyle = COL.cur;
    ctx.fillText('最初の世代が終わると、ここに学習曲線が出ます', L + 6, T + ph / 2);
    return;
  }
  const n = hist.length;
  const g0 = hist[0].g, g1 = Math.max(hist[n - 1].g, g0 + 8);
  const X = (g) => L + ((g - g0) / (g1 - g0)) * pw;
  const Y = (v) => T + ph * (1 - Math.max(0, Math.min(1, v)));
  // 各世代の最高（点）
  ctx.fillStyle = 'rgba(242,195,91,0.5)';
  for (const r of hist) { ctx.fillRect(X(r.g) - 1, Y(r.b) - 1, 2, 2); }
  // いまの本能（点＋なめらかな線）
  ctx.fillStyle = 'rgba(73,200,255,0.45)';
  for (const r of hist) { ctx.fillRect(X(r.g) - 1, Y(r.c) - 1, 2, 2); }
  const sm = smooth(hist.map((r) => r.c), 0.22);
  ctx.strokeStyle = COL.noc;
  ctx.lineWidth = 2;
  ctx.beginPath();
  hist.forEach((r, i) => { const x = X(r.g), y = Y(sm[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  const smb = smooth(hist.map((r) => r.e), 0.22);
  ctx.strokeStyle = 'rgba(242,195,91,0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  hist.forEach((r, i) => { const x = X(r.g), y = Y(smb[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  // 世代の目盛り
  ctx.fillStyle = COL.cur;
  ctx.fillText(`${g0 + 1}`, L, h - 4);
  const gt = `${hist[n - 1].g + 1} 世代`;
  ctx.fillText(gt, L + pw - ctx.measureText(gt).width, h - 4);
  if (label) ctx.fillText(label, L + 4, T + 8);
}

export function drawSpark(cv, values, color = COL.noc) {
  const { ctx, w, h } = prep(cv);
  if (values.length < 2) return;
  const mn = Math.min(...values), mx = Math.max(...values);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - mn) / Math.max(1e-6, mx - mn)) * (h - 4) - 2;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.stroke();
}
