// 門番の頭の上に育つ「脳」。レンズ（入力）から線が生え、手法ごとに違う形になる
import { THREE, Beam, makeLabel, COL, mixDecision, colPass, colStop } from './util.js';
import { FEATS, hornCount } from '../game/rules.js';

const nodeGeo = new THREE.SphereGeometry(1, 16, 12);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const coneGeo = new THREE.ConeGeometry(0.7, 1.4, 6);
const KEY = new THREE.Color(COL.key), SLATE = new THREE.Color(COL.slate), FAINT = new THREE.Color('#aab4c8');
const TOP = 6.6, BASE = 4.5, HALF = 1.9; // 脳の上端・下端の高さと、横幅の半分

function condText(n) {
  if (n.f === 2) return `角 ${Math.floor(n.t * 4) + 1}本以上？`;
  return `${FEATS[n.f].name} > ${n.t.toFixed(2)}？`;
}

export class Brain {
  constructor(parent, lensPos) {
    this.root = new THREE.Group(); parent.add(this.root);
    this.lensPos = lensPos;
    this.beams = []; this.nodes = []; this.labels = [];
    this.model = null; this.x = null;
    this.out = this._node(nodeGeo, 0.26, new THREE.Vector3(0, TOP, 0), '#ccd3e0', true);
    this.outLabel = null;
  }
  _node(geo, r, pos, color, keep = false) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
    m.position.copy(pos); m.scale.setScalar(0.001); m.userData.r = r; m.userData.target = new THREE.Color(color); m.userData.delay = 0;
    m.layers.set(1); this.root.add(m);
    if (!keep) this.nodes.push(m);
    return m;
  }
  _beam(a, b, delay = 0) {
    const bm = new Beam(1).set(a, b); bm.delay = delay; this.root.add(bm.mesh); this.beams.push(bm); return bm;
  }
  _label(text, pos, opts) {
    const sp = makeLabel(text, opts); sp.position.copy(pos); sp.layers.set(1); this.root.add(sp); this.labels.push(sp); return sp;
  }
  clear() {
    for (const b of this.beams) { this.root.remove(b.mesh); b.dispose(); }
    for (const n of this.nodes) { this.root.remove(n); n.material.dispose(); }
    for (const l of this.labels) { this.root.remove(l); l.material.dispose(); }
    this.beams = []; this.nodes = []; this.labels = []; this.parts = null;
  }

  // model が変わったら作り直す。線は根元（レンズ）から生えてくる
  build(model, examples) {
    this.clear();
    this.model = model; this.examples = examples || [];
    this.out.scale.setScalar(0.001); this.out.userData.delay = 0.45;
    const L = this.lensPos, O = this.out.position;
    if (!model || model.empty) { this.parts = { kind: 'empty' }; this._setOut(model ? model.constant : 0, null); return; }
    const P = this.parts = { kind: model.kind };
    if (model.kind === 'linear') {
      P.lines = model.feats.map((f, j) => this._beam(L[f], O, j * 0.05));
    } else if (model.kind === 'nn') {
      const H = model.H;
      P.hid = []; P.l1 = []; P.l2 = [];
      for (let h = 0; h < H; h++) {
        const pos = new THREE.Vector3((h - (H - 1) / 2) * Math.min(0.8, 2 * HALF / H), BASE + 1.0, 0);
        const n = this._node(nodeGeo, 0.14, pos, '#ccd3e0'); n.userData.delay = 0.25; P.hid.push(n);
        P.l1.push(model.feats.map((f, j) => this._beam(L[f], pos, j * 0.03)));
        P.l2.push(this._beam(pos, O, 0.35));
      }
    } else if (model.kind === 'tree') {
      this._buildTree(model.root, P);
    } else if (model.kind === 'forest') {
      const T = model.trees.length;
      P.trees = [];
      for (let t = 0; t < T; t++) {
        const row = T > 9 ? (t % 2) : 0;
        const pos = new THREE.Vector3((t - (T - 1) / 2) * (2 * HALF / Math.max(T, 6)), BASE + 0.85 + row * 0.5, 0);
        const n = this._node(coneGeo, 0.16, pos, '#ccd3e0'); n.userData.delay = 0.2 + t * 0.02;
        const ins = model.used[t].map((f) => this._beam(L[f], pos, t * 0.02).style(0.01, FAINT, 0.55));
        P.trees.push({ n, ins, up: this._beam(pos, O, 0.4 + t * 0.02) });
      }
    } else if (model.kind === 'knn') {
      const hub = new THREE.Vector3(0, BASE + 0.1, 0);
      P.hubNode = this._node(boxGeo, 0.12, hub, COL.slate);
      P.ins = model.feats.map((f, j) => this._beam(L[f], hub, j * 0.04).style(0.014, SLATE, 0.7));
      const n = this.examples.length;
      P.orbs = this.examples.map((e, i) => {
        const row = n > 7 ? i % 2 : 0;
        const pos = new THREE.Vector3((i - (n - 1) / 2) * (2 * HALF / Math.max(n, 5)), BASE + 0.95 + row * 0.5, 0);
        const orb = this._node(nodeGeo, 0.13, pos, e.y ? COL.stop : COL.pass); orb.userData.delay = 0.2 + i * 0.03;
        return { orb, pos, y: e.y, to: this._beam(hub, pos, 0.2 + i * 0.03), up: this._beam(pos, O, 0.45) };
      });
    }
    this.focus(this.x);
  }
  _buildTree(root, P) {
    P.tnodes = [];
    let leaves = 0, maxD = 0;
    (function count(n, d) { maxD = Math.max(maxD, d); if (n.leaf) leaves++; else { count(n.lo, d + 1); count(n.hi, d + 1); } })(root, 0);
    const span = Math.min(2 * HALF, Math.max(1.6, leaves * 0.55));
    const dy = (TOP - 0.6 - (BASE + 0.3)) / Math.max(1, maxD);
    let li = 0;
    const place = (n, d) => {
      let x;
      if (n.leaf) x = leaves === 1 ? 0 : -span / 2 + (li++) * span / (leaves - 1);
      else { const a = place(n.lo, d + 1), b = place(n.hi, d + 1); x = (a + b) / 2; n._lo = a; n._hi = b; }
      n._pos = new THREE.Vector3(x, BASE + 0.3 + d * dy, 0); n._d = d;
      return x;
    };
    place(root, 0);
    const O = this.out.position;
    const make = (n) => {
      const rec = { n, d: n._d };
      if (n.leaf) {
        rec.mesh = this._node(nodeGeo, 0.11, n._pos, n.label ? COL.stop : COL.pass); rec.mesh.userData.delay = 0.15 + n._d * 0.15;
        rec.up = this._beam(n._pos, O, 0.3 + n._d * 0.15).style(0.006, FAINT, 0.0);
      } else {
        rec.mesh = this._node(boxGeo, 0.11, n._pos, COL.slate); rec.mesh.userData.delay = n._d * 0.15;
        rec.inp = this._beam(this.lensPos[n.f], n._pos, n._d * 0.15);
        rec.lo = this._beam(n._pos, n.lo._pos, 0.1 + n._d * 0.15);
        rec.hi = this._beam(n._pos, n.hi._pos, 0.1 + n._d * 0.15);
        rec.label = this._label(condText(n), n._pos.clone().add(new THREE.Vector3(0, -0.27, 0)), { size: 0.27, color: COL.ink });
        make(n.lo); make(n.hi);
      }
      n._rec = rec; P.tnodes.push(rec);
    };
    make(root);
  }

  _setOut(p, conf) {
    this.out.userData.target = mixDecision(p >= 0.5 ? 1 : 0);
    this.out.userData.r = 0.22 + Math.abs(p - 0.5) * 0.18;
    const stop = p >= 0.5;
    const pct = conf === null ? '' : ` ${Math.round((stop ? p : 1 - p) * 20) * 5}%`;
    const text = (stop ? '止める' : '通す') + pct;
    if (this.outText !== text) {
      if (this.outLabel) { this.root.remove(this.outLabel); this.outLabel.material.dispose(); }
      this.outLabel = makeLabel(text, { size: 0.4, color: '#fff', bg: stop ? COL.stop : COL.pass });
      this.outLabel.position.set(0, TOP + 0.55, 0); this.outLabel.layers.set(1);
      this.root.add(this.outLabel); this.outText = text;
    }
  }

  // 重みが変わった（ニューラルネットの学習中）ときに、形はそのままで太さだけ直す
  refresh() { this.focus(this.x); }

  // いま見ている訪問者 x に合わせて、線の太さ・色・光り方を決める
  focus(x) {
    this.x = x;
    const m = this.model, P = this.parts;
    if (!m || !P) return;
    const xx = x || new Array(6).fill(0.5);
    const p = m.predict(xx);
    if (P.kind === 'empty') { this._setOut(m.constant, null); return; }
    this._setOut(p, x ? p : null);
    if (P.kind === 'linear') {
      const mx = Math.max(1e-6, ...m.w.map(Math.abs));
      const ex = m.explain(xx);
      m.w.forEach((w, j) => {
        const act = x ? Math.min(1, Math.abs(ex.contrib[j]) / 2) : 0.4;
        P.lines[j].style(0.008 + 0.06 * Math.abs(w) / mx, w >= 0 ? colStop : colPass, 0.45 + 0.55 * act);
      });
    } else if (P.kind === 'nn') {
      const ex = m.explain(xx);
      let mx1 = 1e-6, mx2 = 1e-6;
      for (let h = 0; h < m.H; h++) { mx2 = Math.max(mx2, Math.abs(m.P.W2[h])); for (const w of m.P.W1[h]) mx1 = Math.max(mx1, Math.abs(w)); }
      for (let h = 0; h < m.H; h++) {
        const a = ex.a[h], on = x ? Math.abs(a) : 0.5;
        m.P.W1[h].forEach((w, j) => P.l1[h][j].style(0.004 + 0.034 * Math.abs(w) / mx1, w >= 0 ? colStop : colPass, 0.2 + 0.6 * on * Math.abs(w) / mx1 + 0.1));
        const w2 = m.P.W2[h];
        P.l2[h].style(0.006 + 0.045 * Math.abs(w2) / mx2, w2 * a >= 0 ? colStop : colPass, 0.3 + 0.7 * on);
        P.hid[h].userData.target = mixDecision((a + 1) / 2); P.hid[h].userData.r = 0.09 + 0.09 * on;
      }
    } else if (P.kind === 'tree') {
      const path = new Set(x ? m.explain(xx).path : []);
      for (const rec of P.tnodes) {
        const on = path.has(rec.n);
        if (rec.n.leaf) {
          rec.mesh.userData.r = on ? 0.17 : 0.1;
          rec.up.style(on ? 0.03 : 0.004, rec.n.label ? colStop : colPass, on ? 0.95 : 0.0);
        } else {
          rec.mesh.userData.r = on ? 0.14 : 0.1;
          rec.mesh.userData.target = on ? KEY : SLATE;
          rec.inp.style(on ? 0.028 : 0.009, on ? KEY : FAINT, on ? 0.95 : 0.5);
          const goHi = xx[rec.n.f] > rec.n.t;
          rec.lo.style(on && !goHi ? 0.03 : 0.01, on && !goHi ? KEY : SLATE, on && !goHi ? 1 : 0.5);
          rec.hi.style(on && goHi ? 0.03 : 0.01, on && goHi ? KEY : SLATE, on && goHi ? 1 : 0.5);
          rec.label.visible = on || rec.d === 0;
        }
      }
    } else if (P.kind === 'forest') {
      const v = m.explain(xx).votes;
      P.trees.forEach((t, i) => {
        t.n.userData.target = x ? (v[i] ? colStop : colPass) : FAINT;
        t.up.style(0.014, x ? (v[i] ? colStop : colPass) : FAINT, x ? 0.85 : 0.4);
      });
    } else if (P.kind === 'knn') {
      const near = x ? m.explain(xx).near : [];
      const map = new Map(near.map((o) => [o.i, o.d]));
      P.orbs.forEach((o, i) => {
        const on = map.has(i);
        o.orb.userData.r = on ? 0.19 : 0.11;
        o.to.style(on ? 0.035 : 0.006, on ? KEY : FAINT, on ? 0.95 : 0.4);
        o.up.style(on ? 0.03 : 0.004, o.y ? colStop : colPass, on ? 0.95 : 0.0);
      });
    }
  }

  update(dt) {
    for (const b of this.beams) b.update(dt);
    for (const n of [...this.nodes, this.out]) {
      const u = n.userData;
      if (u.delay > 0) { u.delay -= dt; continue; }
      const s = n.scale.x + (u.r - n.scale.x) * Math.min(1, dt * 9);
      n.scale.setScalar(s);
      n.material.color.lerp(u.target, Math.min(1, dt * 10));
    }
  }
}
export { hornCount };
