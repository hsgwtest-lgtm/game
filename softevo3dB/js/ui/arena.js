// 対戦の舞台: かけっこ（それぞれの世界でよーいどん）・すもう（同じ世界でぶつかり合う）
const THREE = window.THREE;
import { h, clear, toast, fmtM, hex } from './dom.js';
import { Stage } from '../render/scene.js';
import { CreatureView, lin } from '../render/creature.js';
import { Episode } from '../sim/sim.js';
import { SumoBout } from '../sim/bout.js';
import { compileModel } from '../sim/model.js';
import { REGIONS, officialEnv, RACE_T, goalEnv } from '../game/world.js';
import * as O from '../online.js';

export class ArenaScreen {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.stage = new Stage(app.renderer);
    this.touch = h('div', { style: { position: 'absolute', inset: '0', touchAction: 'none' } });
    let last = null;
    this.touch.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; });
    this.touch.addEventListener('pointermove', (e) => { if (!last) return; this.stage.orbit(-(e.clientX - last[0]) * 0.008, (e.clientY - last[1]) * 0.006); last = [e.clientX, e.clientY]; });
    this.touch.addEventListener('pointerup', () => { last = null; });
    this.touch.addEventListener('wheel', (e) => { e.preventDefault(); this.stage.zoom(e.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });
    this.top = h('div.topbar');
    this.hud = h('div.arena-hud');
    this.verdict = h('div.verdict');
    this.bottom = h('div.sheet');
    this.el.append(this.touch, this.top, this.hud, this.verdict, this.bottom);
    this.views = [];
    this.ring = null;
  }

  enter(params) {
    this.params = params;
    this.mode = params.mode || 'race';
    this.fighters = params.fighters.map(f => ({ ...f, model: compileModel(f.design) }));
    clear(this.top).append(
      h('button.iconbtn', { 'aria-label': 'もどる', onclick: () => this.app.go('online') }, '←'),
      h('div.grow', h('div.title', this.mode === 'race' ? `かけっこ　${REGIONS[params.region].name}` : 'すもう'), h('div.sub', this.mode === 'race' ? `${RACE_T}秒で、どこまで行けるか` : '土俵の外に出るか、倒れたら負け')),
    );
    this.start();
  }
  leave() { this.clearViews(); }

  clearViews() {
    for (const v of this.views) { this.stage.actors.remove(v.group); v.dispose(); }
    this.views = [];
    if (this.ring) { this.stage.scene.remove(this.ring); this.ring = null; }
  }

  start() {
    this.clearViews();
    clear(this.verdict);
    this.done = false;
    this.acc = 0;
    this.endT = 0;
    this.views = this.fighters.map(f => new CreatureView(f.model, { mode: 'skin', color: f.color }));
    for (const v of this.views) this.stage.actors.add(v.group);
    if (this.mode === 'race') {
      const env = officialEnv(this.params.region, { assist: 0 });
      const R = REGIONS[this.params.region];
      this.stage.setBiome(R.biome);
      // 神経のしくみ（お手本をまねるか）は、その種が育った「めざす動き」に合わせる
      this.eps = this.fighters.map(f => new Episode(f.model, f.genes, { ...env, ...goalEnv(f.goal || 'distance', f.model) }));
      const lane = Math.max(0.35, ...this.fighters.map(f => f.model.size.z + 0.25));
      const overlap = env.terrain === 'rough';
      this.offsets = this.fighters.map((f, k) => [0, 0, overlap ? 0 : (k - (this.fighters.length - 1) / 2) * lane]);
      const wl = this.eps[0].terrain.waterLevel || (env.water ? Math.max(...this.fighters.map(f => f.model.size.h)) + 0.6 : null);
      this.stage.setTerrain(env.terrain, wl);
      const s = Math.max(...this.fighters.map(f => Math.max(f.model.size.h, f.model.size.x)));
      this.stage.setView(0.35, 0.3, Math.max(1.4, s * 3 + lane * this.fighters.length), true);
    } else {
      this.stage.setBiome('plain');
      this.stage.setTerrain('flat');
      this.bout = new SumoBout(this.fighters.map(f => ({ model: f.model, genes: f.genes, mimic: f.goal === 'human', vstar: goalEnv(f.goal || 'distance', f.model).vstar })));
      // 土俵
      const R = this.bout.R;
      const ring = new THREE.Group();
      const dohyo = new THREE.Mesh(new THREE.CircleGeometry(R + 0.3, 64), new THREE.MeshStandardMaterial({ color: lin(0xd8c08a), roughness: 0.95 }));
      dohyo.rotation.x = -Math.PI / 2; dohyo.position.y = 0.002; dohyo.receiveShadow = true;
      const line = new THREE.Mesh(new THREE.RingGeometry(R - 0.02, R + 0.02, 96), new THREE.MeshBasicMaterial({ color: 0xf8f3e6 }));
      line.rotation.x = -Math.PI / 2; line.position.y = 0.004;
      const shikiri = [-1, 1].map(sg => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff })); m.rotation.x = -Math.PI / 2; m.position.set(sg * 0.12, 0.005, 0); return m; });
      ring.add(dohyo, line, ...shikiri);
      this.ring = ring;
      this.stage.scene.add(ring);
      this.offsets = this.fighters.map(() => [0, 0, 0]);
      this.stage.focus(0, 0.3, 0, true);
      this.stage.setView(0.2, 0.55, R * 2.6 + 0.6, true);
    }
    this.renderHud();
    clear(this.bottom).append(h('div.row', h('button.btn', { onclick: () => this.start() }, 'もう一度'), h('div.grow'), h('span.muted', '決定論: 何度やっても同じ結果になる')));
  }

  renderHud() {
    clear(this.hud);
    this.laneEls = this.fighters.map((f, k) => {
      const d = h('b', '0.00m');
      const row = h('div.lane', h('span.dot', { style: { background: hex(f.color) } }), h('span', `${this.mode === 'sumo' ? (k === 0 ? '西　' : '東　') : ''}${f.name}`, h('span.muted', `　${f.owner || ''}`)), d);
      this.hud.append(row);
      return d;
    });
  }

  finishRace() {
    this.done = true;
    const res = this.eps.map((ep, k) => ({ k, d: Math.max(0, ep.progress), fell: ep.fell }));
    res.sort((a, b) => b.d - a.d);
    const w = res[0];
    const f = this.fighters[w.k];
    clear(this.verdict).append(h('div.t', `${f.name} の勝ち`), h('div.d', res.map((r, i) => `${i + 1}位 ${this.fighters[r.k].name} ${fmtM(r.d)}${r.fell ? '（転倒）' : ''}`).join('　')));
  }

  finishSumo() {
    this.done = true;
    const r = this.bout.result;
    const t = r.winner === -1 ? '引き分け' : `${this.fighters[r.winner].name} の勝ち`;
    clear(this.verdict).append(h('div.t', t), h('div.d', `決まり手: ${r.kimarite}（${r.t.toFixed(1)}秒）`));
    // オンラインの相手との取組なら、相手（東）の成績に記録
    if (this.params.online && this.fighters[1].online) {
      const res = r.winner === 1 ? 'win' : r.winner === 0 ? 'lose' : 'draw';
      O.postSumo(this.fighters[1].id, res).catch(() => {});
    }
  }

  resize(w, hh) { this.stage.resize(w, hh, { top: 100, bottom: this.bottom.offsetHeight || 60 }); }

  frame(dt) {
    this.acc += dt * 60;
    let n = Math.min(4, Math.floor(this.acc));
    this.acc -= n;
    if (this.mode === 'race') {
      while (n-- > 0) for (const ep of this.eps) if (!ep.done) ep.step();
      let lead = -1e9, lz = 0;
      this.eps.forEach((ep, k) => {
        this.views[k].update(ep.c, this.offsets[k]);
        this.laneEls[k].textContent = `${Math.max(0, ep.progress).toFixed(2)}m${ep.fell ? ' 転倒' : ''}`;
        if (ep.nerves.com[0] > lead) { lead = ep.nerves.com[0]; lz = this.offsets[k][2]; }
      });
      const y = Math.max(...this.eps.map(ep => ep.nerves.com[1]));
      this.stage.focus(lead, Math.max(0.15, y * 0.8), 0);
      if (!this.done && this.eps.every(ep => ep.done)) this.finishRace();
    } else {
      const b = this.bout;
      while (n-- > 0 && !b.result) b.step();
      b.cs.forEach((c, k) => this.views[k].update(c));
      b.nv.forEach((nv, k) => { this.laneEls[k].textContent = `${b.t.toFixed(1)}秒`; });
      if (!this.done && b.result) this.finishSumo();
    }
    this.stage.update(dt);
  }
  render() { this.stage.render(); }
}
