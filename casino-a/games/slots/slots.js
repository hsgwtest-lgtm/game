import { Chips } from '../../js/chips.js';
import { createAudioContext, resumeAudio, chipPlace, win, bigWin, lose, spin } from '../../js/audio.js';
import { setupCanvas, delay, formatChips, weightedRandom, easeOutBounce, easeOutCubic } from '../../js/utils.js';

const SYMBOLS = ['🍒', '🔔', '💎', '7️⃣', '⭐', '🃏', '🍋', '🍇'];
const WEIGHTS = [30, 20, 5, 8, 15, 10, 25, 20];
const STRIP_LENGTH = 20;
const REEL_COUNT = 3;
const VISIBLE_ROWS = 3;
const BOUNCE_AMOUNT = 0.35;
const SPIN_SETTLE_MS = 450;
const BASE_STOP_MS = 1400;
const STOP_STAGGER_MS = 600;
const STATES = {
  IDLE: 'IDLE',
  SPINNING: 'SPINNING',
  STOPPING: 'STOPPING',
  RESULT: 'RESULT'
};

const canvas = document.getElementById('slots-canvas');
const balanceEl = document.getElementById('balance');
const winAmountEl = document.getElementById('win-amount');
const spinButton = document.getElementById('spin-button');
const statusText = document.getElementById('status-text');
const paylineFlash = document.getElementById('payline-flash');
const betButtons = [...document.querySelectorAll('.bet-chip')];

let canvasState = setupCanvas(canvas);
let colors = readThemeColors();
let currentBet = 10;
let spinState = STATES.IDLE;
let activeSpinToken = 0;
let lastTimestamp = 0;

const reels = Array.from({ length: REEL_COUNT }, (_, index) => createReel(index));

function readThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    bgDeep: styles.getPropertyValue('--bg-deep').trim(),
    bgTable: styles.getPropertyValue('--bg-table').trim(),
    gold: styles.getPropertyValue('--gold').trim(),
    goldLight: styles.getPropertyValue('--gold-light').trim(),
    textPrimary: styles.getPropertyValue('--text-primary').trim(),
    textMuted: styles.getPropertyValue('--text-muted').trim()
  };
}

function createStrip() {
  return Array.from({ length: STRIP_LENGTH }, () => SYMBOLS[weightedRandom(SYMBOLS, WEIGHTS)]);
}

function createReel(index) {
  return {
    index,
    strip: createStrip(),
    position: Math.floor(Math.random() * STRIP_LENGTH),
    startPosition: 0,
    targetPosition: 0,
    finalTopIndex: 0,
    stopStart: 0,
    stopDuration: BASE_STOP_MS + index * STOP_STAGGER_MS,
    done: false
  };
}

function normalizePosition(value) {
  return ((value % STRIP_LENGTH) + STRIP_LENGTH) % STRIP_LENGTH;
}

function resetPaylineFlash() {
  paylineFlash.classList.remove('active');
  void paylineFlash.offsetWidth;
}

function triggerPaylineFlash() {
  resetPaylineFlash();
  paylineFlash.classList.add('active');
}

function setStatus(message) {
  statusText.textContent = message;
}

function setWinAmount(amount) {
  winAmountEl.textContent = formatChips(amount);
}

function updateBalance() {
  balanceEl.textContent = formatChips(Chips.balance);
  const canAfford = Chips.balance >= currentBet;
  spinButton.disabled = !canAfford || spinState === STATES.SPINNING || spinState === STATES.STOPPING;
  if (!canAfford && spinState !== STATES.SPINNING && spinState !== STATES.STOPPING) {
    setStatus('Not enough chips for the selected bet.');
  }
}

function updateBetSelection() {
  betButtons.forEach(button => {
    button.classList.toggle('active', Number(button.dataset.bet) === currentBet);
  });
  updateBalance();
}

function resizeCanvas() {
  canvasState = setupCanvas(canvas);
  colors = readThemeColors();
  drawScene();
}

function getLayout() {
  const { width, height } = canvasState;
  const padding = Math.max(16, width * 0.035);
  const reelGap = Math.max(10, width * 0.02);
  const reelWidth = (width - padding * 2 - reelGap * 2) / REEL_COUNT;
  const cellHeight = (height - padding * 2) / VISIBLE_ROWS;
  return { width, height, padding, reelGap, reelWidth, cellHeight };
}

function symbolAt(reel, visibleRow) {
  const topIndex = Math.round(normalizePosition(reel.position));
  return reel.strip[(topIndex + visibleRow) % STRIP_LENGTH];
}

function getPaylineSymbols() {
  return reels.map(reel => symbolAt(reel, 1));
}

function evaluatePayline(symbols) {
  const joined = symbols.join('');
  const payouts = {
    '💎💎💎': 50,
    '7️⃣7️⃣7️⃣': 20,
    '🔔🔔🔔': 10,
    '⭐⭐⭐': 5,
    '🃏🃏🃏': 5,
    '🍇🍇🍇': 4,
    '🍋🍋🍋': 3,
    '🍒🍒🍒': 3
  };

  if (payouts[joined]) {
    return payouts[joined];
  }

  if (symbols[0] === '🍒' && symbols[1] === '🍒') {
    return 1;
  }

  if (symbols[0] === '🍒') {
    return 0.5;
  }

  return 0;
}

function planReelStops(startTime) {
  reels.forEach((reel, index) => {
    const current = normalizePosition(reel.position);
    const finalTopIndex = Math.floor(Math.random() * STRIP_LENGTH);
    const distanceToTarget = ((finalTopIndex - current) + STRIP_LENGTH) % STRIP_LENGTH;
    const extraLoops = STRIP_LENGTH * (2.8 + index * 0.45);

    reel.startPosition = reel.position;
    reel.finalTopIndex = finalTopIndex;
    reel.targetPosition = reel.position + extraLoops + distanceToTarget;
    reel.stopStart = startTime;
    reel.stopDuration = BASE_STOP_MS + index * STOP_STAGGER_MS;
    reel.done = false;
  });
}

function updateStopping(now) {
  let allDone = true;

  reels.forEach(reel => {
    if (reel.done) {
      return;
    }

    allDone = false;
    const elapsed = now - reel.stopStart;
    const progress = Math.min(elapsed / reel.stopDuration, 1);
    const overshootTarget = reel.targetPosition + BOUNCE_AMOUNT;

    if (progress < 0.86) {
      const eased = easeOutCubic(progress / 0.86);
      reel.position = reel.startPosition + (overshootTarget - reel.startPosition) * eased;
    } else {
      const eased = easeOutBounce((progress - 0.86) / 0.14);
      reel.position = overshootTarget + (reel.targetPosition - overshootTarget) * eased;
    }

    if (progress >= 1) {
      reel.position = reel.targetPosition;
      reel.done = true;
    }
  });

  if (allDone || reels.every(reel => reel.done)) {
    finishSpin();
  }
}

function updateMotion(now, deltaSeconds) {
  if (spinState === STATES.SPINNING) {
    reels.forEach(reel => {
      reel.position += deltaSeconds * 22;
    });
    return;
  }

  if (spinState === STATES.STOPPING) {
    updateStopping(now);
  }
}

function drawBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#171924');
  gradient.addColorStop(0.45, colors.bgTable || '#0d2818');
  gradient.addColorStop(1, colors.bgDeep || '#0a0a0f');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, width * 0.7);
  glow.addColorStop(0, 'rgba(240, 208, 128, 0.12)');
  glow.addColorStop(1, 'rgba(240, 208, 128, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const limitedRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + limitedRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, limitedRadius);
  ctx.arcTo(x + width, y + height, x, y + height, limitedRadius);
  ctx.arcTo(x, y + height, x, y, limitedRadius);
  ctx.arcTo(x, y, x + width, y, limitedRadius);
  ctx.closePath();
}

function drawReel(ctx, reel, reelX, reelWidth, topY, cellHeight) {
  ctx.save();
  roundedRectPath(ctx, reelX, topY, reelWidth, cellHeight * VISIBLE_ROWS, 16);
  ctx.clip();

  const reelGradient = ctx.createLinearGradient(reelX, topY, reelX, topY + cellHeight * VISIBLE_ROWS);
  reelGradient.addColorStop(0, 'rgba(4, 7, 10, 0.9)');
  reelGradient.addColorStop(0.5, 'rgba(18, 24, 16, 0.92)');
  reelGradient.addColorStop(1, 'rgba(4, 7, 10, 0.95)');
  ctx.fillStyle = reelGradient;
  ctx.fillRect(reelX, topY, reelWidth, cellHeight * VISIBLE_ROWS);

  const normalized = normalizePosition(reel.position);
  const topIndex = Math.floor(normalized);
  const offset = normalized - topIndex;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(cellHeight * 0.54)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

  for (let visibleIndex = -1; visibleIndex <= VISIBLE_ROWS + 1; visibleIndex += 1) {
    const stripIndex = (topIndex + visibleIndex + STRIP_LENGTH) % STRIP_LENGTH;
    const symbol = reel.strip[stripIndex];
    const symbolY = topY + (visibleIndex - offset + 0.5) * cellHeight;

    ctx.fillStyle = colors.textPrimary;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 12;
    ctx.fillText(symbol, reelX + reelWidth / 2, symbolY);
  }

  ctx.restore();

  ctx.strokeStyle = 'rgba(201, 168, 76, 0.25)';
  ctx.lineWidth = 2;
  roundedRectPath(ctx, reelX, topY, reelWidth, cellHeight * VISIBLE_ROWS, 16);
  ctx.stroke();
}

function drawScene() {
  const { ctx, width, height } = canvasState;
  const { padding, reelGap, reelWidth, cellHeight } = getLayout();
  const reelsHeight = cellHeight * VISIBLE_ROWS;
  const topY = padding;

  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height);

  ctx.strokeStyle = 'rgba(201, 168, 76, 0.16)';
  ctx.lineWidth = 3;
  ctx.strokeRect(padding * 0.5, topY - 10, width - padding, reelsHeight + 20);

  reels.forEach((reel, index) => {
    const reelX = padding + index * (reelWidth + reelGap);
    drawReel(ctx, reel, reelX, reelWidth, topY, cellHeight);

    if (index < REEL_COUNT - 1) {
      const separatorX = reelX + reelWidth + reelGap / 2;
      ctx.strokeStyle = 'rgba(201, 168, 76, 0.24)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(separatorX, topY + 8);
      ctx.lineTo(separatorX, topY + reelsHeight - 8);
      ctx.stroke();
    }
  });

  const paylineY = topY + cellHeight * 1.5;
  ctx.strokeStyle = 'rgba(240, 208, 128, 0.9)';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(240, 208, 128, 0.5)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(padding - 4, paylineY);
  ctx.lineTo(width - padding + 4, paylineY);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(240, 208, 128, 0.12)';
  ctx.fillRect(padding, paylineY - cellHeight / 2, width - padding * 2, cellHeight);
}

function gameLoop(now) {
  const deltaSeconds = lastTimestamp ? Math.min((now - lastTimestamp) / 1000, 0.05) : 0.016;
  lastTimestamp = now;

  updateMotion(now, deltaSeconds);
  drawScene();
  requestAnimationFrame(gameLoop);
}

function unlockAudio() {
  createAudioContext();
  resumeAudio();
}

function finishSpin() {
  if (spinState !== STATES.STOPPING) {
    return;
  }

  spinState = STATES.RESULT;
  const payline = getPaylineSymbols();
  const multiplier = evaluatePayline(payline);
  const payout = Math.round(currentBet * multiplier);

  setWinAmount(payout);

  if (payout > 0) {
    Chips.add(payout);
    updateBalance();
    triggerPaylineFlash();
    setStatus(`Payline ${payline.join(' ')} pays ${multiplier}x.`);

    if (multiplier >= 10) {
      bigWin();
    } else {
      win();
    }
  } else {
    updateBalance();
    setStatus(`No win on ${payline.join(' ')}. Try another spin.`);
    lose();
  }
}

async function startSpin() {
  if (spinState === STATES.SPINNING || spinState === STATES.STOPPING) {
    return;
  }

  if (Chips.balance < currentBet) {
    updateBalance();
    return;
  }

  unlockAudio();
  activeSpinToken += 1;
  const token = activeSpinToken;

  spinState = STATES.SPINNING;
  Chips.subtract(currentBet);
  updateBalance();
  setWinAmount(0);
  resetPaylineFlash();
  setStatus('Reels are spinning...');
  spin();

  reels.forEach(reel => {
    reel.done = false;
  });

  await delay(SPIN_SETTLE_MS);

  if (token !== activeSpinToken || spinState !== STATES.SPINNING) {
    return;
  }

  spinState = STATES.STOPPING;
  planReelStops(performance.now());
  setStatus('Reels are slowing down...');
}

betButtons.forEach(button => {
  button.addEventListener('click', () => {
    if (spinState === STATES.SPINNING || spinState === STATES.STOPPING) {
      return;
    }

    unlockAudio();
    currentBet = Number(button.dataset.bet);
    updateBetSelection();
    chipPlace();
    setStatus(`Bet set to ${formatChips(currentBet)}.`);
  });
});

spinButton.addEventListener('click', startSpin);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', resizeCanvas);
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });

drawScene();
updateBetSelection();
updateBalance();
setWinAmount(0);
requestAnimationFrame(gameLoop);
