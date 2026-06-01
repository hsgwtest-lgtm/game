import * as THREE from 'three';
import { Chips } from '../../js/chips.js';
import { resumeAudio, cardFlip, win, lose } from '../../js/audio.js';
import { createDeck, shuffleDeck, cardValue, createCardTexture, createCardBackTexture, disposeScene, updateBalanceDisplay, formatNumber } from '../../js/utils.js';

// State
let betAmount = 50;
let deck = [];
let playerHand = [];
let dealerHand = [];
let gamePhase = 'betting'; // betting, playing, dealerTurn, done
let scene, camera, renderer, animationId;
let playerCards3D = [];
let dealerCards3D = [];
const cardBackTex = { tex: null };

// DOM
const container = document.getElementById('canvasContainer');
const balanceDisplay = document.getElementById('balanceDisplay');
const dealBtn = document.getElementById('dealBtn');
const hitBtn = document.getElementById('hitBtn');
const standBtn = document.getElementById('standBtn');
const doubleBtn = document.getElementById('doubleBtn');
const betPhase = document.getElementById('betPhase');
const actionButtons = document.getElementById('actionButtons');
const scores = document.getElementById('scores');
const dealerScoreEl = document.getElementById('dealerScore');
const playerScoreEl = document.getElementById('playerScore');
const resultPopup = document.getElementById('resultPopup');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');

updateBalanceDisplay(balanceDisplay, Chips.balance);
Chips.onChange(b => updateBalanceDisplay(balanceDisplay, b));

document.getElementById('backBtn').addEventListener('click', () => {
  cleanup();
  location.href = '../../index.html';
});

// Chip selection
document.querySelectorAll('.chip-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    betAmount = parseInt(btn.dataset.amount, 10);
  });
});

// Hand scoring
function handScore(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    const v = cardValue(card);
    total += v;
    if (card.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBlackjack(hand) {
  return hand.length === 2 && handScore(hand) === 21;
}

// Three.js setup
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 4, 4);
  camera.lookAt(0, 0, 0.5);

  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const light = new THREE.PointLight(0xc9a84c, 1.2, 20);
  light.position.set(0, 6, 2);
  scene.add(light);

  // Table
  const tableGeo = new THREE.PlaneGeometry(8, 5);
  const tableCanvas = createBJTable();
  const tableMat = new THREE.MeshPhongMaterial({
    map: new THREE.CanvasTexture(tableCanvas),
    side: THREE.DoubleSide
  });
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.01;
  scene.add(table);

  cardBackTex.tex = createCardBackTexture(THREE);

  animate();
}

function createBJTable() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d2818';
  ctx.fillRect(0, 0, 512, 320);

  // Semi-circle arc
  ctx.strokeStyle = 'rgba(201,168,76,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(256, 320, 230, Math.PI, 0);
  ctx.stroke();

  // Labels
  ctx.font = '18px serif';
  ctx.fillStyle = 'rgba(201,168,76,0.4)';
  ctx.textAlign = 'center';
  ctx.fillText('DEALER', 256, 60);
  ctx.fillText('PLAYER', 256, 280);

  // Insurance line
  ctx.strokeStyle = 'rgba(201,168,76,0.15)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(60, 160);
  ctx.lineTo(452, 160);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '12px serif';
  ctx.fillStyle = 'rgba(201,168,76,0.25)';
  ctx.fillText('BLACKJACK PAYS 3 TO 2', 256, 155);

  return canvas;
}

function animate() {
  animationId = requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

// Card 3D creation
function createCard3D(cardData, x, z, faceUp = true) {
  const cardGeo = new THREE.PlaneGeometry(0.9, 1.26);
  const tex = faceUp ? createCardTexture(THREE, cardData.suit, cardData.rank) : cardBackTex.tex.clone();
  const mat = new THREE.MeshPhongMaterial({ map: tex, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(cardGeo, mat);
  mesh.position.set(x, 0.02 + Math.random() * 0.01, z);
  mesh.rotation.x = -Math.PI / 2;
  mesh.userData = { cardData, faceUp };
  scene.add(mesh);
  return mesh;
}

function clearCards() {
  for (const c of [...playerCards3D, ...dealerCards3D]) {
    scene.remove(c);
    c.geometry.dispose();
    c.material.dispose();
  }
  playerCards3D = [];
  dealerCards3D = [];
}

function updateScores(showDealer = false) {
  const ps = handScore(playerHand);
  playerScoreEl.textContent = ps;
  if (showDealer) {
    dealerScoreEl.textContent = handScore(dealerHand);
  } else {
    dealerScoreEl.textContent = dealerHand.length > 0 ? cardValue(dealerHand[0]) + ' + ?' : '0';
  }
}

// Deal
dealBtn.addEventListener('click', () => {
  resumeAudio();
  if (Chips.balance < betAmount) return;

  Chips.subtract(betAmount);
  gamePhase = 'playing';

  clearCards();
  playerHand = [];
  dealerHand = [];

  if (deck.length < 15) deck = shuffleDeck(createDeck());

  // Deal 2 cards each
  playerHand.push(deck.pop());
  dealerHand.push(deck.pop());
  playerHand.push(deck.pop());
  dealerHand.push(deck.pop());

  // Create 3D cards
  playerCards3D.push(createCard3D(playerHand[0], -0.5, 1.2));
  playerCards3D.push(createCard3D(playerHand[1], 0.5, 1.2));

  dealerCards3D.push(createCard3D(dealerHand[0], -0.5, -0.8));
  dealerCards3D.push(createCard3D(dealerHand[1], 0.5, -0.8, false)); // hole card face-down

  cardFlip();

  betPhase.style.display = 'none';
  scores.style.display = '';
  actionButtons.style.display = '';
  doubleBtn.disabled = Chips.balance < betAmount;

  updateScores(false);

  // Check player blackjack
  if (isBlackjack(playerHand)) {
    revealDealer();
  }
});

// Hit
hitBtn.addEventListener('click', () => {
  resumeAudio();
  if (gamePhase !== 'playing') return;

  const card = deck.pop();
  playerHand.push(card);
  const x = -0.5 + (playerHand.length - 1) * 0.6;
  playerCards3D.push(createCard3D(card, x, 1.2));
  cardFlip();
  updateScores(false);

  doubleBtn.disabled = true;

  if (handScore(playerHand) > 21) {
    gamePhase = 'done';
    revealDealer();
  }
});

// Stand
standBtn.addEventListener('click', () => {
  resumeAudio();
  if (gamePhase !== 'playing') return;
  revealDealer();
});

// Double Down
doubleBtn.addEventListener('click', () => {
  resumeAudio();
  if (gamePhase !== 'playing') return;
  if (Chips.balance < betAmount) return;

  Chips.subtract(betAmount);
  betAmount *= 2;

  const card = deck.pop();
  playerHand.push(card);
  const x = -0.5 + (playerHand.length - 1) * 0.6;
  playerCards3D.push(createCard3D(card, x, 1.2));
  cardFlip();
  updateScores(false);

  revealDealer();
});

function revealDealer() {
  gamePhase = 'dealerTurn';
  actionButtons.style.display = 'none';

  // Flip hole card
  const holeCard = dealerCards3D[1];
  const tex = createCardTexture(THREE, dealerHand[1].suit, dealerHand[1].rank);
  holeCard.material.map = tex;
  holeCard.material.needsUpdate = true;
  holeCard.userData.faceUp = true;
  cardFlip();

  updateScores(true);

  // Dealer draws (soft 17 hits)
  function dealerDraw() {
    const ds = handScore(dealerHand);
    const playerBust = handScore(playerHand) > 21;

    if (!playerBust && ds < 17) {
      setTimeout(() => {
        const card = deck.pop();
        dealerHand.push(card);
        const x = -0.5 + (dealerHand.length - 1) * 0.6;
        dealerCards3D.push(createCard3D(card, x, -0.8));
        cardFlip();
        updateScores(true);
        dealerDraw();
      }, 600);
    } else {
      setTimeout(() => resolveGame(), 400);
    }
  }
  dealerDraw();
}

function resolveGame() {
  gamePhase = 'done';
  const ps = handScore(playerHand);
  const ds = handScore(dealerHand);
  const playerBJ = isBlackjack(playerHand);
  const dealerBJ = isBlackjack(dealerHand);

  let title, text, cls;

  if (playerBJ && dealerBJ) {
    title = 'PUSH';
    text = 'Both Blackjack';
    cls = 'win';
    Chips.add(betAmount);
  } else if (playerBJ) {
    const payout = Math.floor(betAmount * 2.5);
    title = '🎉 BLACKJACK!';
    text = `+${formatNumber(payout)} chips`;
    cls = 'win';
    Chips.add(payout);
    win();
  } else if (ps > 21) {
    title = 'BUST';
    text = `Player: ${ps}`;
    cls = 'lose';
    lose();
  } else if (ds > 21) {
    title = '🎉 DEALER BUSTS!';
    text = `+${formatNumber(betAmount * 2)} chips`;
    cls = 'win';
    Chips.add(betAmount * 2);
    win();
  } else if (ps > ds) {
    title = '🎉 WIN!';
    text = `+${formatNumber(betAmount * 2)} chips`;
    cls = 'win';
    Chips.add(betAmount * 2);
    win();
  } else if (ds > ps) {
    title = 'LOSE';
    text = `Dealer: ${ds} vs Player: ${ps}`;
    cls = 'lose';
    lose();
  } else {
    title = 'PUSH';
    text = `Both ${ps}`;
    cls = 'win';
    Chips.add(betAmount);
  }

  showResult(title, text, cls);

  // Reset bet amount if doubled
  betAmount = parseInt(document.querySelector('.chip-btn.selected').dataset.amount, 10);

  // Return to betting phase
  setTimeout(() => {
    betPhase.style.display = '';
    actionButtons.style.display = 'none';
    scores.style.display = 'none';
  }, 2500);
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
