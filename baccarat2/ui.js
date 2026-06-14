'use strict';

/* =========================================================================
 * バカラ練習アプリ — UI制御
 *
 * 役割分担:
 *   - game.js: ルール・状態(state)・遷移ロジック（DOMに依存しない）
 *   - ui.js  : state を読み取って描画し、ユーザー操作を game.js の
 *              関数に橋渡しする。アニメーション中の「公開済みカード」は
 *              ここでローカルに保持する一時的な配列であり、state には
 *              含めない（state は確定済みの情報のみを持つ）。
 * ========================================================================= */

(function () {
  const B = window.Baccarat;
  const state = B.state;

  // ---- DOM参照 -------------------------------------------------------------
  const el = {
    bankroll: document.getElementById('bankroll'),
    shoeCount: document.getElementById('shoe-count'),
    shoeBar: document.getElementById('shoe-bar'),
    playerHand: document.getElementById('player-hand'),
    bankerHand: document.getElementById('banker-hand'),
    playerTotal: document.getElementById('player-total'),
    bankerTotal: document.getElementById('banker-total'),
    playerBet: document.getElementById('player-bet'),
    bankerBet: document.getElementById('banker-bet'),
    tieBet: document.getElementById('tie-bet'),
    dealerCallBody: document.getElementById('dealer-call-body'),
    roadGrid: document.getElementById('road-grid'),
    resultBanner: document.getElementById('result-banner'),
    chipTray: document.getElementById('chip-tray'),
    btnUndo: document.getElementById('btn-undo'),
    btnClear: document.getElementById('btn-clear'),
    btnDeal: document.getElementById('btn-deal'),
    statsToggle: document.getElementById('stats-toggle'),
    statsPanel: document.getElementById('stats-panel'),
    statsBody: document.getElementById('stats-panel-body'),
    rulesToggle: document.getElementById('rules-toggle'),
    rulesPanel: document.getElementById('rules-panel'),
    floatBtns: document.querySelector('.float-btns'),
    scrim: document.getElementById('scrim'),
    zones: {
      player: document.querySelector('[data-zone="player"]'),
      banker: document.querySelector('[data-zone="banker"]'),
      tie: document.querySelector('[data-zone="tie"]')
    }
  };

  // ---- 表示用ヘルパー ---------------------------------------------------------
  function formatYen(n) {
    const value = Math.round(n);
    const sign = value < 0 ? '-' : '';
    return sign + '¥' + Math.abs(value).toLocaleString('ja-JP');
  }

  function chipLabel(value) {
    if (value >= 10000) return (value / 10000) + '万';
    if (value >= 1000) return (value / 1000) + 'K';
    return String(value);
  }

  function isRed(suit) {
    return suit === '♥' || suit === '♦';
  }

  function setDealerCall(text) {
    el.dealerCallBody.textContent = text;
  }

  function defaultDealerMessage() {
    const phase = B.getPhase(state);
    if (phase === 'ready') return 'ベットを確定したら「ディール」を押してください。';
    if (state.bankroll < B.constants.CHIP_VALUES[0]) {
      return '残高が不足しています。統計パネルからリセットできます。';
    }
    return 'チップを選んで、ゾーンをタップして賭けてください。';
  }

  // ---- カード描画 -------------------------------------------------------------
  function appendCard(container, card) {
    const flip = document.createElement('div');
    flip.className = 'card-flip';
    const colorClass = isRed(card.suit) ? 'is-red' : 'is-black';
    flip.innerHTML =
      '<div class="card-flip__inner">' +
        '<div class="card-face card-face--back"><span class="card-face__mark">P・B</span></div>' +
        '<div class="card-face card-face--front ' + colorClass + '">' +
          '<span class="card-face__corner card-face__corner--tl">' + card.rank + '<br>' + card.suit + '</span>' +
          '<span class="card-face__pip">' + card.suit + '</span>' +
          '<span class="card-face__corner card-face__corner--br">' + card.rank + '<br>' + card.suit + '</span>' +
        '</div>' +
      '</div>';
    container.appendChild(flip);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        flip.classList.add('is-entered');
        setTimeout(function () { flip.classList.add('is-revealed'); }, 160);
      });
    });
  }

  function clearTable() {
    el.playerHand.innerHTML = '';
    el.bankerHand.innerHTML = '';
    el.playerTotal.textContent = '--';
    el.bankerTotal.textContent = '--';
    el.resultBanner.classList.remove('is-visible', 'result-banner--player', 'result-banner--banker', 'result-banner--tie');
    el.resultBanner.innerHTML = '';
  }

  // ---- 結果バナー -------------------------------------------------------------
  function showResultBanner(result) {
    if (!result) return;
    const wagered = B.totalBet(result.bets);
    const net = result.payout - wagered;

    let mainText;
    if (result.winner === 'tie') mainText = 'タイ';
    else if (result.winner === 'player') mainText = 'プレイヤー勝ち';
    else mainText = 'バンカー勝ち';

    let subText;
    if (net > 0) subText = '獲得 +' + formatYen(net);
    else if (net < 0) subText = '損失 ' + formatYen(net);
    else subText = 'プッシュ（ベットは返却）';
    if (result.commission > 0) subText += '　コミッション ' + formatYen(-result.commission);

    el.resultBanner.classList.remove('result-banner--player', 'result-banner--banker', 'result-banner--tie');
    el.resultBanner.classList.add('result-banner--' + result.winner);
    el.resultBanner.innerHTML = mainText + '<span class="result-banner__sub">' + subText + '</span>';
    requestAnimationFrame(function () {
      el.resultBanner.classList.add('is-visible');
    });
  }

  // ---- ディール アニメーション -------------------------------------------------
  function revealSteps(result) {
    const revealed = { player: [], banker: [] };
    let i = 0;

    function next() {
      if (i >= result.steps.length) {
        const finished = B.finalizeRound(state);
        showResultBanner(finished);
        renderAll();
        return;
      }
      const step = result.steps[i];
      if (step.playerCard) {
        revealed.player.push(step.playerCard);
        appendCard(el.playerHand, step.playerCard);
      }
      if (step.bankerCard) {
        revealed.banker.push(step.bankerCard);
        appendCard(el.bankerHand, step.bankerCard);
      }
      if (step.playerCard || step.bankerCard) {
        el.playerTotal.textContent = revealed.player.length ? String(B.handTotal(revealed.player)) : '--';
        el.bankerTotal.textContent = revealed.banker.length ? String(B.handTotal(revealed.banker)) : '--';
      }
      if (step.message) setDealerCall(step.message);

      i += 1;
      const delay = (step.playerCard || step.bankerCard) ? 700 : 1100;
      setTimeout(next, delay);
    }

    setDealerCall('カードを配ります…');
    setTimeout(next, 500);
  }

  // ---- 描画 -------------------------------------------------------------------
  function renderBankroll() {
    el.bankroll.textContent = formatYen(state.bankroll);
  }

  function renderShoe() {
    el.shoeCount.textContent = state.shoe.length + ' / ' + state.shoeTotal;
    const ratio = state.shoeTotal ? state.shoe.length / state.shoeTotal : 1;
    el.shoeBar.style.transform = 'scaleX(' + ratio.toFixed(3) + ')';
  }

  function renderBets() {
    el.playerBet.textContent = formatYen(state.bets.player);
    el.bankerBet.textContent = formatYen(state.bets.banker);
    el.tieBet.textContent = formatYen(state.bets.tie);
  }

  function renderChips() {
    const chips = el.chipTray.querySelectorAll('.chip');
    chips.forEach(function (c) {
      c.classList.toggle('is-selected', Number(c.dataset.value) === state.selectedChip);
    });
  }

  function renderButtons() {
    const phase = B.getPhase(state);
    el.btnDeal.disabled = phase !== 'ready';
    el.btnClear.disabled = !(phase === 'betting' || phase === 'ready');
    el.btnUndo.disabled = !(phase === 'betting' || phase === 'ready');

    const dealing = phase === 'dealing';
    Object.keys(el.zones).forEach(function (zone) {
      el.zones[zone].classList.toggle('is-disabled', dealing);
    });
  }

  function renderDealerDefault() {
    const phase = B.getPhase(state);
    if (phase === 'betting' || phase === 'ready') {
      setDealerCall(defaultDealerMessage());
    }
  }

  function renderRoad() {
    el.roadGrid.innerHTML = '';
    state.history.forEach(function (entry) {
      const cell = document.createElement('div');
      cell.className = 'road-cell road-cell--' + entry.winner;
      cell.title = entry.playerTotal + ' - ' + entry.bankerTotal;
      el.roadGrid.appendChild(cell);
    });
    el.roadGrid.scrollLeft = el.roadGrid.scrollWidth;
  }

  function renderStats() {
    const s = state.stats;
    const pct = function (n) {
      return s.rounds ? (n / s.rounds * 100).toFixed(1) : '0.0';
    };
    el.statsBody.innerHTML =
      '<h2>統計</h2>' +
      '<dl>' +
        '<div><dt>プレイ回数</dt><dd>' + s.rounds + '</dd></div>' +
        '<div><dt>プレイヤー勝ち</dt><dd>' + s.playerWins + ' (' + pct(s.playerWins) + '%)</dd></div>' +
        '<div><dt>バンカー勝ち</dt><dd>' + s.bankerWins + ' (' + pct(s.bankerWins) + '%)</dd></div>' +
        '<div><dt>タイ</dt><dd>' + s.ties + ' (' + pct(s.ties) + '%)</dd></div>' +
        '<div><dt>コミッション総額</dt><dd>' + formatYen(s.totalCommission) + '</dd></div>' +
        '<div><dt>純損益</dt><dd class="' + (s.netProfit >= 0 ? 'is-positive' : 'is-negative') + '">' +
          (s.netProfit > 0 ? '+' : '') + formatYen(s.netProfit) + '</dd></div>' +
        '<div><dt>最高残高</dt><dd>' + formatYen(s.maxBankroll) + '</dd></div>' +
        '<div><dt>最低残高</dt><dd>' + formatYen(s.minBankroll) + '</dd></div>' +
      '</dl>' +
      '<button class="btn btn--ghost" id="btn-reset" type="button">残高をリセット</button>' +
      '<button class="btn btn--primary stats-panel__close" id="btn-stats-close" type="button">閉じる</button>';

    document.getElementById('btn-reset').addEventListener('click', function () {
      if (window.confirm('残高・統計・ロード履歴をリセットしますか？')) {
        B.resetBankroll(state);
        clearTable();
        renderAll();
      }
    });
    document.getElementById('btn-stats-close').addEventListener('click', closeStats);
  }

  function renderAll() {
    renderBankroll();
    renderShoe();
    renderBets();
    renderChips();
    renderButtons();
    renderRoad();
    renderDealerDefault();
    if (!el.statsPanel.hidden) renderStats();
  }

  // ---- 統計パネル -------------------------------------------------------------
  function openStats() {
    renderStats();
    el.statsPanel.hidden = false;
    el.rulesPanel.hidden = true;
    el.scrim.hidden = false;
    el.floatBtns.hidden = true;
    el.statsToggle.setAttribute('aria-expanded', 'true');
    el.rulesToggle.setAttribute('aria-expanded', 'false');
  }

  function closeStats() {
    el.statsPanel.hidden = true;
    el.scrim.hidden = true;
    el.floatBtns.hidden = false;
    el.statsToggle.setAttribute('aria-expanded', 'false');
  }

  // ---- ルールパネル -----------------------------------------------------------
  function openRules() {
    el.rulesPanel.hidden = false;
    el.statsPanel.hidden = true;
    el.scrim.hidden = false;
    el.floatBtns.hidden = true;
    el.rulesToggle.setAttribute('aria-expanded', 'true');
    el.statsToggle.setAttribute('aria-expanded', 'false');
    // 閉じるボタンをここで結線（パネルは常駐HTMLなのでonce的に）
    const closeBtn = document.getElementById('btn-rules-close');
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = '1';
      closeBtn.addEventListener('click', closeRules);
    }
  }

  function closeRules() {
    el.rulesPanel.hidden = true;
    el.scrim.hidden = true;
    el.floatBtns.hidden = false;
    el.rulesToggle.setAttribute('aria-expanded', 'false');
  }

  function closeAllPanels() {
    closeStats();
    closeRules();
  }

  // ---- ベットゾーンの不足通知 ---------------------------------------------------
  let flashTimer = null;
  function flashInsufficient() {
    setDealerCall('残高が足りません。チップを下げるか、統計からリセットしてください。');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      renderDealerDefault();
    }, 1800);
  }

  // ---- チップトレイ構築 ---------------------------------------------------------
  function buildChipTray() {
    B.constants.CHIP_VALUES.forEach(function (value) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.dataset.value = String(value);
      btn.textContent = chipLabel(value);
      btn.setAttribute('aria-label', value.toLocaleString('ja-JP') + '円チップ');
      btn.addEventListener('click', function () {
        state.selectedChip = value;
        renderChips();
      });
      el.chipTray.appendChild(btn);
    });
  }

  // ---- イベント結線 -------------------------------------------------------------
  function bindZone(zone) {
    const node = el.zones[zone];

    function activate() {
      if (B.getPhase(state) === 'result') clearTable();
      const ok = B.placeBet(state, zone);
      if (!ok) {
        flashInsufficient();
        return;
      }
      renderAll();
    }

    node.addEventListener('click', activate);
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  }

  function bindEvents() {
    Object.keys(el.zones).forEach(bindZone);

    el.btnClear.addEventListener('click', function () {
      B.clearBets(state);
      renderAll();
    });

    el.btnUndo.addEventListener('click', function () {
      B.undoLastBet(state);
      renderAll();
    });

    el.btnDeal.addEventListener('click', function () {
      const r = B.startRound(state);
      if (!r.ok) return;
      renderAll();
      if (r.reshuffled) {
        setDealerCall('新しいシューを用意しました。カードを配ります…');
        setTimeout(function () { revealSteps(state.pendingResult); }, 900);
      } else {
        revealSteps(state.pendingResult);
      }
    });

    el.statsToggle.addEventListener('click', function () {
      if (el.statsPanel.hidden) openStats(); else closeStats();
    });
    el.rulesToggle.addEventListener('click', function () {
      if (el.rulesPanel.hidden) openRules(); else closeRules();
    });
    el.scrim.addEventListener('click', closeAllPanels);
  }

  // ---- 初期化 ------------------------------------------------------------------
  function init() {
    B.loadState(state);
    if (state.shoe.length < B.constants.RESHUFFLE_THRESHOLD) {
      B.reshoeNewShoe(state);
    }
    buildChipTray();
    bindEvents();
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
