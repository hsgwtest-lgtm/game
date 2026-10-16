// AI EYE 64 — あなたの運転をお手本に、64×64 の目で見る AI が運転を覚える
import * as THREE from '../lib/three.module.min.js';
import {
  buildTrack, nearest, stepCar, placeOnTrack, expertAction, indexDelta,
  HALF_WIDTH, CURB_WIDTH, OFF_MARGIN,
} from './track.js';
import { createModel, makeWorkspace, forward, gradCam, fillInput, DEFAULT_CONFIG } from './cnn.js';
import { loadAll, saveChunks, clearAll, CHUNK } from './datastore.js';

// ---------- 設定 ----------
const EYE = 64;              // AI の目の解像度
const SS = 2;                // 128×128 で描いてから 2×2 平均で 64×64 に（ギザギザ防止）
const S = EYE * EYE * 3;     // 1 場面ぶんのバイト数（RGB）
const STEP = 1 / 60;         // 物理計算の刻み（秒）
const DECIDE_EVERY = 6;      // 6 刻みに 1 回＝1 秒に 10 回、AI が画像を見て判断する
const MAX_SAMPLES = 3000;
const AUG_YAW = 10 * Math.PI / 180; // ずらした目の向き
const AUG_SHIFT = 0.5;               // ずらした目の横位置（m）
const MIN_SAMPLES = 150;
const SPEEDS = [{ label: 'ゆっくり', v: 7 }, { label: 'ふつう', v: 9 }, { label: 'はやい', v: 11 }];
const STORE_KEY = 'aieye.v1';
const MODEL_SIG = 'c8-16-24-h32';
const EXPERT = new URLSearchParams(location.search).has('expert');

const COL = {
  sky: 0xa9d9f2, grass: 0x6dbe45, grass2: 0x63b33e, asphalt: 0x585d63, paint: 0xf2f4f5,
  curb: 0xd7263d, tree: 0x2e7d32, trunk: 0x7a5232, cone: 0xf08a24, sign: 0x1d5daf,
};

// ---------- 保存 ----------
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveStore(patch) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...loadStore(), ...patch })); } catch { /* 容量不足などは無視 */ }
}
function f32ToB64(f) {
  const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToF32(b) {
  const s = atob(b);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

// ---------- 画面の部品 ----------
const $ = (id) => document.getElementById(id);
const ui = {
  app: $('app'), stage: $('stage'), view: $('view'),
  eyeCanvas: $('eyeCanvas'), heatCanvas: $('heatCanvas'), eyeBtn: $('eyeBtn'), eye: $('eye'),
  hudLaps: $('hudLaps'), hudOffs: $('hudOffs'), hudRun: $('hudRun'),
  speedBtn: $('speedBtn'), toast: $('toast'), emptyMsg: $('emptyMsg'), expertBadge: $('expertBadge'),
  tabs: [...document.querySelectorAll('.mode')],
  panels: { teach: $('panel-teach'), train: $('panel-train'), drive: $('panel-drive') },
  sampleCount: $('sampleCount'), clearBtn: $('clearBtn'), augToggle: $('augToggle'),
  mix: [[$('mixL'), $('mixLn')], [$('mixS'), $('mixSn')], [$('mixR'), $('mixRn')]],
  epochSeg: $('epochSeg'), trainBtn: $('trainBtn'), resetBtn: $('resetBtn'), trainWarn: $('trainWarn'),
  trainBar: $('trainBar'), trainStatus: $('trainStatus'), trainRun: $('trainRun'),
  chart: $('chart'), chartTip: $('chartTip'), chartBox: $('chartBox'), chartTable: $('chartTable'),
  probs: [[$('pL'), $('pLn')], [$('pS'), $('pSn')], [$('pR'), $('pRn')]],
  heatToggle: $('heatToggle'), featToggle: $('featToggle'), bigToggle: $('bigToggle'),
  featBox: $('featBox'), featCanvas: $('featCanvas'),
  addCount: $('addCount'), retrainBtn: $('retrainBtn'),
  pads: $('pads'), padL: $('padL'), padR: $('padR'),
  help: $('help'), helpBtn: $('helpBtn'), helpClose: $('helpClose'),
};

// ---------- 状態 ----------
const store = loadStore();
const track = buildTrack(undefined, 900);
const car = { x: 0, z: 0, heading: 0, steer: 0, speed: 0, idx: 0 };
placeOnTrack(track, car, 0);

const data = new Uint8Array(MAX_SAMPLES * S);  // 記録した 64×64 画像
const labels = new Uint8Array(MAX_SAMPLES);     // 0=左 1=直進 2=右
const counts = [0, 0, 0];
let n = 0;          // 記録した場面の数
let dataReady = false;          // 保存してあった記録を読み込み終えたか
let persistOk = true;           // IndexedDB が使えるか
const dirty = new Set();        // 保存し直すかたまりの番号
let added = 0;      // AI 運転中に教え直して足した場面の数（次の学習まで）

let model = null, ws = null;
let aiProbs = null;
let aiTarget = 0;
let mode = 'teach';
let speedIdx = Number.isInteger(store.speedIdx) ? store.speedIdx : 1;
let heatOn = true, featOn = false, bigOn = false;
const human = { L: false, R: false };
const keys = { L: false, R: false };
let expertPrev = 0;
let augOn = store.augOn === true; // ずらした目でも記録する（初期値はオフ）
let augFlip = 0;
let stepCount = 0;
let cooldown = 0;
const stats = { laps: 0, offs: 0, run: 0, best: 0, prog: 0 };

let worker = null;
let training = false;
let epochsPlanned = 6;
let epochBase = 0;
let history = [];
let trainedEpochs = 0;

// 保存してあるモデルを読み込む
if (store.model && store.modelSig === MODEL_SIG) {
  try {
    const P = b64ToF32(store.model);
    const m = createModel(DEFAULT_CONFIG, 1);
    if (P.length === m.P.length) {
      m.P.set(P);
      model = m;
      ws = makeWorkspace(model);
      trainedEpochs = store.trainedEpochs || 0;
      history = Array.isArray(store.history) ? store.history : [];
    }
  } catch { /* 壊れていたら無視 */ }
}

// ---------- Three.js ----------
THREE.ColorManagement.enabled = false; // 画面と AI の目で同じ色の値になるように色変換を切る
const renderer = new THREE.WebGLRenderer({ canvas: ui.view, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(COL.sky);
scene.fog = new THREE.Fog(COL.sky, 45, 150);

const cam = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
cam.layers.enable(1);                   // 人間用カメラには車（レイヤー1）も映す
const eyeCam = new THREE.PerspectiveCamera(80, 1, 0.1, 160); // AI の目には車体を映さない
const rt = new THREE.WebGLRenderTarget(EYE * SS, EYE * SS, { depthBuffer: true });
const rtBuf = new Uint8Array(EYE * SS * EYE * SS * 4);
const frame = new Uint8Array(S);         // いま AI が見ている 64×64 の画像
const sideFrame = new Uint8Array(S);     // 向きをずらした目（データの水増し用）

scene.add(new THREE.HemisphereLight(0xffffff, 0x88a070, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(30, 60, 20);
scene.add(sun);

function buildWorld() {
  // 芝生（大きな市松模様で、動いている感じを出す）
  const gc = document.createElement('canvas');
  gc.width = gc.height = 64;
  const g = gc.getContext('2d');
  g.fillStyle = '#6dbe45'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#63b33e'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  const tex = new THREE.CanvasTexture(gc);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 30);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // 巨大な一枚板は奥行きの精度が落ちて、AI の目（低い視点）でコースより手前に描かれることがある。
  // 少し下げたうえで奥行きをずらしておく。
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600),
    new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  scene.add(ground);

  // コースの帯（舗装・縁石・センターライン）
  const ribbon = (off0, off1, y, colorOf) => {
    const { N, px, pz, rx, rz } = track;
    const pos = [], col = [];
    const c = new THREE.Color();
    for (let k = 0; k < N; k++) {
      const hex = colorOf(k);
      if (hex === null) continue;
      c.setHex(hex);
      const k2 = (k + 1) % N;
      const P = (i, off) => [px[i] + rx[i] * off, y, pz[i] + rz[i] * off];
      const A = P(k, off0), B = P(k2, off0), C = P(k, off1), D = P(k2, off1);
      pos.push(...A, ...B, ...C, ...B, ...D, ...C);
      for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    scene.add(mesh);
    return mesh;
  };
  ribbon(-HALF_WIDTH, HALF_WIDTH, 0.02, () => COL.asphalt);
  const stripe = (k) => (Math.floor(k / 4) % 2 ? COL.curb : COL.paint);
  ribbon(HALF_WIDTH, HALF_WIDTH + CURB_WIDTH, 0.03, stripe);
  ribbon(-HALF_WIDTH - CURB_WIDTH, -HALF_WIDTH, 0.03, stripe);
  ribbon(-0.1, 0.1, 0.035, (k) => (Math.floor(k / 7) % 2 === 0 ? COL.paint : null));
  // スタートラインの市松
  {
    const pos = [], col = [];
    const k = 0, k2 = 2;
    const cells = 10;
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < 2; j++) {
        const o0 = -HALF_WIDTH + (2 * HALF_WIDTH * i) / cells, o1 = -HALF_WIDTH + (2 * HALF_WIDTH * (i + 1)) / cells;
        const ka = j === 0 ? k : 1, kb = j === 0 ? 1 : k2;
        const P = (idx, off) => [track.px[idx] + track.rx[idx] * off, 0.04, track.pz[idx] + track.rz[idx] * off];
        const A = P(ka, o0), B = P(kb, o0), C = P(ka, o1), D = P(kb, o1);
        pos.push(...A, ...B, ...C, ...B, ...D, ...C);
        const v = (i + j) % 2 ? 0.1 : 0.95;
        for (let q = 0; q < 6; q++) col.push(v, v, v);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }

  // スタートのゲート
  {
    const side = HALF_WIDTH + CURB_WIDTH + 1.0;
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.18, 5.2, 10);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xe9edf0 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(poleGeo, poleMat);
      p.position.set(track.px[0] + track.rx[0] * side * s, 2.6, track.pz[0] + track.rz[0] * side * s);
      scene.add(p);
    }
    const bc = document.createElement('canvas');
    bc.width = 256; bc.height = 32;
    const b = bc.getContext('2d');
    b.fillStyle = '#1d5daf'; b.fillRect(0, 0, 256, 32);
    b.fillStyle = '#ffffff';
    b.font = '800 22px "Hiragino Sans", "Noto Sans JP", sans-serif';
    b.textAlign = 'center'; b.textBaseline = 'middle';
    b.fillText('AI EYE 64', 128, 17);
    const bannerTex = new THREE.CanvasTexture(bc);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(side * 2 + 0.4, 0.9, 0.12), [
      new THREE.MeshBasicMaterial({ color: COL.sign }), new THREE.MeshBasicMaterial({ color: COL.sign }),
      new THREE.MeshBasicMaterial({ color: COL.sign }), new THREE.MeshBasicMaterial({ color: COL.sign }),
      new THREE.MeshBasicMaterial({ map: bannerTex }), new THREE.MeshBasicMaterial({ map: bannerTex }),
    ]);
    banner.position.set(track.px[0], 4.9, track.pz[0]);
    banner.rotation.y = Math.atan2(track.tx[0], track.tz[0]);
    scene.add(banner);
  }

  // 木とコーン（コースから十分離して置く）
  const r = mulberry(42);
  const trees = [];
  for (let tries = 0; tries < 3000 && trees.length < 170; tries++) {
    const x = (r() - 0.5) * 260, z = (r() - 0.5) * 240;
    const near = nearest(track, x, z);
    if (near.dist < HALF_WIDTH + CURB_WIDTH + 6) continue;
    trees.push([x, z, 0.8 + r() * 0.7]);
  }
  const leafGeo = new THREE.ConeGeometry(1.6, 4.2, 7); leafGeo.translate(0, 3.5, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.32, 1.5, 6); trunkGeo.translate(0, 0.75, 0);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: COL.tree, flatShading: true }), trees.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: COL.trunk }), trees.length);
  const m = new THREE.Matrix4();
  trees.forEach(([x, z, s], i) => {
    m.makeScale(s, s, s).setPosition(x, 0, z);
    leaves.setMatrixAt(i, m);
    trunks.setMatrixAt(i, m);
  });
  scene.add(leaves, trunks);

  const cones = [];
  for (let k = 30; k < track.N; k += 75) {
    // カーブの外側にコーンを置く
    const a = (k - 5 + track.N) % track.N, b = (k + 5) % track.N;
    const turn = track.tx[a] * track.tz[b] - track.tz[a] * track.tx[b];
    if (Math.abs(turn) < 0.01) continue;
    const s = turn > 0 ? 1 : -1;
    const off = (HALF_WIDTH + CURB_WIDTH + 1.4) * s;
    cones.push([track.px[k] + track.rx[k] * off, track.pz[k] + track.rz[k] * off]);
  }
  const coneMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.32, 0.9, 10).translate(0, 0.45, 0),
    new THREE.MeshLambertMaterial({ color: COL.cone }), cones.length);
  cones.forEach(([x, z], i) => { m.makeTranslation(x, 0, z); coneMesh.setMatrixAt(i, m); });
  scene.add(coneMesh);
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 教習車（人間用カメラにだけ映る）
const carMesh = new THREE.Group();
function buildCar() {
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); carMesh.add(o); return o; };
  add(new THREE.BoxGeometry(1.9, 0.62, 4.1), lam(0xf5f7f8), 0, 0.58, 0);
  add(new THREE.BoxGeometry(1.92, 0.14, 4.12), lam(COL.sign), 0, 0.66, 0);
  add(new THREE.BoxGeometry(1.6, 0.55, 2.1), lam(0x2b3a4a), 0, 1.16, -0.25);
  add(new THREE.BoxGeometry(0.9, 0.28, 0.36), lam(0xffd60a), 0, 1.58, -0.2); // 教習車の屋根の表示灯
  const wheel = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 14).rotateZ(Math.PI / 2);
  for (const [x, z] of [[0.95, 1.35], [-0.95, 1.35], [0.95, -1.35], [-0.95, -1.35]]) add(wheel, lam(0x22262b), x, 0.38, z);
  // 後ろの若葉マーク
  const half = (pts, color) => {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const o = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    o.position.set(0.55, 0.62, -2.07);
    o.rotation.y = Math.PI;
    carMesh.add(o);
  };
  half([[-0.17, 0.2], [0, 0.13], [0, -0.21], [-0.17, -0.08]], 0xffd60a);
  half([[0, 0.13], [0.17, 0.2], [0.17, -0.08], [0, -0.21]], 0x0e9f4b);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.2, 2.3, 1);
  shadow.position.y = 0.045;
  carMesh.add(shadow);
  carMesh.traverse((o) => o.layers.set(1));
  scene.add(carMesh);
}

buildWorld();
buildCar();

// ---------- AI の目：64×64 を撮って表示する ----------
const eyeCtx = ui.eyeCanvas.getContext('2d');
const eyeImg = eyeCtx.createImageData(EYE, EYE);
const heatCtx = ui.heatCanvas.getContext('2d');
const heatImg = heatCtx.createImageData(EYE, EYE);
const featCtx = ui.featCanvas.getContext('2d');
const featImg = featCtx.createImageData(ui.featCanvas.width, ui.featCanvas.height);

// AI の目に映る画像を out（64×64 RGB）に描く。yaw/lateral で向きと位置を少しずらせる
function renderEye(out, yaw = 0, lateral = 0) {
  const h = car.heading + yaw;
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = -Math.cos(car.heading), rz = Math.sin(car.heading);
  const x = car.x + rx * lateral, z = car.z + rz * lateral;
  eyeCam.position.set(x + fx * 1.0, 2.4, z + fz * 1.0);
  eyeCam.lookAt(x + fx * 8.4, 0, z + fz * 8.4);
  renderer.setRenderTarget(rt);
  renderer.render(scene, eyeCam);
  renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(rt, 0, 0, EYE * SS, EYE * SS, rtBuf);
  // WebGL の読み出しは下から上なので上下を反転しつつ、2×2 を平均
  const W2 = EYE * SS, area = SS * SS;
  for (let y = 0; y < EYE; y++) {
    const sy = (EYE - 1 - y) * SS;
    for (let x2 = 0; x2 < EYE; x2++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        let i = ((sy + dy) * W2 + x2 * SS) * 4;
        for (let dx = 0; dx < SS; dx++, i += 4) { r += rtBuf[i]; g += rtBuf[i + 1]; b += rtBuf[i + 2]; }
      }
      const o = (y * EYE + x2) * 3;
      out[o] = (r / area + 0.5) | 0;
      out[o + 1] = (g / area + 0.5) | 0;
      out[o + 2] = (b / area + 0.5) | 0;
    }
  }
}

function captureEye() {
  renderEye(frame);
  const d = eyeImg.data;
  for (let i = 0, j = 0; i < S; i += 3, j += 4) {
    d[j] = frame[i]; d[j + 1] = frame[i + 1]; d[j + 2] = frame[i + 2]; d[j + 3] = 255;
  }
  eyeCtx.putImageData(eyeImg, 0, 0);
}

// ヒートマップ：Grad-CAM の 14×14 を 64×64 に引き伸ばし、黄→赤で重ねる
function drawHeat(cam, cw, ch) {
  const d = heatImg.data;
  for (let y = 0; y < EYE; y++) {
    const fy = Math.min(ch - 1.001, Math.max(0, ((y + 0.5) / EYE) * ch - 0.5));
    const y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < EYE; x++) {
      const fx = Math.min(cw - 1.001, Math.max(0, ((x + 0.5) / EYE) * cw - 0.5));
      const x0 = Math.floor(fx), tx = fx - x0;
      const v00 = cam[y0 * cw + x0], v10 = cam[y0 * cw + x0 + 1];
      const v01 = cam[(y0 + 1) * cw + x0], v11 = cam[(y0 + 1) * cw + x0 + 1];
      const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
      const j = (y * EYE + x) * 4;
      const t = Math.max(0, (v - 0.2) / 0.8);
      // 黄 (255,214,10) → 橙 (240,138,36) → 赤 (215,38,61)
      let r, g, b;
      if (t < 0.5) { const u = t / 0.5; r = 255 - 15 * u; g = 214 - 76 * u; b = 10 + 26 * u; }
      else { const u = (t - 0.5) / 0.5; r = 240 - 25 * u; g = 138 - 100 * u; b = 36 + 25 * u; }
      d[j] = r; d[j + 1] = g; d[j + 2] = b;
      d[j + 3] = t <= 0 ? 0 : Math.min(175, 35 + t * 150);
    }
  }
  heatCtx.putImageData(heatImg, 0, 0);
}
function clearHeat() { heatCtx.clearRect(0, 0, EYE, EYE); }

// 1 層目の特徴マップ（8 枚）を 4×2 に並べる
function drawFeatures() {
  const L = model.shape.layers[0];
  const A = ws.a[1];
  const tile = L.Wo, gap = 1, cols = 4;
  const W = featImg.width;
  const d = featImg.data;
  d.fill(0);
  for (let k = 0; k < L.Co; k++) {
    const ox = (k % cols) * (tile + gap), oy = Math.floor(k / cols) * (tile + gap);
    let mx = 1e-6;
    for (let p = 0; p < tile * L.Ho; p++) mx = Math.max(mx, A[k * tile * L.Ho + p]);
    for (let y = 0; y < L.Ho; y++) {
      for (let x = 0; x < tile; x++) {
        const v = Math.min(255, (A[k * tile * L.Ho + y * tile + x] / mx) * 255) | 0;
        const j = ((oy + y) * W + ox + x) * 4;
        d[j] = v; d[j + 1] = v; d[j + 2] = v; d[j + 3] = 255;
      }
    }
  }
  featCtx.putImageData(featImg, 0, 0);
}

function infer() {
  fillInput(ws.a[0], frame, EYE, EYE, false, 1);
  const p = forward(model, ws);
  aiProbs = [p[0], p[1], p[2]];
  const showHeat = heatOn && mode !== 'teach';
  const showFeat = featOn && mode === 'drive';
  if (showFeat) drawFeatures(); // forward 直後の活性を使う（Grad-CAM の前に描く）
  if (showHeat) {
    let am = 0;
    for (let c = 1; c < 3; c++) if (aiProbs[c] > aiProbs[am]) am = c;
    const cam = gradCam(model, ws, am);
    drawHeat(cam, ws.camW, ws.camH);
  } else {
    clearHeat();
  }
}

// ---------- 操作 ----------
function humanSteer() {
  return ((human.R || keys.R) ? 1 : 0) - ((human.L || keys.L) ? 1 : 0);
}
function humanPressing() {
  return human.L || human.R || keys.L || keys.R;
}

function record(label, buf = frame) {
  let i;
  if (n < MAX_SAMPLES) i = n++;
  else { i = Math.floor(Math.random() * MAX_SAMPLES); counts[labels[i]]--; }
  data.set(buf, i * S);
  labels[i] = label;
  counts[label]++;
  dirty.add(Math.floor(i / CHUNK));
}

function flushData() {
  if (!persistOk || !dataReady || !dirty.size) return;
  saveChunks(data, labels, n, S, dirty).catch(() => { persistOk = false; });
}

function aiInControl() {
  return mode !== 'teach' && model !== null;
}

// 1 秒に 10 回：見る → 判断する → 記録する
function decide() {
  captureEye();
  if (model) infer();
  else { aiProbs = null; clearHeat(); }
  const live = car.speed > 0 && cooldown <= 0 && dataReady;
  if (mode === 'teach') {
    if (EXPERT) expertPrev = expertAction(track, car, expertPrev);
    const a = EXPERT ? expertPrev : humanSteer();
    if (live) {
      record(a + 1);
      if (augOn) {
        // 右に 10° ずれた目なら「左へ戻す」、左にずれた目なら「右へ戻す」を正解として足す
        augFlip ^= 1;
        const side = augFlip ? 1 : -1;            // +1: 右にずれた目
        renderEye(sideFrame, -side * AUG_YAW, side * AUG_SHIFT);
        record(Math.max(-1, Math.min(1, a - side)) + 1, sideFrame);
      }
    }
  } else if (mode === 'drive' && model && humanPressing() && live) {
    record(humanSteer() + 1);
    added++;
  }
  if (aiProbs) aiTarget = aiProbs[2] - aiProbs[0];
  updateLiveUI();
}

function physicsStep() {
  const canDrive = mode === 'teach' || model !== null;
  car.speed = canDrive ? SPEEDS[speedIdx].v : 0;
  if (stepCount % DECIDE_EVERY === 0) decide();
  stepCount++;
  let target;
  if (mode === 'teach') target = EXPERT ? expertPrev : humanSteer();
  else if (mode === 'drive' && humanPressing()) target = humanSteer();
  else target = aiInControl() ? aiTarget : 0;
  stepCar(car, target, STEP);
  if (cooldown > 0) cooldown -= STEP;

  const nn = nearest(track, car.x, car.z, car.idx);
  const d = indexDelta(track, car.idx, nn.i);
  car.idx = nn.i;
  stats.prog += d;
  if (d > 0) {
    stats.run += d * track.step;
    stats.best = Math.max(stats.best, stats.run);
  }
  stats.laps = Math.max(0, Math.floor(stats.prog / track.N));
  if (Math.abs(nn.lateral) > HALF_WIDTH + CURB_WIDTH + OFF_MARGIN) {
    placeOnTrack(track, car, nn.i);
    cooldown = 0.6;
    aiTarget = 0;
    stats.offs++;
    stats.run = 0;
    showToast('コースアウト');
  }
}

// ---------- カメラ ----------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const tmpP = new THREE.Vector3(), tmpL = new THREE.Vector3();
function updateChase(dt, snap = false) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  tmpP.set(car.x - fx * 8.5, 4.6, car.z - fz * 8.5);
  tmpL.set(car.x + fx * 6, 0.6, car.z + fz * 6);
  const a = snap ? 1 : 1 - Math.exp(-dt * 5);
  camPos.lerp(tmpP, a);
  camLook.lerp(tmpL, a);
  cam.position.copy(camPos);
  cam.lookAt(camLook);
}

function syncCarMesh() {
  carMesh.position.set(car.x, 0, car.z);
  carMesh.rotation.y = car.heading;
}

// ---------- 表示の更新 ----------
let toastTimer = 0;
function showToast(text, kind = '') {
  ui.toast.textContent = text;
  ui.toast.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast.className = 'toast' + (kind ? ' ' + kind : ''); }, 900);
}

const fmt = (v) => v.toLocaleString('ja-JP');

function updateLiveUI() {
  ui.hudLaps.textContent = stats.laps;
  ui.hudOffs.textContent = stats.offs;
  ui.hudRun.textContent = `${Math.round(stats.run)} m`;
  if (mode === 'teach') updateDataUI();
  if (mode === 'drive') {
    ui.probs.forEach(([bar, num], c) => {
      const v = aiProbs ? aiProbs[c] : 0;
      bar.style.width = `${(v * 100).toFixed(1)}%`;
      num.textContent = aiProbs ? `${Math.round(v * 100)}%` : '–';
    });
    if (aiProbs) {
      let am = 0;
      for (let c = 1; c < 3; c++) if (aiProbs[c] > aiProbs[am]) am = c;
      ui.probs.forEach(([, num], c) => num.classList.toggle('top', c === am));
    }
    ui.addCount.textContent = fmt(added);
    ui.retrainBtn.disabled = added === 0 || training;
  }
}

function updateDataUI() {
  ui.sampleCount.textContent = fmt(n);
  const mx = Math.max(1, ...counts);
  ui.mix.forEach(([bar, num], c) => {
    bar.style.width = `${(counts[c] / mx) * 100}%`;
    num.textContent = fmt(counts[c]);
  });
}

function updateEmpty() {
  let msg = '';
  if (!model && mode === 'drive') msg = 'まだ何も覚えていません。「1 教える」で運転して、「2 学習」で覚えさせてください。';
  else if (!model && mode === 'train' && !training) msg = '学習をはじめると、AIがハンドルを握ります。最初はでたらめに走ります。';
  ui.emptyMsg.hidden = !msg;
  ui.emptyMsg.textContent = msg;
}

function setMode(m) {
  if (!ui.panels[m]) return;
  mode = m;
  flushData();
  ui.tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
  for (const [k, p] of Object.entries(ui.panels)) p.hidden = k !== m;
  ui.pads.hidden = m === 'train';
  ui.pads.classList.toggle('compact', m === 'drive');
  ui.padL.setAttribute('aria-label', m === 'drive' ? '左に切るよう教え直す' : '左にハンドルを切る');
  ui.padR.setAttribute('aria-label', m === 'drive' ? '右に切るよう教え直す' : '右にハンドルを切る');
  Object.assign(stats, { laps: 0, offs: 0, run: 0, best: 0, prog: 0 });
  aiTarget = 0;
  if (m === 'teach') { clearHeat(); updateDataUI(); }
  if (m === 'train') updateTrainUI();
  updateHeatClass();
  updateEmpty();
  updateLiveUI();
}

function updateHeatClass() {
  ui.eye.classList.toggle('heat-off', !(heatOn && model && mode !== 'teach'));
}

function setSpeed(i) {
  speedIdx = (i + SPEEDS.length) % SPEEDS.length;
  ui.speedBtn.textContent = `速さ：${SPEEDS[speedIdx].label}`;
  saveStore({ speedIdx });
}

// ---------- 学習（Web Worker で計算） ----------
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./trainer.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.onerror = (e) => {
    training = false;
    ui.trainRun.hidden = true;
    ui.trainStatus.textContent = `学習を続けられませんでした（${e.message || '不明なエラー'}）。ページを開き直してください。`;
    updateTrainUI();
  };
  return worker;
}

function startTraining(fresh = false) {
  if (training) {
    worker.postMessage({ type: 'stop' });
    ui.trainStatus.textContent = 'この回の区切りで止めています…';
    return;
  }
  if (n < MIN_SAMPLES) {
    ui.trainWarn.hidden = false;
    ui.trainWarn.textContent = `記録が足りません。あと${fmt(MIN_SAMPLES - n)}場面ほど、「1 教える」で運転してください。`;
    return;
  }
  ui.trainWarn.hidden = true;
  flushData();
  ensureWorker();
  if (!model || fresh) {
    model = createModel(DEFAULT_CONFIG, (Math.random() * 1e9) | 0);
    ws = makeWorkspace(model);
    history = [];
    trainedEpochs = 0;
  }
  epochBase = trainedEpochs;
  const d = data.slice(0, n * S), l = labels.slice(0, n);
  worker.postMessage({
    type: 'train', data: d, labels: l, n, epochs: epochsPlanned,
    params: model.P.slice(), seed: (Math.random() * 1e9) | 0, lr: epochBase > 0 ? 0.001 : 0.002,
  }, [d.buffer, l.buffer]);
  training = true;
  added = 0;
  ui.trainStatus.textContent = `${fmt(n)}場面で学習を準備しています…`;
  ui.trainBar.style.width = '0%';
  updateTrainUI();
  updateEmpty();
  updateHeatClass();
  renderChart();
}

function onWorkerMessage(e) {
  const m = e.data;
  if (m.type === 'progress') {
    const f = ((m.epoch - 1) + m.batch / m.batches) / m.epochs;
    ui.trainBar.style.width = `${(f * 100).toFixed(1)}%`;
    ui.trainRun.hidden = false;
    ui.trainRun.style.transform = `scaleX(${f})`;
    ui.trainStatus.innerHTML = `<b>${epochBase + m.epoch}回目</b>を学習中（今回 ${m.epoch} / ${m.epochs}）`;
  } else if (m.type === 'epoch') {
    model.P.set(m.params);
    trainedEpochs = epochBase + m.epoch;
    history.push({ epoch: trainedEpochs, trainAcc: m.trainAcc, valAcc: m.valAcc });
    renderChart();
  } else if (m.type === 'done') {
    model.P.set(m.params);
    training = false;
    ui.trainRun.hidden = true;
    const last = history[history.length - 1];
    ui.trainStatus.innerHTML = last
      ? `${m.stopped ? '途中で止めました' : '学習が終わりました'}。検証データの正解率は<b>${Math.round(last.valAcc * 100)}%</b>です。「3 AIが運転」で走りを確かめましょう。`
      : '途中で止めました。';
    if (!m.stopped) ui.trainBar.style.width = '100%';
    saveModel();
    updateTrainUI();
    renderChart();
    if (!m.stopped) showToast('学習が終わりました', 'info');
  } else if (m.type === 'error') {
    training = false;
    ui.trainRun.hidden = true;
    ui.trainStatus.textContent = `学習を続けられませんでした（${m.message}）。`;
    updateTrainUI();
  }
}

function saveModel() {
  if (!model) return;
  saveStore({ model: f32ToB64(model.P), modelSig: MODEL_SIG, trainedEpochs, history: history.slice(-40) });
}

function updateTrainUI() {
  ui.trainBtn.classList.toggle('stop', training);
  ui.trainBtn.textContent = training ? '学習を止める' : (model ? '続けて学習する' : '学習をはじめる');
  ui.resetBtn.hidden = training || !model;
  ui.epochSeg.querySelectorAll('button').forEach((b) => { b.disabled = training; });
  if (!training && !model) ui.trainStatus.textContent = n < MIN_SAMPLES ? `いま${fmt(n)}場面。${fmt(MIN_SAMPLES)}場面以上あると学習できます。` : `${fmt(n)}場面を記録済み。学習できます。`;
  ui.retrainBtn.disabled = added === 0 || training;
}

// 正解率のグラフ（SVG）。学習データ＝青、検証データ＝緑
const SVGNS = 'http://www.w3.org/2000/svg';
const CH = { W: 320, H: 150, L: 36, R: 44, T: 10, B: 24 };
function chartX(e, maxE) { return CH.L + (maxE <= 1 ? 0 : ((e - 1) / (maxE - 1))) * (CH.W - CH.L - CH.R); }
function chartY(v) { return CH.T + (1 - v) * (CH.H - CH.T - CH.B); }
function chartMaxE() {
  const lastE = history.length ? history[history.length - 1].epoch : 0;
  return Math.max(4, lastE, training ? epochBase + epochsPlanned : 0);
}
function renderChart() {
  const svg = ui.chart;
  svg.textContent = '';
  const el = (name, attrs, text) => {
    const o = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs)) o.setAttribute(k, v);
    if (text !== undefined) o.textContent = text;
    svg.appendChild(o);
    return o;
  };
  const maxE = chartMaxE();
  for (const v of [0, 0.5, 1]) {
    el('line', { x1: CH.L, x2: CH.W - CH.R, y1: chartY(v), y2: chartY(v), stroke: '#dde2e6', 'stroke-width': 1 });
    el('text', { x: CH.L - 6, y: chartY(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#4a5560' }, `${v * 100}%`);
  }
  const ticks = maxE <= 8 ? Array.from({ length: maxE }, (_, i) => i + 1) : [1, Math.round(maxE / 2), maxE];
  for (const e of ticks) {
    el('text', { x: chartX(e, maxE), y: CH.H - 6, 'text-anchor': 'middle', 'font-size': 10, fill: '#4a5560' }, `${e}`);
  }
  el('text', { x: CH.W - CH.R + 8, y: CH.H - 6, 'font-size': 10, fill: '#4a5560' }, '回');
  if (!history.length) {
    el('text', { x: (CH.L + CH.W - CH.R) / 2, y: chartY(0.55), 'text-anchor': 'middle', 'font-size': 11, fill: '#4a5560' }, '学習をはじめると、回ごとの正解率がここに出ます');
  } else {
    const series = [['trainAcc', '#1d5daf'], ['valAcc', '#0e9f4b']];
    for (const [key, color] of series) {
      const d = history.map((h, i) => `${i ? 'L' : 'M'}${chartX(h.epoch, maxE).toFixed(1)},${chartY(h[key]).toFixed(1)}`).join(' ');
      el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      for (const h of history) {
        el('circle', { cx: chartX(h.epoch, maxE), cy: chartY(h[key]), r: 4, fill: color, stroke: '#fff', 'stroke-width': 2 });
      }
    }
    // 最後の点の横に数値（重なるときは上下にずらす）
    const last = history[history.length - 1];
    let yt = chartY(last.trainAcc), yv = chartY(last.valAcc);
    if (Math.abs(yt - yv) < 12) {
      const mid = (yt + yv) / 2;
      const up = last.trainAcc >= last.valAcc;
      yt = mid + (up ? -6 : 6); yv = mid + (up ? 6 : -6);
    }
    const lx = chartX(last.epoch, maxE) + 8;
    el('text', { x: lx, y: yt + 4, 'font-size': 11, 'font-weight': 700, fill: '#1b2026' }, `${Math.round(last.trainAcc * 100)}%`);
    el('text', { x: lx, y: yv + 4, 'font-size': 11, 'font-weight': 700, fill: '#1b2026' }, `${Math.round(last.valAcc * 100)}%`);
  }
  svg.setAttribute('aria-label', history.length
    ? `正解率のグラフ。${history.length}回分。最新は学習データ${Math.round(history[history.length - 1].trainAcc * 100)}%、検証データ${Math.round(history[history.length - 1].valAcc * 100)}%`
    : '正解率のグラフ。まだデータがありません');
  const tbody = ui.chartTable.tBodies[0];
  tbody.innerHTML = history.map((h) => `<tr><td>${h.epoch}</td><td>${Math.round(h.trainAcc * 100)}%</td><td>${Math.round(h.valAcc * 100)}%</td></tr>`).join('');
}

let tipTimer = 0;
function showChartTip(ev) {
  if (!history.length) return;
  const rect = ui.chart.getBoundingClientRect();
  const sx = ((ev.clientX - rect.left) / rect.width) * CH.W;
  const maxE = chartMaxE();
  let best = history[0], bd = Infinity;
  for (const h of history) {
    const dx = Math.abs(chartX(h.epoch, maxE) - sx);
    if (dx < bd) { bd = dx; best = h; }
  }
  const boxRect = ui.chartBox.getBoundingClientRect();
  const px = rect.left - boxRect.left + (chartX(best.epoch, maxE) / CH.W) * rect.width;
  const py = rect.top - boxRect.top + (chartY(Math.max(best.trainAcc, best.valAcc)) / CH.H) * rect.height - 8;
  ui.chartTip.hidden = false;
  ui.chartTip.innerHTML = `${best.epoch}回目<br>学習データ ${Math.round(best.trainAcc * 100)}%<br>検証データ ${Math.round(best.valAcc * 100)}%`;
  ui.chartTip.style.left = `${Math.min(boxRect.width - 70, Math.max(70, px))}px`;
  ui.chartTip.style.top = `${py}px`;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => { ui.chartTip.hidden = true; }, 2500);
}

// ---------- 入力の登録 ----------
function bindPad(el, side) {
  const set = (v) => { human[side] = v; el.classList.toggle('on', v); };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* 古いブラウザ */ }
    set(true);
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, () => set(false));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindPad(ui.padL, 'L');
bindPad(ui.padR, 'R');

const KEYMAP = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R' };
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  else if (e.key === '1') setMode('teach');
  else if (e.key === '2') setMode('train');
  else if (e.key === '3') setMode('drive');
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
window.addEventListener('blur', () => { keys.L = keys.R = false; human.L = human.R = false; ui.padL.classList.remove('on'); ui.padR.classList.remove('on'); });

ui.tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
ui.speedBtn.addEventListener('click', () => setSpeed(speedIdx + 1));
ui.clearBtn.addEventListener('click', () => {
  if (!n) return;
  if (!confirm(`記録した${fmt(n)}場面をすべて消しますか？`)) return;
  n = 0; counts.fill(0); added = 0;
  dirty.clear();
  clearAll().catch(() => { /* 保存できない環境では何もしない */ });
  updateDataUI();
});
ui.augToggle.addEventListener('click', () => {
  augOn = !augOn;
  ui.augToggle.setAttribute('aria-pressed', String(augOn));
  saveStore({ augOn });
});
ui.epochSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || training) return;
  epochsPlanned = Number(b.dataset.ep);
  ui.epochSeg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderChart();
});
ui.trainBtn.addEventListener('click', () => startTraining(false));
ui.resetBtn.addEventListener('click', () => {
  if (!confirm('いまのAIの記憶を消して、はじめから学習し直しますか？')) return;
  startTraining(true);
});
ui.retrainBtn.addEventListener('click', () => { setMode('train'); startTraining(false); });
const setBig = (v) => {
  bigOn = v;
  ui.stage.classList.toggle('big', v);
  ui.bigToggle.setAttribute('aria-pressed', String(v));
  ui.eyeBtn.setAttribute('aria-label', v ? 'AIの目を小さく戻す' : 'AIの目を大きく表示する');
};
ui.eyeBtn.addEventListener('click', () => setBig(!bigOn));
ui.bigToggle.addEventListener('click', () => setBig(!bigOn));
ui.heatToggle.addEventListener('click', () => {
  heatOn = !heatOn;
  ui.heatToggle.setAttribute('aria-pressed', String(heatOn));
  if (!heatOn) clearHeat();
  updateHeatClass();
});
ui.featToggle.addEventListener('click', () => {
  featOn = !featOn;
  ui.featToggle.setAttribute('aria-pressed', String(featOn));
  ui.featBox.hidden = !featOn;
});
ui.chart.addEventListener('pointerdown', showChartTip);
ui.chart.addEventListener('pointermove', showChartTip);
ui.chart.addEventListener('pointerleave', () => { ui.chartTip.hidden = true; });

const openHelp = () => { ui.help.hidden = false; ui.helpClose.focus(); };
const closeHelp = () => { ui.help.hidden = true; saveStore({ helpSeen: true }); };
ui.helpBtn.addEventListener('click', openHelp);
ui.helpClose.addEventListener('click', closeHelp);
ui.help.addEventListener('click', (e) => { if (e.target === ui.help) closeHelp(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.help.hidden) closeHelp(); });

// ---------- ループ ----------
const resize = () => {
  const r = ui.stage.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  renderer.setSize(r.width, r.height, false);
  cam.aspect = r.width / r.height;
  cam.updateProjectionMatrix();
};
new ResizeObserver(resize).observe(ui.stage);
resize();

let paused = false;
let last = performance.now();
let acc = 0;
document.addEventListener('visibilitychange', () => {
  paused = document.hidden;
  last = performance.now();
  if (document.hidden) flushData();
});
window.addEventListener('pagehide', flushData);
setInterval(flushData, 3000);

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (paused) return;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 8) { physicsStep(); acc -= STEP; steps++; }
  if (steps === 8) acc = 0;
  syncCarMesh();
  updateChase(dt);
  renderer.render(scene, cam);
}

// ---------- 起動 ----------
setSpeed(speedIdx);
ui.augToggle.setAttribute('aria-pressed', String(augOn));
ui.expertBadge.hidden = !EXPERT;
syncCarMesh();
updateChase(0, true);
setMode('teach');
renderChart();
updateTrainUI();
if (model) {
  ui.trainStatus.innerHTML = `前回までに<b>${trainedEpochs}回</b>学習したAIを読み込みました。「3 AIが運転」でそのまま走らせられます。`;
}
if (!store.helpSeen) openHelp();
requestAnimationFrame((t) => { last = t; loop(t); });

// 前回までの記録を読み込む
loadAll(data, labels, S, MAX_SAMPLES)
  .then((m) => {
    n = m;
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[labels[i]]++;
    if (n > 0) showToast(`前回の記録 ${fmt(n)}場面を読み込みました`, 'info');
  })
  .catch(() => { persistOk = false; })
  .finally(() => {
    dataReady = true;
    updateDataUI();
    updateTrainUI();
    if (model) ui.trainStatus.innerHTML = `前回までに<b>${trainedEpochs}回</b>学習したAIを読み込みました。「3 AIが運転」でそのまま走らせられます。`;
  });

const allowSW = !['localhost', '127.0.0.1'].includes(location.hostname) || new URLSearchParams(location.search).has('sw');
if ('serviceWorker' in navigator && allowSW) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン対応なしでも遊べる */ });
}

// 自動テスト用の窓口
window.__aieye = {
  get n() { return n; }, get mode() { return mode; }, get training() { return training; },
  get history() { return history; }, get probs() { return aiProbs; }, get hasModel() { return model !== null; },
  get dataReady() { return dataReady; }, flushData,
  stats, car, setMode, setSpeed, startTraining, closeHelp,
  setEpochs(e) { epochsPlanned = e; },
  setAug(v) { augOn = v; ui.augToggle.setAttribute('aria-pressed', String(v)); },
};
