/* =====================================================
   AntSim4 - リアルなアリ生態シミュレータ v4
   新機能:
   - 消去範囲可視化: カーソル位置に消去範囲を表示
   - 消去範囲調整: スライダーで消去範囲を変更可能
   - COF（Config）モード: あらゆるパラメータ調整パネル
   - 略奪と抗争システム: 食料奪取・宣戦布告フェロモン
   - 兵站の最適化（Mizusumashi）: ベテランアリの効率ルート
   - 環境の動的変化: 雨・干ばつイベント
   - 遺伝的変異（Mutation）: 特殊個体の出現
   ===================================================== */

(function () {
  'use strict';

  // ─── Configurable Parameters (COF) ─────────────────
  const COF = {
    // World
    worldW: 1200,
    worldH: 800,
    maxAnts: 4000,

    // Lifespan
    lifespanEnabled: true,
    lifespanBase: 120,
    lifespanVariance: 40,

    // Pheromone
    pheroDecayRate: 0.997,
    pheroDiffuseRate: 0.08,
    pheroStrengthMultiplier: 1.0,

    // Spawning
    spawnMultiplier: 1,
    birthCostMultiplier: 1.0,

    // Movement
    speedMultiplier: 1.0,
    maxTurnRate: 0.12,

    // Combat
    combatDamageMultiplier: 1.0,
    allyBonusPerAnt: 0.15,
    maxAllyBonus: 2.0,

    // Congestion
    congestionThreshold: 5,
    congestionSlowdown: 0.08,
    minCongestionSpeed: 0.3,

    // Nest
    nestUpkeepRate: 0.002,
    nestMaxPop: 200,

    // Food
    naturalFoodSpawnRate: 0.003,
    naturalFoodMin: 8,
    naturalFoodMax: 15,

    // Plunder (Raid) system
    raidEnabled: true,
    raidDuration: 30,
    raidStealRate: 0.5,
    raidAggressionRange: 120,

    // Environment events
    envEventsEnabled: true,
    envEventInterval: 90,
    rainPheroResetStrength: 0.8,
    droughtFoodReduction: 0.5,

    // Mutation
    mutationEnabled: true,
    mutationRate: 0.03,
    mutationSpeedRange: 0.5,
    mutationPheroSenseRange: 0.4,

    // Mizusumashi (veteran logistics)
    mizusumasiEnabled: true,
    veteranAgeThreshold: 40,
    veteranSpeedBonus: 0.15,
    veteranCarryBonus: 0.3,
  };

  // ─── COF Definitions (for panel generation) ────────
  const COF_DEFS = [
    { section: '寿命 (Lifespan)', items: [
      { key: 'lifespanEnabled', label: '寿命ON/OFF', type: 'bool' },
      { key: 'lifespanBase', label: '基本寿命(秒)', type: 'range', min: 30, max: 600, step: 10 },
      { key: 'lifespanVariance', label: '寿命のバラつき(秒)', type: 'range', min: 0, max: 120, step: 5 },
    ]},
    { section: 'フェロモン (Pheromone)', items: [
      { key: 'pheroDecayRate', label: '減衰率', type: 'range', min: 0.98, max: 0.9999, step: 0.001 },
      { key: 'pheroDiffuseRate', label: '拡散の強さ', type: 'range', min: 0, max: 0.3, step: 0.01 },
      { key: 'pheroStrengthMultiplier', label: 'フェロモン強度倍率', type: 'range', min: 0.1, max: 3, step: 0.1 },
    ]},
    { section: '繁殖 (Spawning)', items: [
      { key: 'spawnMultiplier', label: '1回の誕生個体数', type: 'range', min: 1, max: 5, step: 1 },
      { key: 'birthCostMultiplier', label: '誕生コスト倍率', type: 'range', min: 0.2, max: 3, step: 0.1 },
    ]},
    { section: '移動 (Movement)', items: [
      { key: 'speedMultiplier', label: '移動速度倍率', type: 'range', min: 0.2, max: 3, step: 0.1 },
      { key: 'maxTurnRate', label: '最大旋回率', type: 'range', min: 0.02, max: 0.4, step: 0.02 },
    ]},
    { section: '戦闘 (Combat)', items: [
      { key: 'combatDamageMultiplier', label: 'ダメージ倍率', type: 'range', min: 0.1, max: 5, step: 0.1 },
      { key: 'allyBonusPerAnt', label: '味方ボーナス/匹', type: 'range', min: 0, max: 0.5, step: 0.05 },
      { key: 'maxAllyBonus', label: '最大味方ボーナス', type: 'range', min: 1, max: 5, step: 0.5 },
    ]},
    { section: '渋滞 (Congestion)', items: [
      { key: 'congestionThreshold', label: '渋滞閾値', type: 'range', min: 2, max: 20, step: 1 },
      { key: 'congestionSlowdown', label: '減速率', type: 'range', min: 0.01, max: 0.2, step: 0.01 },
    ]},
    { section: '巣 (Nest)', items: [
      { key: 'nestUpkeepRate', label: '維持コスト率', type: 'range', min: 0, max: 0.01, step: 0.001 },
      { key: 'nestMaxPop', label: '最大人口', type: 'range', min: 50, max: 1000, step: 50 },
    ]},
    { section: '食料 (Food)', items: [
      { key: 'naturalFoodSpawnRate', label: '自然湧き率', type: 'range', min: 0, max: 0.02, step: 0.001 },
    ]},
    { section: '略奪 (Raid)', items: [
      { key: 'raidEnabled', label: '略奪システムON/OFF', type: 'bool' },
      { key: 'raidDuration', label: '略奪モード持続(秒)', type: 'range', min: 10, max: 120, step: 5 },
      { key: 'raidStealRate', label: '略奪速度', type: 'range', min: 0.1, max: 2, step: 0.1 },
      { key: 'raidAggressionRange', label: '略奪侵攻範囲', type: 'range', min: 40, max: 300, step: 10 },
    ]},
    { section: '環境イベント (Environment)', items: [
      { key: 'envEventsEnabled', label: '環境イベントON/OFF', type: 'bool' },
      { key: 'envEventInterval', label: 'イベント間隔(秒)', type: 'range', min: 20, max: 300, step: 10 },
      { key: 'rainPheroResetStrength', label: '雨のフェロモン消去率', type: 'range', min: 0.1, max: 1, step: 0.1 },
      { key: 'droughtFoodReduction', label: '干ばつの食料減少率', type: 'range', min: 0.1, max: 0.9, step: 0.1 },
    ]},
    { section: '変異 (Mutation)', items: [
      { key: 'mutationEnabled', label: '変異ON/OFF', type: 'bool' },
      { key: 'mutationRate', label: '変異確率', type: 'range', min: 0, max: 0.2, step: 0.01 },
      { key: 'mutationSpeedRange', label: '速度変異幅', type: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'mutationPheroSenseRange', label: 'フェロモン感度変異幅', type: 'range', min: 0, max: 1, step: 0.05 },
    ]},
    { section: '兵站 (Mizusumashi)', items: [
      { key: 'mizusumasiEnabled', label: 'ベテランロジックON/OFF', type: 'bool' },
      { key: 'veteranAgeThreshold', label: 'ベテラン年齢(秒)', type: 'range', min: 10, max: 120, step: 5 },
      { key: 'veteranSpeedBonus', label: 'ベテラン速度ボーナス', type: 'range', min: 0, max: 0.5, step: 0.05 },
      { key: 'veteranCarryBonus', label: 'ベテラン運搬ボーナス', type: 'range', min: 0, max: 1, step: 0.1 },
    ]},
  ];

  // ─── Constants (derived from COF or fixed) ─────────
  const GRID_SIZE = 4;
  const SPATIAL_CELL = 16;

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
  const STATE_RAID = 5;

  const TERRAIN_EMPTY = 0;
  const TERRAIN_WALL = 1;
  const TERRAIN_WATER = 2;
  const TERRAIN_NEST = 3;

  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 8;
  const FOOD_PICKUP_RADIUS = 8;
  const FOOD_DETECT_RADIUS = 40;

  let DELETE_RADIUS_NEST = 25;
  let DELETE_RADIUS_FOOD = 15;
  let ERASE_BRUSH_SIZE = 3;

  const SPECIES = [
    { name: '赤アリ', color: [200, 60, 60], bodyR: 2.2, speed: 1.2, attack: 1.0, pheroStr: 1.0, birthCost: 10 },
    { name: '緑アリ', color: [60, 180, 60], bodyR: 2.6, speed: 0.9, attack: 1.3, pheroStr: 0.8, birthCost: 12 },
    { name: '青アリ', color: [60, 60, 200], bodyR: 1.8, speed: 1.5, attack: 0.7, pheroStr: 1.3, birthCost: 8 },
  ];

  // ─── Derived sizes ─────────────────────────────────
  let GRID_W = (COF.worldW / GRID_SIZE) | 0;
  let GRID_H = (COF.worldH / GRID_SIZE) | 0;
  let GRID_CELLS = GRID_W * GRID_H;
  let SPATIAL_W = (COF.worldW / SPATIAL_CELL) | 0;
  let SPATIAL_H = (COF.worldH / SPATIAL_CELL) | 0;

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
      birthProgress: 0,
      population: 0,
      maxPop: COF.nestMaxPop,
      tunnels: generateTunnels(x, y),
      birthEffects: [],
      // Raid system
      raidMode: false,
      raidTimer: 0,
      raidTarget: null,
    };
    nests.push(nest);

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

    for (let i = 0; i < 30; i++) {
      spawnAnt(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20, species, ROLE_WORKER);
    }
    for (let i = 0; i < 5; i++) {
      spawnAnt(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20, species, ROLE_SOLDIER);
    }

    return nest;
  }

  function deleteNestNear(x, y) {
    const r2 = DELETE_RADIUS_NEST * DELETE_RADIUS_NEST;
    for (let i = nests.length - 1; i >= 0; i--) {
      const nest = nests[i];
      const dx = nest.x - x;
      const dy = nest.y - y;
      if (dx * dx + dy * dy < r2) {
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
        const speciesId = nest.species;
        nests.splice(i, 1);
        const hasOtherNest = nests.some(n => n.species === speciesId);
        if (!hasOtherNest) {
          for (const ant of ants) {
            if (ant.species === speciesId) ant.alive = false;
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
    if (ants.length >= COF.maxAnts) return null;
    const sp = SPECIES[species];
    const lifespan = COF.lifespanBase + (Math.random() - 0.5) * 2 * COF.lifespanVariance;
    let baseSpeed = sp.speed * (role === ROLE_SOLDIER ? 0.85 : 1.0) * (0.85 + Math.random() * 0.3);
    let pheroSensitivity = 1.0;
    let isMutant = false;
    let mutationTraits = null;

    // Genetic Mutation
    if (COF.mutationEnabled && Math.random() < COF.mutationRate) {
      isMutant = true;
      const speedMut = 1.0 + (Math.random() - 0.5) * 2 * COF.mutationSpeedRange;
      const pheroMut = 1.0 + (Math.random() - 0.5) * 2 * COF.mutationPheroSenseRange;
      baseSpeed *= speedMut;
      pheroSensitivity = pheroMut;
      mutationTraits = {
        speedFactor: speedMut,
        pheroFactor: pheroMut,
      };
    }

    const ant = {
      x, y,
      angle: Math.random() * Math.PI * 2,
      speed: baseSpeed,
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
      // Mutation fields
      isMutant,
      mutationTraits,
      pheroSensitivity,
      // Raid fields
      raidTarget: null,
      stolenFood: 0,
      // Veteran tracking
      foodDelivered: 0,
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
    pheroGrids[ch][idx] = Math.min(pheroGrids[ch][idx] + strength * COF.pheroStrengthMultiplier, 1.0);
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
    const decayRate = COF.pheroDecayRate;
    const diffuseRate = COF.pheroDiffuseRate;
    for (let ch = 0; ch < TOTAL_PHERO_CHANNELS; ch++) {
      const grid = pheroGrids[ch];
      for (let i = 0; i < GRID_CELLS; i++) {
        grid[i] *= decayRate;
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
          grid[idx] = grid[idx] * (1 - diffuseRate) + avg * diffuseRate;
        }
      }
    }
  }

  // ─── Terrain helpers ───────────────────────────────
  function isWalkable(x, y) {
    if (x < 0 || x >= COF.worldW || y < 0 || y >= COF.worldH) return false;
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

  // ─── Environment Events ────────────────────────────
  let envEventTimer = 0;
  let activeEvent = null;
  let eventEffects = [];

  const ENV_EVENTS = [
    {
      id: 'rain',
      name: '☔ 雨 (Rain)',
      nameJa: '☔ 雨が降った！',
      duration: 5,
      apply() {
        const resetStr = COF.rainPheroResetStrength;
        for (let ch = 0; ch < TOTAL_PHERO_CHANNELS; ch++) {
          const grid = pheroGrids[ch];
          for (let i = 0; i < GRID_CELLS; i++) {
            grid[i] *= (1 - resetStr);
          }
        }
      },
    },
    {
      id: 'drought',
      name: '🏜 干ばつ (Drought)',
      nameJa: '🏜 干ばつ発生！',
      duration: 8,
      apply() {
        const reduction = COF.droughtFoodReduction;
        for (const f of foods) {
          f.amount *= (1 - reduction);
          if (f.amount < 0.1) f.amount = 0;
        }
        // Temporarily suppress natural food spawning (handled in updateFoods)
      },
    },
    {
      id: 'bloom',
      name: '🌸 豊穣 (Bloom)',
      nameJa: '🌸 豊穣の季節！',
      duration: 5,
      apply() {
        // Spawn extra food clusters
        for (let i = 0; i < 8; i++) {
          const x = 50 + Math.random() * (COF.worldW - 100);
          const y = 50 + Math.random() * (COF.worldH - 100);
          if (isWalkable(x, y)) {
            createFood(x, y, 15 + Math.random() * 25, Math.random() < 0.3);
          }
        }
      },
    },
    {
      id: 'storm',
      name: '🌪 嵐 (Storm)',
      nameJa: '🌪 嵐が来た！',
      duration: 4,
      apply() {
        // Scatter ants randomly
        for (const ant of ants) {
          if (!ant.alive) continue;
          const pushX = (Math.random() - 0.5) * 40;
          const pushY = (Math.random() - 0.5) * 40;
          const nx = ant.x + pushX;
          const ny = ant.y + pushY;
          if (isWalkable(nx, ny)) {
            ant.x = nx;
            ant.y = ny;
          }
          ant.angle += (Math.random() - 0.5) * Math.PI;
        }
        // Partial pheromone reset
        for (let ch = 0; ch < TOTAL_PHERO_CHANNELS; ch++) {
          const grid = pheroGrids[ch];
          for (let i = 0; i < GRID_CELLS; i++) {
            grid[i] *= 0.5;
          }
        }
      },
    },
  ];

  function updateEnvironmentEvents(dt) {
    if (!COF.envEventsEnabled) return;

    // Update active event timer
    if (activeEvent) {
      activeEvent.timer -= dt;
      if (activeEvent.timer <= 0) {
        activeEvent = null;
      }
    }

    envEventTimer += dt;
    if (envEventTimer >= COF.envEventInterval) {
      envEventTimer = 0;
      const evt = ENV_EVENTS[(Math.random() * ENV_EVENTS.length) | 0];
      evt.apply();
      activeEvent = { id: evt.id, name: evt.nameJa, timer: evt.duration };
      showEventNotification(evt.nameJa);
    }
  }

  function showEventNotification(text) {
    const log = document.getElementById('birth-log');
    const msg = document.createElement('div');
    msg.className = 'birth-msg event-msg';
    msg.style.borderColor = '#ffa';
    msg.style.color = '#ffa';
    msg.style.fontSize = '13px';
    msg.style.fontWeight = 'bold';
    msg.textContent = text;
    log.appendChild(msg);
    setTimeout(() => {
      if (msg.parentNode) msg.parentNode.removeChild(msg);
    }, 4000);
    while (log.children.length > 8) {
      log.removeChild(log.firstChild);
    }
  }

  // ─── Raid System ───────────────────────────────────
  function activateRaid(speciesId, targetSpeciesId) {
    if (!COF.raidEnabled) return;
    for (const nest of nests) {
      if (nest.species === speciesId) {
        nest.raidMode = true;
        nest.raidTimer = COF.raidDuration;
        // Find target nest
        for (const tn of nests) {
          if (tn.species === targetSpeciesId) {
            nest.raidTarget = tn;
            break;
          }
        }
        showEventNotification(`⚔️ ${SPECIES[speciesId].name} が ${SPECIES[targetSpeciesId].name} に宣戦布告！`);
        break;
      }
    }
  }

  function updateRaidMode(dt) {
    if (!COF.raidEnabled) return;
    for (const nest of nests) {
      if (nest.raidMode) {
        nest.raidTimer -= dt;
        if (nest.raidTimer <= 0) {
          nest.raidMode = false;
          nest.raidTarget = null;
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

  // Check if ant is a veteran (Mizusumashi)
  function isVeteran(ant) {
    return COF.mizusumasiEnabled && ant.age >= COF.veteranAgeThreshold && ant.foodDelivered >= 3;
  }

  function updateAnt(ant, dt) {
    if (!ant.alive) return;
    ant.age += dt;
    ant.legPhase += dt * ant.speed * 12;
    ant.fightCooldown = Math.max(0, ant.fightCooldown - dt);

    // Natural death from old age
    if (COF.lifespanEnabled && ant.age >= ant.lifespan) {
      ant.alive = false;
      return;
    }

    const sp = SPECIES[ant.species];
    const nest = getNestForSpecies(ant.species);

    if (!nest) {
      ant.hp -= dt * 0.1;
      if (ant.hp <= 0) {
        ant.alive = false;
        return;
      }
    }

    const maxTurn = COF.maxTurnRate;
    let moveSpeed = ant.speed * 38 * COF.speedMultiplier;

    // Veteran bonus (Mizusumashi)
    const veteran = isVeteran(ant);
    if (veteran) {
      moveSpeed *= (1.0 + COF.veteranSpeedBonus);
    }

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

    // Mutant: pheromone insensitivity affects wander
    const pheroSens = ant.pheroSensitivity;

    switch (ant.state) {
      case STATE_EXPLORE: {
        let desiredAngle = ant.angle + ant.wanderAngle * 0.3;

        const senseDist = 12;
        const senseAngle = 0.5;
        const fwdPhero = samplePheromoneDir(ant.x, ant.y, ant.angle, ant.species, PHERO_FOOD, senseDist) * pheroSens;
        const leftPhero = samplePheromoneDir(ant.x, ant.y, ant.angle - senseAngle, ant.species, PHERO_FOOD, senseDist) * pheroSens;
        const rightPhero = samplePheromoneDir(ant.x, ant.y, ant.angle + senseAngle, ant.species, PHERO_FOOD, senseDist) * pheroSens;

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

        // Raid mode: soldiers & workers seek enemy nest
        if (nest && nest.raidMode && nest.raidTarget) {
          const tn = nest.raidTarget;
          const distToTarget = Math.sqrt(distSq(ant.x, ant.y, tn.x, tn.y));
          if (distToTarget < COF.raidAggressionRange) {
            ant.state = STATE_RAID;
            ant.raidTarget = tn;
            break;
          } else if (ant.role === ROLE_SOLDIER || (veteran && Math.random() < 0.3)) {
            const toTarget = Math.atan2(tn.y - ant.y, tn.x - ant.x);
            ant.angle = steerTowards(ant.angle, toTarget, maxTurn * 1.2);
          }
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
              let capacity = ant.carryCapacity;
              if (veteran) capacity *= (1.0 + COF.veteranCarryBonus);
              if (f.big && f.amount > f.maxAmount * 0.5) {
                const take = Math.min(capacity * 0.4, f.amount);
                ant.carryFood = take;
                f.amount -= take;
                if (f.carriers.length < 6) f.carriers.push(ant);
              } else {
                const take = Math.min(capacity, f.amount);
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

        // Veteran carry speed bonus
        if (veteran) {
          moveSpeed *= 1.15;
        }

        let desiredAngle = ant.angle + ant.wanderAngle * 0.12;

        if (nest) {
          const toNest = Math.atan2(nest.y - ant.y, nest.x - ant.x);
          const distToNest = Math.sqrt(distSq(ant.x, ant.y, nest.x, nest.y));
          const senseDist = 14;
          const senseAngle = 0.55;

          // Veteran ants follow direct path more
          if (veteran) {
            desiredAngle = toNest + ant.wanderAngle * 0.05;
          } else {
            const fwd = samplePheromoneDir(ant.x, ant.y, ant.angle, ant.species, PHERO_HOME, senseDist) * pheroSens;
            const left = samplePheromoneDir(ant.x, ant.y, ant.angle - senseAngle, ant.species, PHERO_HOME, senseDist) * pheroSens;
            const right = samplePheromoneDir(ant.x, ant.y, ant.angle + senseAngle, ant.species, PHERO_HOME, senseDist) * pheroSens;

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
          }

          if (distToNest < 80) {
            desiredAngle = steerTowards(desiredAngle, toNest, maxTurn * 2);
          }

          if (distSq(ant.x, ant.y, nest.x, nest.y) < 400) {
            nest.food += ant.carryFood;
            nest.birthProgress += ant.carryFood;
            ant.foodDelivered++;
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
          const numBonus = Math.min(COF.maxAllyBonus, 1.0 + allyCount * COF.allyBonusPerAnt);
          target.hp -= sp.attack * (ant.role === ROLE_SOLDIER ? 1.5 : 0.8) * dt * 3 * numBonus * COF.combatDamageMultiplier;
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

      case STATE_RAID: {
        // Raid behavior: move towards enemy nest, steal food, return home
        const targetNest = ant.raidTarget;
        if (!targetNest || !nest || !nest.raidMode) {
          ant.state = STATE_EXPLORE;
          ant.raidTarget = null;
          break;
        }

        if (ant.stolenFood > 0) {
          // Carrying stolen food, return home
          moveSpeed *= 0.5;
          const toHome = Math.atan2(nest.y - ant.y, nest.x - ant.x);
          ant.angle = steerTowards(ant.angle, toHome, maxTurn * 2);

          if (distSq(ant.x, ant.y, nest.x, nest.y) < 400) {
            nest.food += ant.stolenFood;
            nest.birthProgress += ant.stolenFood;
            ant.stolenFood = 0;
            ant.foodDelivered++;
            ant.state = STATE_EXPLORE;
          }
        } else {
          // Move towards enemy nest to steal
          const toEnemy = Math.atan2(targetNest.y - ant.y, targetNest.x - ant.x);
          ant.angle = steerTowards(ant.angle, toEnemy, maxTurn * 1.5);
          moveSpeed *= 1.1;

          // At enemy nest: steal food
          if (distSq(ant.x, ant.y, targetNest.x, targetNest.y) < 600) {
            const stealAmt = COF.raidStealRate * dt;
            if (targetNest.food > stealAmt) {
              targetNest.food -= stealAmt;
              ant.stolenFood += stealAmt;
              depositPheromone(ant.x, ant.y, ant.species, PHERO_DANGER, 0.9 * sp.pheroStr);
            }
            let capacity = ant.carryCapacity;
            if (veteran) capacity *= (1.0 + COF.veteranCarryBonus);
            if (ant.stolenFood >= capacity) {
              // Full, head home
            }
          }
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

    // Veteran ants avoid congestion better (Mizusumashi)
    if (nearbyCount > COF.congestionThreshold) {
      const congestFactor = veteran ? 0.5 : 1.0;
      moveSpeed *= Math.max(COF.minCongestionSpeed, 1.0 - (nearbyCount - COF.congestionThreshold) * COF.congestionSlowdown * congestFactor);
      const spreadAngle = veteran ? 0.25 : 0.15;
      ant.angle += (Math.random() - 0.5) * spreadAngle * (nearbyCount - COF.congestionThreshold);
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

    ant.x = Math.max(2, Math.min(COF.worldW - 2, ant.x));
    ant.y = Math.max(2, Math.min(COF.worldH - 2, ant.y));
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
  const birthEffects = [];

  function addBirthEffect(x, y, species, role, isMutant) {
    birthEffects.push({
      x, y, species, timer: 1.0, role, isMutant: !!isMutant,
    });

    const sp = SPECIES[species];
    const roleName = role === ROLE_SOLDIER ? '兵隊' : role === ROLE_QUEEN ? '女王' : '働き';
    const log = document.getElementById('birth-log');
    const msg = document.createElement('div');
    msg.className = 'birth-msg';
    msg.style.borderColor = `rgb(${sp.color[0]},${sp.color[1]},${sp.color[2]})`;
    msg.style.color = `rgb(${sp.color[0]},${sp.color[1]},${sp.color[2]})`;
    let label = `🐣 ${sp.name} ${roleName}アリ誕生`;
    if (isMutant) label += ' 🧬突然変異!';
    msg.textContent = label;
    log.appendChild(msg);
    setTimeout(() => {
      if (msg.parentNode) msg.parentNode.removeChild(msg);
    }, 3000);
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

  // ─── Nest logic ────────────────────────────────────
  function updateNests(dt) {
    for (const nest of nests) {
      const sp = SPECIES[nest.species];
      nest.maxPop = COF.nestMaxPop;

      const upkeep = nest.population * COF.nestUpkeepRate * dt;
      nest.food = Math.max(0, nest.food - upkeep);

      const effectiveBirthCost = sp.birthCost * COF.birthCostMultiplier;
      if (nest.birthProgress >= effectiveBirthCost && nest.population < nest.maxPop) {
        const spawnCount = COF.spawnMultiplier;
        for (let si = 0; si < spawnCount; si++) {
          if (nest.population >= nest.maxPop) break;
          nest.birthProgress -= effectiveBirthCost;
          const role = Math.random() < 0.15 ? ROLE_SOLDIER : ROLE_WORKER;
          const newAnt = spawnAnt(
            nest.x + (Math.random() - 0.5) * 15,
            nest.y + (Math.random() - 0.5) * 15,
            nest.species,
            role
          );
          if (newAnt) {
            addBirthEffect(nest.x, nest.y, nest.species, role, newAnt.isMutant);
          }
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

    // Drought suppresses spawning
    const isDrought = activeEvent && activeEvent.id === 'drought';
    const spawnRate = isDrought ? COF.naturalFoodSpawnRate * 0.2 : COF.naturalFoodSpawnRate;

    if (foods.length < 15 && Math.random() < spawnRate) {
      const x = 30 + Math.random() * (COF.worldW - 60);
      const y = 30 + Math.random() * (COF.worldH - 60);
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
    updateRaidMode(dt);
    updateEnvironmentEvents(dt);
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
    const scaleX = window.innerWidth / COF.worldW;
    const scaleY = window.innerHeight / COF.worldH;
    targetCamZoom = Math.min(scaleX, scaleY);
    targetCamX = (window.innerWidth - COF.worldW * targetCamZoom) / 2;
    targetCamY = (window.innerHeight - COF.worldH * targetCamZoom) / 2;
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
    ctx.drawImage(terrainCanvas, 0, 0, COF.worldW, COF.worldH);

    // Grid
    if (showGrid) {
      ctx.strokeStyle = 'rgba(200,170,100,0.08)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x < COF.worldW; x += GRID_SIZE * 10) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, COF.worldH); ctx.stroke();
      }
      for (let y = 0; y < COF.worldH; y += GRID_SIZE * 10) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(COF.worldW, y); ctx.stroke();
      }
    }

    // Pheromone
    if (showPheromone) {
      renderPheromones();
      ctx.globalAlpha = 0.6;
      ctx.drawImage(pheroCanvas, 0, 0, COF.worldW, COF.worldH);
      ctx.globalAlpha = 1;
    }

    // Nests
    for (const nest of nests) {
      const sc = SPECIES[nest.species].color;

      // Raid mode indicator
      if (nest.raidMode) {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.01);
        ctx.strokeStyle = `rgba(255,50,50,${pulse * 0.6})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(nest.x, nest.y, 20 + pulse * 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},0.3)`;
      ctx.beginPath();
      ctx.arc(nest.x, nest.y, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(20,15,8,0.9)';
      ctx.beginPath();
      ctx.arc(nest.x, nest.y, 5, 0, Math.PI * 2);
      ctx.fill();

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

      // Reproduction progress bar
      const sp = SPECIES[nest.species];
      const barW = 30;
      const barH = 5;
      const barX = nest.x - barW / 2;
      const barY = nest.y - 22;
      const effectiveBirthCost = sp.birthCost * COF.birthCostMultiplier;
      const birthRatio = Math.min(1, nest.birthProgress / effectiveBirthCost);

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, barY, barW, barH);
      const r = sc[0], g = sc[1], b = sc[2];
      if (birthRatio >= 1) {
        const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.008);
        ctx.fillStyle = `rgba(255,255,180,${pulse})`;
      } else {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
      }
      ctx.fillRect(barX, barY, barW * birthRatio, barH);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(barX, barY, barW, barH);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.floor(nest.birthProgress)}/${Math.floor(effectiveBirthCost)}`, nest.x, barY + barH - 0.5);

      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.font = '6px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👑', nest.x, barY - 2);

      ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
      ctx.font = '7px sans-serif';
      ctx.textAlign = 'center';
      let nestLabel = `${nest.population}匹 🍎${Math.floor(nest.food)}`;
      if (nest.raidMode) nestLabel += ' ⚔️';
      ctx.fillText(nestLabel, nest.x, nest.y + 20);
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

      // Mutant glow
      if (ant.isMutant) {
        ctx.fillStyle = `rgba(255,255,100,${0.15 + 0.1 * Math.sin(ant.age * 3)})`;
        ctx.beginPath();
        ctx.arc(0, 0, cr * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Veteran indicator
      if (isVeteran(ant)) {
        ctx.strokeStyle = 'rgba(255,215,0,0.4)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.arc(0, 0, cr * 2, 0, Math.PI * 2);
        ctx.stroke();
      }

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

      // Carrying stolen food indicator
      if (ant.stolenFood > 0) {
        ctx.fillStyle = '#f44';
        ctx.beginPath();
        ctx.arc(-cr * 0.5, -cr * 0.8, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fighting indicator
      if (ant.state === STATE_FIGHT) {
        ctx.fillStyle = 'rgba(255,50,50,0.5)';
        ctx.beginPath();
        ctx.arc(0, 0, cr * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Raid indicator
      if (ant.state === STATE_RAID) {
        ctx.strokeStyle = 'rgba(255,100,0,0.6)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(0, 0, cr * 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }

    // Birth effects
    for (const be of birthEffects) {
      const sc = SPECIES[be.species].color;
      const alpha = be.timer;
      const radius = (1 - be.timer) * 15 + 3;
      ctx.strokeStyle = `rgba(${sc[0]},${sc[1]},${sc[2]},${alpha * 0.8})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(be.x, be.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      const numParticles = be.isMutant ? 8 : 4;
      const t = 1 - be.timer;
      for (let p = 0; p < numParticles; p++) {
        const angle = (p / numParticles) * Math.PI * 2 + t * 2;
        const dist = t * 12;
        const px = be.x + Math.cos(angle) * dist;
        const py = be.y + Math.sin(angle) * dist;
        ctx.fillStyle = be.isMutant ? `rgba(255,255,0,${alpha * 0.8})` : `rgba(255,255,200,${alpha * 0.6})`;
        ctx.beginPath();
        ctx.arc(px, py, be.isMutant ? 1.8 : 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Environment event overlay
    if (activeEvent) {
      ctx.fillStyle = 'rgba(255,255,200,0.03)';
      if (activeEvent.id === 'rain') {
        ctx.fillStyle = 'rgba(80,100,200,0.06)';
      } else if (activeEvent.id === 'drought') {
        ctx.fillStyle = 'rgba(200,150,50,0.05)';
      } else if (activeEvent.id === 'storm') {
        ctx.fillStyle = 'rgba(100,100,120,0.08)';
      }
      ctx.fillRect(0, 0, COF.worldW, COF.worldH);
    }

    ctx.restore();

    // ─── Erase/Delete cursor overlay ────────────────────
    if (cursorVisible && (currentTool === 'erase' || currentTool === 'delete-nest' || currentTool === 'delete-food' || currentTool === 'wall' || currentTool === 'water')) {
      let radiusWorld = 0;
      let cursorColor = 'rgba(255,255,255,0.5)';
      let cursorFill = 'rgba(255,255,255,0.06)';
      let dashPattern = [4, 4];

      switch (currentTool) {
        case 'erase':
          radiusWorld = ERASE_BRUSH_SIZE * GRID_SIZE;
          cursorColor = 'rgba(255,200,80,0.7)';
          cursorFill = 'rgba(255,200,80,0.1)';
          break;
        case 'delete-nest':
          radiusWorld = DELETE_RADIUS_NEST;
          cursorColor = 'rgba(255,80,80,0.7)';
          cursorFill = 'rgba(255,80,80,0.1)';
          break;
        case 'delete-food':
          radiusWorld = DELETE_RADIUS_FOOD;
          cursorColor = 'rgba(255,120,60,0.7)';
          cursorFill = 'rgba(255,120,60,0.1)';
          break;
        case 'wall':
          radiusWorld = 2 * GRID_SIZE;
          cursorColor = 'rgba(160,140,100,0.5)';
          cursorFill = 'rgba(160,140,100,0.06)';
          dashPattern = [2, 3];
          break;
        case 'water':
          radiusWorld = 2 * GRID_SIZE;
          cursorColor = 'rgba(80,140,255,0.5)';
          cursorFill = 'rgba(80,140,255,0.06)';
          dashPattern = [2, 3];
          break;
      }

      const radiusScreen = radiusWorld * camZoom;
      const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.005);

      ctx.save();
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      // Filled circle
      ctx.globalAlpha = pulse;
      ctx.fillStyle = cursorFill;
      ctx.beginPath();
      ctx.arc(cursorScreenX, cursorScreenY, radiusScreen, 0, Math.PI * 2);
      ctx.fill();

      // Dashed outline
      ctx.strokeStyle = cursorColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dashPattern);
      ctx.beginPath();
      ctx.arc(cursorScreenX, cursorScreenY, radiusScreen, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshair
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.4 * pulse;
      const cross = Math.max(3, radiusScreen * 0.2);
      ctx.beginPath();
      ctx.moveTo(cursorScreenX - cross, cursorScreenY);
      ctx.lineTo(cursorScreenX + cross, cursorScreenY);
      ctx.moveTo(cursorScreenX, cursorScreenY - cross);
      ctx.lineTo(cursorScreenX, cursorScreenY + cross);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Event notification on screen
    if (activeEvent) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(w / 2 - 100, 50, 200, 30);
      ctx.fillStyle = '#ffa';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(activeEvent.name, w / 2, 70);
    }
  }

  // ─── Population Graph Rendering ────────────────────
  function renderGraph() {
    if (!showGraph) return;

    const graphCanvas = document.getElementById('graphCanvas');
    const gCtx = graphCanvas.getContext('2d');
    const gW = graphCanvas.width;
    const gH = graphCanvas.height;

    gCtx.clearRect(0, 0, gW, gH);

    gCtx.fillStyle = 'rgba(10,8,4,0.8)';
    gCtx.fillRect(0, 0, gW, gH);

    let maxVal = 10;
    for (let s = 0; s < MAX_SPECIES; s++) {
      for (const v of populationHistory[s]) {
        if (v > maxVal) maxVal = v;
      }
    }
    maxVal = Math.ceil(maxVal / 10) * 10;

    gCtx.strokeStyle = 'rgba(200,170,100,0.15)';
    gCtx.lineWidth = 0.5;
    const gridLines = 4;
    for (let i = 1; i <= gridLines; i++) {
      const y = gH - (i / gridLines) * gH;
      gCtx.beginPath();
      gCtx.moveTo(0, y);
      gCtx.lineTo(gW, y);
      gCtx.stroke();
      gCtx.fillStyle = 'rgba(200,170,100,0.5)';
      gCtx.font = '9px sans-serif';
      gCtx.textAlign = 'left';
      gCtx.fillText(String(Math.round((i / gridLines) * maxVal)), 2, y - 2);
    }

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
  let showConfig = false;
  let simSpeed = 1;
  let isPaused = false;
  let frameCount = 0;

  let pointers = new Map();
  let lastPinchDist = 0;
  let isPanning = false;
  let panStartX = 0, panStartY = 0;
  let camStartX = 0, camStartY = 0;
  let isDrawing = false;
  let cursorScreenX = -1, cursorScreenY = -1;
  let cursorVisible = false;

  function screenToWorld(sx, sy) {
    return {
      x: (sx - camX) / camZoom,
      y: (sy - camY) / camZoom,
    };
  }

  function handleToolAction(sx, sy) {
    const { x, y } = screenToWorld(sx, sy);
    if (x < 0 || x >= COF.worldW || y < 0 || y >= COF.worldH) return;

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
        setTerrain(x, y, TERRAIN_EMPTY, ERASE_BRUSH_SIZE);
        terrainDirty = true;
        break;
      case 'delete-nest':
        deleteNestNear(x, y);
        break;
      case 'delete-food':
        deleteFoodNear(x, y);
        break;
      case 'provoke': {
        // Drop war pheromone - all species within range become aggressive
        depositPheromone(x, y, 0, PHERO_DANGER, 1.0);
        depositPheromone(x, y, 1, PHERO_DANGER, 1.0);
        depositPheromone(x, y, 2, PHERO_DANGER, 1.0);
        break;
      }
      case 'war': {
        // Declare war: find nearest nest of current species and make it raid the nearest other species
        let myNest = null;
        let minD = Infinity;
        for (const n of nests) {
          if (n.species === currentSpecies) {
            const d = distSq(x, y, n.x, n.y);
            if (d < minD) { minD = d; myNest = n; }
          }
        }
        if (myNest) {
          // Find nearest enemy nest
          let enemyNest = null;
          let enemyD = Infinity;
          for (const n of nests) {
            if (n.species !== currentSpecies) {
              const d = distSq(x, y, n.x, n.y);
              if (d < enemyD) { enemyD = d; enemyNest = n; }
            }
          }
          if (enemyNest) {
            activateRaid(currentSpecies, enemyNest.species);
          }
        }
        break;
      }
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
    cursorScreenX = e.clientX;
    cursorScreenY = e.clientY;
    cursorVisible = true;

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
    } else if (isDrawing && currentTool !== 'nest' && currentTool !== 'delete-nest' && currentTool !== 'delete-food' && currentTool !== 'war') {
      handleToolAction(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('pointerleave', () => {
    cursorVisible = false;
  });

  canvas.addEventListener('pointerenter', e => {
    cursorScreenX = e.clientX;
    cursorScreenY = e.clientY;
    cursorVisible = true;
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
  const eraseRadiusControl = document.getElementById('erase-radius-control');
  const eraseRadiusSlider = document.getElementById('erase-radius-slider');
  const eraseRadiusValue = document.getElementById('erase-radius-value');

  function updateEraseRadiusUI() {
    const isEraseTool = currentTool === 'erase' || currentTool === 'delete-nest' || currentTool === 'delete-food';
    if (isEraseTool) {
      eraseRadiusControl.classList.remove('hidden');
      // Update slider to reflect current tool's radius
      if (currentTool === 'erase') {
        eraseRadiusSlider.min = 1;
        eraseRadiusSlider.max = 15;
        eraseRadiusSlider.value = ERASE_BRUSH_SIZE;
        eraseRadiusValue.textContent = ERASE_BRUSH_SIZE;
      } else if (currentTool === 'delete-nest') {
        eraseRadiusSlider.min = 5;
        eraseRadiusSlider.max = 80;
        eraseRadiusSlider.value = DELETE_RADIUS_NEST;
        eraseRadiusValue.textContent = DELETE_RADIUS_NEST;
      } else if (currentTool === 'delete-food') {
        eraseRadiusSlider.min = 5;
        eraseRadiusSlider.max = 60;
        eraseRadiusSlider.value = DELETE_RADIUS_FOOD;
        eraseRadiusValue.textContent = DELETE_RADIUS_FOOD;
      }
    } else {
      eraseRadiusControl.classList.add('hidden');
    }
  }

  eraseRadiusSlider.addEventListener('input', () => {
    const val = parseInt(eraseRadiusSlider.value);
    eraseRadiusValue.textContent = val;
    if (currentTool === 'erase') {
      ERASE_BRUSH_SIZE = val;
    } else if (currentTool === 'delete-nest') {
      DELETE_RADIUS_NEST = val;
    } else if (currentTool === 'delete-food') {
      DELETE_RADIUS_FOOD = val;
    }
  });

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      updateEraseRadiusUI();
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

  // ─── COF Panel ─────────────────────────────────────
  document.getElementById('btn-config').addEventListener('click', () => {
    showConfig = !showConfig;
    document.getElementById('config-panel').classList.toggle('hidden', !showConfig);
  });

  document.getElementById('close-config').addEventListener('click', () => {
    showConfig = false;
    document.getElementById('config-panel').classList.add('hidden');
  });

  function buildConfigPanel() {
    const container = document.getElementById('config-content');
    container.innerHTML = '';

    for (const section of COF_DEFS) {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'config-section';

      const titleEl = document.createElement('div');
      titleEl.className = 'config-section-title';
      titleEl.textContent = section.section;
      titleEl.addEventListener('click', () => {
        sectionEl.classList.toggle('collapsed');
      });
      sectionEl.appendChild(titleEl);

      const itemsEl = document.createElement('div');
      itemsEl.className = 'config-items';

      for (const item of section.items) {
        const row = document.createElement('div');
        row.className = 'config-row';

        const label = document.createElement('label');
        label.textContent = item.label;
        row.appendChild(label);

        if (item.type === 'bool') {
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = COF[item.key];
          checkbox.addEventListener('change', () => {
            COF[item.key] = checkbox.checked;
          });
          row.appendChild(checkbox);
        } else if (item.type === 'range') {
          const wrapper = document.createElement('div');
          wrapper.className = 'config-slider-wrapper';

          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = item.min;
          slider.max = item.max;
          slider.step = item.step;
          slider.value = COF[item.key];

          const valueDisplay = document.createElement('span');
          valueDisplay.className = 'config-value';
          valueDisplay.textContent = COF[item.key];

          slider.addEventListener('input', () => {
            COF[item.key] = parseFloat(slider.value);
            valueDisplay.textContent = parseFloat(slider.value).toFixed(
              item.step < 0.01 ? 4 : item.step < 0.1 ? 3 : item.step < 1 ? 2 : 0
            );
          });

          wrapper.appendChild(slider);
          wrapper.appendChild(valueDisplay);
          row.appendChild(wrapper);
        }

        itemsEl.appendChild(row);
      }

      sectionEl.appendChild(itemsEl);
      container.appendChild(sectionEl);
    }
  }

  // ─── Inspect: show info panel for nest or ant ─────
  function showInfoAt(wx, wy) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content');

    for (const nest of nests) {
      if (distSq(wx, wy, nest.x, nest.y) < 400) {
        const sp = SPECIES[nest.species];
        const effectiveBirthCost = sp.birthCost * COF.birthCostMultiplier;
        const progress = Math.min(nest.birthProgress, effectiveBirthCost);
        let raidInfo = '';
        if (nest.raidMode) {
          raidInfo = `<br><span style="color:#f44">⚔️ 略奪中 (残${Math.floor(nest.raidTimer)}秒)</span>`;
        }
        content.innerHTML =
          `<b>${sp.name}の巣</b><br>` +
          `個体数: ${nest.population} / ${nest.maxPop}<br>` +
          `貯蔵食料: ${Math.floor(nest.food)}<br>` +
          `誕生進捗: ${Math.floor(progress)} / ${Math.floor(effectiveBirthCost)}<br>` +
          raidInfo +
          `<small style="color:rgba(200,170,100,0.6)">位置: (${Math.floor(nest.x)}, ${Math.floor(nest.y)})</small>`;
        panel.classList.remove('hidden');
        return;
      }
    }

    for (const ant of ants) {
      if (!ant.alive) continue;
      if (distSq(wx, wy, ant.x, ant.y) < 64) {
        const sp = SPECIES[ant.species];
        const stateNames = ['探索中', '帰巣中', '餌運搬', '戦闘中', '逃走中', '略奪中'];
        const roleNames = ['ワーカー', '兵隊', '女王'];
        const ageStr = ant.age < 60 ? `${Math.floor(ant.age)}秒` : `${(ant.age / 60).toFixed(1)}分`;
        const lifespanStr = COF.lifespanEnabled
          ? (ant.lifespan < 60 ? `${Math.floor(ant.lifespan)}秒` : `${(ant.lifespan / 60).toFixed(1)}分`)
          : '∞';
        let extra = '';
        if (ant.isMutant) {
          extra += `<br><span style="color:#ff0">🧬 突然変異体</span>`;
          if (ant.mutationTraits) {
            extra += `<br>速度因子: ${ant.mutationTraits.speedFactor.toFixed(2)}`;
            extra += `<br>感度因子: ${ant.mutationTraits.pheroFactor.toFixed(2)}`;
          }
        }
        if (isVeteran(ant)) {
          extra += `<br><span style="color:#ffd700">⭐ ベテラン (配達${ant.foodDelivered}回)</span>`;
        }
        content.innerHTML =
          `<b>${sp.name} (${roleNames[ant.role]})</b><br>` +
          `状態: ${stateNames[ant.state] || '不明'}<br>` +
          `HP: ${ant.hp.toFixed(1)} / ${ant.maxHp.toFixed(1)}<br>` +
          `年齢: ${ageStr} / ${lifespanStr}<br>` +
          `所持食料: ${ant.carryFood.toFixed(1)}<br>` +
          `速度: ${ant.speed.toFixed(2)}` +
          extra;
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

  function updateStats() {
    document.getElementById('ant-count').textContent = `🐜 ${ants.length}`;
    document.getElementById('food-count').textContent = `🍎 ${foods.length}`;
    document.getElementById('fps-counter').textContent = `FPS: ${currentFps}`;

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

    for (let i = 0; i < 5; i++) {
      const cx = 80 + Math.random() * (COF.worldW - 160);
      const cy = 80 + Math.random() * (COF.worldH - 160);
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

    for (let i = 0; i < 2; i++) {
      const cx = 100 + Math.random() * (COF.worldW - 200);
      const cy = 100 + Math.random() * (COF.worldH - 200);
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

    createNest(200, 300, 0);
    createNest(COF.worldW - 200, COF.worldH - 300, 1);

    const nestPositions = [[200, 300], [COF.worldW - 200, COF.worldH - 300]];
    for (const [nx, ny] of nestPositions) {
      for (let i = 0; i < 4; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 60 + Math.random() * 100;
        const fx = nx + Math.cos(angle) * dist;
        const fy = ny + Math.sin(angle) * dist;
        if (fx > 20 && fx < COF.worldW - 20 && fy > 20 && fy < COF.worldH - 20 && isWalkable(fx, fy)) {
          createFood(fx, fy, 15 + Math.random() * 15, false);
        }
      }
    }
    for (let i = 0; i < 12; i++) {
      const x = 50 + Math.random() * (COF.worldW - 100);
      const y = 50 + Math.random() * (COF.worldH - 100);
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

    fpsFrames++;
    fpsTime += rawDt;
    if (fpsTime >= 1) {
      currentFps = fpsFrames;
      fpsFrames = 0;
      fpsTime = 0;
      updateStats();
    }

    if (!isPaused) {
      const dt = rawDt * simSpeed;
      const steps = simSpeed >= 3 ? 2 : 1;
      const stepDt = dt / steps;
      for (let s = 0; s < steps; s++) {
        simulate(stepDt);
        frameCount++;
      }
    }

    render();
    renderGraph();
  }

  // ─── Boot ──────────────────────────────────────────
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  buildSpeciesStatsUI();
  buildConfigPanel();
  initWorld();
  lastTime = performance.now();
  requestAnimationFrame(mainLoop);

})();
