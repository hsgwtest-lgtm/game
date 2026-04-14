/**
 * PixLife 2 - Creature Entity
 * Each creature starts as 1 pixel and grows as it eats.
 * Movement is controlled by a neural network.
 */

import { NeuralNet } from './neural.js';

// Creature states
export const STATE = {
  FORAGING: 0,   // Looking for food
  CARRYING: 1,   // Carrying food to nest
  RETURNING: 2,  // Returning to nest (no food)
  RESTING: 3,    // At nest, recovering energy
  EXPLORING: 4   // Wandering with curiosity
};

// Color palettes for different generations (warm pixel tones)
const GEN_COLORS = [
  [0xe0, 0x7a, 0x5f],  // warm red
  [0xe8, 0xa8, 0x7c],  // warm orange
  [0xf0, 0xc2, 0x7f],  // warm gold
  [0xd6, 0x8f, 0xba],  // warm pink
  [0x81, 0xb2, 0x9a],  // sage green
  [0x92, 0xa8, 0xd1],  // soft blue
  [0xf4, 0xe8, 0xc1],  // cream
  [0xc9, 0x8a, 0x7a],  // terracotta
];

let nextId = 0;

export class Creature {
  /**
   * @param {number} x
   * @param {number} y
   * @param {NeuralNet} [brain]
   * @param {number} [generation]
   */
  constructor(x, y, brain = null, generation = 0) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.generation = generation;
    this.brain = brain || new NeuralNet(12, 8, 4);

    // Life stats
    this.energy = 80 + Math.random() * 20;
    this.maxEnergy = 100;
    this.size = 1; // pixels
    this.age = 0;
    this.foodCollected = 0;
    this.alive = true;
    this.state = STATE.FORAGING;

    // Carrying
    this.carryingFood = false;
    this.carryFoodType = 0;

    // Pheromone memory
    this.lastPheromoneTime = 0;
    this.pheromoneInterval = 5; // ticks between pheromone drops

    // Growth thresholds (food collected to grow)
    this.growthThresholds = [3, 8, 15, 25, 40];

    // Appearance
    const ci = generation % GEN_COLORS.length;
    this.baseColor = GEN_COLORS[ci];
    this.hueShift = (Math.random() - 0.5) * 20;

    // Movement smoothing
    this.targetX = x;
    this.targetY = y;
    this.moveTimer = 0;
    this.decisionInterval = 4 + Math.floor(Math.random() * 4);

    // Nest reference (set by world)
    this.nestX = 0;
    this.nestY = 0;

    // Fitness score for evolution
    this.fitness = 0;
  }

  /**
   * Sense the environment and decide next action
   * @param {object} senses - environment data
   */
  think(senses) {
    // Build input vector
    const inputs = [
      senses.foodDirX || 0,        // 0: direction to nearest food X
      senses.foodDirY || 0,        // 1: direction to nearest food Y
      senses.foodDist || 1,        // 2: distance to nearest food (normalized)
      senses.nestDirX || 0,        // 3: direction to nest X
      senses.nestDirY || 0,        // 4: direction to nest Y
      senses.nestDist || 1,        // 5: distance to nest (normalized)
      senses.pheroForagX || 0,     // 6: foraging pheromone gradient X
      senses.pheroForagY || 0,     // 7: foraging pheromone gradient Y
      senses.pheroReturnX || 0,    // 8: return pheromone gradient X
      senses.pheroReturnY || 0,    // 9: return pheromone gradient Y
      this.energy / this.maxEnergy,// 10: energy level
      this.carryingFood ? 1 : -1   // 11: carrying food
    ];

    const output = this.brain.forward(inputs);

    // Output: [dx, dy, pheromone_strength, state_change]
    this.vx = output[0] * (1.2 + this.size * 0.05);
    this.vy = output[1] * (1.2 + this.size * 0.05);
    this.pheromoneStrength = (output[2] + 1) / 2; // 0-1

    // State logic influenced by neural output
    if (this.carryingFood) {
      this.state = STATE.CARRYING;
    } else if (this.energy < 20) {
      this.state = STATE.RETURNING;
    } else if (output[3] > 0.5) {
      this.state = STATE.EXPLORING;
    } else {
      this.state = STATE.FORAGING;
    }
  }

  /**
   * Update creature position and stats
   * @param {number} worldW
   * @param {number} worldH
   */
  update(worldW, worldH) {
    if (!this.alive) return;

    this.age++;

    // Apply velocity with slight random jitter for natural movement
    this.x += this.vx + (Math.random() - 0.5) * 0.3;
    this.y += this.vy + (Math.random() - 0.5) * 0.3;

    // Boundary wrapping with margin
    const margin = 2;
    if (this.x < margin) this.x = margin;
    if (this.x >= worldW - margin) this.x = worldW - margin - 1;
    if (this.y < margin) this.y = margin;
    if (this.y >= worldH - margin) this.y = worldH - margin - 1;

    // Energy consumption
    const moveCost = (Math.abs(this.vx) + Math.abs(this.vy)) * 0.02;
    this.energy -= 0.03 + moveCost + this.size * 0.005;

    // Death check
    if (this.energy <= 0) {
      this.alive = false;
      return;
    }

    // Update fitness
    this.fitness = this.foodCollected * 10 + this.age * 0.01;
  }

  /**
   * Pick up food
   * @param {number} foodType
   */
  pickupFood(foodType = 0) {
    this.carryingFood = true;
    this.carryFoodType = foodType;
    this.state = STATE.CARRYING;
  }

  /**
   * Deliver food to nest
   * @returns {number} food type delivered
   */
  deliverFood() {
    if (!this.carryingFood) return -1;
    this.carryingFood = false;
    this.foodCollected++;
    this.energy = Math.min(this.maxEnergy, this.energy + 30);
    this.fitness += 10;

    // Check growth
    this.checkGrowth();

    this.state = STATE.FORAGING;
    return this.carryFoodType;
  }

  checkGrowth() {
    const idx = this.growthThresholds.findIndex(t => this.foodCollected < t);
    const newSize = idx === -1 ? this.growthThresholds.length + 1 : idx + 1;
    if (newSize > this.size) {
      this.size = newSize;
      this.maxEnergy = 100 + (this.size - 1) * 20;
    }
  }

  /**
   * Create offspring
   * @returns {Creature}
   */
  reproduce() {
    const childBrain = this.brain.cloneWithMutation(0.2, 0.4);
    const angle = Math.random() * Math.PI * 2;
    const dist = 3 + Math.random() * 5;
    const child = new Creature(
      this.x + Math.cos(angle) * dist,
      this.y + Math.sin(angle) * dist,
      childBrain,
      this.generation + 1
    );
    child.nestX = this.nestX;
    child.nestY = this.nestY;

    this.energy -= 40;
    return child;
  }

  /**
   * Can this creature reproduce?
   */
  canReproduce() {
    return this.energy > 70 && this.foodCollected >= 2 && this.age > 200;
  }

  /**
   * Get creature color with state variation
   * @returns {number[]} [r, g, b, a]
   */
  getColor() {
    const [r, g, b] = this.baseColor;
    let alpha = 255;

    switch (this.state) {
      case STATE.CARRYING:
        // Brighter when carrying food
        return [Math.min(255, r + 40), Math.min(255, g + 30), b, alpha];
      case STATE.RESTING:
        alpha = 180;
        return [r, g, b, alpha];
      case STATE.EXPLORING:
        return [Math.min(255, r + 20), g, Math.min(255, b + 30), alpha];
      default:
        return [r, g, b, alpha];
    }
  }

  /**
   * Rest at nest
   */
  rest() {
    this.state = STATE.RESTING;
    this.energy = Math.min(this.maxEnergy, this.energy + 0.5);
  }
}
