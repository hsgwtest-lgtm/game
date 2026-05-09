/**
 * main.js — Terra Tower bootstrap & game loop
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
const btnSpawn       = document.getElementById('btn-spawn');
const scoreVal       = document.getElementById('score-val');
const fpsVal         = document.getElementById('fps-val');
const handPill       = document.getElementById('hand-pill');
const pinchDot       = document.getElementById('pinch-dot');
const videoEl        = document.getElementById('camera-video');
const canvasEl       = document.getElementById('three-canvas');

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

// FPS tracking
let lastTime = 0, frameCount = 0, fpsAccum = 0;

// ─── Depth calibration ───────────────────────────────────────────────────────
// camera.z = 18; world z = camera.z - depth
// depth=15 → world z≈3 (near side), depth=21 → world z≈-3 (far side)
const DEPTH_NEAR_DEFAULT = 15;   // world z ≈ +3 (front of block zone)
const DEPTH_FAR_DEFAULT  = 21;   // world z ≈ -3 (back of block zone)
const DEPTH_DEFAULT      = 18;   // world z ≈ 0 (scene centre, no calibration)

const GRAB_REACH = 2.5;  // world-space radius within which a block can be grabbed

let calibPhase    = 'near';   // 'near' | 'waitRelease' | 'far' | 'play'
let calibScaleNear = null;    // hand scale recorded at near position
let calibScaleFar  = null;    // hand scale recorded at far position
let currentDepth   = DEPTH_DEFAULT;

// ─── Entry point ─────────────────────────────────────────────────────────────
btnStart.addEventListener('click', startGame);

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
    // Show far step UI immediately so user sees what's next
    showCalibUI('far');
  } else if (calibPhase === 'far') {
    calibScaleFar = handScale;
    finishCalibration();
  }
}

function onCalibRelease() {
  // Advance from waitRelease → far only after user has released the pinch
  if (calibPhase === 'waitRelease') {
    calibPhase = 'far';
  }
}

function finishCalibration() {
  calibPhase = 'play';
  calibScreen.style.display = 'none';

  // If user calibrated near/far in the wrong order, swap them
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
  // t=1 → near (large scale, front), t=0 → far (small scale, back)
  const t = Math.max(0, Math.min(1,
    (handScale - calibScaleFar) / (calibScaleNear - calibScaleFar)
  ));
  return DEPTH_NEAR_DEFAULT * t + DEPTH_FAR_DEFAULT * (1 - t);
}

// ─── Begin gameplay ───────────────────────────────────────────────────────────
function beginPlay() {
  handTracker.onPinchStart = ({ nx, ny, handScale, handRoll }) => onPinchStart(nx, ny, handScale, handRoll);
  handTracker.onPinchEnd   = ({ nx, ny, handScale, handRoll }) => onPinchEnd(nx, ny, handScale, handRoll);
  handTracker.onPinchMove  = ({ nx, ny, handScale, handRoll }) => onPinchMove(nx, ny, handScale, handRoll);
  handTracker.onHandMove   = ({ nx, ny, handScale }) => {
    if (handTracker.isPinching) return; // onPinchMove handles position when pinching

    currentDepth = scaleToDepth(handScale);
    const worldPos = landmarkToWorld(nx, ny, currentDepth, renderer.camera);

    // Find the nearest grabbable block within reach as a grab preview
    let bestDist = GRAB_REACH;
    let bestIdx  = -1;
    for (let i = 0; i < objects.length; i++) {
      if (objects[i].isGrabbed) continue;
      const d = objects[i].mesh.position.distanceTo(worldPos);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    // Update preview highlight only when it changes
    if (previewIdx !== bestIdx) {
      clearPreviewHighlight();
      previewIdx = bestIdx;
      if (previewIdx !== -1) {
        objects[previewIdx].mesh.material.emissive.setHex(0x665500);
        objects[previewIdx].mesh.material.emissiveIntensity = 0.45;
      }
    }

    updatePinchDot(nx, ny, true, true); // show idle dot at hand position
  };

  spawnRandomBlock();
  spawnRandomBlock();
  spawnRandomBlock();

  btnSpawn.addEventListener('click', spawnRandomBlock);

  requestAnimationFrame(gameLoop);
}

// ─── Game loop ────────────────────────────────────────────────────────────────
function gameLoop(now) {
  requestAnimationFrame(gameLoop);

  // FPS
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  fpsAccum += dt;
  frameCount++;
  if (fpsAccum >= 0.5) {
    fpsVal.textContent = Math.round(frameCount / fpsAccum);
    fpsAccum = 0;
    frameCount = 0;
  }

  // Step physics (skip if dt is weird, e.g. first frame)
  if (dt > 0 && dt < 0.1) {
    physicsWorld.step();
  }

  physicsWorld.syncMeshes(objects);

  // Update score (highest block Y position above platform top)
  updateScore();

  // Update HUD hand status
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

  // Find the block closest to the pinch 3D position
  const worldPos = landmarkToWorld(nx, ny, currentDepth, renderer.camera);

  let bestDist = GRAB_REACH; // grab radius
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

    // Seed grab history for throw velocity tracking
    grabHistory = [{ x: worldPos.x, y: worldPos.y, z: worldPos.z, t: performance.now() }];

    // Visual feedback
    objects[bestIdx].mesh.material.emissive.setHex(0x664400);
    objects[bestIdx].mesh.material.emissiveIntensity = 0.5;
  }

  // Update pinch dot
  updatePinchDot(nx, ny, true);
}

function onPinchMove(nx, ny, handScale, handRoll) {
  updatePinchDot(nx, ny, true);

  if (grabbedIdx === -1) return;

  currentDepth = scaleToDepth(handScale);
  const worldPos = landmarkToWorld(nx, ny, currentDepth, renderer.camera);
  physicsWorld.setKinematicPosition(objects[grabbedIdx].handle, worldPos);
  objects[grabbedIdx].mesh.position.copy(worldPos);

  // Track position history (keep last ~5 frames) for throw velocity
  const now = performance.now();
  grabHistory.push({ x: worldPos.x, y: worldPos.y, z: worldPos.z, t: now });
  if (grabHistory.length > 5) grabHistory.shift();

  // Apply hand roll to the grabbed object so it tilts with the hand.
  // handRoll > 0 = clockwise (physical) but appears counterclockwise in the
  // CSS-mirrored video; the block should match the visual appearance, so we
  // apply +sin instead of -sin to align with the mirrored view.
  // Quaternion half-angle formula: q = (axis * sin(θ/2), cos(θ/2))
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

  // Compute throw velocity from recent grab position history
  if (grabHistory.length >= 2) {
    const first = grabHistory[0];
    const last  = grabHistory[grabHistory.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt > 0.01) {  // require at least 10 ms of history for a meaningful velocity estimate
      const THROW_SCALE = 1.5;
      const MAX_SPEED   = 25;  // world units/s; keeps blocks within the platform area
      let vx = (last.x - first.x) / dt * THROW_SCALE;
      let vy = (last.y - first.y) / dt * THROW_SCALE;
      let vz = (last.z - first.z) / dt * THROW_SCALE;
      // Clamp to a maximum speed
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
  // Mirror nx because video is CSS-mirrored
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
    const y = obj.mesh.position.y - 0.2; // subtract base top
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
  // Spawn above the platform at a random XZ
  const pos = {
    x: (Math.random() - 0.5) * 6,
    y: 8 + Math.random() * 2,
    z: (Math.random() - 0.5) * 6,
  };
  const obj = spawnBlock(type, pos, physicsWorld, renderer);
  objects.push(obj);

  // Remove blocks that fall off (y < -5) — checked each frame lazily
  setTimeout(() => cleanupFallen(), 10000);
}

function cleanupFallen() {
  // Reset preview index first since splicing will invalidate it
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
