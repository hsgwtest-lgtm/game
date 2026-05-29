/* =====================================================
   NeuroCanvas Engine — 進化型AIアートシミュレータ
   CPPN-based Interactive Evolutionary Art
   ===================================================== */

// ─── Constants ───────────────────────────────────────
const IN = 7, H1 = 10, H2 = 8, OUT = 3;
const POP_SIZE = 12;
const THUMB_RES_DEFAULT = 128;
const FULL_RES = 512;
const EXPORT_RES = 1024;
const STORAGE_KEY = 'neurocanvas_v1';
const GALLERY_KEY = 'neurocanvas_gallery_v1';
const MAX_GALLERY = 30;

// ─── Activation Functions ────────────────────────────
const ACT_NAMES = ['sin','cos','tanh','relu','gauss','abs','saw','sig'];
const ACT_FNS = [
  x => Math.sin(x * Math.PI),
  x => Math.cos(x * Math.PI),
  x => Math.tanh(x),
  x => Math.max(0, x),
  x => Math.exp(-(x * x)),
  x => Math.abs(x),
  x => ((x % 1) + 1) % 1, // sawtooth: repeating ramp 0→1
  x => 1 / (1 + Math.exp(-x))
];
const ACT_COLORS = [
  '#ff6b6b','#ffa500','#ffee58','#66bb6a',
  '#42a5f5','#ab47bc','#ec407a','#26c6da'
];
const NUM_ACT = ACT_FNS.length;

const SYMMETRY_NAMES = ['なし','左右対称','上下対称','4面対称','回転対称'];

// ─── Utility Functions ───────────────────────────────
function gaussRand() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function lerp(a, b, t) { return a + (b - a) * t; }

// ─── CPPN (Compositional Pattern Producing Network) ──
class CPPN {
  constructor(genome) {
    this.g = genome;
  }

  forward(rawX, rawY) {
    let x = rawX, y = rawY;
    const s = this.g.scale;

    // Apply symmetry
    switch (this.g.symmetry) {
      case 1: x = Math.abs(x); break;
      case 2: y = Math.abs(y); break;
      case 3: x = Math.abs(x); y = Math.abs(y); break;
      case 4:
        const a = ((Math.atan2(y, x) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3);
        const d2 = Math.sqrt(x * x + y * y);
        x = d2 * Math.cos(a);
        y = d2 * Math.sin(a);
        break;
    }

    x *= s; y *= s;
    const d = Math.sqrt(x * x + y * y);
    const inputs = [x, y, d, Math.sin(x * 3.0), Math.cos(y * 3.0), x * y, 1.0];

    // Hidden 1
    const h1 = new Float64Array(H1);
    const w1 = this.g.w1, b1 = this.g.b1, a1 = this.g.a1;
    for (let i = 0; i < H1; i++) {
      let sum = b1[i];
      const base = i * IN;
      for (let j = 0; j < IN; j++) sum += inputs[j] * w1[base + j];
      h1[i] = ACT_FNS[a1[i]](sum);
    }

    // Hidden 2
    const h2 = new Float64Array(H2);
    const w2 = this.g.w2, b2 = this.g.b2, a2 = this.g.a2;
    for (let i = 0; i < H2; i++) {
      let sum = b2[i];
      const base = i * H1;
      for (let j = 0; j < H1; j++) sum += h1[j] * w2[base + j];
      h2[i] = ACT_FNS[a2[i]](sum);
    }

    // Output (sigmoid → [0,1])
    const out = new Float64Array(OUT);
    const w3 = this.g.w3, b3 = this.g.b3;
    for (let i = 0; i < OUT; i++) {
      let sum = b3[i];
      const base = i * H2;
      for (let j = 0; j < H2; j++) sum += h2[j] * w3[base + j];
      out[i] = 1 / (1 + Math.exp(-clamp(sum, -10, 10)));
    }
    return out;
  }

  // Return all layer activations for visualization
  getActivations(rawX, rawY) {
    let x = rawX, y = rawY;
    const s = this.g.scale;
    switch (this.g.symmetry) {
      case 1: x = Math.abs(x); break;
      case 2: y = Math.abs(y); break;
      case 3: x = Math.abs(x); y = Math.abs(y); break;
      case 4:
        const a = ((Math.atan2(y, x) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3);
        const d2 = Math.sqrt(x * x + y * y);
        x = d2 * Math.cos(a); y = d2 * Math.sin(a);
        break;
    }
    x *= s; y *= s;
    const d = Math.sqrt(x * x + y * y);
    const inputs = [x, y, d, Math.sin(x * 3.0), Math.cos(y * 3.0), x * y, 1.0];

    const h1 = new Float64Array(H1);
    for (let i = 0; i < H1; i++) {
      let sum = this.g.b1[i];
      for (let j = 0; j < IN; j++) sum += inputs[j] * this.g.w1[i * IN + j];
      h1[i] = ACT_FNS[this.g.a1[i]](sum);
    }
    const h2 = new Float64Array(H2);
    for (let i = 0; i < H2; i++) {
      let sum = this.g.b2[i];
      for (let j = 0; j < H1; j++) sum += h1[j] * this.g.w2[i * H1 + j];
      h2[i] = ACT_FNS[this.g.a2[i]](sum);
    }
    const out = new Float64Array(OUT);
    for (let i = 0; i < OUT; i++) {
      let sum = this.g.b3[i];
      for (let j = 0; j < H2; j++) sum += h2[j] * this.g.w3[i * H2 + j];
      out[i] = 1 / (1 + Math.exp(-clamp(sum, -10, 10)));
    }
    return { inputs, h1: Array.from(h1), h2: Array.from(h2), out: Array.from(out) };
  }
}

// ─── Genome Operations ───────────────────────────────
function randomGenome() {
  const wInit = (n) => Array.from({ length: n }, () => (Math.random() * 2 - 1) * 1.8);
  const bInit = (n) => Array.from({ length: n }, () => (Math.random() * 2 - 1) * 0.5);
  const aInit = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * NUM_ACT));
  return {
    w1: wInit(H1 * IN), b1: bInit(H1), a1: aInit(H1),
    w2: wInit(H2 * H1), b2: bInit(H2), a2: aInit(H2),
    w3: wInit(OUT * H2), b3: bInit(OUT),
    symmetry: Math.floor(Math.random() * 5),
    scale: 0.8 + Math.random() * 2.2,
  };
}

function mutateGenome(genome, rate, strength) {
  const g = deepClone(genome);
  // Weights + biases
  for (const k of ['w1','b1','w2','b2','w3','b3']) {
    for (let i = 0; i < g[k].length; i++) {
      if (Math.random() < rate) g[k][i] += gaussRand() * strength;
    }
  }
  // Activation functions
  for (const k of ['a1','a2']) {
    for (let i = 0; i < g[k].length; i++) {
      if (Math.random() < rate * 0.25) g[k][i] = Math.floor(Math.random() * NUM_ACT);
    }
  }
  // Symmetry
  if (Math.random() < rate * 0.15) g.symmetry = Math.floor(Math.random() * 5);
  // Scale
  if (Math.random() < rate * 0.3) g.scale = clamp(g.scale + gaussRand() * 0.3, 0.3, 5.0);
  return g;
}

function crossoverGenomes(a, b) {
  const child = deepClone(a);
  for (const k of ['w1','b1','w2','b2','w3','b3']) {
    for (let i = 0; i < child[k].length; i++) {
      if (Math.random() < 0.5) child[k][i] = b[k][i];
    }
  }
  for (const k of ['a1','a2']) {
    for (let i = 0; i < child[k].length; i++) {
      if (Math.random() < 0.5) child[k][i] = b[k][i];
    }
  }
  if (Math.random() < 0.5) child.symmetry = b.symmetry;
  if (Math.random() < 0.5) child.scale = b.scale;
  return child;
}

function genomeDistance(a, b) {
  let dist = 0;
  for (const k of ['w1','w2','w3']) {
    for (let i = 0; i < a[k].length; i++) {
      const d = a[k][i] - b[k][i];
      dist += d * d;
    }
  }
  return Math.sqrt(dist);
}

// ─── Evolution Engine ────────────────────────────────
class Evolution {
  constructor() {
    this.population = [];
    this.generation = 1;
    this.selected = new Set();
    this.history = [];        // { generation, genome, diversity }
    this.diversityHistory = [];
    this.mutationRate = 0.15;
    this.mutationStrength = 0.5;
  }

  init() {
    this.population = [];
    for (let i = 0; i < POP_SIZE; i++) this.population.push(randomGenome());
    this.generation = 1;
    this.selected.clear();
    this.history = [];
    this.diversityHistory = [];
    this.updateDiversity();
  }

  toggleSelect(idx) {
    if (this.selected.has(idx)) this.selected.delete(idx);
    else this.selected.add(idx);
  }

  evolve() {
    if (this.selected.size === 0) return false;
    const parents = [...this.selected].map(i => this.population[i]);

    // Save history: best = first selected
    const bestIdx = [...this.selected][0];
    this.history.push({
      generation: this.generation,
      genome: deepClone(this.population[bestIdx]),
      diversity: this.currentDiversity,
      selectedCount: this.selected.size
    });

    // Create new population
    const newPop = [];
    // Elitism: keep parents
    for (const p of parents) newPop.push(deepClone(p));

    // Fill rest with offspring
    while (newPop.length < POP_SIZE) {
      const pA = parents[Math.floor(Math.random() * parents.length)];
      let child;
      if (parents.length > 1 && Math.random() < 0.7) {
        const pB = parents[Math.floor(Math.random() * parents.length)];
        child = crossoverGenomes(pA, pB);
      } else {
        child = deepClone(pA);
      }
      child = mutateGenome(child, this.mutationRate, this.mutationStrength);
      newPop.push(child);
    }

    this.population = newPop;
    this.generation++;
    this.selected.clear();
    this.updateDiversity();
    return true;
  }

  updateDiversity() {
    if (this.population.length < 2) { this.currentDiversity = 0; return; }
    let total = 0, count = 0;
    for (let i = 0; i < this.population.length; i++) {
      for (let j = i + 1; j < this.population.length; j++) {
        total += genomeDistance(this.population[i], this.population[j]);
        count++;
      }
    }
    this.currentDiversity = total / count;
    this.diversityHistory.push(this.currentDiversity);
  }

  // Normalized diversity (0-1) for UI meter
  get normalizedDiversity() {
    if (this.diversityHistory.length === 0) return 1;
    const maxDiv = Math.max(...this.diversityHistory, 1);
    return clamp(this.currentDiversity / maxDiv, 0, 1);
  }
}

// ─── Renderer ────────────────────────────────────────
class Renderer {
  static renderArt(genome, canvas, resolution) {
    const cppn = new CPPN(genome);
    const ctx = canvas.getContext('2d');
    canvas.width = resolution;
    canvas.height = resolution;
    const imgData = ctx.createImageData(resolution, resolution);
    const d = imgData.data;
    const inv = 1 / (resolution - 1);
    for (let py = 0; py < resolution; py++) {
      const y = py * inv * 2 - 1;
      for (let px = 0; px < resolution; px++) {
        const x = px * inv * 2 - 1;
        const c = cppn.forward(x, y);
        const idx = (py * resolution + px) * 4;
        d[idx]     = (c[0] * 255) | 0;
        d[idx + 1] = (c[1] * 255) | 0;
        d[idx + 2] = (c[2] * 255) | 0;
        d[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  static renderNetwork(genome, canvas, highlightActivations) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const layers = [
      { size: IN, labels: ['x','y','d','sin','cos','x·y','1'], color: '#00e8ff' },
      { size: H1, acts: genome.a1, color: '#ffffff' },
      { size: H2, acts: genome.a2, color: '#ffffff' },
      { size: OUT, labels: ['R','G','B'], colors: ['#ff5555','#55ff55','#5555ff'] }
    ];
    const layerCount = layers.length;
    const padX = 50, padY = 15;
    const usableW = W - padX * 2;
    const usableH = H - padY * 2;

    // Layer x positions
    const lx = layers.map((_, i) => padX + (i / (layerCount - 1)) * usableW);

    // Node positions
    const nodePos = layers.map((l, li) => {
      const positions = [];
      for (let i = 0; i < l.size; i++) {
        const y = padY + ((i + 0.5) / l.size) * usableH;
        positions.push({ x: lx[li], y });
      }
      return positions;
    });

    // Draw connections
    const weightArrays = [genome.w1, genome.w2, genome.w3];
    const fromSizes = [IN, H1, H2];
    const toSizes = [H1, H2, OUT];

    for (let l = 0; l < 3; l++) {
      const ws = weightArrays[l];
      for (let to = 0; to < toSizes[l]; to++) {
        for (let from = 0; from < fromSizes[l]; from++) {
          const w = ws[to * fromSizes[l] + from];
          const absW = Math.abs(w);
          if (absW < 0.05) continue;
          const alpha = Math.min(absW / 2.5, 0.7);
          ctx.strokeStyle = w > 0
            ? `rgba(100, 200, 255, ${alpha})`
            : `rgba(255, 100, 130, ${alpha})`;
          ctx.lineWidth = Math.min(absW * 0.8, 2.5);
          const p1 = nodePos[l][from];
          const p2 = nodePos[l + 1][to];
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }

    // Draw nodes
    for (let li = 0; li < layerCount; li++) {
      const layer = layers[li];
      for (let i = 0; i < layer.size; i++) {
        const pos = nodePos[li][i];
        let nodeColor = layer.color;
        let radius = 5;

        if (layer.colors) nodeColor = layer.colors[i];
        if (layer.acts) nodeColor = ACT_COLORS[layer.acts[i]];

        // Activation highlight
        if (highlightActivations) {
          const layerKeys = ['inputs','h1','h2','out'];
          const val = highlightActivations[layerKeys[li]][i];
          const brightness = clamp(Math.abs(val), 0, 1);
          radius = 4 + brightness * 5;
          ctx.shadowBlur = brightness * 12;
          ctx.shadowColor = nodeColor;
        }

        ctx.fillStyle = nodeColor;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Labels
        if (layer.labels) {
          ctx.fillStyle = 'rgba(200,200,220,0.6)';
          ctx.font = '9px monospace';
          ctx.textAlign = li === 0 ? 'right' : 'left';
          const offsetX = li === 0 ? -10 : 10;
          ctx.fillText(layer.labels[i], pos.x + offsetX, pos.y + 3);
        }

        // Activation function tags
        if (layer.acts) {
          ctx.fillStyle = ACT_COLORS[layer.acts[i]];
          ctx.font = '7px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(ACT_NAMES[layer.acts[i]], pos.x, pos.y - 9);
        }
      }
    }

    // Layer labels
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,200,255,0.3)';
    const layerLabels = ['入力','隠れ層1','隠れ層2','出力'];
    for (let i = 0; i < layerCount; i++) {
      ctx.fillText(layerLabels[i], lx[i], H - 3);
    }

    // Reset canvas dimensions for CSS
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }

  static renderGenomeBar(genome, canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width, H = canvas.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // Concatenate all weights into a single array for visualization
    const allW = [...genome.w1, ...genome.b1, ...genome.w2, ...genome.b2, ...genome.w3, ...genome.b3];
    const segW = W / allW.length;

    for (let i = 0; i < allW.length; i++) {
      const v = clamp(allW[i] / 3, -1, 1);
      const r = v > 0 ? 50 + v * 200 : 50;
      const g = Math.abs(v) < 0.3 ? 80 : 30;
      const b = v < 0 ? 50 + Math.abs(v) * 200 : 50;
      ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
      ctx.fillRect(i * segW, 0, Math.ceil(segW), H);
    }

    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }

  static renderHistoryGraph(history, diversityHistory, canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width, H = canvas.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (diversityHistory.length < 2) {
      ctx.fillStyle = 'rgba(200,200,255,0.3)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('世代を重ねるとグラフが表示されます', W / 2, H / 2);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      return;
    }

    const pad = { top: 20, right: 20, bottom: 30, left: 45 };
    const gW = W - pad.left - pad.right;
    const gH = H - pad.top - pad.bottom;
    const maxDiv = Math.max(...diversityHistory);
    const n = diversityHistory.length;

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (i / 4) * gH;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + gW, y); ctx.stroke();
    }

    // Diversity line
    ctx.strokeStyle = '#00e8ff';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#00e8ff';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pad.left + (i / (n - 1)) * gW;
      const y = pad.top + (1 - diversityHistory[i] / maxDiv) * gH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Selection count line (if available)
    if (history.length > 0) {
      ctx.strokeStyle = '#c840ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const maxSel = Math.max(...history.map(h => h.selectedCount), 1);
      for (let i = 0; i < history.length; i++) {
        const x = pad.left + (i / Math.max(n - 1, 1)) * gW;
        const y = pad.top + (1 - history[i].selectedCount / maxSel) * gH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Axes labels
    ctx.fillStyle = 'rgba(200,200,255,0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('世代', pad.left + gW / 2, H - 5);
    ctx.save();
    ctx.translate(12, pad.top + gH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('多様性', 0, 0);
    ctx.restore();

    // Legend
    ctx.font = '9px sans-serif';
    const legY = 12;
    ctx.fillStyle = '#00e8ff';
    ctx.fillRect(pad.left, legY - 4, 12, 3);
    ctx.fillText('多様性', pad.left + 18, legY);
    ctx.fillStyle = '#c840ff';
    ctx.fillRect(pad.left + 80, legY - 4, 12, 3);
    ctx.fillText('選択数', pad.left + 98, legY);

    // Gen numbers
    ctx.fillStyle = 'rgba(200,200,255,0.4)';
    ctx.textAlign = 'center';
    ctx.font = '9px monospace';
    const step = Math.max(1, Math.floor(n / 8));
    for (let i = 0; i < n; i += step) {
      const x = pad.left + (i / (n - 1)) * gW;
      ctx.fillText(String(i + 1), x, H - 16);
    }

    canvas.style.width = '100%';
    canvas.style.height = 'auto';
  }
}

// ─── Background Particles ────────────────────────────
class BgParticles {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.resize();
    this.initParticles();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.scale(dpr, dpr);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
  }

  initParticles() {
    this.particles = [];
    const count = Math.min(50, Math.floor(this.w * this.h / 15000));
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: 1 + Math.random() * 2,
        alpha: 0.2 + Math.random() * 0.4,
        hue: Math.random() < 0.5 ? 190 : 280
      });
    }
  }

  update() {
    const { ctx, w, h, particles } = this;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
      ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Draw connections
    ctx.lineWidth = 0.5;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = dx * dx + dy * dy;
        if (dist < 12000) {
          const alpha = (1 - dist / 12000) * 0.15;
          ctx.strokeStyle = `rgba(100, 200, 255, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
  }
}

// ─── Toast Notification ──────────────────────────────
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, 2000);
}

// ─── Gallery Manager ─────────────────────────────────
class GalleryManager {
  constructor() {
    this.items = [];
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(GALLERY_KEY);
      this.items = raw ? JSON.parse(raw) : [];
    } catch { this.items = []; }
  }

  save() {
    try { localStorage.setItem(GALLERY_KEY, JSON.stringify(this.items)); }
    catch { /* quota exceeded */ }
  }

  add(genome, generation) {
    if (this.items.length >= MAX_GALLERY) {
      showToast(`ギャラリーが満杯です（最大${MAX_GALLERY}作品）`);
      return false;
    }
    this.items.push({
      genome: deepClone(genome),
      generation,
      timestamp: Date.now()
    });
    this.save();
    return true;
  }

  remove(index) {
    this.items.splice(index, 1);
    this.save();
  }
}

// ─── Main Application ────────────────────────────────
class App {
  constructor() {
    this.evo = new Evolution();
    this.gallery = new GalleryManager();
    this.bgParticles = null;
    this.thumbRes = THUMB_RES_DEFAULT;
    this.cards = [];
    this.inspectIndex = -1;
    this.longPressTimer = null;
  }

  init() {
    // Background
    this.bgParticles = new BgParticles(document.getElementById('bgCanvas'));
    this.startBgLoop();

    // Load saved state or init fresh
    if (!this.loadState()) {
      this.evo.init();
    }

    // Build grid
    this.createGrid();
    this.renderAll();
    this.updateUI();

    // Event listeners
    this.bindEvents();

    // Tutorial
    if (!localStorage.getItem('neurocanvas_tutorial_done')) {
      this.showOverlay('tutorialOverlay');
    }

    // Register SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  createGrid() {
    const container = document.getElementById('gridContainer');
    container.innerHTML = '';
    this.cards = [];
    for (let i = 0; i < POP_SIZE; i++) {
      const card = document.createElement('div');
      card.className = 'art-card';
      card.dataset.index = i;
      const canvas = document.createElement('canvas');
      canvas.width = this.thumbRes;
      canvas.height = this.thumbRes;
      const check = document.createElement('div');
      check.className = 'card-check';
      check.textContent = '✓';
      const idx = document.createElement('div');
      idx.className = 'card-index';
      idx.textContent = '#' + (i + 1);
      card.appendChild(canvas);
      card.appendChild(check);
      card.appendChild(idx);
      container.appendChild(card);
      this.cards.push({ el: card, canvas });
    }
  }

  renderAll() {
    for (let i = 0; i < POP_SIZE; i++) this.renderCard(i);
  }

  renderCard(i) {
    if (i < this.evo.population.length) {
      Renderer.renderArt(this.evo.population[i], this.cards[i].canvas, this.thumbRes);
    }
  }

  updateUI() {
    document.getElementById('genNum').textContent = this.evo.generation;
    document.getElementById('selCount').textContent = this.evo.selected.size;
    document.getElementById('evolveBtn').disabled = this.evo.selected.size === 0;

    // Diversity meter
    const fill = document.getElementById('diversityFill');
    fill.style.width = (this.evo.normalizedDiversity * 100) + '%';

    // Card selection state
    for (let i = 0; i < POP_SIZE; i++) {
      this.cards[i].el.classList.toggle('selected', this.evo.selected.has(i));
    }
  }

  // ─── Event Binding ──────────────────────────────
  bindEvents() {
    const grid = document.getElementById('gridContainer');

    // Card click (tap = select, long press = inspect)
    grid.addEventListener('pointerdown', (e) => {
      const card = e.target.closest('.art-card');
      if (!card) return;
      const idx = parseInt(card.dataset.index);
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        this.showInspect(idx);
      }, 500);
    });

    grid.addEventListener('pointerup', (e) => {
      const card = e.target.closest('.art-card');
      if (!card) return;
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
        const idx = parseInt(card.dataset.index);
        this.evo.toggleSelect(idx);
        this.updateUI();
        this.saveState();
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate(10);
      }
    });

    grid.addEventListener('pointerleave', () => {
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    });
    grid.addEventListener('pointercancel', () => {
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    });

    // Double-click for inspect on desktop
    grid.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.art-card');
      if (card) this.showInspect(parseInt(card.dataset.index));
    });

    // Evolve button
    document.getElementById('evolveBtn').addEventListener('click', () => this.handleEvolve());

    // Random button
    document.getElementById('randomBtn').addEventListener('click', () => {
      this.evo.init();
      this.animateCards();
      this.renderAll();
      this.updateUI();
      this.saveState();
      showToast('🎲 新しい集団を生成しました');
    });

    // Tool buttons
    document.getElementById('historyBtn').addEventListener('click', () => this.showHistory());
    document.getElementById('galleryBtn').addEventListener('click', () => this.showGallery());
    document.getElementById('settingsBtn').addEventListener('click', () => this.showSettings());

    // Close buttons
    document.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.close || btn.closest('.overlay').id;
        this.hideOverlay(id);
      });
    });

    // Overlay backdrop clicks
    document.querySelectorAll('.overlay-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', () => {
        this.hideOverlay(backdrop.closest('.overlay').id);
      });
    });

    // Tutorial start
    document.getElementById('tutorialStart').addEventListener('click', () => {
      localStorage.setItem('neurocanvas_tutorial_done', '1');
      this.hideOverlay('tutorialOverlay');
    });

    // Inspect actions
    document.getElementById('saveBtn').addEventListener('click', () => {
      if (this.inspectIndex >= 0) {
        if (this.gallery.add(this.evo.population[this.inspectIndex], this.evo.generation)) {
          showToast('💾 ギャラリーに保存しました');
        }
      }
    });

    document.getElementById('downloadBtn').addEventListener('click', () => {
      if (this.inspectIndex >= 0) this.downloadArt(this.inspectIndex);
    });

    // Settings
    const sldRate = document.getElementById('sldMutRate');
    const sldStr = document.getElementById('sldMutStr');
    const selRes = document.getElementById('selResolution');

    sldRate.addEventListener('input', () => {
      const v = parseFloat(sldRate.value);
      document.getElementById('valMutRate').textContent = Math.round(v * 100) + '%';
      this.evo.mutationRate = v;
      this.saveState();
    });

    sldStr.addEventListener('input', () => {
      const v = parseFloat(sldStr.value);
      document.getElementById('valMutStr').textContent = v.toFixed(1);
      this.evo.mutationStrength = v;
      this.saveState();
    });

    selRes.addEventListener('change', () => {
      this.thumbRes = parseInt(selRes.value);
      this.renderAll();
      this.saveState();
    });

    // Reset
    document.getElementById('resetBtn').addEventListener('click', () => {
      if (confirm('すべてのデータをリセットしますか？')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(GALLERY_KEY);
        localStorage.removeItem('neurocanvas_tutorial_done');
        this.evo.init();
        this.gallery = new GalleryManager();
        this.renderAll();
        this.updateUI();
        this.hideOverlay('settingsOverlay');
        showToast('🔄 リセットしました');
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !document.getElementById('evolveBtn').disabled) {
        this.handleEvolve();
      }
      if (e.key === 'Escape') {
        document.querySelectorAll('.overlay:not(.hidden)').forEach(o => {
          if (o.id !== 'tutorialOverlay') this.hideOverlay(o.id);
        });
      }
    });

    // Load settings into UI
    sldRate.value = this.evo.mutationRate;
    document.getElementById('valMutRate').textContent = Math.round(this.evo.mutationRate * 100) + '%';
    sldStr.value = this.evo.mutationStrength;
    document.getElementById('valMutStr').textContent = this.evo.mutationStrength.toFixed(1);
    selRes.value = this.thumbRes;
  }

  // ─── Evolve Action ─────────────────────────────
  handleEvolve() {
    if (this.evo.evolve()) {
      this.animateCards();
      this.renderAll();
      this.updateUI();
      this.saveState();

      // Generation flash
      const genNum = document.getElementById('genNum');
      genNum.style.transition = 'none';
      genNum.style.transform = 'scale(1.5)';
      genNum.style.color = '#ffffff';
      requestAnimationFrame(() => {
        genNum.style.transition = 'all 0.5s ease';
        genNum.style.transform = 'scale(1)';
        genNum.style.color = '';
      });

      showToast(`🧬 世代 ${this.evo.generation} に進化しました`);
    }
  }

  animateCards() {
    this.cards.forEach((c, i) => {
      c.el.classList.remove('evolving');
      void c.el.offsetWidth; // force reflow
      setTimeout(() => c.el.classList.add('evolving'), i * 50);
    });
  }

  // ─── Inspect Mode ──────────────────────────────
  showInspect(idx) {
    this.inspectIndex = idx;
    const genome = this.evo.population[idx];
    const cppn = new CPPN(genome);

    // Render high-res art
    Renderer.renderArt(genome, document.getElementById('inspectCanvas'), FULL_RES);

    // Render network with center activations
    const acts = cppn.getActivations(0, 0);
    Renderer.renderNetwork(genome, document.getElementById('networkCanvas'), acts);

    // Render genome bar
    Renderer.renderGenomeBar(genome, document.getElementById('genomeCanvas'));

    // Symmetry & scale info
    document.getElementById('inspectSymmetry').textContent = '対称: ' + SYMMETRY_NAMES[genome.symmetry];
    document.getElementById('inspectScale').textContent = 'スケール: ' + genome.scale.toFixed(2);

    // Genome stats
    const totalWeights = genome.w1.length + genome.w2.length + genome.w3.length;
    const totalParams = totalWeights + genome.b1.length + genome.b2.length + genome.b3.length;
    const actCounts = {};
    for (const a of [...genome.a1, ...genome.a2]) {
      actCounts[ACT_NAMES[a]] = (actCounts[ACT_NAMES[a]] || 0) + 1;
    }
    const actSummary = Object.entries(actCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}:${count}`)
      .join(' ');

    document.getElementById('genomeStats').innerHTML =
      `パラメータ数: ${totalParams} | 層構造: ${IN}→${H1}→${H2}→${OUT}<br>` +
      `活性化関数: ${actSummary}`;

    // Activation legend
    const legend = document.querySelector('.act-legend');
    legend.innerHTML = '';
    for (let i = 0; i < NUM_ACT; i++) {
      const tag = document.createElement('span');
      tag.className = 'act-tag';
      tag.style.borderColor = ACT_COLORS[i];
      tag.style.color = ACT_COLORS[i];
      tag.textContent = ACT_NAMES[i];
      legend.appendChild(tag);
    }

    this.showOverlay('inspectOverlay');
  }

  // ─── History View ──────────────────────────────
  showHistory() {
    const timeline = document.getElementById('historyTimeline');
    const empty = document.getElementById('historyEmpty');
    timeline.innerHTML = '';

    if (this.evo.history.length === 0) {
      empty.style.display = '';
      document.getElementById('historyGraphWrap').style.display = 'none';
    } else {
      empty.style.display = 'none';
      document.getElementById('historyGraphWrap').style.display = '';

      // Render diversity graph
      Renderer.renderHistoryGraph(
        this.evo.history,
        this.evo.diversityHistory,
        document.getElementById('historyGraph')
      );

      // Render timeline items
      for (const entry of this.evo.history) {
        const item = document.createElement('div');
        item.className = 'history-item';
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        Renderer.renderArt(entry.genome, canvas, 64);
        const label = document.createElement('div');
        label.className = 'history-gen';
        label.textContent = 'G' + entry.generation;
        item.appendChild(canvas);
        item.appendChild(label);
        // Click to inspect
        item.addEventListener('click', () => {
          // Temporarily show this genome
          const tempCppn = new CPPN(entry.genome);
          Renderer.renderArt(entry.genome, document.getElementById('inspectCanvas'), FULL_RES);
          const acts = tempCppn.getActivations(0, 0);
          Renderer.renderNetwork(entry.genome, document.getElementById('networkCanvas'), acts);
          Renderer.renderGenomeBar(entry.genome, document.getElementById('genomeCanvas'));
          document.getElementById('inspectSymmetry').textContent = '対称: ' + SYMMETRY_NAMES[entry.genome.symmetry];
          document.getElementById('inspectScale').textContent = 'スケール: ' + entry.genome.scale.toFixed(2);
          document.getElementById('genomeStats').textContent = `世代 ${entry.generation} のベスト | 選択数: ${entry.selectedCount}`;
          this.inspectIndex = -1; // Mark as history view
          this.showOverlay('inspectOverlay');
        });
        timeline.appendChild(item);
      }
    }

    this.showOverlay('historyOverlay');
  }

  // ─── Gallery View ──────────────────────────────
  showGallery() {
    const grid = document.getElementById('galleryGrid');
    const empty = document.getElementById('galleryEmpty');
    grid.innerHTML = '';

    if (this.gallery.items.length === 0) {
      empty.style.display = '';
    } else {
      empty.style.display = 'none';
      this.gallery.items.forEach((item, idx) => {
        const el = document.createElement('div');
        el.className = 'gallery-item';
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 128;
        Renderer.renderArt(item.genome, canvas, 128);
        const info = document.createElement('div');
        info.className = 'gallery-item-info';
        info.textContent = `G${item.generation} | ${new Date(item.timestamp).toLocaleDateString('ja-JP')}`;
        const del = document.createElement('button');
        del.className = 'gallery-item-del';
        del.textContent = '✕';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          this.gallery.remove(idx);
          this.showGallery(); // Re-render
          showToast('🗑️ 削除しました');
        });
        el.appendChild(canvas);
        el.appendChild(info);
        el.appendChild(del);
        // Click to inspect
        el.addEventListener('click', () => {
          Renderer.renderArt(item.genome, document.getElementById('inspectCanvas'), FULL_RES);
          const cppn = new CPPN(item.genome);
          const acts = cppn.getActivations(0, 0);
          Renderer.renderNetwork(item.genome, document.getElementById('networkCanvas'), acts);
          Renderer.renderGenomeBar(item.genome, document.getElementById('genomeCanvas'));
          document.getElementById('inspectSymmetry').textContent = '対称: ' + SYMMETRY_NAMES[item.genome.symmetry];
          document.getElementById('inspectScale').textContent = 'スケール: ' + item.genome.scale.toFixed(2);
          document.getElementById('genomeStats').textContent = `ギャラリー作品 | 世代${item.generation}で保存`;
          this.inspectIndex = -1;
          this.showOverlay('inspectOverlay');
        });
        grid.appendChild(el);
      });
    }

    this.showOverlay('galleryOverlay');
  }

  // ─── Settings View ─────────────────────────────
  showSettings() {
    this.showOverlay('settingsOverlay');
  }

  // ─── Download Art ──────────────────────────────
  downloadArt(idx) {
    const genome = idx >= 0 ? this.evo.population[idx] : null;
    if (!genome) return;
    const tempCanvas = document.createElement('canvas');
    Renderer.renderArt(genome, tempCanvas, EXPORT_RES);
    const link = document.createElement('a');
    link.download = `neurocanvas_gen${this.evo.generation}_${Date.now()}.png`;
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
    showToast('📥 ダウンロードしました');
  }

  // ─── Overlay Management ────────────────────────
  showOverlay(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  hideOverlay(id) {
    document.getElementById(id).classList.add('hidden');
  }

  // ─── State Persistence ─────────────────────────
  saveState() {
    try {
      const state = {
        population: this.evo.population,
        generation: this.evo.generation,
        selected: [...this.evo.selected],
        history: this.evo.history,
        diversityHistory: this.evo.diversityHistory,
        currentDiversity: this.evo.currentDiversity,
        mutationRate: this.evo.mutationRate,
        mutationStrength: this.evo.mutationStrength,
        thumbRes: this.thumbRes,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* quota */ }
  }

  loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const state = JSON.parse(raw);
      this.evo.population = state.population;
      this.evo.generation = state.generation;
      this.evo.selected = new Set(state.selected);
      this.evo.history = state.history || [];
      this.evo.diversityHistory = state.diversityHistory || [];
      this.evo.currentDiversity = state.currentDiversity || 0;
      this.evo.mutationRate = state.mutationRate || 0.15;
      this.evo.mutationStrength = state.mutationStrength || 0.5;
      this.thumbRes = state.thumbRes || THUMB_RES_DEFAULT;
      return true;
    } catch { return false; }
  }

  // ─── Background Animation Loop ─────────────────
  startBgLoop() {
    const loop = () => {
      this.bgParticles.update();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

// ─── Boot ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
