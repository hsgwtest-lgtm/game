// ═══════════════════════════════════════════════════════════════════════════
// SYNAPSE — ニューラル迷宮  |  engine.js
// ═══════════════════════════════════════════════════════════════════════════
//
// Concept: 「学習のメタファー」
//   ニューラルネットワークが迷路を解く過程を、3D空間上でリアルタイムに可視化する。
//   ユーザーは「環境デザイナー」兼「脳外科医」として、壁の配置・ゴール移動・
//   ニューロン凍結などの介入を行い、AIの学習ダイナミクスに直接影響を与える。
//
// Architecture:
//   - NeuralNetwork: 多層パーセプトロン（ReLU + 線形出力）、手動バックプロパゲーション
//   - Q-Learning: 経験再生バッファ + ε-greedy探索 + TD(0)ターゲット
//   - GridWorld: 2Dグリッド上の障害物環境（迷路生成: 再帰バックトラッカー）
//   - Three.js: InstancedMesh（壁）、Force-directed brain graph、パーティクルシステム
//
// Why manual backprop instead of a library:
//   外部MLライブラリ（TensorFlow.js等）は数MBのオーバーヘッドを持ち、
//   PWAのオフライン制約・軽量性と相反する。4層・380パラメータの小規模ネットワークでは
//   手動実装の方がメモリ効率が高く、勾配の可視化も容易。
// ═══════════════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ═══════════ Constants ═══════════ */

const GRID_W = 12, GRID_H = 12;
const CELL = 1.0;
const OX = -GRID_W * CELL / 2 + CELL / 2;   // grid origin X
const OZ = -GRID_H * CELL / 2 + CELL / 2;   // grid origin Z
const BRAIN_Y = 9;                            // brain float height
const NET_LAYERS = [12, 16, 8, 4];            // network topology
const ACTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // UP RIGHT DOWN LEFT
const ACTION_LABELS = ['↑', '→', '↓', '←'];
const MAX_STEPS = 200;
const REPLAY_CAP = 10000;
const BATCH_SIZE = 32;
const NEURON_RADIUS = 0.18;
const TRAIL_MAX = 60;

const C = {
  bg: 0x050510, floor: 0x0a0a1a, gridLine: 0x1a1a3a,
  wall: 0x3a2070, wallEmit: 0x1a0a3a,
  agent: 0x63d2ff, agentEmit: 0x2080bb,
  goal: 0xffd700, goalEmit: 0xbb9900,
  nInactive: 0x333355, nActive: 0x63d2ff,
  nFrozenOff: 0x661111, nFrozenOn: 0xeeeeff,
  wPos: 0x4488ff, wNeg: 0xff4444,
  trail: 0x2060aa, particleGold: 0xffcc00, particleRed: 0xff3333,
};

/* ═══════════ Utilities ═══════════ */

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function gaussRandom() {
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}
function gridToWorld(gx, gy) { return [OX + gx * CELL, 0, OZ + gy * CELL]; }
function worldToGrid(wx, wz) {
  return [Math.round((wx - OX) / CELL), Math.round((wz - OZ) / CELL)];
}

/* ═══════════ NeuralNetwork ═══════════ */
// 多層パーセプトロン: Xavier初期化、ReLU隠れ層、線形出力
// 技術的根拠: Q-Learning の関数近似には非線形活性化が必須。
// ReLU は勾配消失を避けつつ計算コストが低く、小規模ネットワークに最適。
// Xavier初期化はReLU + 線形出力のネットワークで勾配の分散を安定させる。

class NeuralNetwork {
  constructor(sizes) {
    this.sizes = sizes;
    this.L = sizes.length;            // total layers incl. input
    this.weights = [];                 // weights[l]: Float32Array, flat [in*out]
    this.biases = [];                  // biases[l]: Float32Array [outSize]
    this.activations = [];             // stored per forward pass
    this.preActs = [];                 // pre-activation (for backprop & visualization)
    this.neuronStates = [];            // 0=normal, 1=frozen_off, 2=frozen_on

    for (let l = 0; l < this.L - 1; l++) {
      const fanIn = sizes[l], fanOut = sizes[l + 1];
      const scale = Math.sqrt(2.0 / fanIn);   // He initialization (suitable for ReLU)
      const w = new Float32Array(fanIn * fanOut);
      for (let i = 0; i < w.length; i++) w[i] = gaussRandom() * scale;
      this.weights.push(w);
      this.biases.push(new Float32Array(fanOut));
    }
    for (let l = 0; l < this.L; l++) {
      this.neuronStates.push(new Uint8Array(sizes[l])); // all normal
    }
  }

  forward(input) {
    const acts = [Float32Array.from(input)];
    const pres = [null];
    let cur = acts[0];

    for (let l = 0; l < this.L - 1; l++) {
      const inSz = this.sizes[l], outSz = this.sizes[l + 1];
      const w = this.weights[l], b = this.biases[l];
      const pre = new Float32Array(outSz);
      const act = new Float32Array(outSz);
      const states = this.neuronStates[l + 1];

      for (let j = 0; j < outSz; j++) {
        // Frozen neuron handling
        if (states[j] === 1) { pre[j] = 0; act[j] = 0; continue; }
        if (states[j] === 2) { pre[j] = 1; act[j] = 1; continue; }

        let sum = b[j];
        for (let i = 0; i < inSz; i++) sum += cur[i] * w[i * outSz + j];
        pre[j] = sum;
        act[j] = l < this.L - 2 ? Math.max(0, sum) : sum; // ReLU hidden, linear output
      }
      pres.push(pre);
      acts.push(act);
      cur = act;
    }
    this.activations = acts;
    this.preActs = pres;
    return cur;
  }

  // TD-error backpropagation for a single (state, action, targetQ)
  // Only the chosen action's Q-value receives gradient.
  // Gradient clipping at ±1.0 prevents exploding gradients in early training.
  train(state, action, targetQ, lr) {
    const q = this.forward(state);
    const outSize = this.sizes[this.L - 1];

    // δ[layer index] = gradient of loss w.r.t. pre-activation at that layer
    const delta = new Array(this.L).fill(null);

    // Output delta (MSE gradient, only for chosen action)
    delta[this.L - 1] = new Float32Array(outSize);
    delta[this.L - 1][action] = clamp(q[action] - targetQ, -1, 1);

    // Backprop hidden layers
    for (let l = this.L - 2; l >= 1; l--) {
      const sz = this.sizes[l], nextSz = this.sizes[l + 1];
      const d = new Float32Array(sz);
      const nd = delta[l + 1], w = this.weights[l];
      const states = this.neuronStates[l];
      for (let i = 0; i < sz; i++) {
        if (states[i] !== 0) continue; // skip frozen neurons
        let sum = 0;
        for (let j = 0; j < nextSz; j++) sum += nd[j] * w[i * nextSz + j];
        d[i] = this.preActs[l][i] > 0 ? clamp(sum, -1, 1) : 0; // ReLU derivative
      }
      delta[l] = d;
    }

    // Weight update (SGD)
    for (let l = 0; l < this.L - 1; l++) {
      const inSz = this.sizes[l], outSz = this.sizes[l + 1];
      const w = this.weights[l], b = this.biases[l];
      const a = this.activations[l], d = delta[l + 1];
      for (let j = 0; j < outSz; j++) {
        if (this.neuronStates[l + 1][j] !== 0) continue;
        for (let i = 0; i < inSz; i++) {
          w[i * outSz + j] -= lr * d[j] * a[i];
        }
        b[j] -= lr * d[j];
      }
    }
    return delta;
  }

  clone() {
    const nn = new NeuralNetwork(this.sizes);
    for (let l = 0; l < this.weights.length; l++) {
      nn.weights[l].set(this.weights[l]);
      nn.biases[l].set(this.biases[l]);
    }
    return nn;
  }

  toggleNeuron(layerIdx, neuronIdx) {
    if (layerIdx <= 0 || layerIdx >= this.L) return;
    const s = this.neuronStates[layerIdx];
    s[neuronIdx] = (s[neuronIdx] + 1) % 3;
    return s[neuronIdx]; // 0=normal, 1=frozen_off, 2=frozen_on
  }
}

/* ═══════════ ReplayBuffer ═══════════ */
// 技術的根拠: 経験再生は時系列相関を破壊し、Q-Learningの収束を安定させる。
// リングバッファによりO(1)のpush・O(1)のランダムアクセスを実現。

class ReplayBuffer {
  constructor(cap) { this.cap = cap; this.buf = []; this.pos = 0; }
  push(s, a, r, ns, done) {
    const exp = { s, a, r, ns, done };
    if (this.buf.length < this.cap) this.buf.push(exp);
    else this.buf[this.pos] = exp;
    this.pos = (this.pos + 1) % this.cap;
  }
  sample(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.buf[(Math.random() * this.buf.length) | 0]);
    return out;
  }
  get length() { return this.buf.length; }
}

/* ═══════════ GridWorld ═══════════ */

class GridWorld {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.cells = new Uint8Array(w * h);     // 0=empty, 1=wall
    this.agentX = 1; this.agentY = 1;
    this.goalX = w - 2; this.goalY = h - 2;
    this.startX = 1; this.startY = 1;
    this.dirty = true;
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h; }
  isWall(x, y) { return !this.inBounds(x, y) || this.cells[this.idx(x, y)] === 1; }

  setCell(x, y, val) {
    if (!this.inBounds(x, y)) return;
    if (x === this.agentX && y === this.agentY) return;
    if (x === this.goalX && y === this.goalY) return;
    this.cells[this.idx(x, y)] = val;
    this.dirty = true;
  }

  moveGoal(x, y) {
    if (!this.inBounds(x, y) || this.isWall(x, y)) return false;
    this.goalX = x; this.goalY = y;
    this.dirty = true;
    return true;
  }

  reset() {
    this.agentX = this.startX;
    this.agentY = this.startY;
    return this.getState();
  }

  getState() {
    const s = new Float32Array(12);
    s[0] = this.agentX / (this.w - 1);
    s[1] = this.agentY / (this.h - 1);
    s[2] = this.goalX / (this.w - 1);
    s[3] = this.goalY / (this.h - 1);
    // 8 surrounding cells
    const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    for (let i = 0; i < 8; i++) {
      const nx = this.agentX + dirs[i][0], ny = this.agentY + dirs[i][1];
      s[4 + i] = this.isWall(nx, ny) ? 1.0 : 0.0;
    }
    return s;
  }

  step(action, shaping) {
    const dx = ACTIONS[action][0], dy = ACTIONS[action][1];
    const nx = this.agentX + dx, ny = this.agentY + dy;
    let reward = -0.05;   // step cost encourages efficiency
    let done = false;

    if (this.isWall(nx, ny)) {
      reward = -1.0;      // wall penalty
    } else {
      // Distance-based shaping reward
      if (shaping) {
        const oldDist = Math.abs(this.agentX - this.goalX) + Math.abs(this.agentY - this.goalY);
        const newDist = Math.abs(nx - this.goalX) + Math.abs(ny - this.goalY);
        reward += (oldDist - newDist) * 0.1;
      }
      this.agentX = nx;
      this.agentY = ny;
      if (nx === this.goalX && ny === this.goalY) {
        reward = 10.0;
        done = true;
      }
    }
    return { state: this.getState(), reward, done };
  }

  // Maze generation using recursive backtracker (DFS).
  // 技術的根拠: DFS迷路は連結性を保証し、必ず解が存在する。
  // 奇数座標にノード、偶数座標に壁を配置する「薄壁」方式。
  generateMaze() {
    this.cells.fill(1);
    const visited = new Uint8Array(this.w * this.h);
    const stack = [];

    const carve = (x, y) => {
      this.cells[this.idx(x, y)] = 0;
      visited[this.idx(x, y)] = 1;
    };

    // Start from (1,1)
    carve(1, 1);
    stack.push([1, 1]);

    while (stack.length > 0) {
      const [cx, cy] = stack[stack.length - 1];
      const neighbors = [];
      for (const [dx, dy] of [[0, -2], [2, 0], [0, 2], [-2, 0]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 1 && nx < this.w - 1 && ny >= 1 && ny < this.h - 1 && !visited[this.idx(nx, ny)]) {
          neighbors.push([nx, ny, cx + dx / 2, cy + dy / 2]);
        }
      }
      if (neighbors.length === 0) { stack.pop(); continue; }
      const [nx, ny, mx, my] = neighbors[(Math.random() * neighbors.length) | 0];
      carve(mx, my);
      carve(nx, ny);
      stack.push([nx, ny]);
    }

    // Ensure start and goal are open
    this.cells[this.idx(1, 1)] = 0;
    this.cells[this.idx(this.w - 2, this.h - 2)] = 0;
    this.startX = 1; this.startY = 1;
    this.goalX = this.w - 2; this.goalY = this.h - 2;
    this.dirty = true;
  }

  clear() {
    this.cells.fill(0);
    this.startX = 1; this.startY = 1;
    this.goalX = this.w - 2; this.goalY = this.h - 2;
    this.dirty = true;
  }
}

/* ═══════════ Main Game ═══════════ */

class Game {
  constructor() {
    this.world = new GridWorld(GRID_W, GRID_H);
    this.net = new NeuralNetwork(NET_LAYERS);
    this.targetNet = this.net.clone();        // target network for stable Q targets
    this.buffer = new ReplayBuffer(REPLAY_CAP);

    // Training state
    this.episode = 0;
    this.stepCount = 0;
    this.episodeReward = 0;
    this.episodeSteps = 0;
    this.epsilon = 1.0;
    this.lr = 0.001;
    this.gamma = 0.95;
    this.speed = 1;
    this.shaping = true;
    this.running = false;
    this.currentState = null;

    // Stats tracking
    this.recentRewards = [];
    this.recentSuccess = [];
    this.graphData = [];

    // Interaction
    this.tool = 'observe';

    // Animation
    this.agentVisualX = 1; this.agentVisualZ = 1;
    this.trailPositions = [];
    this.clock = new THREE.Clock();
  }

  init() {
    this.initThree();
    this.initGrid();
    this.initBrain();
    this.initParticles();
    this.initUI();
    this.currentState = this.world.reset();
    this.animate();
  }

  /* ─── Three.js Setup ─── */
  initThree() {
    const canvas = document.getElementById('c');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(C.bg);
    this.scene.fog = new THREE.FogExp2(C.bg, 0.012);

    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
    this.camera.position.set(0, 18, 16);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 3, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 40;

    // Lighting
    this.scene.add(new THREE.AmbientLight(0x222244, 0.6));
    const dir = new THREE.DirectionalLight(0xccccff, 0.5);
    dir.position.set(5, 15, 5);
    this.scene.add(dir);

    // Raycaster
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  /* ─── Grid Rendering ─── */
  initGrid() {
    // Floor plane with grid pattern (CanvasTexture)
    const texSize = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = texSize;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, texSize, texSize);
    ctx.strokeStyle = '#1a1a3a';
    ctx.lineWidth = 1;
    const step = texSize / GRID_W;
    for (let i = 0; i <= GRID_W; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, texSize); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(texSize, i * step); ctx.stroke();
    }
    const floorTex = new THREE.CanvasTexture(cv);
    const floorGeo = new THREE.PlaneGeometry(GRID_W * CELL, GRID_H * CELL);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0.1 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.name = 'floor';
    this.scene.add(floor);
    this.floor = floor;

    // Wall InstancedMesh
    const wallGeo = new THREE.BoxGeometry(CELL * 0.9, CELL * 0.7, CELL * 0.9);
    const wallMat = new THREE.MeshStandardMaterial({
      color: C.wall, emissive: C.wallEmit, emissiveIntensity: 0.3,
      roughness: 0.6, metalness: 0.3
    });
    this.wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, GRID_W * GRID_H);
    this.wallMesh.count = 0;
    this.wallMesh.name = 'walls';
    this.scene.add(this.wallMesh);

    // Agent mesh
    const agentGeo = new THREE.IcosahedronGeometry(0.3, 2);
    const agentMat = new THREE.MeshStandardMaterial({
      color: C.agent, emissive: C.agentEmit, emissiveIntensity: 0.6,
      roughness: 0.2, metalness: 0.5
    });
    this.agentMesh = new THREE.Mesh(agentGeo, agentMat);
    this.agentMesh.position.set(OX + CELL, 0.35, OZ + CELL);
    this.scene.add(this.agentMesh);

    this.agentLight = new THREE.PointLight(C.agent, 1.5, 5);
    this.agentLight.position.copy(this.agentMesh.position);
    this.agentLight.position.y = 0.8;
    this.scene.add(this.agentLight);

    // Goal mesh
    const goalGeo = new THREE.OctahedronGeometry(0.25, 0);
    const goalMat = new THREE.MeshStandardMaterial({
      color: C.goal, emissive: C.goalEmit, emissiveIntensity: 0.8,
      roughness: 0.2, metalness: 0.6
    });
    this.goalMesh = new THREE.Mesh(goalGeo, goalMat);
    const gp = gridToWorld(this.world.goalX, this.world.goalY);
    this.goalMesh.position.set(gp[0], 0.5, gp[2]);
    this.scene.add(this.goalMesh);

    this.goalLight = new THREE.PointLight(C.goal, 1.2, 4);
    this.goalLight.position.copy(this.goalMesh.position);
    this.goalLight.position.y = 1;
    this.scene.add(this.goalLight);

    // Trail (ring buffer of small points)
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    trailGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(TRAIL_MAX * 4), 4));
    const trailMat = new THREE.PointsMaterial({
      size: 0.12, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.trailPoints = new THREE.Points(trailGeo, trailMat);
    this.trailPoints.frustumCulled = false;
    this.scene.add(this.trailPoints);
    this.trailIdx = 0;

    // Grid interaction plane (invisible)
    const iPlane = new THREE.PlaneGeometry(GRID_W * CELL, GRID_H * CELL);
    const iPlaneMat = new THREE.MeshBasicMaterial({ visible: false });
    this.interactionPlane = new THREE.Mesh(iPlane, iPlaneMat);
    this.interactionPlane.rotation.x = -Math.PI / 2;
    this.interactionPlane.position.y = 0;
    this.interactionPlane.name = 'iplane';
    this.scene.add(this.interactionPlane);
  }

  rebuildWalls() {
    const dummy = new THREE.Object3D();
    let count = 0;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (this.world.cells[this.world.idx(x, y)] === 1) {
          const [wx, , wz] = gridToWorld(x, y);
          dummy.position.set(wx, 0.35, wz);
          dummy.updateMatrix();
          this.wallMesh.setMatrixAt(count, dummy.matrix);
          count++;
        }
      }
    }
    this.wallMesh.count = count;
    this.wallMesh.instanceMatrix.needsUpdate = true;
  }

  /* ─── Brain Rendering ─── */
  // ニューロンを3D空間で同心円状に配置。レイヤーはY軸方向にスタック。
  // 接続はLineSegmentsで一括描画（頂点カラーで重み符号・大きさを表現）。
  initBrain() {
    this.brainGroup = new THREE.Group();
    this.brainGroup.position.set(0, BRAIN_Y, 0);
    this.scene.add(this.brainGroup);

    // Compute neuron positions (circle layout per layer)
    this.neuronPositions = []; // [layer][neuron] = THREE.Vector3
    this.neuronMeshes = [];    // [layer][neuron] = Mesh
    const layerSpacing = 2.2;
    const baseY = 0;

    const neuronGeo = new THREE.SphereGeometry(NEURON_RADIUS, 12, 8);

    for (let l = 0; l < NET_LAYERS.length; l++) {
      const n = NET_LAYERS[l];
      const posArr = [];
      const meshArr = [];
      const y = baseY + l * layerSpacing;
      const radius = Math.max(0.6, n * 0.15);

      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const pos = new THREE.Vector3(x, y, z);
        posArr.push(pos);

        const mat = new THREE.MeshStandardMaterial({
          color: C.nInactive, emissive: C.nInactive, emissiveIntensity: 0.2,
          roughness: 0.4, metalness: 0.3
        });
        const mesh = new THREE.Mesh(neuronGeo, mat);
        mesh.position.copy(pos);
        mesh.userData = { layer: l, index: i };
        this.brainGroup.add(mesh);
        meshArr.push(mesh);
      }
      this.neuronPositions.push(posArr);
      this.neuronMeshes.push(meshArr);
    }

    // Connection lines
    this.connectionCount = 0;
    for (let l = 0; l < NET_LAYERS.length - 1; l++) {
      this.connectionCount += NET_LAYERS[l] * NET_LAYERS[l + 1];
    }

    const linePositions = new Float32Array(this.connectionCount * 6); // 2 verts * 3 coords
    const lineColors = new Float32Array(this.connectionCount * 6);    // 2 verts * 3 color channels
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.connectionLines = new THREE.LineSegments(lineGeo, lineMat);
    this.brainGroup.add(this.connectionLines);
    this.updateBrainVisuals();

    // Brain ambient light
    const bLight = new THREE.PointLight(0x4466aa, 0.8, 8);
    bLight.position.set(0, NET_LAYERS.length * layerSpacing / 2, 0);
    this.brainGroup.add(bLight);
  }

  updateBrainVisuals() {
    const posAttr = this.connectionLines.geometry.getAttribute('position');
    const colAttr = this.connectionLines.geometry.getAttribute('color');
    let idx = 0;

    for (let l = 0; l < NET_LAYERS.length - 1; l++) {
      const inSz = NET_LAYERS[l], outSz = NET_LAYERS[l + 1];
      const w = this.net.weights[l];
      const inActs = this.net.activations[l];
      const outActs = this.net.activations[l + 1];

      for (let i = 0; i < inSz; i++) {
        for (let j = 0; j < outSz; j++) {
          const p1 = this.neuronPositions[l][i];
          const p2 = this.neuronPositions[l + 1][j];
          const vi = idx * 6;

          posAttr.array[vi] = p1.x; posAttr.array[vi + 1] = p1.y; posAttr.array[vi + 2] = p1.z;
          posAttr.array[vi + 3] = p2.x; posAttr.array[vi + 4] = p2.y; posAttr.array[vi + 5] = p2.z;

          const wt = w[i * outSz + j];
          const mag = Math.min(1, Math.abs(wt) * 0.5);
          let r, g, b;
          if (wt >= 0) { r = 0.2 * mag; g = 0.4 * mag; b = mag; }     // blue = positive
          else         { r = mag; g = 0.15 * mag; b = 0.15 * mag; }     // red = negative

          // Modulate by activation flow if available
          if (inActs && outActs) {
            const flow = Math.abs((inActs[i] || 0) * wt) * 0.3;
            r = Math.min(1, r + flow); g = Math.min(1, g + flow); b = Math.min(1, b + flow);
          }

          colAttr.array[vi] = r; colAttr.array[vi + 1] = g; colAttr.array[vi + 2] = b;
          colAttr.array[vi + 3] = r; colAttr.array[vi + 4] = g; colAttr.array[vi + 5] = b;
          idx++;
        }
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Update neuron colors
    for (let l = 0; l < NET_LAYERS.length; l++) {
      const acts = this.net.activations[l];
      const states = this.net.neuronStates[l];
      for (let i = 0; i < NET_LAYERS[l]; i++) {
        const mesh = this.neuronMeshes[l][i];
        const state = states[i];
        const act = acts ? Math.min(1, Math.abs(acts[i] || 0)) : 0;

        if (state === 1) {        // frozen off
          mesh.material.color.setHex(C.nFrozenOff);
          mesh.material.emissive.setHex(C.nFrozenOff);
          mesh.material.emissiveIntensity = 0.3;
          mesh.scale.setScalar(0.7);
        } else if (state === 2) { // frozen on
          mesh.material.color.setHex(C.nFrozenOn);
          mesh.material.emissive.setHex(C.nFrozenOn);
          mesh.material.emissiveIntensity = 0.8;
          mesh.scale.setScalar(1.3);
        } else {                  // normal
          const color = new THREE.Color(C.nInactive).lerp(new THREE.Color(C.nActive), act);
          mesh.material.color.copy(color);
          mesh.material.emissive.copy(color);
          mesh.material.emissiveIntensity = 0.2 + act * 0.6;
          mesh.scale.setScalar(0.9 + act * 0.3);
        }
      }
    }
  }

  /* ─── Particle System ─── */
  initParticles() {
    const MAX = 200;
    this.particles = { max: MAX, count: 0, life: new Float32Array(MAX) };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX * 3), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAX * 3), 3));
    const mat = new THREE.PointsMaterial({
      size: 0.15, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.8
    });
    this.particleMesh = new THREE.Points(geo, mat);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);

    // Velocity storage
    this.particles.vx = new Float32Array(MAX);
    this.particles.vy = new Float32Array(MAX);
    this.particles.vz = new Float32Array(MAX);
  }

  emitParticles(pos, color, count) {
    const pAttr = this.particleMesh.geometry.getAttribute('position');
    const cAttr = this.particleMesh.geometry.getAttribute('color');
    const c = new THREE.Color(color);

    for (let i = 0; i < count; i++) {
      const idx = this.particles.count % this.particles.max;
      const vi = idx * 3;
      pAttr.array[vi] = pos.x; pAttr.array[vi + 1] = pos.y; pAttr.array[vi + 2] = pos.z;
      cAttr.array[vi] = c.r; cAttr.array[vi + 1] = c.g; cAttr.array[vi + 2] = c.b;
      this.particles.vx[idx] = (Math.random() - 0.5) * 2;
      this.particles.vy[idx] = Math.random() * 3 + 1;
      this.particles.vz[idx] = (Math.random() - 0.5) * 2;
      this.particles.life[idx] = 1.0;
      this.particles.count = Math.min(this.particles.count + 1, this.particles.max);
    }
    pAttr.needsUpdate = true;
    cAttr.needsUpdate = true;
  }

  updateParticles(dt) {
    const pAttr = this.particleMesh.geometry.getAttribute('position');
    const cAttr = this.particleMesh.geometry.getAttribute('color');
    let anyAlive = false;

    for (let i = 0; i < this.particles.count; i++) {
      if (this.particles.life[i] <= 0) continue;
      anyAlive = true;
      this.particles.life[i] -= dt * 1.5;
      const vi = i * 3;
      pAttr.array[vi] += this.particles.vx[i] * dt;
      pAttr.array[vi + 1] += this.particles.vy[i] * dt;
      pAttr.array[vi + 2] += this.particles.vz[i] * dt;
      this.particles.vy[i] -= 4 * dt; // gravity

      const alpha = Math.max(0, this.particles.life[i]);
      cAttr.array[vi] *= (0.97 + alpha * 0.03);
      cAttr.array[vi + 1] *= (0.95 + alpha * 0.05);
      cAttr.array[vi + 2] *= (0.93 + alpha * 0.07);
    }
    if (anyAlive) {
      pAttr.needsUpdate = true;
      cAttr.needsUpdate = true;
    }
  }

  /* ─── UI Wiring ─── */
  initUI() {
    // Tutorial
    document.getElementById('btn-start').addEventListener('click', () => {
      document.getElementById('tutorial-overlay').classList.add('hidden');
      this.running = true;
    });

    // Toolbar
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.tool = btn.dataset.tool;
        this.controls.enabled = this.tool === 'observe';
      });
    });

    // Controls
    const speedEl = document.getElementById('ctrl-speed');
    const lrEl = document.getElementById('ctrl-lr');
    const gammaEl = document.getElementById('ctrl-gamma');
    const shapingEl = document.getElementById('ctrl-shaping');

    speedEl.addEventListener('input', () => {
      this.speed = +speedEl.value;
      document.getElementById('val-speed').textContent = this.speed;
    });
    lrEl.addEventListener('input', () => {
      this.lr = Math.pow(10, +lrEl.value);
      document.getElementById('val-lr').textContent = this.lr.toFixed(4);
    });
    gammaEl.addEventListener('input', () => {
      this.gamma = +gammaEl.value;
      document.getElementById('val-gamma').textContent = this.gamma.toFixed(2);
    });
    shapingEl.addEventListener('change', () => {
      this.shaping = shapingEl.checked;
      document.getElementById('val-shaping').textContent = this.shaping ? 'ON' : 'OFF';
    });

    // Action buttons
    document.getElementById('btn-reset').addEventListener('click', () => {
      this.net = new NeuralNetwork(NET_LAYERS);
      this.targetNet = this.net.clone();
      this.buffer = new ReplayBuffer(REPLAY_CAP);
      this.episode = 0; this.epsilon = 1.0;
      this.recentRewards = []; this.recentSuccess = []; this.graphData = [];
      this.currentState = this.world.reset();
      this.showToast('🔄 ネットワークをリセットしました');
    });
    document.getElementById('btn-maze').addEventListener('click', () => {
      this.world.generateMaze();
      this.currentState = this.world.reset();
      this.showToast('🏗️ 迷路を生成しました');
    });
    document.getElementById('btn-clear').addEventListener('click', () => {
      this.world.clear();
      this.currentState = this.world.reset();
      this.showToast('🗑️ フィールドをクリアしました');
    });

    // Canvas interaction
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    canvas.addEventListener('pointermove', e => this.onPointerMove(e));

    // Graph canvas
    this.graphCanvas = document.getElementById('graph');
    this.graphCtx = this.graphCanvas.getContext('2d');
    this.graphCanvas.width = 220; this.graphCanvas.height = 110;
  }

  onPointerDown(e) {
    if (!this.running) return;
    if (this.tool === 'observe') return;

    this.pointer.x = (e.clientX / innerWidth) * 2 - 1;
    this.pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.tool === 'probe') {
      this.handleBrainProbe();
    } else {
      this.handleGridInteraction();
    }
  }

  onPointerMove(e) {
    if (!this.running) return;
    this.pointer.x = (e.clientX / innerWidth) * 2 - 1;
    this.pointer.y = -(e.clientY / innerHeight) * 2 + 1;

    if (this.tool === 'probe') {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      this.handleBrainHover(e);
    }
  }

  handleGridInteraction() {
    const hits = this.raycaster.intersectObject(this.interactionPlane);
    if (hits.length === 0) return;
    const p = hits[0].point;
    const [gx, gy] = worldToGrid(p.x, p.z);
    if (!this.world.inBounds(gx, gy)) return;

    if (this.tool === 'wall') {
      this.world.setCell(gx, gy, 1);
    } else if (this.tool === 'erase') {
      this.world.setCell(gx, gy, 0);
    } else if (this.tool === 'goal') {
      if (this.world.moveGoal(gx, gy)) {
        const gp = gridToWorld(gx, gy);
        this.goalMesh.position.set(gp[0], 0.5, gp[2]);
        this.goalLight.position.set(gp[0], 1, gp[2]);
      }
    }
  }

  handleBrainProbe() {
    // Collect all neuron meshes
    const allMeshes = [];
    for (let l = 0; l < NET_LAYERS.length; l++) {
      for (let i = 0; i < NET_LAYERS[l]; i++) {
        allMeshes.push(this.neuronMeshes[l][i]);
      }
    }
    this.raycaster.params.Mesh = {};
    const hits = this.raycaster.intersectObjects(allMeshes);
    if (hits.length === 0) return;

    const mesh = hits[0].object;
    const { layer, index } = mesh.userData;
    const newState = this.net.toggleNeuron(layer, index);
    const labels = ['通常', '凍結OFF', '凍結ON'];
    this.showToast(`🧠 L${layer}N${index}: ${labels[newState]}`);
  }

  handleBrainHover(e) {
    const allMeshes = [];
    for (let l = 0; l < NET_LAYERS.length; l++) {
      for (let i = 0; i < NET_LAYERS[l]; i++) {
        allMeshes.push(this.neuronMeshes[l][i]);
      }
    }
    const hits = this.raycaster.intersectObjects(allMeshes);
    const tooltip = document.getElementById('brain-tooltip');

    if (hits.length === 0) {
      tooltip.classList.add('hidden');
      return;
    }

    const mesh = hits[0].object;
    const { layer, index } = mesh.userData;
    const act = this.net.activations[layer] ? (this.net.activations[layer][index] || 0).toFixed(3) : '—';
    const state = this.net.neuronStates[layer][index];
    const stateLabel = ['通常', '凍結OFF', '凍結ON'][state];
    const layerLabel = layer === 0 ? '入力' : layer === NET_LAYERS.length - 1 ? '出力' : `隠れ${layer}`;
    let extra = '';
    if (layer === NET_LAYERS.length - 1) extra = ` (${ACTION_LABELS[index]})`;

    tooltip.innerHTML = `<b>${layerLabel} #${index}${extra}</b><br>活性: ${act}<br>状態: ${stateLabel}<br><small>クリックで切替</small>`;
    tooltip.classList.remove('hidden');
    tooltip.style.left = e.clientX + 'px';
    tooltip.style.top = e.clientY + 'px';
  }

  /* ─── Training ─── */
  trainStep() {
    // Epsilon-greedy action selection
    // Epsilon decays from 1.0 to 0.05 over ~500 episodes
    this.epsilon = Math.max(0.05, 1.0 - this.episode * 0.002);

    const state = this.currentState;
    let action;
    if (Math.random() < this.epsilon) {
      action = (Math.random() * 4) | 0;
    } else {
      const q = this.net.forward(state);
      action = 0;
      for (let i = 1; i < 4; i++) if (q[i] > q[action]) action = i;
    }

    const { state: nextState, reward, done } = this.world.step(action, this.shaping);
    this.buffer.push(state, action, reward, nextState, done);
    this.episodeReward += reward;
    this.episodeSteps++;

    // Train from replay buffer
    if (this.buffer.length >= BATCH_SIZE) {
      const batch = this.buffer.sample(BATCH_SIZE);
      for (const exp of batch) {
        let target = exp.r;
        if (!exp.done) {
          const nextQ = this.targetNet.forward(exp.ns);
          let maxQ = nextQ[0];
          for (let i = 1; i < 4; i++) if (nextQ[i] > maxQ) maxQ = nextQ[i];
          target = exp.r + this.gamma * maxQ;
        }
        this.net.train(exp.s, exp.a, target, this.lr);
      }
    }

    if (done || this.episodeSteps >= MAX_STEPS) {
      this.episode++;
      this.recentRewards.push(this.episodeReward);
      this.recentSuccess.push(done ? 1 : 0);
      this.graphData.push(this.episodeReward);
      if (this.recentRewards.length > 100) { this.recentRewards.shift(); this.recentSuccess.shift(); }

      // Update target network every 10 episodes (stabilizes learning)
      if (this.episode % 10 === 0) {
        this.targetNet = this.net.clone();
      }

      if (done) {
        const ap = gridToWorld(this.world.agentX, this.world.agentY);
        this.emitParticles(new THREE.Vector3(ap[0], 0.5, ap[2]), C.particleGold, 25);
      }

      this.episodeReward = 0;
      this.episodeSteps = 0;
      this.currentState = this.world.reset();
      this.trailPositions = [];
    } else {
      this.currentState = nextState;
    }
  }

  /* ─── Stats & Graph ─── */
  updateStats() {
    document.getElementById('stat-episode').textContent = this.episode;
    document.getElementById('stat-steps').textContent = this.episodeSteps;
    document.getElementById('stat-reward').textContent = this.episodeReward.toFixed(1);
    const sr = this.recentSuccess.length > 0 ?
      ((this.recentSuccess.reduce((a, b) => a + b, 0) / this.recentSuccess.length) * 100).toFixed(0) : '0';
    document.getElementById('stat-success').textContent = sr + '%';
    document.getElementById('stat-epsilon').textContent = this.epsilon.toFixed(2);
  }

  drawGraph() {
    const ctx = this.graphCtx;
    const w = this.graphCanvas.width, h = this.graphCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const data = this.graphData;
    if (data.length < 2) return;

    // Show last 200 episodes
    const show = data.slice(-200);
    const minV = Math.min(...show);
    const maxV = Math.max(...show);
    const range = maxV - minV || 1;

    // Running average (window=10)
    const avg = [];
    for (let i = 0; i < show.length; i++) {
      const start = Math.max(0, i - 9);
      let sum = 0;
      for (let j = start; j <= i; j++) sum += show[j];
      avg.push(sum / (i - start + 1));
    }

    // Draw axes
    ctx.strokeStyle = 'rgba(99,210,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Draw raw data (faded)
    ctx.strokeStyle = 'rgba(99,210,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < show.length; i++) {
      const x = (i / (show.length - 1)) * w;
      const y = h - ((show[i] - minV) / range) * (h - 10) - 5;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw running average (bright)
    ctx.strokeStyle = 'rgba(99,210,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < avg.length; i++) {
      const x = (i / (avg.length - 1)) * w;
      const y = h - ((avg[i] - minV) / range) * (h - 10) - 5;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(99,210,255,0.5)';
    ctx.font = '9px sans-serif';
    ctx.fillText('Episode Reward', 4, 10);
    ctx.fillText(`ep ${this.episode}`, w - 40, 10);
  }

  /* ─── Toast ─── */
  showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  /* ─── Main Loop ─── */
  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;

    // Controls
    this.controls.update();

    // Training steps
    if (this.running) {
      for (let i = 0; i < this.speed; i++) {
        this.trainStep();
      }
    }

    // Rebuild walls if dirty
    if (this.world.dirty) {
      this.rebuildWalls();
      this.world.dirty = false;
    }

    // Agent smooth movement
    const [tx, , tz] = gridToWorld(this.world.agentX, this.world.agentY);
    this.agentVisualX = lerp(this.agentVisualX, tx, Math.min(1, dt * 12));
    this.agentVisualZ = lerp(this.agentVisualZ, tz, Math.min(1, dt * 12));
    this.agentMesh.position.set(this.agentVisualX, 0.35 + Math.sin(time * 3) * 0.05, this.agentVisualZ);
    this.agentMesh.rotation.y = time * 0.8;
    this.agentLight.position.set(this.agentVisualX, 0.8, this.agentVisualZ);

    // Trail
    if (this.running && this.stepCount % 3 === 0) {
      const tGeo = this.trailPoints.geometry;
      const tPos = tGeo.getAttribute('position');
      const tCol = tGeo.getAttribute('color');
      const ti = this.trailIdx % TRAIL_MAX;
      const vi = ti * 3;
      tPos.array[vi] = this.agentVisualX;
      tPos.array[vi + 1] = 0.05;
      tPos.array[vi + 2] = this.agentVisualZ;
      tCol.array[vi] = 0.12; tCol.array[vi + 1] = 0.37; tCol.array[vi + 2] = 0.67;
      // Mark as opaque
      const ci = ti * 4;
      tPos.needsUpdate = true;
      tCol.needsUpdate = true;
      this.trailIdx++;
    }
    // Fade trail
    {
      const tCol = this.trailPoints.geometry.getAttribute('color');
      for (let i = 0; i < Math.min(this.trailIdx, TRAIL_MAX); i++) {
        const vi = i * 3;
        tCol.array[vi] *= 0.995;
        tCol.array[vi + 1] *= 0.995;
        tCol.array[vi + 2] *= 0.995;
      }
      tCol.needsUpdate = true;
    }

    this.stepCount++;

    // Goal animation
    this.goalMesh.rotation.y = time * 1.2;
    this.goalMesh.rotation.x = Math.sin(time * 0.8) * 0.2;
    this.goalMesh.position.y = 0.5 + Math.sin(time * 2) * 0.08;

    // Update brain visuals
    if (this.running) this.updateBrainVisuals();

    // Particles
    this.updateParticles(dt);

    // Stats & graph (throttled)
    if (this.stepCount % 10 === 0) this.updateStats();
    if (this.stepCount % 30 === 0) this.drawGraph();

    // Render
    this.renderer.render(this.scene, this.camera);
  }
}

/* ═══════════ Bootstrap ═══════════ */
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.init();
});
