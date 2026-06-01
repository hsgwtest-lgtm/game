import * as THREE from 'three';
import { Chips } from '../../js/chips.js';
import { resumeAudio, cardFlip, win, lose } from '../../js/audio.js';
import { createDeck, shuffleDeck, dragonTigerValue, createCardTexture, createCardBackTexture, disposeScene, updateBalanceDisplay, formatNumber } from '../../js/utils.js';

// State
let selectedBet = null;
let betAmount = 50;
let dealing = false;
let deck = [];
let scene, camera, renderer, animationId;
let dragonCard3D, tigerCard3D;
let dragonCardData, tigerCardData;
let particles = [];

// DOM
const container = document.getElementById('canvasContainer');
const balanceDisplay = document.getElementById('balanceDisplay');
const dealBtn = document.getElementById('dealBtn');
const resultPopup = document.getElementById('resultPopup');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');

// Init balance
updateBalanceDisplay(balanceDisplay, Chips.balance);
Chips.onChange(b => updateBalanceDisplay(balanceDisplay, b));

// Back button
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

// Three.js setup
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 3.5, 3);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const pointLight = new THREE.PointLight(0xc9a84c, 1.2, 20);
  pointLight.position.set(0, 5, 2);
  scene.add(pointLight);

  // Table
  const tableGeo = new THREE.PlaneGeometry(6, 4);
  const tableCanvas = createTableTexture();
  const tableMat = new THREE.MeshPhongMaterial({
    map: new THREE.CanvasTexture(tableCanvas),
    side: THREE.DoubleSide
  });
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.01;
  scene.add(table);

  // Card placeholders (face down)
  const backTex = createCardBackTexture(THREE);
  const cardGeo = new THREE.PlaneGeometry(1.2, 1.68);

  // Dragon card
  const dragonMat = new THREE.MeshPhongMaterial({ map: backTex.clone(), side: THREE.DoubleSide });
  dragonCard3D = new THREE.Mesh(cardGeo.clone(), dragonMat);
  dragonCard3D.position.set(-1.5, 0.01, 0);
  dragonCard3D.rotation.x = -Math.PI / 2;
  scene.add(dragonCard3D);

  // Tiger card
  const tigerMat = new THREE.MeshPhongMaterial({ map: backTex.clone(), side: THREE.DoubleSide });
  tigerCard3D = new THREE.Mesh(cardGeo.clone(), tigerMat);
  tigerCard3D.position.set(1.5, 0.01, 0);
  tigerCard3D.rotation.x = -Math.PI / 2;
  scene.add(tigerCard3D);

  // Start render loop
  animate();
}

function createTableTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 340;
  const ctx = canvas.getContext('2d');

  // Felt background
  ctx.fillStyle = '#0d2818';
  ctx.fillRect(0, 0, 512, 340);

  // Dragon area
  ctx.fillStyle = 'rgba(192,57,43,0.15)';
  ctx.fillRect(20, 20, 220, 300);
  ctx.strokeStyle = 'rgba(192,57,43,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, 220, 300);

  // Tiger area
  ctx.fillStyle = 'rgba(41,128,185,0.15)';
  ctx.fillRect(272, 20, 220, 300);
  ctx.strokeStyle = 'rgba(41,128,185,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(272, 20, 220, 300);

  // Labels
  ctx.font = 'bold 28px serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(192,57,43,0.6)';
  ctx.fillText('DRAGON', 130, 310);
  ctx.fillStyle = 'rgba(41,128,185,0.6)';
  ctx.fillText('TIGER', 382, 310);

  // Gold border
  ctx.strokeStyle = 'rgba(201,168,76,0.3)';
  ctx.lineWidth = 3;
  ctx.strokeRect(5, 5, 502, 330);

  return canvas;
}

function animate() {
  animationId = requestAnimationFrame(animate);

  // Update particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.mesh.position.add(p.velocity);
    p.velocity.y -= 0.002;
    p.life -= 0.02;
    p.mesh.material.opacity = Math.max(0, p.life);
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
}

// Dealing logic
dealBtn.addEventListener('click', () => {
  resumeAudio();
  if (dealing) return;
  if (!selectedBet) return;
  if (Chips.balance < betAmount) return;

  dealing = true;
  Chips.subtract(betAmount);

  // Reset cards to face-down
  const backTex = createCardBackTexture(THREE);
  dragonCard3D.material.map = backTex.clone();
  dragonCard3D.material.needsUpdate = true;
  dragonCard3D.rotation.z = 0;
  tigerCard3D.material.map = backTex.clone();
  tigerCard3D.material.needsUpdate = true;
  tigerCard3D.rotation.z = 0;

  // Shuffle deck if needed
  if (deck.length < 10) {
    deck = shuffleDeck(createDeck());
  }

  dragonCardData = deck.pop();
  tigerCardData = deck.pop();

  // Flip dragon card first
  setTimeout(() => {
    flipCard(dragonCard3D, dragonCardData, () => {
      cardFlip();
      // Flip tiger card
      setTimeout(() => {
        flipCard(tigerCard3D, tigerCardData, () => {
          cardFlip();
          setTimeout(() => resolveRound(), 500);
        });
      }, 400);
    });
  }, 300);
});

function flipCard(card3D, cardData, onComplete) {
  const frontTex = createCardTexture(THREE, cardData.suit, cardData.rank);
  let progress = 0;
  const startRotZ = 0;

  function step() {
    progress += 0.05;
    if (progress >= 1) {
      card3D.rotation.z = Math.PI;
      card3D.material.map = frontTex;
      card3D.material.needsUpdate = true;
      if (onComplete) onComplete();
      return;
    }

    card3D.rotation.z = startRotZ + Math.PI * progress;
    if (progress >= 0.5 && card3D.material.map !== frontTex) {
      card3D.material.map = frontTex;
      card3D.material.needsUpdate = true;
    }
    requestAnimationFrame(step);
  }
  step();
}

function resolveRound() {
  const dVal = dragonTigerValue(dragonCardData);
  const tVal = dragonTigerValue(tigerCardData);

  let result, payout = 0;

  if (dVal > tVal) {
    result = 'dragon';
  } else if (tVal > dVal) {
    result = 'tiger';
  } else {
    // Check suited tie
    if (dragonCardData.suit === tigerCardData.suit) {
      result = 'suited-tie';
    } else {
      result = 'tie';
    }
  }

  if (selectedBet === 'dragon' && result === 'dragon') {
    payout = betAmount * 2;
  } else if (selectedBet === 'tiger' && result === 'tiger') {
    payout = betAmount * 2;
  } else if (selectedBet === 'tie' && (result === 'tie' || result === 'suited-tie')) {
    payout = result === 'suited-tie' ? betAmount * 51 : betAmount * 9;
  } else if ((selectedBet === 'dragon' || selectedBet === 'tiger') && (result === 'tie' || result === 'suited-tie')) {
    // Tie: return 50% of bet
    payout = Math.floor(betAmount / 2);
  }

  if (payout > 0) {
    Chips.add(payout);
    win();
    spawnParticles(result === 'dragon' ? -1.5 : result === 'tiger' ? 1.5 : 0);
    showResult(
      payout > betAmount ? '🎉 WIN!' : 'PUSH',
      `+${formatNumber(payout)} chips`,
      'win'
    );
  } else {
    lose();
    showResult('LOSE', `${dragonCardData.rank}${dragonCardData.suit} vs ${tigerCardData.rank}${tigerCardData.suit}`, 'lose');
  }

  dealing = false;
}

function spawnParticles(x) {
  const colors = [0xc9a84c, 0xf0d080, 0xc0392b, 0x2980b9, 0xffffff];
  for (let i = 0; i < 20; i++) {
    const geo = new THREE.SphereGeometry(0.04, 4, 4);
    const mat = new THREE.MeshPhongMaterial({
      color: colors[Math.floor(Math.random() * colors.length)],
      transparent: true,
      opacity: 1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.5, 0);
    scene.add(mesh);
    particles.push({
      mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.08,
        Math.random() * 0.06 + 0.02,
        (Math.random() - 0.5) * 0.08
      ),
      life: 1
    });
  }
}

function showResult(title, text, cls) {
  resultTitle.textContent = title;
  resultTitle.className = cls;
  resultText.textContent = text;
  resultPopup.classList.add('show');
  setTimeout(() => resultPopup.classList.remove('show'), 2000);
}

function cleanup() {
  if (animationId) cancelAnimationFrame(animationId);
  if (renderer) disposeScene(scene, renderer);
}

// Resize handler
window.addEventListener('resize', () => {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Init
deck = shuffleDeck(createDeck());
initScene();
