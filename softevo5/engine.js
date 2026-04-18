/* =====================================================
   SoftEvo3 — ライブ進化シミュレータ
   ─────────────────────────────────────────────────────
   ゼロ依存: 自作 Verlet 物理 + 自作ニューラルネット
   SoftEvo2 からの進化:
     1. ニューラルモニター (リアルタイム発火可視化)
     2. ライブ・ステータスラベル (全個体頭上表示)
     3. ライブ・チューニング (走行中パラメータ即時反映)
     4. 環境リアルタイム干渉
     5. ライブ・イベントティッカー (AI実況ログ)
     6. 演算/描画分離 60fps 最適化
   ===================================================== */

(function () {
  'use strict';

  // ─── Game Phase ───────────────────────────────────
  const PHASE_BUILD = 'build';
  const PHASE_SIM = 'sim';
  let currentPhase = PHASE_BUILD;

  // ─── Configurable Parameters (LIVE-tunable) ───────
  const COF = {
    worldW: 4000,
    worldH: 800,
    cellSize: 10,
    groundLevel: 0.75,
    population: 20,
    evalSeconds: 10,
    eliteRatio: 0.3,
    mutationRate: 0.15,
    mutationStrength: 0.3,
    gravity: 0.35,
    airDrag: 0.995,
    groundFriction: 0.6,
    bounce: 0.15,
    constraintIter: 5,
    boneStiffness: 0.6,
    muscleStiffness: 0.3,
    hiddenSize1: 12,
    hiddenSize2: 8,
    cameraSpeed: 0.08,
    trailLen: 60,
    goalBonus: 150,
    goalRadius: 30,
  };

  const COF_DEFS = [
    { section: '進化 (Evolution)', items: [
      { key: 'population', label: '個体数', type: 'range', min: 5, max: 50, step: 1, live: false },
      { key: 'evalSeconds', label: '評価時間(秒)', type: 'range', min: 3, max: 30, step: 1, live: true },
      { key: 'eliteRatio', label: 'エリート率', type: 'range', min: 0.1, max: 0.6, step: 0.05, live: true },
    ]},
    { section: '変異 (Mutation)', items: [
      { key: 'mutationRate', label: '変異確率', type: 'range', min: 0, max: 0.5, step: 0.01, live: true },
      { key: 'mutationStrength', label: '変異強度', type: 'range', min: 0.01, max: 1.0, step: 0.01, live: true },
    ]},
    { section: '物理 (Physics) — LIVE', items: [
      { key: 'gravity', label: '重力', type: 'range', min: 0, max: 1.5, step: 0.05, live: true },
      { key: 'airDrag', label: '空気抵抗', type: 'range', min: 0.9, max: 1.0, step: 0.005, live: true },
      { key: 'groundFriction', label: '地面摩擦', type: 'range', min: 0.1, max: 1.0, step: 0.05, live: true },
      { key: 'bounce', label: '反発係数', type: 'range', min: 0, max: 0.8, step: 0.05, live: true },
      { key: 'constraintIter', label: '制約反復', type: 'range', min: 1, max: 12, step: 1, live: true },
      { key: 'boneStiffness', label: '骨剛性', type: 'range', min: 0.1, max: 1.0, step: 0.05, live: true },
      { key: 'muscleStiffness', label: '筋肉剛性', type: 'range', min: 0.05, max: 0.8, step: 0.05, live: true },
    ]},
    { section: 'ニューラルネット', items: [
      { key: 'hiddenSize1', label: '隠れ層1', type: 'range', min: 4, max: 32, step: 2, live: false },
      { key: 'hiddenSize2', label: '隠れ層2', type: 'range', min: 4, max: 24, step: 2, live: false },
    ]},
    { section: 'ゴール', items: [
      { key: 'goalBonus', label: 'ボーナス', type: 'range', min: 10, max: 500, step: 10, live: true },
      { key: 'goalRadius', label: '到達半径', type: 'range', min: 10, max: 80, step: 5, live: true },
    ]},
  ];

  // ─── Constants ────────────────────────────────────
  const TERRAIN_EMPTY = 0, TERRAIN_SOLID = 1;
  const MIN_ZOOM = 0.15, MAX_ZOOM = 6;
  const BASE_WORLD_WIDTH = 4000;
  const EXPAND_THRESHOLD = 500, WORLD_EXPAND_INCREMENT = 2000;

  let TERRAIN_W, TERRAIN_H, TERRAIN_CELLS;
  let terrain;
  let terrainDirty = true;
  let BRUSH_SIZE = 2;

  function initTerrainGrid() {
    TERRAIN_W = (COF.worldW / COF.cellSize) | 0;
    TERRAIN_H = (COF.worldH / COF.cellSize) | 0;
    TERRAIN_CELLS = TERRAIN_W * TERRAIN_H;
    terrain = new Uint8Array(TERRAIN_CELLS);
  }

  // ─── Gaussian Random ──────────────────────────────
  function gaussianRandom() {
    let u, v;
    do { u = Math.random(); } while (u <= Number.EPSILON);
    v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // ═══════════════════════════════════════════════════
  //  NEURAL NETWORK — with activation telemetry
  // ═══════════════════════════════════════════════════
  class NeuralNet {
    constructor(layerSizes) {
      this.layers = layerSizes;
      this.weights = [];
      this.biases = [];
      // Telemetry: store activations for visualization
      this.activations = [];
      for (let i = 0; i < layerSizes.length; i++) {
        this.activations.push(new Float32Array(layerSizes[i]));
      }
      for (let i = 1; i < layerSizes.length; i++) {
        const inSz = layerSizes[i - 1], outSz = layerSizes[i];
        const w = new Float32Array(inSz * outSz);
        const b = new Float32Array(outSz);
        const scale = Math.sqrt(2.0 / inSz);
        for (let j = 0; j < w.length; j++) w[j] = gaussianRandom() * scale;
        this.weights.push(w);
        this.biases.push(b);
      }
    }

    predict(input) {
      let cur = input;
      // Store input activations
      for (let i = 0; i < Math.min(cur.length, this.activations[0].length); i++) {
        this.activations[0][i] = cur[i];
      }
      for (let l = 0; l < this.weights.length; l++) {
        const w = this.weights[l];
        const b = this.biases[l];
        const inSz = this.layers[l];
        const outSz = this.layers[l + 1];
        const out = new Float32Array(outSz);
        for (let j = 0; j < outSz; j++) {
          let sum = b[j];
          for (let i = 0; i < inSz; i++) {
            sum += cur[i] * w[i * outSz + j];
          }
          out[j] = l < this.weights.length - 1
            ? Math.max(0, sum)
            : 1.0 / (1.0 + Math.exp(-Math.max(-10, Math.min(10, sum))));
        }
        // Store activations
        for (let j = 0; j < outSz; j++) {
          this.activations[l + 1][j] = out[j];
        }
        cur = out;
      }
      return cur;
    }

    getGenome() {
      return {
        weights: this.weights.map(w => new Float32Array(w)),
        biases: this.biases.map(b => new Float32Array(b)),
      };
    }

    setGenome(g) {
      for (let i = 0; i < this.weights.length; i++) {
        this.weights[i].set(g.weights[i]);
        this.biases[i].set(g.biases[i]);
      }
    }
  }

  function crossoverGenome(gA, gB) {
    return {
      weights: gA.weights.map((layerA, i) => {
        const layerB = gB.weights[i];
        const child = new Float32Array(layerA.length);
        for (let j = 0; j < layerA.length; j++)
          child[j] = Math.random() < 0.5 ? layerA[j] : layerB[j];
        return child;
      }),
      biases: gA.biases.map((layerA, i) => {
        const layerB = gB.biases[i];
        const child = new Float32Array(layerA.length);
        for (let j = 0; j < layerA.length; j++)
          child[j] = Math.random() < 0.5 ? layerA[j] : layerB[j];
        return child;
      }),
    };
  }

  function mutateGenome(g, rate, strength) {
    return {
      weights: g.weights.map(layer => {
        const m = new Float32Array(layer.length);
        for (let j = 0; j < layer.length; j++) {
          m[j] = layer[j];
          if (Math.random() < rate) m[j] += gaussianRandom() * strength;
        }
        return m;
      }),
      biases: g.biases.map(layer => {
        const m = new Float32Array(layer.length);
        for (let j = 0; j < layer.length; j++) {
          m[j] = layer[j];
          if (Math.random() < rate) m[j] += gaussianRandom() * strength;
        }
        return m;
      }),
    };
  }

  // ═══════════════════════════════════════════════════
  //  CREATURE BLUEPRINT (Build Phase)
  // ═══════════════════════════════════════════════════
  const blueprint = { nodes: [], bones: [], muscles: [] };
  let buildTool = 'add-node';
  let buildSelectedNode = -1;
  let buildDragNode = -1;

  function clearBlueprint() {
    blueprint.nodes.length = 0;
    blueprint.bones.length = 0;
    blueprint.muscles.length = 0;
    buildSelectedNode = -1;
    buildDragNode = -1;
    updateBuildInfo();
  }

  function isValidBlueprint() {
    return blueprint.nodes.length >= 2 && blueprint.muscles.length >= 1;
  }

  function updateBuildInfo() {
    const nd = document.getElementById('build-node-count');
    const bn = document.getElementById('build-bone-count');
    const ms = document.getElementById('build-muscle-count');
    if (nd) nd.textContent = `ノード: ${blueprint.nodes.length}`;
    if (bn) bn.textContent = `ボーン: ${blueprint.bones.length}`;
    if (ms) ms.textContent = `筋肉: ${blueprint.muscles.length}`;
    const btn = document.getElementById('btn-start-sim');
    if (btn) btn.disabled = !isValidBlueprint();
    updateBuildHint();
  }

  function updateBuildHint() {
    const hint = document.getElementById('build-hint');
    if (!hint) return;
    const msgs = {
      'add-node': 'タップでノード配置 | 2本指でパン/ズーム',
      'add-bone': buildSelectedNode >= 0 ? '2つ目のノードをタップして接続' : 'ノードをタップして骨格を開始',
      'add-muscle': buildSelectedNode >= 0 ? '2つ目のノードをタップして筋肉接続' : 'ノードをタップして筋肉を開始',
      'move-node': 'ノードをドラッグして移動 | 2本指でパン/ズーム',
      'resize-node': 'ノードをタップしてサイズ変更（タップで切替）',
      'pan': '1本指でドラッグして視点移動 | 2本指でピンチズーム',
      'delete': 'ノード/接続をタップして削除',
    };
    hint.textContent = msgs[buildTool] || '';
  }

  function findBuildNodeAt(wx, wy) {
    for (let i = blueprint.nodes.length - 1; i >= 0; i--) {
      const n = blueprint.nodes[i];
      const dx = wx - n.x, dy = wy - n.y;
      if (dx * dx + dy * dy < (n.radius + 5) * (n.radius + 5)) return i;
    }
    return -1;
  }

  function connectionExists(list, a, b) {
    return list.some(c => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  }

  // ─── Presets ──────────────────────────────────────
  function presetBiped() {
    clearBlueprint();
    const cx = 200, cy = 350;
    blueprint.nodes.push({ x: cx - 12, y: cy - 20, radius: 7 });
    blueprint.nodes.push({ x: cx + 12, y: cy - 20, radius: 7 });
    blueprint.nodes.push({ x: cx + 12, y: cy + 5, radius: 7 });
    blueprint.nodes.push({ x: cx - 12, y: cy + 5, radius: 7 });
    blueprint.nodes.push({ x: cx - 15, y: cy + 35, radius: 6 });
    blueprint.nodes.push({ x: cx + 15, y: cy + 35, radius: 6 });
    blueprint.nodes.push({ x: cx - 18, y: cy + 60, radius: 8 });
    blueprint.nodes.push({ x: cx + 18, y: cy + 60, radius: 8 });
    blueprint.bones.push({ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 });
    blueprint.bones.push({ a: 3, b: 4 }, { a: 2, b: 5 }, { a: 4, b: 6 }, { a: 5, b: 7 });
    blueprint.muscles.push({ a: 0, b: 2 }, { a: 1, b: 3 }, { a: 3, b: 6 }, { a: 2, b: 7 }, { a: 4, b: 5 }, { a: 6, b: 7 });
    updateBuildInfo();
  }

  function presetSnake() {
    clearBlueprint();
    const startX = 120, cy = 380, seg = 7;
    for (let i = 0; i < seg; i++)
      blueprint.nodes.push({ x: startX + i * 22, y: cy, radius: 6 + (i === 0 ? 2 : 0) });
    for (let i = 0; i < seg - 1; i++) blueprint.bones.push({ a: i, b: i + 1 });
    for (let i = 0; i < seg - 2; i++) blueprint.muscles.push({ a: i, b: i + 2 });
    updateBuildInfo();
  }

  function presetSpider() {
    clearBlueprint();
    const cx = 200, cy = 360;
    blueprint.nodes.push({ x: cx, y: cy, radius: 9 });
    blueprint.nodes.push({ x: cx + 20, y: cy, radius: 7 });
    const legAngles = [-0.8, -0.3, 0.3, 0.8];
    for (const angle of legAngles) {
      const lx = cx + Math.cos(Math.PI / 2 + angle) * 25, ly = cy + Math.sin(Math.PI / 2 + angle) * 25;
      const fx = cx + Math.cos(Math.PI / 2 + angle) * 50, fy = cy + Math.sin(Math.PI / 2 + angle) * 50;
      blueprint.nodes.push({ x: lx, y: ly, radius: 5 });
      blueprint.nodes.push({ x: fx, y: fy, radius: 6 });
      const mx = cx - Math.cos(Math.PI / 2 + angle) * 25, my = cy + Math.sin(Math.PI / 2 + angle) * 25;
      const mfx = cx - Math.cos(Math.PI / 2 + angle) * 50, mfy = cy + Math.sin(Math.PI / 2 + angle) * 50;
      blueprint.nodes.push({ x: mx, y: my, radius: 5 });
      blueprint.nodes.push({ x: mfx, y: mfy, radius: 6 });
    }
    blueprint.bones.push({ a: 0, b: 1 });
    for (let i = 0; i < 4; i++) {
      const base = 2 + i * 4;
      blueprint.bones.push({ a: 0, b: base }, { a: base, b: base + 1 }, { a: 0, b: base + 2 }, { a: base + 2, b: base + 3 });
    }
    for (let i = 0; i < 4; i++) {
      const base = 2 + i * 4;
      blueprint.muscles.push({ a: 0, b: base + 1 }, { a: 0, b: base + 3 }, { a: base + 1, b: base + 3 });
    }
    updateBuildInfo();
  }

  function presetBlob() {
    clearBlueprint();
    const cx = 200, cy = 370, nc = 6;
    for (let i = 0; i < nc; i++) {
      const angle = (Math.PI * 2 * i) / nc;
      blueprint.nodes.push({ x: cx + Math.cos(angle) * 25, y: cy + Math.sin(angle) * 15, radius: 5 + Math.random() * 4 });
    }
    for (let i = 0; i < nc; i++) blueprint.bones.push({ a: i, b: (i + 1) % nc });
    const muscleSet = new Set();
    for (let i = 0; i < nc; i++) {
      const j = (i + 2) % nc;
      const key = Math.min(i, j) + '-' + Math.max(i, j);
      if (!muscleSet.has(key)) { muscleSet.add(key); blueprint.muscles.push({ a: i, b: j }); }
    }
    for (let i = 0; i < nc; i++) {
      const j = (i + Math.floor(nc / 2)) % nc;
      const key = Math.min(i, j) + '-' + Math.max(i, j);
      if (!muscleSet.has(key)) { muscleSet.add(key); blueprint.muscles.push({ a: i, b: j }); }
    }
    updateBuildInfo();
  }

  // ═══════════════════════════════════════════════════
  //  FITNESS OBJECTIVES
  // ═══════════════════════════════════════════════════
  let fitnessObjective = 'distance';
  let currentStage = 'flat';

  function calcFitnessForBody(body) {
    const cx = body.getCenterX(), cy = body.getCenterY();
    let fit = 0;
    switch (fitnessObjective) {
      case 'distance': fit = cx - body.startX; break;
      case 'height': {
        const groundY = Math.floor(TERRAIN_H * COF.groundLevel) * COF.cellSize;
        fit = Math.max(0, (groundY - body.minY) * 2);
        break;
      }
      case 'goal-speed': {
        if (goals.length > 0) {
          let minDist = Infinity;
          for (const g of goals) { const dx = cx - g.x, dy = cy - g.y; minDist = Math.min(minDist, Math.sqrt(dx * dx + dy * dy)); }
          fit = Math.max(0, 1000 - minDist);
          const gr2 = COF.goalRadius * COF.goalRadius;
          for (const g of goals) { const dx = cx - g.x, dy = cy - g.y; if (dx * dx + dy * dy < gr2) fit += COF.goalBonus; }
        } else { fit = cx - body.startX; }
        break;
      }
      case 'stability': {
        const groundY = Math.floor(TERRAIN_H * COF.groundLevel) * COF.cellSize;
        const upright = Math.max(0, groundY - cy);
        const horizontalDist = cx - body.startX;
        let yVar = 0;
        for (const n of body.nodes) yVar += (n.y - cy) * (n.y - cy);
        yVar = Math.sqrt(yVar / body.nodes.length);
        fit = upright * 0.5 + horizontalDist * 0.3 + Math.max(0, 50 - yVar) * 2;
        break;
      }
    }
    if (fitnessObjective !== 'goal-speed') {
      const gr2 = COF.goalRadius * COF.goalRadius;
      for (const g of goals) { const dx = cx - g.x, dy = cy - g.y; if (dx * dx + dy * dy < gr2) fit += COF.goalBonus; }
    }
    body.fitness = fit;
    return fit;
  }

  const goals = [];
  let goalIdCounter = 0;
  function createGoal(x, y) { goals.push({ id: goalIdCounter++, x, y }); }
  function deleteGoalNear(x, y) {
    const r2 = 625;
    for (let i = goals.length - 1; i >= 0; i--) {
      const g = goals[i], dx = g.x - x, dy = g.y - y;
      if (dx * dx + dy * dy < r2) { goals.splice(i, 1); return true; }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════
  //  SOFT BODY — with telemetry
  // ═══════════════════════════════════════════════════
  let bodyIdCounter = 0;

  class SoftBody {
    constructor(x, y, bp, genome) {
      this.id = bodyIdCounter++;
      this.startX = x; this.startY = y;
      this.fitness = 0; this.alive = true;
      this.minY = y;
      // Telemetry
      this.totalMuscleOutput = 0;
      this.prevFitness = 0;
      this.fitnessVelocity = 0;
      this.movementPattern = 0; // track movement pattern changes
      this.prevMuscleHash = 0;

      const nc = bp.nodes.length;
      let bpCx = 0, bpCy = 0;
      for (const n of bp.nodes) { bpCx += n.x; bpCy += n.y; }
      bpCx /= nc; bpCy /= nc;

      this.nodes = [];
      for (let i = 0; i < nc; i++) {
        const n = bp.nodes[i];
        this.nodes.push({ x: x + (n.x - bpCx), y: y + (n.y - bpCy), ox: x + (n.x - bpCx), oy: y + (n.y - bpCy), radius: n.radius, mass: 1, grounded: false });
      }

      this.bones = [];
      for (const b of bp.bones) {
        const na = this.nodes[b.a], nb = this.nodes[b.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        this.bones.push({ a: b.a, b: b.b, restLength: Math.sqrt(dx * dx + dy * dy), stiffness: COF.boneStiffness });
      }

      this.muscles = [];
      this.muscleAct = [];
      for (const m of bp.muscles) {
        const na = this.nodes[m.a], nb = this.nodes[m.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const rl = Math.sqrt(dx * dx + dy * dy);
        this.muscles.push({ a: m.a, b: m.b, restLength: rl, currentTarget: rl, stiffness: COF.muscleStiffness });
        this.muscleAct.push(0.5);
      }

      const muscleCount = this.muscles.length;
      const inputSize = nc * 2 + muscleCount + nc + 1;
      this.brain = new NeuralNet([inputSize, COF.hiddenSize1, COF.hiddenSize2, muscleCount]);
      if (genome) this.brain.setGenome(genome);

      this.trail = [];
    }

    getInputs(time) {
      const inputs = [];
      for (const n of this.nodes) { inputs.push((n.x - n.ox) * 0.1); inputs.push((n.y - n.oy) * 0.1); }
      for (const m of this.muscles) {
        const na = this.nodes[m.a], nb = this.nodes[m.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        inputs.push(Math.sqrt(dx * dx + dy * dy) / (m.restLength + 0.001) - 1.0);
      }
      for (const n of this.nodes) inputs.push(n.grounded ? 1.0 : 0.0);
      inputs.push(Math.sin(time * 5));
      return inputs;
    }

    updateBrain(time) {
      const inputs = this.getInputs(time);
      const outputs = this.brain.predict(inputs);
      let totalOut = 0;
      let muscleHash = 0;
      for (let i = 0; i < this.muscles.length; i++) {
        const act = outputs[i] !== undefined ? outputs[i] : 0.5;
        this.muscleAct[i] = act;
        this.muscles[i].currentTarget = this.muscles[i].restLength * (0.4 + 0.6 * act);
        // LIVE stiffness from COF
        this.muscles[i].stiffness = COF.muscleStiffness;
        totalOut += Math.abs(act - 0.5);
        muscleHash += (act > 0.6 ? 1 : 0) << (i % 16);
      }
      // LIVE bone stiffness
      for (const b of this.bones) b.stiffness = COF.boneStiffness;

      this.totalMuscleOutput = totalOut / this.muscles.length;

      // Detect movement pattern changes
      if (muscleHash !== this.prevMuscleHash) this.movementPattern++;
      this.prevMuscleHash = muscleHash;

      // Track fitness velocity
      const currentFit = this.getCenterX() - this.startX;
      this.fitnessVelocity = currentFit - this.prevFitness;
      this.prevFitness = currentFit;
    }

    getCenterX() { let s = 0; for (const n of this.nodes) s += n.x; return s / this.nodes.length; }
    getCenterY() { let s = 0; for (const n of this.nodes) s += n.y; return s / this.nodes.length; }
    calcFitness() { return calcFitnessForBody(this); }

    getColor() {
      const maxFit = Math.max(bestEverFitness, 80);
      const rawFit = this.fitness || (this.getCenterX() - this.startX);
      const t = Math.min(1, Math.max(0, rawFit / maxFit));
      return [Math.floor(100 + 155 * t), Math.floor(80 + 140 * t), Math.floor(240 * (1 - t) + 50 * t)];
    }
  }

  // ─── Population Management ────────────────────────
  let population = [];
  let generation = 0;
  let evalTimer = 0;
  let bestEverFitness = 0;
  let bestEverGen = 0;
  let focusedIndex = 0;

  function getSpawnY() { return Math.floor(TERRAIN_H * COF.groundLevel) * COF.cellSize - 50; }

  function createPopulation(genomes) {
    population = [];
    const spacing = 120, startX = 200, sy = getSpawnY();
    for (let i = 0; i < COF.population; i++) {
      population.push(new SoftBody(startX + i * spacing, sy, blueprint, genomes ? genomes[i] : null));
    }
    focusedIndex = 0;
  }

  function clearPopulation() { population = []; }

  const HISTORY_MAX = 200;
  const historyBest = [], historyAvg = [];
  const strategyHistory = []; // { gen, catScores:[vel,mus,gnd,rht], fitness, strategyType }

  // ═══════════════════════════════════════════════════
  //  LIVE EVENT TICKER — AI commentary
  // ═══════════════════════════════════════════════════
  let prevAvgFitness = 0;
  let prevBestFitness = 0;
  let patternDetectionCounters = {};
  let tickerCooldown = 0;

  function generateLiveCommentary() {
    if (tickerCooldown > 0) { tickerCooldown--; return; }
    if (population.length === 0) return;

    // Check for sudden fitness jumps
    for (const body of population) {
      if (body.fitnessVelocity > 3) {
        addEventMsg(`🚀 #${body.id}: 急加速中！ (+${body.fitnessVelocity.toFixed(1)}/f)`, '#63d2ff', false, true);
        tickerCooldown = 90;
        return;
      }
    }

    // Check for grounded status
    const fullyGrounded = population.filter(b => b.nodes.every(n => n.grounded)).length;
    if (fullyGrounded > population.length * 0.7 && Math.random() < 0.01) {
      addEventMsg(`⚠ ${fullyGrounded}/${population.length}体が完全接地 — 動き不足`, '#f59e0b', false, true);
      tickerCooldown = 120;
    }

    // Random muscle activity observation
    if (Math.random() < 0.005) {
      const best = population.reduce((a, b) => (a.totalMuscleOutput > b.totalMuscleOutput ? a : b));
      const pct = (best.totalMuscleOutput * 100).toFixed(0);
      addEventMsg(`💪 最活発: #${best.id} (筋活性 ${pct}%)`, '#a78bfa', false, true);
      tickerCooldown = 100;
    }
  }

  // ─── Genetic Algorithm ────────────────────────────
  function evolve() {
    const fitnesses = population.map(p => p.calcFitness());
    const indices = fitnesses.map((_, i) => i);
    indices.sort((a, b) => fitnesses[b] - fitnesses[a]);

    const eliteCount = Math.max(2, Math.floor(COF.population * COF.eliteRatio));
    const eliteIdx = indices.slice(0, eliteCount);

    const bestFit = fitnesses[indices[0]];
    const avgFit = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length;

    const isRecord = bestFit > bestEverFitness;
    if (isRecord) { bestEverFitness = bestFit; bestEverGen = generation; }

    // Live commentary on generation change
    const avgDelta = avgFit - prevAvgFitness;
    if (generation > 0) {
      if (avgDelta > 0) {
        const pct = prevAvgFitness > 0 ? ((avgDelta / prevAvgFitness) * 100).toFixed(0) : '∞';
        addEventMsg(`📈 世代 ${generation + 1}: 平均スコア ${pct}% 向上！`, '#34d399', false, true);
      } else if (avgDelta < -5) {
        addEventMsg(`📉 世代 ${generation + 1}: 平均スコア低下… 探索中`, '#f87171', false, true);
      }
    }
    prevAvgFitness = avgFit;
    prevBestFitness = bestFit;

    historyBest.push(bestFit);
    historyAvg.push(avgFit);
    if (historyBest.length > HISTORY_MAX) { historyBest.shift(); historyAvg.shift(); }

    // ── Record strategy profile for analysis mode ──
    try {
      const bestBody = population[indices[0]];
      if (bestBody && bestBody.brain) {
        const profile = computeStrategyProfile(bestBody.brain);
        profile.gen = generation;
        profile.fitness = bestFit;
        strategyHistory.push(profile);
        if (strategyHistory.length > HISTORY_MAX) strategyHistory.shift();
      }
    } catch(e) { /* ignore analysis errors */ }

    const eliteGenomes = eliteIdx.map(i => population[i].brain.getGenome());
    const newGenomes = [];
    for (let i = 0; i < COF.population; i++) {
      if (i < eliteCount) {
        newGenomes.push(eliteGenomes[i]);
      } else {
        const pA = eliteGenomes[Math.floor(Math.random() * eliteCount)];
        const pB = eliteGenomes[Math.floor(Math.random() * eliteCount)];
        newGenomes.push(mutateGenome(crossoverGenome(pA, pB), COF.mutationRate, COF.mutationStrength));
      }
    }

    patternDetectionCounters = {};
    clearPopulation();
    createPopulation(newGenomes);
    generation++;
    evalTimer = 0;

    document.getElementById('gen-info').textContent = `🧬 世代 ${generation}`;
    document.getElementById('best-info').textContent = `🏆 ${Math.round(bestFit)}`;
    document.getElementById('avg-info').textContent = `📊 ${Math.round(avgFit)}`;

    showGenFlash(generation, bestFit, avgFit, isRecord);
    addEventMsg(`🧬 世代 ${generation} | 最高 ${Math.round(bestFit)} | 平均 ${Math.round(avgFit)}`, '#818cf8', false);
    if (isRecord) addEventMsg(`🏆 新記録！ ${Math.round(bestFit)} (世代 ${generation})`, '#fbbf24', true);
  }

  // ─── Physics (Verlet) ─────────────────────────────
  function physicStep() {
    let needExpand = false;
    for (const body of population) {
      for (const n of body.nodes) { if (n.x > COF.worldW - EXPAND_THRESHOLD) { needExpand = true; break; } }
      if (needExpand) break;
    }
    if (needExpand) expandWorld();

    for (const body of population) {
      for (const n of body.nodes) {
        const vx = (n.x - n.ox) * COF.airDrag;
        const vy = (n.y - n.oy) * COF.airDrag;
        n.ox = n.x; n.oy = n.y;
        n.x += vx; n.y += vy + COF.gravity;
        n.grounded = false;
      }
      for (let iter = 0; iter < COF.constraintIter; iter++) {
        for (const c of body.bones) solveConstraint(body.nodes[c.a], body.nodes[c.b], c.restLength, c.stiffness);
        for (const m of body.muscles) solveConstraint(body.nodes[m.a], body.nodes[m.b], m.currentTarget, m.stiffness);
        for (const n of body.nodes) { collideWithTerrain(n); constrainToWorld(n); }
      }
      const cy = body.getCenterY();
      if (cy < body.minY) body.minY = cy;
      body.trail.push({ x: body.getCenterX(), y: cy });
      if (body.trail.length > COF.trailLen) body.trail.shift();
    }
  }

  function solveConstraint(a, b, targetLen, stiffness) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.001) return;
    const diff = (targetLen - dist) / dist * stiffness * 0.5;
    const mx = dx * diff, my = dy * diff;
    const totalMass = a.mass + b.mass;
    const ra = b.mass / totalMass, rb = a.mass / totalMass;
    a.x -= mx * ra; a.y -= my * ra;
    b.x += mx * rb; b.y += my * rb;
  }

  function collideWithTerrain(node) {
    const r = node.radius;
    const minGx = Math.max(0, Math.floor((node.x - r) / COF.cellSize));
    const maxGx = Math.min(TERRAIN_W - 1, Math.floor((node.x + r) / COF.cellSize));
    const minGy = Math.max(0, Math.floor((node.y - r) / COF.cellSize));
    const maxGy = Math.min(TERRAIN_H - 1, Math.floor((node.y + r) / COF.cellSize));
    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        if (terrain[gy * TERRAIN_W + gx] !== TERRAIN_SOLID) continue;
        const cx1 = gx * COF.cellSize, cy1 = gy * COF.cellSize;
        const cx2 = cx1 + COF.cellSize, cy2 = cy1 + COF.cellSize;
        const nearX = Math.max(cx1, Math.min(node.x, cx2));
        const nearY = Math.max(cy1, Math.min(node.y, cy2));
        const dx = node.x - nearX, dy = node.y - nearY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < r) {
          if (dist > 0.001) {
            const overlap = r - dist, nx = dx / dist, ny = dy / dist;
            node.x += nx * overlap; node.y += ny * overlap;
            const vx = node.x - node.ox, vy = node.y - node.oy;
            const vn = vx * nx + vy * ny;
            if (vn < 0) {
              node.ox = node.x - (-(nx * vn) * COF.bounce + (vx - nx * vn) * COF.groundFriction);
              node.oy = node.y - (-(ny * vn) * COF.bounce + (vy - ny * vn) * COF.groundFriction);
            }
            node.grounded = true;
          } else {
            const dl = node.x - cx1, dr2 = cx2 - node.x, dt = node.y - cy1, db = cy2 - node.y;
            const mn = Math.min(dl, dr2, dt, db);
            if (mn === dl) node.x = cx1 - r;
            else if (mn === dr2) node.x = cx2 + r;
            else if (mn === dt) node.y = cy1 - r;
            else node.y = cy2 + r;
            node.ox = node.x; node.oy = node.y; node.grounded = true;
          }
        }
      }
    }
  }

  function constrainToWorld(node) {
    const r = node.radius;
    if (node.x - r < 0) { node.x = r; node.ox = node.x; }
    if (node.y - r < 0) { node.y = r; node.oy = node.y; }
    if (node.y + r > COF.worldH) { node.y = COF.worldH - r; node.oy = node.y; node.grounded = true; }
  }

  // ═══════════════════════════════════════════════════
  //  RENDERING
  // ═══════════════════════════════════════════════════
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');
  let camX = 0, camY = 0, camZoom = 1;
  let targetCamX = 0, targetCamY = 0, targetCamZoom = 1;
  let cameraMode = 'follow';
  let terrainCanvas, terrainCtx, terrainImageData;

  function initTerrainCanvas() {
    terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = TERRAIN_W; terrainCanvas.height = TERRAIN_H;
    terrainCtx = terrainCanvas.getContext('2d');
    terrainImageData = terrainCtx.createImageData(TERRAIN_W, TERRAIN_H);
  }

  function resizeCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    const w = wrapper ? wrapper.clientWidth : window.innerWidth;
    const h = wrapper ? wrapper.clientHeight : window.innerHeight;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    if (currentPhase === PHASE_BUILD) {
      const scaleX = w / 400, scaleY = h / 500;
      targetCamZoom = Math.min(scaleX, scaleY) * 0.8;
      targetCamX = w / 2 - 200 * targetCamZoom;
      targetCamY = h / 2 - 350 * targetCamZoom;
    } else {
      const scaleX = w / COF.worldW, scaleY = h / COF.worldH;
      targetCamZoom = Math.min(scaleX, scaleY);
      targetCamX = (w - COF.worldW * targetCamZoom) / 2;
      targetCamY = (h - COF.worldH * targetCamZoom) / 2;
    }
  }

  function renderTerrain() {
    if (!terrainDirty) return;
    terrainDirty = false;
    const data = terrainImageData.data;
    for (let y = 0; y < TERRAIN_H; y++) {
      for (let x = 0; x < TERRAIN_W; x++) {
        const idx = y * TERRAIN_W + x, pi = idx * 4;
        if (terrain[idx] === TERRAIN_SOLID) {
          const above = y > 0 ? terrain[(y - 1) * TERRAIN_W + x] : TERRAIN_EMPTY;
          if (above !== TERRAIN_SOLID) { data[pi] = 50; data[pi+1] = 65; data[pi+2] = 95; data[pi+3] = 255; }
          else { const noise = ((x*17+y*31)%8)-4; data[pi]=22+noise; data[pi+1]=28+noise; data[pi+2]=42+noise; data[pi+3]=255; }
        } else { data[pi]=0; data[pi+1]=0; data[pi+2]=0; data[pi+3]=0; }
      }
    }
    terrainCtx.putImageData(terrainImageData, 0, 0);
  }

  // ─── Build Phase Rendering ────────────────────────
  function renderBuildPhase() {
    const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#060c1a'); grad.addColorStop(0.5, '#060a14'); grad.addColorStop(1, '#040810');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);

    camX += (targetCamX - camX) * 0.1; camY += (targetCamY - camY) * 0.1;
    camZoom += (targetCamZoom - camZoom) * 0.1;

    ctx.save(); ctx.translate(camX, camY); ctx.scale(camZoom, camZoom);

    ctx.strokeStyle = 'rgba(99,210,255,0.04)'; ctx.lineWidth = 0.5;
    for (let x = 0; x <= 400; x += 20) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,600); ctx.stroke(); }
    for (let y = 0; y <= 600; y += 20) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(400,y); ctx.stroke(); }

    const groundY = Math.floor(TERRAIN_H * COF.groundLevel) * COF.cellSize;
    ctx.strokeStyle = 'rgba(99,210,255,0.15)'; ctx.lineWidth = 1;
    ctx.setLineDash([8,8]); ctx.beginPath(); ctx.moveTo(0,groundY); ctx.lineTo(400,groundY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(99,210,255,0.3)'; ctx.font = '10px sans-serif'; ctx.fillText('地面', 5, groundY - 5);

    for (const b of blueprint.bones) {
      const na = blueprint.nodes[b.a], nb = blueprint.nodes[b.b];
      ctx.strokeStyle = 'rgba(200,210,230,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y); ctx.stroke();
    }
    for (const m of blueprint.muscles) {
      const na = blueprint.nodes[m.a], nb = blueprint.nodes[m.b];
      ctx.strokeStyle = 'rgba(255,100,100,0.5)'; ctx.lineWidth = 2.5;
      ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(na.x,na.y); ctx.lineTo(nb.x,nb.y); ctx.stroke(); ctx.setLineDash([]);
    }
    if (buildSelectedNode >= 0 && (buildTool === 'add-bone' || buildTool === 'add-muscle')) {
      const n = blueprint.nodes[buildSelectedNode];
      ctx.strokeStyle = buildTool === 'add-bone' ? 'rgba(200,210,230,0.3)' : 'rgba(255,100,100,0.3)';
      ctx.lineWidth = 1.5; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.arc(n.x,n.y,n.radius+8,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
    }
    for (let i = 0; i < blueprint.nodes.length; i++) {
      const n = blueprint.nodes[i], isSelected = (i === buildSelectedNode);
      if (isSelected) { ctx.fillStyle = 'rgba(99,210,255,0.15)'; ctx.beginPath(); ctx.arc(n.x,n.y,n.radius+10,0,Math.PI*2); ctx.fill(); }
      ctx.fillStyle = isSelected ? 'rgba(99,210,255,0.8)' : 'rgba(129,200,248,0.6)';
      ctx.beginPath(); ctx.arc(n.x,n.y,n.radius,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = isSelected ? 'rgba(99,210,255,0.9)' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(i), n.x, n.y + 3);
    }
    ctx.restore();
  }

  // ─── Sim Phase Rendering ──────────────────────────
  function renderSimPhase(simTime) {
    const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#060c1a'); grad.addColorStop(0.5, '#060a14'); grad.addColorStop(1, '#040810');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);

    camX += (targetCamX - camX) * COF.cameraSpeed;
    camY += (targetCamY - camY) * COF.cameraSpeed;
    camZoom += (targetCamZoom - camZoom) * COF.cameraSpeed;

    ctx.save(); ctx.translate(camX, camY); ctx.scale(camZoom, camZoom);

    renderTerrain();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainCanvas, 0, 0, COF.worldW, COF.worldH);

    if (showGrid) {
      ctx.strokeStyle = 'rgba(129,140,248,0.06)'; ctx.lineWidth = 0.5;
      const step = COF.cellSize * 5;
      for (let x = 0; x <= COF.worldW; x += step) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,COF.worldH); ctx.stroke(); }
      for (let y = 0; y <= COF.worldH; y += step) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(COF.worldW,y); ctx.stroke(); }
    }

    for (const g of goals) {
      const pulse = 0.6 + 0.4 * Math.sin(simTime * 4 + g.id);
      ctx.strokeStyle = `rgba(251,191,36,${pulse * 0.7})`; ctx.lineWidth = 2;
      ctx.setLineDash([4,4]); ctx.beginPath(); ctx.arc(g.x,g.y,COF.goalRadius,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = `rgba(251,191,36,${pulse * 0.15})`; ctx.fill();
      ctx.fillStyle = `rgba(251,191,36,${pulse})`; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🎯', g.x, g.y + 5);
    }

    if (showTrails) {
      for (const body of population) {
        if (body.trail.length < 2) continue;
        const c = body.getColor();
        for (let t = 1; t < body.trail.length; t++) {
          const alpha = (t / body.trail.length) * 0.25;
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(body.trail[t-1].x,body.trail[t-1].y); ctx.lineTo(body.trail[t].x,body.trail[t].y); ctx.stroke();
        }
      }
    }

    for (let i = 0; i < population.length; i++) {
      drawCreature(population[i], i === focusedIndex, simTime);
    }

    ctx.restore();

    // Cursor overlay for brush tools
    if (cursorVisible && (currentTool === 'block' || currentTool === 'erase')) {
      const radiusScreen = BRUSH_SIZE * COF.cellSize * camZoom;
      const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.005);
      const isBlock = currentTool === 'block';
      ctx.save(); ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = isBlock ? 'rgba(129,140,248,0.08)' : 'rgba(248,113,113,0.08)';
      ctx.beginPath(); ctx.arc(cursorScreenX, cursorScreenY, radiusScreen, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = isBlock ? 'rgba(129,140,248,0.5)' : 'rgba(248,113,113,0.5)'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4,4]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.restore();
    }
  }

  function drawCreature(body, isFocused, simTime) {
    const nodes = body.nodes, nc = nodes.length;
    const col = body.getColor();
    const colStr = `rgb(${col[0]},${col[1]},${col[2]})`;

    let cx = 0, cy = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; }
    cx /= nc; cy /= nc;

    const sorted = nodes.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

    if (isFocused) {
      ctx.strokeStyle = 'rgba(251,191,36,0.4)'; ctx.lineWidth = 2;
      ctx.setLineDash([5,5]); ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
      // Focused indicator label
      ctx.fillStyle = 'rgba(251,191,36,0.8)';
      ctx.font = 'bold 8px -apple-system,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`▼ #${body.id} 観察中`, cx, cy - 54);
      ctx.textBaseline = 'middle';
    }

    // Membrane
    ctx.globalAlpha = 0.3; ctx.fillStyle = colStr; ctx.beginPath();
    if (sorted.length >= 3) {
      for (let i = 0; i < sorted.length; i++) {
        const curr = sorted[i], next = sorted[(i+1)%sorted.length];
        const midX = (curr.x+next.x)/2, midY = (curr.y+next.y)/2;
        if (i === 0) { const prev = sorted[sorted.length-1]; ctx.moveTo((prev.x+curr.x)/2,(prev.y+curr.y)/2); }
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Bones
    ctx.strokeStyle = 'rgba(200,210,230,0.25)'; ctx.lineWidth = 1;
    for (const b of body.bones) { const na = nodes[b.a], nb = nodes[b.b]; ctx.beginPath(); ctx.moveTo(na.x,na.y); ctx.lineTo(nb.x,nb.y); ctx.stroke(); }

    // Muscles with pulse animation
    if (showMuscles) {
      for (let i = 0; i < body.muscles.length; i++) {
        const m = body.muscles[i], na = nodes[m.a], nb = nodes[m.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const curLen = Math.sqrt(dx*dx+dy*dy);
        const ratio = curLen / m.restLength;
        const act = body.muscleAct[i];
        let mr, mg, mb;
        if (ratio < 0.85) { mr=255; mg=100; mb=60; }
        else if (ratio > 1.05) { mr=80; mg=140; mb=255; }
        else { const t=(ratio-0.85)/0.2; mr=Math.floor(255*(1-t)+80*t); mg=Math.floor(100*(1-t)+140*t); mb=Math.floor(60*(1-t)+255*t); }

        // Pulse effect on high activation
        const lw = act > 0.5 ? 1 + act * 2.5 : 1;
        const pulseAlpha = 0.4 + act * 0.4;
        ctx.strokeStyle = `rgba(${mr},${mg},${mb},${pulseAlpha})`;
        ctx.lineWidth = lw;

        // Draw signal pulse traveling along muscle
        if (act > 0.6 && showNeural) {
          const pulsePos = (simTime * 3 + i) % 1;
          const px = na.x + dx * pulsePos, py = na.y + dy * pulsePos;
          ctx.fillStyle = `rgba(${mr},${mg},${mb},0.8)`;
          ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI*2); ctx.fill();
        }

        ctx.beginPath(); ctx.moveTo(na.x,na.y); ctx.lineTo(nb.x,nb.y); ctx.stroke();
      }
    }

    // Nodes with firing glow
    for (const n of nodes) {
      ctx.fillStyle = colStr;
      ctx.beginPath(); ctx.arc(n.x,n.y,n.radius,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.8; ctx.stroke();
      if (n.grounded) { ctx.fillStyle='rgba(129,255,140,0.4)'; ctx.beginPath(); ctx.arc(n.x,n.y,n.radius*0.4,0,Math.PI*2); ctx.fill(); }
    }

    // Neural signal glow on nodes (when neural view is on)
    if (showNeural && body.brain.activations.length > 0) {
      const outActs = body.brain.activations[body.brain.activations.length - 1];
      for (let i = 0; i < Math.min(outActs.length, body.muscles.length); i++) {
        const act = outActs[i];
        if (act > 0.5) {
          const m = body.muscles[i];
          const na = nodes[m.a], nb = nodes[m.b];
          const glowR = 3 + act * 4;
          ctx.fillStyle = `rgba(99,255,200,${act * 0.3})`;
          ctx.beginPath(); ctx.arc(na.x,na.y,glowR,0,Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(nb.x,nb.y,glowR,0,Math.PI*2); ctx.fill();
        }
      }
    }

    // Eyes
    let frontNode = nodes[0];
    for (const n of nodes) if (n.x > frontNode.x) frontNode = n;
    const eyeAngle = Math.atan2(frontNode.y-cy, frontNode.x-cx);
    const perpX = -Math.sin(eyeAngle), perpY = Math.cos(eyeAngle);
    const eyeR = 2.5, eyeSpread = 3.5;
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(frontNode.x+perpX*eyeSpread*0.5,frontNode.y+perpY*eyeSpread*0.5,eyeR,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(frontNode.x-perpX*eyeSpread*0.5,frontNode.y-perpY*eyeSpread*0.5,eyeR,0,Math.PI*2); ctx.fill();
    const pOff = 0.8;
    ctx.fillStyle='#111';
    ctx.beginPath(); ctx.arc(frontNode.x+perpX*eyeSpread*0.5+Math.cos(eyeAngle)*pOff,frontNode.y+perpY*eyeSpread*0.5+Math.sin(eyeAngle)*pOff,eyeR*0.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(frontNode.x-perpX*eyeSpread*0.5+Math.cos(eyeAngle)*pOff,frontNode.y-perpY*eyeSpread*0.5+Math.sin(eyeAngle)*pOff,eyeR*0.5,0,Math.PI*2); ctx.fill();

    // ═══ LIVE STATUS LABELS ═══
    if (showLabels) {
      const fit = Math.round(body.fitness || (body.getCenterX() - body.startX));
      const outPct = (body.totalMuscleOutput * 100).toFixed(0);

      // Background pill
      ctx.fillStyle = isFocused ? 'rgba(251,191,36,0.15)' : 'rgba(6,10,20,0.6)';
      const labelW = 70, labelH = 22;
      const lx = cx - labelW/2, ly = cy - 55;
      ctx.beginPath();
      ctx.moveTo(lx+4, ly); ctx.lineTo(lx+labelW-4, ly); ctx.quadraticCurveTo(lx+labelW, ly, lx+labelW, ly+4);
      ctx.lineTo(lx+labelW, ly+labelH-4); ctx.quadraticCurveTo(lx+labelW, ly+labelH, lx+labelW-4, ly+labelH);
      ctx.lineTo(lx+4, ly+labelH); ctx.quadraticCurveTo(lx, ly+labelH, lx, ly+labelH-4);
      ctx.lineTo(lx, ly+4); ctx.quadraticCurveTo(lx, ly, lx+4, ly); ctx.fill();

      // Fitness score
      ctx.fillStyle = isFocused ? 'rgba(251,191,36,0.95)' : `rgba(${col[0]},${col[1]},${col[2]},0.9)`;
      ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${fit}`, cx, cy - 43);

      // Output strength bar
      const barW = 30, barH = 2;
      const barX = cx - barW/2, barY = cy - 38;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(barX, barY, barW, barH);
      const fillW = barW * Math.min(1, body.totalMuscleOutput * 2);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.7)`;
      ctx.fillRect(barX, barY, fillW, barH);
    }
  }

  // ═══════════════════════════════════════════════════
  //  NEURAL MONITOR — real-time NN visualization
  // ═══════════════════════════════════════════════════
  function renderNeuralMonitor() {
    if (!showNeural) return;
    const nc = document.getElementById('neuralCanvas');
    if (!nc) return;

    if (population.length === 0 || focusedIndex >= population.length) return;
    const body = population[focusedIndex];
    const brain = body.brain;
    const acts = brain.activations;
    const nodeCount = blueprint.nodes.length;
    const muscleCount = blueprint.muscles.length;
    const dpr = window.devicePixelRatio || 1;

    // ── Displayed counts ──
    const dispNodes   = Math.min(nodeCount, 8);
    const dispMuscles = Math.min(muscleCount, 10);
    const hiddenLayers = brain.layers.length - 2;

    // ── Layout constants (compact in brain-mode) ──
    const compact = brainMode && !expandedSection;
    const pad = compact ? 5 : 8;
    const barH = compact ? 4 : 6, barGap = 1;
    const catH = compact ? 8 : 11;
    const secGap = compact ? 2 : 4;
    const labelW = compact ? 16 : 20;
    const inputBarW = compact ? 42 : 54;
    const colInputX = pad;
    const colInputTotalW = labelW + inputBarW;
    const inputBarX = colInputX + labelW;

    // ── Dynamic canvas height based on actual input count ──
    const titleH   = compact ? 13 : 18;
    const velRows  = dispNodes;
    const musRows  = dispMuscles;
    const velH     = catH + velRows * (barH + barGap) + secGap;
    const musH     = catH + musRows * (barH + barGap) + secGap;
    const gndH     = catH + (compact ? 14 : 20) + secGap;
    const rhtH     = catH + barH + pad;
    const neededH  = titleH + velH + musH + gndH + rhtH;
    const canvasH  = Math.max(neededH, compact ? 120 : 200);
    if (!brainMode && Math.abs(nc.clientHeight - canvasH) > 2) nc.style.height = canvasH + 'px';

    const cw = nc.clientWidth, ch = nc.clientHeight;
    if (nc.width !== Math.round(cw * dpr) || nc.height !== Math.round(ch * dpr)) {
      nc.width = Math.round(cw * dpr); nc.height = Math.round(ch * dpr);
    }
    const nCtx = nc.getContext('2d');
    nCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nCtx.clearRect(0, 0, cw, ch);
    nCtx.fillStyle = 'rgba(4,6,10,0.92)'; nCtx.fillRect(0, 0, cw, ch);

    // ── Output column dimensions ──
    const outLabelW = compact ? 16 : 20, outBarW = compact ? 42 : 56;
    const colOutTotalW = outLabelW + outBarW;
    const colOutX  = cw - pad - colOutTotalW;
    const outBarX  = colOutX + outLabelW;

    // ── Hidden area bounds ──
    const hidX0 = colInputX + colInputTotalW + pad;
    const hidX1 = colOutX - pad;
    const hidW  = Math.max(1, hidX1 - hidX0);
    const hidAreaTopY = 20;
    const hidAreaH    = ch - 28;

    // ── Helper: get hidden layer node positions ──
    function getHiddenPos(hl) {
      const layerIdx = hl + 1;
      const count = Math.min(brain.layers[layerIdx], 20);
      const hlX = hidX0 + (hidW / (hiddenLayers + 1)) * (hl + 1);
      const spacing = Math.min(16, (hidAreaH - 8) / Math.max(1, count));
      const totalH = (count - 1) * spacing;
      const startY = hidAreaTopY + (hidAreaH - totalH) / 2;
      return Array.from({ length: count }, (_, n) => ({ x: hlX, y: startY + n * spacing }));
    }

    // ══════════════════════════════════════════════════════
    // PASS 1: Pre-compute input entry positions
    // Each entry: { y, colorBase, inputIndices }
    // ══════════════════════════════════════════════════════
    const inputEntries = [];
    let inputIdx = 0;
    let iy = titleH;

    // Velocity (vx,vy per node → 1 bar per node)
    iy += catH;
    for (let i = 0; i < dispNodes; i++) {
      inputEntries.push({ y: iy + barH / 2, colorBase: 'rgba(251,191,36,', inputIndices: [inputIdx, inputIdx + 1] });
      iy += barH + barGap; inputIdx += 2;
    }
    iy += secGap;

    // Muscle state (1 bar per muscle)
    iy += catH;
    for (let i = 0; i < dispMuscles; i++) {
      inputEntries.push({ y: iy + barH / 2, colorBase: 'rgba(52,211,153,', inputIndices: [inputIdx] });
      iy += barH + barGap; inputIdx++;
    }
    iy += secGap;

    // Grounded (dots, all share same row Y)
    iy += catH;
    const gndDotY = iy + 4;
    for (let i = 0; i < dispNodes; i++) {
      inputEntries.push({ y: gndDotY, colorBase: 'rgba(99,210,255,', inputIndices: [inputIdx] });
      inputIdx++;
    }
    iy += (compact ? 14 : 20); iy += secGap;

    // Rhythm
    iy += catH;
    inputEntries.push({ y: iy + barH / 2, colorBase: 'rgba(167,139,250,', inputIndices: [inputIdx] });

    // Build lookup: input tensor index → entry index
    const inputOwner = new Array(brain.layers[0]).fill(-1);
    for (let ei = 0; ei < inputEntries.length; ei++) {
      for (const ii of inputEntries[ei].inputIndices) {
        if (ii < inputOwner.length) inputOwner[ii] = ei;
      }
    }

    // ── Output entry positions ──
    const outLayerIdx = brain.layers.length - 1;
    const outEntries = [];
    let oiy = titleH + catH;
    for (let i = 0; i < dispMuscles; i++) {
      outEntries.push({ y: oiy + barH / 2, idx: i });
      oiy += barH + barGap;
    }

    // ══════════════════════════════════════════════════════
    // PASS 2: Draw (connections first, then nodes/bars)
    // ══════════════════════════════════════════════════════
    nCtx.textBaseline = 'middle';

    // ── Signal lines: Input → H1 ──
    if (hiddenLayers > 0) {
      const h1Pos  = getHiddenPos(0);
      const h1Size = brain.layers[1];
      const wt0    = brain.weights[0];
      const inCount = brain.layers[0];
      const fromX = colInputX + colInputTotalW + 2;

      for (let j = 0; j < h1Pos.length; j++) {
        // Aggregate signal per entry
        const entrySignal = new Float32Array(inputEntries.length);
        for (let i = 0; i < inCount; i++) {
          const ei = inputOwner[i];
          if (ei < 0) continue;
          entrySignal[ei] += (wt0[i * h1Size + j] || 0) * (acts[0][i] || 0);
        }
        const { x: toX, y: toY } = h1Pos[j];
        for (let ei = 0; ei < inputEntries.length; ei++) {
          const s = entrySignal[ei];
          const absS = Math.abs(s);
          if (absS < 0.08) continue;
          const alpha = Math.min(0.5, absS * 0.18);
          const { colorBase, y: srcY } = inputEntries[ei];
          nCtx.strokeStyle = s > 0 ? `${colorBase}${alpha})` : `rgba(248,113,113,${alpha})`;
          nCtx.lineWidth = Math.min(2, absS * 0.3);
          const cpX = fromX + (toX - 4 - fromX) * 0.5;
          nCtx.beginPath();
          nCtx.moveTo(fromX, srcY);
          nCtx.quadraticCurveTo(cpX, srcY, toX - 4, toY);
          nCtx.stroke();
          // Pulse
          if (absS > 0.4) {
            const t = (simTime * 2.0 + j * 0.13 + srcY * 0.003) % 1;
            const mt = 1 - t;
            const px = mt * mt * fromX + 2 * mt * t * cpX + t * t * (toX - 4);
            const py = mt * mt * srcY  + 2 * mt * t * srcY  + t * t * toY;
            nCtx.fillStyle = s > 0 ? `${colorBase}${Math.min(0.9, alpha * 3)})` : `rgba(248,113,113,${Math.min(0.9, alpha * 3)})`;
            nCtx.beginPath(); nCtx.arc(px, py, 1.5, 0, Math.PI * 2); nCtx.fill();
          }
        }
      }
    }

    // ── Signal lines: Hidden → Hidden ──
    for (let hl = 0; hl < hiddenLayers - 1; hl++) {
      const fromPos = getHiddenPos(hl);
      const toPos   = getHiddenPos(hl + 1);
      const fLayerIdx = hl + 1, tLayerIdx = hl + 2;
      const wt = brain.weights[hl + 1];
      const tSize = brain.layers[tLayerIdx];
      for (let j = 0; j < toPos.length; j++) {
        for (let i = 0; i < fromPos.length; i++) {
          const w = (wt[i * tSize + j]) || 0;
          const s = Math.abs(w * (acts[fLayerIdx][i] || 0));
          if (s < 0.06) continue;
          const alpha = Math.min(0.4, s * 0.35);
          nCtx.strokeStyle = w > 0 ? `rgba(129,140,248,${alpha})` : `rgba(248,113,113,${alpha})`;
          nCtx.lineWidth = Math.min(1.8, s * 0.8);
          nCtx.beginPath();
          nCtx.moveTo(fromPos[i].x + 4, fromPos[i].y);
          nCtx.lineTo(toPos[j].x - 4, toPos[j].y);
          nCtx.stroke();
          if (s > 0.2) {
            const t = (simTime * 2.2 + i * 0.11 + j * 0.08) % 1;
            const px = (fromPos[i].x + 4) + (toPos[j].x - 4 - fromPos[i].x - 4) * t;
            const py = fromPos[i].y + (toPos[j].y - fromPos[i].y) * t;
            nCtx.fillStyle = w > 0 ? `rgba(129,140,248,${alpha * 2})` : `rgba(248,113,113,${alpha * 2})`;
            nCtx.beginPath(); nCtx.arc(px, py, 1.2, 0, Math.PI * 2); nCtx.fill();
          }
        }
      }
    }

    // ── Signal lines: Last Hidden → Output ──
    if (hiddenLayers > 0) {
      const lastHlIdx = hiddenLayers - 1;
      const lastPos = getHiddenPos(lastHlIdx);
      const wt = brain.weights[brain.weights.length - 1];
      const outSize = brain.layers[outLayerIdx];
      const actLayer = hiddenLayers; // index into acts[]
      for (let j = 0; j < outEntries.length; j++) {
        for (let i = 0; i < lastPos.length; i++) {
          const w = (wt[i * outSize + j]) || 0;
          const s = Math.abs(w * (acts[actLayer][i] || 0));
          if (s < 0.08) continue;
          const alpha = Math.min(0.35, s * 0.3);
          nCtx.strokeStyle = w > 0 ? `rgba(52,211,153,${alpha})` : `rgba(248,113,113,${alpha})`;
          nCtx.lineWidth = Math.min(1.5, s);
          nCtx.beginPath();
          nCtx.moveTo(lastPos[i].x + 5, lastPos[i].y);
          nCtx.lineTo(colOutX - 2, outEntries[j].y);
          nCtx.stroke();
          if (s > 0.25) {
            const t = (simTime * 2.5 + i * 0.13 + j * 0.09) % 1;
            const fx = lastPos[i].x + 5, tx = colOutX - 2;
            nCtx.fillStyle = w > 0 ? `rgba(52,211,153,${alpha * 2})` : `rgba(248,113,113,${alpha * 2})`;
            nCtx.beginPath();
            nCtx.arc(fx + (tx - fx) * t, lastPos[i].y + (outEntries[j].y - lastPos[i].y) * t, 1.2, 0, Math.PI * 2);
            nCtx.fill();
          }
        }
      }
    }

    // ── Hidden nodes ──
    for (let hl = 0; hl < hiddenLayers; hl++) {
      const layerIdx = hl + 1;
      const positions = getHiddenPos(hl);
      if (positions.length > 0) {
        nCtx.fillStyle = 'rgba(129,140,248,0.55)';
        nCtx.font = `7px -apple-system,sans-serif`;
        nCtx.textAlign = 'center'; nCtx.textBaseline = 'top';
        nCtx.fillText(`H${hl + 1}(${brain.layers[layerIdx]})`, positions[0].x, 2);
        nCtx.textBaseline = 'middle';
      }
      for (const { x: hx, y: hy } of positions) {
        const act = Math.abs(acts[layerIdx][positions.indexOf({ x: hx, y: hy })] || 0);
        // Use index-based lookup
        const n = positions.findIndex(p => p.x === hx && p.y === hy);
        const activation = Math.abs(acts[layerIdx][n] || 0);
        const r = 2.5 + activation * 3;
        if (activation > 0.2) {
          nCtx.fillStyle = `rgba(129,140,248,${activation * 0.15})`;
          nCtx.beginPath(); nCtx.arc(hx, hy, r + 5, 0, Math.PI * 2); nCtx.fill();
        }
        const br = Math.floor(60 + activation * 190);
        nCtx.fillStyle = `rgb(${Math.floor(br * 0.5)},${Math.floor(br * 0.6)},${br})`;
        nCtx.beginPath(); nCtx.arc(hx, hy, r, 0, Math.PI * 2); nCtx.fill();
        nCtx.strokeStyle = `rgba(255,255,255,${0.15 + activation * 0.3})`;
        nCtx.lineWidth = 0.5; nCtx.stroke();
      }
    }

    // ─── Title bar ───
    const titleFont = compact ? 7 : 9;
    const subFont = compact ? 6 : 8;
    nCtx.font = `bold ${titleFont}px -apple-system,sans-serif`;
    nCtx.fillStyle = '#63d2ff'; nCtx.textAlign = 'left'; nCtx.textBaseline = 'middle';
    nCtx.fillText(`#${body.id}`, pad, compact ? 6 : 9);
    nCtx.fillStyle = 'rgba(99,210,255,0.6)';
    nCtx.font = `${subFont}px -apple-system,sans-serif`;
    nCtx.fillText(`Fit:${Math.round(body.fitness || 0)}`, pad + 24, compact ? 6 : 9);

    // ─── Draw helpers ───
    function drawCatHeader(x, yy, text, color) {
      nCtx.fillStyle = color;
      nCtx.font = `bold ${compact ? 6 : 8}px -apple-system,sans-serif`;
      nCtx.textAlign = 'left'; nCtx.textBaseline = 'top';
      nCtx.fillText(text, x, yy);
      nCtx.textBaseline = 'middle';
    }
    function drawBar(x, yy, w, val, maxVal, color, label) {
      const ratio = Math.min(1, Math.max(0, (val + maxVal) / (2 * maxVal)));
      nCtx.fillStyle = 'rgba(255,255,255,0.06)'; nCtx.fillRect(x, yy, w, barH);
      nCtx.fillStyle = color; nCtx.fillRect(x, yy, ratio * w, barH);
      nCtx.fillStyle = 'rgba(255,255,255,0.12)'; nCtx.fillRect(x + w * 0.5, yy, 1, barH);
      if (label) {
        nCtx.fillStyle = 'rgba(255,255,255,0.5)';
        nCtx.font = `6px -apple-system,sans-serif`; nCtx.textAlign = 'right';
        nCtx.fillText(label, x - 2, yy + barH / 2);
      }
    }
    function drawBar01(x, yy, w, val, color, label) {
      const ratio = Math.min(1, Math.max(0, val));
      nCtx.fillStyle = 'rgba(255,255,255,0.06)'; nCtx.fillRect(x, yy, w, barH);
      nCtx.fillStyle = color; nCtx.fillRect(x, yy, ratio * w, barH);
      if (label) {
        nCtx.fillStyle = 'rgba(255,255,255,0.5)';
        nCtx.font = `6px -apple-system,sans-serif`; nCtx.textAlign = 'right';
        nCtx.fillText(label, x - 2, yy + barH / 2);
      }
    }

    // ─── Input column ───
    inputIdx = 0;
    let drawY = titleH;

    // Velocity
    drawCatHeader(colInputX, drawY, '⚡速度', 'rgba(251,191,36,0.8)'); drawY += catH;
    for (let i = 0; i < dispNodes; i++) {
      const vx = acts[0][inputIdx] || 0, vy = acts[0][inputIdx + 1] || 0;
      drawBar01(inputBarX, drawY, inputBarW, Math.sqrt(vx * vx + vy * vy) * 2, 'rgba(251,191,36,0.6)', `N${i}`);
      drawY += barH + barGap; inputIdx += 2;
    }
    drawY += secGap;

    // Muscle state
    drawCatHeader(colInputX, drawY, '🔗筋肉', 'rgba(52,211,153,0.8)'); drawY += catH;
    for (let i = 0; i < dispMuscles; i++) {
      drawBar(inputBarX, drawY, inputBarW, acts[0][inputIdx] || 0, 1, 'rgba(52,211,153,0.6)', `M${i}`);
      drawY += barH + barGap; inputIdx++;
    }
    drawY += secGap;

    // Grounded dots
    drawCatHeader(colInputX, drawY, '⬇接地', 'rgba(99,210,255,0.8)'); drawY += catH;
    const dotSpacing = colInputTotalW / Math.max(1, dispNodes);
    for (let i = 0; i < dispNodes; i++) {
      const grounded = acts[0][inputIdx] || 0;
      const dotX = colInputX + dotSpacing * (i + 0.5);
      nCtx.fillStyle = grounded > 0.5 ? 'rgba(99,210,255,0.9)' : 'rgba(99,210,255,0.15)';
      nCtx.beginPath(); nCtx.arc(dotX, drawY + 4, 3, 0, Math.PI * 2); nCtx.fill();
      nCtx.fillStyle = 'rgba(255,255,255,0.3)';
      nCtx.font = `5px -apple-system,sans-serif`; nCtx.textAlign = 'center'; nCtx.textBaseline = 'top';
      nCtx.fillText(i, dotX, drawY + 9); nCtx.textBaseline = 'middle';
      inputIdx++;
    }
    drawY += 20; drawY += secGap;

    // Rhythm
    drawCatHeader(colInputX, drawY, '♪リズム', 'rgba(167,139,250,0.8)'); drawY += catH;
    drawBar(inputBarX, drawY, inputBarW, acts[0][inputIdx] || 0, 1, 'rgba(167,139,250,0.6)', 'sin');

    // ─── Output column ───
    drawCatHeader(colOutX, titleH, '💪出力', 'rgba(52,211,153,0.9)');
    let drawOY = titleH + catH;
    for (let i = 0; i < dispMuscles; i++) {
      const act = acts[outLayerIdx][i] || 0;
      const g = Math.floor(120 + act * 135);
      drawBar01(outBarX, drawOY, outBarW, act, `rgba(50,${g},${Math.floor(g * 0.7)},0.8)`, `M${i}`);
      // Percentage label
      nCtx.fillStyle = 'rgba(255,255,255,0.35)';
      nCtx.font = `6px -apple-system,sans-serif`; nCtx.textAlign = 'left';
      nCtx.fillText(`${Math.round(act * 100)}%`, outBarX + outBarW + 2, drawOY + barH / 2);
      drawOY += barH + barGap;
    }

    // ─── Legend ───
    const legendY = ch - 5;
    nCtx.font = `6px -apple-system,sans-serif`; nCtx.textBaseline = 'middle';
    const legends = [
      { color: 'rgba(251,191,36,0.8)', text: '速度' },
      { color: 'rgba(52,211,153,0.8)', text: '筋肉' },
      { color: 'rgba(99,210,255,0.8)', text: '接地' },
      { color: 'rgba(167,139,250,0.8)', text: 'リズム' },
    ];
    let lx = pad;
    for (const lg of legends) {
      nCtx.fillStyle = lg.color; nCtx.fillRect(lx, legendY - 3, 5, 3);
      nCtx.fillStyle = 'rgba(255,255,255,0.4)'; nCtx.textAlign = 'left';
      nCtx.fillText(lg.text, lx + 7, legendY - 1); lx += 34;
    }
    nCtx.fillStyle = 'rgba(52,211,153,0.5)'; nCtx.fillRect(lx + 2, legendY - 2, 10, 1.5);
    nCtx.fillStyle = 'rgba(255,255,255,0.4)'; nCtx.fillText('興奮', lx + 14, legendY - 1); lx += 34;
    nCtx.fillStyle = 'rgba(248,113,113,0.5)'; nCtx.fillRect(lx, legendY - 2, 10, 1.5);
    nCtx.fillStyle = 'rgba(255,255,255,0.4)'; nCtx.fillText('抑制', lx + 12, legendY - 1);
  }

  // ═══════════════════════════════════════════════════
  //  BRAIN ANALYSIS — 「なぜこの戦略？」を解析・可視化
  // ═══════════════════════════════════════════════════

  const CAT_DEFS = [
    { key: 'vel', name: '速度', emoji: '⚡', color: '#fbbf24', rgba: 'rgba(251,191,36,' },
    { key: 'mus', name: '筋肉FB', emoji: '🔗', color: '#34d399', rgba: 'rgba(52,211,153,' },
    { key: 'gnd', name: '接地', emoji: '⬇', color: '#63d2ff', rgba: 'rgba(99,210,255,' },
    { key: 'rht', name: 'リズム', emoji: '♪', color: '#a78bfa', rgba: 'rgba(167,139,250,' },
  ];

  function computeStrategyProfile(brain) {
    const nLayers = brain.layers.length;
    const inputSize = brain.layers[0];
    const outputSize = brain.layers[nLayers - 1];
    const acts = brain.activations;
    const nodeCount = blueprint.nodes.length;
    const muscleCount = blueprint.muscles.length;

    // ── End-to-end effective weight matrix (input→output) ──
    // accounts for ReLU gating at current activation state
    let matrix = [];
    const h1Size = brain.layers[1];
    for (let i = 0; i < inputSize; i++) {
      matrix[i] = new Float32Array(h1Size);
      for (let j = 0; j < h1Size; j++) {
        matrix[i][j] = brain.weights[0][i * h1Size + j];
      }
    }
    for (let l = 1; l < nLayers - 1; l++) {
      const prevSize = brain.layers[l];
      const nextSize = brain.layers[l + 1];
      const reluMask = acts[l].map(a => a > 0 ? 1 : 0);
      const wt = brain.weights[l];
      const newMatrix = [];
      for (let i = 0; i < inputSize; i++) {
        newMatrix[i] = new Float32Array(nextSize);
        for (let j = 0; j < nextSize; j++) {
          let sum = 0;
          for (let k = 0; k < prevSize; k++) {
            sum += matrix[i][k] * reluMask[k] * wt[k * nextSize + j];
          }
          newMatrix[i][j] = sum;
        }
      }
      matrix = newMatrix;
    }

    // ── Input category ranges ──
    const velStart = 0, velEnd = nodeCount * 2;
    const musStart = velEnd, musEnd = velEnd + muscleCount;
    const gndStart = musEnd, gndEnd = musEnd + nodeCount;
    const rhtStart = gndEnd;
    const catRanges = [
      { start: velStart, end: velEnd },
      { start: musStart, end: musEnd },
      { start: gndStart, end: gndEnd },
      { start: rhtStart, end: rhtStart + 1 },
    ];

    // ── Per-muscle category attribution ──
    const dispMuscles = Math.min(muscleCount, 10);
    const muscleAttr = []; // [muscle][cat] = abs attribution
    for (let j = 0; j < dispMuscles; j++) {
      const attrs = [];
      for (const range of catRanges) {
        let absSum = 0;
        for (let i = range.start; i < range.end && i < inputSize; i++) {
          absSum += Math.abs(matrix[i][j]) * Math.abs(acts[0][i] || 0);
        }
        attrs.push(absSum);
      }
      muscleAttr.push(attrs);
    }

    // ── Overall category importance ──
    const catScores = CAT_DEFS.map((_, ci) => {
      let total = 0;
      for (let j = 0; j < dispMuscles; j++) total += muscleAttr[j][ci];
      return total;
    });
    const maxScore = Math.max(...catScores, 0.001);
    const normalized = catScores.map(v => v / maxScore);

    // ── Strategy type classification ──
    const dominantIdx = normalized.indexOf(Math.max(...normalized));
    const typeNames = ['速度反応型', '自己フィードバック型', '接地感知型', 'リズム駆動型'];
    const secondIdx = normalized.map((v, i) => i === dominantIdx ? -1 : v).indexOf(
      Math.max(...normalized.filter((_, i) => i !== dominantIdx))
    );
    let strategyType = typeNames[dominantIdx];
    if (normalized[secondIdx] > 0.7) {
      strategyType += '＋' + typeNames[secondIdx].replace('型', '');
    }

    return { catScores, normalized, muscleAttr, strategyType, dominantIdx, matrix };
  }

  function generateStrategyNarrative(profile, body) {
    const lines = [];
    const { normalized, muscleAttr, dominantIdx, strategyType } = profile;
    const dispMuscles = muscleAttr.length;

    // ── Overall strategy description ──
    const descriptions = [
      '各ノードの速度を感知し、動きに応じて筋肉を制御する',
      '自身の筋肉状態をフィードバックし、姿勢を自己調整する',
      '接地を検出し、地面に触れた脚で踏み込む歩行パターンを発達させた',
      'リズム信号に同期して周期的に筋肉を伸縮させる',
    ];
    lines.push(descriptions[dominantIdx]);

    // ── Per-muscle insights (top 3 most active muscles) ──
    const muscleTotalActivity = muscleAttr.map(attrs => attrs.reduce((a, b) => a + b, 0));
    const topMuscles = muscleTotalActivity.map((v, i) => ({ i, v }))
      .sort((a, b) => b.v - a.v).slice(0, 3);

    for (const { i: mi } of topMuscles) {
      const attrs = muscleAttr[mi];
      const total = attrs.reduce((a, b) => a + b, 0.001);
      const sorted = attrs.map((v, ci) => ({ ci, pct: v / total }))
        .sort((a, b) => b.pct - a.pct);
      const top = sorted[0];
      if (top.pct > 0.4) {
        const catName = CAT_DEFS[top.ci].emoji + CAT_DEFS[top.ci].name;
        const pct = Math.round(top.pct * 100);
        const action = body.muscleAct && body.muscleAct[mi] > 0.5 ? '収縮' : '伸長';
        lines.push(`M${mi}: ${catName}(${pct}%)に依存 → ${action}傾向`);
      }
    }

    return lines;
  }

  function renderBrainAnalysis() {
    if (!showAnalysis) return;
    const ac = document.getElementById('analysisCanvas');
    if (!ac) return;
    if (population.length === 0 || focusedIndex >= population.length) return;

    const body = population[focusedIndex];
    const brain = body.brain;
    const dpr = window.devicePixelRatio || 1;
    const muscleCount = blueprint.muscles.length;
    const dispMuscles = Math.min(muscleCount, 10);
    const aCompact = brainMode && !expandedSection;
    const pad = aCompact ? 6 : 10;

    // ── Compute profile ──
    let profile;
    try {
      profile = computeStrategyProfile(brain);
    } catch(e) { return; }
    const { catScores, normalized, muscleAttr, strategyType, dominantIdx } = profile;
    const narrative = generateStrategyNarrative(profile, body);

    // ── Canvas sizing ──
    const radarH = aCompact ? 80 : 120;
    const narrativeLineH = aCompact ? 10 : 14;
    const maxNarrative = aCompact ? Math.min(narrative.length, 3) : narrative.length;
    const narrativeH = narrativeLineH * (maxNarrative + 1) + (aCompact ? 4 : 10);
    const heatmapRowH = aCompact ? 10 : 14;
    const heatmapH = (aCompact ? 12 : 16) + dispMuscles * heatmapRowH + (aCompact ? 4 : 10);
    const importBarH = aCompact ? 12 : 18;
    const importanceH = CAT_DEFS.length * importBarH + (aCompact ? 10 : 20);
    const trendH = strategyHistory.length > 1 ? (aCompact ? 45 : 80) : 0;
    let neededH;
    if (aCompact) {
      // 2-column: left = radar + heatmap, right = narrative + importance + trend
      const leftH = radarH + 4 + 10 + 6 + dispMuscles * 10;
      const rightH = 10 + Math.min(narrative.length, 4) * 10 + 4 + 10 + CAT_DEFS.length * 10 + 4 + trendH;
      neededH = 16 + Math.max(leftH, rightH) + 8;
    } else {
      neededH = 22 + radarH + narrativeH + heatmapH + importanceH + trendH + 20;
    }
    const canvasH = Math.max(neededH, aCompact ? 180 : 380);
    if (!brainMode && Math.abs(ac.clientHeight - canvasH) > 2) ac.style.height = canvasH + 'px';

    const cw = ac.clientWidth, ch = ac.clientHeight;
    if (ac.width !== Math.round(cw * dpr) || ac.height !== Math.round(ch * dpr)) {
      ac.width = Math.round(cw * dpr); ac.height = Math.round(ch * dpr);
    }
    const ctx = ac.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(4,6,10,0.92)'; ctx.fillRect(0, 0, cw, ch);

    // ── Title ──
    const aTitleFontSz = aCompact ? 7 : 9;
    const aSubFontSz = aCompact ? 6 : 8;
    ctx.font = `bold ${aTitleFontSz}px -apple-system,sans-serif`;
    ctx.fillStyle = '#fbbf24'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`#${body.id}  戦略: ${strategyType}`, pad, aCompact ? 8 : 11);
    ctx.fillStyle = 'rgba(251,191,36,0.5)';
    ctx.font = `${aSubFontSz}px -apple-system,sans-serif`;
    ctx.fillText(`Fit: ${Math.round(body.fitness || 0)}`, cw - pad - 50, aCompact ? 8 : 11);

    let y = aCompact ? 16 : 24;

    if (aCompact) {
      // ═══════════════════════════════════════
      // COMPACT 2-COLUMN LAYOUT
      // Left:  Radar → Heatmap
      // Right: Narrative → Importance → Trend
      // ═══════════════════════════════════════
      const halfW = Math.floor(cw / 2);
      const colL = pad, colR = halfW + 4;
      const rightW = cw - colR - pad;

      // ════════ LEFT COLUMN ════════
      let ly = y;

      // ── Radar chart ──
      const rcx = halfW / 2, rcy = ly + radarH / 2;
      const rMax = Math.min(radarH / 2 - 10, halfW / 2 - 20);
      const nAxes = 4;
      const angles = CAT_DEFS.map((_, i) => -Math.PI / 2 + (Math.PI * 2 / nAxes) * i);
      for (let ring = 1; ring <= 3; ring++) {
        const r = rMax * ring / 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(rcx, rcy, r, 0, Math.PI * 2); ctx.stroke();
      }
      for (let i = 0; i < nAxes; i++) {
        const ax = rcx + Math.cos(angles[i]) * rMax;
        const ay = rcy + Math.sin(angles[i]) * rMax;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(rcx, rcy); ctx.lineTo(ax, ay); ctx.stroke();
        const lbx = rcx + Math.cos(angles[i]) * (rMax + 8);
        const lby = rcy + Math.sin(angles[i]) * (rMax + 6);
        ctx.fillStyle = CAT_DEFS[i].color;
        ctx.font = 'bold 6px -apple-system,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(CAT_DEFS[i].emoji + CAT_DEFS[i].name, lbx, lby);
      }
      ctx.beginPath();
      for (let i = 0; i < nAxes; i++) {
        const r = rMax * Math.min(1, normalized[i]);
        const px = rcx + Math.cos(angles[i]) * r;
        const py = rcy + Math.sin(angles[i]) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = `${CAT_DEFS[dominantIdx].rgba}0.15)`;
      ctx.fill();
      ctx.strokeStyle = `${CAT_DEFS[dominantIdx].rgba}0.7)`;
      ctx.lineWidth = 1.5; ctx.stroke();
      for (let i = 0; i < nAxes; i++) {
        const r = rMax * Math.min(1, normalized[i]);
        const px = rcx + Math.cos(angles[i]) * r;
        const py = rcy + Math.sin(angles[i]) * r;
        ctx.fillStyle = CAT_DEFS[i].color;
        ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '6px -apple-system,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(Math.round(normalized[i] * 100) + '%', px, py - 6);
      }
      ly += radarH + 4;

      // ── Heatmap (left, below radar) ──
      ctx.fillStyle = 'rgba(251,191,36,0.7)';
      ctx.font = 'bold 7px -apple-system,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('── 入出力影響マップ ──', colL, ly);
      ly += 10;
      const hmLeft2 = colL + 16;
      const hmRight2 = halfW - 2;
      const catColW2 = (hmRight2 - hmLeft2) / CAT_DEFS.length;
      const rowH2 = 9;
      for (let ci = 0; ci < CAT_DEFS.length; ci++) {
        const cx = hmLeft2 + catColW2 * ci + catColW2 / 2;
        ctx.fillStyle = CAT_DEFS[ci].color;
        ctx.font = 'bold 6px -apple-system,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(CAT_DEFS[ci].emoji, cx, ly + 2);
      }
      ly += 6;
      const maxAttr = Math.max(...muscleAttr.flat(), 0.001);
      for (let mi = 0; mi < dispMuscles; mi++) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '5px -apple-system,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(`M${mi}`, hmLeft2 - 3, ly + rowH2 / 2);
        for (let ci = 0; ci < CAT_DEFS.length; ci++) {
          const cellX = hmLeft2 + catColW2 * ci + 1;
          const cellW = catColW2 - 2;
          const intensity = muscleAttr[mi][ci] / maxAttr;
          ctx.fillStyle = 'rgba(255,255,255,0.04)';
          ctx.fillRect(cellX, ly, cellW, rowH2 - 1);
          if (intensity > 0.02) {
            const alpha = Math.min(0.8, intensity * 0.9);
            ctx.fillStyle = `${CAT_DEFS[ci].rgba}${alpha})`;
            ctx.fillRect(cellX, ly, cellW, rowH2 - 1);
            if (intensity > 0.15) {
              ctx.fillStyle = intensity > 0.5 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)';
              ctx.font = '5px -apple-system,sans-serif'; ctx.textAlign = 'center';
              ctx.fillText(Math.round(intensity * 100), cellX + cellW / 2, ly + rowH2 / 2);
            }
          }
        }
        ly += rowH2;
      }
      const leftBottom = ly;

      // ════════ RIGHT COLUMN ════════
      let ry = y;

      // ── Narrative ──
      ctx.fillStyle = 'rgba(251,191,36,0.7)';
      ctx.font = 'bold 7px -apple-system,sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('── なぜこの戦略？ ──', colR, ry);
      ry += 10;
      ctx.font = '7px -apple-system,sans-serif';
      const maxNarLines = Math.min(narrative.length, 4);
      const maxCh = Math.floor(rightW / 4.2);
      for (let li = 0; li < maxNarLines; li++) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        const txt = narrative[li].length > maxCh ? narrative[li].slice(0, maxCh) + '…' : narrative[li];
        ctx.fillText(txt, colR, ry);
        ry += 10;
      }
      ry += 4;

      // ── Importance ranking (no legend) ──
      ctx.fillStyle = 'rgba(251,191,36,0.7)';
      ctx.font = 'bold 7px -apple-system,sans-serif'; ctx.textBaseline = 'top';
      ctx.fillText('── 入力重要度 ──', colR, ry);
      ry += 10;
      const maxCatScore = Math.max(...catScores, 0.001);
      const sortedCats = catScores.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
      const impBarLeft2 = colR + 34;
      const impBarW2 = cw - pad - impBarLeft2 - 20;
      for (const { i: ci, v } of sortedCats) {
        const ratio = v / maxCatScore;
        ctx.fillStyle = CAT_DEFS[ci].color;
        ctx.font = '6px -apple-system,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(CAT_DEFS[ci].emoji + ' ' + CAT_DEFS[ci].name, colR, ry + 4);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(impBarLeft2, ry, impBarW2, 7);
        ctx.fillStyle = `${CAT_DEFS[ci].rgba}0.6)`;
        ctx.fillRect(impBarLeft2, ry, impBarW2 * ratio, 7);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '5px -apple-system,sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(Math.round(ratio * 100) + '%', impBarLeft2 + impBarW2 + 2, ry + 4);
        ry += 10;
      }
      ry += 4;

      // ── Strategy trend (right, compact) ──
      if (strategyHistory.length > 1) {
        ctx.fillStyle = 'rgba(251,191,36,0.7)';
        ctx.font = 'bold 7px -apple-system,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('── 戦略変遷 ──', colR, ry);
        ry += 9;
        const trendLeft = colR;
        const trendRight = cw - pad;
        const trendW = trendRight - trendLeft;
        const trendTop = ry;
        const trendBot = ry + 30;
        const hist = strategyHistory;
        const len = hist.length;
        for (let ci = 0; ci < CAT_DEFS.length; ci++) {
          ctx.beginPath();
          for (let gi = 0; gi < len; gi++) {
            const x = trendLeft + (gi / Math.max(1, len - 1)) * trendW;
            const scores = hist[gi].catScores;
            const total = scores.reduce((a, b) => a + b, 0.001);
            let cumRatio = 0;
            for (let k = 0; k <= ci; k++) cumRatio += scores[k] / total;
            const py = trendBot - (trendBot - trendTop) * cumRatio;
            if (gi === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
          }
          for (let gi = len - 1; gi >= 0; gi--) {
            const x = trendLeft + (gi / Math.max(1, len - 1)) * trendW;
            const scores = hist[gi].catScores;
            const total = scores.reduce((a, b) => a + b, 0.001);
            let cumRatio = 0;
            for (let k = 0; k < ci; k++) cumRatio += scores[k] / total;
            const py = trendBot - (trendBot - trendTop) * cumRatio;
            ctx.lineTo(x, py);
          }
          ctx.closePath();
          ctx.fillStyle = `${CAT_DEFS[ci].rgba}0.35)`;
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '5px -apple-system,sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(`世代${hist[0].gen}`, trendLeft, trendBot + 3);
        ctx.textAlign = 'right';
        ctx.fillText(`世代${hist[len - 1].gen}`, trendRight, trendBot + 3);
        ry = trendBot + 10;
      }
      const rightBottom = ry;

      // ── Bottom alignment line ──
      const bottomY = Math.max(leftBottom, rightBottom);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad, bottomY + 2); ctx.lineTo(cw - pad, bottomY + 2); ctx.stroke();

    } else {

    // ══════════════════════════════════════════
    // NON-COMPACT (single column) LAYOUT
    // ══════════════════════════════════════════

    // 1. STRATEGY RADAR CHART
    const rcx = cw / 2, rcy = y + radarH / 2;
    const rMax = Math.min(radarH / 2 - 14, (cw / 2) - 40);
    const nAxes = 4;
    const angles = CAT_DEFS.map((_, i) => -Math.PI / 2 + (Math.PI * 2 / nAxes) * i);
    for (let ring = 1; ring <= 3; ring++) {
      const r = rMax * ring / 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(rcx, rcy, r, 0, Math.PI * 2); ctx.stroke();
    }
    for (let i = 0; i < nAxes; i++) {
      const ax = rcx + Math.cos(angles[i]) * rMax;
      const ay = rcy + Math.sin(angles[i]) * rMax;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(rcx, rcy); ctx.lineTo(ax, ay); ctx.stroke();
      const lx = rcx + Math.cos(angles[i]) * (rMax + 12);
      const ly = rcy + Math.sin(angles[i]) * (rMax + 10);
      ctx.fillStyle = CAT_DEFS[i].color;
      ctx.font = 'bold 8px -apple-system,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(CAT_DEFS[i].emoji + CAT_DEFS[i].name, lx, ly);
    }
    ctx.beginPath();
    for (let i = 0; i < nAxes; i++) {
      const r = rMax * Math.min(1, normalized[i]);
      const px = rcx + Math.cos(angles[i]) * r;
      const py = rcy + Math.sin(angles[i]) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = `${CAT_DEFS[dominantIdx].rgba}0.15)`;
    ctx.fill();
    ctx.strokeStyle = `${CAT_DEFS[dominantIdx].rgba}0.7)`;
    ctx.lineWidth = 1.5; ctx.stroke();
    for (let i = 0; i < nAxes; i++) {
      const r = rMax * Math.min(1, normalized[i]);
      const px = rcx + Math.cos(angles[i]) * r;
      const py = rcy + Math.sin(angles[i]) * r;
      ctx.fillStyle = CAT_DEFS[i].color;
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '7px -apple-system,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(Math.round(normalized[i] * 100) + '%', px, py - 7);
    }
    y += radarH + 6;

    // 2. STRATEGY NARRATIVE
    ctx.fillStyle = 'rgba(251,191,36,0.7)';
    ctx.font = 'bold 8px -apple-system,sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('── なぜこの戦略？ ──', pad, y);
    y += 13;
    ctx.font = '8px -apple-system,sans-serif';
    for (const line of narrative) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(line.length > 44 ? line.slice(0, 44) + '…' : line, pad + 2, y);
      y += 12;
    }
    y += 6;

    // 3. INPUT→OUTPUT HEATMAP
    ctx.fillStyle = 'rgba(251,191,36,0.7)';
    ctx.font = 'bold 8px -apple-system,sans-serif';
    ctx.fillText('── 入出力影響マップ ──', pad, y);
    y += 14;
    const hmLeft = pad + 24;
    const hmRight = cw - pad;
    const catColW = (hmRight - hmLeft) / CAT_DEFS.length;
    const rowH = 12;
    for (let ci = 0; ci < CAT_DEFS.length; ci++) {
      const cx = hmLeft + catColW * ci + catColW / 2;
      ctx.fillStyle = CAT_DEFS[ci].color;
      ctx.font = 'bold 7px -apple-system,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(CAT_DEFS[ci].emoji, cx, y - 2);
    }
    y += 4;
    const maxAttr = Math.max(...muscleAttr.flat(), 0.001);
    for (let mi = 0; mi < dispMuscles; mi++) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '7px -apple-system,sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(`M${mi}`, hmLeft - 4, y + rowH / 2);
      for (let ci = 0; ci < CAT_DEFS.length; ci++) {
        const cellX = hmLeft + catColW * ci + 1;
        const cellW = catColW - 2;
        const intensity = muscleAttr[mi][ci] / maxAttr;
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(cellX, y, cellW, rowH - 1);
        if (intensity > 0.02) {
          const alpha = Math.min(0.8, intensity * 0.9);
          ctx.fillStyle = `${CAT_DEFS[ci].rgba}${alpha})`;
          ctx.fillRect(cellX, y, cellW, rowH - 1);
          if (intensity > 0.15) {
            ctx.fillStyle = intensity > 0.5 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)';
            ctx.font = '6px -apple-system,sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(Math.round(intensity * 100), cellX + cellW / 2, y + rowH / 2);
          }
        }
      }
      y += rowH;
    }
    y += 8;

    // 4. INPUT IMPORTANCE RANKING
    ctx.fillStyle = 'rgba(251,191,36,0.7)';
    ctx.font = 'bold 8px -apple-system,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('── 入力重要度ランキング ──', pad, y);
    y += 14;
    const maxCatScore = Math.max(...catScores, 0.001);
    const sortedCats = catScores.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v);
    const impBarLeft = pad + 50;
    const impBarW = cw - impBarLeft - pad - 30;
    for (const { i: ci, v } of sortedCats) {
      const ratio = v / maxCatScore;
      ctx.fillStyle = CAT_DEFS[ci].color;
      ctx.font = '8px -apple-system,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(CAT_DEFS[ci].emoji + ' ' + CAT_DEFS[ci].name, pad, y + 5);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(impBarLeft, y, impBarW, 10);
      ctx.fillStyle = `${CAT_DEFS[ci].rgba}0.6)`;
      ctx.fillRect(impBarLeft, y, impBarW * ratio, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '7px -apple-system,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(Math.round(ratio * 100) + '%', impBarLeft + impBarW + 3, y + 6);
      y += 16;
    }
    y += 6;

    // 5. STRATEGY EVOLUTION TREND
    if (strategyHistory.length > 1) {
      ctx.fillStyle = 'rgba(251,191,36,0.7)';
      ctx.font = 'bold 8px -apple-system,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('── 戦略変遷 ──', pad, y);
      y += 12;
      const trendLeft = pad + 8;
      const trendRight = cw - pad;
      const trendW = trendRight - trendLeft;
      const trendTop = y;
      const trendBot = y + 50;
      const hist = strategyHistory;
      const len = hist.length;
      for (let ci = 0; ci < CAT_DEFS.length; ci++) {
        ctx.beginPath();
        for (let gi = 0; gi < len; gi++) {
          const x = trendLeft + (gi / Math.max(1, len - 1)) * trendW;
          const scores = hist[gi].catScores;
          const total = scores.reduce((a, b) => a + b, 0.001);
          let cumRatio = 0;
          for (let k = 0; k <= ci; k++) cumRatio += scores[k] / total;
          const py = trendBot - (trendBot - trendTop) * cumRatio;
          if (gi === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
        }
        for (let gi = len - 1; gi >= 0; gi--) {
          const x = trendLeft + (gi / Math.max(1, len - 1)) * trendW;
          const scores = hist[gi].catScores;
          const total = scores.reduce((a, b) => a + b, 0.001);
          let cumRatio = 0;
          for (let k = 0; k < ci; k++) cumRatio += scores[k] / total;
          const py = trendBot - (trendBot - trendTop) * cumRatio;
          ctx.lineTo(x, py);
        }
        ctx.closePath();
        ctx.fillStyle = `${CAT_DEFS[ci].rgba}0.35)`;
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '6px -apple-system,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`世代${hist[0].gen}`, trendLeft, trendBot + 8);
      ctx.textAlign = 'right';
      ctx.fillText(`世代${hist[len - 1].gen}`, trendRight, trendBot + 8);
      y = trendBot + 16;
    }

    // 6. MINI LEGEND
    ctx.font = '6px -apple-system,sans-serif'; ctx.textBaseline = 'middle';
    let lx = pad;
    for (const cat of CAT_DEFS) {
      ctx.fillStyle = cat.color; ctx.fillRect(lx, y, 5, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.textAlign = 'left';
      ctx.fillText(cat.name, lx + 7, y + 2); lx += 40;
    }

    } // end if/else aCompact
  }

  function renderGraph() {
    if (!showGraph) return;
    const gc = document.getElementById('graphCanvas');
    const gCtx = gc.getContext('2d');
    const gW = gc.width, gH = gc.height;
    gCtx.clearRect(0, 0, gW, gH); gCtx.fillStyle = 'rgba(4,6,10,0.8)'; gCtx.fillRect(0, 0, gW, gH);
    if (historyBest.length < 2) {
      gCtx.fillStyle = 'rgba(129,140,248,0.3)'; gCtx.font = '12px sans-serif'; gCtx.textAlign = 'center';
      gCtx.fillText('データ収集中...', gW/2, gH/2); return;
    }
    let maxVal = 10, minVal = 0;
    for (const v of historyBest) if (v > maxVal) maxVal = v;
    for (const v of historyAvg) if (v < minVal) minVal = v;
    const range = maxVal - minVal;
    maxVal += range * 0.1; minVal -= range * 0.1;
    const rng = maxVal - minVal || 1;

    gCtx.strokeStyle = 'rgba(129,140,248,0.1)'; gCtx.lineWidth = 0.5;
    for (let i = 1; i <= 4; i++) {
      const y = gH - (i/4)*gH;
      gCtx.beginPath(); gCtx.moveTo(0,y); gCtx.lineTo(gW,y); gCtx.stroke();
      gCtx.fillStyle='rgba(129,140,248,0.4)'; gCtx.font='9px sans-serif'; gCtx.textAlign='left';
      gCtx.fillText(String(Math.round(minVal + (i/4)*rng)), 2, y-2);
    }
    drawGraphLine(gCtx, historyBest, gW, gH, minVal, rng, '#fbbf24', 2);
    drawGraphLine(gCtx, historyAvg, gW, gH, minVal, rng, '#818cf8', 1.5);
    gCtx.font='10px sans-serif'; gCtx.textAlign='right';
    gCtx.fillStyle='#fbbf24'; gCtx.fillText(`最高: ${Math.round(historyBest[historyBest.length-1])}`, gW-10, 14);
    gCtx.fillStyle='#818cf8'; gCtx.fillText(`平均: ${Math.round(historyAvg[historyAvg.length-1])}`, gW-10, 28);
  }

  function drawGraphLine(gCtx, data, gW, gH, minVal, rng, color, lw) {
    gCtx.strokeStyle = color; gCtx.lineWidth = lw; gCtx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / Math.max(1, HISTORY_MAX - 1)) * gW;
      const y = gH - ((data[i] - minVal) / rng) * gH;
      if (i === 0) gCtx.moveTo(x,y); else gCtx.lineTo(x,y);
    }
    gCtx.stroke();
  }

  // ═══════════════════════════════════════════════════
  //  INPUT HANDLING
  // ═══════════════════════════════════════════════════
  let currentTool = 'observe';
  let showMuscles = true, showTrails = false, showGrid = false, showGraph = false;
  let showLabels = true, showNeural = false, showAnalysis = false;
  let brainMode = false;
  let showConfig = false;
  let simSpeed = 1, isPaused = false;
  let pointers = new Map();
  let lastPinchDist = 0, isPanning = false;
  let panStartX = 0, panStartY = 0, camStartX = 0, camStartY = 0;
  let isDrawing = false;
  let cursorScreenX = -1, cursorScreenY = -1, cursorVisible = false;

  function screenToWorld(sx, sy) { return { x: (sx - camX) / camZoom, y: (sy - camY) / camZoom }; }

  // Build Phase Input
  function handleBuildClick(sx, sy) {
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    switch (buildTool) {
      case 'add-node': blueprint.nodes.push({ x: wx, y: wy, radius: 7 }); updateBuildInfo(); break;
      case 'add-bone': case 'add-muscle': {
        const idx = findBuildNodeAt(wx, wy); if (idx < 0) break;
        if (buildSelectedNode < 0) { buildSelectedNode = idx; }
        else if (idx !== buildSelectedNode) {
          const list = buildTool === 'add-bone' ? blueprint.bones : blueprint.muscles;
          if (!connectionExists(list, buildSelectedNode, idx)) list.push({ a: buildSelectedNode, b: idx });
          buildSelectedNode = -1; updateBuildInfo();
        }
        updateBuildHint(); break;
      }
      case 'resize-node': {
        const idx2 = findBuildNodeAt(wx, wy);
        if (idx2 >= 0) { const sizes = [4,6,8,10,12]; const ci = sizes.indexOf(blueprint.nodes[idx2].radius); blueprint.nodes[idx2].radius = ci >= 0 ? sizes[(ci+1)%sizes.length] : sizes[0]; }
        break;
      }
      case 'delete': {
        const nodeIdx = findBuildNodeAt(wx, wy);
        if (nodeIdx >= 0) {
          blueprint.nodes.splice(nodeIdx, 1);
          blueprint.bones = blueprint.bones.filter(b => b.a !== nodeIdx && b.b !== nodeIdx).map(b => ({ a: b.a > nodeIdx ? b.a-1 : b.a, b: b.b > nodeIdx ? b.b-1 : b.b }));
          blueprint.muscles = blueprint.muscles.filter(m => m.a !== nodeIdx && m.b !== nodeIdx).map(m => ({ a: m.a > nodeIdx ? m.a-1 : m.a, b: m.b > nodeIdx ? m.b-1 : m.b }));
          buildSelectedNode = -1; updateBuildInfo();
        } else {
          let deleted = false;
          for (let i = blueprint.muscles.length-1; i >= 0; i--) {
            if (isNearLine(wx,wy,blueprint.nodes[blueprint.muscles[i].a],blueprint.nodes[blueprint.muscles[i].b],8)) { blueprint.muscles.splice(i,1); deleted=true; break; }
          }
          if (!deleted) for (let i = blueprint.bones.length-1; i >= 0; i--) {
            if (isNearLine(wx,wy,blueprint.nodes[blueprint.bones[i].a],blueprint.nodes[blueprint.bones[i].b],8)) { blueprint.bones.splice(i,1); break; }
          }
          updateBuildInfo();
        }
        break;
      }
    }
  }

  function isNearLine(px, py, a, b, threshold) {
    const dx = b.x-a.x, dy = b.y-a.y, lenSq = dx*dx+dy*dy;
    if (lenSq < 0.001) return false;
    let t = Math.max(0, Math.min(1, ((px-a.x)*dx+(py-a.y)*dy)/lenSq));
    const nx = a.x+t*dx-px, ny = a.y+t*dy-py;
    return nx*nx+ny*ny < threshold*threshold;
  }

  // Sim Phase Input — REAL-TIME terrain editing
  function handleToolAction(sx, sy) {
    const { x, y } = screenToWorld(sx, sy);
    if (x < 0 || x >= COF.worldW || y < 0 || y >= COF.worldH) return;
    switch (currentTool) {
      case 'block': setTerrain(x, y, TERRAIN_SOLID, BRUSH_SIZE); terrainDirty = true; break;
      case 'erase': setTerrain(x, y, TERRAIN_EMPTY, BRUSH_SIZE); terrainDirty = true; break;
      case 'goal': createGoal(x, y); break;
      case 'delete-goal': deleteGoalNear(x, y); break;
      case 'poke': {
        let nearestIdx = -1, nearestD2 = Infinity;
        for (let i = 0; i < population.length; i++) {
          const cx2 = population[i].getCenterX(), cy2 = population[i].getCenterY();
          const d2 = (x-cx2)*(x-cx2)+(y-cy2)*(y-cy2);
          if (d2 < nearestD2) { nearestD2 = d2; nearestIdx = i; }
        }
        if (nearestIdx >= 0 && nearestD2 < 6400) {
          for (const n of population[nearestIdx].nodes) n.oy += 8;
        }
        break;
      }
    }
  }

  function setTerrain(x, y, type, brushSize) {
    const gcx = (x/COF.cellSize)|0, gcy = (y/COF.cellSize)|0, r = brushSize || 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const gx = gcx+dx, gy = gcy+dy;
      if (gx >= 0 && gx < TERRAIN_W && gy >= 0 && gy < TERRAIN_H && dx*dx+dy*dy <= r*r)
        terrain[gy * TERRAIN_W + gx] = type;
    }
  }

  // ─── Pointer Events ───────────────────────────────
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (currentPhase === PHASE_BUILD) {
      if (pointers.size >= 2) {
        isPanning = true; panStartX = e.clientX; panStartY = e.clientY;
        camStartX = targetCamX; camStartY = targetCamY; buildDragNode = -1;
      } else if (pointers.size === 1) {
        if (buildTool === 'move-node') {
          const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
          buildDragNode = findBuildNodeAt(wx, wy);
          if (buildDragNode < 0) { isPanning = true; panStartX = e.clientX; panStartY = e.clientY; camStartX = targetCamX; camStartY = targetCamY; }
        } else if (buildTool === 'pan') {
          isPanning = true; panStartX = e.clientX; panStartY = e.clientY; camStartX = targetCamX; camStartY = targetCamY;
        } else {
          const { x: wx } = screenToWorld(e.clientX, e.clientY);
          if (wx < -50 || wx > 450) { isPanning = true; panStartX = e.clientX; panStartY = e.clientY; camStartX = targetCamX; camStartY = targetCamY; }
          else handleBuildClick(e.clientX, e.clientY);
        }
      }
    } else {
      if (pointers.size === 1) {
        if (currentTool === 'observe') {
          isPanning = true; panStartX = e.clientX; panStartY = e.clientY; camStartX = targetCamX; camStartY = targetCamY;
          const tapX = e.clientX, tapY = e.clientY;
          canvas.addEventListener('pointerup', function checkTap() {
            if (Math.abs(e.clientX - tapX) < 5 && Math.abs(e.clientY - tapY) < 5) {
              const { x: wx, y: wy } = screenToWorld(tapX, tapY);
              // Select nearest creature and update focusedIndex
              let nearestIdx = -1, nearestD2 = Infinity;
              for (let i = 0; i < population.length; i++) {
                const cx2 = population[i].getCenterX(), cy2 = population[i].getCenterY();
                const d2 = (wx - cx2) * (wx - cx2) + (wy - cy2) * (wy - cy2);
                if (d2 < nearestD2) { nearestD2 = d2; nearestIdx = i; }
              }
              if (nearestIdx >= 0 && nearestD2 < 6400) {
                focusedIndex = nearestIdx;
              }
              showInfoAt(wx, wy);
            }
          }, { once: true });
        } else { isDrawing = true; handleToolAction(e.clientX, e.clientY); }
      }
    }
  });

  canvas.addEventListener('pointermove', e => {
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cursorScreenX = e.clientX; cursorScreenY = e.clientY; cursorVisible = true;
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      if (lastPinchDist > 0) {
        const scale = dist / lastPinchDist;
        const mx = (pts[0].x+pts[1].x)/2, my = (pts[0].y+pts[1].y)/2;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetCamZoom * scale));
        targetCamX = mx - (mx - targetCamX) * (newZoom / targetCamZoom);
        targetCamY = my - (my - targetCamY) * (newZoom / targetCamZoom);
        targetCamZoom = newZoom;
      }
      lastPinchDist = dist; isPanning = false; isDrawing = false; buildDragNode = -1;
    } else if (currentPhase === PHASE_BUILD && buildDragNode >= 0) {
      const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
      blueprint.nodes[buildDragNode].x = wx; blueprint.nodes[buildDragNode].y = wy;
    } else if (isPanning) {
      targetCamX = camStartX + (e.clientX - panStartX);
      targetCamY = camStartY + (e.clientY - panStartY);
      if (currentPhase === PHASE_SIM && cameraMode === 'follow') {
        cameraMode = 'free';
        document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
        const fb = document.querySelector('.cam-btn[data-cam="free"]'); if (fb) fb.classList.add('active');
      }
    } else if (isDrawing && (currentTool === 'block' || currentTool === 'erase')) {
      handleToolAction(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('pointerleave', () => { cursorVisible = false; });
  canvas.addEventListener('pointerenter', e => { cursorScreenX = e.clientX; cursorScreenY = e.clientY; cursorVisible = true; });
  canvas.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = 0;
    if (pointers.size === 0) { isPanning = false; isDrawing = false; buildDragNode = -1; }
  });
  canvas.addEventListener('pointercancel', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = 0;
    if (pointers.size === 0) { isPanning = false; isDrawing = false; buildDragNode = -1; }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetCamZoom * scale));
    targetCamX = e.clientX - (e.clientX - targetCamX) * (newZoom / targetCamZoom);
    targetCamY = e.clientY - (e.clientY - targetCamY) * (newZoom / targetCamZoom);
    targetCamZoom = newZoom;
  }, { passive: false });

  function updateCamera() {
    if (cameraMode !== 'follow' || population.length === 0) return;
    const target = population[focusedIndex]; if (!target) return;
    const wcx = target.getCenterX(), wcy = target.getCenterY();
    const screenCx = wcx * camZoom + camX, screenCy = wcy * camZoom + camY;
    const sw = canvas.width / devicePixelRatio, sh = canvas.height / devicePixelRatio, margin = 0.3;
    if (screenCx < sw * margin || screenCx > sw * (1 - margin)) targetCamX = sw / 2 - wcx * targetCamZoom;
    if (screenCy < sh * margin || screenCy > sh * (1 - margin)) targetCamY = sh / 2 - wcy * targetCamZoom;
  }

  // ═══════════════════════════════════════════════════
  //  UI MANAGEMENT
  // ═══════════════════════════════════════════════════
  document.querySelectorAll('.build-btn[data-btool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.build-btn[data-btool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); buildTool = btn.dataset.btool; buildSelectedNode = -1; updateBuildHint();
    });
  });

  document.getElementById('btn-preset-biped').addEventListener('click', presetBiped);
  document.getElementById('btn-preset-snake').addEventListener('click', presetSnake);
  document.getElementById('btn-preset-spider').addEventListener('click', presetSpider);
  document.getElementById('btn-preset-blob').addEventListener('click', presetBlob);
  document.getElementById('btn-clear-build').addEventListener('click', clearBlueprint);

  document.getElementById('btn-start-sim').addEventListener('click', () => { if (isValidBlueprint()) switchToSim(); });

  function switchToSim() {
    currentPhase = PHASE_SIM;
    document.getElementById('build-overlay').classList.add('hidden');
    document.getElementById('sim-overlay').classList.remove('hidden');
    generation = 0; bestEverFitness = 0; bestEverGen = 0;
    historyBest.length = 0; historyAvg.length = 0;
    evalTimer = 0; COF.worldW = BASE_WORLD_WIDTH;
    prevAvgFitness = 0; prevBestFitness = 0; patternDetectionCounters = {};
    initWorld(); createPopulation(null); resizeCanvas();
    addEventMsg('🚀 ライブ進化シミュレーション開始！', '#63d2ff', false);
  }

  function switchToBuild() {
    currentPhase = PHASE_BUILD;
    document.getElementById('sim-overlay').classList.add('hidden');
    document.getElementById('build-overlay').classList.remove('hidden');
    clearPopulation(); isPaused = false; simSpeed = 1;
    resizeCanvas(); updateBuildInfo();
  }

  document.getElementById('btn-back-build').addEventListener('click', switchToBuild);

  const brushRadiusControl = document.getElementById('brush-radius-control');
  const brushRadiusSlider = document.getElementById('brush-radius-slider');
  const brushRadiusValue = document.getElementById('brush-radius-value');

  function updateBrushUI() {
    const show = currentTool === 'block' || currentTool === 'erase';
    brushRadiusControl.classList.toggle('hidden', !show);
    if (show) { brushRadiusSlider.value = BRUSH_SIZE; brushRadiusValue.textContent = BRUSH_SIZE; }
  }

  brushRadiusSlider.addEventListener('input', () => {
    BRUSH_SIZE = parseInt(brushRadiusSlider.value); brushRadiusValue.textContent = BRUSH_SIZE;
  });

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); currentTool = btn.dataset.tool; updateBrushUI();
    });
  });

  // Speed Controls
  function setSpeed(speed, paused, activeBtn) {
    isPaused = paused; simSpeed = speed;
    document.querySelectorAll('#speed-control button').forEach(b => b.classList.remove('active'));
    document.getElementById(activeBtn).classList.add('active');
  }
  document.getElementById('btn-pause').addEventListener('click', () => setSpeed(0, true, 'btn-pause'));
  document.getElementById('btn-slow').addEventListener('click', () => setSpeed(0.25, false, 'btn-slow'));
  document.getElementById('btn-play').addEventListener('click', () => setSpeed(1, false, 'btn-play'));
  document.getElementById('btn-fast').addEventListener('click', () => setSpeed(3, false, 'btn-fast'));
  document.getElementById('btn-skip').addEventListener('click', () => {
    if (!isPaused && population.length > 0) evalTimer = COF.evalSeconds;
  });
  document.getElementById('btn-reset-gen').addEventListener('click', () => {
    if (population.length > 0) { evalTimer = 0; createPopulation(null); addEventMsg('🔄 世代リセット — 全個体を再配置', '#63d2ff', false); }
  });

  // Stage
  document.querySelectorAll('.stage-btn[data-stage]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stage-btn[data-stage]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const ns = btn.dataset.stage;
      if (ns !== currentStage) {
        currentStage = ns; COF.worldW = BASE_WORLD_WIDTH;
        initWorld(); createPopulation(null); evalTimer = 0; triggerStageFlash();
        const names = { flat:'平地', hills:'丘陵', obstacles:'障害物', random:'ランダム' };
        addEventMsg(`🗺 ステージ変更: ${names[currentStage]}`, '#34d399', false);
      }
    });
  });
  document.getElementById('btn-stage-reset').addEventListener('click', () => {
    COF.worldW = BASE_WORLD_WIDTH; initWorld(); createPopulation(null);
    evalTimer = 0; triggerStageFlash(); addEventMsg('🔄 地形リセット', '#34d399', false);
  });

  // Toggles
  document.getElementById('toggle-muscles').addEventListener('click', e => { showMuscles = !showMuscles; e.target.classList.toggle('active', showMuscles); });
  document.getElementById('toggle-trails').addEventListener('click', e => { showTrails = !showTrails; e.target.classList.toggle('active', showTrails); });
  document.getElementById('toggle-grid').addEventListener('click', e => { showGrid = !showGrid; e.target.classList.toggle('active', showGrid); });
  document.getElementById('toggle-graph').addEventListener('click', e => {
    showGraph = !showGraph; e.target.classList.toggle('active', showGraph);
    document.getElementById('graph-panel').classList.toggle('hidden', !showGraph);
  });
  document.getElementById('toggle-labels').addEventListener('click', e => { showLabels = !showLabels; e.target.classList.toggle('active', showLabels); });

  // ── Brain Mode (vertical full-screen layout) ──
  let expandedSection = null; // null | 'neural' | 'analysis'

  function activateBrainMode() {
    brainMode = true; showNeural = true; showAnalysis = true;
    document.getElementById('app').classList.add('brain-mode');
    document.getElementById('brain-bar').classList.remove('hidden');
    document.getElementById('toggle-brain').classList.add('active');
    // Sync camera buttons
    document.querySelectorAll('.brain-cam').forEach(b => b.classList.toggle('active', b.dataset.cam === cameraMode));
    if (population.length > 0 && focusedIndex < population.length) {
      const b = population[focusedIndex];
      document.getElementById('creature-label-text').textContent = `▼ #${b.id} 観察中`;
    }
    document.getElementById('creature-label').classList.remove('hidden');
    document.getElementById('brain-info-overlay').classList.remove('hidden');
    setTimeout(resizeCanvas, 0);
  }
  function deactivateBrainMode() {
    brainMode = false; showNeural = false; showAnalysis = false;
    expandedSection = null;
    document.getElementById('app').classList.remove('brain-mode');
    document.getElementById('app').classList.remove('expand-neural', 'expand-analysis');
    document.getElementById('brain-bar').classList.add('hidden');
    document.getElementById('creature-label').classList.add('hidden');
    document.getElementById('brain-info-overlay').classList.add('hidden');
    document.getElementById('toggle-brain').classList.remove('active');
    document.querySelectorAll('.section-expand').forEach(b => b.classList.remove('active'));
    setTimeout(resizeCanvas, 0);
  }
  function toggleExpandSection(section) {
    const app = document.getElementById('app');
    if (expandedSection === section) {
      // Collapse back to 3-pane
      expandedSection = null;
      app.classList.remove('expand-neural', 'expand-analysis');
      document.querySelectorAll('.section-expand').forEach(b => b.classList.remove('active'));
    } else {
      expandedSection = section;
      app.classList.remove('expand-neural', 'expand-analysis');
      app.classList.add('expand-' + section);
      document.querySelectorAll('.section-expand').forEach(b => {
        b.classList.toggle('active', b.dataset.section === section);
      });
    }
    setTimeout(resizeCanvas, 0);
  }
  function updateBrainBar() {
    if (!brainMode) return;
    if (population.length === 0 || focusedIndex >= population.length) return;
    const body = population[focusedIndex];
    document.getElementById('brain-creature-id').textContent = `🦠 #${body.id} 観察中`;
    document.getElementById('brain-creature-fit').textContent = `Fit: ${Math.round(body.fitness || 0)}`;
    document.getElementById('creature-label-text').textContent = `▼ #${body.id} 観察中`;
    // Sync stats
    const genEl = document.getElementById('gen-info');
    const bestEl = document.getElementById('best-info');
    if (genEl) document.getElementById('brain-gen').textContent = genEl.textContent;
    if (bestEl) document.getElementById('brain-best').textContent = bestEl.textContent;
    // Update info overlay
    updateBrainInfoOverlay(body);
  }
  function updateBrainInfoOverlay(body) {
    const left = document.getElementById('brain-info-left');
    const right = document.getElementById('brain-info-right');
    if (!left || !right) return;
    const fit = Math.round(body.fitness || 0);
    const grnd = body.nodes.filter(n => n.grounded).length;
    const muscAct = (body.totalMuscleOutput * 100).toFixed(0);
    left.innerHTML = `N:${body.nodes.length} M:${body.muscles.length}<br>接地:${grnd} 筋活:${muscAct}%`;
    // Strategy info if available
    try {
      const profile = computeStrategyProfile(body.brain);
      right.innerHTML = `${profile.strategyType}<br>Fit:${fit}`;
    } catch(e) {
      right.innerHTML = `Fit:${fit}`;
    }
  }

  document.getElementById('toggle-brain').addEventListener('click', () => {
    if (brainMode) deactivateBrainMode(); else activateBrainMode();
  });
  document.getElementById('close-brain-mode').addEventListener('click', deactivateBrainMode);

  // Brain bar camera mode
  document.querySelectorAll('.brain-cam').forEach(btn => {
    btn.addEventListener('click', () => {
      cameraMode = btn.dataset.cam;
      document.querySelectorAll('.brain-cam').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Also sync main cam buttons
      document.querySelectorAll('.cam-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.cam === cameraMode);
      });
    });
  });

  // Section expand buttons
  document.querySelectorAll('.section-expand').forEach(btn => {
    btn.addEventListener('click', () => toggleExpandSection(btn.dataset.section));
  });

  // Brain bar speed controls
  function syncBrainSpeed(speed, paused, activeBrainId) {
    isPaused = paused; simSpeed = speed;
    document.querySelectorAll('.brain-ctrl').forEach(b => b.classList.remove('active'));
    document.getElementById(activeBrainId).classList.add('active');
    document.querySelectorAll('#speed-control button').forEach(b => b.classList.remove('active'));
    if (paused) document.getElementById('btn-pause').classList.add('active');
    else if (speed <= 0.25) document.getElementById('btn-slow').classList.add('active');
    else if (speed >= 3) document.getElementById('btn-fast').classList.add('active');
    else document.getElementById('btn-play').classList.add('active');
  }
  document.getElementById('brain-pause').addEventListener('click', () => syncBrainSpeed(0, true, 'brain-pause'));
  document.getElementById('brain-slow').addEventListener('click', () => syncBrainSpeed(0.25, false, 'brain-slow'));
  document.getElementById('brain-play').addEventListener('click', () => syncBrainSpeed(1, false, 'brain-play'));
  document.getElementById('brain-fast').addEventListener('click', () => syncBrainSpeed(4, false, 'brain-fast'));

  document.getElementById('close-graph').addEventListener('click', () => {
    showGraph = false; document.getElementById('toggle-graph').classList.remove('active');
    document.getElementById('graph-panel').classList.add('hidden');
  });

  // Camera Mode
  document.querySelectorAll('.cam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); cameraMode = btn.dataset.cam;
      // Sync brain-bar cam buttons
      document.querySelectorAll('.brain-cam').forEach(b => b.classList.toggle('active', b.dataset.cam === cameraMode));
    });
  });

  // Fitness Objective
  document.querySelectorAll('.obj-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.obj-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const newObj = btn.dataset.obj;
      if (newObj !== fitnessObjective) {
        fitnessObjective = newObj;
        const names = { 'distance':'移動距離', 'height':'跳躍高', 'goal-speed':'ゴール到達', 'stability':'安定性' };
        addEventMsg(`🎯 学習目標変更: ${names[fitnessObjective]}`, '#a78bfa', false);
      }
    });
  });

  // ─── Config Panel — LIVE TUNING ───────────────────
  document.getElementById('btn-config').addEventListener('click', () => {
    showConfig = !showConfig;
    document.getElementById('config-panel').classList.toggle('hidden', !showConfig);
  });
  document.getElementById('close-config').addEventListener('click', () => {
    showConfig = false; document.getElementById('config-panel').classList.add('hidden');
  });

  function buildConfigPanel() {
    const container = document.getElementById('config-content');
    container.innerHTML = '';
    for (const section of COF_DEFS) {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'config-section';
      const titleEl = document.createElement('div');
      titleEl.className = 'config-section-title';
      titleEl.textContent = section.section;
      titleEl.addEventListener('click', () => sectionEl.classList.toggle('collapsed'));
      sectionEl.appendChild(titleEl);

      const itemsEl = document.createElement('div');
      itemsEl.className = 'config-items';
      for (const item of section.items) {
        const row = document.createElement('div');
        row.className = 'config-row';
        const label = document.createElement('label');
        label.textContent = item.label;
        // LIVE indicator
        if (item.live) {
          const liveSpan = document.createElement('span');
          liveSpan.className = 'config-live-indicator';
          liveSpan.textContent = '● LIVE';
          label.appendChild(liveSpan);
        }
        row.appendChild(label);
        if (item.type === 'range') {
          const wrapper = document.createElement('div');
          wrapper.className = 'config-slider-wrapper';
          const slider = document.createElement('input');
          slider.type = 'range'; slider.min = item.min; slider.max = item.max;
          slider.step = item.step; slider.value = COF[item.key];
          const valueDisplay = document.createElement('span');
          valueDisplay.className = 'config-value'; valueDisplay.textContent = COF[item.key];
          slider.addEventListener('input', () => {
            const oldVal = COF[item.key];
            COF[item.key] = parseFloat(slider.value);
            const decimals = item.step < 0.01 ? 3 : item.step < 0.1 ? 2 : item.step < 1 ? 1 : 0;
            valueDisplay.textContent = parseFloat(slider.value).toFixed(decimals);
            // LIVE feedback
            if (item.live && oldVal !== COF[item.key]) {
              addEventMsg(`⚙ ${item.label}: ${parseFloat(slider.value).toFixed(decimals)} に変更 (即時反映)`, '#818cf8', false, true);
            }
          });
          wrapper.appendChild(slider); wrapper.appendChild(valueDisplay);
          row.appendChild(wrapper);
        }
        itemsEl.appendChild(row);
      }
      sectionEl.appendChild(itemsEl);
      container.appendChild(sectionEl);
    }
  }

  // ─── Info → activate brain mode on creature tap ──
  function showInfoAt(wx, wy) {
    for (let i = 0; i < population.length; i++) {
      const body = population[i];
      const cx2 = body.getCenterX(), cy2 = body.getCenterY();
      if ((wx-cx2)*(wx-cx2)+(wy-cy2)*(wy-cy2) < 2500) {
        focusedIndex = i;
        if (!brainMode) activateBrainMode();
        return;
      }
    }
  }

  // ─── Event Log ────────────────────────────────────
  function addEventMsg(text, color, isRecord, isDiscovery) {
    const log = document.getElementById('event-log');
    const msg = document.createElement('div');
    msg.className = 'event-msg' + (isRecord ? ' record' : '') + (isDiscovery ? ' discovery' : '');
    msg.style.borderColor = color; msg.style.color = color; msg.textContent = text;
    log.appendChild(msg);
    setTimeout(() => { if (msg.parentNode) msg.parentNode.removeChild(msg); }, isRecord ? 4500 : 3500);
    while (log.children.length > 8) log.removeChild(log.firstChild);
  }

  let genFlashTimer = 0;
  function showGenFlash(gen, bestFit, avgFit, isRecord) {
    const el = document.getElementById('gen-flash');
    el.innerHTML = `<div class="gen-title">世代 ${gen}</div>` +
      `<div class="gen-sub">最高 ${Math.round(bestFit)} | 平均 ${Math.round(avgFit)}</div>` +
      (isRecord ? `<div class="gen-record">🏆 新記録！</div>` : '');
    el.classList.add('show'); genFlashTimer = 120;
  }

  function updateRanking() {
    const rankEl = document.getElementById('ranking');
    if (population.length === 0) { rankEl.innerHTML = ''; return; }
    const sorted = population.map((p, i) => ({ idx: i, fit: Math.round(p.fitness || (p.getCenterX() - p.startX)) })).sort((a, b) => b.fit - a.fit);
    const medals = ['🥇', '🥈', '🥉'];
    rankEl.innerHTML = sorted.slice(0, 3).map((s, i) => `<span class="rank-item">${medals[i]} #${s.idx} ${s.fit}</span>`).join('');
  }

  let fpsFrames = 0, fpsTime = 0, currentFps = 0;
  function updateStats(rawDt) {
    fpsFrames++; fpsTime += rawDt;
    if (fpsTime >= 1) {
      currentFps = fpsFrames; fpsFrames = 0; fpsTime = 0;
      document.getElementById('fps-counter').textContent = `FPS: ${currentFps}`;
      updateRanking();
    }
  }

  // ─── World Initialization ─────────────────────────
  function generateFlatTerrain(startCol, endCol) {
    const groundRow = Math.floor(TERRAIN_H * COF.groundLevel);
    for (let y = groundRow; y < TERRAIN_H; y++) for (let x = startCol; x < endCol; x++) terrain[y * TERRAIN_W + x] = TERRAIN_SOLID;
  }

  function generateHillsTerrain(startCol, endCol) {
    generateFlatTerrain(startCol, endCol);
    const groundRow = Math.floor(TERRAIN_H * COF.groundLevel);
    for (let i = 0; i < Math.ceil((endCol - startCol) / 40); i++) {
      const hillCx = startCol + 30 + i * 40 + Math.floor(Math.random() * 20);
      const hillW = 8 + Math.floor(Math.random() * 10), hillH = 2 + Math.floor(Math.random() * 5);
      for (let dx = -hillW; dx <= hillW; dx++) {
        const gx = hillCx + dx; if (gx < startCol || gx >= endCol) continue;
        const h = Math.floor(hillH * Math.max(0, 1 - (dx/hillW)*(dx/hillW)));
        for (let dy = 0; dy < h; dy++) { const gy = groundRow - 1 - dy; if (gy >= 0) terrain[gy * TERRAIN_W + gx] = TERRAIN_SOLID; }
      }
    }
  }

  function generateObstaclesTerrain(startCol, endCol) {
    generateFlatTerrain(startCol, endCol);
    const groundRow = Math.floor(TERRAIN_H * COF.groundLevel), span = endCol - startCol;
    for (let i = 0; i < Math.ceil(span/60); i++) {
      const sx = startCol + 20 + i * 60, sw = 4 + Math.floor(Math.random() * 4), sh = 2 + Math.floor(Math.random() * 3);
      for (let dx = 0; dx < sw; dx++) for (let dy = 0; dy < sh; dy++) {
        const gx = sx + dx, gy = groundRow - 1 - dy;
        if (gx >= startCol && gx < endCol && gy >= 0) terrain[gy * TERRAIN_W + gx] = TERRAIN_SOLID;
      }
    }
    for (let i = 0; i < Math.ceil(span/120); i++) {
      const wx = startCol + 80 + i * 120, wh = 4 + Math.floor(Math.random() * 4);
      for (let dy = 0; dy < wh; dy++) { const gy = groundRow - 1 - dy; if (wx >= startCol && wx < endCol && gy >= 0) terrain[gy * TERRAIN_W + wx] = TERRAIN_SOLID; }
    }
    for (let i = 0; i < Math.ceil(span/100); i++) {
      const gapX = startCol + 50 + i * 100, gapW = 2 + Math.floor(Math.random() * 3);
      for (let dx = 0; dx < gapW; dx++) {
        const gx = gapX + dx;
        if (gx >= startCol && gx < endCol) { terrain[groundRow * TERRAIN_W + gx] = TERRAIN_EMPTY; if (groundRow + 1 < TERRAIN_H) terrain[(groundRow + 1) * TERRAIN_W + gx] = TERRAIN_EMPTY; }
      }
    }
  }

  function generateRandomTerrain(startCol, endCol) {
    const fns = [generateFlatTerrain, generateHillsTerrain, generateObstaclesTerrain];
    for (let x = startCol; x < endCol; x += 30) fns[Math.floor(Math.random() * fns.length)](x, Math.min(x + 30, endCol));
  }

  function generateTerrainForStage(stage, startCol, endCol) {
    switch (stage) {
      case 'flat': generateFlatTerrain(startCol, endCol); break;
      case 'hills': generateHillsTerrain(startCol, endCol); break;
      case 'obstacles': generateObstaclesTerrain(startCol, endCol); break;
      case 'random': generateRandomTerrain(startCol, endCol); break;
      default: generateFlatTerrain(startCol, endCol);
    }
  }

  function expandWorld() {
    const oldW = TERRAIN_W;
    COF.worldW += WORLD_EXPAND_INCREMENT;
    const newTW = (COF.worldW / COF.cellSize) | 0;
    const newTerrain = new Uint8Array(newTW * TERRAIN_H);
    for (let y = 0; y < TERRAIN_H; y++) for (let x = 0; x < oldW; x++) newTerrain[y * newTW + x] = terrain[y * oldW + x];
    terrain = newTerrain; TERRAIN_W = newTW; TERRAIN_CELLS = newTW * TERRAIN_H;
    generateTerrainForStage(currentStage, oldW, newTW);
    for (let x = oldW; x < newTW; x++) { newTerrain[x] = TERRAIN_SOLID; newTerrain[(TERRAIN_H - 1) * newTW + x] = TERRAIN_SOLID; }
    initTerrainCanvas(); terrainDirty = true;
  }

  function triggerStageFlash() {
    const el = document.getElementById('stage-flash'); if (!el) return;
    el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 200);
  }

  function initWorld() {
    initTerrainGrid(); initTerrainCanvas();
    generateTerrainForStage(currentStage, 0, TERRAIN_W);
    for (let x = 0; x < TERRAIN_W; x++) { terrain[x] = TERRAIN_SOLID; terrain[(TERRAIN_H - 1) * TERRAIN_W + x] = TERRAIN_SOLID; }
    for (let y = 0; y < TERRAIN_H; y++) terrain[y * TERRAIN_W] = TERRAIN_SOLID;
    terrainDirty = true;
  }

  // ═══════════════════════════════════════════════════
  //  MAIN LOOP — optimized RAF with separated logic
  // ═══════════════════════════════════════════════════
  let lastTime = 0;
  let simTime = 0;
  // Accumulator for fixed-step physics
  let physicsAccum = 0;
  const PHYSICS_DT = 1 / 60; // fixed 60Hz physics

  function mainLoop(timestamp) {
    requestAnimationFrame(mainLoop);

    const rawDt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    if (currentPhase === PHASE_BUILD) {
      renderBuildPhase();
      return;
    }

    // ─── SIM PHASE ──────────────────────────────
    updateStats(rawDt);

    if (genFlashTimer > 0) {
      genFlashTimer--;
      document.getElementById('gen-flash').style.opacity = Math.min(1, genFlashTimer / 30);
      if (genFlashTimer <= 0) document.getElementById('gen-flash').classList.remove('show');
    }

    if (!isPaused) {
      const dt = rawDt * simSpeed;
      simTime += dt;
      evalTimer += dt;

      const progress = Math.min(100, (evalTimer / COF.evalSeconds) * 100);
      document.getElementById('eval-fill').style.width = `${progress}%`;
      document.getElementById('eval-timer').textContent = `⏱ ${evalTimer.toFixed(1)} / ${COF.evalSeconds.toFixed(1)}s`;

      // Fixed-step physics with accumulator
      physicsAccum += dt;
      const maxSteps = simSpeed >= 3 ? 4 : simSpeed <= 0.25 ? 1 : 2;
      let steps = 0;
      while (physicsAccum >= PHYSICS_DT && steps < maxSteps) {
        for (const body of population) body.updateBrain(simTime);
        physicStep();
        physicsAccum -= PHYSICS_DT;
        steps++;
      }
      if (physicsAccum > PHYSICS_DT * maxSteps) physicsAccum = 0; // prevent spiral

      // Update fitness for all creatures (live)
      let bestIdx = 0, bestFit = -Infinity;
      for (let i = 0; i < population.length; i++) {
        const f = calcFitnessForBody(population[i]);
        if (f > bestFit) { bestFit = f; bestIdx = i; }
      }
      if (cameraMode === 'follow') focusedIndex = bestIdx;

      updateCamera();

      // Live commentary
      generateLiveCommentary();

      if (evalTimer >= COF.evalSeconds) evolve();
    }

    // ─── RENDER (always runs, even when paused) ─────
    renderSimPhase(simTime);
    renderGraph();
    renderNeuralMonitor();
    renderBrainAnalysis();
    updateBrainBar();
  }

  // ═══════════════════════════════════════════════════
  //  BOOT
  // ═══════════════════════════════════════════════════
  window.addEventListener('resize', resizeCanvas);
  initTerrainGrid(); initTerrainCanvas();
  resizeCanvas(); buildConfigPanel(); updateBuildInfo();
  presetBlob();
  lastTime = performance.now();
  requestAnimationFrame(mainLoop);

})();
