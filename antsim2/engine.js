   AntSim2 - リアルなアリ生態シミュレータ v2
   改善点:
   - 巣/餌の削除機能
   - 各種族の個体数表示 & 推移グラフ
   - 繁殖の明確化（視覚エフェクト・ログ表示）
   ===================================================== */

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────
  const WORLD_W = 1200;
  const WORLD_H = 800;
  const GRID_SIZE = 4;
  const GRID_W = (WORLD_W / GRID_SIZE) | 0;
  const GRID_H = (WORLD_H / GRID_SIZE) | 0;
  const GRID_CELLS = GRID_W * GRID_H;

  const MAX_ANTS = 4000;
  const SPATIAL_CELL = 16;
  const SPATIAL_W = (WORLD_W / SPATIAL_CELL) | 0;
  const SPATIAL_H = (WORLD_H / SPATIAL_CELL) | 0;

  const PHERO_DECAY_RATE = 0.997;
  const PHERO_DIFFUSE_RATE = 0.08;

  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 8;

  const MAX_TURN_RATE = 0.12;
  const FOOD_PICKUP_RADIUS = 8;
  const FOOD_DETECT_RADIUS = 40;

  const CONGESTION_THRESHOLD = 5;
  const CONGESTION_SLOWDOWN = 0.08;
  const MIN_CONGESTION_SPEED = 0.3;

  const MAX_ALLY_BONUS = 2.0;
  const ALLY_BONUS_PER_ANT = 0.15;

  // Lifespan: ants die of old age after this many seconds (with some variance)
  const ANT_LIFESPAN_BASE = 120;   // ~2 minutes base lifespan
  const ANT_LIFESPAN_VARIANCE = 40;

  // Nest upkeep: food consumed per ant per second to maintain the colony
  const NEST_UPKEEP_RATE = 0.002;

  const PHERO_FOOD = 0;
  const PHERO_HOME = 1;
  const PHERO_DANGER = 2;
  const PHERO_TYPES = 3;
  const MAX_SPECIES = 3;
  const TOTAL_PHERO_CHANNELS = MAX_SPECIES * PHERO_TYPES;

  const ROLE_WORKER = 0;
  const ROLE_SOLDIER = 1;
  const ROLE_QUEEN = 2;

  const STATE_EXPLORE = 0;
  const STATE_RETURN_HOME = 1;
  const STATE_CARRY_FOOD = 2;
  const STATE_FIGHT = 3;
  const STATE_FLEE = 4;

  const TERRAIN_EMPTY = 0;
  const TERRAIN_WALL = 1;
  const TERRAIN_WATER = 2;
  const TERRAIN_NEST = 3;

  // birthCost: food needed to birth one ant
  const SPECIES = [
    { name: '赤アリ', color: [200, 60, 60], bodyR: 2.2, speed: 1.2, attack: 1.0, pheroStr: 1.0, spawnRate: 0.008, birthCost: 10 },
    { name: '緑アリ', color: [60, 180, 60], bodyR: 2.6, speed: 0.9, attack: 1.3, pheroStr: 0.8, spawnRate: 0.006, birthCost: 12 },
    { name: '青アリ', color: [60, 60, 200], bodyR: 1.8, speed: 1.5, attack: 0.7, pheroStr: 1.3, spawnRate: 0.010, birthCost: 8 },
  ];

  // ─── DELETE radius for nest/food deletion ──────────
  const DELETE_RADIUS_NEST = 25;
  const DELETE_RADIUS_FOOD = 15;

  // ─── Pheromone grids ───────────────────────────────
  const pheroGrids = [];
  for (let i = 0; i < TOTAL_PHERO_CHANNELS; i++) {
    pheroGrids.push(new Float32Array(GRID_CELLS));
  }
  const pheroTmp = new Float32Array(GRID_CELLS);

  // Terrain grid
  const terrainGrid = new Uint8Array(GRID_CELLS);

  // ─── Spatial Hash ──────────────────────────────────
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

  // ─── Food items ────────────────────────────────────
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

  // ─── Delete food near position ─────────────────────
  function deleteFoodNear(x, y) {
    const r2 = DELETE_RADIUS_FOOD * DELETE_RADIUS_FOOD;
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      const dx = f.x - x;
      const dy = f.y - y;
      if (dx * dx + dy * dy < r2) {
        foods.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  // ─── Nests ─────────────────────────────────────────
  const nests = [];

  function createNest(x, y, species) {
    const nest = {
      x, y,
      species,
      food: 0,
      birthProgress: 0,  // accumulated food toward next birth (0 → birthCost)
      population: 0,
      maxPop: 200,
      spawnTimer: 0,
      tunnels: generateTunnels(x, y),
      birthEffects: [],   // visual birth effect queue
    };
    nests.push(nest);

    // Mark terrain
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
    for (let i = 0; i < 5; i++) {
      spawnAnt(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20, species, ROLE_SOLDIER);
    }

    return nest;
  }

  // ─── Delete nest near position ─────────────────────
  function deleteNestNear(x, y) {
    const r2 = DELETE_RADIUS_NEST * DELETE_RADIUS_NEST;
    for (let i = nests.length - 1; i >= 0; i--) {
      const nest = nests[i];
      const dx = nest.x - x;
      const dy = nest.y - y;
      if (dx * dx + dy * dy < r2) {
        // Clear terrain cells for this nest
        const gx = (nest.x / GRID_SIZE) | 0;
        const gy = (nest.y / GRID_SIZE) | 0;
        for (let tdy = -2; tdy <= 2; tdy++) {
          for (let tdx = -2; tdx <= 2; tdx++) {
            const idx = (gy + tdy) * GRID_W + (gx + tdx);
            if (idx >= 0 && idx < GRID_CELLS) {
              terrainGrid[idx] = TERRAIN_EMPTY;
            }
          }
        }
        // Kill all ants belonging to this nest's species if no other nest of same species
        const speciesId = nest.species;
        nests.splice(i, 1);
        const hasOtherNest = nests.some(n => n.species === speciesId);
        if (!hasOtherNest) {
          for (const ant of ants) {
            if (ant.species === speciesId) {
              ant.alive = false;
            }
          }
        }
        terrainDirty = true;
        return true;
      }
    }
    return false;
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

  // ─── Ants ──────────────────────────────────────────
  const ants = [];

  function spawnAnt(x, y, species, role) {
    if (ants.length >= MAX_ANTS) return null;
    const sp = SPECIES[species];
    const lifespan = ANT_LIFESPAN_BASE + (Math.random() - 0.5) * 2 * ANT_LIFESPAN_VARIANCE;
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
      lifespan,
      legPhase: Math.random() * Math.PI * 2,
    };
    ants.push(ant);
    for (const n of nests) {
      if (n.species === species) {
        n.population++;
        break;
      }
    }
    return ant;
  }

  // ─── Pheromone helpers ─────────────────────────────
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

  // ─── Pheromone decay & diffusion ───────────────────
  function updatePheromones() {
    for (let ch = 0; ch < TOTAL_PHERO_CHANNELS; ch++) {
      const grid = pheroGrids[ch];
      for (let i = 0; i < GRID_CELLS; i++) {
        grid[i] *= PHERO_DECAY_RATE;
        if (grid[i] < 0.001) grid[i] = 0;
      }
      pheroTmp.set(grid);
      for (let y = 1; y < GRID_H - 1; y++) {
        for (let x = 1; x < GRID_W - 1; x++) {
          const idx = y * GRID_W + x;
          const avg = (
            pheroTmp[idx - 1] + pheroTmp[idx + 1] +
            pheroTmp[idx - GRID_W] + pheroTmp[idx + GRID_W]
          ) * 0.25;
          grid[idx] = grid[idx] * (1 - PHERO_DIFFUSE_RATE) + avg * PHERO_DIFFUSE_RATE;
        }
      }
    }
  }

  // ─── Terrain helpers ───────────────────────────────
  function isWalkable(x, y) {
    if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) return false;
    const gx = (x / GRID_SIZE) | 0;
    const gy = (y / GRID_SIZE) | 0;
    const t = terrainGrid[gy * GRID_W + gx] & 0x0F;
    return t !== TERRAIN_WALL && t !== TERRAIN_WATER;
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

  // ─── Ant AI ────────────────────────────────────────
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

    // Natural death from old age
    if (ant.age >= ant.lifespan) {
      ant.alive = false;
      return;
    }

    const sp = SPECIES[ant.species];
    const nest = getNestForSpecies(ant.species);

    // If the nest is gone, ant wanders aimlessly and eventually dies
    if (!nest) {
      ant.hp -= dt * 0.1;
      if (ant.hp <= 0) {
        ant.alive = false;
        return;
      }
    }

    const maxTurn = MAX_TURN_RATE;
    let moveSpeed = ant.speed * 38;

    // Realistic wandering
    ant.wanderTimer -= dt;
    if (ant.wanderTimer <= 0) {
      const t = ant.age * 2.3 + ant.legPhase * 0.1;
      ant.wanderAngle = Math.sin(t * 1.1) * 0.6
                       + Math.sin(t * 2.7 + 1.3) * 0.3
                       + Math.sin(t * 5.3 + 2.7) * 0.15
                       + (Math.random() - 0.5) * 0.8;
      ant.wanderTimer = 0.03 + Math.random() * 0.08;
    }

    switch (ant.state) {
      case STATE_EXPLORE: {
        let desiredAngle = ant.angle + ant.wanderAngle * 0.3;

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

        for (let s = 0; s < MAX_SPECIES; s++) {
          if (s === ant.species) continue;
          const danger = samplePheromone(ant.x, ant.y, s, PHERO_DANGER);
          if (danger > 0.1 && ant.role === ROLE_SOLDIER) {
            const dx = samplePheromoneDir(ant.x, ant.y, ant.angle + 0.3, s, PHERO_DANGER, senseDist);
            const dy = samplePheromoneDir(ant.x, ant.y, ant.angle - 0.3, s, PHERO_DANGER, senseDist);
            if (dx > dy) desiredAngle = ant.angle + 0.3;
            else desiredAngle = ant.angle - 0.3;
          }
        }

        ant.angle = steerTowards(ant.angle, desiredAngle, maxTurn);

        ant.pheroTimer -= dt;
        if (ant.pheroTimer <= 0) {
          depositPheromone(ant.x, ant.y, ant.species, PHERO_HOME, 0.3 * sp.pheroStr);
          ant.pheroTimer = 0.1;
        }

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
            if (closestD2 < FOOD_PICKUP_RADIUS * FOOD_PICKUP_RADIUS) {
              const f = closestFood;
              if (f.big && f.amount > f.maxAmount * 0.5) {
                const take = Math.min(ant.carryCapacity * 0.4, f.amount);
                ant.carryFood = take;
                f.amount -= take;
                if (f.carriers.length < 6) f.carriers.push(ant);
              } else {
                const take = Math.min(ant.carryCapacity, f.amount);
                ant.carryFood = take;
                f.amount -= take;
              }
              ant.state = STATE_CARRY_FOOD;
              ant.targetFood = closestFood;
              depositPheromone(ant.x, ant.y, ant.species, PHERO_FOOD, 0.9 * sp.pheroStr);
            } else if (closestD2 < FOOD_DETECT_RADIUS * FOOD_DETECT_RADIUS) {
              const toFood = Math.atan2(closestFood.y - ant.y, closestFood.x - ant.x);
              ant.angle = steerTowards(ant.angle, toFood, maxTurn * 1.8);
            }
          }
        }
        break;
      }

      case STATE_CARRY_FOOD: {
        moveSpeed *= 0.55;
        ant.wanderAngle *= 0.7;

        let desiredAngle = ant.angle + ant.wanderAngle * 0.12;

        if (nest) {
          const toNest = Math.atan2(nest.y - ant.y, nest.x - ant.x);
          const distToNest = Math.sqrt(distSq(ant.x, ant.y, nest.x, nest.y));
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
            desiredAngle = toNest + ant.wanderAngle * 0.2;
          }

          if (distToNest < 80) {
            desiredAngle = steerTowards(desiredAngle, toNest, maxTurn * 2);
          }

          if (distSq(ant.x, ant.y, nest.x, nest.y) < 400) {
            nest.food += ant.carryFood;
            nest.birthProgress += ant.carryFood;
            ant.carryFood = 0;
            ant.state = STATE_EXPLORE;
            ant.angle = normalizeAngle(ant.angle + Math.PI + (Math.random() - 0.5) * 0.6);
          }
        }

        ant.angle = steerTowards(ant.angle, desiredAngle, maxTurn);

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
          spatialQuery(ant.x, ant.y, 15, queryResult);
          let allyCount = 0;
          for (let k = 0; k < queryResult.length; k++) {
            if (queryResult[k].species === ant.species && queryResult[k].alive) allyCount++;
          }
          const numBonus = Math.min(MAX_ALLY_BONUS, 1.0 + allyCount * ALLY_BONUS_PER_ANT);
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

    // Congestion
    const cx0 = (ant.x / SPATIAL_CELL) | 0;
    const cy0 = (ant.y / SPATIAL_CELL) | 0;
    let nearbyCount = 0;
    if (cx0 >= 0 && cx0 < SPATIAL_W && cy0 >= 0 && cy0 < SPATIAL_H) {
      nearbyCount = spatialBuckets[cy0 * SPATIAL_W + cx0].length;
    }
    if (nearbyCount > CONGESTION_THRESHOLD) {
      moveSpeed *= Math.max(MIN_CONGESTION_SPEED, 1.0 - (nearbyCount - CONGESTION_THRESHOLD) * CONGESTION_SLOWDOWN);
      ant.angle += (Math.random() - 0.5) * 0.15 * (nearbyCount - CONGESTION_THRESHOLD);
    }

    // Move
    const dx = Math.cos(ant.angle) * moveSpeed * dt;
    const dy = Math.sin(ant.angle) * moveSpeed * dt;
    const nx = ant.x + dx;
    const ny = ant.y + dy;

    if (isWalkable(nx, ny)) {
      ant.x = nx;
      ant.y = ny;
    } else {
      ant.angle += (Math.random() - 0.5) * Math.PI;
      ant.wanderAngle = (Math.random() - 0.5) * 2;
    }

    ant.x = Math.max(2, Math.min(WORLD_W - 2, ant.x));
    ant.y = Math.max(2, Math.min(WORLD_H - 2, ant.y));
  }

  // ─── Collision & combat detection ──────────────────
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

  // ─── Birth effects & log ───────────────────────────
  const birthEffects = [];  // {x, y, species, timer, role}

  function addBirthEffect(x, y, species, role) {
    birthEffects.push({
      x, y, species, timer: 1.0, role,
    });

    // Add birth log message to DOM
    const sp = SPECIES[species];
    const roleName = role === ROLE_SOLDIER ? '兵隊' : role === ROLE_QUEEN ? '女王' : '働き';
    const log = document.getElementById('birth-log');
    const msg = document.createElement('div');
    msg.className = 'birth-msg';
    msg.style.borderColor = `rgb(${sp.color[0]},${sp.color[1]},${sp.color[2]})`;
    msg.style.color = `rgb(${sp.color[0]},${sp.color[1]},${sp.color[2]})`;
    msg.textContent = `🐣 ${sp.name} ${roleName}アリ誕生`;
    log.appendChild(msg);
    // Remove after animation
    setTimeout(() => {
      if (msg.parentNode) msg.parentNode.removeChild(msg);
    }, 3000);
    // Keep log size bounded
    while (log.children.length > 8) {
      log.removeChild(log.firstChild);
    }
  }

  function updateBirthEffects(dt) {
    for (let i = birthEffects.length - 1; i >= 0; i--) {
      birthEffects[i].timer -= dt;
      if (birthEffects[i].timer <= 0) {
        birthEffects.splice(i, 1);
      }
    }
  }

  // ─── Nest logic (with reproduction visualization) ──
  function updateNests(dt) {
    for (const nest of nests) {
      const sp = SPECIES[nest.species];

      // Colony upkeep: consume food to maintain existing ants
      const upkeep = nest.population * NEST_UPKEEP_RATE * dt;
      nest.food = Math.max(0, nest.food - upkeep);

      // Birth occurs when enough food has been accumulated (birthProgress >= birthCost)
      if (nest.birthProgress >= sp.birthCost && nest.population < nest.maxPop) {
        nest.birthProgress -= sp.birthCost;
        const role = Math.random() < 0.15 ? ROLE_SOLDIER : ROLE_WORKER;
        const newAnt = spawnAnt(
          nest.x + (Math.random() - 0.5) * 15,
          nest.y + (Math.random() - 0.5) * 15,
          nest.species,
          role
        );
        if (newAnt) {
          // Trigger birth effect
          addBirthEffect(nest.x, nest.y, nest.species, role);
        }
      }

      depositPheromone(nest.x, nest.y, nest.species, PHERO_HOME, 1.0);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          depositPheromone(nest.x + dx * GRID_SIZE, nest.y + dy * GRID_SIZE, nest.species, PHERO_HOME, 0.8);
        }
      }
    }
  }

  // ─── Food management ──────────────────────────────
  function updateFoods() {
    for (let i = foods.length - 1; i >= 0; i--) {
      if (foods[i].amount <= 0) {
        foods.splice(i, 1);
      }
    }

    if (foods.length < 15 && Math.random() < 0.003) {
      const x = 30 + Math.random() * (WORLD_W - 60);
      const y = 30 + Math.random() * (WORLD_H - 60);
      if (isWalkable(x, y)) {
        createFood(x, y, 8 + Math.random() * 15, Math.random() < 0.2);
      }
    }
  }

  // ─── Cleanup dead ants ─────────────────────────────
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

  // ─── Population History (for graph) ────────────────
  const HISTORY_MAX = 300;
  const populationHistory = [];
  for (let s = 0; s < MAX_SPECIES; s++) {
    populationHistory.push([]);
  }
  let historyTimer = 0;

  function recordPopulationHistory(dt) {
    historyTimer += dt;
    if (historyTimer < 0.5) return;
    historyTimer = 0;

    for (let s = 0; s < MAX_SPECIES; s++) {
      let count = 0;
      for (const ant of ants) {
        if (ant.alive && ant.species === s) count++;
      }
      populationHistory[s].push(count);
      if (populationHistory[s].length > HISTORY_MAX) {
        populationHistory[s].shift();
      }
    }
  }

  // ─── Simulation step ──────────────────────────────
  function simulate(dt) {
    spatialClear();
    for (const ant of ants) {
      if (ant.alive) spatialInsert(ant);
    }

    for (const ant of ants) {
      updateAnt(ant, dt);
    }

    handleInteractions(dt);
    updateNests(dt);
    updateFoods();
    updatePheromones();
    updateBirthEffects(dt);
    recordPopulationHistory(dt);

    if (frameCount % 60 === 0) {
      cleanupAnts();
    }
  }

  // ─── Rendering ─────────────────────────────────────
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');

  let camX = 0, camY = 0, camZoom = 1;
  let targetCamX = 0, targetCamY = 0, targetCamZoom = 1;

  function resizeCanvas() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const scaleX = window.innerWidth / WORLD_W;
    const scaleY = window.innerHeight / WORLD_H;
    targetCamZoom = Math.min(scaleX, scaleY);
    targetCamX = (window.innerWidth - WORLD_W * targetCamZoom) / 2;
    targetCamY = (window.innerHeight - WORLD_H * targetCamZoom) / 2;
  }

  const pheroCanvas = document.createElement('canvas');
  pheroCanvas.width = GRID_W;
  pheroCanvas.height = GRID_H;
  const pheroCtx = pheroCanvas.getContext('2d');
  const pheroImageData = pheroCtx.createImageData(GRID_W, GRID_H);

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

        r += sc[0] * food * 0.7;
        g += sc[1] * food * 0.7;
        b += sc[2] * food * 0.7;

        r += sc[0] * home * 0.2;
        g += sc[1] * home * 0.2;
        b += sc[2] * home * 0.2;

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

    ctx.fillStyle = '#1a1206';
    ctx.fillRect(0, 0, w, h);

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

    // Grid
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

    // Pheromone
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
      ctx.fillStyle = 'rgba(20,15,8,0.9)';
      ctx.beginPath();
      ctx.arc(nest.x, nest.y, 5, 0, Math.PI * 2);
      ctx.fill();

      // Tunnel lines
      ctx.strokeStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},0.15)`;
      ctx.lineWidth = 2;
      for (const seg of nest.tunnels) {
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
        ctx.fillStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},0.1)`;
        ctx.beginPath();
        ctx.arc(seg.x2, seg.y2, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // ─── Reproduction progress bar above nest ───
      const barW = 30;
      const barH = 5;
      const barX = nest.x - barW / 2;
      const barY = nest.y - 22;
      const birthCost = sp.birthCost;
      const birthRatio = Math.min(1, nest.birthProgress / birthCost);

      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, barY, barW, barH);
      // Fill — gradient from dim to bright as it approaches full
      const r = sc[0], g = sc[1], b = sc[2];
      if (birthRatio >= 1) {
        // Full — pulsing glow to indicate ready
        const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.008);
        ctx.fillStyle = `rgba(255,255,180,${pulse})`;
      } else {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
      }
      ctx.fillRect(barX, barY, barW * birthRatio, barH);
      // Border
      ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(barX, barY, barW, barH);
      // Text label showing progress
      ctx.fillStyle = `rgba(255,255,255,0.8)`;
      ctx.font = '5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.floor(nest.birthProgress)}/${birthCost}`, nest.x, barY + barH - 0.5);

      // Queen crown icon (above the bar)
      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.font = '6px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👑', nest.x, barY - 2);

      // Population and stored food label at nest
      ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
      ctx.font = '7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${nest.population}匹 🍎${Math.floor(nest.food)}`, nest.x, nest.y + 20);
    }

    // Food
    for (const f of foods) {
      const ratio = f.amount / f.maxAmount;
      const size = f.big ? 4 + ratio * 4 : 2 + ratio * 2;
      ctx.fillStyle = f.big ? '#8a6' : '#a84';
      ctx.beginPath();
      ctx.arc(f.x, f.y, size, 0, Math.PI * 2);
      ctx.fill();
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

      // Legs
      ctx.strokeStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},0.6)`;
      ctx.lineWidth = 0.5;
      for (let li = 0; li < 3; li++) {
        const phase = ant.legPhase + li * 2.1;
        const legSwing = Math.sin(phase) * 0.4;
        const lx = -cr * 0.3 + li * cr * 0.5;
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx + Math.cos(legSwing) * cr, -cr * 1.2 + Math.sin(legSwing) * cr * 0.3);
        ctx.stroke();
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

    // ─── Birth effects (sparkle/glow at nest when born) ──
    for (const be of birthEffects) {
      const sc = SPECIES[be.species].color;
      const alpha = be.timer;
      const radius = (1 - be.timer) * 15 + 3;
      ctx.strokeStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},${alpha * 0.8})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(be.x, be.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Small sparkle particles
      const numParticles = 4;
      const t = 1 - be.timer;
      for (let p = 0; p < numParticles; p++) {
        const angle = (p / numParticles) * Math.PI * 2 + t * 2;
        const dist = t * 12;
        const px = be.x + Math.cos(angle) * dist;
        const py = be.y + Math.sin(angle) * dist;
        ctx.fillStyle = `rgba(255,255,200,${alpha * 0.6})`;
        ctx.beginPath();
        ctx.arc(px, py, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // ─── Population Graph Rendering ────────────────────
  function renderGraph() {
    if (!showGraph) return;

    const graphCanvas = document.getElementById('graphCanvas');
    const gCtx = graphCanvas.getContext('2d');
    const gW = graphCanvas.width;
    const gH = graphCanvas.height;

    gCtx.clearRect(0, 0, gW, gH);

    // Background
    gCtx.fillStyle = 'rgba(10,8,4,0.8)';
    gCtx.fillRect(0, 0, gW, gH);

    // Find max value for scaling
    let maxVal = 10;
    for (let s = 0; s < MAX_SPECIES; s++) {
      for (const v of populationHistory[s]) {
        if (v > maxVal) maxVal = v;
      }
    }
    maxVal = Math.ceil(maxVal / 10) * 10;

    // Grid lines
    gCtx.strokeStyle = 'rgba(200,170,100,0.15)';
    gCtx.lineWidth = 0.5;
    const gridLines = 4;
    for (let i = 1; i <= gridLines; i++) {
      const y = gH - (i / gridLines) * gH;
      gCtx.beginPath();
      gCtx.moveTo(0, y);
      gCtx.lineTo(gW, y);
      gCtx.stroke();
      // Label
      gCtx.fillStyle = 'rgba(200,170,100,0.5)';
      gCtx.font = '9px sans-serif';
      gCtx.textAlign = 'left';
      gCtx.fillText(String(Math.round((i / gridLines) * maxVal)), 2, y - 2);
    }

    // Draw lines for each species
    for (let s = 0; s < MAX_SPECIES; s++) {
      const hist = populationHistory[s];
      if (hist.length < 2) continue;

      const sc = SPECIES[s].color;
      gCtx.strokeStyle = `rgb(${sc[0]},${sc[1]},${sc[2]})`;
      gCtx.lineWidth = 2;
      gCtx.beginPath();

      for (let i = 0; i < hist.length; i++) {
        const x = (i / (HISTORY_MAX - 1)) * gW;
        const y = gH - (hist[i] / maxVal) * gH;
        if (i === 0) gCtx.moveTo(x, y);
        else gCtx.lineTo(x, y);
      }
      gCtx.stroke();
    }

    // Legend
    const legendY = 12;
    let legendX = gW - 10;
    gCtx.font = '10px sans-serif';
    gCtx.textAlign = 'right';
    for (let s = MAX_SPECIES - 1; s >= 0; s--) {
      const sc = SPECIES[s].color;
      const hist = populationHistory[s];
      const currentCount = hist.length > 0 ? hist[hist.length - 1] : 0;
      const label = `${SPECIES[s].name}: ${currentCount}`;
      gCtx.fillStyle = `rgb(${sc[0]},${sc[1]},${sc[2]})`;
      gCtx.fillText(label, legendX, legendY);
      legendX -= gCtx.measureText(label).width + 12;
    }
  }

  // ─── Input handling ────────────────────────────────
  let currentTool = 'observe';
  let currentSpecies = 0;
  let showPheromone = false;
  let showGrid = false;
  let showGraph = false;
  let simSpeed = 1;
  let isPaused = false;
  let frameCount = 0;

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
      case 'delete-nest':
        deleteNestNear(x, y);
        break;
      case 'delete-food':
        deleteFoodNear(x, y);
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

        // On tap (not drag), inspect nest or ant at position
        const tapX = e.clientX;
        const tapY = e.clientY;
        const checkTap = () => {
          const dx = Math.abs(e.clientX - tapX);
          const dy = Math.abs(e.clientY - tapY);
          if (dx < 5 && dy < 5) {
            const wx = (tapX - camX) / camZoom;
            const wy = (tapY - camY) / camZoom;
            showInfoAt(wx, wy);
          }
        };
        canvas.addEventListener('pointerup', checkTap, { once: true });
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
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinchDist > 0) {
        const scale = dist / lastPinchDist;
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetCamZoom * scale));
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
    } else if (isDrawing && currentTool !== 'nest' && currentTool !== 'delete-nest' && currentTool !== 'delete-food') {
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
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetCamZoom * scale));
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

  document.getElementById('toggle-graph').addEventListener('change', e => {
    showGraph = e.target.checked;
    document.getElementById('graph-panel').classList.toggle('hidden', !showGraph);
  });

  document.getElementById('close-graph').addEventListener('click', () => {
    showGraph = false;
    document.getElementById('toggle-graph').checked = false;
    document.getElementById('graph-panel').classList.add('hidden');
  });

  document.getElementById('close-info').addEventListener('click', () => {
    document.getElementById('info-panel').classList.add('hidden');
  });

  // ─── Inspect: show info panel for nest or ant ─────
  function showInfoAt(wx, wy) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content');

    // Check nests first
    for (const nest of nests) {
      if (distSq(wx, wy, nest.x, nest.y) < 400) {
        const sp = SPECIES[nest.species];
        const progress = Math.min(nest.birthProgress, sp.birthCost);
        content.innerHTML =
          `<b>${sp.name}の巣</b><br>` +
          `個体数: ${nest.population} / ${nest.maxPop}<br>` +
          `貯蔵食料: ${Math.floor(nest.food)}<br>` +
          `誕生進捗: ${Math.floor(progress)} / ${sp.birthCost}<br>` +
          `<small style="color:rgba(200,170,100,0.6)">位置: (${Math.floor(nest.x)}, ${Math.floor(nest.y)})</small>`;
        panel.classList.remove('hidden');
        return;
      }
    }

    // Check ants
    for (const ant of ants) {
      if (!ant.alive) continue;
      if (distSq(wx, wy, ant.x, ant.y) < 64) {
        const sp = SPECIES[ant.species];
        const stateNames = ['探索中', '帰巣中', '餌運搬', '戦闘中', '逃走中'];
        const roleNames = ['ワーカー', '兵隊', '女王'];
        const ageStr = ant.age < 60 ? `${Math.floor(ant.age)}秒` : `${(ant.age / 60).toFixed(1)}分`;
        const lifespanStr = ant.lifespan < 60 ? `${Math.floor(ant.lifespan)}秒` : `${(ant.lifespan / 60).toFixed(1)}分`;
        content.innerHTML =
          `<b>${sp.name} (${roleNames[ant.role]})</b><br>` +
          `状態: ${stateNames[ant.state] || '不明'}<br>` +
          `HP: ${ant.hp.toFixed(1)} / ${ant.maxHp.toFixed(1)}<br>` +
          `年齢: ${ageStr} / ${lifespanStr}<br>` +
          `所持食料: ${ant.carryFood.toFixed(1)}<br>` +
          `速度: ${ant.speed.toFixed(2)}`;
        panel.classList.remove('hidden');
        return;
      }
    }

    panel.classList.add('hidden');
  }

  // ─── FPS counter ───────────────────────────────────
  let fpsFrames = 0;
  let fpsTime = 0;
  let currentFps = 0;

  // ─── Species stats display ─────────────────────────
  function buildSpeciesStatsUI() {
    const container = document.getElementById('species-stats');
    container.innerHTML = '';
    for (let s = 0; s < MAX_SPECIES; s++) {
      const sp = SPECIES[s];
      const el = document.createElement('span');
      el.className = 'species-count';
      el.id = `species-count-${s}`;
      el.innerHTML = `<span class="dot" style="background:rgb(${sp.color[0]},${sp.color[1]},${sp.color[2]})"></span><span class="count-val">0</span>`;
      container.appendChild(el);
    }
  }

  // ─── Stats update ──────────────────────────────────
  function updateStats() {
    document.getElementById('ant-count').textContent = `🐜 ${ants.length}`;
    document.getElementById('food-count').textContent = `🍎 ${foods.length}`;
    document.getElementById('fps-counter').textContent = `FPS: ${currentFps}`;

    // Per-species counts
    const counts = new Array(MAX_SPECIES).fill(0);
    for (const ant of ants) {
      if (ant.alive) counts[ant.species]++;
    }
    for (let s = 0; s < MAX_SPECIES; s++) {
      const el = document.getElementById(`species-count-${s}`);
      if (el) {
        const valEl = el.querySelector('.count-val');
        if (valEl) valEl.textContent = counts[s];
      }
    }
  }

  // ─── Initialize world ─────────────────────────────
  function initWorld() {
    // Border walls
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

    // Scatter initial food (some near each nest to bootstrap the colony)
    const nestPositions = [[200, 300], [WORLD_W - 200, WORLD_H - 300]];
    for (const [nx, ny] of nestPositions) {
      for (let i = 0; i < 4; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 100;
        const fx = nx + Math.cos(angle) * dist;
        const fy = ny + Math.sin(angle) * dist;
        if (fx > 20 && fx < WORLD_W - 20 && fy > 20 && fy < WORLD_H - 20 && isWalkable(fx, fy)) {
          createFood(fx, fy, 15 + Math.random() * 15, false);
        }
      }
    }
    for (let i = 0; i < 12; i++) {
      const x = 50 + Math.random() * (WORLD_W - 100);
      const y = 50 + Math.random() * (WORLD_H - 100);
      if (isWalkable(x, y)) {
        createFood(x, y, 10 + Math.random() * 20, Math.random() < 0.25);
      }
    }
  }

  // ─── Main loop ─────────────────────────────────────
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

    // Population graph
    renderGraph();
  }

  // ─── Boot ──────────────────────────────────────────
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  buildSpeciesStatsUI();
  initWorld();
  lastTime = performance.now();
  requestAnimationFrame(mainLoop);

})();
