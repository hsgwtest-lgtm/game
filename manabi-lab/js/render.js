// render.js — Three.js でボクセルの島を描く（ブラウザ用）
//   低い解像度で描いてから最近傍で拡大し（canvas 自体を小さくして CSS で引きのばす）、
//   さらに色を段階化＋ディザ、奥行きの段差に輪郭線をつけて、ドット絵の質感にする。
//   描くのは「島の状態」だけで、シミュレーションには手を出さない（ライブでもリプレイでも同じ描き方）
import * as THREE from '../lib/three.module.min.js';
import { G, NC, LEVEL_H, WATER_Y, T, sunAt } from './world.js';
import { METHODS, ACT, N_METHODS } from './defs.js';

const OFF = G / 2;
const wx = (i) => i - OFF + 0.5;
const C = (hex) => new THREE.Color(hex);
const MAX_C = 420; // 1方式あたり描ける数

const PAL = {
  deep: C('#1d4a86'),
  shallow: C('#d2bd83'),
  sand: C('#ecd8a0'),
  dirt: C('#9a7444'),
  lush: C('#4fb848'),
  hillDirt: C('#8f7c52'),
  hillLush: C('#74a64a'),
  rock: C('#8e8a84'),
  forest: C('#3c7a34'),
  trunk: C('#6b4426'),
  leafA: C('#2f7d32'),
  leafB: C('#45a046'),
  tuft: C('#6fd85a'),
  water: C('#3d8fd6'),
  bed: C('#163a6a'),
};

const hash2 = (i, j) => {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// 箱を組み合わせて形を作る（頂点色・面ごとの法線つき）
class GeoBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
  }
  quad(a, b, c, d, nx, ny, nz, col) {
    for (const v of [a, b, c, a, c, d]) {
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nx, ny, nz);
      this.c.push(col.r, col.g, col.b);
    }
  }
  // sideShade: 横の面を暗くする割合（ボクセルらしい陰影）
  box(cx, cy, cz, sx, sy, sz, col, sideShade = 1) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const s1 = col.clone().multiplyScalar(sideShade);
    const s2 = col.clone().multiplyScalar(sideShade * 0.86);
    const bt = col.clone().multiplyScalar(sideShade * 0.6);
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 0, 1, 0, col);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0, bt);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0, s1);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, s1);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, s2);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], 0, 0, -1, s2);
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

// 地形の柱（高さ1、底が y=0）。上面は明るく、側面は暗い
function columnGeometry() {
  const b = new GeoBuilder();
  b.box(0, 0.5, 0, 1, 1, 1, new THREE.Color(1, 1, 1), 0.66);
  return b.build();
}

// 生き物。前は +x。方式ごとに頭の飾りがちがう（競争モードでも見分けられる）
function creatureGeometry(m) {
  const b = new GeoBuilder();
  const body = C(METHODS[m].color);
  const dark = C(METHODS[m].dark);
  const black = C('#0b1020');
  const white = C('#f4f6fa');
  b.box(0, 0.24, 0, 0.5, 0.36, 0.46, body, 0.8);
  b.box(0.26, 0.3, 0.11, 0.04, 0.08, 0.07, black);
  b.box(0.26, 0.3, -0.11, 0.04, 0.08, 0.07, black);
  b.box(0.1, 0.03, 0.13, 0.14, 0.06, 0.1, dark);
  b.box(0.1, 0.03, -0.13, 0.14, 0.06, 0.1, dark);
  b.box(-0.12, 0.03, 0.13, 0.14, 0.06, 0.1, dark);
  b.box(-0.12, 0.03, -0.13, 0.14, 0.06, 0.1, dark);
  if (m === 0) {
    // ルール: 四角い帽子（きまりを守る係）
    b.box(0, 0.45, 0, 0.38, 0.06, 0.38, C('#56657a'));
    b.box(0, 0.53, 0, 0.24, 0.12, 0.24, C('#56657a'));
  } else if (m === 1) {
    // 進化NN: アンテナ
    b.box(0, 0.5, 0, 0.05, 0.18, 0.05, dark);
    b.box(0, 0.62, 0, 0.12, 0.12, 0.12, C('#ffd84a'));
  } else if (m === 2) {
    // Q学習: ゴーグル（表を読む）
    b.box(0.27, 0.31, 0, 0.05, 0.12, 0.42, white, 0.9);
    b.box(0.29, 0.31, 0.11, 0.04, 0.07, 0.08, C('#1f6f86'));
    b.box(0.29, 0.31, -0.11, 0.04, 0.07, 0.08, C('#1f6f86'));
  } else {
    // ランダム＋選択: 頭にサイコロ
    b.box(0, 0.52, 0, 0.2, 0.2, 0.2, white, 0.85);
    b.box(0.101, 0.52, 0, 0.01, 0.05, 0.05, black);
    b.box(0, 0.621, 0, 0.05, 0.01, 0.05, black);
  }
  return b.build();
}

function treeGeometry() {
  const b = new GeoBuilder();
  b.box(0, 0.4, 0, 0.26, 0.8, 0.26, PAL.trunk, 0.8);
  b.box(0, 1.0, 0, 0.95, 0.6, 0.95, PAL.leafA, 0.75);
  b.box(0, 1.45, 0, 0.6, 0.4, 0.6, PAL.leafB, 0.75);
  return b.build();
}
function tuftGeometry() {
  const b = new GeoBuilder();
  const g = new THREE.Color(1, 1, 1);
  b.box(-0.12, 0.1, 0.05, 0.08, 0.2, 0.08, g, 0.8);
  b.box(0.1, 0.07, 0.1, 0.08, 0.14, 0.08, g, 0.8);
  b.box(0.02, 0.09, -0.12, 0.08, 0.18, 0.08, g, 0.8);
  return b.build();
}
function rockGeometry() {
  const b = new GeoBuilder();
  b.box(0, 0.15, 0, 0.7, 0.3, 0.6, C('#a19d96'), 0.75);
  b.box(0.08, 0.36, 0.04, 0.38, 0.16, 0.34, C('#b7b3ac'), 0.75);
  return b.build();
}

const POST_VS = `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
// 色の段階化（4×4 ベイヤーのディザ）と、奥行きの段差の輪郭線
const POST_FS = `
uniform sampler2D tCol;
uniform sampler2D tDep;
uniform vec2 res;
uniform float cnear;
uniform float cfar;
uniform float levels;
float lin(float d) { return cnear * cfar / (cfar - d * (cfar - cnear)); }
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  vec2 px = floor(gl_FragCoord.xy);
  vec2 uv = (px + 0.5) / res;
  vec2 dx = vec2(1.0 / res.x, 0.0);
  vec2 dy = vec2(0.0, 1.0 / res.y);
  vec3 c = texture2D(tCol, uv).rgb;
  float d = lin(texture2D(tDep, uv).r);
  float n = max(max(lin(texture2D(tDep, uv + dx).r), lin(texture2D(tDep, uv - dx).r)),
                max(lin(texture2D(tDep, uv + dy).r), lin(texture2D(tDep, uv - dy).r)));
  float edge = step(0.3 + d * 0.02, n - d);
  c *= mix(1.0, 0.45, edge);
  c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
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
    this.pixel = 2; // 1ドット = CSS の何ピクセルか
    this.time = 0;
    this.terr = null;
    this.lastGrassTick = -1;
    this.selected = -1;
    this.focusSlot = -1;
    this.picks = [];

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8fd0ff');
    this.scene.fog = new THREE.Fog(0x8fd0ff, 70, 150);
    this.cam = new THREE.PerspectiveCamera(34, 1, 1, 400);
    this.orbit = { az: -0.75, pol: 0.95, rad: 50, tx: 0, ty: 0.8, tz: 0 };

    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x6b5a3a, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 22;
    sc.bottom = -22;
    sc.near = 1;
    sc.far = 140;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8fa8ff, 0);
    this.scene.add(this.moon, this.moon.target);

    this.makeStatic();
    this.makePost();
    this.resize();
  }

  makeStatic() {
    const s = this.scene;
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: PAL.bed }));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -1;
    s.add(bed);
    this.waterMat = new THREE.MeshLambertMaterial({ color: PAL.water, transparent: true, opacity: 0.72 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    s.add(water);

    // 星・太陽・月（箱）
    const ST = 180;
    const sp = new Float32Array(ST * 3);
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < ST; i++) {
      const a = rnd() * Math.PI * 2;
      const e = 0.15 + rnd() * 1.3;
      sp[i * 3] = Math.cos(a) * Math.cos(e) * 180;
      sp[i * 3 + 1] = Math.sin(e) * 180;
      sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 180;
    }
    const stg = new THREE.BufferGeometry();
    stg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    const stars = new THREE.Points(stg, this.starMat);
    stars.frustumCulled = false;
    s.add(stars);
    this.sunBox = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe58a, fog: false }));
    this.moonBox = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshBasicMaterial({ color: 0xe6ecff, fog: false }));
    s.add(this.sunBox, this.moonBox);

    const mkInst = (geo, n, cast = true) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = cast;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const w = new THREE.Color(1, 1, 1);
      for (let i = 0; i < n; i++) m.setColorAt(i, w);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      s.add(m);
      return m;
    };
    this.mkInst = mkInst;
    this.colMesh = mkInst(columnGeometry(), NC, false);
    this.colMesh.receiveShadow = true;
    this.treeMesh = mkInst(treeGeometry(), NC);
    this.rockMesh = mkInst(rockGeometry(), NC);
    this.tuftMesh = mkInst(tuftGeometry(), NC, false);
    this.cMesh = [];
    for (let m = 0; m < N_METHODS; m++) this.cMesh.push(mkInst(creatureGeometry(m), MAX_C));

    // できごとの粒
    const PP = 320;
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

    // 目印（選んだ個体・リプレイの主役）と足あと
    this.marker = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshBasicMaterial({ color: 0xffd84a, fog: false }));
    this.marker.visible = false;
    s.add(this.marker);
    const TR = 64;
    this.trailPos = new Float32Array(TR * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({ color: 0xffd84a, size: 2, sizeAttenuation: false, fog: false }));
    this.trail.frustumCulled = false;
    this.trail.geometry.setDrawRange(0, 0);
    s.add(this.trail);

    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpS = new THREE.Vector3();
    this.tmpP = new THREE.Vector3();
    this.tmpC = new THREE.Color();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  makePost() {
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VS,
      fragmentShader: POST_FS,
      uniforms: {
        tCol: { value: null },
        tDep: { value: null },
        res: { value: new THREE.Vector2(1, 1) },
        cnear: { value: this.cam.near },
        cfar: { value: this.cam.far },
        levels: { value: 20 },
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
    this.cw = cw;
    this.ch = ch;
    this.lw = Math.ceil(cw / this.pixel);
    this.lh = Math.ceil(ch / this.pixel);
    this.r.setSize(this.lw, this.lh, false);
    // CSS では整数倍に引きのばす（はみ出た分は画面の外）
    this.canvas.style.width = `${this.lw * this.pixel}px`;
    this.canvas.style.height = `${this.lh * this.pixel}px`;
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
    // 縦長の画面でも島がおさまる距離
    this.fitRad = 50 / Math.sqrt(Math.min(1, this.cam.aspect));
    this.applyInset();
    const u = this.postMat.uniforms;
    u.tCol.value = this.rt.texture;
    u.tDep.value = this.rt.depthTexture;
    u.res.value.set(this.lw, this.lh);
  }
  // 下のパネルに隠れないよう、画面の中心を上にずらす（px は CSS ピクセル）
  setInset(px) {
    this.inset = Math.max(0, px || 0);
    this.applyInset();
  }
  applyInset() {
    const off = Math.round((this.inset || 0) / this.pixel / 2);
    if (off > 0) this.cam.setViewOffset(this.lw, this.lh, 0, off, this.lw, this.lh);
    else this.cam.clearViewOffset();
    this.cam.updateProjectionMatrix();
  }
  setPixel(p) {
    this.pixel = p;
    this.resize();
  }
  setShadows(on) {
    this.sun.castShadow = on;
  }

  // ---- 島の地形（シードが変わったときだけ作り直す）
  setTerrain(terr) {
    if (this.terr === terr) return;
    this.terr = terr;
    this.orbit.rad = this.fitRad || 50;
    this.orbit.tx = 0;
    this.orbit.tz = 0;
    this.lastGrassTick = -1;
    this.top = new Float32Array(NC);
    const M4 = this.tmpM;
    let nt = 0;
    let nr = 0;
    for (let k = 0; k < NC; k++) {
      const i = k % G;
      const j = (k / G) | 0;
      const lv = terr.level[k];
      const top = lv === 0 ? 0.1 : lv * LEVEL_H;
      this.top[k] = top;
      this.tmpS.set(1, top + 1, 1);
      this.tmpP.set(wx(i), -1, wx(j));
      M4.compose(this.tmpP, this.tmpQ.identity(), this.tmpS);
      this.colMesh.setMatrixAt(k, M4);
      const t = terr.type[k];
      if (t === T.TREE) {
        const sc = 0.8 + hash2(i, j) * 0.4;
        this.tmpS.set(sc, sc * (0.9 + hash2(j, i) * 0.3), sc);
        this.tmpP.set(wx(i), top, wx(j));
        this.tmpQ.setFromAxisAngle(this.up, Math.floor(hash2(i + 3, j) * 4) * (Math.PI / 2));
        M4.compose(this.tmpP, this.tmpQ, this.tmpS);
        this.treeMesh.setMatrixAt(nt++, M4);
      } else if (t === T.ROCK && hash2(j + 11, i) < 0.4) {
        this.tmpS.set(1, 1, 1);
        this.tmpP.set(wx(i), top, wx(j));
        this.tmpQ.setFromAxisAngle(this.up, hash2(i, j + 5) * Math.PI);
        M4.compose(this.tmpP, this.tmpQ, this.tmpS);
        this.rockMesh.setMatrixAt(nr++, M4);
      }
    }
    this.tmpQ.identity();
    this.colMesh.count = NC;
    this.treeMesh.count = nt;
    this.rockMesh.count = nr;
    this.colMesh.instanceMatrix.needsUpdate = true;
    this.treeMesh.instanceMatrix.needsUpdate = true;
    this.rockMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < nt; i++) this.treeMesh.setColorAt(i, this.tmpC.setScalar(0.85 + hash2(i, 9) * 0.25));
    this.treeMesh.instanceColor.needsUpdate = true;
  }

  // 草の量で地面の色と草むらを変える。grass は 0〜1（scale=1）か 0〜255（scale=1/255）
  updateGrass(grass, scale) {
    const terr = this.terr;
    const col = this.tmpC;
    this.tmpQ.identity();
    let nt = 0;
    const M4 = this.tmpM;
    for (let k = 0; k < NC; k++) {
      const i = k % G;
      const j = (k / G) | 0;
      const t = terr.type[k];
      const g = grass[k] * scale;
      const ck = (i + j) & 1 ? 0.93 : 1; // 市松もようでドット感を出す
      switch (t) {
        case T.DEEP:
          col.copy(PAL.deep);
          break;
        case T.SHALLOW:
          col.copy(PAL.shallow);
          break;
        case T.SAND:
          col.copy(PAL.sand).lerp(PAL.lush, Math.min(1, g * 1.5) * 0.5);
          break;
        case T.MEADOW:
          col.copy(PAL.dirt).lerp(PAL.lush, Math.min(1, g * 1.6));
          break;
        case T.HILL:
          col.copy(PAL.hillDirt).lerp(PAL.hillLush, Math.min(1, g * 1.6));
          break;
        case T.ROCK:
          col.copy(PAL.rock);
          break;
        default:
          col.copy(PAL.forest);
      }
      col.multiplyScalar(ck * (0.96 + hash2(i, j) * 0.08));
      this.colMesh.setColorAt(k, col);
      if (terr.walk[k] && g > 0.22) {
        const s = 0.5 + g * 0.8;
        this.tmpS.set(s, s, s);
        this.tmpP.set(wx(i) + (hash2(i, j + 1) - 0.5) * 0.4, this.top[k], wx(j) + (hash2(i + 1, j) - 0.5) * 0.4);
        M4.compose(this.tmpP, this.tmpQ, this.tmpS);
        this.tuftMesh.setMatrixAt(nt, M4);
        this.tuftMesh.setColorAt(nt, col.copy(PAL.tuft).multiplyScalar(0.75 + g * 0.35));
        nt++;
      }
    }
    this.tuftMesh.count = nt;
    this.colMesh.instanceColor.needsUpdate = true;
    this.tuftMesh.instanceMatrix.needsUpdate = true;
    this.tuftMesh.instanceColor.needsUpdate = true;
  }

  // ---- できごとの粒
  emit(x, y, z, r, g, b, n, spread, up) {
    for (let q = 0; q < n; q++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % this.pLife.length;
      this.pPos[i * 3] = x;
      this.pPos[i * 3 + 1] = y;
      this.pPos[i * 3 + 2] = z;
      this.pVel[i * 3] = (Math.random() - 0.5) * spread;
      this.pVel[i * 3 + 1] = up * (0.6 + Math.random() * 0.6);
      this.pVel[i * 3 + 2] = (Math.random() - 0.5) * spread;
      this.pCol[i * 3] = r;
      this.pCol[i * 3 + 1] = g;
      this.pCol[i * 3 + 2] = b;
      this.pLife[i] = 0.6 + Math.random() * 0.5;
    }
  }
  onFx(list) {
    if (!this.terr) return;
    for (const e of list) {
      const k = e.y * G + e.x;
      const x = wx(e.x);
      const z = wx(e.y);
      const y = this.top[k] + 0.4;
      if (e.t === 'eat') this.emit(x, y, z, 0.45, 0.95, 0.4, 1, 0.8, 1.2);
      else if (e.t === 'birth') this.emit(x, y + 0.2, z, 1, 0.45, 0.85, 6, 2.2, 2.2);
      else if (e.t === 'death') {
        if (e.cause === 'owl') this.emit(x, y + 0.3, z, 0.65, 0.5, 1, 7, 2.6, 2.4);
        else this.emit(x, y, z, 0.7, 0.72, 0.78, 5, 1.6, 1.4);
      } else if (e.t === 'bump') this.emit(x, y, z, 1, 1, 1, 1, 1.4, 0.8);
    }
  }
  updateParticles(dt) {
    const P = this.pPos;
    const V = this.pVel;
    for (let i = 0; i < this.pLife.length; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        P[i * 3 + 1] = -999;
        continue;
      }
      V[i * 3 + 1] -= 4 * dt;
      P[i * 3] += V[i * 3] * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += V[i * 3 + 2] * dt;
    }
    this.parts.geometry.attributes.position.needsUpdate = true;
    this.parts.geometry.attributes.color.needsUpdate = true;
  }

  // ---- 生き物。list: [{ id, m, x, y, px, py, act, dir, e, explore, slot }]
  //   frac: 前のターンから今のターンへの進み具合（0〜1）。opt: { dim(c) → 暗くするか, focus(c) → 主役か }
  updateCreatures(list, frac, opt = {}) {
    const n = new Array(N_METHODS).fill(0);
    const M4 = this.tmpM;
    const col = this.tmpC;
    const picks = this.picks;
    picks.length = 0;
    let markerAt = null;
    const night = opt.night;
    for (let q = 0; q < list.length; q++) {
      const c = list[q];
      const mesh = this.cMesh[c.m];
      const idx = n[c.m];
      if (idx >= MAX_C) continue;
      n[c.m]++;
      const moved = c.x !== c.px || c.y !== c.py;
      const f = moved ? frac : 1;
      const gx = c.px + (c.x - c.px) * f;
      const gy = c.py + (c.y - c.py) * f;
      const k0 = c.py * G + c.px;
      const k1 = c.y * G + c.x;
      let y = this.top[k0] + (this.top[k1] - this.top[k0]) * f;
      // 同じマスに何匹かいても重ならないよう、少しずらす
      const jx = (hash2(c.id, 3) - 0.5) * 0.36;
      const jz = (hash2(c.id, 7) - 0.5) * 0.36;
      let sy = 1;
      let sxz = 1;
      if (moved) y += Math.sin(frac * Math.PI) * 0.3;
      if (c.act === ACT.SLEEP) {
        sy = 0.62;
        sxz = 1.08;
      } else if (c.act === ACT.EAT) {
        y -= Math.abs(Math.sin((this.time * 9 + c.id) % Math.PI)) * 0.06;
      }
      const dir = c.dir ?? (c.act >= 1 && c.act <= 4 ? c.act - 1 : 1);
      const rot = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][dir & 3];
      // 若い（世代内で生まれた）個体は少し小さい
      const age = c.depth > 0 ? 0.82 : 1;
      this.tmpS.set(sxz * age, sy * age, sxz * age);
      this.tmpP.set(wx(gx) + jx, y, wx(gy) + jz);
      this.tmpQ.setFromAxisAngle(this.up, rot);
      M4.compose(this.tmpP, this.tmpQ, this.tmpS);
      mesh.setMatrixAt(idx, M4);
      let b = 1;
      if (c.act === ACT.SLEEP) b = 0.7;
      if (c.e < 15) b *= 0.75 + 0.25 * Math.abs(Math.sin(this.time * 6));
      if (c.explore) b = 1.9; // Q学習の「試し」の一手は白く光る
      if (opt.dim && opt.dim(c)) b *= 0.35;
      if (night && c.act !== ACT.SLEEP) b *= 1.1;
      mesh.setColorAt(idx, col.setScalar(b));
      picks.push({ id: c.id, x: this.tmpP.x, y: y + 0.3, z: this.tmpP.z });
      if (c.id === this.selected || (opt.focus && opt.focus(c))) {
        if (!markerAt || c.id === this.selected) markerAt = [this.tmpP.x, y, this.tmpP.z];
      }
    }
    for (let m = 0; m < N_METHODS; m++) {
      const mesh = this.cMesh[m];
      mesh.count = n[m];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    if (markerAt) {
      this.marker.visible = true;
      this.marker.position.set(markerAt[0], markerAt[1] + 1.0 + Math.sin(this.time * 4) * 0.12, markerAt[2]);
      this.marker.rotation.y = this.time * 2;
    } else this.marker.visible = false;
  }

  // 足あと: [[x, y], ...]
  setTrail(pts) {
    const n = Math.min(pts ? pts.length : 0, this.trailPos.length / 3);
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[pts.length - n + i];
      const k = y * G + x;
      this.trailPos[i * 3] = wx(x);
      this.trailPos[i * 3 + 1] = (this.top ? this.top[k] : 1) + 0.06;
      this.trailPos[i * 3 + 2] = wx(y);
    }
    this.trail.geometry.setDrawRange(0, n);
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  updateSky(tick) {
    const s = sunAt(tick);
    const d = s.daylight;
    const dayC = this.tmpC.set('#8fd0ff');
    const dusk = new THREE.Color('#ff9a6a');
    const nightC = new THREE.Color('#0d1430');
    const twilight = Math.max(0, 1 - Math.abs(s.elev) / 0.3) * 0.6;
    const bg = nightC.clone().lerp(dayC, d).lerp(dusk, twilight * (d > 0.05 ? 1 : 0.3));
    this.scene.background.copy(bg);
    this.scene.fog.color.copy(bg);
    this.hemi.intensity = 0.3 + 0.85 * d;
    this.sun.intensity = 2.3 * d;
    this.moon.intensity = 0.55 * (1 - d);
    this.starMat.opacity = Math.max(0, 1 - d * 1.6);
    const a = s.angle;
    const R = 90;
    this.sun.position.set(Math.cos(a) * R * 0.8, Math.sin(a) * R + 4, 26);
    this.sun.target.position.set(0, 0, 0);
    this.sunBox.position.set(Math.cos(a) * 150, Math.sin(a) * 150, 40);
    this.moonBox.position.set(-Math.cos(a) * 150, -Math.sin(a) * 150, 40);
    this.moon.position.set(-Math.cos(a) * 60, Math.max(20, -Math.sin(a) * 60), -20);
    this.sunBox.visible = Math.sin(a) > -0.1;
    this.moonBox.visible = Math.sin(a) < 0.1;
    this.waterMat.color.copy(PAL.water).multiplyScalar(0.35 + 0.65 * d);
    return d;
  }

  updateCamera() {
    const o = this.orbit;
    o.pol = Math.max(0.25, Math.min(1.35, o.pol));
    o.rad = Math.max(14, Math.min(110, o.rad));
    o.tx = Math.max(-OFF, Math.min(OFF, o.tx));
    o.tz = Math.max(-OFF, Math.min(OFF, o.tz));
    const sp = Math.sin(o.pol);
    this.cam.position.set(o.tx + o.rad * sp * Math.cos(o.az), o.ty + o.rad * Math.cos(o.pol), o.tz + o.rad * sp * Math.sin(o.az));
    this.cam.lookAt(o.tx, o.ty, o.tz);
  }

  // 画面の点（CSS ピクセル）にいちばん近い生き物の id（なければ -1）
  pick(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    let best = -1;
    let bd = 28 * 28;
    for (const p of this.picks) {
      v.set(p.x, p.y, p.z).project(this.cam);
      if (v.z > 1) continue;
      const x = rect.left + ((v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = p.id;
      }
    }
    return best;
  }

  // state: { grass, gscale, tick（小数可）, gtick（草を描き直す合図）, list, frac, dim, focus }
  render(dt, state) {
    this.time += dt;
    if (state && this.terr) {
      if (state.gtick !== this.lastGrassTick) {
        this.lastGrassTick = state.gtick;
        this.updateGrass(state.grass, state.gscale);
      }
      const d = this.updateSky(state.tick);
      this.updateCreatures(state.list, state.frac, { dim: state.dim, focus: state.focus, night: d < 0.3 });
    }
    this.updateParticles(dt);
    this.updateCamera();
    this.r.setRenderTarget(this.rt);
    this.r.render(this.scene, this.cam);
    this.r.setRenderTarget(null);
    this.r.render(this.postScene, this.postCam);
  }
}
