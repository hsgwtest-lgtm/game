// 惑星（ホーム画面）: 7つの地方が広がる小さな星。あなたの種がどこまで広がったかが、ひと目でわかる
//   ・地方ごとに色と高さ（山・砂丘・森の木）
//   ・時代で見た目が変わる（氷河期は白く、大乾燥は黄土色に、大海進は海面が上がる）
//   ・定着した地方には、あなたの生き物が小さく立っている
const THREE = window.THREE;
import { REGIONS, REGION_KEYS, regionAt, ERAS } from '../game/world.js';
import { CreatureView, lin } from './creature.js';

// 地方の中心（球面上の向き）。海が大きく、陸が北東に連なる
const CENTERS = {
  sea: [-0.62, -0.18, 0.76],
  shore: [-0.2, -0.05, 0.98],
  plain: [0.28, 0.18, 0.94],
  dune: [0.12, -0.55, 0.83],
  forest: [0.55, 0.62, 0.56],
  rock: [0.7, -0.15, 0.7],
  ice: [0.62, 0.0, 0.0],
};
// 地方の大きさ（ボロノイの重み: 大きいほど広い）
const WEIGHT = { sea: 1.55, shore: 0.8, plain: 1.0, dune: 0.95, forest: 1.0, rock: 0.95, ice: 1.1 };

const BIOME_COL = {
  sea: [0x1d5f8a, 0x2b7aa8], shore: [0xe6d3a3, 0xd2bd88], plain: [0x7fb15e, 0x6a9c4c], desert: [0xe5c27f, 0xd3a960],
  forest: [0x3f7d48, 0x356c3d], rock: [0x8d857c, 0x766f67], ice: [0xe8f2f8, 0xc8dceb],
};

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
// なめらかな雑音（球面上）
function noise3(x, y, z) {
  return Math.sin(x * 5.1 + Math.sin(y * 3.7)) * 0.5 + Math.sin(y * 6.3 + Math.cos(z * 4.1)) * 0.35 + Math.sin(z * 7.7 + x * 2.3) * 0.25
    + Math.sin((x + y) * 11.3) * 0.12 + Math.sin((y - z) * 13.1) * 0.08;
}

export class Planet {
  constructor(renderer) {
    this.renderer = renderer;
    const s = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100);
    this.camera.position.set(0, 0, 4.2);
    this.group = new THREE.Group();
    s.add(this.group);
    this.centers = {};
    for (const k of REGION_KEYS) this.centers[k] = new THREE.Vector3(...norm(CENTERS[k]));
    // 光
    s.add(new THREE.HemisphereLight(lin(0xcfe2ff), lin(0x403a50), 0.55));
    this.sun = new THREE.DirectionalLight(lin(0xfff1dd), 2.4);
    this.sun.position.set(3, 2, 4);
    s.add(this.sun);
    // 星空
    const sg = new THREE.BufferGeometry();
    const sp = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 900; i++) {
      const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = 30 + rnd() * 20;
      const q = Math.sqrt(1 - u * u);
      sp.push(r * q * Math.cos(t), r * u, r * q * Math.sin(t));
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.8 }));
    s.add(this.stars);
    // 大地
    this.geo = new THREE.IcosahedronGeometry(1, 5);
    // 頂点をまとめる（Icosahedron は面ごとに頂点を持つので、同じ位置は同じ値にする）
    const p = this.geo.attributes.position;
    this.vRegion = new Array(p.count);
    this.vNoise = new Float32Array(p.count);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const nz = noise3(v.x * 1.3, v.y * 1.3, v.z * 1.3);
      this.vNoise[i] = nz;
      let best = null, bd = 1e9;
      for (const k of REGION_KEYS) {
        const d = (1 - v.dot(this.centers[k])) / WEIGHT[k] + nz * 0.045;
        if (d < bd) { bd = d; best = k; }
      }
      this.vRegion[i] = best;
    }
    this.base = Float32Array.from(p.array);
    this.geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3));
    this.landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
    this.land = new THREE.Mesh(this.geo, this.landMat);
    this.group.add(this.land);
    // 海面
    this.waterMat = new THREE.MeshStandardMaterial({ color: lin(0x2f86b8), transparent: true, opacity: 0.72, roughness: 0.25, metalness: 0.05 });
    this.water = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.waterMat);
    this.group.add(this.water);
    // 大気のふち（時代の色）
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: { col: { value: new THREE.Color(0xf2a65a) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 col; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(0.0, dot(vN, vV)), 2.6); gl_FragColor = vec4(col * f * 1.6, f); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.09, 48, 32), this.atmoMat);
    s.add(this.atmo);
    // 木（もり）と岩（いわやま）の飾り
    this.props = new THREE.Group();
    this.group.add(this.props);
    // 選んだ地方のしるし
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.115, 0.13, 48), this.ringMat);
    this.ring.visible = false;
    this.group.add(this.ring);
    // 生き物
    this.figures = new THREE.Group();
    this.group.add(this.figures);
    this.views = [];
    // 回転
    this.rot = { yaw: -0.35, pitch: 0.12, vy: 0.0, vp: 0, auto: true, goalYaw: null, goalPitch: null };
    this.era = -1;
    this.zoom = 1;
    this.selected = null;
    this.setEra(0);
  }

  setEra(era) {
    if (this.era === era) return;
    this.era = era;
    const p = this.geo.attributes.position, col = this.geo.attributes.color;
    const flood = ERAS[era] && era >= 3;
    const c = new THREE.Color(), c2 = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const k = this.vRegion[i];
      const r = regionAt(k, era);
      const nz = this.vNoise[i];
      let h;
      switch (k) {
        case 'sea': h = -0.05 + nz * 0.01; break;
        case 'shore': h = 0.004 + nz * 0.006; break;
        case 'plain': h = 0.012 + nz * 0.004; break;
        case 'dune': h = 0.018 + Math.abs(Math.sin(nz * 9)) * 0.02; break;
        case 'forest': h = 0.016 + nz * 0.006; break;
        case 'rock': h = 0.04 + Math.max(0, nz) * 0.07; break;
        case 'ice': h = 0.022 + nz * 0.01; break;
        default: h = 0.01;
      }
      const s = 1 + h;
      p.setXYZ(i, this.base[3 * i] * s, this.base[3 * i + 1] * s, this.base[3 * i + 2] * s);
      const [a, b] = BIOME_COL[r.biome] || BIOME_COL.plain;
      c.setHex(a); c2.setHex(b);
      c.lerp(c2, 0.5 + 0.5 * Math.sin(nz * 7));
      if (k === 'rock' && h > 0.085) c.lerp(new THREE.Color(0xf4f6f8), 0.7);   // 雪の頂
      c.convertSRGBToLinear();
      col.setXYZ(i, c.r, c.g, c.b);
    }
    p.needsUpdate = true; col.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.water.scale.setScalar(flood ? 1.016 : 1.0);
    const eraCol = [0xf2a65a, 0x9cd3f0, 0xe3b74e, 0x3fb8af][era] || 0xf2a65a;
    this.atmoMat.uniforms.col.value.set(eraCol);
    this._props(era);
  }

  _props(era) {
    for (const c of [...this.props.children]) { this.props.remove(c); c.geometry.dispose(); }
    const p = this.geo.attributes.position;
    const tree = new THREE.ConeGeometry(0.007, 0.026, 6);
    tree.translate(0, 0.012, 0);
    const rock = new THREE.DodecahedronGeometry(0.008, 0);
    const cactus = new THREE.CylinderGeometry(0.003, 0.004, 0.02, 6);
    cactus.translate(0, 0.01, 0);
    const forestR = regionAt('forest', era), duneR = regionAt('dune', era);
    const treeMat = new THREE.MeshStandardMaterial({ color: lin(forestR.biome === 'ice' ? 0xdfeef6 : forestR.biome === 'rock' ? 0x7a6a50 : 0x2f6b3a), roughness: 0.8, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: lin(0x6f6860), roughness: 0.9, flatShading: true });
    const cactMat = new THREE.MeshStandardMaterial({ color: lin(0x6c8f4a), roughness: 0.8 });
    const place = (geo, mat, k, n, every) => {
      const idx = [];
      for (let i = 0; i < p.count; i += every) if (this.vRegion[i] === k) idx.push(i);
      const m = new THREE.InstancedMesh(geo, mat, Math.min(n, idx.length));
      const v = new THREE.Vector3(), q = new THREE.Quaternion(), M = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let j = 0; j < m.count; j++) {
        const i = idx[Math.floor(rnd() * idx.length)];
        v.fromBufferAttribute(p, i);
        q.setFromUnitVectors(up, v.clone().normalize());
        const sc = 0.7 + rnd() * 0.7;
        M.compose(v, q, new THREE.Vector3(sc, sc, sc));
        m.setMatrixAt(j, M);
      }
      this.props.add(m);
    };
    if (forestR.biome !== 'rock') place(tree, treeMat, 'forest', 160, 3);
    place(rock, rockMat, 'rock', 70, 5);
    if (duneR.biome === 'desert') place(cactus, cactMat, 'dune', 24, 7);
  }

  // 地方の表面の点（中心の向き × 地面の高さ）
  surfacePoint(k, offset = [0, 0]) {
    const c = this.centers[k].clone();
    // 中心から少しずらす（何匹も立てるとき）
    const t1 = new THREE.Vector3(0, 1, 0).cross(c).normalize(), t2 = c.clone().cross(t1).normalize();
    c.addScaledVector(t1, offset[0]).addScaledVector(t2, offset[1]).normalize();
    // その向きでいちばん近い頂点の高さ
    const p = this.geo.attributes.position;
    let best = 1, bd = -1;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 2) {
      v.fromBufferAttribute(p, i);
      const l = v.length();
      const d = v.x * c.x / l + v.y * c.y / l + v.z * c.z / l;
      if (d > bd) { bd = d; best = l; }
    }
    const waterR = this.water.scale.x;
    return c.multiplyScalar(Math.max(best, k === 'sea' ? waterR * 0.97 : best));
  }

  // 生き物を地方に立てる: list = [{ region, model, color, x(遺伝子), ghost }]
  setFigures(list) {
    for (const v of this.views) { this.figures.remove(v.holder); v.view.dispose(); }
    this.views = [];
    const perRegion = {};
    for (const f of list) {
      const k = f.region;
      const n = perRegion[k] = (perRegion[k] || 0) + 1;
      const view = new CreatureView(f.model, f.ghost ? { ghost: f.ghostColor || 0x223344, opacity: 0.55 } : { color: f.color, mode: 'skin' });
      // 設計の姿勢のまま
      const fake = poseOf(f.model);
      view.update(fake);
      const holder = new THREE.Group();
      const s = 0.13 / Math.max(0.15, Math.max(f.model.size.h, f.model.size.x * 0.8));
      view.group.scale.setScalar(s);
      view.group.position.set(-f.model.com[0] * s, -f.model.minY * s, -f.model.com[2] * s);
      holder.add(view.group);
      const off = [[0, 0], [0.07, 0.03], [-0.07, 0.04], [0.02, -0.07], [-0.04, -0.06]][(n - 1) % 5];
      const pt = this.surfacePoint(k, off);
      holder.position.copy(pt);
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pt.clone().normalize());
      holder.rotateY(Math.PI * 0.5 + (n - 1) * 0.9);
      this.figures.add(holder);
      this.views.push({ holder, view, region: k });
    }
  }

  select(k) {
    this.selected = k;
    if (!k) { this.ring.visible = false; return; }
    const pt = this.surfacePoint(k).multiplyScalar(1.004);
    this.ring.position.copy(pt);
    this.ring.lookAt(pt.clone().multiplyScalar(2));
    this.ring.visible = true;
    // その地方を正面へ回す
    const c = this.centers[k];
    this.rot.goalYaw = Math.atan2(-c.x, c.z);
    this.rot.goalPitch = Math.asin(Math.max(-1, Math.min(1, c.y))) * 0.8;
    this.rot.auto = false;
  }

  drag(dx, dy) {
    this.rot.vy = dx * 0.006; this.rot.vp = dy * 0.006;
    this.rot.yaw += this.rot.vy; this.rot.pitch = Math.max(-1.1, Math.min(1.1, this.rot.pitch + this.rot.vp));
    this.rot.goalYaw = null; this.rot.goalPitch = null; this.rot.auto = false;
  }
  release() { /* 慣性で回りつづける */ }

  // 画面の点 → 地方
  pick(nx, ny) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = ray.intersectObject(this.land, false)[0] || ray.intersectObject(this.water, false)[0];
    if (!hit) return null;
    const pLocal = this.group.worldToLocal(hit.point.clone()).normalize();
    let best = null, bd = -2;
    // 頂点の地方で決める（境目を正しく）
    const p = this.geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      v.fromBufferAttribute(p, i).normalize();
      const d = v.dot(pLocal);
      if (d > bd) { bd = d; best = this.vRegion[i]; }
    }
    return best;
  }

  // 地方の中心が画面のどこにあるか（ラベル用）: { x, y, visible }
  project(k, w, h) {
    const p = this.surfacePoint(k).multiplyScalar(1.05);
    const world = this.group.localToWorld(p.clone());
    const n = world.clone().normalize();
    const toCam = this.camera.position.clone().sub(world).normalize();
    const visible = n.dot(toCam) > 0.15;
    world.project(this.camera);
    return { x: (world.x * 0.5 + 0.5) * w, y: (-world.y * 0.5 + 0.5) * h, visible };
  }

  resize(w, h, bottomInset = 0) {
    this.w = w; this.h = h;
    this.camera.aspect = w / Math.max(1, h);
    // 下にパネルがあるときは、星を上にずらして見せる
    if (bottomInset > 0) this.camera.setViewOffset(w, h, 0, bottomInset * 0.45, w, h);
    else this.camera.clearViewOffset();
    // 星がちょうど画面の幅（たて長なら幅、横長なら高さ）に収まる距離
    const t = Math.tan((this.camera.fov / 2) * Math.PI / 180);
    const fit = 1.32 / (t * Math.min(1, this.camera.aspect));
    this.camera.position.z = Math.max(3.2, fit) / this.zoom;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    const r = this.rot;
    if (r.goalYaw !== null) {
      let d = r.goalYaw - r.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      r.yaw += d * (1 - Math.exp(-dt * 4));
      r.pitch += (r.goalPitch - r.pitch) * (1 - Math.exp(-dt * 4));
      r.vy = 0; r.vp = 0;
    } else {
      r.yaw += r.vy; r.pitch = Math.max(-1.1, Math.min(1.1, r.pitch + r.vp));
      r.vy *= Math.exp(-dt * 3); r.vp *= Math.exp(-dt * 3);
      if (r.auto) r.yaw += dt * 0.06;
    }
    this.group.rotation.set(r.pitch, r.yaw, 0, 'XYZ');
    this.stars.rotation.y += dt * 0.004;
    if (this.ring.visible) this.ringMat.opacity = 0.55 + 0.35 * Math.sin(performance.now() / 300);
  }

  render() {
    this.renderer.setClearColor(0x0d1124, 1);
    this.renderer.render(this.scene, this.camera);
  }
}

// 設計の姿勢（物理を動かさずに、組み立てたときの位置・向き）
export function poseOf(model) {
  const n = model.n;
  const pos = new Float64Array(3 * n), q = new Float64Array(4 * n);
  model.bodies.forEach((b, i) => { pos.set(b.c, 3 * i); q.set(b.q0, 4 * i); });
  // 筋肉の通り道（設計の姿勢での位置）
  const M = model.muscles, nm = M.length;
  const mStart = new Int32Array(nm + 1);
  let np = 0;
  M.forEach((m, k) => { mStart[k] = np; np += m.pts.length; });
  mStart[nm] = np;
  const mPt = new Float64Array(3 * np);
  let k = 0;
  for (const m of M) for (const pt of m.pts) { mPt.set(pt.p, 3 * k); k++; }
  return { n, pos, q, mPt, mStart, act: new Float64Array(nm), mForce: new Float64Array(nm), mFmax: Float64Array.from(M.map(m => m.fmax)) };
}
