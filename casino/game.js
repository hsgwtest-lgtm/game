'use strict';
// ============================================================
// game.js — ブラックジャックゲームロジック
//
// 依存: strategy.js (先に読み込む)
//   getOptimalMove(), highlightStrategyCell(), switchTab(), ACTION_LABELS
//
// ゲーム状態遷移:
//   BETTING → PLAYER_TURN → DEALER_TURN → RESULT → BETTING ...
// ============================================================

// ===== ゲーム状態定数 =====
const GS = Object.freeze({
  BETTING: 'BETTING',
  PLAYER:  'PLAYER',
  DEALER:  'DEALER',
  RESULT:  'RESULT',
});

// ===== ゲーム変数 =====
let gs       = GS.BETTING; // 現在の状態
let deck     = [];         // 残デッキ (6デッキ使用)
let pHands   = [[]];       // プレイヤーハンド配列 (スプリット対応)
let hIdx     = 0;          // 現在プレイ中のハンドインデックス
let dHand    = [];         // ディーラーハンド
let chips    = 1000;       // 所持チップ
let bet      = 0;          // 現在のベット額
let hBets    = [];         // ハンドごとのベット (スプリット後に複数)
let stats    = { n: 0, ok: 0 }; // 正解率カウンター
let fbTimer  = null;       // フィードバック消去タイマー

// ============================================================
// デッキ操作
// ============================================================

/** 6デッキをシャッフルして生成 */
function mkDeck() {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const d = [];
  for (let i = 0; i < 6; i++) {
    for (const s of suits) {
      for (const r of ranks) {
        const v = r === 'A' ? 11 : ['J','Q','K'].includes(r) ? 10 : +r;
        d.push({ s, r, v });
      }
    }
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

/** デッキからカードを1枚引く (残り52枚未満でシャッフル) */
function pop(hidden = false) {
  if (deck.length < 52) {
    deck = mkDeck();
    toast('シャッフルしました');
  }
  return { ...deck.pop(), hidden };
}

// ============================================================
// スコア計算
// ============================================================

/** ハンドのスコアを計算 (Aceを1/11と最適に扱う) */
function calcScore(hand) {
  let s = 0, aces = 0;
  for (const c of hand) {
    if (c.hidden) continue;
    if (c.r === 'A') { aces++; s += 11; } else s += c.v;
  }
  while (s > 21 && aces > 0) { s -= 10; aces--; }
  return s;
}

/** ソフトハンド (Ace=11 で成立) かを判定 */
function isSoft(hand) {
  let s = 0, aces = 0;
  for (const c of hand) {
    if (c.hidden) continue;
    if (c.r === 'A') { aces++; s += 11; } else s += c.v;
  }
  return aces > 0 && s <= 21;
}

/** ペアか (最初の2枚が同ランク) */
function isPair(hand) {
  return hand.length === 2 && hand[0].r === hand[1].r;
}

// ============================================================
// ベット操作
// ============================================================

/** チップを追加 */
function addBet(n) {
  if (gs !== GS.BETTING) return;
  if (chips <= 0) { toast('チップが足りません'); return; }
  bet = Math.min(bet + n, chips);
  rBet();
}

/** ベットをリセット */
function clearBet() {
  if (gs !== GS.BETTING) return;
  bet = 0;
  rBet();
}

// ============================================================
// ディール (ゲーム開始)
// ============================================================

function deal() {
  if (gs !== GS.BETTING) return;
  if (bet <= 0)    { toast('ベットを置いてください'); return; }
  if (chips < bet) { toast('チップが足りません');     return; }

  // ベット確定
  chips -= bet;
  hBets = [bet];

  // カード配布 (プレイヤー×2, ディーラー: 1枚表/1枚裏)
  pHands   = [[pop(), pop()]];
  dHand    = [pop(), pop(/* hidden = */true)];
  hIdx     = 0;
  gs       = GS.PLAYER;

  rAll();

  // ブラックジャック即判定
  const ps = calcScore(pHands[0]);
  if (ps === 21) {
    _reveal();
    const ds = calcScore(dHand);
    endGame(ds === 21 ? ['push'] : ['bj']);
    return;
  }

  _hlCell(); // 戦略表ハイライト
}

// ============================================================
// プレイヤーアクション
// ============================================================

/** Hit — カードを1枚追加 */
function playerHit() {
  if (gs !== GS.PLAYER) return;
  _chkFb('H'); // フィードバック評価

  pHands[hIdx].push(pop());

  const s = calcScore(pHands[hIdx]);
  rAll();

  if (s > 21)      { setTimeout(_next, 600); }  // バスト
  else if (s === 21){ setTimeout(_next, 300); }  // 21: オートスタンド
  else              { _hlCell(); }                // 継続
}

/** Stand — ステイ (このハンドを終了) */
function playerStand() {
  if (gs !== GS.PLAYER) return;
  _chkFb('S');
  rAll();
  _next();
}

/** Double Down — ベット2倍, カード1枚, 強制スタンド */
function playerDouble() {
  if (gs !== GS.PLAYER) return;
  const curHand = pHands[hIdx];
  // 手牌が正確に2枚のときのみダブル可能（firstActフラグ不要）
  if (!curHand || curHand.length !== 2) return;
  if (chips < hBets[hIdx]) { toast('チップが足りません'); return; }

  _chkFb('D');
  chips -= hBets[hIdx];
  hBets[hIdx] *= 2;
  pHands[hIdx].push(pop());

  rAll();
  setTimeout(_next, 600);
}

/** Split — ペアを2つのハンドに分割 */
function playerSplit() {
  if (gs !== GS.PLAYER) return;
  const sHand = pHands[hIdx];
  // 手牌が正確に2枚 & ペアのときのみスプリット可能
  if (!sHand || sHand.length !== 2 || !isPair(sHand)) return;
  if (chips < hBets[hIdx]) { toast('チップが足りません'); return; }

  _chkFb('P');
  chips -= hBets[hIdx];

  const [c1, c2] = sHand;
  const b = hBets[hIdx];
  // 元のハンドを2つに分割し, それぞれ新しいカードを1枚追加
  pHands.splice(hIdx, 1, [c1, pop()], [c2, pop()]);
  hBets.splice(hIdx, 1, b, b);

  // エーススプリット: gsを即座にDEALERへ変えてプレイヤー操作を完全ロック
  if (c1.r === 'A') {
    gs = GS.DEALER;
    _reveal();
    rAll();              // ボタンが非表示の状態でレンダリング
    setTimeout(_dStep, 900);
    return;
  }

  rAll();    // 通常スプリット: 新しいハンドを表示 (hand.length===2 → Double/Split有効)
  _hlCell(); // 戦略表を更新
}

/** 次のハンドへ進む, なければディーラーターンへ */
function _next() {
  hIdx++;
  if (hIdx < pHands.length) {
    rAll();
    _hlCell();
  } else {
    dealerTurn();
  }
}

// ============================================================
// ディーラーターン
// ============================================================

function dealerTurn() {
  gs = GS.DEALER;
  _reveal();  // ホールカード開示
  rAll();
  _dStep();
}

/**
 * ディーラーの1ステップ処理
 * H17ルール: ソフト17 (A+6=17) でもヒット
 */
function _dStep() {
  const s  = calcScore(dHand);
  const sf = isSoft(dHand);
  if (s < 17 || (s === 17 && sf)) {
    setTimeout(() => { dHand.push(pop()); rAll(); _dStep(); }, 580);
  } else {
    setTimeout(_resolveGame, 420);
  }
}

/** ディーラーホールカードを開示 */
function _reveal() {
  dHand.forEach(c => { c.hidden = false; });
}

// ============================================================
// 結果判定
// ============================================================

function _resolveGame() {
  const ds    = calcScore(dHand);
  const dBust = ds > 21;

  const results = pHands.map(hand => {
    const ps = calcScore(hand);
    if (ps > 21)  return 'lose'; // プレイヤーバスト
    if (dBust)    return 'win';  // ディーラーバスト
    if (ps > ds)  return 'win';
    if (ps < ds)  return 'lose';
    return 'push';
  });

  endGame(results);
}

/**
 * ゲーム終了: チップ精算 & リザルト表示
 * @param {Array<'bj'|'win'|'push'|'lose'>} results ハンドごとの結果
 */
function endGame(results) {
  gs = GS.RESULT;
  let ret = 0;

  // ディーラーの最終スコアを取得
  const ds = calcScore(dHand);

  const msgs = results.map((r, i) => {
    const b  = hBets[i] !== undefined ? hBets[i] : hBets[0];
    const ps = calcScore(pHands[i] || pHands[0]);
    // 手札スコア情報（全結果に共通表示）
    const scoreInfo = `<span class="res-score">あなた: ${ps}　ディーラー: ${ds}</span>`;
    switch (r) {
      case 'bj':   ret += Math.floor(b * 2.5); return `🎉 Blackjack!<br>${scoreInfo}`;
      case 'win':  ret += b * 2;               return `✅ 勝ち<br>${scoreInfo}`;
      case 'push': ret += b;                   return `🤝 引き分け<br>${scoreInfo}`;
      default:                                 return `❌ 負け<br>${scoreInfo}`;
    }
  });

  chips += ret;
  rAll();
  _showOverlay(msgs.join('<br>'));
}

// ============================================================
// フィードバック (戦略正誤判定)
// ============================================================

/**
 * プレイヤーの選択とベーシックストラテジーを比較してフィードバックを表示
 * @param {'H'|'S'|'D'|'P'} act プレイヤーが選択したアクション
 */
function _chkFb(act) {
  const hand = pHands[hIdx];
  if (!hand || !hand.length) return;

  const ps     = calcScore(hand);
  const sf     = isSoft(hand);
  const pr     = isPair(hand) && hand.length === 2;
  const pRank  = pr ? hand[0].r : undefined;
  const upCard = dHand.find(c => !c.hidden);
  if (!upCard) return;

  const opt = getOptimalMove(ps, sf, pr, upCard.r, pRank);
  stats.n++;

  if (act === opt) {
    stats.ok++;
    _fb('✅ 正解！', 'ok');
  } else {
    _fb(`❌ 不正解です。推奨手は ${ACTION_LABELS[opt]} です`, 'ng');
  }

  rStats();
}

/** フィードバックメッセージを表示 (3.2秒後フェードアウト) */
function _fb(msg, cls) {
  const el = document.getElementById('fb');
  el.textContent = msg;
  el.className = `fb ${cls} vis`;
  clearTimeout(fbTimer);
  fbTimer = setTimeout(() => el.classList.remove('vis'), 3200);
}

/** 軽量なトースト通知 */
function toast(msg) { _fb(msg, 'info'); }

// ============================================================
// レンダリング
// ============================================================

/** 全UI要素を再描画 */
function rAll() {
  rDealer();
  rPlayer();
  rStatus();
  rCtrl();
  rChips();
  rBet();
}

/** ディーラーエリアを描画 */
function rDealer() {
  const cardsEl = document.getElementById('d-cards');
  const scoreEl = document.getElementById('d-score');
  cardsEl.innerHTML = '';
  dHand.forEach(c => cardsEl.appendChild(_mkCard(c)));

  const vis = dHand.filter(c => !c.hidden);
  scoreEl.textContent = vis.length ? `[${calcScore(vis)}]` : '';
}

/** プレイヤーエリアを描画 (スプリット対応) */
function rPlayer() {
  const wrap = document.getElementById('p-hands');
  wrap.innerHTML = '';

  pHands.forEach((hand, i) => {
    if (!hand.length) return; // 空ハンドはスキップ
    const isActive = i === hIdx && gs === GS.PLAYER;

    const div = document.createElement('div');
    div.className = 'hand' + (isActive ? ' cur' : '');

    // ハンドのベット表示
    if (hBets[i]) {
      const bl = document.createElement('div');
      bl.className = 'hbet';
      bl.textContent = `💰 ${hBets[i]}`;
      div.appendChild(bl);
    }

    // カード行
    const row = document.createElement('div');
    row.className = 'cards';
    hand.forEach(c => row.appendChild(_mkCard(c)));
    div.appendChild(row);

    // スコア表示
    const sc   = document.createElement('div');
    const s    = calcScore(hand);
    const soft = isSoft(hand);
    sc.className = 'hscore' + (s > 21 ? ' bust' : '');
    if (s > 0) {
      sc.textContent = s > 21
        ? `${s} BUST`
        : `${s}${soft && s <= 21 ? ' (Soft)' : ''}`;
    }
    div.appendChild(sc);

    wrap.appendChild(div);
  });
}

/**
 * カードDOM要素を生成
 * @param {{s:string, r:string, v:number, hidden:boolean}} card
 */
function _mkCard(card) {
  const el = document.createElement('div');

  if (card.hidden) {
    el.className = 'card back';
    el.innerHTML = '<span>★</span>';
    return el;
  }

  const isRed = ['♥','♦'].includes(card.s);
  el.className = `card ${isRed ? 'red' : 'blk'}`;
  el.innerHTML =
    `<b class="cr ct">${card.r}</b>` +
    `<b class="cs">${card.s}</b>`    +
    `<b class="cr cb">${card.r}</b>`;
  return el;
}

/** ステータスバー (状況テキスト) を更新 */
function rStatus() {
  const el = document.getElementById('sit');
  if (!el) return;

  if (gs === GS.BETTING) {
    el.textContent = 'ベットを置いてディールしてください';
    return;
  }

  const upCard = dHand.find(c => !c.hidden);
  if (!upCard) return;

  // 現在のハンド (RESULT時は最後のハンドを表示)
  const i    = Math.min(hIdx, pHands.length - 1);
  const hand = pHands[i];
  if (!hand || !hand.length) return;

  const ps   = calcScore(hand);
  const sf   = isSoft(hand);
  const pr   = isPair(hand) && hand.length === 2 && gs === GS.PLAYER;
  const type = pr ? 'Pair' : sf ? 'Soft' : 'Hard';

  el.textContent = `プレイヤー: ${ps} (${type})  vs  ディーラー: ${upCard.r}`;
}

/** コントロールボタン表示を切り替え */
function rCtrl() {
  const bEl = document.getElementById('bet-ctrl');
  const aEl = document.getElementById('act-ctrl');
  if (!bEl || !aEl) return;

  if (gs === GS.BETTING) {
    bEl.style.display = 'flex';
    aEl.style.display = 'none';
    return;
  }

  if (gs === GS.PLAYER) {
    bEl.style.display = 'none';
    aEl.style.display = 'flex';
    const hand  = pHands[hIdx];
    const cBet  = hBets[hIdx] || 0;
    // 手牌が正確に2枚 = 最初のアクション。firstActフラグ不要でバグ根絶
    const isFirst = hand?.length === 2;
    document.getElementById('bDbl').disabled = !(isFirst && chips >= cBet);
    document.getElementById('bSpl').disabled = !(isFirst && hand && isPair(hand) && chips >= cBet);
    return;
  }

  // DEALER / RESULT: ボタン非表示
  bEl.style.display = 'none';
  aEl.style.display = 'none';
}

/** チップ残高を更新 */
function rChips() {
  const el = document.getElementById('chips');
  if (el) el.textContent = `💰 ${chips.toLocaleString()}`;
}

/** ベット表示を更新 */
function rBet() {
  const el = document.getElementById('bet-disp');
  if (el) el.textContent = `BET: ${bet}`;
}

/** 正解率を更新 */
function rStats() {
  const el = document.getElementById('stat');
  if (!el) return;
  if (stats.n === 0) { el.textContent = '正解率: —'; return; }
  const pct = Math.round(stats.ok / stats.n * 100);
  el.textContent = `正解率: ${stats.ok}/${stats.n} (${pct}%)`;
}

/** 現在のハンドに対応する戦略セルをハイライト */
function _hlCell() {
  if (gs !== GS.PLAYER) return;
  const hand = pHands[hIdx];
  if (!hand?.length) return;

  const ps     = calcScore(hand);
  const sf     = isSoft(hand);
  const pr     = isPair(hand) && hand.length === 2;
  const upCard = dHand.find(c => !c.hidden);
  if (!upCard) return;

  highlightStrategyCell(ps, sf, pr, upCard.r, pr ? hand[0].r : undefined);
}

/** リザルトオーバーレイを表示 */
function _showOverlay(html) {
  document.getElementById('res-txt').innerHTML   = html;
  document.getElementById('res-chips').textContent = `残チップ: ${chips.toLocaleString()}`;
  document.getElementById('overlay').style.display = 'flex';
  if (chips <= 0) {
    document.getElementById('res-txt').innerHTML += '<br><small style="font-size:0.6em;color:#aaa">チップ補充！</small>';
  }
}

// ============================================================
// ゲーム制御
// ============================================================

/** 次のラウンドへ (オーバーレイを閉じてBETTINGへ) */
function newRound() {
  document.getElementById('overlay').style.display = 'none';

  // チップ切れリセット
  if (chips <= 0) { chips = 1000; toast('チップをリセットしました'); }

  gs       = GS.BETTING;
  pHands   = [[]];
  hIdx     = 0;
  dHand    = [];
  bet      = 0;
  hBets    = [];

  // カード表示をクリア
  document.getElementById('d-cards').innerHTML = '';
  document.getElementById('p-hands').innerHTML = '';
  document.getElementById('d-score').textContent = '';

  // 戦略表ハイライトをリセット
  document.querySelectorAll('.s-cell.active-cell').forEach(c => c.classList.remove('active-cell'));

  rAll();
  rStats();
}

/** 初期化 */
function init() {
  deck = mkDeck();
  rAll();
  rStats();
}

document.addEventListener('DOMContentLoaded', init);
