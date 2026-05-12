/**
 * Mesh3D – 1枚の写真からオブジェクトの背面を推定し完全な3Dメッシュを生成
 *
 * Pipeline:
 *  1. 画像ロード → 512px以下にリサイズ (iOS メモリ対策)
 *  2. Transformers.js v3 (Depth-Anything-Small / WebGPU or WASM FP16) で深度マップ取得
 *  3. 深度マップ → 前面・背面・側面の BufferGeometry を生成 (Depth Displacement Mesh)
 *  4. 元画像をテクスチャとして前面に投影、ミラー反転を背面に適用
 *  5. Three.js で OrbitControls 付きシーンに表示
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';

// ─── iOS / WebKit memory optimisations ───────────────────────────────────────
const MAX_IMG_SIZE    = 512;   // リサイズ上限 (px)
const MESH_SEGMENTS   = 64;    // フロント面グリッド解像度
const DEPTH_SCALE     = 0.45;  // Z 方向の変位スケール
const MODEL_ID        = 'onnx-community/depth-anything-v2-small';
const MODEL_DTYPE     = 'fp16'; // FP16 でメモリ節約

// WebGPU 利用可能なら使用し、なければ WASM にフォールバック
env.backends.onnx.wasm.proxy = false;

// ─── Progress / Status ────────────────────────────────────────────────────────
const progressBar   = document.getElementById('progress-bar');
const progressFill  = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const statusBadge   = document.getElementById('status-badge');

function setProgress(pct, label) {
  progressFill.style.width = `${pct}%`;
  progressLabel.textContent = label;
  progressBar.classList.toggle('hidden', pct >= 100);
}

function setStatus(text, type = 'idle') {
  statusBadge.textContent = text;
  statusBadge.className = `status-badge status-${type}`;
}

// ─── Three.js Scene Setup ─────────────────────────────────────────────────────
const canvas   = document.getElementById('three-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a14);

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
camera.position.set(0, 0, 3.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor  = 0.08;
controls.minDistance    = 0.5;
controls.maxDistance    = 8;
controls.autoRotate     = false;
controls.autoRotateSpeed = 1.5;

// Lighting
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1.5, 2, 2.5);
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x8899ff, 0.4);
fillLight.position.set(-2, -1, -1);
scene.add(fillLight);

// Resize handler
function onResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// Render loop
(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

// ─── Depth Estimation Pipeline ────────────────────────────────────────────────
let depthPipeline = null;

async function initModel() {
  setStatus('モデル読込中…', 'loading');
  setProgress(5, 'モデルをダウンロード中…');
  try {
    const device = navigator.gpu ? 'webgpu' : 'wasm';
    depthPipeline = await pipeline('depth-estimation', MODEL_ID, {
      device,
      dtype: MODEL_DTYPE,
      progress_callback: ({ progress, status, file }) => {
        if (progress != null) {
          setProgress(Math.round(progress * 0.6), `${file ?? 'モデル'} 読込: ${Math.round(progress)}%`);
        }
      }
    });
    setProgress(100, '');
    setStatus('準備完了', 'ready');
  } catch (err) {
    console.error('Model load failed:', err);
    setStatus('モデル読込失敗', 'error');
    setProgress(100, '');
  }
}

// ─── Image Helpers ────────────────────────────────────────────────────────────
/**
 * HTMLImageElement / File → canvas の ImageData (リサイズ済み)
 * @param {HTMLImageElement|File} src
 * @returns {{ canvas: HTMLCanvasElement, width: number, height: number }}
 */
async function loadAndResize(src) {
  let img;
  if (src instanceof File) {
    img = await fileToImage(src);
  } else {
    img = src;
  }

  let w = img.naturalWidth  || img.width;
  let h = img.naturalHeight || img.height;
  if (w > MAX_IMG_SIZE || h > MAX_IMG_SIZE) {
    const scale = MAX_IMG_SIZE / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const offscreen = document.createElement('canvas');
  offscreen.width  = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: offscreen, width: w, height: h };
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── Depth Map Estimation ─────────────────────────────────────────────────────
/**
 * Returns a Float32Array of depth values in [0,1], same dimensions as the input.
 * @param {HTMLCanvasElement} imgCanvas
 * @returns {Float32Array}
 */
async function estimateDepth(imgCanvas) {
  const dataURL = imgCanvas.toDataURL('image/jpeg', 0.9);
  const rawImage = await RawImage.fromURL(dataURL);
  const result   = await depthPipeline(rawImage);

  // result.depth is a Tensor2D [H, W]; values are relative depth (higher = closer)
  const depthTensor = result.depth;
  const data  = depthTensor.data;  // Float32Array or similar
  const len   = data.length;

  // Normalise to [0, 1]
  let dMin = Infinity, dMax = -Infinity;
  for (let i = 0; i < len; i++) {
    if (data[i] < dMin) dMin = data[i];
    if (data[i] > dMax) dMax = data[i];
  }
  const range  = dMax - dMin || 1;
  const norm   = new Float32Array(len);
  for (let i = 0; i < len; i++) norm[i] = (data[i] - dMin) / range;
  return norm;
}

// ─── Mesh Builder ─────────────────────────────────────────────────────────────

/**
 * Bilinear sample of a depth map.
 */
function sampleDepth(depthNorm, mapW, mapH, u, v) {
  const px = u * (mapW - 1);
  const py = (1 - v) * (mapH - 1);
  const x0 = Math.floor(px), x1 = Math.min(x0 + 1, mapW - 1);
  const y0 = Math.floor(py), y1 = Math.min(y0 + 1, mapH - 1);
  const tx = px - x0, ty = py - y0;
  const d00 = depthNorm[y0 * mapW + x0];
  const d10 = depthNorm[y0 * mapW + x1];
  const d01 = depthNorm[y1 * mapW + x0];
  const d11 = depthNorm[y1 * mapW + x1];
  return d00 * (1 - tx) * (1 - ty) + d10 * tx * (1 - ty) +
         d01 * (1 - tx) * ty       + d11 * tx * ty;
}

/**
 * Build a depth-displaced front surface.
 * Vertices are on a MESH_SEGMENTS × MESH_SEGMENTS grid in XY, displaced in Z.
 */
function buildFrontGeometry(depthNorm, mapW, mapH) {
  const segs = MESH_SEGMENTS;
  const geo  = new THREE.PlaneGeometry(2, 2, segs, segs);
  const pos  = geo.attributes.position;
  const uv   = geo.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const d = sampleDepth(depthNorm, mapW, mapH, u, v);
    pos.setZ(i, d * DEPTH_SCALE);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a flat back plane slightly behind the object.
 * Uses mirrored UVs (horizontally flipped) so the texture reads as a reflection.
 */
function buildBackGeometry() {
  const segs = 8;
  const geo  = new THREE.PlaneGeometry(2, 2, segs, segs);
  // Rotate to face backwards
  geo.rotateY(Math.PI);
  // Shift to back
  geo.translate(0, 0, -DEPTH_SCALE * 0.15);
  // UVs are already mirrored by the Y-rotation (U flips)
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build side wall geometry connecting the front face edges to the back plane.
 *
 * Each of the 4 edges (top / bottom / left / right) is sampled from the
 * depth-displaced front surface and extruded back to z = backZ.
 *
 * @param {Float32Array} depthNorm
 * @param {number} mapW
 * @param {number} mapH
 * @returns {THREE.BufferGeometry}
 */
function buildSideGeometry(depthNorm, mapW, mapH) {
  const segs  = MESH_SEGMENTS;
  const backZ = -DEPTH_SCALE * 0.15;

  const positions = [];
  const normals   = [];
  const uvs       = [];
  const indices   = [];

  /**
   * Append one side strip.
   * edgePts: Array of {x, y, z, u, v} – front edge vertices from low to high
   * dir: outward normal direction {x, y, z}
   * mirrorU: flip U when sampling back edge
   */
  function addStrip(edgePts, outNormal) {
    const base = positions.length / 3;
    const n    = edgePts.length;

    for (let i = 0; i < n; i++) {
      const p = edgePts[i];
      // Front vertex (index base + i*2)
      positions.push(p.x, p.y, p.z);
      normals.push(outNormal.x, outNormal.y, outNormal.z);
      uvs.push(p.u, p.v);

      // Back vertex (index base + i*2+1)
      positions.push(p.x, p.y, backZ);
      normals.push(outNormal.x, outNormal.y, outNormal.z);
      uvs.push(p.u, p.v);
    }

    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      const b = base + i * 2 + 1;
      const c = base + (i + 1) * 2;
      const d = base + (i + 1) * 2 + 1;
      // Two triangles per quad (consistent winding)
      indices.push(a, b, c, b, d, c);
    }
  }

  /**
   * Sample edge points along UV space.
   * @param {'u'|'v'} axis - 'u' = fixed U (left/right vertical edge), 'v' = fixed V (top/bottom horizontal edge)
   * @param {number} fixedVal - fixed coordinate value (0 or 1)
   * @param {number} fromT - start of the varying coordinate
   * @param {number} toT   - end of the varying coordinate
   * @param {number} steps - number of segments
   */
  function edgeSample(axis, fixedVal, fromT, toT, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = fromT + (toT - fromT) * (i / steps);
      let u, v, x, y;
      if (axis === 'u') { // fixed U → left or right vertical edge; V varies
        u = fixedVal; v = t;
        x = u * 2 - 1; y = v * 2 - 1;
      } else {            // fixed V → bottom or top horizontal edge; U varies
        u = t; v = fixedVal;
        x = u * 2 - 1; y = v * 2 - 1;
      }
      const z = sampleDepth(depthNorm, mapW, mapH, u, v) * DEPTH_SCALE;
      pts.push({ x, y, z, u, v });
    }
    return pts;
  }

  const s = segs;
  addStrip(edgeSample('v', 0,  0, 1, s), { x: 0, y: -1, z: 0 }); // bottom (v=0, u varies)
  addStrip(edgeSample('v', 1,  0, 1, s), { x: 0, y:  1, z: 0 }); // top    (v=1, u varies)
  addStrip(edgeSample('u', 0,  0, 1, s), { x: -1, y: 0, z: 0 }); // left   (u=0, v varies)
  addStrip(edgeSample('u', 1,  0, 1, s), { x:  1, y: 0, z: 0 }); // right  (u=1, v varies)

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ─── Texture Helpers ──────────────────────────────────────────────────────────

/**
 * Create a THREE.Texture from a canvas element.
 */
function canvasToTexture(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Create a horizontally-mirrored version of a canvas.
 */
function mirrorCanvas(src, w, h) {
  const dst = document.createElement('canvas');
  dst.width  = w; dst.height = h;
  const ctx  = dst.getContext('2d');
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0, w, h);
  return dst;
}

/**
 * Create a blurred / desaturated edge canvas for sides.
 */
function sideCanvas(src, w, h) {
  const dst = document.createElement('canvas');
  dst.width  = w; dst.height = h;
  const ctx  = dst.getContext('2d');
  ctx.filter = 'blur(6px) saturate(0.5) brightness(0.7)';
  ctx.drawImage(src, 0, 0, w, h);
  return dst;
}

// ─── Main Processing ──────────────────────────────────────────────────────────
let currentGroup = null;

async function processImage(file) {
  if (!depthPipeline) {
    setStatus('モデル未準備', 'error');
    return;
  }

  // Clean up previous mesh
  if (currentGroup) {
    scene.remove(currentGroup);
    currentGroup.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    currentGroup = null;
  }

  controls.autoRotate = false;
  setStatus('処理中…', 'loading');
  setProgress(65, '画像リサイズ中…');

  // 1. Load + resize
  const { canvas: imgCanvas, width: imgW, height: imgH } = await loadAndResize(file);
  setProgress(72, '深度推定中…');

  // 2. Depth estimation
  let depthNorm;
  try {
    depthNorm = await estimateDepth(imgCanvas);
  } catch (err) {
    console.error('Depth estimation failed:', err);
    setStatus('深度推定失敗', 'error');
    setProgress(100, '');
    return;
  }

  setProgress(85, 'メッシュ生成中…');

  // 3. Build geometries
  const frontGeo = buildFrontGeometry(depthNorm, imgW, imgH);
  const backGeo  = buildBackGeometry();
  const sideGeo  = buildSideGeometry(depthNorm, imgW, imgH);

  // 4. Textures
  const frontTex = canvasToTexture(imgCanvas);
  const backTex  = canvasToTexture(mirrorCanvas(imgCanvas, imgW, imgH));
  const sideTex  = canvasToTexture(sideCanvas(imgCanvas, imgW, imgH));

  const matFront = new THREE.MeshStandardMaterial({
    map: frontTex, side: THREE.FrontSide,
    roughness: 0.6, metalness: 0.05
  });
  const matBack = new THREE.MeshStandardMaterial({
    map: backTex, side: THREE.FrontSide,
    roughness: 0.8, metalness: 0.02
  });
  const matSide = new THREE.MeshStandardMaterial({
    map: sideTex, side: THREE.DoubleSide,
    roughness: 0.9, metalness: 0.01
  });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(frontGeo, matFront));
  group.add(new THREE.Mesh(backGeo,  matBack));
  group.add(new THREE.Mesh(sideGeo,  matSide));

  // Aspect-ratio correction so the object isn't distorted
  const aspect = imgW / imgH;
  if (aspect > 1) {
    group.scale.set(1, 1 / aspect, 1);
  } else {
    group.scale.set(aspect, 1, 1);
  }

  scene.add(group);
  currentGroup = group;

  // Auto-fit camera
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0, 0, size * 1.2));
  camera.near = size * 0.01;
  camera.far  = size * 20;
  camera.updateProjectionMatrix();
  controls.update();
  controls.autoRotate = true;

  setProgress(100, '');
  setStatus('3Dモデル完成', 'ready');
  window.dispatchEvent(new CustomEvent('mesh3d:ready'));
}

// ─── Event Binding ────────────────────────────────────────────────────────────
const fileInput   = document.getElementById('file-input');
const cameraInput = document.getElementById('camera-input');
const btnCamera   = document.getElementById('btn-camera');
const btnFile     = document.getElementById('btn-file');
const btnRotate   = document.getElementById('btn-rotate');
const btnReset    = document.getElementById('btn-reset');

btnCamera.addEventListener('click', () => cameraInput.click());
btnFile.addEventListener('click',   () => fileInput.click());

function handleFile(e) {
  const f = e.target.files?.[0];
  if (f) processImage(f);
  e.target.value = '';
}
fileInput.addEventListener('change',   handleFile);
cameraInput.addEventListener('change', handleFile);

btnRotate.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  btnRotate.classList.toggle('active', controls.autoRotate);
});

btnReset.addEventListener('click', () => {
  camera.position.set(0, 0, 3.5);
  controls.target.set(0, 0, 0);
  controls.update();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

initModel();
