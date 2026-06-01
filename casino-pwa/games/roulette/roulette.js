import * as THREE from 'three';
import { Chips } from '../../js/chips.js';
import { resumeAudio, rouletteRoll, win, lose } from '../../js/audio.js';
import { disposeScene, updateBalanceDisplay, formatNumber } from '../../js/utils.js';

// European wheel order
const WHEEL_NUMBERS = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,
  11,30,8,23,10,5,24,16,33,1,20,14,31,9,
  22,18,29,7,28,12,35,3,26
];

const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

function isRed(n) { return RED_NUMBERS.includes(n); }
function isBlack(n) { return n > 0 && !isRed(n); }

// Bet types and payouts
const BET_CHECK = {
  red:    n => isRed(n),
  black:  n => isBlack(n),
  odd:    n => n > 0 && n % 2 === 1,
  even:   n => n > 0 && n % 2 === 0,
  low:    n => n >= 1 && n <= 18,
  high:   n => n >= 19 && n <= 36,
  dozen1: n => n >= 1 && n <= 12,
  dozen2: n => n >= 13 && n <= 24,
  dozen3: n => n >= 25 && n <= 36,
};

const BET_PAYOUT = {
  red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
  dozen1: 2, dozen2: 2, dozen3: 2,
  straight: 35
};

// State
let betAmount = 50;
let selectedBets = []; // [{type, number?}]
let spinning = false;
let scene, camera, renderer, animationId;
let wheel, ball;
let wheelAngle = 0, ballAngle = 0, ballRadius = 2.2;
let ballSpeed = 0, wheelSpeed = 0;
let spinPhase = 'idle'; // idle, spinning, decelerating, done

// DOM
const container = document.getElementById('canvasContainer');
const balanceDisplay = document.getElementById('balanceDisplay');
const spinBtn = document.getElementById('spinBtn');
const resultNumber = document.getElementById('resultNumber');
const resultNum = document.getElementById('resultNum');
const numberGrid = document.getElementById('numberGrid');
const resultPopup = document.getElementById('resultPopup');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');

updateBalanceDisplay(balanceDisplay, Chips.balance);
Chips.onChange(b => updateBalanceDisplay(balanceDisplay, b));

document.getElementById('backBtn').addEventListener('click', () => {
  cleanup();
  location.href = '../../index.html';
});

document.querySelectorAll('.chip-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    betAmount = parseInt(btn.dataset.amount, 10);
  });
});

// Build number grid
function buildNumberGrid() {
  // Zero
  const zeroBtn = document.createElement('button');
  zeroBtn.className = 'bet-cell num-green';
  zeroBtn.textContent = '0';
  zeroBtn.dataset.bet = 'straight';
  zeroBtn.dataset.number = '0';
  zeroBtn.style.gridColumn = '1 / -1';
  numberGrid.appendChild(zeroBtn);

  for (let n = 1; n <= 36; n++) {
    const btn = document.createElement('button');
    btn.className = `bet-cell ${isRed(n) ? 'num-red' : 'num-black'}`;
    btn.textContent = n;
    btn.dataset.bet = 'straight';
    btn.dataset.number = String(n);
    numberGrid.appendChild(btn);
  }
}
buildNumberGrid();

// Bet selection
document.getElementById('bettingBoard').addEventListener('click', (e) => {
  const cell = e.target.closest('.bet-cell');
  if (!cell || spinning) return;

  cell.classList.toggle('selected');
  const betType = cell.dataset.bet;
  const number = cell.dataset.number ? parseInt(cell.dataset.number, 10) : null;

  const existing = selectedBets.findIndex(b =>
    b.type === betType && b.number === number
  );
  if (existing >= 0) {
    selectedBets.splice(existing, 1);
  } else {
    selectedBets.push({ type: betType, number });
  }
});

// Three.js
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 5, 4);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, 8, 3);
  dirLight.castShadow = true;
  scene.add(dirLight);

  const goldLight = new THREE.PointLight(0xc9a84c, 0.6, 15);
  goldLight.position.set(0, 4, 0);
  scene.add(goldLight);

  // Wheel base
  const baseGeo = new THREE.CylinderGeometry(2.8, 2.8, 0.15, 64);
  const baseMat = new THREE.MeshPhongMaterial({ color: 0x2a1a0a });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.receiveShadow = true;
  scene.add(base);

  // Wheel
  wheel = new THREE.Group();

  const wheelGeo = new THREE.CylinderGeometry(2.5, 2.5, 0.3, 64);
  const wheelTex = createWheelTexture();
  const wheelMat = new THREE.MeshPhongMaterial({
    map: new THREE.CanvasTexture(wheelTex)
  });
  const wheelMesh = new THREE.Mesh(wheelGeo, wheelMat);
  wheelMesh.castShadow = true;
  wheelMesh.receiveShadow = true;
  wheel.add(wheelMesh);

  // Center cone
  const coneGeo = new THREE.ConeGeometry(0.3, 0.5, 16);
  const coneMat = new THREE.MeshPhongMaterial({ color: 0xc9a84c, shininess: 100 });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.y = 0.4;
  wheel.add(cone);

  // Pocket dividers (simplified)
  for (let i = 0; i < 37; i++) {
    const angle = (i / 37) * Math.PI * 2;
    const divGeo = new THREE.BoxGeometry(0.02, 0.15, 0.3);
    const divMat = new THREE.MeshPhongMaterial({ color: 0xc9a84c });
    const div = new THREE.Mesh(divGeo, divMat);
    div.position.set(Math.cos(angle) * 2.2, 0.2, Math.sin(angle) * 2.2);
    div.rotation.y = -angle + Math.PI / 2;
    wheel.add(div);
  }

  wheel.position.y = 0.15;
  scene.add(wheel);

  // Ball
  const ballGeo = new THREE.SphereGeometry(0.08, 12, 12);
  const ballMat = new THREE.MeshPhongMaterial({ color: 0xeeeeee, shininess: 100 });
  ball = new THREE.Mesh(ballGeo, ballMat);
  ball.castShadow = true;
  ball.position.set(2.2, 0.5, 0);
  scene.add(ball);

  animate();
}

function createWheelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const cx = 256, cy = 256, r = 250;

  // Background
  ctx.fillStyle = '#1a0a00';
  ctx.fillRect(0, 0, 512, 512);

  // Draw sectors on the top face
  const n = WHEEL_NUMBERS.length;
  for (let i = 0; i < n; i++) {
    const startAngle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const endAngle = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const num = WHEEL_NUMBERS[i];

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.closePath();

    if (num === 0) ctx.fillStyle = '#27ae60';
    else if (isRed(num)) ctx.fillStyle = '#c0392b';
    else ctx.fillStyle = '#1a1a2e';
    ctx.fill();

    // Number text
    const midAngle = (startAngle + endAngle) / 2;
    const tx = cx + Math.cos(midAngle) * r * 0.78;
    const ty = cy + Math.sin(midAngle) * r * 0.78;
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(midAngle + Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(num), 0, 5);
    ctx.restore();

    // Sector border
    ctx.strokeStyle = 'rgba(201,168,76,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(startAngle) * r, cy + Math.sin(startAngle) * r);
    ctx.stroke();
  }

  // Center circle
  ctx.beginPath();
  ctx.arc(cx, cy, 60, 0, Math.PI * 2);
  ctx.fillStyle = '#2a1a0a';
  ctx.fill();
  ctx.strokeStyle = '#c9a84c';
  ctx.lineWidth = 2;
  ctx.stroke();

  return canvas;
}

function animate() {
  animationId = requestAnimationFrame(animate);

  if (spinPhase === 'spinning') {
    wheelAngle += wheelSpeed;
    ballAngle += ballSpeed;
    wheel.rotation.y = wheelAngle;

    // Ball position
    ball.position.x = Math.cos(ballAngle) * ballRadius;
    ball.position.z = Math.sin(ballAngle) * ballRadius;
    ball.position.y = 0.5;

    // Decelerate ball
    ballSpeed *= 0.998;
    if (ballSpeed < 0.08) {
      spinPhase = 'decelerating';
    }
  } else if (spinPhase === 'decelerating') {
    wheelAngle += wheelSpeed;
    ballAngle += ballSpeed;
    wheel.rotation.y = wheelAngle;

    ballSpeed *= 0.99;
    ballRadius -= 0.003;
    ball.position.x = Math.cos(ballAngle) * Math.max(1.8, ballRadius);
    ball.position.z = Math.sin(ballAngle) * Math.max(1.8, ballRadius);
    ball.position.y = 0.35 + (ballRadius - 1.8) * 0.2;

    wheelSpeed *= 0.997;

    if (ballSpeed < 0.01 && wheelSpeed < 0.005) {
      spinPhase = 'done';
      wheelSpeed = 0;
      ballSpeed = 0;
      resolveResult();
    }
  }

  // Camera slowly orbits during spin
  if (spinPhase === 'spinning' || spinPhase === 'decelerating') {
    const camAngle = Date.now() * 0.0002;
    camera.position.x = Math.sin(camAngle) * 4;
    camera.position.z = Math.cos(camAngle) * 4;
    camera.position.y = 5;
    camera.lookAt(0, 0, 0);
  }

  renderer.render(scene, camera);
}

// Spin
spinBtn.addEventListener('click', () => {
  resumeAudio();
  if (spinning) return;
  if (selectedBets.length === 0) return;

  const totalBet = selectedBets.length * betAmount;
  if (Chips.balance < totalBet) return;

  spinning = true;
  Chips.subtract(totalBet);
  resultNumber.style.display = 'none';
  rouletteRoll();

  // Start spin
  ballAngle = Math.random() * Math.PI * 2;
  ballRadius = 2.2;
  ballSpeed = 0.15 + Math.random() * 0.08;
  wheelSpeed = 0.03 + Math.random() * 0.02;
  spinPhase = 'spinning';
});

function resolveResult() {
  // Determine winning number from ball angle relative to wheel
  const relAngle = ((ballAngle - wheelAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const sectorIndex = Math.floor(relAngle / (Math.PI * 2) * 37) % 37;
  const winNumber = WHEEL_NUMBERS[sectorIndex];

  // Show result number
  resultNumber.style.display = '';
  resultNum.textContent = winNumber;
  resultNum.className = winNumber === 0 ? 'green' : isRed(winNumber) ? 'red' : 'black';

  // Calculate winnings
  let totalWin = 0;
  for (const bet of selectedBets) {
    let won = false;
    if (bet.type === 'straight') {
      won = bet.number === winNumber;
    } else if (BET_CHECK[bet.type]) {
      won = BET_CHECK[bet.type](winNumber);
    }
    if (won) {
      totalWin += betAmount + betAmount * BET_PAYOUT[bet.type];
    }
  }

  if (totalWin > 0) {
    Chips.add(totalWin);
    win();
    const colorName = winNumber === 0 ? 'Green' : isRed(winNumber) ? 'Red' : 'Black';
    showResult('🎉 WIN!', `${winNumber} ${colorName} — +${formatNumber(totalWin)}`, 'win');
  } else {
    lose();
    const colorName = winNumber === 0 ? 'Green' : isRed(winNumber) ? 'Red' : 'Black';
    showResult('No luck', `${winNumber} ${colorName}`, 'lose');
  }

  // Clear bets
  selectedBets = [];
  document.querySelectorAll('.bet-cell.selected').forEach(c => c.classList.remove('selected'));

  // Reset camera
  camera.position.set(0, 5, 4);
  camera.lookAt(0, 0, 0);

  spinning = false;
}

function showResult(title, text, cls) {
  resultTitle.textContent = title;
  resultTitle.className = cls;
  resultText.textContent = text;
  resultPopup.classList.add('show');
  setTimeout(() => resultPopup.classList.remove('show'), 3000);
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

initScene();
