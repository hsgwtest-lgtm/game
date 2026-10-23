// 成長パレード: 昔の自分たち（第0世代・レベルアップした世代・いま）をレーンにならべて同時に走らせる
// かけっこ: 図鑑の生き物どうしで競争（params.race = [id...]）

import { C, text, button, iconButton, win, mini, bigNum, LINE_H, measure } from '../ui/widgets.js';
import { ICON } from '../gfx/icons.js';
import { db } from '../core/db.js';
import { compileBody } from '../sim/body.js';
import { brainLayout } from '../sim/brain.js';
import { normalizeEnv } from '../sim/creature.js';
import { Actor, Clock } from '../world/actor.js';
import { formatFit } from '../evo/growth.js';
import { envLabel } from '../evo/session.js';
import { bestChamp } from './zukan.js';

const MAX_LANES = 5;

export class ParadeScreen {
  constructor(app) { this.app = app; this.actors = []; }

  async enter(params = {}) {
    const app = this.app;
    this.loading = true;
    this.actors = [];
    this.lanes = [];
    this.t = 0;
    this.phase = 'load';
    this.params = params;
    app.sound.setMood('fast');
    const w = app.world;
    w.buildGroup.visible = false; w.envGroup.visible = true;
    if (params.race) await this._loadRace(params.race);
    else await this._loadParade(params.id);
    if (!this.lanes.length) { app.toast('まだ 世代の記録が ありません', C.red); app.go('zukan'); return; }
    this._setup();
    this.loading = false;
  }

  async _loadParade(id) {
    const rec = await db.getCreature(id);
    if (!rec) return;
    this.rec = rec;
    const champs = await db.getChamps(id);
    if (!champs.length) return;
    this.env = normalizeEnv(rec.env);
    const body = compileBody(rec.voxels);
    const L = brainLayout(body, rec.hidden);
    // えらぶ世代: 最初・レベルアップの世代・最新
    const pick = new Map();
    const add = (c, label) => { if (c && !pick.has(c.gen)) pick.set(c.gen, { c, label }); };
    add(champs[0], '第0世代');
    const levelGens = rec.journal.filter(j => j.kind === 'level').map(j => j.gen);
    const last = champs[champs.length - 1];
    const mids = [];
    for (const g of levelGens) {
      const c = champs.find(x => x.gen === g);
      if (c) mids.push(c);
    }
    // 間を均等にえらぶ
    const want = MAX_LANES - 2;
    for (let k = 0; k < want && mids.length; k++) {
      const c = mids[Math.floor((k + 1) * mids.length / (want + 1))];
      add(c, `第${c.gen}世代`);
    }
    if (pick.size < MAX_LANES - 1 && champs.length > 2) {
      for (const f of [0.25, 0.5, 0.75]) { const c = champs[Math.floor(champs.length * f)]; if (pick.size < MAX_LANES - 1) add(c, `第${c.gen}世代`); }
    }
    add(last, `いま(第${last.gen})`);
    const list = [...pick.values()].sort((a, b) => a.c.gen - b.c.gen);
    this.lanes = list.map(({ c, label }) => ({ body, L, genome: c.g, label, sub: formatFit(this.env.objective, c.fit) }));
    this.title = `${rec.name} の 成長パレード`;
  }

  async _loadRace(ids) {
    this.env = normalizeEnv({});
    for (const id of ids.slice(0, MAX_LANES)) {
      const rec = await db.getCreature(id);
      if (!rec) continue;
      const champs = await db.getChamps(id);
      const best = bestChamp(champs, rec);
      if (!best) continue;
      const body = compileBody(rec.voxels);
      this.lanes.push({ body, L: brainLayout(body, rec.hidden), genome: best.g, label: rec.name, sub: `LV${rec.level}` });
    }
    this.title = 'かけっこ大会';
  }

  _setup() {
    const w = this.app.world;
    const n = this.lanes.length;
    w.setTheme(this.env.terrain);
    w.setTerrain(this.env.terrain, n);
    w.setRecord(null);
    for (const a of this.actors) a.dispose();
    this.actors = this.lanes.map((ln, i) => new Actor(w, ln.body, ln.L, ln.genome, this.env, { z: w.laneZ(i, n) }));
    w.setView(0.3, 0.82, 2.2 + n * 0.75, true);
    w.focus(0.3, 0.1, 0, true);
    this.clock = new Clock();
    this.phase = 'count';
    this.countT = 3.2;
    this.results = null;
    this.speed = 1;
  }

  exit() {
    for (const a of this.actors) a.dispose();
    this.actors = [];
    this.app.world.setTerrain(this.app.world.terrain, 1);
  }

  viewHeight() { return this.app.px.VH; }

  update(dt, modal) {
    this.t += dt;
    if (this.loading) return;
    const w = this.app.world;
    if (this.phase === 'count') {
      const before = Math.ceil(this.countT);
      this.countT -= dt;
      const after = Math.ceil(this.countT);
      if (after !== before && after > 0) this.app.sfx('tick');
      if (this.countT <= 0) { this.phase = 'run'; this.app.sfx('go'); }
    } else if (this.phase === 'run' && !modal) {
      const nfr = this.clock.frames(dt, this.speed);
      for (const a of this.actors) a.stepFrames(nfr);
      if (this.actors.every(a => a.done)) {
        this.phase = 'done';
        const isJump = this.env.objective === 'jump';
        this.results = this.actors.map((a, i) => ({ i, v: isJump ? a.c.st.maxClear : a.distance }))
          .sort((a, b) => b.v - a.v);
        this.app.sfx('win');
      }
    }
    let mx = 0, lead = -1e9;
    for (const a of this.actors) { a.sync(this.t); mx += a.com[0]; lead = Math.max(lead, a.com[0]); }
    mx /= Math.max(1, this.actors.length);
    w.focus((mx + lead) / 2, 0.1, 0);
  }

  draw(fb) {
    const app = this.app, px = app.px, VW = px.VW, VH = px.VH, top = px.safe.t, bot = VH - px.safe.b;
    if (this.loading) { fb.rect(0, 0, VW, VH, C.navy); text(fb, 'よみこみちゅう…', VW / 2, VH / 2, C.silver, { align: 'center' }); return; }
    app.ui.area('par_view', 0, 0, VW, VH, {
      down: (x, y) => { this.drag = { lx: x, ly: y }; },
      move: (x, y) => { const d = this.drag; if (!d) return; app.world.orbit(-(x - d.lx) * 0.018, (y - d.ly) * 0.014); d.lx = x; d.ly = y; },
      up: () => { this.drag = null; },
      pinch: (f) => app.world.zoom(f),
    });
    iconButton(app, 'par_back', 4, top + 3, 18, 14, ICON.back, () => app.go(this.params.race ? 'zukan' : 'lab', { id: this.params.id }));
    text(fb, this.title, 26, top + 4, C.white, { outline: C.ink });
    text(fb, envLabel(this.env), 26, top + 16, C.silver, { outline: C.ink });
    // 名札（頭の上）
    const isJump = this.env.objective === 'jump';
    this.actors.forEach((a, i) => {
      const ln = this.lanes[i];
      const p = app.world.project(a.com[0], a.com[1] + 0.32, a.com[2] + a.z);
      if (!p) return;
      const x = Math.round(p.x * VW), y = Math.round(p.y * VH);
      if (y < top + 26 || y > VH - 10) return;
      const val = isJump ? `${(a.c.st.maxClear * 100).toFixed(0)}cm` : `${a.distance.toFixed(2)}m`;
      const rank = this.results ? this.results.findIndex(r => r.i === i) + 1 : 0;
      const col = rank === 1 ? C.yellow : C.white;
      text(fb, ln.label, x, y - 11, col, { align: 'center', outline: C.ink });
      mini(fb, val.toUpperCase(), x, y + 1, col, 'center');
    });
    if (this.phase === 'count') {
      const n = Math.ceil(this.countT);
      if (n > 0) bigNum(fb, String(n), VW / 2 - 6, VH * 0.35, C.yellow, 5, 'left');
      text(fb, '昔の自分と 競争！', VW / 2, VH * 0.35 + 34, C.white, { align: 'center', outline: C.ink });
    }
    if (this.phase === 'run') {
      const f = this.actors[0].frame / 600;
      fb.rect(8, bot - 6, VW - 16, 2, C.ink);
      fb.rect(8, bot - 6, Math.round((VW - 16) * Math.min(1, f)), 2, C.white);
      button(app, 'par_speed', VW - 40, bot - 26, 34, 16, `x${this.speed}`, () => { this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1; }, { mini: true });
    }
    if (this.phase === 'done') {
      const n = this.results.length;
      const h = 30 + n * LINE_H + 24;
      const y = bot - h - 6;
      win(fb, 8, y, VW - 16, h, { title: 'けっか', titleCenter: true });
      this.results.forEach((r, k) => {
        const ln = this.lanes[r.i];
        const col = k === 0 ? C.yellow : C.white;
        text(fb, `${k + 1}い`, 16, y + 9 + k * LINE_H, col);
        text(fb, ln.label, 40, y + 9 + k * LINE_H, col);
        text(fb, isJump ? `${(r.v * 100).toFixed(1)}cm` : `${r.v.toFixed(2)}m`, VW - 16, y + 9 + k * LINE_H, col, { align: 'right' });
      });
      if (!this.params.race && this.results[0] && this.lanes[this.results[0].i].label.startsWith('いま')) {
        text(fb, 'いまの自分が いちばん！', VW / 2, y + 11 + n * LINE_H, C.lime, { align: 'center' });
      }
      const bw = Math.floor((VW - 40) / 2);
      button(app, 'par_again', 16, y + h - 20, bw, 15, 'もういちど', () => this._setup());
      button(app, 'par_done', 24 + bw, y + h - 20, bw, 15, 'もどる', () => app.go(this.params.race ? 'zukan' : 'lab', { id: this.params.id }), { accent: C.lime });
    }
  }
}
