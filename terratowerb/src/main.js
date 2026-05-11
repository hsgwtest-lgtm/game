/**
 * main.js — Terra Tower β  (WebXR AR version)
 *
 * Flow:
 *  1. Page load → init Three.js renderer with xr.enabled = true.
 *  2. User taps "AR START" → requestSession('immersive-ar', {hit-test}).
 *  3. Every XR frame → run hit test from viewer centre → update reticle position.
 *  4. First floor detection → set Cannon-es ground height, spawn 3 blocks.
 *  5. Screen tap → grab nearest block (horizontal proximity to reticle) or release held block.
 *  6. While grabbed → block follows reticle position (held 15 cm above floor).
 *  7. Release tap → block goes dynamic, Cannon-es physics drops it onto the stack.
 *  8. Score = max block height above detected floor (in centimetres).
 */
import * as THREE from 'https://esm.sh/three@0.176.0';
import { PhysicsWorld } from './physics.js';
import { spawnBlock, BLOCK_TYPES } from './objects.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const startScreen    = document.getElementById('start-screen');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMsg     = document.getElementById('loading-msg');
const btnArStart     = document.getElementById('btn-ar-start');
const btnSpawn       = document.getElementById('btn-spawn');
const btnExitAr      = document.getElementById('btn-exit-ar');
const scoreVal       = document.getElementById('score-val');
const fpsVal         = document.getElementById('fps-val');
const modePill       = document.getElementById('mode-pill');
const hudEl          = document.getElementById('hud');
const arNotSupported = document.getElementById('ar-not-supported');
const canvasEl       = document.getElementById('three-canvas');

// ─── Three.js globals ────────────────────────────────────────────────────────
let scene, camera, renderer;
let reticleMesh;

// ─── WebXR state ─────────────────────────────────────────────────────────────
let xrSession    = null;
let hitTestSource = null;
let xrRefSpace   = null;   // reference space used for hit-test pose resolution
let isReticleHit = false;
const reticleWorldPos = new THREE.Vector3();

// ─── Physics & game state ────────────────────────────────────────────────────
let physicsWorld;
const objects   = [];  // [{type, id, mesh, color, isGrabbed}]
let grabbedIdx  = -1;
let floorY      = null; // Y of the real-world floor in XR reference-space coords

// Velocity tracking while holding (for a gentle toss on release)
let holdHistory  = [];  // [{x,y,z,t}]

let score       = 0;
let lastTime    = 0;
let frameCount  = 0, fpsAccum = 0;

// ─── Three.js initialisation ─────────────────────────────────────────────────

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);

  // Lights — bright ambient so blocks look natural in varied real-world lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dir = new THREE.DirectionalLight(0xffeedd, 1.0);
  dir.position.set(5, 10, 5);
  scene.add(dir);

  // Reticle — a flat ring that sits on the detected floor
  const ringGeo = new THREE.RingGeometry(0.09, 0.12, 36);
  ringGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x58a6ff, side: THREE.DoubleSide });
  reticleMesh = new THREE.Mesh(ringGeo, ringMat);
  reticleMesh.visible = false;
  reticleMesh.matrixAutoUpdate = false;
  scene.add(reticleMesh);

  // Add a grab-dot indicator inside the HUD (shows grabbing state)
  // (element is already in HTML; just reference it via setGrabDot helper)

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ─── WebXR support check ─────────────────────────────────────────────────────

async function checkXRSupport() {
  if (!navigator.xr) {
    arNotSupported.style.display = '';
    btnArStart.disabled = true;
    return;
  }
  const supported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!supported) {
    arNotSupported.style.display = '';
    btnArStart.disabled = true;
  }
}

// ─── Start AR session ────────────────────────────────────────────────────────

btnArStart.addEventListener('click', startAR);

async function startAR() {
  showLoading('ARセッション開始中...');

  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.getElementById('app') },
    });

    xrSession = session;

    // Use 'local' reference space — origin at initial camera position, Y-up
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);

    xrRefSpace = await session.requestReferenceSpace('local');

    // Request hit-test source from the viewer (screen-centre ray)
    const viewerSpace = await session.requestReferenceSpace('viewer');
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

    session.addEventListener('end', onSessionEnd);

    // Touch listener — single tap toggles grab / release
    canvasEl.addEventListener('touchstart', onTouchStart, { passive: false });
    // Also listen on the whole document so the HUD doesn't block taps
    document.addEventListener('touchstart', onTouchStart, { passive: false });

    // Initialise physics world
    physicsWorld = new PhysicsWorld();

    startScreen.style.display = 'none';
    hudEl.style.display = 'flex';
    hideLoading();

    renderer.setAnimationLoop(xrLoop);

  } catch (err) {
    hideLoading();
    console.error('AR session error:', err);
    alert('ARセッションの開始に失敗しました:\n' + err.message);
  }
}

// ─── XR render loop ──────────────────────────────────────────────────────────

function xrLoop(time, frame) {
  const dt = lastTime > 0 ? Math.min((time - lastTime) / 1000, 0.1) : 0;
  lastTime = time;

  // FPS
  fpsAccum += dt;
  frameCount++;
  if (fpsAccum >= 0.5) {
    fpsVal.textContent = Math.round(frameCount / fpsAccum);
    fpsAccum = 0;
    frameCount = 0;
  }

  // ── Hit Test ──────────────────────────────────────────────────────────────
  isReticleHit = false;
  if (frame && hitTestSource) {
    const results = frame.getHitTestResults(hitTestSource);
    if (results.length > 0) {
      const pose = results[0].getPose(xrRefSpace);
      if (pose) {
        reticleMesh.visible = true;
        reticleMesh.matrix.fromArray(pose.transform.matrix);
        reticleMesh.matrixWorldNeedsUpdate = true;
        reticleWorldPos.setFromMatrixPosition(reticleMesh.matrix);
        isReticleHit = true;

        // On first floor detection — set physics ground, spawn initial blocks
        if (floorY === null) {
          floorY = reticleWorldPos.y;
          physicsWorld.setFloorY(floorY);
          modePill.textContent = '📍 床を検出しました';
          spawnRandomBlock();
          spawnRandomBlock();
          spawnRandomBlock();
        }
      }
    }
    if (!isReticleHit) {
      reticleMesh.visible = false;
    }
  }

  // ── Grabbed block follows reticle ─────────────────────────────────────────
  if (grabbedIdx !== -1 && isReticleHit) {
    const hx = reticleWorldPos.x;
    const hy = reticleWorldPos.y + 0.18;   // hold 0.18 m (18 cm) above detected floor
    const hz = reticleWorldPos.z;
    physicsWorld.setKinematicPosition(objects[grabbedIdx].id, { x: hx, y: hy, z: hz });
    objects[grabbedIdx].mesh.position.set(hx, hy, hz);

    // Track recent positions for throw velocity on release
    holdHistory.push({ x: hx, y: hy, z: hz, t: time });
    if (holdHistory.length > 6) holdHistory.shift();
  }

  // ── Physics step ──────────────────────────────────────────────────────────
  if (dt > 0) {
    physicsWorld.step(dt);
  }

  // ── Sync Three.js meshes from physics ─────────────────────────────────────
  physicsWorld.syncMeshes(objects);

  // ── Score ─────────────────────────────────────────────────────────────────
  if (floorY !== null) {
    updateScore();
  }

  renderer.render(scene, camera);
}

// ─── Touch interaction ───────────────────────────────────────────────────────

function onTouchStart(e) {
  // Ignore taps on HUD buttons (they have their own handlers)
  if (e.target.closest('#btn-spawn, #btn-exit-ar')) return;
  e.preventDefault();

  if (grabbedIdx !== -1) {
    // Release the held block
    releaseBlock();
  } else {
    // Attempt to grab the nearest block to the reticle
    tryGrab();
  }
}

function tryGrab() {
  if (!isReticleHit) return;

  const GRAB_RADIUS = 0.35; // metres horizontal reach
  let bestDist = GRAB_RADIUS;
  let bestIdx  = -1;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj.isGrabbed) continue;
    const dx = obj.mesh.position.x - reticleWorldPos.x;
    const dz = obj.mesh.position.z - reticleWorldPos.z;
    const d  = Math.sqrt(dx * dx + dz * dz);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }

  if (bestIdx !== -1) {
    grabbedIdx = bestIdx;
    objects[bestIdx].isGrabbed = true;
    physicsWorld.grabBody(objects[bestIdx].id);
    holdHistory = [{ ...objects[bestIdx].mesh.position, t: performance.now() }];

    objects[bestIdx].mesh.material.emissive.setHex(0x664400);
    objects[bestIdx].mesh.material.emissiveIntensity = 0.5;

    modePill.textContent = '🤏 掴んでいる';
    setGrabDot(true);
    navigator.vibrate?.(30);
  }
}

function releaseBlock() {
  if (grabbedIdx === -1) return;

  const obj = objects[grabbedIdx];
  obj.isGrabbed = false;

  // Apply throw velocity from recent hold history
  if (holdHistory.length >= 2) {
    const first = holdHistory[0];
    const last  = holdHistory[holdHistory.length - 1];
    const dt    = (last.t - first.t) / 1000;
    if (dt > 0.01) {
      const THROW_SCALE = 1.2;
      const MAX_SPEED   = 8;  // m/s cap
      let vx = (last.x - first.x) / dt * THROW_SCALE;
      let vy = (last.y - first.y) / dt * THROW_SCALE;
      let vz = (last.z - first.z) / dt * THROW_SCALE;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > MAX_SPEED) {
        const s = MAX_SPEED / speed;
        vx *= s; vy *= s; vz *= s;
      }
      physicsWorld.releaseBodyWithVelocity(obj.id, { x: vx, y: vy, z: vz });
    } else {
      physicsWorld.releaseBody(obj.id);
    }
  } else {
    physicsWorld.releaseBody(obj.id);
  }

  holdHistory = [];
  obj.mesh.material.emissive.setHex(0x000000);
  obj.mesh.material.emissiveIntensity = 0;
  grabbedIdx = -1;

  modePill.textContent = isReticleHit ? '📍 床を検出しました' : '🔍 床を探しています';
  setGrabDot(false);
}

// ─── Block spawning ──────────────────────────────────────────────────────────

function spawnRandomBlock() {
  if (floorY === null) return;  // wait until floor is known

  const type = BLOCK_TYPES[Math.floor(Math.random() * BLOCK_TYPES.length)];

  // Spread blocks slightly around the reticle or default to origin XZ
  const cx = isReticleHit ? reticleWorldPos.x : 0;
  const cz = isReticleHit ? reticleWorldPos.z : 0;
  const spread = 0.15;
  const pos = {
    x: cx + (Math.random() - 0.5) * spread,
    y: floorY + 0.25 + Math.random() * 0.2,
    z: cz + (Math.random() - 0.5) * spread,
  };

  const obj = spawnBlock(type, pos, physicsWorld, scene);
  objects.push(obj);

  // Lazy cleanup: remove blocks that have fallen far below the floor
  setTimeout(() => cleanupFallen(), 15000);
}

btnSpawn.addEventListener('click', (e) => {
  e.stopPropagation();
  spawnRandomBlock();
});

// ─── Session end / cleanup ───────────────────────────────────────────────────

btnExitAr.addEventListener('click', (e) => {
  e.stopPropagation();
  xrSession?.end();
});

function onSessionEnd() {
  renderer.setAnimationLoop(null);

  hitTestSource?.cancel();
  hitTestSource  = null;
  xrRefSpace     = null;
  xrSession      = null;

  canvasEl.removeEventListener('touchstart', onTouchStart);
  document.removeEventListener('touchstart', onTouchStart);

  // Clear all blocks and physics bodies
  for (const obj of objects) {
    scene.remove(obj.mesh);
    physicsWorld?.removeBody(obj.id);
  }
  objects.length = 0;
  physicsWorld = null;

  grabbedIdx  = -1;
  floorY      = null;
  holdHistory = [];
  score       = 0;
  scoreVal.textContent = '0';
  modePill.textContent = '🔍 床を探しています';

  reticleMesh.visible   = false;
  hudEl.style.display   = 'none';
  startScreen.style.display = 'flex';
  setGrabDot(false);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function updateScore() {
  let maxH = 0;
  for (const obj of objects) {
    const h = obj.mesh.position.y - floorY;
    if (h > maxH) maxH = h;
  }
  const newScore = Math.max(0, Math.floor(maxH * 100)); // cm above floor
  if (newScore !== score) {
    score = newScore;
    scoreVal.textContent = score;
  }
}

function cleanupFallen() {
  if (floorY === null) return;
  for (let i = objects.length - 1; i >= 0; i--) {
    if (objects[i].mesh.position.y < floorY - 1.5) {
      if (i === grabbedIdx) { grabbedIdx = -1; setGrabDot(false); }
      else if (i < grabbedIdx) { grabbedIdx--; }
      scene.remove(objects[i].mesh);
      physicsWorld.removeBody(objects[i].id);
      objects.splice(i, 1);
    }
  }
}

function setGrabDot(grabbing) {
  const dot = document.getElementById('grab-dot');
  if (!dot) return;
  dot.style.display = grabbing ? 'block' : 'none';
  dot.classList.toggle('grabbing', grabbing);
}

function showLoading(msg) {
  loadingMsg.textContent = msg;
  loadingOverlay.classList.add('visible');
}
function hideLoading() {
  loadingOverlay.classList.remove('visible');
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
initThree();
checkXRSupport();
