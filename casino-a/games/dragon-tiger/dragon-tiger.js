import { Chips } from '../../js/chips.js';
import { createDeck, drawCard, shuffle } from '../../js/card.js';
import { createAudioContext, resumeAudio, chipPlace, cardFlip, win, lose } from '../../js/audio.js';
import { setupCanvas, delay, formatChips, animate } from '../../js/utils.js';

const BET_TYPES = ['dragon', 'tiger', 'tie', 'suitedTie'];
const PAYOUTS = {
  dragon: 1,
  tiger: 1,
  tie: 8,
  suitedTie: 50
};
const DEFAULT_MESSAGE = 'Select a chip, tap a betting spot, then deal the hand.';

const state = {
  deck: [],
  selectedChip: 100,
  bets: {
    dragon: 0,
    tiger: 0,
    tie: 0,
    suitedTie: 0
  },
  dragonCard: null,
  tigerCard: null,
  dealing: false,
  revealProgress: 0,
  cardLift: 0,
  cardsRemaining: 0
};

const els = {};
let canvasCtx = null;
let canvasMetrics = null;

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function rankValue(card) {
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return ranks.indexOf(card.rank) + 1;
}

function ensureShoe() {
  if (state.deck.length <= 100) {
    state.deck = createDeck(8);
    shuffle(state.deck);
    setMessage('Fresh 8-deck shoe prepared. Place your wager.', '');
  }
  state.cardsRemaining = state.deck.length;
  updateCardsRemaining();
}

function drawFromShoe() {
  if (state.deck.length <= 100) {
    ensureShoe();
  }
  const card = state.deck.pop();
  state.cardsRemaining = state.deck.length;
  updateCardsRemaining();
  return card;
}

function updateBalance() {
  els.balance.textContent = formatChips(Chips.balance);
}

function updateCardsRemaining() {
  if (els.cardsRemaining) {
    els.cardsRemaining.textContent = `${state.cardsRemaining}`;
  }
}

function updateBetDisplays() {
  BET_TYPES.forEach(type => {
    const display = document.querySelector(`[data-bet-display="${type}"]`);
    const button = document.querySelector(`[data-bet-type="${type}"]`);
    if (!display || !button) return;
    display.textContent = formatChips(state.bets[type]);
    button.classList.toggle('active', state.bets[type] > 0);
    button.disabled = state.dealing;
  });
}

function updateControlState() {
  const totalBet = getTotalBet();
  els.dealBtn.disabled = state.dealing || totalBet <= 0;
  els.clearBetsBtn.disabled = state.dealing || totalBet <= 0;
  document.querySelectorAll('.chip-btn').forEach(button => {
    button.disabled = state.dealing;
    button.classList.toggle('active', Number(button.dataset.chip) === state.selectedChip);
  });
}

function getTotalBet() {
  return Object.values(state.bets).reduce((sum, amount) => sum + amount, 0);
}

function setMessage(text, tone = '') {
  els.resultMessage.textContent = text;
  els.resultMessage.classList.remove('win', 'loss', 'tie-state');
  if (tone) {
    els.resultMessage.classList.add(tone);
  }
}

function setSeatLabels() {
  els.dragonCardLabel.textContent = state.dragonCard ? `${state.dragonCard.rank}${state.dragonCard.suit}` : 'Awaiting deal';
  els.tigerCardLabel.textContent = state.tigerCard ? `${state.tigerCard.rank}${state.tigerCard.suit}` : 'Awaiting deal';
}

function clearPanelHighlights() {
  els.dragonPanel.classList.remove('winner', 'tie');
  els.tigerPanel.classList.remove('winner', 'tie');
}

function applyResultHighlight(outcome) {
  clearPanelHighlights();
  if (outcome === 'dragon') {
    els.dragonPanel.classList.add('winner');
  } else if (outcome === 'tiger') {
    els.tigerPanel.classList.add('winner');
  } else {
    els.dragonPanel.classList.add('tie');
    els.tigerPanel.classList.add('tie');
  }
}

function addBet(type) {
  if (state.dealing) return;
  if (Chips.balance < state.selectedChip) {
    setMessage('Not enough chips for that bet. Choose a smaller chip or clear bets.', 'loss');
    return;
  }

  createAudioContext();
  resumeAudio();
  Chips.subtract(state.selectedChip);
  state.bets[type] += state.selectedChip;
  chipPlace();
  updateBalance();
  updateBetDisplays();
  updateControlState();
  setMessage(`${typeLabel(type)} bet increased by ${formatChips(state.selectedChip)}.`, '');
}

function clearBets() {
  if (state.dealing) return;
  const totalBet = getTotalBet();
  if (totalBet <= 0) return;
  Chips.add(totalBet);
  BET_TYPES.forEach(type => {
    state.bets[type] = 0;
  });
  updateBalance();
  updateBetDisplays();
  updateControlState();
  setMessage('All wagers returned to your rack.', '');
}

function typeLabel(type) {
  return {
    dragon: 'Dragon',
    tiger: 'Tiger',
    tie: 'Tie',
    suitedTie: 'Suited Tie'
  }[type];
}

function evaluateHand() {
  const dragonValue = rankValue(state.dragonCard);
  const tigerValue = rankValue(state.tigerCard);
  if (dragonValue > tigerValue) return 'dragon';
  if (tigerValue > dragonValue) return 'tiger';
  return 'tie';
}

function calculatePayout(result) {
  let returned = 0;
  const wonBets = [];

  if (result === 'dragon' && state.bets.dragon > 0) {
    returned += state.bets.dragon * (PAYOUTS.dragon + 1);
    wonBets.push('Dragon');
  }

  if (result === 'tiger' && state.bets.tiger > 0) {
    returned += state.bets.tiger * (PAYOUTS.tiger + 1);
    wonBets.push('Tiger');
  }

  if (result === 'tie') {
    if (state.bets.tie > 0) {
      returned += state.bets.tie * (PAYOUTS.tie + 1);
      wonBets.push('Tie');
    }
    if (state.bets.dragon > 0) {
      returned += state.bets.dragon * 0.5;
    }
    if (state.bets.tiger > 0) {
      returned += state.bets.tiger * 0.5;
    }
    if (state.bets.suitedTie > 0 && state.dragonCard.suit === state.tigerCard.suit) {
      returned += state.bets.suitedTie * (PAYOUTS.suitedTie + 1);
      wonBets.push('Suited Tie');
    }
  }

  return { returned, wonBets };
}

function settleRound(result) {
  const { returned, wonBets } = calculatePayout(result);
  const totalBet = getTotalBet();
  const net = returned - totalBet;

  if (returned > 0) {
    Chips.add(Math.round(returned));
    win();
  } else {
    lose();
  }

  updateBalance();
  const dragonValue = rankValue(state.dragonCard);
  const tigerValue = rankValue(state.tigerCard);
  const suited = result === 'tie' && state.dragonCard.suit === state.tigerCard.suit;
  const resultText = result === 'tie'
    ? suited
      ? `Suited Tie! ${state.dragonCard.rank}${state.dragonCard.suit} matches ${state.tigerCard.rank}${state.tigerCard.suit}.`
      : `Tie on ${state.dragonCard.rank}. Dragon and Tiger main bets return half.`
    : dragonValue > tigerValue
      ? `Dragon wins with ${state.dragonCard.rank}${state.dragonCard.suit} over ${state.tigerCard.rank}${state.tigerCard.suit}.`
      : `Tiger wins with ${state.tigerCard.rank}${state.tigerCard.suit} over ${state.dragonCard.rank}${state.dragonCard.suit}.`;

  if (net > 0) {
    setMessage(`${resultText} You won ${formatChips(Math.round(net))}${wonBets.length ? ` on ${wonBets.join(', ')}` : ''}.`, result === 'tie' ? 'tie-state' : 'win');
  } else if (net === 0) {
    setMessage(`${resultText} Push overall.`, result === 'tie' ? 'tie-state' : '');
  } else {
    setMessage(`${resultText} Net ${formatChips(Math.abs(Math.round(net)))} lost this round.`, result === 'tie' ? 'tie-state' : 'loss');
  }

  BET_TYPES.forEach(type => {
    state.bets[type] = 0;
  });
  updateBetDisplays();
  updateControlState();
}

function drawTableBackground(ctx, width, height) {
  const leftGrad = ctx.createLinearGradient(0, 0, width / 2, 0);
  leftGrad.addColorStop(0, 'rgba(192, 57, 43, 0.32)');
  leftGrad.addColorStop(1, 'rgba(192, 57, 43, 0.02)');
  ctx.fillStyle = leftGrad;
  ctx.fillRect(0, 0, width / 2, height);

  const rightGrad = ctx.createLinearGradient(width / 2, 0, width, 0);
  rightGrad.addColorStop(0, 'rgba(26, 74, 138, 0.02)');
  rightGrad.addColorStop(1, 'rgba(26, 74, 138, 0.32)');
  ctx.fillStyle = rightGrad;
  ctx.fillRect(width / 2, 0, width / 2, height);

  ctx.strokeStyle = 'rgba(240, 208, 128, 0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2, 20);
  ctx.lineTo(width / 2, height - 20);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(201, 168, 76, 0.18)';
  ctx.strokeRect(14, 14, width - 28, height - 28);
}

function drawSideBadge(ctx, label, amount, x, y, align = 'left') {
  ctx.save();
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
  roundedRectPath(ctx, x - (align === 'left' ? 0 : 150), y - 28, 150, 56, 14);
  ctx.fill();
  ctx.fillStyle = '#f0d080';
  ctx.font = "700 24px 'Playfair Display', serif";
  ctx.fillText(label, x, y - 4);
  ctx.fillStyle = 'rgba(240, 232, 208, 0.9)';
  ctx.font = "600 18px 'Crimson Pro', serif";
  ctx.fillText(amount, x, y + 18);
  ctx.restore();
}

function drawCardWithFlip(ctx, card, centerX, centerY, width, height) {
  if (!card) {
    drawPlaceholder(ctx, centerX, centerY, width, height);
    return;
  }

  const lift = state.cardLift;
  const reveal = state.revealProgress;
  const scaleX = Math.abs(reveal < 0.5 ? 1 - reveal * 2 : (reveal - 0.5) * 2);
  const faceUp = reveal >= 0.5;

  ctx.save();
  ctx.translate(centerX, centerY - lift);
  if (scaleX < 0.04) {
    ctx.restore();
    return;
  }
  ctx.scale(scaleX, 1);
  drawCard(ctx, card, -width / 2, -height / 2, width, height, faceUp);
  if (faceUp) {
    ctx.strokeStyle = 'rgba(240, 208, 128, 0.55)';
    ctx.lineWidth = 4;
    ctx.strokeRect(-width / 2 - 2, -height / 2 - 2, width + 4, height + 4);
  }
  ctx.restore();
}

function drawPlaceholder(ctx, centerX, centerY, width, height) {
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.fillStyle = 'rgba(8, 10, 16, 0.42)';
  ctx.strokeStyle = 'rgba(240, 208, 128, 0.18)';
  ctx.lineWidth = 2;
  roundedRectPath(ctx, -width / 2, -height / 2, width, height, 18);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = 'rgba(240, 208, 128, 0.22)';
  ctx.strokeRect(-width / 2 + 16, -height / 2 + 16, width - 32, height - 32);
  ctx.setLineDash([]);
  ctx.restore();
}

function render() {
  if (!canvasCtx || !canvasMetrics) return;
  const { ctx, width, height } = canvasMetrics;
  ctx.clearRect(0, 0, width, height);
  drawTableBackground(ctx, width, height);

  drawSideBadge(ctx, 'DRAGON', formatChips(state.bets.dragon), 34, 60, 'left');
  drawSideBadge(ctx, 'TIGER', formatChips(state.bets.tiger), width - 34, 60, 'right');

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(240, 232, 208, 0.92)';
  ctx.font = "700 28px 'Playfair Display', serif";
  ctx.fillText('Tie', width / 2, 68);
  ctx.font = "600 18px 'Crimson Pro', serif";
  ctx.fillStyle = 'rgba(240, 208, 128, 0.8)';
  ctx.fillText(formatChips(state.bets.tie), width / 2, 94);
  ctx.fillText(`Suited ${formatChips(state.bets.suitedTie)}`, width / 2, 116);
  ctx.restore();

  const cardWidth = Math.min(width * 0.23, 190);
  const cardHeight = cardWidth * 1.4;
  drawCardWithFlip(ctx, state.dragonCard, width * 0.28, height * 0.62, cardWidth, cardHeight);
  drawCardWithFlip(ctx, state.tigerCard, width * 0.72, height * 0.62, cardWidth, cardHeight);
}

async function dealRound() {
  if (state.dealing) return;
  if (getTotalBet() <= 0) {
    setMessage('Place at least one wager before dealing.', 'loss');
    return;
  }

  state.dealing = true;
  updateControlState();
  clearPanelHighlights();
  ensureShoe();
  state.dragonCard = null;
  state.tigerCard = null;
  state.revealProgress = 0;
  state.cardLift = 0;
  setSeatLabels();
  render();
  setMessage('No more bets. Cards are on the way...', '');

  await animate(320, t => {
    state.cardLift = 18 * t;
    render();
  });

  state.dragonCard = drawFromShoe();
  state.tigerCard = drawFromShoe();
  setSeatLabels();
  render();

  await delay(350);
  cardFlip();
  await animate(620, t => {
    state.revealProgress = t;
    state.cardLift = 18 - (18 * t);
    render();
  });

  const result = evaluateHand();
  applyResultHighlight(result);
  settleRound(result);
  state.dealing = false;
  updateControlState();
}

function bindEvents() {
  document.querySelectorAll('[data-bet-type]').forEach(button => {
    button.addEventListener('click', () => addBet(button.dataset.betType));
  });

  document.querySelectorAll('.chip-btn').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedChip = Number(button.dataset.chip);
      createAudioContext();
      resumeAudio();
      chipPlace();
      updateControlState();
      setMessage(`Selected ${formatChips(state.selectedChip)} chip.`, '');
    });
  });

  els.clearBetsBtn.addEventListener('click', clearBets);
  els.dealBtn.addEventListener('click', dealRound);

  const activateAudio = () => {
    createAudioContext();
    resumeAudio();
  };
  document.addEventListener('touchstart', activateAudio, { once: true });
  document.addEventListener('pointerdown', activateAudio, { once: true });

  window.addEventListener('resize', () => {
    canvasMetrics = setupCanvas(els.canvas);
    canvasCtx = canvasMetrics.ctx;
    render();
  });
}

function cacheElements() {
  els.balance = document.getElementById('balance');
  els.canvas = document.getElementById('gameCanvas');
  els.dealBtn = document.getElementById('dealBtn');
  els.clearBetsBtn = document.getElementById('clearBetsBtn');
  els.resultMessage = document.getElementById('resultMessage');
  els.dragonPanel = document.getElementById('dragonPanel');
  els.tigerPanel = document.getElementById('tigerPanel');
  els.dragonCardLabel = document.getElementById('dragonCardLabel');
  els.tigerCardLabel = document.getElementById('tigerCardLabel');
  els.cardsRemaining = document.getElementById('cardsRemaining');
}

function init() {
  cacheElements();
  canvasMetrics = setupCanvas(els.canvas);
  canvasCtx = canvasMetrics.ctx;
  ensureShoe();
  updateBalance();
  updateBetDisplays();
  updateControlState();
  setSeatLabels();
  setMessage(DEFAULT_MESSAGE, '');
  bindEvents();
  render();
}

document.addEventListener('DOMContentLoaded', init);
