// ホーム: 惑星。地方をえらび、生命をはじめ、枝分かれして広がっていく
import { h, clear, gestures, fmtM, hex, modal } from './dom.js';
import { Planet } from '../render/planet.js';
import { REGIONS, REGION_KEYS, ERAS, RACE_T } from '../game/world.js';
import { eraName, regionNow, masterOf, masterModel, masterRecord, masterGenes, modelFor, living, settledCount } from '../game/game.js';
import { showHelp } from './help.js';

const INTRO = [
  'ここは、生まれたばかりの惑星。',
  '海と陸のあちこちに、「ぬし」と呼ばれる先住の生き物がいる。',
  'あなたは、いのちの設計者。',
  '骨を組み、関節を決め、筋肉をつける。',
  '動かし方は教えない。それは、進化が見つける。',
];

const STATUS = {
  growing: { t: '進化中', c: 'dim' },
  settled: { t: '定着', c: 'good' },
  crisis: { t: '危機', c: 'bad' },
  extinct: { t: '絶滅', c: 'dim' },
};

export function envChips(R) {
  const e = R.env, out = [];
  if (e.water) out.push('水の中');
  if (e.shallow) out.push('浅い水');
  if (e.terrain === 'beach') out.push(e.deep ? '深い波打ち際' : '波打ち際の坂');
  if (e.terrain === 'hills') out.push('丘');
  if (e.terrain === 'rough') out.push('でこぼこ');
  if (e.terrain === 'steps') out.push('段差');
  if (e.terrain === 'slope') out.push('のぼり坂');
  const f = e.friction || 1;
  if (e.terrain === 'ice' || f < 0.35) out.push('つるつる');
  else if (f < 0.7) out.push('すべる');
  if (!out.length) out.push('平ら');
  return out;
}

export class HomeScreen {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.planet = new Planet(app.renderer);
    this.sel = null;
    this.touch = h('div', { style: { position: 'absolute', inset: '0', touchAction: 'none' } });
    gestures(this.touch, {
      onDrag: (dx, dy) => this.planet.drag(dx, dy),
      onPinch: (f) => { this.planet.zoom = Math.max(0.7, Math.min(1.8, this.planet.zoom * f)); this.resize(this.app.size.w, this.app.size.h); },
      onTap: (e) => {
        const nx = (e.clientX / this.app.size.w) * 2 - 1, ny = -(e.clientY / this.app.size.h) * 2 + 1;
        const k = this.planet.pick(nx, ny);
        if (k) this.select(k);
      },
    });
    this.labels = h('div.labels');
    this.banner = h('div.era-banner');
    this.top = h('div.topbar',
      h('div.logo', h('b', 'SoftEvo ', h('i', '3D B')), h('span', '骨と筋肉の進化記')),
      h('div.grow'),
      h('button.iconbtn', { title: '系統樹と年代記', 'aria-label': '系統樹と年代記', onclick: () => app.go('tree') }, '🌳'),
      h('button.iconbtn', { title: 'オンライン', 'aria-label': 'オンライン', onclick: () => app.go('online') }, '🌐'),
      h('button.iconbtn', { title: '遊び方', 'aria-label': '遊び方', onclick: () => showHelp() }, '？'),
    );
    this.sheet = h('div.sheet');
    this.intro = null;
    el.append(this.touch, this.labels, this.banner, this.top, this.sheet);
    this.labelEls = {};
    for (const k of REGION_KEYS) {
      const l = h('button.rlabel', { onclick: () => this.select(k) });
      this.labelEls[k] = l;
      this.labels.appendChild(l);
    }
  }

  get g() { return this.app.game; }

  enter(params = {}) {
    this.planet.setEra(this.g.era);
    this.app.setEra(this.g.era);
    this.refreshFigures();
    this.updateLabels();
    this.banner.replaceChildren(h('div.n', `第${this.g.era + 1}紀`), h('div.t', ERAS[this.g.era].name));
    if (this.intro && this.g.introDone) {
      this.intro.remove(); this.intro = null;
      for (const el of [this.sheet, this.banner, this.labels]) el.classList.remove('hidden');
    }
    if (!this.g.introDone) { if (!this.intro) this.showIntro(); }
    else if (params.region) this.select(params.region);
    else if (this.sel) this.select(this.sel);
    else this.renderSheet();
  }
  leave() {}

  showIntro() {
    this.sheet.classList.add('hidden');
    this.banner.classList.add('hidden');
    this.labels.classList.add('hidden');
    const lines = INTRO.map(t => h('p', t));
    const go = h('button.btn.primary', { onclick: () => {
      this.intro.remove(); this.intro = null;
      this.sheet.classList.remove('hidden'); this.banner.classList.remove('hidden'); this.labels.classList.remove('hidden');
      this.g.introDone = true;
      this.app.save();
      this.renderSheet();
    } }, '生まれる場所をえらぶ');
    go.style.opacity = '0';
    this.intro = h('div.intro', h('div.lines', lines), go);
    this.el.appendChild(this.intro);
    lines.forEach((p, i) => setTimeout(() => p.classList.add('in'), 500 + i * 1100));
    setTimeout(() => { go.style.transition = 'opacity .8s'; go.style.opacity = '1'; }, 500 + lines.length * 1100);
  }

  refreshFigures() {
    const list = [];
    const g = this.g;
    for (const k of REGION_KEYS) {
      const mine = living(g).filter(s => s.region === k).sort((a, b) => (b.status === 'settled') - (a.status === 'settled') || (b.record || 0) - (a.record || 0)).slice(0, 2);
      for (const s of mine) list.push({ region: k, model: modelFor(s), color: s.color });
      if (!g.settled[k] && masterOf(k)) list.push({ region: k, model: masterModel(k), ghost: true, ghostColor: 0x1a2236 });
    }
    this.planet.setFigures(list);
  }

  // その地方へ行けるか: { ok, why, parents:[種] }
  reach(k) {
    const g = this.g;
    const alive = living(g);
    if (!alive.length) return { ok: true, fresh: true, parents: [] };
    const parents = alive.filter(s => s.status === 'settled' && (s.region === k || REGIONS[s.region].adj.includes(k)));
    if (parents.length) return { ok: true, parents };
    return { ok: false, parents: [], why: 'となりの地方に定着すると、ここへ枝分かれできる。' };
  }

  updateLabels() {
    const g = this.g;
    for (const k of REGION_KEYS) {
      const R = regionNow(g, k);
      const l = this.labelEls[k];
      const mine = living(g).filter(s => s.region === k);
      const settledSp = mine.find(s => s.status === 'settled');
      const crisis = mine.some(s => s.status === 'crisis');
      const rch = this.reach(k);
      l.replaceChildren(...[
        settledSp ? h('span.flag', { style: { background: hex(settledSp.color) } }) : null,
        h('span', R.icon), h('span', R.name), crisis ? h('span', { style: { color: 'var(--bad)' } }, '！') : null,
      ].filter(Boolean));
      l.classList.toggle('sel', this.sel === k);
      l.classList.toggle('locked', !rch.ok && !mine.length);
    }
  }

  select(k) {
    this.sel = k;
    this.planet.select(k);
    this.updateLabels();
    this.renderSheet();
  }

  renderSheet() {
    const g = this.g, s = clear(this.sheet);
    s.appendChild(h('div.grip'));
    const alive = living(g);
    if (!this.sel) {
      if (!alive.length) {
        s.append(h('h2', g.species.length ? '生命はふたたび' : '最初の生命'),
          h('p', g.species.length ? 'すべての種が絶えた。でも惑星は待っている。どこからでも、もう一度はじめられる。' : '惑星の地方をタップして、最初の生命が生まれる場所をえらんでください。どこからはじめても、たどる道は自由です。'));
      } else {
        s.append(h('h2', eraName(g.era)), h('p', ERAS[g.era].story));
        const next = ERAS[g.era + 1];
        s.append(h('p.muted', next ? `定着した地方 ${settledCount(g)} / ${next.at} で、次の時代「${next.name}」がはじまる。` : `定着した地方 ${settledCount(g)} / ${REGION_KEYS.length}`));
        s.append(h('h3', 'あなたの種'), this.speciesList(alive));
      }
      return;
    }
    const k = this.sel;
    const R = regionNow(g, k);
    const M = masterOf(k);
    s.append(h('div.row.between',
      h('h2', h('span', R.icon), R.name),
      h('button.iconbtn', { 'aria-label': 'とじる', onclick: () => { this.sel = null; this.planet.select(null); this.updateLabels(); this.renderSheet(); } }, '×')));
    if (R.changedAt) s.append(h('p', { style: { color: 'var(--era)' } }, `${ERAS[R.changedAt].name}で、${REGIONS[k].name}は「${R.name}」になった。`));
    s.append(h('p', REGIONS[k].desc));
    s.append(h('div.row.wrap', envChips(R).map(t => h('span.chip', t))));
    if (M) {
      const mr = masterRecord(k, g.era);
      s.append(h('h3', 'ぬし'), h('div.master',
        h('span.dot', { style: { background: '#2a3550' } }),
        h('div.grow', h('div', { style: { fontWeight: 700 } }, M.name), h('div.muted', M.desc)),
        h('div.rec.num', fmtM(mr)),
        h('button.btn.small', { onclick: () => this.app.go('arena', { mode: 'race', region: k, back: 'home', era: g.era,
          fighters: [{ key: 'm:' + k, name: M.name, owner: `${R.name}のぬし`, design: M.design, genes: masterGenes(k), color: 0x8a96b8, region: k }] }) }, '見る')));
      s.append(h('p.muted', `試練: ${RACE_T}秒でぬしより遠くへ進むと、この地方に定着できる。`));
    }
    const mine = g.species.filter(sp => sp.region === k);
    if (mine.length) s.append(h('h3', 'ここにいるあなたの種'), this.speciesList(mine));
    const rch = this.reach(k);
    const acts = h('div.stack', { style: { marginTop: '12px' } });
    if (rch.fresh) {
      acts.append(h('button.btn.primary.block', { onclick: () => this.app.go('design', { mode: 'new', region: k }) }, g.species.length ? 'ここで生命をはじめなおす' : 'ここで生命をはじめる'));
    } else if (rch.ok) {
      for (const p of rch.parents.slice(0, 3)) {
        acts.append(h('button.btn.primary.block', { onclick: () => this.app.go('design', { mode: 'branch', region: k, parent: p.id }) },
          p.region === k ? `『${p.name}』から新しい種をつくる` : `『${p.name}』をここへ枝分かれさせる`));
      }
    } else if (!mine.length) {
      acts.append(h('p.muted', rch.why));
    }
    s.append(acts);
    requestAnimationFrame(() => this.resize(this.app.size.w, this.app.size.h));
  }

  speciesList(list) {
    const g = this.g;
    return h('div.splist', list.map(sp => {
      const st = STATUS[sp.status];
      const R = regionNow(g, sp.region);
      return h('button.spcard', { onclick: () => (sp.status === 'extinct' ? this.fossil(sp) : this.app.go('lab', { id: sp.id })) },
        h('span.dot', { style: { background: hex(sp.color), width: '14px', height: '14px' } }),
        h('div.grow',
          h('div.row', h('span.nm', sp.name), h('span.chip.' + st.c, st.t)),
          h('div.meta', `${R.icon} ${R.name}　第${sp.gens}世代`)),
        h('div.rec.num', fmtM(sp.record)));
    }));
  }

  async fossil(sp) {
    const v = await modal({
      title: `『${sp.name}』の化石`,
      body: h('div', h('p', `第${(sp.extinctAt ? sp.extinctAt.era : 0) + 1}紀に絶滅した。記録 ${fmtM(sp.record)}、第${sp.gens}世代まで進化した。`), h('p', '化石から設計図と神経を取りだして、生きている種の地方で新しい種としてよみがえらせることもできる。')),
      actions: [{ label: 'とじる', value: null }, { label: '動きを見る', value: 'view' }],
    });
    if (v === 'view') this.app.go('lab', { id: sp.id });
  }

  resize(w, h) {
    this.planet.resize(w, h, this.sheet.classList.contains('hidden') ? 0 : Math.min(this.sheet.offsetHeight || 0, h * 0.5));
  }

  frame(dt) {
    this.planet.update(dt);
    // ラベルの位置
    const { w, h } = this.app.size;
    for (const k of REGION_KEYS) {
      const p = this.planet.project(k, w, h);
      const l = this.labelEls[k];
      l.style.left = p.x + 'px';
      l.style.top = p.y + 'px';
      l.style.opacity = p.visible ? '1' : '0';
      l.style.pointerEvents = p.visible ? 'auto' : 'none';
    }
    if (!this._sized && this.sheet.offsetHeight) { this._sized = true; this.resize(w, h); }
  }
  render() { this.planet.render(); }
}
