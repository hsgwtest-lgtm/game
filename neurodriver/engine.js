'use strict';
// ============================================================
//  NeuroDriver — AI Racing Evolution Engine
//  ニューロドライバー：遺伝的アルゴリズム × ニューラルネット
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
};

// ---- Math Utilities ----
const PI2 = Math.PI * 2;
const DEG = Math.PI / 180;
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1; return Math.sqrt(dx * dx + dy * dy); }
function randF(lo, hi) { return Math.random() * (hi - lo) + lo; }
function randGauss() { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(PI2 * v); }

// Side of point relative to line segment (sign = side)
function side(px, py, x1, y1, x2, y2) {
  return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
}

// Ray vs segment intersection → returns distance or -1
function raySeg(ox, oy, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1;
  const det = sx * dy - dx * sy;
  if (Math.abs(det) < 1e-10) return -1;
  const invDet = 1 / det;
  const t = (-sy * (x1 - ox) + sx * (y1 - oy)) * invDet;
  const s = (dx * (y1 - oy) - dy * (x1 - ox)) * invDet;
  return (t >= 0 && s >= 0 && s <= 1) ? t : -1;
}

// Point-to-segment distance
function ptSegDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) return dist(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = clamp(t, 0, 1);
  return dist(px, py, x1 + t * dx, y1 + t * dy);
}

// Catmull-Rom spline point
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
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
    // Hidden
    for (let h = 0; h < this.hidN; h++) {
      let s = this.bH[h];
      for (let i = 0; i < this.inN; i++) s += inputs[i] * this.wIH[i * this.hidN + h];
      this.aHid[h] = Math.tanh(s);
    }
    // Output
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

  // Compute normals & offset
  for (let i = 0; i < n; i++) {
    const prev = centerPts[(i - 1 + n) % n], next = centerPts[(i + 1) % n];
    const dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    inner.push({ x: centerPts[i].x + nx * halfW, y: centerPts[i].y + ny * halfW });
    outer.push({ x: centerPts[i].x - nx * halfW, y: centerPts[i].y - ny * halfW });
  }

  // Walls
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    walls.push({ x1: inner[i].x, y1: inner[i].y, x2: inner[j].x, y2: inner[j].y });
    walls.push({ x1: outer[i].x, y1: outer[i].y, x2: outer[j].x, y2: outer[j].y });
  }

  // Checkpoints
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

  // Start position = first centerline point, facing along tangent
  const s0 = centerPts[0], s1 = centerPts[1];
  const startAngle = Math.atan2(s1.y - s0.y, s1.x - s0.x);

  return { walls, checkpoints, inner, outer, center: centerPts, startX: s0.x, startY: s0.y, startAngle };
}

// Preset track generators (polar-based)
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
//  Car
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
      this.sensors[s] = minD / CFG.SENSOR_RANGE; // 0=close, 1=far
    }
  }

  update(walls, checkpoints) {
    if (!this.alive) return;
    this.age++;

    // Cast sensors
    this.castSensors(walls);

    // Neural network input: sensors + normalized speed
    const inputs = [...this.sensors, this.speed / CFG.MAX_SPEED];
    const out = this.brain.forward(inputs);

    // Apply controls
    const steer = out[0]; // -1..1
    const accel = out[1]; // -1..1

    // Turn rate scales with speed for realism
    const speedFactor = Math.abs(this.speed) / CFG.MAX_SPEED + 0.15;
    this.angle += steer * CFG.TURN * Math.min(speedFactor, 1);

    // Acceleration
    if (accel > 0) this.speed += accel * CFG.ACCEL;
    else this.speed += accel * CFG.BRAKE;
    this.speed *= CFG.DRAG;
    this.speed = clamp(this.speed, -0.5, CFG.MAX_SPEED);

    // Move
    this.prevX = this.x; this.prevY = this.y;
    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;

    // Collision: check if too close to any wall
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
        // Crossed checkpoint line — verify correct direction
        if (Math.sign(currS) === cp.correctSign || cp.correctSign === 0) {
          this.cpPassed++;
          this.nextCP = (this.nextCP + 1) % checkpoints.length;
          if (this.nextCP === 0) this.laps++;
        }
      }
    }

    // Fitness = checkpoints passed (smooth)
    // Add fractional progress toward next checkpoint
    if (checkpoints.length > 0) {
      const cp = checkpoints[this.nextCP];
      const d = dist(this.x, this.y, cp.cx, cp.cy);
      const prevCPIdx = (this.nextCP - 1 + checkpoints.length) % checkpoints.length;
      const prevCP = checkpoints[prevCPIdx];
      const totalD = dist(prevCP.cx, prevCP.cy, cp.cx, cp.cy) || 1;
      const progress = clamp(1 - d / totalD, 0, 1);
      this.fitness = this.cpPassed + progress * 0.99;
    }

    // Stagnation detection — kill cars that aren't making progress
    if (this.fitness > this.maxFit + 0.01) {
      this.maxFit = this.fitness;
      this.stagnant = 0;
    } else {
      this.stagnant++;
      if (this.stagnant > 180) this.alive = false; // 3 seconds at 60fps
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

  // Keep elites
  for (const e of elites) {
    children.push(e.brain.copy());
  }

  // Generate offspring from elites
  while (children.length < CFG.POP) {
    const parent = elites[Math.floor(Math.random() * elites.length)];
    const child = parent.brain.copy();
    child.mutate(CFG.MUT_RATE, CFG.MUT_STR);
    children.push(child);
  }

  return children;
}

// ============================================================
//  Main Game
// ============================================================
class Game {
  constructor() {
    this.state = 'menu'; // menu | draw | sim
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

    // Canvas refs
    this.mainC = document.getElementById('mainCanvas');
    this.mainCtx = this.mainC.getContext('2d');
    this.neuralC = document.getElementById('neuralCanvas');
    this.neuralCtx = this.neuralC.getContext('2d');
    this.fitC = document.getElementById('fitnessCanvas');
    this.fitCtx = this.fitC.getContext('2d');
    this.drawC = document.getElementById('drawCanvas');
    this.drawCtx = this.drawC.getContext('2d');

    // Mobile canvases
    this.neuralCM = document.getElementById('neuralCanvasM');
    this.fitCM = document.getElementById('fitnessCanvasM');

    this.setupUI();
    this.setupPresets();
    this.resizeAll();
    window.addEventListener('resize', () => this.resizeAll());
    this.loop();
  }

  resizeAll() {
    // Main canvas
    const wrap = this.mainC.parentElement;
    if (wrap) {
      this.mainC.width = wrap.clientWidth * devicePixelRatio;
      this.mainC.height = wrap.clientHeight * devicePixelRatio;
      this.mainC.style.width = wrap.clientWidth + 'px';
      this.mainC.style.height = wrap.clientHeight + 'px';
      this.trackCache = null; // force redraw
    }
    // Side canvases
    this.resizeCanvas(this.neuralC);
    this.resizeCanvas(this.fitC);
    // Draw canvas
    if (this.drawC.parentElement) {
      this.drawC.width = window.innerWidth * devicePixelRatio;
      this.drawC.height = (window.innerHeight - 52) * devicePixelRatio;
      this.drawC.style.width = '100%';
    }
    // Mobile
    if (this.neuralCM) this.resizeCanvas(this.neuralCM);
    if (this.fitCM) this.resizeCanvas(this.fitCM);
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
    // Speed buttons
    document.querySelectorAll('.speed-btns button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.speed-btns button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.speedMult = parseInt(b.dataset.speed);
      });
    });

    // Reset
    document.getElementById('btnReset').addEventListener('click', () => {
      this.state = 'menu';
      document.getElementById('gameUI').style.display = 'none';
      document.getElementById('startScreen').style.display = 'flex';
      this.gen = 0;
      this.bestFitHistory = [];
      this.avgFitHistory = [];
      this.allTimeBest = 0;
      this.bestBrain = null;
      this.selectedPreset = null;
      document.querySelectorAll('.track-card').forEach(c => c.classList.remove('selected'));
      document.getElementById('btnStart').disabled = true;
    });

    // Start button
    document.getElementById('btnStart').addEventListener('click', () => this.startSim());

    // Custom draw button
    document.getElementById('btnCustom').addEventListener('click', () => this.enterDrawMode());
    document.getElementById('btnDrawBack').addEventListener('click', () => this.exitDrawMode());
    document.getElementById('btnDrawUndo').addEventListener('click', () => {
      this.drawPoints.pop();
      this.renderDrawMode();
    });
    document.getElementById('btnDrawDone').addEventListener('click', () => this.finishDraw());

    // Draw canvas click/touch
    this.drawC.addEventListener('click', (e) => this.handleDrawClick(e));
    this.drawC.addEventListener('mousemove', (e) => { this._drawMouse = this.getCanvasPos(this.drawC, e); this.renderDrawMode(); });
    this.drawC.addEventListener('touchend', (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      this.handleDrawClick(touch);
    });

    // Main canvas click/touch (select car)
    this.mainC.addEventListener('click', (e) => this.handleMainClick(e));
    this.mainC.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.handleMainClick(e.changedTouches[0]);
    });

    // Parameter sliders
    this.bindSlider('ctrlPop', 'valPop', v => { CFG.POP = v; return v; });
    this.bindSlider('ctrlMutRate', 'valMutRate', v => { CFG.MUT_RATE = v / 100; return v + '%'; });
    this.bindSlider('ctrlMutStr', 'valMutStr', v => { CFG.MUT_STR = v / 100; return (v / 100).toFixed(2); });
    this.bindSlider('ctrlElite', 'valElite', v => { CFG.ELITE = v; return v; });
    this.bindSlider('ctrlTime', 'valTime', v => { CFG.GEN_TIME = v; return v + 's'; });
    this.bindSlider('ctrlWidth', 'valWidth', v => {
      CFG.TRACK_W = v;
      return v;
    });

    // Mobile tabs
    document.querySelectorAll('.mob-tabs button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.mob-tabs button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.querySelectorAll('.mob-content .panel-section').forEach(p => p.classList.remove('active'));
        const panel = document.querySelector(`.mob-content [data-panel="${b.dataset.tab}"]`);
        if (panel) panel.classList.add('active');
      });
    });
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

      // Draw mini preview
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
    // Generate track at standard center, then scale to fit preview
    const ctrl = preset.ctrl(cx, cy);
    const pts = smoothCenterline(ctrl, 6);
    // Find bounds
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
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('drawOverlay').style.display = 'flex';
    this.resizeAll();
    this.renderDrawMode();
  }

  exitDrawMode() {
    this.state = 'menu';
    document.getElementById('drawOverlay').style.display = 'none';
    document.getElementById('startScreen').style.display = 'flex';
  }

  handleDrawClick(e) {
    const pos = this.getCanvasPos(this.drawC, e);
    const pts = this.drawPoints;

    // Check if closing the loop
    if (pts.length >= 8) {
      const d = dist(pos.x, pos.y, pts[0].x, pts[0].y);
      if (d < 40 * devicePixelRatio) {
        // Close!
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

    // Grid
    ctx.strokeStyle = '#ffffff08';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40 * devicePixelRatio) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 40 * devicePixelRatio) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    const pts = this.drawPoints;
    if (pts.length < 2) {
      // Draw placed points
      pts.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 6 * devicePixelRatio, 0, PI2);
        ctx.fillStyle = '#00ff88'; ctx.fill();
      });
      return;
    }

    // Draw smooth preview
    const closed = pts.length >= 8;
    if (closed) {
      const smooth = smoothCenterline(pts, 6);
      // Draw track preview
      const halfW = CFG.TRACK_W * devicePixelRatio / 2;
      const n = smooth.length;
      // Compute walls for preview
      const innerPts = [], outerPts = [];
      for (let i = 0; i < n; i++) {
        const prev = smooth[(i - 1 + n) % n], next = smooth[(i + 1) % n];
        const dx = next.x - prev.x, dy = next.y - prev.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        innerPts.push({ x: smooth[i].x + (-dy / len) * halfW, y: smooth[i].y + (dx / len) * halfW });
        outerPts.push({ x: smooth[i].x - (-dy / len) * halfW, y: smooth[i].y - (dx / len) * halfW });
      }

      // Fill track surface
      ctx.fillStyle = '#1a1a3044';
      ctx.beginPath();
      innerPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath();
      for (let i = outerPts.length - 1; i >= 0; i--) {
        i === outerPts.length - 1 ? ctx.moveTo(outerPts[i].x, outerPts[i].y) : ctx.lineTo(outerPts[i].x, outerPts[i].y);
      }
      ctx.closePath();
      ctx.fill('evenodd');

      // Wall lines
      ctx.strokeStyle = '#00ff8844';
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      innerPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath(); ctx.stroke();
      ctx.beginPath();
      outerPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath(); ctx.stroke();
    }

    // Centerline
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.setLineDash([8 * devicePixelRatio, 4 * devicePixelRatio]);
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    if (closed) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Points
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 * devicePixelRatio, 0, PI2);
      ctx.fillStyle = i === 0 ? '#ffcc00' : '#00ff88';
      ctx.fill();
    });

    // Start point indicator
    if (pts.length >= 8) {
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 20 * devicePixelRatio, 0, PI2);
      ctx.strokeStyle = '#ffcc0066'; ctx.lineWidth = 2 * devicePixelRatio;
      ctx.stroke();
    }
  }

  finishDraw() {
    if (this.drawPoints.length < 8) return;
    // Scale points from canvas coordinates to game coordinates
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
      // Use center of main canvas
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

    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('gameUI').style.display = 'flex';
    this.state = 'sim';
    this.resizeAll();
    this.newGeneration();
  }

  newGeneration(brains) {
    this.gen++;
    this.genTimer = 0;
    this.cars = [];
    const t = this.track;
    for (let i = 0; i < CFG.POP; i++) {
      const brain = brains ? brains[i] : new NeuralNet(CFG.SENSORS + 1, CFG.HIDDEN, 2);
      this.cars.push(new Car(t.startX, t.startY, t.startAngle, brain));
    }
    this.selectedCar = null;
    this.updateStats();
  }

  step() {
    if (this.state !== 'sim' || this.speedMult === 0) return;

    const dt = 1 / 60;
    for (let s = 0; s < this.speedMult; s++) {
      this.genTimer += dt;

      // Update all cars
      let anyAlive = false;
      for (const car of this.cars) {
        car.update(this.track.walls, this.track.checkpoints);
        if (car.alive) anyAlive = true;
      }

      // Find best car
      let best = this.cars[0];
      for (const c of this.cars) if (c.fitness > best.fitness) best = c;
      this.bestCar = best;

      // Auto-select best if no selection
      if (!this.selectedCar || !this.selectedCar.alive) this.selectedCar = this.bestCar;

      // End of generation?
      if (!anyAlive || this.genTimer >= CFG.GEN_TIME) {
        this.endGeneration();
        break;
      }
    }
  }

  endGeneration() {
    // Record fitness
    let best = 0, sum = 0;
    for (const c of this.cars) {
      if (c.fitness > best) best = c.fitness;
      sum += c.fitness;
    }
    this.bestFitHistory.push(best);
    this.avgFitHistory.push(sum / this.cars.length);

    // Update all-time best
    if (best > this.allTimeBest) {
      this.allTimeBest = best;
      // Find the best car's brain
      const bestCar = this.cars.reduce((a, b) => a.fitness > b.fitness ? a : b);
      this.bestBrain = bestCar.brain.copy();
    }

    // Ticker message
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

    // Evolve
    const brains = evolve(this.cars, CFG.ELITE);

    // Inject all-time best
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
    const cw = this.mainC.width, ch = this.mainC.height;
    // Transform to track coords
    const view = this.getView();
    const tx = (pos.x - view.ox) / view.scale;
    const ty = (pos.y - view.oy) / view.scale;

    // Find nearest alive car
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
    // Find track bounds
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

    // Track surface (cached)
    if (!this.trackCache) {
      this.trackCache = document.createElement('canvas');
      this.trackCache.width = cw;
      this.trackCache.height = ch;
      const tc = this.trackCache.getContext('2d');
      tc.translate(v.ox, v.oy);
      tc.scale(v.scale, v.scale);

      // Fill track surface
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

      // Wall lines
      tc.strokeStyle = '#444470';
      tc.lineWidth = 2 / v.scale;
      tc.lineJoin = 'round';
      tc.beginPath();
      t.inner.forEach((p, i) => i === 0 ? tc.moveTo(p.x, p.y) : tc.lineTo(p.x, p.y));
      tc.closePath(); tc.stroke();
      tc.beginPath();
      t.outer.forEach((p, i) => i === 0 ? tc.moveTo(p.x, p.y) : tc.lineTo(p.x, p.y));
      tc.closePath(); tc.stroke();

      // Checkpoints (subtle)
      tc.strokeStyle = '#ffffff10';
      tc.lineWidth = 1 / v.scale;
      for (const cp of t.checkpoints) {
        tc.beginPath(); tc.moveTo(cp.x1, cp.y1); tc.lineTo(cp.x2, cp.y2); tc.stroke();
      }

      // Start line
      const cp0 = t.checkpoints[0];
      tc.strokeStyle = '#00ff8866';
      tc.lineWidth = 3 / v.scale;
      tc.beginPath(); tc.moveTo(cp0.x1, cp0.y1); tc.lineTo(cp0.x2, cp0.y2); tc.stroke();
    }
    ctx.restore();
    ctx.drawImage(this.trackCache, 0, 0);

    // Draw cars
    ctx.save();
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.scale, v.scale);
    this.renderCars(ctx, v.scale);
    ctx.restore();
  }

  renderCars(ctx, scale) {
    // Sort: dead first, alive on top, selected last
    const sorted = [...this.cars].sort((a, b) => {
      if (a === this.selectedCar) return 1;
      if (b === this.selectedCar) return -1;
      if (a.alive && !b.alive) return 1;
      if (!a.alive && b.alive) return -1;
      return a.fitness - b.fitness;
    });

    for (const car of sorted) {
      if (!car.alive && car.age < this.genTimer * 60 - 30) continue; // Hide old dead cars

      const isSelected = car === this.selectedCar;
      const isBest = car === this.bestCar;

      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      if (!car.alive) {
        // Dead car: small X
        ctx.strokeStyle = '#ff444488';
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath(); ctx.moveTo(-3, -3); ctx.lineTo(3, 3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-3, 3); ctx.lineTo(3, -3); ctx.stroke();
        ctx.restore();
        continue;
      }

      // Car color based on fitness ranking
      const maxFit = this.bestCar ? this.bestCar.fitness : 1;
      const fitRatio = maxFit > 0 ? car.fitness / maxFit : 0;
      let color;
      if (isBest) color = '#ffcc00';
      else if (fitRatio > 0.7) color = '#00ff88';
      else if (fitRatio > 0.3) color = '#4488ff';
      else color = '#ff6644';

      // Glow for best/selected
      if (isSelected || isBest) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12 / scale;
      }

      // Car triangle
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

      // Sensor rays for selected car
      if (isSelected && car.alive) {
        for (let s = 0; s < CFG.SENSORS; s++) {
          const a = car.angle + CFG.SENSOR_ANGLES[s] * DEG;
          const d = car.sensors[s] * CFG.SENSOR_RANGE;
          const ex = car.x + Math.cos(a) * d;
          const ey = car.y + Math.sin(a) * d;
          const danger = 1 - car.sensors[s];
          ctx.strokeStyle = danger > 0.7 ? `rgba(255,68,68,${0.6})` :
                            danger > 0.4 ? `rgba(255,200,0,${0.5})` :
                            `rgba(0,255,136,${0.3})`;
          ctx.lineWidth = 1.5 / scale;
          ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(ex, ey); ctx.stroke();
          // Sensor endpoint
          ctx.beginPath(); ctx.arc(ex, ey, 2 / scale, 0, PI2);
          ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        }
      }
    }
  }

  // ---- Neural Network Visualization ----
  renderNeural() {
    const targets = [
      { canvas: this.neuralC, ctx: this.neuralCtx },
    ];
    // Mobile canvas
    if (this.neuralCM && this.neuralCM.getContext) {
      const mCtx = this.neuralCM.getContext('2d');
      targets.push({ canvas: this.neuralCM, ctx: mCtx });
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
      const labels = [
        ['L60°', 'L30°', '前方', 'R30°', 'R60°', '速度'],
        [],
        ['操舵', '加速']
      ];

      // Compute node positions
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

      // Draw connections
      // Input → Hidden
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

      // Layer labels
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

    // Glow
    if (absVal > 0.3) {
      ctx.beginPath(); ctx.arc(x, y, r + 4 * devicePixelRatio, 0, PI2);
      const glowColor = val > 0 ? `rgba(0,255,136,${absVal * 0.3})` : `rgba(255,68,85,${absVal * 0.3})`;
      ctx.fillStyle = glowColor;
      ctx.fill();
    }

    // Node circle
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

    // Value text inside
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${7 * devicePixelRatio}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(val.toFixed(1), x, y);

    // Label
    if (label) {
      ctx.fillStyle = '#aaa';
      ctx.font = `${8 * devicePixelRatio}px sans-serif`;
      ctx.fillText(label, x, y + r + 10 * devicePixelRatio);
    }
  }

  // ---- Fitness Graph ----
  renderFitness() {
    const targets = [
      { canvas: this.fitC, ctx: this.fitCtx },
    ];
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

      // Grid
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

      // Average fill
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

      // Best fill
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

      // Average line
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 1.5 * devicePixelRatio;
      ctx.beginPath();
      for (let i = 0; i < avgData.length; i++) {
        const x = pad + (i / (numGens - 1)) * gw;
        const y = pad + gh * (1 - avgData[i] / maxVal);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Best line
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = pad + (i / (numGens - 1)) * gw;
        const y = pad + gh * (1 - data[i] / maxVal);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Legend
      const ly = pad - 10 * devicePixelRatio;
      ctx.font = `${9 * devicePixelRatio}px sans-serif`;
      ctx.fillStyle = '#00ff88'; ctx.fillRect(pad, ly, 12 * devicePixelRatio, 3 * devicePixelRatio);
      ctx.fillStyle = '#aaa'; ctx.textAlign = 'left';
      ctx.fillText('最高', pad + 16 * devicePixelRatio, ly + 4 * devicePixelRatio);
      ctx.fillStyle = '#4488ff'; ctx.fillRect(pad + 50 * devicePixelRatio, ly, 12 * devicePixelRatio, 3 * devicePixelRatio);
      ctx.fillStyle = '#aaa';
      ctx.fillText('平均', pad + 66 * devicePixelRatio, ly + 4 * devicePixelRatio);

      // X axis label
      ctx.fillStyle = '#555';
      ctx.textAlign = 'center';
      ctx.fillText(`世代 (${numGens})`, w / 2, h - 6 * devicePixelRatio);
    }
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
