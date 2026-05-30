'use strict';
// ============================================================
//  NeuroDriver — AI Racing Evolution Engine v2
//  ニューロドライバー：AI学習サンドボックス
//  報酬カスタマイズ・車体設計・XAI可視化
// ============================================================

// ---- Configuration ----
const CFG = {
  POP: 30, ELITE: 6, MUT_RATE: 0.15, MUT_STR: 0.30,
  GEN_TIME: 12,
  CAR_R: 5, MAX_SPEED: 4.5, ACCEL: 0.14, BRAKE: 0.06,
  TURN: 0.055, DRAG: 0.985,
  SENSORS: 5, SENSOR_RANGE: 160,
  SENSOR_ANGLES: [-60, -30, 0, 30, 60],
  HIDDEN: 8,
  TRACK_W: 60, CP_COUNT: 50,
  COG_OFFSET: 0,
  LATENCY: 0,
};

// ---- Reward Configuration ----
const REWARD_CFG = {
  weights: { speed: 0, safety: 0, efficiency: 0, smoothness: 0 },
  rules: [],
};

// ---- Telemetry Ring Buffer ----
const TELEM_SIZE = 120;
const telemetry = {
  throttle: new Float32Array(TELEM_SIZE),
  brake: new Float32Array(TELEM_SIZE),
  steering: new Float32Array(TELEM_SIZE),
  speed: new Float32Array(TELEM_SIZE),
  idx: 0,
  count: 0,
  sensorAttention: [],
  current: { throttle: 0, brake: 0, steering: 0, speed: 0, sensorValues: [] },
};

function telemPush(throttle, brake, steering, speed) {
  telemetry.throttle[telemetry.idx] = throttle;
  telemetry.brake[telemetry.idx] = brake;
  telemetry.steering[telemetry.idx] = steering;
  telemetry.speed[telemetry.idx] = speed;
  telemetry.idx = (telemetry.idx + 1) % TELEM_SIZE;
  if (telemetry.count < TELEM_SIZE) telemetry.count++;
  telemetry.current = { throttle, brake, steering, speed, sensorValues: [] };
}

function telemGet(arr) {
  const out = [];
  const start = telemetry.count < TELEM_SIZE ? 0 : telemetry.idx;
  for (let i = 0; i < telemetry.count; i++) {
    out.push(arr[(start + i) % TELEM_SIZE]);
  }
  return out;
}

function telemReset() {
  telemetry.throttle.fill(0);
  telemetry.brake.fill(0);
  telemetry.steering.fill(0);
  telemetry.speed.fill(0);
  telemetry.idx = 0;
  telemetry.count = 0;
  telemetry.sensorAttention = [];
}

// ---- Math Utilities ----
const PI2 = Math.PI * 2;
const DEG = Math.PI / 180;
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); }
function randF(lo, hi) { return Math.random() * (hi - lo) + lo; }
function randGauss() { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(PI2 * v); }

function side(px, py, x1, y1, x2, y2) {
  return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
}

function raySeg(ox, oy, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1;
  const det = sx * dy - dx * sy;
  if (Math.abs(det) < 1e-10) return -1;
  const invDet = 1 / det;
  const t = (-sy * (x1 - ox) + sx * (y1 - oy)) * invDet;
  const s = (dx * (y1 - oy) - dy * (x1 - ox)) * invDet;
  return (t >= 0 && s >= 0 && s <= 1) ? t : -1;
}

function ptSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) return dist(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = clamp(t, 0, 1);
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

// ---- Sensor angle generation ----
const SENSOR_SPREAD_DEG = 120; // total angular spread of sensors in degrees

function generateSensorAngles(count) {
  if (count <= 1) return [0];
  const angles = [];
  for (let i = 0; i < count; i++) {
    angles.push(-SENSOR_SPREAD_DEG / 2 + (SENSOR_SPREAD_DEG / (count - 1)) * i);
  }
  return angles;
}

// ============================================================
//  Reward Computation (extracted from Car.update)
// ============================================================
// Reward scaling constants: when efficiency progress exists, use full scale;
// otherwise reduce reward to avoid rewarding stationary cars.
const REWARD_SCALE_ACTIVE = 1;
const REWARD_SCALE_INACTIVE = 0.1;
// Center-of-gravity effect on turning: higher values amplify oversteer/understeer
const COG_EFFECT_MULTIPLIER = 0.3;

// Shared condition type definitions for reward rules
const RULE_CONDITION_TYPES = [
  { value: 'wall_distance', label: '壁距離' },
  { value: 'speed_over', label: '速度超過' },
  { value: 'speed_under', label: '速度不足' },
  { value: 'steer_change', label: '操舵変化' },
];

function computeReward(car, checkpoints) {
  const w = REWARD_CFG.weights;
  const totalWeight = (w.speed + w.safety + w.efficiency + w.smoothness);

  // When all weights are 0, base weighted reward is 0 — cars get no directional reward.
  // Rule-based bonuses/penalties still apply even with zero weights.
  let baseReward = 0;

  if (totalWeight > 0) {
    // Efficiency reward: checkpoint progress (original fitness)
    let efficiencyReward = 0;
    if (checkpoints.length > 0) {
      const cp = checkpoints[car.nextCP];
      const d = dist(car.x, car.y, cp.cx, cp.cy);
      const prevCPIdx = (car.nextCP - 1 + checkpoints.length) % checkpoints.length;
      const prevCP = checkpoints[prevCPIdx];
      const totalD = dist(prevCP.cx, prevCP.cy, cp.cx, cp.cy) || 1;
      const progress = clamp(1 - d / totalD, 0, 1);
      efficiencyReward = car.cpPassed + progress * 0.99;
    }

    // Speed reward: normalized speed
    const speedReward = car.speed / CFG.MAX_SPEED;

    // Safety reward: minimum sensor value (farther from walls = higher)
    let minSensor = 1;
    for (let i = 0; i < car.sensors.length; i++) {
      if (car.sensors[i] < minSensor) minSensor = car.sensors[i];
    }
    const safetyReward = minSensor;

    // Smoothness reward: penalize sudden steering changes
    const smoothReward = 1 - Math.abs(car._steerChange || 0);

    // Weighted combination
    baseReward = (
      w.efficiency * efficiencyReward +
      w.speed * speedReward +
      w.safety * safetyReward +
      w.smoothness * smoothReward
    ) / totalWeight;

    // Scale so efficiency component dominates magnitude (keeps evolution working)
    baseReward *= (efficiencyReward > 0 ? REWARD_SCALE_ACTIVE : REWARD_SCALE_INACTIVE);
  }

  // Apply conditional rules (these work even with zero base weights)
  let ruleBonus = 0;
  let minSensor = 1;
  for (let i = 0; i < car.sensors.length; i++) {
    if (car.sensors[i] < minSensor) minSensor = car.sensors[i];
  }
  for (const rule of REWARD_CFG.rules) {
    if (!rule.enabled) continue;
    let condVal = 0;
    if (rule.condition.type === 'wall_distance') condVal = minSensor;
    else if (rule.condition.type === 'speed_over') condVal = car.speed;
    else if (rule.condition.type === 'speed_under') condVal = car.speed;
    else if (rule.condition.type === 'steer_change') condVal = Math.abs(car._steerChange || 0);

    let met = false;
    if (rule.condition.comparison === 'lt') met = condVal < rule.condition.threshold;
    else if (rule.condition.comparison === 'gt') met = condVal > rule.condition.threshold;

    if (met) {
      ruleBonus += rule.effect.type === 'penalty' ? -Math.abs(rule.effect.value) : Math.abs(rule.effect.value);
    }
  }

  return baseReward + ruleBonus;
}

// ============================================================
//  Neural Network
// ============================================================
class NeuralNet {
  constructor(inN, hidN, outN) {
    this.inN = inN; this.hidN = hidN; this.outN = outN;
    this.wIH = new Float32Array(inN * hidN);
    this.bH = new Float32Array(hidN);
    this.wHO = new Float32Array(hidN * outN);
    this.bO = new Float32Array(outN);
    this.aIn = new Float32Array(inN);
    this.aHid = new Float32Array(hidN);
    this.aOut = new Float32Array(outN);
    this.randomize();
  }
  randomize() {
    for (let i = 0; i < this.wIH.length; i++) this.wIH[i] = randF(-1, 1);
    for (let i = 0; i < this.bH.length; i++) this.bH[i] = randF(-0.5, 0.5);
    for (let i = 0; i < this.wHO.length; i++) this.wHO[i] = randF(-1, 1);
    for (let i = 0; i < this.bO.length; i++) this.bO[i] = randF(-0.5, 0.5);
  }
  forward(inputs) {
    for (let i = 0; i < this.inN; i++) this.aIn[i] = inputs[i];
    for (let h = 0; h < this.hidN; h++) {
      let s = this.bH[h];
      for (let i = 0; i < this.inN; i++) s += inputs[i] * this.wIH[i * this.hidN + h];
      this.aHid[h] = Math.tanh(s);
    }
    for (let o = 0; o < this.outN; o++) {
      let s = this.bO[o];
      for (let h = 0; h < this.hidN; h++) s += this.aHid[h] * this.wHO[h * this.outN + o];
      this.aOut[o] = Math.tanh(s);
    }
    return this.aOut;
  }
  copy() {
    const n = new NeuralNet(this.inN, this.hidN, this.outN);
    n.wIH.set(this.wIH); n.bH.set(this.bH);
    n.wHO.set(this.wHO); n.bO.set(this.bO);
    return n;
  }
  mutate(rate, strength) {
    const mutArr = (arr) => { for (let i = 0; i < arr.length; i++) if (Math.random() < rate) arr[i] += randGauss() * strength; };
    mutArr(this.wIH); mutArr(this.bH); mutArr(this.wHO); mutArr(this.bO);
  }
  getGenomeSize() { return this.wIH.length + this.bH.length + this.wHO.length + this.bO.length; }

  // Compute sensor attention: sum of absolute weights from each input to hidden layer
  getSensorAttention() {
    const attn = new Float32Array(this.inN);
    for (let i = 0; i < this.inN; i++) {
      let sum = 0;
      for (let h = 0; h < this.hidN; h++) {
        sum += Math.abs(this.wIH[i * this.hidN + h]);
      }
      attn[i] = sum;
    }
    // Normalize
    let maxA = 0;
    for (let i = 0; i < attn.length; i++) if (attn[i] > maxA) maxA = attn[i];
    if (maxA > 0) for (let i = 0; i < attn.length; i++) attn[i] /= maxA;
    return attn;
  }
}

// ============================================================
//  Track Generation
// ============================================================
function smoothCenterline(ctrl, samplesPerSeg = 8) {
  const n = ctrl.length, pts = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < samplesPerSeg; s++) {
      pts.push(catmullRom(p0, p1, p2, p3, s / samplesPerSeg));
    }
  }
  return pts;
}

function buildTrack(centerPts, halfW, cpCount) {
  const n = centerPts.length;
  const inner = [], outer = [], walls = [], checkpoints = [];

  for (let i = 0; i < n; i++) {
    const prev = centerPts[(i - 1 + n) % n], next = centerPts[(i + 1) % n];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    inner.push({ x: centerPts[i].x + nx * halfW, y: centerPts[i].y + ny * halfW });
    outer.push({ x: centerPts[i].x - nx * halfW, y: centerPts[i].y - ny * halfW });
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    walls.push({ x1: inner[i].x, y1: inner[i].y, x2: inner[j].x, y2: inner[j].y });
    walls.push({ x1: outer[i].x, y1: outer[i].y, x2: outer[j].x, y2: outer[j].y });
  }

  const cpSpacing = Math.max(1, Math.floor(n / cpCount));
  for (let k = 0; k < cpCount; k++) {
    const idx = Math.floor(k * n / cpCount) % n;
    const nextIdx = (idx + cpSpacing) % n;
    const correctSide = side(centerPts[nextIdx].x, centerPts[nextIdx].y,
      inner[idx].x, inner[idx].y, outer[idx].x, outer[idx].y);
    checkpoints.push({
      x1: inner[idx].x, y1: inner[idx].y,
      x2: outer[idx].x, y2: outer[idx].y,
      cx: centerPts[idx].x, cy: centerPts[idx].y,
      correctSign: Math.sign(correctSide),
    });
  }

  const s0 = centerPts[0], s1 = centerPts[1];
  const startAngle = Math.atan2(s1.y - s0.y, s1.x - s0.x);

  return { walls, checkpoints, inner, outer, center: centerPts, startX: s0.x, startY: s0.y, startAngle };
}

function presetTrack(cx, cy, baseR, perturbations, numCtrl = 24) {
  const ctrl = [];
  for (let i = 0; i < numCtrl; i++) {
    const a = (i / numCtrl) * PI2;
    let r = baseR;
    for (const p of perturbations) r += p.a * Math.sin(a * p.f + (p.p || 0));
    ctrl.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.75 });
  }
  return ctrl;
}

const PRESETS = [
  { name: 'オーバル', diff: '★☆☆', ctrl: (cx, cy) => presetTrack(cx, cy, 200, [], 20) },
  { name: 'ピーナッツ', diff: '★★☆', ctrl: (cx, cy) => presetTrack(cx, cy, 180, [{ a: 70, f: 2, p: 0 }], 24) },
  { name: 'クローバー', diff: '★★★', ctrl: (cx, cy) => presetTrack(cx, cy, 150, [{ a: 55, f: 3, p: 0.5 }], 28) },
  { name: 'スター', diff: '★★★', ctrl: (cx, cy) => presetTrack(cx, cy, 140, [{ a: 45, f: 5, p: 0 }], 32) },
];

// ============================================================
//  Car (with latency buffer & CoG offset)
// ============================================================
class Car {
  constructor(x, y, angle, brain) {
    this.x = x; this.y = y; this.angle = angle;
    this.speed = 0; this.brain = brain;
    this.alive = true; this.fitness = 0;
    this.nextCP = 0; this.cpPassed = 0; this.laps = 0;
    this.prevX = x; this.prevY = y;
    this.sensors = new Float32Array(CFG.SENSORS);
    this.age = 0; this.maxFit = 0;
    this.stagnant = 0;
    this._prevSteer = 0;
    this._steerChange = 0;
    // Latency buffer for delayed inputs
    this._latencyBuf = [];
    for (let i = 0; i < CFG.LATENCY; i++) {
      this._latencyBuf.push(new Float32Array(CFG.SENSORS + 1));
    }
    this._latencyIdx = 0;
  }

  castSensors(walls) {
    for (let s = 0; s < CFG.SENSORS; s++) {
      const a = this.angle + CFG.SENSOR_ANGLES[s] * DEG;
      const dx = Math.cos(a), dy = Math.sin(a);
      let minD = CFG.SENSOR_RANGE;
      for (const w of walls) {
        const d = raySeg(this.x, this.y, dx, dy, w.x1, w.y1, w.x2, w.y2);
        if (d >= 0 && d < minD) minD = d;
      }
      this.sensors[s] = minD / CFG.SENSOR_RANGE;
    }
  }

  update(walls, checkpoints) {
    if (!this.alive) return;
    this.age++;

    this.castSensors(walls);

    // Build current inputs
    const currentInputs = new Float32Array(CFG.SENSORS + 1);
    for (let i = 0; i < CFG.SENSORS; i++) currentInputs[i] = this.sensors[i];
    currentInputs[CFG.SENSORS] = this.speed / CFG.MAX_SPEED;

    // Apply latency: use delayed inputs if latency > 0
    let inputs;
    if (CFG.LATENCY > 0 && this._latencyBuf.length > 0) {
      inputs = this._latencyBuf[this._latencyIdx % this._latencyBuf.length];
      this._latencyBuf[this._latencyIdx % this._latencyBuf.length] = currentInputs;
      this._latencyIdx++;
    } else {
      inputs = currentInputs;
    }

    const out = this.brain.forward(inputs);

    const steer = out[0];
    const accel = out[1];
    this._steerChange = steer - this._prevSteer;
    this._prevSteer = steer;

    // Turn rate scales with speed, plus CoG offset effect
    const speedFactor = Math.abs(this.speed) / CFG.MAX_SPEED + 0.15;
    const cogEffect = 1 + CFG.COG_OFFSET * COG_EFFECT_MULTIPLIER * (this.speed / CFG.MAX_SPEED);
    this.angle += steer * CFG.TURN * Math.min(speedFactor, 1) * cogEffect;

    if (accel > 0) this.speed += accel * CFG.ACCEL;
    else this.speed += accel * CFG.BRAKE;
    this.speed *= CFG.DRAG;
    this.speed = clamp(this.speed, -0.5, CFG.MAX_SPEED);

    this.prevX = this.x; this.prevY = this.y;
    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;

    for (const w of walls) {
      if (ptSegDist(this.x, this.y, w.x1, w.y1, w.x2, w.y2) < CFG.CAR_R) {
        this.alive = false;
        return;
      }
    }

    // Checkpoint detection
    if (checkpoints.length > 0) {
      const cp = checkpoints[this.nextCP];
      const prevS = side(this.prevX, this.prevY, cp.x1, cp.y1, cp.x2, cp.y2);
      const currS = side(this.x, this.y, cp.x1, cp.y1, cp.x2, cp.y2);
      if (prevS * currS < 0) {
        if (Math.sign(currS) === cp.correctSign || cp.correctSign === 0) {
          this.cpPassed++;
          this.nextCP = (this.nextCP + 1) % checkpoints.length;
          if (this.nextCP === 0) this.laps++;
        }
      }
    }

    // Compute fitness using reward function
    this.fitness = computeReward(this, checkpoints);

    // Stagnation detection
    if (this.fitness > this.maxFit + 0.01) {
      this.maxFit = this.fitness;
      this.stagnant = 0;
    } else {
      this.stagnant++;
      if (this.stagnant > 180) this.alive = false;
    }
  }
}

// ============================================================
//  Genetic Algorithm
// ============================================================
function evolve(cars, eliteCount) {
  cars.sort((a, b) => b.fitness - a.fitness);
  const elites = cars.slice(0, eliteCount);
  const children = [];

  for (const e of elites) {
    children.push(e.brain.copy());
  }

  while (children.length < CFG.POP) {
    const parent = elites[Math.floor(Math.random() * elites.length)];
    const child = parent.brain.copy();
    child.mutate(CFG.MUT_RATE, CFG.MUT_STR);
    children.push(child);
  }

  return children;
}

// ============================================================
//  Reward Rule Management
// ============================================================
let ruleIdCounter = 0;

function addRewardRule() {
  const rule = {
    id: 'rule_' + (ruleIdCounter++),
    condition: { type: 'wall_distance', threshold: 0.3, comparison: 'lt' },
    effect: { type: 'penalty', value: 0.5 },
    enabled: true,
  };
  REWARD_CFG.rules.push(rule);
  return rule;
}

function removeRewardRule(id) {
  REWARD_CFG.rules = REWARD_CFG.rules.filter(r => r.id !== id);
}

function renderRuleList(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (const rule of REWARD_CFG.rules) {
    const div = document.createElement('div');
    div.className = 'rule-item';

    const condSelect = document.createElement('select');
    RULE_CONDITION_TYPES.forEach(({ value, label }) => {
      const o = document.createElement('option');
      o.value = value; o.textContent = label;
      if (value === rule.condition.type) o.selected = true;
      condSelect.appendChild(o);
    });
    condSelect.addEventListener('change', () => { rule.condition.type = condSelect.value; syncRuleLists(); });

    const compSelect = document.createElement('select');
    [['lt', '＜'], ['gt', '＞']].forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      if (v === rule.condition.comparison) o.selected = true;
      compSelect.appendChild(o);
    });
    compSelect.addEventListener('change', () => { rule.condition.comparison = compSelect.value; syncRuleLists(); });

    const threshInput = document.createElement('input');
    threshInput.type = 'number';
    threshInput.step = '0.1';
    threshInput.value = rule.condition.threshold;
    threshInput.addEventListener('change', () => { rule.condition.threshold = parseFloat(threshInput.value) || 0; syncRuleLists(); });

    const effSelect = document.createElement('select');
    [['penalty', '罰'], ['bonus', '報酬']].forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = l;
      if (v === rule.effect.type) o.selected = true;
      effSelect.appendChild(o);
    });
    effSelect.addEventListener('change', () => { rule.effect.type = effSelect.value; syncRuleLists(); });

    const valInput = document.createElement('input');
    valInput.type = 'number';
    valInput.step = '0.1';
    valInput.min = '0';
    valInput.max = '5';
    valInput.value = rule.effect.value;
    valInput.addEventListener('change', () => { rule.effect.value = parseFloat(valInput.value) || 0; syncRuleLists(); });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'rule-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => { removeRewardRule(rule.id); syncRuleLists(); });

    div.appendChild(condSelect);
    div.appendChild(compSelect);
    div.appendChild(threshInput);
    div.appendChild(effSelect);
    div.appendChild(valInput);
    div.appendChild(removeBtn);
    container.appendChild(div);
  }
}

function syncRuleLists() {
  renderRuleList('ruleList');
  renderRuleList('ruleListM');
  renderRuleList('ruleListLive');
}

// ============================================================
//  Main Game
// ============================================================
class Game {
  constructor() {
    this.state = 'start';
    this.track = null;
    this.cars = [];
    this.gen = 0;
    this.genTimer = 0;
    this.speedMult = 1;
    this.bestFitHistory = [];
    this.avgFitHistory = [];
    this.selectedCar = null;
    this.bestCar = null;
    this.allTimeBest = 0;
    this.bestBrain = null;
    this.tickerMsg = '🧠 AIの学習を観察しましょう';
    this.drawPoints = [];
    this.frameCount = 0;
    this.trackCache = null;
    this.showRacerInfo = false;
    this.watchMode = false;
    this.watchBrain = null;

    // Canvas refs
    this.mainC = document.getElementById('mainCanvas');
    this.mainCtx = this.mainC.getContext('2d');
    this.neuralC = document.getElementById('neuralCanvas');
    this.neuralCtx = this.neuralC.getContext('2d');
    this.fitC = document.getElementById('fitnessCanvas');
    this.fitCtx = this.fitC.getContext('2d');
    this.drawC = document.getElementById('drawCanvas');
    this.drawCtx = this.drawC.getContext('2d');
    this.telemC = document.getElementById('telemetryCanvas');
    this.telemCtx = this.telemC ? this.telemC.getContext('2d') : null;
    this.attnC = document.getElementById('attentionCanvas');
    this.attnCtx = this.attnC ? this.attnC.getContext('2d') : null;
    this.sensorPrev = document.getElementById('sensorPreview');
    this.sensorPrevCtx = this.sensorPrev ? this.sensorPrev.getContext('2d') : null;

    // Mobile canvases
    this.neuralCM = document.getElementById('neuralCanvasM');
    this.fitCM = document.getElementById('fitnessCanvasM');
    this.telemCM = document.getElementById('telemetryCanvasM');
    this.attnCM = document.getElementById('attentionCanvasM');

    this.setupUI();
    this.setupPresets();
    this.resizeAll();
    window.addEventListener('resize', () => this.resizeAll());
    this.loop();
  }

  resizeAll() {
    const wrap = this.mainC.parentElement;
    if (wrap) {
      this.mainC.width = wrap.clientWidth * devicePixelRatio;
      this.mainC.height = wrap.clientHeight * devicePixelRatio;
      this.mainC.style.width = wrap.clientWidth + 'px';
      this.mainC.style.height = wrap.clientHeight + 'px';
      this.trackCache = null;
    }
    this.resizeCanvas(this.neuralC);
    this.resizeCanvas(this.fitC);
    this.resizeCanvas(this.telemC);
    this.resizeCanvas(this.attnC);
    if (this.drawC.parentElement) {
      this.drawC.width = window.innerWidth * devicePixelRatio;
      this.drawC.height = (window.innerHeight - 52) * devicePixelRatio;
      this.drawC.style.width = '100%';
    }
    if (this.neuralCM) this.resizeCanvas(this.neuralCM);
    if (this.fitCM) this.resizeCanvas(this.fitCM);
    if (this.telemCM) this.resizeCanvas(this.telemCM);
    if (this.attnCM) this.resizeCanvas(this.attnCM);
    this.renderSensorPreview();
  }

  resizeCanvas(c) {
    if (!c || !c.parentElement) return;
    const w = c.parentElement.clientWidth || 300;
    const computed = getComputedStyle(c);
    const arStr = computed.aspectRatio;
    let ar = 1.7;
    if (arStr && arStr !== 'auto') {
      const parts = arStr.split('/');
      ar = parseFloat(parts[0]) / (parseFloat(parts[1]) || 1);
    }
    const h = Math.round(w / ar);
    c.width = w * devicePixelRatio;
    c.height = h * devicePixelRatio;
    c.style.width = w + 'px';
    c.style.height = h + 'px';
  }

  // ---- UI Setup ----
  setupUI() {
    // ---- Phase Navigation ----
    // Start screen → Racer Design
    document.getElementById('btnStartDesign').addEventListener('click', () => this.showScreen('racerDesign'));
    // Start screen → Saved Racers
    document.getElementById('btnViewSaved').addEventListener('click', () => {
      this.renderSavedRacers();
      this.showScreen('savedRacers');
    });
    // Racer Design → back to Start
    document.getElementById('btnBackToStart').addEventListener('click', () => this.showScreen('start'));
    // Racer Design → Course Design
    document.getElementById('btnToCourse').addEventListener('click', () => {
      this.applyDesignFromPhase();
      this.showScreen('courseDesign');
    });
    // Course Design → back to Racer Design
    document.getElementById('btnBackToDesign').addEventListener('click', () => this.showScreen('racerDesign'));
    // Saved Racers → back to Start
    document.getElementById('btnBackFromSaved').addEventListener('click', () => this.showScreen('start'));

    // Speed buttons
    document.querySelectorAll('.speed-btns button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.speed-btns button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.speedMult = parseInt(b.dataset.speed);
      });
    });

    // Reset - back to start screen
    document.getElementById('btnReset').addEventListener('click', () => {
      this.state = 'start';
      document.getElementById('gameUI').style.display = 'none';
      this.showScreen('start');
      this.gen = 0;
      this.bestFitHistory = [];
      this.avgFitHistory = [];
      this.allTimeBest = 0;
      this.bestBrain = null;
      this.watchMode = false;
      this.watchBrain = null;
      this.selectedPreset = null;
      telemReset();
      document.querySelectorAll('.track-card').forEach(c => c.classList.remove('selected'));
      document.getElementById('btnStart').disabled = true;
    });

    // Start training button
    document.getElementById('btnStart').addEventListener('click', () => this.startSim());

    // Custom draw button
    document.getElementById('btnCustom').addEventListener('click', () => this.enterDrawMode());
    document.getElementById('btnDrawBack').addEventListener('click', () => this.exitDrawMode());
    document.getElementById('btnDrawUndo').addEventListener('click', () => {
      this.drawPoints.pop();
      this.renderDrawMode();
    });
    document.getElementById('btnDrawDone').addEventListener('click', () => this.finishDraw());

    // Draw canvas
    this.drawC.addEventListener('click', (e) => this.handleDrawClick(e));
    this.drawC.addEventListener('mousemove', (e) => { this._drawMouse = this.getCanvasPos(this.drawC, e); this.renderDrawMode(); });
    this.drawC.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.handleDrawClick(e.changedTouches[0]);
    });

    // Main canvas click/touch
    this.mainC.addEventListener('click', (e) => this.handleMainClick(e));
    this.mainC.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.handleMainClick(e.changedTouches[0]);
    });

    // Save racer button
    document.getElementById('btnSaveRacer').addEventListener('click', () => this.saveCurrentRacer());

    // Toggle racer info overlay
    const btnToggle = document.getElementById('btnToggleInfo');
    btnToggle.addEventListener('click', () => {
      this.showRacerInfo = !this.showRacerInfo;
      btnToggle.style.borderColor = this.showRacerInfo ? '#4488ff' : '';
      btnToggle.style.color = this.showRacerInfo ? '#fff' : '';
      btnToggle.style.background = this.showRacerInfo ? '#4488ff' : '';
    });

    // ---- Design phase sliders (racer design screen) ----
    // Evolution parameter sliders
    this.bindSlider('ctrlPop', 'valPop', v => { CFG.POP = v; return v; });
    this.bindSlider('ctrlMutRate', 'valMutRate', v => { CFG.MUT_RATE = v / 100; return v + '%'; });
    this.bindSlider('ctrlMutStr', 'valMutStr', v => { CFG.MUT_STR = v / 100; return (v / 100).toFixed(2); });
    this.bindSlider('ctrlElite', 'valElite', v => { CFG.ELITE = v; return v; });
    this.bindSlider('ctrlTime', 'valTime', v => { CFG.GEN_TIME = v; return v + 's'; });
    this.bindSlider('ctrlWidth', 'valWidth', v => { CFG.TRACK_W = v; return v; });

    // Reward weight sliders (design phase)
    this.bindSlider('rwdSpeed', 'valRwdSpeed', v => { REWARD_CFG.weights.speed = v / 100; this.syncLiveSliders(); return (v / 100).toFixed(2); });
    this.bindSlider('rwdSafety', 'valRwdSafety', v => { REWARD_CFG.weights.safety = v / 100; this.syncLiveSliders(); return (v / 100).toFixed(2); });
    this.bindSlider('rwdEfficiency', 'valRwdEfficiency', v => { REWARD_CFG.weights.efficiency = v / 100; this.syncLiveSliders(); return (v / 100).toFixed(2); });
    this.bindSlider('rwdSmoothness', 'valRwdSmoothness', v => { REWARD_CFG.weights.smoothness = v / 100; this.syncLiveSliders(); return (v / 100).toFixed(2); });

    // Body design sliders
    this.bindSlider('bodySteer', 'valBodySteer', v => { CFG.TURN = v / 1000; return (v / 1000).toFixed(3); });
    this.bindSlider('bodyFriction', 'valBodyFriction', v => { CFG.DRAG = v / 1000; return (v / 1000).toFixed(3); });
    this.bindSlider('bodyMaxSpd', 'valBodyMaxSpd', v => { CFG.MAX_SPEED = v / 10; return (v / 10).toFixed(1); });
    this.bindSlider('bodyAccel', 'valBodyAccel', v => { CFG.ACCEL = v / 100; return (v / 100).toFixed(2); });
    this.bindSlider('bodyBrake', 'valBodyBrake', v => { CFG.BRAKE = v / 100; return (v / 100).toFixed(2); });
    this.bindSlider('bodyCog', 'valBodyCog', v => { CFG.COG_OFFSET = v / 100; return (v / 100).toFixed(2); });
    this.bindSlider('bodyLatency', 'valBodyLatency', v => { CFG.LATENCY = v; return v; });

    // Sensor & hidden
    this.bindSlider('bodySensors', 'valBodySensors', v => { this._pendingSensors = v; this.renderSensorPreview(); return v; });
    this.bindSlider('bodyRange', 'valBodyRange', v => { this._pendingRange = v; return v; });
    this.bindSlider('bodyHidden', 'valBodyHidden', v => { this._pendingHidden = v; return v; });

    this._pendingSensors = CFG.SENSORS;
    this._pendingRange = CFG.SENSOR_RANGE;
    this._pendingHidden = CFG.HIDDEN;

    // ---- Live panel sliders (during simulation) ----
    this.bindSlider('rwdSpeedLive', 'valRwdSpeedLive', v => { REWARD_CFG.weights.speed = v / 100; return (v / 100).toFixed(2); });
    this.bindSlider('rwdSafetyLive', 'valRwdSafetyLive', v => { REWARD_CFG.weights.safety = v / 100; return (v / 100).toFixed(2); });
    this.bindSlider('rwdEfficiencyLive', 'valRwdEfficiencyLive', v => { REWARD_CFG.weights.efficiency = v / 100; return (v / 100).toFixed(2); });
    this.bindSlider('rwdSmoothnessLive', 'valRwdSmoothnessLive', v => { REWARD_CFG.weights.smoothness = v / 100; return (v / 100).toFixed(2); });

    this.bindSlider('ctrlPopLive', 'valPopLive', v => { CFG.POP = v; return v; });
    this.bindSlider('ctrlMutRateLive', 'valMutRateLive', v => { CFG.MUT_RATE = v / 100; return v + '%'; });
    this.bindSlider('ctrlMutStrLive', 'valMutStrLive', v => { CFG.MUT_STR = v / 100; return (v / 100).toFixed(2); });
    this.bindSlider('ctrlEliteLive', 'valEliteLive', v => { CFG.ELITE = v; return v; });
    this.bindSlider('ctrlTimeLive', 'valTimeLive', v => { CFG.GEN_TIME = v; return v + 's'; });

    // Rule add buttons (design phase)
    const addRuleBtn = document.getElementById('btnAddRule');
    if (addRuleBtn) addRuleBtn.addEventListener('click', () => { addRewardRule(); syncRuleLists(); });
    // Rule add button (live)
    const addRuleBtnLive = document.getElementById('btnAddRuleLive');
    if (addRuleBtnLive) addRuleBtnLive.addEventListener('click', () => { addRewardRule(); syncRuleLists(); });
    const addRuleBtnM = document.getElementById('btnAddRuleM');
    if (addRuleBtnM) addRuleBtnM.addEventListener('click', () => { addRewardRule(); syncRuleLists(); });

    // Mobile tabs - with canvas resize fix
    document.querySelectorAll('.mob-tabs button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.mob-tabs button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.querySelectorAll('.mob-content .panel-section').forEach(p => p.classList.remove('active'));
        const panel = document.querySelector(`.mob-content [data-panel="${b.dataset.tab}"]`);
        if (panel) panel.classList.add('active');
        // Re-resize canvases when switching tabs (root fix for display issue)
        requestAnimationFrame(() => this.resizeAll());
      });
    });

    // Initial rule list render
    syncRuleLists();
  }

  // Sync live panel sliders with design phase values
  syncLiveSliders() {
    const syncSlider = (id, valId, value, display) => {
      const s = document.getElementById(id);
      const v = document.getElementById(valId);
      if (s) s.value = value;
      if (v) v.textContent = display;
    };
    syncSlider('rwdSpeedLive', 'valRwdSpeedLive', Math.round(REWARD_CFG.weights.speed * 100), REWARD_CFG.weights.speed.toFixed(2));
    syncSlider('rwdSafetyLive', 'valRwdSafetyLive', Math.round(REWARD_CFG.weights.safety * 100), REWARD_CFG.weights.safety.toFixed(2));
    syncSlider('rwdEfficiencyLive', 'valRwdEfficiencyLive', Math.round(REWARD_CFG.weights.efficiency * 100), REWARD_CFG.weights.efficiency.toFixed(2));
    syncSlider('rwdSmoothnessLive', 'valRwdSmoothnessLive', Math.round(REWARD_CFG.weights.smoothness * 100), REWARD_CFG.weights.smoothness.toFixed(2));
    syncSlider('ctrlPopLive', 'valPopLive', CFG.POP, CFG.POP);
    syncSlider('ctrlMutRateLive', 'valMutRateLive', Math.round(CFG.MUT_RATE * 100), Math.round(CFG.MUT_RATE * 100) + '%');
    syncSlider('ctrlMutStrLive', 'valMutStrLive', Math.round(CFG.MUT_STR * 100), CFG.MUT_STR.toFixed(2));
    syncSlider('ctrlEliteLive', 'valEliteLive', CFG.ELITE, CFG.ELITE);
    syncSlider('ctrlTimeLive', 'valTimeLive', CFG.GEN_TIME, CFG.GEN_TIME + 's');
  }

  // Apply design settings from the design phase
  applyDesignFromPhase() {
    CFG.SENSORS = this._pendingSensors;
    CFG.SENSOR_RANGE = this._pendingRange;
    CFG.SENSOR_ANGLES = generateSensorAngles(CFG.SENSORS);
    CFG.HIDDEN = this._pendingHidden;
    this.syncLiveSliders();
  }

  // Screen management
  showScreen(screen) {
    const screens = ['startScreen', 'racerDesignScreen', 'courseDesignScreen', 'savedRacersScreen'];
    screens.forEach(s => {
      const el = document.getElementById(s);
      if (el) el.style.display = 'none';
    });
    document.getElementById('gameUI').style.display = 'none';

    switch (screen) {
      case 'start':
        this.state = 'start';
        document.getElementById('startScreen').style.display = 'flex';
        break;
      case 'racerDesign':
        this.state = 'design';
        document.getElementById('racerDesignScreen').style.display = 'flex';
        this.renderSensorPreview();
        break;
      case 'courseDesign':
        this.state = 'courseDesign';
        document.getElementById('courseDesignScreen').style.display = 'flex';
        break;
      case 'savedRacers':
        this.state = 'savedRacers';
        document.getElementById('savedRacersScreen').style.display = 'flex';
        break;
      case 'sim':
        this.state = 'sim';
        document.getElementById('gameUI').style.display = 'flex';
        this.resizeAll();
        break;
    }
  }

  bindSlider(sliderId, valId, fn) {
    const s = document.getElementById(sliderId);
    const v = document.getElementById(valId);
    if (!s || !v) return;
    s.addEventListener('input', () => { v.textContent = fn(parseInt(s.value)); });
  }

  getCanvasPos(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * devicePixelRatio,
      y: (e.clientY - r.top) * devicePixelRatio,
    };
  }

  // ---- Sensor Preview ----
  renderSensorPreview() {
    const c = this.sensorPrev;
    if (!c || !c.parentElement) return;
    const w = c.parentElement.clientWidth || 160;
    c.width = w * devicePixelRatio;
    c.height = w * devicePixelRatio;
    c.style.width = w + 'px';
    c.style.height = w + 'px';
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const cx = c.width / 2, cy = c.height / 2;
    const r = c.width * 0.38;
    const count = this._pendingSensors || CFG.SENSORS;
    const angles = generateSensorAngles(count);

    ctx.clearRect(0, 0, c.width, c.height);

    // Range circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, PI2);
    ctx.strokeStyle = '#ffffff15';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Car body
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#00ff8844';
    ctx.beginPath();
    ctx.arc(0, 0, 8 * devicePixelRatio, 0, PI2);
    ctx.fill();

    // Sensor rays
    for (let i = 0; i < count; i++) {
      const a = (-90 + angles[i]) * DEG; // -90 to point up
      const ex = Math.cos(a) * r;
      const ey = Math.sin(a) * r;
      const hue = (i / count) * 120;
      ctx.strokeStyle = `hsla(${hue}, 80%, 60%, 0.6)`;
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // Endpoint dot
      ctx.beginPath();
      ctx.arc(ex, ey, 3 * devicePixelRatio, 0, PI2);
      ctx.fillStyle = `hsla(${hue}, 80%, 60%, 0.8)`;
      ctx.fill();
    }
    ctx.restore();

    // Label
    ctx.fillStyle = '#777';
    ctx.font = `${9 * devicePixelRatio}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${count}センサー × ${this._pendingRange || CFG.SENSOR_RANGE}px`, cx, c.height - 6 * devicePixelRatio);
  }

  // ---- Preset Cards ----
  setupPresets() {
    const grid = document.getElementById('trackGrid');
    PRESETS.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'track-card';
      card.innerHTML = `<canvas></canvas><div class="name">${p.name}</div><div class="diff">${p.diff}</div>`;
      card.addEventListener('click', () => {
        document.querySelectorAll('.track-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedPreset = i;
        document.getElementById('btnStart').disabled = false;
      });
      grid.appendChild(card);
      const mc = card.querySelector('canvas');
      setTimeout(() => this.drawPreview(mc, p, 400, 280), 50);
    });
  }

  drawPreview(canvas, preset, cx, cy) {
    if (!canvas || !canvas.parentElement) return;
    const w = canvas.parentElement.clientWidth || 120;
    const h = w / 1.4;
    canvas.width = w * 2; canvas.height = h * 2;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);
    const ctrl = preset.ctrl(cx, cy);
    const pts = smoothCenterline(ctrl, 6);
    let minX=1e9, minY=1e9, maxX=-1e9, maxY=-1e9;
    for (const p of pts) { minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); }
    const tw=maxX-minX+40, th=maxY-minY+40;
    const scale = Math.min(w/tw, h/th) * 0.85;
    const offX = (w - tw*scale)/2 - (minX-20)*scale;
    const offY = (h - th*scale)/2 - (minY-20)*scale;
    ctx.strokeStyle = '#00ff8866';
    ctx.lineWidth = Math.max(3, 8 * scale);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => {
      const sx = p.x * scale + offX;
      const sy = p.y * scale + offY;
      i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.stroke();
  }

  // ---- Draw Mode ----
  enterDrawMode() {
    this.state = 'draw';
    this.drawPoints = [];
    document.getElementById('courseDesignScreen').style.display = 'none';
    document.getElementById('drawOverlay').style.display = 'flex';
    this.resizeAll();
    this.renderDrawMode();
  }

  exitDrawMode() {
    this.state = 'courseDesign';
    document.getElementById('drawOverlay').style.display = 'none';
    document.getElementById('courseDesignScreen').style.display = 'flex';
  }

  handleDrawClick(e) {
    const pos = this.getCanvasPos(this.drawC, e);
    const pts = this.drawPoints;
    if (pts.length >= 8) {
      const d = dist(pos.x, pos.y, pts[0].x, pts[0].y);
      if (d < 40 * devicePixelRatio) {
        document.getElementById('btnDrawDone').disabled = false;
        this.renderDrawMode();
        return;
      }
    }
    pts.push(pos);
    document.getElementById('btnDrawDone').disabled = pts.length < 8;
    document.getElementById('drawInfo').textContent =
      pts.length < 8 ? `ポイント: ${pts.length}/8+ (あと${8 - pts.length}点以上)` : '✓ 始点の近くをクリックで閉じるか「完了」を押してください';
    this.renderDrawMode();
  }

  renderDrawMode() {
    const ctx = this.drawCtx;
    if (!ctx) return;
    const w = this.drawC.width, h = this.drawC.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = '#ffffff08';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40 * devicePixelRatio) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 40 * devicePixelRatio) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    const pts = this.drawPoints;
    if (pts.length < 2) {
      pts.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 * devicePixelRatio, 0, PI2);
        ctx.fillStyle = '#00ff88'; ctx.fill();
      });
      return;
    }

    const closed = pts.length >= 8;
    if (closed) {
      const smooth = smoothCenterline(pts, 6);
      const halfW = CFG.TRACK_W * devicePixelRatio / 2;
      const n = smooth.length;
      const innerPts = [], outerPts = [];
      for (let i = 0; i < n; i++) {
        const prev = smooth[(i - 1 + n) % n], next = smooth[(i + 1) % n];
        const dx = next.x - prev.x, dy = next.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        innerPts.push({ x: smooth[i].x + (-dy / len) * halfW, y: smooth[i].y + (dx / len) * halfW });
        outerPts.push({ x: smooth[i].x - (-dy / len) * halfW, y: smooth[i].y - (dx / len) * halfW });
      }

      ctx.fillStyle = '#1a1a3044';
      ctx.beginPath();
      innerPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath();
      for (let i = outerPts.length - 1; i >= 0; i--) {
        i === outerPts.length - 1 ? ctx.moveTo(outerPts[i].x, outerPts[i].y) : ctx.lineTo(outerPts[i].x, outerPts[i].y);
      }
      ctx.closePath();
      ctx.fill('evenodd');

      ctx.strokeStyle = '#00ff8844';
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      innerPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath(); ctx.stroke();
      ctx.beginPath();
      outerPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath(); ctx.stroke();
    }

    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.setLineDash([8 * devicePixelRatio, 4 * devicePixelRatio]);
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    if (closed) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 * devicePixelRatio, 0, PI2);
      ctx.fillStyle = i === 0 ? '#ffcc00' : '#00ff88';
      ctx.fill();
    });

    if (pts.length >= 8) {
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 20 * devicePixelRatio, 0, PI2);
      ctx.strokeStyle = '#ffcc0066'; ctx.lineWidth = 2 * devicePixelRatio;
      ctx.stroke();
    }
  }

  finishDraw() {
    if (this.drawPoints.length < 8) return;
    const scale = 1 / devicePixelRatio;
    const ctrl = this.drawPoints.map(p => ({ x: p.x * scale, y: p.y * scale }));
    this.customCtrl = ctrl;
    document.getElementById('drawOverlay').style.display = 'none';
    this.startSimFromCtrl(ctrl);
  }

  // ---- Simulation ----
  startSim() {
    let ctrl;
    if (this.selectedPreset != null) {
      const cx = 420, cy = 280;
      ctrl = PRESETS[this.selectedPreset].ctrl(cx, cy);
    } else {
      return;
    }
    this.startSimFromCtrl(ctrl);
  }

  startSimFromCtrl(ctrl) {
    const smooth = smoothCenterline(ctrl, 8);
    this.track = buildTrack(smooth, CFG.TRACK_W / 2, CFG.CP_COUNT);
    this.gen = 0;
    this.bestFitHistory = [];
    this.avgFitHistory = [];
    this.allTimeBest = 0;
    this.bestBrain = null;
    this.trackCache = null;
    this.watchMode = false;
    this.watchBrain = null;
    telemReset();

    // Hide all screens, show game UI
    ['startScreen', 'racerDesignScreen', 'courseDesignScreen', 'savedRacersScreen'].forEach(id => {
      document.getElementById(id).style.display = 'none';
    });
    this.syncLiveSliders();
    this.showScreen('sim');
    this.newGeneration();
  }

  newGeneration(brains) {
    this.gen++;
    this.genTimer = 0;
    this.cars = [];
    const t = this.track;

    if (this.watchMode && this.watchBrain) {
      // In watch mode, create a single car with the saved brain
      const brain = this.watchBrain.copy();
      this.cars.push(new Car(t.startX, t.startY, t.startAngle, brain));
    } else {
      for (let i = 0; i < CFG.POP; i++) {
        const brain = brains ? brains[i] : new NeuralNet(CFG.SENSORS + 1, CFG.HIDDEN, 2);
        this.cars.push(new Car(t.startX, t.startY, t.startAngle, brain));
      }
    }
    this.selectedCar = null;
    this.updateStats();
  }

  step() {
    if (this.state !== 'sim' || this.speedMult === 0) return;

    const dt = 1 / 60;
    for (let s = 0; s < this.speedMult; s++) {
      this.genTimer += dt;

      let anyAlive = false;
      for (const car of this.cars) {
        car.update(this.track.walls, this.track.checkpoints);
        if (car.alive) anyAlive = true;
      }

      let best = this.cars[0];
      for (const c of this.cars) if (c.fitness > best.fitness) best = c;
      this.bestCar = best;

      if (!this.selectedCar || !this.selectedCar.alive) this.selectedCar = this.bestCar;

      // Collect telemetry from selected car
      const tel = this.selectedCar || this.bestCar;
      if (tel && tel.alive) {
        const out = tel.brain.aOut;
        const accelVal = out[1] || 0;
        telemPush(
          Math.max(0, accelVal),
          Math.max(0, -accelVal),
          out[0] || 0,
          tel.speed / CFG.MAX_SPEED
        );
        telemetry.current.sensorValues = Array.from(tel.sensors);
        // Compute attention
        telemetry.sensorAttention = Array.from(tel.brain.getSensorAttention());
      }

      if (!anyAlive || this.genTimer >= CFG.GEN_TIME) {
        this.endGeneration();
        break;
      }
    }
  }

  endGeneration() {
    // In watch mode, just restart the single car
    if (this.watchMode) {
      let best = 0;
      for (const c of this.cars) {
        if (c.fitness > best) best = c.fitness;
      }
      this.bestFitHistory.push(best);
      this.avgFitHistory.push(best);
      this.tickerMsg = `👁 鑑賞モード — スコア: ${best.toFixed(1)}`;
      this.newGeneration();
      return;
    }

    let best = 0, sum = 0;
    for (const c of this.cars) {
      if (c.fitness > best) best = c.fitness;
      sum += c.fitness;
    }
    this.bestFitHistory.push(best);
    this.avgFitHistory.push(sum / this.cars.length);

    if (best > this.allTimeBest) {
      this.allTimeBest = best;
      const bestCar = this.cars.reduce((a, b) => a.fitness > b.fitness ? a : b);
      this.bestBrain = bestCar.brain.copy();
    }

    const cpStr = Math.floor(best);
    const bestCar = this.cars.reduce((a, b) => a.fitness > b.fitness ? a : b);
    if (this.gen <= 1) {
      this.tickerMsg = '🧬 第1世代 — ランダムな脳で走行開始！';
    } else if (best < 3) {
      this.tickerMsg = `🧬 世代${this.gen} — まだ学習中... 最高${cpStr}チェックポイント`;
    } else if (best < 10) {
      this.tickerMsg = `🚗 世代${this.gen} — コーナリングを学び始めた！ 最高${cpStr}CP`;
    } else if (best < 30) {
      this.tickerMsg = `🔥 世代${this.gen} — かなり上達！ 最高${cpStr}CP通過`;
    } else {
      this.tickerMsg = `🏆 世代${this.gen} — ${bestCar.laps > 0 ? 'ラップ完走！' : `${cpStr}CP通過`} 素晴らしい学習成果！`;
    }

    const brains = evolve(this.cars, CFG.ELITE);
    if (this.bestBrain) brains[0] = this.bestBrain.copy();
    this.newGeneration(brains);
  }

  updateStats() {
    document.getElementById('statGen').textContent = this.gen;
    const alive = this.cars.filter(c => c.alive).length;
    document.getElementById('statAlive').textContent = alive;
    document.getElementById('statTotal').textContent = CFG.POP;
    if (this.bestFitHistory.length > 0) {
      document.getElementById('statBest').textContent = Math.floor(this.bestFitHistory[this.bestFitHistory.length - 1]);
      document.getElementById('statAvg').textContent = Math.floor(this.avgFitHistory[this.avgFitHistory.length - 1]);
    }
    document.getElementById('statTime').textContent = this.genTimer.toFixed(1);
    document.getElementById('progressBar').style.width = (this.genTimer / CFG.GEN_TIME * 100) + '%';
    document.getElementById('ticker').textContent = this.tickerMsg;
  }

  handleMainClick(e) {
    if (this.state !== 'sim') return;
    const pos = this.getCanvasPos(this.mainC, e);
    const view = this.getView();
    const tx = (pos.x - view.ox) / view.scale;
    const ty = (pos.y - view.oy) / view.scale;

    let minD = 30, found = null;
    for (const c of this.cars) {
      if (!c.alive) continue;
      const d = dist(tx, ty, c.x, c.y);
      if (d < minD) { minD = d; found = c; }
    }
    if (found) this.selectedCar = found;
  }

  getView() {
    if (!this.track) return { scale: 1, ox: 0, oy: 0 };
    const cw = this.mainC.width, ch = this.mainC.height;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const p of this.track.inner) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    for (const p of this.track.outer) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    const tw = maxX - minX + 80, th = maxY - minY + 80;
    const scale = Math.min(cw / tw, ch / th);
    const ox = (cw - tw * scale) / 2 - (minX - 40) * scale;
    const oy = (ch - th * scale) / 2 - (minY - 40) * scale;
    return { scale, ox, oy };
  }

  // ============================================================
  //  Rendering
  // ============================================================
  render() {
    if (this.state !== 'sim') return;
    this.frameCount++;
    this.renderTrack();
    if (this.frameCount % 3 === 0) this.renderNeural();
    if (this.frameCount % 5 === 0) this.renderFitness();
    if (this.frameCount % 2 === 0) this.renderTelemetry();
    if (this.frameCount % 4 === 0) this.renderAttention();
    this.updateStats();
  }

  renderTrack() {
    const ctx = this.mainCtx;
    if (!ctx) return;
    const cw = this.mainC.width, ch = this.mainC.height;
    if (cw === 0 || ch === 0) return;
    ctx.clearRect(0, 0, cw, ch);

    if (!this.track) return;
    const v = this.getView();

    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.scale, v.scale);

    if (!this.trackCache) {
      this.trackCache = document.createElement('canvas');
      this.trackCache.width = cw;
      this.trackCache.height = ch;
      const tc = this.trackCache.getContext('2d');
      tc.translate(v.ox, v.oy);
      tc.scale(v.scale, v.scale);

      const t = this.track;
      tc.fillStyle = '#181830';
      tc.beginPath();
      t.outer.forEach((p, i) => i === 0 ? tc.moveTo(p.x, p.y) : tc.lineTo(p.x, p.y));
      tc.closePath();
      tc.fill();
      tc.fillStyle = '#0a0a1a';
      tc.beginPath();
      t.inner.forEach((p, i) => i === 0 ? tc.moveTo(p.x, p.y) : tc.lineTo(p.x, p.y));
      tc.closePath();
      tc.fill();

      tc.strokeStyle = '#444470';
      tc.lineWidth = 2 / v.scale;
      tc.lineJoin = 'round';
      tc.beginPath();
      t.inner.forEach((p, i) => i === 0 ? tc.moveTo(p.x, p.y) : tc.lineTo(p.x, p.y));
      tc.closePath(); tc.stroke();
      tc.beginPath();
      t.outer.forEach((p, i) => i === 0 ? tc.moveTo(p.x, p.y) : tc.lineTo(p.x, p.y));
      tc.closePath(); tc.stroke();

      tc.strokeStyle = '#ffffff10';
      tc.lineWidth = 1 / v.scale;
      for (const cp of t.checkpoints) {
        tc.beginPath(); tc.moveTo(cp.x1, cp.y1); tc.lineTo(cp.x2, cp.y2); tc.stroke();
      }

      const cp0 = t.checkpoints[0];
      tc.strokeStyle = '#00ff8866';
      tc.lineWidth = 3 / v.scale;
      tc.beginPath(); tc.moveTo(cp0.x1, cp0.y1); tc.lineTo(cp0.x2, cp0.y2); tc.stroke();
    }
    ctx.restore();
    ctx.drawImage(this.trackCache, 0, 0);

    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.scale, v.scale);
    this.renderCars(ctx, v.scale);
    ctx.restore();
  }

  renderCars(ctx, scale) {
    const sorted = [...this.cars].sort((a, b) => {
      if (a === this.selectedCar) return 1;
      if (b === this.selectedCar) return -1;
      if (a.alive && !b.alive) return 1;
      if (!a.alive && b.alive) return -1;
      return a.fitness - b.fitness;
    });

    for (const car of sorted) {
      if (!car.alive && car.age < this.genTimer * 60 - 30) continue;

      const isSelected = car === this.selectedCar;
      const isBest = car === this.bestCar;

      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      if (!car.alive) {
        ctx.strokeStyle = '#ff444488';
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(3, 3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(3, -3); ctx.stroke();
        ctx.restore();
        continue;
      }

      const maxFit = this.bestCar ? this.bestCar.fitness : 1;
      const fitRatio = maxFit > 0 ? car.fitness / maxFit : 0;
      let color;
      if (isBest) color = '#ffcc00';
      else if (fitRatio > 0.7) color = '#00ff88';
      else if (fitRatio > 0.3) color = '#4488ff';
      else color = '#ff6644';

      if (isSelected || isBest) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12 / scale;
      }

      const L = 9, W = 5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(L, 0);
      ctx.lineTo(-L * 0.6, -W);
      ctx.lineTo(-L * 0.6, W);
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.restore();

      // Sensor rays for selected car (with attention coloring)
      if (isSelected && car.alive) {
        const attn = telemetry.sensorAttention;
        for (let s = 0; s < CFG.SENSORS; s++) {
          const a = car.angle + CFG.SENSOR_ANGLES[s] * DEG;
          const d = car.sensors[s] * CFG.SENSOR_RANGE;
          const ex = car.x + Math.cos(a) * d;
          const ey = car.y + Math.sin(a) * d;
          const danger = 1 - car.sensors[s];
          const attnVal = (attn && attn[s]) ? attn[s] : 0;
          // Blend danger color with attention brightness
          const alpha = 0.3 + attnVal * 0.5;
          ctx.strokeStyle = danger > 0.7 ? `rgba(255,68,68,${alpha})` :
                            danger > 0.4 ? `rgba(255,200,0,${alpha})` :
                            `rgba(0,255,136,${alpha})`;
          ctx.lineWidth = (1.5 + attnVal * 2) / scale;
          ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.beginPath(); ctx.arc(ex, ey, 2 / scale, 0, PI2);
          ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        }
      }

      // Racer info overlay (show/hide toggle)
      if (this.showRacerInfo && car.alive) {
        const fontSize = Math.max(8, 11 / scale);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        const labelY = car.y - 12 / scale;
        const score = car.fitness.toFixed(1);
        const cp = car.cpPassed;

        // Background
        const text = `${score} (CP:${cp})`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(car.x - tw / 2 - 2 / scale, labelY - fontSize - 1 / scale, tw + 4 / scale, fontSize + 2 / scale);

        // Text color based on fitness
        const maxFit = this.bestCar ? this.bestCar.fitness : 1;
        const fitRatio = maxFit > 0 ? car.fitness / maxFit : 0;
        if (isBest) ctx.fillStyle = '#ffcc00';
        else if (fitRatio > 0.7) ctx.fillStyle = '#00ff88';
        else if (fitRatio > 0.3) ctx.fillStyle = '#4488ff';
        else ctx.fillStyle = '#ff8866';

        ctx.fillText(text, car.x, labelY);
      }
    }
  }

  // ---- Neural Network Visualization ----
  renderNeural() {
    const targets = [{ canvas: this.neuralC, ctx: this.neuralCtx }];
    if (this.neuralCM && this.neuralCM.getContext) {
      targets.push({ canvas: this.neuralCM, ctx: this.neuralCM.getContext('2d') });
    }

    const car = this.selectedCar || this.bestCar;

    for (const { canvas, ctx } of targets) {
      if (!canvas || !ctx) continue;
      const w = canvas.width, h = canvas.height;
      if (w === 0 || h === 0) continue;
      ctx.clearRect(0, 0, w, h);

      if (!car || !car.brain) {
        ctx.fillStyle = '#555';
        ctx.font = `${12 * devicePixelRatio}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('車両を選択してください', w / 2, h / 2);
        continue;
      }

      const brain = car.brain;
      const pad = 30 * devicePixelRatio;
      const layerX = [pad, w / 2, w - pad];
      const layers = [brain.inN, brain.hidN, brain.outN];
      const activations = [brain.aIn, brain.aHid, brain.aOut];

      // Dynamic sensor labels
      const sensorLabels = [];
      for (let i = 0; i < CFG.SENSORS; i++) {
        const angle = CFG.SENSOR_ANGLES[i];
        if (angle === 0) sensorLabels.push('前方');
        else if (angle < 0) sensorLabels.push(`L${Math.abs(angle)}°`);
        else sensorLabels.push(`R${angle}°`);
      }
      sensorLabels.push('速度');
      const labels = [sensorLabels, [], ['操舵', '加速']];

      const nodePos = [];
      for (let l = 0; l < 3; l++) {
        const nodes = [];
        const n = layers[l];
        const totalH = h - pad * 2;
        const spacing = totalH / (n + 1);
        for (let i = 0; i < n; i++) {
          nodes.push({ x: layerX[l], y: pad + spacing * (i + 1) });
        }
        nodePos.push(nodes);
      }

      // Draw connections: Input → Hidden
      for (let i = 0; i < brain.inN; i++) {
        for (let h2 = 0; h2 < brain.hidN; h2++) {
          const weight = brain.wIH[i * brain.hidN + h2];
          const act = activations[0][i] * weight;
          this.drawConnection(ctx, nodePos[0][i], nodePos[1][h2], weight, act);
        }
      }
      // Hidden → Output
      for (let h2 = 0; h2 < brain.hidN; h2++) {
        for (let o = 0; o < brain.outN; o++) {
          const weight = brain.wHO[h2 * brain.outN + o];
          const act = activations[1][h2] * weight;
          this.drawConnection(ctx, nodePos[1][h2], nodePos[2][o], weight, act);
        }
      }

      // Draw nodes
      for (let l = 0; l < 3; l++) {
        for (let i = 0; i < layers[l]; i++) {
          const pos = nodePos[l][i];
          const val = activations[l][i];
          this.drawNode(ctx, pos.x, pos.y, val, labels[l][i]);
        }
      }

      ctx.fillStyle = '#555';
      ctx.font = `${9 * devicePixelRatio}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('入力', layerX[0], pad - 10 * devicePixelRatio);
      ctx.fillText('隠れ層', layerX[1], pad - 10 * devicePixelRatio);
      ctx.fillText('出力', layerX[2], pad - 10 * devicePixelRatio);
    }
  }

  drawConnection(ctx, from, to, weight, activation) {
    const absW = Math.abs(weight);
    const absA = Math.min(Math.abs(activation), 1);
    ctx.strokeStyle = weight > 0
      ? `rgba(0,200,255,${0.05 + absA * 0.4})`
      : `rgba(255,80,80,${0.05 + absA * 0.4})`;
    ctx.lineWidth = (0.5 + absW * 2) * devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  drawNode(ctx, x, y, val, label) {
    const r = 8 * devicePixelRatio;
    const absVal = Math.min(Math.abs(val), 1);

    if (absVal > 0.3) {
      ctx.beginPath(); ctx.arc(x, y, r + 4 * devicePixelRatio, 0, PI2);
      const glowColor = val > 0 ? `rgba(0,255,136,${absVal * 0.3})` : `rgba(255,68,85,${absVal * 0.3})`;
      ctx.fillStyle = glowColor;
      ctx.fill();
    }

    ctx.beginPath(); ctx.arc(x, y, r, 0, PI2);
    const brightness = 40 + absVal * 180;
    if (val >= 0) {
      ctx.fillStyle = `rgb(${40 - absVal * 30},${brightness},${80 + absVal * 50})`;
    } else {
      ctx.fillStyle = `rgb(${brightness},${40 - absVal * 20},${50 + absVal * 30})`;
    }
    ctx.fill();
    ctx.strokeStyle = '#ffffff33';
    ctx.lineWidth = 1 * devicePixelRatio;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${7 * devicePixelRatio}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(val.toFixed(1), x, y);

    if (label) {
      ctx.fillStyle = '#aaa';
      ctx.font = `${8 * devicePixelRatio}px sans-serif`;
      ctx.fillText(label, x, y + r + 10 * devicePixelRatio);
    }
  }

  // ---- Telemetry Graph ----
  renderTelemetry() {
    const targets = [{ canvas: this.telemC, ctx: this.telemCtx }];
    if (this.telemCM && this.telemCM.getContext) {
      targets.push({ canvas: this.telemCM, ctx: this.telemCM.getContext('2d') });
    }

    for (const { canvas, ctx } of targets) {
      if (!canvas || !ctx) continue;
      const w = canvas.width, h = canvas.height;
      if (w === 0 || h === 0) continue;
      ctx.clearRect(0, 0, w, h);

      const pad = 25 * devicePixelRatio;
      const gw = w - pad * 2, gh = h - pad * 2;

      if (telemetry.count < 2) {
        ctx.fillStyle = '#555';
        ctx.font = `${11 * devicePixelRatio}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('テレメトリデータ収集中...', w / 2, h / 2);
        continue;
      }

      // Grid
      ctx.strokeStyle = '#ffffff08';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad + gh * (1 - i / 4);
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + gw, y); ctx.stroke();
      }
      // Zero line
      const zeroY = pad + gh * 0.5;
      ctx.strokeStyle = '#ffffff15';
      ctx.beginPath(); ctx.moveTo(pad, zeroY); ctx.lineTo(pad + gw, zeroY); ctx.stroke();

      const datasets = [
        { data: telemGet(telemetry.throttle), color: '#00ff88', label: 'スロットル' },
        { data: telemGet(telemetry.brake), color: '#ff4455', label: 'ブレーキ' },
        { data: telemGet(telemetry.steering), color: '#4488ff', label: 'ステアリング' },
        { data: telemGet(telemetry.speed), color: '#ffcc00', label: '速度' },
      ];

      // Draw each dataset
      for (const ds of datasets) {
        if (ds.data.length < 2) continue;
        ctx.strokeStyle = ds.color;
        ctx.lineWidth = 1.5 * devicePixelRatio;
        ctx.beginPath();
        for (let i = 0; i < ds.data.length; i++) {
          const x = pad + (i / (ds.data.length - 1)) * gw;
          // Map -1..1 to graph height
          const val = clamp(ds.data[i], -1, 1);
          const y = pad + gh * (1 - (val + 1) / 2);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Legend
      const ly = pad - 8 * devicePixelRatio;
      ctx.font = `${8 * devicePixelRatio}px sans-serif`;
      let lx = pad;
      for (const ds of datasets) {
        ctx.fillStyle = ds.color;
        ctx.fillRect(lx, ly, 8 * devicePixelRatio, 3 * devicePixelRatio);
        ctx.fillStyle = '#aaa'; ctx.textAlign = 'left';
        ctx.fillText(ds.label, lx + 10 * devicePixelRatio, ly + 4 * devicePixelRatio);
        lx += 60 * devicePixelRatio;
      }
    }
  }

  // ---- Attention Heatmap ----
  renderAttention() {
    const targets = [{ canvas: this.attnC, ctx: this.attnCtx }];
    if (this.attnCM && this.attnCM.getContext) {
      targets.push({ canvas: this.attnCM, ctx: this.attnCM.getContext('2d') });
    }

    for (const { canvas, ctx } of targets) {
      if (!canvas || !ctx) continue;
      const w = canvas.width, h = canvas.height;
      if (w === 0 || h === 0) continue;
      ctx.clearRect(0, 0, w, h);

      const attn = telemetry.sensorAttention;
      const sensorVals = telemetry.current.sensorValues;
      if (!attn || attn.length === 0) {
        ctx.fillStyle = '#555';
        ctx.font = `${11 * devicePixelRatio}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('アテンションデータなし', w / 2, h / 2);
        continue;
      }

      const pad = 20 * devicePixelRatio;
      const barW = Math.min(30 * devicePixelRatio, (w - pad * 2) / attn.length - 4 * devicePixelRatio);
      const maxH = h - pad * 3;
      const totalW = attn.length * (barW + 4 * devicePixelRatio);
      const startX = (w - totalW) / 2;

      // Title
      ctx.fillStyle = '#777';
      ctx.font = `${9 * devicePixelRatio}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('センサー注目度（重み）', w / 2, pad - 4 * devicePixelRatio);

      for (let i = 0; i < attn.length; i++) {
        const x = startX + i * (barW + 4 * devicePixelRatio);
        const barH = attn[i] * maxH;
        const y = h - pad - barH;

        // Background bar
        ctx.fillStyle = '#1a1a30';
        ctx.fillRect(x, h - pad - maxH, barW, maxH);

        // Attention bar (heatmap color)
        const hue = (1 - attn[i]) * 120; // red=high attention, green=low
        ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.8)`;
        ctx.fillRect(x, y, barW, barH);

        // Sensor value overlay (smaller bar inside)
        if (sensorVals && sensorVals[i] !== undefined) {
          const sH = sensorVals[i] * maxH * 0.3;
          ctx.fillStyle = '#ffffff30';
          ctx.fillRect(x + barW * 0.3, h - pad - sH, barW * 0.4, sH);
        }

        // Label
        const angle = CFG.SENSOR_ANGLES[i];
        let label;
        if (angle === 0) label = '前';
        else if (angle < 0) label = `L${Math.abs(angle)}`;
        else label = `R${angle}`;

        ctx.fillStyle = '#888';
        ctx.font = `${7 * devicePixelRatio}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(label, x + barW / 2, h - pad + 10 * devicePixelRatio);

        // Attention value on top
        ctx.fillStyle = '#ccc';
        ctx.fillText((attn[i] * 100).toFixed(0) + '%', x + barW / 2, y - 4 * devicePixelRatio);
      }
    }
  }

  // ---- Fitness Graph ----
  renderFitness() {
    const targets = [{ canvas: this.fitC, ctx: this.fitCtx }];
    if (this.fitCM && this.fitCM.getContext) {
      targets.push({ canvas: this.fitCM, ctx: this.fitCM.getContext('2d') });
    }

    for (const { canvas, ctx } of targets) {
      if (!canvas || !ctx) continue;
      const w = canvas.width, h = canvas.height;
      if (w === 0 || h === 0) continue;
      ctx.clearRect(0, 0, w, h);

      const pad = 35 * devicePixelRatio;
      const gw = w - pad * 2, gh = h - pad * 2;

      if (this.bestFitHistory.length < 2) {
        ctx.fillStyle = '#555';
        ctx.font = `${11 * devicePixelRatio}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('学習データを収集中...', w / 2, h / 2);
        continue;
      }

      const data = this.bestFitHistory;
      const avgData = this.avgFitHistory;
      const maxVal = Math.max(...data, 1);
      const numGens = data.length;

      ctx.strokeStyle = '#ffffff0a';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad + gh * (1 - i / 4);
        ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + gw, y); ctx.stroke();
        ctx.fillStyle = '#555';
        ctx.font = `${8 * devicePixelRatio}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * i / 4), pad - 4 * devicePixelRatio, y + 3 * devicePixelRatio);
      }

      ctx.fillStyle = 'rgba(68,136,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(pad, pad + gh);
      for (let i = 0; i < avgData.length; i++) {
        const x = pad + (i / (numGens - 1)) * gw;
        const y = pad + gh * (1 - avgData[i] / maxVal);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(pad + gw, pad + gh);
      ctx.closePath(); ctx.fill();

      ctx.fillStyle = 'rgba(0,255,136,0.08)';
      ctx.beginPath();
      ctx.moveTo(pad, pad + gh);
      for (let i = 0; i < data.length; i++) {
        const x = pad + (i / (numGens - 1)) * gw;
        const y = pad + gh * (1 - data[i] / maxVal);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(pad + gw, pad + gh);
      ctx.closePath(); ctx.fill();

      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 1.5 * devicePixelRatio;
      ctx.beginPath();
      for (let i = 0; i < avgData.length; i++) {
        const x = pad + (i / (numGens - 1)) * gw;
        const y = pad + gh * (1 - avgData[i] / maxVal);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = pad + (i / (numGens - 1)) * gw;
        const y = pad + gh * (1 - data[i] / maxVal);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      const ly = pad - 10 * devicePixelRatio;
      ctx.font = `${9 * devicePixelRatio}px sans-serif`;
      ctx.fillStyle = '#00ff88'; ctx.fillRect(pad, ly, 12 * devicePixelRatio, 3 * devicePixelRatio);
      ctx.fillStyle = '#aaa'; ctx.textAlign = 'left';
      ctx.fillText('最高', pad + 16 * devicePixelRatio, ly + 4 * devicePixelRatio);
      ctx.fillStyle = '#4488ff'; ctx.fillRect(pad + 50 * devicePixelRatio, ly, 12 * devicePixelRatio, 3 * devicePixelRatio);
      ctx.fillStyle = '#aaa';
      ctx.fillText('平均', pad + 66 * devicePixelRatio, ly + 4 * devicePixelRatio);

      ctx.fillStyle = '#555';
      ctx.textAlign = 'center';
      ctx.fillText(`世代 (${numGens})`, w / 2, h - 6 * devicePixelRatio);
    }
  }

  // ---- Save/Load Racers ----
  saveCurrentRacer() {
    if (!this.bestBrain) {
      this.tickerMsg = '⚠️ まだ保存できるレーサーがいません。学習を進めてください。';
      return;
    }
    const name = `レーサー_世代${this.gen}_${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
    const racerData = {
      name,
      gen: this.gen,
      fitness: this.allTimeBest,
      date: new Date().toISOString(),
      brain: {
        inN: this.bestBrain.inN,
        hidN: this.bestBrain.hidN,
        outN: this.bestBrain.outN,
        wIH: Array.from(this.bestBrain.wIH),
        bH: Array.from(this.bestBrain.bH),
        wHO: Array.from(this.bestBrain.wHO),
        bO: Array.from(this.bestBrain.bO),
      },
      config: {
        sensors: CFG.SENSORS,
        sensorRange: CFG.SENSOR_RANGE,
        hidden: CFG.HIDDEN,
        maxSpeed: CFG.MAX_SPEED,
        accel: CFG.ACCEL,
        brake: CFG.BRAKE,
        turn: CFG.TURN,
        drag: CFG.DRAG,
      },
      rewards: JSON.parse(JSON.stringify(REWARD_CFG)),
    };

    const saved = JSON.parse(localStorage.getItem('neurodriver_racers') || '[]');
    saved.push(racerData);
    localStorage.setItem('neurodriver_racers', JSON.stringify(saved));
    this.tickerMsg = `💾 「${name}」を保存しました！`;
  }

  loadSavedRacers() {
    try {
      return JSON.parse(localStorage.getItem('neurodriver_racers') || '[]');
    } catch {
      return [];
    }
  }

  deleteSavedRacer(index) {
    const saved = this.loadSavedRacers();
    saved.splice(index, 1);
    localStorage.setItem('neurodriver_racers', JSON.stringify(saved));
    this.renderSavedRacers();
  }

  renderSavedRacers() {
    const grid = document.getElementById('savedRacerGrid');
    if (!grid) return;
    const saved = this.loadSavedRacers();
    grid.innerHTML = '';

    if (saved.length === 0) {
      grid.innerHTML = '<div class="no-saved">保存されたレーサーはありません。<br>学習フェーズで「💾 保存」ボタンを押してレーサーを保存してください。</div>';
      return;
    }

    saved.forEach((racer, idx) => {
      const card = document.createElement('div');
      card.className = 'saved-racer-card';
      const date = new Date(racer.date).toLocaleDateString('ja-JP');
      card.innerHTML = `
        <div class="racer-name">🏎️ ${racer.name}</div>
        <div class="racer-info">
          世代: ${racer.gen} | 最高スコア: ${racer.fitness.toFixed(1)}<br>
          保存日: ${date}<br>
          センサー: ${racer.config.sensors} | 隠れ層: ${racer.config.hidden}
        </div>
        <div class="racer-actions">
          <button class="btn-watch">👁 鑑賞</button>
          <button class="btn-delete-racer">🗑 削除</button>
        </div>
      `;
      card.querySelector('.btn-watch').addEventListener('click', () => this.watchSavedRacer(idx));
      card.querySelector('.btn-delete-racer').addEventListener('click', () => this.deleteSavedRacer(idx));
      grid.appendChild(card);
    });
  }

  watchSavedRacer(index) {
    const saved = this.loadSavedRacers();
    if (index >= saved.length) return;
    const racer = saved[index];

    // Restore config
    CFG.SENSORS = racer.config.sensors;
    CFG.SENSOR_RANGE = racer.config.sensorRange;
    CFG.SENSOR_ANGLES = generateSensorAngles(CFG.SENSORS);
    CFG.HIDDEN = racer.config.hidden;
    CFG.MAX_SPEED = racer.config.maxSpeed;
    CFG.ACCEL = racer.config.accel;
    CFG.BRAKE = racer.config.brake;
    CFG.TURN = racer.config.turn;
    CFG.DRAG = racer.config.drag;

    // Restore rewards
    REWARD_CFG.weights = { ...racer.rewards.weights };
    REWARD_CFG.rules = JSON.parse(JSON.stringify(racer.rewards.rules || []));

    // Restore brain
    const b = racer.brain;
    const brain = new NeuralNet(b.inN, b.hidN, b.outN);
    brain.wIH.set(new Float32Array(b.wIH));
    brain.bH.set(new Float32Array(b.bH));
    brain.wHO.set(new Float32Array(b.wHO));
    brain.bO.set(new Float32Array(b.bO));

    this.watchMode = true;
    this.watchBrain = brain;

    // Use oval track for watching
    const cx = 420, cy = 280;
    const ctrl = PRESETS[0].ctrl(cx, cy);
    const smooth = smoothCenterline(ctrl, 8);
    this.track = buildTrack(smooth, CFG.TRACK_W / 2, CFG.CP_COUNT);
    this.gen = 0;
    this.bestFitHistory = [];
    this.avgFitHistory = [];
    this.allTimeBest = 0;
    this.bestBrain = brain.copy();
    this.trackCache = null;
    telemReset();

    this.syncLiveSliders();
    this.showScreen('sim');
    this.tickerMsg = `👁 「${racer.name}」を鑑賞中`;
    this.newGeneration();
  }

  // ---- Main Loop ----
  loop() {
    this.step();
    this.render();
    requestAnimationFrame(() => this.loop());
  }
}

// ============================================================
//  PWA Registration & Init
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
