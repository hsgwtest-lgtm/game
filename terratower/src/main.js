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

// ─── State ───────────────────────────────────────────────────────────────────
let renderer, physicsWorld, handTracker;
const objects = [];       // [{type, handle, mesh, isGrabbed}]
let grabbedIdx = -1;      // index into objects[]
let prevGrabPos = null;   // for velocity estimation
let score = 0;

// FPS tracking
let lastTime = 0, frameCount = 0, fpsAccum = 0;

// Grab depth (Z-distance from camera when block was grabbed)
const GRAB_DEPTH = 8;

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

  // Wire up hand callbacks
  handTracker.onPinchStart = ({ nx, ny }) => onPinchStart(nx, ny);
  handTracker.onPinchEnd   = ({ nx, ny }) => onPinchEnd(nx, ny);
  handTracker.onPinchMove  = ({ nx, ny }) => onPinchMove(nx, ny);

  handTracker.start();

  // Spawn a few starter blocks
  spawnRandomBlock();
  spawnRandomBlock();
  spawnRandomBlock();

  btnSpawn.addEventListener('click', spawnRandomBlock);

  hideLoading();
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
  }

  renderer.render();
}

// ─── Pinch interaction ────────────────────────────────────────────────────────
function onPinchStart(nx, ny) {
  // Find the block closest to the pinch 3D position
  const worldPos = landmarkToWorld(nx, ny, GRAB_DEPTH, renderer.camera);

  let bestDist = 2.5; // grab radius
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
    prevGrabPos = worldPos.clone();

    // Visual feedback
    objects[bestIdx].mesh.material.emissive.setHex(0x664400);
    objects[bestIdx].mesh.material.emissiveIntensity = 0.5;
  }

  // Update pinch dot
  updatePinchDot(nx, ny, true);
}

function onPinchMove(nx, ny) {
  updatePinchDot(nx, ny, true);

  if (grabbedIdx === -1) return;

  const worldPos = landmarkToWorld(nx, ny, GRAB_DEPTH, renderer.camera);
  physicsWorld.setKinematicPosition(objects[grabbedIdx].handle, worldPos);
  objects[grabbedIdx].mesh.position.copy(worldPos);

  prevGrabPos = worldPos.clone();
}

function onPinchEnd(nx, ny) {
  updatePinchDot(nx, ny, false);
  pinchDot.style.display = 'none';

  if (grabbedIdx === -1) return;

  const obj = objects[grabbedIdx];
  obj.isGrabbed = false;

  // Estimate throw velocity from camera motion (simple: zero for now;
  // Rapier will compute from kinematic delta automatically)
  physicsWorld.releaseBody(obj.handle);

  obj.mesh.material.emissive.setHex(0x000000);
  obj.mesh.material.emissiveIntensity = 0;

  grabbedIdx = -1;
  prevGrabPos = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function updatePinchDot(nx, ny, visible) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Mirror nx because video is CSS-mirrored
  pinchDot.style.left = ((1 - nx) * w) + 'px';
  pinchDot.style.top  = (ny * h) + 'px';
  pinchDot.style.display = visible ? 'block' : 'none';
  pinchDot.classList.toggle('grabbing', visible && grabbedIdx !== -1);
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
