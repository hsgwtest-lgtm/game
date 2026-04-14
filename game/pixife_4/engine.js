/**
 * PixiLife 4 — Evolutionary AI Sandbox
 * 進化する人工生命サンドボックスゲーム
 *
 * Architecture:
 *   World (terrain, food, pheromones, seasons)
 *   Brain (neural network per creature)
 *   Creature (genome, behavior, energy, reproduction)
 *   Renderer (offscreen canvas, zoom/pan)
 *   Simulation (main loop, stats)
 *   UI (god-mode tools, info, graphs)
 */

// ═══════════════════════════════════════════
// ██ Constants
// ═══════════════════════════════════════════

const W = 320;                 // World width (logical pixels)
const H = 240;                 // World height (logical pixels)
const MAX_CREATURES = 800;     // Hard cap
const INITIAL_POP = 80;        // Starting population
const FOOD_ENERGY = 35;        // Energy from eating food
const WATER_ENERGY = 15;       // Energy from drinking water
const REPRODUCE_COST = 100;    // Energy to reproduce
const INITIAL_ENERGY = 60;     // Starting energy
const STARVE_RATE = 0.1;       // Energy loss per tick
const MAX_AGE = 4000;          // Maximum lifespan (ticks)
const MUTATION_RATE = 0.15;    // Per-weight mutation probability
const MUTATION_MAG = 0.35;     // Mutation magnitude
const PHEROMONE_DECAY = 0.992; // Pheromone fade per tick
const FOOD_REGEN_RATE = 0.003; // Probability of food spawn per empty cell per tick
const MAX_FOOD = 2000;         // Food cap
const NEST_RADIUS = 6;         // Nest influence radius
const INPUT_SIZE = 20;         // Neural net inputs
const HIDDEN_SIZE = 12;        // Hidden neurons
const OUTPUT_SIZE = 8;         // Neural net outputs
const NUM_SPECIES = 5;         // Number of species
const SEASON_LENGTH = 1200;    // Ticks per season

// Terrain types
const TILE_EMPTY = 0;
const TILE_WALL = 1;
const TILE_WATER = 2;
const TILE_DANGER = 3;

// Pheromone channels
const PHER_FOOD = 0;
const PHER_DANGER = 1;
const PHER_CHANNELS = 2;

// Species colors (warm pixel art palette)
const SPECIES_COLORS = [
  [255, 120, 80],   // 赤系 (gatherer)
  [80, 200, 120],   // 緑系 (explorer)
  [100, 140, 255],  // 青系 (defender)
  [255, 200, 60],   // 金系 (builder)
  [200, 100, 255],  // 紫系 (scavenger)
];

const SPECIES_NAMES = ['採集族', '探索族', '防衛族', '建設族', '清掃族'];

const STRATEGIES = ['gatherer', 'explorer', 'defender', 'builder', 'scavenger'];

// Seasons
const SEASONS = [
  { name: '🌸 春', foodMul: 1.2, tempMul: 1.0, color: [60, 100, 40] },
  { name: '☀️ 夏', foodMul: 1.5, tempMul: 1.3, color: [80, 110, 30] },
  { name: '🍂 秋', foodMul: 0.8, tempMul: 0.9, color: [90, 70, 30] },
  { name: '❄️ 冬', foodMul: 0.3, tempMul: 0.5, color: [40, 50, 70] },
];


// ═══════════════════════════════════════════
// ██ Utility Functions
// ═══════════════════════════════════════════

/** Simplex-like noise for terrain generation */
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** 2D value noise for terrain */
function generateNoise(w, h, scale, seed) {
  const rng = seededRandom(seed);
  // Generate grid of random values
  const gw = Math.ceil(w / scale) + 2;
  const gh = Math.ceil(h / scale) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();

  const result = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / scale;
      const fy = y / scale;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      // Smoothstep
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const i00 = iy * gw + ix;
      const v00 = grid[i00] || 0;
      const v10 = grid[i00 + 1] || 0;
      const v01 = grid[i00 + gw] || 0;
      const v11 = grid[i00 + gw + 1] || 0;
      result[y * w + x] = (v00 * (1 - sx) + v10 * sx) * (1 - sy) +
                           (v01 * (1 - sx) + v11 * sx) * sy;
    }
  }
  return result;
}

/** Distance between two points */
function dist(x1, y1, x2, y2) {
  const dx = x1 - x2, dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Clamp value */
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** ReLU activation */
function relu(x) { return x > 0 ? x : 0; }

/** Tanh activation */
function tanh(x) { return Math.tanh(x); }

/** Sigmoid activation */
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }


// ═══════════════════════════════════════════
// ██ Brain — Neural Network
// ═══════════════════════════════════════════

class Brain {
  /**
   * Two-layer feedforward network
   * Input → Hidden (tanh) → Output (mixed activations)
   */
  constructor() {
    // Layer 1: Input→Hidden
    this.w1 = new Float32Array(INPUT_SIZE * HIDDEN_SIZE);
    this.b1 = new Float32Array(HIDDEN_SIZE);
    // Layer 2: Hidden→Output
    this.w2 = new Float32Array(HIDDEN_SIZE * OUTPUT_SIZE);
    this.b2 = new Float32Array(OUTPUT_SIZE);
    this.randomize();
  }

  /** Initialize with small random weights */
  randomize() {
    const r = () => (Math.random() - 0.5) * 1.2;
    for (let i = 0; i < this.w1.length; i++) this.w1[i] = r();
    for (let i = 0; i < this.b1.length; i++) this.b1[i] = r() * 0.3;
    for (let i = 0; i < this.w2.length; i++) this.w2[i] = r();
    for (let i = 0; i < this.b2.length; i++) this.b2[i] = r() * 0.3;
  }

  /**
   * Forward pass
   * @param {Float32Array} input - INPUT_SIZE values
   * @returns {Float32Array} OUTPUT_SIZE values
   */
  forward(input) {
    // Hidden layer with tanh
    const hidden = new Float32Array(HIDDEN_SIZE);
    for (let h = 0; h < HIDDEN_SIZE; h++) {
      let sum = this.b1[h];
      for (let i = 0; i < INPUT_SIZE; i++) {
        sum += input[i] * this.w1[i * HIDDEN_SIZE + h];
      }
      hidden[h] = tanh(sum);
    }
    // Output layer
    const output = new Float32Array(OUTPUT_SIZE);
    for (let o = 0; o < OUTPUT_SIZE; o++) {
      let sum = this.b2[o];
      for (let h = 0; h < HIDDEN_SIZE; h++) {
        sum += hidden[h] * this.w2[h * OUTPUT_SIZE + o];
      }
      // 0-1: movement (tanh), 2-7: actions (sigmoid)
      output[o] = o < 2 ? tanh(sum) : sigmoid(sum);
    }
    return output;
  }

  /** Create a mutated clone */
  clone() {
    const child = new Brain();
    child.w1.set(this.w1);
    child.b1.set(this.b1);
    child.w2.set(this.w2);
    child.b2.set(this.b2);
    child.mutate();
    return child;
  }

  /** Apply mutations to weights */
  mutate() {
    const mutArr = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        if (Math.random() < MUTATION_RATE) {
          arr[i] += (Math.random() - 0.5) * MUTATION_MAG * 2;
          arr[i] = clamp(arr[i], -3, 3);
        }
      }
    };
    mutArr(this.w1);
    mutArr(this.b1);
    mutArr(this.w2);
    mutArr(this.b2);
  }

  /** Crossover with another brain */
  crossover(other) {
    const child = new Brain();
    const cross = (a, b, out) => {
      const point = Math.floor(Math.random() * a.length);
      for (let i = 0; i < a.length; i++) {
        out[i] = i < point ? a[i] : b[i];
      }
    };
    cross(this.w1, other.w1, child.w1);
    cross(this.b1, other.b1, child.b1);
    cross(this.w2, other.w2, child.w2);
    cross(this.b2, other.b2, child.b2);
    child.mutate();
    return child;
  }
}


// ═══════════════════════════════════════════
// ██ Genome — Genetic Parameters
// ═══════════════════════════════════════════

class Genome {
  constructor() {
    this.speed = 0.8 + Math.random() * 0.8;       // 0.8–1.6
    this.senseRange = 15 + Math.random() * 25;     // 15–40
    this.size = 1;                                   // Visual size
    this.attackPower = 0.3 + Math.random() * 0.7;  // 0.3–1.0
    this.defense = 0.3 + Math.random() * 0.7;      // 0.3–1.0
    this.efficiency = 0.7 + Math.random() * 0.6;   // Food conversion
    this.reproductionAge = 300 + Math.random() * 400;
    this.colorShift = Math.random() * 40 - 20;     // Variation within species
  }

  clone() {
    const g = new Genome();
    g.speed = this.speed;
    g.senseRange = this.senseRange;
    g.size = this.size;
    g.attackPower = this.attackPower;
    g.defense = this.defense;
    g.efficiency = this.efficiency;
    g.reproductionAge = this.reproductionAge;
    g.colorShift = this.colorShift;
    return g;
  }

  mutate() {
    const m = (v, lo, hi) => clamp(v + (Math.random() - 0.5) * 0.2, lo, hi);
    this.speed = m(this.speed, 0.3, 2.5);
    this.senseRange = m(this.senseRange * 0.1, 0.5, 6) * 10;
    this.attackPower = m(this.attackPower, 0.1, 2.0);
    this.defense = m(this.defense, 0.1, 2.0);
    this.efficiency = m(this.efficiency, 0.3, 1.5);
    this.reproductionAge = m(this.reproductionAge * 0.01, 1, 10) * 100;
    this.colorShift = m(this.colorShift, -40, 40);
  }

  crossover(other) {
    const child = new Genome();
    const pick = () => Math.random() < 0.5;
    child.speed = pick() ? this.speed : other.speed;
    child.senseRange = pick() ? this.senseRange : other.senseRange;
    child.attackPower = pick() ? this.attackPower : other.attackPower;
    child.defense = pick() ? this.defense : other.defense;
    child.efficiency = pick() ? this.efficiency : other.efficiency;
    child.reproductionAge = pick() ? this.reproductionAge : other.reproductionAge;
    child.colorShift = (this.colorShift + other.colorShift) / 2;
    child.mutate();
    return child;
  }
}


// ═══════════════════════════════════════════
// ██ Creature — Living Entity
// ═══════════════════════════════════════════

let creatureIdCounter = 0;

class Creature {
  constructor(x, y, species, brain, genome) {
    this.id = creatureIdCounter++;
    this.x = x;
    this.y = y;
    this.species = species;        // 0–4
    this.brain = brain || new Brain();
    this.genome = genome || new Genome();
    this.energy = INITIAL_ENERGY;
    this.age = 0;
    this.alive = true;
    this.carrying = false;         // Carrying food to nest
    this.foodCarried = 0;
    this.generation = 0;
    this.fitness = 0;
    this.state = 'wander';         // wander, forage, attack, flee, build, return
    this.nestX = -1;
    this.nestY = -1;
    this.kills = 0;
    this.offspring = 0;
    this.role = STRATEGIES[species]; // Default role from species
  }

  /** Build neural network input vector from surroundings */
  sense(world) {
    const inp = new Float32Array(INPUT_SIZE);
    const sr = this.genome.senseRange;

    // [0-1] Nearest food direction
    let nearFoodD = sr + 1, nearFoodX = 0, nearFoodY = 0;
    // [2-3] Nearest nest direction
    // [4] Carrying food
    // [5] Energy (normalized)
    // [6-7] Nearest enemy direction + distance
    // [8-9] Nearest ally direction + distance
    // [10-11] Pheromone food/danger at current pos
    // [12] Wall proximity
    // [13] Water proximity
    // [14] Season food multiplier
    // [15] Species bias
    // [16] Age normalized
    // [17] Population density nearby
    // [18-19] Gradient of pheromone (food trail direction)

    // Scan nearby area
    let nearEnemyD = sr + 1, nearEnemyX = 0, nearEnemyY = 0;
    let nearAllyD = sr + 1, nearAllyX = 0, nearAllyY = 0;
    let nearbyCount = 0;

    const scanR = Math.ceil(sr);
    const cx = Math.round(this.x), cy = Math.round(this.y);

    // Check food grid
    for (let dy = -scanR; dy <= scanR; dy += 2) {
      for (let dx = -scanR; dx <= scanR; dx += 2) {
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
        if (world.food[ty * W + tx] > 0) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < nearFoodD) {
            nearFoodD = d;
            nearFoodX = dx;
            nearFoodY = dy;
          }
        }
      }
    }

    // Check creatures (spatial hash)
    const neighbors = world.getNeighbors(this.x, this.y, sr);
    for (const other of neighbors) {
      if (other.id === this.id || !other.alive) continue;
      const d = dist(this.x, this.y, other.x, other.y);
      if (d > sr) continue;
      nearbyCount++;
      if (other.species !== this.species) {
        if (d < nearEnemyD) {
          nearEnemyD = d;
          nearEnemyX = other.x - this.x;
          nearEnemyY = other.y - this.y;
        }
      } else {
        if (d < nearAllyD) {
          nearAllyD = d;
          nearAllyX = other.x - this.x;
          nearAllyY = other.y - this.y;
        }
      }
    }

    // Normalize directions
    const norm = (x, y) => {
      const m = Math.sqrt(x * x + y * y) || 1;
      return [x / m, y / m];
    };

    const [fdx, fdy] = norm(nearFoodX, nearFoodY);
    inp[0] = nearFoodD <= sr ? fdx : 0;
    inp[1] = nearFoodD <= sr ? fdy : 0;

    // Nest direction
    if (this.nestX >= 0) {
      const [ndx, ndy] = norm(this.nestX - this.x, this.nestY - this.y);
      inp[2] = ndx;
      inp[3] = ndy;
    }

    inp[4] = this.carrying ? 1 : 0;
    inp[5] = clamp(this.energy / 200, 0, 1);

    // Enemy
    if (nearEnemyD <= sr) {
      const [edx, edy] = norm(nearEnemyX, nearEnemyY);
      inp[6] = edx;
      inp[7] = edy;
    }

    // Ally
    if (nearAllyD <= sr) {
      const [adx, ady] = norm(nearAllyX, nearAllyY);
      inp[8] = adx;
      inp[9] = ady;
    }

    // Pheromones at current position
    const pi = cy * W + cx;
    if (cx >= 0 && cx < W && cy >= 0 && cy < H) {
      inp[10] = clamp(world.pheromones[PHER_FOOD * W * H + pi], 0, 1);
      inp[11] = clamp(world.pheromones[PHER_DANGER * W * H + pi], 0, 1);
    }

    // Wall proximity (check 4 directions)
    let wallProx = 0;
    for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const wx = cx + ddx * 2, wy = cy + ddy * 2;
      if (wx < 0 || wx >= W || wy < 0 || wy >= H || world.terrain[wy * W + wx] === TILE_WALL) {
        wallProx += 0.25;
      }
    }
    inp[12] = wallProx;

    // Water proximity
    let waterProx = 0;
    for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const wx = cx + ddx * 3, wy = cy + ddy * 3;
      if (wx >= 0 && wx < W && wy >= 0 && wy < H && world.terrain[wy * W + wx] === TILE_WATER) {
        waterProx += 0.25;
      }
    }
    inp[13] = waterProx;

    inp[14] = world.seasonMultiplier;
    inp[15] = this.species / NUM_SPECIES;
    inp[16] = clamp(this.age / MAX_AGE, 0, 1);
    inp[17] = clamp(nearbyCount / 10, 0, 1);

    // Pheromone gradient (food trail direction)
    let pgx = 0, pgy = 0;
    if (cx > 0 && cx < W - 1 && cy > 0 && cy < H - 1) {
      pgx = (world.pheromones[PHER_FOOD * W * H + cy * W + cx + 1] -
             world.pheromones[PHER_FOOD * W * H + cy * W + cx - 1]);
      pgy = (world.pheromones[PHER_FOOD * W * H + (cy + 1) * W + cx] -
             world.pheromones[PHER_FOOD * W * H + (cy - 1) * W + cx]);
    }
    inp[18] = clamp(pgx * 5, -1, 1);
    inp[19] = clamp(pgy * 5, -1, 1);

    return inp;
  }

  /**
   * Think & act using neural network
   * Outputs:
   *  [0] dx movement
   *  [1] dy movement
   *  [2] pickup/eat action
   *  [3] drop/deliver action
   *  [4] attack action
   *  [5] reproduce action
   *  [6] build action
   *  [7] pheromone deposit
   */
  act(world) {
    const input = this.sense(world);
    const out = this.brain.forward(input);

    // Movement
    let dx = out[0] * this.genome.speed;
    let dy = out[1] * this.genome.speed;

    // Strategy modifiers
    if (this.role === 'gatherer' && this.carrying && this.nestX >= 0) {
      // Bias toward nest when carrying
      const ndx = this.nestX - this.x, ndy = this.nestY - this.y;
      const nd = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
      dx += (ndx / nd) * 0.4;
      dy += (ndy / nd) * 0.4;
    } else if (this.role === 'explorer') {
      // Random exploration bonus
      if (Math.random() < 0.12) {
        dx += (Math.random() - 0.5) * 1.5;
        dy += (Math.random() - 0.5) * 1.5;
      }
    }

    // Apply movement
    let nx = this.x + dx;
    let ny = this.y + dy;

    // Wrap or clamp
    nx = ((nx % W) + W) % W;
    ny = ((ny % H) + H) % H;

    // Collision check
    const tileIdx = Math.round(ny) * W + Math.round(nx);
    if (tileIdx >= 0 && tileIdx < W * H && world.terrain[tileIdx] !== TILE_WALL) {
      this.x = nx;
      this.y = ny;
    }

    const ix = Math.round(this.x), iy = Math.round(this.y);
    const idx = iy * W + ix;

    // Water interaction: drink for energy
    if (ix >= 0 && ix < W && iy >= 0 && iy < H && world.terrain[idx] === TILE_WATER) {
      this.energy += WATER_ENERGY * 0.05;
    }

    // Danger zone damage
    if (ix >= 0 && ix < W && iy >= 0 && iy < H && world.terrain[idx] === TILE_DANGER) {
      this.energy -= 2;
    }

    // Pickup food
    if (out[2] > 0.5 && !this.carrying) {
      if (ix >= 0 && ix < W && iy >= 0 && iy < H && world.food[idx] > 0) {
        world.food[idx]--;
        world.totalFood--;
        this.energy += FOOD_ENERGY * this.genome.efficiency;
        this.carrying = true;
        this.foodCarried++;
        this.fitness += 5;
        // Deposit food pheromone
        world.depositPheromone(ix, iy, PHER_FOOD, 0.8);
      }
    }

    // Drop food at nest (delivery)
    if (out[3] > 0.5 && this.carrying && this.nestX >= 0) {
      if (dist(this.x, this.y, this.nestX, this.nestY) < NEST_RADIUS) {
        this.carrying = false;
        this.fitness += 15;
        // Add food to nest storage
        const nestId = `${this.species}`;
        if (world.nests[nestId]) world.nests[nestId].food++;
      }
    }

    // Attack nearby enemy
    if (out[4] > 0.6 && this.role !== 'builder') {
      const enemies = world.getNeighbors(this.x, this.y, 3);
      for (const enemy of enemies) {
        if (enemy.species !== this.species && enemy.alive && enemy.id !== this.id) {
          const d = dist(this.x, this.y, enemy.x, enemy.y);
          if (d < 2.5) {
            const dmg = this.genome.attackPower * 8;
            const def = enemy.genome.defense * 4;
            enemy.energy -= Math.max(dmg - def, 1);
            this.energy -= 2; // Attack costs energy
            if (enemy.energy <= 0) {
              enemy.alive = false;
              this.kills++;
              this.energy += 20; // Predation bonus
              this.fitness += 10;
              // Deposit danger pheromone
              world.depositPheromone(Math.round(enemy.x), Math.round(enemy.y), PHER_DANGER, 1.0);
            }
            break;
          }
        }
      }
    }

    // Reproduce
    if (out[5] > 0.65 && this.energy > REPRODUCE_COST && this.age > this.genome.reproductionAge &&
        world.creatures.length < MAX_CREATURES) {
      this.reproduce(world);
    }

    // Build (place wall near nest)
    if (out[6] > 0.7 && this.role === 'builder' && this.nestX >= 0 &&
        dist(this.x, this.y, this.nestX, this.nestY) < NEST_RADIUS + 3) {
      const bx = Math.round(this.x + (Math.random() - 0.5) * 4);
      const by = Math.round(this.y + (Math.random() - 0.5) * 4);
      if (bx >= 0 && bx < W && by >= 0 && by < H &&
          world.terrain[by * W + bx] === TILE_EMPTY &&
          world.food[by * W + bx] === 0) {
        world.terrain[by * W + bx] = TILE_WALL;
        this.energy -= 5;
        this.fitness += 3;
      }
    }

    // Pheromone deposit while moving
    if (out[7] > 0.4 && ix >= 0 && ix < W && iy >= 0 && iy < H) {
      const channel = this.carrying ? PHER_FOOD : PHER_DANGER;
      world.depositPheromone(ix, iy, channel, 0.3);
    }

    // Age and energy costs
    this.age++;
    this.energy -= STARVE_RATE * (1 + this.genome.speed * 0.3);
    this.fitness += 0.01; // Survival fitness

    // Death
    if (this.energy <= 0 || this.age >= MAX_AGE) {
      this.alive = false;
    }
  }

  /** Reproduce — create offspring */
  reproduce(world) {
    this.energy -= REPRODUCE_COST * 0.6;

    let childBrain, childGenome;

    // Try sexual reproduction with nearby ally
    const allies = world.getNeighbors(this.x, this.y, 8);
    let mate = null;
    for (const a of allies) {
      if (a.species === this.species && a.id !== this.id && a.alive &&
          a.energy > REPRODUCE_COST * 0.4 && a.age > a.genome.reproductionAge) {
        mate = a;
        break;
      }
    }

    if (mate && Math.random() < 0.7) {
      // Sexual reproduction (crossover)
      childBrain = this.brain.crossover(mate.brain);
      childGenome = this.genome.crossover(mate.genome);
      mate.energy -= REPRODUCE_COST * 0.3;
    } else {
      // Asexual reproduction (clone + mutate)
      childBrain = this.brain.clone();
      childGenome = this.genome.clone();
      childGenome.mutate();
    }

    const child = new Creature(
      this.x + (Math.random() - 0.5) * 4,
      this.y + (Math.random() - 0.5) * 4,
      this.species,
      childBrain,
      childGenome
    );
    child.generation = this.generation + 1;
    child.energy = INITIAL_ENERGY * 0.8;
    child.nestX = this.nestX;
    child.nestY = this.nestY;
    child.role = this.role;

    // Small chance of species mutation (speciation)
    if (Math.random() < 0.02) {
      child.species = Math.floor(Math.random() * NUM_SPECIES);
      child.role = STRATEGIES[child.species];
    }

    world.creatures.push(child);
    this.offspring++;
    this.fitness += 8;
  }
}


// ═══════════════════════════════════════════
// ██ World — Environment
// ═══════════════════════════════════════════

class World {
  constructor() {
    this.terrain = new Uint8Array(W * H);        // Tile types
    this.food = new Uint8Array(W * H);           // Food amount per cell
    this.pheromones = new Float32Array(PHER_CHANNELS * W * H); // Pheromone channels
    this.creatures = [];
    this.nests = {};                              // { speciesId: { x, y, food } }
    this.tick = 0;
    this.generation = 0;
    this.totalFood = 0;
    this.season = 0;                              // 0-3
    this.seasonMultiplier = 1;
    this.climate = 1.0;                           // Climate modifier (god mode)
    this.spatialHash = new Map();                 // For neighbor queries
    this.hashCellSize = 8;

    // Stats tracking
    this.popHistory = [];                         // Population over time
    this.speciesHistory = [];                     // Per-species population
    this.maxGeneration = 0;

    this.generate();
  }

  /** Generate terrain using noise */
  generate() {
    const seed = Date.now();
    const elevation = generateNoise(W, H, 20, seed);
    const moisture = generateNoise(W, H, 30, seed + 1000);

    for (let i = 0; i < W * H; i++) {
      const e = elevation[i];
      const m = moisture[i];

      if (e < 0.15) {
        this.terrain[i] = TILE_WATER;
      } else if (e > 0.85) {
        this.terrain[i] = TILE_WALL; // Mountains
      } else if (e > 0.78 && m < 0.3) {
        this.terrain[i] = TILE_DANGER; // Volcanic/danger zones
      } else {
        this.terrain[i] = TILE_EMPTY;
      }
    }

    // Spawn initial food
    this.spawnFood(600);

    // Spawn creatures
    this.spawnInitialCreatures();

    // Create nests
    this.createNests();
  }

  /** Spawn food on empty tiles */
  spawnFood(count) {
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 5) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H);
      const idx = y * W + x;
      if (this.terrain[idx] === TILE_EMPTY && this.food[idx] === 0) {
        this.food[idx] = 1;
        this.totalFood++;
        placed++;
      }
      attempts++;
    }
  }

  /** Create initial population */
  spawnInitialCreatures() {
    for (let i = 0; i < INITIAL_POP; i++) {
      let x, y, idx;
      // Find valid spawn position
      do {
        x = Math.random() * W;
        y = Math.random() * H;
        idx = Math.round(y) * W + Math.round(x);
      } while (idx < 0 || idx >= W * H || this.terrain[idx] === TILE_WALL || this.terrain[idx] === TILE_WATER);

      const species = i % NUM_SPECIES;
      const c = new Creature(x, y, species);
      c.role = STRATEGIES[species];
      this.creatures.push(c);
    }
  }

  /** Create nests for each species */
  createNests() {
    for (let s = 0; s < NUM_SPECIES; s++) {
      let x, y, idx;
      do {
        x = 30 + Math.random() * (W - 60);
        y = 30 + Math.random() * (H - 60);
        idx = Math.round(y) * W + Math.round(x);
      } while (this.terrain[idx] !== TILE_EMPTY);

      this.nests[`${s}`] = { x, y, food: 0 };

      // Assign nest to creatures of this species
      for (const c of this.creatures) {
        if (c.species === s) {
          c.nestX = x;
          c.nestY = y;
        }
      }
    }
  }

  /** Update spatial hash for fast neighbor queries */
  updateSpatialHash() {
    this.spatialHash.clear();
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const hx = Math.floor(c.x / this.hashCellSize);
      const hy = Math.floor(c.y / this.hashCellSize);
      const key = hx + hy * 1000;
      if (!this.spatialHash.has(key)) this.spatialHash.set(key, []);
      this.spatialHash.get(key).push(c);
    }
  }

  /** Get creatures near a position */
  getNeighbors(x, y, range) {
    const results = [];
    const r = Math.ceil(range / this.hashCellSize);
    const hx0 = Math.floor(x / this.hashCellSize);
    const hy0 = Math.floor(y / this.hashCellSize);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const key = (hx0 + dx) + (hy0 + dy) * 1000;
        const cell = this.spatialHash.get(key);
        if (cell) {
          for (const c of cell) results.push(c);
        }
      }
    }
    return results;
  }

  /** Deposit pheromone */
  depositPheromone(x, y, channel, strength) {
    const spread = 2;
    for (let dy = -spread; dy <= spread; dy++) {
      for (let dx = -spread; dx <= spread; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        const falloff = Math.max(0, strength * (1 - d / (spread + 1)));
        const pi = channel * W * H + py * W + px;
        this.pheromones[pi] = Math.min(this.pheromones[pi] + falloff, 1);
      }
    }
  }

  /** Main world update tick */
  update() {
    this.tick++;

    // Season update
    const newSeason = Math.floor(this.tick / SEASON_LENGTH) % 4;
    if (newSeason !== this.season) {
      this.season = newSeason;
    }
    this.seasonMultiplier = SEASONS[this.season].foodMul * this.climate;

    // Food regeneration
    if (this.totalFood < MAX_FOOD * this.seasonMultiplier) {
      const regenChance = FOOD_REGEN_RATE * this.seasonMultiplier;
      const attempts = Math.ceil(W * H * regenChance * 0.01);
      for (let i = 0; i < attempts; i++) {
        const x = Math.floor(Math.random() * W);
        const y = Math.floor(Math.random() * H);
        const idx = y * W + x;
        if (this.terrain[idx] === TILE_EMPTY && this.food[idx] === 0) {
          this.food[idx] = 1;
          this.totalFood++;
        }
      }
    }

    // Pheromone decay
    for (let i = 0; i < this.pheromones.length; i++) {
      this.pheromones[i] *= PHEROMONE_DECAY;
      if (this.pheromones[i] < 0.001) this.pheromones[i] = 0;
    }

    // Update spatial hash
    this.updateSpatialHash();

    // Update all creatures
    for (const c of this.creatures) {
      if (c.alive) c.act(this);
    }

    // Remove dead creatures
    this.creatures = this.creatures.filter(c => c.alive);

    // Track max generation
    for (const c of this.creatures) {
      if (c.generation > this.maxGeneration) this.maxGeneration = c.generation;
    }

    // Auto-repopulate if population too low
    if (this.creatures.length < 10) {
      for (let i = 0; i < 20; i++) {
        let x, y, idx;
        do {
          x = Math.random() * W;
          y = Math.random() * H;
          idx = Math.round(y) * W + Math.round(x);
        } while (idx < 0 || idx >= W * H || this.terrain[idx] !== TILE_EMPTY);
        const species = Math.floor(Math.random() * NUM_SPECIES);
        const c = new Creature(x, y, species);
        c.generation = this.maxGeneration;
        const nest = this.nests[`${species}`];
        if (nest) { c.nestX = nest.x; c.nestY = nest.y; }
        this.creatures.push(c);
      }
    }

    // Stats (every 30 ticks)
    if (this.tick % 30 === 0) {
      this.popHistory.push(this.creatures.length);
      if (this.popHistory.length > 200) this.popHistory.shift();

      const specCounts = new Array(NUM_SPECIES).fill(0);
      for (const c of this.creatures) specCounts[c.species]++;
      this.speciesHistory.push(specCounts);
      if (this.speciesHistory.length > 200) this.speciesHistory.shift();
    }
  }
}


// ═══════════════════════════════════════════
// ██ Renderer — Canvas Rendering with Zoom
// ═══════════════════════════════════════════

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Offscreen buffer at world resolution
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = W;
    this.offscreen.height = H;
    this.offCtx = this.offscreen.getContext('2d');
    this.imgData = this.offCtx.createImageData(W, H);
    this.buf = new Uint32Array(this.imgData.data.buffer);

    // Camera (zoom & pan)
    this.camX = W / 2;
    this.camY = H / 2;
    this.zoom = 1;      // 1 = fit screen
    this.minZoom = 0.5;
    this.maxZoom = 8;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Convert screen coords to world coords */
  screenToWorld(sx, sy) {
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.width / dpr;
    const ch = this.canvas.height / dpr;
    const scale = Math.min(cw / W, ch / H) * this.zoom;
    const ox = cw / 2 - this.camX * scale;
    const oy = ch / 2 - this.camY * scale;
    return {
      x: (sx - ox) / scale,
      y: (sy - oy) / scale,
    };
  }

  /** Render the world */
  render(world, time) {
    const buf = this.buf;
    const season = SEASONS[world.season];

    // Clear buffer
    for (let i = 0; i < buf.length; i++) buf[i] = 0;

    // Draw terrain
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const tile = world.terrain[idx];
        let r, g, b;

        if (tile === TILE_EMPTY) {
          // Ground with seasonal color
          const base = season.color;
          r = base[0] + Math.floor(Math.random() * 4);
          g = base[1] + Math.floor(Math.random() * 4);
          b = base[2];
        } else if (tile === TILE_WATER) {
          // Water with shimmer
          const shimmer = Math.sin(time * 0.003 + x * 0.3 + y * 0.2) * 15;
          r = 30 + shimmer;
          g = 60 + shimmer;
          b = 140 + shimmer;
        } else if (tile === TILE_WALL) {
          r = 80; g = 70; b = 60;
        } else if (tile === TILE_DANGER) {
          const pulse = Math.sin(time * 0.005 + x + y) * 20;
          r = 120 + pulse; g = 30; b = 20;
        }

        buf[idx] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
    }

    // Draw pheromones (additive blend)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const pf = world.pheromones[PHER_FOOD * W * H + idx];
        const pd = world.pheromones[PHER_DANGER * W * H + idx];

        if (pf > 0.01 || pd > 0.01) {
          const existing = buf[idx];
          let r = existing & 0xFF;
          let g = (existing >> 8) & 0xFF;
          let b = (existing >> 16) & 0xFF;

          // Food pheromone = green tint
          if (pf > 0.01) {
            g = Math.min(255, g + Math.floor(pf * 60));
            b = Math.min(255, b + Math.floor(pf * 20));
          }
          // Danger pheromone = red tint
          if (pd > 0.01) {
            r = Math.min(255, r + Math.floor(pd * 80));
          }

          buf[idx] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
    }

    // Draw food
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (world.food[idx] > 0) {
          const pulse = 0.8 + Math.sin(time * 0.004 + x + y) * 0.2;
          const r = Math.floor(180 * pulse);
          const g = Math.floor(220 * pulse);
          const b = Math.floor(60 * pulse);
          buf[idx] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
    }

    // Draw nests
    for (const [key, nest] of Object.entries(world.nests)) {
      const species = parseInt(key);
      const col = SPECIES_COLORS[species];
      const nx = Math.round(nest.x), ny = Math.round(nest.y);
      for (let dy = -NEST_RADIUS; dy <= NEST_RADIUS; dy++) {
        for (let dx = -NEST_RADIUS; dx <= NEST_RADIUS; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > NEST_RADIUS) continue;
          const px = nx + dx, py = ny + dy;
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          const alpha = (1 - d / NEST_RADIUS) * 0.25;
          const idx = py * W + px;
          const existing = buf[idx];
          let r = existing & 0xFF;
          let g = (existing >> 8) & 0xFF;
          let b = (existing >> 16) & 0xFF;
          r = Math.min(255, r + Math.floor(col[0] * alpha));
          g = Math.min(255, g + Math.floor(col[1] * alpha));
          b = Math.min(255, b + Math.floor(col[2] * alpha));
          buf[idx] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
    }

    // Draw creatures
    for (const c of world.creatures) {
      if (!c.alive) continue;
      const px = Math.round(c.x), py = Math.round(c.y);
      if (px < 0 || px >= W || py < 0 || py >= H) continue;

      const col = SPECIES_COLORS[c.species];
      const brightness = clamp(c.energy / 100, 0.3, 1.0);
      const shift = c.genome.colorShift;
      let r = clamp(Math.floor((col[0] + shift) * brightness), 0, 255);
      let g = clamp(Math.floor((col[1] + shift * 0.5) * brightness), 0, 255);
      let b = clamp(Math.floor((col[2] - shift * 0.3) * brightness), 0, 255);

      // Carrying indicator: brighter
      if (c.carrying) {
        r = Math.min(255, r + 40);
        g = Math.min(255, g + 40);
      }

      buf[py * W + px] = (255 << 24) | (b << 16) | (g << 8) | r;

      // Larger creatures draw more pixels
      if (c.genome.size > 1 || c.energy > 150) {
        for (const [ddx, ddy] of [[1,0],[0,1],[-1,0],[0,-1]]) {
          const ex = px + ddx, ey = py + ddy;
          if (ex >= 0 && ex < W && ey >= 0 && ey < H) {
            const ri = Math.floor(r * 0.7), gi = Math.floor(g * 0.7), bi = Math.floor(b * 0.7);
            buf[ey * W + ex] = (255 << 24) | (bi << 16) | (gi << 8) | ri;
          }
        }
      }
    }

    // Put image data to offscreen canvas
    this.offCtx.putImageData(this.imgData, 0, 0);

    // Draw offscreen to main canvas with zoom
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.width / dpr;
    const ch = this.canvas.height / dpr;
    const scale = Math.min(cw / W, ch / H) * this.zoom;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.fillStyle = '#0a0a1a';
    this.ctx.fillRect(0, 0, cw, ch);

    const ox = cw / 2 - this.camX * scale;
    const oy = ch / 2 - this.camY * scale;
    this.ctx.drawImage(this.offscreen, ox, oy, W * scale, H * scale);
  }

  /** Render minimap */
  renderMinimap(world, minimapCanvas) {
    const mctx = minimapCanvas.getContext('2d');
    const mw = minimapCanvas.width, mh = minimapCanvas.height;
    const mid = mctx.createImageData(mw, mh);
    const mbuf = new Uint32Array(mid.data.buffer);

    const sx = W / mw, sy = H / mh;

    // Terrain
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const wx = Math.floor(x * sx), wy = Math.floor(y * sy);
        const tile = world.terrain[wy * W + wx];
        let r = 30, g = 40, b = 25;
        if (tile === TILE_WATER) { r = 20; g = 40; b = 100; }
        else if (tile === TILE_WALL) { r = 60; g = 50; b = 40; }
        mbuf[y * mw + x] = (255 << 24) | (b << 16) | (g << 8) | r;
      }
    }

    // Creatures as bright dots
    for (const c of world.creatures) {
      if (!c.alive) continue;
      const mx = Math.floor(c.x / sx), my = Math.floor(c.y / sy);
      if (mx >= 0 && mx < mw && my >= 0 && my < mh) {
        const col = SPECIES_COLORS[c.species];
        mbuf[my * mw + mx] = (255 << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
      }
    }

    mctx.putImageData(mid, 0, 0);

    // Camera viewport box
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.width / dpr;
    const ch = this.canvas.height / dpr;
    const scale = Math.min(cw / W, ch / H) * this.zoom;
    const vw = cw / scale / sx;
    const vh = ch / scale / sy;
    const vx = (this.camX - cw / scale / 2) / sx;
    const vy = (this.camY - ch / scale / 2) / sy;

    mctx.strokeStyle = 'rgba(255,255,255,0.6)';
    mctx.lineWidth = 1;
    mctx.strokeRect(vx, vy, vw, vh);
  }
}


// ═══════════════════════════════════════════
// ██ Data Visualization
// ═══════════════════════════════════════════

class DataViz {
  /** Draw population graph */
  static drawPopGraph(canvas, history) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (history.length < 2) return;

    ctx.strokeStyle = '#e0d8c8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const max = Math.max(...history, 1);
    for (let i = 0; i < history.length; i++) {
      const x = (i / (history.length - 1)) * w;
      const y = h - (history[i] / max) * h * 0.9 - h * 0.05;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#888';
    ctx.font = '9px monospace';
    ctx.fillText(`人口 (max: ${max})`, 4, 12);
  }

  /** Draw species population stacked area chart */
  static drawSpeciesGraph(canvas, history) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (history.length < 2) return;

    // Find max total
    let maxTotal = 1;
    for (const entry of history) {
      const total = entry.reduce((a, b) => a + b, 0);
      if (total > maxTotal) maxTotal = total;
    }

    // Draw stacked areas (bottom to top)
    for (let s = NUM_SPECIES - 1; s >= 0; s--) {
      const col = SPECIES_COLORS[s];
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.5)`;
      ctx.beginPath();
      ctx.moveTo(0, h);

      for (let i = 0; i < history.length; i++) {
        let cumulative = 0;
        for (let j = 0; j <= s; j++) cumulative += history[i][j];
        const x = (i / (history.length - 1)) * w;
        const y = h - (cumulative / maxTotal) * h * 0.9 - h * 0.05;
        ctx.lineTo(x, y);
      }

      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#888';
    ctx.font = '9px monospace';
    ctx.fillText('種族分布', 4, 12);
  }
}


// ═══════════════════════════════════════════
// ██ UI — User Interface & God Mode
// ═══════════════════════════════════════════

class UI {
  constructor(world, renderer) {
    this.world = world;
    this.renderer = renderer;
    this.tool = 'observe';
    this.paused = false;
    this.speed = 1;
    this.speeds = [1, 2, 4, 8];
    this.speedIdx = 0;
    this.selectedCreature = null;

    // Touch/mouse state
    this.pointerDown = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.pinchDist = 0;
    this.isPanning = false;

    this.setupEvents();
  }

  setupEvents() {
    const canvas = this.renderer.canvas;

    // Tool selection
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tool = btn.dataset.tool;

        if (tool === 'stats') {
          this.toggleDataPanel();
          return;
        }

        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.tool = tool;
      });
    });

    // Pause
    document.getElementById('btn-pause').addEventListener('click', () => {
      this.paused = !this.paused;
      document.getElementById('btn-pause').textContent = this.paused ? '▶' : '⏸';
    });

    // Speed
    document.getElementById('btn-speed').addEventListener('click', () => {
      this.speedIdx = (this.speedIdx + 1) % this.speeds.length;
      this.speed = this.speeds[this.speedIdx];
      document.getElementById('btn-speed').textContent = `${this.speed}×`;
    });

    // Canvas pointer events
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    // Wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.renderer.zoom = clamp(this.renderer.zoom * delta, this.renderer.minZoom, this.renderer.maxZoom);
    }, { passive: false });

    // Touch zoom (pinch)
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        this.pinchDist = dist(
          e.touches[0].clientX, e.touches[0].clientY,
          e.touches[1].clientX, e.touches[1].clientY
        );
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const newDist = dist(
          e.touches[0].clientX, e.touches[0].clientY,
          e.touches[1].clientX, e.touches[1].clientY
        );
        const scale = newDist / (this.pinchDist || 1);
        this.renderer.zoom = clamp(this.renderer.zoom * scale, this.renderer.minZoom, this.renderer.maxZoom);
        this.pinchDist = newDist;
      }
    }, { passive: true });

    // Info panel close
    document.getElementById('info-close').addEventListener('click', () => {
      document.getElementById('info-panel').classList.add('hidden');
      this.selectedCreature = null;
    });

    // Data panel close
    document.getElementById('data-close').addEventListener('click', () => {
      document.getElementById('data-panel').classList.add('hidden');
    });

    // Minimap click
    document.getElementById('minimap').addEventListener('click', (e) => {
      const rect = e.target.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;
      this.renderer.camX = mx * W;
      this.renderer.camY = my * H;
    });
  }

  onPointerDown(e) {
    this.pointerDown = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.isPanning = false;
  }

  onPointerMove(e) {
    if (!this.pointerDown) return;

    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      this.isPanning = true;
    }

    if (this.isPanning && this.tool === 'observe') {
      // Pan camera
      const dpr = window.devicePixelRatio || 1;
      const cw = this.renderer.canvas.width / dpr;
      const ch = this.renderer.canvas.height / dpr;
      const scale = Math.min(cw / W, ch / H) * this.renderer.zoom;
      this.renderer.camX -= dx / scale;
      this.renderer.camY -= dy / scale;
      this.renderer.camX = clamp(this.renderer.camX, 0, W);
      this.renderer.camY = clamp(this.renderer.camY, 0, H);
    }

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  }

  onPointerUp(e) {
    if (!this.isPanning && this.pointerDown) {
      // Click action
      const wp = this.renderer.screenToWorld(e.clientX, e.clientY);
      this.handleToolAction(wp.x, wp.y);
    }
    this.pointerDown = false;
    this.isPanning = false;
  }

  /** Handle tool click at world coordinates */
  handleToolAction(wx, wy) {
    const world = this.world;
    const ix = Math.round(wx), iy = Math.round(wy);

    switch (this.tool) {
      case 'observe': {
        // Find nearest creature
        let nearest = null, nearestD = 6;
        for (const c of world.creatures) {
          const d = dist(c.x, c.y, wx, wy);
          if (d < nearestD) { nearestD = d; nearest = c; }
        }
        if (nearest) {
          this.selectedCreature = nearest;
          this.showCreatureInfo(nearest);
        }
        break;
      }
      case 'meteor': {
        // Destroy area
        const radius = 12;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > radius) continue;
            const px = ix + dx, py = iy + dy;
            if (px < 0 || px >= W || py < 0 || py >= H) continue;
            const idx = py * W + px;
            if (d < radius * 0.6) {
              world.terrain[idx] = TILE_DANGER;
              world.food[idx] = 0;
            }
          }
        }
        // Kill creatures in radius
        for (const c of world.creatures) {
          if (dist(c.x, c.y, wx, wy) < radius) {
            c.alive = false;
          }
        }
        this.showToast('☄️ 隕石落下！');
        break;
      }
      case 'food-burst': {
        // Spawn food in area
        const radius = 15;
        let count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
            const px = ix + dx, py = iy + dy;
            if (px < 0 || px >= W || py < 0 || py >= H) continue;
            const idx = py * W + px;
            if (world.terrain[idx] === TILE_EMPTY && world.food[idx] === 0) {
              world.food[idx] = 1;
              world.totalFood++;
              count++;
            }
          }
        }
        this.showToast(`🌿 資源バースト +${count}`);
        break;
      }
      case 'mutate': {
        // Force mutation on nearby creatures
        let mutated = 0;
        for (const c of world.creatures) {
          if (dist(c.x, c.y, wx, wy) < 10) {
            c.brain.mutate();
            c.brain.mutate(); // Double mutation
            c.genome.mutate();
            mutated++;
          }
        }
        this.showToast(`🧪 ${mutated}体を突然変異`);
        break;
      }
      case 'wall': {
        // Place walls
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const px = ix + dx, py = iy + dy;
            if (px >= 0 && px < W && py >= 0 && py < H) {
              world.terrain[py * W + px] = TILE_WALL;
              world.food[py * W + px] = 0;
            }
          }
        }
        break;
      }
      case 'water': {
        // Place water
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (Math.sqrt(dx * dx + dy * dy) > 3) continue;
            const px = ix + dx, py = iy + dy;
            if (px >= 0 && px < W && py >= 0 && py < H) {
              world.terrain[py * W + px] = TILE_WATER;
              world.food[py * W + px] = 0;
            }
          }
        }
        this.showToast('💧 水源追加');
        break;
      }
      case 'climate': {
        // Cycle climate
        world.climate = world.climate >= 1.5 ? 0.3 : world.climate + 0.3;
        const label = world.climate < 0.6 ? '氷河期' : world.climate < 1.0 ? '寒冷' :
                      world.climate < 1.3 ? '温暖' : '灼熱';
        this.showToast(`🌡️ 気候: ${label}`);
        break;
      }
    }
  }

  /** Show creature info panel */
  showCreatureInfo(c) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content');
    const col = SPECIES_COLORS[c.species];

    content.innerHTML = `
      <div style="color:rgb(${col[0]},${col[1]},${col[2]})">
        ■ ${SPECIES_NAMES[c.species]} (#${c.id})
      </div>
      <div>世代: G${c.generation} | 年齢: ${c.age}</div>
      <div>エネルギー: ${c.energy.toFixed(1)} | 役割: ${c.role}</div>
      <div>速度: ${c.genome.speed.toFixed(2)} | 視野: ${c.genome.senseRange.toFixed(1)}</div>
      <div>攻撃: ${c.genome.attackPower.toFixed(2)} | 防御: ${c.genome.defense.toFixed(2)}</div>
      <div>子孫: ${c.offspring} | 捕食: ${c.kills}</div>
      <div>適応度: ${c.fitness.toFixed(1)} | 状態: ${c.state}</div>
      <div>運搬中: ${c.carrying ? '🍂' : '—'}</div>
    `;
    panel.classList.remove('hidden');
  }

  /** Toggle data/stats panel */
  toggleDataPanel() {
    const panel = document.getElementById('data-panel');
    panel.classList.toggle('hidden');
  }

  /** Show toast notification */
  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    // Reset animation
    toast.style.animation = 'none';
    // Force reflow
    void toast.offsetHeight;
    toast.style.animation = '';
    setTimeout(() => toast.classList.add('hidden'), 2500);
  }

  /** Update stats display */
  updateStats() {
    const world = this.world;
    document.getElementById('stat-pop').textContent = `🧬 ${world.creatures.length}`;
    document.getElementById('stat-food').textContent = `🍂 ${world.totalFood}`;
    document.getElementById('stat-gen').textContent = `⏳ G${world.maxGeneration}`;
    document.getElementById('season-indicator').textContent = SEASONS[world.season].name;

    // Update data panel if visible
    if (!document.getElementById('data-panel').classList.contains('hidden')) {
      DataViz.drawPopGraph(document.getElementById('pop-graph'), world.popHistory);
      DataViz.drawSpeciesGraph(document.getElementById('species-graph'), world.speciesHistory);
    }

    // Update selected creature info
    if (this.selectedCreature) {
      if (this.selectedCreature.alive) {
        this.showCreatureInfo(this.selectedCreature);
      } else {
        document.getElementById('info-panel').classList.add('hidden');
        this.selectedCreature = null;
      }
    }
  }
}


// ═══════════════════════════════════════════
// ██ Simulation — Main Loop
// ═══════════════════════════════════════════

class Simulation {
  constructor() {
    this.world = new World();
    this.renderer = new Renderer(document.getElementById('world-canvas'));
    this.ui = new UI(this.world, this.renderer);
    this.minimap = document.getElementById('minimap');
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.fps = 60;

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  loop(time) {
    // FPS tracking
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
      document.getElementById('stat-fps').textContent = `${this.fps}fps`;
    }

    // Simulation steps per frame (based on speed)
    if (!this.ui.paused) {
      const steps = this.ui.speed;
      for (let i = 0; i < steps; i++) {
        this.world.update();
      }
    }

    // Render
    this.renderer.render(this.world, time);

    // Minimap (every 5 frames)
    if (this.frameCount % 5 === 0) {
      this.renderer.renderMinimap(this.world, this.minimap);
    }

    // UI stats (every 10 frames)
    if (this.frameCount % 10 === 0) {
      this.ui.updateStats();
    }

    requestAnimationFrame(this.loop);
  }
}


// ═══════════════════════════════════════════
// ██ Initialize
// ═══════════════════════════════════════════

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Start simulation
const sim = new Simulation();
