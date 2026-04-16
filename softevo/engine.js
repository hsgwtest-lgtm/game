/* =====================================================
   SoftEvo — 軟体生物進化シミュレータ (リビルド版)
   ─────────────────────────────────────────────────────
   ゼロ依存: 自作 Verlet 物理 + 自作ニューラルネット
   antsim4 のこだわりを継承した本格シミュレータ
   ===================================================== */

(function () {
  'use strict';

  // ─── Configurable Parameters (COF) ─────────────────
  const COF = {
    // World
    worldW: 4000,
    worldH: 600,
    cellSize: 10,
    groundLevel: 0.75,

    // Evolution
    population: 20,
    evalSeconds: 10,
    eliteRatio: 0.3,

    // Mutation
    mutationRate: 0.15,
    mutationStrength: 0.3,

    // Body
    nodeCount: 6,
    bodyRadiusX: 25,
    bodyRadiusY: 15,
    nodeRadiusMin: 5,
    nodeRadiusMax: 9,

    // Physics
    gravity: 0.35,
    airDrag: 0.995,
    groundFriction: 0.6,
    bounce: 0.15,
    constraintIter: 5,
    boneStiffness: 0.6,
    muscleStiffness: 0.3,

    // Neural Net
    hiddenSize1: 12,
    hiddenSize2: 8,

    // Display
    cameraSpeed: 0.08,
    trailLen: 60,

    // Goal bonus
    goalBonus: 150,
    goalRadius: 30,
  };

  // ─── COF Definitions (for panel generation) ────────
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
    { section: '身体 (Body)', items: [
      { key: 'nodeCount', label: 'ノード数', type: 'range', min: 4, max: 10, step: 1 },
      { key: 'bodyRadiusX', label: '体幅', type: 'range', min: 10, max: 50, step: 1 },
      { key: 'bodyRadiusY', label: '体高', type: 'range', min: 8, max: 40, step: 1 },
      { key: 'nodeRadiusMin', label: 'ノード最小半径', type: 'range', min: 2, max: 8, step: 1 },
      { key: 'nodeRadiusMax', label: 'ノード最大半径', type: 'range', min: 5, max: 15, step: 1 },
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

  // ─── Constants ─────────────────────────────────────
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
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // ─── Neural Network (pure JS, no TF) ─────────────
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
          // ReLU for hidden, sigmoid for output
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

  // ─── Soft Body (Creature) ─────────────────────────
  let bodyIdCounter = 0;

  class SoftBody {
    constructor(x, y, genome) {
      this.id = bodyIdCounter++;
      this.startX = x;
      this.fitness = 0;
      this.alive = true;

      const nc = COF.nodeCount;

      // Create nodes in elliptical arrangement
      this.nodes = [];
      for (let i = 0; i < nc; i++) {
        const angle = (Math.PI * 2 * i) / nc;
        const nx = x + Math.cos(angle) * COF.bodyRadiusX;
        const ny = y + Math.sin(angle) * COF.bodyRadiusY;
        const r = COF.nodeRadiusMin + Math.random() * (COF.nodeRadiusMax - COF.nodeRadiusMin);
        this.nodes.push({
          x: nx, y: ny, ox: nx, oy: ny,
          radius: r, mass: 1, grounded: false,
        });
      }

      // Bones: adjacent nodes
      this.bones = [];
      for (let i = 0; i < nc; i++) {
        const j = (i + 1) % nc;
        const na = this.nodes[i], nb = this.nodes[j];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        this.bones.push({
          a: i, b: j,
          restLength: Math.sqrt(dx * dx + dy * dy),
          stiffness: COF.boneStiffness,
        });
      }

      // Muscles: skip-2 connections
      this.muscles = [];
      this.muscleAct = [];
      const muscleSet = new Set();
      for (let i = 0; i < nc; i++) {
        const j = (i + 2) % nc;
        const key = Math.min(i, j) + '-' + Math.max(i, j);
        if (!muscleSet.has(key)) {
          muscleSet.add(key);
          const na = this.nodes[i], nb = this.nodes[j];
          const dx = nb.x - na.x, dy = nb.y - na.y;
          const rl = Math.sqrt(dx * dx + dy * dy);
          this.muscles.push({
            a: i, b: j,
            restLength: rl,
            currentTarget: rl,
            stiffness: COF.muscleStiffness,
          });
          this.muscleAct.push(0.5);
        }
      }

      // Also add diameter muscles for richer control
      for (let i = 0; i < nc; i++) {
        const j = (i + Math.floor(nc / 2)) % nc;
        const key = Math.min(i, j) + '-' + Math.max(i, j);
        if (!muscleSet.has(key)) {
          muscleSet.add(key);
          const na = this.nodes[i], nb = this.nodes[j];
          const dx = nb.x - na.x, dy = nb.y - na.y;
          const rl = Math.sqrt(dx * dx + dy * dy);
          this.muscles.push({
            a: i, b: j,
            restLength: rl,
            currentTarget: rl,
            stiffness: COF.muscleStiffness,
          });
          this.muscleAct.push(0.5);
        }
      }

      // Neural network
      const muscleCount = this.muscles.length;
      const inputSize = nc * 2 + muscleCount + nc + 1;
      this.brain = new NeuralNet([
        inputSize, COF.hiddenSize1, COF.hiddenSize2, muscleCount
      ]);

      if (genome) {
        this.brain.setGenome(genome);
      }

      // Trail
      this.trail = [];
    }

    getInputs(time) {
      const inputs = [];
      // Node velocities
      for (const n of this.nodes) {
        inputs.push((n.x - n.ox) * 0.1);
        inputs.push((n.y - n.oy) * 0.1);
      }
      // Muscle lengths (normalized)
      for (const m of this.muscles) {
        const na = this.nodes[m.a], nb = this.nodes[m.b];
        const dx = nb.x - na.x, dy = nb.y - na.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        inputs.push(len / (m.restLength + 0.001) - 1.0);
      }
      // Ground contacts
      for (const n of this.nodes) {
        inputs.push(n.grounded ? 1.0 : 0.0);
      }
      // Rhythm signal
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
      let fit = this.getCenterX() - this.startX;
      // Goal bonuses
      const cx = this.getCenterX(), cy = this.getCenterY();
      const gr2 = COF.goalRadius * COF.goalRadius;
      for (const g of goals) {
        const dx = cx - g.x, dy = cy - g.y;
        if (dx * dx + dy * dy < gr2) {
          fit += COF.goalBonus;
        }
      }
      this.fitness = fit;
      return fit;
    }

    getColor() {
      const maxFit = Math.max(bestEverFitness, 80);
      const t = Math.min(1, Math.max(0, (this.getCenterX() - this.startX) / maxFit));
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
    return groundRow * COF.cellSize - 45;
  }

  function createPopulation(genomes) {
    population = [];
    const spacing = 100;
    const startX = 200;
    const sy = getSpawnY();
    for (let i = 0; i < COF.population; i++) {
      const x = startX + i * spacing;
      const g = genomes ? genomes[i] : null;
      population.push(new SoftBody(x, sy, g));
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
    // Calculate fitness
    const fitnesses = population.map(p => p.calcFitness());

    // Sort descending
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

    // Record history
    historyBest.push(bestFit);
    historyAvg.push(avgFit);
    if (historyBest.length > HISTORY_MAX) { historyBest.shift(); historyAvg.shift(); }

    // Save elite genomes
    const eliteGenomes = eliteIdx.map(i => population[i].brain.getGenome());

    // Create new population
    const newGenomes = [];
    for (let i = 0; i < COF.population; i++) {
      if (i < eliteCount) {
        // Keep elite unchanged
        newGenomes.push(eliteGenomes[i]);
      } else {
        // Crossover + mutation
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

    // Update UI
    document.getElementById('gen-info').textContent = `🧬 世代 ${generation}`;
    document.getElementById('best-info').textContent = `🏆 ${Math.round(bestFit)}px`;
    document.getElementById('avg-info').textContent = `📊 ${Math.round(avgFit)}px`;

    // Show generation flash
    showGenFlash(generation, bestFit, avgFit, isRecord);

    // Event log
    addEventMsg(`🧬 世代 ${generation} | 最高 ${Math.round(bestFit)}px | 平均 ${Math.round(avgFit)}px`,
      '#818cf8', false);
    if (isRecord) {
      addEventMsg(`🏆 新記録！ ${Math.round(bestFit)}px (世代 ${generation})`, '#fbbf24', true);
    }
  }

  // ─── Physics (Verlet Integration) ─────────────────
  function physicStep() {
    for (const body of population) {
      // Integrate nodes
      for (const n of body.nodes) {
        const vx = (n.x - n.ox) * COF.airDrag;
        const vy = (n.y - n.oy) * COF.airDrag;
        n.ox = n.x;
        n.oy = n.y;
        n.x += vx;
        n.y += vy + COF.gravity;
        n.grounded = false;
      }

      // Constraint iterations
      for (let iter = 0; iter < COF.constraintIter; iter++) {
        // Bones
        for (const c of body.bones) {
          solveConstraint(body.nodes[c.a], body.nodes[c.b], c.restLength, c.stiffness);
        }
        // Muscles (use currentTarget)
        for (const m of body.muscles) {
          solveConstraint(body.nodes[m.a], body.nodes[m.b], m.currentTarget, m.stiffness);
        }
        // Terrain collision after each iteration
        for (const n of body.nodes) {
          collideWithTerrain(n);
          constrainToWorld(n);
        }
      }

      // Update trail
      body.trail.push({ x: body.getCenterX(), y: body.getCenterY() });
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

            // Velocity decomposition
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
            // Inside cell — push to nearest edge
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

  // ─── Rendering ────────────────────────────────────
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');

  let camX = 0, camY = 0, camZoom = 1;
  let targetCamX = 0, targetCamY = 0, targetCamZoom = 1;

  // Off-screen terrain canvas
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
    const scaleX = window.innerWidth / COF.worldW;
    const scaleY = window.innerHeight / COF.worldH;
    targetCamZoom = Math.min(scaleX, scaleY);
    targetCamX = (window.innerWidth - COF.worldW * targetCamZoom) / 2;
    targetCamY = (window.innerHeight - COF.worldH * targetCamZoom) / 2;
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
            // Surface cell
            data[pi] = 60; data[pi + 1] = 70; data[pi + 2] = 100; data[pi + 3] = 255;
          } else {
            const noise = ((x * 17 + y * 31) % 8) - 4;
            data[pi] = 28 + noise; data[pi + 1] = 32 + noise; data[pi + 2] = 48 + noise; data[pi + 3] = 255;
          }
        } else {
          data[pi] = 0; data[pi + 1] = 0; data[pi + 2] = 0; data[pi + 3] = 0;
        }
      }
    }
    terrainCtx.putImageData(terrainImageData, 0, 0);
  }

  function render(simTime) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0c1020');
    grad.addColorStop(0.5, '#0a0e1a');
    grad.addColorStop(1, '#080c16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Smooth camera
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
      for (let i = 0; i < population.length; i++) {
        const body = population[i];
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

    // Cursor overlay (screen space)
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

    // Find center & sort nodes by angle for membrane
    let cx = 0, cy = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; }
    cx /= nc; cy /= nc;

    const sorted = nodes.slice().sort((a, b) =>
      Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
    );

    // Glow for focused
    if (isFocused) {
      ctx.strokeStyle = 'rgba(251,191,36,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(cx, cy, 45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Membrane (smooth blob)
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = colStr;
    ctx.beginPath();
    const sn = sorted.length;
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
    ctx.globalAlpha = 1.0;

    // Bones
    ctx.strokeStyle = 'rgba(200,210,230,0.2)';
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
      // Ground contact indicator
      if (n.grounded) {
        ctx.fillStyle = 'rgba(129,255,140,0.4)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Eyes on frontmost node
    let frontNode = nodes[0];
    for (const n of nodes) {
      if (n.x > frontNode.x) frontNode = n;
    }
    const eyeAngle = Math.atan2(frontNode.y - cy, frontNode.x - cx);
    const perpX = -Math.sin(eyeAngle);
    const perpY = Math.cos(eyeAngle);
    const eyeR = 2.5;
    const eyeSpread = 3.5;
    // White sclera
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(frontNode.x + perpX * eyeSpread * 0.5, frontNode.y + perpY * eyeSpread * 0.5, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(frontNode.x - perpX * eyeSpread * 0.5, frontNode.y - perpY * eyeSpread * 0.5, eyeR, 0, Math.PI * 2);
    ctx.fill();
    // Pupils
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
      const fit = Math.round(body.getCenterX() - body.startX);
      ctx.fillStyle = 'rgba(251,191,36,0.9)';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${fit}px`, cx, cy - 40);
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
    gCtx.fillStyle = 'rgba(6,8,12,0.8)';
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

    // Grid
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

    // Best line (gold)
    drawGraphLine(gCtx, historyBest, gW, gH, minVal, rng, '#fbbf24', 2);
    // Average line (indigo)
    drawGraphLine(gCtx, historyAvg, gW, gH, minVal, rng, '#818cf8', 1.5);

    // Legend
    gCtx.font = '10px sans-serif';
    gCtx.textAlign = 'right';
    gCtx.fillStyle = '#fbbf24';
    gCtx.fillText(`最高: ${Math.round(historyBest[historyBest.length - 1])}px`, gW - 10, 14);
    gCtx.fillStyle = '#818cf8';
    gCtx.fillText(`平均: ${Math.round(historyAvg[historyAvg.length - 1])}px`, gW - 10, 28);
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

  // ─── Input Handling ───────────────────────────────
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
        // Find nearest creature and apply upward force
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
      case 'restart':
        // Reset evolution
        generation = 0;
        bestEverFitness = 0;
        bestEverGen = 0;
        historyBest.length = 0;
        historyAvg.length = 0;
        evalTimer = 0;
        clearPopulation();
        createPopulation(null);
        document.getElementById('gen-info').textContent = '🧬 世代 0';
        document.getElementById('best-info').textContent = '🏆 0px';
        document.getElementById('avg-info').textContent = '📊 0px';
        addEventMsg('🔄 進化をリセットしました', '#f87171', false);
        break;
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

  // Pointer events
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      if (currentTool === 'observe') {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        camStartX = targetCamX;
        camStartY = targetCamY;

        const tapX = e.clientX, tapY = e.clientY;
        const checkTap = () => {
          if (Math.abs(e.clientX - tapX) < 5 && Math.abs(e.clientY - tapY) < 5) {
            const { x: wx, y: wy } = screenToWorld(tapX, tapY);
            showInfoAt(wx, wy);
          }
        };
        canvas.addEventListener('pointerup', checkTap, { once: true });
      } else if (currentTool === 'restart') {
        handleToolAction(e.clientX, e.clientY);
      } else {
        isDrawing = true;
        handleToolAction(e.clientX, e.clientY);
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
    } else if (isPanning) {
      targetCamX = camStartX + (e.clientX - panStartX);
      targetCamY = camStartY + (e.clientY - panStartY);
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
    if (pointers.size === 0) { isPanning = false; isDrawing = false; }
  });

  canvas.addEventListener('pointercancel', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = 0;
    if (pointers.size === 0) { isPanning = false; isDrawing = false; }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetCamZoom * scale));
    targetCamX = e.clientX - (e.clientX - targetCamX) * (newZoom / targetCamZoom);
    targetCamY = e.clientY - (e.clientY - targetCamY) * (newZoom / targetCamZoom);
    targetCamZoom = newZoom;
  }, { passive: false });

  // ─── Camera follow ────────────────────────────────
  function updateCamera() {
    if (population.length === 0) return;
    const target = population[focusedIndex];
    if (!target) return;
    const wcx = target.getCenterX();
    const wcy = target.getCenterY();
    const screenCx = wcx * camZoom + camX;
    const screenCy = wcy * camZoom + camY;
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    // Only follow if creature is near edges
    const margin = 0.3;
    if (screenCx < sw * margin || screenCx > sw * (1 - margin)) {
      targetCamX = sw / 2 - wcx * targetCamZoom;
    }
    if (screenCy < sh * margin || screenCy > sh * (1 - margin)) {
      targetCamY = sh / 2 - wcy * targetCamZoom;
    }
  }

  // ─── UI Management ────────────────────────────────

  // Tool buttons
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

  // Speed controls
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
      evalTimer = COF.evalSeconds; // force evolve on next frame
    }
  });

  // Toggles
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

  // ─── Config (COF) Panel ───────────────────────────
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

        if (item.type === 'bool') {
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = COF[item.key];
          checkbox.addEventListener('change', () => { COF[item.key] = checkbox.checked; });
          row.appendChild(checkbox);
        } else if (item.type === 'range') {
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

    // Check creatures
    for (let i = 0; i < population.length; i++) {
      const body = population[i];
      const cx2 = body.getCenterX(), cy2 = body.getCenterY();
      const d2 = (wx - cx2) * (wx - cx2) + (wy - cy2) * (wy - cy2);
      if (d2 < 50 * 50) {
        focusedIndex = i;
        const fit = Math.round(body.getCenterX() - body.startX);
        const groundCount = body.nodes.filter(n => n.grounded).length;
        const muscleInfo = body.muscleAct.map((a, mi) => {
          const pct = (a * 100).toFixed(0);
          const barLen = Math.round(a * 10);
          const bar = '▓'.repeat(barLen) + '░'.repeat(10 - barLen);
          return `M${mi}: ${bar} ${pct}%`;
        }).join('<br>');

        content.innerHTML =
          `<b>🦠 個体 #${body.id}</b><br>` +
          `移動距離: <span style="color:#fbbf24">${fit}px</span><br>` +
          `接地ノード: ${groundCount} / ${body.nodes.length}<br>` +
          `ノード数: ${body.nodes.length} | 筋肉数: ${body.muscles.length}<br>` +
          `<br><b>筋肉活性:</b><br>` +
          `<span style="font-size:10px;font-family:monospace;line-height:1.5">${muscleInfo}</span>`;
        panel.classList.remove('hidden');
        return;
      }
    }

    // Check goals
    for (const g of goals) {
      const d2 = (wx - g.x) * (wx - g.x) + (wy - g.y) * (wy - g.y);
      if (d2 < 30 * 30) {
        content.innerHTML =
          `<b>🎯 ゴール</b><br>` +
          `位置: (${Math.floor(g.x)}, ${Math.floor(g.y)})<br>` +
          `ボーナス: +${COF.goalBonus}px<br>` +
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
      `<div class="gen-sub">最高 ${Math.round(bestFit)}px | 平均 ${Math.round(avgFit)}px</div>` +
      (isRecord ? `<div class="gen-record">🏆 新記録！</div>` : '');
    el.classList.add('show');
    genFlashTimer = 120;
  }

  // ─── Ranking Display ──────────────────────────────
  function updateRanking() {
    const rankEl = document.getElementById('ranking');
    if (population.length === 0) { rankEl.innerHTML = ''; return; }

    const sorted = population.map((p, i) => ({
      idx: i, fit: Math.round(p.getCenterX() - p.startX)
    })).sort((a, b) => b.fit - a.fit);

    const medals = ['🥇', '🥈', '🥉'];
    rankEl.innerHTML = sorted.slice(0, 3).map((s, i) =>
      `<span class="rank-item">${medals[i]} #${s.idx} ${s.fit}px</span>`
    ).join('');
  }

  // ─── Stats Update ─────────────────────────────────
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

    // Fill ground
    const groundRow = Math.floor(TERRAIN_H * COF.groundLevel);
    for (let y = groundRow; y < TERRAIN_H; y++) {
      for (let x = 0; x < TERRAIN_W; x++) {
        terrain[y * TERRAIN_W + x] = TERRAIN_SOLID;
      }
    }

    // Borders (top/bottom/left walls, no right wall)
    for (let x = 0; x < TERRAIN_W; x++) {
      terrain[x] = TERRAIN_SOLID; // top
      terrain[(TERRAIN_H - 1) * TERRAIN_W + x] = TERRAIN_SOLID; // bottom
    }
    for (let y = 0; y < TERRAIN_H; y++) {
      terrain[y * TERRAIN_W] = TERRAIN_SOLID; // left
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
    createPopulation(null);
  }

  // ─── Main Loop ────────────────────────────────────
  let lastTime = 0;
  let simTime = 0;

  function mainLoop(timestamp) {
    requestAnimationFrame(mainLoop);

    const rawDt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    updateStats(rawDt);

    // Generation flash countdown
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

      // Update progress bar
      const progress = Math.min(100, (evalTimer / COF.evalSeconds) * 100);
      document.getElementById('eval-fill').style.width = `${progress}%`;
      document.getElementById('eval-timer').textContent =
        `⏱ ${evalTimer.toFixed(1)} / ${COF.evalSeconds.toFixed(1)}s`;

      // Neural network updates
      for (const body of population) {
        body.updateBrain(simTime);
      }

      // Physics steps
      const steps = simSpeed >= 3 ? 2 : 1;
      for (let s = 0; s < steps; s++) {
        physicStep();
      }

      // Find best performer for camera focus
      let bestIdx = 0;
      let bestFit = -Infinity;
      for (let i = 0; i < population.length; i++) {
        const f = population[i].getCenterX() - population[i].startX;
        if (f > bestFit) { bestFit = f; bestIdx = i; }
      }
      // Only auto-focus if user hasn't clicked a specific creature recently
      focusedIndex = bestIdx;

      // Camera follow
      updateCamera();

      // Evolution check
      if (evalTimer >= COF.evalSeconds) {
        evolve();
      }
    }

    render(simTime);
    renderGraph();
  }

  // ─── Boot ─────────────────────────────────────────
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  buildConfigPanel();
  initWorld();
  lastTime = performance.now();
  requestAnimationFrame(mainLoop);

})();
