// 画面の流れ: 現場の一覧 → 現場（学び方を選ぶ → 教える・まねる・練習・検定・くらべる）
// 重い計算（世界・AIの目・学習）は core/worker.js が受け持ち、ここは表示と操作だけ。
import { STAGES, STAGE_BY_ID, METHODS, STAR_RATES, rankFor } from './core/stages.js';
import { DEFAULT_REWARD } from './core/env.js';
import { Scene3D } from './gfx/scene.js';
import { drawChart } from './gfx/charts.js';
import * as Save from './game/save.js';

const $ = (s, r = document) => r.querySelector(s);
const pct = (r) => Math.round(r * 100) + '%';
const fmtN = (n) => (n >= 100000 ? Math.round(n / 10000) + '万' : n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(Math.round(n)));
const starHtml = (n) => `<span class="stars"><b>${'★'.repeat(n)}</b>${'★'.repeat(3 - n)}</span>`;
const METHOD = Object.fromEntries(METHODS.map((m) => [m.id, m]));
const STEPS = {
  bc: [['teach', '教える'], ['learn', 'まねる'], ['exam', '検定'], ['cmp', 'くらべる']],
  rl: [['practice', '練習'], ['exam', '検定'], ['cmp', 'くらべる']],
  mix: [['teach', '教える'], ['learn', 'まねる'], ['practice', '練習'], ['exam', '検定'], ['cmp', 'くらべる']],
};
const REWARD_UI = [
  ['reach', '近づく', 0, 3, 0.1], ['grasp', 'つかむ', 0, 3, 0.1], ['carry', '運ぶ', 0, 3, 0.1],
  ['success', '成功', 1, 10, 0.5], ['time', '時間のばつ', 0, 0.05, 0.005],
];
const PRESETS = {
  default: DEFAULT_REWARD,
  sparse: Object.assign({}, DEFAULT_REWARD, { reach: 0, grasp: 0, carry: 0 }),
  hurry: Object.assign({}, DEFAULT_REWARD, { time: 0.05 }),
};
const EVENTS = {
  grasp: ['つかんだ', 'info'], miss: ['空振り', 'bad'], drop: ['放した', 'info'], deliver: ['1個め完了', 'good'],
  success: ['成功！', 'good'], fail: ['失格（ニセモノ）', 'bad'], timeout: ['時間切れ', 'bad'],
  demo: ['お手本 +1', 'good'], fixed: ['手直しを記録', 'good'],
};

const save = Save.load();
const home = $('#home'), play = $('#play'), panel = $('#panel'), gl = $('#gl');
const scene = new Scene3D(gl);
const worker = new Worker(new URL('./core/worker.js', import.meta.url), { type: 'module' });
const ui = {
  stage: null, method: 'bc', step: 'teach', demos: { total: 0, human: 0, robot: 0, fix: 0, steps: 0 }, slots: {},
  job: null, exam: null, examOut: null, gripSeq: 0, grip: 0, touching: false, pid: -1, tx: 0, ty: 0, dirty: false,
  period: 50, liveKey: '', lastT: -1, bc: null, rl: null, epochs: 40, opening: false,
  reward: Object.assign({}, DEFAULT_REWARD, save.reward || {}),
};
const eyeCtx = $('#eye').getContext('2d'), eyeImg = eyeCtx.createImageData(32, 32), ovCtx = $('#eye-ov').getContext('2d');
const probBars = [...document.querySelectorAll('#probs .bars b')];
let wakeLock = null;

// ---------------------------------------------------------------- 共通の小物
let toastTimer = 0;
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}
let tickTimer = 0;
function ticker(text, cls) {
  const t = $('#ticker');
  t.textContent = text; t.className = 'ticker on ' + cls;
  clearTimeout(tickTimer); tickTimer = setTimeout(() => t.classList.remove('on'), 900);
}
function modal(html, onReady) {
  const m = $('#modal');
  m.innerHTML = `<div class="card">${html}</div>`; m.hidden = false;
  m.onclick = (e) => { if (e.target === m || e.target.dataset.close !== undefined) m.hidden = true; };
  if (onReady) onReady(m);
}
const set = (sel, html) => { const e = $(sel, panel); if (e) e.innerHTML = html; };
const slot = (m = ui.method) => ui.slots[m] || { ready: false, bcEpochs: 0, bcDemos: 0, bcCurve: [], rlSteps: 0, rlCurve: [], estimate: null };
async function setWake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}

// ---------------------------------------------------------------- 現場の一覧
function renderHome() {
  const total = Save.totalStars(save), max = STAGES.length * 9, rk = rankFor(total);
  const nextId = (STAGES.find((s, i) => Save.unlocked(save, i) && Save.stageStars(save, s.id) === 0) || {}).id;
  const card = (st, i) => {
    const open = Save.unlocked(save, i);
    const chips = METHODS.map((m) => {
      const r = save.st[st.id] && save.st[st.id][m.id], n = r ? r.stars : 0;
      return `<i class="chip ${m.id} ${n ? 'on' : ''}">${m.short} ${'★'.repeat(n)}${'☆'.repeat(3 - n)}</i>`;
    }).join('');
    return `<button class="stage ${open ? '' : 'locked'} ${st.id === nextId ? 'next' : ''}" data-stage="${st.id}" ${open ? '' : 'disabled'}>
      <div class="no">${open ? st.no : '🔒'}</div>
      <div><b>${st.name}</b><span>${open ? st.brief : '前の現場で★を1つ取ると開きます'}</span>${open ? `<div class="ms">${chips}</div>` : ''}</div></button>`;
  };
  home.innerHTML = `
    <h1><small>MINARAI ARM</small>見習いアーム</h1>
    <p class="lead">32×32ピクセルの目しか持たない新人アームに、仕事を教えよう。見せて教えるか、自分で練習させるか、その両方か。</p>
    <div class="rank"><div class="badge">${rk.name}</div>
      <div class="meta">★ <b>${total}</b> / ${max}${rk.next ? `　次の肩書き「${rk.next[1]}」まで ★${rk.next[0] - total}` : '　最高の肩書きです'}
        <div class="bar"><i style="width:${(total / max * 100).toFixed(1)}%"></i></div></div></div>
    <div class="stages">${STAGES.map(card).join('')}</div>
    <div class="howto"><b>3通りの育て方</b>（現場ごとに、それぞれ★3つまで）
      <ol><li><b>模倣学習</b> … あなたのお手本をまねさせる</li><li><b>強化学習</b> … ごほうびを頼りに、自分で練習させる</li><li><b>模倣→強化</b> … まねさせてから、自分で磨かせる</li></ol></div>
    <div class="home-foot"><button class="btn" id="btn-help">あそびかた</button><button class="btn warn" id="btn-wipe">記録を消す</button></div>`;
  home.querySelectorAll('.stage:not(.locked)').forEach((b) => { b.onclick = () => openStage(b.dataset.stage); });
  $('#btn-help').onclick = showHelp;
  $('#btn-wipe').onclick = () => modal(`<h2>記録を消しますか？</h2><p>★・記録・お手本・育てた頭脳がすべて消えます。</p>
    <div class="row"><button class="btn" data-close>やめる</button><button class="btn warn" id="wipe-yes">消す</button></div>`, (m) => {
    $('#wipe-yes', m).onclick = () => { localStorage.removeItem('minarai.v1'); worker.postMessage({ type: 'wipe' }); location.reload(); };
  });
}

function showHelp() {
  modal(`<h2><small>HOW TO PLAY</small>あそびかた</h2>
    <p>アームは<b>右上の「AIの目」（32×32の画像）</b>と、関節の角度センサーだけを頼りに動きます。位置の数値は教えてもらえません。</p>
    <ol>
      <li><b>教える</b> … 指で机をなぞって手先を動かし、「にぎる／はなす」でお手本を見せる（お手本ロボにも頼めます）</li>
      <li><b>まねる</b> … お手本と同じ行動を選べるように学習（模倣学習）。動きを見ながら指で<b>手直し</b>もできます</li>
      <li><b>練習</b> … 自分で何万回も試して、ごほうびが増える動きを覚える（強化学習）</li>
      <li><b>検定</b> … 決まった100問で合格率を測る。${pct(STAR_RATES[0])}で★、${pct(STAR_RATES[1])}で★★、${pct(STAR_RATES[2])}で★★★</li>
      <li><b>くらべる</b> … 3通りの育て方の成績を並べて見る</li>
    </ol>
    <p>現場で★を1つ取ると次の現場が開きます。少ないお手本・少ない練習量で合格するほど良い記録として残ります。</p>
    <p>学習はすべてこの端末の中で行い、どこにも送信しません。</p>
    <button class="btn solid block" data-close>とじる</button>`);
}

function goHome() {
  worker.postMessage({ type: 'stop' });
  ui.job = null; setWake(false);
  worker.postMessage({ type: 'live', mode: 'idle' }); ui.liveKey = '';
  play.hidden = true; home.hidden = false; ui.stage = null;
  renderHome();
}

// ---------------------------------------------------------------- 現場
function openStage(id) {
  ui.stage = STAGE_BY_ID[id]; ui.opening = true; ui.job = null; ui.exam = null; ui.examOut = null; ui.liveKey = ''; ui.lastT = -1; ui.bc = null; ui.rl = null;
  home.hidden = true; play.hidden = false;
  $('#st-name').textContent = `${ui.stage.no}. ${ui.stage.name}`; $('#st-brief').textContent = ui.stage.brief;
  panel.innerHTML = '<p>準備中…</p>';
  requestAnimationFrame(() => scene.resize());
  worker.postMessage({ type: 'open', stage: id });
}

function onOpened(m) {
  if (!ui.stage || m.stage !== ui.stage.id) return;
  ui.opening = false; ui.demos = m.demos; ui.slots = m.slots;
  Save.noteModels(save, ui.stage.id, ui.slots);
  const first = !save.last[ui.stage.id];
  ui.method = save.last[ui.stage.id] || 'bc';
  renderTabs(); setStep(STEPS[ui.method][0][0]);
  if (first) modal(`<h2><small>現場 ${ui.stage.no}</small>${ui.stage.name}</h2><p><b>${ui.stage.brief}</b></p><p>${ui.stage.hint}</p>
    <p>下の3つのタブで育て方を選びます。どれから試してもかまいません。</p><button class="btn solid block" data-close>はじめる</button>`);
  save.last[ui.stage.id] = ui.method; Save.persist(save);
}

function renderTabs() {
  const ms = $('#methods'), ss = $('#steps');
  ms.innerHTML = METHODS.map((m) => {
    const r = save.st[ui.stage.id] && save.st[ui.stage.id][m.id], n = r ? r.stars : 0;
    return `<button class="${m.id}" role="tab" aria-selected="${m.id === ui.method}" data-m="${m.id}">${m.name}<small>${'★'.repeat(n)}${'☆'.repeat(3 - n)}</small></button>`;
  }).join('');
  ms.querySelectorAll('button').forEach((b) => { b.onclick = () => setMethod(b.dataset.m); });
  ss.innerHTML = STEPS[ui.method].map(([id, name], i) => `<button role="tab" aria-selected="${id === ui.step}" data-s="${id}"><i>${i + 1}</i>${name}</button>`).join('');
  ss.querySelectorAll('button').forEach((b) => { b.onclick = () => setStep(b.dataset.s); });
}

function setMethod(m) {
  if (m === ui.method) return;
  if (ui.job) { toast('学習や検定の途中は、育て方を切り替えられません'); return; }
  ui.method = m; ui.examOut = null; ui.exam = null;
  save.last[ui.stage.id] = m; Save.persist(save);
  const keep = STEPS[m].find((s) => s[0] === ui.step);
  ui.step = keep ? ui.step : STEPS[m][0][0];
  renderTabs(); setStep(ui.step);
}

function setStep(s) {
  ui.step = s;
  document.querySelectorAll('#steps button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.s === s)));
  applyLive(); renderPanel();
}

// 画面に映す1台の動かし方を決める
function applyLive() {
  if (!ui.stage || ui.opening) return;
  const ready = slot().ready;
  let mode;
  if (ui.step === 'teach' && !ui.job) mode = 'teach';
  else mode = ready ? 'watch' : (ui.method === 'rl' ? 'idle' : 'expert');
  const key = mode + ':' + ui.method;
  if (key === ui.liveKey) return;
  ui.liveKey = key; ui.touching = false; scene.setCursor(0, 0, false);
  worker.postMessage({ type: 'live', mode, method: ui.method });
}

const canControl = () => !ui.job && !ui.opening && (ui.step === 'teach' || (ui.step === 'learn' && ui.method !== 'rl' && slot().ready));

// ---------------------------------------------------------------- パネル
function renderPanel() {
  if (ui.step === 'teach') panelTeach();
  else if (ui.step === 'learn') panelLearn();
  else if (ui.step === 'practice') panelPractice();
  else if (ui.step === 'exam') panelExam();
  else panelCmp();
  refresh();
}

function bindCommon() {
  const g = $('#btn-grip', panel);
  if (g) g.onclick = () => { if (!canControl()) return; ui.gripSeq++; ui.dirty = true; };
  const n = $('#btn-next', panel);
  if (n) n.onclick = () => worker.postMessage({ type: 'next' });
  const r = $('#btn-reset', panel);
  if (r) r.onclick = () => modal(`<h2>頭脳をリセットしますか？</h2><p>「${METHOD[ui.method].name}」で育てた頭脳が、この現場のぶんだけ まっさらに戻ります（★と記録は残ります）。</p>
    <div class="row"><button class="btn" data-close>やめる</button><button class="btn warn" id="yes" data-close>リセット</button></div>`, (m) => {
    $('#yes', m).onclick = () => { worker.postMessage({ type: 'reset', method: ui.method }); ui.liveKey = ''; $('#modal').hidden = true; };
  });
}

function panelTeach() {
  const t = ui.stage.task;
  const lead = t === 'touch' ? '指で机をなぞると手先がついてきます。<b>ブロックに手先でふれれば成功</b>です（にぎらなくてOK）。'
    : t === 'grasp' ? '指で机をなぞると手先がついてきます。ブロックの真上で<b>にぎる</b>と成功です。'
      : '指で机をなぞると手先がついてきます。ブロックの上で<b>にぎる</b>、同じ色の置き場の上で<b>はなす</b>。';
  panel.innerHTML = `<p>${lead}</p>
    ${t === 'touch' ? '' : '<div class="row"><button class="btn hot grip-btn" id="btn-grip">にぎる</button></div>'}
    <div class="kv"><div><span class="k">お手本</span><span class="v" id="d-n"></span></div><div><span class="k">自分</span><span class="v" id="d-h"></span></div>
      <div><span class="k">お手本ロボ</span><span class="v" id="d-r"></span></div><div><span class="k">手直し</span><span class="v" id="d-f"></span></div></div>
    <div class="row"><button class="btn" id="btn-next">並べ直す</button><button class="btn" id="btn-robot">お手本ロボ +10本</button></div>
    <div class="row"><button class="btn small" id="btn-undo">1本もどす</button><button class="btn small warn" id="btn-clear">ぜんぶ消す</button></div>
    <p class="note">指を離している間は時間が止まります。失敗した回は記録されません。お手本ロボは、わざと少しよろけながら運びます（立て直し方もお手本に入れるため）。お手本は多いほど上手になりますが、少ない本数で合格するほど良い記録です。次は「まねる」へ。</p>`;
  bindCommon();
  $('#btn-robot', panel).onclick = () => { if (!ui.job) worker.postMessage({ type: 'demo', op: 'robot', n: 10 }); };
  $('#btn-undo', panel).onclick = () => { if (!ui.job) worker.postMessage({ type: 'demo', op: 'undo' }); };
  $('#btn-clear', panel).onclick = () => { if (!ui.job && ui.demos.total) modal(`<h2>お手本をぜんぶ消しますか？</h2><p>この現場のお手本 ${ui.demos.total}本が消えます。</p>
    <div class="row"><button class="btn" data-close>やめる</button><button class="btn warn" id="yes">消す</button></div>`, (m) => {
    $('#yes', m).onclick = () => { worker.postMessage({ type: 'demo', op: 'clear' }); $('#modal').hidden = true; };
  }); };
}

function panelLearn() {
  panel.innerHTML = `
    <div class="row"><button class="btn solid" id="btn-bc"></button>
      <select class="btn fix" id="bc-epochs" aria-label="学習の回数">${[20, 40, 80].map((n) => `<option value="${n}" ${n === ui.epochs ? 'selected' : ''}>${n}周</option>`).join('')}</select></div>
    <div class="progress"><i id="bc-bar"></i></div>
    <div class="kv"><div><span class="k">お手本</span><span class="v" id="d-n"></span></div><div><span class="k">学習</span><span class="v" id="l-ep"></span></div>
      <div><span class="k">一致率</span><span class="v" id="l-acc"></span></div><div><span class="k">腕前のめやす</span><span class="v" id="l-est"></span></div></div>
    <canvas class="chart" id="chart-bc"></canvas>
    <div class="legend"><span><i style="--c:var(--amber)"></i>一致率（お手本と同じ行動を選べた割合）</span></div>
    <div class="row">${ui.stage.task === 'touch' ? '' : '<button class="btn hot" id="btn-grip">にぎる</button>'}<button class="btn" id="btn-next">並べ直す</button></div>
    <p class="note"><b>手直し</b>: アームが動いている間に机をなぞると、その間だけあなたが操作します。成功で終わると、その直し方がお手本に加わります（もう一度「まねる」で反映）。</p>
    <div class="row">${ui.method === 'mix' ? '<button class="btn small" id="btn-copy">「模倣学習」の頭脳をコピー</button>' : ''}<button class="btn small warn" id="btn-reset">頭脳をリセット</button></div>
    <label class="note"><input type="checkbox" id="aug" ${save.augment !== false ? 'checked' : ''}> お手本の水増し（机ごと回す・左右を裏返す）</label>`;
  bindCommon();
  $('#bc-epochs', panel).onchange = (e) => { ui.epochs = +e.target.value; refresh(); };
  $('#aug', panel).onchange = (e) => { save.augment = e.target.checked; Save.persist(save); };
  $('#btn-bc', panel).onclick = () => {
    if (ui.job === 'bc') { worker.postMessage({ type: 'bc', op: 'stop' }); return; }
    if (ui.job) return;
    if (!ui.demos.total) { toast('まず「教える」でお手本を記録してください'); return; }
    worker.postMessage({ type: 'bc', op: 'start', method: ui.method, epochs: ui.epochs, augment: save.augment !== false });
  };
  const c = $('#btn-copy', panel);
  if (c) c.onclick = () => { if (!ui.job) { worker.postMessage({ type: 'copy' }); ui.liveKey = ''; } };
}

function panelPractice() {
  const sliders = REWARD_UI.map(([k, name, lo, hi, st]) => `<label class="slider"><span>${name}</span><input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${st}" value="${ui.reward[k]}"><output>${ui.reward[k]}</output></label>`).join('');
  panel.innerHTML = `
    <div class="row"><button class="btn solid" id="btn-rl"></button></div>
    <div class="kv"><div><span class="k">練習量</span><span class="v" id="r-steps"></span></div><div><span class="k">成功率</span><span class="v" id="r-rate"></span></div>
      <div><span class="k">速さ</span><span class="v" id="r-sps"></span></div><div><span class="k">迷い</span><span class="v" id="r-ent"></span></div></div>
    <canvas class="chart" id="chart-rl"></canvas>
    <div class="legend"><span><i style="--c:var(--${ui.method})"></i>練習中の成功率（直近200回）</span></div>
    <details id="rw"><summary>ごほうび設計</summary>${sliders}
      <div class="row"><button class="btn small" data-p="default">おすすめ</button><button class="btn small" data-p="sparse">成功だけ</button><button class="btn small" data-p="hurry">急がせる</button></div>
      <p class="note">近づいた分・運んだ分だけ少しずつもらえる「誘導」のごほうびと、成功したときのごほうび。変更は次に「練習」を始めたときから効きます。</p></details>
    <div class="row"><button class="btn small" id="btn-inherit">ほかの現場の頭脳を引き継ぐ</button><button class="btn small warn" id="btn-reset">頭脳をリセット</button></div>
    <p class="note">${ui.method === 'mix' ? '「まねる」で覚えた動きを出発点に、自分で試して磨きます。' : 'まっさらな頭脳が、ごほうびだけを頼りに自分で覚えます。お手本は使いません。'}画面を開いたままにしてください。</p>`;
  bindCommon();
  $('#btn-rl', panel).onclick = () => {
    if (ui.job === 'rl') { worker.postMessage({ type: 'rl', op: 'pause' }); return; }
    if (ui.job) return;
    if (ui.method === 'mix' && !slot().ready) { toast('先に「まねる」で模倣学習をしてください'); return; }
    worker.postMessage({ type: 'rl', op: 'start', method: ui.method, reward: ui.reward });
  };
  panel.querySelectorAll('input[type=range]').forEach((r) => { r.oninput = () => { ui.reward[r.dataset.k] = +r.value; r.nextElementSibling.textContent = r.value; save.reward = ui.reward; Save.persist(save); }; });
  panel.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { ui.reward = Object.assign({}, PRESETS[b.dataset.p]); save.reward = ui.reward; Save.persist(save); const open = $('#rw', panel).open; panelPractice(); $('#rw', panel).open = open; refresh(); }; });
  $('#btn-inherit', panel).onclick = showInherit;
}

function showInherit() {
  if (ui.job) return;
  const items = [];
  for (const st of STAGES) {
    if (st.id === ui.stage.id) continue;
    for (const m of METHODS) {
      const s = save.models[st.id] && save.models[st.id][m.id];
      if (s && s.ready) items.push(`<button class="btn" data-st="${st.id}" data-m="${m.id}">${st.no}. ${st.name}・${m.name}</button>`);
    }
  }
  modal(`<h2>頭脳を引き継ぐ</h2><p>ほかの現場で育てた頭脳をコピーして、この現場の「${METHOD[ui.method].name}」の出発点にします。いまの頭脳は上書きされます。引き継いだ頭脳の成績は「最少記録」には数えません。</p>
    <div class="list">${items.join('') || '<p>まだ、ほかの現場で育てた頭脳がありません。</p>'}</div><button class="btn block" data-close>やめる</button>`, (m) => {
    m.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => { worker.postMessage({ type: 'inherit', method: ui.method, fromStage: b.dataset.st, fromMethod: b.dataset.m }); ui.liveKey = ''; m.hidden = true; }; });
  });
}

function panelExam() {
  panel.innerHTML = `
    <div class="row"><button class="btn solid" id="btn-exam">検定を受ける（100問）</button></div>
    <div class="grid100" id="grid">${'<i></i>'.repeat(100)}</div>
    <div class="result" id="result"></div>
    <div class="kv"><div><span class="k">最高</span><span class="v" id="x-best"></span></div><div><span class="k">最少記録 ★1</span><span class="v" id="x-m1"></span></div>
      <div><span class="k">★2</span><span class="v" id="x-m2"></span></div><div><span class="k">★3</span><span class="v" id="x-m3"></span></div></div>
    <p class="note" id="x-solo"></p>
    <p class="note">合格率 ${pct(STAR_RATES[0])}で★、${pct(STAR_RATES[1])}で★★、${pct(STAR_RATES[2])}で★★★。出題は毎回同じ100問なので、同じ頭脳なら同じ結果になります。</p>`;
  $('#btn-exam', panel).onclick = () => {
    if (ui.job) return;
    if (!slot().ready) { toast('まだ育てていません'); return; }
    ui.examOut = null; worker.postMessage({ type: 'exam', method: ui.method });
  };
}

function panelCmp() {
  panel.innerHTML = `<canvas class="chart tall" id="chart-cmp"></canvas>
    <div class="legend">${METHODS.map((m) => `<span><i style="--c:var(--${m.id})"></i>${m.name}</span>`).join('')}</div>
    <table class="cmp"><thead><tr><th>育て方</th><th>検定の最高</th><th>★</th><th>お手本</th><th>練習量</th></tr></thead><tbody id="cmp-body"></tbody></table>
    <p class="note">横軸は練習量（強化学習で動いた歩数）。模倣学習だけの成績は横線で示しています。</p>`;
}

function costText(m, c) {
  if (!c) return '–';
  if (m === 'bc') return `${c.demos}<small>本</small>`;
  if (m === 'rl') return `${fmtN(c.steps)}<small>歩</small>`;
  return `${c.demos}<small>本</small>+${fmtN(c.steps)}<small>歩</small>`;
}

// 数字やグラフなど、変わる所だけ書き直す
function refresh() {
  if (!ui.stage) return;
  const d = ui.demos, s = slot(), m = ui.method;
  set('#d-n', `${d.total}<small>本</small>`); set('#d-h', String(d.human)); set('#d-r', String(d.robot)); set('#d-f', String(d.fix));
  const gb = $('#btn-grip', panel);
  if (gb) { gb.textContent = ui.grip ? 'はなす' : 'にぎる'; gb.disabled = !canControl(); }
  for (const id of ['#btn-robot', '#btn-undo', '#btn-clear', '#btn-reset']) { const b = $(id, panel); if (b) b.disabled = !!ui.job; }
  if (ui.step === 'learn') {
    const run = ui.job === 'bc', b = $('#btn-bc', panel);
    b.textContent = run ? '止める' : (s.bcEpochs ? `もっとまねる（+${ui.epochs}周）` : `まねる（${ui.epochs}周）`);
    b.disabled = (!!ui.job && !run) || (m === 'mix' && s.rlSteps > 0);
    const last = s.bcCurve && s.bcCurve.length ? s.bcCurve[s.bcCurve.length - 1] : null;
    set('#l-ep', `${s.bcEpochs || 0}<small>周</small>`);
    set('#l-acc', last ? pct(last[2]) : '–');
    set('#l-est', run ? '<small>学習中…</small>' : (s.estimate == null ? '–' : pct(s.estimate)));
    const bar = $('#bc-bar', panel);
    if (bar) bar.style.width = run && ui.bc ? (ui.bc.epoch / ui.bc.epochs * 100) + '%' : '0%';
    const c = $('#chart-bc', panel);
    if (c) drawChart(c, { series: [{ pts: (s.bcCurve || []).map((p) => [p[0], p[2]]), color: '#ffb020' }], yMin: 0, yMax: 1, yFmt: pct, xFmt: (v) => v ? v + '周' : '0', empty: 'まだ学習していません' });
    const cp = $('#btn-copy', panel);
    if (cp) cp.disabled = !!ui.job || !(ui.slots.bc && ui.slots.bc.ready) || s.rlSteps > 0;
  } else if (ui.step === 'practice') {
    const run = ui.job === 'rl', b = $('#btn-rl', panel);
    b.textContent = run ? '一時停止' : (s.rlSteps ? '練習を続ける' : '練習スタート');
    b.disabled = (!!ui.job && !run) || (m === 'mix' && !s.ready);
    b.classList.toggle('hot', run); b.classList.toggle('solid', !run);
    set('#r-steps', `${fmtN(s.rlSteps || 0)}<small>歩</small>`);
    set('#r-rate', s.rlSteps && s.rlCurve && s.rlCurve.length ? pct(s.estimate || 0) : (s.rlSteps ? '<small>計測中</small>' : '–'));
    set('#r-sps', run && ui.rl && ui.rl.sps ? `${Math.round(ui.rl.sps)}<small>歩/秒</small>` : '–');
    set('#r-ent', ui.rl && ui.rl.entropy != null ? ui.rl.entropy.toFixed(2) : '–');
    const c = $('#chart-rl', panel);
    if (c) drawChart(c, { series: [{ pts: s.rlCurve || [], color: getComputedStyle(document.documentElement).getPropertyValue('--' + m).trim() }], yMin: 0, yMax: 1, yFmt: pct, xFmt: (v) => v ? fmtN(v) + '歩' : '0', hlines: STAR_RATES.slice(2).map((y) => ({ y, color: 'rgba(255,176,32,.5)', label: '★★★' })), empty: m === 'mix' && !s.ready ? '先に「まねる」で模倣学習を' : 'まだ練習していません' });
    const ib = $('#btn-inherit', panel); if (ib) ib.disabled = !!ui.job;
  } else if (ui.step === 'exam') {
    const b = $('#btn-exam', panel);
    b.disabled = !!ui.job || !s.ready;
    b.textContent = ui.job === 'exam' ? '検定中…' : (s.ready ? '検定を受ける（100問）' : 'まだ育てていません');
    const g = $('#grid', panel), res = ui.exam;
    if (g) [...g.children].forEach((c, i) => { c.className = res && res[i] === 1 ? 'ok' : res && res[i] === 0 ? 'ng' : ''; });
    const o = ui.examOut;
    set('#result', o ? `<span class="rate">${Math.round(o.rate * 100)}<small>%</small></span>${starHtml(o.stars)}${o.msg ? `<span class="msg">${o.msg}</span>` : ''}` : '');
    const r = save.st[ui.stage.id] && save.st[ui.stage.id][m];
    set('#x-best', r && r.tries ? `${pct(r.best)}${r.inherit ? '<small> 引継</small>' : ''}` : '–');
    for (const k of [1, 2, 3]) set('#x-m' + k, r && r.min[k] ? costText(m, r.min[k]) : '–');
    set('#x-solo', m === 'rl' ? '' : `自力（お手本ロボを使わず、自分のお手本と手直しだけ）: ${r && r.solo ? '★'.repeat(r.solo) : 'まだ'}`);
  } else if (ui.step === 'cmp') {
    const col = (id) => getComputedStyle(document.documentElement).getPropertyValue('--' + id).trim();
    const series = [], hlines = [];
    const bcRec = save.st[ui.stage.id] && save.st[ui.stage.id].bc;
    const bcLevel = bcRec && bcRec.tries ? bcRec.best : (ui.slots.bc && ui.slots.bc.estimate != null && ui.slots.bc.ready ? ui.slots.bc.estimate : null);
    if (bcLevel != null) hlines.push({ y: bcLevel, color: col('bc'), label: '模倣 ' + pct(bcLevel) });
    for (const id of ['rl', 'mix']) {
      const sl = ui.slots[id];
      if (!sl || !sl.rlCurve || !sl.rlCurve.length) continue;
      const pts = sl.rlCurve.slice();
      if (id === 'mix' && sl.bcEstimate != null) pts.unshift([0, sl.bcEstimate]);
      series.push({ pts, color: col(id) });
    }
    const c = $('#chart-cmp', panel);
    if (c) drawChart(c, { series, hlines, yMin: 0, yMax: 1, yFmt: pct, xFmt: (v) => v ? fmtN(v) + '歩' : '0', empty: 'まだ成績がありません' });
    set('#cmp-body', METHODS.map((mm) => {
      const r = save.st[ui.stage.id] && save.st[ui.stage.id][mm.id], sl = ui.slots[mm.id] || {};
      return `<tr><td class="${mm.id}">${mm.name}</td><td>${r && r.tries ? pct(r.best) : (sl.ready && sl.estimate != null ? '<small>めやす</small> ' + pct(sl.estimate) : '–')}</td>
        <td class="st">${r ? '★'.repeat(r.stars) : ''}</td><td>${mm.id === 'rl' || !sl.ready ? '–' : (sl.bcDemos || 0) + '本'}</td><td>${mm.id === 'bc' || !sl.ready ? '–' : fmtN(sl.rlSteps || 0) + '歩'}</td></tr>`;
    }).join(''));
  }
  document.querySelectorAll('#methods button').forEach((b) => { b.disabled = !!ui.job && b.dataset.m !== ui.method; });
}

// ---------------------------------------------------------------- ワーカーからの知らせ
function onFrame(m) {
  if (!ui.stage) return;
  scene.push(m.snap, ui.period, m.t === 0 || m.t < ui.lastT || ui.lastT < 0);
  ui.lastT = m.t;
  const e = m.eye, px = eyeImg.data;
  for (let i = 0, j = 0; i < 1024; i++, j += 4) { px[j] = e[i * 3]; px[j + 1] = e[i * 3 + 1]; px[j + 2] = e[i * 3 + 2]; px[j + 3] = 255; }
  eyeCtx.putImageData(eyeImg, 0, 0);
  ovCtx.clearRect(0, 0, 192, 192);
  if (m.keys) {
    // 注目点: 頭脳が画像の中で「ここ」と見ている場所（丸の濃さ＝そこに何かある確信）
    for (let k = 0; k < m.keys.length / 3; k++) {
      const mass = m.keys[k * 3 + 2];
      if (mass < 0.12) continue;
      ovCtx.strokeStyle = `hsla(${(k * 47) % 360}, 100%, 70%, ${Math.min(1, 0.3 + mass)})`; ovCtx.lineWidth = 3;
      ovCtx.beginPath(); ovCtx.arc((m.keys[k * 3] + 1) * 96, (m.keys[k * 3 + 1] + 1) * 96, 9, 0, 7); ovCtx.stroke();
    }
  }
  const pb = $('#probs');
  if (m.probs) { pb.hidden = false; for (let i = 0; i < 8; i++) probBars[i].style.transform = `scaleY(${Math.max(0.04, m.probs[i]).toFixed(3)})`; } else pb.hidden = true;
  if (m.grip !== ui.grip) { ui.grip = m.grip; const gb = $('#btn-grip', panel); if (gb) gb.textContent = ui.grip ? 'はなす' : 'にぎる'; }
  const who = m.src === 'human' ? ['who-human', 'あなた'] : m.src === 'ai' ? ['who-ai', 'AI'] : m.src === 'robot' ? ['who-robot', 'お手本ロボ'] : ['', '–'];
  $('#status').innerHTML = `<div class="${who[0]}">操作 <b>${who[1]}</b></div><div>歩数 <b>${m.t}</b>/${m.max}</div>${m.pending ? `<div>記録中 <b>${m.pending}</b>歩</div>` : ''}${ui.job === 'rl' ? '<div><b>練習中</b></div>' : ui.job === 'bc' ? '<div><b>学習中</b></div>' : ''}`;
  if (m.event && EVENTS[m.event]) {
    const ev = EVENTS[m.event];
    ticker(ev[0], ev[1]);
    if (m.event === 'success' || m.event === 'demo' || m.event === 'fixed') scene.flash('success');
    else if (m.event === 'fail' || m.event === 'timeout' || m.event === 'miss') scene.flash('fail');
    else if (m.event === 'grasp') scene.flash('grasp');
  }
}

function onExamDone(m) {
  ui.job = null; ui.exam = m.results;
  ui.slots[m.method] = m.meta;
  const cost = { demos: m.method === 'rl' ? 0 : (m.meta.bcDemos || 0), steps: m.meta.rlSteps || 0, robot: m.method === 'rl' ? 0 : m.demos.robot };
  const out = Save.recordExam(save, ui.stage.id, m.method, m.rate, cost, m.meta.inherit);
  const msgs = [];
  if (out.gained) msgs.push(`★が${out.gained}つ増えました`);
  else if (out.newBest) msgs.push('自己ベスト更新');
  if (out.records.length) msgs.push('最少記録を更新');
  if (out.solo) msgs.push('自力（お手本ロボなし）で達成');
  if (out.unlockedNext) msgs.push(`次の現場「${out.unlockedNext.name}」が開きました`);
  if (!out.stars) msgs.push(`★まであと ${Math.max(1, Math.round((STAR_RATES[0] - m.rate) * 100))}%`);
  ui.examOut = { rate: m.rate, stars: out.stars, msg: msgs.join('・') };
  if (out.stars) scene.flash('success');
  renderTabs(); refresh();
}

worker.onmessage = (ev) => {
  const m = ev.data;
  switch (m.type) {
    case 'ready': break;
    case 'opened': onOpened(m); break;
    case 'frame': onFrame(m); break;
    case 'demos': ui.demos = m.demos; refresh(); break;
    case 'slots':
      if (!ui.stage || m.stage !== ui.stage.id) break;
      ui.slots = m.slots; Save.noteModels(save, ui.stage.id, ui.slots); ui.liveKey = ''; applyLive(); refresh();
      break;
    case 'bc':
      if (!ui.stage) break;
      if (m.state === 'start') { ui.job = 'bc'; ui.bc = { epoch: 0, epochs: m.epochs }; ui.liveKey = ''; applyLive(); }
      else if (m.state === 'progress') {
        ui.bc = { epoch: m.epoch, epochs: m.epochs };
        const s = ui.slots[m.method]; s.ready = true; s.bcEpochs = m.total; (s.bcCurve = s.bcCurve || []).push([m.total, m.loss, m.acc]);
        if (m.epoch === 1) { ui.liveKey = ''; applyLive(); }
      } else { ui.job = null; ui.bc = null; ui.slots[m.method] = m.meta; Save.noteModels(save, ui.stage.id, ui.slots); ui.liveKey = ''; applyLive(); if (m.meta.estimate != null) toast(`腕前のめやす: 成功率 ${pct(m.meta.estimate)}`); }
      refresh();
      break;
    case 'rl':
      if (!ui.stage) break;
      if (m.state === 'start') { ui.job = 'rl'; ui.rl = { sps: 0 }; ui.slots[m.method].ready = true; setWake(true); ui.liveKey = ''; applyLive(); }
      else if (m.state === 'progress') {
        const s = ui.slots[m.method];
        s.rlSteps = m.steps;
        if (m.point) { s.estimate = m.rate; (s.rlCurve = s.rlCurve || []).push(m.point); if (s.rlCurve.length > 240) s.rlCurve = s.rlCurve.filter((_, i) => i % 2 === 1); }
        ui.rl = { sps: m.sps, entropy: m.entropy, ret: m.ret };
      } else { ui.job = null; ui.slots[m.method] = m.meta; Save.noteModels(save, ui.stage.id, ui.slots); setWake(false); }
      refresh();
      break;
    case 'exam':
      if (!ui.stage) break;
      if (m.state === 'start') { ui.job = 'exam'; ui.exam = null; ui.examOut = null; }
      else if (m.state === 'progress') ui.exam = m.results;
      else if (m.state === 'done') { onExamDone(m); break; }
      else ui.job = null;
      refresh();
      break;
    case 'toast': toast(m.text); break;
    case 'error': console.error(m.text); toast('エラーが起きました。開き直してみてください'); break;
  }
};
worker.onerror = (e) => { console.error('worker', e.message); toast('学習用の裏方を起動できませんでした'); };

// ---------------------------------------------------------------- 指の操作（机をなぞる → 手先の行き先）
function aim(e) {
  const p = scene.pick(e.clientX, e.clientY - (e.pointerType === 'touch' ? 42 : 0));
  if (!p) return;
  ui.tx = p.x; ui.ty = p.y; ui.dirty = true;
  scene.setCursor(p.x, p.y, true);
}
gl.addEventListener('pointerdown', (e) => {
  if (!ui.stage || !canControl()) return;
  ui.pid = e.pointerId; ui.touching = true;
  try { gl.setPointerCapture(e.pointerId); } catch (err) { /* 古い環境 */ }
  aim(e); e.preventDefault();
});
gl.addEventListener('pointermove', (e) => { if (ui.touching && e.pointerId === ui.pid) aim(e); });
const lift = (e) => { if (e.pointerId !== ui.pid) return; ui.touching = false; ui.dirty = true; scene.setCursor(0, 0, false); };
gl.addEventListener('pointerup', lift); gl.addEventListener('pointercancel', lift);

$('#btn-back').onclick = goHome;
$('#btn-view').onclick = () => { $('#btn-view').textContent = scene.toggleView() === 'top' ? '斜め' : '真上'; };
$('#btn-speed').onclick = () => {
  ui.period = ui.period === 50 ? 17 : 50;
  $('#btn-speed').textContent = ui.period === 50 ? '×1' : '×3';
  worker.postMessage({ type: 'speed', period: ui.period });
};
window.addEventListener('resize', () => scene.resize());
document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.job === 'rl') setWake(true); });

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (ui.dirty) { ui.dirty = false; worker.postMessage({ type: 'input', x: ui.tx, y: ui.ty, touching: ui.touching && canControl(), gripSeq: ui.gripSeq }); }
  if (!play.hidden) scene.render(dt);
  requestAnimationFrame(loop);
}

renderHome();
requestAnimationFrame(loop);
if (!save.help) { save.help = true; Save.persist(save); showHelp(); }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// 開発・確認用: ?s=place&m=rl&step=practice で現場を直接開く
const q = new URLSearchParams(location.search);
if (q.get('s') && STAGE_BY_ID[q.get('s')]) {
  $('#modal').hidden = true;
  if (q.get('m')) save.last[q.get('s')] = q.get('m');
  openStage(q.get('s'));
  if (q.get('step')) { const want = q.get('step'); const t = setInterval(() => { if (!ui.opening) { clearInterval(t); $('#modal').hidden = true; if (STEPS[ui.method].some((x) => x[0] === want)) setStep(want); } }, 50); }
}
window.__app = { ui, worker, save, scene, setStep, setMethod, openStage, goHome };
