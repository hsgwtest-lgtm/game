'use strict';

/* =========================================================================
 * バカラ（プント・バンコ）練習アプリ — ゲームロジック
 *
 * 設計方針:
 *   - state は「観測可能なデータ構造」であり、boolean フラグで局面を
 *     表現しない。局面（フェーズ）は state の中身から導出する。
 *       - pendingResult が非nullなら「カード公開アニメーション中」
 *       - roundResult   が非nullなら「結果表示中」
 *       - どちらもnullでベット額>0なら「ディール可能」
 *       - どちらもnullでベット額=0なら「ベット受付中」
 *   - playRound() はシューからカードを引きながら、結果と
 *     「公開ステップ(steps)」を一括計算する純粋寄りの関数。
 *     UI側はsteps配列を順番に再生するだけでよい。
 * ========================================================================= */

(function () {

  // ---- 定数 -------------------------------------------------------------
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const NUM_DECKS = 8;                 // 実カジノ同様、8デッキシュー
  const RESHUFFLE_THRESHOLD = 16;      // 残り枚数がこれを切ったら新シュー
  const CHIP_VALUES = [100, 500, 1000, 5000, 10000];
  const INITIAL_BANKROLL = 100000;
  const COMMISSION_RATE = 0.05;        // バンカー側 5% コミッション
  const TIE_PAYOUT = 8;                // タイは 8:1
  const STORAGE_KEY = 'baccaratPracticeState_v1';

  // ---- カード -------------------------------------------------------------
  function cardPoint(rank) {
    if (rank === 'A') return 1;
    if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;
    return Number(rank);
  }

  function buildDeck() {
    const deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank: rank, suit: suit, point: cardPoint(rank) });
      }
    }
    return deck;
  }

  function shuffle(cards) {
    const result = cards.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }

  // 新しいシューを作る。実カジノに合わせて先頭1枚をバーンし、
  // その数値（10/J/Q/Kは10とみなす）と同じ枚数を追加でバーンする。
  function createShoe(numDecks) {
    let cards = [];
    for (let d = 0; d < (numDecks || NUM_DECKS); d++) {
      cards = cards.concat(buildDeck());
    }
    cards = shuffle(cards);

    const burnCard = cards.shift();
    const burnCount = burnCard.point === 0 ? 10 : burnCard.point;
    const burned = cards.splice(0, burnCount);

    return { cards: cards, total: cards.length, burnCard: burnCard, burnedCount: burned.length + 1 };
  }

  function drawCard(shoe) {
    return shoe.shift();
  }

  function handTotal(cards) {
    let sum = 0;
    for (const c of cards) sum += c.point;
    return sum % 10;
  }

  // バンカーが3枚目を引くかどうか（プントバンコ標準ルール）
  function bankerShouldDraw(bankerTotal, playerThirdPoint) {
    if (playerThirdPoint === null) {
      // プレイヤーがスタンド（6・7）の場合、バンカーも0〜5で引く
      return bankerTotal <= 5;
    }
    switch (bankerTotal) {
      case 0: case 1: case 2: return true;
      case 3: return playerThirdPoint !== 8;
      case 4: return playerThirdPoint >= 2 && playerThirdPoint <= 7;
      case 5: return playerThirdPoint >= 4 && playerThirdPoint <= 7;
      case 6: return playerThirdPoint === 6 || playerThirdPoint === 7;
      default: return false; // 7はスタンド
    }
  }

  function bankerRuleMessage(bankerTotal, playerThirdPoint, drew) {
    const action = drew ? '3枚目を引きます' : 'スタンドします';
    if (playerThirdPoint === null) {
      return 'バンカー: 合計' + bankerTotal + '（プレイヤーはスタンド） → ' + action;
    }
    return 'バンカー: 合計' + bankerTotal + '、プレイヤーの3枚目は' + playerThirdPoint + ' → ' + action;
  }

  function resultMessage(winner, playerTotal, bankerTotal) {
    if (winner === 'tie') return 'タイ！ ' + playerTotal + ' - ' + bankerTotal;
    const side = winner === 'player' ? 'プレイヤー' : 'バンカー';
    return side + 'の勝ち！ ' + playerTotal + ' - ' + bankerTotal;
  }

  // 1ラウンドを最後まで計算し、結果と「公開ステップ」を返す。
  // steps: ui.js が順番に再生するための配列。各要素は
  //   { playerCard?, bankerCard?, message? } の組み合わせ。
  function playRound(shoe) {
    const playerCards = [];
    const bankerCards = [];
    const steps = [];

    const p1 = drawCard(shoe); playerCards.push(p1);
    steps.push({ playerCard: p1 });

    const b1 = drawCard(shoe); bankerCards.push(b1);
    steps.push({ bankerCard: b1 });

    const p2 = drawCard(shoe); playerCards.push(p2);
    steps.push({ playerCard: p2 });

    const b2 = drawCard(shoe); bankerCards.push(b2);
    const initialPlayerTotal = handTotal(playerCards);
    const initialBankerTotal = handTotal(bankerCards);
    steps.push({
      bankerCard: b2,
      message: '初期2枚: プレイヤー ' + initialPlayerTotal + ' / バンカー ' + initialBankerTotal
    });

    const playerNatural = initialPlayerTotal >= 8;
    const bankerNatural = initialBankerTotal >= 8;
    let playerThirdPoint = null;

    if (playerNatural || bankerNatural) {
      const naturalVal = Math.max(initialPlayerTotal, initialBankerTotal);
      let naturalSide;
      if (playerNatural && bankerNatural) naturalSide = '両者';
      else if (playerNatural) naturalSide = 'プレイヤー';
      else naturalSide = 'バンカー';
      steps.push({ message: naturalSide + 'にナチュラル' + naturalVal + ' — 追加カードはありません' });
    } else {
      if (initialPlayerTotal <= 5) {
        const p3 = drawCard(shoe);
        playerCards.push(p3);
        playerThirdPoint = p3.point;
        steps.push({
          playerCard: p3,
          message: 'プレイヤー: 合計' + initialPlayerTotal + ' → 3枚目を引きます'
        });
      } else {
        steps.push({ message: 'プレイヤー: 合計' + initialPlayerTotal + ' → スタンドします' });
      }

      const bankerTotalNow = handTotal(bankerCards);
      if (bankerShouldDraw(bankerTotalNow, playerThirdPoint)) {
        const b3 = drawCard(shoe);
        bankerCards.push(b3);
        steps.push({
          bankerCard: b3,
          message: bankerRuleMessage(bankerTotalNow, playerThirdPoint, true)
        });
      } else {
        steps.push({ message: bankerRuleMessage(bankerTotalNow, playerThirdPoint, false) });
      }
    }

    const playerTotal = handTotal(playerCards);
    const bankerTotal = handTotal(bankerCards);
    let winner;
    if (playerTotal > bankerTotal) winner = 'player';
    else if (bankerTotal > playerTotal) winner = 'banker';
    else winner = 'tie';

    steps.push({ message: resultMessage(winner, playerTotal, bankerTotal) });

    return {
      playerCards: playerCards,
      bankerCards: bankerCards,
      playerTotal: playerTotal,
      bankerTotal: bankerTotal,
      winner: winner,
      playerNatural: playerNatural,
      bankerNatural: bankerNatural,
      steps: steps
    };
  }

  // ベット額の合計
  function totalBet(bets) {
    return bets.player + bets.banker + bets.tie;
  }

  // 賭けの精算。payout には「戻ってくる総額」（勝った場合は元金+配当、
  // タイでのプッシュは元金のみ）を入れる。負けた賭けは0。
  function settleBets(bets, winner) {
    let payout = 0;
    let commission = 0;
    if (winner === 'player') {
      payout += bets.player * 2;
    } else if (winner === 'banker') {
      commission = Math.round(bets.banker * COMMISSION_RATE);
      payout += bets.banker * 2 - commission;
    } else {
      payout += bets.tie * (TIE_PAYOUT + 1);
      payout += bets.player; // プッシュ（返却）
      payout += bets.banker; // プッシュ（返却）
    }
    return { payout: payout, commission: commission };
  }

  // ---- 状態 ---------------------------------------------------------------
  const state = {
    bankroll: INITIAL_BANKROLL,
    shoe: [],
    shoeTotal: 0,
    bets: { player: 0, banker: 0, tie: 0 },
    betLog: [],          // [{zone, amount}, ...] 直前のベット操作履歴（取り消し用）
    selectedChip: CHIP_VALUES[0],
    pendingResult: null, // playRound() の結果。公開アニメーション中はここに入る
    roundResult: null,   // 確定済みの結果（払い出し済み、表示用）
    history: [],         // [{winner, playerTotal, bankerTotal}, ...] ロード表示用
    stats: {
      rounds: 0,
      playerWins: 0,
      bankerWins: 0,
      ties: 0,
      totalCommission: 0,
      netProfit: 0,
      maxBankroll: INITIAL_BANKROLL,
      minBankroll: INITIAL_BANKROLL
    }
  };

  // 現在のフェーズを state から導出する（フラグを持たない）
  function getPhase(s) {
    if (s.pendingResult) return 'dealing';
    if (s.roundResult) return 'result';
    return totalBet(s.bets) > 0 ? 'ready' : 'betting';
  }

  function reshoeNewShoe(s) {
    const shoe = createShoe(NUM_DECKS);
    s.shoe = shoe.cards;
    s.shoeTotal = shoe.total;
    return shoe;
  }

  // ベットを置く。結果表示後であれば、まずテーブルをリセットしてから置く。
  function placeBet(s, zone) {
    if (getPhase(s) === 'result') {
      s.roundResult = null;
    }
    const phase = getPhase(s);
    if (phase !== 'betting' && phase !== 'ready') return false;

    const chip = s.selectedChip;
    if (s.bankroll < chip) return false;

    s.bets[zone] += chip;
    s.bankroll -= chip;
    s.betLog.push({ zone: zone, amount: chip });
    return true;
  }

  function undoLastBet(s) {
    const phase = getPhase(s);
    if (phase !== 'betting' && phase !== 'ready') return false;
    const last = s.betLog.pop();
    if (!last) return false;
    s.bets[last.zone] -= last.amount;
    s.bankroll += last.amount;
    return true;
  }

  function clearBets(s) {
    const phase = getPhase(s);
    if (phase !== 'betting' && phase !== 'ready') return false;
    s.bankroll += totalBet(s.bets);
    s.bets = { player: 0, banker: 0, tie: 0 };
    s.betLog = [];
    return true;
  }

  // ラウンド開始: シューが少なければ新シューを用意し、結果を計算して
  // pendingResult にセットする。実際のカード公開はUI側のアニメーションに委ねる。
  function startRound(s) {
    if (getPhase(s) !== 'ready') return { ok: false, reshuffled: false };

    let reshuffled = false;
    if (s.shoe.length < RESHUFFLE_THRESHOLD) {
      reshoeNewShoe(s);
      reshuffled = true;
    }

    s.pendingResult = playRound(s.shoe);
    return { ok: true, reshuffled: reshuffled };
  }

  // アニメーション完了後に呼ぶ: 払い出し・統計・ロード履歴・保存を行う。
  function finalizeRound(s) {
    const result = s.pendingResult;
    if (!result) return null;

    const settled = settleBets(s.bets, result.winner);
    s.bankroll += settled.payout;

    s.stats.rounds += 1;
    if (result.winner === 'player') s.stats.playerWins += 1;
    else if (result.winner === 'banker') s.stats.bankerWins += 1;
    else s.stats.ties += 1;
    s.stats.totalCommission += settled.commission;
    s.stats.netProfit = s.bankroll - INITIAL_BANKROLL;
    s.stats.maxBankroll = Math.max(s.stats.maxBankroll, s.bankroll);
    s.stats.minBankroll = Math.min(s.stats.minBankroll, s.bankroll);

    s.history.push({
      winner: result.winner,
      playerTotal: result.playerTotal,
      bankerTotal: result.bankerTotal
    });
    if (s.history.length > 96) s.history = s.history.slice(-96);

    const finished = Object.assign({}, result, {
      payout: settled.payout,
      commission: settled.commission,
      bets: Object.assign({}, s.bets)
    });

    s.roundResult = finished;
    s.pendingResult = null;
    s.bets = { player: 0, banker: 0, tie: 0 };
    s.betLog = [];

    saveState(s);
    return finished;
  }

  function resetBankroll(s) {
    s.bankroll = INITIAL_BANKROLL;
    s.bets = { player: 0, banker: 0, tie: 0 };
    s.betLog = [];
    s.history = [];
    s.stats = {
      rounds: 0,
      playerWins: 0,
      bankerWins: 0,
      ties: 0,
      totalCommission: 0,
      netProfit: 0,
      maxBankroll: INITIAL_BANKROLL,
      minBankroll: INITIAL_BANKROLL
    };
    saveState(s);
  }

  // ---- 保存・読込（localStorage。失敗しても無視して続行） -------------------
  function saveState(s) {
    try {
      const data = {
        bankroll: s.bankroll,
        stats: s.stats,
        history: s.history
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      // iOS Safariのプライベートブラウズ等で失敗する場合は無視する
    }
  }

  function loadState(s) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.bankroll === 'number') s.bankroll = data.bankroll;
      if (data.stats) s.stats = Object.assign({}, s.stats, data.stats);
      if (Array.isArray(data.history)) s.history = data.history;
    } catch (e) {
      // 読み込み失敗時は初期状態のまま続行する
    }
  }

  // ---- 公開API -------------------------------------------------------------
  window.Baccarat = {
    constants: {
      SUITS: SUITS,
      RANKS: RANKS,
      CHIP_VALUES: CHIP_VALUES,
      INITIAL_BANKROLL: INITIAL_BANKROLL,
      COMMISSION_RATE: COMMISSION_RATE,
      TIE_PAYOUT: TIE_PAYOUT,
      RESHUFFLE_THRESHOLD: RESHUFFLE_THRESHOLD
    },
    state: state,
    handTotal: handTotal,
    totalBet: totalBet,
    getPhase: getPhase,
    reshoeNewShoe: reshoeNewShoe,
    placeBet: placeBet,
    undoLastBet: undoLastBet,
    clearBets: clearBets,
    startRound: startRound,
    finalizeRound: finalizeRound,
    resetBankroll: resetBankroll,
    saveState: saveState,
    loadState: loadState
  };

})();
