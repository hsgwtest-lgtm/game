'use strict';
// ============================================================
// strategy.js — Texas Hold'em Starting Hand Strategy Engine
//
// 公開 API (game.js から参照):
//   getHandKey(c1, c2)                   → 'AKs' / 'AKo' / 'AA' etc.
//   getOptimalPokerAction(handKey, pos)   → 'raise' | 'fold'
//   highlightHandInMatrix(handKey, pos)   → チャート上の該当セルをハイライト
//   switchTab(tabName)                    → ポジションタブ切替
//   ACTION_LABELS_POKER                   → アクション日本語ラベル
// ============================================================

// ランク順 (高 → 低). ポーカー表記で 10 は 'T'
const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];

// 表示用 (セルヘッダー)
const RANK_DISPLAY = {A:'A',K:'K',Q:'Q',J:'J',T:'10',9:'9',8:'8',7:'7',6:'6',5:'5',4:'4',3:'3',2:'2'};

const ACTION_LABELS_POKER = { raise:'Open Raise', fold:'Fold' };

// ============================================================
// スタートハンドレンジ定義
// ============================================================

const RANGE = {

  // ===== BTN (Button) — 最広レンジ =====
  BTN: new Set([
    // ペア
    'AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22',
    // スーテッドエース
    'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
    // スーテッドキング
    'KQs','KJs','KTs','K9s','K8s','K7s',
    // スーテッドクイーン〜
    'QJs','QTs','Q9s','Q8s',
    'JTs','J9s','J8s',
    'T9s','T8s',
    '98s','87s','76s','65s','54s',
    // オフスート
    'AKo','AQo','AJo','ATo','A9o','A8o',
    'KQo','KJo','KTo','K9o',
    'QJo','QTo','Q9o',
    'JTo','J9o','T9o',
  ]),

  // ===== CO (Cutoff) =====
  CO: new Set([
    'AA','KK','QQ','JJ','TT','99','88','77','66','55','44','33','22',
    'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A6s','A5s','A4s','A3s','A2s',
    'KQs','KJs','KTs','K9s','K8s',
    'QJs','QTs','Q9s','Q8s',
    'JTs','J9s','J8s',
    'T9s','T8s','98s','87s','76s',
    'AKo','AQo','AJo','ATo','A9o','A8o',
    'KQo','KJo','KTo','K9o',
    'QJo','QTo','Q9o','JTo',
  ]),

  // ===== MP (Middle Position) =====
  MP: new Set([
    'AA','KK','QQ','JJ','TT','99','88','77','66','55',
    'AKs','AQs','AJs','ATs','A9s','A8s','A7s','A5s','A4s','A3s','A2s',
    'KQs','KJs','KTs','K9s',
    'QJs','QTs','Q9s',
    'JTs','J9s','T9s','98s','87s',
    'AKo','AQo','AJo','ATo','A9o','A8o',
    'KQo','KJo','KTo','K9o',
    'QJo','QTo','JTo',
  ]),

  // ===== EP (Early Position / UTG) — 最狭レンジ =====
  EP: new Set([
    'AA','KK','QQ','JJ','TT','99','88','77',
    'AKs','AQs','AJs','ATs',
    'KQs','KJs','KTs','QJs','JTs',
    'AKo','AQo','AJo','ATo',
    'KQo','KJo','QJo',
  ]),
};

// ============================================================
// ハンドキー取得
// ============================================================

/**
 * 2枚のホールカードから標準ポーカー表記のキーを返す
 * @param {Object} c1 カード1 { r, s, numVal }
 * @param {Object} c2 カード2 { r, s, numVal }
 * @returns {string}  e.g. 'AKs', 'AKo', 'AA', 'TTs'
 */
function getHandKey(c1, c2) {
  const norm = r => r === '10' ? 'T' : r; // 表記を T に統一
  const r1 = norm(c1.r), r2 = norm(c2.r);
  const i1 = RANKS.indexOf(r1), i2 = RANKS.indexOf(r2);

  if (i1 === i2) return `${r1}${r1}`; // ペア

  // 高いランクを先に表記
  const [hi, lo] = i1 < i2 ? [r1, r2] : [r2, r1];
  const suited = c1.s === c2.s;
  return `${hi}${lo}${suited ? 's' : 'o'}`;
}

/**
 * 指定ポジションでの最適プリフロップアクション
 * @param {string} handKey  e.g. 'AKs'
 * @param {string} position e.g. 'BTN'
 * @returns {'raise'|'fold'}
 */
function getOptimalPokerAction(handKey, position) {
  return RANGE[position]?.has(handKey) ? 'raise' : 'fold';
}

// ============================================================
// スタートハンドマトリクス構築
// ============================================================

/**
 * BTN / CO / MP / EP の 13×13 マトリクスを DOM に挿入
 */
function buildHandMatrices() {
  ['BTN','CO','MP','EP'].forEach(pos => {
    const el = document.getElementById(`matrix-${pos.toLowerCase()}`);
    if (el) el.innerHTML = _matrixHTML(pos);
  });
}

function _matrixHTML(pos) {
  const range = RANGE[pos];
  let html = '<div class="tbl-wrap"><table class="s-tbl"><thead><tr>';
  html += '<th class="th-corner"></th>';
  RANKS.forEach(r => {
    html += `<th class="dealer-header">${RANK_DISPLAY[r]}</th>`;
  });
  html += '</tr></thead><tbody>';

  RANKS.forEach((rowR, i) => {
    html += `<tr><th class="th-row">${RANK_DISPLAY[rowR]}</th>`;
    RANKS.forEach((colR, j) => {
      let key;
      if      (i === j) key = `${rowR}${rowR}`;    // ペア (対角)
      else if (i < j)   key = `${rowR}${colR}s`;   // スーテッド (右上)
      else              key = `${colR}${rowR}o`;   // オフスート (左下)

      const inRange = range.has(key);
      const bg = inRange ? '#1a5c34' : '#3d0f18';
      const cellId = `cell-${pos.toLowerCase()}-${key}`;
      // 対角セルのみランクラベルを表示
      const label = i === j ? RANK_DISPLAY[rowR] : '';

      html += `<td id="${cellId}" class="s-cell${inRange ? ' in-range' : ''}" style="background:${bg}" data-hand="${key}" title="${key}">${label}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

// ============================================================
// ハイライト
// ============================================================

/**
 * 現在のハンドをマトリクス上でハイライト
 * @param {string} handKey  e.g. 'AKs'
 * @param {string} position e.g. 'BTN'
 */
function highlightHandInMatrix(handKey, position) {
  document.querySelectorAll('.s-cell.active-cell').forEach(c => c.classList.remove('active-cell'));

  const cellId = `cell-${position.toLowerCase()}-${handKey}`;
  const cell   = document.getElementById(cellId);
  if (cell) {
    cell.classList.add('active-cell');
    cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

// ============================================================
// ポジションタブ切替
// ============================================================

function switchTab(name) {
  const lower = name.toLowerCase();
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === lower);
  });
  document.querySelectorAll('.chart-pane').forEach(p => {
    p.classList.toggle('on', p.id === `matrix-${lower}`);
  });
}

// ============================================================
// ポストフロップ ハンド分析エンジン
// ============================================================

// 強さティアの定義 (色 / 日本語ラベル / 簡単な指針)
const TIER_INFO = {
  monster: { label: 'モンスター', color: '#9b59b6', jp: '最強クラス。バリューを最大化しよう' },
  strong:  { label: '強い',       color: '#1e6b3c', jp: 'ベット/レイズで主導権を握ろう' },
  medium:  { label: '普通',       color: '#1a5276', jp: '小さく賭けるかチェックで様子見' },
  draw:    { label: 'ドロー',     color: '#16a0a0', jp: 'ポットオッズと比較して判断' },
  weak:    { label: '弱い',       color: '#a36b00', jp: '基本はチェック。大きいベットは降りる' },
  air:     { label: '何もない',   color: '#9b2335', jp: 'ブラフ以外は降りる準備を' },
};

const POSTFLOP_ACTION_LABELS = { bet: 'Bet', check: 'Check', call: 'Call', fold: 'Fold' };

/**
 * フラッシュドロー / ストレートドローを検出 (リバーでは判定しない)
 * @returns {{label:string, outs:number, equity:number}|null}
 */
function detectDraw(hole, community) {
  if (community.length >= 5) return null;
  const all = [...hole, ...community];

  // フラッシュドロー (同スート4枚)
  const suitCount = {};
  all.forEach(c => suitCount[c.s] = (suitCount[c.s] || 0) + 1);
  const hasFlushDraw = Object.values(suitCount).some(c => c === 4);

  // ストレートドロー (A-2-3-4-5 のホイールにも対応)
  let vals = [...new Set(all.map(c => c.numVal))].sort((a, b) => a - b);
  if (vals.includes(14)) vals = [1, ...vals];

  let straightType = null; // 'open' (8アウツ) | 'gutshot' (4アウツ)
  for (let start = vals[0]; start <= 14 - 4; start++) {
    const window = [start, start+1, start+2, start+3, start+4];
    const present = window.filter(v => vals.includes(v));
    if (present.length === 4) {
      const missingIdx = window.findIndex(v => !vals.includes(v));
      if (missingIdx === 0 || missingIdx === 4) straightType = 'open';
      else if (!straightType) straightType = 'gutshot';
    }
  }

  let outs = 0;
  const labels = [];
  if (hasFlushDraw)             { outs += 9; labels.push('フラッシュドロー'); }
  if (straightType === 'open')  { outs += 8; labels.push('ストレートドロー(両面)'); }
  else if (straightType)        { outs += 4; labels.push('ストレートドロー(片面)'); }

  if (outs === 0) return null;

  // 4-2ルール: 残り2枚なら×4、残り1枚なら×2
  const cardsToCome = community.length === 3 ? 2 : 1;
  const equity = Math.min(outs * (cardsToCome === 2 ? 4 : 2), 100);
  return { label: labels.join(' + '), outs, equity };
}

/**
 * 現在のハンドの強さを分析する
 * @param {Array} hole       プレイヤーのホールカード (2枚)
 * @param {Array} community  コミュニティカード (3〜5枚)
 * @returns {{tier:string, label:string, outs?:number, equity?:number}}
 */
function analyzePostflopHand(hole, community) {
  const best     = bestHand([...hole, ...community]);
  const boardVals = community.map(c => c.numVal).sort((a,b) => b - a);
  const maxBoard  = boardVals[0];
  const isPocket  = hole[0].numVal === hole[1].numVal;

  if (best.rank >= 7) return { tier: 'monster', label: best.name };
  if (best.rank === 6) return { tier: 'monster', label: 'フルハウス' };
  if (best.rank === 5) return { tier: 'monster', label: 'フラッシュ' };
  if (best.rank === 4) return { tier: 'monster', label: 'ストレート' };
  if (best.rank === 3) return { tier: 'monster', label: isPocket ? 'セット' : 'スリーカード' };
  if (best.rank === 2) return { tier: 'strong',  label: 'ツーペア' };

  if (best.rank === 1) {
    if (isPocket) {
      return hole[0].numVal > maxBoard
        ? { tier: 'strong', label: 'オーバーペア' }
        : { tier: 'medium', label: 'ボード以下のポケットペア' };
    }
    const pairCard = hole.find(c => community.some(b => b.numVal === c.numVal));
    if (!pairCard) {
      // ボード自体にペアがあり、自分のホールカードは絡んでいない
      return { tier: 'weak', label: 'ボードにペア (自分はノーペア)' };
    }
    if (pairCard.numVal === maxBoard) {
      const kicker = hole.find(c => c.numVal !== pairCard.numVal)?.numVal ?? 0;
      return kicker >= 11
        ? { tier: 'strong', label: 'トップペア (強キッカー)' }
        : { tier: 'medium', label: 'トップペア (弱キッカー)' };
    }
    if (pairCard.numVal === boardVals[1]) return { tier: 'medium', label: 'ミドルペア' };
    return { tier: 'weak', label: 'ボトムペア' };
  }

  // ハイカード: ドロー or オーバーカード判定
  const draw = detectDraw(hole, community);
  if (draw) return { tier: 'draw', label: draw.label, outs: draw.outs, equity: draw.equity };

  const holeMax = Math.max(hole[0].numVal, hole[1].numVal);
  return holeMax > maxBoard
    ? { tier: 'weak', label: 'オーバーカードのみ' }
    : { tier: 'air',  label: 'ハイカード (役なし)' };
}

/**
 * ポットオッズ (コールに必要な勝率%) を計算
 * @param {number} toCall コールに必要な額
 * @param {number} pot    現在のポット (toCallを含まない)
 * @returns {number} 必要勝率 (0〜100)
 */
function calcPotOdds(toCall, pot) {
  if (toCall <= 0) return 0;
  return Math.round((toCall / (pot + toCall)) * 100);
}

/**
 * 配列からランダムに n 個を取り出す (Fisher-Yates 部分シャッフル, 非破壊)
 */
function _sampleN(arr, n) {
  const a = [...arr];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/**
 * モンテカルロ法で「ランダムな相手」に対する推定勝率を計算
 * @param {Array}  hole       プレイヤーのホールカード (2枚)
 * @param {Array}  community  コミュニティカード (3〜5枚)
 * @param {number} iterations シミュレーション回数 (デフォルト200)
 * @returns {number} 推定勝率 (0〜100)
 */
function estimateEquity(hole, community, iterations = 200) {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

  // 既に見えているカードを除いた残りデッキを構築
  const used = new Set([...hole, ...community].map(c => `${c.r}${c.s}`));
  const remain = [];
  for (const s of suits) for (const r of ranks) {
    if (!used.has(`${r}${s}`)) {
      const numVal = r==='A'?14 : r==='K'?13 : r==='Q'?12 : r==='J'?11 : +r;
      remain.push({ r, s, numVal });
    }
  }

  const need = 5 - community.length; // 残りコミュニティカード枚数
  let win = 0, tie = 0;

  for (let i = 0; i < iterations; i++) {
    const sample  = _sampleN(remain, 2 + need);
    const oppHole = [sample[0], sample[1]];
    const fullCom = [...community, ...sample.slice(2)];

    const pScore = bestHand([...hole, ...fullCom]).score;
    const oScore = bestHand([...oppHole, ...fullCom]).score;

    if (pScore > oScore) win++;
    else if (pScore === oScore) tie++;
  }

  return Math.round(((win + tie * 0.5) / iterations) * 100);
}

/**
 * ポストフロップの推奨アクションを返す
 * @param {Object}  analysis    analyzePostflopHand() の戻り値
 * @param {boolean} facingBet   相手のベットに直面しているか
 * @param {number}  potOddsPct  必要勝率 (%)
 * @param {number}  equityPct   推定勝率 (%) — estimateEquity() の結果
 * @returns {'bet'|'check'|'call'|'fold'}
 */
function getPostflopRecommendation(analysis, facingBet, potOddsPct, equityPct) {
  const { tier } = analysis;

  if (!facingBet) {
    if (tier === 'monster' || tier === 'strong')        return 'bet';
    if (tier === 'draw' && (analysis.equity ?? 0) >= 35) return 'bet'; // セミブラフ
    return 'check';
  }

  // ベットに直面: 推定勝率 vs 必要勝率 (ポットオッズ) で判断
  return equityPct >= potOddsPct ? 'call' : 'fold';
}

// ============================================================
// ポストフロップ戦略ガイド (静的リファレンス)
// ============================================================

// 役の一覧 (強い順)
const HAND_RANK_INFO = [
  { name: 'ロイヤルフラッシュ', ex: 'A♠ K♠ Q♠ J♠ 10♠', desc: '同じスートのA-K-Q-J-10。最強の役' },
  { name: 'ストレートフラッシュ', ex: '9♥ 8♥ 7♥ 6♥ 5♥', desc: '同じスートで連続した5枚' },
  { name: 'フォーカード', ex: 'K♠ K♥ K♦ K♣ 2♠', desc: '同じランクが4枚' },
  { name: 'フルハウス', ex: 'J♠ J♥ J♦ 4♣ 4♠', desc: 'スリーカード + ペア' },
  { name: 'フラッシュ', ex: 'A♣ J♣ 8♣ 5♣ 2♣', desc: '同じスートが5枚 (連続でなくてOK)' },
  { name: 'ストレート', ex: '8♠ 7♥ 6♦ 5♣ 4♠', desc: '異なるスートでも連続した5枚' },
  { name: 'スリーカード', ex: '7♠ 7♥ 7♦ K♣ 2♠', desc: '同じランクが3枚 (セットとも呼ばれる)' },
  { name: 'ツーペア', ex: 'Q♠ Q♥ 6♦ 6♣ 3♠', desc: 'ペアが2組' },
  { name: 'ワンペア', ex: '10♠ 10♥ K♦ 6♣ 2♠', desc: '同じランクが2枚' },
  { name: 'ハイカード', ex: 'A♠ J♥ 8♦ 5♣ 2♠', desc: '役なし。一番高いカード1枚で勝負' },
];

function buildPostflopGuide() {
  const el = document.getElementById('matrix-guide');
  if (!el) return;

  const order   = ['monster', 'strong', 'medium', 'draw', 'weak', 'air'];
  const noBetMap = { monster:'Bet', strong:'Bet', medium:'Check', draw:'Check / Bet', weak:'Check', air:'Check' };
  const betMap   = { monster:'Call/Raise', strong:'Call', medium:'状況次第', draw:'オッズ次第', weak:'Fold', air:'Fold' };

  let html = '<div class="guide-wrap">';

  // ── 役の一覧 (最も基本的なリファレンス) ──
  html += '<h4>役の一覧 (強い順)</h4>';
  html += '<table class="guide-tbl"><thead><tr><th>役</th><th>例</th><th>説明</th></tr></thead><tbody>';
  HAND_RANK_INFO.forEach(h => {
    html += `<tr><td class="rank-name">${h.name}</td><td class="rank-ex">${h.ex}</td><td>${h.desc}</td></tr>`;
  });
  html += '</tbody></table>';

  html += '<h4>ハンドの強さ別アクション</h4>';
  html += '<table class="guide-tbl"><thead><tr><th>強さ</th><th>説明</th><th>ベット無し</th><th>ベット有り</th></tr></thead><tbody>';
  order.forEach(t => {
    const info = TIER_INFO[t];
    html += `<tr><td><span class="tier-chip-sm" style="background:${info.color}">${info.label}</span></td>`
          + `<td>${info.jp}</td><td>${noBetMap[t]}</td><td>${betMap[t]}</td></tr>`;
  });
  html += '</tbody></table>';

  html += '<h4>覚えておきたい公式</h4>';
  html += '<div class="guide-formula"><b>勝率の概算 (4-2ルール)</b><br>'
        + '残り2枚 (フロップ後): アウツ × 4 %　/　残り1枚 (ターン後): アウツ × 2 %</div>';
  html += '<div class="guide-formula"><b>ポットオッズ</b><br>'
        + '必要勝率 = コール額 ÷ (ポット + コール額)</div>';
  html += '<div class="guide-formula">画面上部の「勝率」が「必要勝率」を<b>上回っていればコールはプラス収支</b>。'
        + '下回るならフォールドが正解。</div>';

  html += '</div>';
  el.innerHTML = html;
}

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  buildHandMatrices();
  buildPostflopGuide();
  switchTab('btn');
});
