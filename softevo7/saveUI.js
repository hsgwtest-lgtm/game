/**
 * saveUI.js — セーブ・リーダーボード・レース UI 管理モジュール
 *
 * 依存: creatureSaveManager.js, leaderboard.js, window.SoftEvoAPI (engine.js)
 */

import { saveCreature, loadCreature, loadAllCreatures, deleteCreature } from './creatureSaveManager.js';
import { postEntry, subscribeTop } from './leaderboard.js';

// ─── State ────────────────────────────────────────────────────────────
let currentModal = null;   // null | 'save' | 'leaderboard'
let lbUnsubscribe  = null;
let cachedSlots    = Array(10).fill(null);
let lbEntries      = [];let pendingSlots   = new Set(); // 世代終了を待機中のスロット番号
// ─── Engine API accessor ─────────────────────────────────────────────
const api = () => window.SoftEvoAPI ?? null;

// ─── Modal helpers ────────────────────────────────────────────────────
function openModal(name) {
  closeModal();
  currentModal = name;
  document.getElementById(`modal-${name}`)?.classList.remove('hidden');
  document.getElementById('modal-backdrop')?.classList.remove('hidden');
  if (name === 'save')        refreshSaveModal();
  if (name === 'leaderboard') refreshLeaderboard();
}

function closeModal() {
  if (currentModal) {
    document.getElementById(`modal-${currentModal}`)?.classList.add('hidden');
  }
  document.getElementById('modal-backdrop')?.classList.add('hidden');
  currentModal = null;

  // リーダーボード購読を解除
  if (lbUnsubscribe) { lbUnsubscribe(); lbUnsubscribe = null; }
}

// ═══════════════════════════════════════════════════════════════════════
//  SAVE MODAL
// ═══════════════════════════════════════════════════════════════════════

async function refreshSaveModal() {
  try {
    cachedSlots = await loadAllCreatures();
  } catch (e) {
    cachedSlots = Array(10).fill(null);
    showToast(`⚠️ スロット読み込みエラー: ${e.message}`, 'warn');
  }
  renderSlots();
}

function renderSlots() {
  const grid = document.getElementById('save-slots-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < 10; i++) {
    const slot   = cachedSlots[i];
    const slotNo = i + 1;
    const isPending = pendingSlots.has(slotNo);
    const card   = document.createElement('div');
    card.className = `slot-card ${isPending ? 'slot-pending' : slot ? 'slot-filled' : 'slot-empty'}`;

    if (isPending) {
      card.innerHTML = `
        <div class="slot-header">
          <span class="slot-num">Slot ${slotNo}</span>
          <span class="slot-pending-badge">⏳ 待機中</span>
        </div>
        <div class="slot-pending-label">世代終了で最優秀個体を保存します</div>
        <div class="slot-actions">
          <button class="slot-btn s-cancel" data-slot="${slotNo}">❌ キャンセル</button>
        </div>`;
    } else if (slot) {
      const d = new Date(slot.savedAt);
      const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      card.innerHTML = `
        <div class="slot-header">
          <span class="slot-num">Slot ${slotNo}</span>
          <span class="slot-date">${dateStr}</span>
        </div>
        <div class="slot-name">${esc(slot.name)}</div>
        <div class="slot-stats">
          <span class="slot-score">🏆 ${slot.score}</span>
          <span class="slot-gen">🧬 Gen ${slot.generation}</span>
        </div>
        <div class="slot-actions">
          <button class="slot-btn s-view"  data-slot="${slotNo}" title="生物を閲覧">🔍 確認</button>
          <button class="slot-btn s-save"  data-slot="${slotNo}" title="世代終了待機保存">💾 上書き</button>
          <button class="slot-btn s-post"  data-slot="${slotNo}" title="クラウドへ投稿">☁️ 投稿</button>
          <button class="slot-btn s-del"   data-slot="${slotNo}" title="削除">🗑</button>
        </div>`;
    } else {
      card.innerHTML = `
        <div class="slot-header">
          <span class="slot-num">Slot ${slotNo}</span>
        </div>
        <div class="slot-empty-label">— 空きスロット —</div>
        <div class="slot-actions">
          <button class="slot-btn s-save" data-slot="${slotNo}">💾 ここに保存</button>
        </div>`;
    }
    grid.appendChild(card);
  }

  grid.querySelectorAll('.s-view').forEach(b =>
    b.addEventListener('click', () => { window.location.href = `viewer.html?slot=${b.dataset.slot}`; }));
  grid.querySelectorAll('.s-save').forEach(b =>
    b.addEventListener('click', () => handleSaveToSlot(+b.dataset.slot)));
  grid.querySelectorAll('.s-cancel').forEach(b =>
    b.addEventListener('click', () => handleCancelPending(+b.dataset.slot)));
  grid.querySelectorAll('.s-del').forEach(b =>
    b.addEventListener('click', () => handleDeleteSlot(+b.dataset.slot)));
  grid.querySelectorAll('.s-post').forEach(b =>
    b.addEventListener('click', () => handlePostSlot(+b.dataset.slot)));
}

async function handleSaveToSlot(slot) {
  if (!api()?.isInSim()) {
    showToast('⚠️ シミュレーション中のみ保存できます', 'warn');
    return;
  }
  if (pendingSlots.has(slot)) {
    showToast(`⏳ Slot ${slot} は既に待機中です`, 'info');
    return;
  }

  pendingSlots.add(slot);
  showToast(`⏳ Slot ${slot}: 世代終了を待機中…`, 'info');
  renderSlots();

  try {
    const data = await api().queueSaveToSlot(slot);
    data.name = `Gen${data.generation}-${data.score}`;
    await saveCreature(slot, data);
    showToast(`✅ Slot ${slot} に保存しました！（世代 ${data.generation}・スコア ${data.score}）`, 'success');
    await refreshSaveModal();
  } catch (e) {
    if (e.message !== 'キャンセルされました') {
      showToast(`❌ 保存失敗: ${e.message}`, 'error');
    }
  } finally {
    pendingSlots.delete(slot);
    renderSlots();
  }
}

function handleCancelPending(slot) {
  api()?.cancelPendingSave(slot);
  pendingSlots.delete(slot);
  showToast(`❌ Slot ${slot} の待機をキャンセルしました`, 'info');
  renderSlots();
}

async function handleDeleteSlot(slot) {
  try {
    await deleteCreature(slot);
    showToast(`🗑 Slot ${slot} を削除しました`, 'info');
    await refreshSaveModal();
  } catch (e) {
    showToast(`❌ 削除失敗: ${e.message}`, 'error');
  }
}

async function handlePostSlot(slot) {
  const record = await loadCreature(slot).catch(() => null);
  if (!record) { showToast('⚠️ スロットが空です', 'warn'); return; }

  const nickInput = document.getElementById('save-nickname');
  const nickname  = nickInput?.value?.trim() || 'Anonymous';

  const btn = document.querySelector(`.s-post[data-slot="${slot}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '送信中…'; }

  try {
    // Float32Array → 通常配列に変換して投稿
    const genome = {
      weights: record.genome.weights.map(w => Array.from(w)),
      biases:  record.genome.biases.map(b => Array.from(b)),
    };
    await postEntry({
      nickname,
      score:      record.score,
      generation: record.generation,
      genome,
      blueprint:  record.blueprint ?? null,
    });
    showToast(`☁️ 投稿成功！ ${nickname}: ${record.score}点`, 'success');
  } catch (e) {
    showToast(`❌ 投稿失敗: ${e.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '☁️ 投稿'; }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  LEADERBOARD MODAL
// ═══════════════════════════════════════════════════════════════════════

function refreshLeaderboard() {
  const list = document.getElementById('lb-list');
  if (!list) return;
  list.innerHTML = '<div class="lb-loading">📡 読み込み中…</div>';

  lbUnsubscribe = subscribeTop((entries, err) => {
    lbEntries = entries;
    if (err) {
      list.innerHTML = `<div class="lb-error">❌ ${esc(err.message)}</div>`;
      return;
    }
    renderLeaderboard(entries);
  }, 20);
}

function renderLeaderboard(entries) {
  const list = document.getElementById('lb-list');
  if (!list) return;

  if (entries.length === 0) {
    list.innerHTML = '<div class="lb-empty">まだ投稿がありません。<br>最初の投稿者になりましょう！</div>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  list.innerHTML = entries.map((entry, i) => `
    <div class="lb-entry">
      <span class="lb-rank">${medals[i] ?? (i + 1) + '.'}</span>
      <div class="lb-info">
        <span class="lb-name">${esc(entry.nickname)}</span>
        <span class="lb-meta">🧬 Gen ${entry.generation ?? '?'} · ${entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('ja-JP') : '—'}</span>
      </div>
      <span class="lb-score">🏆 ${entry.score}</span>
      <button class="lb-race-btn" data-idx="${i}" title="この生物とレース対戦">🏎️</button>
    </div>
  `).join('');

  list.querySelectorAll('.lb-race-btn').forEach(btn =>
    btn.addEventListener('click', () => handleStartRace(+btn.dataset.idx)));
}

function handleStartRace(idx) {
  const entry = lbEntries[idx];
  if (!entry?.genome) { showToast('⚠️ このエントリにゲノムデータがありません', 'warn'); return; }

  const a = api();
  if (!a)           { showToast('⚠️ エンジン未初期化', 'warn'); return; }
  if (!a.isInSim()) { showToast('⚠️ 進化をスタートしてからレースに挑戦してください', 'warn'); return; }

  a.clearRaceOpponents();
  a.addRaceOpponent({
    genome:    entry.genome,
    blueprint: entry.blueprint ?? null,
    name:      entry.nickname,
    score:     entry.score,
  });

  closeModal();
  showRaceBar([{ name: entry.nickname, baseScore: entry.score }]);
  showToast(`🏎️ ${entry.nickname} とのレース開始！`, 'success');
}

// ═══════════════════════════════════════════════════════════════════════
//  RACE BAR
// ═══════════════════════════════════════════════════════════════════════

function showRaceBar(opponents) {
  const bar  = document.getElementById('race-bar');
  const info = document.getElementById('race-bar-info');
  if (!bar || !info) return;

  info.innerHTML = opponents
    .map(op => `<span class="race-opp-tag">👑 ${esc(op.name)}<span class="race-opp-base">ベスト: ${op.baseScore}</span></span>`)
    .join('');
  bar.classList.remove('hidden');
}

function hideRaceBar() {
  document.getElementById('race-bar')?.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════════════

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);

  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, 3200);
}

// ─── Utilities ───────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════

function setup() {
  // Open buttons
  document.getElementById('btn-save-modal')?.addEventListener('click', () => openModal('save'));
  document.getElementById('btn-leaderboard-modal')?.addEventListener('click', () => openModal('leaderboard'));

  // Backdrop / close buttons
  document.getElementById('modal-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('close-save-modal')?.addEventListener('click', closeModal);
  document.getElementById('close-lb-modal')?.addEventListener('click', closeModal);

  // Prevent modal panel clicks from bubbling to backdrop
  document.querySelectorAll('.modal-panel').forEach(el =>
    el.addEventListener('click', e => e.stopPropagation()));

  // Race bar stop
  document.getElementById('btn-stop-race')?.addEventListener('click', () => {
    api()?.clearRaceOpponents();
    hideRaceBar();
    showToast('🏁 レース終了', 'info');
  });
}

// engine.js の IIFE が完了して SoftEvoAPI が公開されるのを待つ
function waitForEngine() {
  if (window.SoftEvoAPI) { setup(); return; }
  setTimeout(waitForEngine, 80);
}

waitForEngine();
