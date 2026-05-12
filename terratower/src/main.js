/**
 * main.js — Terra Tower bootstrap & game loop (AR upgrade)
 */
import { Renderer }     from './renderer.js';
import { initRapier, PhysicsWorld } from './physics.js';
import { HandTracker }  from './hands.js';
import { spawnBlock, BLOCK_TYPES } from './objects.js';
import { landmarkToWorld } from './coords.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const startScreen    = document.getElementById('start-screen');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMsg     = document.getElementById('loading-msg');
const btnStart       = document.getElementById('btn-start');
const btnModeNormal  = document.getElementById('btn-mode-normal');
const btnModeAr      = document.getElementById('btn-mode-ar');
const btnSpawn       = document.getElementById('btn-spawn');
const btnToggleMode  = document.getElementById('btn-toggle-mode');
const scoreVal       = document.getElementById('score-val');
const fpsVal         = document.getElementById('fps-val');
const handPill       = document.getElementById('hand-pill');
const pinchDot       = document.getElementById('pinch-dot');
const videoEl        = document.getElementById('camera-video');
const canvasEl       = document.getElementById('three-canvas');
const arBadge        = document.getElementById('ar-badge');
const btnResetView   = document.getElementById('btn-reset-view');

// Calibration screen elements
const calibScreen      = document.getElementById('calib-screen');
const calibTitle       = document.getElementById('calib-title');
const calibDesc        = document.getElementById('calib-desc');
const calibStepEl      = document.getElementById('calib-step');
const calibHandStatus  = document.getElementById('calib-hand-status');
const calibIndicator   = document.getElementById('calib-indicator');
const btnCalibSkip     = document.getElementById('btn-calib-skip');

// ─── State ───────────────────────────────────────────────────────────────────
let renderer, physicsWorld, handTracker;
const objects = [];       // [{type, handle, mesh, isGrabbed}]
let grabbedIdx = -1;      // index into objects[]
let grabHistory = [];     // [{x,y,z,t}] recent positions for throw velocity
let score = 0;
let previewIdx = -1;  // index of block currently highlighted as grab preview

// AR / device-orientation
let arOrientationEnabled = false;
let gameMode = 'normal';  // 'normal' | 'ar'

// Stored reference to the orientation handler so the listener can be removed
let _orientationHandler = null;

// FPS tracking
let lastTime = 0, frameCount = 0, fpsAccum = 0;

// ─── Depth calibration ───────────────────────────────────────────────────────
// depth = distance along camera's forward axis (world units)
// Larger value = object is farther from the camera
const DEPTH_NEAR_DEFAULT = 15;
const DEPTH_FAR_DEFAULT  = 21;
const DEPTH_DEFAULT      = 18;

const GRAB_REACH = 2.5;  // world-space radius within which a block can be grabbed

let calibPhase    = 'near';   // 'near' | 'waitRelease' | 'far' | 'play'
let calibScaleNear = null;
let calibScaleFar  = null;
let currentDepth   = DEPTH_DEFAULT;

// ─── Start-screen mode selection ─────────────────────────────────────────────
btnModeNormal.addEventListener('click', () => {
  gameMode = 'normal';
  btnModeNormal.classList.add('active');
  btnModeAr.classList.remove('active');
});
btnModeAr.addEventListener('click', () => {
  gameMode = 'ar';
  btnModeAr.classList.add('active');
  btnModeNormal.classList.remove('active');
});

// ─── Entry point ─────────────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  // Request DeviceOrientationEvent permission FIRST — must happen synchronously
  // within (or immediately following) the user gesture on iOS 13+.
  if (gameMode === 'ar') {
    arOrientationEnabled = await requestOrientationPermission();
  }
  startGame();
});

// ─── Device-orientation permission (iOS 13+) ─────────────────────────────────
async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent?.requestPermission !== 'function') {
    // Not iOS 13+ — orientation events are available without asking
    return ('DeviceOrientationEvent' in window);
  }
  try {
    const result = await DeviceOrientationEvent.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

// ─── Device-orientation listener ─────────────────────────────────────────────
function setupDeviceOrientation() {
  if (!arOrientationEnabled || !renderer) return;

  renderer.enableAR();

  // Remove any previously registered handler before adding a new one
  removeDeviceOrientationListener();

  _orientationHandler = (e) => {
    if (!renderer) return;
    // Prefer screen.orientation.angle; fall back to the deprecated window.orientation
    const screenAngle = (window.screen?.orientation?.angle) ?? (window.orientation ?? 0);
    renderer.applyDeviceOrientation(e.alpha, e.beta, e.gamma, screenAngle);
  };
  window.addEventListener('deviceorientation', _orientationHandler, true);

  // Show AR badge
  if (arBadge) arBadge.style.display = 'flex';

  // Reset-view button
  if (btnResetView) {
    btnResetView.style.display = 'block';
  }
}

function removeDeviceOrientationListener() {
  if (_orientationHandler) {
    window.removeEventListener('deviceorientation', _orientationHandler, true);
    _orientationHandler = null;
  }
}

async function startGame() {
  startScreen.style.display = 'none';
  showLoading('物理エンジン初期化中...');

  try {
    await initRapier();
  } catch (err) {
    alert('物理エンジンの読み込みに失敗しました: ' + err.message);
    startScreen.style.display = '';
    hideLoading();
    return;
  }

  physicsWorld = new PhysicsWorld();
  renderer = new Renderer(canvasEl);

  showLoading('カメラ・AI初期化中...');
  handTracker = new HandTracker(videoEl);

  try {
    await handTracker.init(msg => { loadingMsg.textContent = msg; });
  } catch (err) {
    alert('カメラまたはAIモデルの初期化に失敗しました:\n' + err.message);
    startScreen.style.display = '';
    hideLoading();
    return;
  }

  handTracker.start();

  // Enable device-orientation AR control now that the renderer is ready
  setupDeviceOrientation();

  hideLoading();

  // Begin depth calibration before game starts
  beginCalibration();
}

// ─── Calibration phase ────────────────────────────────────────────────────────
function beginCalibration() {
  calibPhase = 'near';
  showCalibUI('near');
  calibScreen.style.display = 'flex';

  handTracker.onPinchStart = onCalibPinch;
  handTracker.onPinchEnd   = onCalibRelease;
  handTracker.onPinchMove  = null;

  btnCalibSkip.addEventListener('click', skipCalibration);

  requestAnimationFrame(calibLoop);
}

function calibLoop() {
  if (calibPhase === 'play') return;

  if (handTracker.detected) {
    const scale = handTracker.lastHandScale || 0;
    calibHandStatus.textContent = '✋ 手を検出中';
    // Scale the indicator dot: map scale 0.05–0.30 → 40–120 px
    const size = Math.round(40 + Math.min(1, Math.max(0, (scale - 0.05) / 0.25)) * 80);
    calibIndicator.style.width  = size + 'px';
    calibIndicator.style.height = size + 'px';
    calibIndicator.classList.add('detected');
  } else {
    calibHandStatus.textContent = '手が検出されていません';
    calibIndicator.classList.remove('detected');
  }

  requestAnimationFrame(calibLoop);
}

function showCalibUI(step) {
  if (step === 'near') {
    calibTitle.textContent   = '① 手前の設定';
    calibDesc.textContent    = '手をカメラに近づけて、ピンチ（🤏）してください';
    calibStepEl.textContent  = '1';
  } else {
    calibTitle.textContent   = '② 奥の設定';
    calibDesc.textContent    = '手をカメラから遠ざけて、ピンチ（🤏）してください';
    calibStepEl.textContent  = '2';
  }
}

function onCalibPinch({ handScale }) {
  if (calibPhase === 'near') {
    calibScaleNear = handScale;
    calibPhase = 'waitRelease';
    showCalibUI('far');
  } else if (calibPhase === 'far') {
    calibScaleFar = handScale;
    finishCalibration();
  }
}

function onCalibRelease() {
  if (calibPhase === 'waitRelease') {
    calibPhase = 'far';
  }
}

function finishCalibration() {
  calibPhase = 'play';
  calibScreen.style.display = 'none';

  if (calibScaleNear !== null && calibScaleFar !== null &&
      calibScaleNear < calibScaleFar) {
    [calibScaleNear, calibScaleFar] = [calibScaleFar, calibScaleNear];
  }

  beginPlay();
}

function skipCalibration() {
  calibPhase     = 'play';
  calibScaleNear = null;
  calibScaleFar  = null;
  currentDepth   = DEPTH_DEFAULT;
  calibScreen.style.display = 'none';
  beginPlay();
}

/** Map current hand scale to a world-space depth value. */
function scaleToDepth(handScale) {
  if (calibScaleNear === null || calibScaleFar === null ||
      calibScaleNear === calibScaleFar) {
    return DEPTH_DEFAULT;
  }
  const t = Math.max(0, Math.min(1,
    (handScale - calibScaleFar) / (calibScaleNear - calibScaleFar)
  ));
  return DEPTH_FAR_DEFAULT * t + DEPTH_NEAR_DEFAULT * (1 - t);
}

// ─── Begin gameplay ───────────────────────────────────────────────────────────
function beginPlay() {
  handTracker.onPinchStart = ({ nx, ny, handScale, handRoll }) => onPinchStart(nx, ny, handScale, handRoll);
  handTracker.onPinchEnd   = ({ nx, ny, handScale, handRoll }) => onPinchEnd(nx, ny, handScale, handRoll);
  handTracker.onPinchMove  = ({ nx, ny, handScale, handRoll }) => onPinchMove(nx, ny, handScale, handRoll);
  handTracker.onHandMove   = ({ nx, ny, handScale }) => {
    if (handTracker.isPinching) return;

    currentDepth = scaleToDepth(handScale);
    const worldPos = landmarkToWorld(nx, ny, currentDepth, renderer.camera);

    let bestDist = GRAB_REACH;
    let bestIdx  = -1;
    for (let i = 0; i < objects.length; i++) {
      if (objects[i].isGrabbed) continue;
      const d = objects[i].mesh.position.distanceTo(worldPos);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    if (previewIdx !== bestIdx) {
      clearPreviewHighlight();
      previewIdx = bestIdx;
      if (previewIdx !== -1) {
        objects[previewIdx].mesh.material.emissive.setHex(0x665500);
        objects[previewIdx].mesh.material.emissiveIntensity = 0.45;
      }
    }

    updatePinchDot(nx, ny, true, true);
  };

  spawnRandomBlock();
  spawnRandomBlock();
  spawnRandomBlock();

  btnSpawn.addEventListener('click', spawnRandomBlock);
  btnResetView.addEventListener('click', () => renderer?.resetAROrientation());

  // Show mode-toggle button and set initial label
  updateModeToggleUI();
  btnToggleMode.style.display = 'block';
  btnToggleMode.addEventListener('click', toggleMode);

  requestAnimationFrame(gameLoop);
}

// ─── In-game mode toggle ─────────────────────────────────────────────────────
async function toggleMode() {
  if (gameMode === 'ar') {
    // Switch to normal (fixed camera)
    gameMode = 'normal';
    removeDeviceOrientationListener();
    renderer.disableAR();
    arBadge.style.display   = 'none';
    btnResetView.style.display = 'none';
  } else {
    // Switch to AR
    if (!arOrientationEnabled) {
      arOrientationEnabled = await requestOrientationPermission();
    }
    if (!arOrientationEnabled) {
      alert('デバイスの向きセンサーの許可が必要です。ブラウザの設定でセンサーアクセスを許可してください。');
      return;
    }
    gameMode = 'ar';
    setupDeviceOrientation();
    arBadge.style.display      = 'flex';
    btnResetView.style.display = 'block';
  }
  updateModeToggleUI();
}

function updateModeToggleUI() {
  btnToggleMode.textContent = gameMode === 'ar' ? '🎮 通常モード' : '📡 ARモード';
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function gameLoop(now) {
  requestAnimationFrame(gameLoop);

  const dt = (now - lastTime) / 1000;
  lastTime = now;
  fpsAccum += dt;
  frameCount++;
  if (fpsAccum >= 0.5) {
    fpsVal.textContent = Math.round(frameCount / fpsAccum);
    fpsAccum = 0;
    frameCount = 0;
  }

  if (dt > 0 && dt < 0.1) {
    physicsWorld.step();
  }

  physicsWorld.syncMeshes(objects);

  updateScore();

  if (handTracker.detected) {
    handPill.textContent = handTracker.isPinching ? '🤏 掴んでいる' : '✋ 検出済み';
  } else {
    handPill.textContent = '✋ 検出中...';
    clearPreviewHighlight();
    pinchDot.style.display = 'none';
  }

  renderer.render();
}

// ─── Pinch interaction ────────────────────────────────────────────────────────
function onPinchStart(nx, ny, handScale, handRoll) {
  clearPreviewHighlight();
  currentDepth = scaleToDepth(handScale);

  const worldPos = landmarkToWorld(nx, ny, currentDepth, renderer.camera);

  let bestDist = GRAB_REACH;
  let bestIdx  = -1;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj.isGrabbed) continue;
    const d = obj.mesh.position.distanceTo(worldPos);
    if (d < bestDist) {
      bestDist = d;
      bestIdx  = i;
    }
  }

  if (bestIdx !== -1) {
    grabbedIdx = bestIdx;
    objects[bestIdx].isGrabbed = true;
    physicsWorld.grabBody(objects[bestIdx].handle);

    grabHistory = [{ x: worldPos.x, y: worldPos.y, z: worldPos.z, t: performance.now() }];

    objects[bestIdx].mesh.material.emissive.setHex(0x664400);
    objects[bestIdx].mesh.material.emissiveIntensity = 0.5;
  }

  updatePinchDot(nx, ny, true);
}

function onPinchMove(nx, ny, handScale, handRoll) {
  updatePinchDot(nx, ny, true);

  if (grabbedIdx === -1) return;

  currentDepth = scaleToDepth(handScale);
  const worldPos = landmarkToWorld(nx, ny, currentDepth, renderer.camera);
  physicsWorld.setKinematicPosition(objects[grabbedIdx].handle, worldPos);
  objects[grabbedIdx].mesh.position.copy(worldPos);

  const now = performance.now();
  grabHistory.push({ x: worldPos.x, y: worldPos.y, z: worldPos.z, t: now });
  if (grabHistory.length > 5) grabHistory.shift();

  const halfRoll = handRoll / 2;
  physicsWorld.setKinematicRotation(objects[grabbedIdx].handle, {
    x: 0,
    y: 0,
    z:  Math.sin(halfRoll),
    w:  Math.cos(halfRoll),
  });
}

function onPinchEnd(nx, ny, handScale, handRoll) {
  updatePinchDot(nx, ny, false);
  pinchDot.style.display = 'none';

  if (grabbedIdx === -1) return;

  const obj = objects[grabbedIdx];
  obj.isGrabbed = false;

  if (grabHistory.length >= 2) {
    const first = grabHistory[0];
    const last  = grabHistory[grabHistory.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt > 0.01) {
      const THROW_SCALE = 1.5;
      const MAX_SPEED   = 25;
      let vx = (last.x - first.x) / dt * THROW_SCALE;
      let vy = (last.y - first.y) / dt * THROW_SCALE;
      let vz = (last.z - first.z) / dt * THROW_SCALE;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > MAX_SPEED) {
        const s = MAX_SPEED / speed;
        vx *= s; vy *= s; vz *= s;
      }
      physicsWorld.releaseBodyWithVelocity(obj.handle, { x: vx, y: vy, z: vz });
    } else {
      physicsWorld.releaseBody(obj.handle);
    }
  } else {
    physicsWorld.releaseBody(obj.handle);
  }
  grabHistory = [];

  obj.mesh.material.emissive.setHex(0x000000);
  obj.mesh.material.emissiveIntensity = 0;

  grabbedIdx = -1;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function updatePinchDot(nx, ny, visible, isIdle = false) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  pinchDot.style.left = ((1 - nx) * w) + 'px';
  pinchDot.style.top  = (ny * h) + 'px';
  pinchDot.style.display = visible ? 'block' : 'none';
  pinchDot.classList.toggle('grabbing', visible && !isIdle && grabbedIdx !== -1);
  pinchDot.classList.toggle('idle', visible && isIdle);
}

function clearPreviewHighlight() {
  if (previewIdx !== -1) {
    const obj = objects[previewIdx];
    if (obj && !obj.isGrabbed) {
      obj.mesh.material.emissive.setHex(0x000000);
      obj.mesh.material.emissiveIntensity = 0;
    }
    previewIdx = -1;
  }
}

function updateScore() {
  let maxY = 0;
  for (const obj of objects) {
    const y = obj.mesh.position.y - 0.2;
    if (y > maxY) maxY = y;
  }
  const newScore = Math.max(0, Math.floor(maxY * 10));
  if (newScore !== score) {
    score = newScore;
    scoreVal.textContent = score;
  }
}

function spawnRandomBlock() {
  const type = BLOCK_TYPES[Math.floor(Math.random() * BLOCK_TYPES.length)];
  const pos = {
    x: (Math.random() - 0.5) * 6,
    y: 8 + Math.random() * 2,
    z: (Math.random() - 0.5) * 6,
  };
  const obj = spawnBlock(type, pos, physicsWorld, renderer);
  objects.push(obj);

  setTimeout(() => cleanupFallen(), 10000);
}

function cleanupFallen() {
  clearPreviewHighlight();
  for (let i = objects.length - 1; i >= 0; i--) {
    if (objects[i].mesh.position.y < -5) {
      renderer.remove(objects[i].mesh);
      physicsWorld.removeBody(objects[i].handle);
      objects.splice(i, 1);
    }
  }
}

function showLoading(msg) {
  loadingMsg.textContent = msg;
  loadingOverlay.classList.add('visible');
}
function hideLoading() {
  loadingOverlay.classList.remove('visible');
}
