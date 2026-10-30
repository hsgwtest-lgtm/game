// ラボ: 海の条件を選び、気に入った世界を自分で選んで進化させる
import { $, esc } from './dom.js';
import { activeLayout, randomRow, ROW_FLOATS } from '../sim/brain.js';
import { baseCfg, envFor, randomPatches } from '../sim/stages.js';
import { Evolution } from '../ml/evolve.js';
import { RNG, hashSeed } from '../sim/rng.js';
import { metricOf } from '../game/session.js';
import { writeSave } from '../game/save.js';
import { coverRect, ensureAmbient } from './title.js';

const ALL = ['food', 'touch', 'light', 'crowd', 'vibe', 'glow'];
const REEF = [{ t: 'c', x: 0.25, y: 0.95, r: 0.05 }, { t: 'c', x: 0.78, y: 0.42, r: 0.06 }, { t: 'c', x: 0.6, y: 1.2, r: 0.035 }, { t: 'c', x: 0.2, y: 0.3, r: 0.045 }];

const OPTS = [
  { k: 'food', name: '餌場', desc: 'ところどころに餌がわく' },
  { k: 'jelly', name: 'クラゲ', desc: '群れを追う捕食者が2匹' },
  { k: 'rock', name: '岩', desc: '海に岩が散らばる' },
  { k: 'dark', name: '暗い海', desc: '振動は近くだけ。クラゲは光がにがて' },
  { k: 'light', name: '海面の光', desc: '上ほど明るい' },
];

export class LabSession {
  constructor(app) {
    this.app = app;
    this.kind = 'lab';
    this.id = 'lab';
    this.title = 'ラボ　えらぶ進化';
    this.metric = 'alive';
    this.metricName = '生存';
    this.pass = [0.3, 0.5, 0.7];
    this.layout = activeLayout(ALL, 12);
    const lab = app.save.lab || (app.save.lab = { opts: { food: true, jelly: false, rock: false, dark: false, light: true } });
    this.opts = lab.opts;
  }

  makeCfg(seed) {
    const o = this.opts;
    const rng = new RNG(seed);
    const c = baseCfg();
    c.env = o.rock ? envFor('lab-rock', REEF, { mode: 'open', exp: 2 }) : envFor('open', [], { mode: 'open', exp: 2 });
    c.spawn = [0.5, 0.75, 0, 1];
    c.light = [o.light ? 1 : 0, 0, 0, 0.08];
    if (o.dark) c.light[0] *= 0.3;
    c.energy0 = 0.6;
    c.energy = [0.0007, 0.0008, 0.0003, 0.2];
    c.foodR = [0.02, 0, 0, 0];
    c.patches = o.food ? randomPatches(rng, 5, 0.1, 0.13, { env: c.env }) : [];
    if (!o.food) { c.energy = [0.0003, 0.0003, 0.0002, 0.2]; c.energy0 = 1; }
    if (o.jelly) {
      c.predP = [2, 0.03, 0.35, o.dark ? 0.07 : 0.16];
      c.predM = [0.0046, 0.07, 0.3, o.dark ? 6 : 0];
      c.predSpawns = [[rng.range(0.1, 0.9), 1.45, 0, -0.003], [rng.range(0.1, 0.9), 0.05, 0, 0.003]];
      if (o.dark) c.defense = [0.8, 8, 0.95, 0];
    }
    return c;
  }

  attach(swarm) {
    const lab = this.app.save.lab;
    const row0 = lab.champion && lab.champion.length === ROW_FLOATS ? Float32Array.from(lab.champion) : randomRow(this.layout, new RNG(hashSeed('lab', lab.restarts || 0)));
    this.evo = new Evolution(swarm, { stage: null, layout: this.layout, row0, seed: hashSeed('lab', lab.restarts || 0), makeCfg: (s) => this.makeCfg(s) });
    if (lab.evo && lab.evo.es && lab.evo.es.mu && lab.evo.es.mu.length === this.layout.idx.length) {
      try { this.evo.load(lab.evo); } catch (e) { /* 最初から */ }
    }
    this.findings = lab.findings || (lab.findings = []);
    this.metricHist = lab.metricHist || (lab.metricHist = []);
    return this.evo;
  }

  onGeneration(ev) {
    const lab = this.app.save.lab;
    const n = 2 + this.evo.pairs * 2;
    const m = [];
    for (let k = 0; k < n; k++) m.push(metricOf('alive', ev, k));
    const rec = { g: ev.rec.gen, c: m[0], e: m[1], b: Math.max(...m), f: ev.rec.center };
    this.metricHist.push(rec);
    if (this.metricHist.length > 600) this.metricHist.splice(0, this.metricHist.length - 600);
    lab.champion = Array.from(this.evo.eliteRow());
    lab.evo = this.evo.toJSON();
    writeSave(this.app.save);
    return { metrics: m, rec };
  }

  championRow() {
    const lab = this.app.save.lab;
    if (this.evo) return this.evo.eliteRow();
    return lab.champion ? Float32Array.from(lab.champion) : randomRow(this.layout, new RNG(1));
  }

  showArg() {
    return {
      trial: 'lab', session: this,
      meta: { id: 'lab', name: 'ラボの群れ', metric: 'alive', metricName: '生存', pass: this.pass, play: this.opts.jelly ? 'jelly' : 'food', playHint: this.opts.jelly ? 'クラゲを指でつかんで動かせる' : 'タップすると、そこに餌場が生まれる', steps: 600 },
    };
  }

  restart() {
    const lab = this.app.save.lab;
    lab.restarts = (lab.restarts || 0) + 1;
    delete lab.evo; delete lab.champion; lab.findings = []; lab.metricHist = [];
    writeSave(this.app.save, true);
  }
}

export function createLab(app) {
  const el = $('#s-lab');
  let sw = null, t = 0;

  function card() {
    const s = new LabSession(app);
    const o = s.opts;
    const gens = app.save.lab && app.save.lab.evo ? app.save.lab.evo.gen : 0;
    const html = `
      <div class="depth">ラボ</div>
      <h3>えらぶ進化</h3>
      <p class="how">海の条件を決めて、自由に本能を進化させる。進化の画面で世界をタップすると、その世界の本能へ近づく（選ばなければ、長く生きた群れが選ばれる）。すべての感覚が使え、神経は12。</p>
      <h4>海の条件</h4>
      <div class="labcfg">${OPTS.map((x) => `<button class="opt ${o[x.k] ? 'on' : ''}" data-k="${x.k}"><b>${esc(x.name)}</b><span>${esc(x.desc)}</span></button>`).join('')}</div>
      <div class="row">
        ${gens ? '<button class="btn ghost small" data-a="reset">本能を最初から</button>' : ''}
        <button class="btn ghost" data-a="back">もどる</button>
        <button class="btn primary" data-a="go">${gens ? `つづける（${gens}世代）` : '進化をはじめる'}</button>
      </div>`;
    const c = app.modal(html, () => app.go('title'));
    c.addEventListener('click', (e) => {
      const op = e.target.closest('.opt');
      if (op) { o[op.dataset.k] = !o[op.dataset.k]; op.classList.toggle('on', o[op.dataset.k]); app.persist(); return; }
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'back') app.go('title');
      if (b.dataset.a === 'go') app.go('evolve', { session: new LabSession(app) });
      if (b.dataset.a === 'reset') {
        if (b.dataset.sure) { new LabSession(app).restart(); app.toast('ラボの本能を生まれたときに戻しました'); card(); }
        else { b.dataset.sure = '1'; b.textContent = 'もう一度押すと消えます'; }
      }
    });
  }

  return {
    el,
    enter() {
      sw = ensureAmbient(app);
      card();
    },
    leave() {},
    frame() {
      if (!sw) return;
      sw.step(1);
      if (++t > 1500) { sw.reset(5 + t); t = 0; }
      app.R.clear();
      app.R.drawWorlds(sw, [coverRect(app.canvas.clientWidth, app.canvas.clientHeight)], { trails: true, pointSize: 1.1, bright: 0.3, fade: 0.86, ring: 0.3 });
    },
  };
}
