// ── Nest: Ant Colony Home ──
class Nest {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 9;    // world pixels
    this.foodStored = 0;
    this.pulseTimer = 0;
  }

  update(dt) {
    this.pulseTimer += dt;
  }
}

// ── Creature: Pixel Life Entity with AI Brain ──
// Each creature is an ant-like life form with:
//  - Neural network brain (12 inputs → 8 hidden → 4 outputs)
//  - Colony state machine: 'searching' ↔ 'carrying'
//  - Pheromone sensing and trail deposition
//  - Energy / DNA / emotion system

let creatureIdCounter = 0;

// Input indices (12 total):
//  0: nearest food distance (0=far/none, 1=adjacent)
//  1: nearest food angle sin (relative to heading)
//  2: nearest food angle cos
//  3: nest distance (normalized 0-1)
//  4: nest angle sin
//  5: nest angle cos
//  6: pheromone strength at position (0-1)
//  7: pheromone turn bias (-1=left, +1=right)
//  8: pheromone ahead strength
//  9: is carrying food (0 or 1)
// 10: own energy (0-1)
// 11: temperature (0-1)

// Output indices (4 total):
//  0: move speed (0-1 × maxSpeed)
//  1: turn delta (0→left, 0.5→straight, 1→right)
//  2: (reserved – pick up handled by rule)
//  3: (reserved – deposit handled by rule)

class Creature {
  constructor(x, y, params = {}) {
    this.id = creatureIdCounter++;
    this.x = x;
    this.y = y;
    this.angle = params.angle != null ? params.angle : Math.random() * Math.PI * 2;
    this.speed = 0;
    this.alive = true;
    this.age = 0;

    this.dna = {
      bodyColor:  params.bodyColor  || this._warmColor(),
      eyeColor:   params.eyeColor   || '#1a1008',
      size:       params.size       || (2 + Math.floor(Math.random() * 2)),
      maxSpeed:   params.maxSpeed   || (16 + Math.random() * 16),
      metabolism: params.metabolism || (1.0 + Math.random() * 1.5),
      senseRange: params.senseRange || (45 + Math.random() * 40),
      fertility:  params.fertility  || (0.5 + Math.random() * 0.5),
    };

    this.energy = params.energy || 80;
    this.maxEnergy = 150;
    this.generation = params.generation || 0;
    this.reproductionCooldown = 0;

    this.emotion = 'neutral';
    this.emotionTimer = 0;

    this.brain = params.brain || new Brain(12, 8, 4);
    this.brain.lifetime = 0;

    this._targetAngle = this.angle;
    this._wobble = Math.random() * Math.PI * 2;
    this._lastLearnAge = 0;

    // Colony state
    this.state = 'searching'; // 'searching' | 'carrying'
    this.carryingFood = null; // Food reference while carrying

    // Trail
    this.trail = [];
    this._trailTimer = 0;
  }

  _warmColor() {
    const palettes = [
      '#e8a040','#d07830','#f8c870','#c06020','#f0a050',
      '#b85830','#e8c060','#d09840','#a04818','#f8d888',
      '#c88850','#e0b068','#d8a058','#b87038','#f0c878',
      '#90c068','#70a848','#a8d078','#80b858','#60a040',
    ];
    return palettes[Math.floor(Math.random() * palettes.length)];
  }

  _lerpAngle(from, to, t) {
    let diff = to - from;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return from + diff * t;
  }

  _senseAheadPhero(world) {
    const dist = 7;
    const left  = world.getPheromone(
      this.x + Math.cos(this.angle - 0.55) * dist,
      this.y + Math.sin(this.angle - 0.55) * dist);
    const fwd   = world.getPheromone(
      this.x + Math.cos(this.angle) * dist,
      this.y + Math.sin(this.angle) * dist);
    const right = world.getPheromone(
      this.x + Math.cos(this.angle + 0.55) * dist,
      this.y + Math.sin(this.angle + 0.55) * dist);
    return { left, fwd, right };
  }

  sense(world) {
    const inputs = new Float32Array(12);
    const range = this.dna.senseRange;

    // 0-2: nearest visible food
    let nearestFoodDist = Infinity;
    let nearestFood = null;
    for (const f of world.foods) {
      if (!f.alive || f.pickedUp) continue;
      const dx = f.x - this.x, dy = f.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestFoodDist) { nearestFoodDist = d; nearestFood = f; }
    }
    if (nearestFood && nearestFoodDist < range) {
      inputs[0] = 1 - nearestFoodDist / range;
      const fa = Math.atan2(nearestFood.y - this.y, nearestFood.x - this.x) - this.angle;
      inputs[1] = Math.sin(fa);
      inputs[2] = Math.cos(fa);
    }

    // 3-5: nest direction
    if (world.nest) {
      const ndx = world.nest.x - this.x, ndy = world.nest.y - this.y;
      const nd = Math.sqrt(ndx * ndx + ndy * ndy);
      inputs[3] = Math.max(0, 1 - nd / (range * 2));
      const na = Math.atan2(ndy, ndx) - this.angle;
      inputs[4] = Math.sin(na);
      inputs[5] = Math.cos(na);
    }

    // 6-8: pheromone sensing
    const ph = this._senseAheadPhero(world);
    const maxP = Math.max(ph.left, ph.fwd, ph.right);
    inputs[6] = maxP;
    inputs[7] = ph.left > ph.right ? -1 : (ph.right > ph.left ? 1 : 0);
    inputs[8] = ph.fwd;

    // 9: state
    inputs[9] = this.state === 'carrying' ? 1 : 0;
    // 10: energy
    inputs[10] = this.energy / this.maxEnergy;
    // 11: temperature
    inputs[11] = world.temperature / 100;

    return inputs;
  }

  update(dt, world) {
    if (!this.alive) return;
    this.age += dt;
    this.brain.lifetime += dt;
    this._wobble += dt * 4;
    if (this.reproductionCooldown > 0) this.reproductionCooldown -= dt;
    this.emotionTimer -= dt;

    // Metabolism
    const tempFactor = 0.5 + Math.abs(world.temperature - 50) / 100;
    const carryPenalty = this.state === 'carrying' ? 1.25 : 1;
    this.energy -= this.dna.metabolism * dt * tempFactor * carryPenalty;

    // Brain
    const inputs = this.sense(world);
    const outputs = this.brain.think(inputs);
    const neuralSpeed = outputs[0];
    const neuralTurn = (outputs[1] - 0.5) * Math.PI * 2;

    // State machine
    if (this.state === 'searching') {
      this._updateSearching(dt, world, neuralSpeed, neuralTurn);
    } else {
      this._updateCarrying(dt, world, neuralSpeed, neuralTurn);
    }

    // Apply movement
    const wobbleX = Math.sin(this._wobble) * 0.18;
    const wobbleY = Math.cos(this._wobble * 0.7) * 0.18;
    this.x += (Math.cos(this.angle) * this.speed + wobbleX) * dt;
    this.y += (Math.sin(this.angle) * this.speed + wobbleY) * dt;
    this.energy -= this.speed * 0.012 * dt;

    // Boundaries
    const m = this.dna.size + 1;
    if (this.x < m)                    { this.x = m;                     this.angle = Math.PI - this.angle; }
    if (this.x > world.width - m)      { this.x = world.width - m;       this.angle = Math.PI - this.angle; }
    if (this.y < m)                    { this.y = m;                      this.angle = -this.angle; }
    if (this.y > world.height - m)     { this.y = world.height - m;      this.angle = -this.angle; }

    // Rock collision
    for (const rock of world.rocks) {
      const dx = this.x - rock.x, dy = this.y - rock.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = rock.size + this.dna.size;
      if (dist < minDist && dist > 0) {
        const push = (minDist - dist) / dist;
        this.x += dx * push;
        this.y += dy * push;
        this.angle += (Math.random() - 0.5) * 1.5;
      }
    }

    // Emotion
    if (this.emotionTimer <= 0) {
      if      (this.energy < this.maxEnergy * 0.2) this.emotion = 'hungry';
      else if (this.state === 'carrying')           this.emotion = 'focused';
      else                                           this.emotion = 'neutral';
    }

    // Trail
    this._trailTimer += dt;
    if (this._trailTimer > 0.25 && this.speed > 3) {
      this._trailTimer = 0;
      this.trail.push({ x: this.x, y: this.y, life: 1 });
      if (this.trail.length > 10) this.trail.shift();
    }
    for (const t of this.trail) t.life -= dt * 0.6;
    this.trail = this.trail.filter(t => t.life > 0);

    // Lifetime learning (every 5 s)
    if (this.age - this._lastLearnAge >= 5) {
      this._lastLearnAge = this.age;
      this.brain.learn(0.005);
    }

    // Reproduction (only while searching and healthy)
    if (this.canReproduce()) {
      world.pendingBirths.push(this);
    }

    // Death
    if (this.energy <= 0) this.alive = false;
  }

  _updateSearching(dt, world, neuralSpeed, neuralTurn) {
    // Find nearest food
    let nearestFood = null, nearestFoodDist = this.dna.senseRange;
    for (const f of world.foods) {
      if (!f.alive || f.pickedUp) continue;
      const dx = f.x - this.x, dy = f.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestFoodDist) { nearestFoodDist = d; nearestFood = f; }
    }

    if (nearestFood) {
      // Hard steer toward food, neural net adds small variation
      const foodAngle = Math.atan2(nearestFood.y - this.y, nearestFood.x - this.x);
      this._targetAngle = this._lerpAngle(this.angle, foodAngle, 0.12) + neuralTurn * dt * 0.15;

      // Pick up if adjacent
      const pickDist = this.dna.size + nearestFood.size + 2;
      if (nearestFoodDist < pickDist) {
        this._pickupFood(nearestFood, world);
        return;
      }
    } else {
      // Follow pheromone or wander
      const ph = this._senseAheadPhero(world);
      const maxP = Math.max(ph.left, ph.fwd, ph.right);
      if (maxP > 0.04) {
        // Turn toward highest pheromone sector
        let pheroTurn = 0;
        if (ph.left > ph.right && ph.left > ph.fwd)        pheroTurn = -0.45;
        else if (ph.right > ph.left && ph.right > ph.fwd)  pheroTurn = +0.45;
        this._targetAngle = this.angle + pheroTurn * dt * 6 + neuralTurn * dt * 0.2;
      } else {
        // Pure wander driven by neural net
        this._targetAngle = this.angle + neuralTurn * dt;
      }
    }

    this.angle = this._lerpAngle(this.angle, this._targetAngle, 0.22);
    const targetSpeed = (0.25 + neuralSpeed * 0.75) * this.dna.maxSpeed;
    this.speed += (targetSpeed - this.speed) * 0.14;
  }

  _updateCarrying(dt, world, neuralSpeed, neuralTurn) {
    if (!world.nest) { this.state = 'searching'; this.carryingFood = null; return; }

    // Deposit pheromone trail on path back to nest
    world.depositPheromone(this.x, this.y, 0.65);

    // Hard steer toward nest, neural net adds tiny variation
    const nestAngle = Math.atan2(world.nest.y - this.y, world.nest.x - this.x);
    this._targetAngle = this._lerpAngle(this.angle, nestAngle, 0.18) + neuralTurn * dt * 0.08;
    this.angle = this._lerpAngle(this.angle, this._targetAngle, 0.3);

    const targetSpeed = (0.45 + neuralSpeed * 0.55) * this.dna.maxSpeed;
    this.speed += (targetSpeed - this.speed) * 0.18;

    // Deposit at nest
    const dx = world.nest.x - this.x, dy = world.nest.y - this.y;
    if (dx * dx + dy * dy < (world.nest.radius + this.dna.size) * (world.nest.radius + this.dna.size)) {
      this._depositAtNest(world);
    }
  }

  _pickupFood(food, world) {
    food.pickedUp = true;
    food.alive = false;
    this.state = 'carrying';
    this.carryingFood = food;
    this.emotion = 'happy';
    this.emotionTimer = 2;
    this.brain.reward += food.energy * 0.08;
    this.energy = Math.min(this.maxEnergy, this.energy + 5);
  }

  _depositAtNest(world) {
    if (!this.carryingFood) { this.state = 'searching'; return; }
    world.nestFood += 1;
    world.nest.foodStored += 1;
    this.energy = Math.min(this.maxEnergy, this.energy + 18);
    this.brain.reward += 3;
    this.state = 'searching';
    this.carryingFood = null;
    this.emotion = 'happy';
    this.emotionTimer = 2.5;
    // Turn away from nest to go explore again
    this.angle += Math.PI + (Math.random() - 0.5) * 0.8;
  }

  canReproduce() {
    return this.alive &&
           this.energy > this.maxEnergy * 0.78 &&
           this.reproductionCooldown <= 0 &&
           this.age > 10 &&
           this.state === 'searching';
  }

  reproduce() {
    if (!this.canReproduce()) return null;
    this.energy *= 0.55;
    this.reproductionCooldown = 14;

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
    const childAngle = Math.random() * Math.PI * 2;
    const offset = this.dna.size * 4;

    return new Creature(
      this.x + Math.cos(childAngle) * offset,
      this.y + Math.sin(childAngle) * offset,
      {
        bodyColor:  mutColor(this.dna.bodyColor),
        eyeColor:   this.dna.eyeColor,
        size:       Math.max(1, Math.min(5, this.dna.size + (Math.random() < 0.1 ? (Math.random() < 0.5 ? 1 : -1) : 0))),
        maxSpeed:   Math.max(8, Math.min(40, this.dna.maxSpeed + (Math.random()-0.5) * 4)),
        metabolism: Math.max(0.5, Math.min(4,  this.dna.metabolism + (Math.random()-0.5) * 0.3)),
        senseRange: Math.max(20, Math.min(120, this.dna.senseRange + (Math.random()-0.5) * 10)),
        fertility:  Math.max(0.3, Math.min(1,  this.dna.fertility + (Math.random()-0.5) * 0.1)),
        energy:     this.energy * 0.7,
        generation: this.generation + 1,
        brain:      childBrain,
        angle:      childAngle,
      }
    );
  }
}

// ── Food ──
class Food {
  constructor(x, y, type = 'plant') {
    this.x = x;
    this.y = y;
    this.type = type;
    this.energy = type === 'fruit' ? 22 + Math.random() * 12 : 8 + Math.random() * 8;
    this.size = type === 'fruit' ? 3 : 2;
    this.alive = true;
    this.pickedUp = false; // true while a creature is carrying this
    this.age = 0;
    this.growthPhase = 0;
  }

  update(dt, light) {
    if (!this.alive) return;
    this.age += dt;
    if (this.growthPhase < 1) this.growthPhase = Math.min(1, this.growthPhase + dt * 0.8);
    if (this.type === 'plant' && light > 0.5) this.energy = Math.min(22, this.energy + dt * 0.5);
    if (this.age > 35) this.alive = false;
  }
}

// ── Rock (obstacle) ──
class Rock {
  constructor(x, y, size) {
    this.x = x;
    this.y = y;
    this.size = size || (4 + Math.floor(Math.random() * 5));
    this.shade = 0.3 + Math.random() * 0.3;
  }
}

// ── Light Source ──
class LightSource {
  constructor(x, y, radius, intensity) {
    this.x = x;
    this.y = y;
    this.radius = radius || 60;
    this.intensity = intensity || 1;
    this.life = 8;
  }

  update(dt) {
    this.life -= dt;
    if (this.life < 2) this.intensity = this.life / 2;
  }
}
