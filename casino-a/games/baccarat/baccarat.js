import { Chips } from '../../js/chips.js';
import { createDeck, drawCard, shuffle } from '../../js/card.js';
import { createAudioContext, resumeAudio, chipPlace, cardFlip, win, lose } from '../../js/audio.js';
import { setupCanvas, delay, formatChips, animate } from '../../js/utils.js';

const BET_KEYS = ['player', 'banker', 'tie', 'playerPair', 'bankerPair'];
const BET_LABELS = {
  player: 'Player',
  banker: 'Banker',
  tie: 'Tie',
  playerPair: 'Player Pair',
  bankerPair: 'Banker Pair'
};
const ROAD_MARKERS = { player: 'P', banker: 'B', tie: 'T' };
const state = {
  selectedChip: 100,
  deck: [],
  bets: { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 },
  playerHand: [],
  bankerHand: [],
  playerCards: [],
  bankerCards: [],
  history: [],
  isDealing: false,
  overlayTimer: null,
  lastOutcome: null
};

let ctx;
let canvas;
let balanceEl;
let totalBetEl;
let playerScoreEl;
let bankerScoreEl;
let dealBtn;
let betButtons = [];
let chipButtons = [];
let beadRoadEl;
let overlay;
let messageTitle;
let messageText;

function init() {
  canvas = document.getElementById('gameCanvas');
  balanceEl = document.getElementById('balance');
  totalBetEl = document.getElementById('totalBet');
  playerScoreEl = document.getElementById('playerScore');
  bankerScoreEl = document.getElementById('bankerScore');
  dealBtn = document.getElementById('dealBtn');
  beadRoadEl = document.getElementById('beadRoad');
  overlay = document.getElementById('messageOverlay');
  messageTitle = document.getElementById('messageTitle');
  messageText = document.getElementById('messageText');
  betButtons = Array.from(document.querySelectorAll('.bet-btn'));
  chipButtons = Array.from(document.querySelectorAll('.chip-btn'));

  createAudioContext();
  resetShoe();
  resizeCanvas();
  bindEvents();
  renderAll();
}

function bindEvents() {
  window.addEventListener('resize', () => {
    resizeCanvas();
    drawTable();
  });

  chipButtons.forEach(button => {
    button.addEventListener('click', () => {
      resumeAudio();
      state.selectedChip = Number(button.dataset.value);
      chipButtons.forEach(chip => chip.classList.toggle('active', chip === button));
    });
  });

  betButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (state.isDealing) return;
      resumeAudio();
      placeBet(button.dataset.bet);
    });
  });

  dealBtn.addEventListener('click', async () => {
    resumeAudio();
    await startRound();
  });
}

function resetShoe() {
  state.deck = createDeck(8);
  shuffle(state.deck);
}

function ensureShoe() {
  if (state.deck.length <= 312) {
    resetShoe();
    showMessage('New shoe', 'Eight fresh decks are now in play.', 1500);
  }
}

function resizeCanvas() {
  ctx = setupCanvas(canvas);
}

function renderAll() {
  updateBalance();
  updateBetDisplays();
  updateScores();
  renderRoad();
  updateControls();
  drawTable();
}

function updateBalance() {
  balanceEl.textContent = formatChips(Math.round(Chips.balance));
}

function stagedTotal() {
  return BET_KEYS.reduce((sum, key) => sum + state.bets[key], 0);
}

function updateBetDisplays() {
  BET_KEYS.forEach(key => {
    const el = document.getElementById(`bet-${key}`);
    if (el) el.textContent = formatChips(state.bets[key]);
  });
  totalBetEl.textContent = formatChips(stagedTotal());
}

function updateScores() {
  playerScoreEl.textContent = state.playerHand.length ? handTotal(state.playerHand) : '--';
  bankerScoreEl.textContent = state.bankerHand.length ? handTotal(state.bankerHand) : '--';
}

function updateControls() {
  const canDeal = stagedTotal() > 0 && !state.isDealing;
  dealBtn.disabled = !canDeal;
  betButtons.forEach(button => {
    button.disabled = state.isDealing;
  });
  chipButtons.forEach(button => {
    button.disabled = state.isDealing;
  });
}

function placeBet(type) {
  const projected = stagedTotal() + state.selectedChip;
  if (projected > Chips.balance) {
    showMessage('Insufficient balance', 'Choose a smaller chip or clear your wagers with a deal.', 1800);
    return;
  }

  state.bets[type] += state.selectedChip;
  chipPlace();
  updateBetDisplays();
  updateControls();
}

function clearRoundState() {
  state.playerHand = [];
  state.bankerHand = [];
  state.playerCards = [];
  state.bankerCards = [];
  state.lastOutcome = null;
  updateScores();
  drawTable();
}

async function startRound() {
  if (state.isDealing || stagedTotal() <= 0) {
    if (!state.isDealing && stagedTotal() <= 0) {
      showMessage('No wagers placed', 'Place at least one bet before dealing.', 1600);
    }
    return;
  }

  ensureShoe();
  const wager = stagedTotal();
  if (!Chips.subtract(wager)) {
    showMessage('Balance locked', 'Your bankroll cannot cover that total wager.', 1800);
    return;
  }

  state.isDealing = true;
  hideMessage();
  updateBalance();
  updateControls();
  clearRoundState();

  await dealInitialCards();

  const playerNatural = handTotal(state.playerHand);
  const bankerNatural = handTotal(state.bankerHand);
  const natural = playerNatural >= 8 || bankerNatural >= 8;

  let playerThird = null;
  if (!natural && playerNatural <= 5) {
    playerThird = drawFromShoe();
    await dealAnimatedCard('player', playerThird);
  }

  const bankerShouldDraw = shouldBankerDraw(handTotal(state.bankerHand), playerThird ? baccaratValue(playerThird) : null, Boolean(playerThird));
  if (!natural && bankerShouldDraw) {
    const bankerThird = drawFromShoe();
    await dealAnimatedCard('banker', bankerThird);
  }

  const outcome = decideWinner();
  const pairs = {
    playerPair: isPair(state.playerHand),
    bankerPair: isPair(state.bankerHand)
  };
  settleBets(outcome, pairs, wager);

  state.history.push(outcome);
  renderRoad();
  state.bets = { player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 };
  updateBetDisplays();
  updateControls();
  state.isDealing = false;
  updateControls();
}

async function dealInitialCards() {
  await dealAnimatedCard('player', drawFromShoe());
  await delay(90);
  await dealAnimatedCard('banker', drawFromShoe());
  await delay(90);
  await dealAnimatedCard('player', drawFromShoe());
  await delay(90);
  await dealAnimatedCard('banker', drawFromShoe());
}

function drawFromShoe() {
  const card = state.deck.pop();
  if (!card) {
    resetShoe();
    return state.deck.pop();
  }
  return card;
}

async function dealAnimatedCard(side, card) {
  const rect = canvas.getBoundingClientRect();
  const layout = getLayout(rect.width, rect.height);
  const targetIndex = side === 'player' ? state.playerHand.length : state.bankerHand.length;
  const targetX = (side === 'player' ? layout.playerX : layout.bankerX) + targetIndex * layout.spacing;
  const displayCard = {
    card,
    x: rect.width / 2 - layout.cardW / 2,
    y: layout.cardY,
    targetX,
    w: layout.cardW,
    h: layout.cardH
  };

  if (side === 'player') {
    state.playerHand.push(card);
    state.playerCards.push(displayCard);
  } else {
    state.bankerHand.push(card);
    state.bankerCards.push(displayCard);
  }

  updateScores();
  await animate(340, progress => {
    const eased = 1 - (1 - progress) * (1 - progress);
    displayCard.x = rect.width / 2 - layout.cardW / 2 + (targetX - (rect.width / 2 - layout.cardW / 2)) * eased;
    drawTable();
  });
  displayCard.x = targetX;
  cardFlip();
  drawTable();
}

function baccaratValue(card) {
  if (!card) return 0;
  if (card.value === 'A') return 1;
  const numeric = Number(card.value);
  if (!Number.isNaN(numeric)) return numeric;
  return 0;
}

function handTotal(hand) {
  return hand.reduce((sum, card) => sum + baccaratValue(card), 0) % 10;
}

function shouldBankerDraw(bankerTotal, playerThirdValue, playerDrew) {
  if (!playerDrew) {
    return bankerTotal <= 5;
  }

  if (bankerTotal <= 2) return true;
  if (bankerTotal === 3) return playerThirdValue !== 8;
  if (bankerTotal === 4) return playerThirdValue >= 2 && playerThirdValue <= 7;
  if (bankerTotal === 5) return playerThirdValue >= 4 && playerThirdValue <= 7;
  if (bankerTotal === 6) return playerThirdValue === 6 || playerThirdValue === 7;
  return false;
}

function decideWinner() {
  const player = handTotal(state.playerHand);
  const banker = handTotal(state.bankerHand);
  if (player > banker) return 'player';
  if (banker > player) return 'banker';
  return 'tie';
}

function isPair(hand) {
  return hand.length >= 2 && hand[0].value === hand[1].value;
}

function settleBets(outcome, pairs, wager) {
  let payout = 0;
  const lines = [];

  if (outcome === 'player' && state.bets.player) {
    const amount = state.bets.player * 2;
    payout += amount;
    lines.push(`Player +${formatChips(amount)}`);
  }

  if (outcome === 'banker' && state.bets.banker) {
    const amount = Math.round(state.bets.banker * 1.95);
    payout += amount;
    lines.push(`Banker +${formatChips(amount)}`);
  }

  if (outcome === 'tie') {
    if (state.bets.tie) {
      const amount = state.bets.tie * 9;
      payout += amount;
      lines.push(`Tie +${formatChips(amount)}`);
    }
    if (state.bets.player) {
      payout += state.bets.player;
      lines.push(`Player push +${formatChips(state.bets.player)}`);
    }
    if (state.bets.banker) {
      payout += state.bets.banker;
      lines.push(`Banker push +${formatChips(state.bets.banker)}`);
    }
  }

  if (pairs.playerPair && state.bets.playerPair) {
    const amount = state.bets.playerPair * 12;
    payout += amount;
    lines.push(`Player Pair +${formatChips(amount)}`);
  }

  if (pairs.bankerPair && state.bets.bankerPair) {
    const amount = state.bets.bankerPair * 12;
    payout += amount;
    lines.push(`Banker Pair +${formatChips(amount)}`);
  }

  if (payout > 0) {
    Chips.add(payout);
  }

  const net = payout - wager;
  updateBalance();
  updateScores();
  drawTable();

  if (net > 0) win();
  else if (net < 0) lose();

  const outcomeTitle = outcome === 'tie' ? 'Tie' : `${BET_LABELS[outcome]} wins`;
  const pairText = [pairs.playerPair ? 'Player Pair' : '', pairs.bankerPair ? 'Banker Pair' : ''].filter(Boolean).join(' · ');
  const detailText = lines.length ? lines.join(' · ') : net === 0 ? 'Push.' : 'No winning wagers.';
  showMessage(outcomeTitle, pairText ? `${pairText} · ${detailText}` : detailText, 4200);
}

function renderRoad() {
  beadRoadEl.innerHTML = '';
  state.history.forEach(result => {
    const cell = document.createElement('div');
    cell.className = `bead-cell ${result}`;
    cell.textContent = ROAD_MARKERS[result];
    beadRoadEl.appendChild(cell);
  });
  beadRoadEl.scrollLeft = beadRoadEl.scrollWidth;
}

function showMessage(title, text, timeout = 0) {
  clearTimeout(state.overlayTimer);
  messageTitle.textContent = title;
  messageText.textContent = text;
  overlay.classList.remove('hidden');
  if (timeout > 0) {
    state.overlayTimer = setTimeout(() => overlay.classList.add('hidden'), timeout);
  }
}

function hideMessage() {
  clearTimeout(state.overlayTimer);
  overlay.classList.add('hidden');
}

function getLayout(width, height) {
  const cardW = Math.min(92, width * 0.12);
  const cardH = cardW * 1.42;
  return {
    cardW,
    cardH,
    cardY: height * 0.2,
    playerX: width * 0.12,
    bankerX: width * 0.58,
    spacing: cardW * 0.72
  };
}

function drawTable() {
  if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  ctx.clearRect(0, 0, width, height);

  const felt = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, Math.max(width, height));
  felt.addColorStop(0, '#1d5b32');
  felt.addColorStop(0.55, '#0d2818');
  felt.addColorStop(1, '#07110b');
  ctx.fillStyle = felt;
  ctx.fillRect(0, 0, width, height);

  fillAndStrokeRect(width * 0.04, height * 0.08, width * 0.42, height * 0.62, 26, 'rgba(240, 208, 128, 0.08)');
  fillAndStrokeRect(width * 0.54, height * 0.08, width * 0.42, height * 0.62, 26, 'rgba(240, 208, 128, 0.08)');
  fillAndStrokeRect(width * 0.35, height * 0.08, width * 0.3, height * 0.16, 18, 'rgba(240, 208, 128, 0.12)');

  ctx.strokeStyle = 'rgba(240, 208, 128, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2, height * 0.12);
  ctx.lineTo(width / 2, height * 0.64);
  ctx.stroke();

  ctx.fillStyle = '#f0d080';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.max(18, width * 0.018)}px "Playfair Display", serif`;
  ctx.fillText('PLAYER', width * 0.25, height * 0.13);
  ctx.fillText('BANKER', width * 0.75, height * 0.13);
  ctx.font = `500 ${Math.max(14, width * 0.013)}px "Crimson Pro", serif`;
  ctx.fillStyle = 'rgba(240, 232, 208, 0.78)';
  ctx.fillText(`Shoe: ${state.deck.length} cards`, width / 2, height * 0.16);

  const layout = getLayout(width, height);
  state.playerCards.forEach(entry => drawCard(ctx, entry.card, entry.x, entry.y, layout.cardW, layout.cardH, true));
  state.bankerCards.forEach(entry => drawCard(ctx, entry.card, entry.x, entry.y, layout.cardW, layout.cardH, true));

  drawScoreBlock(width * 0.25, height * 0.79, handTotal(state.playerHand), '#72a6ff', state.playerHand.length > 0);
  drawScoreBlock(width * 0.75, height * 0.79, handTotal(state.bankerHand), '#ff8b7e', state.bankerHand.length > 0);
}

function drawScoreBlock(x, y, score, color, visible) {
  fillAndStrokeRect(x - 72, y - 38, 144, 76, 18, 'rgba(6, 9, 8, 0.72)', 'rgba(201, 168, 76, 0.35)', 2);
  ctx.fillStyle = color;
  ctx.font = '700 42px "Playfair Display", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(visible ? String(score) : '--', x, y + 2);
}

function fillAndStrokeRect(x, y, width, height, radius, fillStyle, strokeStyle = 'rgba(201, 168, 76, 0.6)', lineWidth = 3) {
  pathRoundRect(x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function pathRoundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
