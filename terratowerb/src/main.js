/**
 * main.js — Terra Tower β  (Camera AR version, iOS Safari compatible)
 *
 * Flow:
 *  1. Page load → init Three.js renderer (xr.enabled = false).
 *  2. User taps "AR START" → request DeviceOrientation permission (iOS),
 *     then getUserMedia for the rear camera → stream to <video>.
 *  3. Every frame → update camera quaternion from DeviceOrientationEvent,
 *     cast a ray to the virtual floor plane, position reticle there.
 *  4. First tap → set floor Y = -1.2 m, spawn 3 blocks.
 *  5. Screen tap → grab nearest block (horizontal proximity to reticle) or release held block.
 *  6. While grabbed → block follows reticle position (held 18 cm above floor).
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
const arVideoEl      = document.getElementById('ar-video');

// ─── Three.js globals ────────────────────────────────────────────────────────
let scene, camera, renderer;
let reticleMesh;

// ─── Camera stream ────────────────────────────────────────────────────────────
let cameraStream = null;

// ─── Device orientation state ────────────────────────────────────────────────
let deviceAlpha = 0, deviceBeta = 0, deviceGamma = 0;
window.addEventListener('deviceorientation', (e) => {
  deviceAlpha = e.alpha ?? 0;
  deviceBeta  = e.beta  ?? 0;
  deviceGamma = e.gamma ?? 0;
});

// ─── Reticle state ────────────────────────────────────────────────────────────
let isReticleHit = false;
const reticleWorldPos = new THREE.Vector3();

// Raycaster for floor-plane intersection (reused each frame)
const _raycaster    = new THREE.Raycaster();
const _screenCenter = new THREE.Vector2(0, 0);
const _floorPlane   = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// ─── Physics & game state ────────────────────────────────────────────────────
let physicsWorld;
const objects  = [];   // [{type, id, mesh, color, isGrabbed}]
let grabbedIdx = -1;
let floorY     = null; // Y of the virtual floor in world coords
let floorSet   = false;

// Velocity tracking while holding (for a gentle toss on release)
let holdHistory = [];  // [{x,y,z,t}]

let score      = 0;
let lastTime   = 0;
let frameCount = 0, fpsAccum = 0;

// ─── Three.js initialisation ─────────────────────────────────────────────────

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = false;

  scene  = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
  camera.position.set(0, 0, 0);

  // Lights — bright ambient so blocks look natural in varied real-world lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dir = new THREE.DirectionalLight(0xffeedd, 1.0);
  dir.position.set(5, 10, 5);
  scene.add(dir);

  // Reticle — a flat ring that sits on the virtual floor
  const ringGeo = new THREE.RingGeometry(0.09, 0.12, 36);
  ringGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x58a6ff, side: THREE.DoubleSide });
  reticleMesh = new THREE.Mesh(ringGeo, ringMat);
  reticleMesh.visible = false;
  scene.add(reticleMesh);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ─── Camera support check ────────────────────────────────────────────────────

async function checkCameraSupport() {
  if (!navigator.mediaDevices?.getUserMedia) {
    arNotSupported.style.display = '';
    btnArStart.disabled = true;
  }
}

// ─── Start AR session ────────────────────────────────────────────────────────

btnArStart.addEventListener('click', startAR);

async function startAR() {
  showLoading('カメラ起動中...');

  try {
    // Request DeviceOrientation permission on iOS 13+
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== 'granted') {
        throw new Error('デバイスの向きセンサーへのアクセスが拒否されました。');
      }
    }

    // Get rear camera stream
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    arVideoEl.srcObject = cameraStream;

    // Initialise physics world
    physicsWorld = new PhysicsWorld();

    // Touch listeners — single tap toggles grab / release
    canvasEl.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchstart', onTouchStart, { passive: false });

    startScreen.style.display = 'none';
    hudEl.style.display = 'flex';
    hideLoading();

    renderer.setAnimationLoop(mainLoop);

  } catch (err) {
    hideLoading();
    console.error('AR start error:', err);
    alert('カメラへのアクセスを許可してください:\n' + err.message);
  }
}

// ─── Camera orientation from DeviceOrientationEvent ─────────────────────────

function updateCameraFromOrientation() {
  // deviceBeta - 90: converts portrait-held device (beta≈90°) to forward-looking camera.
  // -deviceGamma: negates roll so left/right tilt maps correctly in Y-up world.
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(deviceBeta - 90),
    THREE.MathUtils.degToRad(deviceAlpha),
    THREE.MathUtils.degToRad(-deviceGamma),
    'YXZ'
  );
  camera.quaternion.setFromEuler(euler);
}

// ─── Reticle: cast screen-centre ray to virtual floor plane ─────────────────

function updateReticlePos() {
  if (!floorSet) {
    isReticleHit = false;
    reticleMesh.visible = false;
    return;
  }
  _raycaster.setFromCamera(_screenCenter, camera);
  _floorPlane.constant = -floorY;  // plane equation: y - floorY = 0
  const hit = _raycaster.ray.intersectPlane(_floorPlane, reticleWorldPos);
  if (hit) {
    isReticleHit = true;
    reticleMesh.position.copy(reticleWorldPos);
    reticleMesh.visible = true;
  } else {
    isReticleHit = false;
    reticleMesh.visible = false;
  }
}

// ─── Main render loop (replaces WebXR xrLoop) ───────────────────────────────

function mainLoop(time) {
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

  // Update camera rotation from device orientation
  updateCameraFromOrientation();

  // Update reticle position (floor-plane intersection)
  updateReticlePos();

  // ── Grabbed block follows reticle ─────────────────────────────────────────
  if (grabbedIdx !== -1 && isReticleHit) {
    const hx = reticleWorldPos.x;
    const hy = reticleWorldPos.y + 0.18;   // hold 18 cm above floor
    const hz = reticleWorldPos.z;
    physicsWorld.setKinematicPosition(objects[grabbedIdx].id, { x: hx, y: hy, z: hz });
    objects[grabbedIdx].mesh.position.set(hx, hy, hz);

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
  if (floorSet) {
    updateScore();
  }

  renderer.render(scene, camera);
}

// ─── First tap: set virtual floor ────────────────────────────────────────────

function onFirstTap() {
  if (floorSet) return;
  // Assume the floor is ~1.2 m below the camera (device held at chest/eye level).
  // Users should tap while holding the device at roughly chest height.
  floorY  = -1.2;
  floorSet = true;
  physicsWorld.setFloorY(floorY);
  spawnRandomBlock();
  spawnRandomBlock();
  spawnRandomBlock();
  modePill.textContent = '📍 床を設定しました';
}

// ─── Touch interaction ───────────────────────────────────────────────────────

function onTouchStart(e) {
  // Ignore taps on HUD buttons (they have their own handlers)
  if (e.target.closest('#btn-spawn, #btn-exit-ar')) return;
  e.preventDefault();

  // First tap sets the floor
  if (!floorSet) {
    onFirstTap();
    return;
  }

  if (grabbedIdx !== -1) {
    releaseBlock();
  } else {
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

  modePill.textContent = '📍 床を設定しました';
  setGrabDot(false);
}

// ─── Block spawning ──────────────────────────────────────────────────────────

function spawnRandomBlock() {
  if (!floorSet) return;

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

  setTimeout(() => cleanupFallen(), 15000);
}

btnSpawn.addEventListener('click', (e) => {
  e.stopPropagation();
  spawnRandomBlock();
});

// ─── Session stop / cleanup ──────────────────────────────────────────────────

btnExitAr.addEventListener('click', (e) => {
  e.stopPropagation();
  stopAR();
});

function stopAR() {
  renderer.setAnimationLoop(null);

  // Stop camera stream
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    arVideoEl.srcObject = null;
  }

  canvasEl.removeEventListener('touchstart', onTouchStart);
  document.removeEventListener('touchstart', onTouchStart);

  // Clear all blocks and physics bodies
  for (const obj of objects) {
    scene.remove(obj.mesh);
    physicsWorld?.removeBody(obj.id);
  }
  objects.length = 0;
  physicsWorld = null;

  grabbedIdx   = -1;
  floorY       = null;
  floorSet     = false;
  holdHistory  = [];
  score        = 0;
  scoreVal.textContent = '0';
  modePill.textContent = '🔍 床を探しています';

  reticleMesh.visible       = false;
  hudEl.style.display       = 'none';
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
  if (!floorSet) return;
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
checkCameraSupport();
