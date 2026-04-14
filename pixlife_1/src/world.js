// ── World: Sandbox Environment with Ant Colony ──
// Manages all entities, pheromone grid, nest, day/night, and natural spawning.

class GameWorld {
  constructor(w, h) {
    this.pixelScale = 3;
    this.width  = Math.floor(w / this.pixelScale);
    this.height = Math.floor(h / this.pixelScale);
    this.screenWidth  = w;
    this.screenHeight = h;

    this.creatures     = [];
    this.foods         = [];
    this.rocks         = [];
    this.lights        = [];
    this.pendingBirths = [];
    this.particles     = [];

    this.maxCreatures = 50;
    this.maxFood      = 110;
    this.temperature  = 50;
    this.humidity     = 50;
    this.time         = 0;
    this.dayTime      = 0;
    this.dayLength    = 60;
    this.isNight      = false;
    this.manualNight  = false;
    this.paused       = false;
    this.maxGeneration = 0;
    this.ambientLight = 0.8;

    // Colony
    this.nest           = null;
    this.nestFood       = 0;   // total food delivered all time
    this._nestSpawnTimer = 0;

    // Pheromone grid (world-pixel resolution ÷ pheroSize)
    this.pheroSize = 3;
    this._initPheroGrid();
  }

  // ── Pheromone grid ──
  _initPheroGrid() {
    this.pheroWidth  = Math.ceil(this.width  / this.pheroSize) + 2;
    this.pheroHeight = Math.ceil(this.height / this.pheroSize) + 2;
    this.pheromones  = new Float32Array(this.pheroWidth * this.pheroHeight);
  }

  getPheromone(wx, wy) {
    const cx = Math.floor(wx / this.pheroSize);
    const cy = Math.floor(wy / this.pheroSize);
    if (cx < 0 || cx >= this.pheroWidth || cy < 0 || cy >= this.pheroHeight) return 0;
    return this.pheromones[cy * this.pheroWidth + cx];
  }

  depositPheromone(wx, wy, amount) {
    const cx = Math.floor(wx / this.pheroSize);
    const cy = Math.floor(wy / this.pheroSize);
    if (cx < 0 || cx >= this.pheroWidth || cy < 0 || cy >= this.pheroHeight) return;
    const idx = cy * this.pheroWidth + cx;
    this.pheromones[idx] = Math.min(1.0, this.pheromones[idx] + amount * 0.06);
  }

  _decayPheromones(dt) {
    // ~4% decay per second; full evaporation in ~25 s
    const factor = 1 - dt * 0.04;
    for (let i = 0; i < this.pheromones.length; i++) {
      const v = this.pheromones[i] * factor;
      this.pheromones[i] = v < 0.005 ? 0 : v;
    }
  }

  // ── Resize ──
  resize(w, h) {
    this.width  = Math.floor(w / this.pixelScale);
    this.height = Math.floor(h / this.pixelScale);
    this.screenWidth  = w;
    this.screenHeight = h;
    this._initPheroGrid();
  }

  // ── Light ──
  getLightAt(x, y) {
    let light = this.ambientLight;
    for (const ls of this.lights) {
      const dx = x - ls.x, dy = y - ls.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < ls.radius) light += ls.intensity * (1 - dist / ls.radius);
    }
    return Math.min(1, light);
  }

  // ── Spawn helpers ──
  spawnCreature(x, y, params) {
    if (this.creatures.length >= this.maxCreatures) return null;
    const c = new Creature(x / this.pixelScale, y / this.pixelScale, params);
    this.creatures.push(c);
    return c;
  }

  spawnFood(x, y, type) {
    const alive = this.foods.filter(f => f.alive).length;
    if (alive >= this.maxFood) return;
    this.foods.push(new Food(x / this.pixelScale, y / this.pixelScale, type));
  }

  spawnRock(x, y) {
    this.rocks.push(new Rock(x / this.pixelScale, y / this.pixelScale));
  }

  addLight(x, y) {
    this.lights.push(new LightSource(x / this.pixelScale, y / this.pixelScale, 50, 1));
  }

  // Apply gentle push from user touch (なでる)
  applyTouch(screenX, screenY, strength) {
    const wx = screenX / this.pixelScale;
    const wy = screenY / this.pixelScale;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const dx = c.x - wx, dy = c.y - wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 30) {
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

  // ── Natural food spawning ──
  _naturalFoodSpawn(dt) {
    const aliveFood = this.foods.filter(f => f.alive).length;
    const spawnRate = (this.humidity / 100) * 2.5;
    if (aliveFood < this.maxFood * 0.45 && Math.random() < dt * spawnRate) {
      const x = 8 + Math.random() * (this.width - 16);
      const y = 8 + Math.random() * (this.height - 16);
      // Avoid nest area
      let blocked = false;
      if (this.nest) {
        const dx = x - this.nest.x, dy = y - this.nest.y;
        if (dx * dx + dy * dy < (this.nest.radius * 2.5) * (this.nest.radius * 2.5)) blocked = true;
      }
      if (!blocked) {
        for (const r of this.rocks) {
          if (Math.abs(r.x - x) < r.size + 1 && Math.abs(r.y - y) < r.size + 1) { blocked = true; break; }
        }
      }
      if (!blocked) {
        this.foods.push(new Food(x, y, Math.random() < 0.2 ? 'fruit' : 'plant'));
      }
    }
  }

  // ── Nest-based spawning ──
  _updateNestSpawning(dt) {
    if (!this.nest) return;
    this._nestSpawnTimer += dt;
    // Every 5 food delivered → spawn a new creature (max 1 per 10 s)
    if (this.nest.foodStored >= 5 && this._nestSpawnTimer >= 10 &&
        this.creatures.length < this.maxCreatures) {
      this.nest.foodStored -= 5;
      this._nestSpawnTimer = 0;
      const angle = Math.random() * Math.PI * 2;
      const r = this.nest.radius + 4;
      const nc = new Creature(
        this.nest.x + Math.cos(angle) * r,
        this.nest.y + Math.sin(angle) * r,
        { energy: 65, generation: this.maxGeneration }
      );
      this.creatures.push(nc);
      // Celebration burst
      for (let i = 0; i < 10; i++) {
        this.particles.push({
          x: this.nest.x, y: this.nest.y,
          vx: (Math.random() - 0.5) * 18,
          vy: (Math.random() - 0.5) * 18 - 4,
          life: 1, type: 'sparkle',
        });
      }
    }
  }

  // ── Ambient particles ──
  _spawnAmbientParticles(dt) {
    if (Math.random() < dt * 2 && this.particles.length < 30) {
      this.particles.push({
        x:    Math.random() * this.width,
        y:    Math.random() * this.height,
        vx:   (Math.random() - 0.5) * 2,
        vy:   -Math.random() * 3 - 1,
        life: 1,
        type: this.isNight ? 'firefly' : 'pollen',
      });
    }
  }

  // ── Main update ──
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
      const sunAngle = this.dayTime * Math.PI * 2;
      this.ambientLight = 0.3 + 0.6 * Math.max(0, Math.cos(sunAngle - Math.PI * 0.5));
      this.isNight = this.ambientLight < 0.35;
    }

    this._naturalFoodSpawn(dt);
    this._spawnAmbientParticles(dt);
    this._decayPheromones(dt);

    if (this.nest) this.nest.update(dt);
    this._updateNestSpawning(dt);

    // Particles
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 0.3;
      if (p.type === 'firefly') {
        p.vx += (Math.random() - 0.5) * dt * 10;
        p.vy += (Math.random() - 0.5) * dt * 10;
      }
    }
    this.particles = this.particles.filter(
      p => p.life > 0 && p.x > 0 && p.x < this.width && p.y > 0 && p.y < this.height
    );

    // Lights
    for (const l of this.lights) l.update(dt);
    this.lights = this.lights.filter(l => l.life > 0);

    // Food
    for (const f of this.foods) f.update(dt, this.getLightAt(f.x, f.y));

    // Creatures
    for (const c of this.creatures) c.update(dt, this);

    // Process births
    const births = [];
    for (const parent of this.pendingBirths) {
      if (this.creatures.length + births.length < this.maxCreatures) {
        const child = parent.reproduce();
        if (child) {
          births.push(child);
          if (child.generation > this.maxGeneration) this.maxGeneration = child.generation;
        }
      }
    }
    this.pendingBirths = [];
    for (const b of births) this.creatures.push(b);

    // Remove dead creatures (leave food scraps)
    const dead = this.creatures.filter(c => !c.alive);
    for (const d of dead) {
      const aliveFood = this.foods.filter(f => f.alive).length;
      if (aliveFood < this.maxFood) {
        for (let i = 0; i < 2; i++) {
          this.foods.push(new Food(
            d.x + (Math.random() - 0.5) * 6,
            d.y + (Math.random() - 0.5) * 6,
            'fruit'
          ));
        }
      }
      for (let i = 0; i < 4; i++) {
        this.particles.push({
          x: d.x, y: d.y,
          vx: (Math.random() - 0.5) * 10,
          vy: (Math.random() - 0.5) * 10 - 3,
          life: 1, type: 'sparkle',
        });
      }
    }
    this.creatures = this.creatures.filter(c => c.alive);
    this.foods     = this.foods.filter(f => f.alive);

    // Auto-respawn if colony dies out
    if (this.creatures.length === 0) {
      this._respawnTimer = (this._respawnTimer || 0) + dt;
      if (this._respawnTimer >= 3) {
        this._respawnTimer = 0;
        const bx = this.nest ? this.nest.x : this.width * 0.5;
        const by = this.nest ? this.nest.y : this.height * 0.5;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          this.creatures.push(new Creature(bx + Math.cos(a) * 12, by + Math.sin(a) * 12, { energy: 70 }));
        }
      }
    } else {
      this._respawnTimer = 0;
    }
  }

  // ── Reset / init ──
  reset() {
    this.creatures     = [];
    this.foods         = [];
    this.rocks         = [];
    this.lights        = [];
    this.particles     = [];
    this.pendingBirths = [];
    this.time          = 0;
    this.maxGeneration = 0;
    this.nestFood      = 0;
    this._nestSpawnTimer = 0;
    this._respawnTimer   = 0;
    this._initPheroGrid();

    // Place nest roughly in the center
    this.nest = new Nest(
      Math.floor(this.width  * 0.5),
      Math.floor(this.height * 0.55)
    );

    // Initial creatures fanning out from nest
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const r = this.nest.radius + 5 + Math.random() * 8;
      this.creatures.push(new Creature(
        this.nest.x + Math.cos(angle) * r,
        this.nest.y + Math.sin(angle) * r,
        { energy: 85 }
      ));
    }

    // Scatter food (avoid nest proximity)
    for (let i = 0; i < 55; i++) {
      let x, y, ok = false, tries = 0;
      while (!ok && tries < 30) {
        x = 8 + Math.random() * (this.width - 16);
        y = 8 + Math.random() * (this.height - 16);
        const dx = x - this.nest.x, dy = y - this.nest.y;
        ok = dx * dx + dy * dy > (this.nest.radius * 2.5) * (this.nest.radius * 2.5);
        tries++;
      }
      if (ok) this.foods.push(new Food(x, y, Math.random() < 0.2 ? 'fruit' : 'plant'));
    }

    // Rocks (avoid nest)
    for (let i = 0; i < 5; i++) {
      let x, y, ok = false, tries = 0;
      while (!ok && tries < 20) {
        x = 10 + Math.random() * (this.width - 20);
        y = 10 + Math.random() * (this.height - 20);
        const dx = x - this.nest.x, dy = y - this.nest.y;
        ok = dx * dx + dy * dy > (this.nest.radius * 3) * (this.nest.radius * 3);
        tries++;
      }
      if (ok) this.rocks.push(new Rock(x, y));
    }
  }

  // ── Creature tap detection ──
  getCreatureAt(screenX, screenY) {
    const wx = screenX / this.pixelScale;
    const wy = screenY / this.pixelScale;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const dx = c.x - wx, dy = c.y - wy;
      if (dx * dx + dy * dy < (c.dna.size + 4) * (c.dna.size + 4)) return c;
    }
    return null;
  }
}
