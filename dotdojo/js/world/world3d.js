// 3D の修行場（Three.js r128）
// 浮き島・鳥居と巻物・オニ・トゲ・カギとトビラ・小判・でしたち・方針の矢印・パーティクル・カメラ。
// 描画は PixelRenderer が低解像度＋32色に変換するので、ここでは素直なローポリで作る。

import { THEMES, PAL } from '../core/config.js';
import { T_WALL, T_VOID, T_GOAL, T_DOOR, T_SPIKE_A, T_SPIKE_B, C_FALL, C_GOAL } from '../sim/env.js';

const THREE = window.THREE;

const MAX_AGENTS = 96;
const MAX_TILES = 13 * 13;
const MAX_PARTICLES = 420;
const MAX_ONI = 6;
const MAX_COINS = 12;
const MAX_FOOT = 120;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function initInstanced(im) {
  const n = im.instanceMatrix.count;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
  im.instanceColor.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false;
  im.count = 0;
  return im;
}

function lambert(color = 0xffffff, opts = {}) { return new THREE.MeshLambertMaterial(Object.assign({ color }, opts)); }
function basic(color = 0xffffff, opts = {}) { return new THREE.MeshBasicMaterial(Object.assign({ color }, opts)); }

// 平らな矢印（上向き＝-Z方向。タイルの上に寝かせて使う）
function arrowGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.36);
  s.lineTo(0.26, 0.04);
  s.lineTo(0.1, 0.04);
  s.lineTo(0.1, -0.3);
  s.lineTo(-0.1, -0.3);
  s.lineTo(-0.1, 0.04);
  s.lineTo(-0.26, 0.04);
  s.lineTo(0, 0.36);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);   // XY → XZ（先端が -Z）
  return g;
}

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class World3D {
  constructor() {
    const s = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 220);
    this.fog = new THREE.Fog(0xffffff, 60, 160);
    s.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x555566, 0.8);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.85);
    this.sun.position.set(-6, 14, 9);
    s.add(this.sun);
    this.time = 0;
    this.themeIdx = -1;
    this.theme = THEMES[0];
    this.stage = null;
    this.W = 9; this.H = 9;
    this._buildSky();
    this._buildIsland();
    this._buildProps();
    this._buildAgents();
    this._buildParticles();
    this._buildOverlays();
    this.cam = { mode: 'fixed', yaw: 0, pitch: 0.88, dist: 22, look: new THREE.Vector3(), zoom: 1, aspect: 1, orbit: 0 };
    this.baseLook = new THREE.Vector3();
    this.frameOpts = {};
    this.setTheme(0);
  }

  // ── 空・雲・遠くの島 ──
  _buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, low: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 zenith; uniform vec3 horizon; uniform vec3 low; varying vec3 vDir;' +
        'void main(){ float h = normalize(vDir).y; vec3 c = h > 0.0 ? mix(horizon, zenith, smoothstep(0.0, 0.55, h)) : mix(horizon, low, smoothstep(0.0, -0.35, h)); gl_FragColor = vec4(c, 1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(190, 16, 10), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    // 星（夜だけ）
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, y = 0.05 + Math.random() * 0.95;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 180; pos[i * 3 + 1] = y * 180 - 20; pos[i * 3 + 2] = Math.sin(th) * r * 180;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    // 太陽・月
    this.sunMat = basic(0xffffff, { fog: false, depthWrite: false });
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 12), this.sunMat);
    this.sunDisc.position.set(-60, 55, -150);
    this.sunDisc.lookAt(0, 0, 0);
    this.sunDisc.renderOrder = -8;
    this.scene.add(this.sunDisc);
    // 雲（島のまわりと下）
    this.cloudMat = lambert(0xffffff);
    this.clouds = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 16; i++) {
      const grp = new THREE.Group();
      const parts = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < parts; j++) {
        const b = new THREE.Mesh(box, this.cloudMat);
        b.scale.set(rnd(4, 9), rnd(1.2, 2.2), rnd(3, 5));
        b.position.set(rnd(-3, 3), rnd(-0.4, 0.6), rnd(-1.5, 1.5));
        grp.add(b);
      }
      const ang = Math.random() * Math.PI * 2, r = rnd(16, 46);
      grp.position.set(Math.cos(ang) * r, rnd(-14, -3), Math.sin(ang) * r - 6);
      grp.userData.spd = rnd(0.2, 0.6);
      this.scene.add(grp);
      this.clouds.push(grp);
    }
    // 遠くの小さな浮き島
    this.farMat = lambert(0x888888);
    this.farTopMat = lambert(0x66aa66);
    this.farIslands = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const g2 = new THREE.Group();
      const w = rnd(2, 4.5);
      const top = new THREE.Mesh(box, this.farTopMat); top.scale.set(w, 0.4, w * rnd(0.7, 1.2)); g2.add(top);
      const b1 = new THREE.Mesh(box, this.farMat); b1.scale.set(w * 0.8, 1.2, w * 0.7); b1.position.y = -0.8; g2.add(b1);
      const b2 = new THREE.Mesh(box, this.farMat); b2.scale.set(w * 0.45, 1.2, w * 0.4); b2.position.y = -1.9; g2.add(b2);
      const ang = (i / 7) * Math.PI * 2 + rnd(-0.3, 0.3), r = rnd(30, 60);
      g2.position.set(Math.cos(ang) * r, rnd(-6, 6), Math.sin(ang) * r - 10);
      g2.userData.bob = Math.random() * 6;
      this.farIslands.add(g2);
    }
    this.scene.add(this.farIslands);
  }

  // ── 浮き島（ゆか・土台・かべ）──
  _buildIsland() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.topMesh = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_TILES));
    this.body1 = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_TILES));
    this.body2 = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_TILES));
    this.body3 = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_TILES));
    this.wallMesh = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_TILES * 3));
    this.wallCap = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_TILES * 3));
    this.glowMat = basic(PAL.yellow);
    this.wallGlow = initInstanced(new THREE.InstancedMesh(box, this.glowMat, MAX_TILES));
    this.grass = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_TILES * 2));
    this.pitMesh = initInstanced(new THREE.InstancedMesh(box, basic(PAL.ink), MAX_TILES * 5));   // 穴の中（暗く見せる）
    for (const m of [this.topMesh, this.body1, this.body2, this.body3, this.wallMesh, this.wallCap, this.wallGlow, this.grass, this.pitMesh]) this.scene.add(m);
    this.tileColors = new Float32Array(MAX_TILES * 3);
    this.tileIdx = new Int16Array(MAX_TILES).fill(-1);   // タイル → topMesh のインスタンス番号
  }

  // ── 鳥居・巻物・トビラ・カギ・小判・トゲ・オニ ──
  _buildProps() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const red = lambert(PAL.red), dark = lambert(PAL.dkbrown), gold = lambert(PAL.gold), cream = lambert(PAL.cream);
    // 鳥居
    const torii = this.torii = new THREE.Group();
    const add = (g, mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(box, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); g.add(m); return m; };
    add(torii, red, 0.12, 1.25, 0.12, -0.42, 0.62, -0.38);
    add(torii, red, 0.12, 1.25, 0.12, 0.42, 0.62, -0.38);
    add(torii, dark, 1.25, 0.1, 0.18, 0, 1.3, -0.38);
    add(torii, red, 1.1, 0.1, 0.14, 0, 1.18, -0.38);
    add(torii, red, 0.95, 0.07, 0.1, 0, 0.98, -0.38);
    this.scene.add(torii);
    // 巻物
    const scroll = this.scroll = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.44, 8), cream);
    body.rotation.z = Math.PI / 2;
    scroll.add(body);
    for (const sx of [-0.25, 0.25]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 8), red);
      cap.rotation.z = Math.PI / 2; cap.position.x = sx; scroll.add(cap);
    }
    const band = new THREE.Mesh(box, red); band.scale.set(0.06, 0.26, 0.26); scroll.add(band);
    this.scene.add(scroll);
    // 台座
    this.pedestal = new THREE.Mesh(box, lambert(PAL.gray));
    this.pedestal.scale.set(0.5, 0.16, 0.5);
    this.scene.add(this.pedestal);
    // トビラ
    const door = this.door = new THREE.Group();
    const wood = lambert(PAL.brown), wood2 = lambert(PAL.tan);
    add(door, wood, 0.12, 1.1, 0.16, -0.46, 0.55, 0);
    add(door, wood, 0.12, 1.1, 0.16, 0.46, 0.55, 0);
    add(door, wood, 1.04, 0.12, 0.18, 0, 1.12, 0);
    this.doorL = add(door, wood2, 0.42, 0.9, 0.08, -0.21, 0.47, 0);
    this.doorR = add(door, wood2, 0.42, 0.9, 0.08, 0.21, 0.47, 0);
    this.doorLock = add(door, gold, 0.12, 0.14, 0.12, 0, 0.5, 0.06);
    this.scene.add(door);
    // カギ
    const key = this.key = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.04, 6, 10), gold);
    ring.position.y = 0.14; key.add(ring);
    add(key, gold, 0.06, 0.32, 0.06, 0, -0.08, 0);
    add(key, gold, 0.1, 0.05, 0.05, 0.06, -0.2, 0);
    add(key, gold, 0.08, 0.05, 0.05, 0.05, -0.12, 0);
    this.scene.add(key);
    // 小判
    const coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 10);
    coinGeo.rotateX(Math.PI / 2);
    coinGeo.scale(0.8, 1.15, 1);
    this.coinMesh = initInstanced(new THREE.InstancedMesh(coinGeo, gold, MAX_COINS));
    this.scene.add(this.coinMesh);
    // トゲ
    const cone = new THREE.ConeGeometry(0.09, 0.32, 4);
    this.spikePlate = initInstanced(new THREE.InstancedMesh(box, basic(PAL.slate), MAX_TILES));
    this.spikeMesh = initInstanced(new THREE.InstancedMesh(cone, lambert(PAL.silver), MAX_TILES * 4));
    this.scene.add(this.spikePlate, this.spikeMesh);
    // オニ
    this.onis = [];
    for (let i = 0; i < MAX_ONI; i++) {
      const g = new THREE.Group();
      const skin = lambert(i % 2 ? PAL.sky : PAL.red);
      const bodyM = add(g, skin, 0.56, 0.5, 0.5, 0, 0.3, 0);
      void bodyM;
      add(g, lambert(PAL.yellow), 0.6, 0.12, 0.54, 0, 0.12, 0);         // 虎柄のパンツ
      const hornMat = lambert(PAL.cream);
      for (const sx of [-0.16, 0.16]) {
        const h = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 4), hornMat);
        h.position.set(sx, 0.64, 0); g.add(h);
      }
      const eyeM = basic(PAL.white), pupM = basic(PAL.ink);
      for (const sx of [-0.12, 0.12]) {
        add(g, eyeM, 0.12, 0.1, 0.04, sx, 0.4, 0.26);
        add(g, pupM, 0.06, 0.06, 0.03, sx, 0.39, 0.285);
      }
      add(g, lambert(PAL.brown), 0.1, 0.5, 0.1, 0.36, 0.38, 0.05);      // こん棒
      g.visible = false;
      this.scene.add(g);
      this.onis.push(g);
    }
  }

  // ── でし（インスタンス描画）──
  _buildAgents() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.agBody = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_AGENTS));
    this.agBand = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_AGENTS));
    this.agTail = initInstanced(new THREE.InstancedMesh(box, lambert(), MAX_AGENTS * 2));
    this.agEye = initInstanced(new THREE.InstancedMesh(box, basic(PAL.white), MAX_AGENTS * 2));
    this.agPupil = initInstanced(new THREE.InstancedMesh(box, basic(PAL.ink), MAX_AGENTS * 2));
    this.agKey = initInstanced(new THREE.InstancedMesh(box, lambert(PAL.gold), MAX_AGENTS));
    this.agShadow = initInstanced(new THREE.InstancedMesh(new THREE.CircleGeometry(0.24, 8).rotateX(-Math.PI / 2), basic(PAL.ink, { transparent: false }), MAX_AGENTS));
    for (const m of [this.agShadow, this.agBody, this.agBand, this.agTail, this.agEye, this.agPupil, this.agKey]) this.scene.add(m);
    // 見た目の状態（でしごと）
    this.ag = [];
    for (let i = 0; i < MAX_AGENTS; i++) {
      this.ag.push({ x: 0, y: 0, px: 0, py: 0, state: 0, t: 0, face: 0, faceTo: 0, cause: 0, color: 0xffffff, band: 0xffffff, key: 0, seed: Math.random() * 10, scale: 1, hi: false });
    }
    this.nAg = 0;
    this.stepFrac = 1;
  }

  // ── パーティクル（小さな四角）──
  _buildParticles() {
    const geo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
    this.ptMesh = initInstanced(new THREE.InstancedMesh(geo, basic(), MAX_PARTICLES));
    this.scene.add(this.ptMesh);
    this.pts = [];
    this.petals = [];
  }

  // ── 方針の矢印・足あと ──
  _buildOverlays() {
    this.arrowMesh = initInstanced(new THREE.InstancedMesh(arrowGeometry(), basic(), MAX_TILES));
    this.waitMesh = initInstanced(new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.02, 0.22), basic(), MAX_TILES));
    this.footMesh = initInstanced(new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.03, 0.12), basic(), MAX_FOOT));
    this.scene.add(this.arrowMesh, this.waitMesh, this.footMesh);
    this.heat = null;
  }

  setTheme(i) {
    i = Math.max(0, Math.min(THEMES.length - 1, i | 0));
    this.themeIdx = i;
    const th = this.theme = THEMES[i];
    this.skyMat.uniforms.zenith.value.set(th.zenith);
    this.skyMat.uniforms.horizon.value.set(th.horizon);
    this.skyMat.uniforms.low.value.set(th.low);
    this.fog.color.set(th.fog);
    this.hemi.intensity = th.hemi;
    this.sun.intensity = th.dir;
    this.stars.visible = th.stars;
    this.sunMat.color.set(th.stars ? PAL.cream : PAL.yellow);
    this.cloudMat.color.set(th.cloud);
    this.farMat.color.set(th.side[1]);
    this.farTopMat.color.set(th.floor[1]);
    this.body1.material.color.set(0xffffff);
    if (this.stage) this.buildStage(this.stage);
  }

  // タイル座標 → ワールド座標
  wx(x) { return x - (this.W - 1) / 2; }
  wz(y) { return y - (this.H - 1) / 2; }

  // ── 修行場を組み立てる ──
  buildStage(stage) {
    this.stage = stage;
    const W = this.W = stage.W, H = this.H = stage.H;
    const th = this.theme;
    const solid = (x, y) => stage.tile(x, y) !== T_VOID;
    let nTop = 0, nB1 = 0, nB2 = 0, nB3 = 0, nW = 0, nC = 0, nG = 0, nGr = 0, nSp = 0, nSpk = 0, nPit = 0;
    this.tileIdx.fill(-1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = stage.tile(x, y);
        if (t === T_VOID) {
          // 島の中の穴は暗い穴に見せる（まわりが地面のところ）
          const pit = (solid(x - 1, y) && solid(x + 1, y)) || (solid(x, y - 1) && solid(x, y + 1));
          if (pit) {
            _m.compose(_v.set(this.wx(x), -0.72, this.wz(y)), _q.identity(), _s.set(1.0, 1.0, 1.0));
            this.pitMesh.setMatrixAt(nPit++, _m);
          }
          continue;
        }
        const X = this.wx(x), Z = this.wz(y);
        // ゆかの天板
        _m.compose(_v.set(X, -0.13, Z), _q.identity(), _s.set(1, 0.26, 1));
        this.topMesh.setMatrixAt(nTop, _m);
        let col = th.floor[(x + y) & 1];
        if (t === T_GOAL) col = PAL.cream;
        else if (t === T_SPIKE_A || t === T_SPIKE_B) col = PAL.gray;
        else if (t === T_DOOR) col = th.floor[1];
        _c.set(col);
        this.tileColors[nTop * 3] = _c.r; this.tileColors[nTop * 3 + 1] = _c.g; this.tileColors[nTop * 3 + 2] = _c.b;
        this.topMesh.setColorAt(nTop, _c);
        this.tileIdx[y * W + x] = nTop;
        nTop++;
        // 土台（端ほど細くなる浮き島）
        _m.compose(_v.set(X, -0.75, Z), _q.identity(), _s.set(1, 1, 1));
        this.body1.setMatrixAt(nB1, _m);
        this.body1.setColorAt(nB1, _c.set(((x * 7 + y * 3) % 5) ? th.side[0] : th.side[1]));
        nB1++;
        const n4 = solid(x - 1, y) + solid(x + 1, y) + solid(x, y - 1) + solid(x, y + 1);
        if (n4 >= 3) {
          const k = n4 === 4 ? 0.92 : 0.7;
          _m.compose(_v.set(X, -1.65, Z), _q.identity(), _s.set(k, 0.8, k));
          this.body2.setMatrixAt(nB2, _m);
          this.body2.setColorAt(nB2, _c.set(th.side[1]));
          nB2++;
          const n8 = n4 + solid(x - 1, y - 1) + solid(x + 1, y - 1) + solid(x - 1, y + 1) + solid(x + 1, y + 1);
          if (n8 >= 7) {
            const k2 = 0.55 + hash2(x, y) * 0.3;
            _m.compose(_v.set(X, -2.4 - hash2(y, x) * 0.6, Z), _q.identity(), _s.set(k2, 0.9, k2));
            this.body3.setMatrixAt(nB3, _m);
            this.body3.setColorAt(nB3, _c.set(th.side[2]));
            nB3++;
          }
        }
        // 草（ゆかの飾り）
        if (t !== T_WALL && t !== T_GOAL && t !== T_DOOR && t !== T_SPIKE_A && t !== T_SPIKE_B && hash2(x + 11, y + 5) < 0.35) {
          const gx = X + (hash2(x, y + 9) - 0.5) * 0.6, gz = Z + (hash2(x + 3, y) - 0.5) * 0.6;
          _m.compose(_v.set(gx, 0.03, gz), _q.identity(), _s.set(0.06, 0.08, 0.06));
          this.grass.setMatrixAt(nGr, _m);
          this.grass.setColorAt(nGr, _c.set(th.floor[1]));
          nGr++;
        }
        // かべ
        if (t === T_WALL) {
          const hh = 0.75 + hash2(x, y) * 0.35;
          if (th.wallStyle === 'bamboo') {
            for (let k = 0; k < 3; k++) {
              const bx = X + (k - 1) * 0.28 + (hash2(x + k, y) - 0.5) * 0.08;
              const bz = Z + (hash2(x, y + k) - 0.5) * 0.4;
              const bh = 0.85 + hash2(x * 3 + k, y) * 0.5;
              _m.compose(_v.set(bx, bh / 2, bz), _q.identity(), _s.set(0.14, bh, 0.14));
              this.wallMesh.setMatrixAt(nW, _m); this.wallMesh.setColorAt(nW, _c.set(th.wall[k & 1])); nW++;
              _m.compose(_v.set(bx, bh * 0.55, bz), _q.identity(), _s.set(0.17, 0.05, 0.17));
              this.wallCap.setMatrixAt(nC, _m); this.wallCap.setColorAt(nC, _c.set(th.wall[1])); nC++;
              _m.compose(_v.set(bx + 0.08, bh + 0.05, bz), _q.identity(), _s.set(0.32, 0.12, 0.2));
              this.wallCap.setMatrixAt(nC, _m); this.wallCap.setColorAt(nC, _c.set(th.wallTop === PAL.yellow ? PAL.lime : th.wallTop)); nC++;
            }
          } else if (th.wallStyle === 'lantern' && hash2(x, y + 1) < 0.5) {
            // 石灯籠
            const parts = [[0.5, 0.18, 0.09], [0.2, 0.42, 0.39], [0.44, 0.1, 0.65], [0.3, 0.24, 0.82], [0.56, 0.1, 1.0], [0.16, 0.12, 1.11]];
            for (const [w, h2, yy] of parts) {
              _m.compose(_v.set(X, yy, Z), _q.identity(), _s.set(w, h2, w));
              this.wallMesh.setMatrixAt(nW, _m); this.wallMesh.setColorAt(nW, _c.set(th.wall[(nW & 1)])); nW++;
            }
            _m.compose(_v.set(X, 0.82, Z), _q.identity(), _s.set(0.18, 0.14, 0.32));
            this.wallGlow.setMatrixAt(nG, _m); nG++;
          } else {
            _m.compose(_v.set(X, hh / 2, Z), _q.setFromEuler(_e.set(0, (hash2(y, x) - 0.5) * 0.3, 0)), _s.set(0.9, hh, 0.9));
            this.wallMesh.setMatrixAt(nW, _m); this.wallMesh.setColorAt(nW, _c.set(th.wall[(x + y) & 1])); nW++;
            _m.compose(_v.set(X, hh + 0.05, Z), _q, _s.set(0.94, 0.12, 0.94));
            this.wallCap.setMatrixAt(nC, _m); this.wallCap.setColorAt(nC, _c.set(th.wallTop)); nC++;
          }
        }
        // トゲの台
        if (t === T_SPIKE_A || t === T_SPIKE_B) {
          _m.compose(_v.set(X, 0.02, Z), _q.identity(), _s.set(0.86, 0.05, 0.86));
          this.spikePlate.setMatrixAt(nSp, _m);
          this.spikePlate.setColorAt(nSp, _c.set(t === T_SPIKE_A ? PAL.steel : PAL.slate));
          // トゲの穴（4つ）
          for (let j = 0; j < 4; j++) {
            const ox = (j & 1 ? 0.18 : -0.18), oz = (j & 2 ? 0.18 : -0.18);
            _m.compose(_v.set(X + ox, 0.05, Z + oz), _q.identity(), _s.set(0.12, 0.01, 0.12));
            this.pitMesh.setMatrixAt(nPit++, _m);
          }
          nSp++;
          nSpk += 4;
        }
      }
    }
    this.topMesh.count = nTop; this.body1.count = nB1; this.body2.count = nB2; this.body3.count = nB3;
    this.wallMesh.count = nW; this.wallCap.count = nC; this.wallGlow.count = nG; this.grass.count = nGr;
    this.pitMesh.count = nPit; this.pitMesh.instanceMatrix.needsUpdate = true;
    this.spikePlate.count = nSp;
    this.spikeMesh.count = nSpk;
    for (const m of [this.topMesh, this.body1, this.body2, this.body3, this.wallMesh, this.wallCap, this.wallGlow, this.grass, this.spikePlate]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // 小道具の配置
    const gx = this.wx(stage.goal.x), gz = this.wz(stage.goal.y);
    this.torii.position.set(gx, 0, gz);
    this.pedestal.position.set(gx, 0.08, gz);
    this.scroll.position.set(gx, 0.55, gz);
    this.door.visible = false;
    for (let i = 0; i < stage.W * stage.H; i++) {
      if (stage.tiles[i] === T_DOOR) {
        this.door.visible = true;
        this.door.position.set(this.wx(i % W), 0, this.wz(Math.floor(i / W)));
      }
    }
    this.doorOpen = 0; this.doorOpenTo = 0;
    this.key.visible = stage.hasKey;
    if (stage.hasKey) this.key.position.set(this.wx(stage.keyIdx % W), 0.45, this.wz(Math.floor(stage.keyIdx / W)));
    this.coinVis = new Uint8Array(stage.coins.length).fill(1);
    this.keyVis = 1;
    for (let e = 0; e < MAX_ONI; e++) this.onis[e].visible = e < stage.enemies.length;
    this.spikeTiles = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = stage.tile(x, y);
      if (t === T_SPIKE_A || t === T_SPIKE_B) this.spikeTiles.push({ x, y, t, h: 0 });
    }
    this.envT = 0;
    this.setHeat(null);
    this.setArrows(null);
    this.setFootprints(null);
    this.nAg = 0;
    this._spawnPetals(true);
    this.frameCamera(this.cam.aspect || 1, this.frameOpts);
  }

  // ── でしの同期（1ステップごと）──
  // list[i] = { x, y, px, py, done, cause, color, band, key, hi }
  syncAgents(list) {
    const n = this.nAg = Math.min(MAX_AGENTS, list.length);
    for (let i = 0; i < n; i++) {
      const a = list[i], g = this.ag[i];
      g.px = a.px; g.py = a.py; g.x = a.x; g.y = a.y;
      g.color = a.color; g.band = a.band; g.key = a.key ? 1 : 0; g.hi = !!a.hi;
      if (a.x !== a.px || a.y !== a.py) g.faceTo = Math.atan2(a.x - a.px, a.y - a.py);
      if (a.done && g.state === 0) {
        g.state = a.cause === C_FALL ? 1 : a.cause === C_GOAL ? 3 : (a.cause === 5 ? 5 : 2);
        g.t = 0; g.cause = a.cause;
      } else if (!a.done && g.state !== 0) {
        g.state = 0; g.t = 0;
      }
    }
    this.stepFrac = 0;
  }

  // エピソードの最初に全員をスタートに戻す
  resetAgents(list) {
    for (let i = 0; i < MAX_AGENTS; i++) { this.ag[i].state = 0; this.ag[i].t = 0; this.ag[i].faceTo = Math.PI; this.ag[i].face = Math.PI; }
    this.syncAgents(list);
    this.stepFrac = 1;
  }

  setStepFrac(f) { this.stepFrac = Math.max(0, Math.min(1, f)); }

  // ── オニ・トゲ・アイテムの状態 ──
  setEnv(t, frac) { this.envT = t; this.envFrac = frac; }
  setItems(keyVisible, coinsVisible, doorOpen) {
    this.keyVis = keyVisible ? 1 : 0;
    if (coinsVisible) for (let i = 0; i < this.coinVis.length; i++) this.coinVis[i] = coinsVisible[i] ? 1 : 0;
    this.doorOpenTo = doorOpen ? 1 : 0;
  }

  // 価値・自信の色をゆかに重ねる（arr[タイル] = 色(hex) or -1）
  setHeat(arr) {
    this.heat = arr;
    if (!this.stage) return;
    const W = this.W;
    for (let i = 0; i < W * this.H; i++) {
      const k = this.tileIdx[i];
      if (k < 0) continue;
      if (arr && arr[i] >= 0) _c.set(arr[i]);
      else _c.setRGB(this.tileColors[k * 3], this.tileColors[k * 3 + 1], this.tileColors[k * 3 + 2]);
      this.topMesh.setColorAt(k, _c);
    }
    this.topMesh.instanceColor.needsUpdate = true;
  }

  // 方針の矢印（arr[タイル] = {a: 行動, c: 色, s: 大きさ} or null）
  setArrows(arr) {
    let na = 0, nw = 0;
    if (arr && this.stage) {
      const W = this.W;
      for (let i = 0; i < arr.length; i++) {
        const o = arr[i];
        if (!o) continue;
        const X = this.wx(i % W), Z = this.wz(Math.floor(i / W));
        if (o.a === 4) {
          _m.compose(_v.set(X, 0.03, Z), _q.identity(), _s.set(o.s, 1, o.s));
          this.waitMesh.setMatrixAt(nw, _m); this.waitMesh.setColorAt(nw, _c.set(o.c)); nw++;
        } else {
          const rot = [0, Math.PI, Math.PI / 2, -Math.PI / 2][o.a];
          _m.compose(_v.set(X, 0.03, Z), _q.setFromAxisAngle(_up, rot), _s.set(o.s, 1, o.s));
          this.arrowMesh.setMatrixAt(na, _m); this.arrowMesh.setColorAt(na, _c.set(o.c)); na++;
        }
      }
    }
    this.arrowMesh.count = na; this.waitMesh.count = nw;
    this.arrowMesh.instanceMatrix.needsUpdate = true; this.waitMesh.instanceMatrix.needsUpdate = true;
    if (na) this.arrowMesh.instanceColor.needsUpdate = true;
    if (nw) this.waitMesh.instanceColor.needsUpdate = true;
  }

  // 足あと（list = [[x,y], ...], color）
  setFootprints(list, color = PAL.white) {
    let n = 0;
    if (list) {
      for (let i = 0; i < list.length && n < MAX_FOOT; i++) {
        const [x, y] = list[i];
        if (!this.stage || this.stage.tile(x, y) === T_VOID) continue;
        const k = hash2(i, x + y * 13);
        _m.compose(_v.set(this.wx(x) + (k - 0.5) * 0.2, 0.02, this.wz(y) + (hash2(x, i) - 0.5) * 0.2), _q.identity(), _s.set(1, 1, 1));
        this.footMesh.setMatrixAt(n, _m);
        this.footMesh.setColorAt(n, _c.set(color));
        n++;
      }
    }
    this.footMesh.count = n;
    this.footMesh.instanceMatrix.needsUpdate = true;
    if (n) this.footMesh.instanceColor.needsUpdate = true;
  }

  // ── パーティクル ──
  burst(x, y, kind, count = 10) {
    const X = this.wx(x), Z = this.wz(y);
    const cols = {
      goal: [PAL.yellow, PAL.gold, PAL.white, PAL.cyan],
      coin: [PAL.yellow, PAL.gold, PAL.white],
      key: [PAL.yellow, PAL.gold],
      poof: [PAL.white, PAL.silver, PAL.gray],
      oni: [PAL.red, PAL.white, PAL.orange],
      dust: [this.theme.side[0], PAL.cream],
      learn: [PAL.cyan, PAL.white, PAL.sky],
      evolve: [PAL.lime, PAL.yellow, PAL.white],
    }[kind] || [PAL.white];
    for (let i = 0; i < count; i++) {
      if (this.pts.length >= MAX_PARTICLES - 60) break;
      const a = Math.random() * Math.PI * 2, sp = kind === 'dust' ? 0.6 : 1.5 + Math.random() * 1.5;
      this.pts.push({
        x: X + (Math.random() - 0.5) * 0.3, y: kind === 'dust' ? 0.05 : 0.4, z: Z + (Math.random() - 0.5) * 0.3,
        vx: Math.cos(a) * sp * 0.6, vy: kind === 'dust' ? 0.6 : 2 + Math.random() * 2.5, vz: Math.sin(a) * sp * 0.6,
        life: 0.5 + Math.random() * 0.5, t: 0, c: cols[i % cols.length], g: kind === 'dust' ? 2 : 6, s: kind === 'dust' ? 0.8 : 1,
      });
    }
  }

  _spawnPetals(reset = false) {
    if (reset) this.petals = [];
    const target = 28;
    while (this.petals.length < target) {
      this.petals.push({
        x: (Math.random() - 0.5) * (this.W + 6), y: 3 + Math.random() * 6, z: (Math.random() - 0.5) * (this.H + 6),
        vx: 0.2 + Math.random() * 0.3, vy: -(0.25 + Math.random() * 0.35), ph: Math.random() * 6, c: this.theme.petal[Math.random() < 0.5 ? 0 : 1],
      });
    }
  }

  // ── カメラ ──
  // 島がちょうど画面に収まる距離を二分探索で求める（marginTop/Bottom は NDC での余白）
  frameCamera(aspect, opts = this.frameOpts) {
    this.frameOpts = opts || {};
    const c = this.cam, cam = this.camera;
    c.aspect = aspect;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    // 実際に物がある所の点（ゆかの角・土台の底・かべの上・鳥居の上）
    const pts = [];
    const st = this.stage;
    if (st) {
      const tall = this.theme.wallStyle === 'bamboo' ? 2.2 : 1.15;
      for (let y = 0; y < st.H; y++) for (let x = 0; x < st.W; x++) {
        const t = st.tile(x, y);
        if (t === T_VOID) continue;
        const X = this.wx(x), Z = this.wz(y);
        for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
          pts.push([X + dx, 0, Z + dz]);
          pts.push([X + dx, -1.25, Z + dz]);
          if (t === T_WALL) pts.push([X + dx, tall, Z + dz]);
        }
        if (t === T_GOAL) { pts.push([X - 0.6, 1.4, Z - 0.4]); pts.push([X + 0.6, 1.4, Z - 0.4]); }
      }
    } else {
      for (const x of [-4.5, 4.5]) for (const z of [-4.5, 4.5]) { pts.push([x, 0, z]); pts.push([x, -1.25, z]); }
    }
    const mx = opts.mx ?? 0.94, top = opts.top ?? 0.9, bot = opts.bot ?? -0.94;
    const saveMode = c.mode;
    c.mode = 'fixed';
    // 縦方向の中心をずらして上下の余白をそろえる
    c.look.set(0, 0, 0);
    let lo = 4, hi = 120;
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2;
      c.dist = mid; c.zoom = 1;
      this._updateCamera(0);
      let ok = true, ymin = 1e9, ymax = -1e9;
      for (const p of pts) {
        _v.set(p[0], p[1], p[2]).project(cam);
        if (Math.abs(_v.x) > mx) ok = false;
        ymin = Math.min(ymin, _v.y); ymax = Math.max(ymax, _v.y);
      }
      if (ymax - ymin > top - bot) ok = false;
      if (ok) hi = mid; else lo = mid;
    }
    c.dist = hi;
    this._updateCamera(0);
    // 上下の位置合わせ：見えている範囲の中心が (top+bot)/2 に来るように注視点を前後へ（2回くり返して合わせる）
    const worldPerNdc = c.dist * Math.tan(cam.fov * Math.PI / 360) / Math.sin(c.pitch);
    for (let it = 0; it < 3; it++) {
      let ymin = 1e9, ymax = -1e9;
      for (const p of pts) { _v.set(p[0], p[1], p[2]).project(cam); ymin = Math.min(ymin, _v.y); ymax = Math.max(ymax, _v.y); }
      const want = (top + bot) / 2, have = (ymin + ymax) / 2;
      c.look.z += (want - have) * worldPerNdc;
      this._updateCamera(0);
    }
    this.baseLook = c.look.clone();
    c.mode = saveMode;
  }

  _updateCamera(dt) {
    const c = this.cam, cam = this.camera;
    let yaw = c.yaw;
    if (c.mode === 'orbit') { c.orbit += dt * 0.12; yaw = Math.sin(c.orbit) * 0.5; }
    const d = c.dist / c.zoom;
    const lx = c.look.x, ly = c.look.y, lz = c.look.z;
    cam.position.set(lx + Math.sin(yaw) * Math.cos(c.pitch) * d, ly + Math.sin(c.pitch) * d, lz + Math.cos(yaw) * Math.cos(c.pitch) * d);
    cam.lookAt(lx, ly, lz);
    cam.updateMatrixWorld();
  }

  // 3D の点 → 画面（3D表示部分）の仮想ピクセル
  project(X, Y, Z, vw, vh) {
    _v.set(X, Y, Z).project(this.camera);
    return { x: (_v.x * 0.5 + 0.5) * vw, y: (-_v.y * 0.5 + 0.5) * vh, z: _v.z };
  }
  projectTile(x, y, h, vw, vh) { return this.project(this.wx(x), h, this.wz(y), vw, vh); }

  // 画面の点（3D表示部分）→ タイル（ゆか y=0 との交点）
  pickTile(sx, sy, vw, vh) {
    const ndc = new THREE.Vector3(sx / vw * 2 - 1, -(sy / vh * 2 - 1), 0.5);
    ndc.unproject(this.camera);
    const o = this.camera.position, dir = ndc.sub(o).normalize();
    if (Math.abs(dir.y) < 1e-4) return null;
    const t = -o.y / dir.y;
    if (t < 0) return null;
    const X = o.x + dir.x * t, Z = o.z + dir.z * t;
    return { x: Math.round(X + (this.W - 1) / 2), y: Math.round(Z + (this.H - 1) / 2), fx: X + (this.W - 1) / 2, fy: Z + (this.H - 1) / 2 };
  }

  // でしの見た目上の位置（UIの吹き出し・選択マーク用）
  agentPos(i) {
    const g = this.ag[i];
    if (!g) return null;
    const f = this._ease(this.stepFrac);
    return { X: this.wx(g.px + (g.x - g.px) * f), Z: this.wz(g.py + (g.y - g.py) * f), visible: g.state === 0 || g.t < 0.3 };
  }

  _ease(f) { return f < 0 ? 0 : f > 1 ? 1 : f; }

  // ── 毎フレーム ──
  update(dt) {
    this.time += dt;
    const t = this.time;
    this._updateCamera(dt);
    // 巻物と小道具
    this.scroll.position.y = 0.6 + Math.sin(t * 2.2) * 0.07;
    this.scroll.rotation.y = t * 1.4;
    if (this.key.visible) {
      this.key.rotation.y = t * 2;
      this.key.position.y = 0.5 + Math.sin(t * 3) * 0.06;
      this.key.scale.setScalar(this.keyVis ? 1.6 : 0.0001);
    }
    this.doorOpen += (this.doorOpenTo - this.doorOpen) * Math.min(1, dt * 6);
    this.doorL.position.x = -0.21 - this.doorOpen * 0.34;
    this.doorR.position.x = 0.21 + this.doorOpen * 0.34;
    this.doorLock.visible = this.doorOpen < 0.2;
    // 小判
    if (this.stage) {
      const st = this.stage;
      let nc = 0;
      for (let i = 0; i < st.coins.length && nc < MAX_COINS; i++) {
        const c = st.coins[i];
        const vis = this.coinVis[i];
        _m.compose(_v.set(this.wx(c.x), 0.32 + Math.sin(t * 3 + i) * 0.04, this.wz(c.y)), _q.setFromAxisAngle(_up, t * 2.5 + i), _s.setScalar(vis ? 1 : 0.0001));
        this.coinMesh.setMatrixAt(nc++, _m);
      }
      this.coinMesh.count = nc;
      this.coinMesh.instanceMatrix.needsUpdate = true;
      // トゲ（次の時刻に出るものは少し前から上がりはじめる）
      let k = 0;
      const tt = this.envT + (this.envFrac || 0);
      for (const sp of this.spikeTiles) {
        const on = st.spikeOn(sp.t, Math.floor(tt));
        const target = on ? 1 : 0;
        sp.h += (target - sp.h) * Math.min(1, dt * 14);
        const X = this.wx(sp.x), Z = this.wz(sp.y);
        for (let j = 0; j < 4; j++) {
          const ox = (j & 1 ? 0.18 : -0.18), oz = (j & 2 ? 0.18 : -0.18);
          _m.compose(_v.set(X + ox, -0.06 + sp.h * 0.22, Z + oz), _q.identity(), _s.set(1.15, 0.45 + sp.h * 0.75, 1.15));
          this.spikeMesh.setMatrixAt(k++, _m);
        }
      }
      this.spikeMesh.count = k;
      this.spikeMesh.instanceMatrix.needsUpdate = true;
      // オニ（ぴょんぴょん動く）
      const f = this._ease(this.envFrac ?? 1);
      for (let e = 0; e < st.enemies.length && e < MAX_ONI; e++) {
        const a = st.enemyPos(e, Math.max(0, this.envT - 1)), b = st.enemyPos(e, this.envT);
        const ax = a % st.W, ay = Math.floor(a / st.W), bx = b % st.W, by = Math.floor(b / st.W);
        const g = this.onis[e];
        const moving = a !== b;
        const ff = this.envT === 0 ? 1 : f;
        g.position.set(this.wx(ax + (bx - ax) * ff), (moving ? Math.sin(ff * Math.PI) * 0.3 : 0) + Math.abs(Math.sin(t * 4 + e)) * 0.03, this.wz(ay + (by - ay) * ff));
        // 次に向かう方向を向く
        const c2 = st.enemyPos(e, this.envT + 1);
        const cx = c2 % st.W, cy = Math.floor(c2 / st.W);
        if (cx !== bx || cy !== by) g.rotation.y = Math.atan2(cx - bx, cy - by);
      }
    }
    // 雲・遠くの島
    for (const c of this.clouds) { c.position.x += c.userData.spd * dt; if (c.position.x > 60) c.position.x = -60; }
    for (const g of this.farIslands.children) g.position.y += Math.sin(t * 0.5 + g.userData.bob) * dt * 0.15;
    this._updateAgents(dt);
    this._updateParticles(dt);
  }

  _updateAgents(dt) {
    const f = this._ease(this.stepFrac);
    const n = this.nAg;
    // 同じマスにいる人数（重ならないように少しずらす）
    const occ = new Map();
    let ib = 0, it = 0, ie = 0;
    for (let i = 0; i < n; i++) {
      const g = this.ag[i];
      if (g.state !== 0 && g.t > 1.2) {
        this.agBody.setMatrixAt(i, ZERO); this.agBand.setMatrixAt(i, ZERO); this.agShadow.setMatrixAt(i, ZERO); this.agKey.setMatrixAt(i, ZERO);
        continue;
      }
      if (g.state !== 0 && f >= 1) g.t += dt;
      const key = (g.state === 0 || f < 1 ? g.y * 64 + g.x : -1 - i);
      const rank = occ.get(key) || 0;
      occ.set(key, rank + 1);
      // 向きをなめらかに
      let dA = g.faceTo - g.face;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      g.face += dA * Math.min(1, dt * 14);
      let X = this.wx(g.px + (g.x - g.px) * f), Z = this.wz(g.py + (g.y - g.py) * f);
      const moved = g.x !== g.px || g.y !== g.py;
      let Y = moved ? Math.sin(f * Math.PI) * 0.32 : 0;
      let sc = 1, sy = 1, spin = 0;
      // 群れのずらし（らせん状）
      if (rank > 0) {
        const ang = rank * 2.4, r = 0.13 + 0.05 * Math.sqrt(rank);
        X += Math.cos(ang) * Math.min(0.32, r); Z += Math.sin(ang) * Math.min(0.32, r);
      }
      if (n > 24) sc = 0.78; else if (n > 10) sc = 0.88;
      // ぴょこぴょこ（待っている時）
      if (!moved && g.state === 0) Y += Math.abs(Math.sin(this.time * 5 + g.seed)) * 0.04;
      // 着地のつぶれ
      if (moved && f > 0.85) { sy = 1 - (1 - (1 - f) / 0.15) * 0.18; }
      let showShadow = true;
      if (g.state === 1) {          // 落ちる
        Y = -g.t * g.t * 9; spin = g.t * 9; showShadow = false; sc *= Math.max(0.3, 1 - g.t * 0.4);
      } else if (g.state === 2) {   // やられた
        sy = Math.max(0.05, 1 - g.t * 4); sc *= 1 + g.t * 0.5;
        if (g.t > 0.35) sc = 0;
      } else if (g.state === 3) {   // ゴール
        Y = Math.sin(Math.min(1, g.t * 2) * Math.PI) * 0.7; spin = g.t * 12; sc *= Math.max(0, 1 - Math.max(0, g.t - 0.6) * 2.5);
      } else if (g.state === 5) {   // 時間切れ
        sy = 0.85; Y = 0; sc *= Math.max(0, 1 - g.t * 1.2);
      }
      if (g.hi) sc *= 1.12;
      const bodyH = 0.5 * sy * sc;
      _q.setFromEuler(_e.set(0, g.face + spin, 0));
      _m.compose(_v.set(X, Y + bodyH / 2 + 0.02, Z), _q, _s.set(0.56 * sc, bodyH, 0.56 * sc));
      this.agBody.setMatrixAt(i, _m);
      this.agBody.setColorAt(i, _c.set(g.color));
      _m.compose(_v.set(X, Y + bodyH * 0.8 + 0.02, Z), _q, _s.set(0.59 * sc, 0.1 * sc, 0.59 * sc));
      this.agBand.setMatrixAt(i, _m);
      this.agBand.setColorAt(i, _c.set(g.band));
      // 鉢巻のしっぽ・目
      const fwd = _v.set(0, 0, 1).applyQuaternion(_q).clone();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_q);
      for (let k = 0; k < 2; k++) {
        const side = k ? 1 : -1;
        const tx = X - fwd.x * 0.33 * sc + right.x * side * 0.07 * sc, tz = Z - fwd.z * 0.33 * sc + right.z * side * 0.07 * sc;
        const wob = Math.sin(this.time * 9 + g.seed + k) * 0.03;
        _m.compose(_v.set(tx, Y + bodyH * 0.75 + wob, tz), _q, _s.set(0.06 * sc, 0.05 * sc, 0.16 * sc));
        this.agTail.setMatrixAt(it, _m); this.agTail.setColorAt(it, _c.set(g.band)); it++;
        if (sc > 0.05) {
          const ex = X + fwd.x * 0.285 * sc + right.x * side * 0.12 * sc, ez = Z + fwd.z * 0.285 * sc + right.z * side * 0.12 * sc;
          const blink = (Math.sin(this.time * 1.3 + g.seed * 3) > 0.97) ? 0.2 : 1;
          const ey = Y + bodyH * 0.55;
          _m.compose(_v.set(ex, ey, ez), _q, _s.set(0.13 * sc, 0.15 * sc * blink, 0.03));
          this.agEye.setMatrixAt(ie, _m);
          _m.compose(_v.set(ex + fwd.x * 0.012, ey - 0.015 * sc, ez + fwd.z * 0.012), _q, _s.set(0.07 * sc, 0.09 * sc * blink, 0.03));
          this.agPupil.setMatrixAt(ie, _m);
          ie++;
        }
      }
      // カギを持っていたら頭の上に
      if (g.key && g.state === 0) {
        _m.compose(_v.set(X, Y + bodyH + 0.18, Z), _q.setFromAxisAngle(_up, this.time * 3), _s.set(0.1, 0.16, 0.05));
        this.agKey.setMatrixAt(i, _m);
      } else this.agKey.setMatrixAt(i, ZERO);
      if (showShadow && Y < 1) {
        _m.compose(_v.set(X, 0.012, Z), _q.identity(), _s.setScalar(Math.max(0.2, 1 - Y) * sc * (g.state === 0 ? 1 : Math.max(0, 1 - g.t * 2))));
        this.agShadow.setMatrixAt(i, _m);
      } else this.agShadow.setMatrixAt(i, ZERO);
      ib++;
    }
    void ib;
    for (const m of [this.agBody, this.agBand, this.agShadow, this.agKey]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor && n) m.instanceColor.needsUpdate = true;
    }
    this.agTail.count = it; this.agTail.instanceMatrix.needsUpdate = true; if (it) this.agTail.instanceColor.needsUpdate = true;
    this.agEye.count = ie; this.agEye.instanceMatrix.needsUpdate = true;
    this.agPupil.count = ie; this.agPupil.instanceMatrix.needsUpdate = true;
  }

  _updateParticles(dt) {
    let n = 0;
    const pm = this.ptMesh;
    const keep = [];
    for (const p of this.pts) {
      p.t += dt;
      if (p.t > p.life) continue;
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03 && p.vy < 0) { p.y = 0.03; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
      const s = p.s * (1 - p.t / p.life * 0.6);
      _m.compose(_v.set(p.x, p.y, p.z), _q.identity(), _s.setScalar(s));
      pm.setMatrixAt(n, _m); pm.setColorAt(n, _c.set(p.c)); n++;
      keep.push(p);
    }
    this.pts = keep;
    // 花びら・葉・ほたる
    const night = this.theme.stars;
    for (const p of this.petals) {
      p.ph += dt;
      p.x += (p.vx + Math.sin(p.ph * 1.7) * 0.3) * dt;
      p.y += (night ? Math.sin(p.ph) * 0.2 : p.vy) * dt;
      p.z += Math.cos(p.ph * 1.3) * 0.25 * dt;
      if (p.y < -4 || p.x > this.W / 2 + 4) {
        p.x = -(this.W / 2 + 3) + Math.random() * 2; p.y = 2 + Math.random() * 6; p.z = (Math.random() - 0.5) * (this.H + 6);
      }
      if (n >= MAX_PARTICLES) break;
      const tw = night ? (Math.sin(p.ph * 3) > 0 ? 1 : 0.0001) : 1;
      _m.compose(_v.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.ph, p.ph * 0.7, 0)), _s.set(0.9 * tw, 0.4 * tw, 0.9 * tw));
      pm.setMatrixAt(n, _m); pm.setColorAt(n, _c.set(p.c)); n++;
    }
    pm.count = n;
    pm.instanceMatrix.needsUpdate = true;
    if (n) pm.instanceColor.needsUpdate = true;
  }
}
