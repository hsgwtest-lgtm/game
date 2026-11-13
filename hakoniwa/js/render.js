// render.js — Three.js の描画。低解像度で描いてから最近傍で拡大し、ドット絵の質感にする
import * as THREE from '../lib/three.module.min.js';
import { GW, GH, LEVEL_H, WATER_Y, T, FERT, MAX_TREES } from './world.js';
import { HERB, CARN, MAX_ANIMALS, maturityOf } from './sim.js';
import { ACT } from './brain.js';
import { TR, traitNorm } from './genetics.js';
import { clamp, smoothstep } from './util.js';

const OX = GW / 2;
const OZ = GH / 2;
const C = (hex) => new THREE.Color(hex);

const PAL = {
  deepBed: C('#1c3558'),
  shallowBed: C('#c4ad78'),
  bedSide: C('#22406a'),
  sand: C('#e6d39a'),
  sandSideA: C('#cfb172'),
  sandSideB: C('#c2a466'),
  dirtTop: C('#8a6a3c'),
  grassDry: C('#a3914e'),
  grassLush: C('#5db143'),
  forestDry: C('#6d6a35'),
  forestLush: C('#3a8a3a'),
  lip: C('#4b8f35'),
  forestLip: C('#356e2e'),
  dirtA: C('#7a5230'),
  dirtB: C('#6a4628'),
  rock: C('#8f8c86'),
  rockMoss: C('#7b8a63'),
  rockSideA: C('#78746f'),
  rockSideB: C('#6c6863'),
  peak: C('#eef2f6'),
  peakSide: C('#c6cbd1'),
  snow: C('#f4f7fb'),
  straw: C('#c9a85a'),
  trunk: C('#6b4426'),
  leafA: C('#2f7d32'),
  leafB: C('#3f9842'),
  fruit0: C('#e0443a'),
  fruit1: C('#f2a03a'),
  bone: C('#e7dfcf'),
  water: C('#3d8fd6'),
};

// ---- 箱を組み合わせて形を作る小道具（頂点色つき、面ごとに法線）
class GeoBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
  }
  get count() {
    return this.p.length / 3;
  }
  quad(a, b, c, d, nx, ny, nz, col) {
    for (const v of [a, b, c, a, c, d]) {
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nx, ny, nz);
      this.c.push(col.r, col.g, col.b);
    }
  }
  box(cx, cy, cz, sx, sy, sz, col) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 0, 1, 0, col);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0, col);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0, col);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, col);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, col);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], 0, 0, -1, col);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const gray = (v) => new THREE.Color(v, v, v);

function herbGeometry() {
  const b = new GeoBuilder();
  const W = gray(1);
  b.box(0, 0.32, 0, 0.62, 0.36, 0.42, W); // 胴
  b.box(0.34, 0.52, 0, 0.3, 0.3, 0.32, W); // 頭
  b.box(0.3, 0.76, 0.08, 0.08, 0.26, 0.07, gray(0.92)); // 耳
  b.box(0.3, 0.76, -0.08, 0.08, 0.26, 0.07, gray(0.92));
  b.box(0.48, 0.56, 0.13, 0.05, 0.06, 0.04, gray(0.04)); // 目
  b.box(0.48, 0.56, -0.13, 0.05, 0.06, 0.04, gray(0.04));
  b.box(-0.34, 0.42, 0, 0.1, 0.12, 0.12, gray(1)); // しっぽ
  for (const [x, z] of [
    [0.18, 0.13],
    [0.18, -0.13],
    [-0.18, 0.13],
    [-0.18, -0.13],
  ]) {
    b.box(x, 0.08, z, 0.1, 0.16, 0.1, gray(0.72));
  }
  return b.build();
}

function carnGeometry() {
  const b = new GeoBuilder();
  const W = gray(1);
  b.box(0, 0.34, 0, 0.72, 0.3, 0.32, W);
  b.box(0.44, 0.5, 0, 0.28, 0.26, 0.28, W);
  b.box(0.62, 0.43, 0, 0.16, 0.12, 0.14, gray(0.86)); // 鼻先
  b.box(0.42, 0.68, 0.09, 0.08, 0.14, 0.07, gray(0.8));
  b.box(0.42, 0.68, -0.09, 0.08, 0.14, 0.07, gray(0.8));
  b.box(0.56, 0.54, 0.12, 0.05, 0.05, 0.04, gray(0.04));
  b.box(0.56, 0.54, -0.12, 0.05, 0.05, 0.04, gray(0.04));
  b.box(-0.47, 0.42, 0, 0.3, 0.12, 0.12, W); // しっぽ
  b.box(-0.66, 0.44, 0, 0.09, 0.11, 0.11, gray(1));
  for (const [x, z] of [
    [0.24, 0.1],
    [0.24, -0.1],
    [-0.24, 0.1],
    [-0.24, -0.1],
  ]) {
    b.box(x, 0.1, z, 0.08, 0.2, 0.08, gray(0.62));
  }
  return b.build();
}

function treeGeometry() {
  const b = new GeoBuilder();
  b.box(0, 0.45, 0, 0.28, 0.9, 0.28, PAL.trunk);
  b.box(0, 1.15, 0, 1.15, 0.8, 1.15, PAL.leafA);
  b.box(0, 1.72, 0, 0.75, 0.5, 0.75, PAL.leafB);
  return b.build();
}

function tuftGeometry() {
  const b = new GeoBuilder();
  const g = gray(1);
  b.box(-0.09, 0.17, 0.02, 0.07, 0.34, 0.07, g);
  b.box(0.08, 0.12, 0.06, 0.07, 0.24, 0.07, gray(0.85));
  b.box(0.01, 0.14, -0.08, 0.07, 0.28, 0.07, gray(0.92));
  return b.build();
}

const hash2 = (i, j) => {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// 形質の色分け（青→水色→黄→赤）
const RAMP = [C('#2b4cff'), C('#2bd9c0'), C('#ffe04a'), C('#ff4a3a')];
function rampColor(t, out) {
  const x = clamp(t, 0, 1) * 3;
  const i = Math.min(2, Math.floor(x));
  return out.copy(RAMP[i]).lerp(RAMP[i + 1], x - i);
}

const POST_VS = `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const POST_FS = `
uniform sampler2D tCol;
uniform sampler2D tDep;
uniform vec2 res;
uniform float block;
uniform float cnear;
uniform float cfar;
uniform float outline;
float lin(float d) { return cnear * cfar / (cfar - d * (cfar - cnear)); }
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  vec2 px = floor(gl_FragCoord.xy / block);
  vec2 uv = (px + 0.5) / res;
  vec2 dx = vec2(1.0 / res.x, 0.0);
  vec2 dy = vec2(0.0, 1.0 / res.y);
  vec3 c = texture2D(tCol, uv).rgb;
  float d = lin(texture2D(tDep, uv).r);
  float n = max(max(lin(texture2D(tDep, uv + dx).r), lin(texture2D(tDep, uv - dx).r)),
                max(lin(texture2D(tDep, uv + dy).r), lin(texture2D(tDep, uv - dy).r)));
  float edge = step(0.35 + d * 0.025, n - d);
  c *= mix(1.0, 0.5, edge * outline);
  c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  float levels = 22.0;
  c = floor(c * levels + bayer4(px)) / levels;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.r.setPixelRatio(1);
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.BasicShadowMap;
    this.pixel = 2;
    this.shadows = true;
    this.colorMode = 'gene';
    this.inset = 0;
    this.sim = null;
    this.selected = null;
    this.follow = false;
    this.time = 0;
    this.terrainAcc = 0;
    this.lastG = -1;
    this.lastTreeV = -1;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x8fc6ee, 60, 180);
    this.scene.background = new THREE.Color(0x8fc6ee);
    this.cam = new THREE.PerspectiveCamera(36, 1, 1, 600);
    this.orbit = { az: -0.9, pol: 0.92, rad: 62, tx: 0, ty: 1.6, tz: 0 };

    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6b5a3a, 1.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.makeStatic();
    this.makePost();
    this.resize();
  }

  // ---- 島に依存しない物
  makeStatic() {
    const s = this.scene;
    // 海底と海
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshLambertMaterial({ color: PAL.deepBed }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -0.02;
    bed.receiveShadow = true;
    s.add(bed);
    this.waterMat = new THREE.MeshLambertMaterial({ color: PAL.water, transparent: true, opacity: 0.7 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    s.add(water);

    // 水面のきらめき
    const SP = 90;
    this.sparkPos = new Float32Array(SP * 3);
    for (let i = 0; i < SP; i++) this.placeSparkle(i);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false, transparent: true, opacity: 0.8 });
    this.sparkles = new THREE.Points(sg, this.sparkMat);
    this.sparkles.frustumCulled = false;
    s.add(this.sparkles);

    // 星・太陽・月
    const ST = 200;
    const sp = new Float32Array(ST * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < ST; i++) {
      const a = rnd() * Math.PI * 2;
      const e = 0.12 + rnd() * 1.3;
      sp[i * 3] = Math.cos(a) * Math.cos(e) * 220;
      sp[i * 3 + 1] = Math.sin(e) * 220;
      sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 220;
    }
    const stg = new THREE.BufferGeometry();
    stg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(stg, this.starMat);
    this.stars.frustumCulled = false;
    s.add(this.stars);
    this.sunBox = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 9), new THREE.MeshBasicMaterial({ color: 0xffe58a, fog: false }));
    this.moonBox = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false }));
    s.add(this.sunBox, this.moonBox);

    // 生き物
    const mk = (geo, n, vc = true) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: vc }), n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = false;
      m.frustumCulled = false;
      const w = new THREE.Color(1, 1, 1);
      for (let i = 0; i < n; i++) m.setColorAt(i, w);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      s.add(m);
      return m;
    };
    this.herbMesh = mk(herbGeometry(), MAX_ANIMALS);
    this.carnMesh = mk(carnGeometry(), MAX_ANIMALS);
    this.treeMesh = mk(treeGeometry(), MAX_TREES + 4);
    this.fruitMesh = mk(new THREE.BoxGeometry(0.26, 0.26, 0.26), 150, false);
    this.fruitMesh.castShadow = false;
    this.carcMesh = mk(new THREE.BoxGeometry(0.42, 0.12, 0.26), 40, false);
    this.carcMesh.castShadow = false;

    // 雨・雪
    const PR = 520;
    this.precipPos = new Float32Array(PR * 3);
    for (let i = 0; i < PR; i++) {
      this.precipPos[i * 3] = (Math.random() - 0.5) * 60;
      this.precipPos[i * 3 + 1] = Math.random() * 20;
      this.precipPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.precipPos, 3));
    this.precipMat = new THREE.PointsMaterial({ color: 0xa9c6ff, size: 1, sizeAttenuation: false, transparent: true, opacity: 0.85 });
    this.precip = new THREE.Points(pg, this.precipMat);
    this.precip.frustumCulled = false;
    this.precip.geometry.setDrawRange(0, 0);
    s.add(this.precip);

    // 小さな粒（誕生・捕食などの合図）
    const PP = 220;
    this.pPos = new Float32Array(PP * 3).fill(-999);
    this.pCol = new Float32Array(PP * 3);
    this.pVel = new Float32Array(PP * 3);
    this.pLife = new Float32Array(PP);
    this.pNext = 0;
    const ppg = new THREE.BufferGeometry();
    ppg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    ppg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.parts = new THREE.Points(ppg, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }));
    this.parts.frustumCulled = false;
    s.add(this.parts);

    // 選んだ個体の目印・視野の輪・ねらいの線
    this.marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), new THREE.MeshBasicMaterial({ color: 0xffd84a, fog: false }));
    this.marker.visible = false;
    s.add(this.marker);
    const RN = 48;
    this.ringPos = new Float32Array(RN * 3);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.ringPos, 3));
    this.ring = new THREE.LineLoop(rg, new THREE.LineBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.85, fog: false }));
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    s.add(this.ring);
    this.linePos = new Float32Array(6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.tline = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, fog: false }));
    this.tline.frustumCulled = false;
    this.tline.visible = false;
    s.add(this.tline);

    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpS = new THREE.Vector3();
    this.tmpP = new THREE.Vector3();
    this.tmpC = new THREE.Color();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  placeSparkle(i) {
    const a = Math.random() * Math.PI * 2;
    const r = 18 + Math.random() * 40;
    this.sparkPos[i * 3] = Math.cos(a) * r;
    this.sparkPos[i * 3 + 1] = WATER_Y + 0.02;
    this.sparkPos[i * 3 + 2] = Math.sin(a) * r;
  }

  makePost() {
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VS,
      fragmentShader: POST_FS,
      uniforms: {
        tCol: { value: null },
        tDep: { value: null },
        res: { value: new THREE.Vector2(1, 1) },
        block: { value: 2 },
        cnear: { value: this.cam.near },
        cfar: { value: this.cam.far },
        outline: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    q.frustumCulled = false;
    this.postScene.add(q);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  resize() {
    const cw = Math.max(1, window.innerWidth);
    const ch = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = cw;
    this.ch = ch;
    this.r.setSize(Math.round(cw * dpr), Math.round(ch * dpr), false);
    this.block = this.pixel * dpr;
    this.lw = Math.ceil((cw * dpr) / this.block);
    this.lh = Math.ceil((ch * dpr) / this.block);
    if (this.rt) {
      this.rt.depthTexture.dispose();
      this.rt.dispose();
    }
    this.rt = new THREE.WebGLRenderTarget(this.lw, this.lh, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(this.lw, this.lh),
    });
    this.cam.aspect = this.lw / this.lh;
    this.applyInset();
    const u = this.postMat.uniforms;
    u.tCol.value = this.rt.texture;
    u.tDep.value = this.rt.depthTexture;
    u.res.value.set(this.lw, this.lh);
    u.block.value = this.block;
  }

  setPixel(p) {
    this.pixel = p;
    this.resize();
  }
  setShadows(on) {
    this.shadows = on;
    this.sun.castShadow = on;
  }
  // 下のパネルに隠れないよう、画面の中心を上にずらす
  setInset(px) {
    this.inset = px;
    this.applyInset();
  }
  applyInset() {
    const off = Math.round((this.inset / this.ch) * this.lh * 0.5);
    if (off > 0) this.cam.setViewOffset(this.lw, this.lh, 0, off, this.lw, this.lh);
    else this.cam.clearViewOffset();
    this.cam.updateProjectionMatrix();
  }

  // ---- 島ごとの物（地形・草）
  setSim(sim) {
    this.sim = sim;
    this.selected = null;
    this.follow = false;
    this.buildTerrain();
    this.buildTufts();
    this.lastG = -1;
    this.lastTreeV = -1;
    this.updateTerrainColors(true);
  }

  buildTerrain() {
    const w = this.sim.world;
    if (this.terrain) {
      this.scene.remove(this.terrain);
      this.terrain.geometry.dispose();
    }
    const b = new GeoBuilder();
    this.topStart = new Int32Array(GW * GH).fill(-1);
    const sideCol = (t, s, lv) => {
      if (t <= T.SHALLOW) return PAL.bedSide;
      if (t === T.SAND) return s % 2 ? PAL.sandSideA : PAL.sandSideB;
      if (t === T.ROCK) return s % 2 ? PAL.rockSideA : PAL.rockSideB;
      if (t === T.PEAK) return s >= lv - 1 ? PAL.peakSide : s % 2 ? PAL.rockSideA : PAL.rockSideB;
      if (s === lv - 1) return t === T.FOREST ? PAL.forestLip : PAL.lip;
      return s % 2 ? PAL.dirtA : PAL.dirtB;
    };
    for (let j = 0; j < GH; j++) {
      for (let i = 0; i < GW; i++) {
        const k = j * GW + i;
        const lv = w.level[k];
        const t = w.type[k];
        const y = lv * LEVEL_H;
        const x0 = i - OX;
        const x1 = x0 + 1;
        const z0 = j - OZ;
        const z1 = z0 + 1;
        this.topStart[k] = b.count;
        b.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], 0, 1, 0, PAL.sand);
        const nb = [
          [i + 1, j, 1, 0],
          [i - 1, j, -1, 0],
          [i, j + 1, 0, 1],
          [i, j - 1, 0, -1],
        ];
        for (const [ni, nj, dx, dz] of nb) {
          const nl = ni < 0 || nj < 0 || ni >= GW || nj >= GH ? 0 : w.level[nj * GW + ni];
          for (let s = nl; s < lv; s++) {
            const ya = s * LEVEL_H;
            const yb = (s + 1) * LEVEL_H;
            const col = sideCol(t, s, lv);
            if (dx === 1) b.quad([x1, ya, z0], [x1, yb, z0], [x1, yb, z1], [x1, ya, z1], 1, 0, 0, col);
            else if (dx === -1) b.quad([x0, ya, z0], [x0, ya, z1], [x0, yb, z1], [x0, yb, z0], -1, 0, 0, col);
            else if (dz === 1) b.quad([x0, ya, z1], [x1, ya, z1], [x1, yb, z1], [x0, yb, z1], 0, 0, 1, col);
            else b.quad([x0, ya, z0], [x0, yb, z0], [x1, yb, z0], [x1, ya, z0], 0, 0, -1, col);
          }
        }
      }
    }
    const geo = b.build();
    geo.getAttribute('color').setUsage(THREE.DynamicDrawUsage);
    this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.terrain.receiveShadow = true;
    this.terrain.castShadow = true;
    this.scene.add(this.terrain);
  }

  buildTufts() {
    const w = this.sim.world;
    if (this.tufts) {
      this.scene.remove(this.tufts);
      this.tufts.dispose();
    }
    this.tuftCells = [];
    for (let k = 0; k < GW * GH; k++) if (FERT[w.type[k]] >= 0.5) this.tuftCells.push(k);
    const m = new THREE.InstancedMesh(tuftGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), this.tuftCells.length);
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.Color();
    this.tuftJit = new Float32Array(this.tuftCells.length * 3);
    for (let n = 0; n < this.tuftCells.length; n++) {
      const k = this.tuftCells[n];
      const i = k % GW;
      const j = (k / GW) | 0;
      this.tuftJit[n * 3] = 0.2 + hash2(i, j) * 0.6;
      this.tuftJit[n * 3 + 1] = 0.2 + hash2(j + 7, i + 3) * 0.6;
      this.tuftJit[n * 3 + 2] = hash2(i + 11, j + 5) * Math.PI;
      m.setColorAt(n, c.setRGB(1, 1, 1));
    }
    this.tufts = m;
    this.scene.add(m);
  }

  updateTerrainColors(force) {
    const w = this.sim.world;
    const key = w.gVersion + Math.round(w.snow * 20) * 1e6 + Math.round(w.heatI * 10) * 1e8 + Math.round(w.rainI * 10) * 1e9;
    if (!force && key === this.lastG) return;
    this.lastG = key;
    const attr = this.terrain.geometry.getAttribute('color');
    const arr = attr.array;
    const c = this.tmpC;
    const snow = w.snow;
    const dry = w.heatI * (1 - w.rainI) * 0.35;
    const wet = 1 - 0.1 * w.rainI;
    for (let k = 0; k < GW * GH; k++) {
      const t = w.type[k];
      const g = w.grass[k];
      switch (t) {
        case T.DEEP:
          c.copy(PAL.deepBed);
          break;
        case T.SHALLOW:
          c.copy(PAL.shallowBed);
          break;
        case T.SAND:
          c.copy(PAL.sand).lerp(PAL.grassLush, g * 0.35);
          break;
        case T.GRASS:
          if (g < 0.15) c.copy(PAL.dirtTop).lerp(PAL.grassDry, g / 0.15);
          else c.copy(PAL.grassDry).lerp(PAL.grassLush, (g - 0.15) / 0.85);
          break;
        case T.FOREST:
          if (g < 0.15) c.copy(PAL.dirtTop).lerp(PAL.forestDry, g / 0.15);
          else c.copy(PAL.forestDry).lerp(PAL.forestLush, (g - 0.15) / 0.85);
          break;
        case T.ROCK:
          c.copy(PAL.rock).lerp(PAL.rockMoss, g * 0.6);
          break;
        default:
          c.copy(PAL.peak);
      }
      if (t >= T.SAND) {
        if (dry > 0 && (t === T.GRASS || t === T.FOREST)) c.lerp(PAL.straw, dry);
        if (snow > 0) c.lerp(PAL.snow, snow * 0.85);
        c.multiplyScalar(wet);
      }
      const v = 1 + (hash2(k % GW, (k / GW) | 0) - 0.5) * (t === T.ROCK ? 0.16 : 0.07);
      const r = c.r * v;
      const gg = c.g * v;
      const bb = c.b * v;
      let o = this.topStart[k] * 3;
      for (let q = 0; q < 6; q++) {
        arr[o++] = r;
        arr[o++] = gg;
        arr[o++] = bb;
      }
    }
    attr.needsUpdate = true;
    // 草の株
    const m = this.tufts;
    const M = this.tmpM;
    const Q = this.tmpQ;
    const S = this.tmpS;
    const P = this.tmpP;
    for (let n = 0; n < this.tuftCells.length; n++) {
      const k = this.tuftCells[n];
      const g = w.grass[k];
      const show = g > 0.3 && snow < 0.5;
      const h = show ? (g - 0.2) * 1.3 : 0.001;
      const i = k % GW;
      const j = (k / GW) | 0;
      P.set(i - OX + this.tuftJit[n * 3], w.level[k] * LEVEL_H, j - OZ + this.tuftJit[n * 3 + 1]);
      Q.setFromAxisAngle(this.up, this.tuftJit[n * 3 + 2]);
      S.set(show ? 1 : 0.001, h, show ? 1 : 0.001);
      M.compose(P, Q, S);
      m.setMatrixAt(n, M);
      c.copy(w.type[k] === T.FOREST ? PAL.forestLush : PAL.grassLush).multiplyScalar(0.85 + g * 0.25);
      if (dry > 0) c.lerp(PAL.straw, dry);
      m.setColorAt(n, c);
    }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }

  updateTrees() {
    const w = this.sim.world;
    const m = this.treeMesh;
    const M = this.tmpM;
    const c = this.tmpC;
    m.count = w.trees.length;
    for (let i = 0; i < w.trees.length; i++) {
      const tr = w.trees[i];
      const k = w.cellIndex(tr.x, tr.z);
      const sc = (0.35 + 0.65 * tr.grow) * (0.9 + hash2(i, 3) * 0.25);
      this.tmpP.set(tr.x - OX, w.level[k] * LEVEL_H, tr.z - OZ);
      this.tmpQ.setFromAxisAngle(this.up, hash2(i, 9) * Math.PI);
      this.tmpS.set(sc, sc, sc);
      M.compose(this.tmpP, this.tmpQ, this.tmpS);
      m.setMatrixAt(i, M);
      if (tr.kind === 0) c.setRGB(1, 1, 1);
      else c.setRGB(0.82, 1, 0.78);
      m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }

  updateItems() {
    const w = this.sim.world;
    const M = this.tmpM;
    const Q = this.tmpQ.identity();
    const S = this.tmpS;
    const P = this.tmpP;
    const fm = this.fruitMesh;
    const n = Math.min(150, w.fruits.length);
    fm.count = n;
    for (let i = 0; i < n; i++) {
      const f = w.fruits[i];
      const s = f.age < 0.6 ? f.age / 0.6 : 1;
      P.set(f.x - OX, w.groundY(f.x, f.z) + 0.13 * s, f.z - OZ);
      S.set(s, s, s);
      M.compose(P, Q, S);
      fm.setMatrixAt(i, M);
      fm.setColorAt(i, f.kind ? PAL.fruit1 : PAL.fruit0);
    }
    fm.instanceMatrix.needsUpdate = true;
    if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    const cm = this.carcMesh;
    cm.count = w.carcs.length;
    for (let i = 0; i < w.carcs.length; i++) {
      const cc = w.carcs[i];
      const s = Math.max(0.2, 1 - cc.age / 55) * Math.min(1.4, 0.6 + cc.e / 40);
      P.set(cc.x - OX, w.groundY(cc.x, cc.z) + 0.06, cc.z - OZ);
      S.set(s, 1, s);
      M.compose(P, Q, S);
      cm.setMatrixAt(i, M);
      cm.setColorAt(i, PAL.bone);
    }
    cm.instanceMatrix.needsUpdate = true;
    if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
  }

  colorOf(c, out) {
    if (this.colorMode === 'gene') {
      const sp = this.sim.species[c.sp];
      const light = clamp(sp.light + 0.22 * (c.t[TR.COLD] - 0.4), 0.22, 0.9);
      return out.setHSL(c.hue, sp.sat, light);
    }
    const ti = { speed: 0, size: 1, vision: 2, diet: 3, cold: 4 }[this.colorMode];
    return rampColor(traitNorm(ti, c.t[ti]), out);
  }

  updateCreatures(dt) {
    const sim = this.sim;
    const w = sim.world;
    const M = this.tmpM;
    const Q = this.tmpQ;
    const S = this.tmpS;
    const P = this.tmpP;
    const col = this.tmpC;
    let nh = 0;
    let nc = 0;
    for (const c of sim.creatures) {
      if (!c.alive) continue;
      const ty = w.groundY(c.x, c.z);
      if (c.ry === undefined) {
        c.ry = ty;
        c.rh = c.h;
        c.ph = Math.random() * 6;
      }
      c.ry += (ty - c.ry) * Math.min(1, dt * 14);
      let dh = c.h - c.rh;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      c.rh += dh * Math.min(1, dt * 10);
      const moving = c.v > 0.05;
      c.ph += dt * (moving ? 5 + 5 * c.v : 1.2);
      const mat = maturityOf(c);
      const youth = c.age < mat ? 0.55 + 0.45 * (c.age / mat) : 1;
      const sc = (0.25 + c.t[TR.SIZE] * 0.95) * youth;
      let bob = 0;
      if (moving) bob = c.cls === HERB ? Math.abs(Math.sin(c.ph)) * 0.2 * sc : Math.abs(Math.sin(c.ph * 1.4)) * 0.07 * sc;
      const rest = c.act === ACT.REST;
      P.set(c.x - OX, c.ry + bob, c.z - OZ);
      Q.setFromAxisAngle(this.up, -c.rh);
      S.set(sc * (0.85 + 0.15 * c.t[TR.SPEED]), sc * (rest ? 0.78 : 1), sc);
      M.compose(P, Q, S);
      this.colorOf(c, col);
      if (c.cls === HERB) {
        this.herbMesh.setMatrixAt(nh, M);
        this.herbMesh.setColorAt(nh, col);
        nh++;
      } else {
        this.carnMesh.setMatrixAt(nc, M);
        this.carnMesh.setColorAt(nc, col);
        nc++;
      }
    }
    for (const m of [this.herbMesh, this.carnMesh]) {
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    this.herbMesh.count = nh;
    this.carnMesh.count = nc;
  }

  // ---- 粒
  burst(x, y, z, color, n, spread = 1.5, up = 2.5) {
    const c = this.tmpC.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % this.pLife.length;
      this.pPos[i * 3] = x;
      this.pPos[i * 3 + 1] = y;
      this.pPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * spread;
      this.pVel[i * 3] = Math.cos(a) * s;
      this.pVel[i * 3 + 1] = up * (0.5 + Math.random());
      this.pVel[i * 3 + 2] = Math.sin(a) * s;
      this.pLife[i] = 0.7 + Math.random() * 0.5;
      this.pCol[i * 3] = c.r;
      this.pCol[i * 3 + 1] = c.g;
      this.pCol[i * 3 + 2] = c.b;
    }
  }
  updateParticles(dt) {
    let any = false;
    for (let i = 0; i < this.pLife.length; i++) {
      if (this.pLife[i] <= 0) continue;
      any = true;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = -999;
        continue;
      }
      this.pVel[i * 3 + 1] -= 5 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
    }
    if (any || this.partsDirty) {
      this.parts.geometry.getAttribute('position').needsUpdate = true;
      this.parts.geometry.getAttribute('color').needsUpdate = true;
      this.partsDirty = any;
    }
  }

  onEvents(evs) {
    const w = this.sim.world;
    for (const e of evs) {
      if (e.x === undefined) continue;
      const y = w.groundY(e.x, e.z) + 0.4;
      const X = e.x - OX;
      const Z = e.z - OZ;
      if (e.type === 'birth') this.burst(X, y, Z, '#ff8fd0', 5, 1, 2);
      else if (e.type === 'death') this.burst(X, y, Z, e.cause === 'eaten' ? '#d0d0d0' : '#8a8a8a', e.cause === 'eaten' ? 9 : 5, 1.6, 2);
      else if (e.type === 'eat') this.burst(X, y - 0.2, Z, '#ffb347', 3, 0.8, 1.5);
      else if (e.type === 'miss') this.burst(X, y, Z, '#ffffff', 3, 1.2, 1.5);
    }
  }

  burstAt(x, z, color, n) {
    const w = this.sim.world;
    this.burst(x - OX, w.groundY(x, z) + 0.5, z - OZ, color, n, 2.2, 3);
  }

  // ---- 空・光・天気
  updateSky(dt) {
    const w = this.sim.world;
    const el = w.sunElev;
    const morning = w.tod < 0.5;
    const night = C('#0b1430');
    const twi = morning ? C('#f2a066') : C('#ee7f57');
    const day = C('#8fc6ee');
    const sky = night.clone().lerp(twi, smoothstep(-0.28, 0.0, el)).lerp(day, smoothstep(0.0, 0.32, el));
    if (w.rainI > 0) sky.lerp(C('#6f7d8c'), 0.55 * w.rainI * (0.4 + 0.6 * w.daylight));
    if (w.heatI > 0) sky.lerp(C('#f0c27b'), 0.28 * w.heatI * w.daylight);
    if (w.coldI > 0) sky.lerp(C('#cfdbe8'), 0.3 * w.coldI * w.daylight);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    const R = this.orbit.rad;
    this.scene.fog.near = R * 1.0;
    this.scene.fog.far = R * 2.8 + 40;

    const a = w.sunA;
    const sunDir = this.tmpP.set(Math.cos(a), Math.sin(a), 0.35).normalize();
    const sunI = 2.3 * smoothstep(-0.04, 0.25, el) * (1 - 0.6 * w.rainI);
    const moonI = 0.55 * smoothstep(-0.04, 0.25, -el) * (1 - 0.6 * w.rainI);
    const useSun = el > -0.02;
    const dir = useSun ? sunDir : sunDir.clone().multiplyScalar(-1);
    const tgt = this.sun.target.position.set(this.orbit.tx, 0, this.orbit.tz);
    this.sun.position.copy(tgt).addScaledVector(dir, 70);
    if (useSun) this.sun.color.copy(C('#ffb27a')).lerp(C('#fff3df'), smoothstep(0, 0.45, el));
    else this.sun.color.set('#9fb4ff');
    this.sun.intensity = useSun ? sunI : moonI;
    this.hemi.color.copy(C('#26345c')).lerp(C('#bcd8ff'), w.daylight);
    this.hemi.groundColor.copy(C('#141420')).lerp(C('#6b5a3a'), w.daylight);
    this.hemi.intensity = 0.55 + 0.7 * w.daylight;
    this.sunBox.position.copy(tgt).addScaledVector(sunDir, 190);
    this.sunBox.visible = el > -0.1;
    this.moonBox.position.copy(tgt).addScaledVector(sunDir, -190);
    this.moonBox.visible = el < 0.1;
    this.starMat.opacity = smoothstep(0.1, -0.25, el) * (1 - w.rainI);
    this.sparkMat.opacity = 0.75 * w.daylight * (1 - w.rainI);
    if (Math.random() < dt * 6) this.placeSparkle(Math.floor(Math.random() * 90));
    this.sparkles.geometry.getAttribute('position').needsUpdate = true;
    this.sparkles.visible = this.sparkMat.opacity > 0.02;
    this.waterMat.color.copy(PAL.water).lerp(C('#10284d'), 1 - w.daylight).lerp(C('#8ea6b8'), w.snow * 0.3);

    // 雨・雪
    const snowing = w.coldI > 0.5 && w.temp < 6;
    const rain = Math.max(w.rainI, 0);
    let count = 0;
    if (snowing) count = Math.round(520 * Math.min(1, w.coldI));
    else if (rain > 0.02) count = Math.round(520 * rain);
    this.precip.geometry.setDrawRange(0, count);
    if (count > 0) {
      this.precipMat.color.set(snowing ? '#ffffff' : '#a9c6ff');
      const pp = this.precipPos;
      const ox = this.orbit.tx;
      const oz = this.orbit.tz;
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        if (snowing) {
          pp[k + 1] -= 2.4 * dt;
          pp[k] += Math.sin(this.time * 1.3 + i) * 0.6 * dt;
        } else {
          pp[k + 1] -= 26 * dt;
          pp[k] += 2 * dt;
        }
        if (pp[k + 1] < 0 || Math.abs(pp[k] - ox) > 32 || Math.abs(pp[k + 2] - oz) > 32) {
          pp[k] = ox + (Math.random() - 0.5) * 60;
          pp[k + 1] = pp[k + 1] < 0 ? 16 + Math.random() * 6 : Math.random() * 20;
          pp[k + 2] = oz + (Math.random() - 0.5) * 60;
        }
      }
      this.precip.geometry.getAttribute('position').needsUpdate = true;
    }
  }

  // ---- 選んだ個体
  updateSelection() {
    const c = this.selected;
    const ok = c && c.alive;
    this.marker.visible = !!ok;
    this.ring.visible = !!ok;
    this.tline.visible = false;
    if (!ok) return;
    const w = this.sim.world;
    const sc = 0.25 + c.t[TR.SIZE] * 0.95;
    this.marker.position.set(c.x - OX, (c.ry ?? w.groundY(c.x, c.z)) + 1.05 * sc + 0.35 + Math.sin(this.time * 4) * 0.08, c.z - OZ);
    this.marker.rotation.y = this.time * 2;
    const vis = c.t[TR.VISION] * (c.cls === HERB ? 1 - 0.3 * (1 - w.daylight) : 1);
    const N = this.ringPos.length / 3;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = c.x + Math.cos(a) * vis;
      const z = c.z + Math.sin(a) * vis;
      this.ringPos[i * 3] = x - OX;
      this.ringPos[i * 3 + 1] = Math.max(w.groundY(x, z), WATER_Y) + 0.06;
      this.ringPos[i * 3 + 2] = z - OZ;
    }
    this.ring.geometry.getAttribute('position').needsUpdate = true;
    let tx = null;
    let tz = null;
    let color = '#ffffff';
    if (c.act === ACT.EAT && c.food) {
      const f = c.food;
      if (f.k === 'p' && f.c.alive) {
        tx = f.c.x;
        tz = f.c.z;
        color = '#ff7a3a';
      } else if (f.k !== 'p') {
        tx = f.x;
        tz = f.z;
        color = '#8cff6a';
      }
    } else if (c.act === ACT.FLEE && c.thr && c.thr.alive) {
      tx = c.thr.x;
      tz = c.thr.z;
      color = '#ff4d4d';
    } else if (c.act === ACT.REPRO && c.mate && c.mate.alive) {
      tx = c.mate.x;
      tz = c.mate.z;
      color = '#ff8fd0';
    }
    if (tx !== null) {
      const y0 = (c.ry ?? 0) + 0.45 * sc;
      this.linePos[0] = c.x - OX;
      this.linePos[1] = y0;
      this.linePos[2] = c.z - OZ;
      this.linePos[3] = tx - OX;
      this.linePos[4] = w.groundY(tx, tz) + 0.35;
      this.linePos[5] = tz - OZ;
      this.tline.geometry.getAttribute('position').needsUpdate = true;
      this.tline.material.color.set(color);
      this.tline.visible = true;
    }
  }

  // ---- カメラ
  rotate(dx, dy) {
    this.orbit.az += dx * 0.009;
    this.orbit.pol = clamp(this.orbit.pol - dy * 0.007, 0.3, 1.32);
  }
  zoom(f) {
    this.orbit.rad = clamp(this.orbit.rad * f, 12, 115);
  }
  pan(dx, dy) {
    const o = this.orbit;
    const k = o.rad * 0.0026;
    const rx = Math.sin(o.az);
    const rz = -Math.cos(o.az);
    const fx = -Math.cos(o.az);
    const fz = -Math.sin(o.az);
    o.tx = clamp(o.tx - rx * dx * k + fx * dy * k, -OX, OX);
    o.tz = clamp(o.tz - rz * dx * k + fz * dy * k, -OZ, OZ);
    this.follow = false;
  }
  focus(x, z) {
    this.orbit.tx = x - OX;
    this.orbit.tz = z - OZ;
  }
  updateCamera(dt) {
    const o = this.orbit;
    const c = this.selected;
    if (this.follow && c && c.alive) {
      const k = Math.min(1, dt * 4);
      o.tx += (c.x - OX - o.tx) * k;
      o.tz += (c.z - OZ - o.tz) * k;
      o.ty += ((c.ry ?? 1.6) + 0.5 - o.ty) * k;
    } else {
      o.ty += (1.6 - o.ty) * Math.min(1, dt * 2);
    }
    const sp = Math.sin(o.pol);
    this.cam.position.set(o.tx + o.rad * sp * Math.cos(o.az), o.ty + o.rad * Math.cos(o.pol), o.tz + o.rad * sp * Math.sin(o.az));
    this.cam.lookAt(o.tx, o.ty, o.tz);
  }

  // ---- 画面座標 ⇔ 世界
  ndcFromClient(x, y) {
    return new THREE.Vector2((x / this.pixel / this.lw) * 2 - 1, ((this.ch - y) / this.pixel / this.lh) * 2 - 1);
  }
  clientFromWorld(X, Y, Z) {
    const v = this.tmpP.set(X, Y, Z).project(this.cam);
    return [((v.x + 1) / 2) * this.lw * this.pixel, this.ch - ((v.y + 1) / 2) * this.lh * this.pixel, v.z];
  }
  pickCreature(x, y, maxDist = 30) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const c of this.sim.creatures) {
      if (!c.alive) continue;
      const [sx, sy, sz] = this.clientFromWorld(c.x - OX, (c.ry ?? 0) + 0.35 * c.t[TR.SIZE], c.z - OZ);
      if (sz > 1) continue;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }
  pickGround(x, y) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.ndcFromClient(x, y), this.cam);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const w = this.sim.world;
    const height = (X, Z) => {
      const k = w.cellIndex(X + OX, Z + OZ);
      return k < 0 ? WATER_Y : Math.max(w.level[k] * LEVEL_H, WATER_Y);
    };
    let prev = 0;
    for (let t = 0; t < 400; t += 0.25) {
      const X = o.x + d.x * t;
      const Y = o.y + d.y * t;
      const Z = o.z + d.z * t;
      if (Y <= height(X, Z)) {
        let a = prev;
        let b = t;
        for (let q = 0; q < 8; q++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m <= height(o.x + d.x * m, o.z + d.z * m)) b = m;
          else a = m;
        }
        const hx = o.x + d.x * b + OX;
        const hz = o.z + d.z * b + OZ;
        if (w.cellIndex(hx, hz) < 0) return null;
        return { x: hx, z: hz };
      }
      prev = t;
      if (Y < -1) break;
    }
    return null;
  }

  render(dt) {
    if (!this.sim) return;
    this.time += dt;
    const w = this.sim.world;
    this.terrainAcc += dt;
    if (this.terrainAcc > 0.25) {
      this.terrainAcc = 0;
      this.updateTerrainColors(false);
    }
    if (w.treeVersion !== this.lastTreeV) {
      this.lastTreeV = w.treeVersion;
      this.updateTrees();
    }
    this.updateItems();
    this.updateCreatures(dt);
    this.updateParticles(dt);
    this.updateCamera(dt);
    this.updateSky(dt);
    this.updateSelection();
    this.r.setRenderTarget(this.rt);
    this.r.render(this.scene, this.cam);
    this.r.setRenderTarget(null);
    this.r.render(this.postScene, this.postCam);
  }
}
