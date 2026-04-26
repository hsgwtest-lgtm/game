/**
 * race.js — SoftEvo7 専用レースモード
 * localStorage の 'softevo7_race' から参加者を読み込み、全員同一スタート位置でレースを実施
 */

// ═══ 定数 ═══════════════════════════════════════════════════════════
const RACE_DURATION = 30;   // 秒
const SPAWN_X       = 300;  // 全員共通スタートX
const GROUND_FRAC   = 0.72; // canvas高さに対する地面比率

const RACER_COLORS = [
  [251, 191,  36],  // Gold
  [ 99, 210, 255],  // Cyan
  [ 52, 211, 153],  // Green
  [167, 139, 250],  // Purple
  [251, 146,  60],  // Orange
  [244, 114, 182],  // Pink
];

const MEDALS = ['🥇', '🥈', '🥉'];

const DEFAULT_COF = {
  gravity: 0.35, airDrag: 0.995, groundFriction: 0.6, bounce: 0.15,
  constraintIter: 5, boneStiffness: 0.6, muscleStiffness: 0.3,
};

// ═══ NeuralNet ═══════════════════════════════════════════════════════
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
      const isLast = l === this.weights.length - 1;
      for (let j = 0; j < outSz; j++) {
        let sum = b[j];
        for (let i = 0; i < inSz; i++) sum += cur[i] * w[i * outSz + j];
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

// ═══ SoftBody ════════════════════════════════════════════════════════
class SoftBody {
  constructor(x, y, bp, genome, h1 = 12, h2 = 8, cof = DEFAULT_COF) {
    this._cof = cof;
    const nc = bp.nodes.length;
    let cx = 0, cy = 0;
    for (const n of bp.nodes) { cx += n.x; cy += n.y; }
    cx /= nc; cy /= nc;

    this.startX       = x;
    this.maxX         = x;
    this.fitness      = 0;
    this.trail        = [];
    this.speed        = 0;   // 瞬間速度 (px/s)
    this.currentRank  = 0;   // 現在のランク

    this.nodes = bp.nodes.map(n => ({
      x: x + (n.x - cx), y: y + (n.y - cy),
      ox: x + (n.x - cx), oy: y + (n.y - cy),
      radius: n.radius, mass: 1.0, grounded: false,
    }));
    this.bones = bp.bones.map(b => {
      const na = this.nodes[b.a], nb = this.nodes[b.b];
      const dx = nb.x - na.x, dy = nb.y - na.y;
      return { a: b.a, b: b.b, restLength: Math.sqrt(dx*dx+dy*dy), stiffness: cof.boneStiffness };
    });
    this.muscles   = [];
    this.muscleAct = [];
    for (const m of bp.muscles) {
      const na = this.nodes[m.a], nb = this.nodes[m.b];
      const dx = nb.x - na.x, dy = nb.y - na.y;
      const rl = Math.sqrt(dx*dx+dy*dy);
      this.muscles.push({ a: m.a, b: m.b, restLength: rl, currentTarget: rl, stiffness: cof.muscleStiffness });
      this.muscleAct.push(0.5);
    }
    const mc   = this.muscles.length;
    const inSz = nc * 2 + mc + nc + 1;
    this.brain = new NeuralNet([inSz, h1, h2, mc]);
    if (genome) this.brain.setGenome(genome);
  }

  getCenterX() { let s = 0; for (const n of this.nodes) s += n.x; return s / this.nodes.length; }
  getCenterY() { let s = 0; for (const n of this.nodes) s += n.y; return s / this.nodes.length; }

  update(time) {
    const inputs = [];
    for (const n of this.nodes) {
      inputs.push((n.x - n.ox) * 0.1);
      inputs.push((n.y - n.oy) * 0.1);
    }
    for (const m of this.muscles) {
      const na = this.nodes[m.a], nb = this.nodes[m.b];
      const dx = nb.x - na.x, dy = nb.y - na.y;
      inputs.push(Math.sqrt(dx*dx+dy*dy) / (m.restLength + 0.001) - 1.0);
    }
    for (const n of this.nodes) inputs.push(n.grounded ? 1.0 : 0.0);
    inputs.push(Math.sin(time * 5));

    const outputs = this.brain.predict(inputs);
    for (let i = 0; i < this.muscles.length; i++) {
      const act = outputs[i] ?? 0.5;
      this.muscleAct[i] = act;
      this.muscles[i].currentTarget = this.muscles[i].restLength * (0.4 + 0.6 * act);
      this.muscles[i].stiffness     = raceCOF.muscleStiffness;
    }
    for (const b of this.bones) b.stiffness = raceCOF.boneStiffness;
  }

  physics(gY) {
    for (const n of this.nodes) {
      const vx = (n.x - n.ox) * raceCOF.airDrag;
      const vy = (n.y - n.oy) * raceCOF.airDrag;
      n.ox = n.x; n.oy = n.y;
      n.x += vx; n.y += vy + raceCOF.gravity;
      n.grounded = false;
    }
    for (let iter = 0; iter < raceCOF.constraintIter; iter++) {
      for (const b of this.bones)
        solveConstraint(this.nodes[b.a], this.nodes[b.b], b.restLength, b.stiffness);
      for (const m of this.muscles)
        solveConstraint(this.nodes[m.a], this.nodes[m.b], m.currentTarget, m.stiffness);
    }
    for (const n of this.nodes) {
      if (n.y + n.radius > gY) {
        n.y = gY - n.radius;
        const vy = n.y - n.oy, vx = n.x - n.ox;
        n.oy = n.y + vy * raceCOF.bounce;
        n.ox = n.x - vx * raceCOF.groundFriction;
        n.grounded = true;
      }
      if (n.x - n.radius < 0) { n.x = n.radius; n.ox = n.x; }
    }
    const cx = this.getCenterX();
    this.maxX    = Math.max(this.maxX, cx);
    this.fitness = cx - this.startX;
    if (Math.round(simTime * 60) % 4 === 0) {
      this.trail.push({ x: cx, y: this.getCenterY() });
      if (this.trail.length > 80) this.trail.shift();
    }
  }
}

function solveConstraint(a, b, targetLen, stiffness) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.sqrt(dx*dx+dy*dy);
  if (dist < 0.001) return;
  const diff = (targetLen - dist) / dist * stiffness * 0.5;
  const mx = dx * diff, my = dy * diff;
  const totalMass = a.mass + b.mass;
  a.x -= mx * (b.mass / totalMass); a.y -= my * (b.mass / totalMass);
  b.x += mx * (a.mass / totalMass); b.y += my * (a.mass / totalMass);
}

// ═══ 状態 ════════════════════════════════════════════════════════════
let raceCOF       = Object.assign({}, DEFAULT_COF);
let participants  = [];  // 読み込んだ参加者データ
let racers        = [];  // SoftBody[] + { name, color, colorStr, raceScore }
let simTime       = 0;
let raceTime      = 0;   // カウントアップ (秒)
let isPaused      = false;
let isFinished    = false;
let isCountdown   = true;
let countdownVal  = 3;
let countdownTimer = 0;
let simSpeed      = 1;
let stepAccum     = 0;    // スロー再生用アキュムレータ
let camX          = 0;
let camTargetIdx  = -1;   // -1 = リーダー追従, ≥ 0 = 特定レーサー追従
let groundY       = 400;
let lastTs        = 0;
let prevRanks     = {};   // 追い抜き検出用
let overtakeEvents = [];  // キャンバス上フローティング通知

/** @type {HTMLCanvasElement} */ let canvas;
/** @type {CanvasRenderingContext2D} */ let ctx;

// ═══ localStorage からデータ読み込み ════════════════════════════════
function loadParticipants() {
  try {
    const raw = localStorage.getItem('softevo7_race');
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

// ═══ レーサー初期化 ══════════════════════════════════════════════════
function spawnRacers() {
  racers = [];
  const dpr    = window.devicePixelRatio || 1;
  const rect   = canvas.getBoundingClientRect();
  groundY      = rect.height * GROUND_FRAC;
  const spawnY = groundY - 60;

  for (let i = 0; i < participants.length; i++) {
    const p    = participants[i];
    const bp   = p.blueprint;
    if (!bp?.nodes?.length) continue;

    const color  = RACER_COLORS[i % RACER_COLORS.length];
    const genome = p.genome ? {
      weights: p.genome.weights.map(w => new Float32Array(w)),
      biases:  p.genome.biases.map(b => new Float32Array(b)),
    } : null;
    const h1 = p.cof?.hiddenSize1 ?? 12;
    const h2 = p.cof?.hiddenSize2 ?? 8;

    const body = new SoftBody(SPAWN_X, spawnY, bp, genome, h1, h2, raceCOF);
    body.racerName  = p.name  || `参加者${i + 1}`;
    body.raceScore  = p.score || 0;
    body.color      = color;
    body.colorStr   = `rgb(${color[0]},${color[1]},${color[2]})`;
    racers.push(body);
  }
}

// ═══ HUD レンダリング ════════════════════════════════════════════════
function renderHUD() {
  const hud = document.getElementById('race-hud');
  if (!hud) return;

  const hintHtml = '<div id="race-hud-hint">📹 タップで視点切替</div>';

  if (racers.length === 0) { hud.innerHTML = hintHtml; return; }

  // ランク順に並べ、currentRank をセット
  const ranked = racers.slice().sort((a, b) => b.fitness - a.fitness);
  ranked.forEach((r, i) => { r.currentRank = i; });
  const maxFit = Math.max(ranked[0].fitness, 1);

  const rowsHtml = ranked.map((r, rank) => {
    const pct      = Math.min(100, Math.max(0, (r.fitness / maxFit) * 100));
    const medal    = MEDALS[rank] ?? `${rank + 1}.`;
    const dist     = Math.round(r.fitness);
    const spd      = Math.round(Math.max(0, r.speed ?? 0));
    const racerIdx = racers.indexOf(r);
    const isCam    = (camTargetIdx === racerIdx) || (camTargetIdx === -1 && rank === 0);
    const c        = r.color;
    return `
      <div class="race-hud-row${isCam ? ' cam-active' : ''}" data-idx="${racerIdx}">
        <span class="race-hud-cam-icon">${isCam ? '📹' : ''}</span>
        <span class="race-hud-medal">${medal}</span>
        <span class="race-hud-name" style="color:rgb(${c[0]},${c[1]},${c[2]})">${esc(r.racerName)}</span>
        <div class="race-hud-bar-wrap">
          <div class="race-hud-bar" style="width:${pct.toFixed(1)}%;background:rgba(${c[0]},${c[1]},${c[2]},0.7)"></div>
        </div>
        <span class="race-hud-dist">${dist}px</span>
        <span class="race-hud-spd">${spd > 0 ? spd : '—'}</span>
      </div>`;
  }).join('');

  hud.innerHTML = rowsHtml + hintHtml;

  // タップで視点切替
  hud.querySelectorAll('.race-hud-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx);
      camTargetIdx = (camTargetIdx === idx) ? -1 : idx;
      renderHUD();
    });
  });
}

// ═══ ライブ順位 (ボトムバー) ════════════════════════════════════════
function renderStandings() {
  const el = document.getElementById('race-live-standings');
  if (!el) return;
  const ranked = racers.slice().sort((a, b) => b.fitness - a.fitness);
  el.innerHTML = ranked.map((r, rank) => {
    const c = r.color;
    return `<span class="race-standing-tag" style="border-color:rgba(${c[0]},${c[1]},${c[2]},0.5);color:rgb(${c[0]},${c[1]},${c[2]})">`
      + `${MEDALS[rank] ?? (rank + 1) + '.'} ${esc(r.racerName)}</span>`;
  }).join('');
}
// ═══ 追い抜き検出 ════════════════════════════════════════════════════
function detectOvertakes() {
  if (racers.length < 2 || raceTime < 1.5) return;
  const ranked = racers.slice().sort((a, b) => b.fitness - a.fitness);
  for (let i = 0; i < ranked.length; i++) {
    const r        = ranked[i];
    const prevRank = prevRanks[r.racerName];
    if (prevRank !== undefined && prevRank > i) {
      overtakeEvents.push({
        startTime: raceTime,
        text:      `${r.racerName} 追い抜き!`,
        color:     r.color,
        worldX:    r.getCenterX(),
        worldY:    r.getCenterY(),
      });
    }
    prevRanks[r.racerName] = i;
  }
  overtakeEvents = overtakeEvents.filter(e => raceTime - e.startTime < 2.5);
}
// ═══ フィニッシュ画面 ════════════════════════════════════════════════
function showFinish() {
  isFinished = true;
  const overlay = document.getElementById('race-finish-overlay');
  const podium  = document.getElementById('race-podium');
  if (!overlay || !podium) return;

  const ranked = racers.slice().sort((a, b) => b.fitness - a.fitness);
  podium.innerHTML = ranked.map((r, rank) => {
    const c   = r.color;
    const med = MEDALS[rank] ?? `${rank + 1}.`;
    return `
      <div class="podium-entry">
        <span class="podium-medal">${med}</span>
        <span class="podium-name" style="color:rgb(${c[0]},${c[1]},${c[2]})">${esc(r.racerName)}</span>
        <span class="podium-dist">${Math.round(r.fitness)} px</span>
      </div>`;
  }).join('');

  overlay.classList.remove('hidden');
}

// ═══ メインキャンバス描画 ════════════════════════════════════════════
function render() {
  const dpr = window.devicePixelRatio || 1;
  const cw  = canvas.width  / dpr;
  const ch  = canvas.height / dpr;
  const gY  = groundY;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, ch);
  bg.addColorStop(0, '#060c1a'); bg.addColorStop(0.5, '#060a14'); bg.addColorStop(1, '#040810');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);

  // 地面
  ctx.fillStyle = 'rgba(99,210,255,0.06)'; ctx.fillRect(0, gY, cw, ch - gY);
  ctx.strokeStyle = 'rgba(99,210,255,0.35)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, gY); ctx.lineTo(cw, gY); ctx.stroke();

  // グリッド
  ctx.strokeStyle = 'rgba(99,210,255,0.04)'; ctx.lineWidth = 1;
  for (let gx = -camX % 100; gx < cw; gx += 100) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, gY); ctx.stroke();
  }

  // 距離マーカー
  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = 'rgba(167,139,250,0.1)'; ctx.lineWidth = 1;
  ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
  for (let mx = 100; mx < 8000; mx += 100) {
    const sx = mx - camX;
    if (sx < -10 || sx > cw + 10) continue;
    ctx.beginPath(); ctx.moveTo(sx, gY - 16); ctx.lineTo(sx, gY); ctx.stroke();
    if (mx % 500 === 0) {
      ctx.fillStyle = 'rgba(167,139,250,0.4)';
      ctx.fillText(`${mx}`, sx, gY - 19);
    }
  }
  ctx.setLineDash([]);

  // スタートライン
  ctx.strokeStyle = 'rgba(251,191,36,0.5)'; ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(SPAWN_X - camX, gY - 80); ctx.lineTo(SPAWN_X - camX, gY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(251,191,36,0.6)'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('START', SPAWN_X - camX, gY - 84);

  if (racers.length === 0) {
    ctx.fillStyle = 'rgba(167,139,250,0.4)'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('参加者を選択してください', cw / 2, ch / 2);
    ctx.textBaseline = 'alphabetic';
    return;
  }

  ctx.save();
  ctx.translate(-camX, 0);

  // 軌跡
  for (const racer of racers) {
    if (racer.trail.length < 2) continue;
    const c = racer.color;
    for (let t = 1; t < racer.trail.length; t++) {
      const alpha = (t / racer.trail.length) * 0.2;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(racer.trail[t - 1].x, racer.trail[t - 1].y);
      ctx.lineTo(racer.trail[t].x, racer.trail[t].y);
      ctx.stroke();
    }
  }

  // 各レーサー描画
  for (const racer of racers) drawRacer(racer);

  // 追い抜きイベント (ワールド座標空間)
  for (const ev of overtakeEvents) {
    const age   = raceTime - ev.startTime;
    const alpha = Math.max(0, 1 - age / 2.5);
    const yOff  = age * 22;
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = `rgb(${ev.color[0]},${ev.color[1]},${ev.color[2]})`;
    ctx.font        = 'bold 11px -apple-system,sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(ev.text, ev.worldX, ev.worldY - 38 - yOff);
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // カウントダウン表示
  if (isCountdown) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, cw, ch);
    ctx.font = 'bold 80px -apple-system,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const pulse = 1 + Math.sin(Date.now() * 0.008) * 0.08;
    ctx.save(); ctx.translate(cw / 2, ch / 2); ctx.scale(pulse, pulse);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(countdownVal > 0 ? String(countdownVal) : 'GO!', 0, 0);
    ctx.restore(); ctx.textBaseline = 'alphabetic';
  }
}

// ═══ レーサー描画 (engine.js drawCreature と同一) ════════════════════
function drawRacer(body) {
  const nodes = body.nodes, nc = nodes.length;
  const c = body.color;
  const colStr = body.colorStr;

  let cx = 0, cy = 0;
  for (const n of nodes) { cx += n.x; cy += n.y; }
  cx /= nc; cy /= nc;

  const sorted = nodes.slice().sort((a, b) =>
    Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  // Membrane
  ctx.globalAlpha = 0.3; ctx.fillStyle = colStr; ctx.beginPath();
  if (sorted.length >= 3) {
    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i], next = sorted[(i + 1) % sorted.length];
      const midX = (curr.x + next.x) / 2, midY = (curr.y + next.y) / 2;
      if (i === 0) { const prev = sorted[sorted.length - 1]; ctx.moveTo((prev.x + curr.x) / 2, (prev.y + curr.y) / 2); }
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

  // Muscles
  for (let i = 0; i < body.muscles.length; i++) {
    const m = body.muscles[i], na = nodes[m.a], nb = nodes[m.b];
    const dx = nb.x - na.x, dy = nb.y - na.y;
    const curLen = Math.sqrt(dx*dx+dy*dy);
    const ratio  = curLen / m.restLength;
    const act    = body.muscleAct[i];
    let mr, mg, mb;
    if (ratio < 0.85) { mr=255; mg=100; mb=60; }
    else if (ratio > 1.05) { mr=80; mg=140; mb=255; }
    else { const t=(ratio-0.85)/0.2; mr=Math.floor(255*(1-t)+80*t); mg=Math.floor(100*(1-t)+140*t); mb=Math.floor(60*(1-t)+255*t); }
    ctx.strokeStyle = `rgba(${mr},${mg},${mb},${0.4 + act * 0.4})`;
    ctx.lineWidth = act > 0.5 ? 1 + act * 2.5 : 1;
    if (act > 0.6) {
      const pp = (simTime * 3 + i) % 1;
      ctx.fillStyle = `rgba(${mr},${mg},${mb},0.8)`;
      ctx.beginPath(); ctx.arc(na.x + dx * pp, na.y + dy * pp, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y); ctx.stroke();
  }

  // Nodes
  for (const n of nodes) {
    ctx.fillStyle = colStr;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.8; ctx.stroke();
    if (n.grounded) {
      ctx.fillStyle = 'rgba(129,255,140,0.4)';
      ctx.beginPath(); ctx.arc(n.x, n.y, n.radius * 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Eyes
  let frontNode = nodes[0];
  for (const n of nodes) if (n.x > frontNode.x) frontNode = n;
  const eyeAngle = Math.atan2(frontNode.y - cy, frontNode.x - cx);
  const perpX = -Math.sin(eyeAngle), perpY = Math.cos(eyeAngle);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(frontNode.x + perpX * 1.75, frontNode.y + perpY * 1.75, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(frontNode.x - perpX * 1.75, frontNode.y - perpY * 1.75, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(frontNode.x + perpX * 1.75 + Math.cos(eyeAngle) * 0.8, frontNode.y + perpY * 1.75 + Math.sin(eyeAngle) * 0.8, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(frontNode.x - perpX * 1.75 + Math.cos(eyeAngle) * 0.8, frontNode.y - perpY * 1.75 + Math.sin(eyeAngle) * 0.8, 1.2, 0, Math.PI * 2); ctx.fill();

  // メダルバッジ (ランク表示)
  const rankMedal = MEDALS[body.currentRank ?? 0];
  if (rankMedal) {
    ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(rankMedal, cx + 15, cy - 22);
    ctx.textBaseline = 'alphabetic';
  }

  // 名前ラベル
  ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.9)`;
  ctx.font = 'bold 9px -apple-system,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(body.racerName, cx, cy - 16);
  ctx.textBaseline = 'alphabetic';

  // スコアラベル
  const dist = Math.round(body.fitness);
  ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.7)`;
  ctx.font = '8px -apple-system,monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${dist}px`, cx, cy - 26);
  ctx.textBaseline = 'alphabetic';
}

// ═══ カメラ更新 (ターゲット対応) ══════════════════════════════════════════════
function updateCamera() {
  if (racers.length === 0) return;
  const target = (camTargetIdx >= 0 && camTargetIdx < racers.length)
    ? racers[camTargetIdx]
    : racers.reduce((a, b) => (a.getCenterX() > b.getCenterX() ? a : b));
  const dpr = window.devicePixelRatio || 1;
  const cw  = canvas.width / dpr;
  const tx  = target.getCenterX() - cw * 0.45;
  camX += (tx - camX) * 0.06;
  if (camX < 0) camX = 0;
}

// ═══ タイマー表示 ════════════════════════════════════════════════════
function updateTimerDisplay() {
  const el = document.getElementById('race-timer-disp');
  if (!el) return;
  const remaining = Math.max(0, RACE_DURATION - raceTime);
  el.textContent = remaining.toFixed(1) + 's';
  if (remaining < 5) el.classList.add('race-timer-warn');
  else el.classList.remove('race-timer-warn');
}

// ═══ メインループ ════════════════════════════════════════════════════
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (isCountdown) {
    countdownTimer += dt;
    if (countdownTimer >= 1) {
      countdownTimer = 0;
      countdownVal--;
      if (countdownVal < 0) {
        isCountdown = false;
        document.getElementById('race-countdown-overlay').classList.add('hidden');
      } else {
        document.getElementById('race-countdown-num').textContent =
          countdownVal > 0 ? String(countdownVal) : 'GO!';
        document.getElementById('race-countdown-sub').textContent =
          countdownVal > 0 ? 'レースまで…' : '';
      }
    }
    render();
    return;
  }

  if (!isPaused && !isFinished) {
    // スロー再生対応：アキュムレータ方式
    stepAccum += simSpeed * 60 * dt;
    const maxSteps = Math.min(Math.floor(stepAccum), simSpeed >= 1 ? 8 : 1);
    if (maxSteps > 0) {
      stepAccum -= maxSteps;
      const stepDt = 1 / 60;
      for (let s = 0; s < maxSteps; s++) {
        for (const racer of racers) {
          const preCX = racer.getCenterX();
          racer.update(simTime);
          racer.physics(groundY);
          const postCX = racer.getCenterX();
          racer.speed = racer.speed * 0.8 + (postCX - preCX) * 60 * 0.2;
        }
        simTime  += stepDt;
        raceTime += stepDt;
      }
      detectOvertakes();
      updateTimerDisplay();
      renderHUD();
      renderStandings();
      if (raceTime >= RACE_DURATION) showFinish();
    }
  }
  updateCamera();
  render();
}

// ═══ リサイズ ════════════════════════════════════════════════════════
function resize() {
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const nw   = Math.round(rect.width  * dpr);
  const nh   = Math.round(rect.height * dpr);
  if (canvas.width !== nw || canvas.height !== nh) {
    canvas.width  = nw;
    canvas.height = nh;
    groundY = rect.height * GROUND_FRAC;
  }
}

// ═══ ユーティリティ ══════════════════════════════════════════════════
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ═══ 初期化 ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('race-canvas');
  ctx    = canvas.getContext('2d');

  participants = loadParticipants();

  if (participants.length < 2) {
    document.getElementById('race-no-part').classList.remove('hidden');
    document.getElementById('race-countdown-overlay').classList.add('hidden');
    return;
  }

  // 物理パラメータ: 最初の参加者の COF を使用
  const firstCof = participants[0].cof;
  if (firstCof) {
    for (const key of Object.keys(DEFAULT_COF)) {
      if (firstCof[key] !== undefined) raceCOF[key] = firstCof[key];
    }
  }

  resize();
  window.addEventListener('resize', () => { resize(); spawnRacers(); });

  spawnRacers();
  renderHUD();

  // コントロール
  document.getElementById('btn-race-pause-ctrl')?.addEventListener('click', () => {
    isPaused = true;
    document.getElementById('btn-race-pause-ctrl')?.classList.add('active');
    document.getElementById('btn-race-play-ctrl')?.classList.remove('active');
  });
  document.getElementById('btn-race-play-ctrl')?.addEventListener('click', () => {
    isPaused = false;
    document.getElementById('btn-race-play-ctrl')?.classList.add('active');
    document.getElementById('btn-race-pause-ctrl')?.classList.remove('active');
  });

  document.getElementById('btn-race-again').addEventListener('click', () => {
    simTime      = 0;
    raceTime     = 0;
    isPaused     = false;
    isFinished   = false;
    isCountdown  = true;
    countdownVal = 3;
    countdownTimer = 0;
    camX         = 0;
    stepAccum    = 0;
    camTargetIdx = -1;
    prevRanks    = {};
    overtakeEvents = [];
    document.getElementById('race-finish-overlay').classList.add('hidden');
    document.getElementById('race-countdown-overlay').classList.remove('hidden');
    document.getElementById('race-countdown-num').textContent = '3';
    document.getElementById('race-countdown-sub').textContent = 'レースまで…';
    document.getElementById('race-timer-disp').classList.remove('race-timer-warn');
    document.getElementById('btn-race-play-ctrl')?.classList.add('active');
    document.getElementById('btn-race-pause-ctrl')?.classList.remove('active');
    spawnRacers();
    renderHUD();
  });

  document.querySelectorAll('.race-spd-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.race-spd-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      simSpeed  = parseFloat(btn.dataset.speed);
      stepAccum = 0;  // スロー切替時にアキュムレータリセット
    });
  });

  lastTs = performance.now();
  requestAnimationFrame(loop);
});
