// 系統樹と年代記: あなたの種がどう分かれ、どこへ広がり、何が絶えたか
import { h, clear, hex, fmtM } from './dom.js';
import { ERAS, REGIONS } from '../game/world.js';
import { eraName, regionNow } from '../game/game.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids) if (k) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
};

export class TreeScreen {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.wrap = h('div.tree-wrap');
    this.top = h('div.topbar', { style: { background: 'var(--space)' } });
    this.el.append(this.wrap, this.top);
  }
  get g() { return this.app.game; }

  enter() {
    clear(this.top).append(
      h('button.iconbtn', { 'aria-label': 'もどる', onclick: () => this.app.go('home') }, '←'),
      h('div.grow', h('div.title', '系統樹と年代記'), h('div.sub', eraName(this.g.era))),
    );
    clear(this.wrap);
    const sc = h('div.tree-scroll');
    this.wrap.append(sc);
    const sp = this.g.species;
    if (!sp.length) {
      sc.append(h('div', { style: { padding: '20px' } }, h('p', 'まだ種がいない。惑星から、最初の生命をはじめよう。')));
      return;
    }
    sc.append(this.treeSvg(sp));
    sc.append(this.chronicle());
  }
  leave() {}

  treeSvg(list) {
    const byParent = new Map();
    for (const x of list) {
      const p = x.parent && list.some(y => y.id === x.parent) ? x.parent : null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(x);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.born - b.born);
    // 葉の順に x、深さで y
    const pos = new Map();
    let leaf = 0, maxD = 0;
    const walk = (node, d) => {
      maxD = Math.max(maxD, d);
      const kids = byParent.get(node.id) || [];
      if (!kids.length) { pos.set(node.id, { x: leaf++, d }); return; }
      for (const k of kids) walk(k, d + 1);
      const xs = kids.map(k => pos.get(k.id).x);
      pos.set(node.id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, d });
    };
    for (const r of byParent.get(null) || []) walk(r, 0);
    const W = Math.max(this.app.size.w, leaf * 96 + 40), dy = 96;
    const H = (maxD + 1) * dy + 50;
    const X = (x) => (leaf > 1 ? 48 + x * (W - 96) / (leaf - 1) : W / 2);
    const Y = (d) => 40 + d * dy;
    const svg = s('svg', { width: W, height: H, class: 'tree-svg', viewBox: `0 0 ${W} ${H}` });
    // 枝
    for (const x of list) {
      const p = pos.get(x.id), pp = x.parent ? pos.get(x.parent) : null;
      if (!p || !pp) continue;
      const x1 = X(pp.x), y1 = Y(pp.d), x2 = X(p.x), y2 = Y(p.d);
      svg.appendChild(s('path', { d: `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`, fill: 'none', stroke: x.status === 'extinct' ? 'rgba(243,236,223,0.25)' : 'rgba(243,236,223,0.5)', 'stroke-width': 2, 'stroke-dasharray': x.status === 'extinct' ? '4 4' : '' }));
    }
    // 節
    for (const x of list) {
      const p = pos.get(x.id);
      if (!p) continue;
      const cx = X(p.x), cy = Y(p.d);
      const R = regionNow(this.g, x.region);
      const g = s('g', { style: 'cursor:pointer' });
      g.addEventListener('click', () => this.app.go('lab', { id: x.id }));
      const ext = x.status === 'extinct';
      g.appendChild(s('circle', { cx, cy, r: 16, fill: ext ? 'none' : hex(x.color), stroke: x.status === 'crisis' ? '#ef7b6b' : x.status === 'settled' ? '#f3ecdf' : 'rgba(243,236,223,0.4)', 'stroke-width': x.status === 'growing' ? 1.5 : 3, 'stroke-dasharray': ext ? '3 3' : '' }));
      g.appendChild(s('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', 'font-size': 14 }, R.icon));
      g.appendChild(s('text', { x: cx, y: cy + 34, 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': 700, fill: ext ? 'rgba(243,236,223,0.45)' : '#f3ecdf' }, x.name));
      g.appendChild(s('text', { x: cx, y: cy + 49, 'text-anchor': 'middle', 'font-size': 11, fill: 'rgba(180,182,196,0.9)' }, ext ? '絶滅' : x.record ? fmtM(x.record) : `第${x.gens}世代`));
      svg.appendChild(g);
    }
    return svg;
  }

  chronicle() {
    const box = h('div.chron');
    box.append(h('h3', { style: { margin: '8px 0 0', fontSize: '15px' } }, '年代記'));
    let era = -1;
    for (const e of this.g.chronicle) {
      if (e.era !== era) { era = e.era; box.append(h('div.era-h', eraName(era))); }
      box.append(h('div.ev.k-' + e.kind, e.text));
    }
    return box;
  }

  resize() {}
  frame() {}
  render() { this.app.renderer.setClearColor(0x0d1124, 1); this.app.renderer.clear(); }
}
