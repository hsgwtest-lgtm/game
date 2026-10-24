// 3Dの舞台: 空・光・影・地面（地形）・水面・カメラ
const THREE = window.THREE;
import { heightAt } from '../sim/terrain.js';
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

export const BIOMES = {
  sea: { sky: [0x0b3b5c, 0x1d6d8c], fog: 0x0e4a66, ground: [0xc9b48a, 0xb9a273], fogNear: 3, fogFar: 22, water: 0x1a7fa8, under: true },
  shore: { sky: [0x7fc4ec, 0xe8f3f7], fog: 0xd8ecf2, ground: [0xe6d3a3, 0xd9c28c], fogNear: 12, fogFar: 60, water: 0x3a9cc4 },
  plain: { sky: [0x5aa6dc, 0xd8ebf3], fog: 0xcfe4ee, ground: [0x7aa85a, 0x6c9a4f], fogNear: 14, fogFar: 70 },
  desert: { sky: [0x8cc3e6, 0xf6eedc], fog: 0xf0e4cc, ground: [0xe8c98f, 0xdcb978], fogNear: 14, fogFar: 70 },
  rock: { sky: [0x9bb2c8, 0xe9eef2], fog: 0xd9e0e6, ground: [0x9a9590, 0x8a857f], fogNear: 12, fogFar: 60 },
  ice: { sky: [0x9fc9e6, 0xf2f8fb], fog: 0xe8f2f8, ground: [0xe4f0f8, 0xcfe2ef], fogNear: 12, fogFar: 60 },
  forest: { sky: [0x7fb6a0, 0xe4efe6], fog: 0xcfe0d4, ground: [0x6f9a55, 0x628b4a], fogNear: 10, fogFar: 50 },
  lab: { sky: [0x1c2433, 0x3a4a63], fog: 0x26324a, ground: [0x3b4a63, 0x34425a], fogNear: 8, fogFar: 40 },
};

function groundTexture(c1, c2) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const a = new THREE.Color(c1), b = new THREE.Color(c2);
  g.fillStyle = `#${a.getHexString()}`; g.fillRect(0, 0, S, S);
  // ゆるい市松 + 細かな粒
  g.fillStyle = `#${b.getHexString()}`;
  g.fillRect(0, 0, S / 2, S / 2); g.fillRect(S / 2, S / 2, S / 2, S / 2);
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = Math.random() * 1.6 + 0.3;
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + Math.random() * 0.05})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2;
  g.strokeRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.encoding = THREE.sRGBEncoding;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// 画面全体で1つだけ作るレンダラー（スマホでは WebGL の文脈を何個も作らない）
export function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.outputEncoding = THREE.sRGBEncoding;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  return r;
}

export class Stage {
  constructor(renderer) {
    const r = this.renderer = renderer && typeof renderer.render === 'function' ? renderer : makeRenderer(renderer);
    const s = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.03, 300);
    this.hemi = new THREE.HemisphereLight(lin(0xcfe3ff), lin(0x6a5a48), 0.9);
    s.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(lin(0xfff0dc), 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    const sc = sun.shadow.camera;
    sc.left = -2.5; sc.right = 2.5; sc.top = 2.5; sc.bottom = -2.5; sc.near = 0.5; sc.far = 20;
    s.add(sun); s.add(sun.target);
    this.fill = new THREE.DirectionalLight(lin(0x9fc4ff), 0.35);
    this.fill.position.set(-3, 2, -4);
    s.add(this.fill);
    // 空
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vW; void main(){ float h = clamp(vW.y*1.2+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(150, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    s.add(this.sky);
    this.fog = new THREE.Fog(0xffffff, 10, 60);
    s.fog = this.fog;
    this.groundGroup = new THREE.Group();
    s.add(this.groundGroup);
    this.actors = new THREE.Group();
    s.add(this.actors);
    this.fx = new THREE.Group();
    s.add(this.fx);
    this.cam = { yaw: 0.9, pitch: 0.28, dist: 3, target: new THREE.Vector3(0, 0.5, 0), goal: new THREE.Vector3(0, 0.5, 0), yawGoal: 0.9, pitchGoal: 0.28, distGoal: 3, auto: true };
    this.biome = '';
    this.terrainType = '';
    this.setBiome('plain');
    this.setTerrain('flat');
  }

  setBiome(key) {
    if (this.biome === key) return;
    this.biome = key;
    const b = this.b = BIOMES[key] || BIOMES.plain;
    this.skyMat.uniforms.top.value.setHex(b.sky[0]);
    this.skyMat.uniforms.bottom.value.setHex(b.sky[1]);
    this.fog.color.copy(lin(b.fog));
    this.fog.near = b.fogNear; this.fog.far = b.fogFar;
    this.clear = b.fog;
    this.hemi.intensity = b.under ? 0.7 : 0.9;
    this.sun.intensity = b.under ? 1.1 : 2.2;
    if (this.terrainType) { const t = this.terrainType; this.terrainType = ''; this.setTerrain(t, this.water); }
  }

  setTerrain(type, water = null) {
    if (this.terrainType === type && this.water === water) return;
    this.terrainType = type; this.water = water;
    for (const c of [...this.groundGroup.children]) { this.groundGroup.remove(c); if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }
    const b = this.b;
    const x0 = -12, x1 = 60, w = 24;
    const flat = type === 'flat' || type === 'ice';
    const nx = flat ? 4 : 360, nz = flat ? 4 : 48;
    const geo = new THREE.PlaneGeometry(x1 - x0, w, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, 0);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (!flat) p.setY(i, heightAt(type, x, z));
      uv.setXY(i, x / 1.0, z / 1.0);
    }
    geo.computeVertexNormals();
    const tex = groundTexture(b.ground[0], b.ground[1]);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: type === 'ice' ? 0.15 : 0.95, metalness: 0 });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.groundGroup.add(ground);
    // 距離の目じるし（1mごとの線）
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    for (let m = 1; m <= 50; m++) {
      const lg = new THREE.PlaneGeometry(0.02, m % 5 === 0 ? 2.4 : 1.2);
      lg.rotateX(-Math.PI / 2);
      const l = new THREE.Mesh(lg, lineMat);
      l.position.set(m, heightAt(type, m, 0) + 0.003, 0);
      this.groundGroup.add(l);
    }
    if (water) {
      const wg = new THREE.PlaneGeometry(x1 - x0, w, 1, 1);
      wg.rotateX(-Math.PI / 2);
      const wm = new THREE.MeshStandardMaterial({ color: lin(b.water || 0x3a9cc4), transparent: true, opacity: 0.45, roughness: 0.15, metalness: 0.1, depthWrite: false });
      const wmesh = new THREE.Mesh(wg, wm);
      wmesh.position.set((x0 + x1) / 2, water, 0);
      wmesh.renderOrder = 2;
      this.groundGroup.add(wmesh);
    }
  }

  // w,h: 画面の大きさ。inset: 上下のパネルで隠れる高さ（被写体が見える所の真ん中に来るよう、投影をずらす）
  resize(w, h, inset = null) {
    this.w = w; this.h = h;
    this.camera.aspect = w / Math.max(1, h);
    if (inset && (inset.top || inset.bottom)) this.camera.setViewOffset(w, h, 0, (inset.bottom - inset.top) * 0.5, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  focus(x, y, z, snap = false) {
    this.cam.goal.set(x, y, z);
    if (snap) this.cam.target.copy(this.cam.goal);
  }
  orbit(dy, dp) { this.cam.yawGoal += dy; this.cam.pitchGoal = Math.max(-0.15, Math.min(1.4, this.cam.pitchGoal + dp)); }
  zoom(f) { this.cam.distGoal = Math.max(0.6, Math.min(25, this.cam.distGoal / f)); }
  setView(yaw, pitch, dist, snap = false) {
    const c = this.cam;
    c.yawGoal = yaw; c.pitchGoal = pitch; if (dist) c.distGoal = dist;
    if (snap) { c.yaw = yaw; c.pitch = pitch; if (dist) c.dist = dist; }
  }

  update(dt) {
    const c = this.cam;
    const k = 1 - Math.exp(-dt * 5);
    c.target.lerp(c.goal, 1 - Math.exp(-dt * 3.5));
    c.yaw += (c.yawGoal - c.yaw) * k;
    c.pitch += (c.pitchGoal - c.pitch) * k;
    c.dist += (c.distGoal - c.dist) * k;
    const cp = Math.cos(c.pitch);
    this.camera.position.set(c.target.x + Math.sin(c.yaw) * cp * c.dist, c.target.y + Math.sin(c.pitch) * c.dist, c.target.z + Math.cos(c.yaw) * cp * c.dist);
    const minY = (this.terrainType ? heightAt(this.terrainType, this.camera.position.x, this.camera.position.z) : 0) + 0.05;
    if (this.camera.position.y < minY) this.camera.position.y = minY;
    this.camera.lookAt(c.target);
    this.sun.position.set(c.target.x + 2.5, c.target.y + 6, c.target.z + 3.5);
    this.sun.target.position.copy(c.target);
    const span = Math.max(1.5, Math.min(6, c.dist * 0.8));
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - span) > 0.05) { sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.updateProjectionMatrix(); }
    this.sky.position.copy(this.camera.position);
  }

  render() {
    this.renderer.setClearColor(this.clear !== undefined ? this.clear : 0x000000, 1);
    this.renderer.render(this.scene, this.camera);
  }
}
