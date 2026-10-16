// CNN の自己テスト：node tools/check_cnn.mjs
// 1) 誤差逆伝播の勾配を数値微分と比べる（倍精度で）
// 2) 簡単な合成画像（赤い四角が左・中央・右のどこか）を学習できるか、Grad-CAM が四角を指すか
import { createModel, makeWorkspace, forward, backward, gradCam, fillInput, runTraining, rng, DEFAULT_CONFIG } from '../js/cnn.js';

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// ---- 1) 勾配チェック ----
{
  const model = createModel(DEFAULT_CONFIG, 3);
  model.P = Float64Array.from(model.P);
  const ws = makeWorkspace(model);
  const to64 = (a) => (a ? new Float64Array(a.length) : null);
  for (const k of ['h', 'dh', 'logits', 'probs', 'dl', 'cam']) ws[k] = to64(ws[k]);
  for (const k of ['a', 'dA', 'cols', 'dcols']) ws[k] = ws[k].map(to64);
  const r = rng(11);
  const input = new Float64Array(ws.a[0].length).map(() => r() - 0.5);
  const y = 2;
  const lossAt = () => { ws.a[0].set(input); const p = forward(model, ws); return -Math.log(p[y]); };
  lossAt();
  const G = new Float64Array(model.P.length);
  for (let c = 0; c < 3; c++) ws.dl[c] = ws.probs[c] - (c === y ? 1 : 0);
  backward(model, ws, G, 0);
  let worst = 0;
  for (let t = 0; t < 200; t++) {
    const i = Math.floor(r() * model.P.length);
    const o = model.P[i], eps = 1e-6;
    model.P[i] = o + eps; const lp = lossAt();
    model.P[i] = o - eps; const lm = lossAt();
    model.P[i] = o;
    const num = (lp - lm) / (2 * eps), ana = G[i];
    if (Math.abs(num) + Math.abs(ana) < 1e-9) continue;
    worst = Math.max(worst, Math.abs(num - ana) / (Math.abs(num) + Math.abs(ana)));
  }
  check(worst < 1e-3, `勾配が数値微分と一致（最大相対誤差 ${worst.toExponential(1)}）`);
}

// ---- 2) 合成データの学習と Grad-CAM ----
{
  const S = 64 * 64 * 3;
  const makeImg = (cls, rr) => {
    const im = new Uint8Array(S);
    for (let i = 0; i < 64 * 64; i++) { im[i * 3] = 90 + rr() * 20; im[i * 3 + 1] = 150 + rr() * 20; im[i * 3 + 2] = 90 + rr() * 20; }
    const cx = [14, 32, 50][cls] + Math.floor((rr() - 0.5) * 8), cy = 30 + Math.floor((rr() - 0.5) * 16);
    for (let yy = cy - 5; yy <= cy + 5; yy++) for (let x = cx - 5; x <= cx + 5; x++) { const i = (yy * 64 + x) * 3; im[i] = 230; im[i + 1] = 40; im[i + 2] = 50; }
    return im;
  };
  const n = 500, data = new Uint8Array(n * S), labels = new Uint8Array(n);
  const rr = rng(5);
  for (let i = 0; i < n; i++) { const c = Math.floor(rr() * 3); labels[i] = c; data.set(makeImg(c, rr), i * S); }
  const model = createModel(DEFAULT_CONFIG, 9);
  const t0 = Date.now();
  const res = await runTraining({ model, data, labels, n, epochs: 3 });
  const last = res.history[res.history.length - 1];
  check(last.valAcc > 0.95, `合成データの検証正解率 ${(last.valAcc * 100).toFixed(0)}%（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
  const ws = makeWorkspace(model);
  fillInput(ws.a[0], makeImg(2, rng(99)));
  forward(model, ws);
  const cam = gradCam(model, ws, 2);
  let bx = 0, bv = -1;
  for (let i = 0; i < cam.length; i++) if (cam[i] > bv) { bv = cam[i]; bx = i % ws.camW; }
  check(bx >= ws.camW / 2, `Grad-CAM が右側の四角を指す（x=${bx}/${ws.camW}）`);
}

process.exit(failed ? 1 : 0);
