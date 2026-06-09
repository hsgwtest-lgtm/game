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
// 初期化
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  buildHandMatrices();
  switchTab('btn');
});
