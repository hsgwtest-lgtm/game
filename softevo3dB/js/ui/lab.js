// 進化のラボ: いまの「いちばん」の動きを再生しながら、次の世代を育てる
//   ゆっくり（既定）… 1回の再生ごとに1世代。成長の一歩一歩を見られる
//   はやく … 評価係（Worker）が休まず世代を回す。画面は最新のいちばんを流す
const THREE = window.THREE;
import { h, clear, toast, modal, ask, confirmBox, fmtM, hex } from './dom.js';
import { Stage } from '../render/scene.js';
import { CreatureView, lin } from '../render/creature.js';
import { Episode } from '../sim/sim.js';
import { FPS } from '../sim/physics.js';
import { geneCount, GENE_NAMES_GLOBAL } from '../sim/nerves.js';
import { GaitRecorder, GAIT_NAMES } from '../sim/gait.js';
import { AXIS_NAME } from '../sim/model.js';
import { Evolver, needsSupport } from '../evo/engine.js';
import { REGIONS, ERAS, RACE_T, goalEnv } from '../game/world.js';
import * as G from '../game/game.js';
import { b64ToF64, f64ToB64, downloadJSON } from '../game/store.js';
import { growthChart, footfallChart, angleChart, phaseDial } from './charts.js';
import { envChips } from './home.js';

const SPEEDS = { slow: 'ゆっくり', fast: 'はやく' };
const GOALS = { distance: 'はやさ', walk: '省エネで歩く', human: 'ヒトの歩き方をまねる' };

export class LabScreen {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.stage = new Stage(app.renderer);
    this.touch = h('div', { style: { position: 'absolute', inset: '0', touchAction: 'none' } });
    this.el.append(this.touch);
    let px = 0, py = 0, pid = null, pinch = null;
    const pts = new Map();
    this.touch.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
    this.touch.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p[0], dy = e.clientY - p[1];
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) { this.stage.orbit(-dx * 0.008, dy * 0.006); this.camMode = 'free'; }
      else if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) this.stage.zoom(d / pinch); pinch = d; }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    this.touch.addEventListener('pointerup', up); this.touch.addEventListener('pointercancel', up);
    this.touch.addEventListener('wheel', (e) => { e.preventDefault(); this.stage.zoom(e.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });
    this.top = h('div.topbar');
    this.hud = h('div.lab-hud');
    this.ctrl = h('div.lab-ctrl');
    this.sheet = h('div.sheet');
    this.el.append(this.top, this.hud, this.ctrl, this.sheet);
    this.tab = 'grow';
    this.speed = 'slow';
    this.viewMode = 'muscle';
    this.camMode = 'follow';
    this.ghostsOn = true;
    // 記録の旗（ぬし・あなた）
    this.flags = new THREE.Group();
    this.stage.scene.add(this.flags);
    // 支えの手の輪
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 36), new THREE.MeshBasicMaterial({ color: 0x9cd3f0, transparent: true, opacity: 0.4, depthWrite: false }));
    this.halo.rotation.x = Math.PI / 2;
    this.halo.visible = false;
    this.stage.scene.add(this.halo);
    // リズムの波紋
    this.pulse = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0x6fd3e8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.pulse.visible = false;
    this.stage.scene.add(this.pulse);
  }

  get g() { return this.app.game; }

  async enter(params = {}) {
    this.active = true;
    const sp = this.sp = G.speciesById(this.g, params.id);
    if (!sp) { this.app.go('home'); return; }
    this.fossil = sp.status === 'extinct';
    this.model = G.modelFor(sp);
    this.R = G.regionNow(this.g, sp.region);
    this.stage.setBiome(this.R.biome);
    this.knock = new Set();
    this.queue = [];
    this.pending = null;
    this.busy = false;
    this.paused = this.fossil;
    this.gaitInfo = null;
    // 環境
    this.baseEnv = this.envFor(sp);
    // 進化のエンジン
    const n = geneCount(this.model);
    let genes = G.genesOf(sp, 'champ');
    if (genes.length !== n) genes = new Float64Array(n);
    const saved = sp.evo && sp.evo.state && sp.evo.state.n === n ? sp.evo : null;
    let assist = saved ? saved.assist : 0;
    if (!saved && !this.fossil) {
      // 背が高くて自分では立っていられない体には、はじめ「支えの手」
      assist = needsSupport(this.model, genes, this.baseEnv) ? 1 : 0;
    }
    this.evo = new Evolver(this.model, { genes, goal: sp.goal || 'distance', state: saved ? saved.state : null, assist, okStreak: saved ? saved.okStreak : 0, bestFit: saved ? saved.bestFit : undefined, sigma: sp.parent ? 0.25 : 0.3 });
    if (!saved && assist > 0 && !this.fossil) setTimeout(() => this.celebrate('支えの手', 'この体は、まだ自分では立っていられない。見えない手が胴を支える。歩けるようになるたびに、少しずつ手を放していく。'), 600);
    // 再生（いまのいちばん）
    this.champ = sp.champ ? { x: b64ToF64(sp.champ.x), assist: sp.champ.assist, gen: sp.champ.gen, r: sp.champ.r } : { x: genes, assist, gen: 0, r: null };
    if (this.champ.x.length !== n) this.champ.x = genes;
    this.buildViews();
    this.startReplay();
    this.renderTop();
    this.renderHud();
    this.renderCtrl();
    this.renderSheet();
    // 評価係の準備
    if (!this.fossil) {
      this.pool = this.app.pool();
      this.poolKey = `${sp.id}:${sp.designRev || 0}:${this.g.era}:${sp.goal || 'distance'}`;
      try { await this.pool.setup(sp.design, this.baseEnv, this.poolKey); } catch (e) { console.warn(e); }
      if (!this.active) return;
      this.ready = true;
      this.wantGen = true;
      this.pump();
    }
  }

  leave() {
    this.active = false;
    this.ready = false;
    this.saveEvo();
    this.app.saveNow();
  }

  envFor(sp) {
    return G.envFor(this.g, sp.region, goalEnv(sp.goal || 'distance', this.model));
  }

  saveEvo() {
    if (!this.evo || this.fossil || !this.sp) return;
    this.sp.evo = this.evo.save();
    this.app.save();
  }

  // ── 表示する生き物 ──
  buildViews() {
    for (const v of [this.view, this.mView, this.fView]) if (v) { this.stage.actors.remove(v.group); v.dispose(); }
    this.view = new CreatureView(this.model, { mode: this.viewMode, color: this.sp.color });
    this.stage.actors.add(this.view.group);
    // ぬしのゴースト
    const mk = this.sp.region;
    this.mModel = G.masterModel(mk);
    this.mView = this.mModel ? new CreatureView(this.mModel, { ghost: 0x2b3a66, opacity: 0.3 }) : null;
    if (this.mView) this.stage.actors.add(this.mView.group);
    // 第1世代のゴースト
    this.fView = this.sp.firstX ? new CreatureView(this.model, { ghost: 0xf3ecdf, opacity: 0.14 }) : null;
    if (this.fView) this.stage.actors.add(this.fView.group);
    this.updateFlags();
    const wl = this.R.env.water ? this.model.size.h + 0.6 : null;
    this.stage.setTerrain(this.R.env.terrain, null);
  }

  updateFlags() {
    clear(this.flags);
    const pole = (x, col, hgt, z = Math.max(0.25, this.model.size.z * 0.8)) => {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, hgt, 6), new THREE.MeshBasicMaterial({ color: col }));
      p.position.y = hgt / 2;
      const f = new THREE.Mesh(new THREE.PlaneGeometry(hgt * 0.3, hgt * 0.18), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
      f.position.set(hgt * 0.15, hgt - hgt * 0.09, 0);
      g.add(p, f);
      g.position.set(x, 0, z);
      return g;
    };
    const H = Math.max(0.35, this.model.size.h * 1.2);
    const mr = G.masterRecord(this.sp.region, this.g.era);
    if (mr > 0) {
      const mz = this.mModel ? -(this.model.size.z / 2 + this.mModel.size.z / 2 + 0.3) - Math.max(0.15, this.mModel.size.z * 0.6) : -0.4;
      const f = pole(mr, lin(0x9aa6c8), H, mz); this.flags.add(f); this.mFlag = f;
    }
    if (this.sp.record > 0) { const f = pole(this.sp.record, lin(getEraHex()), H * 0.85); this.flags.add(f); }
    // 地形の高さに合わせる
    for (const f of this.flags.children) {
      const ep = this.ep;
      if (ep) f.position.y = ep.terrain.h(f.position.x, f.position.z);
    }
  }

  startReplay() {
    const env = { ...this.baseEnv, assist: this.champ.assist };
    this.ep = new Episode(this.model, this.champ.x, env);
    for (const i of this.knock) this.ep.nerves.knock[i] = 1;
    this.rec = new GaitRecorder(this.model, Math.round(RACE_T * FPS) + 2);
    this.mEp = this.mModel && this.ghostsOn ? new Episode(this.mModel, G.masterGenes(this.sp.region), { ...G.envFor(this.g, this.sp.region, {}), assist: 0 }) : null;
    this.fEp = this.fView && this.ghostsOn && this.sp.firstX ? new Episode(this.model, b64ToF64(this.sp.firstX), { ...this.baseEnv, assist: this.sp.firstAssist || 0 }) : null;
    if (this.mView) this.mView.setVisible(!!this.mEp);
    if (this.fView) this.fView.setVisible(!!this.fEp);
    this.endWait = 0;
    this.acc = 0;
    const wl = this.ep.terrain.waterLevel || (this.ep.env.water ? this.model.size.h + 0.6 : null);
    this.stage.setTerrain(this.ep.env.terrain, wl);
    this.updateFlags();
    this.view.update(this.ep.c);
    const com = this.ep.nerves.com;
    this.stage.focus(com[0], Math.max(0.15, com[1]), com[2], true);
    const d = Math.max(1.0, Math.max(this.model.size.h, this.model.size.x) * 3.2 + 0.4);
    if (this.camMode === 'follow') this.stage.setView(0.42, 0.22, d, !this._camInit);
    this._camInit = true;
    // ゆっくり: 再生が始まったら、次の世代を考えはじめる
    if (this.speed === 'slow') { this.wantGen = true; this.pump(); }
  }

  // ── 進化を回す ──
  async pump() {
    if (!this.active || !this.ready || this.busy || this.paused || this.fossil) return;
    if (this.speed === 'slow' && (!this.wantGen || this.pending)) return;
    this.busy = true;
    this.wantGen = false;
    let res;
    try { res = await this.evo.step(this.pool); } catch (e) { console.error(e); this.busy = false; return; }
    this.busy = false;
    if (!this.active || this.sp.status === 'extinct') return;
    this.onGeneration(res);
    if (this.speed === 'fast') setTimeout(() => this.pump(), 0);
  }

  onGeneration(res) {
    const sp = this.sp;
    if (!sp.firstX) { sp.firstX = f64ToB64(res.champ.x); sp.firstAssist = res.champ.assist; }
    const events = G.recordGeneration(this.g, sp, res);
    if (res.gen % 5 === 0) this.saveEvo(); else this.app.save();
    for (const e of events) this.queue.push(e);
    if (this.speed === 'fast') {
      this.latest = res.champ;
    } else {
      this.pending = res.champ;
    }
    this.renderHud();
    if (this.tab === 'grow') this.renderSheet();
    this.flushEvents();
  }

  flushEvents() {
    if (this.celebrating || !this.queue.length) return;
    const e = this.queue.shift();
    const sp = this.sp;
    if (e.type === 'milestone') this.celebrate(`第${e.m.gen}世代`, e.m.title, e.m.text);
    else if (e.type === 'record') { this.updateFlags(); this.flushEvents(); }
    else if (e.type === 'kick') { toast('伸び悩み。変異を強めた', { icon: '🧬' }); this.flushEvents(); }
    else if (e.type === 'settle') {
      this.updateFlags();
      this.celebrate(e.wasCrisis ? '適応' : '定着', e.wasCrisis ? `『${sp.name}』は危機を乗りこえた` : `${this.R.name}に定着した`, e.wasCrisis ? '変わった環境で、ぬしを超えた。' : 'ぬしの記録を破った。となりの地方へ枝分かれできる。');
      this.renderTop();
    } else if (e.type === 'era') {
      this.app.setEra(this.g.era);
      this.celebrate('新しい時代', `${G.eraName(e.era)}`, ERAS[e.era].story);
    } else if (e.type === 'crisis') {
      this.celebrate('危機', `『${e.sp.name}』が危機にある`, `${G.regionNow(this.g, e.sp.region).name}の環境が変わった。次の時代までに適応しないと絶滅する。`);
    } else if (e.type === 'extinct') {
      this.celebrate('絶滅', `『${e.sp.name}』が絶滅した`, '化石が残った。');
    } else this.flushEvents();
    // 時代が変わってこの種の環境が変わったら、作りなおす
    if (e.type === 'era') {
      const R = G.regionNow(this.g, sp.region);
      if (R.name !== this.R.name) setTimeout(() => this.reload(), 2600);
    }
  }

  celebrate(k, t, d = '') {
    this.celebrating = true;
    const el = h('div.celebrate', h('div.k', k), h('div.t', t), d ? h('div.d', d) : null);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => { el.remove(); this.celebrating = false; this.flushEvents(); }, 400); }, 2600);
  }

  async reload() {
    const id = this.sp.id;
    this.leave();
    await this.enter({ id });
  }

  // 再生が終わったとき
  onReplayEnd() {
    // 歩き方の分析
    const a = this.rec.analyze();
    if (a && !this.knock.size) {
      const nm = GAIT_NAMES[a.type] || GAIT_NAMES.walk;
      this.gaitInfo = { ...a, name: nm.name, desc: nm.desc };
      if (!this.fossil && !this.replayingOld) {
        const out = G.noteGait(this.g, this.sp, this.gaitInfo, { x: this.champ.x, assist: this.champ.assist });
        for (const e of out || []) this.queue.push(e);
        this.flushEvents();
      }
      if (this.tab === 'gait') this.renderSheet();
      this.renderHud();
    }
    if (this.speed === 'fast' && this.latest) { this.champ = this.latest; this.latest = null; this.replayingOld = false; }
    if (this.speed === 'slow' && this.pending) { this.champ = this.pending; this.pending = null; this.replayingOld = false; }
    this.startReplay();
  }

  // ── 上・HUD・操作 ──
  renderTop() {
    const sp = this.sp;
    clear(this.top).append(
      h('button.iconbtn', { 'aria-label': '惑星へもどる', onclick: () => this.app.go('home', { region: sp.region }) }, '←'),
      h('span.dot', { style: { background: hex(sp.color), width: '14px', height: '14px' } }),
      h('div.grow', h('div.title', sp.name), h('div.sub', `${this.R.icon} ${this.R.name}${sp.status === 'settled' ? '　定着' : sp.status === 'crisis' ? '　危機' : sp.status === 'extinct' ? '　絶滅' : ''}`)),
      h('button.iconbtn', { 'aria-label': 'メニュー', onclick: () => this.menu() }, '⋯'),
    );
  }

  renderHud() {
    const sp = this.sp;
    const mr = G.masterRecord(sp.region, this.g.era);
    const rec = sp.record || 0;
    const pct = mr > 0 ? Math.min(1, rec / (mr * 1.25)) : 0;
    this.liveDist = h('span.num', '0.00');
    clear(this.hud).append(
      h('div.scoreline',
        h('div', h('div.lbl', this.fossil ? '化石' : `第${sp.gens}世代`), h('div.big', this.liveDist, h('small', 'm'))),
        h('div', h('div.vs', '記録 ', h('b.num', fmtM(sp.record))), h('div.vs', 'ぬし ', h('b.num', fmtM(mr))))),
      mr > 0 ? h('div.trialbar', h('i', { style: { width: `${pct * 100}%` } }), h('u', { style: { left: `${(1 / 1.25) * 100}%` } })) : null,
      sp.status === 'crisis' ? h('div.chip.bad', { style: { alignSelf: 'flex-start' } }, `危機: 次の時代までに ${fmtM(mr)} を超えないと絶滅する`) : null,
      sp.status === 'settled' ? h('button.btn.small.primary', { style: { alignSelf: 'flex-start' }, onclick: () => this.app.go('home', { region: sp.region }) }, '定着した。となりの地方へ枝分かれする') : null,
      sp.status === 'growing' && !sp.record && !this.fossil && sp.gens < 3 ? h('div.chip.dim', { style: { alignSelf: 'flex-start' } }, `試練: ${RACE_T}秒で ${fmtM(mr)} より遠くへ`) : null,
      h('div.lab-chips',
        this.champ.assist > 0 ? h('span.chip', { style: { color: 'var(--nerve)' } }, `支えの手 ${Math.round(this.champ.assist * 100)}%`) : null,
        this.gaitInfo ? h('span.chip', `あるき方: ${this.gaitInfo.name}`) : null,
        this.knock.size ? h('span.chip.bad', `神経を${this.knock.size}本切った`) : null,
        this.speed === 'fast' ? h('span.chip.era', 'はやく') : null,
        this.paused && !this.fossil ? h('span.chip.warn', '一時停止') : null,
        this.busy && this.speed === 'slow' && !this.pending ? null : null,
      ),
    );
  }

  renderCtrl() {
    const c = clear(this.ctrl);
    c.style.top = 'calc(150px + var(--safe-t))';
    if (!this.fossil) {
      c.append(
        h('button.iconbtn' + (this.paused ? '.on' : ''), { 'aria-label': this.paused ? '進化を再開' : '進化を止める', title: '進化', onclick: () => { this.paused = !this.paused; this.renderCtrl(); this.renderHud(); if (!this.paused) { this.wantGen = true; this.pump(); } } }, this.paused ? '▶' : '⏸'),
        h('button.iconbtn' + (this.speed === 'fast' ? '.on' : ''), { 'aria-label': 'はやく', title: this.speed === 'fast' ? 'はやく' : 'ゆっくり', onclick: () => this.setSpeed(this.speed === 'fast' ? 'slow' : 'fast') }, this.speed === 'fast' ? '⏩' : '🐢'),
      );
    }
    c.append(
      h('button.iconbtn', { 'aria-label': '表示', title: '肌・筋肉・骨', onclick: () => { const order = ['skin', 'muscle', 'bone']; this.viewMode = order[(order.indexOf(this.viewMode) + 1) % 3]; this.view.setMode(this.viewMode); toast({ skin: '肌', muscle: '筋肉', bone: '骨' }[this.viewMode]); } }, '◐'),
      h('button.iconbtn' + (this.camMode === 'follow' ? '.on' : ''), { 'aria-label': 'カメラ', title: 'カメラ', onclick: () => { this.camMode = this.camMode === 'follow' ? 'side' : 'follow'; if (this.camMode === 'side') this.stage.setView(0, 0.05, null); else this.stage.setView(0.42, 0.22, null); this.renderCtrl(); } }, '🎥'),
      h('button.iconbtn' + (this.ghostsOn ? '.on' : ''), { 'aria-label': 'ゴースト', title: 'ぬしと第1世代のゴースト', onclick: () => { this.ghostsOn = !this.ghostsOn; this.renderCtrl(); this.startReplay(); } }, '👻'),
    );
  }

  setGoal(gv) {
    const sp = this.sp;
    if (gv === (sp.goal || 'distance')) return;
    sp.goal = gv;
    sp.evo = null;
    G.log(this.g, `『${sp.name}』のめざす動きを「${GOALS[gv]}」に変えた。`, 'note', sp);
    this.app.save();
    toast(`めざす動き: ${GOALS[gv]}`);
    this.reload();
  }

  setSpeed(s) {
    this.speed = s;
    this.renderCtrl(); this.renderHud();
    if (s === 'fast') { this.wantGen = true; this.pump(); toast('はやく: 評価係が休まず世代を回す'); }
    else toast('ゆっくり: 再生1回ごとに1世代');
  }

  async menu() {
    const sp = this.sp;
    const acts = [];
    if (!this.fossil) acts.push({ label: '体を作りかえる', value: 'edit' });
    acts.push({ label: '名前を変える', value: 'rename' });
    if (!this.fossil) acts.push({ label: `めざす動き: ${GOALS[sp.goal || 'distance']}`, value: 'goal' });
    if (sp.status === 'settled') acts.push({ label: 'となりへ枝分かれ', value: 'branch' });
    if (!this.fossil && sp.best) acts.push({ label: 'オンラインに公開', value: 'publish' });
    acts.push({ label: '書き出す（ファイル）', value: 'export' });
    if (!this.fossil) acts.push({ label: 'この種を消す', value: 'delete', kind: 'danger' });
    const body = h('div.stack', acts.map(a => h('button.btn.block' + (a.kind ? '.' + a.kind : ''), { onclick: () => box._close(a.value) }, a.label)));
    const p = modal({ title: sp.name, body, actions: [{ label: 'とじる', value: null }] });
    const box = document.querySelector('.modal-wrap:last-child .modal');
    const v = await p;
    if (v === 'edit') this.app.go('design', { mode: 'edit', id: sp.id });
    else if (v === 'rename') { const n = await ask('種の名前', sp.name, { max: 12 }); if (n) { sp.name = n; this.renderTop(); this.app.save(); } }
    else if (v === 'goal') {
      const biped = new GaitRecorder(this.model, 2).biped;
      const gv = await modal({
        title: 'めざす動き',
        body: h('div',
          h('p', '「はやさ」は10秒でどれだけ遠くへ行けるか。'),
          h('p', '「省エネで歩く」は、決まった速さより速くても点にならず、筋肉を使いすぎると減点される。ゆったりした歩き方が育ちやすい。'),
          biped ? h('p', '「ヒトの歩き方をまねる」は、省エネで歩きながら、股・ひざ・足首の動きがヒトの歩行の記録に近いほど点がふえる。体はあなたの設計のまま、ヒトの動きを再現できるかの実験。') : h('p.muted', '「ヒトの歩き方をまねる」は、股・ひざ・足首のある二本足の体で選べる。')),
        actions: [{ label: 'はやさ', value: 'distance' }, { label: '省エネで歩く', value: 'walk' }, ...(biped ? [{ label: 'ヒトをまねる', value: 'human' }] : [])],
      });
      if (gv) this.setGoal(gv);
    } else if (v === 'branch') this.app.go('home', { region: sp.region });
    else if (v === 'publish') this.app.go('online', { publish: sp.id });
    else if (v === 'export') downloadJSON(`${sp.name}.softevo3dB.json`, { kind: 'softevo3dB-species', v: 1, name: sp.name, design: sp.design, genes: sp.best ? sp.best.x : sp.champ && sp.champ.x, region: sp.region, record: sp.record });
    else if (v === 'delete') {
      if (await confirmBox('この種を消す', `『${sp.name}』を消します。もとに戻せません。`, '消す', 'danger')) {
        this.g.species = this.g.species.filter(s => s.id !== sp.id);
        this.app.saveNow();
        this.app.go('home');
      }
    }
  }

  // ── 下のパネル ──
  renderSheet() {
    const s = clear(this.sheet);
    s.appendChild(h('div.grip'));
    const tabs = [['grow', '成長'], ['nerve', '神経'], ['gait', '歩き方'], ['story', '記録']];
    s.append(h('div.tabs', tabs.map(([k, n]) => h('button.tab' + (this.tab === k ? '.on' : ''), { onclick: () => { this.tab = k; this.renderSheet(); } }, n))));
    if (this.tab === 'grow') this.sheetGrow(s);
    else if (this.tab === 'nerve') this.sheetNerve(s);
    else if (this.tab === 'gait') this.sheetGait(s);
    else this.sheetStory(s);
  }

  sheetGrow(s) {
    const sp = this.sp;
    const cv = h('canvas.chart');
    s.append(cv);
    requestAnimationFrame(() => growthChart(cv, sp, G.masterRecord(sp.region, this.g.era), sp.milestones));
    const st = h('div.row.wrap', { style: { margin: '6px 0' } },
      h('span.chip', `${this.R.icon} ${this.R.name}`), ...envChips(this.R).map(t => h('span.chip.dim', t)),
      h('span.chip.dim', `めざす動き: ${GOALS[sp.goal || 'distance']}`));
    s.append(st);
    if (!sp.milestones.length) s.append(h('p', this.fossil ? '' : 'はじめはもがくだけ。世代を重ねるうちに、神経が体の使い方を見つけていく。'));
    else s.append(h('h3', '節目（タップで再生）'), h('div.stones', sp.milestones.slice().reverse().slice(0, 12).map(m => h('div.stone', { onclick: () => this.replayMilestone(m) }, h('span.g', `第${m.gen}世代`), h('span', m.title)))));
  }

  replayMilestone(m) {
    this.replayingOld = true;
    this.champ = { x: b64ToF64(m.x), assist: m.assist, gen: m.gen, r: null };
    this.pending = null;
    toast(`第${m.gen}世代「${m.title}」を再生`);
    this.startReplay();
  }

  sheetNerve(s) {
    const nv = this.ep.nerves;
    this.dial = h('canvas', { style: { width: '100%', height: '64px', display: 'block' } });
    s.append(this.dial);
    s.append(h('p', '関節の軸ごとの指令（朱: 筋肉の力、水色: めざす角度）。タップすると、その神経を切る実験ができる（進化には影響しない）。'));
    const groups = new Map();
    for (const d of this.model.dofs) {
      if (d.secondary) continue;
      groups.set(d.group, d);
    }
    this.nrows = [];
    const grid = h('div.nerve-grid');
    for (const d of this.model.dofs) {
      const name = d.name;
      const bar = h('div.bar', h('i'), h('b'));
      const row = h('div.nrow' + (this.knock.has(d.i) ? '.cut' : ''), { onclick: () => {
        if (this.knock.has(d.i)) this.knock.delete(d.i); else this.knock.add(d.i);
        row.classList.toggle('cut', this.knock.has(d.i));
        this.ep.nerves.knock[d.i] = this.knock.has(d.i) ? 1 : 0;
        toast(this.knock.has(d.i) ? `「${name}」の神経を切った` : `「${name}」の神経をつないだ`);
        this.renderHud();
      } }, h('span', name), bar, h('span.x', ''));
      this.nrows.push({ d, bar, row, x: row.lastChild });
      grid.append(row);
    }
    s.append(grid);
    if (this.knock.size) s.append(h('button.btn.small', { style: { marginTop: '8px' }, onclick: () => { this.knock.clear(); this.startReplay(); this.renderSheet(); this.renderHud(); } }, 'すべてつなぎなおす'));
    const gl = [];
    const genes = this.champ.x;
    GENE_NAMES_GLOBAL.forEach((n, i) => gl.push(h('span.chip.dim', `${n} ${(genes[i] || 0).toFixed(2)}`)));
    s.append(h('h3', '全体の遺伝子'), h('div.row.wrap', gl));
  }

  sheetGait(s) {
    const a = this.gaitInfo;
    if (!a) { s.append(h('p', '再生が終わると、足の運びを分析する。')); return; }
    s.append(h('div.row', h('h2', a.name), h('span.muted', a.desc)));
    s.append(h('div.row.wrap', { style: { margin: '6px 0' } },
      h('span.chip.num', `速さ ${a.speed.toFixed(2)}m/秒`),
      a.cadence ? h('span.chip.num', `歩数 ${Math.round(a.cadence)}歩/分`) : null,
      a.stride ? h('span.chip.num', `1周期 ${a.stride.toFixed(2)}m`) : null,
      h('span.chip.num', `浮いている時間 ${Math.round(a.airFrac * 100)}%`)));
    const cv = h('canvas', { style: { width: '100%', height: `${Math.max(40, a.feet.length * 16 + 8)}px`, display: 'block' } });
    s.append(h('h3', '足あと図（白: 地面についている）'), cv);
    const F = this.rec.n, n = this.model.n;
    const rows = a.feet.map(f => {
      const arr = new Uint8Array(F);
      for (let k = 0; k < F; k++) arr[k] = this.rec.contact[k * n + f.i];
      return { name: this.model.bodies[f.i].name, contact: arr };
    });
    requestAnimationFrame(() => footfallChart(cv, rows, F));
    if (a.human) {
      const hm = a.human;
      s.append(h('h3', 'ヒトの歩行とくらべる'));
      s.append(h('div.row', h('div.score-big.num', `${Math.round(hm.total)}`), h('div.muted', '点 / 100（股・ひざ・足首の角度の形と大きさが、ヒトの平地歩行の代表的な曲線にどれだけ近いか）')));
      s.append(h('div.legend', h('span', h('i', { style: { background: 'var(--era)' } }), 'あなた'), h('span', h('i', { style: { background: 'var(--ink-2)' } }), 'ヒト'), h('span', '横軸: 片足の着地から次の着地まで')));
      const figs = h('div.cmp');
      for (const [k, nm] of [['hip', '股'], ['knee', 'ひざ'], ['ankle', '足首']]) {
        const c = h('canvas');
        figs.append(h('figure', c, h('figcaption', h('span', nm), h('span.num', `${Math.round(hm.score[k].score)}点`))));
        requestAnimationFrame(() => angleChart(c, hm.curves[k], hm.ref[k]));
      }
      s.append(figs);
    } else if (this.rec.biped) {
      s.append(h('p.muted', '二本足の生き物は、ヒトの歩行と股・ひざ・足首の動きをくらべられる。足が地面から離れて歩くようになると、比較が表示される。'));
    }
    if (this.rec.biped && (this.sp.goal || 'distance') !== 'human' && !this.fossil) {
      s.append(h('div.notice', { style: { marginTop: '10px' } },
        h('div', 'この体は二本足。めざす動きを「ヒトの歩き方をまねる」にすると、ヒトの歩行の記録をお手本に、この体でその動きを再現できるか試せる。'),
        h('button.btn.small', { style: { marginTop: '8px' }, onclick: () => this.setGoal('human') }, 'ヒトの歩き方をまねる')));
    }
  }

  sheetStory(s) {
    const items = this.g.chronicle.filter(e => e.sp === this.sp.id).slice(-30).reverse();
    if (!items.length) s.append(h('p', 'まだ記録はない。'));
    s.append(h('div.chron', { style: { padding: '0' } }, items.map(e => h('div.ev.k-' + e.kind, e.text))));
  }

  resize(w, hh) {
    const sh = Math.min(this.sheet.offsetHeight || 0, hh * 0.62);
    this.stage.resize(w, hh, { top: 110, bottom: sh });
  }

  frame(dt) {
    const ep = this.ep;
    if (!ep) return;
    this.acc += dt * 60;
    let steps = Math.min(4, Math.floor(this.acc));
    this.acc -= steps;
    while (steps-- > 0) {
      if (!ep.done) {
        ep.step();
        this.rec.record(ep);
        if (this.mEp && !this.mEp.done) this.mEp.step();
        if (this.fEp && !this.fEp.done) this.fEp.step();
      } else {
        this.endWait += 1 / 60;
        if (this.mEp && !this.mEp.done) this.mEp.step();
        if (this.fEp && !this.fEp.done) this.fEp.step();
      }
    }
    if (ep.done && this.endWait > (ep.fell ? 1.2 : 0.8)) {
      // ゆっくり: 次の世代の答えを待つ
      if (this.speed === 'slow' && !this.pending && !this.paused && !this.fossil && this.ready) {
        if (!this._waitShown) { this._waitShown = true; this.liveDist.textContent = '…'; }
        if (!this.busy) { this.wantGen = true; this.pump(); }
      } else { this._waitShown = false; this.onReplayEnd(); }
    }
    this.view.update(ep.c);
    if (this.mEp && this.mView) {
      // ぬしは、となりのレーンを走る（地形は x だけで決まる所が多いので、横にずらしても足もとは合う）
      const rough = this.mEp.terrain.type === 'rough';
      const off = rough ? 0 : -(this.model.size.z / 2 + this.mModel.size.z / 2 + 0.3);
      this.mView.update(this.mEp.c, [0, 0, off]);
    }
    if (this.fEp && this.fView) this.fView.update(this.fEp.c);
    if (this.liveDist && !this._waitShown) this.liveDist.textContent = Math.max(0, ep.progress).toFixed(2);
    // カメラ
    const com = ep.nerves.com;
    this.stage.focus(com[0] + this.model.size.x * 0.1, Math.max(0.12, com[1] * 0.85), com[2] * 0.6);
    // 支えの手
    const S = this.model.sense;
    if (ep.nerves.assist > 0) {
      this.halo.visible = true;
      const r = Math.max(0.08, this.model.bodies[S].r * 2.2);
      this.halo.scale.setScalar(r);
      this.halo.position.set(ep.c.pos[3 * S], ep.c.pos[3 * S + 1] + this.model.bodies[S].r * 1.4, ep.c.pos[3 * S + 2]);
      this.halo.material.opacity = 0.15 + 0.45 * ep.nerves.assist;
    } else this.halo.visible = false;
    // リズムの波紋（1周期ごと）
    const ph = ep.nerves.phase;
    if (this._lastPh !== undefined && ph < this._lastPh - 3) { this._pulseT = 0; }
    this._lastPh = ph;
    if (this._pulseT !== undefined && this._pulseT < 0.6) {
      this._pulseT += dt;
      this.pulse.visible = this.viewMode !== 'skin';
      const k = this._pulseT / 0.6;
      const r = Math.max(0.06, this.model.bodies[S].r * 1.6) * (1 + 2 * k);
      this.pulse.scale.setScalar(r);
      this.pulse.position.set(ep.c.pos[3 * S], ep.c.pos[3 * S + 1], ep.c.pos[3 * S + 2]);
      this.pulse.quaternion.copy(this.stage.camera.quaternion);
      this.pulse.material.opacity = 0.6 * (1 - k);
    } else this.pulse.visible = false;
    // 神経のパネル
    if (this.tab === 'nerve' && this.nrows && this.sheet.offsetHeight) {
      const nv = ep.nerves;
      const feetOn = this.model.feet ? this.model.feet.filter(f => ep.c.contact[f.i]).map(f => this.model.bodies[f.i].name.replace(/あし|足/g, '').slice(0, 3)) : [];
      if (this.dial) phaseDial(this.dial, nv.phase, nv.freq, feetOn);
      for (const r of this.nrows) {
        const d = r.d;
        const tq = nv.tau[d.i], T = Math.max(1e-6, (d.Tpos + d.Tneg) / 2);
        const f = Math.max(-1, Math.min(1, tq / T));
        const bar = r.bar.firstChild;
        bar.style.left = f >= 0 ? '50%' : `${50 + f * 50}%`;
        bar.style.width = `${Math.abs(f) * 50}%`;
        const tg = (nv.target[d.i] - d.lo) / Math.max(1e-6, d.hi - d.lo);
        r.bar.lastChild.style.left = `${Math.max(0, Math.min(1, tg)) * 100}%`;
        r.x.textContent = `${Math.round(ep.c.jang[3 * d.joint + d.axis] * 57.3)}°`;
      }
    }
    this.stage.update(dt);
    const sh = this.sheet.offsetHeight;
    if (sh !== this._lastSh) { this._lastSh = sh; this.resize(this.app.size.w, this.app.size.h); }
  }

  render() { this.stage.render(); }
}

function getEraHex() {
  const v = getComputedStyle(document.body).getPropertyValue('--era').trim();
  return parseInt(v.replace('#', ''), 16) || 0xf2a65a;
}
