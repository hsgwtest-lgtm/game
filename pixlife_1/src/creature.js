// ── Creature: Pixel Life Entity with AI Brain ──
// Creatures are small pixel organisms with:
//  - A neural network brain that controls movement
//  - Energy that depletes over time (must eat to survive)
//  - DNA (visual traits) inherited with mutations
//  - Simple emotional states shown via pixel expressions

let creatureIdCounter = 0;

// Sensory input indices (total: 12)
// 0: nearest food distance (normalized)
// 1: nearest food angle (sin)
// 2: nearest food angle (cos)
// 3: nearest creature distance
// 4: nearest creature angle (sin)
// 5: nearest creature angle (cos)
// 6: nearest rock distance
// 7: nearest rock angle (sin)
// 8: nearest rock angle (cos)
// 9: own energy level (0-1)
// 10: light level at position (0-1)
// 11: temperature (0-1)

// Output indices (total: 4)
// 0: move forward strength
// 1: turn left/right (-0.5 to 0.5 mapped from 0-1)
// 2: eat attempt threshold
// 3: reproduce attempt threshold

class Creature {
  constructor(x, y, params = {}) {
    this.id = creatureIdCounter++;
    this.x = x;
    this.y = y;
    this.angle = params.angle != null ? params.angle : Math.random() * Math.PI * 2;
    this.speed = 0;
    this.alive = true;
    this.age = 0;

    // DNA: visual and behavioral traits
    this.dna = {
      bodyColor:    params.bodyColor    || this._warmColor(),
      eyeColor:     params.eyeColor    || '#1a1008',
      size:         params.size         || (3 + Math.floor(Math.random() * 3)),  // pixel size 3-5
      maxSpeed:     params.maxSpeed     || (15 + Math.random() * 20),
      metabolism:   params.metabolism   || (1.5 + Math.random() * 2),
      senseRange:   params.senseRange   || (40 + Math.random() * 40),
      fertility:    params.fertility    || (0.6 + Math.random() * 0.4),
    };

    this.energy = params.energy || 80;
    this.maxEnergy = 150;
    this.generation = params.generation || 0;
    this.reproductionCooldown = 0;
    this.eatingCooldown = 0;

    // Emotional state for pixel expressions
    this.emotion = 'neutral'; // neutral, happy, hungry, sleepy
    this.emotionTimer = 0;

    // Brain
    this.brain = params.brain || new Brain(12, 8, 4);
    this.brain.lifetime = 0;

    // Movement smoothing
    this._targetAngle = this.angle;
    this._wobble = Math.random() * Math.PI * 2;

    // Footprint trail
    this.trail = [];
    this._trailTimer = 0;
  }

  _warmColor() {
    // Generate warm pixel-friendly colors
    const palettes = [
      '#e8a040', '#d07830', '#f8c870', '#c06020', '#f0a050',
      '#b85830', '#e8c060', '#d09840', '#a04818', '#f8d888',
      '#c88850', '#e0b068', '#d8a058', '#b87038', '#f0c878',
      '#90c068', '#70a848', '#a8d078', '#80b858', '#60a040',
    ];
    return palettes[Math.floor(Math.random() * palettes.length)];
  }

  /**
   * Gather sensory inputs from the world.
   * @param {object} world
   * @returns {number[]}
   */
  sense(world) {
    const inputs = new Float32Array(12);
    const range = this.dna.senseRange;

    // Find nearest food
    let nearestFood = null;
    let nearestFoodDist = Infinity;
    for (const f of world.foods) {
      if (!f.alive) continue;
      const dx = f.x - this.x;
      const dy = f.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestFoodDist) {
        nearestFoodDist = d;
        nearestFood = f;
      }
    }
    if (nearestFood) {
      inputs[0] = Math.max(0, 1 - nearestFoodDist / range);
      const foodAngle = Math.atan2(nearestFood.y - this.y, nearestFood.x - this.x) - this.angle;
      inputs[1] = Math.sin(foodAngle);
      inputs[2] = Math.cos(foodAngle);
    }

    // Find nearest creature
    let nearestCreature = null;
    let nearestCreatureDist = Infinity;
    for (const c of world.creatures) {
      if (!c.alive || c.id === this.id) continue;
      const dx = c.x - this.x;
      const dy = c.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestCreatureDist) {
        nearestCreatureDist = d;
        nearestCreature = c;
      }
    }
    if (nearestCreature) {
      inputs[3] = Math.max(0, 1 - nearestCreatureDist / range);
      const cAngle = Math.atan2(nearestCreature.y - this.y, nearestCreature.x - this.x) - this.angle;
      inputs[4] = Math.sin(cAngle);
      inputs[5] = Math.cos(cAngle);
    }

    // Find nearest rock
    let nearestRockDist = Infinity;
    let nearestRock = null;
    for (const r of world.rocks) {
      const dx = r.x - this.x;
      const dy = r.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestRockDist) {
        nearestRockDist = d;
        nearestRock = r;
      }
    }
    if (nearestRock) {
      inputs[6] = Math.max(0, 1 - nearestRockDist / range);
      const rAngle = Math.atan2(nearestRock.y - this.y, nearestRock.x - this.x) - this.angle;
      inputs[7] = Math.sin(rAngle);
      inputs[8] = Math.cos(rAngle);
    }

    // Own state
    inputs[9] = this.energy / this.maxEnergy;
    inputs[10] = world.getLightAt(this.x, this.y);
    inputs[11] = world.temperature / 100;

    return inputs;
  }

  /**
   * Update creature state.
   */
  update(dt, world) {
    if (!this.alive) return;
    this.age += dt;
    this.brain.lifetime += dt;
    this._wobble += dt * 3;

    // Cooldowns
    if (this.reproductionCooldown > 0) this.reproductionCooldown -= dt;
    if (this.eatingCooldown > 0) this.eatingCooldown -= dt;
    this.emotionTimer -= dt;

    // Metabolism - burn energy
    const tempFactor = 0.5 + Math.abs(world.temperature - 50) / 100; // extreme temps cost more
    this.energy -= this.dna.metabolism * dt * tempFactor;

    // Brain decision
    const inputs = this.sense(world);
    const outputs = this.brain.think(inputs);

    // Apply outputs
    const moveStrength = outputs[0];
    const turnAmount = (outputs[1] - 0.5) * Math.PI * 2; // radians per second
    const wantEat = outputs[2] > 0.6;
    const wantReproduce = outputs[3] > 0.7;

    // Turn
    this._targetAngle = this.angle + turnAmount * dt;
    this.angle += (this._targetAngle - this.angle) * 0.3;

    // Move
    const targetSpeed = moveStrength * this.dna.maxSpeed;
    this.speed += (targetSpeed - this.speed) * 0.2;
    const wobbleX = Math.sin(this._wobble) * 0.3;
    const wobbleY = Math.cos(this._wobble * 0.7) * 0.3;
    this.x += (Math.cos(this.angle) * this.speed + wobbleX) * dt;
    this.y += (Math.sin(this.angle) * this.speed + wobbleY) * dt;

    // Energy cost for movement
    this.energy -= this.speed * 0.02 * dt;

    // Boundary wrapping
    const margin = this.dna.size;
    if (this.x < margin) { this.x = margin; this.angle = Math.PI - this.angle; }
    if (this.x > world.width - margin) { this.x = world.width - margin; this.angle = Math.PI - this.angle; }
    if (this.y < margin) { this.y = margin; this.angle = -this.angle; }
    if (this.y > world.height - margin) { this.y = world.height - margin; this.angle = -this.angle; }

    // Rock collision
    for (const rock of world.rocks) {
      const dx = this.x - rock.x;
      const dy = this.y - rock.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = rock.size + this.dna.size;
      if (dist < minDist && dist > 0) {
        const push = (minDist - dist) / dist;
        this.x += dx * push;
        this.y += dy * push;
        this.angle += (Math.random() - 0.5) * 1;
      }
    }

    // Eating
    if (wantEat && this.eatingCooldown <= 0) {
      for (const food of world.foods) {
        if (!food.alive) continue;
        const dx = food.x - this.x;
        const dy = food.y - this.y;
        const eatDist = this.dna.size + food.size;
        if (dx * dx + dy * dy < eatDist * eatDist) {
          this.energy = Math.min(this.maxEnergy, this.energy + food.energy);
          food.alive = false;
          this.eatingCooldown = 0.3;
          this.emotion = 'happy';
          this.emotionTimer = 1.5;
          // Reward brain for eating
          this.brain.reward += food.energy * 0.1;
          break;
        }
      }
    }

    // Reproduction
    if (wantReproduce && this.canReproduce()) {
      world.pendingBirths.push(this);
    }

    // Lifetime learning (every 5 seconds)
    if (!this._lastLearnAge) this._lastLearnAge = 0;
    if (this.age - this._lastLearnAge >= 5) {
      this._lastLearnAge = this.age;
      this.brain.learn(0.005);
    }

    // Update emotion
    if (this.emotionTimer <= 0) {
      if (this.energy < this.maxEnergy * 0.2) {
        this.emotion = 'hungry';
      } else if (this.speed < 2 && world.getLightAt(this.x, this.y) < 0.3) {
        this.emotion = 'sleepy';
      } else {
        this.emotion = 'neutral';
      }
    }

    // Trail
    this._trailTimer += dt;
    if (this._trailTimer > 0.3 && this.speed > 3) {
      this._trailTimer = 0;
      this.trail.push({ x: this.x, y: this.y, life: 1 });
      if (this.trail.length > 12) this.trail.shift();
    }
    for (const t of this.trail) {
      t.life -= dt * 0.5;
    }
    this.trail = this.trail.filter(t => t.life > 0);

    // Death
    if (this.energy <= 0) {
      this.alive = false;
    }
  }

  canReproduce() {
    return this.alive &&
           this.energy > this.maxEnergy * 0.7 &&
           this.reproductionCooldown <= 0 &&
           this.age > 5;
  }

  reproduce() {
    if (!this.canReproduce()) return null;
    this.energy *= 0.5;
    this.reproductionCooldown = 8;

    const mutColor = (hex) => {
      const r = parseInt(hex.slice(1,3), 16);
      const g = parseInt(hex.slice(3,5), 16);
      const b = parseInt(hex.slice(5,7), 16);
      const mr = Math.max(0, Math.min(255, r + Math.floor((Math.random()-0.5)*30)));
      const mg = Math.max(0, Math.min(255, g + Math.floor((Math.random()-0.5)*30)));
      const mb = Math.max(0, Math.min(255, b + Math.floor((Math.random()-0.5)*30)));
      return '#' + mr.toString(16).padStart(2,'0') + mg.toString(16).padStart(2,'0') + mb.toString(16).padStart(2,'0');
    };

    const childBrain = this.brain.mutate(0.12, 0.4);

    const offset = this.dna.size * 3;
    const childAngle = Math.random() * Math.PI * 2;

    return new Creature(
      this.x + Math.cos(childAngle) * offset,
      this.y + Math.sin(childAngle) * offset,
      {
        bodyColor: mutColor(this.dna.bodyColor),
        eyeColor: this.dna.eyeColor,
        size: Math.max(2, Math.min(6, this.dna.size + (Math.random() < 0.1 ? (Math.random() < 0.5 ? 1 : -1) : 0))),
        maxSpeed: Math.max(8, Math.min(40, this.dna.maxSpeed + (Math.random()-0.5) * 4)),
        metabolism: Math.max(0.8, Math.min(4, this.dna.metabolism + (Math.random()-0.5) * 0.3)),
        senseRange: Math.max(20, Math.min(100, this.dna.senseRange + (Math.random()-0.5) * 10)),
        fertility: Math.max(0.3, Math.min(1, this.dna.fertility + (Math.random()-0.5) * 0.1)),
        energy: this.energy * 0.8,
        generation: this.generation + 1,
        brain: childBrain,
        angle: childAngle,
      }
    );
  }
}

// ── Food ──
class Food {
  constructor(x, y, type = 'plant') {
    this.x = x;
    this.y = y;
    this.type = type; // 'plant' or 'fruit'
    this.energy = type === 'fruit' ? 20 + Math.random() * 10 : 8 + Math.random() * 8;
    this.size = type === 'fruit' ? 3 : 2;
    this.alive = true;
    this.age = 0;
    this.growthPhase = 0; // 0-1 for sprouting animation
  }

  update(dt, light) {
    if (!this.alive) return;
    this.age += dt;
    if (this.growthPhase < 1) {
      this.growthPhase = Math.min(1, this.growthPhase + dt * 0.8);
    }
    // Plants grow faster in light
    if (this.type === 'plant' && light > 0.5) {
      this.energy = Math.min(20, this.energy + dt * 0.5);
    }
    // Decay over time
    if (this.age > 30) {
      this.alive = false;
    }
  }
}

// ── Rock (obstacle) ──
class Rock {
  constructor(x, y, size) {
    this.x = x;
    this.y = y;
    this.size = size || (4 + Math.floor(Math.random() * 6));
    this.shade = 0.3 + Math.random() * 0.3; // brightness variation
  }
}

// ── Light Source ──
class LightSource {
  constructor(x, y, radius, intensity) {
    this.x = x;
    this.y = y;
    this.radius = radius || 60;
    this.intensity = intensity || 1;
    this.life = 8; // seconds
  }

  update(dt) {
    this.life -= dt;
    if (this.life < 2) {
      this.intensity = this.life / 2;
    }
  }
}
