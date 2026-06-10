'use strict';
// ============================================================
// game.js — Texas Hold'em Practice
//
// 状態遷移: IDLE → PREFLOP → FLOP → TURN → RIVER → SHOWDOWN → IDLE
// 依存: strategy.js (先読み)
//   getHandKey / getOptimalPokerAction / highlightHandInMatrix
//   switchTab / ACTION_LABELS_POKER
// ============================================================

const GS = Object.freeze({
  IDLE:     'IDLE',
  PREFLOP:  'PREFLOP',
  FLOP:     'FLOP',
  TURN:     'TURN',
  RIVER:    'RIVER',
  SHOWDOWN: 'SHOWDOWN',
});

// ===== ゲーム変数 =====
let gs            = GS.IDLE;
let deck          = [];
let playerHand    = [];   // プレイヤーのホールカード (2枚)
let dealerHand    = [];   // ディーラーのホールカード (裏向き→ショーダウンで公開)
let community     = [];   // コミュニティカード (最大5枚)
let pot           = 0;
let playerStack   = 1000;
let playerBet     = 0;    // このストリートでプレイヤーが投じた額
let currentBet    = 0;    // プレイヤーへのベット要求額
let position      = 'BTN';
let handKey       = '';
let preflopDone   = false; // フィードバックを一度だけ出すフラグ

// ===== 統計 =====
let stats = { n: 0, ok: 0 };
let fbTimer = null;

// ===== 定数 =====
const SB = 10;
const BB = 20;
const OPEN_RAISE = 60; // 3x BB

const POSITIONS     = ['BTN', 'CO', 'MP', 'EP'];
const POS_FULL      = { BTN: 'Button', CO: 'Cutoff', MP: 'Middle Position', EP: 'Early Position (UTG)' };
const HAND_NAMES    = ['High Card','Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];

// ============================================================
// デッキ操作
// ============================================================

function mkDeck() {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const d = [];
  for (const s of suits)
    for (const r of ranks) {
      const numVal = r==='A'?14 : r==='K'?13 : r==='Q'?12 : r==='J'?11 : +r;
      d.push({ s, r, numVal });
    }
  return _shuffle(d);
}

function _shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function pop(hidden = false) {
  if (deck.length < 10) deck = mkDeck();
  return { ...deck.pop(), hidden };
}

// ============================================================
// ゲームフロー
// ============================================================

/** ハンド開始 */
function startHand() {
  if (gs !== GS.IDLE) return;

  // ランダムポジション
  position = POSITIONS[Math.floor(Math.random() * POSITIONS.length)];

  // カード配布
  playerHand  = [pop(), pop()];
  dealerHand  = [pop(true), pop(true)];
  community   = [];
  preflopDone = false;

  // ブラインド
  playerStack -= SB;
  pot          = SB + BB;
  playerBet    = SB;
  currentBet   = BB;

  handKey = getHandKey(playerHand[0], playerHand[1]);

  gs = GS.PREFLOP;
  renderAll();

  // チャートをポジション別にハイライト
  switchTab(position.toLowerCase());
  highlightHandInMatrix(handKey, position);
}

// ─── プリフロップ アクション ───────────────────────────────

function pFold() {
  if (gs !== GS.PREFLOP) return;
  _givePreflopFb('fold');
  const won = pot;
  _endHand();
  showResult(`❌ フォールド<br><span class="res-score">ディーラーが <b>${won}</b> チップ獲得</span>`);
}

function pCall() {
  if (gs !== GS.PREFLOP) return;
  _givePreflopFb('call');
  const toCall = currentBet - playerBet;
  playerStack -= toCall;
  pot         += toCall;
  playerBet    = currentBet;
  gs           = GS.FLOP;
  _dealCommunity(3);
}

function pRaise() {
  if (gs !== GS.PREFLOP) return;
  _givePreflopFb('raise');
  const cost = OPEN_RAISE - playerBet;
  playerStack -= cost;
  pot         += cost;
  playerBet    = OPEN_RAISE;

  // ディーラーの反応: 70% コール, 30% フォールド
  if (Math.random() < 0.30) {
    // ディーラーフォールド: プレイヤーが鍋をもらう
    playerStack += pot;
    _endHand();
    showResult(`✅ ディーラーがフォールド！<br><span class="res-score">+<b>${pot}</b> チップ獲得</span>`);
  } else {
    pot += OPEN_RAISE - BB; // ディーラーのコール分
    gs = GS.FLOP;
    _dealCommunity(3);
  }
}

// ─── ポストフロップ アクション ────────────────────────────

/** チェック (AIがチェックした場合) */
function pCheck() {
  if (gs === GS.IDLE || gs === GS.PREFLOP || gs === GS.SHOWDOWN) return;
  _advanceStreet();
}

/** AIのベットをコール */
function pCallBet() {
  if (gs === GS.IDLE || gs === GS.PREFLOP || gs === GS.SHOWDOWN) return;
  playerStack -= currentBet;
  pot         += currentBet;
  currentBet   = 0;
  _advanceStreet();
}

/** AIのベットにフォールド */
function pFold2() {
  if (gs === GS.IDLE || gs === GS.PREFLOP || gs === GS.SHOWDOWN) return;
  const won = pot;
  _endHand();
  showResult(`❌ フォールド<br><span class="res-score">ディーラーが <b>${won}</b> チップ獲得</span>`);
}

// ─── 内部ヘルパー ─────────────────────────────────────────

function _dealCommunity(count) {
  for (let i = 0; i < count; i++) community.push(pop());
  renderAll();
  // AIが先にアクション (少し遅延してUXを改善)
  setTimeout(_dealerActs, 750);
}

/** ディーラーAI のポストフロップアクション */
function _dealerActs() {
  if (Math.random() < 0.48) {
    // チェック
    currentBet = 0;
    renderAll();
    _renderPostflopCtrl('check');
  } else {
    // ベット (ハーフポット)
    const betAmt = Math.max(BB, Math.floor(pot * 0.5));
    pot       += betAmt; // ディーラーのベットをポットへ
    currentBet = betAmt;
    renderAll();
    _renderPostflopCtrl('bet');
  }
}

/** ストリート進行 */
function _advanceStreet() {
  if      (gs === GS.FLOP)  { gs = GS.TURN;  _dealCommunity(1); }
  else if (gs === GS.TURN)  { gs = GS.RIVER; _dealCommunity(1); }
  else if (gs === GS.RIVER) { gs = GS.SHOWDOWN; _revealShowdown(); }
}

/** ショーダウン */
function _revealShowdown() {
  dealerHand.forEach(c => { c.hidden = false; });

  const pBest = bestHand([...playerHand, ...community]);
  const dBest = bestHand([...dealerHand, ...community]);

  let msg;
  if (pBest.score > dBest.score) {
    playerStack += pot;
    msg = `🏆 勝ち！<br><span class="res-score">あなた: <b>${pBest.name}</b> / ディーラー: ${dBest.name}</span>`;
  } else if (pBest.score < dBest.score) {
    msg = `❌ 負け<br><span class="res-score">あなた: ${pBest.name} / ディーラー: <b>${dBest.name}</b></span>`;
  } else {
    playerStack += Math.floor(pot / 2);
    msg = `🤝 チョップ (引き分け)<br><span class="res-score">両者: ${pBest.name}</span>`;
  }

  renderAll();
  showResult(msg);
  _endHand();
}

/** ハンド終了後の状態クリア */
function _endHand() {
  gs = GS.IDLE;
}

/** 次のハンドへ */
function nextHand() {
  document.getElementById('overlay').style.display = 'none';
  if (playerStack <= 0) { playerStack = 1000; fb('チップをリセットしました', 'info'); }
  playerHand = []; dealerHand = []; community = [];
  pot = 0; playerBet = 0; currentBet = 0;
  handKey = '';
  document.querySelectorAll('.s-cell.active-cell').forEach(c => c.classList.remove('active-cell'));
  renderAll();
}

// ============================================================
// プリフロップ フィードバック
// ============================================================

function _givePreflopFb(action) {
  if (preflopDone) return;
  preflopDone = true;

  const opt = getOptimalPokerAction(handKey, position);
  stats.n++;
  if (action === opt) {
    stats.ok++;
    fb('✅ 正解！', 'ok');
  } else {
    fb(`❌ 不正解。推奨: ${ACTION_LABELS_POKER[opt]}`, 'ng');
  }
  _renderStats();
}

// ============================================================
// ハンド評価 (5〜7枚から最強の5枚を判定)
// ============================================================

function bestHand(cards) {
  let best = null;
  for (const combo of _choose5(cards)) {
    const h = _eval5(combo);
    if (!best || h.score > best.score) best = h;
  }
  return best || { score: 0, name: 'High Card' };
}

/** 配列から5枚の組み合わせを全列挙 */
function _choose5(arr) {
  const out = [];
  const n = arr.length;
  for (let a=0; a<n-4; a++)
  for (let b=a+1; b<n-3; b++)
  for (let c=b+1; c<n-2; c++)
  for (let d=c+1; d<n-1; d++)
  for (let e=d+1; e<n;   e++)
    out.push([arr[a], arr[b], arr[c], arr[d], arr[e]]);
  return out;
}

/** 5枚のハンドを評価してスコアを返す */
function _eval5(hand) {
  const sorted = [...hand].sort((a, b) => b.numVal - a.numVal);
  const vals   = sorted.map(c => c.numVal);
  const suits  = sorted.map(c => c.s);
  const isFlush = suits.every(s => s === suits[0]);

  // ランク頻度 → [{ v, c }] を count降順・value降順でソート
  const freq = {};
  for (const v of vals) freq[v] = (freq[v] || 0) + 1;
  const groups = Object.entries(freq)
    .map(([v, c]) => ({ v: +v, c }))
    .sort((a, b) => b.c - a.c || b.v - a.v);
  const cnt = groups.map(g => g.c);
  const gv  = groups.map(g => g.v);

  // ストレート判定 (A-2-3-4-5 = ホイール = 5ハイ)
  const uniq = [...new Set(vals)].sort((a, b) => b - a);
  let isStraight = false, strHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) { isStraight = true; strHigh = uniq[0]; }
    if (uniq.join() === '14,5,4,3,2') { isStraight = true; strHigh = 5; }
  }

  let rank, tv;
  if (isFlush && isStraight && strHigh === 14) { rank = 9; tv = [14]; }          // Royal Flush
  else if (isFlush && isStraight)               { rank = 8; tv = [strHigh]; }    // Straight Flush
  else if (cnt[0] === 4)                        { rank = 7; tv = gv; }           // Four of a Kind
  else if (cnt[0] === 3 && cnt[1] === 2)        { rank = 6; tv = gv; }           // Full House
  else if (isFlush)                             { rank = 5; tv = vals; }          // Flush
  else if (isStraight)                          { rank = 4; tv = [strHigh]; }    // Straight
  else if (cnt[0] === 3)                        { rank = 3; tv = gv; }           // Three of a Kind
  else if (cnt[0] === 2 && cnt[1] === 2)        { rank = 2; tv = gv; }           // Two Pair
  else if (cnt[0] === 2)                        { rank = 1; tv = gv; }           // Pair
  else                                          { rank = 0; tv = vals; }         // High Card

  // スコア: rank * 10^10 + v1*100^4 + v2*100^3 + ...
  let score = rank * 1e10;
  tv.slice(0, 5).forEach((v, i) => { score += v * Math.pow(100, 4 - i); });

  return { rank, name: HAND_NAMES[rank], score };
}

// ============================================================
// レンダリング
// ============================================================

function renderAll() {
  _renderTopbar();
  _renderCards();
  _renderCtrl();
  _renderChips();
  _renderStats();
}

function _renderTopbar() {
  const sitEl = document.getElementById('sit');
  const potEl = document.getElementById('pot-disp');

  if (gs === GS.IDLE) {
    if (sitEl) sitEl.textContent = 'DEAL を押してください';
    if (potEl) potEl.textContent = '';
    return;
  }

  const streetNames = { [GS.PREFLOP]: 'Preflop', [GS.FLOP]: 'Flop', [GS.TURN]: 'Turn', [GS.RIVER]: 'River', [GS.SHOWDOWN]: 'Showdown' };
  if (sitEl) sitEl.textContent = `${position} — ${POS_FULL[position]}　|　${streetNames[gs] || ''}`;
  if (potEl) potEl.textContent = `POT: ${pot}`;
}

function _renderCards() {
  // コミュニティカード (5スロット)
  const commEl = document.getElementById('community-cards');
  if (commEl) {
    commEl.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      commEl.appendChild(community[i] ? mkCard(community[i]) : _emptySlot());
    }
  }

  // ディーラーのホールカード
  const dlEl = document.getElementById('dealer-cards');
  if (dlEl) {
    dlEl.innerHTML = '';
    if (dealerHand.length) dealerHand.forEach(c => dlEl.appendChild(mkCard(c)));
    else { dlEl.appendChild(_emptySlot()); dlEl.appendChild(_emptySlot()); }
  }

  // プレイヤーのホールカード
  const plEl = document.getElementById('player-cards');
  if (plEl) {
    plEl.innerHTML = '';
    if (playerHand.length) playerHand.forEach(c => plEl.appendChild(mkCard(c)));
    else { plEl.appendChild(_emptySlot()); plEl.appendChild(_emptySlot()); }
  }

  // プレイヤーのハンド名 (フロップ以降)
  const pnEl = document.getElementById('player-hand-name');
  if (pnEl) {
    if (community.length >= 3 && playerHand.length === 2) {
      const best = bestHand([...playerHand, ...community]);
      pnEl.textContent = best ? `[${best.name}]` : '';
    } else {
      pnEl.textContent = handKey ? `[${handKey}]` : '';
    }
  }

  // ディーラーのハンド名 (ホールカード公開後)
  const dnEl = document.getElementById('dealer-hand-name');
  if (dnEl) {
    if (dealerHand.length && !dealerHand[0].hidden && community.length >= 3) {
      const best = bestHand([...dealerHand, ...community]);
      dnEl.textContent = best ? `[${best.name}]` : '';
    } else {
      dnEl.textContent = '';
    }
  }
}

/** カードDOM生成 */
function mkCard(card) {
  const el = document.createElement('div');
  if (card.hidden) {
    el.className = 'card back';
    el.innerHTML = '<span>★</span>';
    return el;
  }
  const red = ['♥','♦'].includes(card.s);
  el.className = `card ${red ? 'red' : 'blk'}`;
  el.innerHTML = `<b class="cr ct">${card.r}</b><b class="cs">${card.s}</b><b class="cr cb">${card.r}</b>`;
  return el;
}

function _emptySlot() {
  const el = document.createElement('div');
  el.className = 'card-slot';
  return el;
}

function _renderCtrl() {
  ['idle-ctrl','preflop-ctrl','postflop-ctrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  if      (gs === GS.IDLE)    { _show('idle-ctrl'); }
  else if (gs === GS.PREFLOP) {
    _show('preflop-ctrl');
    const callBtn = document.getElementById('call-btn');
    if (callBtn) callBtn.textContent = `Call ${currentBet - playerBet}`;
  }
  // postflop-ctrl は _renderPostflopCtrl() で制御
}

function _renderPostflopCtrl(mode) {
  const el = document.getElementById('postflop-ctrl');
  if (!el) return;
  el.style.display = 'flex';
  el.innerHTML = '';

  if (mode === 'check') {
    el.appendChild(_btn('Check', 'ab check-btn', pCheck));
  } else {
    el.appendChild(_btn('Fold', 'ab fold-btn', pFold2));
    el.appendChild(_btn(`Call ${currentBet}`, 'ab call-btn', pCallBet));
  }
}

function _btn(text, cls, fn) {
  const b = document.createElement('button');
  b.className = cls; b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

function _show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}

function _renderChips() {
  const el = document.getElementById('chips');
  if (el) el.textContent = `💰 ${playerStack.toLocaleString()}`;
}

function _renderStats() {
  const text = stats.n === 0
    ? '—'
    : `${stats.ok}/${stats.n} (${Math.round(stats.ok / stats.n * 100)}%)`;

  const elTop = document.getElementById('sc-total-top');
  const elBar = document.getElementById('sc-total');
  if (elTop) elTop.textContent = text;
  if (elBar) elBar.textContent = text;
}

// ============================================================
// フィードバック / リザルト
// ============================================================

function fb(msg, cls) {
  const el = document.getElementById('fb');
  if (!el) return;
  el.textContent = msg;
  el.className = `fb ${cls} vis`;
  clearTimeout(fbTimer);
  fbTimer = setTimeout(() => el.classList.remove('vis'), 3500);
}

function showResult(html) {
  const overlay = document.getElementById('overlay');
  document.getElementById('res-txt').innerHTML   = html;
  document.getElementById('res-chips').textContent = `残チップ: ${playerStack.toLocaleString()}`;
  overlay.style.display = 'flex';
}

// ============================================================
// 初期化
// ============================================================

function init() {
  deck = mkDeck();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
