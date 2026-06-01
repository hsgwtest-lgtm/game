import * as THREE from 'three';
import { Chips } from '../../js/chips.js';
import { resumeAudio, cardFlip, win, lose } from '../../js/audio.js';
import { createDeck, shuffleDeck, baccaratValue, createCardTexture, createCardBackTexture, disposeScene, updateBalanceDisplay, formatNumber } from '../../js/utils.js';

// State
let selectedBet = null;
let betAmount = 50;
let dealing = false;
let deck = [];
let playerHand = [];
let bankerHand = [];
let roadHistory = [];
let scene, camera, renderer, animationId;
let cards3D = [];

// DOM
const container = document.getElementById('canvasContainer');
const balanceDisplay = document.getElementById('balanceDisplay');
const dealBtn = document.getElementById('dealBtn');
const handScores = document.getElementById('handScores');
const playerScoreEl = document.getElementById('playerScore');
const bankerScoreEl = document.getElementById('bankerScore');
const resultPopup = document.getElementById('resultPopup');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');
const roadGrid = document.getElementById('roadGrid');

updateBalanceDisplay(balanceDisplay, Chips.balance);
Chips.onChange(b => updateBalanceDisplay(balanceDisplay, b));

document.getElementById('backBtn').addEventListener('click', () => {
  cleanup();
  location.href = '../../index.html';
});

// Bet selection
document.querySelectorAll('.bet-option').forEach(btn => {
  btn.addEventListener('click', () => {
    resumeAudio();
    document.querySelectorAll('.bet-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedBet = btn.dataset.bet;
  });
});

// Chip selection
document.querySelectorAll('.chip-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    betAmount = parseInt(btn.dataset.amount, 10);
  });
});

function baccaratTotal(hand) {
  let sum = 0;
  for (const card of hand) sum += baccaratValue(card);
  return sum % 10;
}

// Three.js setup
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 4, 3.5);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const light = new THREE.PointLight(0xc9a84c, 1.2, 20);
  light.position.set(0, 6, 2);
  scene.add(light);

  // Table
  const tableGeo = new THREE.PlaneGeometry(7, 4);
  const tableCanvas = createTableTex();
  const tableMat = new THREE.MeshPhongMaterial({
    map: new THREE.CanvasTexture(tableCanvas),
    side: THREE.DoubleSide
  });
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.rotation.x = -Math.PI / 2;
  scene.add(table);

  animate();
}

function createTableTex() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 292;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d2818';
  ctx.fillRect(0, 0, 512, 292);

  // Player area
  ctx.fillStyle = 'rgba(41,128,185,0.12)';
  ctx.fillRect(20, 20, 220, 252);
  ctx.strokeStyle = 'rgba(41,128,185,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, 220, 252);

  // Banker area
  ctx.fillStyle = 'rgba(192,57,43,0.12)';
  ctx.fillRect(272, 20, 220, 252);
  ctx.strokeStyle = 'rgba(192,57,43,0.35)';
  ctx.strokeRect(272, 20, 220, 252);

  ctx.font = 'bold 24px serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(41,128,185,0.5)';
  ctx.fillText('PLAYER', 130, 265);
  ctx.fillStyle = 'rgba(192,57,43,0.5)';
  ctx.fillText('BANKER', 382, 265);

  ctx.strokeStyle = 'rgba(201,168,76,0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, 502, 282);

  return canvas;
}

function animate() {
  animationId = requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function clearCards() {
  for (const c of cards3D) {
    scene.remove(c);
    c.geometry.dispose();
    c.material.dispose();
  }
  cards3D = [];
}

function addCard3D(cardData, x, z, delay) {
  return new Promise(resolve => {
    setTimeout(() => {
      const geo = new THREE.PlaneGeometry(0.85, 1.19);
      const tex = createCardTexture(THREE, cardData.suit, cardData.rank);
      const mat = new THREE.MeshPhongMaterial({ map: tex, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.02 + cards3D.length * 0.005, z);
      mesh.rotation.x = -Math.PI / 2;
      scene.add(mesh);
      cards3D.push(mesh);
      cardFlip();
      resolve();
    }, delay);
  });
}

// Third Card Rule
function playerDrawsThird() {
  return baccaratTotal(playerHand) <= 5;
}

function bankerDrawsThird(playerThirdCard) {
  const bt = baccaratTotal(bankerHand);
  if (bt <= 2) return true;
  if (playerThirdCard === null) return bt <= 5;

  const p3v = baccaratValue(playerThirdCard);
  if (bt === 3) return p3v !== 8;
  if (bt === 4) return p3v >= 2 && p3v <= 7;
  if (bt === 5) return p3v >= 4 && p3v <= 7;
  if (bt === 6) return p3v === 6 || p3v === 7;
  return false;
}

// Deal
dealBtn.addEventListener('click', async () => {
  resumeAudio();
  if (dealing) return;
  if (!selectedBet) return;
  if (Chips.balance < betAmount) return;

  dealing = true;
  Chips.subtract(betAmount);
  clearCards();
  playerHand = [];
  bankerHand = [];

  if (deck.length < 20) deck = shuffleDeck(createDeck());

  handScores.style.display = '';

  // Initial deal: P, B, P, B
  playerHand.push(deck.pop());
  bankerHand.push(deck.pop());
  playerHand.push(deck.pop());
  bankerHand.push(deck.pop());

  await addCard3D(playerHand[0], -1.8, 0, 200);
  await addCard3D(bankerHand[0], 1.8, 0, 400);
  await addCard3D(playerHand[1], -1.0, 0, 400);
  await addCard3D(bankerHand[1], 2.6, 0, 400);

  updateScores();

  const pt = baccaratTotal(playerHand);
  const bt = baccaratTotal(bankerHand);

  // Natural (8 or 9)
  if (pt >= 8 || bt >= 8) {
    setTimeout(() => resolveRound(), 600);
    return;
  }

  // Third card logic
  let playerThirdCard = null;

  if (playerDrawsThird()) {
    playerThirdCard = deck.pop();
    playerHand.push(playerThirdCard);
    await addCard3D(playerThirdCard, -1.4, 0.6, 600);
    updateScores();
  }

  if (bankerDrawsThird(playerThirdCard)) {
    const bc = deck.pop();
    bankerHand.push(bc);
    await addCard3D(bc, 2.2, 0.6, 600);
    updateScores();
  }

  setTimeout(() => resolveRound(), 800);
});

function updateScores() {
  playerScoreEl.textContent = baccaratTotal(playerHand);
  bankerScoreEl.textContent = baccaratTotal(bankerHand);
}

function resolveRound() {
  const pt = baccaratTotal(playerHand);
  const bt = baccaratTotal(bankerHand);

  let result;
  if (pt > bt) result = 'player';
  else if (bt > pt) result = 'banker';
  else result = 'tie';

  // Road history
  roadHistory.push(result);
  updateRoad();

  let payout = 0;
  if (selectedBet === result) {
    if (result === 'player') payout = betAmount * 2;
    else if (result === 'banker') payout = betAmount + Math.floor(betAmount * 0.95);
    else if (result === 'tie') payout = betAmount * 9;
  } else if (result === 'tie') {
    // Tie returns bet on player/banker bets
    payout = betAmount;
  }

  if (payout > 0) {
    Chips.add(payout);
    if (payout > betAmount) {
      win();
      showResult('🎉 WIN!', `${result.toUpperCase()} wins (P:${pt} B:${bt}) — +${formatNumber(payout)}`, 'win');
    } else {
      showResult('PUSH', `Tie — bet returned`, 'win');
    }
  } else {
    lose();
    showResult('LOSE', `${result.toUpperCase()} wins (P:${pt} B:${bt})`, 'lose');
  }

  dealing = false;
}

function updateRoad() {
  roadGrid.innerHTML = '';
  const recent = roadHistory.slice(-40);
  for (const r of recent) {
    const cell = document.createElement('div');
    cell.className = `road-cell ${r}`;
    roadGrid.appendChild(cell);
  }
}

function showResult(title, text, cls) {
  resultTitle.textContent = title;
  resultTitle.className = cls;
  resultText.textContent = text;
  resultPopup.classList.add('show');
  setTimeout(() => resultPopup.classList.remove('show'), 2500);
}

function cleanup() {
  if (animationId) cancelAnimationFrame(animationId);
  if (renderer) disposeScene(scene, renderer);
}

window.addEventListener('resize', () => {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

deck = shuffleDeck(createDeck());
initScene();
