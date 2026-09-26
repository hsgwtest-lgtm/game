/* =====================================================================
   SoftEvo 8 — arena.js
   闘技場: 育てた生物どうしを戦わせる
   ・かけっこ : 同じ条件で横一列 (最大6体)。「共通の地形」か「それぞれの故郷」で
   ・すもう / つなひき : 西 vs 東 の三番勝負。2つの脳が同時に動くのを見比べる
   ・出場者は「マイ生物」の好きな世代 (過去の自分とも戦える) か「道場」の師範
   ・物理は決定論的: 同じ組み合わせは何度見ても同じ結果。変えたければ鍛える
   ===================================================================== */
import { ARENA_MODES, BATTLES, OPENINGS, PRESETS, DEFAULT_SETTINGS, TERRAINS, prepareFighter } from './sim.js';
import { Theater, WEST, EAST } from './theater.js';
import { BrainView } from './brainview.js';
import { drawThumb } from './world.js';
import { DOJO } from './dojo.js';
import * as store from './store.js';
import { $, $$, el, toast } from './ui.js';

const RACE_MAX = 6;
const RACE_HUES = [195, 330, 45, 140, 270, 20];
const MEDALS = ['🥇', '🥈', '🥉'];
const BOUT_NAMES = ['一番', '二番', '三番'];

export class Arena {
  constructor(hooks) {
    this.hooks = hooks;
    this.mode = 'sumo';
    this.duel = [null, null];
    this.racers = [];
    this.raceEnv = 'common';
    this.terrain = 'flat';
    this.state = 'idle';
    this.theater = new Theater($('#arena-canvas'), { onFinish: () => this.onFinish(), onDecision: m => this.onDecision(m) });
    this.brains = [new BrainView($('#arena-brain-w')), new BrainView($('#arena-brain-e'))];
    this.bind();
  }

  bind() {
    $$('#arena-mode button').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    $$('#arena-speed button').forEach(b => b.addEventListener('click', () => {
      this.theater.speed = +b.dataset.speed;
      $$('#arena-speed button').forEach(x => x.classList.toggle('active', x === b));
    }));
    $('#arena-start').addEventListener('click', () => (this.state === 'playing' ? this.stop() : this.start()));
    $('#arena-home').addEventListener('click', () => { this.stop(); this.hooks.onHome(); });
  }

  // ─── 出場者の候補 ───
  candidates() {
    const list = [];
    for (const meta of store.listRuns()) {
      const d = store.loadRun(meta.id);
      if (!d || !d.blueprint) continue;
      const snaps = [], seen = new Set();
      const add = (gen, g, tag) => { if (g && !seen.has(gen)) { seen.add(gen); snaps.push({ gen, g, tag }); } };
      const gs = (d.genomes || []).slice().sort((a, b) => b.gen - a.gen);
      if (d.best) add(d.best.gen, d.best.g, '🏆最高記録');
      if (gs.length) add(gs[0].gen, gs[0].g, '最新');
      for (const x of gs) add(x.gen, x.g, '');
      if (!snaps.length) continue;
      snaps.sort((a, b) => b.gen - a.gen);
      const B = BATTLES[d.settings.objective];
      list.push({ kind: 'run', id: d.id, name: d.name, bp: d.blueprint, settings: { ...DEFAULT_SETTINGS, ...d.settings }, obj: d.settings.objective, snaps,
        note: B ? `${B.icon} ${B.name}の特訓をした脳` : `${TERRAINS[d.settings.terrain]?.icon || ''} ${TERRAINS[d.settings.terrain]?.name || ''}で進化` });
    }
    for (const x of DOJO) {
      list.push({ kind: 'dojo', id: `dojo:${x.id}`, name: x.name, icon: x.icon, bp: PRESETS[x.key].bp, settings: { ...DEFAULT_SETTINGS }, obj: x.obj, mode: x.mode, note: x.note, snaps: [{ gen: null, g: x.g, tag: '' }] });
    }
    return list;
  }

  fighter(c, si = 0) {
    const s = c.snaps[Math.min(si, c.snaps.length - 1)];
    return {
      cid: c.id, si, src: c.kind, baseName: c.name, gen: s.gen,
      name: s.gen != null ? `${c.name}·${s.gen}代` : c.name,
      bp: c.bp, hidden: c.settings.hidden, hidden2: c.settings.hidden2 || 0, obj: c.obj, g: store.b64ToF32(s.g),
      settings: c.settings, hue: 0,
    };
  }

  /** 画面に入る: 候補を読み直して、空いている枠を埋める */
  enter() {
    this.cands = this.candidates();
    const byId = new Map(this.cands.map(c => [c.id, c]));
    const refresh = f => (f && byId.has(f.cid) ? this.fighter(byId.get(f.cid), f.si) : null);
    this.duel = this.duel.map(refresh);
    this.racers = this.racers.map(refresh).filter(Boolean);
    this.fillDefaults();
    this.setMode(this.mode);
  }

  fillDefaults() {
    const mine = this.cands.filter(c => c.kind === 'run' && !BATTLES[c.obj]);
    const dojo = id => this.cands.find(c => c.id === `dojo:${id}`);
    if (!this.duel[0]) this.duel[0] = this.fighter(mine[0] || dojo('quad'));
    if (!this.duel[1]) this.duel[1] = this.fighter(dojo(mine.length ? 'biped' : 'inchworm'));
    if (!this.racers.length) {
      const pool = [...mine.slice(0, 3), ...['quad', 'biped', 'inchworm', 'wheel'].map(dojo)];
      this.racers = pool.slice(0, 4).map(c => this.fighter(c));
    }
  }

  setMode(mode) {
    this.stop(false);
    this.mode = mode;
    $$('#arena-mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.body.dataset.arena = mode === 'race' ? 'race' : 'duel';
    $('#arena-desc').textContent = `${ARENA_MODES[mode].icon} ${ARENA_MODES[mode].desc}`;
    $('#arena-start').textContent = mode === 'race' ? '▶ スタート' : '▶ 三番勝負';
    this.renderEntrants();
    this.renderOptions();
    $('#arena-result').innerHTML = '';
    $('#arena-score').innerHTML = '';
    this.preview();
  }

  // ─── 出場者パネル ───
  renderEntrants() {
    const box = $('#arena-entrants');
    box.innerHTML = '';
    if (this.mode === 'race') {
      this.racers.forEach((f, i) => box.append(this.entrantCard(f, `${i + 1}`, `hsl(${RACE_HUES[i]},80%,65%)`,
        g => { this.racers[i] = g; this.changed(); }, () => { this.racers.splice(i, 1); this.changed(); })));
      if (this.racers.length < RACE_MAX) {
        box.append(el('button', { class: 'btn ghost add-entrant', onclick: () => this.pick(f => { this.racers.push(f); this.changed(); }) }, '＋ 出場者を追加'));
      }
    } else {
      box.append(this.entrantCard(this.duel[0], '西', WEST, f => { this.duel[0] = f; this.changed(); }));
      box.append(el('button', { class: 'swap-btn', title: '西と東を入れ替える', onclick: () => { this.duel.reverse(); this.changed(); } }, '⇅ 入れ替え'));
      box.append(this.entrantCard(this.duel[1], '東', EAST, f => { this.duel[1] = f; this.changed(); }));
    }
  }

  entrantCard(f, side, color, onChange, onRemove) {
    const c = this.cands.find(x => x.id === f.cid);
    const cv = el('canvas', { class: 'ent-thumb' });
    const info = el('div', { class: 'ent-info' }, el('b', {}, c ? c.name : f.name));
    if (c && c.snaps.length > 1) {
      const sel = el('select', { class: 'ent-gen', 'aria-label': '世代' });
      c.snaps.forEach((s, i) => sel.append(el('option', { value: i, selected: i === f.si }, `第${s.gen}世代 ${s.tag}`)));
      sel.addEventListener('change', () => onChange(this.fighter(c, +sel.value)));
      info.append(sel);
    }
    info.append(el('small', {}, c ? c.note : ''));
    const card = el('div', { class: 'entrant', style: `--c:${color}` },
      el('span', { class: 'ent-side' }, side), cv, info,
      el('div', { class: 'ent-actions' },
        el('button', { class: 'btn ghost small', onclick: () => this.pick(onChange) }, '変更'),
        onRemove ? el('button', { class: 'x', title: '外す', onclick: onRemove }, '✕') : null));
    requestAnimationFrame(() => drawThumb(cv, f.bp));
    return card;
  }

  /** 出場者を選ぶダイアログ */
  pick(onPick) {
    const back = el('div', { class: 'modal-back' });
    const close = () => back.remove();
    const box = el('div', { class: 'modal wide' }, el('h3', {}, '出場者を選ぶ'));
    const section = (title, items) => {
      if (!items.length) return;
      box.append(el('h4', { class: 'pick-h' }, title));
      const grid = el('div', { class: 'pick-grid' });
      for (const c of items) {
        const cv = el('canvas', { class: 'pick-thumb' });
        grid.append(el('button', { class: 'pick-item', onclick: () => { close(); onPick(this.fighter(c)); } },
          cv, el('b', {}, `${c.icon ? c.icon + ' ' : ''}${c.name}`), el('small', {}, c.snaps[0].gen != null ? `第${c.snaps[0].gen}世代まで · ${c.note}` : c.note)));
        requestAnimationFrame(() => drawThumb(cv, c.bp));
      }
      box.append(grid);
    };
    const mine = this.cands.filter(c => c.kind === 'run');
    section('マイ生物 (世代はあとで選べます)', mine);
    if (!mine.length) box.append(el('p', { class: 'dim' }, 'まだ育てた生物がいません。ホームから生物をつくって進化させると、ここに出場できます。'));
    section('道場', this.cands.filter(c => c.kind === 'dojo'));
    box.append(el('div', { class: 'modal-actions' }, el('button', { class: 'btn ghost', onclick: close }, 'とじる')));
    back.append(box);
    back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
    document.body.append(back);
  }

  renderOptions() {
    const box = $('#arena-options');
    box.innerHTML = '';
    if (this.mode !== 'race') {
      box.append(el('p', { class: 'pane-note dim' }, '三番勝負は立ち合いの間合いを変えて3回 (特訓と同じ条件)。物理は決定論的なので、同じ組み合わせなら何度見ても同じ結果になります。結果を変えたければ、鍛えるしかありません。'));
      return;
    }
    const seg = el('div', { class: 'seg small' });
    for (const [k, label] of [['common', '共通の地形'], ['home', 'それぞれの故郷']]) {
      seg.append(el('button', { class: k === this.raceEnv ? 'active' : '', onclick: () => { this.raceEnv = k; this.renderOptions(); this.preview(); } }, label));
    }
    box.append(el('div', { class: 'choice-row' }, el('span', {}, '走る場所'), seg));
    if (this.raceEnv === 'common') {
      const ts = el('div', { class: 'seg small' });
      for (const [k, t] of Object.entries(TERRAINS)) ts.append(el('button', { class: k === this.terrain ? 'active' : '', onclick: () => { this.terrain = k; this.renderOptions(); this.preview(); } }, `${t.icon} ${t.name}`));
      box.append(el('div', { class: 'choice-row' }, el('span', {}, '地形'), ts));
    } else {
      box.append(el('p', { class: 'pane-note dim' }, '各自が進化した地形・重力・摩擦で走ります。育った環境の違いがそのまま出ます。'));
    }
  }

  changed() {
    this.stop(false);
    this.renderEntrants();
    $('#arena-result').innerHTML = '';
    $('#arena-score').innerHTML = '';
    this.preview();
  }

  // ─── 試合の準備 ───
  duelEnv() {
    return { terrain: BATTLES[this.mode].terrain, objective: this.mode, gravity: 1, friction: DEFAULT_SETTINGS.friction, evalSeconds: DEFAULT_SETTINGS.evalSeconds };
  }

  raceLanes() {
    return this.racers.map((f, i) => {
      const P = prepareFighter(f, 'distance');
      const s = f.settings;
      const home = this.raceEnv === 'home' && !BATTLES[f.obj];
      const env = {
        terrain: home ? s.terrain : this.raceEnv === 'home' ? 'flat' : this.terrain, objective: 'distance',
        gravity: home ? s.gravity : 1, friction: home ? s.friction : DEFAULT_SETTINGS.friction, evalSeconds: DEFAULT_SETTINGS.evalSeconds,
      };
      const where = this.raceEnv === 'home' ? ` (${TERRAINS[env.terrain].icon}${env.gravity !== 1 ? ` ${env.gravity.toFixed(1)}G` : ''})` : '';
      return { bp: P.bp, layout: P.layout, genome: P.genome, env, label: `${f.name}${where}`, hue: RACE_HUES[i], fighter: f };
    });
  }

  prepareDuel() {
    const [w, e] = this.duel.map(f => prepareFighter(f, this.mode));
    this.W = w; this.E = e;
    this.theater.setRun(w.bp, w.layout);
    this.brains[0].setRun(w.layout); this.brains[0].setGenomes(w.genome, null);
    this.brains[1].setRun(e.layout); this.brains[1].setGenomes(e.genome, null);
    $('#arena-brain-w-name').textContent = this.duel[0].name;
    $('#arena-brain-e-name').textContent = this.duel[1].name;
  }

  playBout(k) {
    this.bout = k;
    this.theater.play({
      kind: 'match', env: this.duelEnv(), bp: this.W.bp, layout: this.W.layout, genome: this.W.genome,
      rival: { ...this.E, name: this.duel[1].name }, opening: OPENINGS[k], meName: this.duel[0].name, tintRival: false,
    });
  }

  /** 始まる前の立ち姿 */
  preview() {
    if (this.mode === 'race') {
      if (!this.racers.length) { this.theater.main = null; return; }
      const lanes = this.raceLanes();
      this.theater.setRun(lanes[0].bp, lanes[0].layout);
      this.theater.play({ kind: 'lanes', lanes, main: 0, top: 0 });
    } else {
      this.prepareDuel();
      this.playBout(0);
    }
    this.renderScore();
  }

  start() {
    if (this.mode === 'race' && this.racers.length < 2) return toast('2体以上を並べてください');
    this.results = [];
    $('#arena-result').innerHTML = '';
    this.preview();
    this.state = 'playing';
    $('#arena-start').textContent = '■ 中断';
    this.renderScore();
  }

  stop(render = true) {
    if (this.state !== 'playing') return;
    this.state = 'idle';
    $('#arena-start').textContent = this.mode === 'race' ? '▶ スタート' : '▶ 三番勝負';
    if (render) this.preview();
  }

  onDecision(m) {
    if (this.state !== 'playing' || this.mode === 'race') return;
    this.results[this.bout] = { winner: m.winner, kimarite: m.kimarite, t: m.endT / 60 };
    this.renderScore();
  }

  onFinish() {
    if (this.state !== 'playing') return;
    if (this.mode === 'race') return this.finishRace();
    const w = this.results.filter(r => r && r.winner === 0).length, l = this.results.filter(r => r && r.winner === 1).length;
    if (this.bout < OPENINGS.length - 1 && w < 2 && l < 2) return this.playBout(this.bout + 1);
    this.finishDuel(w, l);
  }

  finishRace() {
    this.state = 'done';
    const units = this.theater.units;
    const order = units.map((u, i) => ({ i, d: u.broken ? -Infinity : u.distance() })).sort((a, b) => b.d - a.d);
    order.forEach((o, r) => { units[o.i].lane.rank = MEDALS[r] || `${r + 1}位`; });
    const box = $('#arena-result');
    box.innerHTML = '';
    box.append(el('h4', {}, '🏁 結果'));
    const ol = el('ol', { class: 'race-result' });
    for (const o of order) {
      const lane = units[o.i].lane;
      ol.append(el('li', {}, el('span', {}, lane.rank), el('b', {}, lane.label), el('span', { class: 'gold' }, isFinite(o.d) ? `${(o.d / 100).toFixed(2)} m` : '転倒')));
    }
    box.append(ol, el('div', { class: 'result-actions' }, el('button', { class: 'btn ghost small', onclick: () => this.start() }, '↺ もう一度')));
    $('#arena-start').textContent = '▶ スタート';
  }

  finishDuel(w, l) {
    this.state = 'done';
    $('#arena-start').textContent = '▶ 三番勝負';
    const [W, E] = this.duel;
    const box = $('#arena-result');
    box.innerHTML = '';
    const head = w > l ? `🏆 ${W.name} の勝ち越し` : l > w ? `🏆 ${E.name} の勝ち越し` : '引き分け';
    box.append(el('h4', {}, `${head} (${w}勝${l}敗${this.results.length - w - l ? (this.results.length - w - l) + '分' : ''})`));
    const ul = el('ul', { class: 'bout-list' });
    this.results.forEach((r, k) => ul.append(el('li', {},
      el('span', {}, BOUT_NAMES[k]),
      el('b', { style: `color:${r.winner === 0 ? WEST : r.winner === 1 ? EAST : '#ffd166'}` }, r.winner === 0 ? W.name : r.winner === 1 ? E.name : '—'),
      el('span', {}, `${r.kimarite} · ${r.t.toFixed(1)}秒`))));
    box.append(ul);
    const B = BATTLES[this.mode];
    const loser = w > l ? 1 : l > w ? 0 : null;
    box.append(el('p', { class: 'pane-note' }, loser != null
      ? `負けた「${this.duel[loser].baseName}」を鍛えれば、この相手に勝てるようになるでしょうか？ 特訓では脳に「対戦感覚」が加わり、相手を感じて戦うことを学べます。`
      : '互角です。どちらかを鍛えて決着をつけよう。'));
    const actions = el('div', { class: 'result-actions' });
    for (const s of [0, 1]) {
      actions.append(el('button', { class: `btn ${s === loser ? 'primary' : 'ghost'} small`, onclick: () => this.hooks.onTrain(this.duel[s], this.duel[1 - s], this.mode) },
        `🧬 ${this.duel[s].baseName} を${B.name}で鍛える`));
    }
    actions.append(el('button', { class: 'btn ghost small', onclick: () => this.start() }, '↺ もう一度見る'));
    box.append(actions);
  }

  renderScore() {
    const box = $('#arena-score');
    if (this.mode === 'race') { box.innerHTML = ''; return; }
    const [W, E] = this.duel;
    const marks = OPENINGS.map((_, k) => {
      const r = this.results && this.results[k];
      const cls = !r ? (this.state === 'playing' && this.bout === k ? 'now' : '') : r.winner === 0 ? 'w' : r.winner === 1 ? 'e' : 'd';
      return `<i class="${cls}" title="${BOUT_NAMES[k]}${r ? ': ' + r.kimarite : ''}"></i>`;
    }).join('');
    box.innerHTML = `<span class="sc-w">${esc(W.name)}</span><span class="sc-marks">${marks}</span><span class="sc-e">${esc(E.name)}</span>`;
  }

  frame(dt, t) {
    const th = this.theater;
    if (this.state === 'playing') th.update(dt);
    th.render();
    if (this.mode !== 'race' && th.match) {
      const m = th.match;
      this.brains[0].render(m.A.brain.acts, null, t / 1000);
      this.brains[1].render(m.B.brain.acts, null, t / 1000);
    }
  }
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
