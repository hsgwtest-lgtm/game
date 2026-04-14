/**
 * PixLife 2 - World Simulation
 * Manages the world: terrain, food, colonies, pheromones, creature interactions.
 */

import { Creature, STATE } from './creature.js';

// Pheromone types
const PHERO = {
  FORAGE: 0,  // "I found food this way"
  RETURN: 1   // "Nest is this way"
};

// Food types
const FOOD_TYPE = {
  BERRY: 0,    // red-ish
  SEED: 1,     // gold
  MUSHROOM: 2, // purple
  LEAF: 3      // green
};

const FOOD_COLORS = {
  [FOOD_TYPE.BERRY]: [0xe0, 0x5a, 0x5a],
  [FOOD_TYPE.SEED]: [0xf0, 0xc2, 0x7f],
  [FOOD_TYPE.MUSHROOM]: [0xb0, 0x70, 0xd0],
  [FOOD_TYPE.LEAF]: [0x70, 0xb0, 0x60]
};

const FOOD_ENERGY = {
  [FOOD_TYPE.BERRY]: 25,
  [FOOD_TYPE.SEED]: 15,
  [FOOD_TYPE.MUSHROOM]: 35,
  [FOOD_TYPE.LEAF]: 10
};

export class World {
  /**
   * @param {number} width - world width in pixels
   * @param {number} height - world height in pixels
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;

    // Creatures
    this.creatures = [];
    this.maxCreatures = 150;

    // Food items
    this.foods = [];
    this.maxFood = 200;

    // Pheromone grids (2 layers: forage and return)
    this.pheromones = [
      new Float32Array(width * height), // forage
      new Float32Array(width * height)  // return
    ];

    // Nest
    this.nestX = Math.floor(width / 2);
    this.nestY = Math.floor(height / 2);
    this.nestRadius = 6;
    this.nestFood = 0;

    // Stats
    this.tick = 0;
    this.totalBorn = 0;
    this.totalDied = 0;
    this.generation = 0;

    // Time of day (0-1, 0=midnight, 0.5=noon)
    this.timeOfDay = 0.25; // start at dawn
    this.dayLength = 3600; // ticks per day

    // Obstacles (user-placed walls)
    this.obstacles = new Uint8Array(width * height);

    // Natural food spawn timer
    this.naturalFoodTimer = 0;
    this.naturalFoodInterval = 80;
  }

  /**
   * Initialize the world with starting creatures and food
   */
  init() {
    // Spawn initial creatures around the nest
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const dist = 3 + Math.random() * 4;
      const c = new Creature(
        this.nestX + Math.cos(angle) * dist,
        this.nestY + Math.sin(angle) * dist
      );
      c.nestX = this.nestX;
      c.nestY = this.nestY;
      this.creatures.push(c);
      this.totalBorn++;
    }

    // Spawn initial food clusters around the map
    for (let i = 0; i < 5; i++) {
      this.spawnFoodCluster(4 + Math.floor(Math.random() * 4));
    }
  }

  /**
   * Spawn a cluster of food at a random location
   */
  spawnFoodCluster(count = 5) {
    const cx = 10 + Math.random() * (this.width - 20);
    const cy = 10 + Math.random() * (this.height - 20);
    const type = Math.floor(Math.random() * 4);

    for (let i = 0; i < count; i++) {
      if (this.foods.length >= this.maxFood) break;
      this.foods.push({
        x: cx + (Math.random() - 0.5) * 12,
        y: cy + (Math.random() - 0.5) * 12,
        type: type,
        energy: FOOD_ENERGY[type],
        color: FOOD_COLORS[type],
        age: 0
      });
    }
  }

  /**
   * User places food at position
   * @param {number} x
   * @param {number} y
   * @param {number} [type]
   */
  placeFood(x, y, type = -1) {
    if (this.foods.length >= this.maxFood) return;
    if (type < 0) type = Math.floor(Math.random() * 4);
    this.foods.push({
      x, y, type,
      energy: FOOD_ENERGY[type],
      color: FOOD_COLORS[type],
      age: 0
    });
  }

  /**
   * User places obstacle
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   */
  placeObstacle(x, y, radius = 2) {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = Math.floor(x + dx);
        const py = Math.floor(y + dy);
        if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
          this.obstacles[py * this.width + px] = 1;
        }
      }
    }
  }

  /**
   * User places water (attracts creatures to drink)
   * @param {number} x
   * @param {number} y
   */
  placeWater(x, y) {
    const radius = 3;
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = Math.floor(x + dx);
        const py = Math.floor(y + dy);
        if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
          this.obstacles[py * this.width + px] = 2; // 2 = water
        }
      }
    }
  }

  /**
   * User nudges creatures near a point
   * @param {number} x
   * @param {number} y
   * @param {number} dx - nudge direction
   * @param {number} dy
   */
  nudgeCreatures(x, y, dx, dy) {
    const radius = 10;
    for (const c of this.creatures) {
      const dist = Math.hypot(c.x - x, c.y - y);
      if (dist < radius) {
        const strength = 1 - dist / radius;
        c.vx += dx * strength * 0.5;
        c.vy += dy * strength * 0.5;
      }
    }
  }

  /**
   * Get creature at position
   * @param {number} x
   * @param {number} y
   * @returns {Creature|null}
   */
  getCreatureAt(x, y) {
    let closest = null;
    let minDist = 5;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < minDist) {
        minDist = d;
        closest = c;
      }
    }
    return closest;
  }

  /**
   * Build senses for a creature
   * @param {Creature} creature
   * @returns {object}
   */
  buildSenses(creature) {
    const senses = {
      foodDirX: 0, foodDirY: 0, foodDist: 1,
      nestDirX: 0, nestDirY: 0, nestDist: 1,
      pheroForagX: 0, pheroForagY: 0,
      pheroReturnX: 0, pheroReturnY: 0
    };

    // Find nearest food
    let nearestFood = null;
    let nearestFoodDist = Infinity;
    for (const f of this.foods) {
      const d = Math.hypot(f.x - creature.x, f.y - creature.y);
      if (d < nearestFoodDist) {
        nearestFoodDist = d;
        nearestFood = f;
      }
    }

    if (nearestFood && nearestFoodDist < 60) {
      const dx = nearestFood.x - creature.x;
      const dy = nearestFood.y - creature.y;
      const dist = Math.max(1, nearestFoodDist);
      senses.foodDirX = dx / dist;
      senses.foodDirY = dy / dist;
      senses.foodDist = Math.min(1, nearestFoodDist / 60);
    }

    // Nest direction
    const ndx = this.nestX - creature.x;
    const ndy = this.nestY - creature.y;
    const ndist = Math.max(1, Math.hypot(ndx, ndy));
    senses.nestDirX = ndx / ndist;
    senses.nestDirY = ndy / ndist;
    senses.nestDist = Math.min(1, ndist / (this.width * 0.5));

    // Pheromone gradients (sample nearby)
    const px = Math.floor(creature.x);
    const py = Math.floor(creature.y);
    const sampleDist = 3;

    for (let layer = 0; layer < 2; layer++) {
      let gx = 0, gy = 0;
      for (const [ddx, ddy] of [[sampleDist, 0], [-sampleDist, 0], [0, sampleDist], [0, -sampleDist]]) {
        const sx = px + ddx;
        const sy = py + ddy;
        if (sx >= 0 && sx < this.width && sy >= 0 && sy < this.height) {
          const val = this.pheromones[layer][sy * this.width + sx];
          gx += ddx * val;
          gy += ddy * val;
        }
      }
      const gmag = Math.max(1, Math.hypot(gx, gy));
      if (layer === PHERO.FORAGE) {
        senses.pheroForagX = gx / gmag;
        senses.pheroForagY = gy / gmag;
      } else {
        senses.pheroReturnX = gx / gmag;
        senses.pheroReturnY = gy / gmag;
      }
    }

    return senses;
  }

  /**
   * Drop pheromone at position
   */
  dropPheromone(x, y, layer, strength) {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || px >= this.width || py < 0 || py >= this.height) return;

    const idx = py * this.width + px;
    this.pheromones[layer][idx] = Math.min(1, this.pheromones[layer][idx] + strength);

    // Spread slightly
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const ni = ny * this.width + nx;
        this.pheromones[layer][ni] = Math.min(1, this.pheromones[layer][ni] + strength * 0.3);
      }
    }
  }

  /**
   * Evaporate pheromones
   */
  evaporatePheromones() {
    const decay = 0.997;
    for (let layer = 0; layer < 2; layer++) {
      const phero = this.pheromones[layer];
      for (let i = 0; i < phero.length; i++) {
        phero[i] *= decay;
        if (phero[i] < 0.001) phero[i] = 0;
      }
    }
  }

  /**
   * Main simulation step
   */
  step() {
    this.tick++;
    this.timeOfDay = (this.tick % this.dayLength) / this.dayLength;

    // Evaporate pheromones every few ticks
    if (this.tick % 3 === 0) {
      this.evaporatePheromones();
    }

    // Natural food spawning
    this.naturalFoodTimer++;
    if (this.naturalFoodTimer >= this.naturalFoodInterval) {
      this.naturalFoodTimer = 0;
      if (this.foods.length < this.maxFood * 0.7) {
        this.spawnFoodCluster(2 + Math.floor(Math.random() * 4));
      }
    }

    // Update creatures
    const newCreatures = [];
    const deadCreatures = [];

    for (const creature of this.creatures) {
      if (!creature.alive) {
        deadCreatures.push(creature);
        continue;
      }

      // Decision making (not every tick for performance)
      if (this.tick % creature.decisionInterval === 0) {
        const senses = this.buildSenses(creature);
        creature.think(senses);
      }

      // Update position
      creature.update(this.width, this.height);

      if (!creature.alive) {
        deadCreatures.push(creature);
        this.totalDied++;
        continue;
      }

      // Check obstacle collision
      const cpx = Math.floor(creature.x);
      const cpy = Math.floor(creature.y);
      if (cpx >= 0 && cpx < this.width && cpy >= 0 && cpy < this.height) {
        const obstVal = this.obstacles[cpy * this.width + cpx];
        if (obstVal === 1) {
          // Wall: bounce back
          creature.x -= creature.vx * 2;
          creature.y -= creature.vy * 2;
          creature.vx *= -0.5;
          creature.vy *= -0.5;
        } else if (obstVal === 2) {
          // Water: recover energy
          creature.energy = Math.min(creature.maxEnergy, creature.energy + 0.3);
        }
      }

      // Drop pheromones
      if (this.tick - creature.lastPheromoneTime >= creature.pheromoneInterval) {
        creature.lastPheromoneTime = this.tick;
        if (creature.carryingFood) {
          // Carrying food → drop "food is this way" pheromone
          this.dropPheromone(creature.x, creature.y, PHERO.FORAGE, 0.4 * (creature.pheromoneStrength || 0.5));
        } else {
          // Foraging → drop "nest is this way" pheromone
          this.dropPheromone(creature.x, creature.y, PHERO.RETURN, 0.3 * (creature.pheromoneStrength || 0.5));
        }
      }

      // Check food pickup (not carrying)
      if (!creature.carryingFood) {
        for (let i = this.foods.length - 1; i >= 0; i--) {
          const f = this.foods[i];
          const d = Math.hypot(f.x - creature.x, f.y - creature.y);
          if (d < 2 + creature.size * 0.5) {
            creature.pickupFood(f.type);
            creature.energy = Math.min(creature.maxEnergy, creature.energy + f.energy * 0.3);
            this.foods.splice(i, 1);
            break;
          }
        }
      }

      // Check nest delivery
      if (creature.carryingFood) {
        const nestDist = Math.hypot(creature.x - this.nestX, creature.y - this.nestY);
        if (nestDist < this.nestRadius) {
          creature.deliverFood();
          this.nestFood++;
        }
      }

      // Rest at nest if low energy
      if (!creature.carryingFood) {
        const nestDist = Math.hypot(creature.x - this.nestX, creature.y - this.nestY);
        if (nestDist < this.nestRadius && creature.energy < 50) {
          creature.rest();
        }
      }

      // Reproduction
      if (creature.canReproduce() && this.creatures.length + newCreatures.length < this.maxCreatures) {
        const child = creature.reproduce();
        newCreatures.push(child);
        this.totalBorn++;
        this.generation = Math.max(this.generation, child.generation);
      }
    }

    // Remove dead creatures
    this.creatures = this.creatures.filter(c => c.alive);

    // Add new creatures
    for (const nc of newCreatures) {
      this.creatures.push(nc);
    }

    // Emergency spawning if population gets too low
    if (this.creatures.length < 3 && this.tick > 100) {
      this.emergencySpawn();
    }

    // Age food
    for (let i = this.foods.length - 1; i >= 0; i--) {
      this.foods[i].age++;
      if (this.foods[i].age > 2000) {
        this.foods.splice(i, 1);
      }
    }
  }

  /**
   * Emergency spawn when population is critically low
   */
  emergencySpawn() {
    // Find best surviving creature to use as parent
    let bestParent = null;
    let bestFitness = -1;
    for (const c of this.creatures) {
      if (c.fitness > bestFitness) {
        bestFitness = c.fitness;
        bestParent = c;
      }
    }

    const count = 5;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 3 + Math.random() * 5;
      let brain = null;
      let gen = 0;
      if (bestParent) {
        brain = bestParent.brain.cloneWithMutation(0.3, 0.6);
        gen = bestParent.generation + 1;
      }
      const c = new Creature(
        this.nestX + Math.cos(angle) * dist,
        this.nestY + Math.sin(angle) * dist,
        brain,
        gen
      );
      c.nestX = this.nestX;
      c.nestY = this.nestY;
      this.creatures.push(c);
      this.totalBorn++;
    }
  }

  /**
   * Get world statistics
   */
  getStats() {
    let carrying = 0;
    let avgEnergy = 0;
    let maxSize = 0;
    for (const c of this.creatures) {
      if (c.carryingFood) carrying++;
      avgEnergy += c.energy;
      if (c.size > maxSize) maxSize = c.size;
    }
    const pop = this.creatures.length;
    avgEnergy = pop > 0 ? avgEnergy / pop : 0;

    return {
      population: pop,
      carrying,
      foodAvailable: this.foods.length,
      nestFood: this.nestFood,
      generation: this.generation,
      avgEnergy: Math.round(avgEnergy),
      maxSize,
      tick: this.tick,
      timeOfDay: this.timeOfDay,
      born: this.totalBorn,
      died: this.totalDied
    };
  }
}
