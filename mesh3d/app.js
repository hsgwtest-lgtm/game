/**
 * Mesh3D v2 – Depth-Shell + Normal Map
 *
 * Pipeline:
 *  1. 画像ロード → 512px以下にリサイズ (iOS メモリ対策)
 *  2. Transformers.js v3 (Depth-Anything-Small / WebGPU or WASM FP16) で深度マップ取得
 *  3. 深度マップ勾配 → タンジェント空間 Normal Map テクスチャ生成
 *  4. 深度マップ → 閉じた3Dシェルメッシュ生成 (buildSolidMesh)
 *     ・前面 : 深度で Z 変位したグリッド (MESH_SEGMENTS²)
 *     ・背面 : ミラー深度で変位した曲面 (ハーフシェル、フラット板ポリゴンから脱却)
 *     ・側面 : 前面エッジ⇔背面エッジを繋ぐ壁 (closed seams)
 *  5. カラーテクスチャ + Normal Map を Three.js MeshStandardMaterial に適用
 *  6. OrbitControls 付きシーンに表示
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { pipeline, env, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js';

// ─── iOS / WebKit memory optimisations ───────────────────────────────────────
const MAX_IMG_SIZE    = 512;   // リサイズ上限 (px)
const MESH_SEGMENTS   = 64;    // グリッド解像度 (前面・背面)
const DEPTH_SCALE     = 0.45;  // Z 方向の変位スケール
const NORMAL_SCALE    = 1.5;   // ノーマルマップ強度
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

// ─── Depth Sampler ────────────────────────────────────────────────────────────

/**
 * Bilinear sample of a depth map at UV coordinates (u,v) ∈ [0,1]².
 * Image row 0 is the top of the picture; UV v=1 maps to row 0.
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

// ─── Step 3 – Normal Map ──────────────────────────────────────────────────────

/**
 * Build a tangent-space normal map DataTexture from a depth map.
 *
 * Central differences on the depth gradient are used to derive per-pixel
 * surface normals. The result is encoded as RGB (128,128,255 = flat surface).
 * Image y increases downward while UV v increases upward, so the gy sign
 * is flipped to stay consistent with the geometry UVs.
 */
function buildNormalMapTexture(depthNorm, mapW, mapH) {
  const data = new Uint8ClampedArray(mapW * mapH * 4);
  // World-space ratio: depth 0→1 spans DEPTH_SCALE in Z, while UV 0→1 spans 2
  // in XY. Strength tunes how much the normals deviate from the flat forward.
  const strength = NORMAL_SCALE * DEPTH_SCALE * 0.5;

  for (let py = 0; py < mapH; py++) {
    for (let px = 0; px < mapW; px++) {
      const xl = Math.max(0, px - 1), xr = Math.min(mapW - 1, px + 1);
      const yt = Math.max(0, py - 1), yb = Math.min(mapH - 1, py + 1);

      // Central differences in pixel space
      const gx =  (depthNorm[py * mapW + xr] - depthNorm[py * mapW + xl]) / (xr - xl);
      // Image y↓ vs UV v↑ → negate
      const gy = -(depthNorm[yb * mapW + px] - depthNorm[yt * mapW + px]) / (yb - yt);

      // Tangent-space normal (not yet normalised)
      const nx = -gx * strength;
      const ny = -gy * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      const i = (py * mapW + px) * 4;
      data[i]   = ((nx / len) * 0.5 + 0.5) * 255 + 0.5 | 0;
      data[i+1] = ((ny / len) * 0.5 + 0.5) * 255 + 0.5 | 0;
      data[i+2] = ((nz / len) * 0.5 + 0.5) * 255 + 0.5 | 0;
      data[i+3] = 255;
    }
  }

  const tex = new THREE.DataTexture(
    data, mapW, mapH, THREE.RGBAFormat, THREE.UnsignedByteType
  );
  // Normal maps carry linear data – no sRGB conversion
  tex.needsUpdate = true;
  return tex;
}

// ─── Step 1 & 2 – Closed Solid Shell Mesh ────────────────────────────────────

/**
 * Build a watertight depth-shell mesh from a depth map.
 *
 * Vertex layout  (total 2 × (S+1)² vertices):
 *   [ 0 … N−1 ]   front face  z =  depth(u,v)       · DEPTH_SCALE
 *   [ N … 2N−1]   back  face  z = −(0.08 + mirrorDepth·0.12) · DEPTH_SCALE
 *
 * The back face samples depth at mirrored U (1−u, v), creating a concave
 * surface that matches the front's convexity instead of being a flat plane.
 * UV on the back face is (1−u, v) so the colour texture reads as a mirror.
 *
 * Four side walls close the seams between the front and back edges so the
 * mesh is fully closed and correct normals are maintained throughout.
 *
 * Winding conventions (THREE.FrontSide rendering):
 *   Front  – CCW from +Z  → normal points toward viewer
 *   Back   – CW  from +Z  → normal points away from viewer
 *   Sides  – chosen per-edge to give outward-pointing normals
 */
function buildSolidMesh(depthNorm, mapW, mapH) {
  const S  = MESH_SEGMENTS;
  const nx = S + 1;
  const ny = S + 1;
  const N  = nx * ny;  // vertices per face

  const pos   = new Float32Array(N * 2 * 3);
  const uvArr = new Float32Array(N * 2 * 2);

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const k  = iy * nx + ix;
      const u  = ix / S;
      const v  = iy / S;
      const wx = u * 2 - 1;
      const wy = v * 2 - 1;

      // ── Front vertex ──────────────────────────────────────────────────────
      const fz = sampleDepth(depthNorm, mapW, mapH, u, v) * DEPTH_SCALE;
      pos[k * 3]     = wx;
      pos[k * 3 + 1] = wy;
      pos[k * 3 + 2] = fz;
      uvArr[k * 2]     = u;
      uvArr[k * 2 + 1] = v;

      // ── Back vertex (Step 2: depth-varied instead of flat) ────────────────
      // Mirror depth so raised areas on the front produce matching concavity
      // on the back, giving a more realistic cross-section when viewed from
      // the side or from behind.
      const bd = sampleDepth(depthNorm, mapW, mapH, 1 - u, v);
      const bz = -(0.08 + bd * 0.12) * DEPTH_SCALE;
      const bk = N + k;
      pos[bk * 3]     = wx;
      pos[bk * 3 + 1] = wy;
      pos[bk * 3 + 2] = bz;
      uvArr[bk * 2]     = 1 - u;  // mirror U → photo reads correctly from behind
      uvArr[bk * 2 + 1] = v;
    }
  }

  // ── Index buffer ──────────────────────────────────────────────────────────
  const idxCount = S * S * 6 * 2  // front + back quads
                 + S * 6 * 4;     // 4 side walls
  const idx = new Uint32Array(idxCount);
  let ptr = 0;

  // Front face – CCW from +Z
  for (let iy = 0; iy < S; iy++) {
    for (let ix = 0; ix < S; ix++) {
      const a = iy * nx + ix,        b = iy * nx + ix + 1;
      const c = (iy+1) * nx + ix + 1, d = (iy+1) * nx + ix;
      idx[ptr++] = a; idx[ptr++] = b; idx[ptr++] = c;
      idx[ptr++] = a; idx[ptr++] = c; idx[ptr++] = d;
    }
  }

  // Back face – CW from +Z (= CCW from −Z)
  for (let iy = 0; iy < S; iy++) {
    for (let ix = 0; ix < S; ix++) {
      const a = N + iy * nx + ix,        b = N + iy * nx + ix + 1;
      const c = N + (iy+1) * nx + ix + 1, d = N + (iy+1) * nx + ix;
      idx[ptr++] = a; idx[ptr++] = c; idx[ptr++] = b;
      idx[ptr++] = a; idx[ptr++] = d; idx[ptr++] = c;
    }
  }

  // Bottom edge iy=0  – outward normal −Y
  for (let ix = 0; ix < S; ix++) {
    const af = ix,     bf = ix + 1;
    const ab = N + ix, bb = N + ix + 1;
    idx[ptr++] = af; idx[ptr++] = ab; idx[ptr++] = bf;
    idx[ptr++] = bf; idx[ptr++] = ab; idx[ptr++] = bb;
  }

  // Top edge iy=S  – outward normal +Y
  for (let ix = 0; ix < S; ix++) {
    const af = S * nx + ix,     bf = S * nx + ix + 1;
    const ab = N + S * nx + ix, bb = N + S * nx + ix + 1;
    idx[ptr++] = af; idx[ptr++] = bf; idx[ptr++] = ab;
    idx[ptr++] = bf; idx[ptr++] = bb; idx[ptr++] = ab;
  }

  // Left edge ix=0  – outward normal −X
  for (let iy = 0; iy < S; iy++) {
    const af = iy * nx,       bf = (iy+1) * nx;
    const ab = N + iy * nx,   bb = N + (iy+1) * nx;
    idx[ptr++] = af; idx[ptr++] = bf; idx[ptr++] = ab;
    idx[ptr++] = bf; idx[ptr++] = bb; idx[ptr++] = ab;
  }

  // Right edge ix=S  – outward normal +X
  for (let iy = 0; iy < S; iy++) {
    const af = iy * nx + S,     bf = (iy+1) * nx + S;
    const ab = N + iy * nx + S, bb = N + (iy+1) * nx + S;
    idx[ptr++] = af; idx[ptr++] = ab; idx[ptr++] = bf;
    idx[ptr++] = bf; idx[ptr++] = ab; idx[ptr++] = bb;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvArr, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeTangents();  // required for correct tangent-space normal mapping
  return geo;
}

// ─── Texture Helper ───────────────────────────────────────────────────────────

/**
 * Create a THREE.Texture from a canvas element.
 */
function canvasToTexture(c) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
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

  // 3. Build closed watertight shell geometry (front + depth-varied back + sides)
  const geo = buildSolidMesh(depthNorm, imgW, imgH);

  // 4. Textures
  const colorTex  = canvasToTexture(imgCanvas);
  const normalTex = buildNormalMapTexture(depthNorm, imgW, imgH);

  const mat = new THREE.MeshStandardMaterial({
    map:         colorTex,
    normalMap:   normalTex,
    normalScale: new THREE.Vector2(1, 1),
    roughness:   0.6,
    metalness:   0.05,
    side:        THREE.FrontSide,
  });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));

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
