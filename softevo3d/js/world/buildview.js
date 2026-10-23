// 設計画面の3D表示: 方眼の床・ボクセル（ふちどり付きのブロック）・置く場所のカーソル・左右対称の面

import { PAL, MAT_LOOK } from '../core/config.js';
import { H, GRID } from '../sim/body.js';

const THREE = window.THREE;
const MAX_INST = 400;
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

function blockTexture() {
  // 8×8: ふちが少し暗い（ブロックの境目が見える）
  const n = 8, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const edge = x === 0 || y === 0 || x === n - 1 || y === n - 1;
    const hi = (x === 1 && y > 0 && y < n - 1) || (y === n - 2 && x > 0 && x < n - 1);
    const v = edge ? 150 : hi ? 255 : 228;
    const i = (y * n + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function cellCenter(x, y, z) { return new THREE.Vector3(x * H, (y + 0.5) * H, z * H); }

export class BuildView {
  constructor(world) {
    this.world = world;
    const g = this.group = world.buildGroup;
    const geo = new THREE.BoxGeometry(H, H, H);
    this.mat = new THREE.MeshLambertMaterial({ map: blockTexture() });
    this.inst = new THREE.InstancedMesh(geo, this.mat, MAX_INST);
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INST * 3).fill(1), 3);
    this.inst.count = 0;
    this.inst.castShadow = true;
    this.inst.frustumCulled = false;
    g.add(this.inst);
    this.vox = [];
    // 床の方眼
    const pts = [];
    const x0 = (GRID.x0 - 0.5) * H, x1 = (GRID.x1 + 0.5) * H, z0 = (GRID.z0 - 0.5) * H, z1 = (GRID.z1 + 0.5) * H;
    for (let i = GRID.x0; i <= GRID.x1 + 1; i++) { const x = (i - 0.5) * H; pts.push(x, 0.001, z0, x, 0.001, z1); }
    for (let k = GRID.z0; k <= GRID.z1 + 1; k++) { const z = (k - 0.5) * H; pts.push(x0, 0.001, z, x1, 0.001, z); }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: PAL.steel }));
    g.add(this.grid);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshLambertMaterial({ color: PAL.navy }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    floor.receiveShadow = true;
    this.floor = floor;
    g.add(floor);
    // 前の向きを示す矢印（床の上）
    const arrow = new THREE.Shape();
    arrow.moveTo(0.12, 0); arrow.lineTo(0, 0.07); arrow.lineTo(0, 0.025); arrow.lineTo(-0.1, 0.025);
    arrow.lineTo(-0.1, -0.025); arrow.lineTo(0, -0.025); arrow.lineTo(0, -0.07); arrow.lineTo(0.12, 0);
    const ag = new THREE.ShapeGeometry(arrow);
    ag.rotateX(-Math.PI / 2);
    this.arrow = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: PAL.yellow }));
    this.arrow.position.set(x1 - 0.14, 0.003, 0);
    this.arrow.scale.set(1.3, 1.3, 1.3);
    g.add(this.arrow);
    // 左右対称の面（z=0 の列）
    const mg = new THREE.PlaneGeometry(x1 - x0, H);
    mg.rotateX(-Math.PI / 2);
    this.mirror = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: PAL.cyan, transparent: true, opacity: 0.25, depthWrite: false }));
    this.mirror.position.set((x0 + x1) / 2, 0.002, 0);
    g.add(this.mirror);
    // カーソル
    const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(H * 1.04, H * 1.04, H * 1.04));
    this.cursor = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: PAL.white }));
    this.cursor.visible = false;
    this.cursor2 = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: PAL.cyan }));
    this.cursor2.visible = false;
    g.add(this.cursor, this.cursor2);
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  setVisible(v) { this.group.visible = v; }

  setVoxels(vox, opts = {}) {
    this.vox = vox;
    const n = Math.min(MAX_INST, vox.length);
    for (let i = 0; i < n; i++) {
      const [x, y, z, m] = vox[i];
      _m.makeTranslation(x * H, (y + 0.5) * H, z * H);
      this.inst.setMatrixAt(i, _m);
      _c.setHex(MAT_LOOK[m].color);
      if (opts.bad && opts.bad.has(i) && opts.blink) _c.setHex(PAL.magenta);
      this.inst.instanceColor.setXYZ(i, _c.r, _c.g, _c.b);
    }
    this.inst.count = n;
    this.inst.instanceMatrix.needsUpdate = true;
    this.inst.instanceColor.needsUpdate = true;
  }

  showMirror(v) { this.mirror.visible = v; }

  // 画面の点（NDC: -1..1）からボクセル／床を拾う
  pick(nx, ny) {
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.world.camera);
    if (this.inst.count > 0) {
      const hits = this.raycaster.intersectObject(this.inst, false);
      if (hits.length) {
        const h = hits[0];
        const v = this.vox[h.instanceId];
        const n = h.face.normal;
        return {
          type: 'voxel', index: h.instanceId, cell: [v[0], v[1], v[2]],
          normal: [Math.round(n.x), Math.round(n.y), Math.round(n.z)],
        };
      }
    }
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, p)) {
      const x = Math.round(p.x / H), z = Math.round(p.z / H);
      if (x >= GRID.x0 && x <= GRID.x1 && z >= GRID.z0 && z <= GRID.z1) return { type: 'ground', cell: [x, 0, z] };
    }
    return null;
  }

  setCursor(cell, mirrorCell = null, color = PAL.white) {
    if (!cell) { this.cursor.visible = false; this.cursor2.visible = false; return; }
    this.cursor.visible = true;
    this.cursor.material.color.setHex(color);
    this.cursor.position.copy(cellCenter(cell[0], cell[1], cell[2]));
    if (mirrorCell) {
      this.cursor2.visible = true;
      this.cursor2.position.copy(cellCenter(mirrorCell[0], mirrorCell[1], mirrorCell[2]));
    } else this.cursor2.visible = false;
  }

  center() {
    if (!this.vox.length) return new THREE.Vector3(0, H, 0);
    let x = 0, y = 0, z = 0;
    for (const v of this.vox) { x += v[0]; y += v[1] + 0.5; z += v[2]; }
    const n = this.vox.length;
    return new THREE.Vector3((x / n) * H, (y / n) * H, (z / n) * H);
  }
}
