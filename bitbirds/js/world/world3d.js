// 3Dワールド（Three.js r128）
// 渓谷・空・山・雲・障害物・鳥・パーティクル・カメラをまとめて扱う。
// 描画は PixelRenderer が低解像度＋32色に変換するので、ここでは素直なローポリで作る。

import { WORLD, THEMES, FAMILIES } from '../core/config.js';
import { OB_GATE, OB_PILLAR, OB_LOG } from '../sim/course.js';

const THREE = window.THREE;

const MAX_BIRDS = 96;
const MAX_GATES = 16;
const MAX_PILLARS = 110;
const MAX_LOGS = 48;
const MAX_PARTICLES = 700;
const AHEAD = 110, BEHIND = 16;
const WALL_H = 12;
const CLIFF_H = 15;
const TILE = 4;          // 地面テクスチャの繰り返し(m)
const CLIFF_PERIOD = 24; // がけの凹凸の繰り返し(m)

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _mw1 = new THREE.Matrix4();
const _mw2 = new THREE.Matrix4();
const _qI = new THREE.Quaternion();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

function hexColor(h) { return new THREE.Color(h); }

// インスタンスの色バッファを最大数ぶん先に作っておく
// （setColorAt は count が 0 の時に呼ぶと空のバッファを作ってしまうため）
function initInstanced(im) {
  const n = im.instanceMatrix.count;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
  im.instanceColor.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false;
  im.count = 0;
}

function makeTexture(w, h, fn) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y);
    const i = (y * w + x) * 4;
    data[i] = (c >> 16) & 255; data[i + 1] = (c >> 8) & 255; data[i + 2] = c & 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export class World3D {
  constructor() {
    const s = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 175);
    this.camera.position.set(0, 7, 8);
    this.fog = new THREE.Fog(0xffffff, 30, 95);
    s.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 0.7);
    s.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
    this.sunLight.position.set(-5, 12, 7);
    s.add(this.sunLight);
    this.theme = THEMES[0];
    this.time = 0;
    this._buildSky();
    this._buildTerrain();
    this._buildDecor();
    this._buildObstacles();
    this._buildBirds();
    this._buildParticles();
    this._buildGoal();
    this.cam = { mode: 0, pos: new THREE.Vector3(0, 7, 8), look: new THREE.Vector3(0, 5, -10), fov: 62 };
    this.camZ = 0;
    this.setTheme(0);
  }

  // ── 空 ──
  _buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, low: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 zenith; uniform vec3 horizon; uniform vec3 low; varying vec3 vDir;' +
        'void main(){ float h = normalize(vDir).y; vec3 c = h > 0.0 ? mix(horizon, zenith, smoothstep(0.0, 0.5, h)) : mix(horizon, low, smoothstep(0.0, -0.25, h)); gl_FragColor = vec4(c, 1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(150, 16, 10), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    // 星
    const n = 220, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, y = 0.08 + Math.random() * 0.9;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 140; pos[i * 3 + 1] = y * 140; pos[i * 3 + 2] = Math.sin(th) * r * 140;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    // 太陽／月
    this.sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false });
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(7, 10), this.sunMat);
    this.sunDisc.renderOrder = -8;
    this.scene.add(this.sunDisc);
  }

  // ── 地面とがけ ──
  _buildTerrain() {
    this.groundMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const gg = new THREE.PlaneGeometry(120, 280, 1, 1);
    gg.rotateX(-Math.PI / 2);
    const uv = gg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 120 / TILE, uv.getY(i) * 280 / TILE);
    this.ground = new THREE.Mesh(gg, this.groundMat);
    this.ground.position.set(0, 0, -100);
    this.scene.add(this.ground);
    // がけ（内向きの面だけ見える。外側からは透けるので「よこ」カメラが使える）
    this.cliffMat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 0, specular: 0x000000 });
    this.cliffs = [];
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(CLIFF_PERIOD * 11, CLIFF_H + 1, 66, 7);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i), v = p.getY(i) + (CLIFF_H + 1) / 2;   // u: 長さ方向, v: 高さ
        const n = Math.abs(Math.sin(u * Math.PI * 2 / 24 * 1 + v * 0.7) * 0.6 + Math.sin(u * Math.PI * 2 / 8 + v * 1.9) * 0.45 + Math.sin(u * Math.PI * 2 / 6 + 1.3) * 0.3);
        p.setZ(i, -n * 1.1 - 0.05);   // 平面の裏側（外側）へだけへこませる
        p.setY(i, v - 0.5);
      }
      geo.rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2);
      const ng = geo.toNonIndexed();
      ng.computeVertexNormals();
      ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 3), 3));
      const mesh = new THREE.Mesh(ng, this.cliffMat);
      mesh.position.set(side < 0 ? WORLD.XMIN : WORLD.XMAX, 0, 0);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.cliffs.push(mesh);
      // がけの上の台地
      const tg = new THREE.PlaneGeometry(60, 280);
      const tuv = tg.attributes.uv;
      for (let j = 0; j < tuv.count; j++) tuv.setXY(j, tuv.getX(j) * 60 / TILE, tuv.getY(j) * 280 / TILE);
      const top = new THREE.Mesh(tg, this.groundMat);
      top.rotation.x = -Math.PI / 2;
      top.position.set(side * (Math.abs(WORLD.XMIN) + 30.5), CLIFF_H, -100);
      this.scene.add(top);
      mesh.userData.top = top;
    }
  }

  // ── 遠くの山と雲 ──
  _buildDecor() {
    this.mtnMat = new THREE.MeshBasicMaterial({ color: 0x888888, fog: false });
    this.mtnMat2 = new THREE.MeshBasicMaterial({ color: 0x666666, fog: false });
    this.mountains = new THREE.Group();
    const rng = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 14; i++) {
      const far = i < 8;
      const m = new THREE.Mesh(new THREE.ConeGeometry(rng(18, 34), rng(16, 34), 5, 1), far ? this.mtnMat : this.mtnMat2);
      const ang = rng(-1.2, 1.2);
      const dist = far ? rng(128, 140) : rng(108, 120);
      m.position.set(Math.sin(ang) * dist, 0, -Math.cos(ang) * dist);
      m.rotation.y = rng(0, 3);
      m.renderOrder = -7;
      this.mountains.add(m);
    }
    this.scene.add(this.mountains);
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.clouds = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const parts = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < parts; j++) {
        const b = new THREE.Mesh(box, this.cloudMat);
        b.scale.set(rng(5, 11), rng(1.4, 2.6), rng(3, 6));
        b.position.set(rng(-4, 4), rng(-0.5, 0.8), rng(-2, 2));
        g.add(b);
      }
      g.position.set(rng(-50, 50), rng(17, 30), -rng(0, 220));
      this.scene.add(g);
      this.clouds.push(g);
    }
  }

  // ── 障害物（インスタンス描画）──
  _buildObstacles() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.panelMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.panels = new THREE.InstancedMesh(box, this.panelMat, MAX_GATES * 4);
    this.frameMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.frames = new THREE.InstancedMesh(box, this.frameMat, MAX_GATES * 4);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    this.pillarMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.pillars = new THREE.InstancedMesh(cyl, this.pillarMat, MAX_PILLARS);
    const cylX = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    cylX.rotateZ(Math.PI / 2);
    this.logMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.logs = new THREE.InstancedMesh(cylX, this.logMat, MAX_LOGS);
    // 柱・丸太の帯（ドット絵らしいアクセント）
    this.bandMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.bands = new THREE.InstancedMesh(cyl, this.bandMat, MAX_PILLARS * 2 + MAX_LOGS * 2);
    for (const im of [this.panels, this.frames, this.pillars, this.logs, this.bands]) {
      initInstanced(im);
      this.scene.add(im);
    }
    // カメラと鳥の間にある障害物は半透明（ディザで透ける）にして、鳥が見えるようにする
    const ghost = (src, max) => {
      const m = src.material.clone();
      m.transparent = true; m.opacity = 0.22; m.depthWrite = false;
      const im = new THREE.InstancedMesh(src.geometry, m, max);
      initInstanced(im);
      im.renderOrder = 5;
      this.scene.add(im);
      return im;
    };
    this.gPanels = ghost(this.panels, 8 * 4);
    this.gFrames = ghost(this.frames, 8 * 4);
    this.gPillars = ghost(this.pillars, 24);
    this.gLogs = ghost(this.logs, 12);
    this.solid = { panels: this.panels, frames: this.frames, pillars: this.pillars, logs: this.logs, bands: this.bands };
    this.ghost = { panels: this.gPanels, frames: this.gFrames, pillars: this.gPillars, logs: this.gLogs, bands: null };
  }

  // ── 鳥（部位ごとのインスタンス）──
  _buildBirds() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mat = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mk = (m) => {
      const im = new THREE.InstancedMesh(box, m, MAX_BIRDS);
      initInstanced(im);
      this.scene.add(im);
      return im;
    };
    this.bBody = mk(mat());
    this.bHead = mk(mat());
    this.bWingL = mk(mat());
    this.bWingR = mk(mat());
    this.bTail = mk(mat());
    this.bBeak = mk(new THREE.MeshLambertMaterial({ color: 0xf77622 }));
    this.bEye = mk(new THREE.MeshBasicMaterial({ color: 0x181425 }));
    // 足もとの影
    const disc = new THREE.CircleGeometry(0.5, 8);
    disc.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
    this.bShadow = new THREE.InstancedMesh(disc, this.shadowMat, MAX_BIRDS);
    this.bShadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bShadow.frustumCulled = false;
    this.bShadow.count = 0;
    this.scene.add(this.bShadow);
  }

  // ── パーティクル（羽根・火花）──
  _buildParticles() {
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.pGeo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.parts = [];   // {x,y,z,vx,vy,vz,life,max,r,g,b,grav}
  }

  // ゴールの旗（市松模様のアーチ）
  _buildGoal() {
    const g = this.goalMark = new THREE.Group();
    const mkTex = () => {
      const t = makeTexture(16, 2, (x, y) => ((x + y) % 2 ? 0x181425 : 0xffffff));
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      return t;
    };
    const W = WORLD.XMAX - WORLD.XMIN + 0.8;
    const banner = new THREE.Mesh(new THREE.BoxGeometry(W, 1.1, 0.25), new THREE.MeshBasicMaterial({ map: mkTex() }));
    banner.position.set(0, 11.3, 0);
    g.add(banner);
    const postMat = new THREE.MeshLambertMaterial({ color: 0xff0044 });
    for (const sx of [WORLD.XMIN - 0.1, WORLD.XMAX + 0.1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.45, 12, 0.45), postMat);
      p.position.set(sx, 6, 0);
      g.add(p);
    }
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.0), new THREE.MeshBasicMaterial({ map: mkTex() }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.03, 0);
    g.add(line);
    g.visible = false;
    this.scene.add(g);
  }

  setGoal(z) {
    if (z == null) { this.goalMark.visible = false; return; }
    this.goalMark.visible = true;
    this.goalMark.position.z = z;
  }

  setTheme(i) {
    const t = this.theme = THEMES[i] || THEMES[0];
    this.themeIdx = i;
    const u = this.skyMat.uniforms;
    u.zenith.value.set(t.zenith); u.horizon.value.set(t.horizon); u.low.value.set(t.ground[1]);
    this.fog.color.set(t.fog); this.fog.near = t.fogNear; this.fog.far = t.fogFar;
    this.hemi.color.set(0xffffff); this.hemi.groundColor.set(t.ground[1]); this.hemi.intensity = t.hemi;
    this.sunLight.intensity = t.dir;
    this.sunMat.color.set(t.sun);
    this.stars.visible = !!t.stars;
    // 地面テクスチャ
    const [g0, g1] = t.ground;
    if (this.groundTex) this.groundTex.dispose();
    const WAVE = ['........', '..ww....', '.w..w...', '........', '....d...', '......ww', '.....w..', 'd.......'];
    this.groundTex = makeTexture(8, 8, (x, y) => {
      const h = (x * 7 + y * 13 + ((x * y) % 5)) % 11;
      if (t.name === 'river') { const c = WAVE[y][x]; return c === 'w' ? 0xc0cbdc : c === 'd' ? g1 : g0; }
      return h < 2 ? g1 : (h === 5 && y % 2 ? 0xfee761 : g0);
    });
    this.groundMat.map = this.groundTex;
    this.groundMat.needsUpdate = true;
    // がけの地層
    const [c0, c1] = t.cliff;
    for (const m of this.cliffs) {
      const pos = m.geometry.attributes.position, colA = m.geometry.attributes.color;
      const ca = hexColor(c0), cb = hexColor(c1);
      for (let k = 0; k < pos.count; k += 3) {
        const y = (pos.getY(k) + pos.getY(k + 1) + pos.getY(k + 2)) / 3;
        const band = Math.floor(y / 2.2) % 2 === 0 ? ca : cb;
        for (let j = 0; j < 3; j++) colA.setXYZ(k + j, band.r, band.g, band.b);
      }
      colA.needsUpdate = true;
    }
    // 遠景
    const hz = hexColor(t.horizon), zn = hexColor(t.zenith), cl = hexColor(t.cliff[1]);
    this.mtnMat.color.copy(hz).lerp(zn, 0.35);
    this.mtnMat2.color.copy(hz).lerp(cl, 0.5);
    this.cloudMat.color.set(t.stars ? 0x3a4466 : 0xffffff);
    this.pillarMat.color.set(t.pillar);
    this.logMat.color.set(t.log);
    this.bandMat.color.set(t.frame);
    this.frameMat.color.set(t.frame);
  }

  setCamMode(mode) { this.cam.mode = mode; }

  // セッション開始時などにカメラを瞬間移動
  snapCamera(focus) {
    const f = focus || { x: 0, y: WORLD.START_Y, z: 0, vx: 0, vy: 0 };
    this.trail = [];
    this.trailId = null;
    this._camTarget(f);
    this.cam.pos.copy(this._dp); this.cam.look.copy(this._dl);
  }

  // 注目している鳥が通った道を覚える（カメラも同じ穴をくぐれるように）
  _track(f, id) {
    const tr = this.trail || (this.trail = []);
    if (id !== this.trailId) { this.trailId = id; tr.length = 0; }
    const last = tr[tr.length - 1];
    if (!last || last.z - f.z > 0.05) tr.push({ x: f.x, y: f.y, z: f.z });
    else if (last.z < f.z - 1) tr.length = 0;     // 後ろに戻った＝新しい世代
    while (tr.length > 2 && tr[1].z - f.z > 14) tr.shift();
  }
  _trailAt(z) {
    const tr = this.trail || [];
    for (let i = tr.length - 1; i > 0; i--) {
      const a = tr[i - 1], b = tr[i];
      if (a.z >= z && b.z <= z) {
        const t = (a.z - z) / Math.max(1e-6, a.z - b.z);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    return null;
  }

  _camTarget(f, course = null) {
    this._dp = this._dp || new THREE.Vector3();
    this._dl = this._dl || new THREE.Vector3();
    const mode = this.cam.mode;
    if (mode === 0) {        // うしろ：鳥の通った道を少し上から追う（間の障害物は半透明になる）
      const D = 7.0;
      const p = this._trailAt(f.z + D) || f;
      this._dp.set(p.x * 0.7 + f.x * 0.2, Math.min(WORLD.YMAX + 1.5, p.y * 0.6 + f.y * 0.4 + 2.2), f.z + D);
      this._dl.set(f.x * 0.9, f.y + 0.1, f.z - 9);
    } else if (mode === 1) { // まえ（先回りして、向かってくる群れを見る）
      this._dp.set(f.x * 0.5, Math.min(WORLD.YMAX + 1, f.y * 0.5 + 4.5), f.z - 8.5);
      this._dl.set(f.x * 0.6, f.y * 0.7 + 1.2, f.z + 5);
    } else {                 // うえ（ほぼ真上から）
      this._dp.set(f.x * 0.3, 26, f.z + 4);
      this._dl.set(f.x * 0.3, 0, f.z - 5);
    }
  }

  // 1フレームの更新。birds は Bird の配列。alpha は描画の補間係数(0..1)
  update(dt, opts) {
    this.time += dt;
    const { birds = [], course = null, alpha = 1, focus = null, T = 0, aspect = 1 } = opts;
    // カメラ
    const f = focus ? this._interp(focus, alpha) : { x: 0, y: WORLD.START_Y, z: this.camZ - 5.2 - 10 * dt };
    if (focus) this._track(f, focus.id);
    this._camTarget(f, course);
    if (this.cam.mode === 0) {
      // 前後はぴったり、上下左右はなめらかに
      const k = 1 - Math.exp(-dt * 9);
      this.cam.pos.x += (this._dp.x - this.cam.pos.x) * k;
      this.cam.pos.y += (this._dp.y - this.cam.pos.y) * k;
      this.cam.pos.z += (this._dp.z - this.cam.pos.z) * (1 - Math.exp(-dt * 20));
      this.cam.look.lerp(this._dl, 1 - Math.exp(-dt * 8));
    } else {
      const k = 1 - Math.exp(-dt * 3);
      this.cam.pos.lerp(this._dp, k);
      this.cam.look.lerp(this._dl, k);
    }
    const cam = this.camera;
    cam.aspect = aspect;
    const fov = this.cam.mode === 2 ? 55 : this.cam.mode === 1 ? 58 : 62;
    if (Math.abs(cam.fov - fov) > 0.01) cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
    cam.position.copy(this.cam.pos);
    cam.lookAt(this.cam.look);
    const cz = this.camZ = cam.position.z;
    // 空・遠景はカメラに追従
    this.sky.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    this.sunDisc.position.set(cam.position.x - 55, cam.position.y + 48, cz - 120);
    this.sunDisc.lookAt(cam.position);
    this.mountains.position.set(cam.position.x * 0.9, 0, cz);
    // 地面・がけはタイル単位でスナップ（模様が世界に固定されて見える）
    const gz = Math.round(cz / TILE) * TILE;
    this.ground.position.z = gz - 100;
    if (this.theme.name === 'river') this.groundTex.offset.y = (this.time * 0.25) % 1;
    const clz = Math.round(cz / CLIFF_PERIOD) * CLIFF_PERIOD;
    for (const m of this.cliffs) { m.position.z = clz - 100; m.userData.top.position.z = gz - 100; }
    for (const c of this.clouds) {
      if (c.position.z > cz + 30) c.position.z -= 240;
      if (c.position.z < cz - 230) c.position.z += 240;
    }
    if (course) this._syncObstacles(course, cz, focus ? f.z : null);
    else {
      for (const set of [this.solid, this.ghost]) for (const k in set) if (set[k]) set[k].count = 0;
    }
    this._syncBirds(birds, alpha, T);
    this._syncParticles(dt);
  }

  _interp(b, a) {
    return {
      x: b.px + (b.x - b.px) * a, y: b.py + (b.y - b.py) * a, z: b.pz + (b.z - b.pz) * a,
      vx: b.vx, vy: b.vy,
    };
  }

  _syncObstacles(course, cz, fz) {
    const obs = course.obs;
    // z が cz+BEHIND 以下の最初の障害物（二分探索）
    let lo = 0, hi = obs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (obs[mid].z > cz + BEHIND) lo = mid + 1; else hi = mid; }
    const t = this.theme;
    const XMIN = WORLD.XMIN - 0.6, XMAX = WORLD.XMAX + 0.6;
    const sets = [this.solid, this.ghost];
    const cnt = [{ panels: 0, frames: 0, pillars: 0, logs: 0, bands: 0 }, { panels: 0, frames: 0, pillars: 0, logs: 0, bands: 0 }];
    const ghostOn = fz !== null;
    const zA = Math.min(cz, fz ?? 0), zB = Math.max(cz, fz ?? 0);
    const add = (si, key, m, color) => {
      const im = sets[si][key];
      if (!im) return;
      const n = cnt[si][key];
      if (n >= im.instanceMatrix.count) return;
      im.setMatrixAt(n, m);
      if (color !== undefined) im.setColorAt(n, _c.set(color));
      cnt[si][key] = n + 1;
    };
    for (let i = lo; i < obs.length; i++) {
      const o = obs[i];
      if (o.z < cz - AHEAD) break;
      // カメラと注目の鳥の間にある障害物 → 半透明
      const si = (ghostOn && o.z > zA - (cz < fz ? 1.2 : -0.6) && o.z < zB + (cz > fz ? 1.2 : -0.6)) ? 1 : 0;
      if (o.type === OB_GATE) {
        const x0 = o.cx - o.hw / 2, x1 = o.cx + o.hw / 2, y0 = o.cy - o.hh / 2, y1 = o.cy + o.hh / 2;
        const col = (i % 2) ? t.gate : t.gate2;
        const put = (px, py, w, h) => {
          if (w <= 0.001 || h <= 0.001) return;
          _m.compose(_v.set(px, py, o.z), _qI, _s.set(w, h, o.t));
          add(si, 'panels', _m, col);
        };
        put((XMIN + x0) / 2, WALL_H / 2, x0 - XMIN, WALL_H);
        put((x1 + XMAX) / 2, WALL_H / 2, XMAX - x1, WALL_H);
        put(o.cx, y0 / 2, o.hw, y0);
        put(o.cx, (y1 + WALL_H) / 2, o.hw, WALL_H - y1);
        const fw = 0.26, fd = o.t + 0.14;
        const fr = (px, py, w, h) => {
          _m.compose(_v.set(px, py, o.z), _qI, _s.set(w, h, fd));
          add(si, 'frames', _m);
        };
        fr(o.cx, y0 + fw / 2, o.hw, fw);
        fr(o.cx, y1 - fw / 2, o.hw, fw);
        fr(x0 + fw / 2, o.cy, fw, o.hh);
        fr(x1 - fw / 2, o.cy, fw, o.hh);
      } else if (o.type === OB_PILLAR) {
        const h = WALL_H + 2;
        _m.compose(_v.set(o.x, h / 2, o.z), _qI, _s.set(o.r, h, o.r));
        add(si, 'pillars', _m);
        if (si === 0) {
          for (const by of [2.2, 7.6]) {
            _m.compose(_v.set(o.x, by, o.z), _qI, _s.set(o.r * 1.12, 0.35, o.r * 1.12));
            add(0, 'bands', _m);
          }
        }
      } else {
        const len = WORLD.XMAX - WORLD.XMIN + 1.2;
        _m.compose(_v.set(0, o.y, o.z), _qI, _s.set(len, o.r, o.r));
        add(si, 'logs', _m);
        if (si === 0) {
          for (const bx of [-3.5, 3.5]) {
            _m.compose(_v.set(bx, o.y, o.z), _q.setFromAxisAngle(_v.set(0, 0, 1), Math.PI / 2), _s.set(o.r * 1.12, 0.35, o.r * 1.12));
            add(0, 'bands', _m);
          }
        }
      }
    }
    for (let k = 0; k < 2; k++) {
      for (const key in sets[k]) {
        const im = sets[k][key];
        if (!im) continue;
        im.count = cnt[k][key];
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
  }

  _syncBirds(birds, alpha, T) {
    let n = 0;
    const B = this;
    for (let i = 0; i < birds.length && n < MAX_BIRDS; i++) {
      const b = birds[i];
      const look = b.look || FAMILIES[0];
      if (look.hidden) continue;
      let x, y, z, spin = 0;
      if (b.alive) {
        x = b.px + (b.x - b.px) * alpha; y = b.py + (b.y - b.py) * alpha; z = b.pz + (b.z - b.pz) * alpha;
      } else {
        const td = T - b.deathT;
        if (td > 0.9 || b.cause === 'finish') continue;
        x = b.x; z = b.z + 0.4 * td; y = Math.max(0.2, b.y + 1.5 * td - 7 * td * td); spin = td * 9;
      }
      const sc = look.scale || 1;
      _e.set(b.vy * 0.05 + spin, -b.vx * 0.05, -b.vx * 0.09 + spin * 0.7, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_v.set(x, y, z), _q, _s.set(sc, sc, sc));
      const part = (im, ox, oy, oz, sx, sy, sz, color) => {
        _m2.compose(_v.set(ox, oy, oz), _qI, _s.set(sx, sy, sz));
        _m2.premultiply(_m);
        im.setMatrixAt(n, _m2);
        if (color !== undefined) im.setColorAt(n, _c.set(color));
      };
      part(B.bBody, 0, 0, 0, 0.5, 0.42, 0.62, look.color);
      part(B.bHead, 0, 0.2, -0.36, 0.38, 0.36, 0.34, look.color);
      part(B.bBeak, 0, 0.14, -0.6, 0.16, 0.12, 0.2);
      part(B.bEye, 0, 0.26, -0.47, 0.4, 0.08, 0.08);
      part(B.bTail, 0, 0.08, 0.4, 0.26, 0.06, 0.26, look.dark);
      // はばたき
      const fl = Math.sin(b.flap) * 0.85 + 0.15;
      for (const side of [-1, 1]) {
        _m2.makeTranslation(side * 0.25, 0.08, 0.02);
        _mw1.makeRotationZ(side * fl);
        _m2.multiply(_mw1);
        _mw2.compose(_v.set(side * 0.3, 0, 0), _qI, _s.set(0.62, 0.06, 0.34));
        _m2.multiply(_mw2);
        _m2.premultiply(_m);
        const im = side < 0 ? B.bWingL : B.bWingR;
        im.setMatrixAt(n, _m2);
        im.setColorAt(n, _c.set(look.dark));
      }
      // 影
      const sh = Math.max(0.25, 1 - y / 12) * sc;
      _m2.compose(_v.set(x, 0.03, z), _qI, _s.set(sh, 1, sh));
      B.bShadow.setMatrixAt(n, _m2);
      n++;
    }
    for (const im of [B.bBody, B.bHead, B.bBeak, B.bEye, B.bTail, B.bWingL, B.bWingR, B.bShadow]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  // ── パーティクル ──
  burst(x, y, z, color, n = 14, speed = 5) {
    const c1 = hexColor(color), c2 = hexColor(0xffffff);
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.4 + Math.random() * 0.8);
      const c = Math.random() < 0.7 ? c1 : c2;
      this.parts.push({
        x, y, z, vx: Math.sin(ph) * Math.cos(th) * sp, vy: Math.cos(ph) * sp + 2, vz: Math.sin(ph) * Math.sin(th) * sp + 3,
        life: 0, max: 0.6 + Math.random() * 0.6, r: c.r, g: c.g, b: c.b, grav: 9,
      });
    }
  }
  sparkle(x, y, z, color, n = 8) {
    const c = hexColor(color);
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
      const th = (i / n) * Math.PI * 2;
      this.parts.push({ x, y, z, vx: Math.cos(th) * 3, vy: Math.sin(th) * 3, vz: 2, life: 0, max: 0.45, r: c.r, g: c.g, b: c.b, grav: 0 });
    }
  }
  clearParticles() { this.parts.length = 0; }

  _syncParticles(dt) {
    const P = this.parts;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      P[w++] = p;
    }
    P.length = w;
    for (let i = 0; i < w; i++) {
      const p = P[i];
      this.pPos[i * 3] = p.x; this.pPos[i * 3 + 1] = p.y; this.pPos[i * 3 + 2] = p.z;
      this.pCol[i * 3] = p.r; this.pCol[i * 3 + 1] = p.g; this.pCol[i * 3 + 2] = p.b;
    }
    this.pGeo.setDrawRange(0, w);
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
  }

  // 3D座標 → 3D画面上の仮想ピクセル座標（UIの吹き出し用）
  project(x, y, z, VW, viewH) {
    _v.set(x, y, z).project(this.camera);
    if (_v.z > 1 || _v.z < -1) return null;
    return { x: Math.round((_v.x + 1) / 2 * VW), y: Math.round((1 - _v.y) / 2 * viewH) };
  }
}
