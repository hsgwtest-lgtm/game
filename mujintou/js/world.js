// Three.js のシーン：地形・海・植生・建物・空。

import * as THREE from '../lib/three.module.js';
import { N, CELL, HALF, SEA_Y, MIN_Y, BIOME, DISTRICTS } from './terrain.js';
import { campfireBoxes } from './buildings.js';
import { terrainAtlas, voxelTexture, waterTexture, ATLAS_ROWS } from './pixelart.js';
import { hash01 } from './rng.js';

const C = (hex) => new THREE.Color(hex);

const COLORS = {
  grass: ['#6cc24a', '#64b944', '#75c953'],
  forest: ['#3f9a45', '#39903f', '#46a34b'],
  high: ['#a3c956', '#99c04e', '#accf5f'],
  sand: ['#f3e0a2', '#eed998', '#f7e6ad'],
  wetSand: ['#e2cc8c', '#dcc584', '#e6d194'],
  rock: ['#9c9ca8', '#8e8e9a', '#a6a6b1'],
  plaza: ['#dcb87e', '#d5b077', '#e1bf88'],
  path: ['#cba76c', '#c49f64', '#d0ad74'],
  wallDirt: '#8a5f3a',
  wallSand: '#cdb578',
  wallRock: '#74747f',
  seabed: { 0: '#efe6ab', '-1': '#a7dccb', '-2': '#62bccb', '-3': '#3b93c6', '-4': '#2a78b6' },
  deep: '#22669f',
};

function nearestTex(canvas, { repeat = false, mip = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mip;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 箱の配列を1つのジオメトリにまとめる（頂点カラーつき）
function boxesToGeometry(boxes) {
  const pos = [];
  const nor = [];
  const col = [];
  const uv = [];
  const index = [];
  const color = new THREE.Color();
  const faces = [
    // [法線, 4頂点（単位立方体の符号）, u方向の寸法の軸, v方向の寸法の軸]
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], ua: 2, va: 1 },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], ua: 2, va: 1 },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], ua: 0, va: 2 },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], ua: 0, va: 2 },
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], ua: 0, va: 1 },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], ua: 0, va: 1 },
  ];
  const quadUV = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  for (const b of boxes) {
    color.set(b.c);
    for (const f of faces) {
      const base = pos.length / 3;
      f.v.forEach((s, n) => {
        pos.push(b.p[0] + (s[0] * b.s[0]) / 2, b.p[1] + (s[1] * b.s[1]) / 2, b.p[2] + (s[2] * b.s[2]) / 2);
        nor.push(...f.n);
        col.push(color.r, color.g, color.b);
        uv.push((quadUV[n][0] * b.s[f.ua]) / 2, (quadUV[n][1] * b.s[f.va]) / 2);
      });
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

// 時刻ごとの空と光
const SKY_KEYS = [
  { h: 0, sky: '#1c2452', hemi: '#8ea0ff', ground: '#39406e', hemiI: 1.55, sun: '#9fb4ff', sunI: 0.75, night: 1 },
  { h: 4.5, sky: '#1c2452', hemi: '#8ea0ff', ground: '#39406e', hemiI: 1.55, sun: '#9fb4ff', sunI: 0.75, night: 1 },
  { h: 6, sky: '#f6b88a', hemi: '#ffd9c0', ground: '#8a7f6a', hemiI: 1.7, sun: '#ffc48a', sunI: 1.5, night: 0.3 },
  { h: 8, sky: '#8fd6f5', hemi: '#ffffff', ground: '#b9c9a0', hemiI: 1.9, sun: '#fff4dc', sunI: 2.1, night: 0 },
  { h: 16, sky: '#8fd6f5', hemi: '#ffffff', ground: '#b9c9a0', hemiI: 1.9, sun: '#fff4dc', sunI: 2.1, night: 0 },
  { h: 17.8, sky: '#f5a56e', hemi: '#ffd2b0', ground: '#8a7f6a', hemiI: 1.7, sun: '#ffab66', sunI: 1.6, night: 0.25 },
  { h: 19.3, sky: '#2a2f66', hemi: '#98a6ff', ground: '#39406e', hemiI: 1.55, sun: '#9fb4ff', sunI: 0.8, night: 1 },
  { h: 24, sky: '#1c2452', hemi: '#8ea0ff', ground: '#39406e', hemiI: 1.55, sun: '#9fb4ff', sunI: 0.75, night: 1 },
];

// hub: 島民の集まり場（sim.js の resolveHub）。拠点（isBase）のときだけ、たき火と丸太のいすを置く。
// 行動範囲の外の地区も見た目は変えない（壁ではなく、島民の行動で表す）。
export function createWorld({ canvas, terrain, deco, buildings, hub = null, trailCells }) {
  const { h, biome, idx, cellCenter, heightAtCell, seed } = terrain;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = C('#8fd6f5');
  scene.fog = new THREE.Fog('#8fd6f5', 520, 1500);
  const camera = new THREE.PerspectiveCamera(38, 1, 2, 3200);

  const hemi = new THREE.HemisphereLight('#ffffff', '#b9c9a0', 1.9);
  const sun = new THREE.DirectionalLight('#fff4dc', 2.1);
  sun.position.set(-0.55, 1, 0.45);
  scene.add(hemi, sun);

  const atlasTex = nearestTex(terrainAtlas(), { mip: true });
  const voxTex = nearestTex(voxelTexture(), { repeat: true, mip: true });
  const waterTex = nearestTex(waterTexture(), { repeat: true, mip: true });

  // ---- 地形 ----------------------------------------------------------------
  const tmp = new THREE.Color();
  function cellStyle(i, j) {
    const k = idx(i, j);
    const y = h[k];
    const v = Math.floor(hash01(i, j, seed + 21) * 3);
    let top;
    let wall = COLORS.wallDirt;
    let row = ATLAS_ROWS.grass;
    if (y < 1) {
      top = COLORS.seabed[Math.max(-4, y)];
      wall = top;
      row = ATLAS_ROWS.sand;
    } else {
      let b = biome[k];
      if (trailCells && trailCells.has(k) && b !== BIOME.PLAZA && b !== BIOME.SAND && b !== BIOME.ROCK) b = BIOME.PATH;
      switch (b) {
        case BIOME.SAND: {
          const wet = y === 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => heightAtCell(i + a, j + c) < 1);
          top = (wet ? COLORS.wetSand : COLORS.sand)[v];
          wall = COLORS.wallSand;
          row = ATLAS_ROWS.sand;
          break;
        }
        case BIOME.FOREST:
          top = COLORS.forest[v];
          break;
        case BIOME.HIGH:
          top = COLORS.high[v];
          break;
        case BIOME.ROCK:
          top = COLORS.rock[v];
          wall = COLORS.wallRock;
          row = ATLAS_ROWS.rock;
          break;
        case BIOME.PLAZA:
          top = COLORS.plaza[v];
          row = ATLAS_ROWS.dirt;
          break;
        case BIOME.PATH:
          top = COLORS.path[v];
          row = ATLAS_ROWS.dirt;
          break;
        default:
          top = COLORS.grass[v];
      }
    }
    return { top, wall, row, variant: Math.floor(hash01(i, j, seed + 22) * 4) };
  }

  function buildTerrain() {
    const pos = [];
    const nor = [];
    const col = [];
    const uv = [];
    const index = [];
    const T = 0.25;
    const pushColor = (hex, mul = 1) => {
      tmp.set(hex);
      tmp.multiplyScalar(mul);
      for (let n = 0; n < 4; n++) col.push(tmp.r, tmp.g, tmp.b);
    };
    const quad = () => {
      const base = pos.length / 3 - 4;
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const sides = [
      { di: 1, dj: 0, n: [1, 0, 0], c: [[1, 1], [1, 0]] },
      { di: -1, dj: 0, n: [-1, 0, 0], c: [[0, 0], [0, 1]] },
      { di: 0, dj: 1, n: [0, 0, 1], c: [[0, 1], [1, 1]] },
      { di: 0, dj: -1, n: [0, 0, -1], c: [[1, 0], [0, 0]] },
    ];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const y = h[idx(i, j)];
        if (y <= MIN_Y) continue;
        const st = cellStyle(i, j);
        const x0 = (i - N / 2) * CELL;
        const z0 = (j - N / 2) * CELL;
        const x1 = x0 + CELL;
        const z1 = z0 + CELL;
        const u0 = st.variant * T;
        const v0 = 1 - (st.row + 1) * T;
        // 上面
        pos.push(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0);
        for (let n = 0; n < 4; n++) nor.push(0, 1, 0);
        uv.push(u0, v0, u0 + T, v0, u0 + T, v0 + T, u0, v0 + T);
        pushColor(st.top);
        quad();
        // 側面（低い隣との段差）
        const wv0 = 1 - ((y >= 1 && st.row !== ATLAS_ROWS.rock ? ATLAS_ROWS.dirt : st.row) + 1) * T;
        for (const s of sides) {
          const ny = Math.max(MIN_Y, heightAtCell(i + s.di, j + s.dj));
          if (ny >= y) continue;
          for (let top = y; top > ny; top--) {
            const bot = top - 1;
            const ax = x0 + s.c[0][0] * CELL;
            const az = z0 + s.c[0][1] * CELL;
            const bx = x0 + s.c[1][0] * CELL;
            const bz = z0 + s.c[1][1] * CELL;
            pos.push(ax, bot, az, bx, bot, bz, bx, top, bz, ax, top, az);
            for (let n = 0; n < 4; n++) nor.push(...s.n);
            const half = (top & 1) * (T / 2);
            uv.push(u0, wv0 + half, u0 + T, wv0 + half, u0 + T, wv0 + half + T / 2, u0, wv0 + half + T / 2);
            // 草地の一番上の段だけ、ふちに草色を少し残す
            pushColor(st.wall, top === y ? 1 : 0.86);
            quad();
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: atlasTex }));
  }
  const terrainMesh = buildTerrain();
  scene.add(terrainMesh);

  // ---- 海 ------------------------------------------------------------------
  const SEA_SIZE = 6400;
  const seaFloor = new THREE.Mesh(new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE), new THREE.MeshBasicMaterial({ color: COLORS.deep }));
  seaFloor.rotation.x = -Math.PI / 2;
  seaFloor.position.y = MIN_Y - 0.05;
  waterTex.repeat.set(SEA_SIZE / 24, SEA_SIZE / 24);
  const seaMat = new THREE.MeshBasicMaterial({ map: waterTex, transparent: true, opacity: 0.66, depthWrite: false });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_Y;
  sea.renderOrder = 2;
  scene.add(seaFloor, sea);

  // ---- 木・岩・草花（1つの InstancedMesh にまとめて描く） ----------------------
  const voxels = [];
  const vox = (x, y, z, w, hh, d, c) => voxels.push({ x, y, z, w, h: hh, d, c });
  const GREENS = [
    ['#2f8f3f', '#49b24f'],
    ['#2c8748', '#42a85a'],
    ['#3a963a', '#5cbc4a'],
    ['#2a7d4b', '#3f9f5c'],
  ];
  for (const d of deco) {
    const s = d.scale;
    const { x, z } = d;
    const y = d.y;
    if (d.kind === 'tree') {
      const [g1, g2] = GREENS[d.variant];
      vox(x, y + 1.1 * s, z, 0.7 * s, 2.2 * s, 0.7 * s, '#7a4f2c');
      if (d.variant === 3) {
        vox(x, y + 3.3 * s, z, 2.4 * s, 2.6 * s, 2.4 * s, g1);
        vox(x, y + 4.9 * s, z, 1.5 * s, 0.9 * s, 1.5 * s, g2);
      } else {
        vox(x, y + 2.9 * s, z, 3.0 * s, 1.7 * s, 3.0 * s, g1);
        vox(x + 0.2 * s, y + 4.2 * s, z - 0.15 * s, 2.0 * s, 1.2 * s, 2.0 * s, g2);
      }
    } else if (d.kind === 'pine') {
      vox(x, y + 0.7 * s, z, 0.6 * s, 1.4 * s, 0.6 * s, '#6b4426');
      [2.8, 2.1, 1.4, 0.7].forEach((w, n) => vox(x, y + (1.9 + n * 1.0) * s, z, w * s, 1.0 * s, w * s, n % 2 ? '#2f7d5a' : '#27694c'));
    } else if (d.kind === 'palm') {
      const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      const [lx, lz] = dirs[d.variant];
      const T1 = '#a9793f';
      const T2 = '#946733';
      vox(x, y + 0.9, z, 0.6, 1.8, 0.6, T1);
      vox(x + lx * 0.25, y + 2.5, z + lz * 0.25, 0.55, 1.6, 0.55, T2);
      vox(x + lx * 0.55, y + 4.0, z + lz * 0.55, 0.5, 1.6, 0.5, T1);
      const tx = x + lx * 0.7;
      const tz = z + lz * 0.7;
      const ty = y + 4.9;
      vox(tx, ty + 0.1, tz, 0.9, 0.5, 0.9, '#3fae4f');
      for (const [ax, az] of dirs) {
        vox(tx + ax * 1.1, ty, tz + az * 1.1, ax ? 1.6 : 0.7, 0.3, az ? 1.6 : 0.7, '#46b956');
        vox(tx + ax * 2.1, ty - 0.4, tz + az * 2.1, ax ? 1.0 : 0.6, 0.3, az ? 1.0 : 0.6, '#2f9442');
      }
      vox(tx + 0.3, ty - 0.45, tz + 0.25, 0.4, 0.4, 0.4, '#6b4426');
      vox(tx - 0.3, ty - 0.5, tz - 0.2, 0.4, 0.4, 0.4, '#5a3820');
    } else if (d.kind === 'rock') {
      const g = d.variant % 2 ? '#8b8b97' : '#9d9da9';
      vox(x, y + 0.45 * s, z, 1.4 * s, 0.9 * s, 1.2 * s, g);
      if (d.variant > 1) vox(x + 0.5 * s, y + 0.3 * s, z + 0.5 * s, 0.8 * s, 0.6 * s, 0.7 * s, '#7b7b86');
    } else if (d.kind === 'searock') {
      vox(x, (y + 1.2) / 2, z, 1.9 * s, 1.2 - y, 1.6 * s, '#6f7480');
      vox(x + 0.3, 1.4, z - 0.2, 1.0 * s, 0.7, 0.9 * s, '#868b96');
    } else if (d.kind === 'flower') {
      if (trailCells && trailCells.has(idx(d.i, d.j))) continue;
      if (d.variant === 3) vox(x, y + 0.25, z, 0.5, 0.5, 0.18, '#3d9a3f');
      else {
        vox(x, y + 0.2, z, 0.16, 0.4, 0.16, '#3d9a3f');
        vox(x, y + 0.5, z, 0.42, 0.3, 0.42, ['#fff6e0', '#ffd84a', '#ff8fb0'][d.variant]);
      }
    } else if (d.kind === 'shell') {
      vox(x, y + 0.1, z, 0.4, 0.2, 0.4, d.variant % 2 ? '#fff3e6' : '#ff9a6b');
    }
  }
  const decoMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ map: voxTex }), voxels.length);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    voxels.forEach((v, n) => {
      p.set(v.x, v.y, v.z);
      sc.set(v.w, v.h, v.d);
      m.compose(p, q, sc);
      decoMesh.setMatrixAt(n, m);
      decoMesh.setColorAt(n, tmp.set(v.c));
    });
    decoMesh.instanceMatrix.needsUpdate = true;
    if (decoMesh.instanceColor) decoMesh.instanceColor.needsUpdate = true;
    decoMesh.computeBoundingSphere();
  }
  scene.add(decoMesh);

  // ---- 建物 ----------------------------------------------------------------
  const buildingMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: voxTex });
  const buildingMeshes = [];
  for (const b of buildings) {
    const boxes = b.boxes.slice();
    if (b.foundation && b.footprintLocal) {
      const f = b.footprintLocal;
      boxes.push({ p: [(f.x0 + f.x1) / 2, -1.5, (f.z0 + f.z1) / 2], s: [f.x1 - f.x0 - 0.4, 3, f.z1 - f.z0 - 0.4], c: COLORS.wallDirt });
    }
    const mesh = new THREE.Mesh(boxesToGeometry(boxes), buildingMat);
    mesh.position.set(b.x, b.y, b.z);
    mesh.rotation.y = (b.rot * Math.PI) / 180;
    mesh.userData.building = b;
    scene.add(mesh);
    buildingMeshes.push(mesh);
  }

  // ---- 拠点のたき火（拠点が決まってから。未開拓の島には何もない） ------------------
  let fire = null;
  if (hub && hub.isBase) {
    const fireY = terrain.heightAt(hub.x, hub.z);
    const fireCell = terrain.cellOf(hub.x, hub.z);
    const fireXZ = cellCenter(fireCell.i, fireCell.j);
    const fireBase = new THREE.Mesh(boxesToGeometry(campfireBoxes()), buildingMat);
    fireBase.position.set(fireXZ.x, fireY, fireXZ.z);
    scene.add(fireBase);
    const flames = [
      { c: '#ff7a1f', s: 0.8, y: 0.75 },
      { c: '#ffb52e', s: 0.55, y: 1.15 },
      { c: '#fff08a', s: 0.32, y: 1.5 },
    ].map((f, n) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: f.c, fog: false }));
      m.userData = { ...f, n };
      m.position.set(fireXZ.x, fireY + f.y, fireXZ.z);
      scene.add(m);
      return m;
    });
    const fireLight = new THREE.PointLight('#ff9a3c', 0, 60, 1.6);
    fireLight.position.set(fireXZ.x, fireY + 2.2, fireXZ.z);
    scene.add(fireLight);
    fire = { y: fireY, xz: fireXZ, flames, light: fireLight };
  }

  // ---- 雲（島の外側をゆっくり流れる） -------------------------------------------
  const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.92 });
  const clouds = [];
  for (let n = 0; n < 7; n++) {
    const boxes = [];
    const parts = 3 + Math.floor(hash01(n, 1, 9) * 3);
    for (let p = 0; p < parts; p++) {
      const w = 16 + hash01(n, p, 2) * 18;
      boxes.push({ p: [(p - parts / 2) * 11, hash01(n, p, 3) * 4, hash01(n, p, 4) * 8 - 4], s: [w, 5 + hash01(n, p, 5) * 4, 10 + hash01(n, p, 6) * 8], c: '#ffffff' });
    }
    const mesh = new THREE.Mesh(boxesToGeometry(boxes), cloudMat);
    const side = n % 2 ? 1 : -1;
    mesh.userData = { lane: side * (210 + hash01(n, 7) * 150), y: 48 + hash01(n, 8) * 34, speed: 2.2 + hash01(n, 9) * 2.5, phase: hash01(n, 10) * 1400 };
    scene.add(mesh);
    clouds.push(mesh);
  }

  // ---- 更新 ----------------------------------------------------------------
  const skyA = new THREE.Color();
  const skyB = new THREE.Color();
  const mixColor = (a, b, t) => skyA.set(a).lerp(skyB.set(b), t);
  let nightLevel = 0;

  function setTimeOfDay(hour) {
    const hh = ((hour % 24) + 24) % 24;
    let a = SKY_KEYS[0];
    let b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let n = 0; n < SKY_KEYS.length - 1; n++) {
      if (hh >= SKY_KEYS[n].h && hh <= SKY_KEYS[n + 1].h) {
        a = SKY_KEYS[n];
        b = SKY_KEYS[n + 1];
        break;
      }
    }
    const t = b.h === a.h ? 0 : (hh - a.h) / (b.h - a.h);
    scene.background.copy(mixColor(a.sky, b.sky, t));
    scene.fog.color.copy(scene.background);
    hemi.color.copy(mixColor(a.hemi, b.hemi, t));
    hemi.groundColor.copy(mixColor(a.ground, b.ground, t));
    hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * t;
    sun.color.copy(mixColor(a.sun, b.sun, t));
    sun.intensity = a.sunI + (b.sunI - a.sunI) * t;
    nightLevel = a.night + (b.night - a.night) * t;
    // 海と雲も空の明るさに合わせる
    const dim = 1 - nightLevel * 0.45;
    seaMat.color.setScalar(dim);
    seaFloor.material.color.set(COLORS.deep).multiplyScalar(dim);
    cloudMat.color.setScalar(1 - nightLevel * 0.5);
    return scene.background;
  }

  function update(tMs) {
    const t = tMs / 1000;
    // 波：ドット単位でカクカク動かす
    const step = 1 / 32;
    waterTex.offset.set(Math.floor((t * 0.9) % 32) * step, Math.floor((t * 0.5) % 32) * step);
    // 炎のゆらぎ
    if (fire) {
      for (const f of fire.flames) {
        const { s, y, n } = f.userData;
        const tick = Math.floor(t * 7 + n * 1.7);
        const k = 0.8 + hash01(tick, n, 3) * 0.45;
        f.scale.set(s * k, s * (0.9 + hash01(tick, n, 4) * 0.6), s * k);
        f.position.y = fire.y + y + (hash01(tick, n, 5) - 0.5) * 0.12;
        f.position.x = fire.xz.x + (hash01(tick, n, 6) - 0.5) * 0.18 * n;
      }
      fire.light.intensity = nightLevel * (55 + hash01(Math.floor(t * 7), 9) * 20);
    }
    for (const c of clouds) {
      const u = c.userData;
      const span = 1500;
      const x = ((((t * u.speed + u.phase) % span) + span) % span) - span / 2;
      c.position.set(x, u.y, u.lane);
    }
  }

  function resize(w, hgt) {
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }

  // 画面上の点から、建物／地面を拾う
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(nx, ny) {
    ndc.set(nx, ny);
    raycaster.setFromCamera(ndc, camera);
    const hitB = raycaster.intersectObjects(buildingMeshes, false)[0];
    const hitT = raycaster.intersectObject(terrainMesh, false)[0];
    if (hitB && (!hitT || hitB.distance <= hitT.distance + 0.5)) return { type: 'building', building: hitB.object.userData.building, point: hitB.point };
    if (hitT) return { type: 'ground', point: hitT.point };
    return null;
  }

  // 地区ラベルの位置
  const districtAnchors = DISTRICTS.map((d, n) => {
    const x = d.u * HALF;
    const z = d.v * HALF;
    return { id: d.id, name: d.name, index: n, pos: new THREE.Vector3(x, Math.max(1, terrain.heightAt(x, z)) + (d.id === 'plain' ? 9 : 12), z) };
  });

  return { renderer, scene, camera, terrainMesh, buildingMeshes, districtAnchors, update, resize, pick, setTimeOfDay, render: () => renderer.render(scene, camera) };
}
