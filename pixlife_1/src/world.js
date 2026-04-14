// ── World: Sandbox Environment ──
// Manages all entities, environment state, day/night cycle, and natural spawning.

class GameWorld {
  constructor(w, h) {
    this.pixelScale = 3; // each pixel is 3x3 screen pixels
    this.width = Math.floor(w / this.pixelScale);
    this.height = Math.floor(h / this.pixelScale);
    this.screenWidth = w;
    this.screenHeight = h;

    this.creatures = [];
    this.foods = [];
    this.rocks = [];
    this.lights = [];
    this.pendingBirths = [];
    this.particles = []; // ambient particles

    this.maxCreatures = 40;
    this.maxFood = 120;
    this.temperature = 50;  // 0-100
    this.humidity = 50;     // 0-100
    this.time = 0;
    this.dayTime = 0;       // 0-1 cycle (0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight)
    this.dayLength = 60;    // seconds per full day cycle
    this.isNight = false;
    this.manualNight = false;
    this.paused = false;
    this.maxGeneration = 0;

    // Ambient light map (simplified: uniform + light sources)
    this.ambientLight = 0.8;
  }

  resize(w, h) {
    this.width = Math.floor(w / this.pixelScale);
    this.height = Math.floor(h / this.pixelScale);
    this.screenWidth = w;
    this.screenHeight = h;
  }

  // Get light level at a world position (0-1)
  getLightAt(x, y) {
    let light = this.ambientLight;
    for (const ls of this.lights) {
      const dx = x - ls.x;
      const dy = y - ls.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < ls.radius) {
        light += ls.intensity * (1 - dist / ls.radius);
      }
    }
    return Math.min(1, light);
  }

  spawnCreature(x, y, params) {
    if (this.creatures.length >= this.maxCreatures) return null;
    // Convert screen coords to world coords
    const wx = x / this.pixelScale;
    const wy = y / this.pixelScale;
    const c = new Creature(wx, wy, params);
    this.creatures.push(c);
    return c;
  }

  spawnFood(x, y, type) {
    if (this.foods.length >= this.maxFood) return;
    const wx = x / this.pixelScale;
    const wy = y / this.pixelScale;
    this.foods.push(new Food(wx, wy, type));
  }

  spawnRock(x, y) {
    const wx = x / this.pixelScale;
    const wy = y / this.pixelScale;
    this.rocks.push(new Rock(wx, wy));
  }

  addLight(x, y) {
    const wx = x / this.pixelScale;
    const wy = y / this.pixelScale;
    this.lights.push(new LightSource(wx, wy, 50, 1));
  }

  // Apply gentle push from user touch (なでる)
  applyTouch(screenX, screenY, strength) {
    const wx = screenX / this.pixelScale;
    const wy = screenY / this.pixelScale;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const dx = c.x - wx;
      const dy = c.y - wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 30) {
        // Gentle push away from touch + slight energy boost
        const pushForce = strength / (dist + 5);
        c.x += dx * pushForce * 0.5;
        c.y += dy * pushForce * 0.5;
        c.energy = Math.min(c.maxEnergy, c.energy + 0.5);
        c.emotion = 'happy';
        c.emotionTimer = 2;
        c.brain.reward += 0.3;
      }
    }
  }

  _naturalFoodSpawn(dt) {
    // Spawn food naturally
    const spawnRate = this.humidity / 100 * 3; // higher humidity = more food
    if (this.foods.length < this.maxFood * 0.5 && Math.random() < dt * spawnRate) {
      const x = 5 + Math.random() * (this.width - 10);
      const y = 5 + Math.random() * (this.height - 10);
      // Avoid rocks
      let blocked = false;
      for (const r of this.rocks) {
        if (Math.abs(r.x - x) < r.size && Math.abs(r.y - y) < r.size) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        this.foods.push(new Food(x, y, Math.random() < 0.2 ? 'fruit' : 'plant'));
      }
    }
  }

  _spawnAmbientParticles(dt) {
    if (Math.random() < dt * 2 && this.particles.length < 30) {
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 2,
        vy: -Math.random() * 3 - 1,
        life: 1,
        type: this.isNight ? 'firefly' : 'pollen',
      });
    }
  }

  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;

    // Day/night cycle
    this.dayTime = (this.time / this.dayLength) % 1;
    if (this.manualNight) {
      this.ambientLight = 0.15;
      this.isNight = true;
    } else {
      // Smooth day/night: peaks at noon (0.25), darkest at midnight (0.75)
      const sunAngle = this.dayTime * Math.PI * 2;
      this.ambientLight = 0.3 + 0.6 * Math.max(0, Math.cos(sunAngle - Math.PI * 0.5));
      this.isNight = this.ambientLight < 0.35;
    }

    // Natural food spawning
    this._naturalFoodSpawn(dt);

    // Ambient particles
    this._spawnAmbientParticles(dt);

    // Update particles
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 0.3;
      if (p.type === 'firefly') {
        p.vx += (Math.random() - 0.5) * dt * 10;
        p.vy += (Math.random() - 0.5) * dt * 10;
      }
    }
    this.particles = this.particles.filter(p => p.life > 0 && p.x > 0 && p.x < this.width && p.y > 0 && p.y < this.height);

    // Update lights
    for (const l of this.lights) {
      l.update(dt);
    }
    this.lights = this.lights.filter(l => l.life > 0);

    // Update food
    for (const f of this.foods) {
      f.update(dt, this.getLightAt(f.x, f.y));
    }

    // Update creatures
    for (const c of this.creatures) {
      c.update(dt, this);
    }

    // Process births
    const births = [];
    for (const parent of this.pendingBirths) {
      if (this.creatures.length + births.length < this.maxCreatures) {
        const child = parent.reproduce();
        if (child) {
          births.push(child);
          if (child.generation > this.maxGeneration) {
            this.maxGeneration = child.generation;
          }
        }
      }
    }
    this.pendingBirths = [];
    for (const b of births) {
      this.creatures.push(b);
    }

    // Remove dead
    const deadCreatures = this.creatures.filter(c => !c.alive);
    for (const dead of deadCreatures) {
      // Spawn food from dead creature
      const numDrops = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < numDrops; i++) {
        const fx = dead.x + (Math.random() - 0.5) * 8;
        const fy = dead.y + (Math.random() - 0.5) * 8;
        if (this.foods.length < this.maxFood) {
          this.foods.push(new Food(fx, fy, 'fruit'));
        }
      }
      // Death particles
      for (let i = 0; i < 5; i++) {
        this.particles.push({
          x: dead.x,
          y: dead.y,
          vx: (Math.random() - 0.5) * 10,
          vy: (Math.random() - 0.5) * 10 - 5,
          life: 1,
          type: 'sparkle',
        });
      }
    }
    this.creatures = this.creatures.filter(c => c.alive);
    this.foods = this.foods.filter(f => f.alive);

    // Auto-spawn if population dies out
    if (this.creatures.length === 0 && Math.random() < dt * 0.5) {
      const x = this.width * 0.3 + Math.random() * this.width * 0.4;
      const y = this.height * 0.3 + Math.random() * this.height * 0.4;
      this.creatures.push(new Creature(x, y));
    }
  }

  reset() {
    this.creatures = [];
    this.foods = [];
    this.rocks = [];
    this.lights = [];
    this.particles = [];
    this.pendingBirths = [];
    this.time = 0;
    this.maxGeneration = 0;

    // Spawn initial creatures
    for (let i = 0; i < 8; i++) {
      const x = this.width * 0.15 + Math.random() * this.width * 0.7;
      const y = this.height * 0.15 + Math.random() * this.height * 0.7;
      this.creatures.push(new Creature(x, y));
    }

    // Spawn initial food
    for (let i = 0; i < 40; i++) {
      const x = 5 + Math.random() * (this.width - 10);
      const y = 5 + Math.random() * (this.height - 10);
      this.foods.push(new Food(x, y, Math.random() < 0.2 ? 'fruit' : 'plant'));
    }

    // Spawn some rocks
    for (let i = 0; i < 6; i++) {
      const x = 10 + Math.random() * (this.width - 20);
      const y = 10 + Math.random() * (this.height - 20);
      this.rocks.push(new Rock(x, y));
    }
  }

  // Get the creature at a screen position (for info panel)
  getCreatureAt(screenX, screenY) {
    const wx = screenX / this.pixelScale;
    const wy = screenY / this.pixelScale;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const dx = c.x - wx;
      const dy = c.y - wy;
      if (dx * dx + dy * dy < (c.dna.size + 3) * (c.dna.size + 3)) {
        return c;
      }
    }
    return null;
  }
}
