// 小さなグラフ（canvas 2D）
const DPR = () => Math.min(2, window.devicePixelRatio || 1);

function prep(cv) {
  const r = cv.getBoundingClientRect();
  const w = Math.max(10, r.width), h = Math.max(10, r.height);
  const d = DPR();
  if (cv.width !== Math.round(w * d) || cv.height !== Math.round(h * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  const g = cv.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
const css = (name, fb) => getComputedStyle(document.body).getPropertyValue(name).trim() || fb;

// 成長のグラフ: 世代ごとの「記録（支えなし）」と「ぬしの記録」の線
export function growthChart(cv, sp, masterRec, marks = []) {
  const { g, w, h } = prep(cv);
  const d = sp.hist.d, a = sp.hist.a, n = d.length;
  const L = 34, R = 8, T = 10, B = 20;
  const era = css('--era', '#f2a65a'), ink2 = css('--ink-2', '#b4b6c4'), line = 'rgba(243,236,223,0.13)';
  let hi = Math.max(0.5, masterRec * 1.15, ...d.slice(-2000).map(v => v || 0));
  hi = niceCeil(hi);
  const lo = Math.min(0, ...d.map(v => v || 0));
  const X = (i) => L + (w - L - R) * (n <= 1 ? 0 : i / (n - 1));
  const Y = (v) => T + (h - T - B) * (1 - (v - lo) / (hi - lo || 1));
  g.font = '11px system-ui, sans-serif';
  g.fillStyle = ink2; g.strokeStyle = line; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, y = Y(v);
    g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
    g.fillText(`${v.toFixed(v < 10 ? 1 : 0)}m`, 2, y + 4);
  }
  g.fillText(n ? `第${n}世代` : '', w - R - 52, h - 5);
  g.fillText('第1世代', L, h - 5);
  // 支えの手の期間（薄い帯）
  for (let i = 0; i < n; i++) if (a[i] > 0) { g.fillStyle = `rgba(111,211,232,${0.05 + 0.12 * a[i]})`; g.fillRect(X(i) - 1, T, Math.max(1.5, (w - L - R) / Math.max(1, n - 1)) + 1, h - T - B); }
  // ぬし
  if (masterRec > 0) {
    g.setLineDash([5, 4]); g.strokeStyle = ink2; g.beginPath(); g.moveTo(L, Y(masterRec)); g.lineTo(w - R, Y(masterRec)); g.stroke(); g.setLineDash([]);
    g.fillStyle = ink2; g.fillText('ぬし', w - R - 26, Y(masterRec) - 4);
  }
  // 各世代のいちばん（点）と、それまでの最高（線）
  g.fillStyle = 'rgba(243,236,223,0.35)';
  for (let i = 0; i < n; i++) g.fillRect(X(i) - 1, Y(d[i] || 0) - 1, 2, 2);
  g.strokeStyle = era; g.lineWidth = 2; g.beginPath();
  let best = -1e9;
  for (let i = 0; i < n; i++) {
    if (a[i] === 0 && d[i] > best) best = d[i];
    const v = best > -1e9 ? best : 0;
    if (i === 0) g.moveTo(X(i), Y(v)); else g.lineTo(X(i), Y(v));
  }
  g.stroke();
  // 節目
  g.fillStyle = era;
  for (const m of marks) { if (m.gen < 1 || m.gen > n) continue; const x = X(m.gen - 1); g.beginPath(); g.arc(x, T + 3, 3, 0, Math.PI * 2); g.fill(); }
}

function niceCeil(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// 足あと図（足ごとの接地）: rows = [{ name, contact: Uint8Array(frames) }]
export function footfallChart(cv, rows, frames) {
  const { g, w, h } = prep(cv);
  const ink = css('--ink', '#f3ecdf'), ink2 = css('--ink-2', '#b4b6c4');
  const L = 52, rh = Math.min(16, (h - 6) / Math.max(1, rows.length));
  g.font = '11px system-ui, sans-serif';
  rows.forEach((r, k) => {
    const y = 3 + k * rh;
    g.fillStyle = ink2; g.fillText(r.name.slice(0, 5), 2, y + rh * 0.75);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(L, y + 1, w - L - 4, rh - 2);
    g.fillStyle = ink;
    const n = frames;
    let run = -1;
    for (let f = 0; f <= n; f++) {
      const on = f < n && r.contact[f];
      if (on && run < 0) run = f;
      if (!on && run >= 0) { g.fillRect(L + (w - L - 4) * run / n, y + 2, Math.max(1, (w - L - 4) * (f - run) / n), rh - 4); run = -1; }
    }
  });
}

// 角度の曲線（あなた vs ヒト）
export function angleChart(cv, sim, ref, { lo = -30, hi = 70 } = {}) {
  const { g, w, h } = prep(cv);
  const era = css('--era', '#f2a65a'), ink2 = css('--ink-2', '#b4b6c4');
  const all = [...sim, ...ref];
  lo = Math.min(lo, ...all) - 3; hi = Math.max(hi, ...all) + 3;
  const X = (i, n) => 4 + (w - 8) * i / (n - 1);
  const Y = (v) => 4 + (h - 8) * (1 - (v - lo) / (hi - lo));
  g.strokeStyle = 'rgba(243,236,223,0.12)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(4, Y(0)); g.lineTo(w - 4, Y(0)); g.stroke();
  // つま先が離れるころ（約60%）
  g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(60, 101), 4); g.lineTo(X(60, 101), h - 4); g.stroke(); g.setLineDash([]);
  const draw = (arr, col, wd) => { g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); arr.forEach((v, i) => (i ? g.lineTo(X(i, arr.length), Y(v)) : g.moveTo(X(i, arr.length), Y(v)))); g.stroke(); };
  draw(ref, ink2, 1.5);
  draw(sim, era, 2.2);
}

// 神経のリズム（位相の時計）
export function phaseDial(cv, phase, freq, feetOn = []) {
  const { g, w, h } = prep(cv);
  const nerve = css('--nerve', '#6fd3e8'), ink2 = css('--ink-2', '#b4b6c4');
  const cx = h / 2, cy = h / 2, r = h / 2 - 6;
  g.strokeStyle = 'rgba(111,211,232,0.25)'; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = nerve; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + phase); g.stroke();
  g.fillStyle = nerve;
  g.beginPath(); g.arc(cx + r * Math.sin(phase), cy - r * Math.cos(phase), 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = ink2; g.font = '12px system-ui, sans-serif';
  g.fillText(`リズム ${freq.toFixed(2)}回/秒`, h + 8, cy - 4);
  g.fillText(feetOn.length ? `接地: ${feetOn.join(' ')}` : '接地なし', h + 8, cy + 14);
}
