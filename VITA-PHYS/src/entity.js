// ── Entity (Soft-Body Creature) ──
// Each creature is a collection of PhysNodes connected by PhysSprings.
// The core node stores energy and drives behavior.

let entityIdCounter = 0;

class Entity {
  constructor(x, y, params = {}) {
    this.id = entityIdCounter++;
    this.nodes = [];
    this.springs = [];
    this.alive = true;
    this.age = 0;

    // Genetic parameters (inheritable + mutable)
    this.gene = {
      numPetals:  params.numPetals  || (4 + Math.floor(Math.random() * 5)),   // 4-8 outer nodes
      elasticity: params.elasticity || (0.3 + Math.random() * 0.5),           // spring stiffness
      friction:   params.friction   || (0.6 + Math.random() * 0.3),
      metabolism: params.metabolism  || (0.3 + Math.random() * 0.5),           // energy burn rate
      pulseFreq:  params.pulseFreq  || (1.5 + Math.random() * 3),             // locomotion rhythm (Hz)
      pulseAmp:   params.pulseAmp   || (0.15 + Math.random() * 0.2),          // locomotion amplitude
      hue:        params.hue != null ? params.hue : Math.random() * 360,
      baseRadius: params.baseRadius || (14 + Math.random() * 10),
    };

    this.energy = params.energy || 60;
    this.maxEnergy = 200;
    this.generation = params.generation || 0;
    this.divideThreshold = 140;

    this._buildBody(x, y);
    this._phaseOffset = Math.random() * Math.PI * 2;
  }

  _buildBody(cx, cy) {
    const g = this.gene;
    const coreNode = new PhysNode(new Vec2(cx, cy), 2);
    coreNode.radius = 5;
    coreNode.isCore = true;
    this.nodes.push(coreNode);
    this.core = coreNode;

    const n = g.numPetals;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 / n) * i;
      const r = g.baseRadius * this._sizeMultiplier();
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      const node = new PhysNode(new Vec2(px, py), 0.8);
      node.radius = 3;
      this.nodes.push(node);

      // Connect to core
      this.springs.push(new PhysSpring(coreNode, node, r, g.elasticity));
    }

    // Connect adjacent petals to form surface
    for (let i = 1; i <= n; i++) {
      const next = (i % n) + 1;
      const dist = this.nodes[i].pos.dist(this.nodes[next].pos);
      this.springs.push(new PhysSpring(this.nodes[i], this.nodes[next], dist, g.elasticity * 0.6));
    }
  }

  _sizeMultiplier() {
    return 0.6 + (this.energy / this.maxEnergy) * 0.8;
  }

  update(dt, time, viscosity) {
    if (!this.alive) return;
    this.age += dt;

    // ── Metabolism: burn energy over time ──
    this.energy -= this.gene.metabolism * dt * 2;

    // ── Locomotion: rhythmic spring pulsing ──
    const phase = time * this.gene.pulseFreq * Math.PI * 2 + this._phaseOffset;
    const pulse = Math.sin(phase) * this.gene.pulseAmp;
    const sizeMul = this._sizeMultiplier();

    for (let i = 0; i < this.springs.length; i++) {
      const s = this.springs[i];
      if (s.broken) continue;
      // Only pulse core-to-petal springs
      if (s.a === this.core || s.b === this.core) {
        const baseLen = this.gene.baseRadius * sizeMul;
        s.restLen = baseLen * (1 + pulse);
      }
    }

    // ── Viscous drag ──
    const drag = 1 - viscosity * 0.004;
    for (const n of this.nodes) {
      const vx = n.pos.x - n.prev.x;
      const vy = n.pos.y - n.prev.y;
      n.prev.x = n.pos.x - vx * drag;
      n.prev.y = n.pos.y - vy * drag;
    }

    // ── Growth: update spring rest lengths ──
    for (let i = 0; i < this.springs.length; i++) {
      const s = this.springs[i];
      if (s.broken || s.a === this.core || s.b === this.core) continue;
      // surface springs
      const idx1 = this.nodes.indexOf(s.a) - 1;
      const idx2 = this.nodes.indexOf(s.b) - 1;
      if (idx1 >= 0 && idx2 >= 0) {
        const angle1 = (Math.PI * 2 / this.gene.numPetals) * idx1;
        const angle2 = (Math.PI * 2 / this.gene.numPetals) * idx2;
        const r = this.gene.baseRadius * sizeMul;
        const p1 = Vec2.fromAngle(angle1, r);
        const p2 = Vec2.fromAngle(angle2, r);
        s.restLen = p1.dist(p2);
      }
    }

    // ── Death check ──
    if (this.energy <= 0) {
      this.die();
    }
  }

  // Try to eat a nutrient particle (returns true if eaten)
  tryEat(particle) {
    if (!this.alive || !particle.alive) return false;
    const d = this.core.pos.distSq(particle.pos);
    const eatRange = (this.gene.baseRadius * this._sizeMultiplier() + 6);
    if (d < eatRange * eatRange) {
      this.energy = Math.min(this.maxEnergy, this.energy + particle.energy);
      particle.alive = false;
      return true;
    }
    return false;
  }

  // Check collision with another entity for predation
  tryPredation(other) {
    if (!this.alive || !other.alive) return;
    if (this.id === other.id) return;

    const d = this.core.pos.distSq(other.core.pos);
    const mySize = this.gene.baseRadius * this._sizeMultiplier();
    const otherSize = other.gene.baseRadius * other._sizeMultiplier();
    const contactDist = mySize + otherSize;

    if (d < contactDist * contactDist) {
      // Larger entity damages smaller
      if (mySize > otherSize * 1.2) {
        const damage = (mySize - otherSize) * 0.3;
        other.energy -= damage;
        this.energy = Math.min(this.maxEnergy, this.energy + damage * 0.5);

        // Physical push
        const dx = other.core.pos.x - this.core.pos.x;
        const dy = other.core.pos.y - this.core.pos.y;
        const dist = Math.sqrt(d) || 1;
        const pushF = 80 / dist;
        other.core.applyForce(new Vec2(dx * pushF, dy * pushF));
      }
    }
  }

  // Division / Mitosis
  canDivide() {
    return this.alive && this.energy >= this.divideThreshold;
  }

  divide() {
    if (!this.canDivide()) return null;

    const offset = 20;
    const angle = Math.random() * Math.PI * 2;
    const childX = this.core.pos.x + Math.cos(angle) * offset;
    const childY = this.core.pos.y + Math.sin(angle) * offset;

    // Mutate genes
    const mutate = (v, range) => v + (Math.random() - 0.5) * range;
    const childParams = {
      numPetals:  Math.max(3, Math.min(10, this.gene.numPetals + (Math.random() < 0.15 ? (Math.random() < 0.5 ? 1 : -1) : 0))),
      elasticity: Math.max(0.1, Math.min(0.9, mutate(this.gene.elasticity, 0.1))),
      friction:   Math.max(0.2, Math.min(0.95, mutate(this.gene.friction, 0.08))),
      metabolism: Math.max(0.1, Math.min(1.5, mutate(this.gene.metabolism, 0.1))),
      pulseFreq:  Math.max(0.5, Math.min(6, mutate(this.gene.pulseFreq, 0.5))),
      pulseAmp:   Math.max(0.05, Math.min(0.4, mutate(this.gene.pulseAmp, 0.05))),
      hue:        (this.gene.hue + (Math.random() - 0.5) * 30 + 360) % 360,
      baseRadius: Math.max(10, Math.min(28, mutate(this.gene.baseRadius, 3))),
      energy:     this.energy * 0.45,
      generation: this.generation + 1,
    };

    this.energy *= 0.45;

    // Update own spring rest lengths after energy drop
    const sizeMul = this._sizeMultiplier();
    for (const s of this.springs) {
      if (s.a === this.core || s.b === this.core) {
        s.restLen = this.gene.baseRadius * sizeMul;
      }
    }

    return new Entity(childX, childY, childParams);
  }

  die() {
    this.alive = false;
  }

  // Returns positions of all nodes for rendering
  getNodePositions() {
    return this.nodes.map(n => n.pos);
  }

  getCenter() {
    return this.core.pos.clone();
  }

  getRadius() {
    return this.gene.baseRadius * this._sizeMultiplier();
  }
}
