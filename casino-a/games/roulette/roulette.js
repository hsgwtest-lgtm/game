import { Chips } from '../../js/chips.js';
import {
  createAudioContext,
  resumeAudio,
  chipPlace,
  win,
  bigWin,
  lose,
  spin,
  ballRoll
} from '../../js/audio.js';
import { setupCanvas, delay, formatChips, easeOutCubic } from '../../js/utils.js';

const STATES = {
  BETTING: 'BETTING',
  SPINNING: 'SPINNING',
  RESULT: 'RESULT'
};

const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const CHIP_VALUES = [100, 500, 1000, 5000];
const FULL_TURN = Math.PI * 2;
const SECTOR_ANGLE = FULL_TURN / WHEEL.length;

const elements = {
  canvas: document.getElementById('wheelCanvas'),
  balance: document.getElementById('balance'),
  resultValue: document.getElementById('resultValue'),
  resultDetail: document.getElementById('resultDetail'),
  totalBet: document.getElementById('totalBet'),
  spinBtn: document.getElementById('spinBtn'),
  clearBtn: document.getElementById('clearBtn'),
  table: document.getElementById('bettingTable'),
  chipButtons: [...document.querySelectorAll('[data-chip]')]
};

const state = {
  gameState: STATES.BETTING,
  selectedChip: CHIP_VALUES[0],
  bets: [],
  wheelAngle: 0,
  ballAngle: 0,
  canvasState: null,
  highlightKeys: new Set(),
  audioUnlocked: false,
  spinToken: 0,
  lastResult: null,
  spinningBallSound: false
};

const betDefinitions = new Map();
const betElements = new Map();

function unlockAudio() {
  if (state.audioUnlocked) return;
  createAudioContext();
  resumeAudio();
  state.audioUnlocked = true;
}

function normalizeAngle(angle) {
  return ((angle % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

function getNumberTone(number) {
  if (number === 0) return 'green';
  return RED_NUMBERS.has(number) ? 'red' : 'black';
}

function getPayout(type) {
  switch (type) {
    case 'straight':
      return 35;
    case 'column':
    case 'dozen':
      return 2;
    default:
      return 1;
  }
}

function getTotalBet() {
  return state.bets.reduce((sum, bet) => sum + bet.amount, 0);
}

function updateBalance() {
  elements.balance.textContent = formatChips(Chips.balance);
}

function setResultDisplay(value, detail, tone = '') {
  elements.resultValue.textContent = value;
  elements.resultValue.className = `result-value${tone ? ` ${tone}` : ''}`;
  elements.resultDetail.textContent = detail;
}

function updateControls() {
  const hasBet = getTotalBet() > 0;
  const spinning = state.gameState === STATES.SPINNING;

  elements.spinBtn.disabled = spinning || !hasBet;
  elements.clearBtn.disabled = spinning || (!hasBet && state.highlightKeys.size === 0);

  elements.chipButtons.forEach((button) => {
    const value = Number(button.dataset.chip);
    button.classList.toggle('active', value === state.selectedChip);
    button.disabled = spinning || Chips.balance < value;
  });

  betElements.forEach((element) => {
    element.disabled = spinning;
    element.classList.toggle('disabled', spinning);
  });
}

function renderBetChips() {
  betElements.forEach((element) => {
    const existing = element.querySelector('.bet-chip');
    if (existing) existing.remove();
    element.classList.remove('active-bet', 'winning-bet');
  });

  state.bets.forEach((bet) => {
    const cell = betElements.get(bet.key);
    if (!cell) return;
    cell.classList.add('active-bet');
    const chip = document.createElement('span');
    chip.className = 'bet-chip';
    chip.textContent = formatChips(bet.amount).replace('¥', '');
    cell.appendChild(chip);
  });

  state.highlightKeys.forEach((key) => {
    const cell = betElements.get(key);
    if (cell) cell.classList.add('winning-bet');
  });

  elements.totalBet.textContent = formatChips(getTotalBet());
}

function renderHud() {
  updateBalance();
  renderBetChips();
  updateControls();
}

function createCellContent(main, sub = '') {
  const wrapper = document.createElement('span');
  wrapper.innerHTML = `<span class="cell-main">${main}</span>${sub ? `<span class="cell-sub">${sub}</span>` : ''}`;
  return wrapper;
}

function registerBetCell({ key, type, numbers, label, main, sub = '', className = '' }) {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = `bet-cell ${className}`.trim();
  cell.dataset.key = key;
  cell.appendChild(createCellContent(main, sub));
  cell.addEventListener('click', () => placeBet(key));

  betDefinitions.set(key, {
    key,
    type,
    numbers,
    label,
    payout: getPayout(type)
  });
  betElements.set(key, cell);
  return cell;
}

function buildTable() {
  const layout = document.createElement('div');
  layout.className = 'table-layout';

  const zeroRow = document.createElement('div');
  zeroRow.className = 'zero-row';
  zeroRow.appendChild(registerBetCell({
    key: 'straight-0',
    type: 'straight',
    numbers: [0],
    label: '0',
    main: '0',
    sub: 'Straight',
    className: 'number green-number zero-cell'
  }));

  const numberGrid = document.createElement('div');
  numberGrid.className = 'number-grid';

  for (let row = 0; row < 12; row += 1) {
    for (let col = 1; col <= 3; col += 1) {
      const number = row * 3 + col;
      const tone = getNumberTone(number);
      numberGrid.appendChild(registerBetCell({
        key: `straight-${number}`,
        type: 'straight',
        numbers: [number],
        label: `${number}`,
        main: `${number}`,
        className: `number ${tone}-number`
      }));
    }
  }

  const columnsRow = document.createElement('div');
  columnsRow.className = 'columns-row';
  columnsRow.appendChild(registerBetCell({
    key: 'column-1',
    type: 'column',
    numbers: Array.from({ length: 12 }, (_, index) => index * 3 + 1),
    label: '1st Column',
    main: '1st Col',
    className: 'column'
  }));
  columnsRow.appendChild(registerBetCell({
    key: 'column-2',
    type: 'column',
    numbers: Array.from({ length: 12 }, (_, index) => index * 3 + 2),
    label: '2nd Column',
    main: '2nd Col',
    className: 'column'
  }));
  columnsRow.appendChild(registerBetCell({
    key: 'column-3',
    type: 'column',
    numbers: Array.from({ length: 12 }, (_, index) => index * 3 + 3),
    label: '3rd Column',
    main: '3rd Col',
    className: 'column'
  }));

  const dozensRow = document.createElement('div');
  dozensRow.className = 'dozens-row';
  dozensRow.appendChild(registerBetCell({
    key: 'dozen-1',
    type: 'dozen',
    numbers: Array.from({ length: 12 }, (_, index) => index + 1),
    label: '1st 12',
    main: '1st 12',
    sub: '1 - 12',
    className: 'outside'
  }));
  dozensRow.appendChild(registerBetCell({
    key: 'dozen-2',
    type: 'dozen',
    numbers: Array.from({ length: 12 }, (_, index) => index + 13),
    label: '2nd 12',
    main: '2nd 12',
    sub: '13 - 24',
    className: 'outside'
  }));
  dozensRow.appendChild(registerBetCell({
    key: 'dozen-3',
    type: 'dozen',
    numbers: Array.from({ length: 12 }, (_, index) => index + 25),
    label: '3rd 12',
    main: '3rd 12',
    sub: '25 - 36',
    className: 'outside'
  }));

  const outsideRow = document.createElement('div');
  outsideRow.className = 'outside-row';
  outsideRow.appendChild(registerBetCell({
    key: 'range-low',
    type: 'range',
    numbers: Array.from({ length: 18 }, (_, index) => index + 1),
    label: '1 - 18',
    main: '1 - 18',
    className: 'outside'
  }));
  outsideRow.appendChild(registerBetCell({
    key: 'parity-even',
    type: 'parity',
    numbers: Array.from({ length: 18 }, (_, index) => (index + 1) * 2),
    label: 'Even',
    main: 'Even',
    className: 'outside'
  }));
  outsideRow.appendChild(registerBetCell({
    key: 'color-red',
    type: 'color',
    numbers: [...RED_NUMBERS],
    label: 'Red',
    main: 'Red',
    className: 'outside'
  }));
  outsideRow.appendChild(registerBetCell({
    key: 'color-black',
    type: 'color',
    numbers: Array.from({ length: 36 }, (_, index) => index + 1).filter((number) => !RED_NUMBERS.has(number)),
    label: 'Black',
    main: 'Black',
    className: 'outside'
  }));
  outsideRow.appendChild(registerBetCell({
    key: 'parity-odd',
    type: 'parity',
    numbers: Array.from({ length: 18 }, (_, index) => index * 2 + 1),
    label: 'Odd',
    main: 'Odd',
    className: 'outside'
  }));
  outsideRow.appendChild(registerBetCell({
    key: 'range-high',
    type: 'range',
    numbers: Array.from({ length: 18 }, (_, index) => index + 19),
    label: '19 - 36',
    main: '19 - 36',
    className: 'outside'
  }));

  layout.append(zeroRow, numberGrid, columnsRow, dozensRow, outsideRow);
  elements.table.appendChild(layout);
}

function getBetIndex(key) {
  return state.bets.findIndex((bet) => bet.key === key);
}

function prepareNextRound() {
  state.gameState = STATES.BETTING;
  state.highlightKeys.clear();
  state.lastResult = null;
  setResultDisplay('—', 'Place your bets. No more bets after the spin begins.');
}

function placeBet(key) {
  unlockAudio();

  if (state.gameState === STATES.SPINNING) return;
  if (state.gameState === STATES.RESULT) {
    prepareNextRound();
  }

  const betDef = betDefinitions.get(key);
  if (!betDef) return;
  if (Chips.balance < state.selectedChip) {
    setResultDisplay(state.lastResult ?? '—', 'Not enough balance for the selected chip.', state.lastResult !== null ? getNumberTone(state.lastResult) : '');
    renderHud();
    return;
  }

  Chips.subtract(state.selectedChip);
  chipPlace();

  const existingIndex = getBetIndex(key);
  if (existingIndex >= 0) {
    state.bets[existingIndex].amount += state.selectedChip;
  } else {
    state.bets.push({ ...betDef, amount: state.selectedChip });
  }

  setResultDisplay('—', `${betDef.label} +${formatChips(state.selectedChip)}`);
  renderHud();
}

function clearBets() {
  if (state.gameState === STATES.SPINNING) return;

  if (state.gameState === STATES.RESULT) {
    prepareNextRound();
  }

  const refund = getTotalBet();
  if (refund > 0) {
    Chips.add(refund);
  }
  state.bets = [];
  state.highlightKeys.clear();
  setResultDisplay('—', 'Bets cleared. Place your bets.');
  renderHud();
}

function resizeCanvas() {
  state.canvasState = setupCanvas(elements.canvas);
  renderWheel();
}

function drawSector(ctx, centerX, centerY, outerRadius, innerRadius, startAngle, endAngle, fillStyle) {
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
  ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function renderWheel() {
  if (!state.canvasState) return;

  const { ctx, width, height } = state.canvasState;
  ctx.clearRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.42;
  const outerRadius = radius;
  const innerRadius = radius * 0.54;
  const textRadius = radius * 0.76;
  const ballRadius = Math.max(5, radius * 0.045);
  const ballTrack = radius * 1.04;

  ctx.save();
  const backgroundGradient = ctx.createRadialGradient(centerX, centerY, radius * 0.2, centerX, centerY, radius * 1.3);
  backgroundGradient.addColorStop(0, 'rgba(201, 168, 76, 0.12)');
  backgroundGradient.addColorStop(0.6, 'rgba(8, 30, 18, 0.95)');
  backgroundGradient.addColorStop(1, 'rgba(3, 8, 6, 1)');
  ctx.fillStyle = backgroundGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 1.22, 0, FULL_TURN);
  ctx.fill();

  ctx.strokeStyle = 'rgba(240, 208, 128, 0.45)';
  ctx.lineWidth = radius * 0.055;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 1.09, 0, FULL_TURN);
  ctx.stroke();

  for (let index = 0; index < WHEEL.length; index += 1) {
    const number = WHEEL[index];
    const start = state.wheelAngle + index * SECTOR_ANGLE - SECTOR_ANGLE / 2 - Math.PI / 2;
    const end = start + SECTOR_ANGLE;
    const tone = getNumberTone(number);
    const fillStyle = tone === 'green'
      ? '#1d7a4a'
      : tone === 'red'
        ? '#b3372a'
        : '#16181d';

    drawSector(ctx, centerX, centerY, outerRadius, innerRadius, start, end, fillStyle);

    ctx.save();
    const textAngle = state.wheelAngle + index * SECTOR_ANGLE - Math.PI / 2;
    ctx.translate(centerX + Math.cos(textAngle) * textRadius, centerY + Math.sin(textAngle) * textRadius);
    ctx.rotate(textAngle + Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.max(11, radius * 0.12)}px "Crimson Pro", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), 0, 0);
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(240, 208, 128, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, outerRadius, 0, FULL_TURN);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius, 0, FULL_TURN);
  ctx.stroke();

  const hubGradient = ctx.createRadialGradient(centerX, centerY, radius * 0.02, centerX, centerY, radius * 0.28);
  hubGradient.addColorStop(0, '#f6dfa0');
  hubGradient.addColorStop(1, '#7c5a18');
  ctx.fillStyle = hubGradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.22, 0, FULL_TURN);
  ctx.fill();

  ctx.fillStyle = '#1c1304';
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.05, 0, FULL_TURN);
  ctx.fill();

  const ballCanvasAngle = state.ballAngle - Math.PI / 2;
  const ballX = centerX + Math.cos(ballCanvasAngle) * ballTrack;
  const ballY = centerY + Math.sin(ballCanvasAngle) * ballTrack;
  ctx.fillStyle = '#f7f7f7';
  ctx.shadowColor = 'rgba(255, 255, 255, 0.45)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(ballX, ballY, ballRadius, 0, FULL_TURN);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(240, 208, 128, 0.95)';
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - radius * 1.18);
  ctx.lineTo(centerX - radius * 0.08, centerY - radius * 1.03);
  ctx.lineTo(centerX + radius * 0.08, centerY - radius * 1.03);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function getWinningIndex() {
  const relative = normalizeAngle(state.ballAngle - state.wheelAngle);
  return Math.floor((relative + SECTOR_ANGLE / 2) / SECTOR_ANGLE) % WHEEL.length;
}

function resolveBets(resultNumber, totalBet) {
  const tone = getNumberTone(resultNumber);
  const winningKeys = new Set([`straight-${resultNumber}`]);
  let totalReturn = 0;

  state.bets.forEach((bet) => {
    const isWinningBet = bet.numbers.includes(resultNumber);
    if (!isWinningBet) return;

    winningKeys.add(bet.key);
    totalReturn += bet.amount * (bet.payout + 1);
  });

  if (totalReturn > 0) {
    Chips.add(totalReturn);
  }

  const netResult = totalReturn - totalBet;

  state.highlightKeys = winningKeys;
  state.lastResult = resultNumber;
  state.bets = [];
  renderHud();

  if (netResult > 0) {
    setResultDisplay(String(resultNumber), `Won ${formatChips(netResult)} net on ${formatChips(totalBet)} bet.`, tone);
    if (netResult >= totalBet * 5) {
      bigWin();
    } else {
      win();
    }
  } else if (netResult === 0) {
    setResultDisplay(String(resultNumber), `Push. ${formatChips(totalReturn)} returned on ${formatChips(totalBet)} bet.`, tone);
    win();
  } else if (totalReturn > 0) {
    setResultDisplay(String(resultNumber), `Returned ${formatChips(totalReturn)}. Net loss ${formatChips(Math.abs(netResult))}.`, tone);
    lose();
  } else {
    setResultDisplay(String(resultNumber), `Lost ${formatChips(totalBet)}. The house takes this round.`, tone);
    lose();
  }

  state.gameState = STATES.RESULT;
  updateBalance();
  updateControls();
}

async function animateSpin(totalBet) {
  state.gameState = STATES.SPINNING;
  state.highlightKeys.clear();
  setResultDisplay('…', 'No more bets. Wheel is spinning.');
  renderHud();

  const startWheel = state.wheelAngle;
  const startBall = state.ballAngle;
  const targetIndex = Math.floor(Math.random() * WHEEL.length);
  const wheelTurns = 5 + Math.random() * 1.5;
  const ballTurns = wheelTurns + 4 + Math.random() * 1.5;
  const targetRelative = targetIndex * SECTOR_ANGLE;
  const wheelOffset = Math.random() * FULL_TURN;
  const finalWheel = startWheel + wheelTurns * FULL_TURN + wheelOffset;
  let finalBall = finalWheel + targetRelative - ballTurns * FULL_TURN;

  while (finalBall >= startBall) {
    finalBall -= FULL_TURN;
  }

  const duration = 6200;
  const spinToken = Date.now();
  state.spinToken = spinToken;
  state.spinningBallSound = false;

  spin();

  await new Promise((resolve) => {
    const startTime = performance.now();

    function frame(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = easeOutCubic(progress);
      state.wheelAngle = startWheel + (finalWheel - startWheel) * eased;
      state.ballAngle = startBall + (finalBall - startBall) * eased;

      if (!state.spinningBallSound && progress > 0.68) {
        ballRoll();
        state.spinningBallSound = true;
      }

      renderWheel();

      if (progress < 1 && state.spinToken === spinToken) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });

  await delay(180);

  const resultIndex = getWinningIndex();
  const resultNumber = WHEEL[resultIndex];
  resolveBets(resultNumber, totalBet);
}

async function handleSpin() {
  if (state.gameState === STATES.SPINNING) return;
  const totalBet = getTotalBet();
  if (totalBet <= 0) return;

  unlockAudio();
  await animateSpin(totalBet);
}

function bindEvents() {
  elements.chipButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (state.gameState === STATES.SPINNING) return;
      const chipValue = Number(button.dataset.chip);
      state.selectedChip = chipValue;
      renderHud();
    });
  });

  elements.spinBtn.addEventListener('click', handleSpin);
  elements.clearBtn.addEventListener('click', clearBets);

  ['pointerdown', 'touchstart'].forEach((eventName) => {
    window.addEventListener(eventName, unlockAudio, { passive: true, once: true });
  });

  window.addEventListener('resize', resizeCanvas);
}

function init() {
  buildTable();
  bindEvents();
  resizeCanvas();
  renderWheel();
  renderHud();
  setResultDisplay('—', 'Place your bets. No more bets after the spin begins.');
}

init();
