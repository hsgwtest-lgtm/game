'use strict';
// ============================================================
//  NeuroDriver α — Complete Engine
//  AI Racing Evolution: NN + Genetic Algorithm
// ============================================================

// ============================================================
//  Configuration
// ============================================================
const CFG = {
  POP: 30,
  ELITE: 6,
  MUT_RATE: 0.15,
  MUT_STR: 0.30,
  GEN_TIME: 15,
  CAR_R: 5,
  MAX_SPEED: 4.5,
  ACCEL: 0.14,
  BRAKE: 0.06,
  TURN: 0.055,
  DRAG: 0.985,
  SENSORS: 5,
  SENSOR_RANGE: 160,
  HIDDEN: 8,
  TRACK_W: 60,
  CP_COUNT: 50,
};

const REWARD = {
  speed: 1.0,
  safety: 0.5,
  efficiency: 0.7,
  smoothness: 0.3,
};

// ============================================================
//  Math Utilities
// ============================================================
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

function generateSensorAngles(count) {
  if (count <= 1) return [0];
  const spread = 120;
  const angles = [];
  for (let i = 0; i < count; i++) {
    angles.push(-spread / 2 + (spread / (count - 1)) * i);
  }
  return angles;
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
    const m = (arr) => { for (let i = 0; i < arr.length; i++) if (Math.random() < rate) arr[i] += randGauss() * strength; };
    m(this.wIH); m(this.bH); m(this.wHO); m(this.bO);
  }

  toJSON() {
    return {
      inN: this.inN, hidN: this.hidN, outN: this.outN,
      wIH: Array.from(this.wIH), bH: Array.from(this.bH),
      wHO: Array.from(this.wHO), bO: Array.from(this.bO),
    };
  }

  static fromJSON(j) {
    const n = new NeuralNet(j.inN, j.hidN, j.outN);
    n.wIH = new Float32Array(j.wIH);
    n.bH = new Float32Array(j.bH);
    n.wHO = new Float32Array(j.wHO);
    n.bO = new Float32Array(j.bO);
    return n;
  }
}

// ============================================================
//  Track Building
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
  { name: '楕円', diff: '★☆☆', ctrl: (cx, cy) => presetTrack(cx, cy, 200, [], 20) },
  { name: 'S字', diff: '★★☆', ctrl: (cx, cy) => presetTrack(cx, cy, 180, [{ a: 70, f: 2, p: 0 }], 24) },
  { name: '複合', diff: '★★★', ctrl: (cx, cy) => presetTrack(cx, cy, 150, [{ a: 55, f: 3, p: 0.5 }, { a: 30, f: 5, p: 1.2 }], 28) },
];

// ============================================================
//  Car
// ============================================================
class Car {
  constructor(x, y, angle, brain, sensorAngles) {
    this.x = x; this.y = y; this.angle = angle;
    this.speed = 0; this.brain = brain;
    this.alive = true; this.fitness = 0;
    this.nextCP = 0; this.cpPassed = 0; this.laps = 0;
    this.prevX = x; this.prevY = y;
    this.sensors = new Float32Array(CFG.SENSORS);
    this.sensorAngles = sensorAngles;
    this.age = 0; this.maxFit = 0; this.stagnant = 0;
    this._prevSteer = 0; this._steerChange = 0;
  }

  castSensors(walls) {
    for (let s = 0; s < CFG.SENSORS; s++) {
      const a = this.angle + this.sensorAngles[s] * DEG;
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

    const inputs = new Float32Array(CFG.SENSORS + 1);
    for (let i = 0; i < CFG.SENSORS; i++) inputs[i] = this.sensors[i];
    inputs[CFG.SENSORS] = this.speed / CFG.MAX_SPEED;

    const out = this.brain.forward(inputs);
    const steer = out[0];
    const accel = out[1];
    this._steerChange = steer - this._prevSteer;
    this._prevSteer = steer;

    const speedFactor = Math.abs(this.speed) / CFG.MAX_SPEED + 0.15;
    this.angle += steer * CFG.TURN * Math.min(speedFactor, 1);

    if (accel > 0) this.speed += accel * CFG.ACCEL;
    else this.speed += accel * CFG.BRAKE;
    this.speed *= CFG.DRAG;
    this.speed = clamp(this.speed, -0.5, CFG.MAX_SPEED);

    this.prevX = this.x; this.prevY = this.y;
    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;

    for (const w of walls) {
      if (ptSegDist(this.x, this.y, w.x1, w.y1, w.x2, w.y2) < CFG.CAR_R) {
        this.alive = false; return;
      }
    }

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

    this.fitness = this.computeReward(checkpoints);

    if (this.fitness > this.maxFit + 0.01) {
      this.maxFit = this.fitness; this.stagnant = 0;
    } else {
      this.stagnant++;
      if (this.stagnant > 180) this.alive = false;
    }
  }

  computeReward(checkpoints) {
    const w = REWARD;
    const totalW = w.speed + w.safety + w.efficiency + w.smoothness;
    if (totalW <= 0) return 0;

    let effR = 0;
    if (checkpoints.length > 0) {
      const cp = checkpoints[this.nextCP];
      const d = dist(this.x, this.y, cp.cx, cp.cy);
      const prevIdx = (this.nextCP - 1 + checkpoints.length) % checkpoints.length;
      const prevCP = checkpoints[prevIdx];
      const totalD = dist(prevCP.cx, prevCP.cy, cp.cx, cp.cy) || 1;
      const progress = clamp(1 - d / totalD, 0, 1);
      effR = this.cpPassed + progress * 0.99;
    }

    const speedR = this.speed / CFG.MAX_SPEED;
    let minSensor = 1;
    for (let i = 0; i < this.sensors.length; i++) if (this.sensors[i] < minSensor) minSensor = this.sensors[i];
    const safeR = minSensor;
    const smoothR = 1 - Math.abs(this._steerChange || 0);

    let r = (w.efficiency * effR + w.speed * speedR + w.safety * safeR + w.smoothness * smoothR) / totalW;
    r *= (effR > 0 ? 1 : 0.1);
    return r;
  }
}

// ============================================================
//  Genetic Algorithm
// ============================================================
function evolve(cars) {
  cars.sort((a, b) => b.fitness - a.fitness);
  const elites = cars.slice(0, CFG.ELITE);
  const children = [];
  for (const e of elites) children.push(e.brain.copy());
  while (children.length < CFG.POP) {
    const parent = elites[Math.floor(Math.random() * elites.length)];
    const child = parent.brain.copy();
    child.mutate(CFG.MUT_RATE, CFG.MUT_STR);
    children.push(child);
  }
  return children;
}

// ============================================================
//  Saved Racers (localStorage)
// ============================================================
function getSavedRacers() {
  try { return JSON.parse(localStorage.getItem('nd_racers') || '[]'); }
  catch { return []; }
}

function saveRacer(racer) {
  const list = getSavedRacers();
  list.push(racer);
  localStorage.setItem('nd_racers', JSON.stringify(list));
}

function deleteRacer(idx) {
  const list = getSavedRacers();
  list.splice(idx, 1);
  localStorage.setItem('nd_racers', JSON.stringify(list));
}

// ============================================================
//  Game Class
// ============================================================
class Game {
  constructor() {
    this.phase = 'start'; // start, course, design, training, watch
    this.track = null;
    this.trackCtrl = null;
    this.cars = [];
    this.gen = 0;
    this.genTimer = 0;
    this.speedMult = 1;
    this.paused = false;
    this.bestFitHistory = [];
    this.avgFitHistory = [];
    this.allTimeBest = 0;
    this.allTimeBestGen = 0;
    this.bestCar = null;
    this.bestBrain = null;
    this.selectedPreset = 0;
    this.sensorAngles = generateSensorAngles(CFG.SENSORS);
    this.drawPoints = [];
    this.trackCache = null;

    // Watch mode
    this.watchMode = false;
    this.watchBrain = null;
    this.watchCar = null;

    // Canvas refs
    this.mainC = document.getElementById('mainCanvas');
    this.mainCtx = this.mainC.getContext('2d');

    this.setupUI();
    this.setupPresets();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loop();
  }

  // ---- Notifications ----
  notify(msg, type = 'success', duration = 2500) {
    const el = document.getElementById('notification');
    el.textContent = msg;
    el.className = 'notification ' + type + ' show';
    clearTimeout(this._notifyTimer);
    this._notifyTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ---- Screen Management ----
  showScreen(name) {
    this.phase = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const gameScreen = document.getElementById('gameScreen');
    gameScreen.classList.remove('active');

    if (name === 'start') document.getElementById('startScreen').classList.add('active');
    else if (name === 'course') document.getElementById('courseScreen').classList.add('active');
    else if (name === 'design') document.getElementById('designScreen').classList.add('active');
    else if (name === 'training') {
      gameScreen.classList.add('active');
      this.resize();
    }
    else if (name === 'watch') {
      document.getElementById('watchScreen').classList.add('active');
      this.renderSavedRacers();
    }
  }

  // ---- UI Setup ----
  setupUI() {
    // Navigation
    document.getElementById('btnNewRacer').addEventListener('click', () => this.showScreen('course'));
    document.getElementById('btnViewSaved').addEventListener('click', () => this.showScreen('watch'));
    document.getElementById('btnToCourseNext').addEventListener('click', () => {
      this.buildSelectedTrack();
      this.showScreen('design');
      this.renderRacerPreview();
      this.renderRewardRadar();
    });
    document.getElementById('btnBackToCourse').addEventListener('click', () => this.showScreen('course'));
    document.getElementById('btnStartTraining').addEventListener('click', () => this.startTraining());
    document.getElementById('btnBackToStart').addEventListener('click', () => {
      this.watchMode = false;
      this.showScreen('start');
    });
    document.getElementById('btnBackFromWatch').addEventListener('click', () => this.showScreen('start'));

    // Custom draw
    document.getElementById('btnDrawCustom').addEventListener('click', () => this.openDrawMode());
    document.getElementById('btnDrawUndo').addEventListener('click', () => this.drawUndo());
    document.getElementById('btnDrawCancel').addEventListener('click', () => this.closeDrawMode());
    document.getElementById('btnDrawDone').addEventListener('click', () => this.drawDone());

    // Draw canvas events
    const dc = document.getElementById('drawCanvas');
    dc.addEventListener('click', (e) => this.drawAddPoint(e));
    dc.addEventListener('touchend', (e) => { e.preventDefault(); this.drawAddPoint(e.changedTouches[0]); });

    // Speed controls
    document.querySelectorAll('.speed-controls button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.speed-controls button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.speedMult = parseInt(b.dataset.speed);
      });
    });

    // Pause
    document.getElementById('btnPause').addEventListener('click', () => {
      this.paused = !this.paused;
      document.getElementById('btnPause').textContent = this.paused ? '▶' : '⏸';
    });

    // Save best
    document.getElementById('btnSaveBest').addEventListener('click', () => this.saveBestRacer());

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.querySelector(`[data-page="${btn.dataset.tab}"]`).classList.add('active');
      });
    });

    // Track width slider
    const tw = document.getElementById('trackWidth');
    tw.addEventListener('input', () => {
      document.getElementById('trackWidthVal').textContent = tw.value;
      CFG.TRACK_W = parseInt(tw.value);
      this.refreshPresetThumbnails();
    });

    // Design sliders
    this.bindSlider('sensorCount', 'sensorCountVal', v => { CFG.SENSORS = parseInt(v); this.sensorAngles = generateSensorAngles(CFG.SENSORS); this.renderRacerPreview(); });
    this.bindSlider('sensorRange', 'sensorRangeVal', v => { CFG.SENSOR_RANGE = parseInt(v); this.renderRacerPreview(); });
    this.bindSlider('maxSpeed', 'maxSpeedVal', v => { CFG.MAX_SPEED = parseFloat(v); });
    this.bindSlider('accel', 'accelVal', v => { CFG.ACCEL = parseFloat(v); });
    this.bindSlider('turn', 'turnVal', v => { CFG.TURN = parseFloat(v); });
    this.bindSlider('hidden', 'hiddenVal', v => { CFG.HIDDEN = parseInt(v); });

    // Reward sliders
    this.bindSlider('rwSpeed', 'rwSpeedVal', v => { REWARD.speed = parseFloat(v); this.renderRewardRadar(); });
    this.bindSlider('rwSafety', 'rwSafetyVal', v => { REWARD.safety = parseFloat(v); this.renderRewardRadar(); });
    this.bindSlider('rwEfficiency', 'rwEfficiencyVal', v => { REWARD.efficiency = parseFloat(v); this.renderRewardRadar(); });
    this.bindSlider('rwSmoothness', 'rwSmoothnessVal', v => { REWARD.smoothness = parseFloat(v); this.renderRewardRadar(); });
  }

  bindSlider(inputId, valId, cb) {
    const el = document.getElementById(inputId);
    el.addEventListener('input', () => {
      document.getElementById(valId).textContent = el.value;
      cb(el.value);
    });
  }

  // ---- Presets ----
  setupPresets() {
    const grid = document.getElementById('trackGrid');
    PRESETS.forEach((p, i) => {
      const card = document.createElement('div');
      card.className = 'track-card' + (i === 0 ? ' selected' : '');
      card.innerHTML = `<canvas></canvas><div class="name">${p.name}</div><div class="diff">${p.diff}</div>`;
      card.addEventListener('click', () => {
        document.querySelectorAll('.track-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this.selectedPreset = i;
      });
      grid.appendChild(card);
    });
    this.refreshPresetThumbnails();
  }

  refreshPresetThumbnails() {
    const cards = document.querySelectorAll('.track-card');
    cards.forEach((card, i) => {
      if (i >= PRESETS.length) return;
      const c = card.querySelector('canvas');
      const ctx = c.getContext('2d');
      const w = 200, h = 140;
      c.width = w; c.height = h;
      const ctrl = PRESETS[i].ctrl(w / 2, h / 2);
      const scale = 0.38;
      const scaled = ctrl.map(p => ({ x: w / 2 + (p.x - w / 2) * scale, y: h / 2 + (p.y - h / 2) * scale }));
      const center = smoothCenterline(scaled, 6);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = Math.max(1, CFG.TRACK_W * scale * 0.15);
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      center.forEach((p, j) => j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      center.forEach((p, j) => j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.stroke();
    });
  }

  buildSelectedTrack() {
    const cx = 400, cy = 300;
    if (this.trackCtrl) {
      // Custom track
      const center = smoothCenterline(this.trackCtrl, 8);
      this.track = buildTrack(center, CFG.TRACK_W / 2, CFG.CP_COUNT);
    } else {
      const ctrl = PRESETS[this.selectedPreset].ctrl(cx, cy);
      const center = smoothCenterline(ctrl, 8);
      this.track = buildTrack(center, CFG.TRACK_W / 2, CFG.CP_COUNT);
    }
    this.trackCache = null;
  }

  // ---- Draw Mode ----
  openDrawMode() {
    this.drawPoints = [];
    const overlay = document.getElementById('drawOverlay');
    overlay.classList.add('active');
    const c = document.getElementById('drawCanvas');
    c.width = window.innerWidth * devicePixelRatio;
    c.height = (window.innerHeight - 52) * devicePixelRatio;
    c.style.width = '100%';
    this.redrawDrawCanvas();
    document.getElementById('btnDrawDone').disabled = true;
  }

  closeDrawMode() {
    document.getElementById('drawOverlay').classList.remove('active');
  }

  drawAddPoint(e) {
    const c = document.getElementById('drawCanvas');
    const rect = c.getBoundingClientRect();
    const x = (e.clientX - rect.left) * devicePixelRatio;
    const y = (e.clientY - rect.top) * devicePixelRatio;
    this.drawPoints.push({ x, y });
    document.getElementById('btnDrawDone').disabled = this.drawPoints.length < 4;
    this.redrawDrawCanvas();
  }

  drawUndo() {
    this.drawPoints.pop();
    document.getElementById('btnDrawDone').disabled = this.drawPoints.length < 4;
    this.redrawDrawCanvas();
  }

  drawDone() {
    if (this.drawPoints.length < 4) return;
    this.trackCtrl = this.drawPoints.map(p => ({ x: p.x / devicePixelRatio, y: p.y / devicePixelRatio }));
    this.closeDrawMode();
    this.notify('カスタムコースを設定しました');
  }

  redrawDrawCanvas() {
    const c = document.getElementById('drawCanvas');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < c.width; x += 40 * devicePixelRatio) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke(); }
    for (let y = 0; y < c.height; y += 40 * devicePixelRatio) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke(); }

    if (this.drawPoints.length > 1) {
      // Preview track
      if (this.drawPoints.length >= 4) {
        const center = smoothCenterline(this.drawPoints, 6);
        ctx.strokeStyle = 'rgba(0,255,136,0.15)';
        ctx.lineWidth = CFG.TRACK_W * devicePixelRatio * 0.5;
        ctx.beginPath();
        center.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.stroke();

        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 2 * devicePixelRatio;
        ctx.beginPath();
        center.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 2 * devicePixelRatio;
        ctx.beginPath();
        this.drawPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
      }
    }

    // Points
    this.drawPoints.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 * devicePixelRatio, 0, PI2);
      ctx.fillStyle = i === 0 ? '#00cfff' : '#00ff88';
      ctx.fill();
    });
  }

  // ---- Racer Preview ----
  renderRacerPreview() {
    const c = document.getElementById('racerPreviewCanvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const w = c.parentElement.clientWidth || 300;
    const h = Math.round(w / 1.5);
    c.width = w * devicePixelRatio; c.height = h * devicePixelRatio;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;

    // Draw sensor range circle
    const rangeR = Math.min(w, h) * 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, rangeR, 0, PI2);
    ctx.fillStyle = 'rgba(0,207,255,0.04)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,207,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw sensors
    const angles = this.sensorAngles;
    angles.forEach((a, i) => {
      const rad = -90 * DEG + a * DEG;
      const ex = cx + Math.cos(rad) * rangeR;
      const ey = cy + Math.sin(rad) * rangeR;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = `hsla(${160 + i * 20}, 100%, 70%, 0.6)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Sensor tip
      ctx.beginPath();
      ctx.arc(ex, ey, 3, 0, PI2);
      ctx.fillStyle = `hsla(${160 + i * 20}, 100%, 70%, 0.8)`;
      ctx.fill();
    });

    // Draw car body
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, PI2);
    ctx.fillStyle = '#00ff88';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Direction indicator
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx - 5, cy - 20);
    ctx.lineTo(cx + 5, cy - 20);
    ctx.closePath();
    ctx.fillStyle = '#00cfff';
    ctx.fill();

    // Labels
    ctx.fillStyle = '#6a6a90';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${CFG.SENSORS} sensors / range ${CFG.SENSOR_RANGE}`, cx, h - 12);
  }

  // ---- Reward Radar ----
  renderRewardRadar() {
    const c = document.getElementById('rewardRadar');
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 200, 200);
    const cx = 100, cy = 100, r = 70;
    const labels = ['速度', '安全', '効率', '滑らかさ'];
    const values = [REWARD.speed, REWARD.safety, REWARD.efficiency, REWARD.smoothness];
    const maxV = 2;
    const n = 4;

    // Grid
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * PI2 - Math.PI / 2;
        const rr = r * (ring / 4);
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Axes
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.stroke();
    }

    // Data polygon
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI2 - Math.PI / 2;
      const v = (values[i] / maxV) * r;
      const px = cx + Math.cos(a) * v;
      const py = cy + Math.sin(a) * v;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,255,136,0.15)';
    ctx.fill();
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#d0d0e8';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI2 - Math.PI / 2;
      const lx = cx + Math.cos(a) * (r + 18);
      const ly = cy + Math.sin(a) * (r + 18);
      ctx.fillText(labels[i], lx, ly + 4);
    }
  }

  // ---- Training ----
  startTraining() {
    this.applyDesignSettings();
    if (!this.track) this.buildSelectedTrack();
    this.gen = 0;
    this.genTimer = 0;
    this.bestFitHistory = [];
    this.avgFitHistory = [];
    this.allTimeBest = 0;
    this.allTimeBestGen = 0;
    this.bestCar = null;
    this.bestBrain = null;
    this.paused = false;
    this.watchMode = false;
    document.getElementById('btnPause').textContent = '⏸';
    this.spawnGeneration();
    this.showScreen('training');
  }

  applyDesignSettings() {
    CFG.SENSORS = parseInt(document.getElementById('sensorCount').value);
    CFG.SENSOR_RANGE = parseInt(document.getElementById('sensorRange').value);
    CFG.MAX_SPEED = parseFloat(document.getElementById('maxSpeed').value);
    CFG.ACCEL = parseFloat(document.getElementById('accel').value);
    CFG.TURN = parseFloat(document.getElementById('turn').value);
    CFG.HIDDEN = parseInt(document.getElementById('hidden').value);
    this.sensorAngles = generateSensorAngles(CFG.SENSORS);

    REWARD.speed = parseFloat(document.getElementById('rwSpeed').value);
    REWARD.safety = parseFloat(document.getElementById('rwSafety').value);
    REWARD.efficiency = parseFloat(document.getElementById('rwEfficiency').value);
    REWARD.smoothness = parseFloat(document.getElementById('rwSmoothness').value);
  }

  spawnGeneration(brains = null) {
    this.cars = [];
    const t = this.track;
    for (let i = 0; i < CFG.POP; i++) {
      const brain = brains ? brains[i] : new NeuralNet(CFG.SENSORS + 1, CFG.HIDDEN, 2);
      this.cars.push(new Car(t.startX, t.startY, t.startAngle, brain, this.sensorAngles));
    }
    this.genTimer = 0;
  }

  nextGeneration() {
    const brains = evolve(this.cars);
    const best = this.cars.reduce((a, b) => a.fitness > b.fitness ? a : b);
    this.bestFitHistory.push(best.fitness);
    const avg = this.cars.reduce((s, c) => s + c.fitness, 0) / this.cars.length;
    this.avgFitHistory.push(avg);

    if (best.fitness > this.allTimeBest) {
      this.allTimeBest = best.fitness;
      this.allTimeBestGen = this.gen;
      this.bestBrain = best.brain.copy();
      this.notify(`🏆 新記録! スコア: ${best.fitness.toFixed(2)} (世代 ${this.gen})`, 'record');
    }
    this.bestCar = best;
    this.gen++;
    this.spawnGeneration(brains);
  }

  // ---- Save / Watch ----
  saveBestRacer() {
    if (!this.bestBrain) { this.notify('まだベストが存在しません', 'success'); return; }
    const racer = {
      name: `Racer G${this.gen}`,
      gen: this.gen,
      score: this.allTimeBest,
      date: new Date().toISOString().slice(0, 10),
      brain: this.bestBrain.toJSON(),
      config: { ...CFG },
      reward: { ...REWARD },
      sensorAngles: [...this.sensorAngles],
      trackPreset: this.trackCtrl ? null : this.selectedPreset,
      trackCtrl: this.trackCtrl || null,
      trackWidth: CFG.TRACK_W,
      completionRate: ((this.allTimeBest / CFG.CP_COUNT) * 100).toFixed(1),
    };
    saveRacer(racer);
    this.notify(`💾 ${racer.name} を保存しました`);
  }

  renderSavedRacers() {
    const grid = document.getElementById('savedGrid');
    const racers = getSavedRacers();
    grid.innerHTML = '';
    if (racers.length === 0) {
      grid.innerHTML = '<div class="no-saved">保存済みレーサーはありません。<br>学習フェーズで「ベスト保存」してください。</div>';
      return;
    }
    racers.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'saved-card';
      card.innerHTML = `
        <div class="racer-name">${r.name}</div>
        <div class="racer-info">
          世代: ${r.gen}<br>
          スコア: ${r.score.toFixed(2)}<br>
          走破率: ${r.completionRate || '?'}%<br>
          日付: ${r.date}
        </div>
        <div class="racer-actions">
          <button class="btn-small" style="background:var(--green);color:#000" data-watch="${i}">▶ 観察</button>
          <button class="btn-small" style="background:var(--panel);color:var(--red);border:1px solid var(--border)" data-delete="${i}">削除</button>
        </div>
      `;
      grid.appendChild(card);
    });

    grid.querySelectorAll('[data-watch]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.watchRacer(parseInt(btn.dataset.watch));
      });
    });
    grid.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRacer(parseInt(btn.dataset.delete));
        this.renderSavedRacers();
        this.notify('レーサーを削除しました');
      });
    });
  }

  watchRacer(idx) {
    const racers = getSavedRacers();
    const r = racers[idx];
    if (!r) return;

    // Restore config
    Object.assign(CFG, r.config);
    Object.assign(REWARD, r.reward);
    this.sensorAngles = r.sensorAngles || generateSensorAngles(CFG.SENSORS);

    // Build track
    if (r.trackCtrl) {
      this.trackCtrl = r.trackCtrl;
    } else {
      this.trackCtrl = null;
      this.selectedPreset = r.trackPreset || 0;
    }
    CFG.TRACK_W = r.trackWidth || 60;
    this.buildSelectedTrack();

    // Setup watch mode
    this.watchMode = true;
    this.watchBrain = NeuralNet.fromJSON(r.brain);
    this.bestBrain = this.watchBrain;
    this.gen = r.gen;
    this.allTimeBest = r.score;
    this.bestFitHistory = [];
    this.avgFitHistory = [];
    this.paused = false;
    this.spawnWatchCar();
    this.showScreen('training');
    this.notify(`🏎️ ${r.name} を観察中`);
  }

  spawnWatchCar() {
    this.cars = [];
    const t = this.track;
    const car = new Car(t.startX, t.startY, t.startAngle, this.watchBrain.copy(), this.sensorAngles);
    this.cars.push(car);
    this.watchCar = car;
    this.genTimer = 0;
  }

  // ---- Resize ----
  resize() {
    const mc = this.mainC;
    const wrap = mc.parentElement;
    if (wrap && this.phase === 'training') {
      mc.width = wrap.clientWidth * devicePixelRatio;
      mc.height = wrap.clientHeight * devicePixelRatio;
      mc.style.width = wrap.clientWidth + 'px';
      mc.style.height = wrap.clientHeight + 'px';
      this.trackCache = null;
    }
    this.resizePanel();
  }

  resizePanel() {
    ['fitnessCanvas', 'brainCanvas', 'sensorCanvas'].forEach(id => {
      const c = document.getElementById(id);
      if (!c || !c.parentElement) return;
      const w = c.parentElement.clientWidth - 28;
      if (w <= 0) return;
      const ar = id === 'fitnessCanvas' ? 2 : 1.5;
      const h = Math.round(w / ar);
      c.width = w * devicePixelRatio;
      c.height = h * devicePixelRatio;
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    });
  }

  // ---- Main Loop ----
  loop() {
    if (this.phase === 'training' && !this.paused) {
      const steps = this.speedMult === 0 ? 20 : this.speedMult;
      for (let s = 0; s < steps; s++) {
        this.tick();
      }
    }
    if (this.phase === 'training') {
      this.render();
      this.renderSidePanel();
    }
    requestAnimationFrame(() => this.loop());
  }

  tick() {
    if (!this.track) return;
    this.genTimer++;

    if (this.watchMode) {
      // Watch mode: single car
      if (this.cars.length > 0 && this.cars[0].alive) {
        this.cars[0].update(this.track.walls, this.track.checkpoints);
      } else {
        this.spawnWatchCar();
      }
      return;
    }

    let allDead = true;
    for (const car of this.cars) {
      if (car.alive) {
        car.update(this.track.walls, this.track.checkpoints);
        allDead = false;
      }
    }

    if (allDead || this.genTimer > CFG.GEN_TIME * 60) {
      this.nextGeneration();
    }
  }

  // ---- Rendering ----
  render() {
    const c = this.mainC;
    const ctx = this.mainCtx;
    const dpr = devicePixelRatio;
    const w = c.width / dpr;
    const h = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!this.track) return;

    // Camera: center on best alive car or track center
    let camX = 0, camY = 0;
    let best = null;
    let bestFit = -Infinity;
    for (const car of this.cars) {
      if (car.alive && car.fitness > bestFit) { best = car; bestFit = car.fitness; }
    }
    if (!best && this.cars.length > 0) best = this.cars[0];

    const trackCx = this.track.center.reduce((s, p) => s + p.x, 0) / this.track.center.length;
    const trackCy = this.track.center.reduce((s, p) => s + p.y, 0) / this.track.center.length;

    // Compute scale to fit track
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.track.inner) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    for (const p of this.track.outer) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const tW = maxX - minX + 80;
    const tH = maxY - minY + 80;
    const scale = Math.min(w / tW, h / tH);

    camX = (minX + maxX) / 2;
    camY = (minY + maxY) / 2;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-camX, -camY);

    // Draw track
    this.drawTrack(ctx);

    // Draw cars
    for (const car of this.cars) {
      this.drawCar(ctx, car, car === best);
    }

    ctx.restore();

    // HUD overlay
    this.drawHUD(ctx, w, h, best);
  }

  drawTrack(ctx) {
    const t = this.track;

    // Track surface
    ctx.beginPath();
    t.outer.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(30, 30, 60, 0.4)';
    ctx.fill();

    ctx.beginPath();
    t.inner.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = '#0a0a0f';
    ctx.fill();

    // Walls
    ctx.strokeStyle = 'rgba(0, 207, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    t.inner.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    t.outer.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();

    // Centerline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    t.center.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Start/finish line
    const cp0 = t.checkpoints[0];
    if (cp0) {
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cp0.x1, cp0.y1);
      ctx.lineTo(cp0.x2, cp0.y2);
      ctx.stroke();
    }
  }

  drawCar(ctx, car, isBest) {
    const alpha = car.alive ? 1 : 0.15;
    ctx.globalAlpha = alpha;

    // Sensors (only for best car)
    if (isBest && car.alive) {
      for (let s = 0; s < CFG.SENSORS; s++) {
        const a = car.angle + car.sensorAngles[s] * DEG;
        const len = car.sensors[s] * CFG.SENSOR_RANGE;
        const ex = car.x + Math.cos(a) * len;
        const ey = car.y + Math.sin(a) * len;
        const danger = 1 - car.sensors[s];
        ctx.strokeStyle = `rgba(${Math.round(255 * danger)}, ${Math.round(255 * (1 - danger))}, 100, 0.4)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(car.x, car.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
    }

    // Car body
    ctx.beginPath();
    ctx.arc(car.x, car.y, CFG.CAR_R, 0, PI2);
    if (isBest) {
      ctx.fillStyle = '#00ff88';
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 12;
    } else {
      ctx.fillStyle = car.alive ? 'rgba(0, 207, 255, 0.6)' : 'rgba(100, 100, 140, 0.3)';
      ctx.shadowBlur = 0;
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    // Direction
    if (car.alive) {
      const dx = Math.cos(car.angle) * CFG.CAR_R * 1.5;
      const dy = Math.sin(car.angle) * CFG.CAR_R * 1.5;
      ctx.strokeStyle = isBest ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(car.x, car.y);
      ctx.lineTo(car.x + dx, car.y + dy);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  drawHUD(ctx, w, h, bestCar) {
    if (this.watchMode) {
      ctx.fillStyle = 'rgba(0,207,255,0.8)';
      ctx.font = 'bold 14px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('👁️ 観察モード', 14, h - 14);
    }
  }

  // ---- Side Panel Rendering ----
  renderSidePanel() {
    this.updateStats();
    const activePage = document.querySelector('.tab-page.active');
    if (!activePage) return;
    const page = activePage.dataset.page;
    if (page === 'stats') this.renderFitnessGraph();
    else if (page === 'brain') this.renderBrainVis();
    else if (page === 'sensors') this.renderSensorVis();
  }

  updateStats() {
    const alive = this.cars.filter(c => c.alive).length;
    const best = this.cars.reduce((a, b) => a.fitness > b.fitness ? a : b, this.cars[0]);

    document.getElementById('genNum').textContent = this.gen;
    document.getElementById('bestScore').textContent = best ? best.fitness.toFixed(2) : '0.00';
    document.getElementById('aliveCount').textContent = alive;

    document.getElementById('statGen').textContent = this.gen;
    document.getElementById('statBest').textContent = best ? best.fitness.toFixed(2) : '0.00';
    const avg = this.cars.length > 0 ? (this.cars.reduce((s, c) => s + c.fitness, 0) / this.cars.length).toFixed(2) : '0.00';
    document.getElementById('statAvg').textContent = avg;
    document.getElementById('statAllTime').textContent = this.allTimeBest.toFixed(2);
  }

  renderFitnessGraph() {
    const c = document.getElementById('fitnessCanvas');
    if (!c || c.width === 0) { this.resizePanel(); return; }
    const ctx = c.getContext('2d');
    const dpr = devicePixelRatio;
    const w = c.width / dpr;
    const h = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (this.bestFitHistory.length < 2) {
      ctx.fillStyle = '#6a6a90';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('学習データを収集中...', w / 2, h / 2);
      return;
    }

    const pad = { top: 10, right: 10, bottom: 22, left: 36 };
    const gw = w - pad.left - pad.right;
    const gh = h - pad.top - pad.bottom;

    const allVals = [...this.bestFitHistory, ...this.avgFitHistory];
    const maxV = Math.max(...allVals, 1);
    const minV = Math.min(...allVals, 0);
    const range = maxV - minV || 1;

    const toX = (i) => pad.left + (i / (this.bestFitHistory.length - 1)) * gw;
    const toY = (v) => pad.top + gh - ((v - minV) / range) * gh;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = pad.top + (i / 3) * gh;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    }

    // Average line
    ctx.strokeStyle = 'rgba(0,207,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.avgFitHistory.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.stroke();

    // Best line
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.bestFitHistory.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.stroke();

    // All-time best line
    if (this.allTimeBest > 0) {
      ctx.strokeStyle = 'rgba(255,204,0,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      const y = toY(this.allTimeBest);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axis labels
    ctx.fillStyle = '#6a6a90';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(maxV.toFixed(1), pad.left - 4, pad.top + 10);
    ctx.fillText(minV.toFixed(1), pad.left - 4, h - pad.bottom);
    ctx.textAlign = 'center';
    ctx.fillText('世代', w / 2, h - 2);

    // Legend
    ctx.textAlign = 'left';
    ctx.fillStyle = '#00ff88'; ctx.fillText('● ベスト', pad.left + 4, h - 4);
    ctx.fillStyle = '#00cfff'; ctx.fillText('● 平均', pad.left + 64, h - 4);
    ctx.fillStyle = '#ffcc00'; ctx.fillText('--- 全体ベスト', pad.left + 110, h - 4);
  }

  renderBrainVis() {
    const c = document.getElementById('brainCanvas');
    if (!c || c.width === 0) { this.resizePanel(); return; }
    const ctx = c.getContext('2d');
    const dpr = devicePixelRatio;
    const w = c.width / dpr;
    const h = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Find best brain
    let brain = null;
    if (this.bestBrain) brain = this.bestBrain;
    else {
      const best = this.cars.reduce((a, b) => a.fitness > b.fitness ? a : b, this.cars[0]);
      if (best) brain = best.brain;
    }
    if (!brain) return;

    const layers = [brain.inN, brain.hidN, brain.outN];
    const layerX = [w * 0.15, w * 0.5, w * 0.85];
    const inputLabels = [...Array(CFG.SENSORS).keys()].map(i => `S${i}`).concat(['Spd']);
    const outputLabels = ['Steer', 'Accel'];

    // Compute node positions
    const nodeY = (layer, idx) => {
      const n = layers[layer];
      const spacing = Math.min(28, (h - 40) / n);
      const startY = h / 2 - ((n - 1) * spacing) / 2;
      return startY + idx * spacing;
    };

    // Draw edges: input -> hidden
    for (let i = 0; i < brain.inN; i++) {
      for (let hIdx = 0; hIdx < brain.hidN; hIdx++) {
        const wt = brain.wIH[i * brain.hidN + hIdx];
        const abs = Math.abs(wt);
        ctx.strokeStyle = wt > 0 ? `rgba(68, 255, 136, ${clamp(abs * 0.5, 0.05, 0.6)})` : `rgba(255, 68, 102, ${clamp(abs * 0.5, 0.05, 0.6)})`;
        ctx.lineWidth = clamp(abs * 2, 0.3, 3);
        ctx.beginPath();
        ctx.moveTo(layerX[0], nodeY(0, i));
        ctx.lineTo(layerX[1], nodeY(1, hIdx));
        ctx.stroke();
      }
    }

    // Draw edges: hidden -> output
    for (let hIdx = 0; hIdx < brain.hidN; hIdx++) {
      for (let o = 0; o < brain.outN; o++) {
        const wt = brain.wHO[hIdx * brain.outN + o];
        const abs = Math.abs(wt);
        ctx.strokeStyle = wt > 0 ? `rgba(68, 255, 136, ${clamp(abs * 0.5, 0.05, 0.6)})` : `rgba(255, 68, 102, ${clamp(abs * 0.5, 0.05, 0.6)})`;
        ctx.lineWidth = clamp(abs * 2, 0.3, 3);
        ctx.beginPath();
        ctx.moveTo(layerX[1], nodeY(1, hIdx));
        ctx.lineTo(layerX[2], nodeY(2, o));
        ctx.stroke();
      }
    }

    // Draw nodes
    const drawNode = (x, y, activation, label, align) => {
      const r = 8;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, PI2);
      const a = typeof activation === 'number' ? activation : 0;
      const green = Math.max(0, a);
      const red = Math.max(0, -a);
      ctx.fillStyle = `rgba(${Math.round(red * 200 + 30)}, ${Math.round(green * 200 + 30)}, ${Math.round(50 + Math.abs(a) * 100)}, 0.9)`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (label) {
        ctx.fillStyle = '#6a6a90';
        ctx.font = '9px system-ui';
        ctx.textAlign = align || 'center';
        const lx = align === 'right' ? x - 14 : align === 'left' ? x + 14 : x;
        ctx.fillText(label, lx, y + 3);
      }
    };

    // Input nodes
    for (let i = 0; i < brain.inN; i++) drawNode(layerX[0], nodeY(0, i), brain.aIn[i], inputLabels[i], 'right');
    // Hidden nodes
    for (let i = 0; i < brain.hidN; i++) drawNode(layerX[1], nodeY(1, i), brain.aHid[i]);
    // Output nodes
    for (let i = 0; i < brain.outN; i++) drawNode(layerX[2], nodeY(2, i), brain.aOut[i], outputLabels[i], 'left');
  }

  renderSensorVis() {
    // Find best alive car
    let best = null;
    let bestFit = -Infinity;
    for (const car of this.cars) {
      if (car.alive && car.fitness > bestFit) { best = car; bestFit = car.fitness; }
    }
    if (!best) best = this.cars[0];
    if (!best) return;

    // Render sensor radar
    const c = document.getElementById('sensorCanvas');
    if (c && c.width > 0) {
      const ctx = c.getContext('2d');
      const dpr = devicePixelRatio;
      const w = c.width / dpr;
      const h = c.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2, cy = h * 0.55;
      const maxR = Math.min(w, h) * 0.4;

      // Rings
      for (let r = 1; r <= 3; r++) {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * (r / 3), 0, PI2);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Sensors
      const angles = best.sensorAngles || this.sensorAngles;
      for (let s = 0; s < best.sensors.length; s++) {
        const a = -90 * DEG + (angles[s] || 0) * DEG;
        const val = best.sensors[s];
        const len = val * maxR;

        // Sensor line
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        const ex = cx + Math.cos(a) * len;
        const ey = cy + Math.sin(a) * len;
        ctx.lineTo(ex, ey);
        const danger = 1 - val;
        ctx.strokeStyle = `rgba(${Math.round(255 * danger)}, ${Math.round(255 * (1 - danger * 0.5))}, 100, 0.7)`;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Tip
        ctx.beginPath();
        ctx.arc(ex, ey, 4, 0, PI2);
        ctx.fillStyle = `rgba(${Math.round(255 * danger)}, ${Math.round(255 * (1 - danger * 0.5))}, 100, 0.9)`;
        ctx.fill();
      }

      // Car
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, PI2);
      ctx.fillStyle = '#00ff88';
      ctx.fill();
    }

    // Sensor bars
    const barsEl = document.getElementById('sensorBars');
    if (barsEl) {
      const count = best.sensors.length;
      if (barsEl.children.length !== count) {
        barsEl.innerHTML = '';
        for (let i = 0; i < count; i++) {
          const row = document.createElement('div');
          row.className = 'sensor-bar-row';
          row.innerHTML = `<span class="lbl">S${i}</span><div class="sensor-bar-track"><div class="sensor-bar-fill"></div></div>`;
          barsEl.appendChild(row);
        }
      }
      for (let i = 0; i < count; i++) {
        const fill = barsEl.children[i].querySelector('.sensor-bar-fill');
        const val = best.sensors[i];
        fill.style.width = (val * 100) + '%';
        const danger = 1 - val;
        fill.style.background = `rgb(${Math.round(255 * danger)}, ${Math.round(255 * (1 - danger * 0.5))}, 100)`;
      }
    }
  }
}

// ============================================================
//  Boot
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  new Game();
});
