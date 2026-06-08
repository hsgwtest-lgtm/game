'use strict';
// ============================================================
// strategy.js — ベーシックストラテジー判定エンジン
//
// 公開API (game.js から呼び出す):
//   getOptimalMove(playerScore, isSoft, isPair, dealerUpCard, pairRank) → 'H'|'S'|'D'|'P'
//   highlightStrategyCell(playerScore, isSoft, isPair, dealerUpCard, pairRank)
//   switchTab(tabName)
//   ACTION_LABELS  → { H:'Hit', S:'Stand', D:'Double', P:'Split' }
// ============================================================

// ディーラーアップカード順 (インデックス 0〜9)
const DEALER_CARDS = ['2','3','4','5','6','7','8','9','10','A'];

// アクション表示名 (game.js からも参照)
const ACTION_LABELS = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split' };

// セル背景色
const ACTION_COLORS = {
  H: '#9b2335',  // Hit   — 深紅
  S: '#1e6b3c',  // Stand — 深緑
  D: '#1a4a8a',  // Double — 深青
  P: '#b5800a',  // Split  — 琥珀
};

// ============================================================
// ベーシックストラテジーテーブル
// 各行: [dealer 2, 3, 4, 5, 6, 7, 8, 9, 10, A]
// ============================================================

// ===== ハードハンド (playerTotal 5〜17) =====
const HARD_STRATEGY = {
   5: ['H','H','H','H','H','H','H','H','H','H'],
   6: ['H','H','H','H','H','H','H','H','H','H'],
   7: ['H','H','H','H','H','H','H','H','H','H'],
   8: ['H','H','H','H','H','H','H','H','H','H'],
   9: ['H','D','D','D','D','H','H','H','H','H'],
  10: ['D','D','D','D','D','D','D','D','H','H'],
  11: ['D','D','D','D','D','D','D','D','D','H'],
  12: ['H','H','S','S','S','H','H','H','H','H'],
  13: ['S','S','S','S','S','H','H','H','H','H'],
  14: ['S','S','S','S','S','H','H','H','H','H'],
  15: ['S','S','S','S','S','H','H','H','H','H'],
  16: ['S','S','S','S','S','H','H','H','H','H'],
  17: ['S','S','S','S','S','S','S','S','S','S'],
};

// ===== ソフトハンド (A+2=13 〜 A+9=20) =====
const SOFT_STRATEGY = {
  13: ['H','H','H','D','D','H','H','H','H','H'], // A+2
  14: ['H','H','H','D','D','H','H','H','H','H'], // A+3
  15: ['H','H','D','D','D','H','H','H','H','H'], // A+4
  16: ['H','H','D','D','D','H','H','H','H','H'], // A+5
  17: ['H','D','D','D','D','H','H','H','H','H'], // A+6
  18: ['S','D','D','D','D','S','S','H','H','H'], // A+7
  19: ['S','S','S','S','S','S','S','S','S','S'], // A+8
  20: ['S','S','S','S','S','S','S','S','S','S'], // A+9
};

// ===== ペア戦略 =====
const PAIRS_STRATEGY = {
   'A': ['P','P','P','P','P','P','P','P','P','P'],
   '2': ['P','P','P','P','P','P','H','H','H','H'],
   '3': ['P','P','P','P','P','P','H','H','H','H'],
   '4': ['H','H','H','P','P','H','H','H','H','H'],
   '5': ['D','D','D','D','D','D','D','D','H','H'],
   '6': ['P','P','P','P','P','H','H','H','H','H'],
   '7': ['P','P','P','P','P','P','H','H','H','H'],
   '8': ['P','P','P','P','P','P','P','P','P','P'],
   '9': ['P','P','P','P','P','S','P','P','S','S'],
  '10': ['S','S','S','S','S','S','S','S','S','S'],
};

// ============================================================
// 最適手判定
// ============================================================

/**
 * ベーシックストラテジーに基づく最適手を返す
 * @param {number}  playerScore  プレイヤー合計点 (Ace=11で計算後)
 * @param {boolean} isSoft       ソフトハンド (Ace=11) か
 * @param {boolean} isPair       最初の2枚がペアか
 * @param {string}  dealerUpCard ディーラーのアップカード ('2'〜'A')
 * @param {string}  [pairRank]   ペア時のカードランク
 * @returns {'H'|'S'|'D'|'P'}
 */
function getOptimalMove(playerScore, isSoft, isPair, dealerUpCard, pairRank) {
  const dIdx = DEALER_CARDS.indexOf(String(dealerUpCard));
  if (dIdx === -1) return 'H';

  // ペア判定 (J/Q/K はすべて '10' として扱う)
  if (isPair && pairRank !== undefined) {
    let pv = String(pairRank);
    if (['J','Q','K'].includes(pv)) pv = '10';
    if (PAIRS_STRATEGY[pv]) return PAIRS_STRATEGY[pv][dIdx];
  }

  // ソフトハンド (13〜20 のみ対象)
  if (isSoft && playerScore >= 13 && playerScore <= 20) {
    if (SOFT_STRATEGY[playerScore]) return SOFT_STRATEGY[playerScore][dIdx];
  }

  // ハードハンド
  if (playerScore <= 8)  return 'H';
  if (playerScore >= 17) return 'S';
  return HARD_STRATEGY[playerScore]?.[dIdx] ?? 'H';
}

// ============================================================
// 戦略チャート DOM 構築
// ============================================================

/**
 * Hard / Soft / Pairs の3チャートを全て構築してDOMに挿入
 */
function buildStrategyCharts() {
  _buildTable(
    'chart-hard', 'hard',
    ['5','6','7','8','9','10','11','12','13','14','15','16','17+'],
    [5,6,7,8,9,10,11,12,13,14,15,16,17],
    HARD_STRATEGY
  );
  _buildTable(
    'chart-soft', 'soft',
    ['A+2','A+3','A+4','A+5','A+6','A+7','A+8','A+9'],
    [13,14,15,16,17,18,19,20],
    SOFT_STRATEGY
  );
  _buildTable(
    'chart-pairs', 'pairs',
    ['A,A','2,2','3,3','4,4','5,5','6,6','7,7','8,8','9,9','10,10'],
    ['A','2','3','4','5','6','7','8','9','10'],
    PAIRS_STRATEGY
  );
}

/**
 * 戦略テーブルHTMLを生成してコンテナに挿入
 * @param {string} containerId  ターゲット要素ID
 * @param {string} type         'hard' | 'soft' | 'pairs'
 * @param {Array}  rowLabels    表示用行ラベル配列
 * @param {Array}  rowKeys      strategy オブジェクトのキー配列
 * @param {Object} strategy     上記ストラテジーテーブル定数
 */
function _buildTable(containerId, type, rowLabels, rowKeys, strategy) {
  const el = document.getElementById(containerId);
  if (!el) return;

  // ヘッダー行 (ディーラーアップカード)
  let html = '<div class="tbl-wrap"><table class="s-tbl"><thead><tr>';
  html += '<th class="th-corner">手</th>';
  DEALER_CARDS.forEach(d => { html += `<th>${d}</th>`; });
  html += '</tr></thead><tbody>';

  // データ行
  rowKeys.forEach((key, i) => {
    const actions = strategy[key] || [];
    html += `<tr><th class="th-row">${rowLabels[i]}</th>`;
    DEALER_CARDS.forEach((dc, j) => {
      const act = actions[j] || 'H';
      const bg  = ACTION_COLORS[act] || '#555';
      // セルID: "cell-hard-16-7", "cell-soft-18-A", "cell-pairs-A-6" など
      html += `<td id="cell-${type}-${key}-${dc}" class="s-cell" style="background:${bg}" data-act="${act}">${act}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// ============================================================
// ハイライト / タブ切り替え
// ============================================================

/**
 * 現在のプレイヤー状況に対応するセルをハイライトし、タブを切り替える
 */
function highlightStrategyCell(playerScore, isSoft, isPair, dealerUpCard, pairRank) {
  // 既存ハイライトをリセット
  document.querySelectorAll('.s-cell.active-cell').forEach(c => c.classList.remove('active-cell'));

  let type, rowKey;

  if (isPair && pairRank) {
    // ペア → Pairs タブ
    let pv = String(pairRank);
    if (['J','Q','K'].includes(pv)) pv = '10';
    type   = 'pairs';
    rowKey = pv;
  } else if (isSoft && playerScore >= 13 && playerScore <= 20) {
    // ソフトハンド → Soft タブ
    type   = 'soft';
    rowKey = playerScore;
  } else {
    // ハードハンド → Hard タブ
    type   = 'hard';
    rowKey = Math.min(Math.max(playerScore, 5), 17); // 5〜17 にクランプ
  }

  // 対応するタブに自動切り替え
  switchTab(type);

  // セルをハイライト & スクロール
  const cellId = `cell-${type}-${rowKey}-${dealerUpCard}`;
  const cell   = document.getElementById(cellId);
  if (cell) {
    cell.classList.add('active-cell');
    // スムーズスクロールでセルを表示
    cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

/**
 * タブ切り替え
 * @param {string} name 'hard' | 'soft' | 'pairs'
 */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const isActive = b.dataset.tab === name;
    b.classList.toggle('on', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.chart-pane').forEach(p => {
    p.classList.toggle('on', p.id === `chart-${name}`);
  });
}

// ============================================================
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  buildStrategyCharts();
  switchTab('hard');
});
