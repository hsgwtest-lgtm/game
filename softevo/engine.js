/* ============================================================
   SoftEvo — 軟体生物 AI 進化シミュレータ  engine.js
   ============================================================ */

// ---------- CONFIG ----------
const CONFIG = {
  POPULATION:   20,
  EVAL_SECONDS: 8,
  ELITE_RATIO:  0.3,
  MUTATION_RATE: 0.1,
  MUTATION_STD: 0.15,
  NODE_COUNT:   6,
  MUSCLE_COUNT: 6,
  GROUND_Y:    0.8,
  GRAVITY:     1.0,
  FRICTION:    0.5,
};

// ---------- Matter.js aliases ----------
const { Engine, Render, Runner, World, Bodies, Body, Composite,
        Constraint, Events, Mouse, MouseConstraint, Vector } = Matter;

// ---------- Global state ----------
let canvas, ctx, W, H;
let engine, runner, world;
let ground;
let population = [];         // array of SoftBody
let generation = 0;
let evalTimer = 0;
let paused = false;
let timeScale = 1;
let focusedIndex = 0;
let cameraX = 0;
let bestEverFitness = 0;
let bestEverGen = 0;
let trailPoints = [];        // {x,y} for best individual trail
let genFlashTimer = 0;
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 60;
let mouseConstraint = null;

// ---------- Canvas setup ----------
function initCanvas() {
  canvas = document.getElementById('mainCanvas');
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
}

// ---------- Matter.js setup ----------
function initPhysics() {
  engine = Engine.create();
  engine.gravity.y = CONFIG.GRAVITY;

  world = engine.world;

  // Ground — very wide static body
  const groundY = H * CONFIG.GROUND_Y;
  ground = Bodies.rectangle(0, groundY + 250, 100000, 500, {
    isStatic: true,
    friction: CONFIG.FRICTION,
    render: { fillStyle: '#4a4a4a' },
    label: 'ground'
  });
  World.add(world, ground);

  // Mouse interaction
  const mouse = Mouse.create(canvas);
  mouseConstraint = MouseConstraint.create(engine, {
    mouse: mouse,
    constraint: {
      stiffness: 0.2,
      render: { visible: false }
    }
  });
  World.add(world, mouseConstraint);

  // Prevent canvas scroll on touch
  mouse.element.removeEventListener('mousewheel', mouse.mousewheel);
  mouse.element.removeEventListener('DOMMouseScroll', mouse.mousewheel);

  runner = Runner.create();
  Runner.run(runner, engine);
}

// ---------- Neural Network (TF.js) ----------
function createBrain(inputSize, outputSize) {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 16, activation: 'relu', inputShape: [inputSize] }));
  model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
  model.add(tf.layers.dense({ units: outputSize, activation: 'sigmoid' }));
  model.compile({ optimizer: 'sgd', loss: 'meanSquaredError' }); // needed to init weights
  return model;
}

function getWeights(model) {
  return model.getWeights().map(w => w.dataSync().slice());
}

function setWeights(model, weightArrays) {
  const tensors = model.getWeights().map((w, i) =>
    tf.tensor(weightArrays[i], w.shape)
  );
  model.setWeights(tensors);
  tensors.forEach(t => t.dispose());
}

function predictAction(model, inputArray) {
  const result = tf.tidy(() => {
    const input = tf.tensor2d([inputArray]);
    return model.predict(input).dataSync();
  });
  return Array.from(result);
}

// ---------- Soft Body ----------
class SoftBody {
  constructor(x, y, brain) {
    this.startX = x;
    this.nodes = [];
    this.boneConstraints = [];
    this.muscleConstraints = [];
    this.muscleRestLengths = [];
    this.fitness = 0;
    this.color = '#8888ff';

    const nodeCount = CONFIG.NODE_COUNT;
    const muscleCount = CONFIG.MUSCLE_COUNT;

    // Create nodes in elliptical arrangement
    const rx = 30, ry = 20;
    for (let i = 0; i < nodeCount; i++) {
      const angle = (Math.PI * 2 * i) / nodeCount;
      const nx = x + Math.cos(angle) * rx;
      const ny = y + Math.sin(angle) * ry;
      const radius = 8 + Math.random() * 4;
      const node = Bodies.circle(nx, ny, radius, {
        friction: CONFIG.FRICTION,
        restitution: 0.3,
        density: 0.002,
        label: 'softnode'
      });
      this.nodes.push(node);
    }
    World.add(world, this.nodes);

    // Bone constraints (adjacent nodes)
    for (let i = 0; i < nodeCount; i++) {
      const j = (i + 1) % nodeCount;
      const c = Constraint.create({
        bodyA: this.nodes[i],
        bodyB: this.nodes[j],
        stiffness: 0.8,
        damping: 0.05,
        render: { strokeStyle: '#555', lineWidth: 1 }
      });
      this.boneConstraints.push(c);
    }
    World.add(world, this.boneConstraints);

    // Muscle constraints (diagonals)
    this.muscleIndices = [];
    for (let m = 0; m < muscleCount; m++) {
      const a = m % nodeCount;
      const b = (m + Math.floor(nodeCount / 2)) % nodeCount;
      if (a === b) continue;
      const c = Constraint.create({
        bodyA: this.nodes[a],
        bodyB: this.nodes[b],
        stiffness: 0.05 + Math.random() * 0.25,
        damping: 0.05,
        render: { strokeStyle: '#66f', lineWidth: 2 }
      });
      const restLen = Vector.magnitude(
        Vector.sub(this.nodes[a].position, this.nodes[b].position)
      );
      this.muscleConstraints.push(c);
      this.muscleRestLengths.push(restLen);
      this.muscleIndices.push([a, b]);
    }
    World.add(world, this.muscleConstraints);

    // Neural network
    // Input: node velocities (2*nodeCount) + muscle lengths (muscleCount) + sin rhythm
    const actualMuscleCount = this.muscleConstraints.length;
    const inputSize = nodeCount * 2 + actualMuscleCount + 1;
    const outputSize = actualMuscleCount;

    if (brain) {
      this.brain = brain;
    } else {
      this.brain = createBrain(inputSize, outputSize);
    }
  }

  getInputs(time) {
    const inputs = [];
    // Node velocities
    for (const node of this.nodes) {
      inputs.push(node.velocity.x * 0.1);
      inputs.push(node.velocity.y * 0.1);
    }
    // Current muscle lengths (normalized)
    for (let i = 0; i < this.muscleConstraints.length; i++) {
      const c = this.muscleConstraints[i];
      const len = Vector.magnitude(
        Vector.sub(c.bodyA.position, c.bodyB.position)
      );
      inputs.push(len / (this.muscleRestLengths[i] + 1e-6) - 1.0);
    }
    // Rhythm signal
    inputs.push(Math.sin(time * 5));
    return inputs;
  }

  update(time) {
    const inputs = this.getInputs(time);
    const outputs = predictAction(this.brain, inputs);

    // Apply muscle activations
    for (let i = 0; i < this.muscleConstraints.length; i++) {
      const activation = outputs[i] || 0.5;
      this.muscleConstraints[i].length =
        this.muscleRestLengths[i] * (0.6 + 0.4 * activation);
    }
  }

  getCenterX() {
    let sum = 0;
    for (const n of this.nodes) sum += n.position.x;
    return sum / this.nodes.length;
  }

  getCenterY() {
    let sum = 0;
    for (const n of this.nodes) sum += n.position.y;
    return sum / this.nodes.length;
  }

  calcFitness() {
    this.fitness = this.getCenterX() - this.startX;
    return this.fitness;
  }

  remove() {
    World.remove(world, this.nodes);
    World.remove(world, this.boneConstraints);
    World.remove(world, this.muscleConstraints);
    this.brain.dispose();
  }

  getColor() {
    // Blue-purple (low) to gold (high)
    const maxFit = Math.max(bestEverFitness, 100);
    const t = Math.min(1, Math.max(0, this.fitness / maxFit));
    const r = Math.floor(80 + 175 * t);
    const g = Math.floor(60 + 160 * t);
    const b = Math.floor(200 * (1 - t) + 40 * t);
    return `rgb(${r},${g},${b})`;
  }
}

// ---------- Population management ----------
function createPopulation() {
  population = [];
  const groundY = H * CONFIG.GROUND_Y;
  const spacing = 120;
  for (let i = 0; i < CONFIG.POPULATION; i++) {
    const x = 200 + i * spacing;
    const y = groundY - 60;
    population.push(new SoftBody(x, y, null));
  }
  focusedIndex = 0;
}

function clearPopulation() {
  for (const p of population) p.remove();
  population = [];
}

// ---------- Genetic algorithm ----------
function crossoverWeights(wA, wB) {
  return wA.map((layerA, i) => {
    const layerB = wB[i];
    const child = new Float32Array(layerA.length);
    for (let j = 0; j < layerA.length; j++) {
      child[j] = Math.random() < 0.5 ? layerA[j] : layerB[j];
    }
    return child;
  });
}

function mutateWeights(weights, rate, std) {
  return weights.map(layer => {
    const mutated = new Float32Array(layer.length);
    for (let j = 0; j < layer.length; j++) {
      mutated[j] = layer[j];
      if (Math.random() < rate) {
        mutated[j] += gaussianRandom() * std;
      }
    }
    return mutated;
  });
}

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function evolve() {
  // Calculate fitness
  const fitnesses = population.map(p => p.calcFitness());

  // Sort by fitness descending
  const indices = fitnesses.map((f, i) => i);
  indices.sort((a, b) => fitnesses[b] - fitnesses[a]);

  const eliteCount = Math.max(2, Math.floor(CONFIG.POPULATION * CONFIG.ELITE_RATIO));
  const eliteIndices = indices.slice(0, eliteCount);

  // Track best
  const bestFit = fitnesses[indices[0]];
  const avgFit = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length;

  if (bestFit > bestEverFitness) {
    bestEverFitness = bestFit;
    bestEverGen = generation;
  }

  // Save elite weights
  const eliteWeights = eliteIndices.map(i => getWeights(population[i].brain));

  // Clear old population
  clearPopulation();

  // Create new population
  const groundY = H * CONFIG.GROUND_Y;
  const spacing = 120;
  const mutRate = CONFIG.MUTATION_RATE;
  const mutStd = CONFIG.MUTATION_STD;

  for (let i = 0; i < CONFIG.POPULATION; i++) {
    const x = 200 + i * spacing;
    const y = groundY - 60;

    let childWeights;
    if (i < eliteCount) {
      // Keep elite
      childWeights = eliteWeights[i];
    } else {
      // Crossover + mutation
      const pA = eliteWeights[Math.floor(Math.random() * eliteCount)];
      const pB = eliteWeights[Math.floor(Math.random() * eliteCount)];
      childWeights = mutateWeights(crossoverWeights(pA, pB), mutRate, mutStd);
    }

    const body = new SoftBody(x, y, null);
    setWeights(body.brain, childWeights);
    population.push(body);
  }

  generation++;
  evalTimer = 0;
  trailPoints = [];

  // Update UI
  document.getElementById('gen-info').textContent = `Gen: ${generation}`;
  document.getElementById('best-info').textContent = `Best: ${Math.round(bestFit)}px`;
  document.getElementById('avg-info').textContent = `Avg: ${Math.round(avgFit)}px`;

  // Flash effect
  showGenFlash(generation);
}

function showGenFlash(gen) {
  const el = document.getElementById('gen-flash');
  el.textContent = `Generation ${gen}`;
  el.classList.add('show');
  genFlashTimer = 90; // frames
}

// ---------- Camera ----------
function updateCamera() {
  if (population.length === 0) return;
  const target = population[focusedIndex];
  if (!target) return;
  const targetX = target.getCenterX() - W / 2;
  cameraX += (targetX - cameraX) * 0.08;
}

// ---------- Drawing ----------
function draw(time) {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(-cameraX, 0);

  // Ground
  const groundY = H * CONFIG.GROUND_Y;
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(cameraX - 100, groundY, W + 200, H - groundY + 100);

  // Ground surface line
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cameraX - 100, groundY);
  ctx.lineTo(cameraX + W + 100, groundY);
  ctx.stroke();

  // Trail of best individual
  if (trailPoints.length > 1) {
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.15)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(trailPoints[0].x, trailPoints[0].y);
    for (let i = 1; i < trailPoints.length; i++) {
      ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
    }
    ctx.stroke();
  }

  // Draw all soft bodies
  for (let i = 0; i < population.length; i++) {
    drawSoftBody(population[i], i === focusedIndex);
  }

  ctx.restore();

  // Generation flash
  if (genFlashTimer > 0) {
    genFlashTimer--;
    if (genFlashTimer <= 0) {
      document.getElementById('gen-flash').classList.remove('show');
    }
  }

  // FPS counter
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    currentFps = Math.round(frameCount * 1000 / (now - lastFpsTime));
    frameCount = 0;
    lastFpsTime = now;
    document.getElementById('fps-counter').textContent = `FPS:${currentFps}`;
  }
}

function drawSoftBody(body, isFocused) {
  const nodes = body.nodes;
  const color = body.getColor();

  // Draw muscles
  for (let i = 0; i < body.muscleConstraints.length; i++) {
    const c = body.muscleConstraints[i];
    const curLen = Vector.magnitude(
      Vector.sub(c.bodyA.position, c.bodyB.position)
    );
    const restLen = body.muscleRestLengths[i];
    const ratio = curLen / restLen;

    // Contracted = red, relaxed = blue
    let mr, mg, mb;
    if (ratio < 0.85) {
      mr = 255; mg = 80; mb = 80;   // contracted → red
    } else if (ratio > 1.0) {
      mr = 80; mg = 80; mb = 255;   // stretched → blue
    } else {
      const t = (ratio - 0.85) / 0.15;
      mr = Math.floor(255 * (1 - t) + 80 * t);
      mg = 80;
      mb = Math.floor(80 * (1 - t) + 255 * t);
    }

    const lineWidth = ratio < 0.9 ? 3 : 1.5;
    ctx.strokeStyle = `rgba(${mr},${mg},${mb},0.6)`;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(c.bodyA.position.x, c.bodyA.position.y);
    ctx.lineTo(c.bodyB.position.x, c.bodyB.position.y);
    ctx.stroke();
  }

  // Draw bones
  ctx.strokeStyle = 'rgba(200,200,200,0.3)';
  ctx.lineWidth = 1;
  for (const c of body.boneConstraints) {
    ctx.beginPath();
    ctx.moveTo(c.bodyA.position.x, c.bodyA.position.y);
    ctx.lineTo(c.bodyB.position.x, c.bodyB.position.y);
    ctx.stroke();
  }

  // Draw soft membrane (filled polygon)
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.moveTo(nodes[0].position.x, nodes[0].position.y);
  for (let i = 1; i < nodes.length; i++) {
    ctx.lineTo(nodes[i].position.x, nodes[i].position.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // Draw nodes
  for (const node of nodes) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.position.x, node.position.y, node.circleRadius || 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Focus ring
  if (isFocused) {
    const cx = body.getCenterX();
    const cy = body.getCenterY();
    ctx.strokeStyle = 'rgba(255,215,0,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ---------- Main loop ----------
let simTime = 0;

function mainLoop() {
  if (paused) {
    requestAnimationFrame(mainLoop);
    return;
  }

  const dt = 1 / 60;
  simTime += dt * timeScale;
  evalTimer += dt * timeScale;

  // Update each creature's muscles via neural net
  for (const body of population) {
    body.update(simTime);
  }

  // Find current best for camera
  let bestIdx = 0;
  let bestFit = -Infinity;
  for (let i = 0; i < population.length; i++) {
    const f = population[i].getCenterX() - population[i].startX;
    if (f > bestFit) {
      bestFit = f;
      bestIdx = i;
    }
  }
  focusedIndex = bestIdx;

  // Trail for best
  if (population[bestIdx]) {
    trailPoints.push({
      x: population[bestIdx].getCenterX(),
      y: population[bestIdx].getCenterY()
    });
    if (trailPoints.length > 100) trailPoints.shift();
  }

  updateCamera();
  draw(simTime);

  // Check if evaluation period is over
  if (evalTimer >= CONFIG.EVAL_SECONDS) {
    evolve();
  }

  requestAnimationFrame(mainLoop);
}

// ---------- UI event handlers ----------
function initUI() {
  // Pause button
  const btnPause = document.getElementById('btn-pause');
  btnPause.addEventListener('click', () => {
    paused = !paused;
    btnPause.textContent = paused ? '▶' : '⏸';
    btnPause.classList.toggle('active', paused);
    if (paused) {
      Runner.stop(runner);
    } else {
      Runner.run(runner, engine);
    }
  });

  // Speed button
  const btnSpeed = document.getElementById('btn-speed');
  btnSpeed.addEventListener('click', () => {
    if (timeScale === 1) {
      timeScale = 2;
      engine.timing.timeScale = 2;
      btnSpeed.classList.add('active');
    } else {
      timeScale = 1;
      engine.timing.timeScale = 1;
      btnSpeed.classList.remove('active');
    }
  });

  // Gravity slider
  const sliderGravity = document.getElementById('slider-gravity');
  const valGravity = document.getElementById('val-gravity');
  sliderGravity.addEventListener('input', () => {
    const v = parseFloat(sliderGravity.value);
    CONFIG.GRAVITY = v;
    engine.gravity.y = v;
    valGravity.textContent = v.toFixed(1);
  });

  // Friction slider
  const sliderFriction = document.getElementById('slider-friction');
  const valFriction = document.getElementById('val-friction');
  sliderFriction.addEventListener('input', () => {
    const v = parseFloat(sliderFriction.value);
    CONFIG.FRICTION = v;
    ground.friction = v;
    valFriction.textContent = v.toFixed(2);
  });

  // Mutation slider
  const sliderMutation = document.getElementById('slider-mutation');
  const valMutation = document.getElementById('val-mutation');
  sliderMutation.addEventListener('input', () => {
    const v = parseFloat(sliderMutation.value);
    CONFIG.MUTATION_RATE = v;
    valMutation.textContent = v.toFixed(2);
  });

  // Canvas tap — apply impulse or switch focus
  canvas.addEventListener('click', (e) => {
    if (mouseConstraint.body) return; // dragging something

    const worldX = e.clientX + cameraX;
    const worldY = e.clientY;

    // Check if tapped on a creature
    let tappedIdx = -1;
    for (let i = 0; i < population.length; i++) {
      const cx = population[i].getCenterX();
      const cy = population[i].getCenterY();
      const dx = worldX - cx;
      const dy = worldY - cy;
      if (Math.sqrt(dx * dx + dy * dy) < 50) {
        tappedIdx = i;
        break;
      }
    }

    if (tappedIdx >= 0) {
      focusedIndex = tappedIdx;
    } else {
      // Apply upward impulse to focused creature
      if (population[focusedIndex]) {
        for (const node of population[focusedIndex].nodes) {
          Body.applyForce(node, node.position, { x: 0, y: -0.05 });
        }
      }
    }
  });
}

// ---------- Init ----------
function init() {
  initCanvas();
  initPhysics();
  initUI();
  createPopulation();
  document.getElementById('gen-info').textContent = `Gen: ${generation}`;
  requestAnimationFrame(mainLoop);
}

// Wait for libs to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
