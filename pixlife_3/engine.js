/* ======================================================================
   PixLife 3 — Warm-pixel life-simulation sandbox (Safari PWA)
   Single-file ES-module engine
   ====================================================================== */

// ─── Constants ───────────────────────────────────────────────────────
const WORLD_W = 240;          // logical pixel grid width
const WORLD_H = 160;          // logical pixel grid height
const CELL = 1;               // each cell = 1 logical pixel

const MAX_CREATURES = 600;
const FOOD_ENERGY = 40;
const WATER_ENERGY = 20;
const REPRODUCE_ENERGY = 120;
const INITIAL_ENERGY = 60;
const STARVE_RATE = 0.12;
const NEST_RADIUS = 5;

const SPECIES = [
  { id: 0, name: 'アカ族',   hue: 10,  strategy: 'gatherer',  color: [200, 80, 60]  },
  { id: 1, name: 'アオ族',   hue: 210, strategy: 'explorer',  color: [60, 120, 200] },
  { id: 2, name: 'ミドリ族', hue: 130, strategy: 'defender',  color: [70, 180, 90]  },
  { id: 3, name: 'キイロ族', hue: 45,  strategy: 'scavenger', color: [210, 180, 60] },
];

// Neural net sizes
const INPUT_SIZE = 16;
const HIDDEN_SIZE = 10;
const OUTPUT_SIZE = 6; // dx, dy, pickup, drop, attack, reproduce

// ─── Utility ─────────────────────────────────────────────────────────
const rand = (a, b) => Math.random() * (b - a) + a;
const randInt = (a, b) => Math.floor(rand(a, b));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by); // Manhattan

// ─── Simple Neural Network (brain) ──────────────────────────────────
class Brain {
  constructor(weights) {
    if (weights) {
      this.w1 = weights.w1.map(r => [...r]);
      this.b1 = [...weights.b1];
      this.w2 = weights.w2.map(r => [...r]);
      this.b2 = [...weights.b2];
    } else {
      this.w1 = Array.from({ length: HIDDEN_SIZE }, () =>
        Array.from({ length: INPUT_SIZE }, () => rand(-1, 1))
      );
      this.b1 = Array.from({ length: HIDDEN_SIZE }, () => rand(-0.5, 0.5));
      this.w2 = Array.from({ length: OUTPUT_SIZE }, () =>
        Array.from({ length: HIDDEN_SIZE }, () => rand(-1, 1))
      );
      this.b2 = Array.from({ length: OUTPUT_SIZE }, () => rand(-0.5, 0.5));
    }
  }

  forward(inputs) {
    // Hidden layer (tanh)
    const hidden = new Float32Array(HIDDEN_SIZE);
    for (let h = 0; h < HIDDEN_SIZE; h++) {
      let sum = this.b1[h];
      for (let i = 0; i < INPUT_SIZE; i++) sum += this.w1[h][i] * inputs[i];
      hidden[h] = Math.tanh(sum);
    }
    // Output layer (tanh for directions, sigmoid for actions)
    const out = new Float32Array(OUTPUT_SIZE);
    for (let o = 0; o < OUTPUT_SIZE; o++) {
      let sum = this.b2[o];
      for (let h = 0; h < HIDDEN_SIZE; h++) sum += this.w2[o][h] * hidden[h];
      out[o] = o < 2 ? Math.tanh(sum) : 1 / (1 + Math.exp(-sum));
    }
    return out;
  }

  mutate(rate = 0.15) {
    const m = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        if (Array.isArray(arr[i])) {
          for (let j = 0; j < arr[i].length; j++) {
            if (Math.random() < rate) arr[i][j] += rand(-0.4, 0.4);
          }
        } else {
          if (Math.random() < rate) arr[i] += rand(-0.4, 0.4);
        }
      }
    };
    m(this.w1); m(this.b1); m(this.w2); m(this.b2);
  }

  clone() {
    return new Brain({ w1: this.w1, b1: this.b1, w2: this.w2, b2: this.b2 });
  }
}

// ─── Creature ────────────────────────────────────────────────────────
let nextId = 0;
class Creature {
  constructor(x, y, speciesId, brain, energy) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.species = speciesId;
    this.brain = brain || new Brain();
    this.energy = energy || INITIAL_ENERGY;
    this.age = 0;
    this.carrying = null;    // 'food' | null
    this.alive = true;
    this.fitness = 0;
    this.lastAction = '';
  }
}

// ─── World State ─────────────────────────────────────────────────────
class World {
  constructor() {
    this.tick = 0;
    this.generation = 1;
    this.creatures = [];
    this.foods = [];          // { x, y, energy }
    this.waters = [];         // { x, y }
    this.walls = new Set();   // "x,y"
    this.pheromones = [];     // { x, y, species, strength, type }
    this.nests = [];          // { x, y, species, food: number }

    // Grid caches for sensor input (updated each tick)
    this.creatureGrid = new Uint16Array(WORLD_W * WORLD_H);
    this.foodGrid = new Uint8Array(WORLD_W * WORLD_H);
    this.pheromoneGrid = new Float32Array(WORLD_W * WORLD_H);

    this._initSpecies();
  }

  _initSpecies() {
    // Each species starts with a nest and 6 creatures
    const corners = [
      { x: 30, y: 30 },
      { x: WORLD_W - 30, y: 30 },
      { x: 30, y: WORLD_H - 30 },
      { x: WORLD_W - 30, y: WORLD_H - 30 },
    ];
    SPECIES.forEach((sp, i) => {
      const c = corners[i];
      this.nests.push({ x: c.x, y: c.y, species: sp.id, food: 0 });
      for (let j = 0; j < 6; j++) {
        const cx = c.x + randInt(-3, 4);
        const cy = c.y + randInt(-3, 4);
        this.creatures.push(new Creature(cx, cy, sp.id));
      }
    });
    // Scatter initial food
    for (let i = 0; i < 80; i++) {
      this.foods.push({
        x: randInt(5, WORLD_W - 5),
        y: randInt(5, WORLD_H - 5),
        energy: FOOD_ENERGY,
      });
    }
  }

  // ── Grid caches ──
  _rebuildGrids() {
    this.creatureGrid.fill(0);
    this.foodGrid.fill(0);
    this.pheromoneGrid.fill(0);
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const idx = clamp(c.y, 0, WORLD_H - 1) * WORLD_W + clamp(c.x, 0, WORLD_W - 1);
      this.creatureGrid[idx] = c.species + 1; // 0 = empty
    }
    for (const f of this.foods) {
      const idx = clamp(f.y, 0, WORLD_H - 1) * WORLD_W + clamp(f.x, 0, WORLD_W - 1);
      this.foodGrid[idx] = 1;
    }
    for (const p of this.pheromones) {
      const idx = clamp(p.y, 0, WORLD_H - 1) * WORLD_W + clamp(p.x, 0, WORLD_W - 1);
      this.pheromoneGrid[idx] += p.strength;
    }
  }

  // ── Sensor inputs for a creature ──
  _senseInputs(c) {
    const inp = new Float32Array(INPUT_SIZE);
    const nest = this.nests.find(n => n.species === c.species);
    const specInfo = SPECIES[c.species];

    // 0-1: direction to nearest food
    let nearF = null, nearFD = Infinity;
    for (const f of this.foods) {
      const d = dist(c.x, c.y, f.x, f.y);
      if (d < nearFD) { nearFD = d; nearF = f; }
    }
    if (nearF) {
      inp[0] = clamp((nearF.x - c.x) / 30, -1, 1);
      inp[1] = clamp((nearF.y - c.y) / 30, -1, 1);
    }

    // 2-3: direction to nest
    if (nest) {
      inp[2] = clamp((nest.x - c.x) / 40, -1, 1);
      inp[3] = clamp((nest.y - c.y) / 40, -1, 1);
    }

    // 4: carrying food
    inp[4] = c.carrying === 'food' ? 1 : 0;

    // 5: energy (normalised)
    inp[5] = clamp(c.energy / REPRODUCE_ENERGY, 0, 1);

    // 6-7: nearest enemy direction
    let nearE = null, nearED = Infinity;
    for (const o of this.creatures) {
      if (!o.alive || o.species === c.species) continue;
      const d = dist(c.x, c.y, o.x, o.y);
      if (d < nearED) { nearED = d; nearE = o; }
    }
    if (nearE) {
      inp[6] = clamp((nearE.x - c.x) / 20, -1, 1);
      inp[7] = clamp((nearE.y - c.y) / 20, -1, 1);
    }

    // 8-9: nearest ally direction
    let nearA = null, nearAD = Infinity;
    for (const o of this.creatures) {
      if (!o.alive || o.id === c.id || o.species !== c.species) continue;
      const d = dist(c.x, c.y, o.x, o.y);
      if (d < nearAD) { nearAD = d; nearA = o; }
    }
    if (nearA) {
      inp[8] = clamp((nearA.x - c.x) / 20, -1, 1);
      inp[9] = clamp((nearA.y - c.y) / 20, -1, 1);
    }

    // 10: pheromone strength at current position
    const pidx = clamp(c.y, 0, WORLD_H - 1) * WORLD_W + clamp(c.x, 0, WORLD_W - 1);
    inp[10] = clamp(this.pheromoneGrid[pidx], 0, 1);

    // 11: wall nearby (any direction)
    let wallNear = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (this.walls.has(`${c.x + dx},${c.y + dy}`)) wallNear++;
      }
    }
    inp[11] = clamp(wallNear / 8, 0, 1);

    // 12: distance to nearest food normalised
    inp[12] = nearFD < Infinity ? clamp(1 - nearFD / 60, 0, 1) : 0;

    // 13: distance to nearest water source
    let nearWD = Infinity;
    for (const w of this.waters) {
      const d = dist(c.x, c.y, w.x, w.y);
      if (d < nearWD) nearWD = d;
    }
    inp[13] = nearWD < Infinity ? clamp(1 - nearWD / 60, 0, 1) : 0;

    // 14: strategy bias
    const strat = { gatherer: 0.3, explorer: 0.6, defender: -0.3, scavenger: 0.0 };
    inp[14] = strat[specInfo.strategy] || 0;

    // 15: age normalised
    inp[15] = clamp(c.age / 2000, 0, 1);

    return inp;
  }

  // ── Step simulation ──
  step() {
    this.tick++;
    this._rebuildGrids();

    // Process each creature
    const newborn = [];
    for (const c of this.creatures) {
      if (!c.alive) continue;

      // Sense + think
      const inputs = this._senseInputs(c);
      const out = c.brain.forward(inputs);

      // Output: [dx, dy, pickup, drop, attack, reproduce]
      let dx = Math.round(out[0]);
      let dy = Math.round(out[1]);
      const doPickup = out[2] > 0.6;
      const doDrop = out[3] > 0.6;
      const doAttack = out[4] > 0.7;
      const doReproduce = out[5] > 0.7;

      // Apply species strategy modifiers
      const strat = SPECIES[c.species].strategy;
      if (strat === 'gatherer' && c.carrying) {
        // Bias toward nest
        const nest = this.nests.find(n => n.species === c.species);
        if (nest) {
          dx += Math.sign(nest.x - c.x) * 0.5;
          dy += Math.sign(nest.y - c.y) * 0.5;
          dx = Math.round(clamp(dx, -1, 1));
          dy = Math.round(clamp(dy, -1, 1));
        }
      } else if (strat === 'explorer') {
        // Slight random exploration bonus
        if (Math.random() < 0.15) { dx = randInt(-1, 2); dy = randInt(-1, 2); }
      }

      // Move
      const nx = clamp(c.x + dx, 0, WORLD_W - 1);
      const ny = clamp(c.y + dy, 0, WORLD_H - 1);
      if (!this.walls.has(`${nx},${ny}`)) {
        c.x = nx;
        c.y = ny;
      }

      // Pickup food
      if (doPickup && !c.carrying) {
        const fi = this.foods.findIndex(f => dist(c.x, c.y, f.x, f.y) <= 1);
        if (fi !== -1) {
          c.carrying = 'food';
          c.lastAction = 'pickup';
          this.foods.splice(fi, 1);
          c.fitness += 5;
          // Leave pheromone trail
          this.pheromones.push({ x: c.x, y: c.y, species: c.species, strength: 0.8, type: 'food' });
        }
      }

      // Drop food at nest
      if (doDrop && c.carrying === 'food') {
        const nest = this.nests.find(n => n.species === c.species);
        if (nest && dist(c.x, c.y, nest.x, nest.y) <= NEST_RADIUS) {
          c.carrying = null;
          c.lastAction = 'deliver';
          nest.food++;
          c.energy += FOOD_ENERGY * 0.5;
          c.fitness += 20;
        }
      }

      // Auto-drop near nest if carrying
      if (c.carrying === 'food') {
        const nest = this.nests.find(n => n.species === c.species);
        if (nest && dist(c.x, c.y, nest.x, nest.y) <= 2) {
          c.carrying = null;
          c.lastAction = 'deliver';
          nest.food++;
          c.energy += FOOD_ENERGY * 0.5;
          c.fitness += 20;
        }
      }

      // Eat food directly if not carrying to nest
      if (!c.carrying) {
        const fi = this.foods.findIndex(f => c.x === f.x && c.y === f.y);
        if (fi !== -1 && c.energy < INITIAL_ENERGY * 0.5) {
          c.energy += this.foods[fi].energy * 0.3;
          this.foods.splice(fi, 1);
          c.lastAction = 'eat';
          c.fitness += 3;
        }
      }

      // Drink water
      const wi = this.waters.findIndex(w => dist(c.x, c.y, w.x, w.y) <= 1);
      if (wi !== -1) {
        c.energy += WATER_ENERGY * 0.2;
        c.fitness += 1;
      }

      // Attack
      if (doAttack) {
        const target = this.creatures.find(
          o => o.alive && o.species !== c.species && dist(c.x, c.y, o.x, o.y) <= 1
        );
        if (target) {
          target.energy -= 15;
          c.energy -= 5;
          c.lastAction = 'attack';
          c.fitness += 2;
          if (target.energy <= 0) {
            target.alive = false;
            c.fitness += 10;
            // Drop food where enemy died
            if (target.carrying === 'food') {
              this.foods.push({ x: target.x, y: target.y, energy: FOOD_ENERGY });
            }
          }
        }
      }

      // Reproduce
      if (doReproduce && c.energy >= REPRODUCE_ENERGY && this.creatures.length + newborn.length < MAX_CREATURES) {
        const childBrain = c.brain.clone();
        childBrain.mutate(0.12);
        const child = new Creature(
          clamp(c.x + randInt(-2, 3), 0, WORLD_W - 1),
          clamp(c.y + randInt(-2, 3), 0, WORLD_H - 1),
          c.species,
          childBrain,
          INITIAL_ENERGY * 0.7,
        );
        c.energy -= INITIAL_ENERGY * 0.6;
        c.lastAction = 'reproduce';
        newborn.push(child);
      }

      // Age + starvation
      c.age++;
      c.energy -= STARVE_RATE;

      // Die of old age or starvation
      if (c.energy <= 0 || c.age > 3000) {
        c.alive = false;
        if (c.carrying === 'food') {
          this.foods.push({ x: c.x, y: c.y, energy: FOOD_ENERGY });
        }
      }

      // Pheromone trail
      if (c.carrying && this.tick % 3 === 0) {
        this.pheromones.push({ x: c.x, y: c.y, species: c.species, strength: 0.5, type: 'trail' });
      }
    }

    // Add newborn
    this.creatures.push(...newborn);

    // Decay pheromones
    for (let i = this.pheromones.length - 1; i >= 0; i--) {
      this.pheromones[i].strength -= 0.008;
      if (this.pheromones[i].strength <= 0) this.pheromones.splice(i, 1);
    }

    // Remove dead
    this.creatures = this.creatures.filter(c => c.alive);

    // Spawn new food periodically
    if (this.tick % 60 === 0 && this.foods.length < 120) {
      for (let i = 0; i < 3; i++) {
        this.foods.push({
          x: randInt(5, WORLD_W - 5),
          y: randInt(5, WORLD_H - 5),
          energy: FOOD_ENERGY,
        });
      }
    }

    // Evolution: if a species dies out, respawn from fittest memory
    this._checkExtinction();

    // Generation counter
    if (this.tick % 1500 === 0) this.generation++;
  }

  _checkExtinction() {
    for (const sp of SPECIES) {
      const alive = this.creatures.filter(c => c.species === sp.id);
      if (alive.length === 0) {
        const nest = this.nests.find(n => n.species === sp.id);
        if (!nest) continue;
        // Respawn 4 creatures with new random brains
        for (let i = 0; i < 4; i++) {
          this.creatures.push(new Creature(
            nest.x + randInt(-3, 4),
            nest.y + randInt(-3, 4),
            sp.id,
          ));
        }
      }
    }
  }

  // ── User actions ──
  placeFood(x, y) {
    this.foods.push({ x, y, energy: FOOD_ENERGY });
  }

  placeWater(x, y) {
    // Place a small water patch
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const wx = clamp(x + dx, 0, WORLD_W - 1);
        const wy = clamp(y + dy, 0, WORLD_H - 1);
        if (!this.waters.find(w => w.x === wx && w.y === wy)) {
          this.waters.push({ x: wx, y: wy });
        }
      }
    }
  }

  placeWall(x, y) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        this.walls.add(`${clamp(x + dx, 0, WORLD_W - 1)},${clamp(y + dy, 0, WORLD_H - 1)}`);
      }
    }
  }

  placePheromone(x, y) {
    // Attract all species to this point
    for (const sp of SPECIES) {
      this.pheromones.push({ x, y, species: sp.id, strength: 1.0, type: 'lure' });
    }
  }

  getCreatureAt(x, y) {
    return this.creatures.find(c => c.alive && dist(c.x, c.y, x, y) <= 2);
  }
}

// ─── Renderer ────────────────────────────────────────────────────────
class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = WORLD_W;
    this.offscreen.height = WORLD_H;
    this.offCtx = this.offscreen.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.imageSmoothingEnabled = false;
    this.scaleX = w / WORLD_W;
    this.scaleY = h / WORLD_H;
  }

  draw() {
    const ctx = this.offCtx;
    const w = this.world;

    // Background — warm dark earth
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Subtle ground texture
    const imgData = ctx.getImageData(0, 0, WORLD_W, WORLD_H);
    const d = imgData.data;

    // Draw pheromone trails
    for (const p of w.pheromones) {
      const px = clamp(Math.floor(p.x), 0, WORLD_W - 1);
      const py = clamp(Math.floor(p.y), 0, WORLD_H - 1);
      const idx = (py * WORLD_W + px) * 4;
      const sp = SPECIES[p.species];
      const a = p.strength * 0.35;
      d[idx]     = clamp(d[idx] + sp.color[0] * a, 0, 255);
      d[idx + 1] = clamp(d[idx + 1] + sp.color[1] * a, 0, 255);
      d[idx + 2] = clamp(d[idx + 2] + sp.color[2] * a, 0, 255);
    }

    // Draw water
    for (const wa of w.waters) {
      const px = clamp(Math.floor(wa.x), 0, WORLD_W - 1);
      const py = clamp(Math.floor(wa.y), 0, WORLD_H - 1);
      const idx = (py * WORLD_W + px) * 4;
      const shimmer = Math.sin(this.world.tick * 0.05 + wa.x * 0.3) * 15;
      d[idx]     = 40;
      d[idx + 1] = 100 + shimmer;
      d[idx + 2] = 180 + shimmer;
      d[idx + 3] = 255;
    }

    // Draw walls
    for (const wk of w.walls) {
      const [wx, wy] = wk.split(',').map(Number);
      const idx = (wy * WORLD_W + wx) * 4;
      d[idx] = 80;
      d[idx + 1] = 65;
      d[idx + 2] = 50;
      d[idx + 3] = 255;
    }

    // Draw food
    for (const f of w.foods) {
      const px = clamp(Math.floor(f.x), 0, WORLD_W - 1);
      const py = clamp(Math.floor(f.y), 0, WORLD_H - 1);
      const idx = (py * WORLD_W + px) * 4;
      // Warm amber glow
      const pulse = Math.sin(this.world.tick * 0.03 + f.x) * 20;
      d[idx]     = 200 + pulse;
      d[idx + 1] = 160 + pulse;
      d[idx + 2] = 50;
      d[idx + 3] = 255;
    }

    // Draw nests
    for (const n of w.nests) {
      const sp = SPECIES[n.species];
      for (let dx = -NEST_RADIUS; dx <= NEST_RADIUS; dx++) {
        for (let dy = -NEST_RADIUS; dy <= NEST_RADIUS; dy++) {
          if (Math.abs(dx) + Math.abs(dy) > NEST_RADIUS) continue;
          const px = clamp(n.x + dx, 0, WORLD_W - 1);
          const py = clamp(n.y + dy, 0, WORLD_H - 1);
          const idx = (py * WORLD_W + px) * 4;
          const fade = 1 - (Math.abs(dx) + Math.abs(dy)) / NEST_RADIUS;
          d[idx]     = clamp(d[idx] + sp.color[0] * fade * 0.3, 0, 255);
          d[idx + 1] = clamp(d[idx + 1] + sp.color[1] * fade * 0.3, 0, 255);
          d[idx + 2] = clamp(d[idx + 2] + sp.color[2] * fade * 0.3, 0, 255);
        }
      }
      // Nest center marker
      const ci = (clamp(n.y, 0, WORLD_H - 1) * WORLD_W + clamp(n.x, 0, WORLD_W - 1)) * 4;
      d[ci] = Math.min(255, sp.color[0] + 80);
      d[ci + 1] = Math.min(255, sp.color[1] + 80);
      d[ci + 2] = Math.min(255, sp.color[2] + 80);
      d[ci + 3] = 255;
    }

    // Draw creatures
    for (const c of w.creatures) {
      if (!c.alive) continue;
      const sp = SPECIES[c.species];
      const px = clamp(Math.floor(c.x), 0, WORLD_W - 1);
      const py = clamp(Math.floor(c.y), 0, WORLD_H - 1);
      const idx = (py * WORLD_W + px) * 4;

      // Bright species color with energy-based brightness
      const brightness = clamp(c.energy / INITIAL_ENERGY, 0.4, 1.2);
      d[idx]     = clamp(sp.color[0] * brightness, 0, 255);
      d[idx + 1] = clamp(sp.color[1] * brightness, 0, 255);
      d[idx + 2] = clamp(sp.color[2] * brightness, 0, 255);
      d[idx + 3] = 255;

      // If carrying food, draw a small indicator above
      if (c.carrying === 'food' && py > 0) {
        const ci = ((py - 1) * WORLD_W + px) * 4;
        d[ci] = 220;
        d[ci + 1] = 180;
        d[ci + 2] = 50;
        d[ci + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Scale up to canvas
    const mainCtx = this.ctx;
    mainCtx.imageSmoothingEnabled = false;
    mainCtx.drawImage(this.offscreen, 0, 0, this.canvas.width, this.canvas.height);
  }

  // Convert screen coords to world coords
  screenToWorld(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((sx - rect.left) / rect.width * WORLD_W);
    const y = Math.floor((sy - rect.top) / rect.height * WORLD_H);
    return [clamp(x, 0, WORLD_W - 1), clamp(y, 0, WORLD_H - 1)];
  }
}

// ─── App Controller ──────────────────────────────────────────────────
class App {
  constructor() {
    this.canvas = document.getElementById('world');
    this.world = new World();
    this.renderer = new Renderer(this.canvas, this.world);

    this.paused = false;
    this.speed = 1;
    this.tool = 'food';
    this.isDrawing = false;

    this._bindUI();
    this._bindInput();
    this._registerSW();
    this._loop();
    this._showToast('🌱 PixLife — 生命のサンドボックスへようこそ');
  }

  _bindUI() {
    // Pause
    document.getElementById('btn-pause').addEventListener('click', () => {
      this.paused = !this.paused;
      document.getElementById('btn-pause').textContent = this.paused ? '▶' : '⏸';
    });

    // Speed
    const speeds = [1, 2, 4, 8];
    let si = 0;
    document.getElementById('btn-speed').addEventListener('click', () => {
      si = (si + 1) % speeds.length;
      this.speed = speeds[si];
      document.getElementById('btn-speed').textContent = `${this.speed}×`;
    });

    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.tool = btn.id.replace('tool-', '');
        document.getElementById('info-panel').classList.add('hidden');
      });
    });

    // Info panel close
    document.getElementById('info-close').addEventListener('click', () => {
      document.getElementById('info-panel').classList.add('hidden');
    });
  }

  _bindInput() {
    // Pointer events for touch + mouse
    const handleStart = (e) => {
      e.preventDefault();
      this.isDrawing = true;
      this._handlePointer(e);
    };
    const handleMove = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      this._handlePointer(e);
    };
    const handleEnd = () => { this.isDrawing = false; };

    this.canvas.addEventListener('pointerdown', handleStart, { passive: false });
    this.canvas.addEventListener('pointermove', handleMove, { passive: false });
    this.canvas.addEventListener('pointerup', handleEnd);
    this.canvas.addEventListener('pointercancel', handleEnd);
  }

  _handlePointer(e) {
    const sx = e.clientX;
    const sy = e.clientY;
    const [wx, wy] = this.renderer.screenToWorld(sx, sy);

    switch (this.tool) {
      case 'food':
        this.world.placeFood(wx, wy);
        break;
      case 'water':
        this.world.placeWater(wx, wy);
        break;
      case 'wall':
        this.world.placeWall(wx, wy);
        break;
      case 'pheromone':
        this.world.placePheromone(wx, wy);
        break;
      case 'observe': {
        const c = this.world.getCreatureAt(wx, wy);
        if (c) this._showCreatureInfo(c);
        break;
      }
    }
  }

  _showCreatureInfo(c) {
    const sp = SPECIES[c.species];
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content');
    const strategyNames = { gatherer: '採集者', explorer: '探索者', defender: '防衛者', scavenger: '漁り者' };
    content.innerHTML = `
      <h3><span class="species-dot" style="background:rgb(${sp.color.join(',')})"></span>${sp.name} #${c.id}</h3>
      <div class="stat-row"><span>戦略</span><span>${strategyNames[sp.strategy]}</span></div>
      <div class="stat-row"><span>エネルギー</span><span>${Math.floor(c.energy)}</span></div>
      <div class="stat-row"><span>年齢</span><span>${c.age} tick</span></div>
      <div class="stat-row"><span>適応度</span><span>${c.fitness}</span></div>
      <div class="stat-row"><span>運搬中</span><span>${c.carrying || 'なし'}</span></div>
      <div class="stat-row"><span>最後の行動</span><span>${c.lastAction || '移動'}</span></div>
    `;
    panel.classList.remove('hidden');
  }

  _updateStats() {
    const alive = this.world.creatures.filter(c => c.alive);
    document.getElementById('pop-count').textContent = `🌱 ${alive.length}`;
    document.getElementById('food-count').textContent = `🍂 ${this.world.foods.length}`;
    document.getElementById('gen-count').textContent = `⏳ ${this.world.generation}`;
  }

  _showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    // Force reflow
    void el.offsetWidth;
    el.style.animation = '';
    setTimeout(() => el.classList.add('hidden'), 3000);
  }

  _registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  _loop() {
    const tick = () => {
      if (!this.paused) {
        for (let i = 0; i < this.speed; i++) {
          this.world.step();
        }
      }
      this.renderer.draw();
      if (this.world.tick % 10 === 0) this._updateStats();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// ─── Boot ────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => new App());
