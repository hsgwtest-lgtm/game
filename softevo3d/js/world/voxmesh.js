// ボクセル生物の3Dメッシュ
// 物理の節点の位置から、見えている面（四角形）を毎フレーム作り直す。
// 筋肉は「ふくらむと明るく / ちぢむと暗く」色が変わるので、どの筋肉が動いているか見える。
// 前のいちばん上の面に「目」をつける（自分の生き物らしさ）。

import { MAT_LOOK, PAL, CH_COLOR } from '../core/config.js';
import { isMuscle, channelOf } from '../sim/body.js';

const THREE = window.THREE;

const _c1 = new THREE.Color(), _c2 = new THREE.Color();

// 半透明のかわりに、市松模様に穴をあけて描く（ゴースト用）
function ditherMaterial(color, density = 0.5) {
  const m = new THREE.MeshBasicMaterial({ color, depthWrite: false });
  m.userData.density = density;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.ditherK = { value: density };
    m.userData.shader = sh;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform float ditherK;\nvoid main() {\n  vec2 dp = floor(gl_FragCoord.xy);\n  float bx = mod(dp.x, 2.0), by = mod(dp.y, 2.0);\n  float th = (bx * 2.0 + by * 3.0 - 4.0 * bx * by + 0.5) / 4.0;\n  if (th > ditherK) discard;');
  };
  return m;
}

export class VoxMesh {
  // opts: { ghost: 色(数値) | null, density, eyes: true }
  constructor(body, opts = {}) {
    this.body = body;
    this.ghost = opts.ghost ?? null;
    const nF = body.nF;
    this.nF = nF;
    const g = new THREE.BufferGeometry();
    this.posArr = new Float32Array(nF * 12);
    this.nrmArr = new Float32Array(nF * 12);
    this.colArr = new Float32Array(nF * 12);
    const idx = new (nF * 4 > 65535 ? Uint32Array : Uint16Array)(nF * 6);
    for (let f = 0; f < nF; f++) {
      const v = f * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], f * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrmArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colArr, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = g;
    if (this.ghost !== null) {
      this.mat = ditherMaterial(this.ghost, opts.density ?? 0.5);
    } else {
      this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    }
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.ghost === null;
    this.mesh.receiveShadow = false;
    // 面の色（素材）
    this.faceCh = new Int8Array(nF);
    this.baseCol = new Float32Array(nF * 3);
    this.darkCol = new Float32Array(nF * 3);
    for (let f = 0; f < nF; f++) {
      const m = body.faceMat[f];
      const look = MAT_LOOK[m];
      _c1.setHex(look.color); _c2.setHex(look.dark);
      this.baseCol.set([_c1.r, _c1.g, _c1.b], f * 3);
      this.darkCol.set([_c2.r, _c2.g, _c2.b], f * 3);
      this.faceCh[f] = isMuscle(m) ? body.chIndex[channelOf(m)] : -1;
    }
    this.highlight = -1;    // 光らせる筋肉（チャンネル番号）
    this.flash = 0;
    this._colorsDirty = true;
    // 目
    this.eyes = null;
    if (opts.eyes !== false && this.ghost === null) this._makeEyes();
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    if (this.eyes) this.group.add(this.eyes.mesh);
  }

  _makeEyes() {
    const b = this.body;
    // 前向き（+X）の面のうち、いちばん前・いちばん上
    let best = [];
    let bx = -1e9, by = -1e9;
    for (let f = 0; f < b.nF; f++) {
      const n = this._faceNormalRest(f);
      if (n[0] < 0.9) continue;
      const v = b.vox[b.faceVox[f]];
      if (v[0] > bx || (v[0] === bx && v[1] > by)) { bx = v[0]; by = v[1]; best = [f]; }
      else if (v[0] === bx && v[1] === by) best.push(f);
    }
    if (!best.length) return;
    // 左右の端の面を目にする（1つしかなければ、その面に2つ）
    best.sort((a, c) => b.vox[b.faceVox[a]][2] - b.vox[b.faceVox[c]][2]);
    const spots = [];
    if (best.length === 1) { spots.push([best[0], 0.28], [best[0], 0.72]); }
    else { spots.push([best[0], 0.5], [best[best.length - 1], 0.5]); }
    const n = spots.length;
    const pos = new Float32Array(n * 2 * 4 * 3);
    const col = new Float32Array(n * 2 * 4 * 3);
    const idx = [];
    for (let q = 0; q < n * 2; q++) {
      const v = q * 4;
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      const white = q % 2 === 0;
      for (let k = 0; k < 4; k++) col.set(white ? [1, 1, 1] : [0.09, 0.08, 0.15], (v + k) * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.frustumCulled = false;
    this.eyes = { spots, pos, geo: g, mesh };
  }

  _faceNormalRest(f) {
    const b = this.body, r = b.rest, F = b.faces;
    const p = (k) => [r[F[f * 4 + k] * 3], r[F[f * 4 + k] * 3 + 1], r[F[f * 4 + k] * 3 + 2]];
    const a = p(0), c = p(2), bb = p(1), d = p(3);
    const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], w = [d[0] - bb[0], d[1] - bb[1], d[2] - bb[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n) || 1;
    return n.map(x => x / l);
  }

  setHighlight(ch) { if (ch !== this.highlight) { this.highlight = ch; this._colorsDirty = true; } }

  // pos: 節点の位置, act: 筋肉の活動（チャンネルごと, -1..1）, ox/oz: 表示のずらし
  update(pos, act, ox = 0, oy = 0, oz = 0, time = 0) {
    const b = this.body, F = b.faces, P = this.posArr, N = this.nrmArr;
    for (let f = 0; f < this.nF; f++) {
      const i0 = F[f * 4] * 3, i1 = F[f * 4 + 1] * 3, i2 = F[f * 4 + 2] * 3, i3 = F[f * 4 + 3] * 3;
      const o = f * 12;
      P[o] = pos[i0] + ox; P[o + 1] = pos[i0 + 1] + oy; P[o + 2] = pos[i0 + 2] + oz;
      P[o + 3] = pos[i1] + ox; P[o + 4] = pos[i1 + 1] + oy; P[o + 5] = pos[i1 + 2] + oz;
      P[o + 6] = pos[i2] + ox; P[o + 7] = pos[i2 + 1] + oy; P[o + 8] = pos[i2 + 2] + oz;
      P[o + 9] = pos[i3] + ox; P[o + 10] = pos[i3 + 1] + oy; P[o + 11] = pos[i3 + 2] + oz;
      // 対角線の外積 = 面の法線
      const ux = pos[i2] - pos[i0], uy = pos[i2 + 1] - pos[i0 + 1], uz = pos[i2 + 2] - pos[i0 + 2];
      const wx = pos[i3] - pos[i1], wy = pos[i3 + 1] - pos[i1 + 1], wz = pos[i3 + 2] - pos[i1 + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 4; k++) { N[o + k * 3] = nx; N[o + k * 3 + 1] = ny; N[o + k * 3 + 2] = nz; }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    if (this.ghost === null) this._updateColors(act, time);
    if (this.eyes) this._updateEyes(pos, ox, oy, oz);
  }

  _updateColors(act, time) {
    const C = this.colArr, base = this.baseCol, dark = this.darkCol, ch = this.faceCh;
    const hl = this.highlight;
    const blink = hl >= 0 && Math.floor(time * 6) % 2 === 0;
    for (let f = 0; f < this.nF; f++) {
      const c = ch[f];
      let r, g, bl;
      if (c >= 0 && act) {
        // ふくらむ(+1)ほど明るく、ちぢむ(-1)ほど暗く
        const t = Math.max(0, Math.min(1, 0.55 + 0.45 * act[c]));
        r = dark[f * 3] + (base[f * 3] - dark[f * 3]) * t;
        g = dark[f * 3 + 1] + (base[f * 3 + 1] - dark[f * 3 + 1]) * t;
        bl = dark[f * 3 + 2] + (base[f * 3 + 2] - dark[f * 3 + 2]) * t;
        if (blink && c === hl) { r = 1; g = 1; bl = 1; }
      } else if (!this._colorsDirty && !act) {
        continue;
      } else {
        r = base[f * 3]; g = base[f * 3 + 1]; bl = base[f * 3 + 2];
      }
      const o = f * 12;
      for (let k = 0; k < 4; k++) { C[o + k * 3] = r; C[o + k * 3 + 1] = g; C[o + k * 3 + 2] = bl; }
    }
    this._colorsDirty = false;
    this.geo.attributes.color.needsUpdate = true;
  }

  _updateEyes(pos, ox, oy, oz) {
    const b = this.body, F = b.faces, E = this.eyes, P = E.pos;
    let q = 0;
    for (const [f, s] of E.spots) {
      const c = [0, 1, 2, 3].map(k => F[f * 4 + k] * 3);
      // 前向きの面の角の並び: (下,左) → (上,左) → (上,右) → (下,右)
      const pt = (h, v) => {
        // 面の上の点（双一次補間）。h: 横位置(左→右), v: 縦位置(下→上)
        const out = [0, 0, 0];
        const w = [(1 - h) * (1 - v), (1 - h) * v, h * v, h * (1 - v)];
        for (let k = 0; k < 4; k++) for (let a = 0; a < 3; a++) out[a] += pos[c[k] + a] * w[k];
        return out;
      };
      // 面の法線（少し浮かせる）
      const n = [0, 0, 0];
      {
        const ux = pos[c[2]] - pos[c[0]], uy = pos[c[2] + 1] - pos[c[0] + 1], uz = pos[c[2] + 2] - pos[c[0] + 2];
        const wx = pos[c[3]] - pos[c[1]], wy = pos[c[3] + 1] - pos[c[1] + 1], wz = pos[c[3] + 2] - pos[c[1] + 2];
        n[0] = uy * wz - uz * wy; n[1] = uz * wx - ux * wz; n[2] = ux * wy - uy * wx;
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        n[0] /= l; n[1] /= l; n[2] /= l;
      }
      // 白目と黒目
      for (const [half, lift] of [[0.2, 0.004], [0.11, 0.007]]) {
        const quad = [[s - half, 0.62 - half], [s + half, 0.62 - half], [s + half, 0.62 + half], [s - half, 0.62 + half]];
        // 面の角の並び（反時計回り）に合わせて u,v を対応させる
        for (let k = 0; k < 4; k++) {
          const p = pt(quad[k][0], quad[k][1]);
          P[(q * 4 + k) * 3] = p[0] + n[0] * lift + ox;
          P[(q * 4 + k) * 3 + 1] = p[1] + n[1] * lift + oy;
          P[(q * 4 + k) * 3 + 2] = p[2] + n[2] * lift + oz;
        }
        q++;
      }
    }
    E.geo.attributes.position.needsUpdate = true;
  }

  setVisible(v) { this.group.visible = v; }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    if (this.eyes) { this.eyes.geo.dispose(); this.eyes.mesh.material.dispose(); }
  }
}

export { ditherMaterial };
