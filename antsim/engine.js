/* =====================================================
   AntSim - リアルなアリ生態シミュレータ
   ===================================================== */

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────
  const WORLD_W = 1200;
  const WORLD_H = 800;
  const GRID_SIZE = 4;           // pheromone grid cell size
  const GRID_W = (WORLD_W / GRID_SIZE) | 0;
  const GRID_H = (WORLD_H / GRID_SIZE) | 0;
  const GRID_CELLS = GRID_W * GRID_H;

  const MAX_ANTS = 4000;
  const SPATIAL_CELL = 16;
  const SPATIAL_W = (WORLD_W / SPATIAL_CELL) | 0;
  const SPATIAL_H = (WORLD_H / SPATIAL_CELL) | 0;

  // Pheromone channels per species (3 species × 3 types = 9 channels)
  const PHERO_FOOD = 0;
  const PHERO_HOME = 1;
  const PHERO_DANGER = 2;
  const PHERO_TYPES = 3;
  const MAX_SPECIES = 3;
  const TOTAL_PHERO_CHANNELS = MAX_SPECIES * PHERO_TYPES;

  // Ant roles
  const ROLE_WORKER = 0;
  const ROLE_SOLDIER = 1;
  const ROLE_QUEEN = 2;

  // Ant states
  const STATE_EXPLORE = 0;
  const STATE_RETURN_HOME = 1;
  const STATE_CARRY_FOOD = 2;
  const STATE_FIGHT = 3;
  const STATE_FLEE = 4;

  // Terrain
  const TERRAIN_EMPTY = 0;
  const TERRAIN_WALL = 1;
  const TERRAIN_WATER = 2;
  const TERRAIN_NEST = 3;  // packed with species id

  // Species configs
  const SPECIES = [
    { name: '赤アリ', color: [200, 60, 60], bodyR: 2.2, speed: 1.2, attack: 1.0, pheroStr: 1.0, spawnRate: 0.008 },
    { name: '緑アリ', color: [60, 180, 60], bodyR: 2.6, speed: 0.9, attack: 1.3, pheroStr: 0.8, spawnRate: 0.006 },
    { name: '青アリ', color: [60, 60, 200], bodyR: 1.8, speed: 1.5, attack: 0.7, pheroStr: 1.3, spawnRate: 0.010 },
  ];

  // ─── Pheromone grids (Float32Array) ─────────────────
  const pheroGrids = [];
  for (let i = 0; i < TOTAL_PHERO_CHANNELS; i++) {
    pheroGrids.push(new Float32Array(GRID_CELLS));
  }

  // Temp buffer for diffusion
  const pheroTmp = new Float32Array(GRID_CELLS);

  // Terrain grid
  const terrainGrid = new Uint8Array(GRID_CELLS);

  // ─── Spatial Hash ───────────────────────────────────
  const spatialBuckets = new Array(SPATIAL_W * SPATIAL_H);
  for (let i = 0; i < spatialBuckets.length; i++) spatialBuckets[i] = [];

  function spatialClear() {
    for (let i = 0; i < spatialBuckets.length; i++) spatialBuckets[i].length = 0;
  }

  function spatialInsert(ant) {
    const cx = (ant.x / SPATIAL_CELL) | 0;
    const cy = (ant.y / SPATIAL_CELL) | 0;
    if (cx >= 0 && cx < SPATIAL_W && cy >= 0 && cy < SPATIAL_H) {
      spatialBuckets[cy * SPATIAL_W + cx].push(ant);
    }
  }

  function spatialQuery(x, y, radius, result) {
    result.length = 0;
    const r2 = radius * radius;
    const minCx = Math.max(0, ((x - radius) / SPATIAL_CELL) | 0);
    const maxCx = Math.min(SPATIAL_W - 1, ((x + radius) / SPATIAL_CELL) | 0);
    const minCy = Math.max(0, ((y - radius) / SPATIAL_CELL) | 0);
    const maxCy = Math.min(SPATIAL_H - 1, ((y + radius) / SPATIAL_CELL) | 0);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = spatialBuckets[cy * SPATIAL_W + cx];
        for (let i = 0; i < bucket.length; i++) {
          const a = bucket[i];
          const dx = a.x - x;
          const dy = a.y - y;
          if (dx * dx + dy * dy <= r2) result.push(a);
        }
      }
    }
    return result;
  }

  // ─── Food items ─────────────────────────────────────
  const foods = [];
  let foodIdCounter = 0;

  function createFood(x, y, amount, big) {
    foods.push({
      id: foodIdCounter++,
      x, y,
      amount: amount || (big ? 80 : 10),
      maxAmount: amount || (big ? 80 : 10),
      big: !!big,
      carriers: [],
    });
  }

  // ─── Nests ──────────────────────────────────────────
  const nests = [];

  function createNest(x, y, species) {
    const nest = {
      x, y,
      species,
      food: 30,
      population: 0,
      maxPop: 200,
      spawnTimer: 0,
      tunnels: generateTunnels(x, y),
    };
    nests.push(nest);

    // Mark terrain around nest entrance
    const gx = (x / GRID_SIZE) | 0;
    const gy = (y / GRID_SIZE) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const idx = (gy + dy) * GRID_W + (gx + dx);
        if (idx >= 0 && idx < GRID_CELLS) {
          terrainGrid[idx] = TERRAIN_NEST | ((species & 0x3) << 4);
        }
      }
    }

    // Spawn initial ants
    for (let i = 0; i < 30; i++) {
      spawnAnt(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20, species, ROLE_WORKER);
    }
    // Spawn soldiers
    for (let i = 0; i < 5; i++) {
      spawnAnt(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20, species, ROLE_SOLDIER);
    }

    return nest;
  }

  function generateTunnels(cx, cy) {
    const segs = [];
    const count = 3 + (Math.random() * 3) | 0;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const len = 15 + Math.random() * 25;
      segs.push({
        x1: cx, y1: cy,
        x2: cx + Math.cos(angle) * len,
        y2: cy + Math.sin(angle) * len,
      });
    }
    return segs;
  }

  // ─── Ants ───────────────────────────────────────────
  const ants = [];

  function spawnAnt(x, y, species, role) {
    if (ants.length >= MAX_ANTS) return null;
    const sp = SPECIES[species];
    const ant = {
      x, y,
      angle: Math.random() * Math.PI * 2,
      speed: sp.speed * (role === ROLE_SOLDIER ? 0.85 : 1.0) * (0.85 + Math.random() * 0.3),
      species,
      role,
      state: STATE_EXPLORE,
      hp: role === ROLE_SOLDIER ? 3 : (role === ROLE_QUEEN ? 10 : 1.5),
      maxHp: role === ROLE_SOLDIER ? 3 : (role === ROLE_QUEEN ? 10 : 1.5),
      carryFood: 0,
      carryCapacity: role === ROLE_SOLDIER ? 0.5 : 1.0,
      targetFood: null,
      wanderAngle: 0,
      wanderTimer: 0,
      pheroTimer: 0,
      fightTarget: null,
      fightCooldown: 0,
      alive: true,
      age: 0,
      legPhase: Math.random() * Math.PI * 2,
    };
    ants.push(ant);
    // Track population in nest
    for (const n of nests) {
      if (n.species === species) {
        n.population++;
        break;
      }
    }
    return ant;
  }

  // ─── Pheromone helpers ──────────────────────────────
  function getPheroIdx(species, type) {
    return species * PHERO_TYPES + type;
  }

  function depositPheromone(x, y, species, type, strength) {
    const gx = (x / GRID_SIZE) | 0;
    const gy = (y / GRID_SIZE) | 0;
    if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return;
    const idx = gy * GRID_W + gx;
    const ch = getPheroIdx(species, type);
    pheroGrids[ch][idx] = Math.min(pheroGrids[ch][idx] + strength, 1.0);
  }

  function samplePheromone(x, y, species, type) {
    const gx = (x / GRID_SIZE) | 0;
    const gy = (y / GRID_SIZE) | 0;
    if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) return 0;
    return pheroGrids[getPheroIdx(species, type)][gy * GRID_W + gx];
  }

  function samplePheromoneDir(x, y, angle, species, type, dist) {
    const sx = x + Math.cos(angle) * dist;
    const sy = y + Math.sin(angle) * dist;
    return samplePheromone(sx, sy, species, type);
  }

  // ─── Pheromone decay & diffusion ────────────────────
  function updatePheromones() {
    const decayRate = 0.997;
    const diffuseRate = 0.08;

    for (let ch = 0; ch < TOTAL_PHERO_CHANNELS; ch++) {
      const grid = pheroGrids[ch];

      // Decay
      for (let i = 0; i < GRID_CELLS; i++) {
        grid[i] *= decayRate;
        if (grid[i] < 0.001) grid[i] = 0;
      }

      // Diffusion (simple box blur)
      pheroTmp.set(grid);
      for (let y = 1; y < GRID_H - 1; y++) {
        for (let x = 1; x < GRID_W - 1; x++) {
          const idx = y * GRID_W + x;
          const avg = (
            pheroTmp[idx - 1] + pheroTmp[idx + 1] +
            pheroTmp[idx - GRID_W] + pheroTmp[idx + GRID_W]
          ) * 0.25;
          grid[idx] = grid[idx] * (1 - diffuseRate) + avg * diffuseRate;
        }
      }
    }
  }

  // ─── Terrain helpers ────────────────────────────────
  function isWalkable(x, y) {
    if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) return false;
    const gx = (x / GRID_SIZE) | 0;
    const gy = (y / GRID_SIZE) | 0;
    const t = terrainGrid[gy * GRID_W + gx] & 0x0F;
    return t !== TERRAIN_WALL && t !== TERRAIN_WATER;
  }

  function getTerrainAt(x, y) {
    if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) return TERRAIN_WALL;
    const gx = (x / GRID_SIZE) | 0;
    const gy = (y / GRID_SIZE) | 0;
    return terrainGrid[gy * GRID_W + gx];
  }

  function setTerrain(x, y, type, brushSize) {
    const gcx = (x / GRID_SIZE) | 0;
    const gcy = (y / GRID_SIZE) | 0;
    const r = (brushSize || 1);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = gcx + dx;
        const gy = gcy + dy;
        if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GRID_H) {
          if (dx * dx + dy * dy <= r * r) {
            terrainGrid[gy * GRID_W + gx] = type;
          }
        }
      }
    }
  }

  // ─── Ant AI ─────────────────────────────────────────
  const queryResult = [];

  function getNestForSpecies(species) {
    for (const n of nests) {
      if (n.species === species) return n;
    }
    return null;
  }

  function distSq(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
  }

  function normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function steerTowards(current, target, maxTurn) {
    let diff = normalizeAngle(target - current);
    if (diff > maxTurn) diff = maxTurn;
    if (diff < -maxTurn) diff = -maxTurn;
    return normalizeAngle(current + diff);
  }

  function updateAnt(ant, dt) {
    if (!ant.alive) return;
    ant.age += dt;
    ant.legPhase += dt * ant.speed * 12;
    ant.fightCooldown = Math.max(0, ant.fightCooldown - dt);

    const sp = SPECIES[ant.species];
    const nest = getNestForSpecies(ant.species);
    const maxTurn = 0.12;
    let moveSpeed = ant.speed * 38;

    // Realistic wandering: Perlin-like noise via summed sine waves
    ant.wanderTimer -= dt;
    if (ant.wanderTimer <= 0) {
      // Multi-frequency wander: creates naturalistic zigzag paths
      const t = ant.age * 2.3 + ant.legPhase * 0.1;
      ant.wanderAngle = Math.sin(t * 1.1) * 0.6
                       + Math.sin(t * 2.7 + 1.3) * 0.3
                       + Math.sin(t * 5.3 + 2.7) * 0.15
                       + (Math.random() - 0.5) * 0.8;
      ant.wanderTimer = 0.03 + Math.random() * 0.08;
    }

    // Phase-based behavior
    switch (ant.state) {
      case STATE_EXPLORE: {
        // Wander with pheromone bias
        let desiredAngle = ant.angle + ant.wanderAngle * 0.3;

        // Sense food pheromone ahead
        const senseDist = 12;
        const senseAngle = 0.5;
        const fwdPhero = samplePheromoneDir(ant.x, ant.y, ant.angle, ant.species, PHERO_FOOD, senseDist);
        const leftPhero = samplePheromoneDir(ant.x, ant.y, ant.angle - senseAngle, ant.species, PHERO_FOOD, senseDist);
        const rightPhero = samplePheromoneDir(ant.x, ant.y, ant.angle + senseAngle, ant.species, PHERO_FOOD, senseDist);

        if (leftPhero > fwdPhero && leftPhero > rightPhero) {
          desiredAngle = ant.angle - senseAngle * 0.5;
        } else if (rightPhero > fwdPhero && rightPhero > leftPhero) {
          desiredAngle = ant.angle + senseAngle * 0.5;
        } else if (fwdPhero > 0.01) {
          desiredAngle = ant.angle;
        }

        // Check for danger pheromone from other species
        for (let s = 0; s < MAX_SPECIES; s++) {
          if (s === ant.species) continue;
          const danger = samplePheromone(ant.x, ant.y, s, PHERO_DANGER);
          if (danger > 0.1 && ant.role === ROLE_SOLDIER) {
            // Soldiers are attracted to danger
            const dx = samplePheromoneDir(ant.x, ant.y, ant.angle + 0.3, s, PHERO_DANGER, senseDist);
            const dy = samplePheromoneDir(ant.x, ant.y, ant.angle - 0.3, s, PHERO_DANGER, senseDist);
            if (dx > dy) desiredAngle = ant.angle + 0.3;
            else desiredAngle = ant.angle - 0.3;
          }
        }

        ant.angle = steerTowards(ant.angle, desiredAngle, maxTurn);

        // Deposit home pheromone while exploring
        ant.pheroTimer -= dt;
        if (ant.pheroTimer <= 0) {
          depositPheromone(ant.x, ant.y, ant.species, PHERO_HOME, 0.3 * sp.pheroStr);
          ant.pheroTimer = 0.1;
        }

        // Check for nearby food
        if (ant.role !== ROLE_SOLDIER || foods.length > 10) {
          let closestFood = null;
          let closestD2 = Infinity;
          for (const f of foods) {
            if (f.amount <= 0) continue;
            const d2 = distSq(ant.x, ant.y, f.x, f.y);
            if (d2 < closestD2) {
              closestD2 = d2;
              closestFood = f;
            }
          }
          if (closestFood) {
            if (closestD2 < 64) { // within 8px - pickup
              const f = closestFood;
              if (f.big && f.amount > f.maxAmount * 0.5) {
                // Big food: need multiple ants. Each takes a small piece
                // More ants nearby = faster collection
                const take = Math.min(ant.carryCapacity * 0.4, f.amount);
                ant.carryFood = take;
                f.amount -= take;
                // Record carrier for cooperative animation
                if (f.carriers.length < 6) f.carriers.push(ant);
              } else {
                const take = Math.min(ant.carryCapacity, f.amount);
                ant.carryFood = take;
                f.amount -= take;
              }
              ant.state = STATE_CARRY_FOOD;
              ant.targetFood = closestFood;
              // Emit strong food pheromone
              depositPheromone(ant.x, ant.y, ant.species, PHERO_FOOD, 0.9 * sp.pheroStr);
            } else if (closestD2 < 1600) { // within 40px, steer towards
              const toFood = Math.atan2(closestFood.y - ant.y, closestFood.x - ant.x);
              ant.angle = steerTowards(ant.angle, toFood, maxTurn * 1.8);
            }
          }
        }
        break;
      }

      case STATE_CARRY_FOOD: {
        moveSpeed *= 0.55; // Slower while carrying
        // Add slight stumble/wobble when carrying
        ant.wanderAngle *= 0.7;

        // Navigate home using home pheromone
        let desiredAngle = ant.angle + ant.wanderAngle * 0.12;

        if (nest) {
          const toNest = Math.atan2(nest.y - ant.y, nest.x - ant.x);
          const distToNest = Math.sqrt(distSq(ant.x, ant.y, nest.x, nest.y));
          // Mix direct heading with pheromone sensing
          const senseDist = 14;
          const senseAngle = 0.55;
          const fwd = samplePheromoneDir(ant.x, ant.y, ant.angle, ant.species, PHERO_HOME, senseDist);
          const left = samplePheromoneDir(ant.x, ant.y, ant.angle - senseAngle, ant.species, PHERO_HOME, senseDist);
          const right = samplePheromoneDir(ant.x, ant.y, ant.angle + senseAngle, ant.species, PHERO_HOME, senseDist);

          const maxPhero = Math.max(fwd, left, right);
          if (maxPhero > 0.05) {
            if (left > fwd && left > right) {
              desiredAngle = ant.angle - senseAngle * 0.6;
            } else if (right > fwd && right > left) {
              desiredAngle = ant.angle + senseAngle * 0.6;
            }
          } else {
            // No pheromone detected: head more directly to nest with some wander
            desiredAngle = toNest + ant.wanderAngle * 0.2;
          }

          // Strong nest attraction when close
          if (distToNest < 80) {
            desiredAngle = steerTowards(desiredAngle, toNest, maxTurn * 2);
          }

          // Close to nest? Drop food
          if (distSq(ant.x, ant.y, nest.x, nest.y) < 400) {
            nest.food += ant.carryFood;
            ant.carryFood = 0;
            ant.state = STATE_EXPLORE;
            // Turn around
            ant.angle = normalizeAngle(ant.angle + Math.PI + (Math.random() - 0.5) * 0.6);
          }
        }

        ant.angle = steerTowards(ant.angle, desiredAngle, maxTurn);

        // Deposit food pheromone trail back to food
        ant.pheroTimer -= dt;
        if (ant.pheroTimer <= 0) {
          depositPheromone(ant.x, ant.y, ant.species, PHERO_FOOD, 0.7 * sp.pheroStr);
          ant.pheroTimer = 0.08;
        }
        break;
      }

      case STATE_FIGHT: {
        if (!ant.fightTarget || !ant.fightTarget.alive) {
          ant.state = STATE_EXPLORE;
          ant.fightTarget = null;
          break;
        }
        const target = ant.fightTarget;
        const toTarget = Math.atan2(target.y - ant.y, target.x - ant.x);
        ant.angle = steerTowards(ant.angle, toTarget, maxTurn * 3);

        if (distSq(ant.x, ant.y, target.x, target.y) < 25 && ant.fightCooldown <= 0) {
          // Number advantage: count allies nearby
          spatialQuery(ant.x, ant.y, 15, queryResult);
          let allyCount = 0;
          for (let k = 0; k < queryResult.length; k++) {
            if (queryResult[k].species === ant.species && queryResult[k].alive) allyCount++;
          }
          const numBonus = Math.min(2.0, 1.0 + allyCount * 0.15);
          target.hp -= sp.attack * (ant.role === ROLE_SOLDIER ? 1.5 : 0.8) * dt * 3 * numBonus;
          ant.fightCooldown = 0.3;
          depositPheromone(ant.x, ant.y, ant.species, PHERO_DANGER, 0.8 * sp.pheroStr);
          if (target.hp <= 0) {
            target.alive = false;
            ant.state = STATE_EXPLORE;
            ant.fightTarget = null;
          }
        }
        break;
      }

      case STATE_FLEE: {
        moveSpeed *= 1.3;
        ant.wanderAngle += (Math.random() - 0.5) * 2.0;
        if (nest) {
          const toNest = Math.atan2(nest.y - ant.y, nest.x - ant.x);
          ant.angle = steerTowards(ant.angle, toNest, maxTurn * 1.5);
        }
        // Check if safe
        let dangerLevel = 0;
        for (let s = 0; s < MAX_SPECIES; s++) {
          if (s === ant.species) continue;
          dangerLevel += samplePheromone(ant.x, ant.y, s, PHERO_DANGER);
        }
        if (dangerLevel < 0.05) {
          ant.state = STATE_EXPLORE;
        }
        break;
      }
    }

    // ─── Congestion detection ──────────────────
    // Check nearby ant density to simulate crowding slowdown
    const congestionRadius = 6;
    const cx0 = (ant.x / SPATIAL_CELL) | 0;
    const cy0 = (ant.y / SPATIAL_CELL) | 0;
    let nearbyCount = 0;
    if (cx0 >= 0 && cx0 < SPATIAL_W && cy0 >= 0 && cy0 < SPATIAL_H) {
      nearbyCount = spatialBuckets[cy0 * SPATIAL_W + cx0].length;
    }
    if (nearbyCount > 5) {
      moveSpeed *= Math.max(0.3, 1.0 - (nearbyCount - 5) * 0.08);
      // Add extra wander to simulate pushing/shoving
      ant.angle += (Math.random() - 0.5) * 0.15 * (nearbyCount - 5);
    }

    // ─── Move ─────────────────────────────────
    const dx = Math.cos(ant.angle) * moveSpeed * dt;
    const dy = Math.sin(ant.angle) * moveSpeed * dt;
    const nx = ant.x + dx;
    const ny = ant.y + dy;

    if (isWalkable(nx, ny)) {
      ant.x = nx;
      ant.y = ny;
    } else {
      // Bounce/redirect
      ant.angle += (Math.random() - 0.5) * Math.PI;
      ant.wanderAngle = (Math.random() - 0.5) * 2;
    }

    // Keep in bounds
    ant.x = Math.max(2, Math.min(WORLD_W - 2, ant.x));
    ant.y = Math.max(2, Math.min(WORLD_H - 2, ant.y));
  }

  // ─── Collision & combat detection ───────────────────
  function handleInteractions(dt) {
    for (let i = 0; i < ants.length; i++) {
      const a = ants[i];
      if (!a.alive) continue;

      spatialQuery(a.x, a.y, 8, queryResult);
      for (let j = 0; j < queryResult.length; j++) {
        const b = queryResult[j];
        if (a === b || !b.alive) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const minDist = SPECIES[a.species].bodyR + SPECIES[b.species].bodyR;

        // Collision push
        if (d2 < minDist * minDist && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const overlap = (minDist - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
        }

        // Combat: different species
        if (a.species !== b.species && d2 < 36) {
          if (a.state !== STATE_FIGHT && a.state !== STATE_FLEE) {
            if (a.role === ROLE_SOLDIER || Math.random() < 0.3) {
              a.state = STATE_FIGHT;
              a.fightTarget = b;
            } else {
              a.state = STATE_FLEE;
            }
          }
          if (b.state !== STATE_FIGHT && b.state !== STATE_FLEE) {
            if (b.role === ROLE_SOLDIER || Math.random() < 0.3) {
              b.state = STATE_FIGHT;
              b.fightTarget = a;
            } else {
              b.state = STATE_FLEE;
            }
          }
        }
      }
    }
  }

  // ─── Nest logic ─────────────────────────────────────
  function updateNests(dt) {
    for (const nest of nests) {
      const sp = SPECIES[nest.species];
      // Spawn ants if food available
      nest.spawnTimer += dt;
      if (nest.food >= 2 && nest.population < nest.maxPop && nest.spawnTimer > 1.0 / sp.spawnRate) {
        nest.spawnTimer = 0;
        nest.food -= 2;
        const role = Math.random() < 0.15 ? ROLE_SOLDIER : ROLE_WORKER;
        spawnAnt(
          nest.x + (Math.random() - 0.5) * 15,
          nest.y + (Math.random() - 0.5) * 15,
          nest.species,
          role
        );
      }

      // Continuous home pheromone at nest
      depositPheromone(nest.x, nest.y, nest.species, PHERO_HOME, 1.0);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          depositPheromone(nest.x + dx * GRID_SIZE, nest.y + dy * GRID_SIZE, nest.species, PHERO_HOME, 0.8);
        }
      }
    }
  }

  // ─── Food management ───────────────────────────────
  function updateFoods(dt) {
    // Remove depleted food
    for (let i = foods.length - 1; i >= 0; i--) {
      if (foods[i].amount <= 0) {
        foods.splice(i, 1);
      }
    }

    // Random food spawning
    if (foods.length < 15 && Math.random() < 0.003) {
      const x = 30 + Math.random() * (WORLD_W - 60);
      const y = 30 + Math.random() * (WORLD_H - 60);
      if (isWalkable(x, y)) {
        createFood(x, y, 8 + Math.random() * 15, Math.random() < 0.2);
      }
    }
  }

  // ─── Cleanup dead ants ──────────────────────────────
  function cleanupAnts() {
    for (let i = ants.length - 1; i >= 0; i--) {
      if (!ants[i].alive) {
        const dead = ants[i];
        for (const n of nests) {
          if (n.species === dead.species) {
            n.population = Math.max(0, n.population - 1);
            break;
          }
        }
        ants.splice(i, 1);
      }
    }
  }

  // ─── Simulation step ───────────────────────────────
  function simulate(dt) {
    // Spatial rehash
    spatialClear();
    for (const ant of ants) {
      if (ant.alive) spatialInsert(ant);
    }

    // Update ants
    for (const ant of ants) {
      updateAnt(ant, dt);
    }

    // Interactions
    handleInteractions(dt);

    // Nests
    updateNests(dt);

    // Foods
    updateFoods(dt);

    // Pheromones
    updatePheromones();

    // Cleanup every 60 frames
    if (frameCount % 60 === 0) {
      cleanupAnts();
    }
  }

  // ─── Rendering ──────────────────────────────────────
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');

  // Camera
  let camX = 0, camY = 0, camZoom = 1;
  let targetCamX = 0, targetCamY = 0, targetCamZoom = 1;

  function resizeCanvas() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    // Fit world
    const scaleX = window.innerWidth / WORLD_W;
    const scaleY = window.innerHeight / WORLD_H;
    targetCamZoom = Math.min(scaleX, scaleY);
    targetCamX = (window.innerWidth - WORLD_W * targetCamZoom) / 2;
    targetCamY = (window.innerHeight - WORLD_H * targetCamZoom) / 2;
  }

  // Off-screen pheromone canvas
  const pheroCanvas = document.createElement('canvas');
  pheroCanvas.width = GRID_W;
  pheroCanvas.height = GRID_H;
  const pheroCtx = pheroCanvas.getContext('2d');
  const pheroImageData = pheroCtx.createImageData(GRID_W, GRID_H);

  // Off-screen terrain canvas
  const terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = GRID_W;
  terrainCanvas.height = GRID_H;
  const terrainCtx = terrainCanvas.getContext('2d');
  const terrainImageData = terrainCtx.createImageData(GRID_W, GRID_H);
  let terrainDirty = true;

  function renderTerrain() {
    if (!terrainDirty) return;
    terrainDirty = false;
    const data = terrainImageData.data;
    for (let i = 0; i < GRID_CELLS; i++) {
      const t = terrainGrid[i] & 0x0F;
      const pi = i * 4;
      switch (t) {
        case TERRAIN_EMPTY:
          data[pi] = 42; data[pi + 1] = 36; data[pi + 2] = 22; data[pi + 3] = 255;
          break;
        case TERRAIN_WALL:
          data[pi] = 80; data[pi + 1] = 70; data[pi + 2] = 55; data[pi + 3] = 255;
          break;
        case TERRAIN_WATER:
          data[pi] = 30; data[pi + 1] = 60; data[pi + 2] = 110; data[pi + 3] = 255;
          break;
        case TERRAIN_NEST: {
          const sp = (terrainGrid[i] >> 4) & 0x3;
          const c = SPECIES[sp] ? SPECIES[sp].color : [100, 80, 60];
          data[pi] = c[0] * 0.3 + 30; data[pi + 1] = c[1] * 0.3 + 20; data[pi + 2] = c[2] * 0.3 + 15; data[pi + 3] = 255;
          break;
        }
      }
    }
    terrainCtx.putImageData(terrainImageData, 0, 0);
  }

  function renderPheromones() {
    const data = pheroImageData.data;
    for (let i = 0; i < GRID_CELLS; i++) {
      const pi = i * 4;
      let r = 0, g = 0, b = 0, a = 0;

      for (let s = 0; s < MAX_SPECIES; s++) {
        const sc = SPECIES[s].color;
        const food = pheroGrids[getPheroIdx(s, PHERO_FOOD)][i];
        const home = pheroGrids[getPheroIdx(s, PHERO_HOME)][i];
        const danger = pheroGrids[getPheroIdx(s, PHERO_DANGER)][i];

        // Food pheromone: species color bright
        r += sc[0] * food * 0.7;
        g += sc[1] * food * 0.7;
        b += sc[2] * food * 0.7;

        // Home pheromone: species color dim
        r += sc[0] * home * 0.2;
        g += sc[1] * home * 0.2;
        b += sc[2] * home * 0.2;

        // Danger: red tint
        r += 255 * danger * 0.5;

        a = Math.max(a, food * 200, home * 80, danger * 200);
      }

      data[pi] = Math.min(255, r);
      data[pi + 1] = Math.min(255, g);
      data[pi + 2] = Math.min(255, b);
      data[pi + 3] = Math.min(180, a);
    }
    pheroCtx.putImageData(pheroImageData, 0, 0);
  }

  function render() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // Clear
    ctx.fillStyle = '#1a1206';
    ctx.fillRect(0, 0, w, h);

    // Smooth camera
    camX += (targetCamX - camX) * 0.1;
    camY += (targetCamY - camY) * 0.1;
    camZoom += (targetCamZoom - camZoom) * 0.1;

    ctx.save();
    ctx.translate(camX, camY);
    ctx.scale(camZoom, camZoom);

    // Terrain
    renderTerrain();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainCanvas, 0, 0, WORLD_W, WORLD_H);

    // Grid overlay
    if (showGrid) {
      ctx.strokeStyle = 'rgba(200,170,100,0.08)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < WORLD_W; x += GRID_SIZE * 10) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
      }
      for (let y = 0; y < WORLD_H; y += GRID_SIZE * 10) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
      }
    }

    // Pheromone heatmap
    if (showPheromone) {
      renderPheromones();
      ctx.globalAlpha = 0.6;
      ctx.drawImage(pheroCanvas, 0, 0, WORLD_W, WORLD_H);
      ctx.globalAlpha = 1;
    }

    // Nests
    for (const nest of nests) {
      const sc = SPECIES[nest.species].color;
      // Nest entrance circle
      ctx.fillStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},0.3)`;
      ctx.beginPath();
      ctx.arc(nest.x, nest.y, 12, 0, Math.PI * 2);
      ctx.fill();

      // Nest hole
      ctx.fillStyle = `rgba(20,15,8,0.9)`;
      ctx.beginPath();
      ctx.arc(nest.x, nest.y, 5, 0, Math.PI * 2);
      ctx.fill();

      // Tunnel lines (underground preview)
      ctx.strokeStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},0.15)`;
      ctx.lineWidth = 2;
      for (const seg of nest.tunnels) {
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
        // Chamber at end
        ctx.fillStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},0.1)`;
        ctx.beginPath();
        ctx.arc(seg.x2, seg.y2, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Food
    for (const f of foods) {
      const ratio = f.amount / f.maxAmount;
      const size = f.big ? 4 + ratio * 4 : 2 + ratio * 2;
      ctx.fillStyle = f.big ? '#8a6' : '#a84';
      ctx.beginPath();
      ctx.arc(f.x, f.y, size, 0, Math.PI * 2);
      ctx.fill();
      // Crumb look
      if (f.big) {
        ctx.fillStyle = '#6a4';
        ctx.beginPath();
        ctx.arc(f.x - 2, f.y + 1, size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Ants
    for (const ant of ants) {
      if (!ant.alive) continue;
      const sc = SPECIES[ant.species].color;
      const r = SPECIES[ant.species].bodyR;

      ctx.save();
      ctx.translate(ant.x, ant.y);
      ctx.rotate(ant.angle);

      // Body segments (head, thorax, abdomen)
      const cr = ant.role === ROLE_SOLDIER ? r * 1.3 : r;

      // Abdomen
      ctx.fillStyle = `rgb(${sc[0]},${sc[1]},${sc[2]})`;
      ctx.beginPath();
      ctx.ellipse(-cr * 1.2, 0, cr * 1.0, cr * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Thorax
      ctx.fillStyle = `rgb(${(sc[0] * 0.8) | 0},${(sc[1] * 0.8) | 0},${(sc[2] * 0.8) | 0})`;
      ctx.beginPath();
      ctx.arc(0, 0, cr * 0.5, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.fillStyle = `rgb(${(sc[0] * 0.6) | 0},${(sc[1] * 0.6) | 0},${(sc[2] * 0.6) | 0})`;
      ctx.beginPath();
      ctx.arc(cr * 0.9, 0, cr * 0.45, 0, Math.PI * 2);
      ctx.fill();

      // Legs (animated)
      ctx.strokeStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},0.6)`;
      ctx.lineWidth = 0.5;
      for (let li = 0; li < 3; li++) {
        const phase = ant.legPhase + li * 2.1;
        const legSwing = Math.sin(phase) * 0.4;
        const lx = -cr * 0.3 + li * cr * 0.5;
        // Top legs
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx + Math.cos(legSwing) * cr, -cr * 1.2 + Math.sin(legSwing) * cr * 0.3);
        ctx.stroke();
        // Bottom legs
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx + Math.cos(-legSwing) * cr, cr * 1.2 + Math.sin(-legSwing) * cr * 0.3);
        ctx.stroke();
      }

      // Antennae
      ctx.beginPath();
      ctx.moveTo(cr * 0.9, -cr * 0.2);
      ctx.lineTo(cr * 1.8, -cr * 0.8 + Math.sin(ant.legPhase * 0.5) * cr * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cr * 0.9, cr * 0.2);
      ctx.lineTo(cr * 1.8, cr * 0.8 + Math.sin(ant.legPhase * 0.5 + 1) * cr * 0.2);
      ctx.stroke();

      // Carrying food indicator
      if (ant.carryFood > 0) {
        ctx.fillStyle = '#a84';
        ctx.beginPath();
        ctx.arc(-cr * 0.5, -cr * 0.8, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fighting indicator
      if (ant.state === STATE_FIGHT) {
        ctx.fillStyle = 'rgba(255,50,50,0.5)';
        ctx.beginPath();
        ctx.arc(0, 0, cr * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    ctx.restore();
  }

  // ─── Input handling ─────────────────────────────────
  let currentTool = 'observe';
  let currentSpecies = 0;
  let showPheromone = false;
  let showGrid = false;
  let simSpeed = 1;
  let isPaused = false;
  let frameCount = 0;

  // Pointer for pan/zoom
  let pointers = new Map();
  let lastPinchDist = 0;
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let camStartX = 0, camStartY = 0;
  let isDrawing = false;

  function screenToWorld(sx, sy) {
    return {
      x: (sx - camX) / camZoom,
      y: (sy - camY) / camZoom,
    };
  }

  function handleToolAction(sx, sy) {
    const { x, y } = screenToWorld(sx, sy);
    if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) return;

    switch (currentTool) {
      case 'food':
        createFood(x, y, 10 + Math.random() * 10, false);
        break;
      case 'bigfood':
        createFood(x, y, 60 + Math.random() * 40, true);
        break;
      case 'wall':
        setTerrain(x, y, TERRAIN_WALL, 2);
        terrainDirty = true;
        break;
      case 'water':
        setTerrain(x, y, TERRAIN_WATER, 2);
        terrainDirty = true;
        break;
      case 'nest':
        createNest(x, y, currentSpecies);
        terrainDirty = true;
        break;
      case 'erase':
        setTerrain(x, y, TERRAIN_EMPTY, 3);
        terrainDirty = true;
        break;
    }
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      if (currentTool === 'observe') {
        isPanning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        camStartX = targetCamX;
        camStartY = targetCamY;
      } else {
        isDrawing = true;
        handleToolAction(e.clientX, e.clientY);
      }
    }
  });

  canvas.addEventListener('pointermove', e => {
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // Pinch zoom
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinchDist > 0) {
        const scale = dist / lastPinchDist;
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        const newZoom = Math.max(0.3, Math.min(8, targetCamZoom * scale));
        targetCamX = cx - (cx - targetCamX) * (newZoom / targetCamZoom);
        targetCamY = cy - (cy - targetCamY) * (newZoom / targetCamZoom);
        targetCamZoom = newZoom;
      }
      lastPinchDist = dist;
      isPanning = false;
      isDrawing = false;
    } else if (isPanning) {
      targetCamX = camStartX + (e.clientX - panStartX);
      targetCamY = camStartY + (e.clientY - panStartY);
    } else if (isDrawing && currentTool !== 'nest') {
      handleToolAction(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = 0;
    if (pointers.size === 0) {
      isPanning = false;
      isDrawing = false;
    }
  });

  canvas.addEventListener('pointercancel', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = 0;
    if (pointers.size === 0) {
      isPanning = false;
      isDrawing = false;
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.3, Math.min(8, targetCamZoom * scale));
    targetCamX = e.clientX - (e.clientX - targetCamX) * (newZoom / targetCamZoom);
    targetCamY = e.clientY - (e.clientY - targetCamY) * (newZoom / targetCamZoom);
    targetCamZoom = newZoom;
  }, { passive: false });

  // UI buttons
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
    });
  });

  document.querySelectorAll('.species-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.species-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpecies = parseInt(btn.dataset.species);
    });
  });

  document.getElementById('btn-pause').addEventListener('click', () => {
    isPaused = true;
    simSpeed = 0;
    document.querySelectorAll('#speed-control button').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-pause').classList.add('active');
  });

  document.getElementById('btn-play').addEventListener('click', () => {
    isPaused = false;
    simSpeed = 1;
    document.querySelectorAll('#speed-control button').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-play').classList.add('active');
  });

  document.getElementById('btn-fast').addEventListener('click', () => {
    isPaused = false;
    simSpeed = 3;
    document.querySelectorAll('#speed-control button').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-fast').classList.add('active');
  });

  document.getElementById('toggle-pheromone').addEventListener('change', e => {
    showPheromone = e.target.checked;
  });

  document.getElementById('toggle-grid').addEventListener('change', e => {
    showGrid = e.target.checked;
  });

  document.getElementById('close-info').addEventListener('click', () => {
    document.getElementById('info-panel').classList.add('hidden');
  });

  // ─── FPS counter ────────────────────────────────────
  let fpsFrames = 0;
  let fpsTime = 0;
  let currentFps = 0;

  // ─── Stats update ──────────────────────────────────
  function updateStats() {
    document.getElementById('ant-count').textContent = `🐜 ${ants.length}`;
    document.getElementById('food-count').textContent = `🍎 ${foods.length}`;
    document.getElementById('fps-counter').textContent = `FPS: ${currentFps}`;
  }

  // ─── Initialize world ──────────────────────────────
  function initWorld() {
    // Add some natural walls around edges
    for (let x = 0; x < GRID_W; x++) {
      for (let dy = 0; dy < 2; dy++) {
        terrainGrid[dy * GRID_W + x] = TERRAIN_WALL;
        terrainGrid[(GRID_H - 1 - dy) * GRID_W + x] = TERRAIN_WALL;
      }
    }
    for (let y = 0; y < GRID_H; y++) {
      for (let dx = 0; dx < 2; dx++) {
        terrainGrid[y * GRID_W + dx] = TERRAIN_WALL;
        terrainGrid[y * GRID_W + GRID_W - 1 - dx] = TERRAIN_WALL;
      }
    }

    // Add some natural obstacles
    // Rock formations
    for (let i = 0; i < 5; i++) {
      const cx = 80 + Math.random() * (WORLD_W - 160);
      const cy = 80 + Math.random() * (WORLD_H - 160);
      const r = 5 + Math.random() * 10;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy < r * r * (0.5 + Math.random() * 0.5)) {
            const gx = ((cx + dx * GRID_SIZE) / GRID_SIZE) | 0;
            const gy = ((cy + dy * GRID_SIZE) / GRID_SIZE) | 0;
            if (gx > 3 && gx < GRID_W - 3 && gy > 3 && gy < GRID_H - 3) {
              terrainGrid[gy * GRID_W + gx] = TERRAIN_WALL;
            }
          }
        }
      }
    }

    // Water puddles
    for (let i = 0; i < 2; i++) {
      const cx = 100 + Math.random() * (WORLD_W - 200);
      const cy = 100 + Math.random() * (WORLD_H - 200);
      const rx = 8 + Math.random() * 15;
      const ry = 5 + Math.random() * 10;
      for (let dy = -ry; dy <= ry; dy++) {
        for (let dx = -rx; dx <= rx; dx++) {
          if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) < 0.8 + Math.random() * 0.2) {
            const gx = ((cx + dx * GRID_SIZE) / GRID_SIZE) | 0;
            const gy = ((cy + dy * GRID_SIZE) / GRID_SIZE) | 0;
            if (gx > 3 && gx < GRID_W - 3 && gy > 3 && gy < GRID_H - 3) {
              terrainGrid[gy * GRID_W + gx] = TERRAIN_WATER;
            }
          }
        }
      }
    }

    terrainDirty = true;

    // Create initial nests
    createNest(200, 300, 0);
    createNest(WORLD_W - 200, WORLD_H - 300, 1);

    // Scatter initial food
    for (let i = 0; i < 12; i++) {
      const x = 50 + Math.random() * (WORLD_W - 100);
      const y = 50 + Math.random() * (WORLD_H - 100);
      if (isWalkable(x, y)) {
        createFood(x, y, 10 + Math.random() * 20, Math.random() < 0.25);
      }
    }
  }

  // ─── Main loop ──────────────────────────────────────
  let lastTime = 0;

  function mainLoop(timestamp) {
    requestAnimationFrame(mainLoop);

    const rawDt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;

    // FPS
    fpsFrames++;
    fpsTime += rawDt;
    if (fpsTime >= 1) {
      currentFps = fpsFrames;
      fpsFrames = 0;
      fpsTime = 0;
      updateStats();
    }

    // Simulate
    if (!isPaused) {
      const dt = rawDt * simSpeed;
      const steps = simSpeed >= 3 ? 2 : 1;
      const stepDt = dt / steps;
      for (let s = 0; s < steps; s++) {
        simulate(stepDt);
        frameCount++;
      }
    }

    // Render
    render();
  }

  // ─── Boot ───────────────────────────────────────────
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  initWorld();
  lastTime = performance.now();
  requestAnimationFrame(mainLoop);

})();
