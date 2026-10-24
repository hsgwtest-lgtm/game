// オンライン: 地方ごとのランキング・公開・かけっこ・すもう（ネットがなくても、自分の種どうし・ぬしと対戦できる）
import { h, clear, toast, modal, ask, fmtM, hex } from './dom.js';
import * as O from '../online.js';
import { REGIONS, REGION_KEYS, officialEnv, RACE_T, goalEnv } from '../game/world.js';
import * as G from '../game/game.js';
import { evaluate } from '../sim/sim.js';
import { compileModel } from '../sim/model.js';
import { b64ToF64 } from '../game/store.js';

export class OnlineScreen {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.wrap = h('div.online-wrap');
    this.top = h('div.topbar', { style: { background: 'var(--space)' } });
    this.el.append(this.wrap, this.top);
    this.region = 'plain';
    this.data = null;
    this.err = null;
  }
  get g() { return this.app.game; }

  async enter(params = {}) {
    const p = O.profile();
    clear(this.top).append(
      h('button.iconbtn', { 'aria-label': 'もどる', onclick: () => this.app.go('home') }, '←'),
      h('div.grow', h('div.title', 'オンライン'), h('div.sub', '公式コース（はじまりの時代の環境）で競う')),
      h('button.btn.small', { onclick: () => this.rename() }, p.name || '名前を決める'),
    );
    if (params.publish) {
      const sp = G.speciesById(this.g, params.publish);
      if (sp) this.region = sp.region;
    }
    this.paint();
    await this.load();
    if (params.publish) this.publishFlow(params.publish);
  }
  leave() {}

  async load() {
    this.loading = true; this.paint();
    try { this.data = await O.fetchCreatures(); this.err = null; } catch (e) { this.err = e; this.data = null; }
    this.loading = false; this.paint();
  }

  async rename() {
    const v = await ask('あなたの名前（ランキングに出る）', O.profile().name, { max: 16 });
    if (v) { O.setName(v); this.enter({}); }
  }

  paint() {
    const w = clear(this.wrap);
    if (this.err) {
      if (this.err.kind === 'permission') {
        w.append(h('div.notice', 'データベースが、この遊びのデータの読み書きを許可していません。Firebase のルールに次の1行を加えると使えるようになります。', h('code.rule', O.RULES_HINT)));
      } else w.append(h('div.notice', `${this.err.message}。ネットにつながると、ランキングと公開が使えます。下の「手元で対戦」は、いつでも遊べます。`));
    }
    // 地方
    w.append(h('div.seg', { style: { margin: '8px 0', flexWrap: 'wrap' } }, REGION_KEYS.map(k => h('button' + (this.region === k ? '.on' : ''), { onclick: () => { this.region = k; this.paint(); } }, `${REGIONS[k].icon} ${REGIONS[k].name}`))));
    w.append(h('h3', { style: { margin: '10px 0 6px' } }, `${REGIONS[this.region].name}のランキング（${RACE_T}秒で進んだ距離）`));
    if (this.loading) w.append(h('p.muted', '読みこみ中…'));
    else if (this.data) {
      const me = O.profile().id;
      const list = this.data.list.filter(c => c.region === this.region).sort((a, b) => b.record - a.record).slice(0, 30);
      if (!list.length) w.append(h('p.muted', 'まだだれも公開していない。最初の挑戦者になろう。'));
      w.append(h('div.rank', list.map((c, i) => {
        const st = this.data.stats[c.id] || {};
        return h('button.rk' + (c.ownerId === me ? '.me' : ''), { onclick: () => this.creatureMenu(c) },
          h('span.n.num', i + 1),
          h('div', h('div', { style: { fontWeight: 700 } }, h('span.dot', { style: { background: hex(c.color), marginRight: '6px' } }), c.name), h('div.who', `${c.owner}　第${c.gens}世代${st.cheers ? `　拍手 ${st.cheers}` : ''}${st.w || st.l ? `　すもう ${st.w}勝${st.l}敗` : ''}`)),
          h('b.num', fmtM(c.record)));
      })));
      w.append(h('div.row', { style: { marginTop: '8px' } }, h('button.btn.small', { onclick: () => this.load() }, '更新')));
    }
    // 公開
    const mine = G.living(this.g).filter(s => s.best);
    w.append(h('h3', { style: { margin: '18px 0 6px' } }, 'あなたの種を公開する'));
    if (!mine.length) w.append(h('p.muted', '支えの手なしの記録がある種を公開できる。'));
    w.append(h('div.row.wrap', mine.map(s => h('button.btn.small', { onclick: () => this.publishFlow(s.id) }, h('span.dot', { style: { background: hex(s.color) } }), s.name))));
    // 手元で対戦
    w.append(h('h3', { style: { margin: '18px 0 6px' } }, '手元で対戦'));
    w.append(h('p.muted', 'あなたの種どうし、またはぬしと。ネットがなくても遊べる。'));
    w.append(h('div.row.wrap',
      h('button.btn', { onclick: () => this.localBattle('race') }, '🏃 かけっこ'),
      h('button.btn', { onclick: () => this.localBattle('sumo') }, '🤼 すもう')));
  }

  // 自分の種・ぬしの一覧（対戦の相手えらび用）
  candidates() {
    const out = [];
    for (const s of G.living(this.g)) {
      const x = s.best ? s.best.x : s.champ && s.champ.x;
      if (!x) continue;
      out.push({ key: 's:' + s.id, name: s.name, owner: 'あなた', design: s.design, genes: b64ToF64(x), color: s.color, region: s.region, goal: s.goal || 'distance' });
    }
    for (const k of REGION_KEYS) {
      const M = G.masterOf(k);
      if (M) out.push({ key: 'm:' + k, name: M.name, owner: `${REGIONS[k].name}のぬし`, design: M.design, genes: G.masterGenes(k), color: 0x8a96b8, region: k });
    }
    return out;
  }

  async pick(title, exclude = null) {
    const list = this.candidates().filter(c => c.key !== exclude);
    const body = h('div.stack', list.map(c => h('button.spcard', { onclick: () => box._close(c.key) }, h('span.dot', { style: { background: hex(c.color), width: '14px', height: '14px' } }), h('div.grow', h('div.nm', c.name), h('div.meta', c.owner)))));
    const p = modal({ title, body, actions: [{ label: 'やめる', value: null }] });
    const box = document.querySelector('.modal-wrap:last-child .modal');
    const k = await p;
    return k ? list.find(c => c.key === k) : null;
  }

  async localBattle(mode) {
    const a = await this.pick(mode === 'race' ? 'かけっこ: 1匹目' : 'すもう: 西');
    if (!a) return;
    const b = await this.pick(mode === 'race' ? 'かけっこ: 2匹目' : 'すもう: 東', a.key);
    if (!b) return;
    let region = a.region;
    if (mode === 'race') {
      const r = await modal({ title: 'コース', body: h('p', 'どの地方の公式コースで走る？'), actions: [{ label: `${REGIONS[a.region].name}`, value: a.region }, ...(b.region !== a.region ? [{ label: `${REGIONS[b.region].name}`, value: b.region }] : []), { label: 'そうげん', value: 'plain' }] });
      if (!r) return;
      region = r;
    }
    this.app.go('arena', { mode, fighters: [a, b], region });
  }

  async creatureMenu(c) {
    const me = O.profile().id;
    const acts = [{ label: '🏃 かけっこで挑む', value: 'race' }, { label: '🤼 すもうで挑む', value: 'sumo' }, { label: '👏 拍手', value: 'cheer' }, { label: '動きを見る', value: 'watch' }];
    if (c.ownerId === me) acts.push({ label: '公開をやめる', value: 'withdraw', kind: 'danger' });
    const body = h('div.stack', h('p', `${c.owner} の『${c.name}』　${fmtM(c.record)}${c.msg ? `　「${c.msg}」` : ''}`), ...acts.map(a => h('button.btn.block' + (a.kind ? '.' + a.kind : ''), { onclick: () => box._close(a.value) }, a.label)));
    const p = modal({ title: c.name, body, actions: [{ label: 'とじる', value: null }] });
    const box = document.querySelector('.modal-wrap:last-child .modal');
    const v = await p;
    const them = { key: 'o:' + c.id, id: c.id, name: c.name, owner: c.owner, design: c.design, genes: c.genes, color: c.color, region: c.region, goal: c.goal, online: true };
    if (v === 'race' || v === 'sumo') {
      const mine = await this.pick(v === 'race' ? 'あなたの走者' : 'あなたの力士');
      if (!mine) return;
      this.app.go('arena', { mode: v, fighters: [mine, them], region: c.region, online: true });
    } else if (v === 'watch') this.app.go('arena', { mode: 'race', fighters: [them], region: c.region });
    else if (v === 'cheer') { try { await O.cheer(c.id); toast('拍手をおくった', { icon: '👏' }); this.load(); } catch (e) { toast(e.message, { kind: 'bad' }); } }
    else if (v === 'withdraw') { try { await O.withdraw(c.id); toast('公開をやめた'); this.load(); } catch (e) { toast(e.message, { kind: 'bad' }); } }
  }

  async publishFlow(id) {
    const sp = G.speciesById(this.g, id);
    if (!sp || !sp.best) return;
    const genes = b64ToF64(sp.best.x);
    const model = compileModel(sp.design);
    const r = evaluate(model, genes, officialEnv(sp.region, { assist: 0, ...goalEnv(sp.goal || 'distance', model) }));
    const rec = Math.max(0, r.dist);
    if (!O.profile().name) await this.rename();
    const msg = h('input.text', { maxLength: 60, placeholder: 'ひとこと（なくてもよい）' });
    const ok = await modal({
      title: `『${sp.name}』を公開する`,
      body: h('div', h('p', `${REGIONS[sp.region].name}の公式コースで ${fmtM(rec)}。この記録でランキングにのる。ほかの人の端末でも、まったく同じ動きが再現される。`), msg),
      actions: [{ label: 'やめる', value: false }, { label: '公開する', kind: 'primary', value: true }],
    });
    if (!ok) return;
    try {
      await O.publish(sp, rec, genes, msg.value);
      toast('公開した', { kind: 'good', icon: '🌐' });
      this.region = sp.region;
      this.load();
    } catch (e) {
      this.err = e; this.paint();
      toast(e.message, { kind: 'bad' });
    }
  }

  resize() {}
  frame() {}
  // App の描画ループから毎フレーム呼ばれる（3D はないので、背景を塗るだけ）
  render() { this.app.renderer.setClearColor(0x0d1124, 1); this.app.renderer.clear(); }
}
