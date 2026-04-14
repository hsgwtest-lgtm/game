// ── Nutrient Particle ──
class Nutrient {
  constructor(x, y, energy) {
    this.pos = new Vec2(x, y);
    this.vel = new Vec2((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
    this.energy = energy || (3 + Math.random() * 5);
    this.alive = true;
    this.radius = 2 + this.energy * 0.3;
    this.hue = 100 + Math.random() * 40;   // green-ish
    this.age = 0;
  }

  update(dt, gravity, viscosity, worldW, worldH) {
    if (!this.alive) return;
    this.age += dt;

    // Apply gravity
    this.vel.x += gravity.x * dt;
    this.vel.y += gravity.y * dt;

    // Viscous drag
    const drag = 1 - viscosity * 0.01;
    this.vel.x *= drag;
    this.vel.y *= drag;

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Bounce off walls
    if (this.pos.x < this.radius) { this.pos.x = this.radius; this.vel.x *= -0.5; }
    if (this.pos.x > worldW - this.radius) { this.pos.x = worldW - this.radius; this.vel.x *= -0.5; }
    if (this.pos.y < this.radius) { this.pos.y = this.radius; this.vel.y *= -0.5; }
    if (this.pos.y > worldH - this.radius) { this.pos.y = worldH - this.radius; this.vel.y *= -0.5; }
  }
}

// ── Decay Particle (from dead entity) ──
class DecayParticle {
  constructor(pos, vel, energy) {
    this.pos = pos.clone();
    this.vel = vel ? vel.clone() : new Vec2((Math.random()-0.5)*60, (Math.random()-0.5)*60);
    this.energy = energy;
    this.life = 1;
    this.decay = 0.3 + Math.random() * 0.3;
    this.radius = 2 + energy * 0.2;
    this.alive = true;
  }
  update(dt) {
    this.life -= this.decay * dt;
    this.vel.y += 40 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.vel.x *= 0.98;
    this.vel.y *= 0.98;
    if (this.life <= 0) this.alive = false;
  }
}

// ── Game World ──
class GameWorld {
  constructor(w, h) {
    this.width = w;
    this.height = h;
    this.physics = new PhysicsEngine(w, h);
    this.entities = [];
    this.nutrients = [];
    this.decayParticles = [];
    this.maxEntities = 60;
    this.maxNutrients = 200;
    this.viscosity = 20;         // 0-100
    this.gravityStrength = 30;   // 0-100
    this.time = 0;
    this.maxGeneration = 0;
    this.paused = false;

    // Object pool for nutrients
    this._nutrientPool = [];
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.physics.width = w;
    this.physics.height = h;
  }

  spawnEntity(x, y, params) {
    if (this.entities.length >= this.maxEntities) return null;
    const e = new Entity(x, y, params);
    this.entities.push(e);
    return e;
  }

  spawnNutrient(x, y, energy) {
    if (this.nutrients.length >= this.maxNutrients) return;
    const n = new Nutrient(x, y, energy);
    this.nutrients.push(n);
  }

  spawnNutrientBurst(x, y, count) {
    for (let i = 0; i < count; i++) {
      const ox = (Math.random() - 0.5) * 40;
      const oy = (Math.random() - 0.5) * 40;
      this.spawnNutrient(x + ox, y + oy);
    }
  }

  // Natural nutrient spawning
  _naturalSpawn(dt) {
    // Spawn nutrients at random positions
    if (this.nutrients.length < this.maxNutrients * 0.6 && Math.random() < dt * 3) {
      this.spawnNutrient(
        30 + Math.random() * (this.width - 60),
        30 + Math.random() * (this.height - 60)
      );
    }
  }

  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 0.033); // cap at ~30fps worth
    this.time += dt;

    // Update gravity
    const gStr = this.gravityStrength * 5;
    this.physics.gravity.set(0, gStr);
    this.physics.damping = 0.98 - this.viscosity * 0.002;

    // Natural spawning
    this._naturalSpawn(dt);

    // Collect all physics nodes and springs
    const allNodes = [];
    const allSprings = [];
    for (const e of this.entities) {
      if (!e.alive) continue;
      for (const n of e.nodes) allNodes.push(n);
      for (const s of e.springs) {
        if (!s.broken) allSprings.push(s);
      }
    }

    // Physics step
    this.physics.step(allNodes, allSprings, dt);

    // Update entities
    for (const e of this.entities) {
      e.update(dt, this.time, this.viscosity);
    }

    // Nutrient update
    for (const n of this.nutrients) {
      n.update(dt, this.physics.gravity, this.viscosity, this.width, this.height);
    }

    // Decay particles
    for (const p of this.decayParticles) {
      p.update(dt);
    }

    // ── Interactions ──
    // Entity eats nutrients
    for (const e of this.entities) {
      if (!e.alive) continue;
      for (const n of this.nutrients) {
        if (n.alive) e.tryEat(n);
      }
    }

    // Predation between entities
    for (let i = 0; i < this.entities.length; i++) {
      for (let j = i + 1; j < this.entities.length; j++) {
        const a = this.entities[i];
        const b = this.entities[j];
        if (a.alive && b.alive) {
          a.tryPredation(b);
          b.tryPredation(a);
        }
      }
    }

    // ── Division ──
    const newborns = [];
    for (const e of this.entities) {
      if (e.canDivide() && this.entities.length + newborns.length < this.maxEntities) {
        const child = e.divide();
        if (child) {
          newborns.push(child);
          if (child.generation > this.maxGeneration) {
            this.maxGeneration = child.generation;
          }
        }
      }
    }
    for (const nb of newborns) {
      this.entities.push(nb);
    }

    // ── Death & Decay ──
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (!e.alive) {
        // Spawn decay particles & nutrients from corpse
        for (const node of e.nodes) {
          this.decayParticles.push(new DecayParticle(
            node.pos,
            new Vec2((Math.random()-0.5)*80, (Math.random()-0.5)*80 - 30),
            e.energy > 0 ? e.energy / e.nodes.length : 1
          ));
          // Convert some corpse mass into nutrients
          if (Math.random() < 0.5) {
            this.spawnNutrient(
              node.pos.x + (Math.random()-0.5)*20,
              node.pos.y + (Math.random()-0.5)*20,
              2 + Math.random() * 3
            );
          }
        }
        this.entities.splice(i, 1);
      }
    }

    // Clean up dead nutrients & decay particles
    this.nutrients = this.nutrients.filter(n => n.alive);
    this.decayParticles = this.decayParticles.filter(p => p.alive);

    // Auto-spawn entities if population dies out
    if (this.entities.length === 0 && Math.random() < dt * 0.5) {
      this.spawnEntity(
        this.width * 0.3 + Math.random() * this.width * 0.4,
        this.height * 0.3 + Math.random() * this.height * 0.4
      );
    }
  }

  // Apply local gravity towards a point (touch interaction)
  applyLocalGravity(x, y, strength) {
    for (const e of this.entities) {
      if (!e.alive) continue;
      for (const n of e.nodes) {
        const dx = x - n.pos.x;
        const dy = y - n.pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 1) continue;
        const dist = Math.sqrt(distSq);
        const force = strength / (dist + 50);
        n.applyForce(new Vec2(dx * force, dy * force));
      }
    }
    // Also attract nutrients
    for (const n of this.nutrients) {
      if (!n.alive) continue;
      const dx = x - n.pos.x;
      const dy = y - n.pos.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      const f = strength * 0.3 / (dist + 50);
      n.vel.x += dx * f;
      n.vel.y += dy * f;
    }
  }

  addWall(x1, y1, x2, y2) {
    this.physics.walls.push(new PhysWall(x1, y1, x2, y2));
  }

  clearWalls() {
    this.physics.walls = [];
  }

  reset() {
    this.entities = [];
    this.nutrients = [];
    this.decayParticles = [];
    this.physics.walls = [];
    this.time = 0;
    this.maxGeneration = 0;

    // Spawn initial entities
    for (let i = 0; i < 5; i++) {
      this.spawnEntity(
        this.width * 0.2 + Math.random() * this.width * 0.6,
        this.height * 0.2 + Math.random() * this.height * 0.6
      );
    }

    // Initial nutrients
    for (let i = 0; i < 60; i++) {
      this.spawnNutrient(
        30 + Math.random() * (this.width - 60),
        30 + Math.random() * (this.height - 60)
      );
    }
  }
}
