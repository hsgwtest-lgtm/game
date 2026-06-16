'use strict';
/* ============================================================
   game.js  ── ゲームロジック・キャンバス描画
   ヨーロピアンルーレット練習アプリ
   ui.js より先に読み込むこと
   ============================================================ */

// ── 定数 ─────────────────────────────────────────────────────
// ヨーロピアンホイール配列（時計回り、0番からスタート）
const WHEEL = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,
  11,30,8,23,10,5,24,16,33,1,20,14,31,9,
  22,18,29,7,28,12,35,3,26
];
// 赤マス番号セット
const REDS  = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const N     = 37;                      // 総ポケット数（0〜36）
const SLICE = (2 * Math.PI) / N;      // 1ポケット分の中心角
const BUF   = 300;                     // キャンバスバッファサイズ (px)
const DUR   = 5400;                    // スピンアニメーション時間 (ms)
const CHIPS = [100, 500, 1000, 5000]; // 選択可能なチップ額

// アウトサイドベット定義（配当 1:1）
const OUTSIDE_DEFS = [
  { k: 'low',  l: '1〜18',  p: 1, bg: '#0c2610', chk: n => n >= 1 && n <= 18 },
  { k: 'even', l: '偶数',   p: 1, bg: '#0c2610', chk: n => n > 0 && n % 2 === 0 },
  { k: 'red',  l: '赤',     p: 1, bg: '#560000', chk: n => getClr(n) === 'r' },
  { k: 'blk',  l: '黒',     p: 1, bg: '#080808', chk: n => getClr(n) === 'b' },
  { k: 'odd',  l: '奇数',   p: 1, bg: '#0c2610', chk: n => n > 0 && n % 2 === 1 },
  { k: 'high', l: '19〜36', p: 1, bg: '#0c2610', chk: n => n >= 19 && n <= 36 },
];
// ダズンベット定義（配当 2:1）
const DOZEN_DEFS = [
  { k: 'd1', l: '1st 12', p: 2, bg: '#0e240e', chk: n => n >= 1  && n <= 12 },
  { k: 'd2', l: '2nd 12', p: 2, bg: '#0e240e', chk: n => n >= 13 && n <= 24 },
  { k: 'd3', l: '3rd 12', p: 2, bg: '#0e240e', chk: n => n >= 25 && n <= 36 },
];
// コラムベット定義（配当 2:1）── ボード右端の 2:1 ボタン
const COL_DEFS = [
  { k: 'c3', l: '2:1', p: 2, bg: '#0a1b0a', chk: n => n > 0 && n % 3 === 0 }, // 上行: 3,6,9,...36
  { k: 'c2', l: '2:1', p: 2, bg: '#0a1b0a', chk: n => n > 0 && n % 3 === 2 }, // 中行: 2,5,8,...35
  { k: 'c1', l: '2:1', p: 2, bg: '#0a1b0a', chk: n => n > 0 && n % 3 === 1 }, // 下行: 1,4,7,...34
];
const ALL_DEFS = [...OUTSIDE_DEFS, ...DOZEN_DEFS, ...COL_DEFS];

// ── ヘルパー関数 ──────────────────────────────────────────────
/** 番号の色コードを返す: 'r'=赤 / 'b'=黒 / 'g'=緑(0) */
function getClr(n)   { return n === 0 ? 'g' : REDS.has(n) ? 'r' : 'b'; }
function clrLabel(c) { return c === 'r' ? '赤' : c === 'b' ? '黒' : '緑'; }
function clrHex(c)   { return c === 'r' ? '#BB2000' : c === 'b' ? '#111' : c === 'g' ? '#007A3D' : '#444'; }
function sumB(obj)   { return Object.values(obj).reduce((a, v) => a + v, 0); }
function fmtYen(v)   { return `¥${v.toLocaleString('ja-JP')}`; }
function fmtBadge(v) { return v >= 1000 ? `${v / 1000}K` : `${v}`; }

// ── 配当計算 ──────────────────────────────────────────────────
/**
 * ベット一覧と当選番号から払戻総額を計算する
 * @param {Object} bets   { betKey: 賭け額 }
 * @param {number} winNum 当選番号
 * @returns {number} 払戻額合計（ベット額含む）
 */
function calcWin(bets, winNum) {
  let total = 0;
  Object.entries(bets).forEach(([k, amt]) => {
    if (!amt) return;
    if (k[0] === 'N') {
      // ストレートアップ 35:1 → ベット込みで 36 倍返却
      if (parseInt(k.slice(1)) === winNum) total += amt * 36;
    } else {
      const def = ALL_DEFS.find(d => d.k === k);
      if (def && def.chk(winNum)) total += amt * (def.p + 1);
    }
  });
  return total;
}

// ── ゲーム状態 ────────────────────────────────────────────────
const state = {
  balance:  10000, // 現在の残高
  chip:     500,   // 選択中チップ額
  bets:     {},    // 現在のベット { betKey: 額 }
  lastBets: null,  // 直前スピンのベット（リベット用）
  spinning: false, // スピン中フラグ
  result:   null,  // 直前の結果 { n:番号, c:色, w:払戻額 }
  history:  [],    // 履歴 [{ n, c, net }] 新→古
};

// ── アニメーション状態 ────────────────────────────────────────
const anim = {
  wa:   0,     // ホイール現在角度 (rad)
  ba:   0,     // ボール現在角度 (rad)
  br:   0,     // ボール現在半径 (px)
  wi:   -1,    // 当選ポケットのインデックス
  p1ba: null,  // フェーズ1終了時のボール角度（フェーズ2補間用）
  fwa:  0,     // ホイール最終角度
  fba:  0,     // ボール最終角度
  ouR:  0,     // ボール外側軌道半径
  inR:  0,     // ボール落下先（ポケット中央）半径
  fid:  null,  // requestAnimationFrame の ID
};

// ── 永続化（localStorage） ────────────────────────────────────
// iOS Safari プライベートブラウジングでは setItem が例外を投げるため
// 必ず try/catch でラップする
const STORAGE_KEY = 'roulette_practice_v1';

/** balance / lastBets / history を localStorage へ保存 */
function saveState() {
  try {
    const payload = {
      balance:  state.balance,
      lastBets: state.lastBets,
      history:  state.history,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    // プライベートブラウジング等で書き込み不可の場合は黙って無視
  }
}

/** localStorage から状態を復元する。失敗時は初期状態を維持 */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.balance === 'number' && data.balance >= 0) {
      state.balance = data.balance;
    }
    if (data.lastBets && typeof data.lastBets === 'object') {
      state.lastBets = data.lastBets;
    }
    if (Array.isArray(data.history)) {
      state.history = data.history.slice(0, 20);
    }
  } catch (e) {
    // 読み込み・パース失敗時は初期状態のまま続行
  }
}

// ── キャンバス初期化 ──────────────────────────────────────────
const canvas = document.getElementById('wheelCanvas');
const ctx    = canvas.getContext('2d');
canvas.width  = BUF;
canvas.height = BUF;

// ── ホイール描画 ──────────────────────────────────────────────
/**
 * ルーレットホイール全体をキャンバスに描画する
 * @param {number} wa  ホイール回転角 (rad)
 * @param {number} ba  ボール角度 (rad)
 * @param {number} br  ボール半径 (px)  ≤0 で非表示
 * @param {number} wi  ハイライトするポケットindex  -1 でなし
 */
function drawWheel(wa, ba, br, wi) {
  const cx = BUF / 2, cy = BUF / 2, R = cx - 5;
  ctx.clearRect(0, 0, BUF, BUF);

  // 木製外リム（ラジアルグラデーション）
  const g1 = ctx.createRadialGradient(cx * 0.62, cy * 0.62, 0, cx, cy, R);
  g1.addColorStop(0,    '#D4A843');
  g1.addColorStop(0.72, '#8B6914');
  g1.addColorStop(1,    '#3A1E00');
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = g1; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2);
  ctx.strokeStyle = '#EDD060'; ctx.lineWidth = 2.5; ctx.stroke();

  const pO = R * 0.87; // ポケット外径
  const pI = R * 0.54; // ポケット内径

  // ── ポケット（番号マス）──────────────────────────────────
  WHEEL.forEach((num, i) => {
    const a1 = wa + i * SLICE - SLICE / 2; // セクター開始角
    const a2 = a1 + SLICE;                  // セクター終了角
    const ma = wa + i * SLICE;              // セクター中央角

    // セクター塗りつぶし
    ctx.beginPath();
    ctx.arc(cx, cy, pO, a1, a2);
    ctx.arc(cx, cy, pI, a2, a1, true);
    ctx.closePath();
    const isWin = (i === wi);
    if (num === 0)          ctx.fillStyle = isWin ? '#00EE55' : '#007A3D'; // 緑
    else if (REDS.has(num)) ctx.fillStyle = isWin ? '#FF5544' : '#BB2000'; // 赤
    else                    ctx.fillStyle = isWin ? '#4A4A4A' : '#0D0D0D'; // 黒
    ctx.fill();
    ctx.strokeStyle = 'rgba(210,168,60,0.45)'; ctx.lineWidth = 0.4; ctx.stroke();

    // 番号テキスト（セクター中央に縦向きで配置）
    const tR = (pO + pI) / 2;
    const tx = cx + tR * Math.cos(ma);
    const ty = cy + tR * Math.sin(ma);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(ma + Math.PI / 2);
    ctx.fillStyle = '#FFF';
    ctx.font = `bold ${R * 0.068}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(num.toString(), 0, 0);
    ctx.restore();
  });

  // ── 内側仕切りリング ─────────────────────────────────────
  ctx.beginPath(); ctx.arc(cx, cy, pI + 1, 0, Math.PI * 2);
  ctx.strokeStyle = '#D4A843'; ctx.lineWidth = 2; ctx.stroke();

  // ── クロームボウル（ボールが転がる金属面） ───────────────
  const g2 = ctx.createRadialGradient(cx, cy, pI * 0.15, cx, cy, pI);
  g2.addColorStop(0,   '#C8C8C8');
  g2.addColorStop(0.5, '#747474');
  g2.addColorStop(1,   '#505050');
  ctx.beginPath(); ctx.arc(cx, cy, pI, 0, Math.PI * 2);
  ctx.fillStyle = g2; ctx.fill();

  // ── センターハブ（金色） ─────────────────────────────────
  const hR = pI * 0.50;
  const g3 = ctx.createRadialGradient(cx - hR * 0.3, cy - hR * 0.3, 0, cx, cy, hR);
  g3.addColorStop(0,    '#FFE87C');
  g3.addColorStop(0.45, '#C9A84C');
  g3.addColorStop(1,    '#6A4E00');
  ctx.beginPath(); ctx.arc(cx, cy, hR, 0, Math.PI * 2);
  ctx.fillStyle = g3; ctx.fill();
  ctx.strokeStyle = '#8B6914'; ctx.lineWidth = 1.5; ctx.stroke();
  // 中心ポイント
  ctx.beginPath(); ctx.arc(cx, cy, hR * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,248,200,0.85)'; ctx.fill();

  // ── ボール ───────────────────────────────────────────────
  if (br > 0) {
    const bx = cx + br * Math.cos(ba);
    const by = cy + br * Math.sin(ba);
    // 影
    ctx.beginPath(); ctx.arc(bx + 2, by + 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fill();
    // 球体グラデーション
    const g4 = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 6);
    g4.addColorStop(0,    '#FFF');
    g4.addColorStop(0.55, '#DDD');
    g4.addColorStop(1,    '#999');
    ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fillStyle = g4; ctx.fill();
    // ハイライト
    ctx.beginPath(); ctx.arc(bx - 1.5, by - 1.5, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fill();
  }

  // ── 上部マーカー（当選番号を指す金色矢印） ───────────────
  ctx.save();
  ctx.translate(cx, cy - pO - 1);
  ctx.beginPath();
  ctx.moveTo(0, 11); ctx.lineTo(-7, -3); ctx.lineTo(7, -3);
  ctx.closePath();
  ctx.fillStyle = '#FFD700'; ctx.fill();
  ctx.strokeStyle = '#7A5200'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

// ── UI コールバック（ui.js で上書きされるスタブ） ────────────
let render    = () => {};
let showToast = () => {};

// ── ゲームアクション ──────────────────────────────────────────

/** 指定キーにチップ1枚分のベットを追加 */
function placeBet(key) {
  if (state.spinning) return;
  if (sumB(state.bets) + state.chip > state.balance) {
    showToast('残高不足です', 'err'); return;
  }
  state.bets[key] = (state.bets[key] || 0) + state.chip;
  render();
}

/** 全ベットをクリア */
function clearBets() {
  if (state.spinning) return;
  state.bets = {};
  render();
}

/** 全ベットを 2 倍にする */
function doubleBets() {
  if (state.spinning) return;
  if (!sumB(state.bets)) return;
  if (sumB(state.bets) * 2 > state.balance) { showToast('残高不足です', 'err'); return; }
  Object.keys(state.bets).forEach(k => { state.bets[k] *= 2; });
  render();
}

/** 直前のベット内容を再現（リベット機能） */
function rebet() {
  if (state.spinning || !state.lastBets) return;
  if (sumB(state.lastBets) > state.balance) { showToast('残高不足です', 'err'); return; }
  state.bets = { ...state.lastBets };
  render();
}

/** 残高・履歴をリセットして初期状態に戻す */
function resetBalance() {
  state.balance  = 10000;
  state.bets     = {};
  state.lastBets = null;
  state.result   = null;
  state.history  = [];
  anim.wi        = -1;
  drawWheel(anim.wa, 0, 0, -1);
  saveState();
  render();
}

/** スピン実行 ── アニメーション開始〜結果処理まで */
function spin() {
  if (state.spinning) return;
  const total = sumB(state.bets);
  if (!total) { showToast('ベットを置いてください', 'err'); return; }

  // ベット確定・残高減算
  const capturedBets  = { ...state.bets };
  state.balance      -= total;
  state.spinning      = true;
  state.result        = null;
  state.bets          = {};
  render();

  // 当選ポケットをランダムに決定
  const wi = Math.floor(Math.random() * N);
  const wn = WHEEL[wi];
  const R  = BUF / 2 - 5;
  const pO = R * 0.87, pI = R * 0.54;
  anim.ouR = R * 0.91;       // ボール外側軌道半径
  anim.inR = (pO + pI) / 2;  // ボール落下先半径

  // 当選ポケットが上部マーカー（角度 -π/2）に来るよう最終角度を算出
  const cur    = anim.wa;
  const tgtMod = (((-Math.PI / 2 - wi * SLICE) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const curMod = ((cur % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let delta    = tgtMod - curMod;
  if (delta <= 0) delta += 2 * Math.PI;
  const fwa    = cur + delta + 7 * 2 * Math.PI; // 7周以上して演出

  anim.fwa  = fwa;
  anim.fba  = fwa + wi * SLICE; // ボール最終角度（当選ポケット位置）
  anim.br   = anim.ouR;
  anim.ba   = -Math.PI / 2;    // ボール初期位置（上部）
  anim.p1ba = null;
  anim.wi   = wi;

  const t0 = performance.now();

  function loop(now) {
    const t  = Math.min((now - t0) / DUR, 1);
    const wE = 1 - Math.pow(1 - t, 3); // ease-out cubic
    anim.wa  = cur + (fwa - cur) * wE;

    if (t < 0.72) {
      // フェーズ1: ボールが外側軌道を逆方向に高速回転
      const bE  = 1 - Math.pow(1 - t / 0.72, 2.5);
      anim.ba   = -Math.PI / 2 - 10 * Math.PI * 2 * bE;
      anim.br   = anim.ouR;
      anim.p1ba = anim.ba; // フェーズ1終了角度を記録
    } else {
      // フェーズ2: 減速・落下して当選ポケットへ吸い込まれる
      const dt  = (t - 0.72) / 0.28;
      const dE  = 1 - Math.pow(1 - dt, 2);
      const p1V = (((anim.p1ba ?? -Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const fnV = ((anim.fba % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let arc   = fnV - p1V;
      if (arc < 0) arc += 2 * Math.PI;
      anim.ba   = p1V + arc * dE;
      anim.br   = anim.ouR + (anim.inR - anim.ouR) * dE;
    }

    // 毎フレーム描画（t=1 のとき当選ポケットをハイライト）
    drawWheel(anim.wa, anim.ba, anim.br, t >= 1 ? anim.wi : -1);

    if (t < 1) {
      anim.fid = requestAnimationFrame(loop);
    } else {
      // ── アニメーション完了 → 結果処理 ──────────────────
      const winAmt = calcWin(capturedBets, wn);
      state.balance  += winAmt;
      state.result    = { n: wn, c: getClr(wn), w: winAmt };
      state.lastBets  = capturedBets;
      state.spinning  = false;
      state.history   = [{ n: wn, c: getClr(wn), net: winAmt - total }, ...state.history.slice(0, 19)];

      const lbl = clrLabel(getClr(wn));
      const net = winAmt - total;
      if (winAmt > 0) showToast(`🎉 ${wn}（${lbl}）— +${fmtYen(net)} WIN!`, 'win');
      else            showToast(`${wn}（${lbl}）— ${fmtYen(total)} 負け`, 'lose');
      saveState();
      render();
    }
  }
  anim.fid = requestAnimationFrame(loop);
}
