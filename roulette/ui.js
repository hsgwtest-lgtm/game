'use strict';
/* ============================================================
   ui.js  ── DOM構築・描画更新・イベント処理
   game.js に依存。必ず game.js の後に読み込むこと。
   ============================================================ */

// ── game.js のスタブを実装で上書き ───────────────────────────
render    = _render;
showToast = _showToast;

// ── DOM 構築 ─────────────────────────────────────────────────

/** チップ選択ボタン行を生成 */
function buildChipRow() {
  const row = document.getElementById('chipRow');
  CHIPS.forEach(c => {
    const btn       = document.createElement('button');
    btn.className   = 'chip-btn' + (c === state.chip ? ' active' : '');
    btn.textContent = c >= 1000 ? `¥${c / 1000}K` : `¥${c}`;
    btn.dataset.chip = c;
    row.appendChild(btn);
  });
}

/** ベッティングボード全体を生成 */
function buildBettingBoard() {
  _buildNumberGrid();
  _buildDozenRow();
  _buildOutsideRow();
}

/** 数字グリッド（0マス + 1〜36 + 2:1コラムボタン）を生成 */
function _buildNumberGrid() {
  const grid = document.getElementById('numberGrid');

  // 0マス：縦3行をスパン（CSSグリッド grid-row: 1 / 4）
  grid.appendChild(_makeNumCell('N0', '0', '#007A3D', '1 / 4'));

  // 上行: 3, 6, 9, ..., 36  ／  コラム3（n % 3 === 0）
  for (let i = 1; i <= 12; i++) {
    const n = i * 3;
    grid.appendChild(_makeNumCell(`N${n}`, `${n}`, REDS.has(n) ? '#BB2000' : '#0D0D0D'));
  }
  grid.appendChild(_makeOutCell('c3', '2:1', 2, '#0a1b0a'));

  // 中行: 2, 5, 8, ..., 35  ／  コラム2（n % 3 === 2）
  for (let i = 1; i <= 12; i++) {
    const n = i * 3 - 1;
    grid.appendChild(_makeNumCell(`N${n}`, `${n}`, REDS.has(n) ? '#BB2000' : '#0D0D0D'));
  }
  grid.appendChild(_makeOutCell('c2', '2:1', 2, '#0a1b0a'));

  // 下行: 1, 4, 7, ..., 34  ／  コラム1（n % 3 === 1）
  for (let i = 1; i <= 12; i++) {
    const n = i * 3 - 2;
    grid.appendChild(_makeNumCell(`N${n}`, `${n}`, REDS.has(n) ? '#BB2000' : '#0D0D0D'));
  }
  grid.appendChild(_makeOutCell('c1', '2:1', 2, '#0a1b0a'));
}

/** ダズンベット行（1st / 2nd / 3rd 12）を生成 */
function _buildDozenRow() {
  const row = document.getElementById('dozenRow');
  row.appendChild(document.createElement('div')); // 0列スペーサー
  DOZEN_DEFS.forEach(def => {
    const cell = _makeOutCell(def.k, def.l, def.p, def.bg);
    cell.style.gridColumn = 'span 4'; // 数字列4つ分をスパン
    row.appendChild(cell);
  });
  row.appendChild(document.createElement('div')); // 2:1列スペーサー
}

/** アウトサイドベット行（1〜18 / 偶数 / 赤 / 黒 / 奇数 / 19〜36）を生成 */
function _buildOutsideRow() {
  const row = document.getElementById('outsideRow');
  row.appendChild(document.createElement('div'));
  OUTSIDE_DEFS.forEach(def => row.appendChild(_makeOutCell(def.k, def.l, def.p, def.bg)));
  row.appendChild(document.createElement('div'));
}

/**
 * 番号ベットセルを生成する
 * @param {string} key     ベットキー（例: 'N7'）
 * @param {string} label   表示テキスト
 * @param {string} bg      背景色
 * @param {string} gridRow CSSのgrid-row値（例: '1 / 4'）省略可
 */
function _makeNumCell(key, label, bg, gridRow) {
  const cell = document.createElement('div');
  cell.className    = 'bet-cell';
  cell.dataset.key  = key;
  cell.style.background = bg;

  const lbl = document.createElement('span');
  lbl.textContent = label;
  cell.appendChild(lbl);

  const badge = document.createElement('span');
  badge.className = 'badge hidden';
  cell.appendChild(badge);

  if (gridRow) {
    cell.style.gridRow    = gridRow;
    cell.style.gridColumn = '1'; // 常に第1列
  }
  return cell;
}

/**
 * アウトサイドベットセルを生成する
 * @param {string} key    ベットキー
 * @param {string} label  表示テキスト
 * @param {number} payout 配当倍率
 * @param {string} bg     背景色
 */
function _makeOutCell(key, label, payout, bg) {
  const cell = document.createElement('div');
  cell.className    = 'bet-cell';
  cell.dataset.key  = key;
  cell.style.background = bg;

  const lbl = document.createElement('span');
  lbl.textContent = label;
  cell.appendChild(lbl);

  const pay = document.createElement('span');
  pay.className   = 'pay';
  pay.textContent = `${payout}:1`;
  cell.appendChild(pay);

  const badge = document.createElement('span');
  badge.className = 'badge hidden';
  cell.appendChild(badge);

  return cell;
}

// ── UI 更新関数群 ─────────────────────────────────────────────

/** 残高表示・リセットボタン表示を更新 */
function _updateBalance() {
  document.getElementById('balanceDisplay').textContent = fmtYen(state.balance);
  const show = state.balance < state.chip && !state.spinning;
  document.getElementById('btnReset').classList.toggle('hidden', !show);
}

/** ベッティングボードのバッジと合計ベット表示を更新 */
function _updateBettingBoard() {
  document.querySelectorAll('.bet-cell').forEach(cell => {
    const amt   = state.bets[cell.dataset.key] || 0;
    const badge = cell.querySelector('.badge');
    if (amt > 0) {
      badge.textContent = fmtBadge(amt);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });
  const tb = sumB(state.bets);
  document.getElementById('totalBetDisplay').textContent = tb > 0 ? `合計 ${fmtYen(tb)}` : '';
}

/** チップ選択ボタンのアクティブ状態を更新 */
function _updateChipButtons() {
  document.querySelectorAll('.chip-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.chip) === state.chip);
  });
}

/** コントロールボタンの有効/無効・スピン中テキストを更新 */
function _updateControls() {
  const tb = sumB(state.bets);
  const { spinning, lastBets, balance } = state;
  document.getElementById('btnClear').disabled  = spinning || tb === 0;
  document.getElementById('btnDouble').disabled = spinning || tb === 0;
  document.getElementById('btnSpin').disabled   = spinning || tb === 0;
  document.getElementById('btnRebet').disabled  =
    spinning || !lastBets || sumB(lastBets) > balance;

  const spinBtn = document.getElementById('btnSpin');
  spinBtn.textContent = spinning ? '🎡 回転中…' : '▶ SPIN';
  spinBtn.classList.toggle('spinning', spinning);
}

/** 直前の結果バッジ（ホイール上部）を更新 */
function _updateResultBox() {
  const box   = document.getElementById('resultBox');
  const numEl = document.getElementById('resultNumber');
  if (state.result) {
    box.classList.remove('hidden');
    numEl.textContent      = state.result.n;
    numEl.style.background = clrHex(state.result.c);
  } else {
    box.classList.add('hidden');
  }
}

/** 純損益表示（SPINボタン右のセル）を更新 */
function _updateNetDisplay() {
  const el = document.getElementById('netDisplay');
  if (!state.result || !state.lastBets) {
    el.textContent = '—'; el.className = 'net-display'; return;
  }
  const net = state.result.w - sumB(state.lastBets);
  if (net > 0)      { el.textContent = `+${fmtYen(net)}`;           el.className = 'net-display win';  }
  else if (net < 0) { el.textContent = `-${fmtYen(Math.abs(net))}`; el.className = 'net-display lose'; }
  else              { el.textContent = `${fmtYen(0)}`;               el.className = 'net-display';      }
}

/** 履歴ドット列を更新 */
function _updateHistory() {
  const section = document.getElementById('historySection');
  const dotsEl  = document.getElementById('historyDots');
  if (state.history.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  dotsEl.innerHTML = '';
  state.history.forEach(h => {
    const dot = document.createElement('div');
    dot.className       = 'hist-dot';
    dot.style.background = clrHex(h.c);
    dot.style.border    = h.net > 0 ? '1.5px solid #FFD700' : '1.5px solid #2a2a2a';
    dot.textContent     = h.n;
    dot.title           = `${h.n}（${clrLabel(h.c)}）: ${h.net >= 0 ? '+' : ''}${fmtYen(h.net)}`;
    dotsEl.appendChild(dot);
  });
}

/** state に合わせて全UI要素を再描画 */
function _render() {
  _updateBalance();
  _updateBettingBoard();
  _updateChipButtons();
  _updateControls();
  _updateResultBox();
  _updateNetDisplay();
  _updateHistory();
}

// ── トースト通知 ──────────────────────────────────────────────
let _toastTimer = null;
function _showToast(msg, type) {
  const el     = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type}`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast hidden'; }, 3000);
}

// ── 統計モーダル ──────────────────────────────────────────────
function showStatsModal() {
  const hist  = state.history;
  const total = hist.length;
  const wins  = hist.filter(h => h.net > 0).length;
  const reds  = hist.filter(h => h.c === 'r').length;
  const blks  = hist.filter(h => h.c === 'b').length;
  const grns  = hist.filter(h => h.c === 'g').length;
  const net   = hist.reduce((a, h) => a + h.net, 0);

  // 頻出番号（最大5件）
  const freq = {};
  hist.forEach(h => { freq[h.n] = (freq[h.n] || 0) + 1; });
  const hot = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);

  document.getElementById('statsContent').innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">📊 セッション統計</h2>
      <button class="modal-close" id="statsClose">×</button>
    </div>
    ${total === 0
      ? '<p style="color:#555;text-align:center;padding:20px 0">まだデータがありません</p>'
      : `
        <div class="stats-grid">
          ${[
            ['総スピン',  `${total}回`,                              '#FFF'],
            ['勝率',      `${Math.round(wins / total * 100)}%`,     '#FFF'],
            ['純損益',    `${net >= 0 ? '+' : ''}${fmtYen(net)}`,  net >= 0 ? '#66FF88' : '#FF6666'],
            ['現在残高',  fmtYen(state.balance),                    '#C9A84C'],
          ].map(([l, v, c]) => `
            <div class="info-box">
              <div class="stat-label">${l}</div>
              <div class="stat-val" style="color:${c}">${v}</div>
            </div>`).join('')}
        </div>
        <div class="info-box" style="margin-bottom:10px">
          <div style="font-size:11px;color:#888;margin-bottom:8px">色の分布（直近 ${total} 回）</div>
          <div class="color-bar">
            <div style="width:${total ? reds / total * 100 : 33}%;background:#BB2000"></div>
            <div style="width:${total ? blks / total * 100 : 33}%;background:#333"></div>
            <div style="width:${total ? grns / total * 100 : 34}%;background:#007A3D"></div>
          </div>
          <div class="color-legend">
            <span>🔴 赤 ${reds}回</span>
            <span>⚫ 黒 ${blks}回</span>
            <span>🟢 緑 ${grns}回</span>
          </div>
        </div>
        ${hot.length > 0 ? `
          <div class="info-box">
            <div style="font-size:11px;color:#888;margin-bottom:8px">よく出た番号（直近 ${total} 回）</div>
            <div class="hot-numbers">
              ${hot.map(([n, cnt]) => `
                <div class="hot-num">
                  <div class="hot-dot" style="background:${clrHex(getClr(parseInt(n)))}">${n}</div>
                  <span class="hot-cnt">${cnt}回</span>
                </div>`).join('')}
            </div>
          </div>` : ''}
      `}
    <button class="btn-modal-close" style="margin-top:14px" id="statsClose2">閉じる</button>
  `;

  document.getElementById('statsModal').classList.remove('hidden');
  document.getElementById('statsClose').onclick  = closeStatsModal;
  document.getElementById('statsClose2').onclick = closeStatsModal;
}
function closeStatsModal() {
  document.getElementById('statsModal').classList.add('hidden');
}

// ── ルール説明モーダル ────────────────────────────────────────
function showRulesModal() {
  document.getElementById('rulesContent').innerHTML = `
    <div class="modal-header">
      <h2 class="modal-title">🎡 ルーレット ルール</h2>
      <button class="modal-close" id="rulesClose">×</button>
    </div>

    <h3 class="modal-section-title">📋 概要</h3>
    <p style="margin:0 0 14px">
      ヨーロピアンルーレット（シングルゼロ）。
      <strong style="color:#FFF">0〜36 の 37 マス</strong>があり、
      回転するボールが止まった番号で勝敗が決まります。
      ハウスエッジは約 <strong style="color:#FFF">2.70%</strong>
      （アメリカン版の 5.26% より有利）。
    </p>

    <h3 class="modal-section-title">🎲 ベットの種類と配当</h3>
    <div class="info-box" style="margin-bottom:8px">
      <div class="info-box-title">インサイドベット（番号直接）</div>
      <div class="payout-grid">
        <span>ストレートアップ（1 番号に直接ベット）</span>
        <span class="payout-val">35 : 1</span>
      </div>
    </div>
    <div class="info-box" style="margin-bottom:14px">
      <div class="info-box-title">アウトサイドベット</div>
      <div class="payout-grid">
        <span>赤 / 黒</span>                               <span class="payout-val">1 : 1</span>
        <span>奇数 / 偶数</span>                            <span class="payout-val">1 : 1</span>
        <span>ロー（1〜18）/ ハイ（19〜36）</span>          <span class="payout-val">1 : 1</span>
        <span>ダズン（1st / 2nd / 3rd 12）</span>          <span class="payout-val">2 : 1</span>
        <span>コラム（右端の 2:1 ボタン）</span>            <span class="payout-val">2 : 1</span>
      </div>
    </div>

    <h3 class="modal-section-title">⚠️ ゼロ（0）のルール</h3>
    <p style="margin:0 0 14px">
      0 が出るとアウトサイドベットは全て
      <strong style="color:#FF6666">負け</strong>。
      0 に直接ベットすると <strong style="color:#FFF">35:1</strong> の配当。
    </p>

    <h3 class="modal-section-title">🎮 遊び方</h3>
    <ol style="margin:0 0 14px;padding-left:18px;font-size:13px;line-height:2.1">
      <li>チップ（¥100〜¥5,000）を選ぶ</li>
      <li>ベッティングボードをタップしてベットを置く<br>
          <span style="font-size:11px;color:#666">同じマスを複数回タップで追加ベット可</span></li>
      <li>「▶ SPIN」を押す</li>
      <li>ボールが止まった番号で配当が確定する</li>
    </ol>

    <h3 class="modal-section-title">🔘 ボタン説明</h3>
    <ul style="margin:0 0 14px;padding-left:18px;font-size:13px;line-height:2.1">
      <li><strong style="color:#FF9999">クリア</strong>　全ベットを取り消す</li>
      <li><strong style="color:#99FF99">× 2 倍</strong>　全ベットを 2 倍にする</li>
      <li><strong style="color:#AAAAFF">リベット</strong>　直前のベット構成をそのまま再現</li>
      <li>履歴の<span style="color:#FFD700">金枠</span>は勝ち、<span style="color:#333;border:1px solid #444;padding:0 3px">暗枠</span>は負け</li>
    </ul>

    <div class="modal-note">
      ※ セブ旅行に向けた練習アプリです。<br>
      初期残高 ¥10,000 の架空マネーでお楽しみください。
    </div>
    <button class="btn-modal-close" id="rulesClose2">わかった！練習する</button>
  `;
  document.getElementById('rulesModal').classList.remove('hidden');
  document.getElementById('rulesClose').onclick  = closeRulesModal;
  document.getElementById('rulesClose2').onclick = closeRulesModal;
}
function closeRulesModal() {
  document.getElementById('rulesModal').classList.add('hidden');
}

// ── イベントリスナー設定 ──────────────────────────────────────
function setupEvents() {
  // チップ選択（委譲）
  document.getElementById('chipRow').addEventListener('click', e => {
    const btn = e.target.closest('.chip-btn');
    if (!btn) return;
    state.chip = parseInt(btn.dataset.chip);
    render();
  });

  // ベッティングボード（委譲）
  ['numberGrid', 'dozenRow', 'outsideRow'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      const cell = e.target.closest('.bet-cell');
      if (cell) placeBet(cell.dataset.key);
    });
  });

  // コントロールボタン
  document.getElementById('btnClear').addEventListener('click',  clearBets);
  document.getElementById('btnDouble').addEventListener('click', doubleBets);
  document.getElementById('btnRebet').addEventListener('click',  rebet);
  document.getElementById('btnSpin').addEventListener('click',   spin);
  document.getElementById('btnReset').addEventListener('click',  resetBalance);

  // ヘッダーボタン
  document.getElementById('btnStats').addEventListener('click', showStatsModal);
  document.getElementById('btnRules').addEventListener('click', showRulesModal);

  // モーダル背景クリックで閉じる
  document.getElementById('statsModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeStatsModal();
  });
  document.getElementById('rulesModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRulesModal();
  });
}

// ── 初期化 ───────────────────────────────────────────────────
loadState();           // localStorage から残高・履歴を復元（失敗時は初期値）
buildChipRow();         // チップ行を生成
buildBettingBoard();    // ベッティングボードを生成
setupEvents();          // イベントリスナーを設定
drawWheel(0, 0, 0, -1); // ホイール初期描画
render();               // UI 初期状態を描画
