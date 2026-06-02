import { Chips } from '../../js/chips.js';
import { createDeck, drawCard } from '../../js/card.js';
import { createAudioContext, resumeAudio, chipPlace, cardFlip, win, lose } from '../../js/audio.js';
import { setupCanvas, delay, formatChips, animate } from '../../js/utils.js';

const STATES = {
  BETTING: 'BETTING',
  DEALING: 'DEALING',
  PLAYER_TURN: 'PLAYER_TURN',
  DEALER_TURN: 'DEALER_TURN',
  RESULT: 'RESULT'
};

const BET_OPTIONS = [100, 500, 1000, 5000];

const elements = {
  canvas: document.getElementById('tableCanvas'),
  balance: document.getElementById('balance'),
  dealerScore: document.getElementById('dealerScore'),
  playerScore: document.getElementById('playerScore'),
  statusText: document.getElementById('statusText'),
  betDisplay: document.getElementById('betDisplay'),
  dealBtn: document.getElementById('dealBtn'),
  hitBtn: document.getElementById('hitBtn'),
  standBtn: document.getElementById('standBtn'),
  doubleBtn: document.getElementById('doubleBtn'),
  splitBtn: document.getElementById('splitBtn'),
  surrenderBtn: document.getElementById('surrenderBtn'),
  insurancePanel: document.getElementById('insurancePanel'),
  insuranceBtn: document.getElementById('insuranceBtn'),
  skipInsuranceBtn: document.getElementById('skipInsuranceBtn'),
  betButtons: [...document.querySelectorAll('[data-bet]')]
};

const state = {
  shoe: createDeck(6),
  gameState: STATES.BETTING,
  selectedBet: BET_OPTIONS[0],
  hands: [],
  dealer: { cards: [] },
  activeHandIndex: 0,
  revealDealer: false,
  insuranceOffered: false,
  insuranceBet: 0,
  message: 'Place your bet to begin.',
  messageTone: 'neutral',
  dealing: false,
  dealAnimation: null,
  roundOpeningBalance: Chips.balance,
  outcomeLines: [],
  lastReshuffle: false,
  canvasState: null
};

function createHand(cards = [], bet = state.selectedBet, isSplitHand = false) {
  return {
    cards: [...cards],
    bet,
    stood: false,
    busted: false,
    surrendered: false,
    doubled: false,
    blackjack: false,
    isSplitHand,
    resultText: ''
  };
}

function unlockAudio() {
  createAudioContext();
  resumeAudio();
}

function getCardValue(rank) {
  if (rank === 'A') return 11;
  if (['K', 'Q', 'J', '10'].includes(rank)) return 10;
  return Number(rank);
}

function scoreCards(cards) {
  let total = 0;
  let aces = 0;

  cards.forEach((card) => {
    total += getCardValue(card.rank);
    if (card.rank === 'A') aces += 1;
  });

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return {
    total,
    soft: aces > 0
  };
}

function isNaturalBlackjack(hand) {
  return !hand.isSplitHand && hand.cards.length === 2 && scoreCards(hand.cards).total === 21;
}

function dealerHasBlackjack() {
  return state.dealer.cards.length === 2 && scoreCards(state.dealer.cards).total === 21;
}

function currentHand() {
  return state.hands[state.activeHandIndex] || null;
}

function formatScore(score) {
  if (!score) return '—';
  return score.soft && score.total <= 21 ? `${score.total} (soft)` : `${score.total}`;
}

function dealerScoreLabel() {
  if (!state.dealer.cards.length) return '—';
  if (!state.revealDealer) {
    return `${scoreCards([state.dealer.cards[0]]).total}+`;
  }
  return formatScore(scoreCards(state.dealer.cards));
}

function playerScoreLabel() {
  if (!state.hands.length) return '—';
  return state.hands.map((hand, index) => {
    const score = scoreCards(hand.cards);
    const prefix = state.hands.length > 1 ? `H${index + 1}: ` : '';
    if (hand.surrendered) return `${prefix}Surrendered`;
    if (hand.busted) return `${prefix}${score.total} Bust`;
    return `${prefix}${formatScore(score)}`;
  }).join(' • ');
}

function setMessage(message, tone = 'neutral') {
  state.message = message;
  state.messageTone = tone;
  elements.statusText.textContent = message;
}

function updateBalance() {
  elements.balance.textContent = formatChips(Chips.balance);
}

function updateHud() {
  elements.dealerScore.textContent = dealerScoreLabel();
  elements.playerScore.textContent = playerScoreLabel();
  elements.betDisplay.textContent = formatChips(state.selectedBet);
  elements.statusText.textContent = state.message;
}

function canChangeBet() {
  return state.gameState === STATES.BETTING || state.gameState === STATES.RESULT;
}

function canHit(hand = currentHand()) {
  return state.gameState === STATES.PLAYER_TURN
    && !state.dealing
    && !state.insuranceOffered
    && !!hand
    && !hand.stood
    && !hand.busted
    && !hand.surrendered
    && scoreCards(hand.cards).total < 21;
}

function canStand(hand = currentHand()) {
  return state.gameState === STATES.PLAYER_TURN
    && !state.dealing
    && !state.insuranceOffered
    && !!hand
    && !hand.stood
    && !hand.busted
    && !hand.surrendered;
}

function canDouble(hand = currentHand()) {
  return canStand(hand)
    && hand.cards.length === 2
    && scoreCards(hand.cards).total < 21
    && Chips.balance >= hand.bet;
}

function canSplit(hand = currentHand()) {
  return canStand(hand)
    && state.hands.length === 1
    && hand.cards.length === 2
    && hand.cards[0].rank === hand.cards[1].rank
    && Chips.balance >= hand.bet;
}

function canSurrender(hand = currentHand()) {
  return canStand(hand)
    && state.hands.length === 1
    && hand.cards.length === 2
    && scoreCards(hand.cards).total < 21;
}

function updateControls() {
  const dealEnabled = !state.dealing && !state.insuranceOffered
    && (state.gameState === STATES.BETTING || state.gameState === STATES.RESULT)
    && Chips.balance >= state.selectedBet;

  elements.dealBtn.disabled = !dealEnabled;
  elements.dealBtn.textContent = state.gameState === STATES.RESULT ? 'NEXT HAND' : 'DEAL';

  elements.betButtons.forEach((button) => {
    const bet = Number(button.dataset.bet);
    button.classList.toggle('active', bet === state.selectedBet);
    button.disabled = !canChangeBet() || Chips.balance < bet;
  });

  const actionStates = [
    [elements.hitBtn, canHit()],
    [elements.standBtn, canStand()],
    [elements.doubleBtn, canDouble()],
    [elements.splitBtn, canSplit()],
    [elements.surrenderBtn, canSurrender()]
  ];

  actionStates.forEach(([button, enabled]) => {
    button.disabled = !enabled;
    button.classList.toggle('is-available', enabled);
  });

  elements.insurancePanel.classList.toggle('hidden', !state.insuranceOffered);
  elements.insuranceBtn.disabled = !state.insuranceOffered || Chips.balance < state.selectedBet / 2 || state.dealing;
  elements.skipInsuranceBtn.disabled = !state.insuranceOffered || state.dealing;
}

function ensureShoe() {
  if (state.shoe.length < 52) {
    state.shoe = createDeck(6);
    state.lastReshuffle = true;
  } else {
    state.lastReshuffle = false;
  }
}

function drawFromShoe() {
  if (!state.shoe.length) {
    state.shoe = createDeck(6);
  }
  return state.shoe.pop();
}

function getCanvasMetrics() {
  if (!state.canvasState) return null;
  const { width, height } = state.canvasState;
  const cardW = Math.max(56, Math.min(84, width * 0.14));
  const cardH = cardW * 1.42;
  const cardGap = cardW * 0.36;
  const dealerY = height * 0.13;
  const playerY = height * 0.58;
  const handCenters = state.hands.length > 1 ? [width * 0.3, width * 0.7] : [width * 0.5];

  return { width, height, cardW, cardH, cardGap, dealerY, playerY, handCenters };
}

function getHandPositions(count, centerX, topY, metrics) {
  const spread = metrics.cardGap;
  const totalWidth = metrics.cardW + Math.max(0, count - 1) * spread;
  const startX = centerX - totalWidth / 2;

  return Array.from({ length: count }, (_, index) => ({
    x: startX + index * spread,
    y: topY
  }));
}

function getDestinationForDeal(target) {
  const metrics = getCanvasMetrics();
  if (!metrics) return { x: 0, y: 0 };

  if (target === 'dealer') {
    const positions = getHandPositions(state.dealer.cards.length + 1, metrics.width / 2, metrics.dealerY, metrics);
    return positions[positions.length - 1];
  }

  const hand = state.hands[target.handIndex];
  const centerX = metrics.handCenters[target.handIndex] || metrics.width / 2;
  const positions = getHandPositions(hand.cards.length + 1, centerX, metrics.playerY, metrics);
  return positions[positions.length - 1];
}

async function animateDeal(card, faceUp, destination) {
  const metrics = getCanvasMetrics();
  if (!metrics) return;

  const start = {
    x: metrics.width + metrics.cardW,
    y: -metrics.cardH * 0.8
  };

  state.dealAnimation = { card, faceUp, x: start.x, y: start.y };
  render();

  await animate(280, (t) => {
    const eased = 1 - Math.pow(1 - t, 3);
    state.dealAnimation = {
      card,
      faceUp,
      x: start.x + (destination.x - start.x) * eased,
      y: start.y + (destination.y - start.y) * eased
    };
    render();
  });

  state.dealAnimation = null;
}

async function dealCardTo(target, faceUp = true) {
  const card = drawFromShoe();
  const destination = getDestinationForDeal(target);
  cardFlip();
  await animateDeal(card, faceUp, destination);

  if (target === 'dealer') {
    state.dealer.cards.push(card);
  } else {
    state.hands[target.handIndex].cards.push(card);
  }

  updateDerivedState();
  render();
  await delay(100);
  return card;
}

function updateDerivedState() {
  state.hands.forEach((hand) => {
    const score = scoreCards(hand.cards);
    hand.blackjack = isNaturalBlackjack(hand);
    hand.busted = !hand.surrendered && score.total > 21;
  });
  updateBalance();
  updateHud();
  updateControls();
}

async function startRound() {
  if (state.dealing || Chips.balance < state.selectedBet) {
    if (Chips.balance < state.selectedBet) {
      setMessage('Not enough chips for that wager.', 'lose');
      updateHud();
      updateControls();
    }
    return;
  }

  unlockAudio();
  ensureShoe();
  state.dealing = true;
  state.gameState = STATES.DEALING;
  state.revealDealer = false;
  state.insuranceOffered = false;
  state.insuranceBet = 0;
  state.outcomeLines = [];
  state.activeHandIndex = 0;
  state.dealer = { cards: [] };
  state.hands = [createHand([], state.selectedBet, false)];
  state.roundOpeningBalance = Chips.balance;

  Chips.subtract(state.selectedBet);
  chipPlace();
  setMessage(state.lastReshuffle ? 'Fresh shoe in play. Dealing...' : 'Dealing the opening hand...');
  updateDerivedState();
  render();

  await dealCardTo({ handIndex: 0 }, true);
  await dealCardTo('dealer', true);
  await dealCardTo({ handIndex: 0 }, true);
  await dealCardTo('dealer', false);

  state.gameState = STATES.PLAYER_TURN;
  const playerBlackjack = state.hands[0].blackjack;
  const dealerBlackjack = dealerHasBlackjack();

  if (state.dealer.cards[0]?.rank === 'A') {
    state.insuranceOffered = true;
    setMessage(playerBlackjack
      ? 'Dealer shows an Ace. Insurance or skip, then natural blackjack resolves.'
      : 'Dealer shows an Ace. Insurance is available.');
  } else if (dealerBlackjack || playerBlackjack) {
    state.revealDealer = true;
    await delay(280);
    await resolveRound();
  } else {
    setMessage('Your move: hit, stand, double down, split, or surrender.');
  }

  state.dealing = false;
  updateDerivedState();
  render();
}

async function handleInsuranceDecision(takeInsurance) {
  if (!state.insuranceOffered || state.dealing) return;

  unlockAudio();
  state.dealing = true;

  if (takeInsurance) {
    const insuranceCost = state.selectedBet / 2;
    if (Chips.balance < insuranceCost) {
      setMessage('Not enough chips for insurance.', 'lose');
      state.dealing = false;
      updateDerivedState();
      return;
    }

    state.insuranceBet = insuranceCost;
    Chips.subtract(insuranceCost);
    chipPlace();
  }

  state.insuranceOffered = false;
  state.revealDealer = true;
  setMessage('Dealer checks the hole card...');
  updateDerivedState();
  render();
  await delay(350);

  const playerBlackjack = state.hands[0].blackjack;
  const dealerBlackjack = dealerHasBlackjack();

  if (dealerBlackjack || playerBlackjack) {
    await resolveRound();
  } else {
    state.revealDealer = false;
    setMessage(takeInsurance
      ? 'Insurance placed. Continue your hand.'
      : 'Insurance declined. Continue your hand.');
  }

  state.dealing = false;
  updateDerivedState();
  render();
}

async function moveToNextHandOrDealer() {
  const nextIndex = state.hands.findIndex((hand, index) => index > state.activeHandIndex && !hand.stood && !hand.busted && !hand.surrendered);

  if (nextIndex !== -1) {
    state.activeHandIndex = nextIndex;
    setMessage(`Playing hand ${nextIndex + 1}.`);
    updateDerivedState();
    render();
    return;
  }

  const allDeadHands = state.hands.every((hand) => hand.busted || hand.surrendered);
  if (allDeadHands) {
    await resolveRound();
    return;
  }

  await dealerTurn();
}

async function hitCurrentHand() {
  const hand = currentHand();
  if (!canHit(hand)) return;

  unlockAudio();
  state.dealing = true;
  await dealCardTo({ handIndex: state.activeHandIndex }, true);

  const score = scoreCards(hand.cards);
  if (score.total >= 21) {
    hand.stood = score.total === 21;
    state.dealing = false;
    updateDerivedState();
    await moveToNextHandOrDealer();
    return;
  }

  setMessage(`Hand ${state.activeHandIndex + 1}: ${score.total}. Hit or stand.`);
  state.dealing = false;
  updateDerivedState();
  render();
}

async function standCurrentHand() {
  const hand = currentHand();
  if (!canStand(hand)) return;

  hand.stood = true;
  setMessage(state.hands.length > 1
    ? `Hand ${state.activeHandIndex + 1} stands on ${scoreCards(hand.cards).total}.`
    : `Standing on ${scoreCards(hand.cards).total}.`);
  updateDerivedState();
  await moveToNextHandOrDealer();
}

async function doubleCurrentHand() {
  const hand = currentHand();
  if (!canDouble(hand)) return;

  unlockAudio();
  state.dealing = true;
  Chips.subtract(hand.bet);
  chipPlace();
  hand.bet *= 2;
  hand.doubled = true;
  updateDerivedState();
  await dealCardTo({ handIndex: state.activeHandIndex }, true);
  hand.stood = true;
  state.dealing = false;
  updateDerivedState();
  await moveToNextHandOrDealer();
}

async function splitCurrentHand() {
  const hand = currentHand();
  if (!canSplit(hand)) return;

  unlockAudio();
  state.dealing = true;
  Chips.subtract(hand.bet);
  chipPlace();

  const [firstCard, secondCard] = hand.cards;
  state.hands = [
    createHand([firstCard], hand.bet, true),
    createHand([secondCard], hand.bet, true)
  ];
  state.activeHandIndex = 0;
  setMessage('Split accepted. One card is dealt to each hand.');
  updateDerivedState();
  render();

  await dealCardTo({ handIndex: 0 }, true);
  await dealCardTo({ handIndex: 1 }, true);

  state.hands.forEach((splitHand) => {
    if (scoreCards(splitHand.cards).total === 21) {
      splitHand.stood = true;
    }
  });

  const nextPlayable = state.hands.findIndex((splitHand) => !splitHand.stood && !splitHand.busted && !splitHand.surrendered);
  state.activeHandIndex = nextPlayable === -1 ? 0 : nextPlayable;

  state.dealing = false;
  if (nextPlayable === -1) {
    setMessage('Both split hands are locked in. Dealer to act.');
    updateDerivedState();
    render();
    await dealerTurn();
    return;
  }

  setMessage(state.activeHandIndex === 1 ? 'Hand 2 to act.' : 'Hand 1 to act.');
  updateDerivedState();
  render();
}

function surrenderCurrentHand() {
  const hand = currentHand();
  if (!canSurrender(hand)) return;

  hand.surrendered = true;
  hand.stood = true;
  setMessage('You surrendered. Half the bet will be returned.');
  updateDerivedState();
  dealerTurn();
}

async function dealerTurn() {
  if (state.gameState === STATES.DEALER_TURN || state.gameState === STATES.RESULT) return;

  state.dealing = true;
  state.gameState = STATES.DEALER_TURN;
  state.revealDealer = true;
  setMessage('Dealer plays out the hand...');
  updateDerivedState();
  render();
  await delay(400);

  while (true) {
    const dealerScore = scoreCards(state.dealer.cards);
    const shouldHit = dealerScore.total < 17 || (dealerScore.total === 17 && dealerScore.soft);
    if (!shouldHit) break;
    await dealCardTo('dealer', true);
    await delay(220);
  }

  state.dealing = false;
  await resolveRound();
}

async function resolveRound() {
  state.gameState = STATES.RESULT;
  state.revealDealer = true;

  const dealerScore = scoreCards(state.dealer.cards);
  const dealerBlackjack = dealerHasBlackjack();
  const lines = [];

  if (state.insuranceBet > 0) {
    if (dealerBlackjack) {
      Chips.add(state.insuranceBet * 3);
      lines.push(`Insurance pays 2:1 on ${formatChips(state.insuranceBet)}.`);
    } else {
      lines.push(`Insurance lost ${formatChips(state.insuranceBet)}.`);
    }
  }

  state.hands.forEach((hand, index) => {
    const playerScore = scoreCards(hand.cards);
    const handLabel = state.hands.length > 1 ? `Hand ${index + 1}` : 'Hand';

    if (hand.surrendered) {
      Chips.add(hand.bet / 2);
      hand.resultText = 'Surrender';
      lines.push(`${handLabel} surrendered; ${formatChips(hand.bet / 2)} returned.`);
      return;
    }

    if (hand.blackjack && !dealerBlackjack) {
      Chips.add(hand.bet * 2.5);
      hand.resultText = 'Blackjack';
      lines.push(`${handLabel} blackjack pays 3:2.`);
      return;
    }

    if (dealerBlackjack && hand.blackjack) {
      Chips.add(hand.bet);
      hand.resultText = 'Push';
      lines.push(`${handLabel} pushes against dealer blackjack.`);
      return;
    }

    if (dealerBlackjack) {
      hand.resultText = 'Lose';
      lines.push(`${handLabel} loses to dealer blackjack.`);
      return;
    }

    if (hand.busted) {
      hand.resultText = 'Bust';
      lines.push(`${handLabel} busts with ${playerScore.total}.`);
      return;
    }

    if (dealerScore.total > 21) {
      Chips.add(hand.bet * 2);
      hand.resultText = 'Win';
      lines.push(`${handLabel} wins; dealer busts.`);
      return;
    }

    if (playerScore.total > dealerScore.total) {
      Chips.add(hand.bet * 2);
      hand.resultText = 'Win';
      lines.push(`${handLabel} wins ${playerScore.total} to ${dealerScore.total}.`);
      return;
    }

    if (playerScore.total === dealerScore.total) {
      Chips.add(hand.bet);
      hand.resultText = 'Push';
      lines.push(`${handLabel} pushes on ${playerScore.total}.`);
      return;
    }

    hand.resultText = 'Lose';
    lines.push(`${handLabel} loses ${playerScore.total} to ${dealerScore.total}.`);
  });

  state.outcomeLines = lines;
  const net = Chips.balance - state.roundOpeningBalance;

  if (net > 0) {
    win();
    setMessage(lines.join(' '), 'win');
  } else if (net < 0) {
    lose();
    setMessage(lines.join(' '), 'lose');
  } else {
    setMessage(lines.join(' '), 'neutral');
  }

  updateDerivedState();
  render();
}

function drawFelt(ctx, metrics) {
  const gradient = ctx.createLinearGradient(0, 0, 0, metrics.height);
  gradient.addColorStop(0, '#134126');
  gradient.addColorStop(0.45, '#0d2818');
  gradient.addColorStop(1, '#07150d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, metrics.width, metrics.height);

  ctx.strokeStyle = 'rgba(201, 168, 76, 0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(metrics.width / 2, metrics.height * 0.52, metrics.width * 0.45, metrics.height * 0.4, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(240, 208, 128, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(metrics.width * 0.18, metrics.height * 0.46);
  ctx.quadraticCurveTo(metrics.width / 2, metrics.height * 0.34, metrics.width * 0.82, metrics.height * 0.46);
  ctx.stroke();

  ctx.fillStyle = 'rgba(240, 232, 208, 0.65)';
  ctx.font = `600 ${Math.max(12, metrics.width * 0.022)}px 'Crimson Pro', serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`6-DECK SHOE • ${state.shoe.length} CARDS`, metrics.width / 2, metrics.height * 0.08);
  ctx.fillText('BLACKJACK PAYS 3:2 • DEALER HITS SOFT 17', metrics.width / 2, metrics.height * 0.5);
  ctx.textAlign = 'left';
}

function drawLabel(ctx, text, x, y, align = 'left', color = 'rgba(240, 232, 208, 0.92)', fontSize = 18) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `700 ${fontSize}px 'Playfair Display', serif`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawPill(ctx, text, x, y) {
  ctx.save();
  ctx.font = "600 13px 'Crimson Pro', serif";
  const width = ctx.measureText(text).width + 18;
  const height = 24;
  const radius = 12;
  ctx.fillStyle = 'rgba(10, 10, 15, 0.78)';
  ctx.strokeStyle = 'rgba(201, 168, 76, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f0e8d0';
  ctx.fillText(text, x + 9, y + 16);
  ctx.restore();
}

function drawHandBlock(ctx, label, cards, centerX, topY, options = {}) {
  const metrics = getCanvasMetrics();
  const positions = getHandPositions(cards.length, centerX, topY, metrics);
  const score = scoreCards(cards);
  const width = metrics.cardW + Math.max(0, cards.length - 1) * metrics.cardGap;
  const boxX = centerX - width / 2 - 12;
  const boxY = topY - 18;
  const boxW = width + 24;
  const boxH = metrics.cardH + 54;

  if (options.active) {
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 208, 128, 0.88)';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 18;
    ctx.shadowColor = 'rgba(240, 208, 128, 0.45)';
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.restore();
  }

  drawLabel(ctx, label, boxX, topY - 26, 'left', '#f0d080', 18);

  if (!cards.length) {
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 232, 208, 0.25)';
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(centerX - metrics.cardW / 2, topY, metrics.cardW, metrics.cardH);
    ctx.restore();
  }

  cards.forEach((card, index) => {
    const faceUp = options.hiddenHole ? index !== 1 : true;
    drawCard(ctx, card, positions[index].x, positions[index].y, metrics.cardW, metrics.cardH, faceUp);
  });

  if (options.hiddenHole) {
    drawPill(ctx, `Score ${scoreCards([cards[0]]).total}+`, boxX, topY + metrics.cardH + 10);
  } else if (cards.length) {
    drawPill(ctx, `Score ${formatScore(score)}`, boxX, topY + metrics.cardH + 10);
  }

  if (typeof options.bet === 'number') {
    drawPill(ctx, `Bet ${formatChips(options.bet)}`, boxX + Math.min(132, boxW - 120), topY + metrics.cardH + 10);
  }

  if (options.resultText) {
    drawLabel(ctx, options.resultText.toUpperCase(), centerX, topY + metrics.cardH + 52, 'center', '#f0e8d0', 16);
  }
}

function render() {
  if (!state.canvasState) return;
  const { ctx } = state.canvasState;
  const metrics = getCanvasMetrics();

  ctx.clearRect(0, 0, metrics.width, metrics.height);
  drawFelt(ctx, metrics);

  drawHandBlock(ctx, 'DEALER', state.dealer.cards, metrics.width / 2, metrics.dealerY, {
    hiddenHole: !state.revealDealer && state.dealer.cards.length > 1
  });

  if (!state.hands.length) {
    drawHandBlock(ctx, 'PLAYER', [], metrics.width / 2, metrics.playerY);
  } else {
    state.hands.forEach((hand, index) => {
      drawHandBlock(
        ctx,
        state.hands.length > 1 ? `HAND ${index + 1}` : 'PLAYER',
        hand.cards,
        metrics.handCenters[index] || metrics.width / 2,
        metrics.playerY,
        {
          active: state.gameState === STATES.PLAYER_TURN && index === state.activeHandIndex && !state.insuranceOffered,
          bet: hand.bet,
          resultText: state.gameState === STATES.RESULT ? hand.resultText : ''
        }
      );
    });
  }

  if (state.dealAnimation) {
    drawCard(
      ctx,
      state.dealAnimation.card,
      state.dealAnimation.x,
      state.dealAnimation.y,
      metrics.cardW,
      metrics.cardH,
      state.dealAnimation.faceUp
    );
  }

  if (state.gameState === STATES.RESULT && state.outcomeLines.length) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.fillRect(metrics.width * 0.12, metrics.height * 0.44, metrics.width * 0.76, 54);
    ctx.fillStyle = '#f0d080';
    ctx.font = `700 ${Math.max(16, metrics.width * 0.026)}px 'Playfair Display', serif`;
    ctx.textAlign = 'center';
    ctx.fillText('ROUND COMPLETE', metrics.width / 2, metrics.height * 0.49);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}

function resizeCanvas() {
  state.canvasState = setupCanvas(elements.canvas);
  render();
}

function bindEvents() {
  document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  window.addEventListener('resize', resizeCanvas);
  elements.dealBtn.addEventListener('click', startRound);
  elements.hitBtn.addEventListener('click', hitCurrentHand);
  elements.standBtn.addEventListener('click', standCurrentHand);
  elements.doubleBtn.addEventListener('click', doubleCurrentHand);
  elements.splitBtn.addEventListener('click', splitCurrentHand);
  elements.surrenderBtn.addEventListener('click', surrenderCurrentHand);
  elements.insuranceBtn.addEventListener('click', () => handleInsuranceDecision(true));
  elements.skipInsuranceBtn.addEventListener('click', () => handleInsuranceDecision(false));

  elements.betButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const bet = Number(button.dataset.bet);
      if (!canChangeBet() || Chips.balance < bet) return;
      state.selectedBet = bet;
      setMessage(`Main wager set to ${formatChips(bet)}.`);
      chipPlace();
      updateDerivedState();
      render();
    });
  });
}

function init() {
  resizeCanvas();
  bindEvents();
  setMessage('Place your bet to begin.');
  updateDerivedState();
  render();
}

init();
