/* =====================================================================
   SoftEvo 8 — app.js
   画面の流れ:  ホーム → 設計 → 進化ラボ
   進化ラボ = 劇場 (再生) + 脳 + 推移/歩容/系統/物語/環境
   ===================================================================== */
import { DEFAULT_SETTINGS, PRESETS, TERRAINS, OBJECTIVES, BATTLES, OPENINGS, brainLayout, validateBlueprint, blueprintStats, formatFitness, rhythmHz, gaitDistance, cloneBlueprint, isBattle, prepareFighter, rankName } from './sim.js';
import { LADDER_STREAK } from './evo.js';
import { Builder } from './builder.js';
import { Theater } from './theater.js';
import { Arena } from './arena.js';
import { Lobby, onlineFighter } from './lobby.js';
import * as online from './online.js';
import { BrainView } from './brainview.js';
import { TimelineChart, GaitChart, CladeChart } from './charts.js';
import { drawThumb } from './world.js';
import * as store from './store.js';
import { $, $$, el, toast, confirmDialog, infoDialog, fitCanvas, clamp, muscleHue } from './ui.js';

// ════════════════════════════════════════════════════════════
//  画面切り替え
// ════════════════════════════════════════════════════════════
let screen = 'home';
function show(name) {
  screen = name;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
  document.body.dataset.screen = name;
  if (name === 'home') renderHome();
  if (name === 'build') requestAnimationFrame(() => builder.fit());
  if (name === 'arena') arena.enter();
  if (name === 'online') lobby.enter();
}

// ════════════════════════════════════════════════════════════
//  ホーム
// ════════════════════════════════════════════════════════════
function renderHome() {
  const list = $('#run-list');
  list.innerHTML = '';
  const runs = store.listRuns();
  $('#home-empty').classList.toggle('hidden', runs.length > 0);
  for (const meta of runs) {
    const cv = el('canvas', { class: 'thumb' });
    const B = BATTLES[meta.objective];
    const card = el('article', { class: 'run-card' },
      cv,
      el('div', { class: 'run-info' },
        el('h3', {}, meta.name),
        el('p', {}, B ? `第${meta.gen}世代 · ${B.icon} ${B.name}の特訓 · ${rankName(meta.objective, meta.stage || 0)}`
          : `第${meta.gen}世代 · ${TERRAINS[meta.terrain]?.icon || ''} ${OBJECTIVES[meta.objective]?.name || ''}`),
        el('p', { class: 'run-best' }, meta.best != null ? `🏆 ${formatFitness(meta.best, meta.objective)}` : '—'),
        el('p', { class: 'run-date' }, new Date(meta.updated).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))),
      el('div', { class: 'run-actions' },
        el('button', { class: 'btn primary', onclick: () => resumeRun(meta.id) }, '▶ 続きから'),
        el('button', { class: 'btn ghost', title: 'この体をもとに新しく設計', onclick: () => editFrom(meta.id) }, '✎ 体を編集'),
        el('button', { class: 'btn ghost icon', title: 'ファイルに書き出し', onclick: () => exportRun(meta.id) }, '⤓'),
        el('button', { class: 'btn ghost icon danger-text', title: '削除', onclick: async () => {
          if (await confirmDialog('削除しますか？', `「${meta.name}」の進化の記録をすべて削除します。元に戻せません。`, '削除する', true)) { store.deleteRun(meta.id); renderHome(); }
        } }, '🗑')));
    list.append(card);
    const data = store.loadRun(meta.id);
    requestAnimationFrame(() => data && drawThumb(cv, data.blueprint));
  }
}

function editFrom(id) {
  const d = store.loadRun(id);
  if (!d) return toast('読み込めませんでした');
  openBuilder(d.blueprint, d.name + '・改', d.settings);
}

function exportRun(id) {
  const d = store.loadRun(id);
  if (d) store.downloadJSON({ softevo8: 1, ...d }, `softevo8-${d.name}.json`);
}

async function importRun() {
  try {
    const d = await store.pickJSONFile();
    if (!d || !d.blueprint || !d.softevo8) throw new Error('形式が違います');
    d.id = store.uid();
    delete d.softevo8;
    store.saveRun(d, metaOf(d));
    toast(`「${d.name}」を読み込みました`);
    renderHome();
  } catch (e) { if (e.message !== 'no file') toast('読み込みに失敗しました: ' + e.message); }
}

// ════════════════════════════════════════════════════════════
//  設計画面
// ════════════════════════════════════════════════════════════
let buildSettings = { ...DEFAULT_SETTINGS };
const builder = new Builder($('#build-canvas'), {
  onChange: bp => updateBuildInfo(bp),
  onHint: (msg, warn) => setHint(msg, warn),
});

function setHint(msg, warn) {
  const h = $('#build-hint');
  h.textContent = msg; h.classList.toggle('warn', !!warn); h.classList.add('show');
  clearTimeout(setHint.t); setHint.t = setTimeout(() => h.classList.remove('show'), 3200);
}

const TOOL_HINT = {
  node: '空いている所をタップでノード追加。ノードはドラッグで移動',
  bone: 'ノードからノードへドラッグで「骨」(硬い棒)。空白で離すと新ノードごと伸びる',
  muscle: 'ノードからノードへドラッグで「筋肉」(脳が伸び縮みさせる)。辺をタップで変換',
  erase: 'ノードや辺をタップして削除',
};

function updateBuildInfo(bp) {
  const s = blueprintStats(bp);
  const err = validateBlueprint(bp);
  const L = brainLayout(bp, buildSettings);
  $('#build-stats').innerHTML = `<span>● ${s.nodes}</span><span class="bone">━ ${s.bones}</span><span class="muscle">〰 ${s.muscles}</span>` +
    (s.muscles ? `<span class="brainsz" title="脳の大きさ">🧠 ${L.sizes.join('→')}</span>` : '');
  const btn = $('#btn-evolve');
  btn.disabled = !!err;
  $('#build-error').textContent = err || '';
}

function openBuilder(bp, name, settings) {
  buildSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (isBattle(buildSettings.objective)) Object.assign(buildSettings, { objective: DEFAULT_SETTINGS.objective, terrain: DEFAULT_SETTINGS.terrain });
  $('#creature-name').value = name || store.randomName();
  builder.undoStack = []; builder.redoStack = [];
  builder.load(bp || { nodes: [], edges: [] });
  renderBuildSettings();
  show('build');
  setHint(TOOL_HINT[builder.tool]);
}

function renderBuildSettings() {
  const box = $('#build-settings-body');
  box.innerHTML = '';
  const rows = [
    ['population', '個体数', 16, 120, 4, v => `${v}体`],
    ['hidden', '脳: 隠れ層1', 4, 24, 1, v => `${v}個`],
    ['hidden2', '脳: 隠れ層2', 0, 16, 1, v => v ? `${v}個` : 'なし'],
    ['evalSeconds', '評価時間', 5, 30, 1, v => `${v}秒`],
  ];
  for (const [key, label, min, max, step, fmt] of rows) box.append(sliderRow(label, buildSettings[key], min, max, step, fmt, v => { buildSettings[key] = v; updateBuildInfo(builder.bp); }));
  box.append(choiceRow('地形', TERRAINS, buildSettings.terrain, v => { buildSettings.terrain = v; }));
  box.append(choiceRow('目標', OBJECTIVES, buildSettings.objective, v => { buildSettings.objective = v; }));
}

function sliderRow(label, value, min, max, step, fmt, onInput) {
  const out = el('output', {}, fmt(value));
  const inp = el('input', { type: 'range', min, max, step, value });
  inp.addEventListener('input', () => { const v = +inp.value; out.textContent = fmt(v); onInput(v); });
  return el('label', { class: 'slider-row' }, el('span', {}, label), inp, out);
}
function choiceRow(label, defs, value, onPick) {
  const wrap = el('div', { class: 'choice-row' }, el('span', {}, label));
  const seg = el('div', { class: 'seg small' });
  for (const [k, d] of Object.entries(defs)) {
    const b = el('button', { class: k === value ? 'active' : '', onclick: () => { $$('button', seg).forEach(x => x.classList.remove('active')); b.classList.add('active'); onPick(k); } }, `${d.icon} ${d.name}`);
    seg.append(b);
  }
  wrap.append(seg);
  return wrap;
}

function initBuilderUI() {
  $$('#tools [data-tool]').forEach(b => b.addEventListener('click', () => {
    $$('#tools [data-tool]').forEach(x => x.classList.toggle('active', x === b));
    builder.tool = b.dataset.tool; builder.pending = -1;
    setHint(TOOL_HINT[builder.tool]);
  }));
  $('#btn-mirror').addEventListener('click', e => { builder.mirror = !builder.mirror; e.currentTarget.classList.toggle('active', builder.mirror); setHint(builder.mirror ? '左右対称モード: 中心線をはさんで自動でコピーします' : '左右対称モード OFF'); });
  $('#btn-undo').addEventListener('click', () => builder.undo());
  $('#btn-redo').addEventListener('click', () => builder.redo());
  $('#btn-fit').addEventListener('click', () => builder.fit());
  $('#btn-clear').addEventListener('click', async () => { if (!builder.bp.nodes.length || await confirmDialog('全部消しますか？', '設計中の体をすべて消去します（元に戻すで復元できます）', '消去')) builder.clear(); });
  $('#build-home').addEventListener('click', () => show('home'));
  $('#btn-preview').addEventListener('click', () => { if (builder.preview) builder.stopPreview(); else if (builder.startPreview(buildSettings)) setHint('ランダムな脳で動かしています。形が崩れないか確認しよう'); });
  $('#btn-evolve').addEventListener('click', () => {
    const err = validateBlueprint(builder.bp);
    if (err) return setHint(err, true);
    const name = ($('#creature-name').value || '').trim() || store.randomName();
    startLab(newRun(cloneBlueprint(builder.bp), name, buildSettings));
  });
  const pr = $('#presets');
  for (const [k, p] of Object.entries(PRESETS)) {
    pr.append(el('button', { class: 'chip-btn', onclick: () => { builder.load(p.bp, true); setHint(`プリセット「${p.name}」を読み込みました。自由に改造できます`); } }, `${p.icon} ${p.name}`));
  }
  window.addEventListener('keydown', e => {
    if (screen !== 'build' || e.target.tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? builder.redo() : builder.undo(); }
    const map = { 1: 'node', 2: 'bone', 3: 'muscle', 4: 'erase' };
    if (map[e.key]) $(`#tools [data-tool="${map[e.key]}"]`).click();
  });
}

// ════════════════════════════════════════════════════════════
//  実験 (run) データ
// ════════════════════════════════════════════════════════════
function newRun(bp, name, settings, battle = null) {
  return {
    id: store.uid(), name, blueprint: bp, settings: { ...settings }, created: Date.now(), battle,
    history: [], envChanges: [], journal: [], clades: {}, cladeHist: [],
    best: null, lastRecordGait: null, flags: { milestones: [], sweeps: {}, stall: false, lastGaitGen: -99 },
    genTimes: [],
  };
}

function metaOf(d) {
  const m = { id: d.id, name: d.name, gen: d.gen ?? 0, best: d.best ? d.best.fitness : null, terrain: d.settings.terrain, objective: d.settings.objective };
  if (d.battle) m.stage = d.battle.stages[d.battle.stages.length - 1].stage;
  return m;
}

// ─── 対戦の相手 (保存形式 ⇔ メモリ) ───
const fighterOut = f => ({ ...f, g: store.f32ToB64(f.g) });
const fighterIn = f => ({ ...f, g: store.b64ToF32(f.g) });
function serializeBattle(b) {
  return b && { mode: b.mode, ladder: b.ladder, stages: b.stages.map(s => ({ gen: s.gen, stage: s.stage, rivals: s.rivals.map(fighterOut) })), flags: b.flags };
}
function deserializeBattle(b) {
  return b && { mode: b.mode, ladder: b.ladder, stages: b.stages.map(s => ({ gen: s.gen, stage: s.stage, rivals: s.rivals.map(fighterIn) })), flags: b.flags || {} };
}
/** その段階の相手 (この種目の脳に合わせたもの) */
function stageOf(run, stage) {
  const S = run.battle.stages;
  const s = S.find(x => x.stage === stage) || S[S.length - 1];
  if (!s.prepared) s.prepared = s.rivals.map(r => prepareFighter(r, run.settings.objective));
  return s;
}

function serialize(run) {
  const H = run.history;
  const r1 = v => Math.round(v * 10) / 10;
  const keep = new Set();
  for (const j of run.journal) keep.add(j.gen);
  if (run.best) keep.add(run.best.gen);
  if (H.length) keep.add(H[H.length - 1].gen);
  const withG = H.filter(e => e.g);
  const stride = Math.max(1, Math.ceil(withG.length / 30));
  withG.forEach((e, i) => { if (i % stride === 0) keep.add(e.gen); });
  const genomes = withG.filter(e => keep.has(e.gen)).slice(-70).map(e => ({ gen: e.gen, g: store.f32ToB64(e.g), pg: e.pg ? store.f32ToB64(e.pg) : null, clade: e.clade, env: e.env, dist: e.dist }));
  let ch = run.cladeHist;
  if (ch.length > 500) { const s = ch.length / 500; ch = Array.from({ length: 500 }, (_, i) => ch[Math.floor(i * s)]); }
  return {
    v: 1, id: run.id, name: run.name, blueprint: run.blueprint, settings: run.settings, created: run.created,
    gen: H.length ? H[H.length - 1].gen : 0,
    genBase: H.length ? H[0].gen : 0,
    H: { best: H.map(e => r1(e.best)), median: H.map(e => r1(e.median)), p10: H.map(e => r1(e.p10)), p90: H.map(e => r1(e.p90)), bestEver: H.map(e => r1(e.bestEver)), clade: H.map(e => e.clade) },
    envChanges: run.envChanges, journal: run.journal, clades: run.clades, cladeHist: ch,
    genomes,
    best: run.best ? { gen: run.best.gen, fitness: run.best.fitness, dist: run.best.dist, g: store.f32ToB64(run.best.g) } : null,
    lastRecordGait: run.lastRecordGait, flags: run.flags,
    battle: serializeBattle(run.battle),
  };
}

function deserialize(d) {
  const run = newRun(d.blueprint, d.name, { ...DEFAULT_SETTINGS, ...d.settings });
  Object.assign(run, { id: d.id, created: d.created, envChanges: d.envChanges || [], journal: d.journal || [], clades: d.clades || {}, cladeHist: d.cladeHist || [], lastRecordGait: d.lastRecordGait, flags: { ...run.flags, ...(d.flags || {}) } });
  run.battle = deserializeBattle(d.battle);
  const base = d.genBase || 0;
  // 各世代の環境を復元
  const envAt = g => { let env = null; for (const c of run.envChanges) if (c.gen <= g) env = c.env; return env || envOfSettings(run.settings, run, g); };
  const n = d.H ? d.H.best.length : 0;
  for (let i = 0; i < n; i++) {
    run.history.push({ gen: base + i, best: d.H.best[i], median: d.H.median[i], p10: d.H.p10[i], p90: d.H.p90[i], bestEver: d.H.bestEver[i], clade: d.H.clade[i], env: envAt(base + i) });
  }
  for (const gm of d.genomes || []) {
    const e = run.history[gm.gen - base];
    if (e) { e.g = store.b64ToF32(gm.g); e.pg = gm.pg ? store.b64ToF32(gm.pg) : null; e.dist = gm.dist; if (gm.env) e.env = gm.env; }
  }
  if (d.best) run.best = { gen: d.best.gen, fitness: d.best.fitness, dist: d.best.dist, g: store.b64ToF32(d.best.g) };
  return run;
}

/** 設定 → 環境。対戦なら gen 時点 (省略時は最新) の段階も含む */
function envOfSettings(s, run = lab.run, gen = Infinity) {
  const env = { terrain: s.terrain, objective: s.objective, gravity: s.gravity, friction: s.friction, evalSeconds: s.evalSeconds };
  if (run && run.battle) {
    let st = run.battle.stages[0].stage;
    for (const x of run.battle.stages) if (x.gen <= gen) st = x.stage;
    env.stage = st;
  }
  return env;
}

function saveCurrent(silent) {
  if (!lab.run || !lab.run.history.length) return;
  const d = serialize(lab.run);
  const ok = store.saveRun(d, metaOf(d));
  lab.lastSaveGen = d.gen;
  if (!silent) toast(ok ? '💾 保存しました' : '保存できませんでした (容量不足)');
}

function resumeRun(id) {
  const d = store.loadRun(id);
  if (!d) return toast('読み込めませんでした');
  startLab(deserialize(d), true);
}

// ════════════════════════════════════════════════════════════
//  進化ラボ
// ════════════════════════════════════════════════════════════
const lab = {
  run: null, worker: null, mode: 'watch', lastRunMode: 'watch', view: 'live',
  shown: null, pinned: null, rate: 0, lastSaveGen: 0, bout: 0, boutInfo: null, streak: 0,
  dirty: { stats: true, timeline: true, clades: true, journal: true },
  tab: 'timeline',
};

const theater = new Theater($('#theater'), {
  onFinish: () => onReplayFinish(),
  onTapBody: hit => {
    if (!hit) { brainView.select(null); return; }
    const L = lab.run.layout.sizes.length;
    if (hit.muscle != null) brainView.select(L - 1, hit.muscle);
    else if (hit.node != null) brainView.select(0, lab.run.layout.outputs.length + hit.node);
  },
});
const brainView = new BrainView($('#brain'), { onSelect: n => onNeuronSelect(n) });
const timeline = new TimelineChart($('#timeline'), { onPick: g => pinGen(g) });
const gait = new GaitChart($('#gait'));
const cladeChart = new CladeChart($('#clades'), {
  onPick: id => {
    const c = lab.run.clades[id]; if (!c) return;
    const count = lab.run.cladeHist.length ? (lab.run.cladeHist[lab.run.cladeHist.length - 1].c[id] || 0) : 0;
    toast(`系統 ${c.label} — 第${c.born}世代に誕生${c.parent != null && lab.run.clades[c.parent] ? ` (${lab.run.clades[c.parent].label} から分岐)` : ''} · 現在 ${count}体`, 3500);
  },
});

function startLab(run, resumed = false) {
  if (lab.worker) lab.worker.terminate();
  run.layout = brainLayout(run.blueprint, run.settings);
  lab.run = run; lab.shown = null; lab.pinned = null; lab.view = 'live';
  lab.lastSaveGen = run.history.length ? run.history[run.history.length - 1].gen : 0;
  run.genTimes = [];
  theater.setRun(run.blueprint, run.layout);
  theater.main = null;
  brainView.setRun(run.layout);
  timeline.run = run; cladeChart.run = run;
  timeline.selected = null;
  onNeuronSelect(null);
  $('#lab-name').textContent = run.name;
  $$('#view-mode button').forEach(b => b.classList.toggle('active', b.dataset.view === 'live'));
  renderEnvPane();
  Object.keys(lab.dirty).forEach(k => { lab.dirty[k] = true; });

  if (!resumed) {
    if (run.battle) {
      const B = BATTLES[run.settings.objective], r = run.battle.stages[0].rivals[0];
      addJournal(0, B.icon, `${B.name}の特訓開始。相手は「${r.name}」。脳に「対戦感覚」(${B.senses.length}個) が加わった — まだ配線はゼロ`, true, 'start');
    } else addJournal(0, '🥚', `「${run.name}」誕生。ランダムな脳で進化が始まる`, true, 'start');
  }

  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  lab.worker = w;
  w.onmessage = ev => { if (ev.data.type === 'gen') onGen(ev.data.s); };
  w.onerror = e => { console.error(e); toast('進化エンジンでエラーが発生しました'); };
  const last = run.history[run.history.length - 1];
  const lastWithG = [...run.history].reverse().find(e => e.g);
  const opts = { seed: (Math.random() * 2 ** 31) | 0 };
  if (resumed && last) {
    opts.startGen = last.gen + 1;
    opts.seedGenome = lastWithG ? lastWithG.g : run.best?.g;
    opts.bestEver = run.best ? run.best.fitness : null;
    const ids = Object.keys(run.clades).map(Number);
    opts.cladeSeq = ids.length ? Math.max(...ids) + 1 : 0;
    const c = run.clades[last.clade];
    if (c) opts.clade = c;
    addJournal(last.gen + 1, '⏯', '保存した続きから進化を再開', false, 'resume');
  }
  if (run.battle) {
    const cur = run.battle.stages[run.battle.stages.length - 1];
    opts.battle = { rivals: cur.rivals, ladder: run.battle.ladder, stage: cur.stage };
    if (!resumed && run.battle.seed) { opts.seedGenome = run.battle.seed.g; opts.seedObjective = run.battle.seed.obj; }
  }
  $('#st-best-label').textContent = run.battle ? '最高得点' : '最高記録';
  $('#btn-ghosts').classList.toggle('hidden', !!run.battle);
  w.postMessage({ type: 'init', blueprint: run.blueprint, settings: run.settings, opts });
  setMode(lab.mode);
  show('lab');
  if (resumed && lastWithG) playGen(lastWithG);
  updateStats();
}

function setMode(mode) {
  lab.mode = mode;
  if (mode !== 'pause') lab.lastRunMode = mode;
  $$('#evo-mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  lab.worker && lab.worker.postMessage({ type: 'mode', mode });
  $('#evo-state').textContent = { pause: '一時停止中', watch: '観察モード: 1世代ずつ再生と同期', fast: '高速モード: 裏で全力で進化中' }[mode];
}

function onGen(s) {
  const run = lab.run;
  const now = performance.now();
  run.genTimes.push(now); if (run.genTimes.length > 30) run.genTimes.shift();
  const prevBest = run.history.length ? run.history[run.history.length - 1].bestEver : null;
  const e = {
    gen: s.gen, best: s.best, median: s.median, p10: s.p10, p90: s.p90, bestEver: s.bestEver,
    clade: s.champ.clade, g: s.champ.genome, pg: s.champ.parentGenome, top: s.top, env: s.env,
    dist: s.champ.distance, born: s.champ.born, gait: s.champ.gait, battle: s.champ.battle,
  };
  run.history.push(e);
  if (s.clades) for (const c of s.clades) run.clades[c.id] = c;
  run.cladeHist.push({ g: s.gen, c: s.cladeCounts });
  if (run.cladeHist.length > 1600) run.cladeHist = run.cladeHist.filter((_, i) => i % 2 === 0 || i > 800);
  prune(run);

  // ── 環境の切り替わり (Worker 側で実際に適用された世代で検出) ──
  const envKey = JSON.stringify(s.env);
  const prevEntry = run.history[run.history.length - 2];
  if (prevEntry && JSON.stringify(prevEntry.env) !== envKey) {
    run.best = null;
    const promo = prevEntry.env.stage !== s.env.stage;
    run.envChanges.push({ gen: s.gen, env: s.env, promo });
    const env = s.env;
    if (JSON.stringify({ ...prevEntry.env, stage: 0 }) !== JSON.stringify({ ...env, stage: 0 })) {
      const T = TERRAINS[env.terrain] || { icon: '⭕', name: '土俵' };
      const O = OBJECTIVES[env.objective] || BATTLES[env.objective];
      const desc = `${T.icon}${T.name} / ${O.name} / 重力${env.gravity.toFixed(1)}G / 摩擦${env.friction.toFixed(2)} / ${env.evalSeconds}秒`;
      addJournal(s.gen, '🌍', `環境が変わった: ${desc}。ここから新たな適応が始まる`, true, 'env');
    }
  }

  // ── 記録と物語 ──
  const obj = s.env.objective;
  const isNewBest = !run.best || s.best > run.best.fitness;
  if (isNewBest) {
    const old = run.best;
    run.best = { gen: s.gen, fitness: s.best, dist: s.champ.distance, g: s.champ.genome };
    if (old && s.record) {
      const gain = s.best - old.fitness;
      if (gain > Math.max(run.battle ? 400 : 30, Math.abs(old.fitness) * 0.25)) addJournal(s.gen, '🚀', `大躍進！ 記録が ${formatFitness(old.fitness, obj)} → ${formatFitness(s.best, obj)} に`, true, 'leap');
      if (run.lastRecordGait && s.gen - run.flags.lastGaitGen > 10 && gaitDistance(s.champ.gait, run.lastRecordGait) > 0.22) {
        addJournal(s.gen, '🎼', '新しい動き方を発見！ 筋肉の使い方のパターンががらりと変わった', true, 'gait');
        run.flags.lastGaitGen = s.gen;
      }
    }
    run.lastRecordGait = s.champ.gait;
    run.flags.stall = false;
    if (!run.battle) checkMilestones(s.gen, s.best, obj);
  }
  if (run.battle && s.champ.battle) battleStory(s);
  if (s.promoted) {
    run.battle.stages.push({ gen: s.gen + 1, stage: s.promoted.stage, rivals: s.promoted.rivals });
    const beaten = s.promoted.beaten.map(n => `「${n}」`).join('と');
    addJournal(s.gen, '🎖', `昇進！「${rankName(obj, s.promoted.stage)}」へ — ${beaten}に${LADDER_STREAK}世代つづけて全勝。次の相手は第${s.gen}世代の自分と、最初の相手`, true, 'promo');
    renderEnvPane();
  }
  lab.streak = s.streak || 0;
  if (s.newClade) addJournal(s.gen, '🌿', `新系統「${s.newClade.label}」誕生 — 記録を大きく塗り替えた個体が祖となる`, false, 'clade');
  const total = Object.values(s.cladeCounts).reduce((a, b) => a + b, 0);
  for (const [id, n] of Object.entries(s.cladeCounts)) {
    if (n / total >= 0.8 && !run.flags.sweeps[id] && s.gen > 0 && run.clades[id] && run.clades[id].born > 0) {
      run.flags.sweeps[id] = true;
      addJournal(s.gen, '👑', `系統「${run.clades[id].label}」が集団の${Math.round(n / total * 100)}%を占めた (${s.gen - run.clades[id].born}世代で制覇)`, false, 'sweep');
    }
  }
  if (s.boost > 1.01 && !run.flags.stall) {
    run.flags.stall = true;
    addJournal(s.gen, '😴', `${s.stall}世代のあいだ記録が停滞。変異を強めて打開を図る`, false, 'stall');
  }

  Object.keys(lab.dirty).forEach(k => { lab.dirty[k] = true; });
  // 最新表示なら、何も再生していなければすぐ再生
  if (lab.view === 'live' && (!theater.main || lab.waiting)) { lab.waiting = false; playGen(e); }
  if (s.gen - lab.lastSaveGen >= 25) saveCurrent(true);
}

/** 対戦の物語: 初白星 / 全勝 / 新しい決まり手 / 相手を「見て」戦い始めた */
function battleStory(s) {
  const run = lab.run, b = s.champ.battle;
  const f = run.battle.flags || (run.battle.flags = {});
  const names = stageOf(run, b.stage).rivals.map(r => `「${r.name}」`).join('と');
  if (b.wins > 0 && !f.firstWin) {
    f.firstWin = true;
    addJournal(s.gen, '🎉', `初白星！ ${names}から初めて勝ちを奪った (${b.bouts.find(x => x.winner === 0).kimarite})`, true, 'win');
  }
  if (b.wins === b.n && !f[`sweep${b.stage}`]) {
    f[`sweep${b.stage}`] = true;
    addJournal(s.gen, '💯', `${names}に全勝 (${b.n}番)`, b.stage === 0, 'allwin');
  }
  f.kim = f.kim || [];
  for (const bt of b.bouts) {
    if (bt.winner !== 0 || bt.kimarite === '判定' || f.kim.includes(bt.kimarite)) continue;
    f.kim.push(bt.kimarite);
    addJournal(s.gen, '🆕', `決まり手「${bt.kimarite}」で初めて勝った`, false, 'kimarite');
  }
  if (!f.eyes && s.best - b.blind > 300 && b.wins > b.blindWins) {
    f.eyes = true;
    addJournal(s.gen, '👁', `相手を「見て」戦い始めた — 対戦感覚を遮断すると ${Math.round(s.best)}点 → ${Math.round(b.blind)}点、${b.wins}勝 → ${b.blindWins}勝に落ちる`, true, 'eyes');
  }
}

function checkMilestones(gen, best, obj) {
  const run = lab.run, f = run.flags;
  const th = obj === 'jump' ? [10, 20, 30, 50, 75, 100, 150, 200, 300] : [0.5, 1, 2, 3, 5, 10, 15, 20, 30, 50, 75, 100].map(v => v * 100);
  const unit = v => obj === 'jump' ? `${v}cm` : obj === 'efficiency' ? `${v / 100}pt` : `${v / 100}m`;
  for (const t of th) {
    const key = `${obj}:${t}`;
    if (best >= t && !f.milestones.includes(key)) {
      f.milestones.push(key);
      if (t === th[0] && obj !== 'jump') addJournal(gen, '👣', `はじめて意味のある前進 (${unit(t)})`, true, 'first');
      else addJournal(gen, '🏁', `${unit(t)} の壁を突破`, true, 'milestone');
    }
  }
}

function prune(run) {
  const H = run.history, n = H.length;
  const keepJ = new Set(run.journal.map(j => j.gen));
  const i = n - 301;
  if (i >= 0) { const e = H[i]; if (e.g && !(e.gen % 10 === 0 || keepJ.has(e.gen) || (run.best && run.best.gen === e.gen))) { e.g = null; e.pg = null; } e.gait = null; }
  const k = n - 25; if (k >= 0) H[k].top = null;
}

function addJournal(gen, icon, text, major, type) {
  lab.run.journal.push({ gen, icon, text, major, type, t: Date.now() });
  lab.dirty.journal = true;
  if (screen === 'lab' && type !== 'start' && type !== 'resume') flashEvent(icon, text);
}

function flashEvent(icon, text) {
  const box = $('#event-feed');
  const item = el('div', { class: 'event-pop' }, el('span', { class: 'ev-icon' }, icon), el('span', {}, text));
  box.prepend(item);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => item.classList.add('out'), 4200);
  setTimeout(() => item.remove(), 5000);
}

// ─── 再生 ───
function entryAt(gen) { const H = lab.run.history; if (!H.length) return null; return H[gen - H[0].gen] || null; }
function nearestWithGenome(gen) {
  const H = lab.run.history; if (!H.length) return null;
  let bestE = null, bd = Infinity;
  for (const e of H) if (e.g) { const d = Math.abs(e.gen - gen); if (d < bd) { bd = d; bestE = e; } }
  return bestE;
}

function recordFlag(env) {
  const b = lab.run.best;
  if (!b || env.objective === 'jump' || isBattle(env.objective) || b.dist == null || b.dist < 30) return null;
  return { x: b.dist, label: `最高記録 ${(b.dist / 100).toFixed(2)}m (第${b.gen}世代)` };
}

function playGen(e) {
  if (!e || !e.g) return;
  lab.shown = e;
  const run = lab.run;
  if (run.battle) {
    // 対戦: この世代の王者 vs その時の相手。「選択」表示では再生のたびに次の取組へ
    const st = stageOf(run, e.env.stage ?? 0), O = OPENINGS;
    const nb = st.prepared.length * O.length;
    const k = lab.view === 'pinned' ? lab.bout % nb : 0;
    const ri = Math.floor(k / O.length), oi = k % O.length;
    lab.boutInfo = { k, nb, rival: st.rivals[ri], gap: O[oi].gap };
    theater.play({ kind: 'match', gen: e.gen, genome: e.g, env: e.env, rival: st.prepared[ri], opening: O[oi], meName: `第${e.gen}世代` });
  } else {
    const ghosts = (e.top || []).map(t => ({ genome: t.genome, hue: run.clades[t.clade] ? run.clades[t.clade].hue : 200 }));
    theater.play({ kind: 'single', gen: e.gen, genome: e.g, env: e.env, ghosts, record: recordFlag(e.env) });
  }
  brainView.setGenomes(e.g, e.pg);
  if (lab.mode === 'watch' && lab.view === 'live') lab.worker.postMessage({ type: 'grant' });
  updateCaption();
  updateBrainNote();
  $('#th-result').classList.remove('show');
}

function playParade() {
  const run = lab.run, H = run.history;
  const cands = H.filter(e => e.g);
  if (cands.length < 2) { toast('パレードにはもう少し世代が必要です'); setView('live'); return; }
  // 節目: 最初、物語に残った世代、最新 から最大5つ
  const js = new Set(run.journal.filter(j => j.major).map(j => j.gen));
  let picks = [cands[0]];
  const mids = cands.filter(e => js.has(e.gen) && e !== cands[0] && e !== cands[cands.length - 1]);
  const want = 3;
  for (let k = 1; k <= want && mids.length; k++) picks.push(mids[Math.floor(k * mids.length / (want + 1))]);
  if (mids.length < want) {
    for (let k = 1; k <= want - mids.length; k++) picks.push(cands[Math.floor(k * cands.length / (want - mids.length + 1))]);
  }
  picks.push(cands[cands.length - 1]);
  picks = [...new Map(picks.map(p => [p.gen, p])).values()].sort((a, b) => a.gen - b.gen);
  const env = picks[picks.length - 1].env;
  // 対戦では、どの世代も「最初の相手」と取組む = 同じ物差しで成長が見える
  const first = run.battle ? stageOf(run, run.battle.stages[0].stage) : null;
  theater.play({
    kind: 'lanes', map: !run.battle,
    lanes: picks.map(p => ({
      gen: p.gen, genome: p.g, env, label: `第${p.gen}世代`, hue: run.clades[p.clade] ? run.clades[p.clade].hue : 200,
      ...(first ? { rival: first.prepared[0], opening: OPENINGS[0] } : {}),
    })),
  });
  lab.shown = picks[picks.length - 1];
  brainView.setGenomes(lab.shown.g, lab.shown.pg);
  updateCaption();
  updateBrainNote();
}

function onReplayFinish() {
  const run = lab.run, H = run.history;
  if (lab.view === 'live') {
    const latest = H[H.length - 1];
    if (latest && lab.shown && latest.gen !== lab.shown.gen) playGen(latest);
    else if (lab.mode === 'watch') { lab.waiting = true; showResult(true); }
    else playGen(lab.shown);
  } else if (lab.view === 'pinned') { lab.bout++; playGen(lab.shown); }
  else playParade();
}

function showResult(waiting) {
  const box = $('#th-result');
  box.innerHTML = waiting ? '次の世代を計算中…' : '';
  box.classList.toggle('show', !!waiting);
}

function pinGen(gen) {
  const e = nearestWithGenome(gen);
  if (!e) return;
  setView('pinned', false);
  lab.pinned = e.gen;
  lab.bout = 0;
  timeline.selected = e.gen;
  lab.dirty.timeline = true;
  playGen(e);
}

function setView(v, play = true) {
  lab.view = v;
  $$('#view-mode button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v !== 'pinned') { timeline.selected = null; lab.dirty.timeline = true; }
  if (!play) return;
  const H = lab.run.history;
  if (v === 'live' && H.length) playGen(H[H.length - 1]);
  if (v === 'pinned') pinGen(lab.pinned ?? (lab.shown ? lab.shown.gen : 0));
  if (v === 'parade') playParade();
}

function updateCaption() {
  const e = lab.shown, run = lab.run;
  if (!e) return;
  let title;
  if (lab.view === 'parade') title = run.battle ? `パレード: 各世代 vs 最初の相手「${run.battle.stages[0].rivals[0].name}」` : '進化のパレード — 節目の世代が同時に走る';
  else if (run.battle && lab.boutInfo) title = `第${e.gen}世代の王者 vs ${lab.boutInfo.rival.name}${lab.view === 'pinned' ? ' (選択中)' : ''}`;
  else title = `第${e.gen}世代のチャンピオン${lab.view === 'pinned' ? ' (選択中)' : ''}`;
  $('#th-title').textContent = title;
  const c = run.clades[e.clade];
  const chip = $('#th-chip');
  if (c && lab.view !== 'parade') {
    chip.textContent = `系統 ${c.label}`;
    chip.style.setProperty('--h', c.hue);
    chip.classList.remove('hidden');
  } else chip.classList.add('hidden');
  let age = e.born != null && lab.view !== 'parade' ? (e.born === e.gen ? '今世代に誕生' : `第${e.born}世代生まれ・${e.gen - e.born}世代生存`) : '';
  if (run.battle && lab.view !== 'parade') {
    const b = e.battle, bi = lab.boutInfo;
    const rec = b ? ` · この世代の成績 ${b.wins}勝${b.losses}敗${b.draws ? b.draws + '分' : ''}` : '';
    age = `取組 ${bi ? bi.k + 1 : 1}/${bi ? bi.nb : 1} (間合い${bi ? bi.gap : ''}cm)${rec}${age ? ' · ' + age : ''}`;
  }
  $('#th-sub').textContent = age;
  updateLatestBtn();
}

function updateLatestBtn() {
  const H = lab.run.history, btn = $('#th-latest');
  const latest = H[H.length - 1];
  const behind = latest && lab.shown && latest.gen - lab.shown.gen;
  btn.classList.toggle('hidden', !(behind > 0) || lab.view === 'parade');
  if (behind > 0) btn.textContent = lab.view === 'live' ? `⏭ 最新の第${latest.gen}世代を見る` : `⏭ 最新 (第${latest.gen}世代) に戻る`;
}

function updateBrainNote() {
  const e = lab.shown; if (!e) return;
  const L = lab.run.layout;
  let syn = 0; for (let l = 1; l < L.sizes.length; l++) syn += L.sizes[l - 1] * L.sizes[l];
  $('#brain-sub').textContent = `ニューロン ${L.sizes.reduce((a, b) => a + b, 0)} · シナプス ${syn} · リズム ${rhythmHz(e.g).toFixed(2)}Hz`;
  const note = $('#brain-note');
  if (brainView.mode === 'mutation') {
    const st = brainView.mutationStats();
    note.innerHTML = st ? (st.n ? `<b style="color:#ff5fd2">親から ${st.n} 箇所</b>の遺伝子が変化 (変異+交叉, 平均 ±${st.mean.toFixed(2)})。<span style="color:#ff5fd2">ピンク</span>=強まった / <span style="color:#b47bff">紫</span>=弱まった` : '親と遺伝子は同一 (交叉のみ)')
      : 'この個体は前世代から<b>そのまま生き残った</b>エリートです。変異はありません。';
  } else if (brainView.mode === 'weights') {
    note.innerHTML = '進化で獲得した結合の強さ。<span class="pos">橙</span>=興奮性 / <span class="neg">青</span>=抑制性。太いほど強い結合';
  } else {
    note.innerHTML = 'いま流れている信号 (重み×活性)。光の粒は強い信号。ニューロンや体の筋肉を<b>タップ</b>すると対応関係が見えます';
  }
  const b = e.battle;
  if (lab.run.battle && b && lab.view !== 'parade') {
    const dep = e.best - b.blind;
    const verdict = dep > 300 ? '<b style="color:#ff5b6e">相手を見て戦っている</b>' : dep > 60 ? '相手の情報を<b>少し</b>使っている' : '相手を<b>ほぼ見ていない</b> (体の強さと動きのパターンだけで戦っている)';
    note.innerHTML = `<span style="color:#ff5b6e">●</span> 対戦感覚 目隠しテスト: 遮断すると ${Math.round(e.best)}点 → ${Math.round(b.blind)}点 (${b.wins}勝 → ${b.blindWins}勝)。${verdict}<br>` + note.innerHTML;
  }
}

// ─── ニューロン カード ───
function onNeuronSelect(n) {
  const card = $('#neuron-card');
  theater.highlight = n ? brainView.bodyTargets(n) : null;
  if (!n || !lab.shown) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const d = brainView.describe(n, theater.main ? theater.main.brain.acts : null);
  $('#nc-title').textContent = d.title;
  $('#nc-title').style.color = d.color || '';
  $('#nc-desc').textContent = d.desc;
  const links = [];
  const fmtL = arr => arr.map(x => `<span class="${x.w >= 0 ? 'pos' : 'neg'}">${x.name} ${x.w >= 0 ? '+' : ''}${x.w.toFixed(2)}</span>`).join(' ');
  if (d.links.in.length) links.push(`<div><small>主な入力</small> ${fmtL(d.links.in)}</div>`);
  if (d.links.out.length) links.push(`<div><small>主な出力先</small> ${fmtL(d.links.out)}</div>`);
  $('#nc-links').innerHTML = links.join('');
  updateKnockUI();
}

function updateKnockUI() {
  const n = brainView.sel;
  const btn = $('#nc-knock');
  if (n) {
    const k = theater.knock[n.l][n.i];
    btn.textContent = k ? '✚ 復活させる' : '🔪 ノックアウト';
    btn.classList.toggle('active', !!k);
  }
  const cnt = theater.knockCount();
  const badge = $('#knock-badge');
  badge.classList.toggle('hidden', cnt === 0);
  $('span', badge).textContent = `🔪 手術中: ${cnt}個停止`;
}

function drawSpark() {
  const n = brainView.sel; if (!n || !theater.actHist) return;
  const cv = $('#nc-spark');
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const row = theater.actHist[n.l][n.i], HIST = row.length, cnt = theater.filled, head = theater.head;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  const isTouch = n.l === 0 && lab.run.layout.inputs[n.i].group === 'touch';
  ctx.strokeStyle = n.l === lab.run.layout.sizes.length - 1 ? `hsl(${muscleHue(n.i)},80%,65%)` : '#ffd166'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = 0; k < cnt; k++) {
    const v = row[(head - cnt + k + HIST) % HIST];
    const x = (HIST - cnt + k) / HIST * w, y = isTouch ? h - 3 - v * (h - 6) : h / 2 - clamp(v, -1, 1) * (h / 2 - 2);
    if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
  const cur = theater.main ? theater.main.brain.acts[n.l][n.i] : 0;
  $('#nc-val').textContent = cur.toFixed(2);
}

// ─── 環境パネル ───
let envTimer = null;
function renderEnvPane() {
  const run = lab.run, s = run.settings, pane = $('#env-pane');
  pane.innerHTML = '';
  if (run.battle) {
    const B = BATTLES[s.objective], cur = run.battle.stages[run.battle.stages.length - 1];
    pane.append(el('p', { class: 'pane-note' }, `${B.icon} ${B.desc}`));
    pane.append(el('h4', {}, `いまの相手 (${rankName(s.objective, cur.stage)})`));
    const list = el('div', { class: 'rival-list' });
    for (const r of cur.rivals) {
      const cv = el('canvas', { class: 'rival-thumb' });
      list.append(el('div', { class: 'rival-row' }, cv, el('div', {}, el('b', {}, r.name), el('small', {}, r.src === 'self' ? '過去の自分 (昇進で交代)' : r.src === 'dojo' ? '道場の師範' : 'マイ生物'))));
      requestAnimationFrame(() => drawThumb(cv, r.bp));
    }
    pane.append(list);
    pane.append(el('p', { class: 'pane-note dim' }, run.battle.ladder
      ? `昇段戦: 相手すべてに全勝 (半分以上は決着勝ち) を ${LADDER_STREAK}世代つづけると昇進し、その時の自分が次の相手になる (最初の相手も残る)。自分自身との軍拡競争です。`
      : '固定の相手: この相手に勝つことだけを目指します。'));
    pane.append(el('h4', {}, '環境'));
    pane.append(sliderRow('重力', s.gravity, 0.2, 2, 0.1, v => `${v.toFixed(1)}G`, v => changeEnv({ gravity: v }, true)));
    pane.append(sliderRow('地面の摩擦', s.friction, 0.3, 1, 0.05, v => v.toFixed(2), v => changeEnv({ friction: v }, true)));
    pane.append(sliderRow('取組の時間', s.evalSeconds, 5, 30, 1, v => `${v}秒`, v => changeEnv({ evalSeconds: v }, true)));
    appendMutationRows(pane, run);
    return;
  }
  pane.append(el('p', { class: 'pane-note' }, '環境を変えると、次の世代から新しい条件で評価されます。生物がどう「適応」していくか観察してみよう。'));
  pane.append(choiceRow('地形', TERRAINS, s.terrain, v => changeEnv({ terrain: v })));
  pane.append(choiceRow('目標', OBJECTIVES, s.objective, v => changeEnv({ objective: v })));
  pane.append(sliderRow('重力', s.gravity, 0.2, 2, 0.1, v => `${v.toFixed(1)}G`, v => changeEnv({ gravity: v }, true)));
  pane.append(sliderRow('地面の摩擦', s.friction, 0.3, 1, 0.05, v => v.toFixed(2), v => changeEnv({ friction: v }, true)));
  pane.append(sliderRow('評価時間', s.evalSeconds, 5, 30, 1, v => `${v}秒`, v => changeEnv({ evalSeconds: v }, true)));
  appendMutationRows(pane, run);
}

function appendMutationRows(pane, run) {
  const s = run.settings;
  pane.append(el('h4', {}, '変異 (即時反映・記録には影響なし)'));
  pane.append(sliderRow('変異の確率', s.mutationRate, 0.01, 0.3, 0.01, v => `${Math.round(v * 100)}%`, v => { s.mutationRate = v; lab.worker.postMessage({ type: 'env', env: { mutationRate: v } }); }));
  pane.append(sliderRow('変異の大きさ', s.mutationSize, 0.05, 1, 0.05, v => v.toFixed(2), v => { s.mutationSize = v; lab.worker.postMessage({ type: 'env', env: { mutationSize: v } }); }));
  pane.append(el('p', { class: 'pane-note dim' }, `個体数 ${s.population}体 / 脳 ${run.layout.sizes.join('→')} (これらは新しい実験で変更できます)`));
}

function changeEnv(patch, debounce) {
  const run = lab.run;
  Object.assign(run.settings, patch);
  const apply = () => lab.worker.postMessage({ type: 'env', env: envOfSettings(run.settings) });
  clearTimeout(envTimer);
  if (debounce) envTimer = setTimeout(apply, 500); else apply();
}

function renderJournal() {
  const ol = $('#journal');
  ol.innerHTML = '';
  const items = [...lab.run.journal].reverse();
  for (const j of items) {
    ol.append(el('li', { class: j.major ? 'major' : '', onclick: () => pinGen(j.gen), title: 'タップでこの世代を再生' },
      el('span', { class: 'j-icon' }, j.icon),
      el('span', { class: 'j-gen' }, `第${j.gen}世代`),
      el('span', { class: 'j-text' }, j.text)));
  }
}

function updateStats() {
  const run = lab.run, H = run.history;
  const last = H[H.length - 1];
  $('#st-gen').textContent = last ? last.gen : 0;
  $('#st-best').textContent = run.best ? formatFitness(run.best.fitness, run.settings.objective) : '—';
  const T = run.genTimes;
  const rate = T.length > 1 && performance.now() - T[T.length - 1] < 5000 ? (T.length - 1) / ((T[T.length - 1] - T[0]) / 60000) : 0;
  $('#st-rate').textContent = rate > 0 ? Math.round(rate) : '—';
  if (run.battle) {
    const B = BATTLES[run.settings.objective], stage = run.battle.stages[run.battle.stages.length - 1].stage;
    const toGo = run.battle.ladder ? ` · 昇進まで全勝あと${LADDER_STREAK - (lab.streak || 0)}世代` : '';
    $('#lab-sub').textContent = `${B.icon} ${B.name}の特訓 · ${run.settings.objective === 'sumo' ? '番付' : '段位'} ${rankName(run.settings.objective, stage)}${toGo}`;
  } else $('#lab-sub').textContent = `${TERRAINS[run.settings.terrain].icon} ${TERRAINS[run.settings.terrain].name} · ${OBJECTIVES[run.settings.objective].name}`;
}

function initLabUI() {
  $$('#evo-mode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('#view-mode button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $$('#play-speed button').forEach(b => b.addEventListener('click', () => {
    theater.speed = +b.dataset.speed;
    $$('#play-speed button').forEach(x => x.classList.toggle('active', x === b));
  }));
  $('#th-latest').addEventListener('click', () => setView('live'));
  $('#btn-ghosts').addEventListener('click', e => { theater.showGhosts = !theater.showGhosts; e.currentTarget.classList.toggle('active', theater.showGhosts); });
  $('#btn-replay').addEventListener('click', () => { if (lab.view === 'parade') playParade(); else if (lab.shown) playGen(lab.shown); });
  $$('#brain-mode button').forEach(b => b.addEventListener('click', () => {
    brainView.mode = b.dataset.bm;
    $$('#brain-mode button').forEach(x => x.classList.toggle('active', x === b));
    updateBrainNote();
  }));
  $('#brain-expand').addEventListener('click', () => { document.body.classList.toggle('brain-full'); brainView.lastSize = ''; });
  $('#nc-close').addEventListener('click', () => brainView.select(null));
  $('#nc-knock').addEventListener('click', () => {
    const n = brainView.sel; if (!n) return;
    theater.knock[n.l][n.i] ^= 1;
    updateKnockUI();
    flashEvent('🔪', theater.knock[n.l][n.i] ? 'ニューロンを停止。動きはどう変わる？' : 'ニューロンを復活させた');
  });
  $('#knock-badge button').addEventListener('click', () => { theater.knock.forEach(k => k.fill(0)); updateKnockUI(); });
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    lab.tab = b.dataset.tab;
    $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    $$('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === lab.tab));
    Object.keys(lab.dirty).forEach(k => { lab.dirty[k] = true; });
  }));
  $('#lab-home').addEventListener('click', () => { saveCurrent(true); lab.worker && lab.worker.terminate(); lab.worker = null; show('home'); });
  $('#lab-save').addEventListener('click', () => saveCurrent(false));
  $('#lab-menu').addEventListener('click', e => {
    const m = $('#lab-menu-pop');
    m.classList.toggle('hidden');
    e.stopPropagation();
  });
  document.addEventListener('click', () => $('#lab-menu-pop').classList.add('hidden'));
  $('#m-export').addEventListener('click', () => { saveCurrent(true); exportRun(lab.run.id); });
  $('#m-edit').addEventListener('click', () => { saveCurrent(true); lab.worker.terminate(); lab.worker = null; openBuilder(lab.run.blueprint, lab.run.name + '・改', lab.run.settings); });
  $('#m-help').addEventListener('click', showHelp);
  $('#m-rename').addEventListener('click', () => {
    const v = prompt('新しい名前', lab.run.name);
    if (v && v.trim()) { lab.run.name = v.trim().slice(0, 16); $('#lab-name').textContent = lab.run.name; saveCurrent(true); }
  });
  window.addEventListener('pagehide', () => { if (screen === 'lab') saveCurrent(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'lab') saveCurrent(true); });
  window.addEventListener('keydown', e => {
    if (screen !== 'lab' || e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); setMode(lab.mode === 'pause' ? lab.lastRunMode : 'pause'); }
    if (e.key === 'Escape') { brainView.select(null); document.body.classList.remove('brain-full'); }
  });
}

// ════════════════════════════════════════════════════════════
//  メインループ
// ════════════════════════════════════════════════════════════
let lastT = performance.now(), slowT = 0;
function frame(t) {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  if (screen === 'build') builder.render();
  if (screen === 'arena') arena.frame(dt, t);
  if (screen === 'lab' && lab.run) {
    theater.update(dt);
    theater.render();
    brainView.render(theater.main ? theater.main.brain.acts : null, theater.knock, t / 1000);
    $('#th-bar').style.width = `${theater.progress() * 100}%`;
    if (brainView.sel) drawSpark();
    if (lab.tab === 'gait') gait.render(theater);
    slowT += dt;
    if (slowT > 0.25) {
      slowT = 0;
      updateStats();
      updateLatestBtn();
      if (lab.tab === 'timeline' && (lab.dirty.timeline || timeline.hoverX != null)) { timeline.render(); lab.dirty.timeline = false; }
      if (lab.tab === 'clades' && lab.dirty.clades) { lab.run.champClade = lab.shown ? lab.shown.clade : null; cladeChart.render(); lab.dirty.clades = false; }
      if (lab.tab === 'journal' && lab.dirty.journal) { renderJournal(); lab.dirty.journal = false; }
    }
  }
  requestAnimationFrame(frame);
}

function showHelp() {
  infoDialog('SoftEvo 8 の遊び方', `
    <ol class="help">
      <li><b>体をつくる</b> — ノード(●)を置き、<span class="bone">骨</span>(硬い棒)と<span class="muscle">筋肉</span>(伸び縮みする)でつなぐ。左右対称モードで簡単に。</li>
      <li><b>進化スタート</b> — 裏側で何十体もの個体が同時に試され、良い脳を持つ個体の子孫が残っていきます。</li>
      <li><b>劇場で観察</b> — 各世代のチャンピオンを完全に再現して再生。うっすら見えるのは同世代のライバル(ゴースト)。</li>
      <li><b>脳を読む</b> — 左が感覚、右が筋肉。ニューロンや体の筋肉をタップすると、どこがつながっているか光ります。<b>🔪ノックアウト</b>で脳の一部を止める「手術」実験も。</li>
      <li><b>変異モード</b> — 親から子へ、どのシナプスが変わったかがピンクで見えます。</li>
      <li><b>推移グラフ</b>をタップすると、その世代の個体を呼び出せます。<b>パレード</b>では節目の世代が並んで走り、進化の歩みがひと目でわかります。</li>
      <li><b>歩容図</b>では筋肉の収縮と足の接地のリズムが「楽譜」のように見えます。</li>
      <li><b>環境</b>を途中で変えると、生物が新しい世界に適応していく過程を観察できます。</li>
      <li><b>⚔ 闘技場</b> — 育てた生物 (好きな世代) や道場の師範を戦わせます。🏃かけっこ・🤼すもう・🪢つなひき。過去の自分とも戦えます。</li>
      <li><b>🧬 特訓</b> — 負けた生物を、その相手と戦わせながら進化させます。脳に<span style="color:#ff5b6e">対戦感覚</span>(相手の位置・勢い・接触…) が加わり、最初は配線ゼロ。進化がそれを「使う」ようになる瞬間を、<b>目隠しテスト</b>(対戦感覚を遮断して再戦) で確かめられます。</li>
      <li><b>🌐 オンライン道場</b> — 生物を公開し、ほかの人の生物に挑戦。結果はひとこと付きで相手に届き、相手は<b>まったく同じ取組を再生</b>して返信やリベンジ特訓ができます。</li>
      <li><b>昇段戦</b> — 相手に全勝しつづけると昇進し、次はその時の自分が相手になります。終わりのない、自分自身との軍拡競争です。</li>
    </ol>
    <p class="dim">進化は自動保存されます (25世代ごと・画面を離れた時)。ホームから書き出したファイルは、他の端末で読み込めます。</p>`);
}

// ════════════════════════════════════════════════════════════
//  起動
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
//  闘技場 → 特訓
// ════════════════════════════════════════════════════════════
const arena = new Arena({
  onHome: () => show('home'),
  onTrain: (f, rival, mode) => startTraining(f, rival, mode),
  isMe: id => id === online.profile().id,
  onPost: async p => {
    if (!online.profile().name) {
      const v = prompt('オンラインで表示する名前 (16文字まで)', '');
      if (!v || !v.trim()) return false;
      online.setName(v);
    }
    try { await online.postBout(p); toast('📨 届けました'); return true; } catch (e) { toast(e.message); return false; }
  },
});

// ════════════════════════════════════════════════════════════
//  オンライン道場
// ════════════════════════════════════════════════════════════
const lobby = new Lobby({
  onHome: () => show('home'),
  onChallenge: (f, mode) => { arena.setup({ mode, east: f, west: arena.duel[0] && arena.duel[0].src === 'run' ? undefined : null }); show('arena'); },
  onRace: f => { arena.setup({ mode: 'race', racer: f }); show('arena'); },
  onTrain: (f, rival, mode) => startTraining(f, rival, mode),
  onReplay: (b, def) => {
    arena.setup({ mode: b.mode, west: onlineFighter({ ...b.challenger, id: `ch-${b.id}`, msg: '' }), east: onlineFighter(def), replay: b });
    show('arena');
  },
  myCreatures: () => arena.candidates().filter(c => c.kind === 'run'),
  fighterOf: (c, si) => arena.fighter(c, si),
  onData: d => { arena.online = d.creatures; updateOnlineBadge(); },
});

function updateOnlineBadge() {
  const n = lobby.unread(), b = $('#btn-online .badge');
  b.textContent = n || ''; b.classList.toggle('hidden', !n);
}

const rivalRecord = r => ({ name: r.name, bp: r.bp, hidden: r.hidden, hidden2: r.hidden2 || 0, obj: r.obj, g: Float32Array.from(r.g), src: r.src, gen: r.gen ?? null, hue: 0 });

async function startTraining(f, rival, mode) {
  const B = BATTLES[mode];
  const ok = await confirmDialog(`${B.icon} ${B.name}の特訓`,
    `「${f.name}」の脳をもとに、「${rival.name}」を相手に特訓します。脳には相手を感じる「対戦感覚」が${B.senses.length}個加わります (最初は配線ゼロ)。全勝を${LADDER_STREAK}世代つづけると昇進し、次はその時の自分が相手になります。`, '特訓開始');
  if (!ok) return;
  const s = f.settings || DEFAULT_SETTINGS;
  const settings = {
    ...DEFAULT_SETTINGS, population: s.population, mutationRate: s.mutationRate, mutationSize: s.mutationSize,
    hidden: f.hidden, hidden2: f.hidden2 || 0, objective: mode, terrain: B.terrain,
  };
  const run = newRun(cloneBlueprint(f.bp), `${f.baseName}・${B.name}`.slice(0, 16), settings, {
    mode, ladder: true, flags: {},
    stages: [{ gen: 0, stage: 0, rivals: [rivalRecord(rival)] }],
    seed: { g: f.g, obj: f.obj },
  });
  startLab(run);
}

function init() {
  initBuilderUI();
  initLabUI();
  $('#btn-arena').addEventListener('click', () => show('arena'));
  $('#btn-online').addEventListener('click', () => show('online'));
  // 受信箱の新着だけ、そっと確かめておく
  setTimeout(() => online.fetchAll().then(d => { lobby.data = d; arena.online = d.creatures; updateOnlineBadge(); }).catch(() => {}), 1500);
  $('#btn-new').addEventListener('click', () => openBuilder(null));
  $('#btn-quick').addEventListener('click', () => openBuilder(PRESETS.quad.bp, store.randomName()));
  $('#btn-import').addEventListener('click', importRun);
  $('#btn-help').addEventListener('click', showHelp);
  show('home');
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
init();
// デバッグ用
window.__builder = builder; window.__bv = brainView; window.__lab = lab; window.__arena = arena;
