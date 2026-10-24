// 生き物の3D表示（解剖図のような見た目）
//   からだ: 骨ごとのなめらかなカプセル（肌）
//   きんにく: 半透明の肌の下で、筋肉が通り道に沿った紡錘形で見える。力を出すほど太く・明るく光る
//   ほね: 骨と関節だけ
// 物理の状態（Creature）を毎フレーム写しとる。

const THREE = window.THREE;

export const VIEW_MODES = ['skin', 'muscle', 'bone'];

// カプセル（Y軸方向、長さ L、半径 r）の形
export function capsuleGeometry(L, r, radial = 14, cap = 6) {
  const pts = [];
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (i / cap) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.cos(a) * r, -L / 2 + Math.sin(a) * r));
  }
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * Math.PI / 2;
    pts.push(new THREE.Vector2(Math.cos(a) * r, L / 2 + Math.sin(a) * r));
  }
  pts[0].x = 0.0001; pts[pts.length - 1].x = 0.0001;
  const g = new THREE.LatheGeometry(pts, radial);
  g.computeVertexNormals();
  return g;
}

// 角の丸い箱（足など）
export function roundedBox(w, h, d, r) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const p = g.attributes.position, v = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const cx = Math.max(-hx, Math.min(hx, v.x)), cy = Math.max(-hy, Math.min(hy, v.y)), cz = Math.max(-hz, Math.min(hz, v.z));
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    p.setXYZ(i, cx + dx / l * r, cy + dy / l * r, cz + dz / l * r);
  }
  g.computeVertexNormals();
  return g;
}

const MUSCLE_RINGS = 10, MUSCLE_SIDES = 7;
// sRGB の色を、レンダラーの計算用（リニア）に直す
export const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

export class CreatureView {
  constructor(model, opts = {}) {
    this.model = model;
    this.group = new THREE.Group();
    this.mode = opts.mode || 'muscle';
    this.ghost = opts.ghost || null;     // ゴースト（色）
    const skinColor = lin(opts.color || 0xd9a58c);
    this.skinColor = skinColor;
    const B = model.bodies;
    this.skin = [];
    this.bones = [];
    const ghost = this.ghost !== null;
    this.skinMat = ghost
      ? new THREE.MeshBasicMaterial({ color: lin(this.ghost), transparent: true, opacity: opts.opacity || 0.22, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.55, metalness: 0.0, transparent: true, opacity: 1 });
    this.boneMat = new THREE.MeshStandardMaterial({ color: lin(0xeee2c8), roughness: 0.45, metalness: 0.05 });
    this.jointMat = new THREE.MeshStandardMaterial({ color: lin(0x8fb0c8), roughness: 0.4 });
    for (const b of B) {
      let geo, bgeo;
      if (b.shape === 'box') {
        geo = roundedBox(2 * b.r, b.L, b.w, Math.min(b.r, b.w / 2) * 0.6);
        bgeo = roundedBox(b.r * 0.7, b.L * 0.85, b.w * 0.45, b.r * 0.3);
      } else {
        geo = capsuleGeometry(b.L, b.r);
        bgeo = capsuleGeometry(Math.max(0, b.L * 0.92), b.r * 0.32, 8, 3);
      }
      const m = new THREE.Mesh(geo, this.skinMat);
      m.castShadow = !ghost;
      m.receiveShadow = false;
      this.group.add(m);
      this.skin.push(m);
      if (!ghost) {
        const bm = new THREE.Mesh(bgeo, this.boneMat);
        bm.castShadow = false;
        this.group.add(bm);
        this.bones.push(bm);
      }
    }
    // 関節の球
    this.joints = [];
    if (!ghost) {
      const jg = new THREE.SphereGeometry(1, 10, 8);
      for (const j of model.joints) {
        const r = Math.max(0.012, Math.min(model.bodies[j.child].r, model.bodies[j.parent].r) * 0.45);
        const m = new THREE.Mesh(jg, this.jointMat);
        m.scale.setScalar(r);
        this.group.add(m);
        this.joints.push(m);
      }
    }
    // 筋肉
    this.muscleMesh = null;
    if (!ghost && model.muscles.length) this._buildMuscles();
    // 目（いちばん前の骨の前面に2つ）
    this._buildEyes();
    this.setMode(this.mode);
    this.highlight = new Set();
  }

  _buildMuscles() {
    const M = this.model.muscles.length;
    const nv = M * MUSCLE_RINGS * MUSCLE_SIDES;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = [];
    for (let m = 0; m < M; m++) {
      const base = m * MUSCLE_RINGS * MUSCLE_SIDES;
      for (let r = 0; r < MUSCLE_RINGS - 1; r++) {
        for (let s = 0; s < MUSCLE_SIDES; s++) {
          const a = base + r * MUSCLE_SIDES + s, b = base + r * MUSCLE_SIDES + (s + 1) % MUSCLE_SIDES;
          const c = a + MUSCLE_SIDES, d = b + MUSCLE_SIDES;
          idx.push(a, b, c, b, d, c);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.muscleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, emissive: 0x000000 });
    // 力を出している筋肉は光る（頂点の色の明るさを、そのまま発光にも足す）
    this.muscleMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance += max(vec3(0.0), vColor.rgb - vec3(0.45, 0.03, 0.02)) * vec3(2.2, 1.4, 1.0);');
    };
    this.muscleMesh = new THREE.Mesh(g, this.muscleMat);
    this.muscleMesh.frustumCulled = false;
    this.muscleMesh.castShadow = false;
    this.group.add(this.muscleMesh);
    // 筋肉の太さ（最大張力に比例した断面積から）
    this.mRad = Float32Array.from(this.model.muscles.map(m => Math.max(0.006, Math.min(0.045, Math.sqrt(m.fmax / 3e5 / Math.PI) * 0.55))));
    this._tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3(), bn: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  }

  _buildEyes() {
    const model = this.model, B = model.bodies;
    // 頭らしい骨: 前のほうで高いところにある骨
    let best = 0, bs = -1e9;
    for (const b of B) { const s = b.c[0] * 2 + b.c[1] * 0.6 - Math.abs(b.c[2]) * 2; if (s > bs) { bs = s; best = b.i; } }
    this.eyeBody = best;
    const b = B[best];
    const g = new THREE.SphereGeometry(1, 12, 10);
    const white = new THREE.MeshStandardMaterial({ color: lin(0xffffff), roughness: 0.25 });
    const black = new THREE.MeshBasicMaterial({ color: lin(0x111111) });
    this.eyes = [];
    const R = b.shape === 'box' ? b.r : b.r;
    const er = Math.max(0.008, R * 0.22);
    for (const side of [-1, 1]) {
      const e = new THREE.Group();
      const w = new THREE.Mesh(g, this.ghost !== null ? this.skinMat : white); w.scale.setScalar(er);
      const p = new THREE.Mesh(g, this.ghost !== null ? this.skinMat : black); p.scale.setScalar(er * 0.55); p.position.set(er * 0.6, 0, 0);
      e.add(w, p);
      this.group.add(e);
      this.eyes.push({ g: e, side, er });
    }
    // 目の位置（骨のローカル座標）: 世界の前方 + 少し上、左右に
    const inv = new THREE.Quaternion(b.q0[1], b.q0[2], b.q0[3], b.q0[0]).invert();
    const L = b.shape === 'box' ? b.L / 2 : b.L / 2 + b.r;
    this.eyeLocal = [-1, 1].map(side => {
      const world = new THREE.Vector3(0.75 * (b.L > 0.01 && Math.abs(b.Y[0]) > 0.7 ? L : R), R * 0.35, side * R * 0.45);
      if (!(b.L > 0.01 && Math.abs(b.Y[0]) > 0.7)) world.set(R * 0.82, R * 0.3, side * R * 0.45);
      return world.applyQuaternion(inv);
    });
  }

  setMode(mode) {
    this.mode = mode;
    const ghost = this.ghost !== null;
    if (!ghost) {
      this.skinMat.opacity = mode === 'skin' ? 1 : mode === 'muscle' ? 0.16 : 0;
      this.skinMat.depthWrite = mode === 'skin';
      this.skinMat.transparent = mode !== 'skin';
      this.skinMat.needsUpdate = true;
      for (const m of this.skin) m.visible = mode !== 'bone';
      for (const m of this.skin) m.castShadow = true;
      for (const m of this.bones) m.visible = mode !== 'skin';
      for (const m of this.joints) m.visible = mode !== 'skin';
      if (this.muscleMesh) this.muscleMesh.visible = mode === 'muscle';
      for (const e of this.eyes) e.g.visible = mode === 'skin';
    }
  }

  // c: Creature（物理）, offset: 表示のずらし
  update(c, offset = null) {
    const ox = offset ? offset[0] : 0, oy = offset ? offset[1] : 0, oz = offset ? offset[2] : 0;
    const q = new THREE.Quaternion();
    for (let i = 0; i < c.n; i++) {
      q.set(c.q[4 * i + 1], c.q[4 * i + 2], c.q[4 * i + 3], c.q[4 * i]);
      const x = c.pos[3 * i] + ox, y = c.pos[3 * i + 1] + oy, z = c.pos[3 * i + 2] + oz;
      this.skin[i].position.set(x, y, z); this.skin[i].quaternion.copy(q);
      if (this.bones[i]) { this.bones[i].position.set(x, y, z); this.bones[i].quaternion.copy(q); }
    }
    // 関節
    const v = new THREE.Vector3();
    this.model.joints.forEach((j, k) => {
      if (!this.joints[k]) return;
      const P = j.parent;
      q.set(c.q[4 * P + 1], c.q[4 * P + 2], c.q[4 * P + 3], c.q[4 * P]);
      v.set(j.rP[0], j.rP[1], j.rP[2]).applyQuaternion(q);
      this.joints[k].position.set(c.pos[3 * P] + v.x + ox, c.pos[3 * P + 1] + v.y + oy, c.pos[3 * P + 2] + v.z + oz);
    });
    // 目
    const E = this.eyeBody;
    q.set(c.q[4 * E + 1], c.q[4 * E + 2], c.q[4 * E + 3], c.q[4 * E]);
    this.eyes.forEach((e, k) => {
      v.copy(this.eyeLocal[k]).applyQuaternion(q);
      e.g.position.set(c.pos[3 * E] + v.x + ox, c.pos[3 * E + 1] + v.y + oy, c.pos[3 * E + 2] + v.z + oz);
      e.g.quaternion.copy(q).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), this._eyeFwd || (this._eyeFwd = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(this.model.bodies[E].q0[1], this.model.bodies[E].q0[2], this.model.bodies[E].q0[3], this.model.bodies[E].q0[0]).invert()))));
    });
    if (this.muscleMesh && this.mode === 'muscle') this._updateMuscles(c, ox, oy, oz);
  }

  _updateMuscles(c, ox, oy, oz) {
    const g = this.muscleMesh.geometry;
    const P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array;
    const T = this._tmp;
    const M = this.model.muscles.length;
    const pts = [];
    for (let m = 0; m < M; m++) {
      const s0 = c.mStart[m], s1 = c.mStart[m + 1];
      // 通り道（点列）と累積長
      pts.length = 0;
      let tot = 0;
      for (let k = s0; k < s1; k++) {
        const p = [c.mPt[3 * k] + ox, c.mPt[3 * k + 1] + oy, c.mPt[3 * k + 2] + oz];
        if (pts.length) { const l = Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1], p[2] - pts[pts.length - 1][2]); tot += l; p.push(tot); } else p.push(0);
        pts.push(p);
      }
      // 起始から少し入ったところから描く（骨の中に埋もれないように）
      const start = pts.length > 2 ? pts[1][3] * 0.15 : 0;
      const a = c.act[m], F = c.mForce[m] / Math.max(1, c.mFmax[m]);
      const base = this.mRad[m] * (0.75 + 0.5 * Math.min(1, F * 1.5));
      const hl = this.highlight.has(m);
      // 色: 休んでいると暗い赤、力を出すと明るい朱色に光る
      const k = Math.min(1, a * 1.3);
      const cr = hl ? 1 : 0.16 + 0.84 * k, cg = hl ? 0.9 : 0.012 + 0.16 * k * k, cb = hl ? 0.3 : 0.012 + 0.05 * k * k;
      let seg = 0;
      for (let r = 0; r < MUSCLE_RINGS; r++) {
        const u = r / (MUSCLE_RINGS - 1);
        const s = start + (tot - start) * u;
        while (seg < pts.length - 2 && pts[seg + 1][3] < s) seg++;
        const A = pts[seg], B2 = pts[seg + 1] || A;
        const ls = Math.max(1e-6, B2[3] - A[3]);
        const f = Math.max(0, Math.min(1, (s - A[3]) / ls));
        T.a.set(A[0] + (B2[0] - A[0]) * f, A[1] + (B2[1] - A[1]) * f, A[2] + (B2[2] - A[2]) * f);
        T.t.set(B2[0] - A[0], B2[1] - A[1], B2[2] - A[2]).normalize();
        T.n.copy(Math.abs(T.t.y) < 0.9 ? T.up : T.b.set(1, 0, 0)).cross(T.t).normalize();
        T.bn.copy(T.t).cross(T.n);
        // 筋腹（ふくらみ）は前の 3/4、残りは細い腱
        const ub = Math.min(1, u / 0.78);
        const prof = u < 0.78 ? Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * ub)), 0.6) : 0.12;
        const rad = 0.002 + base * prof;
        for (let sd = 0; sd < MUSCLE_SIDES; sd++) {
          const ang = (sd / MUSCLE_SIDES) * Math.PI * 2;
          const cx = Math.cos(ang), sx = Math.sin(ang);
          const nx = T.n.x * cx + T.bn.x * sx, ny = T.n.y * cx + T.bn.y * sx, nz = T.n.z * cx + T.bn.z * sx;
          const vi = ((m * MUSCLE_RINGS + r) * MUSCLE_SIDES + sd) * 3;
          P[vi] = T.a.x + nx * rad; P[vi + 1] = T.a.y + ny * rad; P[vi + 2] = T.a.z + nz * rad;
          N[vi] = nx; N[vi + 1] = ny; N[vi + 2] = nz;
          C[vi] = cr; C[vi + 1] = cg; C[vi + 2] = cb;
        }
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  setVisible(v) { this.group.visible = v; }

  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.skinMat.dispose(); this.boneMat.dispose(); this.jointMat.dispose();
    if (this.muscleMat) this.muscleMat.dispose();
  }
}
