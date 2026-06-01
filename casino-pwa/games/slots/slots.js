import * as THREE from 'three';
import { Chips } from '../../js/chips.js';
import { resumeAudio, chipBet, win, lose, jackpot } from '../../js/audio.js';
import { disposeScene, updateBalanceDisplay, formatNumber } from '../../js/utils.js';

const SYMBOLS = ['🍒', '🔔', '💎', '7️⃣', '⭐', '🃏'];
const SYMBOL_COLORS = {
  '🍒': '#e74c3c',
  '🔔': '#f39c12',
  '💎': '#3498db',
  '7️⃣': '#e74c3c',
  '⭐': '#f1c40f',
  '🃏': '#9b59b6'
};

const PAYOUTS = {
  '💎💎💎': 50,
  '7️⃣7️⃣7️⃣': 20,
  '🔔🔔🔔': 10,
  '🍒🍒🍒': 5,
  '⭐⭐⭐': 3,
  '🃏🃏🃏': 2
};

// State
let betAmount = 50;
let spinning = false;
let scene, camera, renderer, animationId;
let reels = []; // 3 reel groups
let reelResults = [0, 0, 0];
let flashLight;
let particles = [];

const REEL_SYMBOLS = 12; // symbols per reel
const SYMBOL_HEIGHT = 1.2;
const REEL_CIRCUMFERENCE = REEL_SYMBOLS * SYMBOL_HEIGHT;

// DOM
const container = document.getElementById('canvasContainer');
const balanceDisplay = document.getElementById('balanceDisplay');
const spinBtn = document.getElementById('spinBtn');
const winDisplay = document.getElementById('winDisplay');
const winText = document.getElementById('winText');
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

// Create symbol texture
function createSymbolTexture(symbol) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0e0e18';
  ctx.fillRect(0, 0, 256, 256);

  // Border
  ctx.strokeStyle = 'rgba(201,168,76,0.2)';
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, 240, 240);

  // Symbol
  ctx.font = '120px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, 128, 128);

  return new THREE.CanvasTexture(canvas);
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f);

  camera = new THREE.OrthographicCamera(-3, 3, 2.5, -2.5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  flashLight = new THREE.PointLight(0xf0d080, 0, 15);
  flashLight.position.set(0, 0, 5);
  scene.add(flashLight);

  // Machine frame
  const frameMat = new THREE.MeshPhongMaterial({ color: 0x1a1a2e });
  const frameGeo = new THREE.BoxGeometry(6.5, 4.5, 0.3);
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.z = -0.5;
  scene.add(frame);

  // Gold trim
  const trimMat = new THREE.MeshPhongMaterial({ color: 0xc9a84c, emissive: 0x3a2a0c });
  const trims = [
    { pos: [0, 2.35, -0.3], scale: [6.7, 0.1, 0.4] },
    { pos: [0, -2.35, -0.3], scale: [6.7, 0.1, 0.4] },
    { pos: [-3.35, 0, -0.3], scale: [0.1, 4.7, 0.4] },
    { pos: [3.35, 0, -0.3], scale: [0.1, 4.7, 0.4] }
  ];
  for (const t of trims) {
    const geo = new THREE.BoxGeometry(...t.scale);
    const mesh = new THREE.Mesh(geo, trimMat);
    mesh.position.set(...t.pos);
    scene.add(mesh);
  }

  // Reel dividers
  for (let i = -1; i <= 1; i += 2) {
    const div = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 4, 0.2),
      new THREE.MeshPhongMaterial({ color: 0x2a2a3a })
    );
    div.position.set(i * 1.05, 0, -0.1);
    scene.add(div);
  }

  // Create reels
  for (let r = 0; r < 3; r++) {
    const reelGroup = new THREE.Group();
    reelGroup.position.x = (r - 1) * 2.1;

    const reelSymbols = [];
    for (let s = 0; s < REEL_SYMBOLS; s++) {
      const sym = SYMBOLS[s % SYMBOLS.length];
      const tex = createSymbolTexture(sym);
      const mat = new THREE.MeshPhongMaterial({ map: tex });
      const geo = new THREE.PlaneGeometry(1.8, SYMBOL_HEIGHT);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = s * SYMBOL_HEIGHT;
      mesh.userData.symbolIndex = s % SYMBOLS.length;
      reelGroup.add(mesh);
      reelSymbols.push(mesh);
    }

    scene.add(reelGroup);
    reels.push({ group: reelGroup, symbols: reelSymbols, speed: 0, targetY: 0 });
  }

  // Payline indicator
  const lineMat = new THREE.MeshPhongMaterial({ color: 0xc9a84c, transparent: true, opacity: 0.4 });
  const lineGeo = new THREE.PlaneGeometry(6.4, 0.04);
  const line = new THREE.Mesh(lineGeo, lineMat);
  line.position.z = 0.1;
  scene.add(line);

  animate();
}

function animate() {
  animationId = requestAnimationFrame(animate);

  // Reel spinning animation
  for (const reel of reels) {
    if (reel.speed > 0) {
      reel.group.position.y -= reel.speed;

      // Wrap symbols
      for (const sym of reel.symbols) {
        const worldY = sym.position.y + reel.group.position.y;
        if (worldY < -SYMBOL_HEIGHT * 2) {
          sym.position.y += REEL_CIRCUMFERENCE;
        }
      }
    }
  }

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.mesh.position.add(p.velocity);
    p.velocity.y -= 0.003;
    p.life -= 0.015;
    p.mesh.material.opacity = Math.max(0, p.life);
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }

  // Flash light decay
  if (flashLight.intensity > 0) {
    flashLight.intensity *= 0.95;
    if (flashLight.intensity < 0.01) flashLight.intensity = 0;
  }

  renderer.render(scene, camera);
}

// Spin
spinBtn.addEventListener('click', () => {
  resumeAudio();
  if (spinning) return;
  if (Chips.balance < betAmount) return;

  spinning = true;
  chipBet();
  Chips.subtract(betAmount);
  winDisplay.style.display = 'none';

  // Random results
  for (let r = 0; r < 3; r++) {
    reelResults[r] = Math.floor(Math.random() * SYMBOLS.length);
  }

  // Start spinning
  reels.forEach((reel, i) => {
    reel.speed = 0.3 + Math.random() * 0.1;

    // Stop staggered
    setTimeout(() => {
      stopReel(reel, reelResults[i], () => {
        if (i === 2) {
          // All reels stopped
          setTimeout(() => checkResult(), 200);
        }
      });
    }, 1000 + i * 500);
  });
});

function stopReel(reel, targetSymbol, onDone) {
  // Decelerate
  const decelerate = () => {
    reel.speed *= 0.92;
    if (reel.speed < 0.01) {
      reel.speed = 0;
      // Snap to symbol
      snapToSymbol(reel, targetSymbol);
      if (onDone) onDone();
      return;
    }
    requestAnimationFrame(decelerate);
  };
  decelerate();
}

function snapToSymbol(reel, symbolIndex) {
  // Find the symbol and position group so it's centered at y=0
  const targetSym = reel.symbols.find(s => s.userData.symbolIndex === symbolIndex);
  if (targetSym) {
    reel.group.position.y = -targetSym.position.y;
  }
}

function checkResult() {
  const r0 = SYMBOLS[reelResults[0]];
  const r1 = SYMBOLS[reelResults[1]];
  const r2 = SYMBOLS[reelResults[2]];
  const combo = r0 + r1 + r2;

  let payout = 0;
  if (PAYOUTS[combo]) {
    payout = betAmount * PAYOUTS[combo];
  } else {
    // Check for any cherry
    const cherryCount = [r0, r1, r2].filter(s => s === '🍒').length;
    if (cherryCount >= 1) payout = betAmount;
  }

  if (payout > 0) {
    Chips.add(payout);
    flashLight.intensity = 3;

    if (payout >= betAmount * 20) {
      jackpot();
      spawnParticles(30);
      showResult('🎰 JACKPOT!', `+${formatNumber(payout)} chips`, 'win');
    } else {
      win();
      spawnParticles(15);
      showResult('🎉 WIN!', `${r0} ${r1} ${r2} — +${formatNumber(payout)}`, 'win');
    }

    winDisplay.style.display = '';
    winText.textContent = `+${formatNumber(payout)}`;
  } else {
    lose();
  }

  spinning = false;
}

function spawnParticles(count) {
  const colors = [0xc9a84c, 0xf0d080, 0xe74c3c, 0xf1c40f, 0x3498db];
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.06, 4, 4);
    const mat = new THREE.MeshPhongMaterial({
      color: colors[Math.floor(Math.random() * colors.length)],
      transparent: true,
      opacity: 1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 2,
      1
    );
    scene.add(mesh);
    particles.push({
      mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.08,
        Math.random() * 0.08 + 0.02,
        (Math.random() - 0.5) * 0.04
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
  setTimeout(() => resultPopup.classList.remove('show'), 2500);
}

function cleanup() {
  if (animationId) cancelAnimationFrame(animationId);
  if (renderer) disposeScene(scene, renderer);
}

window.addEventListener('resize', () => {
  if (!camera || !renderer) return;
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -3 * aspect;
  camera.right = 3 * aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

initScene();
