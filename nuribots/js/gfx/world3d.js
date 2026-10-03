// 3D のアリーナ（Three.js）。床タイル・かべ・ロボ・ペンキ爆弾・弾・しぶき。
// シミュレーション（env.js）の結果を受け取って、なめらかに動かして見せるだけ。
// ゲームの勝ち負けには関係しない（描画専用）。

import { GW, GH, GN, ARENAS } from '../sim/arenas.js';
import { WALL, DX, DY, RULE } from '../sim/env.js';
import { C, TEAM } from '../core/const.js';

const THREE = window.THREE;

const NEUTRAL_A = new THREE.Color(C.pale);
const NEUTRAL_B = new THREE.Color(C.hay);
const TEAM_COL = TEAM.map(t => new THREE.Color(t.main));
const TEAM_COL2 = TEAM.map(t => new THREE.Color(t.dark));
const TEAM_FLASH = TEAM.map(t => new THREE.Color(t.light));
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function wx(x) { return x - (GW - 1) / 2; }
function wz(y) { return y - (GH - 1) / 2; }
function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
function dirAngle(d) { return [Math.PI, Math.PI / 2, 0, -Math.PI / 2][d]; }

function lam(color, extra = {}) { return new THREE.MeshLambertMaterial({ color, ...extra }); }

class BotMesh {
  constructor(team) {
    const T = TEAM[team];
    this.team = team;
    const g = new THREE.Group();
    this.group = g;
    const body = new THREE.Group();
    this.body = body;
    g.add(body);
    const mBody = lam(T.main), mDark = lam(T.dark), mLight = lam(T.light), mInk = lam(C.ink), mWhite = lam(C.white);
    this.mats = [mBody, mDark, mLight];
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.56), mBody);
    torso.position.y = 0.42;
    body.add(torso);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.6), mLight);
    cap.position.y = 0.66;
    body.add(cap);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.6), mDark);
    skirt.position.y = 0.22;
    body.add(skirt);
    // 顔（画面）
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.04), mInk);
    face.position.set(0, 0.45, 0.29);
    body.add(face);
    const eyeGeo = new THREE.BoxGeometry(0.08, 0.1, 0.03);
    this.eyes = [];
    for (const sx of [-0.11, 0.11]) {
      const e = new THREE.Mesh(eyeGeo, mWhite);
      e.position.set(sx, 0.46, 0.31);
      body.add(e);
      this.eyes.push(e);
    }
    // ピヨった目（×）
    this.xeyes = [];
    const xGeo = new THREE.BoxGeometry(0.12, 0.03, 0.03);
    for (const sx of [-0.11, 0.11]) {
      for (const r of [0.8, -0.8]) {
        const e = new THREE.Mesh(xGeo, mWhite);
        e.position.set(sx, 0.46, 0.31);
        e.rotation.z = r;
        e.visible = false;
        body.add(e);
        this.xeyes.push(e);
      }
    }
    // アンテナ
    const ant = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), mDark);
    ant.position.set(0.18, 0.8, -0.1);
    body.add(ant);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mLight);
    bulb.position.set(0.18, 0.92, -0.1);
    body.add(bulb);
    this.bulb = bulb;
    // ペンキローラー
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.62, 6), mLight);
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, 0.1, 0.42);
    g.add(roller);
    this.roller = roller;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.22), mDark);
    arm.position.set(0, 0.18, 0.33);
    g.add(arm);
    // かげ
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.36, 8), new THREE.MeshBasicMaterial({ color: C.coal }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.012;
    g.add(sh);
    this.shadow = sh;
    // ピヨピヨの星
    this.stars = new THREE.Group();
    const starGeo = new THREE.OctahedronGeometry(0.07, 0);
    const starMat = new THREE.MeshBasicMaterial({ color: C.gold });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(starGeo, starMat);
      this.stars.add(s);
    }
    this.stars.visible = false;
    g.add(this.stars);
    // 状態
    this.from = new THREE.Vector3(); this.to = new THREE.Vector3();
    this.t0 = 0; this.dur = 0.15;
    this.ang = 0; this.angFrom = 0; this.angTo = 0;
    this.kick = 0; this.kickDir = 0; this.kickT = -9;
    this.recoilT = -9;
    this.stun = 0; this.inv = 0;
    this.hop = 0;
    this.pose = null; this.poseT = 0;
  }
}

export class World3D {
  constructor() {
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 140);
    this.clear = C.navy;
    // 上面がちょうど「元の色×1.0」になる明るさ（減色でぴったりパレットの色になる）
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 0.615);
    sun.position.set(-6, 14, 8);
    scene.add(sun);
    this._buildBackdrop();
    this.root = new THREE.Group();
    scene.add(this.root);
    // 土台
    const base = new THREE.Mesh(new THREE.BoxGeometry(GW + 0.8, 1.4, GH + 0.8), lam(C.night));
    base.position.y = -0.86;
    this.root.add(base);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(GW + 1.1, 0.25, GH + 1.1), lam(C.dusk));
    rim.position.y = -0.2;
    this.root.add(rim);
    const under = new THREE.Mesh(new THREE.BoxGeometry(GW - 2, 1.2, GH - 2), lam(C.ink));
    under.position.y = -2;
    this.root.add(under);
    // 床タイル
    const tileGeo = new THREE.BoxGeometry(0.88, 0.3, 0.88);
    tileGeo.translate(0, -0.15, 0);
    this.tiles = new THREE.InstancedMesh(tileGeo, lam(0xffffff), GN);
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.tiles);
    // かべ
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    wallGeo.translate(0, 0.35, 0);
    this.walls = new THREE.InstancedMesh(wallGeo, lam(C.lilac), GN);
    this.root.add(this.walls);
    const capGeo = new THREE.BoxGeometry(1.0, 0.12, 1.0);
    capGeo.translate(0, 0.9, 0);
    this.wallCaps = new THREE.InstancedMesh(capGeo, lam(C.mist), GN);
    this.root.add(this.wallCaps);
    // ロボ
    this.bots = [new BotMesh(0), new BotMesh(1)];
    for (const b of this.bots) { b.group.scale.setScalar(1.28); this.root.add(b.group); }
    // ペンキ爆弾
    this.itemMeshes = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), lam(C.ink));
      ball.position.y = 0.32;
      g.add(ball);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.42), lam(C.hotpink));
      band.position.y = 0.32;
      g.add(band);
      const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), lam(C.khaki));
      fuse.position.y = 0.6;
      g.add(fuse);
      const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), new THREE.MeshBasicMaterial({ color: C.gold }));
      spark.position.y = 0.72;
      g.add(spark);
      g.userData.spark = spark;
      const sh = new THREE.Mesh(new THREE.CircleGeometry(0.26, 8), new THREE.MeshBasicMaterial({ color: C.coal }));
      sh.rotation.x = -Math.PI / 2; sh.position.y = 0.012;
      g.add(sh);
      g.visible = false;
      this.root.add(g);
      this.itemMeshes.push(g);
    }
    // 弾
    this.shotMeshes = [0, 1].map(t => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), new THREE.MeshBasicMaterial({ color: TEAM[t].light }));
      m.visible = false;
      this.root.add(m);
      return m;
    });
    this.shots = [];
    // しぶき（小さな立方体）
    this.PMAX = 260;
    this.parts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.PMAX);
    this.parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parts.count = 0;
    this.root.add(this.parts);
    this.plist = [];
    // 爆発の輪
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      this.root.add(r);
      this.rings.push({ mesh: r, t: 9 });
    }
    // 方策の矢印（AIの考え）
    this.policy = new THREE.Group();
    const arrowGeo = new THREE.ConeGeometry(0.22, 0.5, 3);
    arrowGeo.rotateX(Math.PI / 2);
    const arrowMat = new THREE.MeshBasicMaterial({ color: C.white });
    this.arrows = [];
    for (let d = 0; d < 4; d++) {
      const a = new THREE.Mesh(arrowGeo, arrowMat);
      this.policy.add(a);
      this.arrows.push(a);
    }
    this.shotRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 12), new THREE.MeshBasicMaterial({ color: C.gold, side: THREE.DoubleSide }));
    this.shotRing.rotation.x = -Math.PI / 2;
    this.policy.add(this.shotRing);
    this.policy.visible = false;
    this.root.add(this.policy);
    this.policyBot = 0;
    this.policyProb = null;
    // 選択の印
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), new THREE.MeshBasicMaterial({ color: C.gold }));
    this.marker.rotation.x = Math.PI;
    this.marker.visible = false;
    this.root.add(this.marker);
    this.markBot = -1;
    // タイルの状態
    this.disp = new Uint8Array(GN);       // 表示中の色 0/1/2/3
    this.tileAnim = new Float32Array(GN); // ポップの残り時間
    this.animList = new Set();
    this.paintQ = [];
    this.heat = null;                     // きもちマップ（Float32Array GN, 0..1）
    this.now = 0;
    this.stepDur = 1 / RULE.STEPS_PER_SEC;
    this.arenaId = -1;
    this.items = [];                      // 表示中のアイテム [cell]
    this.camMode = 'fit';
    this.camAng = 0;
    this.camT = 0;
    this.shake = 0;
    this.aspect = 1;
    this.focus = null;
    this.zoom = 1;
    this.padT = 0; this.padB = 0; this.padH = 1;
    this.tilt = 1.12;   // 見下ろし角（ラジアン）
    this.setArena(0);
  }

  _buildBackdrop() {
    // 大きな球の内側にグラデーション（減色とディザでドットの帯になる）
    const geo = new THREE.SphereGeometry(70, 16, 12);
    const cols = [];
    const pos = geo.attributes.position;
    const top = new THREE.Color(C.violet), mid = new THREE.Color(C.grape), bot = new THREE.Color(C.navy);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 70;
      const c = y > 0 ? mid.clone().lerp(top, y) : mid.clone().lerp(bot, Math.min(1, -y * 1.6));
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false }));
    sky.renderOrder = -1;
    this.scene.add(sky);
    // 遠くにまたたく星（小さな立方体）
    this.starfield = new THREE.Group();
    const sg = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const sm = [new THREE.MeshBasicMaterial({ color: C.lavender }), new THREE.MeshBasicMaterial({ color: C.sky }), new THREE.MeshBasicMaterial({ color: C.pink })];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, r = 22 + rnd() * 26;
      const m = new THREE.Mesh(sg, sm[i % 3]);
      m.position.set(Math.cos(a) * r, -14 + rnd() * 8, Math.sin(a) * r);
      m.userData.ph = rnd() * 10;
      this.starfield.add(m);
    }
    this.scene.add(this.starfield);
  }

  setArena(id) {
    const A = ARENAS[id];
    this.arenaId = id;
    let nw = 0;
    for (let c = 0; c < GN; c++) {
      const x = c % GW, y = (c / GW) | 0;
      tmpM.makeTranslation(wx(x), 0, wz(y));
      this.tiles.setMatrixAt(c, tmpM);
      this.tileAnim[c] = 0;
      if (A.wall[c]) {
        this.disp[c] = 3;
        this.tiles.setColorAt(c, tmpC.set(C.dusk));
        tmpM.makeTranslation(wx(x), 0, wz(y));
        this.walls.setMatrixAt(nw, tmpM);
        this.wallCaps.setMatrixAt(nw, tmpM);
        nw++;
      } else {
        this.disp[c] = 0;
        this.tiles.setColorAt(c, NEUTRAL_A);
      }
    }
    this.walls.count = nw; this.wallCaps.count = nw;
    this.walls.instanceMatrix.needsUpdate = true;
    this.wallCaps.instanceMatrix.needsUpdate = true;
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    this.animList.clear();
    this.paintQ.length = 0;
    this.plist.length = 0;
    this.shots.length = 0;
    for (const s of this.shotMeshes) s.visible = false;
    for (const m of this.itemMeshes) m.visible = false;
    this.items = [];
    this.heat = null;
  }

  _tileColor(c, v) {
    if (v === 3) return tmpC.set(C.dusk);
    if (this.heat) return heatColor(this.heat[c]);
    if (v === 0) return NEUTRAL_A;
    return TEAM_COL[v - 1];
  }

  _setTile(c, v, pop) {
    this.disp[c] = v;
    this.tiles.setColorAt(c, pop && !this.heat ? TEAM_FLASH[v - 1] || tmpC.set(C.white) : this._tileColor(c, v));
    if (pop) { this.tileAnim[c] = 0.22; this.animList.add(c); }
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
  }

  // 盤面を一気にそろえる（途中から表示する時など）
  sync(env) {
    if (env.arenaId !== this.arenaId) this.setArena(env.arenaId);
    this.paintQ.length = 0;
    for (let c = 0; c < GN; c++) {
      const v = env.grid[c];
      if (v === WALL) continue;
      this.disp[c] = v;
      this.tiles.setColorAt(c, this._tileColor(c, v));
      this.tileAnim[c] = 0;
      const x = c % GW, y = (c / GW) | 0;
      tmpM.makeTranslation(wx(x), 0, wz(y));
      this.tiles.setMatrixAt(c, tmpM);
    }
    this.animList.clear();
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    for (let i = 0; i < 2; i++) {
      const b = env.bots[i], m = this.bots[i];
      m.from.set(wx(b.x), 0, wz(b.y)); m.to.copy(m.from);
      m.group.position.copy(m.from);
      m.ang = m.angFrom = m.angTo = dirAngle(b.dir);
      m.group.rotation.y = m.ang;
      m.stun = b.stun; m.inv = b.inv;
      m.t0 = this.now; m.pose = null;
      m.body.rotation.set(0, 0, 0);
      m.body.position.y = 0;
    }
    this.items = env.items.slice();
    this._layoutItems(true);
    this.shots.length = 0;
    for (const s of this.shotMeshes) s.visible = false;
  }

  // 1手ぶんの結果を受け取って演出を予約する（fx は env.fx）
  applyStep(env, stepDur) {
    const fx = env.fx;
    this.stepDur = stepDur;
    const now = this.now;
    const moveT = stepDur * 0.62;
    // 前の手の演出が残っていたら終わらせる
    this._flushPaints(now);
    for (let i = 0; i < 2; i++) {
      const b = env.bots[i], m = this.bots[i];
      m.group.position.copy(m.to);
      m.from.set(wx(b.px), 0, wz(b.py));
      m.to.set(wx(b.x), 0, wz(b.y));
      m.t0 = now; m.dur = moveT;
      m.angFrom = m.group.rotation.y;
      let target = dirAngle(b.dir);
      while (target - m.angFrom > Math.PI) target -= Math.PI * 2;
      while (target - m.angFrom < -Math.PI) target += Math.PI * 2;
      m.angTo = target;
      m.stun = b.stun; m.inv = b.inv;
      m.hop = (b.px !== b.x || b.py !== b.y) ? 1 : 0;
    }
    if (!fx) { this.sync(env); return; }
    for (const i of fx.bumps) { const m = this.bots[i]; m.kickT = now; m.kickDir = env.bots[i].dir; m.kick = 0.22; }
    for (const i of fx.bounces) { const m = this.bots[i]; m.kickT = now; m.kickDir = env.bots[i].dir; m.kick = 0.3; }
    // 色ぬりの予約
    const shotLen = {};
    for (const s of fx.shots) shotLen[s.i] = s;
    for (let k = 0; k < fx.paints.length; k += 3) {
      const c = fx.paints[k], v = fx.paints[k + 1], cause = fx.paints[k + 2];
      let at = now + moveT * 0.85;
      if (cause === 1) {
        const s = shotLen[v - 1];
        if (s) {
          const x = c % GW, y = (c / GW) | 0;
          const dist = Math.abs(x - s.x) + Math.abs(y - s.y);
          at = now + stepDur * 0.15 + (dist / Math.max(1, RULE.RANGE)) * stepDur * 0.5;
        }
      } else if (cause === 2) {
        const bomb = fx.bombs.find(b => b.i === v - 1);
        if (bomb) {
          const bx = bomb.cell % GW, by = (bomb.cell / GW) | 0;
          const x = c % GW, y = (c / GW) | 0;
          at = now + moveT + (Math.abs(x - bx) + Math.abs(y - by)) * 0.035;
        }
      }
      this.paintQ.push({ at, c, v, cause });
    }
    for (const s of fx.shots) {
      const m = this.bots[s.i];
      m.recoilT = now;
      this.shots.push({ i: s.i, x: s.x, y: s.y, d: s.d, len: s.len, hit: s.hit, t0: now + stepDur * 0.1, dur: stepDur * 0.55, done: false });
    }
    for (const b of fx.bombs) {
      const x = b.cell % GW, y = (b.cell / GW) | 0;
      this._ring(wx(x), wz(y), TEAM[b.i].light, now + moveT);
      this._burst(wx(x), 0.3, wz(y), TEAM[b.i].light, 18, now + moveT, 3.2);
      this.shake = Math.max(this.shake, 0.18);
      if (this.onEvent) this.onEvent('bomb', b.i);
    }
    for (const i of fx.stuns) {
      const m = this.bots[i];
      this._burst(m.to.x, 0.6, m.to.z, TEAM[1 - i].light, 10, now + stepDur * 0.5, 2.4);
      this.shake = Math.max(this.shake, 0.12);
    }
    // アイテムの表示
    this.items = env.items.slice();
    this._layoutItems(false);
    if (fx.spawns.length) for (const c of fx.spawns) {
      const k = this.items.indexOf(c);
      if (k >= 0 && this.itemMeshes[k]) this.itemMeshes[k].userData.spawnT = now;
    }
  }

  _layoutItems(instant) {
    for (let k = 0; k < this.itemMeshes.length; k++) {
      const m = this.itemMeshes[k];
      const c = this.items[k];
      if (c === undefined) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(wx(c % GW), 0, wz((c / GW) | 0));
      if (instant) m.userData.spawnT = -9;
    }
  }

  _flushPaints(t) {
    const q = this.paintQ;
    if (!q.length) return;
    q.sort((a, b) => a.at - b.at);
    let n = 0;
    for (const p of q) {
      if (p.at > t) break;
      this._doPaint(p);
      n++;
    }
    q.splice(0, n);
  }

  _doPaint(p) {
    this._setTile(p.c, p.v, true);
    const x = p.c % GW, y = (p.c / GW) | 0;
    if (p.cause === 0 && Math.random() < 0.7) this._burst(wx(x), 0.05, wz(y), TEAM[p.v - 1].light, 2, this.now, 1.2);
    else if (p.cause === 1) this._burst(wx(x), 0.05, wz(y), TEAM[p.v - 1].main, 2, this.now, 1.4);
    else if (p.cause === 2 && Math.random() < 0.4) this._burst(wx(x), 0.05, wz(y), TEAM[p.v - 1].main, 1, this.now, 1.8);
  }

  _burst(x, y, z, color, n, t, power) {
    for (let i = 0; i < n; i++) {
      if (this.plist.length >= this.PMAX) this.plist.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random()) * power;
      this.plist.push({
        x, y, z, vx: Math.cos(a) * sp * 0.5, vy: 1.5 + Math.random() * power, vz: Math.sin(a) * sp * 0.5,
        t0: t, life: 0.45 + Math.random() * 0.35, color: new THREE.Color(color), s: 0.6 + Math.random() * 0.8,
      });
    }
  }

  _ring(x, z, color, t) {
    const r = this.rings.find(r => r.t > 1) || this.rings[0];
    r.t = 0; r.t0 = t;
    r.mesh.position.set(x, 0.06, z);
    r.mesh.material.color.set(color);
  }

  setHeat(arr) {
    this.heat = arr;
    for (let c = 0; c < GN; c++) if (this.disp[c] !== 3) this.tiles.setColorAt(c, this._tileColor(c, this.disp[c]));
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
  }

  // 方策の矢印: probs は自分目線の行動確率 [とまる,上,右,下,左,弾]
  setPolicy(botIndex, probs) {
    this.policyBot = botIndex;
    this.policyProb = probs ? Array.from(probs) : null;
    this.policy.visible = !!probs;
  }

  setMarker(i) { this.markBot = i; this.marker.visible = i >= 0; }

  setPose(i, pose) { const m = this.bots[i]; m.pose = pose; m.poseT = this.now; }

  // カメラ: aspect に合わせてアリーナ全体が入る距離を探す
  setAspect(a) {
    if (Math.abs(a - this.aspect) > 1e-6) { this._fitDist = null; }
    this.aspect = a; this.camera.aspect = a;
  }

  // 3Dの上下に重なる表示の分だけ、アリーナを内側に収める（仮想px）
  setPad(top, bottom, viewH) {
    const t = Math.max(0, top | 0), b = Math.max(0, bottom | 0), h = Math.max(1, viewH | 0);
    if (t !== this.padT || b !== this.padB || h !== this.padH) { this.padT = t; this.padB = b; this.padH = h; this._fitDist = null; }
  }

  _fit(tilt, ang) {
    const cam = this.camera;
    cam.updateProjectionMatrix();
    const sY = 1 - ((this.padT || 0) + (this.padB || 0)) / (this.padH || 1);
    const corners = [];
    const hx = GW / 2 + 0.6, hz = GH / 2 + 0.6;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const yy of [-0.4, 1.0]) corners.push(new THREE.Vector3(sx * hx, yy, sz * hz));
    let lo = 5, hi = 120;
    const target = new THREE.Vector3(0, 0, 0);
    for (let it = 0; it < 24; it++) {
      const d = (lo + hi) / 2;
      this._placeCam(d, tilt, ang, target);
      cam.updateMatrixWorld();
      let ok = true;
      for (const c of corners) {
        tmpV.copy(c).project(cam);
        if (Math.abs(tmpV.x) > 0.96 || Math.abs(tmpV.y) > 0.94 * sY) { ok = false; break; }
      }
      if (ok) hi = d; else lo = d;
    }
    return hi;
  }

  _placeCam(d, tilt, ang, target) {
    const cam = this.camera;
    cam.position.set(target.x + Math.sin(ang) * Math.cos(tilt) * d, target.y + Math.sin(tilt) * d, target.z + Math.cos(ang) * Math.cos(tilt) * d);
    cam.lookAt(target);
  }

  update(dt) {
    this.now += dt;
    const now = this.now;
    // 色ぬり
    this._flushPaints(now);
    // タイルのポップ
    if (this.animList.size) {
      for (const c of this.animList) {
        const t = this.tileAnim[c] -= dt;
        const x = c % GW, y = (c / GW) | 0;
        if (t <= 0) {
          this.tileAnim[c] = 0;
          this.animList.delete(c);
          tmpM.makeTranslation(wx(x), 0, wz(y));
          this.tiles.setColorAt(c, this._tileColor(c, this.disp[c]));
          if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
        } else {
          const k = t / 0.22;
          const sy = 1 + Math.sin(k * Math.PI) * 0.9;
          tmpS.set(1, sy, 1);
          tmpV.set(wx(x), Math.sin(k * Math.PI) * 0.06, wz(y));
          tmpM.compose(tmpV, tmpQ.identity(), tmpS);
          if (t < 0.12) { this.tiles.setColorAt(c, this._tileColor(c, this.disp[c])); if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true; }
        }
        this.tiles.setMatrixAt(c, tmpM);
      }
      this.tiles.instanceMatrix.needsUpdate = true;
    }
    // ロボ
    for (let i = 0; i < 2; i++) {
      const m = this.bots[i];
      const k = m.dur > 0 ? ease((now - m.t0) / m.dur) : 1;
      m.group.position.lerpVectors(m.from, m.to, k);
      const raw = Math.min(1, (now - m.t0) / Math.max(0.01, m.dur));
      m.group.position.y = m.hop ? Math.sin(raw * Math.PI) * 0.16 : 0;
      const ka = ease(Math.min(1, (now - m.t0) / Math.max(0.01, m.dur * 0.6)));
      m.group.rotation.y = m.angFrom + (m.angTo - m.angFrom) * ka;
      // ぶつかった時のゆれ
      const kt = (now - m.kickT) / 0.18;
      if (kt >= 0 && kt < 1) {
        const off = Math.sin(kt * Math.PI) * m.kick;
        m.group.position.x += DX[m.kickDir] * off;
        m.group.position.z += DY[m.kickDir] * off;
      }
      // 撃った反動
      const rt = (now - m.recoilT) / 0.15;
      m.body.position.z = rt >= 0 && rt < 1 ? -Math.sin(rt * Math.PI) * 0.12 : 0;
      // ピヨり
      const stunned = m.stun > 0;
      m.stars.visible = stunned;
      for (const e of m.eyes) e.visible = !stunned;
      for (const e of m.xeyes) e.visible = stunned;
      if (stunned) {
        m.body.rotation.z = Math.sin(now * 12) * 0.12;
        m.stars.children.forEach((s, j) => {
          const a = now * 6 + j * Math.PI * 2 / 3;
          s.position.set(Math.cos(a) * 0.36, 1.0, Math.sin(a) * 0.36);
        });
      } else m.body.rotation.z *= 0.8;
      // 無敵は点滅
      m.body.visible = !(m.inv > 0 && Math.floor(now * 14) % 2 === 0);
      // アンテナの電球
      m.bulb.position.y = 0.92 + Math.sin(now * 5 + i) * 0.02;
      // 勝ち・負けのポーズ
      if (m.pose) {
        const pt = now - m.poseT;
        if (m.pose === 'win') {
          m.group.position.y = Math.abs(Math.sin(pt * 6)) * 0.4;
          m.group.rotation.y = m.angTo + pt * 3;
        } else if (m.pose === 'lose') {
          m.body.rotation.x = Math.min(0.5, pt * 2);
        } else if (m.pose === 'idle') {
          m.group.position.y = Math.abs(Math.sin(pt * 3)) * 0.08;
        }
      } else m.body.rotation.x = 0;
    }
    // 弾
    for (let i = 0; i < 2; i++) this.shotMeshes[i].visible = false;
    for (const s of this.shots) {
      const k = (now - s.t0) / s.dur;
      const mesh = this.shotMeshes[s.i];
      if (k < 0) continue;
      if (k >= 1) {
        if (!s.done) {
          s.done = true;
          const ex = s.x + DX[s.d] * s.len, ey = s.y + DY[s.d] * s.len;
          this._burst(wx(ex), 0.3, wz(ey), TEAM[s.i].light, s.hit === 1 ? 10 : 5, now, s.hit === 1 ? 2.6 : 1.6);
        }
        continue;
      }
      mesh.visible = true;
      const dist = Math.max(0.6, s.len) * k;
      mesh.position.set(wx(s.x) + DX[s.d] * dist, 0.42 + Math.sin(k * Math.PI) * 0.25, wz(s.y) + DY[s.d] * dist);
    }
    this.shots = this.shots.filter(s => !s.done || now - s.t0 < 1);
    // しぶき
    let n = 0;
    const keep = [];
    for (const p of this.plist) {
      const t = now - p.t0;
      if (t < 0) { keep.push(p); continue; }
      if (t > p.life) continue;
      keep.push(p);
      const y = p.y + p.vy * t - 6 * t * t;
      if (y < 0.02 && t > 0.1) continue;
      tmpV.set(p.x + p.vx * t, Math.max(0.02, y), p.z + p.vz * t);
      const s = p.s * (1 - t / p.life * 0.6);
      tmpS.set(s, s, s);
      tmpM.compose(tmpV, tmpQ.identity(), tmpS);
      this.parts.setMatrixAt(n, tmpM);
      this.parts.setColorAt(n, p.color);
      n++;
      if (n >= this.PMAX) break;
    }
    this.plist = keep;
    this.parts.count = n;
    this.parts.instanceMatrix.needsUpdate = true;
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;
    // 輪
    for (const r of this.rings) {
      const t = (now - r.t0) / 0.45;
      if (t < 0 || t > 1) { r.mesh.visible = t < 0 && r.t === 0; if (t > 1) r.t = 9; continue; }
      r.mesh.visible = true;
      const s = 0.4 + t * 2.6;
      r.mesh.scale.set(s, s, s);
    }
    // アイテムのふわふわ
    for (let k = 0; k < this.itemMeshes.length; k++) {
      const m = this.itemMeshes[k];
      if (!m.visible) continue;
      const st = now - (m.userData.spawnT ?? -9);
      const drop = st < 0.35 ? (1 - st / 0.35) * 3 : 0;
      m.children[0].position.y = 0.32 + drop + Math.sin(now * 3 + k) * 0.05;
      m.children[1].position.y = m.children[0].position.y;
      m.children[2].position.y = 0.6 + drop + Math.sin(now * 3 + k) * 0.05;
      m.userData.spark.position.y = 0.72 + drop + Math.sin(now * 3 + k) * 0.05;
      m.userData.spark.visible = Math.floor(now * 10 + k) % 2 === 0;
      m.rotation.y = now * 0.8 + k;
    }
    // 方策の矢印
    if (this.policy.visible && this.policyProb) {
      const m = this.bots[this.policyBot];
      this.policy.position.set(m.group.position.x, 0.08, m.group.position.z);
      const flip = this.policyBot === 1;
      for (let cd = 0; cd < 4; cd++) {
        const d = flip ? (cd + 2) & 3 : cd;
        const p = this.policyProb[cd + 1];
        const a = this.arrows[cd];
        const s = 0.25 + Math.sqrt(p) * 1.1;
        a.visible = p > 0.03;
        a.scale.set(s, 0.3, s);
        a.position.set(DX[d] * (0.55 + s * 0.2), 0, DY[d] * (0.55 + s * 0.2));
        a.rotation.y = dirAngle(d);
      }
      const ps = this.policyProb[5];
      this.shotRing.visible = ps > 0.05;
      const rs = 0.6 + Math.sqrt(ps) * 0.8;
      this.shotRing.scale.set(rs, rs, rs);
    }
    // 選択の印
    if (this.markBot >= 0) {
      const m = this.bots[this.markBot];
      this.marker.position.set(m.group.position.x, 1.35 + Math.sin(now * 5) * 0.08, m.group.position.z);
      this.marker.rotation.y = now * 2;
    }
    this.starfield.rotation.y = now * 0.01;
    for (const st of this.starfield.children) st.visible = Math.sin(now * 2 + st.userData.ph) > -0.6;
    this._updateCamera(dt);
  }

  _updateCamera(dt) {
    const cam = this.camera;
    this.camT += dt;
    let ang = 0, tilt = this.tilt, target = new THREE.Vector3(0, 0, 0.3);
    if (this.camMode === 'orbit') { this.camAng += dt * 0.12; ang = Math.sin(this.camAng) * 0.5; tilt = 0.82; }
    if (this.camMode === 'low') { ang = Math.sin(this.camT * 0.15) * 0.25; tilt = 0.7; }
    const key = `${this.aspect.toFixed(3)}:${tilt.toFixed(3)}:${ang.toFixed(2)}`;
    cam.updateProjectionMatrix();
    if (this._fitKey !== key || this._fitDist == null) { this._fitDist = this._fit(tilt, ang); this._fitKey = key; }
    let d = this._fitDist / this.zoom;
    if (this.focus) {
      const f = this.focus;
      target.lerp(new THREE.Vector3(f.x, 0, f.z), f.k);
      d *= 1 - 0.45 * f.k;
    }
    this._placeCam(d, tilt, ang, target);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 0.9);
    }
    // 上下の表示のぶん、画面の中心をずらす（射影行列の y に w をたす）
    const dy = ((this.padB || 0) - (this.padT || 0)) / (this.padH || 1);
    if (dy) {
      const e = cam.projectionMatrix.elements;
      for (let c = 0; c < 4; c++) e[1 + 4 * c] += dy * e[3 + 4 * c];
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    }
  }

  // 3D の位置 → 画面上の位置（view 内の仮想px）
  project(x, y, z, viewW, viewH) {
    tmpV.set(x, y, z).project(this.camera);
    return { x: (tmpV.x * 0.5 + 0.5) * viewW, y: (1 - (tmpV.y * 0.5 + 0.5)) * viewH, vis: tmpV.z < 1 };
  }

  botScreen(i, viewW, viewH, h = 1.1) {
    const p = this.bots[i].group.position;
    return this.project(p.x, h, p.z, viewW, viewH);
  }

  cellScreen(c, viewW, viewH) {
    return this.project(wx(c % GW), 0, wz((c / GW) | 0), viewW, viewH);
  }

  // 画面上の点 → マス（タップでロボを選ぶ等）
  pickCell(sx, sy, viewW, viewH) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(sx / viewW * 2 - 1, -(sy / viewH * 2 - 1)), this.camera);
    const t = -ray.ray.origin.y / ray.ray.direction.y;
    if (!(t > 0)) return -1;
    const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    const x = Math.round(p.x + (GW - 1) / 2), y = Math.round(p.z + (GH - 1) / 2);
    if (x < 0 || y < 0 || x >= GW || y >= GH) return -1;
    return y * GW + x;
  }
}

// きもちマップの色（低い=暗い紫 → 高い=明るい黄）
const HEAT = [C.grape, C.violet, C.rose, C.coral, C.salmon, C.tan, C.sand, C.gold, C.cream].map(h => new THREE.Color(h));
function heatColor(v) {
  const k = Math.max(0, Math.min(HEAT.length - 1, Math.round(v * (HEAT.length - 1))));
  return HEAT[k];
}
