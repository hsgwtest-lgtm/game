// 小さな畳み込みニューラルネット（CNN）を素の JavaScript で実装したもの。
// 外部ライブラリなしで、学習（誤差逆伝播 + Adam）と Grad-CAM（判断の根拠マップ）まで行う。
// ブラウザのメインスレッド・Web Worker・Node.js のどこでも動く。
//
// データの並びは CHW（チャンネル → 行 → 列）。入力は 64×64 のカラー画像。
//   入力 3×64×64
//   → 畳み込み1 (5×5, ストライド2) → 8×30×30
//   → 畳み込み2 (3×3, ストライド2) → 16×14×14   ← Grad-CAM はここで計算
//   → 畳み込み3 (3×3, ストライド2) → 24×6×6
//   → 全結合 → 32 → 3（左 / 直進 / 右）

export const CLASSES = ['左', '直進', '右'];

export const DEFAULT_CONFIG = {
  inC: 3, inH: 64, inW: 64,
  convs: [
    { out: 8, k: 5, s: 2 },
    { out: 16, k: 3, s: 2 },
    { out: 24, k: 3, s: 2 },
  ],
  hidden: 32,
  classes: 3,
  camLayer: 2, // Grad-CAM を計算する畳み込み層（1 始まり）
};

// ---------- 乱数（シード付き） ----------
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- モデルの形とパラメータ ----------
export function describe(cfg = DEFAULT_CONFIG) {
  const layers = [];
  let C = cfg.inC, H = cfg.inH, W = cfg.inW, off = 0;
  for (const c of cfg.convs) {
    const Ho = Math.floor((H - c.k) / c.s) + 1, Wo = Math.floor((W - c.k) / c.s) + 1;
    const nW = c.out * C * c.k * c.k;
    layers.push({ type: 'conv', Ci: C, Hi: H, Wi: W, Co: c.out, k: c.k, s: c.s, Ho, Wo, wOff: off, bOff: off + nW });
    off += nW + c.out;
    C = c.out; H = Ho; W = Wo;
  }
  const flat = C * H * W;
  const d1 = { type: 'dense', nIn: flat, nOut: cfg.hidden, wOff: off, bOff: off + flat * cfg.hidden };
  off += flat * cfg.hidden + cfg.hidden;
  const d2 = { type: 'dense', nIn: cfg.hidden, nOut: cfg.classes, wOff: off, bOff: off + cfg.hidden * cfg.classes };
  off += cfg.hidden * cfg.classes + cfg.classes;
  return { cfg, layers, d1, d2, size: off, flat };
}

export function createModel(cfg = DEFAULT_CONFIG, seed = 7) {
  const shape = describe(cfg);
  const P = new Float32Array(shape.size);
  const r = rng(seed);
  for (const L of shape.layers) {
    const std = Math.sqrt(2 / (L.Ci * L.k * L.k)); // He 初期化
    for (let i = 0; i < L.bOff - L.wOff; i++) P[L.wOff + i] = gauss(r) * std;
  }
  for (const D of [shape.d1, shape.d2]) {
    const std = Math.sqrt(2 / D.nIn) * (D === shape.d2 ? 0.5 : 1);
    for (let i = 0; i < D.nIn * D.nOut; i++) P[D.wOff + i] = gauss(r) * std;
  }
  return { shape, P };
}

// 計算用の作業領域（毎回確保しないように使い回す）
export function makeWorkspace(model) {
  const { shape } = model;
  const cfg = shape.cfg;
  const a = [new Float32Array(cfg.inC * cfg.inH * cfg.inW)];
  const dA = [null];
  const cols = [], dcols = [];
  shape.layers.forEach((L, i) => {
    a.push(new Float32Array(L.Co * L.Ho * L.Wo));
    dA.push(new Float32Array(L.Co * L.Ho * L.Wo));
    cols.push(new Float32Array(L.Ho * L.Wo * L.Ci * L.k * L.k));
    dcols.push(i > 0 ? new Float32Array(L.Ho * L.Wo * L.Ci * L.k * L.k) : null); // 入力層への勾配は不要
  });
  const camL = shape.layers[cfg.camLayer - 1];
  return {
    a, dA, cols, dcols,
    h: new Float32Array(cfg.hidden),
    dh: new Float32Array(cfg.hidden),
    logits: new Float32Array(cfg.classes),
    probs: new Float32Array(cfg.classes),
    dl: new Float32Array(cfg.classes),
    cam: new Float32Array(camL.Ho * camL.Wo),
    camW: camL.Wo, camH: camL.Ho,
  };
}

// ---------- 順伝播 ----------
// 畳み込みは「im2col」で、各出力位置の受容野を一列に並べてから内積をとる（JS でも速い）
function im2col(L, X, cols) {
  const { Ci, Hi, Wi, k, s, Ho, Wo } = L;
  const HWi = Hi * Wi;
  let q = 0;
  for (let oy = 0; oy < Ho; oy++) {
    for (let ox = 0; ox < Wo; ox++) {
      for (let c = 0; c < Ci; c++) {
        const xb = c * HWi + oy * s * Wi + ox * s;
        for (let ky = 0; ky < k; ky++) {
          let xi = xb + ky * Wi;
          for (let kx = 0; kx < k; kx++) cols[q++] = X[xi++];
        }
      }
    }
  }
}

function col2im(L, dcols, dX) {
  const { Ci, Hi, Wi, k, s, Ho, Wo } = L;
  const HWi = Hi * Wi;
  dX.fill(0);
  let q = 0;
  for (let oy = 0; oy < Ho; oy++) {
    for (let ox = 0; ox < Wo; ox++) {
      for (let c = 0; c < Ci; c++) {
        const xb = c * HWi + oy * s * Wi + ox * s;
        for (let ky = 0; ky < k; ky++) {
          let xi = xb + ky * Wi;
          for (let kx = 0; kx < k; kx++) dX[xi++] += dcols[q++];
        }
      }
    }
  }
}

function convForward(P, L, X, Y, cols) {
  im2col(L, X, cols);
  const { Co, Ho, Wo, wOff, bOff } = L;
  const Q = L.Ci * L.k * L.k, HW = Ho * Wo;
  for (let o = 0; o < Co; o++) {
    const wb = wOff + o * Q, yb = o * HW, bias = P[bOff + o];
    for (let p = 0; p < HW; p++) {
      let sum = bias;
      const cb = p * Q;
      for (let q = 0; q < Q; q++) sum += P[wb + q] * cols[cb + q];
      Y[yb + p] = sum > 0 ? sum : 0; // ReLU
    }
  }
}

export function forward(model, ws) {
  const { P, shape } = model;
  const { a, h, logits, probs } = ws;
  shape.layers.forEach((L, i) => convForward(P, L, a[i], a[i + 1], ws.cols[i]));
  const x = a[a.length - 1];
  const { d1, d2 } = shape;
  for (let j = 0; j < d1.nOut; j++) {
    let sum = P[d1.bOff + j];
    const wb = d1.wOff + j * d1.nIn;
    for (let i = 0; i < d1.nIn; i++) sum += P[wb + i] * x[i];
    h[j] = sum > 0 ? sum : 0;
  }
  for (let c = 0; c < d2.nOut; c++) {
    let sum = P[d2.bOff + c];
    const wb = d2.wOff + c * d2.nIn;
    for (let j = 0; j < d2.nIn; j++) sum += P[wb + j] * h[j];
    logits[c] = sum;
  }
  let mx = -Infinity;
  for (let c = 0; c < logits.length; c++) mx = Math.max(mx, logits[c]);
  let z = 0;
  for (let c = 0; c < logits.length; c++) { probs[c] = Math.exp(logits[c] - mx); z += probs[c]; }
  for (let c = 0; c < logits.length; c++) probs[c] /= z;
  return probs;
}

// ---------- 逆伝播 ----------
// dY は出力（ReLU 後）に対する勾配。G が null なら重みの勾配は計算しない。
// cols は順伝播のときに作った im2col をそのまま使う。
function convBackward(P, L, Y, dY, G, dX, cols, dcols) {
  const { Co, Ho, Wo, wOff, bOff } = L;
  const Q = L.Ci * L.k * L.k, HW = Ho * Wo;
  for (let i = 0; i < Co * HW; i++) if (Y[i] <= 0) dY[i] = 0; // ReLU の微分
  if (dX) dcols.fill(0);
  for (let o = 0; o < Co; o++) {
    const wb = wOff + o * Q, yb = o * HW;
    for (let p = 0; p < HW; p++) {
      const g = dY[yb + p];
      if (g === 0) continue; // ReLU で止まった所は飛ばす（約半分）
      const cb = p * Q;
      if (G) {
        G[bOff + o] += g;
        for (let q = 0; q < Q; q++) G[wb + q] += g * cols[cb + q];
      }
      if (dX) for (let q = 0; q < Q; q++) dcols[cb + q] += g * P[wb + q];
    }
  }
  if (dX) col2im(L, dcols, dX);
}

// dl（ロジットに対する勾配）から逆向きに伝える。
// stopAt > 0 のときは、その畳み込み層の出力に対する勾配 dA[stopAt] を求めた時点で止める（Grad-CAM 用）。
export function backward(model, ws, G, stopAt = 0) {
  const { P, shape } = model;
  const { a, dA, h, dh, dl } = ws;
  const { d1, d2 } = shape;
  const nConv = shape.layers.length;
  const x = a[nConv];
  const dx = dA[nConv];
  // 全結合2
  dh.fill(0);
  for (let c = 0; c < d2.nOut; c++) {
    const g = dl[c];
    if (G) G[d2.bOff + c] += g;
    const wb = d2.wOff + c * d2.nIn;
    for (let j = 0; j < d2.nIn; j++) {
      if (G) G[wb + j] += g * h[j];
      dh[j] += g * P[wb + j];
    }
  }
  // 全結合1
  dx.fill(0);
  for (let j = 0; j < d1.nOut; j++) {
    if (h[j] <= 0) continue;
    const g = dh[j];
    if (g === 0) continue;
    if (G) G[d1.bOff + j] += g;
    const wb = d1.wOff + j * d1.nIn;
    if (G) {
      for (let i = 0; i < d1.nIn; i++) { G[wb + i] += g * x[i]; dx[i] += g * P[wb + i]; }
    } else {
      for (let i = 0; i < d1.nIn; i++) dx[i] += g * P[wb + i];
    }
  }
  if (stopAt === nConv) return dA[nConv];
  // 畳み込み層を後ろから
  for (let l = nConv; l >= 1; l--) {
    const L = shape.layers[l - 1];
    const needDX = l > 1 && l - 1 >= stopAt;
    convBackward(P, L, a[l], dA[l], G, needDX ? dA[l - 1] : null, ws.cols[l - 1], ws.dcols[l - 1]);
    if (stopAt > 0 && l - 1 === stopAt) return dA[stopAt];
  }
  return null;
}

// ---------- Grad-CAM：どこを見てそのクラスと判断したか ----------
// forward() のあとに呼ぶ。返り値は 0〜1 に正規化した camH×camW のマップ。
export function gradCam(model, ws, cls) {
  const layer = model.shape.cfg.camLayer;
  const L = model.shape.layers[layer - 1];
  ws.dl.fill(0);
  ws.dl[cls] = 1; // ソフトマックス前のスコアの勾配
  const grad = backward(model, ws, null, layer);
  const A = ws.a[layer];
  const HW = L.Ho * L.Wo;
  const cam = ws.cam;
  cam.fill(0);
  for (let k = 0; k < L.Co; k++) {
    let alpha = 0;
    for (let p = 0; p < HW; p++) alpha += grad[k * HW + p];
    alpha /= HW;
    if (alpha === 0) continue;
    for (let p = 0; p < HW; p++) cam[p] += alpha * A[k * HW + p];
  }
  let mx = 0;
  for (let p = 0; p < HW; p++) { if (cam[p] < 0) cam[p] = 0; if (cam[p] > mx) mx = cam[p]; }
  if (mx > 0) for (let p = 0; p < HW; p++) cam[p] /= mx;
  return cam;
}

// ---------- 入力の作り方 ----------
// rgb: 64×64 の RGB（上から下、行優先）Uint8Array。flip=true で左右反転（データ水増し用）。
export function fillInput(x, rgb, W = 64, H = 64, flip = false, gain = 1) {
  const HW = H * W, g = gain / 255;
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const si = (y * W + (flip ? W - 1 - xx : xx)) * 3;
      const di = y * W + xx;
      x[di] = rgb[si] * g - 0.5;
      x[HW + di] = rgb[si + 1] * g - 0.5;
      x[2 * HW + di] = rgb[si + 2] * g - 0.5;
    }
  }
}

// ---------- 最適化（Adam） ----------
export class Adam {
  constructor(n, { lr = 0.002, b1 = 0.9, b2 = 0.999, eps = 1e-8, wd = 1e-4 } = {}) {
    this.m = new Float32Array(n);
    this.v = new Float32Array(n);
    this.t = 0;
    Object.assign(this, { lr, b1, b2, eps, wd });
  }
  step(P, G, scale) {
    const { m, v, b1, b2, eps, lr, wd } = this;
    this.t++;
    const lrT = lr * Math.sqrt(1 - Math.pow(b2, this.t)) / (1 - Math.pow(b1, this.t));
    for (let i = 0; i < P.length; i++) {
      const g = G[i] * scale;
      m[i] = b1 * m[i] + (1 - b1) * g;
      v[i] = b2 * v[i] + (1 - b2) * g * g;
      P[i] -= lrT * m[i] / (Math.sqrt(v[i]) + eps) + lr * wd * P[i];
    }
  }
}

// ---------- 学習ループ ----------
// data: n 枚ぶんの RGB を詰めた Uint8Array、labels: 0=左 1=直進 2=右
// 検証用に 7 枚に 1 枚は学習に使わない。左右反転で「左」と「右」を入れ替えて水増しする。
export function isValidation(i) { return i % 7 === 3; }

export function classWeights(labels, n) {
  const cnt = [0, 0, 0];
  for (let i = 0; i < n; i++) if (!isValidation(i)) cnt[labels[i]]++;
  // 左右反転を半分の確率で行うので、左と右は平均した数になる
  const lr = (cnt[0] + cnt[2]) / 2;
  const eff = [lr, cnt[1], lr];
  const total = eff[0] + eff[1] + eff[2];
  return eff.map((c) => (c > 0 ? Math.min(3, Math.max(0.3, total / (3 * c))) : 1));
}

export async function runTraining(opts) {
  const {
    model, data, labels, n, epochs = 8, batch = 32, lr = 0.002, seed = 1,
    onProgress = () => {}, onEpoch = () => {}, shouldStop = () => false, tick = () => Promise.resolve(),
  } = opts;
  const { shape, P } = model;
  const cfg = shape.cfg;
  const S = cfg.inH * cfg.inW * cfg.inC;
  const ws = makeWorkspace(model);
  const G = new Float32Array(P.length);
  const opt = new Adam(P.length, { lr });
  const r = rng(seed);
  const train = [], val = [];
  for (let i = 0; i < n; i++) (isValidation(i) ? val : train).push(i);
  const cw = classWeights(labels, n);
  const flipLabel = [2, 1, 0];
  const batches = Math.ceil(train.length / batch);
  const history = [];

  for (let ep = 1; ep <= epochs; ep++) {
    // シャッフル
    for (let i = train.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [train[i], train[j]] = [train[j], train[i]];
    }
    let lossSum = 0, correct = 0, seen = 0;
    for (let b = 0; b < batches; b++) {
      G.fill(0);
      const end = Math.min(train.length, (b + 1) * batch);
      const bs = end - b * batch;
      for (let t = b * batch; t < end; t++) {
        const idx = train[t];
        const flip = r() < 0.5;
        const gain = 0.85 + r() * 0.3; // 明るさを少し揺らす
        fillInput(ws.a[0], data.subarray(idx * S, (idx + 1) * S), cfg.inW, cfg.inH, flip, gain);
        const y = flip ? flipLabel[labels[idx]] : labels[idx];
        const p = forward(model, ws);
        const w = cw[y];
        lossSum += -w * Math.log(p[y] + 1e-9);
        let am = 0;
        for (let c = 1; c < p.length; c++) if (p[c] > p[am]) am = c;
        if (am === y) correct++;
        seen++;
        for (let c = 0; c < p.length; c++) ws.dl[c] = w * (p[c] - (c === y ? 1 : 0));
        backward(model, ws, G, 0);
      }
      opt.step(P, G, 1 / bs);
      if (b % 4 === 3 || b === batches - 1) {
        onProgress({ epoch: ep, epochs, batch: b + 1, batches, loss: lossSum / seen, acc: correct / seen });
        await tick();
        if (shouldStop()) return { stopped: true, history };
      }
    }
    const v = evaluate(model, ws, data, labels, val, S);
    const rec = { epoch: ep, trainLoss: lossSum / seen, trainAcc: correct / seen, valLoss: v.loss, valAcc: v.acc, valN: val.length };
    history.push(rec);
    onEpoch(rec);
    await tick();
    if (shouldStop()) return { stopped: true, history };
  }
  return { stopped: false, history };
}

export function evaluate(model, ws, data, labels, idxs, S) {
  const cfg = model.shape.cfg;
  let loss = 0, correct = 0;
  for (const idx of idxs) {
    fillInput(ws.a[0], data.subarray(idx * S, (idx + 1) * S), cfg.inW, cfg.inH, false, 1);
    const p = forward(model, ws);
    const y = labels[idx];
    loss += -Math.log(p[y] + 1e-9);
    let am = 0;
    for (let c = 1; c < p.length; c++) if (p[c] > p[am]) am = c;
    if (am === y) correct++;
  }
  const k = Math.max(1, idxs.length);
  return { loss: loss / k, acc: idxs.length ? correct / k : 0 };
}
