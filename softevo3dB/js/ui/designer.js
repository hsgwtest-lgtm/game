// 設計: 骨を組み、関節と筋肉を決める
//   骨をタップ → 選ぶ。白い玉: 終わりの位置（長さ・向き）。青い玉: つける場所。＋の玉: そこから新しい骨をのばす
//   選んだ骨の上からドラッグしても、その点から新しい骨がのびる
//   何もない所をドラッグ → 視点を回す。2本指 → 拡大
const THREE = window.THREE;
import { h, clear, gestures, toast, ask, confirmBox, modal, fmtM, hex } from './dom.js';
import { Stage } from '../render/scene.js';
import { CreatureView, lin } from '../render/creature.js';
import { poseOf } from '../render/planet.js';
import { snapshot } from '../render/snap.js';
import { compileModel, validateDesign, JOINT_TYPES, AXIS_NAME, MAX_BONES, normalizeLim, DEFAULT_LIM } from '../sim/model.js';
import { cloneDesign, grounded, sideOf } from '../sim/design.js';
import { TEMPLATES, templateByKey } from '../sim/templates.js';
import * as E from '../sim/edit.js';
import { Episode } from '../sim/sim.js';
import { geneCount } from '../sim/nerves.js';
import { REGIONS } from '../game/world.js';
import { bodyStats, suggestName, planName } from '../game/traits.js';
import { createSpecies, redesign, speciesById, regionNow, envFor, modelFor } from '../game/game.js';

const VIEWS = {
  free: { name: '自由', yaw: 0.75, pitch: 0.32, plane: null },
  side: { name: '横', yaw: 0, pitch: 0.02, plane: [0, 0, 1] },
  front: { name: '前', yaw: Math.PI / 2, pitch: 0.02, plane: [1, 0, 0] },
  top: { name: '上', yaw: 0, pitch: 1.38, plane: [0, 1, 0] },
};

export class DesignScreen {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.stage = new Stage(app.renderer);
    this.stage.setBiome('lab');
    this.stage.setTerrain('flat');
    // 方眼
    const grid = new THREE.GridHelper(4, 40, 0x6f86b0, 0x3b4a6a);
    grid.position.y = 0.001;
    grid.material.transparent = true; grid.material.opacity = 0.5;
    this.stage.scene.add(grid);
    this.grid = grid;
    // 左右の中心の面
    const mid = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ color: 0x6fd3e8, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }));
    mid.position.y = 1;
    this.mid = mid;
    this.stage.scene.add(mid);
    // 取っ手
    const hg = new THREE.SphereGeometry(1, 16, 12);
    this.hEnd = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 }));
    this.hStart = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: 0x6fd3e8, depthTest: false, transparent: true, opacity: 0.95 }));
    this.hGrow = new THREE.Group();
    const gb = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: 0xf2a65a, depthTest: false, transparent: true, opacity: 0.95 }));
    const plusMat = new THREE.MeshBasicMaterial({ color: 0x2a1606, depthTest: false });
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 0.25), plusMat), p2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.1, 0.25), plusMat);
    this.hGrow.add(gb, p1, p2);
    this.hGrowBall = gb;
    for (const m of [this.hEnd, this.hStart, this.hGrow]) { m.renderOrder = 10; m.visible = false; this.stage.scene.add(m); }
    p1.renderOrder = p2.renderOrder = 11;
    // のばし中の線
    this.ghostBone = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), new THREE.MeshBasicMaterial({ color: 0xf2a65a, transparent: true, opacity: 0.6, depthTest: false }));
    this.ghostBone.visible = false; this.ghostBone.renderOrder = 9;
    this.stage.scene.add(this.ghostBone);
    // 選んだ骨のふち
    this.selMat = new THREE.MeshBasicMaterial({ color: 0xf2a65a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.BackSide });
    this.selMesh = null;

    this.touch = h('div', { style: { position: 'absolute', inset: '0', touchAction: 'none' } });
    this.el.append(this.touch);
    this._bindTouch();
    this.top = h('div.topbar');
    this.tools = h('div.d-tools');
    this.hint = h('div.d-hint');
    this.sheet = h('div.sheet');
    this.el.append(this.top, this.tools, this.hint, this.sheet);
    this.view = 'free';
    this.mirror = true;
    this.showMode = 'muscle';
  }

  get g() { return this.app.game; }

  // params: { mode:'new'|'branch'|'edit', region, parent, id }
  enter(params) {
    this.params = params;
    this.mode = params.mode || 'new';
    this.region = params.region || 'plain';
    this.parentSp = params.parent ? speciesById(this.g, params.parent) : null;
    this.sp = params.id ? speciesById(this.g, params.id) : null;
    if (this.mode === 'edit' && this.sp) { this.design = cloneDesign(this.sp.design); this.region = this.sp.region; this.name = this.sp.name; }
    else if (this.mode === 'branch' && this.parentSp) { this.design = cloneDesign(this.parentSp.design); this.name = ''; }
    else { this.design = templateByKey(params.template || 'blank').build(); this.name = ''; }
    const R = regionNow(this.g, this.region);
    this.stage.setBiome(R.env.water ? 'sea' : 'lab');
    this.undoStack = []; this.redoStack = [];
    this.sel = null;
    this.testing = null;
    this.setView('free', true);
    this.rebuild(true);
    this.renderTop();
    this.renderTools();
    this.renderSheet();
    if (this.mode === 'new') setTimeout(() => this.pickTemplate(true), 250);
  }
  leave() { this.stopTest(); }

  // ── 設計図 → 表示 ──
  rebuild(fit = false) {
    let model;
    try { model = compileModel(this.design); } catch (e) { model = null; }
    if (!model) return;
    this.model = model;
    if (this.cv) { this.stage.actors.remove(this.cv.group); this.cv.dispose(); }
    const color = this.sp ? this.sp.color : this.parentSp ? this.parentSp.color : 0xd9a58c;
    this.cv = new CreatureView(model, { mode: this.showMode, color });
    this.cv.update(poseOf(model));
    this.stage.actors.add(this.cv.group);
    this._selOutline();
    this._handles();
    if (fit) {
      const s = Math.max(model.size.h, model.size.x, 0.25);
      this.stage.focus((model.size.minX + model.size.maxX) / 2, model.minY + model.size.h * 0.5, 0, true);
      this.stage.cam.distGoal = s * 2.6 + 0.4;
      this.stage.cam.dist = this.stage.cam.distGoal;
    }
    this.grid.position.y = 0.001;
    this.mid.scale.set(Math.max(1, model.size.x * 1.5), Math.max(1, model.size.h * 1.5), 1);
    this.mid.position.set((model.size.minX + model.size.maxX) / 2, model.size.h * 0.6, 0);
  }

  bodyIndex(id) { return this.model ? this.model.index.get(id) : undefined; }

  _selOutline() {
    if (this.selMesh) { this.stage.actors.remove(this.selMesh); this.selMesh.geometry.dispose(); this.selMesh = null; }
    if (!this.sel || !this.cv) return;
    const i = this.bodyIndex(this.sel);
    if (i === undefined) return;
    const src = this.cv.skin[i];
    this.selMesh = new THREE.Mesh(src.geometry.clone(), this.selMat);
    this.selMesh.position.copy(src.position); this.selMesh.quaternion.copy(src.quaternion);
    this.selMesh.scale.setScalar(1.18);
    this.stage.actors.add(this.selMesh);
  }

  _handles() {
    const b = this.sel ? E.byId(this.design, this.sel) : null;
    const size = this.model ? Math.max(this.model.size.h, this.model.size.x, 0.2) : 0.5;
    const hr = Math.max(0.012, Math.min(0.04, size * 0.035));
    for (const m of [this.hEnd, this.hStart, this.hGrow]) m.visible = !!b && !this.testing;
    if (!b || this.testing) return;
    this.hEnd.position.set(...b.b); this.hEnd.scale.setScalar(hr);
    this.hStart.position.set(...(b.j || b.a)); this.hStart.scale.setScalar(hr * 0.85);
    const dir = new THREE.Vector3(...b.b).sub(new THREE.Vector3(...b.a));
    if (dir.length() < 1e-4) dir.set(0, -1, 0);
    dir.normalize();
    this.hGrow.position.set(b.b[0] + dir.x * hr * 3.2, b.b[1] + dir.y * hr * 3.2, b.b[2] + dir.z * hr * 3.2);
    this.hGrow.scale.setScalar(hr * 0.9);
    this.hGrow.quaternion.copy(this.stage.camera.quaternion);
  }

  // ── 操作 ──
  _ndc(e) { return new THREE.Vector2((e.clientX / this.app.size.w) * 2 - 1, -(e.clientY / this.app.size.h) * 2 + 1); }
  _ray(e) { const r = new THREE.Raycaster(); r.setFromCamera(this._ndc(e), this.stage.camera); return r; }
  _planeAt(p) {
    const v = VIEWS[this.view];
    const n = v.plane ? new THREE.Vector3(...v.plane) : this.stage.camera.getWorldDirection(new THREE.Vector3()).negate();
    return new THREE.Plane().setFromNormalAndCoplanarPoint(n, p);
  }
  _hitPlane(e, plane) { const out = new THREE.Vector3(); return this._ray(e).ray.intersectPlane(plane, out) ? out : null; }

  _bindTouch() {
    let drag = null;
    const el = this.touch;
    el.addEventListener('pointerdown', (e) => {
      if (this.testing) return;
      drag = null;
      const ray = this._ray(e);
      const b = this.sel ? E.byId(this.design, this.sel) : null;
      if (b) {
        const hits = ray.intersectObjects([this.hEnd, this.hStart, this.hGrowBall], false);
        if (hits.length) {
          const o = hits[0].object;
          const kind = o === this.hEnd ? 'end' : o === this.hStart ? 'start' : 'grow';
          const p0 = kind === 'start' ? new THREE.Vector3(...(b.j || b.a)) : new THREE.Vector3(...b.b);
          drag = { kind, plane: this._planeAt(p0), from: kind === 'grow' ? b.b.slice() : null, pushed: false };
          return;
        }
        // 選んだ骨の上から → その点から新しい骨
        const i = this.bodyIndex(b.id);
        const hit = i !== undefined ? ray.intersectObject(this.cv.skin[i], false)[0] : null;
        if (hit) {
          const a = new THREE.Vector3(...b.a), bb = new THREE.Vector3(...b.b);
          const ab = bb.clone().sub(a);
          const t = Math.max(0, Math.min(1, hit.point.clone().sub(a).dot(ab) / Math.max(1e-9, ab.lengthSq())));
          const onAxis = a.clone().addScaledVector(ab, t);
          // 表面の点（軸から当たった点の向きへ、太さぶん）
          const off = hit.point.clone().sub(onAxis);
          const rr = b.shape === 'box' ? Math.max(b.r, (b.w || 0) / 2) : b.r;
          if (off.length() > rr) off.setLength(rr);
          const from = onAxis.add(off);
          drag = { kind: 'grow', plane: this._planeAt(from), from: [from.x, from.y, from.z], onBone: true, startX: e.clientX, startY: e.clientY };
          return;
        }
      }
    });
    gestures(el, {
      onDrag: (dx, dy, e) => {
        if (this.testing) { this.stage.orbit(-dx * 0.008, dy * 0.006); return; }
        if (drag) { this._dragMove(drag, e); return; }
        this.stage.orbit(-dx * 0.008, dy * 0.006);
        if (this.view !== 'free' && Math.abs(dx) + Math.abs(dy) > 3) { this.view = 'free'; this.renderTools(); }
      },
      onPinch: (f) => this.stage.zoom(f),
      onTap: (e) => { if (!drag || drag.onBone) this._tap(e); drag = null; },
      onUp: (e, moved) => { if (drag && moved) this._dragEnd(drag); drag = null; this.ghostBone.visible = false; },
    });
  }

  _tap(e) {
    if (this.testing) return;
    const ray = this._ray(e);
    const hits = this.cv ? ray.intersectObjects(this.cv.skin, false) : [];
    if (hits.length) {
      const i = this.cv.skin.indexOf(hits[0].object);
      this.select(this.model.bodies[i].id);
    } else this.select(null);
  }

  _dragMove(drag, e) {
    const p = this._hitPlane(e, drag.plane);
    if (!p) return;
    const P = [p.x, Math.max(0.002, p.y), p.z];
    if (drag.kind === 'grow') {
      const f = new THREE.Vector3(...drag.from), t = new THREE.Vector3(...P);
      const L = f.distanceTo(t);
      drag.to = P;
      const gb = this.ghostBone;
      gb.visible = L > 0.01;
      gb.position.copy(f).add(t).multiplyScalar(0.5);
      gb.scale.set(0.008, L, 0.008);
      gb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.clone().sub(f).normalize());
      return;
    }
    if (!drag.pushed) { this.pushUndo(); drag.pushed = true; }
    if (drag.kind === 'end') E.moveEnd(this.design, this.sel, P, this.mirror);
    else E.moveStart(this.design, this.sel, P, this.mirror);
    this._rebuildSoon();
  }

  _dragEnd(drag) {
    if (drag.kind === 'grow' && drag.to) {
      const L = Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1], drag.to[2] - drag.from[2]);
      if (L < 0.015) return;
      if (this.design.bones.length >= MAX_BONES) { toast(`骨は ${MAX_BONES}本まで`, { kind: 'bad' }); return; }
      this.pushUndo();
      const nb = E.addBone(this.design, this.sel, drag.from, drag.to, { mirror: this.mirror });
      if (nb) { this.commit(); this.select(nb.id); toast(nb.mirror ? '左右に骨がのびた' : '骨がのびた'); }
      return;
    }
    if (drag.pushed) this.commit();
  }

  _rebuildSoon() {
    if (this._rb) return;
    this._rb = requestAnimationFrame(() => { this._rb = 0; this.rebuild(); });
  }

  select(id) {
    this.sel = id;
    this._selOutline();
    this._handles();
    this.renderSheet();
  }

  pushUndo() {
    this.undoStack.push(JSON.stringify(this.design));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
    this.renderTools();
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(this.undoStack.pop());
    if (this.sel && !E.byId(this.design, this.sel)) this.sel = null;
    this.commit(false);
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(this.redoStack.pop());
    if (this.sel && !E.byId(this.design, this.sel)) this.sel = null;
    this.commit(false);
  }
  // 編集のあと: 地面に合わせ、表示と画面を更新
  commit(regrounding = true) {
    if (regrounding) { try { grounded(this.design); } catch (e) { /* 組めない設計 */ } }
    this.rebuild();
    this.renderTools();
    this.renderSheet();
  }

  setView(v, snap = false) {
    this.view = v;
    const V = VIEWS[v];
    this.stage.setView(V.yaw, V.pitch, null, snap);
    this.renderTools();
  }

  // ── 上の帯・道具 ──
  renderTop() {
    const R = regionNow(this.g, this.region);
    const title = this.mode === 'edit' ? '体を作りかえる' : this.mode === 'branch' ? `${R.name}へ枝分かれ` : `${R.name}で生まれる`;
    clear(this.top).append(
      h('button.iconbtn', { 'aria-label': 'もどる', onclick: () => this.back() }, '←'),
      h('div.grow', h('div.title', title), h('div.sub', this.parentSp ? `親: 『${this.parentSp.name}』` : `${R.icon} ${R.name}`)),
      h('button.btn.primary', { onclick: () => this.finish() }, this.mode === 'edit' ? '決定' : '誕生させる'),
    );
  }
  renderTools() {
    const seg = h('div.seg', Object.entries(VIEWS).map(([k, v]) => h('button' + (this.view === k ? '.on' : ''), { onclick: () => this.setView(k) }, v.name)));
    const show = h('div.seg', [['skin', '肌'], ['muscle', '筋肉'], ['bone', '骨']].map(([k, n]) => h('button' + (this.showMode === k ? '.on' : ''), { onclick: () => { this.showMode = k; this.rebuild(); this.renderTools(); } }, n)));
    clear(this.tools).append(seg,
      h('button.iconbtn' + (this.mirror ? '.on' : ''), { title: '左右対称', 'aria-label': '左右対称', onclick: () => { this.mirror = !this.mirror; this.renderTools(); toast(this.mirror ? '左右対称: オン' : '左右対称: オフ'); } }, '⇋'),
      h('button.iconbtn', { 'aria-label': '元に戻す', disabled: !this.undoStack.length, onclick: () => this.undo() }, '↶'),
      h('button.iconbtn', { 'aria-label': 'やり直す', disabled: !this.redoStack.length, onclick: () => this.redo() }, '↷'),
      show,
    );
    this.hint.style.top = `calc(${(this.tools.offsetTop || 100) + (this.tools.offsetHeight || 44) + 6}px)`;
    this.hint.textContent = this.testing ? '' : this.sel ? '白い玉: 長さと向き　青い玉: つける場所　＋や骨の上からドラッグ: 新しい骨' : '骨をタップして選ぶ';
  }

  // ── 下のパネル ──
  renderSheet() {
    const s = clear(this.sheet);
    s.appendChild(h('div.grip'));
    if (this.testing) return this.renderTestSheet();
    const d = this.design;
    const problems = validateDesign(d);
    const st = this.model ? bodyStats(this.model) : null;
    if (!this.sel) {
      s.append(h('div.row.between',
        h('h2', this.name || (this.model ? suggestName(this.model, REGIONS[this.region].env.water ? 'water' : 'land', 3) : '')),
        h('button.btn.small', { onclick: () => this.rename() }, '名前')));
      if (st) {
        s.append(h('div.row.wrap',
          h('span.chip', planName(st)), h('span.chip.num', `骨 ${st.bones}/${MAX_BONES}`), h('span.chip.num', `関節 ${st.joints}`),
          h('span.chip.num', `筋肉 ${st.muscles}`), h('span.chip.num', `${this.model.mass.toFixed(1)}kg`), h('span.chip.num', `高さ ${fmtM(st.H)}`)));
      }
      if (problems.length) s.append(h('p.problems', problems.join(' / ')));
      s.append(h('p', '骨をタップして選ぶと、形と関節を変えられる。筋肉は関節ごとに自動でつく。'));
      s.append(h('div.row.wrap', { style: { marginTop: '8px' } },
        h('button.btn', { onclick: () => this.pickTemplate(false) }, '見本から'),
        h('button.btn', { onclick: () => this.startTest() }, '▶ ためしに置く'),
      ));
      return;
    }
    const b = E.byId(d, this.sel);
    if (!b) { this.sel = null; return this.renderSheet(); }
    const isRoot = !b.parent;
    const side = sideOf(b);
    s.append(h('div.row.between',
      h('h2', b.name || '骨', side ? h('span.chip.dim', side > 0 ? '右' : '左') : null, b.mirror ? h('span.chip.dim', '対') : null, isRoot ? h('span.chip.dim', '胴（根もと）') : null),
      h('button.iconbtn', { 'aria-label': '選ぶのをやめる', onclick: () => this.select(null) }, '×')));
    const slider = (label, min, max, step, val, fmt, on) => {
      const out = h('output', fmt(val));
      const inp = h('input', { type: 'range', min, max, step, value: val });
      let pushed = false;
      inp.addEventListener('input', () => { if (!pushed) { this.pushUndo(); pushed = true; } const v = +inp.value; out.textContent = fmt(v); on(v); this._rebuildSoon(); });
      inp.addEventListener('change', () => { pushed = false; this.commit(); });
      return h('div.field', h('label', label), inp, out);
    };
    const cm = (v) => `${(v * 100).toFixed(1)}cm`;
    s.append(
      slider('長さ', 0.01, 1.2, 0.005, E.boneLength(b), cm, (v) => E.setLength(d, b.id, v, this.mirror)),
      slider('太さ', 0.008, 0.2, 0.002, b.r, cm, (v) => E.setBone(d, b.id, { r: v }, this.mirror)),
      slider('重さ', 0.3, 3, 0.05, b.dens || 1, (v) => `×${v.toFixed(2)}`, (v) => E.setBone(d, b.id, { dens: v }, this.mirror)),
    );
    s.append(h('div.row', { style: { margin: '4px 0 8px' } },
      h('span.muted', '形'),
      h('div.seg', [['capsule', '丸'], ['box', '板']].map(([k, n]) => h('button' + ((b.shape || 'capsule') === k ? '.on' : ''), { onclick: () => { this.pushUndo(); E.setBone(d, b.id, { shape: k, w: k === 'box' ? Math.max(b.r * 3, 0.04) : undefined }, this.mirror); this.commit(); } }, n))),
      b.shape === 'box' ? h('div.grow') : null,
    ));
    if (b.shape === 'box') s.append(slider('はば', 0.016, 0.5, 0.004, b.w || 0.08, cm, (v) => E.setBone(d, b.id, { w: v }, this.mirror)));
    if (!isRoot) {
      const jt = (b.joint && b.joint.type) || 'hinge';
      s.append(h('h3', '関節'));
      s.append(h('div.jtypes', Object.entries(JOINT_TYPES).map(([k, J]) => h('button.jtype' + (jt === k ? '.on' : ''), {
        onclick: () => { this.pushUndo(); E.setBone(d, b.id, { joint: { type: k, lim: DEFAULT_LIM[k].map(x => x.slice()) } }, this.mirror); this.commit(); },
      }, h('b', J.name), J.desc.split('（')[0]))));
      const lim = normalizeLim(jt, b.joint && b.joint.lim);
      const n = JOINT_TYPES[jt].n;
      for (let k = 0; k < n; k++) {
        const cap = k === 1 ? 80 : 175;
        s.append(h('div.muted', { style: { marginTop: '6px' } }, `${AXIS_NAME[k]}の範囲`));
        s.append(slider('一方', 0, cap, 1, -lim[k][0], (v) => `${Math.round(v)}°`, (v) => { const L = normalizeLim(jt, b.joint.lim); L[k][0] = -v; E.setBone(d, b.id, { joint: { lim: L } }, this.mirror); }));
        s.append(slider('他方', 0, cap, 1, lim[k][1], (v) => `${Math.round(v)}°`, (v) => { const L = normalizeLim(jt, b.joint.lim); L[k][1] = v; E.setBone(d, b.id, { joint: { lim: L } }, this.mirror); }));
      }
      if (jt !== 'fixed') s.append(slider('筋力', 0.3, 4, 0.05, (b.joint && b.joint.str) || 1, (v) => `×${v.toFixed(2)}`, (v) => E.setBone(d, b.id, { joint: { str: v } }, this.mirror)));
    }
    // 2関節筋（ふたつの関節をまたぐ筋肉: 太ももの裏の筋肉のように、つけ根とひざを同時に動かす）
    const par = b.parent ? E.byId(d, b.parent) : null;
    if (par && par.parent) {
      const extra = (d.muscles && d.muscles.extra) || [];
      const mine = extra.filter(x => x.to === b.id);
      const add = (side) => {
        this.pushUndo();
        d.muscles = d.muscles || {};
        d.muscles.extra = (d.muscles.extra || []).slice();
        const id = `m${Date.now().toString(36)}${side > 0 ? 'f' : 'b'}`;
        d.muscles.extra.push({ id, name: `${b.name || '骨'}の2関節筋`, from: par.parent, to: b.id, sides: [side, side], f: 0.8 });
        // 左右の相方にも
        if (this.mirror && b.mirror) {
          const mb = E.byId(d, b.mirror);
          const mp = mb && mb.parent ? E.byId(d, mb.parent) : null;
          if (mb && mp && mp.parent) d.muscles.extra.push({ id: id + 'm', name: `${mb.name || '骨'}の2関節筋`, from: mp.parent, to: mb.id, sides: [side, side], f: 0.8 });
        }
        this.commit(false);
      };
      s.append(h('h3', '2関節筋'),
        h('p.muted', 'ひとつ上の関節もまたぐ筋肉。ふたつの関節をいっしょに動かせる。'),
        h('div.row.wrap',
          mine.map(x => h('button.btn.small', { onclick: () => { this.pushUndo(); d.muscles.extra = d.muscles.extra.filter(y => y.id !== x.id && y.id !== x.id + 'm'); this.commit(false); } }, `${x.sides && x.sides[0] < 0 ? '後ろ' : '前'}の2関節筋 ×`)),
          mine.length < 2 ? h('button.btn.small', { onclick: () => add(1) }, '＋前') : null,
          mine.length < 2 ? h('button.btn.small', { onclick: () => add(-1) }, '＋後ろ') : null));
    }
    const sense = this.model && this.model.bodies[this.model.sense].id === b.id;
    s.append(h('div.row.wrap', { style: { marginTop: '10px' } },
      !isRoot ? h('button.btn.danger.small', { onclick: () => { this.pushUndo(); E.deleteBone(d, b.id, this.mirror); this.sel = null; this.commit(); } }, 'この骨を消す') : null,
      side && !b.mirror ? h('button.btn.small', { onclick: () => { this.pushUndo(); E.makeMirror(d, b.id); this.commit(); } }, '反対側にも作る') : null,
      h('button.btn.small', { onclick: () => this.rename(b) }, '名前'),
      sense ? h('span.chip.good', '平衡感覚がある') : h('button.btn.small', { onclick: () => { this.pushUndo(); E.setSense(d, b.id); this.commit(); toast('平衡感覚をこの骨に置いた'); } }, '平衡感覚をここに'),
    ));
  }

  async rename(b = null) {
    if (b) {
      const v = await ask('骨の名前', b.name || '', { max: 10 });
      if (v) { this.pushUndo(); b.name = v; this.commit(false); }
      return;
    }
    const v = await ask('種の名前', this.name || (this.model ? suggestName(this.model) : ''), { max: 12 });
    if (v) { this.name = v; this.renderSheet(); }
  }

  async pickTemplate(first) {
    const items = TEMPLATES.map(t => {
      let url = '';
      try { url = snapshot(this.app.renderer, compileModel(t.build()), { key: 'tpl:' + t.key }); } catch (e) { /* */ }
      return h('button.tpl', { onclick: () => box._close(t.key) }, url ? h('img', { src: url, alt: '' }) : null, h('b', t.name), h('span.muted', { style: { fontSize: '11px', textAlign: 'center' } }, t.desc));
    });
    const body = h('div', h('p', first ? 'どこから組みはじめますか。見本はただの出発点。骨を足しても、消しても、形を変えてもよい。' : '見本にするとき、いまの設計は消えます。'), h('div.tpls', items));
    const p = modal({ title: '見本', body, actions: first ? [] : [{ label: 'やめる', value: null }] });
    const box = document.querySelector('.modal-wrap:last-child .modal');
    const key = await p;
    if (!key) return;
    this.pushUndo();
    this.design = templateByKey(key).build();
    this.sel = null;
    this.rebuild(true);
    this.renderTools();
    this.renderSheet();
  }

  // ── ためしに置く（神経はまだ何も覚えていない＝姿勢を保つだけ）──
  startTest() {
    if (!this.model) return;
    const env = envFor(this.g, this.region, { T: 30, assist: 0 });
    this.testing = { ep: new Episode(this.model, new Float64Array(geneCount(this.model)), env), env };
    this.stage.setTerrain(env.terrain, this.testing.ep.terrain.waterLevel || (env.water ? this.model.size.h + 0.6 : null));
    this.grid.visible = false; this.mid.visible = false;
    this._handles();
    if (this.selMesh) this.selMesh.visible = false;
    this.renderTools();
    this.renderSheet();
  }
  stopTest() {
    if (!this.testing) return;
    this.testing = null;
    this.stage.setTerrain('flat');
    this.grid.visible = true; this.mid.visible = true;
    if (this.cv && this.model) this.cv.update(poseOf(this.model));
    if (this.selMesh) this.selMesh.visible = true;
    this._handles();
    this.renderTools();
    this.renderSheet();
  }
  renderTestSheet() {
    const box = this.sheet;
    this.testInfo = h('p.num', '');
    box.append(h('h2', 'ためしに置いてみる'),
      h('p', 'まだ何も覚えていない神経。生まれつきの反射（姿勢を保つ・足ぶみ・立ち直り）だけで動いている。すぐ崩れるなら、骨を太く・関節の筋力を強く・足を広く。'),
      this.testInfo,
      h('div.row', h('button.btn', { onclick: () => { this.testing.ep = new Episode(this.model, new Float64Array(geneCount(this.model)), this.testing.env); } }, 'もう一度'), h('button.btn.primary', { onclick: () => this.stopTest() }, '設計にもどる')));
  }

  async back() {
    if (this.undoStack.length && !(await confirmBox('設計をやめる', 'いまの設計は保存されません。もどりますか。', 'もどる', 'danger'))) return;
    if (this.mode === 'edit' && this.sp) this.app.go('lab', { id: this.sp.id });
    else this.app.go('home', { region: this.region });
  }

  async finish() {
    const problems = validateDesign(this.design);
    if (problems.length) { toast(problems[0], { kind: 'bad' }); return; }
    let model;
    try { model = compileModel(this.design); } catch (e) { toast(String(e.message || e), { kind: 'bad' }); return; }
    if (model.nDof === 0) {
      const ok = await confirmBox('動ける関節がありません', '関節がないと、筋肉がつかず動けません。このまま誕生させますか。', '誕生させる');
      if (!ok) return;
    }
    const g = this.g;
    if (this.mode === 'edit' && this.sp) {
      redesign(g, this.sp, this.design);
      if (this.name) this.sp.name = this.name;
      this.app.save();
      this.app.go('lab', { id: this.sp.id, fresh: true });
      return;
    }
    const sp = createSpecies(g, { design: this.design, region: this.region, parent: this.mode === 'branch' ? this.parentSp : null, name: this.name });
    this.app.save();
    this.app.go('lab', { id: sp.id, fresh: true });
  }

  resize(w, hh) {
    const sh = Math.min(this.sheet.offsetHeight || 0, hh * 0.62);
    const top = (this.tools.offsetTop || 0) + (this.tools.offsetHeight || 0);
    this.stage.resize(w, hh, { top, bottom: sh });
  }

  frame(dt) {
    if (this.testing) {
      const ep = this.testing.ep;
      let n = Math.max(1, Math.round(dt * 60));
      while (n-- > 0 && !ep.done) ep.step();
      this.cv.update(ep.c);
      const com = ep.nerves.com;
      this.stage.focus(com[0], Math.max(0.1, com[1]), com[2]);
      if (this.testInfo) this.testInfo.textContent = `${ep.t.toFixed(1)}秒　${ep.fell ? '倒れた' : '倒れていない'}　傾き ${(ep.nerves.tilt * 57.3).toFixed(0)}°`;
    }
    if (this.hGrow.visible) this.hGrow.quaternion.copy(this.stage.camera.quaternion);
    this.stage.update(dt);
    // パネルの高さが変わったら投影を合わせる
    const sh = this.sheet.offsetHeight;
    if (sh !== this._lastSh) { this._lastSh = sh; this.resize(this.app.size.w, this.app.size.h); }
  }
  render() { this.stage.render(); }
}
