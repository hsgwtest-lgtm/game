/**
 * viewer.js — SoftEvo7 保存生物の閲覧・再学習モジュール (v2)
 * engine.js と同一のレンダリング・物理コードを使用
 */

import { loadAllCreatures } from './creatureSaveManager.js';

// ═══ 物理パラメータ定義 (engine.js COF_DEFS 物理セクション) ══════════
const PHYS_DEFS = [
  { key: 'gravity',         label: '重力',     min: 0,    max: 1.5,  step: 0.05  },
  { key: 'airDrag',         label: '空気抵抗', min: 0.9,  max: 1.0,  step: 0.005 },
  { key: 'groundFriction',  label: '地面摩擦', min: 0.1,  max: 1.0,  step: 0.05  },
  { key: 'bounce',          label: '反発係数', min: 0,    max: 0.8,  step: 0.05  },
  { key: 'constraintIter',  label: '制約反復', min: 1,    max: 12,   step: 1     },
  { key: 'boneStiffness',   label: '骨剛性',   min: 0.1,  max: 1.0,  step: 0.05  },
  { key: 'muscleStiffness', label: '筋肉剛性', min: 0.05, max: 0.8,  step: 0.05  },
];

// engine.js の COF 初期値と同一
const DEFAULT_COF = {
  gravity: 0.35, airDrag: 0.995, groundFriction: 0.6, bounce: 0.15,
  constraintIter: 5, boneStiffness: 0.6, muscleStiffness: 0.3,
};

// ═══ 状態 ═══════════════════════════════════════════════════════════
let simCOF      = Object.assign({}, DEFAULT_COF);
let savedCofRef = null;          // 保存時の COF (リセット用)

let slots        = Array(10).fill(null);
let selectedSlot = null;
let selectedData = null;
let creature     = null;
let simTime      = 0;
let isPaused     = false;
let simSpeed     = 1;
let camX         = 0;
let groundY      = 400;
let lastTs       = 0;
let stepAccum    = 0;
let savedScore   = 80;           // getColor() のスコア基準

// ラップタイム追跡
let lapTimes        = [];        // { milestone: number, elapsed: number }[]  直近3件
let lapLastMilestone = 0;        // 最後に通過した 500m 境界 (m)
let lapSegmentStart  = 0;        // そのセグメント開始時の simTime

/** @type {HTMLCanvasElement} */ let canvas;
/** @type {CanvasRenderingContext2D} */ let ctx;
/** @type {HTMLCanvasElement} */ let neuralCanvas;
/** @type {CanvasRenderingContext2D} */ let nCtx;

// ═══ NeuralNet ══════════════════════════════════════════════════════
class NeuralNet {
  constructor(layerSizes) {
    this.layers      = layerSizes.slice();
    this.weights     = [];
    this.biases      = [];
    this.activations = layerSizes.map(n => new Float32Array(n));
  }

  setGenome(g) {
    this.weights = g.weights.map(w => new Float32Array(w));
    this.biases  = g.biases.map(b => new Float32Array(b));
  }

  predict(input) {
    let cur = new Float32Array(input);
    const lim = Math.min(cur.length, this.activations[0].length);
    for (let i = 0; i < lim; i++) this.activations[0][i] = cur[i];

    for (let l = 0; l < this.weights.length; l++) {
      const w = this.weights[l], b = this.biases[l];
      const inSz = this.layers[l], outSz = this.layers[l + 1];
      const out = new Float32Array(outSz);
      for (let j = 0; j < outSz; j++) {
        let sum = b[j];
        for (let i = 0; i < inSz; i++) sum += cur[i] * w[i * outSz + j];
        const isLast = l === this.weights.length - 1;
        out[j] = isLast
          ? 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, sum))))
          : Math.max(0, sum);
        this.activations[l + 1][j] = out[j];
      }
      cur = out;
    }
    return cur;
  }
}

// ═══ SoftBody (engine.js と同一構造) ════════════════════════════════
class SoftBody {
  constructor(x, y, bp, genome, h1 = 12, h2 = 8) {
    const nc = bp.nodes.length;
    let cx = 0, cy = 0;
    for (const n of bp.nodes) { cx += n.x; cy += n.y; }
    cx /= nc; cy /= nc;

    this.startX = x;
    this.maxX   = x;
    this.fitness = 0;
    this.totalMuscleOutput = 0;

    this.nodes = bp.nodes.map(n => ({
      x:  x + (n.x - cx), y:  y + (n.y - cy),
      ox: x + (n.x - cx), oy: y + (n.y - cy),
      radius: n.radius, mass: 1.0, grounded: false,
    }));

    // engine.js と同じフィールド名: restLength, stiffness
    this.bones = bp.bones.map(b => {
      const na = this.nodes[b.a], nb = this.nodes[b.b];
      const dx = nb.x - na.x, dy = nb.y - na.y;
      return { a: b.a, b: b.b, restLength: Math.sqrt(dx * dx + dy * dy), stiffness: simCOF.boneStiffness };
    });

    // engine.js と同じフィールド名: restLength, currentTarget, stiffness
    this.muscles    = [];
    this.muscleAct  = [];
    for (const m of bp.muscles) {
      const na = this.nodes[m.a], nb = this.nodes[m.b];
      const dx = nb.x - na.x, dy = nb.y - na.y;
      const rl = Math.sqrt(dx * dx + dy * dy);
      this.muscles.push({ a: m.a, b: m.b, restLength: rl, currentTarget: rl, stiffness: simCOF.muscleStiffness });
      this.muscleAct.push(0.5);
    }

    const mc   = this.muscles.length;
    const inSz = nc * 2 + mc + nc + 1;
    this.brain = new NeuralNet([inSz, h1, h2, mc]);
    if (genome) this.brain.setGenome(genome);
    this.trail = [];
  }

  getCenterX() { let s = 0; for (const n of this.nodes) s += n.x; return s / this.nodes.length; }
  getCenterY() { let s = 0; for (const n of this.nodes) s += n.y; return s / this.nodes.length; }

  // engine.js getColor() と同一アルゴリズム (savedScore を bestEverFitness として使用)
  getColor() {
    const maxFit = Math.max(savedScore, 80);
    const rawFit = this.maxX - this.startX;
    const t = Math.min(1, Math.max(0, rawFit / maxFit));
    return [Math.floor(100 + 155 * t), Math.floor(80 + 140 * t), Math.floor(240 * (1 - t) + 50 * t)];
  }

  // engine.js updateBrain() + getInputs() と同一
  update(time) {
    const inputs = [];
    for (const n of this.nodes) {
      inputs.push((n.x - n.ox) * 0.1);
      inputs.push((n.y - n.oy) * 0.1);
    }
    for (const m of this.muscles) {
      const na = this.nodes[m.a], nb = this.nodes[m.b];
      const dx = nb.x - na.x, dy = nb.y - na.y;
      inputs.push(Math.sqrt(dx * dx + dy * dy) / (m.restLength + 0.001) - 1.0);
    }
    for (const n of this.nodes) inputs.push(n.grounded ? 1.0 : 0.0);
    inputs.push(Math.sin(time * 5));

    const outputs = this.brain.predict(inputs);
    let totalOut = 0;
    for (let i = 0; i < this.muscles.length; i++) {
      const act = outputs[i] !== undefined ? outputs[i] : 0.5;
      this.muscleAct[i] = act;
      this.muscles[i].currentTarget = this.muscles[i].restLength * (0.4 + 0.6 * act);
      this.muscles[i].stiffness = simCOF.muscleStiffness;
      totalOut += Math.abs(act - 0.5);
    }
    for (const b of this.bones) b.stiffness = simCOF.boneStiffness;
    this.totalMuscleOutput = totalOut / Math.max(1, this.muscles.length);
  }

  // engine.js physicStep() と同一 (平地版)
  physics(gY) {
    for (const n of this.nodes) {
      const vx = (n.x - n.ox) * simCOF.airDrag;
      const vy = (n.y - n.oy) * simCOF.airDrag;
      n.ox = n.x; n.oy = n.y;
      n.x += vx; n.y += vy + simCOF.gravity;
      n.grounded = false;
    }
    for (let iter = 0; iter < simCOF.constraintIter; iter++) {
      for (const b of this.bones)
        solveConstraint(this.nodes[b.a], this.nodes[b.b], b.restLength, b.stiffness);
      for (const m of this.muscles)
        solveConstraint(this.nodes[m.a], this.nodes[m.b], m.currentTarget, m.stiffness);
    }
    // 地面衝突 (平地)
    for (const n of this.nodes) {
      if (n.y + n.radius > gY) {
        n.y = gY - n.radius;
        const vy = n.y - n.oy;
        const vx = n.x - n.ox;
        n.oy = n.y + vy * simCOF.bounce;
        n.ox = n.x - vx * simCOF.groundFriction;
        n.grounded = true;
      }
    }
    // 追跡
    const cx = this.getCenterX();
    this.maxX   = Math.max(this.maxX, cx);
    this.fitness = cx - this.startX;
    if (Math.round(simTime * 60) % 4 === 0) {
      this.trail.push({ x: cx, y: this.getCenterY() });
      if (this.trail.length > 80) this.trail.shift();
    }
  }
}

// engine.js solveConstraint() と同一
function solveConstraint(a, b, targetLen, stiffness) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return;
  const diff = (targetLen - dist) / dist * stiffness * 0.5;
  const mx = dx * diff, my = dy * diff;
  const totalMass = a.mass + b.mass;
  const ra = b.mass / totalMass, rb = a.mass / totalMass;
  a.x -= mx * ra; a.y -= my * ra;
  b.x += mx * rb; b.y += my * rb;
}

// ═══ Helpers ════════════════════════════════════════════════════════
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══ Slot UI ════════════════════════════════════════════════════════
function renderSlotList() {
  const container = document.getElementById('viewer-slot-list');
  container.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const slot   = slots[i];
    const slotNo = i + 1;
    const div    = document.createElement('div');
    div.className = [
      'v-slot-item',
      slot ? 'v-slot-filled' : 'v-slot-empty',
      selectedSlot === slotNo ? 'v-slot-selected' : '',
    ].join(' ').trim();

    if (slot) {
      const d  = new Date(slot.savedAt);
      const ds = `${d.getMonth() + 1}/${d.getDate()}`;
      div.innerHTML =
        `<div class="v-slot-num">Slot ${slotNo}</div>` +
        `<div class="v-slot-name">${esc(slot.name)}</div>` +
        `<div class="v-slot-score">🏆 ${slot.score}</div>` +
        `<div class="v-slot-date">${ds}</div>`;
      div.addEventListener('click', () => selectSlot(slotNo));
    } else {
      div.innerHTML =
        `<div class="v-slot-num">Slot ${slotNo}</div>` +
        `<div class="v-slot-empty-lbl">空き</div>`;
    }
    container.appendChild(div);
  }
}

// ═══ Select & Spawn ══════════════════════════════════════════════════
function selectSlot(slotNo) {
  selectedSlot = slotNo;
  selectedData = slots[slotNo - 1];
  renderSlotList();
  if (!selectedData) return;

  // COF を保存データから読み込む (なければデフォルト)
  savedCofRef = selectedData.cof ?? null;
  for (const def of PHYS_DEFS) {
    simCOF[def.key] = (savedCofRef && savedCofRef[def.key] !== undefined)
      ? savedCofRef[def.key]
      : DEFAULT_COF[def.key];
  }
  buildCofPanel(savedCofRef);

  spawnCreature(selectedData);
  renderStats(selectedData);
  // 環境を再現ボタンの有効/無効
  const restoreBtn = document.getElementById('btn-restore-env');
  if (restoreBtn) restoreBtn.disabled = !savedCofRef;
  const relearnBtn = document.getElementById('btn-relearn-seed');
  if (relearnBtn) relearnBtn.disabled = false;
}

function spawnCreature(data) {
  if (!data.blueprint?.nodes?.length) return;
  simTime  = 0;
  camX     = 0;
  isPaused = false;
  stepAccum = 0;
  lapTimes = [];
  lapLastMilestone = 0;
  lapSegmentStart  = 0;
  savedScore = Math.max(data.score ?? 80, 80);
  document.getElementById('btn-viewer-pause').textContent = '⏸';

  const rect   = canvas.getBoundingClientRect();
  groundY      = rect.height * 0.72;
  const spawnX = 300, spawnY = groundY - 60;

  const genome = data.genome ? {
    weights: data.genome.weights.map(w => new Float32Array(w)),
    biases:  data.genome.biases.map(b => new Float32Array(b)),
  } : null;

  const h1 = data.cof?.hiddenSize1 ?? 12;
  const h2 = data.cof?.hiddenSize2 ?? 8;
  creature = new SoftBody(spawnX, spawnY, data.blueprint, genome, h1, h2);
  document.getElementById('viewer-distance').textContent = '距離: 0';
  renderLapTimes();
}

function resetCreature() {
  if (selectedData) spawnCreature(selectedData);
}

// ═══ Stats ══════════════════════════════════════════════════════════
function renderStats(data) {
  const grid = document.getElementById('viewer-stats-grid');
  if (!grid) return;

  const d   = new Date(data.savedAt);
  const ds  = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const bp  = data.blueprint;
  const nc  = bp?.nodes?.length   ?? 0;
  const nb  = bp?.bones?.length   ?? 0;
  const nm  = bp?.muscles?.length ?? 0;
  const h1  = data.cof?.hiddenSize1 ?? 12;
  const h2  = data.cof?.hiddenSize2 ?? 8;
  const inSz = nc * 2 + nm + nc + 1;

  grid.innerHTML = `
    <div class="v-stat"><span class="v-stat-label">🏆 保存スコア</span><span class="v-stat-val">${data.score}</span></div>
    <div class="v-stat"><span class="v-stat-label">🧬 保存世代</span><span class="v-stat-val">Gen ${data.generation}</span></div>
    <div class="v-stat"><span class="v-stat-label">📅 保存日時</span><span class="v-stat-val v-small">${ds}</span></div>
    <div class="v-stat-divider"></div>
    <div class="v-stat"><span class="v-stat-label">⊕ ノード</span><span class="v-stat-val">${nc}</span></div>
    <div class="v-stat"><span class="v-stat-label">🦴 ボーン</span><span class="v-stat-val">${nb}</span></div>
    <div class="v-stat"><span class="v-stat-label">💪 筋肉</span><span class="v-stat-val">${nm}</span></div>
    <div class="v-stat-divider"></div>
    <div class="v-stat"><span class="v-stat-label">📥 入力数</span><span class="v-stat-val">${inSz}</span></div>
    <div class="v-stat"><span class="v-stat-label">🧠 隠れ層</span><span class="v-stat-val">${h1} / ${h2}</span></div>
    <div class="v-stat"><span class="v-stat-label">📤 出力数</span><span class="v-stat-val">${nm}</span></div>
    <div class="v-stat-divider"></div>
    <div class="v-stat"><span class="v-stat-label">📏 現在距離</span><span class="v-stat-val" id="v-stat-dist">—</span></div>
    <div class="v-stat"><span class="v-stat-label">🎯 最大距離</span><span class="v-stat-val" id="v-stat-max">—</span></div>
  `;
}

// ═══ COF チューニングパネル ════════════════════════════════════════
function buildCofPanel(savedCof) {
  const panel = document.getElementById('viewer-cof-panel');
  if (!panel) return;
  panel.innerHTML = '';

  for (const def of PHYS_DEFS) {
    const row     = document.createElement('div');
    row.className = 'v-cof-row';

    const label     = document.createElement('label');
    label.className = 'v-cof-label';
    label.textContent = def.label;

    const slider     = document.createElement('input');
    slider.type      = 'range';
    slider.min       = def.min;
    slider.max       = def.max;
    slider.step      = def.step;
    slider.value     = simCOF[def.key];
    slider.className = 'v-cof-slider';

    const valSpan     = document.createElement('span');
    valSpan.className = 'v-cof-val';
    const decimals = def.step < 0.01 ? 3 : def.step < 0.1 ? 2 : def.step < 1 ? 1 : 0;
    valSpan.textContent = Number(simCOF[def.key]).toFixed(decimals);

    slider.addEventListener('input', () => {
      simCOF[def.key] = parseFloat(slider.value);
      valSpan.textContent = parseFloat(slider.value).toFixed(decimals);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valSpan);
    panel.appendChild(row);
  }

  // 保存時環境に戻すボタン (savedCof がある場合のみ)
  if (savedCof) {
    const btn     = document.createElement('button');
    btn.className = 'v-cof-reset-btn';
    btn.textContent = '↺ 保存時の環境に戻す';
    btn.addEventListener('click', () => {
      for (const def of PHYS_DEFS) {
        if (savedCof[def.key] !== undefined) simCOF[def.key] = savedCof[def.key];
      }
      buildCofPanel(savedCof);
    });
    panel.appendChild(btn);
  }
}

// ═══ Sim Canvas Render ══════════════════════════════════════════════
function render() {
  const dpr = window.devicePixelRatio || 1;
  const cw  = canvas.width  / dpr;
  const ch  = canvas.height / dpr;
  const gY  = groundY;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  // 背景グラデーション
  const bg = ctx.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#060c1a');
  bg.addColorStop(0.5, '#060a14');
  bg.addColorStop(1, '#040810');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);

  // 地面
  ctx.fillStyle = 'rgba(99,210,255,0.06)';
  ctx.fillRect(0, gY, cw, ch - gY);
  ctx.strokeStyle = 'rgba(99,210,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, gY); ctx.lineTo(cw, gY); ctx.stroke();

  // グリッド
  ctx.strokeStyle = 'rgba(99,210,255,0.04)';
  ctx.lineWidth = 1;
  const gridSp = 100;
  for (let gx = -camX % gridSp; gx < cw; gx += gridSp) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, gY); ctx.stroke();
  }

  // 距離マーカー
  ctx.strokeStyle = 'rgba(167,139,250,0.1)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 6]);
  for (let mx = 100; mx < 8000; mx += 100) {
    const sx = mx - camX;
    if (sx < 0 || sx > cw) continue;
    ctx.beginPath(); ctx.moveTo(sx, gY - 16); ctx.lineTo(sx, gY); ctx.stroke();
    if (mx % 500 === 0) {
      ctx.fillStyle = 'rgba(167,139,250,0.35)';
      ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${mx}`, sx, gY - 19);
    }
  }
  ctx.setLineDash([]);

  if (!creature) {
    ctx.fillStyle = 'rgba(167,139,250,0.4)';
    ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('スロットを選択してください', cw / 2, ch / 2);
    return;
  }

  ctx.save();
  ctx.translate(-camX, 0);

  // スタートマーカー
  ctx.strokeStyle = 'rgba(129,140,248,0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(creature.startX, gY - 70);
  ctx.lineTo(creature.startX, gY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(129,140,248,0.5)';
  ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('START', creature.startX, gY - 74);

  // 軌跡
  if (creature.trail.length > 1) {
    const c = creature.getColor();
    for (let t = 1; t < creature.trail.length; t++) {
      const alpha = (t / creature.trail.length) * 0.25;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(creature.trail[t - 1].x, creature.trail[t - 1].y);
      ctx.lineTo(creature.trail[t].x, creature.trail[t].y);
      ctx.stroke();
    }
  }

  // 生物描画 (engine.js drawCreature() と同一)
  drawCreature(creature, false, simTime);

  ctx.restore();

  // ライブ距離更新
  const dist = Math.round(creature.getCenterX() - creature.startX);
  const maxD = Math.round(creature.maxX - creature.startX);
  document.getElementById('viewer-distance').textContent = `距離: ${dist}`;
  const sd = document.getElementById('v-stat-dist');
  const sm = document.getElementById('v-stat-max');
  if (sd) sd.textContent = dist;
  if (sm) sm.textContent = maxD;
}

// ═══ drawCreature (engine.js drawCreature() と同一) ══════════════
// isFocused=false / showMuscles=true / showNeural=true / showLabels=false
function drawCreature(body, isFocused, _simTime) {
  const nodes = body.nodes, nc = nodes.length;
  const col = body.getColor();
  const colStr = `rgb(${col[0]},${col[1]},${col[2]})`;

  let cx = 0, cy = 0;
  for (const n of nodes) { cx += n.x; cy += n.y; }
  cx /= nc; cy /= nc;

  const sorted = nodes.slice().sort((a, b) =>
    Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  if (isFocused) {
    ctx.strokeStyle = 'rgba(251,191,36,0.4)'; ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Membrane
  ctx.globalAlpha = 0.3; ctx.fillStyle = colStr; ctx.beginPath();
  if (sorted.length >= 3) {
    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i], next = sorted[(i + 1) % sorted.length];
      const midX = (curr.x + next.x) / 2, midY = (curr.y + next.y) / 2;
      if (i === 0) {
        const prev = sorted[sorted.length - 1];
        ctx.moveTo((prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
      }
      ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
    }
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1.0;

  // Bones
  ctx.strokeStyle = 'rgba(200,210,230,0.25)'; ctx.lineWidth = 1;
  for (const b of body.bones) {
    const na = nodes[b.a], nb = nodes[b.b];
    ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y); ctx.stroke();
  }

  // Muscles with pulse animation (engine.js と同一カラーロジック)
  for (let i = 0; i < body.muscles.length; i++) {
    const m = body.muscles[i], na = nodes[m.a], nb = nodes[m.b];
    const dx = nb.x - na.x, dy = nb.y - na.y;
    const curLen = Math.sqrt(dx * dx + dy * dy);
    const ratio  = curLen / m.restLength;
    const act    = body.muscleAct[i];
    let mr, mg, mb;
    if (ratio < 0.85) { mr = 255; mg = 100; mb = 60; }
    else if (ratio > 1.05) { mr = 80; mg = 140; mb = 255; }
    else {
      const t = (ratio - 0.85) / 0.2;
      mr = Math.floor(255 * (1 - t) + 80 * t);
      mg = Math.floor(100 * (1 - t) + 140 * t);
      mb = Math.floor(60 * (1 - t) + 255 * t);
    }
    const lw = act > 0.5 ? 1 + act * 2.5 : 1;
    const pulseAlpha = 0.4 + act * 0.4;
    ctx.strokeStyle = `rgba(${mr},${mg},${mb},${pulseAlpha})`;
    ctx.lineWidth = lw;

    // 神経パルス (showNeural=true と同等)
    if (act > 0.6) {
      const pulsePos = (_simTime * 3 + i) % 1;
      const px = na.x + dx * pulsePos, py = na.y + dy * pulsePos;
      ctx.fillStyle = `rgba(${mr},${mg},${mb},0.8)`;
      ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
    }

    ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y); ctx.stroke();
  }

  // Nodes with firing glow
  for (const n of nodes) {
    ctx.fillStyle = colStr;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.8; ctx.stroke();
    if (n.grounded) {
      ctx.fillStyle = 'rgba(129,255,140,0.4)';
      ctx.beginPath(); ctx.arc(n.x, n.y, n.radius * 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Neural signal glow on nodes (showNeural=true)
  if (body.brain.activations.length > 0) {
    const outActs = body.brain.activations[body.brain.activations.length - 1];
    for (let i = 0; i < Math.min(outActs.length, body.muscles.length); i++) {
      const act = outActs[i];
      if (act > 0.5) {
        const m = body.muscles[i];
        const na = nodes[m.a], nb = nodes[m.b];
        const glowR = 3 + act * 4;
        ctx.fillStyle = `rgba(99,255,200,${act * 0.3})`;
        ctx.beginPath(); ctx.arc(na.x, na.y, glowR, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(nb.x, nb.y, glowR, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Eyes (engine.js と同一)
  let frontNode = nodes[0];
  for (const n of nodes) if (n.x > frontNode.x) frontNode = n;
  const eyeAngle = Math.atan2(frontNode.y - cy, frontNode.x - cx);
  const perpX = -Math.sin(eyeAngle), perpY = Math.cos(eyeAngle);
  const eyeR = 2.5, eyeSpread = 3.5;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(frontNode.x + perpX * eyeSpread * 0.5, frontNode.y + perpY * eyeSpread * 0.5, eyeR, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(frontNode.x - perpX * eyeSpread * 0.5, frontNode.y - perpY * eyeSpread * 0.5, eyeR, 0, Math.PI * 2); ctx.fill();
  const pOff = 0.8;
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(frontNode.x + perpX * eyeSpread * 0.5 + Math.cos(eyeAngle) * pOff, frontNode.y + perpY * eyeSpread * 0.5 + Math.sin(eyeAngle) * pOff, eyeR * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(frontNode.x - perpX * eyeSpread * 0.5 + Math.cos(eyeAngle) * pOff, frontNode.y - perpY * eyeSpread * 0.5 + Math.sin(eyeAngle) * pOff, eyeR * 0.5, 0, Math.PI * 2); ctx.fill();
}

// ═══ renderNeuralMonitor (engine.js renderNeuralMonitor() と同一) ══
function renderNeuralMonitor() {
  const nc = neuralCanvas;
  if (!nc || !nCtx || !creature) return;

  const body        = creature;
  const brain       = body.brain;
  const acts        = brain.activations;
  const nodeCount   = body.nodes.length;
  const muscleCount = body.muscles.length;
  const dpr         = window.devicePixelRatio || 1;

  const dispNodes   = Math.min(nodeCount, 8);
  const dispMuscles = Math.min(muscleCount, 10);
  const hiddenLayers = brain.layers.length - 2;

  // 常に非コンパクトモード
  const compact = false;
  const pad = 8, barH = 6, barGap = 1, catH = 11, secGap = 4;
  const labelW = 20, inputBarW = 54;
  const colInputX = pad, colInputTotalW = labelW + inputBarW, inputBarX = colInputX + labelW;

  const titleH  = 18;
  const velH    = catH + dispNodes   * (barH + barGap) + secGap;
  const musH    = catH + dispMuscles * (barH + barGap) + secGap;
  const gndH    = catH + 20 + secGap;
  const rhtH    = catH + barH + pad;
  const neededH = titleH + velH + musH + gndH + rhtH;
  const canvasH = Math.max(neededH, 200);
  nc.style.height = canvasH + 'px';

  const cw = nc.clientWidth, ch = nc.clientHeight;
  if (nc.width  !== Math.round(cw * dpr) || nc.height !== Math.round(ch * dpr)) {
    nc.width  = Math.round(cw * dpr);
    nc.height = Math.round(ch * dpr);
  }
  nCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  nCtx.clearRect(0, 0, cw, ch);
  nCtx.fillStyle = 'rgba(4,6,10,0.92)'; nCtx.fillRect(0, 0, cw, ch);

  const outLabelW = 20, outBarW = 56;
  const colOutTotalW = outLabelW + outBarW;
  const colOutX = cw - pad - colOutTotalW;
  const outBarX = colOutX + outLabelW;

  const hidX0 = colInputX + colInputTotalW + pad;
  const hidX1 = colOutX - pad;
  const hidW  = Math.max(1, hidX1 - hidX0);
  const hidAreaTopY = 20, hidAreaH = ch - 28;

  function getHiddenPos(hl) {
    const layerIdx = hl + 1;
    const count = Math.min(brain.layers[layerIdx], 20);
    const hlX = hidX0 + (hidW / (hiddenLayers + 1)) * (hl + 1);
    const spacing = Math.min(16, (hidAreaH - 8) / Math.max(1, count));
    const totalH = (count - 1) * spacing;
    const startY = hidAreaTopY + (hidAreaH - totalH) / 2;
    return Array.from({ length: count }, (_, n) => ({ x: hlX, y: startY + n * spacing }));
  }

  // PASS 1: 入力エントリ位置を計算
  const inputEntries = [];
  let inputIdx = 0;
  let iy = titleH;

  iy += catH;
  for (let i = 0; i < dispNodes; i++) {
    inputEntries.push({ y: iy + barH / 2, colorBase: 'rgba(251,191,36,', inputIndices: [inputIdx, inputIdx + 1] });
    iy += barH + barGap; inputIdx += 2;
  }
  iy += secGap;

  iy += catH;
  for (let i = 0; i < dispMuscles; i++) {
    inputEntries.push({ y: iy + barH / 2, colorBase: 'rgba(52,211,153,', inputIndices: [inputIdx] });
    iy += barH + barGap; inputIdx++;
  }
  iy += secGap;

  iy += catH;
  const gndDotY = iy + 4;
  for (let i = 0; i < dispNodes; i++) {
    inputEntries.push({ y: gndDotY, colorBase: 'rgba(99,210,255,', inputIndices: [inputIdx] });
    inputIdx++;
  }
  iy += 20; iy += secGap;

  iy += catH;
  inputEntries.push({ y: iy + barH / 2, colorBase: 'rgba(167,139,250,', inputIndices: [inputIdx] });

  const inputOwner = new Array(brain.layers[0]).fill(-1);
  for (let ei = 0; ei < inputEntries.length; ei++) {
    for (const ii of inputEntries[ei].inputIndices) {
      if (ii < inputOwner.length) inputOwner[ii] = ei;
    }
  }

  const outLayerIdx = brain.layers.length - 1;
  const outEntries = [];
  let oiy = titleH + catH;
  for (let i = 0; i < dispMuscles; i++) {
    outEntries.push({ y: oiy + barH / 2, idx: i });
    oiy += barH + barGap;
  }

  // PASS 2: 描画
  nCtx.textBaseline = 'middle';

  // 入力→H1 シグナル線
  if (hiddenLayers > 0) {
    const h1Pos  = getHiddenPos(0);
    const h1Size = brain.layers[1];
    const wt0    = brain.weights[0];
    const inCount = brain.layers[0];
    const fromX = colInputX + colInputTotalW + 2;

    for (let j = 0; j < h1Pos.length; j++) {
      const entrySignal = new Float32Array(inputEntries.length);
      for (let i = 0; i < inCount; i++) {
        const ei = inputOwner[i];
        if (ei < 0) continue;
        entrySignal[ei] += (wt0[i * h1Size + j] || 0) * (acts[0][i] || 0);
      }
      const { x: toX, y: toY } = h1Pos[j];
      for (let ei = 0; ei < inputEntries.length; ei++) {
        const s = entrySignal[ei];
        const absS = Math.abs(s);
        if (absS < 0.08) continue;
        const alpha = Math.min(0.5, absS * 0.18);
        const { colorBase, y: srcY } = inputEntries[ei];
        nCtx.strokeStyle = s > 0 ? `${colorBase}${alpha})` : `rgba(248,113,113,${alpha})`;
        nCtx.lineWidth = Math.min(2, absS * 0.3);
        const cpX = fromX + (toX - 4 - fromX) * 0.5;
        nCtx.beginPath(); nCtx.moveTo(fromX, srcY); nCtx.quadraticCurveTo(cpX, srcY, toX - 4, toY); nCtx.stroke();
        if (absS > 0.4) {
          const t = (simTime * 2.0 + j * 0.13 + srcY * 0.003) % 1;
          const mt = 1 - t;
          const px = mt * mt * fromX + 2 * mt * t * cpX + t * t * (toX - 4);
          const py = mt * mt * srcY  + 2 * mt * t * srcY  + t * t * toY;
          nCtx.fillStyle = s > 0 ? `${colorBase}${Math.min(0.9, alpha * 3)})` : `rgba(248,113,113,${Math.min(0.9, alpha * 3)})`;
          nCtx.beginPath(); nCtx.arc(px, py, 1.5, 0, Math.PI * 2); nCtx.fill();
        }
      }
    }
  }

  // 隠れ層間 シグナル線
  for (let hl = 0; hl < hiddenLayers - 1; hl++) {
    const fromPos = getHiddenPos(hl);
    const toPos   = getHiddenPos(hl + 1);
    const fLayerIdx = hl + 1, tLayerIdx = hl + 2;
    const wt = brain.weights[hl + 1];
    const tSize = brain.layers[tLayerIdx];
    for (let j = 0; j < toPos.length; j++) {
      for (let i = 0; i < fromPos.length; i++) {
        const w = (wt[i * tSize + j]) || 0;
        const s = Math.abs(w * (acts[fLayerIdx][i] || 0));
        if (s < 0.06) continue;
        const alpha = Math.min(0.4, s * 0.35);
        nCtx.strokeStyle = w > 0 ? `rgba(129,140,248,${alpha})` : `rgba(248,113,113,${alpha})`;
        nCtx.lineWidth = Math.min(1.8, s * 0.8);
        nCtx.beginPath(); nCtx.moveTo(fromPos[i].x + 4, fromPos[i].y); nCtx.lineTo(toPos[j].x - 4, toPos[j].y); nCtx.stroke();
        if (s > 0.2) {
          const t = (simTime * 2.2 + i * 0.11 + j * 0.08) % 1;
          const px = (fromPos[i].x + 4) + (toPos[j].x - 4 - fromPos[i].x - 4) * t;
          const py = fromPos[i].y + (toPos[j].y - fromPos[i].y) * t;
          nCtx.fillStyle = w > 0 ? `rgba(129,140,248,${alpha * 2})` : `rgba(248,113,113,${alpha * 2})`;
          nCtx.beginPath(); nCtx.arc(px, py, 1.2, 0, Math.PI * 2); nCtx.fill();
        }
      }
    }
  }

  // 最終隠れ層→出力 シグナル線
  if (hiddenLayers > 0) {
    const lastHlIdx = hiddenLayers - 1;
    const lastPos = getHiddenPos(lastHlIdx);
    const wt = brain.weights[brain.weights.length - 1];
    const outSize = brain.layers[outLayerIdx];
    const actLayer = hiddenLayers;
    for (let j = 0; j < outEntries.length; j++) {
      for (let i = 0; i < lastPos.length; i++) {
        const w = (wt[i * outSize + j]) || 0;
        const s = Math.abs(w * (acts[actLayer][i] || 0));
        if (s < 0.08) continue;
        const alpha = Math.min(0.35, s * 0.3);
        nCtx.strokeStyle = w > 0 ? `rgba(52,211,153,${alpha})` : `rgba(248,113,113,${alpha})`;
        nCtx.lineWidth = Math.min(1.5, s);
        nCtx.beginPath(); nCtx.moveTo(lastPos[i].x + 5, lastPos[i].y); nCtx.lineTo(colOutX - 2, outEntries[j].y); nCtx.stroke();
        if (s > 0.25) {
          const t = (simTime * 2.5 + i * 0.13 + j * 0.09) % 1;
          const fx = lastPos[i].x + 5, tx = colOutX - 2;
          nCtx.fillStyle = w > 0 ? `rgba(52,211,153,${alpha * 2})` : `rgba(248,113,113,${alpha * 2})`;
          nCtx.beginPath(); nCtx.arc(fx + (tx - fx) * t, lastPos[i].y + (outEntries[j].y - lastPos[i].y) * t, 1.2, 0, Math.PI * 2); nCtx.fill();
        }
      }
    }
  }

  // 隠れノード
  for (let hl = 0; hl < hiddenLayers; hl++) {
    const layerIdx = hl + 1;
    const positions = getHiddenPos(hl);
    if (positions.length > 0) {
      nCtx.fillStyle = 'rgba(129,140,248,0.55)';
      nCtx.font = '7px -apple-system,sans-serif';
      nCtx.textAlign = 'center'; nCtx.textBaseline = 'top';
      nCtx.fillText(`H${hl + 1}(${brain.layers[layerIdx]})`, positions[0].x, 2);
      nCtx.textBaseline = 'middle';
    }
    for (let n = 0; n < positions.length; n++) {
      const { x: hx, y: hy } = positions[n];
      const activation = Math.abs(acts[layerIdx][n] || 0);
      const r = 2.5 + activation * 3;
      if (activation > 0.2) {
        nCtx.fillStyle = `rgba(129,140,248,${activation * 0.15})`;
        nCtx.beginPath(); nCtx.arc(hx, hy, r + 5, 0, Math.PI * 2); nCtx.fill();
      }
      const br = Math.floor(60 + activation * 190);
      nCtx.fillStyle = `rgb(${Math.floor(br * 0.5)},${Math.floor(br * 0.6)},${br})`;
      nCtx.beginPath(); nCtx.arc(hx, hy, r, 0, Math.PI * 2); nCtx.fill();
      nCtx.strokeStyle = `rgba(255,255,255,${0.15 + activation * 0.3})`;
      nCtx.lineWidth = 0.5; nCtx.stroke();
    }
  }

  // タイトルバー
  nCtx.font = 'bold 9px -apple-system,sans-serif';
  nCtx.fillStyle = '#63d2ff'; nCtx.textAlign = 'left'; nCtx.textBaseline = 'middle';
  nCtx.fillText(selectedData?.name || '生物', pad, 9);
  nCtx.fillStyle = 'rgba(99,210,255,0.6)';
  nCtx.font = '8px -apple-system,sans-serif';
  nCtx.fillText(`Fit:${Math.round(body.fitness || 0)}`, pad + 50, 9);

  // 描画ヘルパー
  function drawCatHeader(x, yy, text, color) {
    nCtx.fillStyle = color;
    nCtx.font = 'bold 8px -apple-system,sans-serif';
    nCtx.textAlign = 'left'; nCtx.textBaseline = 'top';
    nCtx.fillText(text, x, yy);
    nCtx.textBaseline = 'middle';
  }
  function drawBar(x, yy, w, val, maxVal, color, label) {
    const ratio = Math.min(1, Math.max(0, (val + maxVal) / (2 * maxVal)));
    nCtx.fillStyle = 'rgba(255,255,255,0.06)'; nCtx.fillRect(x, yy, w, barH);
    nCtx.fillStyle = color; nCtx.fillRect(x, yy, ratio * w, barH);
    nCtx.fillStyle = 'rgba(255,255,255,0.12)'; nCtx.fillRect(x + w * 0.5, yy, 1, barH);
    if (label) {
      nCtx.fillStyle = 'rgba(255,255,255,0.5)';
      nCtx.font = '6px -apple-system,sans-serif'; nCtx.textAlign = 'right';
      nCtx.fillText(label, x - 2, yy + barH / 2);
    }
  }
  function drawBar01(x, yy, w, val, color, label) {
    const ratio = Math.min(1, Math.max(0, val));
    nCtx.fillStyle = 'rgba(255,255,255,0.06)'; nCtx.fillRect(x, yy, w, barH);
    nCtx.fillStyle = color; nCtx.fillRect(x, yy, ratio * w, barH);
    if (label) {
      nCtx.fillStyle = 'rgba(255,255,255,0.5)';
      nCtx.font = '6px -apple-system,sans-serif'; nCtx.textAlign = 'right';
      nCtx.fillText(label, x - 2, yy + barH / 2);
    }
  }

  // 入力列
  inputIdx = 0;
  let drawY = titleH;

  drawCatHeader(colInputX, drawY, '⚡速度', 'rgba(251,191,36,0.8)'); drawY += catH;
  for (let i = 0; i < dispNodes; i++) {
    const vx = acts[0][inputIdx] || 0, vy = acts[0][inputIdx + 1] || 0;
    drawBar01(inputBarX, drawY, inputBarW, Math.sqrt(vx * vx + vy * vy) * 2, 'rgba(251,191,36,0.6)', `N${i}`);
    drawY += barH + barGap; inputIdx += 2;
  }
  drawY += secGap;

  drawCatHeader(colInputX, drawY, '🔗筋肉', 'rgba(52,211,153,0.8)'); drawY += catH;
  for (let i = 0; i < dispMuscles; i++) {
    drawBar(inputBarX, drawY, inputBarW, acts[0][inputIdx] || 0, 1, 'rgba(52,211,153,0.6)', `M${i}`);
    drawY += barH + barGap; inputIdx++;
  }
  drawY += secGap;

  drawCatHeader(colInputX, drawY, '⬇接地', 'rgba(99,210,255,0.8)'); drawY += catH;
  const dotSpacing = colInputTotalW / Math.max(1, dispNodes);
  for (let i = 0; i < dispNodes; i++) {
    const grounded = acts[0][inputIdx] || 0;
    const dotX = colInputX + dotSpacing * (i + 0.5);
    nCtx.fillStyle = grounded > 0.5 ? 'rgba(99,210,255,0.9)' : 'rgba(99,210,255,0.15)';
    nCtx.beginPath(); nCtx.arc(dotX, drawY + 4, 3, 0, Math.PI * 2); nCtx.fill();
    nCtx.fillStyle = 'rgba(255,255,255,0.3)';
    nCtx.font = '5px -apple-system,sans-serif'; nCtx.textAlign = 'center'; nCtx.textBaseline = 'top';
    nCtx.fillText(i, dotX, drawY + 9); nCtx.textBaseline = 'middle';
    inputIdx++;
  }
  drawY += 20; drawY += secGap;

  drawCatHeader(colInputX, drawY, '♪リズム', 'rgba(167,139,250,0.8)'); drawY += catH;
  drawBar(inputBarX, drawY, inputBarW, acts[0][inputIdx] || 0, 1, 'rgba(167,139,250,0.6)', 'sin');

  // 出力列
  drawCatHeader(colOutX, titleH, '💪出力', 'rgba(52,211,153,0.9)');
  let drawOY = titleH + catH;
  for (let i = 0; i < dispMuscles; i++) {
    const act = acts[outLayerIdx][i] || 0;
    const g = Math.floor(120 + act * 135);
    drawBar01(outBarX, drawOY, outBarW, act, `rgba(50,${g},${Math.floor(g * 0.7)},0.8)`, `M${i}`);
    nCtx.fillStyle = 'rgba(255,255,255,0.35)';
    nCtx.font = '6px -apple-system,sans-serif'; nCtx.textAlign = 'left';
    nCtx.fillText(`${Math.round(act * 100)}%`, outBarX + outBarW + 2, drawOY + barH / 2);
    drawOY += barH + barGap;
  }

  // 凡例
  const legendY = ch - 5;
  nCtx.font = '6px -apple-system,sans-serif'; nCtx.textBaseline = 'middle';
  const legends = [
    { color: 'rgba(251,191,36,0.8)', text: '速度' },
    { color: 'rgba(52,211,153,0.8)', text: '筋肉' },
    { color: 'rgba(99,210,255,0.8)', text: '接地' },
    { color: 'rgba(167,139,250,0.8)', text: 'リズム' },
  ];
  let lx = pad;
  for (const lg of legends) {
    nCtx.fillStyle = lg.color; nCtx.fillRect(lx, legendY - 3, 5, 3);
    nCtx.fillStyle = 'rgba(255,255,255,0.4)'; nCtx.textAlign = 'left';
    nCtx.fillText(lg.text, lx + 7, legendY - 1); lx += 34;
  }
  nCtx.fillStyle = 'rgba(52,211,153,0.5)'; nCtx.fillRect(lx + 2, legendY - 2, 10, 1.5);
  nCtx.fillStyle = 'rgba(255,255,255,0.4)'; nCtx.fillText('興奮', lx + 14, legendY - 1); lx += 34;
  nCtx.fillStyle = 'rgba(248,113,113,0.5)'; nCtx.fillRect(lx, legendY - 2, 10, 1.5);
  nCtx.fillStyle = 'rgba(255,255,255,0.4)'; nCtx.fillText('抑制', lx + 12, legendY - 1);
}

// ═══ Lap Times ════════════════════════════════════════════════════════
function renderLapTimes() {
  const el = document.getElementById('viewer-lap-times');
  if (!el) return;
  if (lapTimes.length === 0) {
    el.innerHTML = '<span class="lap-empty">500m毎にタイム表示</span>';
    return;
  }
  el.innerHTML = lapTimes.map(l =>
    `<span class="lap-item">🏁 ${l.milestone}m <strong>${l.elapsed.toFixed(1)}s</strong></span>`
  ).join('');
}

// ═══ Main Loop ═══════════════════════════════════════════════════════
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (!isPaused && creature) {
    stepAccum += simSpeed * 60 * dt;
    const steps  = Math.floor(stepAccum);
    stepAccum -= steps;
    const stepDt = 1 / 60;
    for (let s = 0; s < steps; s++) {
      creature.update(simTime);
      creature.physics(groundY);
      simTime += stepDt;
    }
    // カメラ追従
    const tx = creature.getCenterX() - (canvas.width / (window.devicePixelRatio || 1)) / 2;
    camX += (tx - camX) * 0.08;
    if (camX < 0) camX = 0;

    // 500m ラップタイム追跡
    const distM = Math.floor(creature.getCenterX() - creature.startX);
    const nextMilestone = lapLastMilestone + 500;
    if (distM >= nextMilestone) {
      const elapsed = simTime - lapSegmentStart;
      lapTimes.push({ milestone: nextMilestone, elapsed });
      if (lapTimes.length > 3) lapTimes.shift();
      lapLastMilestone = nextMilestone;
      lapSegmentStart  = simTime;
      renderLapTimes();
    }
    // 5000m 到達で自動リセット
    if (distM >= 5000) {
      resetCreature();
    }
  }

  render();
  renderNeuralMonitor();
}

// ═══ Resize ══════════════════════════════════════════════════════════
function resize() {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const nw   = Math.round(rect.width  * dpr);
  const nh   = Math.round(rect.height * dpr);
  if (canvas.width !== nw || canvas.height !== nh) {
    canvas.width  = nw;
    canvas.height = nh;
    groundY = rect.height * 0.72;
  }
}

// ═══ Controls ════════════════════════════════════════════════════════
function togglePause() {
  isPaused = !isPaused;
  document.getElementById('btn-viewer-pause').textContent = isPaused ? '▶' : '⏸';
}

// ═══ Tab Switch ══════════════════════════════════════════════════════
function switchTab(tabName) {
  document.querySelectorAll('.v-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.v-tab-content').forEach(s => {
    s.classList.toggle('active', s.id === `viewer-${tabName}-section`);
  });
}

// ═══ Re-learn ════════════════════════════════════════════════════════
function startRelearn(useSeed) {
  if (!selectedData?.blueprint) return;
  const data = {
    blueprint: selectedData.blueprint,
    genome:    useSeed ? selectedData.genome : null,
    fresh:     !useSeed,
    cof:       selectedData.cof ?? null,
  };
  try {
    localStorage.setItem('softevo7_relearn', JSON.stringify(data));
  } catch (e) {
    console.warn('localStorage write failed:', e);
  }
  window.location.href = 'index.html';
}

// ═══ Init ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  canvas       = document.getElementById('viewer-canvas');
  ctx          = canvas.getContext('2d');
  neuralCanvas = document.getElementById('viewer-neural');
  nCtx         = neuralCanvas.getContext('2d');

  resize();
  window.addEventListener('resize', resize);

  // スロット読み込み
  try {
    slots = await loadAllCreatures();
  } catch (e) {
    slots = Array(10).fill(null);
    console.warn('slot load error:', e);
  }
  renderSlotList();

  // ボタン
  document.getElementById('btn-viewer-pause').addEventListener('click', togglePause);
  document.getElementById('btn-viewer-reset').addEventListener('click', resetCreature);
  document.getElementById('btn-relearn-seed').addEventListener('click',  () => startRelearn(true));
  document.getElementById('btn-restore-env')?.addEventListener('click', () => {
    if (!savedCofRef) return;
    for (const def of PHYS_DEFS) {
      if (savedCofRef[def.key] !== undefined) simCOF[def.key] = savedCofRef[def.key];
    }
    buildCofPanel(savedCofRef);
    // 環境設定タブに切り替え
    switchTab('cof');
  });

  document.querySelectorAll('.viewer-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.viewer-speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      simSpeed = parseFloat(btn.dataset.speed);
      isPaused = false;
      document.getElementById('btn-viewer-pause').textContent = '⏸';
    });
  });

  // タブ切り替え
  document.querySelectorAll('.v-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // URLパラメータで初期スロット指定
  const params    = new URLSearchParams(location.search);
  const slotParam = parseInt(params.get('slot'));
  if (slotParam >= 1 && slotParam <= 10 && slots[slotParam - 1]) {
    selectSlot(slotParam);
  }

  lastTs = performance.now();
  requestAnimationFrame(loop);
});
