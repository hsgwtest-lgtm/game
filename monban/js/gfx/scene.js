// 3Dの舞台: 門・門番・レンズ・脳・訪問者。門番の目から見た小窓も描く
import { THREE, Beam, makeLabel, markTexture, COL, colPass, colStop } from './util.js';
import { Visitor } from './visitor.js';
import { Brain } from './brain.js';
import { FEATS, hornCount } from '../game/rules.js';

const GK = new THREE.Vector3(0, 0, -1.4);          // 門番の立ち位置
const KS = 1.3;                                    // 門番の大きさ
const EYE = new THREE.Vector3(0, 1.78 * KS, GK.z + 0.5 * KS); // 目の位置
const LENS_Y = 3.8;
const JUDGE = new THREE.Vector3(0, 0, 1.9);        // 本番で訪問者が止まって見られる場所
const KEY = new THREE.Color(COL.key);
// 何度も作り直すものは形を使い回す（夜勤で門を重ねても重くならないように）
const discGeo = new THREE.RingGeometry(0.34, 0.5, 28).rotateX(-Math.PI / 2);
const pickGeo = new THREE.TorusGeometry(0.58, 0.05, 8, 32).rotateX(Math.PI / 2);
const lensRingGeo = new THREE.TorusGeometry(0.3, 0.04, 8, 28);
const lensGlassGeo = new THREE.CircleGeometry(0.3, 24), lensFillGeo = new THREE.CircleGeometry(0.285, 24);
function disposeSprites(group) { group.traverse((o) => { if (o.isSprite) o.material.dispose(); }); }

export class Stage3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.autoClear = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e9f0fb');
    this.scene.fog = new THREE.Fog('#e9f0fb', 22, 42);
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    this.cam.layers.enable(1);
    this.eyeCam = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
    this.eyeRect = null;
    this._lights(); this._ground(); this._gate(); this._keeper();

    this.lensGroup = new THREE.Group(); this.scene.add(this.lensGroup);
    this.lensPos = FEATS.map(() => new THREE.Vector3(0, LENS_Y, GK.z));
    this.lenses = [];
    this.brain = new Brain(this.scene, this.lensPos);
    this.brain.root.position.z = GK.z;
    for (const p of this.lensPos) p.z = 0; // 脳の中では門番の真上を原点にする

    // 視野（目から見ている相手へ伸びる円すい）
    const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0).rotateX(Math.PI); // 頂点が原点、+y に広がる
    this.cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    this.cone.layers.set(1); this.cone.visible = false; this.scene.add(this.cone);

    this.pool = []; this.walkers = [];
    this.focusX = null; this.focusPos = new THREE.Vector3(0, 0.5, 2.5); this.lookPos = this.focusPos.clone();
    this.run = null; this.time = 0;
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.resize();
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b9c4d6', 2.1));
    const d = new THREE.DirectionalLight('#fff4e0', 2.2); d.position.set(4, 9, 6); this.scene.add(d);
  }
  _ground() {
    const g = new THREE.Mesh(new THREE.CircleGeometry(30, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#dfe6f1', roughness: 1 }));
    this.scene.add(g);
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 7.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f4f6fa', roughness: 1 }));
    plaza.position.set(0, 0.004, 3.6); this.scene.add(plaza);
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e3e9f4', roughness: 1 }));
    lane.position.set(0, 0.008, 4.2); this.lane = lane; lane.visible = false; this.scene.add(lane);
  }
  _gate() {
    const stone = new THREE.MeshStandardMaterial({ color: '#a9b4c8', roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: '#8793ab', roughness: 0.9 });
    const wallL = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.5, 0.5), stone); wallL.position.set(-1.6, 0.75, -3.0); this.scene.add(wallL);
    const wallR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.5), stone); wallR.position.set(4.0, 0.75, -3.0); this.scene.add(wallR);
    for (const x of [1.3, 3.3]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.2, 0.62), dark); p.position.set(x, 1.1, -3.0); this.scene.add(p); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.34, 0.62), dark); top.position.set(2.3, 2.36, -3.0); this.scene.add(top);
    // 開け閉めする横木
    this.bar = new THREE.Group(); this.bar.position.set(1.52, 0.9, -2.6);
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 0.14), new THREE.MeshStandardMaterial({ color: COL.stop, roughness: 0.5 }));
    b.position.x = 0.85; this.bar.add(b); this.scene.add(this.bar);
    this.barOpen = 0; this.barTarget = 0;
  }
  _keeper() {
    const g = this.keeper = new THREE.Group(); g.position.copy(GK); g.scale.setScalar(KS);
    const stone = new THREE.MeshStandardMaterial({ color: '#6f7fa3', roughness: 0.75 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.6, 1.25, 16), stone); body.position.y = 0.63; g.add(body);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.58, 0.14, 16), new THREE.MeshStandardMaterial({ color: '#e7b93c', roughness: 0.5 })); belt.position.y = 0.42; g.add(belt);
    this.head = new THREE.Group(); this.head.position.y = 1.78; g.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), stone); this.head.add(skull);
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 })); white.position.z = 0.3; this.head.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshBasicMaterial({ color: '#10224f' })); pupil.position.z = 0.52; this.head.add(pupil);
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 8), new THREE.MeshStandardMaterial({ color: '#e7b93c', roughness: 0.5 })); crest.position.y = 0.6; this.head.add(crest);
    this.scene.add(g);
  }

  resize() {
    const w = this.canvas.clientWidth || 390, h = this.canvas.clientHeight || 600;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    // 横幅 7.6 が収まる距離まで下がる（縦長の画面でも列が切れない）
    const need = 7.2;
    const vfov = (this.cam.fov * Math.PI) / 180;
    const dist = Math.max(15.5, (need / 2) / (Math.tan(vfov / 2) * this.cam.aspect));
    const target = new THREE.Vector3(0, 3.55, 1.6);
    const dir = new THREE.Vector3(0, 0.5, 1).normalize();
    this.cam.position.copy(target).addScaledVector(dir, dist);
    this.cam.lookAt(target);
    this.cam.updateProjectionMatrix();
  }
  setEyeRect(rect) { this.eyeRect = rect; }

  // ── レンズ（門番が見られる特徴）
  setLenses(avail, active) {
    const key = avail.join(',');
    if (this._lensKey !== key) {
      this._lensKey = key;
      for (const l of this.lenses) { this.lensGroup.remove(l.g); l.g.traverse((o) => { if (o.material) o.material.dispose(); }); }
      this.lenses = [];
      const n = avail.length, gap = Math.min(0.95, 4.3 / Math.max(n, 2));
      avail.forEach((f, j) => {
        const x = (j - (n - 1) / 2) * gap;
        this.lensPos[f].set(x, LENS_Y, 0);
        const g = new THREE.Group(); g.position.set(x, LENS_Y, GK.z);
        const ring = new THREE.Mesh(lensRingGeo, new THREE.MeshBasicMaterial({ color: COL.key })); g.add(ring);
        const glass = new THREE.Mesh(lensGlassGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75 })); g.add(glass);
        const fill = new THREE.Mesh(lensFillGeo, new THREE.MeshBasicMaterial({ color: COL.key, transparent: true, opacity: 0.85 })); fill.position.z = 0.005; g.add(fill);
        const label = makeLabel(FEATS[f].name, { size: 0.3, color: COL.ink }); label.position.set(0, -0.5, 0.02); g.add(label);
        g.traverse((o) => o.layers.set(1));
        this.lensGroup.add(g);
        const beam = new Beam(1).set(EYE, new THREE.Vector3(x, LENS_Y - 0.3, GK.z)).style(0.012, KEY, 0.5);
        this.scene.add(beam.mesh);
        this.lenses.push({ f, g, ring, glass, fill, label, beam, on: true });
      });
      // 古い光線を片づける
      (this._oldBeams || []).forEach((b) => { this.scene.remove(b.mesh); b.dispose(); });
      this._oldBeams = this.lenses.map((l) => l.beam);
    }
    for (const l of this.lenses) {
      l.on = active.includes(l.f);
      l.ring.material.color.set(l.on ? COL.key : '#b4bccb');
      l.fill.visible = l.on;
      l.label.material.opacity = l.on ? 1 : 0.45;
      l.beam.style(0.012, KEY, l.on ? 0.5 : 0.0);
    }
    this._lensValues();
  }
  _lensValues() {
    for (const l of this.lenses) {
      const v = this.focusX ? this.focusX[l.f] : 0;
      l.fill.scale.setScalar(Math.max(0.06, Math.sqrt(v)));
    }
  }

  // ── 見本の列
  setPool(pool) {
    this.clearCrowd();
    const n = pool.length, cols = n <= 12 ? 4 : 5, rows = Math.ceil(n / cols);
    const gx = cols === 4 ? 1.55 : 1.32, gz = rows >= 4 ? 1.32 : 1.6;
    pool.forEach((c, i) => {
      const row = Math.floor(i / cols), col = i % cols;
      const inRow = Math.min(cols, n - row * cols);
      const v = new Visitor(c.x);
      v.group.position.set((col - (inRow - 1) / 2) * gx, 0, 1.2 + row * gz);
      v.group.scale.setScalar(rows >= 4 ? 0.74 : 0.86);
      this.scene.add(v.group);
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTexture(c.badge ? 'stop' : 'pass'), depthTest: false, transparent: true }));
      badge.scale.setScalar(0.36); badge.position.y = v.top + 0.2; badge.renderOrder = 10; badge.layers.set(1); v.group.add(badge);
      const disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: COL.pass, transparent: true, opacity: 0.0, depthWrite: false }));
      disc.position.y = 0.02; disc.layers.set(1); v.group.add(disc);
      const pick = new THREE.Mesh(pickGeo, new THREE.MeshBasicMaterial({ color: COL.key }));
      pick.position.y = 0.05; pick.visible = false; pick.layers.set(1); v.group.add(pick);
      const flag = makeLabel('見本', { size: 0.2, color: '#fff', bg: COL.key }); flag.position.y = v.top + 0.52; flag.visible = false; flag.layers.set(1); v.group.add(flag);
      const miss = makeLabel('？', { size: 0.26, color: COL.ink, bg: COL.warn }); miss.position.set(0.34, v.top + 0.2, 0); miss.visible = false; miss.layers.set(1); v.group.add(miss);
      this.pool.push({ v, badge, disc, pick, flag, miss, c });
    });
    this.lane.visible = false;
  }
  // picks: 見本にした番号 / preds: 門番のいまの答え（null なら未学習）
  setPoolState(picks, preds) {
    this.pool.forEach((p, i) => {
      const on = picks.includes(i);
      p.pick.visible = on; p.flag.visible = on;
      p.badge.scale.setScalar(on ? 0.46 : 0.36);
      if (preds) {
        p.disc.material.opacity = 0.7; p.disc.material.color.copy(preds[i] ? colStop : colPass);
        p.miss.visible = preds[i] !== p.c.badge;
      } else { p.disc.material.opacity = 0; p.miss.visible = false; }
    });
  }
  clearCrowd() {
    for (const p of this.pool) { this.scene.remove(p.v.group); p.v.dispose(); disposeSprites(p.v.group); p.disc.material.dispose(); p.pick.material.dispose(); }
    for (const w of this.walkers) { this.scene.remove(w.v.group); w.v.dispose(); disposeSprites(w.v.group); }
    this.pool = []; this.walkers = []; this.run = null;
    this.setFocus(null);
  }
  // 画面のタップ位置から、いちばん近い訪問者の番号を返す
  pickAt(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    let best = -1, bd = 38;
    this.pool.forEach((p, i) => {
      this._v.copy(p.v.group.position); this._v.y += p.v.center;
      this._v.project(this.cam);
      const sx = rect.left + (this._v.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-this._v.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // ── 注目（門番がいま見ている相手）
  setFocus(x, visitor) {
    this.focusX = x; this.focusV = visitor || null;
    this.cone.visible = !!x;
    this._lensValues();
    this.brain.focus(x);
  }
  focusPool(i) { if (i < 0) this.setFocus(null); else this.setFocus(this.pool[i].c.x, this.pool[i].v); }
  setBrain(model, examples) { this.brain.build(model, examples); this.brain.focus(this.focusX); }

  // ── 本番: 訪問者が1体ずつ歩いてきて、門番が判断する
  startRun(test, decideFn, { onJudge, onDone }) {
    for (const p of this.pool) p.v.group.visible = false;
    this.lane.visible = true;
    this.setFocus(null);
    this.run = { test, decideFn, onJudge, onDone, next: 0, clock: 0, judged: 0, speed: 1, done: false };
  }
  setRunSpeed(s) { if (this.run) this.run.speed = s; }
  skipRun() {
    const r = this.run; if (!r || r.done) return;
    for (const w of this.walkers) if (!w.judged) this._judge(w);
    while (r.next < r.test.length) { const c = r.test[r.next]; const dec = r.decideFn(c.x); r.onJudge(r.next, dec, c.y); r.next++; r.judged++; }
    this._finishRun();
  }
  _judge(w) {
    const r = this.run;
    w.judged = true; w.dec = r.decideFn(w.c.x);
    r.onJudge(w.i, w.dec, w.c.y); r.judged++;
    const ok = w.dec === w.c.y;
    const mark = makeLabel(ok ? '正解' : (w.c.y ? '止めるべき' : '通すべき'), { size: 0.26, color: ok ? '#fff' : COL.ink, bg: ok ? (w.dec ? COL.stop : COL.pass) : COL.warn });
    mark.position.y = w.v.top + 0.3; mark.layers.set(1); w.v.group.add(mark);
    if (w.dec === 0) this.barTarget = 1; else { this.barTarget = 0; w.v.hop = 0.25; }
  }
  _finishRun() {
    const r = this.run; if (!r || r.done) return;
    r.done = true; this.barTarget = 0; r.onDone();
  }
  _updateRun(dt) {
    const r = this.run; if (!r) return;
    const sdt = dt * r.speed;
    r.clock += sdt;
    const GAP = 0.55;
    while (r.next < r.test.length && r.clock >= r.next * GAP) {
      const c = r.test[r.next];
      const v = new Visitor(c.x); v.group.position.set(0, 0, 8.5); this.scene.add(v.group);
      this.walkers.push({ v, c, i: r.next, t: 0, judged: false, dec: 0 });
      r.next++;
    }
    const T1 = 1.5, T2 = 0.42; // 歩いてくる時間／立ち止まって見られる時間
    for (const w of this.walkers) {
      w.t += sdt;
      const g = w.v.group;
      if (w.t < T1) { const k = w.t / T1; g.position.set(0, 0, 8.5 + (JUDGE.z - 8.5) * (1 - (1 - k) * (1 - k))); }
      else {
        if (!w.judged) { this._judge(w); this.setFocus(w.c.x, w.v); }
        const k = w.t - T1 - T2;
        w.v.hop *= 0.9;
        if (k > 0) {
          if (w.dec === 0) { // 通す: 右の門をくぐって奥へ
            const u = Math.min(1, k / 1.1);
            g.position.set(2.3 * Math.min(1, u * 1.6), 0, JUDGE.z + (-5.2 - JUDGE.z) * u * u);
          } else { // 止める: 左へ追い返す
            const u = Math.min(1, k / 1.0);
            g.position.set(-5.5 * u * u, 0, JUDGE.z + 1.6 * u);
          }
          if (k > 1.15) w.gone = true;
        }
      }
    }
    for (const w of this.walkers) if (w.gone) { this.scene.remove(w.v.group); w.v.dispose(); disposeSprites(w.v.group); if (this.focusV === w.v) this.focusV = null; }
    this.walkers = this.walkers.filter((w) => !w.gone);
    if (!r.done && r.judged >= r.test.length && r.next >= r.test.length) {
      r.tail = (r.tail || 0) + sdt;
      if (r.tail > 0.9) this._finishRun();
    }
  }
  endRun() {
    for (const w of this.walkers) { this.scene.remove(w.v.group); w.v.dispose(); disposeSprites(w.v.group); }
    this.walkers = []; this.run = null; this.lane.visible = false; this.barTarget = 0;
    for (const p of this.pool) p.v.group.visible = true;
    this.setFocus(null);
  }

  update(dt) {
    this.time += dt;
    for (const p of this.pool) p.v.update(dt);
    for (const w of this.walkers) w.v.update(dt);
    this._updateRun(dt);
    // 門番の首と視野
    if (this.focusV) { this.focusPos.copy(this.focusV.group.position); this.focusPos.y += this.focusV.body.position.y + 0.45 * this.focusV.scale; }
    else this.focusPos.set(Math.sin(this.time * 0.5) * 1.6, 0.5, 3.6);
    this.lookPos.lerp(this.focusPos, Math.min(1, dt * 8));
    this.head.lookAt(this.lookPos);
    if (this.cone.visible) {
      const d = this._v.subVectors(this.lookPos, EYE); const len = d.length();
      this.cone.position.copy(EYE);
      this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      const rr = 0.42 * (this.focusV ? this.focusV.scale : 1) + 0.12;
      this.cone.scale.set(rr, len, rr);
      this.cone.material.opacity = 0.2 + 0.05 * Math.sin(this.time * 5);
    }
    for (const l of this.lenses) l.beam.update(dt);
    this.brain.update(dt);
    this.barOpen += (this.barTarget - this.barOpen) * Math.min(1, dt * 9);
    this.bar.rotation.z = this.barOpen * 1.35;
  }

  render() {
    const r = this.renderer;
    r.setScissorTest(false); r.setViewport(0, 0, this.w, this.h);
    r.clear();
    r.render(this.scene, this.cam);
    if (this.eyeRect) {
      const { x, y, w, h } = this.eyeRect;
      const by = this.h - y - h;
      this.eyeCam.position.copy(EYE);
      this.eyeCam.lookAt(this.lookPos);
      // 相手との距離に合わせて、小窓いっぱいに映るよう画角をしぼる
      const dist = EYE.distanceTo(this.lookPos);
      this.eyeCam.fov = Math.max(9, Math.min(46, (2 * Math.atan(0.8 / dist) * 180) / Math.PI));
      this.eyeCam.aspect = w / h; this.eyeCam.updateProjectionMatrix();
      r.setScissorTest(true); r.setScissor(x, by, w, h); r.setViewport(x, by, w, h);
      r.clear();
      this.keeper.visible = false;
      r.render(this.scene, this.eyeCam);
      this.keeper.visible = true;
      r.setScissorTest(false);
    }
  }
}
export { hornCount };
