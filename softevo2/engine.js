/* =====================================================
   SoftEvo2 — 次世代軟体生物進化シミュレータ
   ─────────────────────────────────────────────────────
   ゼロ依存: 自作 Verlet 物理 + 自作ニューラルネット
   新機能:
     1. 生物作成フェーズ（インタラクティブビルダー）
     2. 学習目標の動的変更
     3. フリーカメラモード
   ===================================================== */

(function () {
  'use strict';

  // ─── Game Phase ───────────────────────────────────
  const PHASE_BUILD = 'build';
  const PHASE_SIM = 'sim';
  let currentPhase = PHASE_BUILD;

  // ─── Configurable Parameters ──────────────────────
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
      { key: 'population', label: '個体数', type: 'range', min: 5, max: 50, step: 1 },
      { key: 'evalSeconds', label: '評価時間(秒)', type: 'range', min: 3, max: 30, step: 1 },
      { key: 'eliteRatio', label: 'エリート率', type: 'range', min: 0.1, max: 0.6, step: 0.05 },
    ]},
    { section: '変異 (Mutation)', items: [
      { key: 'mutationRate', label: '変異確率', type: 'range', min: 0, max: 0.5, step: 0.01 },
      { key: 'mutationStrength', label: '変異強度', type: 'range', min: 0.01, max: 1.0, step: 0.01 },
    ]},
    { section: '物理 (Physics)', items: [
      { key: 'gravity', label: '重力', type: 'range', min: 0, max: 1.5, step: 0.05 },
      { key: 'airDrag', label: '空気抵抗(減衰)', type: 'range', min: 0.9, max: 1.0, step: 0.005 },
      { key: 'groundFriction', label: '地面摩擦', type: 'range', min: 0.1, max: 1.0, step: 0.05 },
      { key: 'bounce', label: '反発係数', type: 'range', min: 0, max: 0.8, step: 0.05 },
      { key: 'constraintIter', label: '制約反復回数', type: 'range', min: 1, max: 12, step: 1 },
      { key: 'boneStiffness', label: '骨剛性', type: 'range', min: 0.1, max: 1.0, step: 0.05 },
      { key: 'muscleStiffness', label: '筋肉剛性', type: 'range', min: 0.05, max: 0.8, step: 0.05 },
    ]},
    { section: 'ニューラルネット (NN)', items: [
      { key: 'hiddenSize1', label: '隠れ層1', type: 'range', min: 4, max: 32, step: 2 },
      { key: 'hiddenSize2', label: '隠れ層2', type: 'range', min: 4, max: 24, step: 2 },
    ]},
    { section: 'ゴール (Goal)', items: [
      { key: 'goalBonus', label: 'ゴールボーナス', type: 'range', min: 10, max: 500, step: 10 },
      { key: 'goalRadius', label: 'ゴール到達半径', type: 'range', min: 10, max: 80, step: 5 },
    ]},
  ];

  // ─── Constants ────────────────────────────────────
  const TERRAIN_EMPTY = 0;
  const TERRAIN_SOLID = 1;
  const MIN_ZOOM = 0.15;
  const MAX_ZOOM = 6;

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

  // ─── Neural Network ──────────────────────────────
  class NeuralNet {
    constructor(layerSizes) {
      this.layers = layerSizes;
      this.weights = [];
      this.biases = [];
      for (let i = 1; i < layerSizes.length; i++) {
        const inSz = layerSizes[i - 1];
        const outSz = layerSizes[i];
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
        for (let j = 0; j < layerA.length; j++) {
          child[j] = Math.random() < 0.5 ? layerA[j] : layerB[j];
        }
        return child;
      }),
      biases: gA.biases.map((layerA, i) => {
        const layerB = gB.biases[i];
        const child = new Float32Array(layerA.length);
        for (let j = 0; j < layerA.length; j++) {
          child[j] = Math.random() < 0.5 ? layerA[j] : layerB[j];
        }
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
  const blueprint = {
    nodes: [],    // { x, y, radius }
    bones: [],    // { a, b }  (indices into nodes)
    muscles: [],  // { a, b }  (indices into nodes)
  };

  let buildTool = 'add-node';
  let buildSelectedNode = -1;  // for bone/muscle connection
  let buildDragNode = -1;      // for move-node tool

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
    if (btn) {
      btn.disabled = !isValidBlueprint();
    }

    updateBuildHint();
  }

  function updateBuildHint() {
    const hint = document.getElementById('build-hint');
    if (!hint) return;
    const msgs = {
      'add-node': 'キャンバスをタップしてノードを配置',
      'add-bone': buildSelectedNode >= 0 ? '2つ目のノードをタップして接続' : 'ノードをタップして骨格を開始',
      'add-muscle': buildSelectedNode >= 0 ? '2つ目のノードをタップして筋肉接続' : 'ノードをタップして筋肉を開始',
      'move-node': 'ノードをドラッグして移動',
      'resize-node': 'ノードをタップしてサイズ変更（タップで切替）',
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
    return list.some(c =>
      (c.a === a && c.b === b) || (c.a === b && c.b === a)
    );
  }

  // ─── Presets ──────────────────────────────────────
  function presetBiped() {
    clearBlueprint();
    const cx = 200, cy = 350;
    // Body core (4 nodes rectangle)
    blueprint.nodes.push({ x: cx - 12, y: cy - 20, radius: 7 });  // 0 top-left
    blueprint.nodes.push({ x: cx + 12, y: cy - 20, radius: 7 });  // 1 top-right
    blueprint.nodes.push({ x: cx + 12, y: cy + 5,  radius: 7 });  // 2 mid-right
    blueprint.nodes.push({ x: cx - 12, y: cy + 5,  radius: 7 });  // 3 mid-left
    // Legs
    blueprint.nodes.push({ x: cx - 15, y: cy + 35, radius: 6 });  // 4 left knee
    blueprint.nodes.push({ x: cx + 15, y: cy + 35, radius: 6 });  // 5 right knee
    blueprint.nodes.push({ x: cx - 18, y: cy + 60, radius: 8 });  // 6 left foot
    blueprint.nodes.push({ x: cx + 18, y: cy + 60, radius: 8 });  // 7 right foot

    // Bones (skeleton)
    blueprint.bones.push({ a: 0, b: 1 });
    blueprint.bones.push({ a: 1, b: 2 });
    blueprint.bones.push({ a: 2, b: 3 });
    blueprint.bones.push({ a: 3, b: 0 });
    blueprint.bones.push({ a: 3, b: 4 });
    blueprint.bones.push({ a: 2, b: 5 });
    blueprint.bones.push({ a: 4, b: 6 });
    blueprint.bones.push({ a: 5, b: 7 });

    // Muscles (actuation)
    blueprint.muscles.push({ a: 0, b: 2 }); // diagonal
    blueprint.muscles.push({ a: 1, b: 3 }); // diagonal
    blueprint.muscles.push({ a: 3, b: 6 }); // left leg full
    blueprint.muscles.push({ a: 2, b: 7 }); // right leg full
    blueprint.muscles.push({ a: 4, b: 5 }); // knee cross
    blueprint.muscles.push({ a: 6, b: 7 }); // feet cross

    updateBuildInfo();
  }

  function presetSnake() {
    clearBlueprint();
    const startX = 120, cy = 380;
    const seg = 7;
    for (let i = 0; i < seg; i++) {
      blueprint.nodes.push({ x: startX + i * 22, y: cy, radius: 6 + (i === 0 ? 2 : 0) });
    }
    for (let i = 0; i < seg - 1; i++) {
      blueprint.bones.push({ a: i, b: i + 1 });
    }
    for (let i = 0; i < seg - 2; i++) {
      blueprint.muscles.push({ a: i, b: i + 2 });
    }
    updateBuildInfo();
  }

  function presetSpider() {
    clearBlueprint();
    const cx = 200, cy = 360;
    // Center body (2 nodes)
    blueprint.nodes.push({ x: cx, y: cy, radius: 9 });       // 0 body
    blueprint.nodes.push({ x: cx + 20, y: cy, radius: 7 });   // 1 head
    // Legs (4 pairs)
    const legAngles = [-0.8, -0.3, 0.3, 0.8];
    let idx = 2;
    for (const angle of legAngles) {
      const lx = cx + Math.cos(Math.PI / 2 + angle) * 25;
      const ly = cy + Math.sin(Math.PI / 2 + angle) * 25;
      const fx = cx + Math.cos(Math.PI / 2 + angle) * 50;
      const fy = cy + Math.sin(Math.PI / 2 + angle) * 50;
      blueprint.nodes.push({ x: lx, y: ly, radius: 5 });  // knee
      blueprint.nodes.push({ x: fx, y: fy, radius: 6 });  // foot
      // Mirror side
      const mx = cx - Math.cos(Math.PI / 2 + angle) * 25;
      const my = cy + Math.sin(Math.PI / 2 + angle) * 25;
      const mfx = cx - Math.cos(Math.PI / 2 + angle) * 50;
      const mfy = cy + Math.sin(Math.PI / 2 + angle) * 50;
      blueprint.nodes.push({ x: mx, y: my, radius: 5 });
      blueprint.nodes.push({ x: mfx, y: mfy, radius: 6 });
      idx += 4;
    }
    // Bone: body-head
    blueprint.bones.push({ a: 0, b: 1 });
    // Bones for legs
    for (let i = 0; i < 4; i++) {
      const base = 2 + i * 4;
      blueprint.bones.push({ a: 0, b: base });
      blueprint.bones.push({ a: base, b: base + 1 });
      blueprint.bones.push({ a: 0, b: base + 2 });
      blueprint.bones.push({ a: base + 2, b: base + 3 });
    }
    // Muscles for legs
    for (let i = 0; i < 4; i++) {
      const base = 2 + i * 4;
      blueprint.muscles.push({ a: 0, b: base + 1 });
      blueprint.muscles.push({ a: 0, b: base + 3 });
      blueprint.muscles.push({ a: base + 1, b: base + 3 });
    }
    updateBuildInfo();
  }

  function presetBlob() {
    clearBlueprint();
    const cx = 200, cy = 370;
    const nc = 6;
    for (let i = 0; i < nc; i++) {
      const angle = (Math.PI * 2 * i) / nc;
      blueprint.nodes.push({
        x: cx + Math.cos(angle) * 25,
        y: cy + Math.sin(angle) * 15,
        radius: 5 + Math.random() * 4,
      });
    }
    for (let i = 0; i < nc; i++) {
      blueprint.bones.push({ a: i, b: (i + 1) % nc });
    }
    const muscleSet = new Set();
    for (let i = 0; i < nc; i++) {
      const j = (i + 2) % nc;
      const key = Math.min(i, j) + '-' + Math.max(i, j);
      if (!muscleSet.has(key)) {
        muscleSet.add(key);
        blueprint.muscles.push({ a: i, b: j });
      }
    }
    for (let i = 0; i < nc; i++) {
      const j = (i + Math.floor(nc / 2)) % nc;
      const key = Math.min(i, j) + '-' + Math.max(i, j);
      if (!muscleSet.has(key)) {
        muscleSet.add(key);
        blueprint.muscles.push({ a: i, b: j });
      }
    }
    updateBuildInfo();
  }

  // ═══════════════════════════════════════════════════
  //  FITNESS OBJECTIVES
  // ═══════════════════════════════════════════════════
  let fitnessObjective = 'distance'; // 'distance', 'height', 'goal-speed', 'stability'

  function calcFitnessForBody(body) {
    const cx = body.getCenterX();
    const cy = body.getCenterY();
    let fit = 0;

    switch (fitnessObjective) {
      case 'distance':
        fit = cx - body.startX;
        break;

      case 'height': {
        // Reward maximum height achieved (lower Y = higher)
        const groundY = Math.floor(TERRAIN_H * COF.groundLevel) * COF.cellSize;
        fit = (groundY - body.minY) * 2;
        if (fit < 0) fit = 0;
        break;
      }

      case 'goal-speed': {
        // Speed to nearest goal
        if (goals.length > 0) {
          let minDist = Infinity;
          for (const g of goals) {
            const dx = cx - g.x, dy = cy - g.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) minDist = d;
          }
          // Inverse distance: closer = more fitness
          fit = Math.max(0, 1000 - minDist);
          // Bonus for reaching goal
          const gr2 = COF.goalRadius * COF.goalRadius;
          for (const g of goals) {
            const dx = cx - g.x, dy = cy - g.y;
            if (dx * dx + dy * dy < gr2) fit += COF.goalBonus;
          }
        } else {
          fit = cx - body.startX; // fallback to distance
        }
        break;
      }

      case 'stability': {
        // Reward upright posture and minimal Y-oscillation
        const groundY = Math.floor(TERRAIN_H * COF.groundLevel) * COF.cellSize;
        const upright = Math.max(0, groundY - cy);
        const horizontalDist = cx - body.startX;
        // Penalize large vertical variance
        let yVar = 0;
        for (const n of body.nodes) {
          yVar += (n.y - cy) * (n.y - cy);
        }
        yVar = Math.sqrt(yVar / body.nodes.length);
        fit = upright * 0.5 + horizontalDist * 0.3 + Math.max(0, 50 - yVar) * 2;
        break;
      }
    }

    // Always add goal bonus for any objective
    if (fitnessObjective !== 'goal-speed') {
      const gr2 = COF.goalRadius * COF.goalRadius;
      for (const g of goals) {
        const dx = cx - g.x, dy = cy - g.y;
        if (dx * dx + dy * dy < gr2) fit += COF.goalBonus;
      }
    }

    body.fitness = fit;
    return fit;
  }

  // ─── Goals ────────────────────────────────────────
  const goals = [];
  let goalIdCounter = 0;

  function createGoal(x, y) {
    goals.push({ id: goalIdCounter++, x, y });
  }

  function deleteGoalNear(x, y) {
    const r2 = 25 * 25;
    for (let i = goals.length - 1; i >= 0; i--) {
      const g = goals[i];
      const dx = g.x - x, dy = g.y - y;
      if (dx * dx + dy * dy < r2) { goals.splice(i, 1); return true; }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════
  //  SOFT BODY (Creature) — built from blueprint
  // ═══════════════════════════════════════════════════
  let bodyIdCounter = 0;

  class SoftBody {
    constructor(x, y, bp, genome) {
      this.id = bodyIdCounter++;
      this.startX = x;
      this.startY = y;
      this.fitness = 0;
      this.alive = true;
      this.minY = y; // track minimum Y for height objective

      const nc = bp.nodes.length;

      // Create nodes from blueprint (offset to spawn position)
      // Compute blueprint center
      let bpCx = 0, bpCy = 0;
      for (const n of bp.nodes) { bpCx += n.x; bpCy += n.y; }
      bpCx /= nc; bpCy /= nc;

      this.nodes = [];
      for (let i = 0; i < nc; i++) {
        const n = bp.nodes[i];
        const nx = x + (n.x - bpCx);
        const ny = y + (n.y - bpCy);
        this.nodes.push({
          x: nx, y: ny, ox: nx, oy: ny,
          radius: n.radius, mass: 1, grounded: false,
        });
      }

      // Bones from blueprint
      this.bones = [];
      for (const b of bp.bones) {
        const na = this.nodes[b.a], nb = this.nodes[b.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        this.bones.push({
          a: b.a, b: b.b,
          restLength: Math.sqrt(dx * dx + dy * dy),
          stiffness: COF.boneStiffness,
        });
      }

      // Muscles from blueprint
      this.muscles = [];
      this.muscleAct = [];
      for (const m of bp.muscles) {
        const na = this.nodes[m.a], nb = this.nodes[m.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const rl = Math.sqrt(dx * dx + dy * dy);
        this.muscles.push({
          a: m.a, b: m.b,
          restLength: rl,
          currentTarget: rl,
          stiffness: COF.muscleStiffness,
        });
        this.muscleAct.push(0.5);
      }

      // Neural network
      const muscleCount = this.muscles.length;
      const inputSize = nc * 2 + muscleCount + nc + 1; // velocities + muscle ratios + grounded + rhythm
      this.brain = new NeuralNet([
        inputSize, COF.hiddenSize1, COF.hiddenSize2, muscleCount
      ]);

      if (genome) {
        this.brain.setGenome(genome);
      }

      this.trail = [];
    }

    getInputs(time) {
      const inputs = [];
      for (const n of this.nodes) {
        inputs.push((n.x - n.ox) * 0.1);
        inputs.push((n.y - n.oy) * 0.1);
      }
      for (const m of this.muscles) {
        const na = this.nodes[m.a], nb = this.nodes[m.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        inputs.push(len / (m.restLength + 0.001) - 1.0);
      }
      for (const n of this.nodes) {
        inputs.push(n.grounded ? 1.0 : 0.0);
      }
      inputs.push(Math.sin(time * 5));
      return inputs;
    }

    updateBrain(time) {
      const inputs = this.getInputs(time);
      const outputs = this.brain.predict(inputs);
      for (let i = 0; i < this.muscles.length; i++) {
        const act = outputs[i] !== undefined ? outputs[i] : 0.5;
        this.muscleAct[i] = act;
        this.muscles[i].currentTarget = this.muscles[i].restLength * (0.4 + 0.6 * act);
      }
    }

    getCenterX() {
      let s = 0;
      for (const n of this.nodes) s += n.x;
      return s / this.nodes.length;
    }

    getCenterY() {
      let s = 0;
      for (const n of this.nodes) s += n.y;
      return s / this.nodes.length;
    }

    calcFitness() {
      return calcFitnessForBody(this);
    }

    getColor() {
      const maxFit = Math.max(bestEverFitness, 80);
      const rawFit = this.fitness || (this.getCenterX() - this.startX);
      const t = Math.min(1, Math.max(0, rawFit / maxFit));
      const r = Math.floor(100 + 155 * t);
      const g = Math.floor(80 + 140 * t);
      const b = Math.floor(240 * (1 - t) + 50 * t);
      return [r, g, b];
    }
  }

  // ─── Population Management ────────────────────────
  let population = [];
  let generation = 0;
  let evalTimer = 0;
  let bestEverFitness = 0;
  let bestEverGen = 0;
  let focusedIndex = 0;

  function getSpawnY() {
    const groundRow = Math.floor(TERRAIN_H * COF.groundLevel);
    return groundRow * COF.cellSize - 50;
  }

  function createPopulation(genomes) {
    population = [];
    const spacing = 120;
    const startX = 200;
    const sy = getSpawnY();
    for (let i = 0; i < COF.population; i++) {
      const x = startX + i * spacing;
      const g = genomes ? genomes[i] : null;
      population.push(new SoftBody(x, sy, blueprint, g));
    }
    focusedIndex = 0;
  }

  function clearPopulation() {
    population = [];
  }

  // ─── Fitness History ──────────────────────────────
  const HISTORY_MAX = 200;
  const historyBest = [];
  const historyAvg = [];

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
    if (isRecord) {
      bestEverFitness = bestFit;
      bestEverGen = generation;
    }

    historyBest.push(bestFit);
    historyAvg.push(avgFit);
    if (historyBest.length > HISTORY_MAX) { historyBest.shift(); historyAvg.shift(); }

    const eliteGenomes = eliteIdx.map(i => population[i].brain.getGenome());

    const newGenomes = [];
    for (let i = 0; i < COF.population; i++) {
      if (i < eliteCount) {
        newGenomes.push(eliteGenomes[i]);
      } else {
        const pA = eliteGenomes[Math.floor(Math.random() * eliteCount)];
        const pB = eliteGenomes[Math.floor(Math.random() * eliteCount)];
        newGenomes.push(mutateGenome(
          crossoverGenome(pA, pB),
          COF.mutationRate,
          COF.mutationStrength
        ));
      }
    }

    clearPopulation();
    createPopulation(newGenomes);

    generation++;
    evalTimer = 0;

    const objNames = {
      'distance': '移動距離',
      'height': '跳躍高',
      'goal-speed': 'ゴール到達',
      'stability': '安定性'
    };
    const objLabel = objNames[fitnessObjective] || '適応度';

    document.getElementById('gen-info').textContent = `🧬 世代 ${generation}`;
    document.getElementById('best-info').textContent = `🏆 ${Math.round(bestFit)}`;
    document.getElementById('avg-info').textContent = `📊 ${Math.round(avgFit)}`;

    showGenFlash(generation, bestFit, avgFit, isRecord);
    addEventMsg(`🧬 世代 ${generation} | 最高 ${Math.round(bestFit)} | 平均 ${Math.round(avgFit)}`,
      '#818cf8', false);
    if (isRecord) {
      addEventMsg(`🏆 新記録！ ${Math.round(bestFit)} (世代 ${generation})`, '#fbbf24', true);
    }
  }

  // ─── Physics (Verlet Integration) ─────────────────
  function physicStep() {
    for (const body of population) {
      for (const n of body.nodes) {
        const vx = (n.x - n.ox) * COF.airDrag;
        const vy = (n.y - n.oy) * COF.airDrag;
        n.ox = n.x;
        n.oy = n.y;
        n.x += vx;
        n.y += vy + COF.gravity;
        n.grounded = false;
      }

      for (let iter = 0; iter < COF.constraintIter; iter++) {
        for (const c of body.bones) {
          solveConstraint(body.nodes[c.a], body.nodes[c.b], c.restLength, c.stiffness);
        }
        for (const m of body.muscles) {
          solveConstraint(body.nodes[m.a], body.nodes[m.b], m.currentTarget, m.stiffness);
        }
        for (const n of body.nodes) {
          collideWithTerrain(n);
          constrainToWorld(n);
        }
      }

      // Track minimum Y for height fitness
      const cy = body.getCenterY();
      if (cy < body.minY) body.minY = cy;

      body.trail.push({ x: body.getCenterX(), y: cy });
      if (body.trail.length > COF.trailLen) body.trail.shift();
    }
  }

  function solveConstraint(a, b, targetLen, stiffness) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.001) return;
    const diff = (targetLen - dist) / dist * stiffness * 0.5;
    const mx = dx * diff;
    const my = dy * diff;
    const totalMass = a.mass + b.mass;
    const ra = b.mass / totalMass;
    const rb = a.mass / totalMass;
    a.x -= mx * ra;
    a.y -= my * ra;
    b.x += mx * rb;
    b.y += my * rb;
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
        const cx1 = gx * COF.cellSize;
        const cy1 = gy * COF.cellSize;
        const cx2 = cx1 + COF.cellSize;
        const cy2 = cy1 + COF.cellSize;

        const nearX = Math.max(cx1, Math.min(node.x, cx2));
        const nearY = Math.max(cy1, Math.min(node.y, cy2));
        const dx = node.x - nearX;
        const dy = node.y - nearY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < r) {
          if (dist > 0.001) {
            const overlap = r - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            node.x += nx * overlap;
            node.y += ny * overlap;
            const vx = node.x - node.ox;
            const vy = node.y - node.oy;
            const vn = vx * nx + vy * ny;
            if (vn < 0) {
              const vnx = nx * vn;
              const vny = ny * vn;
              const vtx = vx - vnx;
              const vty = vy - vny;
              node.ox = node.x - (-vnx * COF.bounce + vtx * COF.groundFriction);
              node.oy = node.y - (-vny * COF.bounce + vty * COF.groundFriction);
            }
            node.grounded = true;
          } else {
            const dl = node.x - cx1;
            const dr = cx2 - node.x;
            const dt = node.y - cy1;
            const db = cy2 - node.y;
            const mn = Math.min(dl, dr, dt, db);
            if (mn === dl) node.x = cx1 - r;
            else if (mn === dr) node.x = cx2 + r;
            else if (mn === dt) node.y = cy1 - r;
            else node.y = cy2 + r;
            node.ox = node.x;
            node.oy = node.y;
            node.grounded = true;
          }
        }
      }
    }
  }

  function constrainToWorld(node) {
    const r = node.radius;
    if (node.x - r < 0) { node.x = r; node.ox = node.x; }
    if (node.x + r > COF.worldW) { node.x = COF.worldW - r; node.ox = node.x; }
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

  // Camera mode
  let cameraMode = 'follow'; // 'follow' or 'free'

  let terrainCanvas, terrainCtx, terrainImageData;

  function initTerrainCanvas() {
    terrainCanvas = document.createElement('canvas');
    terrainCanvas.width = TERRAIN_W;
    terrainCanvas.height = TERRAIN_H;
    terrainCtx = terrainCanvas.getContext('2d');
    terrainImageData = terrainCtx.createImageData(TERRAIN_W, TERRAIN_H);
  }

  function resizeCanvas() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    if (currentPhase === PHASE_BUILD) {
      // Center on build area
      const scaleX = window.innerWidth / 400;
      const scaleY = window.innerHeight / 500;
      targetCamZoom = Math.min(scaleX, scaleY) * 0.8;
      targetCamX = window.innerWidth / 2 - 200 * targetCamZoom;
      targetCamY = window.innerHeight / 2 - 350 * targetCamZoom;
    } else {
      const scaleX = window.innerWidth / COF.worldW;
      const scaleY = window.innerHeight / COF.worldH;
      targetCamZoom = Math.min(scaleX, scaleY);
      targetCamX = (window.innerWidth - COF.worldW * targetCamZoom) / 2;
      targetCamY = (window.innerHeight - COF.worldH * targetCamZoom) / 2;
    }
  }

  function renderTerrain() {
    if (!terrainDirty) return;
    terrainDirty = false;
    const data = terrainImageData.data;
    for (let y = 0; y < TERRAIN_H; y++) {
      for (let x = 0; x < TERRAIN_W; x++) {
        const idx = y * TERRAIN_W + x;
        const pi = idx * 4;
        if (terrain[idx] === TERRAIN_SOLID) {
          const above = y > 0 ? terrain[(y - 1) * TERRAIN_W + x] : TERRAIN_EMPTY;
          if (above !== TERRAIN_SOLID) {
            data[pi] = 50; data[pi + 1] = 65; data[pi + 2] = 95; data[pi + 3] = 255;
          } else {
            const noise = ((x * 17 + y * 31) % 8) - 4;
            data[pi] = 22 + noise; data[pi + 1] = 28 + noise; data[pi + 2] = 42 + noise; data[pi + 3] = 255;
          }
        } else {
          data[pi] = 0; data[pi + 1] = 0; data[pi + 2] = 0; data[pi + 3] = 0;
        }
      }
    }
    terrainCtx.putImageData(terrainImageData, 0, 0);
  }

  // ─── Build Phase Rendering ────────────────────────
  function renderBuildPhase() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#060c1a');
    grad.addColorStop(0.5, '#060a14');
    grad.addColorStop(1, '#040810');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Smooth camera
    camX += (targetCamX - camX) * 0.1;
    camY += (targetCamY - camY) * 0.1;
    camZoom += (targetCamZoom - camZoom) * 0.1;

    ctx.save();
    ctx.translate(camX, camY);
    ctx.scale(camZoom, camZoom);

    // Draw build grid
    ctx.strokeStyle = 'rgba(99, 210, 255, 0.04)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= 400; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 600); ctx.stroke();
    }
    for (let y = 0; y <= 600; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(400, y); ctx.stroke();
    }

    // Ground line preview
    const groundY = Math.floor(TERRAIN_H * COF.groundLevel) * COF.cellSize;
    ctx.strokeStyle = 'rgba(99, 210, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(400, groundY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(99, 210, 255, 0.3)';
    ctx.font = '10px sans-serif';
    ctx.fillText('地面', 5, groundY - 5);

    // Draw bones
    for (const b of blueprint.bones) {
      const na = blueprint.nodes[b.a], nb = blueprint.nodes[b.b];
      ctx.strokeStyle = 'rgba(200, 210, 230, 0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.stroke();
    }

    // Draw muscles
    for (const m of blueprint.muscles) {
      const na = blueprint.nodes[m.a], nb = blueprint.nodes[m.b];
      ctx.strokeStyle = 'rgba(255, 100, 100, 0.5)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw connection in progress
    if (buildSelectedNode >= 0 && (buildTool === 'add-bone' || buildTool === 'add-muscle')) {
      const n = blueprint.nodes[buildSelectedNode];
      ctx.strokeStyle = buildTool === 'add-bone' ?
        'rgba(200, 210, 230, 0.3)' : 'rgba(255, 100, 100, 0.3)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw nodes
    for (let i = 0; i < blueprint.nodes.length; i++) {
      const n = blueprint.nodes[i];
      const isSelected = (i === buildSelectedNode);

      // Glow for selected
      if (isSelected) {
        ctx.fillStyle = 'rgba(99, 210, 255, 0.15)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 10, 0, Math.PI * 2);
        ctx.fill();
      }

      // Node body
      ctx.fillStyle = isSelected ? 'rgba(99, 210, 255, 0.8)' : 'rgba(129, 200, 248, 0.6)';
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isSelected ? 'rgba(99, 210, 255, 0.9)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Index label
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(i), n.x, n.y + 3);
    }

    ctx.restore();
  }

  // ─── Sim Phase Rendering ──────────────────────────
  function renderSimPhase(simTime) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#060c1a');
    grad.addColorStop(0.5, '#060a14');
    grad.addColorStop(1, '#040810');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    camX += (targetCamX - camX) * COF.cameraSpeed;
    camY += (targetCamY - camY) * COF.cameraSpeed;
    camZoom += (targetCamZoom - camZoom) * COF.cameraSpeed;

    ctx.save();
    ctx.translate(camX, camY);
    ctx.scale(camZoom, camZoom);

    // Terrain
    renderTerrain();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainCanvas, 0, 0, COF.worldW, COF.worldH);

    // Grid
    if (showGrid) {
      ctx.strokeStyle = 'rgba(129,140,248,0.06)';
      ctx.lineWidth = 0.5;
      const step = COF.cellSize * 5;
      for (let x = 0; x <= COF.worldW; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, COF.worldH); ctx.stroke();
      }
      for (let y = 0; y <= COF.worldH; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(COF.worldW, y); ctx.stroke();
      }
    }

    // Goals
    for (const g of goals) {
      const pulse = 0.6 + 0.4 * Math.sin(simTime * 4 + g.id);
      ctx.strokeStyle = `rgba(251,191,36,${pulse * 0.7})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(g.x, g.y, COF.goalRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(251,191,36,${pulse * 0.15})`;
      ctx.fill();
      ctx.fillStyle = `rgba(251,191,36,${pulse})`;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎯', g.x, g.y + 5);
    }

    // Trails
    if (showTrails) {
      for (const body of population) {
        if (body.trail.length < 2) continue;
        const c = body.getColor();
        for (let t = 1; t < body.trail.length; t++) {
          const alpha = (t / body.trail.length) * 0.25;
          ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(body.trail[t - 1].x, body.trail[t - 1].y);
          ctx.lineTo(body.trail[t].x, body.trail[t].y);
          ctx.stroke();
        }
      }
    }

    // Creatures
    for (let i = 0; i < population.length; i++) {
      drawCreature(population[i], i === focusedIndex, simTime);
    }

    ctx.restore();

    // Cursor overlay for brush tools
    if (cursorVisible && (currentTool === 'block' || currentTool === 'erase')) {
      const radiusWorld = BRUSH_SIZE * COF.cellSize;
      const radiusScreen = radiusWorld * camZoom;
      const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.005);
      const isBlock = currentTool === 'block';

      ctx.save();
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = isBlock ? 'rgba(129,140,248,0.08)' : 'rgba(248,113,113,0.08)';
      ctx.beginPath();
      ctx.arc(cursorScreenX, cursorScreenY, radiusScreen, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isBlock ? 'rgba(129,140,248,0.5)' : 'rgba(248,113,113,0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function drawCreature(body, isFocused, simTime) {
    const nodes = body.nodes;
    const nc = nodes.length;
    const col = body.getColor();
    const colStr = `rgb(${col[0]},${col[1]},${col[2]})`;

    let cx = 0, cy = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; }
    cx /= nc; cy /= nc;

    const sorted = nodes.slice().sort((a, b) =>
      Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
    );

    // Focused glow
    if (isFocused) {
      ctx.strokeStyle = 'rgba(251,191,36,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, 50, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Membrane
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = colStr;
    ctx.beginPath();
    const sn = sorted.length;
    if (sn >= 3) {
      for (let i = 0; i < sn; i++) {
        const curr = sorted[i];
        const next = sorted[(i + 1) % sn];
        const midX = (curr.x + next.x) / 2;
        const midY = (curr.y + next.y) / 2;
        if (i === 0) {
          const prev = sorted[sn - 1];
          ctx.moveTo((prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
        }
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Bones
    ctx.strokeStyle = 'rgba(200,210,230,0.25)';
    ctx.lineWidth = 1;
    for (const b of body.bones) {
      const na = nodes[b.a], nb = nodes[b.b];
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.stroke();
    }

    // Muscles
    if (showMuscles) {
      for (let i = 0; i < body.muscles.length; i++) {
        const m = body.muscles[i];
        const na = nodes[m.a], nb = nodes[m.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const curLen = Math.sqrt(dx * dx + dy * dy);
        const ratio = curLen / m.restLength;
        const act = body.muscleAct[i];

        let mr, mg, mb;
        if (ratio < 0.85) {
          mr = 255; mg = 100; mb = 60;
        } else if (ratio > 1.05) {
          mr = 80; mg = 140; mb = 255;
        } else {
          const t = (ratio - 0.85) / 0.2;
          mr = Math.floor(255 * (1 - t) + 80 * t);
          mg = Math.floor(100 * (1 - t) + 140 * t);
          mb = Math.floor(60 * (1 - t) + 255 * t);
        }

        const lw = act > 0.5 ? 1 + act * 2 : 1;
        ctx.strokeStyle = `rgba(${mr},${mg},${mb},0.6)`;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }
    }

    // Nodes
    for (const n of nodes) {
      ctx.fillStyle = colStr;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      if (n.grounded) {
        ctx.fillStyle = 'rgba(129,255,140,0.4)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Eyes
    let frontNode = nodes[0];
    for (const n of nodes) {
      if (n.x > frontNode.x) frontNode = n;
    }
    const eyeAngle = Math.atan2(frontNode.y - cy, frontNode.x - cx);
    const perpX = -Math.sin(eyeAngle);
    const perpY = Math.cos(eyeAngle);
    const eyeR = 2.5;
    const eyeSpread = 3.5;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(frontNode.x + perpX * eyeSpread * 0.5, frontNode.y + perpY * eyeSpread * 0.5, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(frontNode.x - perpX * eyeSpread * 0.5, frontNode.y - perpY * eyeSpread * 0.5, eyeR, 0, Math.PI * 2);
    ctx.fill();
    const pOff = 0.8;
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(
      frontNode.x + perpX * eyeSpread * 0.5 + Math.cos(eyeAngle) * pOff,
      frontNode.y + perpY * eyeSpread * 0.5 + Math.sin(eyeAngle) * pOff,
      eyeR * 0.5, 0, Math.PI * 2
    );
    ctx.fill();
    ctx.beginPath();
    ctx.arc(
      frontNode.x - perpX * eyeSpread * 0.5 + Math.cos(eyeAngle) * pOff,
      frontNode.y - perpY * eyeSpread * 0.5 + Math.sin(eyeAngle) * pOff,
      eyeR * 0.5, 0, Math.PI * 2
    );
    ctx.fill();

    // Fitness label for focused creature
    if (isFocused) {
      const fit = Math.round(body.fitness || (body.getCenterX() - body.startX));
      ctx.fillStyle = 'rgba(251,191,36,0.9)';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${fit}`, cx, cy - 45);
    }
  }

  // ─── Graph Rendering ──────────────────────────────
  function renderGraph() {
    if (!showGraph) return;
    const gc = document.getElementById('graphCanvas');
    const gCtx = gc.getContext('2d');
    const gW = gc.width;
    const gH = gc.height;

    gCtx.clearRect(0, 0, gW, gH);
    gCtx.fillStyle = 'rgba(4,6,10,0.8)';
    gCtx.fillRect(0, 0, gW, gH);

    if (historyBest.length < 2) {
      gCtx.fillStyle = 'rgba(129,140,248,0.3)';
      gCtx.font = '12px sans-serif';
      gCtx.textAlign = 'center';
      gCtx.fillText('データ収集中...', gW / 2, gH / 2);
      return;
    }

    let maxVal = 10;
    for (const v of historyBest) if (v > maxVal) maxVal = v;
    let minVal = 0;
    for (const v of historyAvg) if (v < minVal) minVal = v;
    const range = maxVal - minVal;
    maxVal = maxVal + range * 0.1;
    minVal = minVal - range * 0.1;
    const rng = maxVal - minVal || 1;

    gCtx.strokeStyle = 'rgba(129,140,248,0.1)';
    gCtx.lineWidth = 0.5;
    for (let i = 1; i <= 4; i++) {
      const y = gH - (i / 4) * gH;
      gCtx.beginPath(); gCtx.moveTo(0, y); gCtx.lineTo(gW, y); gCtx.stroke();
      gCtx.fillStyle = 'rgba(129,140,248,0.4)';
      gCtx.font = '9px sans-serif';
      gCtx.textAlign = 'left';
      gCtx.fillText(String(Math.round(minVal + (i / 4) * rng)), 2, y - 2);
    }

    drawGraphLine(gCtx, historyBest, gW, gH, minVal, rng, '#fbbf24', 2);
    drawGraphLine(gCtx, historyAvg, gW, gH, minVal, rng, '#818cf8', 1.5);

    gCtx.font = '10px sans-serif';
    gCtx.textAlign = 'right';
    gCtx.fillStyle = '#fbbf24';
    gCtx.fillText(`最高: ${Math.round(historyBest[historyBest.length - 1])}`, gW - 10, 14);
    gCtx.fillStyle = '#818cf8';
    gCtx.fillText(`平均: ${Math.round(historyAvg[historyAvg.length - 1])}`, gW - 10, 28);
  }

  function drawGraphLine(gCtx, data, gW, gH, minVal, rng, color, lw) {
    gCtx.strokeStyle = color;
    gCtx.lineWidth = lw;
    gCtx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / Math.max(1, HISTORY_MAX - 1)) * gW;
      const y = gH - ((data[i] - minVal) / rng) * gH;
      if (i === 0) gCtx.moveTo(x, y); else gCtx.lineTo(x, y);
    }
    gCtx.stroke();
  }

  // ═══════════════════════════════════════════════════
  //  INPUT HANDLING
  // ═══════════════════════════════════════════════════
  let currentTool = 'observe';
  let showMuscles = true;
  let showTrails = false;
  let showGrid = false;
  let showGraph = false;
  let showConfig = false;
  let simSpeed = 1;
  let isPaused = false;

  let pointers = new Map();
  let lastPinchDist = 0;
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let camStartX = 0, camStartY = 0;
  let isDrawing = false;
  let cursorScreenX = -1, cursorScreenY = -1;
  let cursorVisible = false;

  function screenToWorld(sx, sy) {
    return { x: (sx - camX) / camZoom, y: (sy - camY) / camZoom };
  }

  // ─── Build Phase Input ────────────────────────────
  function handleBuildClick(sx, sy) {
    const { x: wx, y: wy } = screenToWorld(sx, sy);

    switch (buildTool) {
      case 'add-node': {
        blueprint.nodes.push({ x: wx, y: wy, radius: 7 });
        updateBuildInfo();
        break;
      }

      case 'add-bone':
      case 'add-muscle': {
        const idx = findBuildNodeAt(wx, wy);
        if (idx < 0) break;
        if (buildSelectedNode < 0) {
          buildSelectedNode = idx;
        } else if (idx !== buildSelectedNode) {
          const list = buildTool === 'add-bone' ? blueprint.bones : blueprint.muscles;
          if (!connectionExists(list, buildSelectedNode, idx)) {
            list.push({ a: buildSelectedNode, b: idx });
          }
          buildSelectedNode = -1;
          updateBuildInfo();
        }
        updateBuildHint();
        break;
      }

      case 'move-node': {
        // Handled by drag
        break;
      }

      case 'resize-node': {
        const idx2 = findBuildNodeAt(wx, wy);
        if (idx2 >= 0) {
          const n = blueprint.nodes[idx2];
          // Cycle through sizes
          const sizes = [4, 6, 8, 10, 12];
          const curIdx = sizes.indexOf(n.radius);
          n.radius = curIdx >= 0 ? sizes[(curIdx + 1) % sizes.length] : sizes[0];
        }
        break;
      }

      case 'delete': {
        const nodeIdx = findBuildNodeAt(wx, wy);
        if (nodeIdx >= 0) {
          // Remove node and all connections referencing it
          blueprint.nodes.splice(nodeIdx, 1);
          // Fix connection indices
          blueprint.bones = blueprint.bones.filter(b => b.a !== nodeIdx && b.b !== nodeIdx)
            .map(b => ({
              a: b.a > nodeIdx ? b.a - 1 : b.a,
              b: b.b > nodeIdx ? b.b - 1 : b.b,
            }));
          blueprint.muscles = blueprint.muscles.filter(m => m.a !== nodeIdx && m.b !== nodeIdx)
            .map(m => ({
              a: m.a > nodeIdx ? m.a - 1 : m.a,
              b: m.b > nodeIdx ? m.b - 1 : m.b,
            }));
          buildSelectedNode = -1;
          updateBuildInfo();
        } else {
          // Check if clicking on a bone or muscle line
          let deleted = false;
          for (let i = blueprint.muscles.length - 1; i >= 0; i--) {
            const m = blueprint.muscles[i];
            if (isNearLine(wx, wy, blueprint.nodes[m.a], blueprint.nodes[m.b], 8)) {
              blueprint.muscles.splice(i, 1);
              deleted = true;
              break;
            }
          }
          if (!deleted) {
            for (let i = blueprint.bones.length - 1; i >= 0; i--) {
              const b = blueprint.bones[i];
              if (isNearLine(wx, wy, blueprint.nodes[b.a], blueprint.nodes[b.b], 8)) {
                blueprint.bones.splice(i, 1);
                break;
              }
            }
          }
          updateBuildInfo();
        }
        break;
      }
    }
  }

  function isNearLine(px, py, a, b, threshold) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.001) return false;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const nx = a.x + t * dx - px;
    const ny = a.y + t * dy - py;
    return (nx * nx + ny * ny) < threshold * threshold;
  }

  // ─── Sim Phase Input ──────────────────────────────
  function handleToolAction(sx, sy) {
    const { x, y } = screenToWorld(sx, sy);
    if (x < 0 || x >= COF.worldW || y < 0 || y >= COF.worldH) return;
    switch (currentTool) {
      case 'block':
        setTerrain(x, y, TERRAIN_SOLID, BRUSH_SIZE);
        terrainDirty = true;
        break;
      case 'erase':
        setTerrain(x, y, TERRAIN_EMPTY, BRUSH_SIZE);
        terrainDirty = true;
        break;
      case 'goal':
        createGoal(x, y);
        break;
      case 'delete-goal':
        deleteGoalNear(x, y);
        break;
      case 'poke': {
        let nearestIdx = -1;
        let nearestD2 = Infinity;
        for (let i = 0; i < population.length; i++) {
          const cx2 = population[i].getCenterX();
          const cy2 = population[i].getCenterY();
          const d2 = (x - cx2) * (x - cx2) + (y - cy2) * (y - cy2);
          if (d2 < nearestD2) { nearestD2 = d2; nearestIdx = i; }
        }
        if (nearestIdx >= 0 && nearestD2 < 80 * 80) {
          for (const n of population[nearestIdx].nodes) {
            n.oy += 8;
          }
        }
        break;
      }
    }
  }

  function setTerrain(x, y, type, brushSize) {
    const gcx = (x / COF.cellSize) | 0;
    const gcy = (y / COF.cellSize) | 0;
    const r = brushSize || 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = gcx + dx;
        const gy = gcy + dy;
        if (gx >= 0 && gx < TERRAIN_W && gy >= 0 && gy < TERRAIN_H) {
          if (dx * dx + dy * dy <= r * r) {
            terrain[gy * TERRAIN_W + gx] = type;
          }
        }
      }
    }
  }

  // ─── Pointer Events (Both Phases) ─────────────────
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (currentPhase === PHASE_BUILD) {
      if (pointers.size === 1) {
        if (buildTool === 'move-node') {
          const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
          buildDragNode = findBuildNodeAt(wx, wy);
          if (buildDragNode < 0) {
            // Pan in build mode
            isPanning = true;
            panStartX = e.clientX; panStartY = e.clientY;
            camStartX = targetCamX; camStartY = targetCamY;
          }
        } else {
          // Check if we should pan (right click or outside area)
          const { x: wx } = screenToWorld(e.clientX, e.clientY);
          if (wx < -50 || wx > 450) {
            isPanning = true;
            panStartX = e.clientX; panStartY = e.clientY;
            camStartX = targetCamX; camStartY = targetCamY;
          } else {
            handleBuildClick(e.clientX, e.clientY);
          }
        }
      }
    } else {
      // SIM phase
      if (pointers.size === 1) {
        if (currentTool === 'observe') {
          isPanning = true;
          panStartX = e.clientX; panStartY = e.clientY;
          camStartX = targetCamX; camStartY = targetCamY;
          if (cameraMode === 'follow') {
            // Tap-to-select creature
            const tapX = e.clientX, tapY = e.clientY;
            const checkTap = () => {
              if (Math.abs(e.clientX - tapX) < 5 && Math.abs(e.clientY - tapY) < 5) {
                const { x: wx, y: wy } = screenToWorld(tapX, tapY);
                showInfoAt(wx, wy);
              }
            };
            canvas.addEventListener('pointerup', checkTap, { once: true });
          }
        } else {
          isDrawing = true;
          handleToolAction(e.clientX, e.clientY);
        }
      }
    }
  });

  canvas.addEventListener('pointermove', e => {
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cursorScreenX = e.clientX;
    cursorScreenY = e.clientY;
    cursorVisible = true;

    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinchDist > 0) {
        const scale = dist / lastPinchDist;
        const mx = (pts[0].x + pts[1].x) / 2;
        const my = (pts[0].y + pts[1].y) / 2;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetCamZoom * scale));
        targetCamX = mx - (mx - targetCamX) * (newZoom / targetCamZoom);
        targetCamY = my - (my - targetCamY) * (newZoom / targetCamZoom);
        targetCamZoom = newZoom;
      }
      lastPinchDist = dist;
      isPanning = false;
      isDrawing = false;
      buildDragNode = -1;
    } else if (currentPhase === PHASE_BUILD && buildDragNode >= 0) {
      const { x: wx, y: wy } = screenToWorld(e.clientX, e.clientY);
      blueprint.nodes[buildDragNode].x = wx;
      blueprint.nodes[buildDragNode].y = wy;
    } else if (isPanning) {
      targetCamX = camStartX + (e.clientX - panStartX);
      targetCamY = camStartY + (e.clientY - panStartY);
      if (currentPhase === PHASE_SIM && cameraMode === 'follow') {
        // Switch to free camera when user pans manually
        cameraMode = 'free';
        document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
        const freeBtn = document.querySelector('.cam-btn[data-cam="free"]');
        if (freeBtn) freeBtn.classList.add('active');
      }
    } else if (isDrawing && (currentTool === 'block' || currentTool === 'erase')) {
      handleToolAction(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('pointerleave', () => { cursorVisible = false; });
  canvas.addEventListener('pointerenter', e => {
    cursorScreenX = e.clientX; cursorScreenY = e.clientY; cursorVisible = true;
  });

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

  // ─── Camera Follow ────────────────────────────────
  function updateCamera() {
    if (cameraMode !== 'follow') return;
    if (population.length === 0) return;
    const target = population[focusedIndex];
    if (!target) return;
    const wcx = target.getCenterX();
    const wcy = target.getCenterY();
    const screenCx = wcx * camZoom + camX;
    const screenCy = wcy * camZoom + camY;
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const margin = 0.3;
    if (screenCx < sw * margin || screenCx > sw * (1 - margin)) {
      targetCamX = sw / 2 - wcx * targetCamZoom;
    }
    if (screenCy < sh * margin || screenCy > sh * (1 - margin)) {
      targetCamY = sh / 2 - wcy * targetCamZoom;
    }
  }

  // ═══════════════════════════════════════════════════
  //  UI MANAGEMENT
  // ═══════════════════════════════════════════════════

  // ─── Build Tools ──────────────────────────────────
  document.querySelectorAll('.build-btn[data-btool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.build-btn[data-btool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildTool = btn.dataset.btool;
      buildSelectedNode = -1;
      updateBuildHint();
    });
  });

  // Presets
  document.getElementById('btn-preset-biped').addEventListener('click', presetBiped);
  document.getElementById('btn-preset-snake').addEventListener('click', presetSnake);
  document.getElementById('btn-preset-spider').addEventListener('click', presetSpider);
  document.getElementById('btn-preset-blob').addEventListener('click', presetBlob);
  document.getElementById('btn-clear-build').addEventListener('click', clearBlueprint);

  // Start Sim
  document.getElementById('btn-start-sim').addEventListener('click', () => {
    if (!isValidBlueprint()) return;
    switchToSim();
  });

  function switchToSim() {
    currentPhase = PHASE_SIM;
    document.getElementById('build-overlay').classList.add('hidden');
    document.getElementById('sim-overlay').classList.remove('hidden');

    // Reset evolution state
    generation = 0;
    bestEverFitness = 0;
    bestEverGen = 0;
    historyBest.length = 0;
    historyAvg.length = 0;
    evalTimer = 0;

    initWorld();
    createPopulation(null);
    resizeCanvas();

    addEventMsg('🚀 進化シミュレーション開始！', '#63d2ff', false);
  }

  function switchToBuild() {
    currentPhase = PHASE_BUILD;
    document.getElementById('sim-overlay').classList.add('hidden');
    document.getElementById('build-overlay').classList.remove('hidden');
    clearPopulation();
    isPaused = false;
    simSpeed = 1;
    resizeCanvas();
    updateBuildInfo();
  }

  // ─── Back to Build ────────────────────────────────
  document.getElementById('btn-back-build').addEventListener('click', switchToBuild);

  // ─── Sim Tool Buttons ─────────────────────────────
  const brushRadiusControl = document.getElementById('brush-radius-control');
  const brushRadiusSlider = document.getElementById('brush-radius-slider');
  const brushRadiusValue = document.getElementById('brush-radius-value');

  function updateBrushUI() {
    const show = currentTool === 'block' || currentTool === 'erase';
    brushRadiusControl.classList.toggle('hidden', !show);
    if (show) {
      brushRadiusSlider.value = BRUSH_SIZE;
      brushRadiusValue.textContent = BRUSH_SIZE;
    }
  }

  brushRadiusSlider.addEventListener('input', () => {
    BRUSH_SIZE = parseInt(brushRadiusSlider.value);
    brushRadiusValue.textContent = BRUSH_SIZE;
  });

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      updateBrushUI();
    });
  });

  // ─── Speed Controls ───────────────────────────────
  document.getElementById('btn-pause').addEventListener('click', () => {
    isPaused = true; simSpeed = 0;
    document.querySelectorAll('#speed-control button').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-pause').classList.add('active');
  });

  document.getElementById('btn-play').addEventListener('click', () => {
    isPaused = false; simSpeed = 1;
    document.querySelectorAll('#speed-control button').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-play').classList.add('active');
  });

  document.getElementById('btn-fast').addEventListener('click', () => {
    isPaused = false; simSpeed = 3;
    document.querySelectorAll('#speed-control button').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-fast').classList.add('active');
  });

  document.getElementById('btn-skip').addEventListener('click', () => {
    if (!isPaused && population.length > 0) {
      evalTimer = COF.evalSeconds;
    }
  });

  // ─── Toggles ──────────────────────────────────────
  document.getElementById('toggle-muscles').addEventListener('change', e => { showMuscles = e.target.checked; });
  document.getElementById('toggle-trails').addEventListener('change', e => { showTrails = e.target.checked; });
  document.getElementById('toggle-grid').addEventListener('change', e => { showGrid = e.target.checked; });
  document.getElementById('toggle-graph').addEventListener('change', e => {
    showGraph = e.target.checked;
    document.getElementById('graph-panel').classList.toggle('hidden', !showGraph);
  });

  document.getElementById('close-graph').addEventListener('click', () => {
    showGraph = false;
    document.getElementById('toggle-graph').checked = false;
    document.getElementById('graph-panel').classList.add('hidden');
  });

  document.getElementById('close-info').addEventListener('click', () => {
    document.getElementById('info-panel').classList.add('hidden');
  });

  // ─── Camera Mode ──────────────────────────────────
  document.querySelectorAll('.cam-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cam-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cameraMode = btn.dataset.cam;
    });
  });

  // ─── Fitness Objective ────────────────────────────
  document.querySelectorAll('.obj-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.obj-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const newObj = btn.dataset.obj;
      if (newObj !== fitnessObjective) {
        fitnessObjective = newObj;
        const objNames = {
          'distance': '移動距離',
          'height': '跳躍高',
          'goal-speed': 'ゴール到達',
          'stability': '安定性'
        };
        addEventMsg(`🎯 学習目標変更: ${objNames[fitnessObjective]}`, '#a78bfa', false);
      }
    });
  });

  // ─── Config Panel ─────────────────────────────────
  document.getElementById('btn-config').addEventListener('click', () => {
    showConfig = !showConfig;
    document.getElementById('config-panel').classList.toggle('hidden', !showConfig);
  });

  document.getElementById('close-config').addEventListener('click', () => {
    showConfig = false;
    document.getElementById('config-panel').classList.add('hidden');
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
        row.appendChild(label);

        if (item.type === 'range') {
          const wrapper = document.createElement('div');
          wrapper.className = 'config-slider-wrapper';
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = item.min;
          slider.max = item.max;
          slider.step = item.step;
          slider.value = COF[item.key];
          const valueDisplay = document.createElement('span');
          valueDisplay.className = 'config-value';
          valueDisplay.textContent = COF[item.key];
          slider.addEventListener('input', () => {
            COF[item.key] = parseFloat(slider.value);
            const decimals = item.step < 0.01 ? 3 : item.step < 0.1 ? 2 : item.step < 1 ? 1 : 0;
            valueDisplay.textContent = parseFloat(slider.value).toFixed(decimals);
          });
          wrapper.appendChild(slider);
          wrapper.appendChild(valueDisplay);
          row.appendChild(wrapper);
        }
        itemsEl.appendChild(row);
      }

      sectionEl.appendChild(itemsEl);
      container.appendChild(sectionEl);
    }
  }

  // ─── Info Panel ───────────────────────────────────
  function showInfoAt(wx, wy) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content');

    for (let i = 0; i < population.length; i++) {
      const body = population[i];
      const cx2 = body.getCenterX(), cy2 = body.getCenterY();
      const d2 = (wx - cx2) * (wx - cx2) + (wy - cy2) * (wy - cy2);
      if (d2 < 50 * 50) {
        focusedIndex = i;
        const fit = Math.round(body.fitness || (body.getCenterX() - body.startX));
        const groundCount = body.nodes.filter(n => n.grounded).length;
        const muscleInfo = body.muscleAct.map((a, mi) => {
          const pct = (a * 100).toFixed(0);
          const barLen = Math.round(a * 10);
          const bar = '▓'.repeat(barLen) + '░'.repeat(10 - barLen);
          return `M${mi}: ${bar} ${pct}%`;
        }).join('<br>');

        content.innerHTML =
          `<b>🦠 個体 #${body.id}</b><br>` +
          `適応度: <span style="color:#fbbf24">${fit}</span><br>` +
          `接地ノード: ${groundCount} / ${body.nodes.length}<br>` +
          `ノード数: ${body.nodes.length} | 筋肉数: ${body.muscles.length}<br>` +
          `<br><b>筋肉活性:</b><br>` +
          `<span style="font-size:10px;font-family:monospace;line-height:1.5">${muscleInfo}</span>`;
        panel.classList.remove('hidden');
        return;
      }
    }

    for (const g of goals) {
      const d2 = (wx - g.x) * (wx - g.x) + (wy - g.y) * (wy - g.y);
      if (d2 < 30 * 30) {
        content.innerHTML =
          `<b>🎯 ゴール</b><br>` +
          `位置: (${Math.floor(g.x)}, ${Math.floor(g.y)})<br>` +
          `ボーナス: +${COF.goalBonus}<br>` +
          `到達半径: ${COF.goalRadius}px`;
        panel.classList.remove('hidden');
        return;
      }
    }

    panel.classList.add('hidden');
  }

  // ─── Event Log ────────────────────────────────────
  function addEventMsg(text, color, isRecord) {
    const log = document.getElementById('event-log');
    const msg = document.createElement('div');
    msg.className = 'event-msg' + (isRecord ? ' record' : '');
    msg.style.borderColor = color;
    msg.style.color = color;
    msg.textContent = text;
    log.appendChild(msg);
    setTimeout(() => {
      if (msg.parentNode) msg.parentNode.removeChild(msg);
    }, isRecord ? 4500 : 3500);
    while (log.children.length > 6) {
      log.removeChild(log.firstChild);
    }
  }

  // ─── Generation Flash ─────────────────────────────
  let genFlashTimer = 0;

  function showGenFlash(gen, bestFit, avgFit, isRecord) {
    const el = document.getElementById('gen-flash');
    el.innerHTML = `<div class="gen-title">世代 ${gen}</div>` +
      `<div class="gen-sub">最高 ${Math.round(bestFit)} | 平均 ${Math.round(avgFit)}</div>` +
      (isRecord ? `<div class="gen-record">🏆 新記録！</div>` : '');
    el.classList.add('show');
    genFlashTimer = 120;
  }

  // ─── Ranking Display ──────────────────────────────
  function updateRanking() {
    const rankEl = document.getElementById('ranking');
    if (population.length === 0) { rankEl.innerHTML = ''; return; }

    const sorted = population.map((p, i) => ({
      idx: i, fit: Math.round(p.fitness || (p.getCenterX() - p.startX))
    })).sort((a, b) => b.fit - a.fit);

    const medals = ['🥇', '🥈', '🥉'];
    rankEl.innerHTML = sorted.slice(0, 3).map((s, i) =>
      `<span class="rank-item">${medals[i]} #${s.idx} ${s.fit}</span>`
    ).join('');
  }

  // ─── Stats ────────────────────────────────────────
  let fpsFrames = 0;
  let fpsTime = 0;
  let currentFps = 0;

  function updateStats(rawDt) {
    fpsFrames++;
    fpsTime += rawDt;
    if (fpsTime >= 1) {
      currentFps = fpsFrames;
      fpsFrames = 0;
      fpsTime = 0;
      document.getElementById('fps-counter').textContent = `FPS: ${currentFps}`;
      updateRanking();
    }
  }

  // ─── World Initialization ─────────────────────────
  function initWorld() {
    initTerrainGrid();
    initTerrainCanvas();

    const groundRow = Math.floor(TERRAIN_H * COF.groundLevel);
    for (let y = groundRow; y < TERRAIN_H; y++) {
      for (let x = 0; x < TERRAIN_W; x++) {
        terrain[y * TERRAIN_W + x] = TERRAIN_SOLID;
      }
    }

    for (let x = 0; x < TERRAIN_W; x++) {
      terrain[x] = TERRAIN_SOLID;
      terrain[(TERRAIN_H - 1) * TERRAIN_W + x] = TERRAIN_SOLID;
    }
    for (let y = 0; y < TERRAIN_H; y++) {
      terrain[y * TERRAIN_W] = TERRAIN_SOLID;
    }

    // Small hill
    const hillCx = 100;
    const hillW = 12;
    const hillH = 3;
    for (let dx = -hillW; dx <= hillW; dx++) {
      const gx = hillCx + dx;
      if (gx < 0 || gx >= TERRAIN_W) continue;
      const h = Math.floor(hillH * Math.max(0, 1 - (dx / hillW) * (dx / hillW)));
      for (let dy = 0; dy < h; dy++) {
        const gy = groundRow - 1 - dy;
        if (gy >= 0) terrain[gy * TERRAIN_W + gx] = TERRAIN_SOLID;
      }
    }

    // Small step
    const stepX = 200;
    const stepW = 6;
    const stepH = 2;
    for (let dx = 0; dx < stepW; dx++) {
      for (let dy = 0; dy < stepH; dy++) {
        const gx = stepX + dx;
        const gy = groundRow - 1 - dy;
        if (gx >= 0 && gx < TERRAIN_W && gy >= 0 && gy < TERRAIN_H) {
          terrain[gy * TERRAIN_W + gx] = TERRAIN_SOLID;
        }
      }
    }

    terrainDirty = true;
  }

  // ═══════════════════════════════════════════════════
  //  MAIN LOOP
  // ═══════════════════════════════════════════════════
  let lastTime = 0;
  let simTime = 0;

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
      const alpha = Math.min(1, genFlashTimer / 30);
      document.getElementById('gen-flash').style.opacity = alpha;
      if (genFlashTimer <= 0) {
        document.getElementById('gen-flash').classList.remove('show');
      }
    }

    if (!isPaused) {
      const dt = rawDt * simSpeed;
      simTime += dt;
      evalTimer += dt;

      const progress = Math.min(100, (evalTimer / COF.evalSeconds) * 100);
      document.getElementById('eval-fill').style.width = `${progress}%`;
      document.getElementById('eval-timer').textContent =
        `⏱ ${evalTimer.toFixed(1)} / ${COF.evalSeconds.toFixed(1)}s`;

      for (const body of population) {
        body.updateBrain(simTime);
      }

      const steps = simSpeed >= 3 ? 2 : 1;
      for (let s = 0; s < steps; s++) {
        physicStep();
      }

      // Find best performer
      let bestIdx = 0;
      let bestFit = -Infinity;
      for (let i = 0; i < population.length; i++) {
        const f = calcFitnessForBody(population[i]);
        if (f > bestFit) { bestFit = f; bestIdx = i; }
      }
      if (cameraMode === 'follow') {
        focusedIndex = bestIdx;
      }

      updateCamera();

      if (evalTimer >= COF.evalSeconds) {
        evolve();
      }
    }

    renderSimPhase(simTime);
    renderGraph();
  }

  // ═══════════════════════════════════════════════════
  //  BOOT
  // ═══════════════════════════════════════════════════
  window.addEventListener('resize', resizeCanvas);

  // Initialize terrain for build phase preview
  initTerrainGrid();
  initTerrainCanvas();

  resizeCanvas();
  buildConfigPanel();
  updateBuildInfo();

  // Load blob preset as default
  presetBlob();

  lastTime = performance.now();
  requestAnimationFrame(mainLoop);

})();
