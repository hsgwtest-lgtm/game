// 3D の世界（Three.js r128）
// 空・地形・距離の看板・記録の旗・レーン・カメラ。生き物のメッシュは VoxMesh。
// 描画は PixelRenderer が低解像度＋32色に変換するので、ここでは素直なローポリで作る。

import { PAL } from '../core/config.js';
import { heightAt, LANE_GAP } from '../sim/terrain.js';
import { FB, rgb } from '../gfx/fb.js';
import { text, measure } from '../gfx/font.js';

const THREE = window.THREE;

const THEMES = {
  flat: { zenith: PAL.sky, horizon: PAL.cyan, low: PAL.blue, fog: PAL.silver, ground: [PAL.lime, PAL.green], far: PAL.green },
  hills: { zenith: PAL.blue, horizon: PAL.peach, low: PAL.plum, fog: PAL.peach, ground: [PAL.lime, PAL.green], far: PAL.forest },
  bumpy: { zenith: PAL.sky, horizon: PAL.sand, low: PAL.clay, fog: PAL.sand, ground: [PAL.sand, PAL.tan], far: PAL.clay },
  stairs: { zenith: PAL.navy, horizon: PAL.steel, low: PAL.ink, fog: PAL.slate, ground: [PAL.gray, PAL.steel], far: PAL.slate },
  build: { zenith: PAL.navy, horizon: PAL.slate, low: PAL.ink, fog: PAL.navy, ground: [PAL.slate, PAL.navy], far: PAL.ink },
};

function labelTexture(str, fg = PAL.ink, bg = PAL.cream, border = PAL.ink) {
  const w = measure(str) + 6, h = 13;
  const fb = new FB(w, h);
  fb.rect(0, 0, w, h, rgb(border));
  fb.rect(1, 1, w - 2, h - 2, rgb(bg));
  text(fb, str, 3, 0, rgb(fg));
  // FB は上から下。テクスチャは下から上なので上下を入れかえる
  const flip = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) flip.set(fb.data.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  const tex = new THREE.DataTexture(flip, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, w, h };
}

function checkerTexture(a, b) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  const d = new Uint8Array(16);
  const put = (i, c) => { d[i * 4] = c.r * 255; d[i * 4 + 1] = c.g * 255; d[i * 4 + 2] = c.b * 255; d[i * 4 + 3] = 255; };
  put(0, ca); put(1, cb); put(2, cb); put(3, ca);
  const t = new THREE.DataTexture(d, 2, 2, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class World3D {
  constructor(renderer) {
    this.renderer = renderer;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    const s = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 140);
    this.fog = new THREE.Fog(0xffffff, 9, 40);
    s.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.62);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.72);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(512, 512);
    const sc = this.sun.shadow.camera;
    sc.left = -1.6; sc.right = 1.6; sc.top = 1.6; sc.bottom = -1.6; sc.near = 0.5; sc.far = 12;
    this.sun.shadow.bias = -0.002;
    s.add(this.sun);
    s.add(this.sun.target);
    this.envGroup = new THREE.Group();
    this.buildGroup = new THREE.Group();
    this.actors = new THREE.Group();
    s.add(this.envGroup, this.buildGroup, this.actors);
    this.time = 0;
    this.themeKey = '';
    this.terrain = '';
    this.lanes = 1;
    this._buildSky();
    this._buildMarkers();
    this.cam = {
      yaw: 0.55, pitch: 0.36, dist: 2.2, target: new THREE.Vector3(0, 0.15, 0),
      goal: new THREE.Vector3(0, 0.15, 0), follow: true, minDist: 0.5, maxDist: 9, lead: 0.25,
      yawGoal: 0.55, pitchGoal: 0.36, distGoal: 2.2,
    };
    this.aspect = 1;
    this.setTheme('flat');
    this.setTerrain('flat', 1);
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
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(120, 16, 10), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    // 雲（ブロック）
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: false });
    this.clouds = new THREE.Group();
    const box = new THREE.BoxGeometry(1, 1, 1);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 14; i++) {
      const grp = new THREE.Group();
      const parts = 2 + Math.floor(rnd() * 3);
      for (let j = 0; j < parts; j++) {
        const b = new THREE.Mesh(box, this.cloudMat);
        b.scale.set(3 + rnd() * 5, 0.8 + rnd() * 1.2, 2 + rnd() * 3);
        b.position.set(rnd() * 4 - 2, rnd() * 0.8, rnd() * 2 - 1);
        grp.add(b);
      }
      const ang = rnd() * Math.PI * 2, r = 40 + rnd() * 40;
      grp.position.set(Math.cos(ang) * r, 14 + rnd() * 14, Math.sin(ang) * r);
      grp.userData.spd = 0.3 + rnd() * 0.5;
      this.clouds.add(grp);
    }
    this.scene.add(this.clouds);
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(5, 10), new THREE.MeshBasicMaterial({ color: PAL.yellow, fog: false, depthWrite: false }));
    this.sunDisc.position.set(30, 38, -80);
    this.sunDisc.lookAt(0, 0, 0);
    this.sunDisc.renderOrder = -8;
    this.scene.add(this.sunDisc);
  }

  setTheme(key) {
    if (this.themeKey === key) return;
    this.themeKey = key;
    const t = this.theme = THEMES[key] || THEMES.flat;
    const u = this.skyMat.uniforms;
    u.zenith.value.setHex(t.zenith); u.horizon.value.setHex(t.horizon); u.low.value.setHex(t.low);
    this.fog.color.setHex(t.fog);
    this.clearColor = t.fog;
    this.cloudMat.color.setHex(key === 'stairs' || key === 'build' ? PAL.slate : PAL.white);
    this.sunDisc.visible = key !== 'build';
  }

  // ── 地形 ──
  setTerrain(type, lanes = 1) {
    if (this.terrain === type && this.lanes === lanes && this.ground) return;
    this.terrain = type; this.lanes = lanes;
    if (this.ground) { this.envGroup.remove(this.ground); this.ground.geometry.dispose(); this.ground.material.map.dispose(); this.ground.material.dispose(); }
    if (this.far) { this.envGroup.remove(this.far); this.far.geometry.dispose(); this.far.material.dispose(); }
    const t = THEMES[type] || THEMES.flat;
    const x0 = -5, x1 = 52, halfZ = Math.max(4, (lanes * LANE_GAP) / 2 + 2.5);
    const dx = type === 'stairs' ? 0.05 : type === 'flat' ? 1 : 0.2;
    const dz = type === 'bumpy' ? 0.125 : type === 'flat' ? 1 : 1;
    const nx = Math.round((x1 - x0) / dx), nz = Math.round((2 * halfZ) / dz);
    const geo = new THREE.PlaneGeometry(x1 - x0, 2 * halfZ, nx, nz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, 0);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, heightAt(type, x, z));
      uv.setXY(i, x / 0.5, z / 0.5);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ map: checkerTexture(t.ground[0], t.ground[1]) });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.envGroup.add(this.ground);
    // 遠くの地面（平ら・単色）
    const fg = new THREE.PlaneGeometry(260, 260);
    fg.rotateX(-Math.PI / 2);
    fg.translate(20, -0.02, 0);
    this.far = new THREE.Mesh(fg, new THREE.MeshLambertMaterial({ color: t.far }));
    this.envGroup.add(this.far);
    this._placeMarkers();
  }

  // ── 距離の看板・スタート・記録の旗・レーン ──
  _buildMarkers() {
    this.markers = new THREE.Group();
    this.envGroup.add(this.markers);
    this.postMat = new THREE.MeshLambertMaterial({ color: PAL.cream });
    this.postGeo = new THREE.BoxGeometry(0.025, 0.3, 0.025);
    this.signs = [];
    for (let m = 1; m <= 50; m++) {
      const post = new THREE.Mesh(this.postGeo, this.postMat);
      const lt = labelTexture(`${m}m`, PAL.ink, m % 5 === 0 ? PAL.yellow : PAL.cream);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.tex, fog: true }));
      sp.scale.set(lt.w * 0.0065, lt.h * 0.0065, 1);
      this.markers.add(post, sp);
      this.signs.push({ m, post, sp });
    }
    // スタートライン
    this.startLine = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 1), new THREE.MeshBasicMaterial({ color: PAL.white }));
    this.markers.add(this.startLine);
    // 記録の旗
    this.flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.5, 0.018), new THREE.MeshLambertMaterial({ color: PAL.silver }));
    pole.position.y = 0.25;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.005), new THREE.MeshLambertMaterial({ color: PAL.gold }));
    cloth.position.set(0.08, 0.44, 0);
    const lt = labelTexture('BEST', PAL.ink, PAL.gold);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.tex }));
    sp.scale.set(lt.w * 0.0065, lt.h * 0.0065, 1);
    sp.position.set(0, 0.6, 0);
    this.flag.add(pole, cloth, sp);
    this.flagLine = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 1), new THREE.MeshBasicMaterial({ color: PAL.gold }));
    this.markers.add(this.flag, this.flagLine);
    this.flag.visible = false; this.flagLine.visible = false;
    // レーンの線
    this.laneLines = [];
  }

  _placeMarkers() {
    const halfW = Math.max(0.5, (this.lanes * LANE_GAP) / 2);
    const zSign = -halfW - 0.35;
    for (const s of this.signs) {
      const h = heightAt(this.terrain, s.m, zSign);
      s.post.position.set(s.m, h + 0.15, zSign);
      s.sp.position.set(s.m, h + 0.36, zSign);
    }
    this.startLine.scale.z = halfW * 2;
    this.startLine.position.set(0, 0.002, 0);
    this.flagLine.scale.z = halfW * 2;
    for (const l of this.laneLines) { this.markers.remove(l); l.geometry.dispose(); }
    this.laneLines = [];
    if (this.lanes > 1) {
      const mat = new THREE.MeshBasicMaterial({ color: PAL.white });
      for (let i = 1; i < this.lanes; i++) {
        const z = -halfW + i * LANE_GAP;
        const g = new THREE.BoxGeometry(50, 0.003, 0.015);
        const m = new THREE.Mesh(g, mat);
        m.position.set(25, 0.003 + (this.terrain === 'flat' ? 0 : 0.0), z);
        if (this.terrain !== 'flat') m.visible = false;
        this.markers.add(m);
        this.laneLines.push(m);
      }
    }
  }

  // 記録の旗（null で隠す）
  setRecord(x) {
    const v = x !== null && x !== undefined && Number.isFinite(x) && x > 0.05;
    this.flag.visible = v; this.flagLine.visible = v;
    if (!v) return;
    const halfW = Math.max(0.5, (this.lanes * LANE_GAP) / 2);
    const h = heightAt(this.terrain, x, -halfW - 0.15);
    this.flag.position.set(x, h, -halfW - 0.15);
    this.flagLine.position.set(x, heightAt(this.terrain, x, 0) + 0.003, 0);
  }

  laneZ(i, n = this.lanes) { return (i - (n - 1) / 2) * LANE_GAP; }

  // ── カメラ ──
  setAspect(a) {
    this.aspect = a;
    // 縦長の画面では横がせまいので、そのぶんカメラを引く
    this.distScale = Math.max(1, 0.95 / Math.max(0.2, a));
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  // 注目点（ふつうは生き物の重心）を追いかける
  focus(x, y, z, snap = false) {
    const c = this.cam;
    c.goal.set(x + c.lead, y, z);
    if (snap) c.target.copy(c.goal);
  }

  orbit(dYaw, dPitch) {
    const c = this.cam;
    c.yawGoal += dYaw;
    c.pitchGoal = Math.max(-0.1, Math.min(1.45, c.pitchGoal + dPitch));
  }
  zoom(f) {
    const c = this.cam;
    c.distGoal = Math.max(c.minDist, Math.min(c.maxDist, c.distGoal / f));
  }
  setView(yaw, pitch, dist, snap = false) {
    const c = this.cam;
    c.yawGoal = yaw; c.pitchGoal = pitch; if (dist) c.distGoal = dist;
    if (snap) { c.yaw = yaw; c.pitch = pitch; if (dist) c.dist = dist; }
  }

  update(dt) {
    this.time += dt;
    const c = this.cam;
    const k = 1 - Math.exp(-dt * 6);
    c.target.lerp(c.goal, 1 - Math.exp(-dt * 4));
    c.yaw += (c.yawGoal - c.yaw) * k;
    c.pitch += (c.pitchGoal - c.pitch) * k;
    c.dist += (c.distGoal - c.dist) * k;
    const cp = Math.cos(c.pitch);
    const cam = this.camera;
    const d = c.dist * (this.distScale || 1);
    cam.position.set(
      c.target.x + Math.sin(c.yaw) * cp * d,
      c.target.y + Math.sin(c.pitch) * d,
      c.target.z + Math.cos(c.yaw) * cp * d,
    );
    const minY = heightAt(this.terrain, cam.position.x, cam.position.z) + 0.04;
    if (cam.position.y < minY) cam.position.y = minY;
    cam.lookAt(c.target);
    // 影は注目点のまわりだけ
    this.sun.position.set(c.target.x + 1.8, c.target.y + 4, c.target.z + 2.6);
    this.sun.target.position.copy(c.target);
    const span = Math.max(1.6, Math.min(6, d * 0.6 + (this.lanes > 1 ? this.lanes * 0.8 : 0)));
    const sc = this.sun.shadow.camera;
    if (Math.abs(sc.right - span) > 0.05) {
      sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.updateProjectionMatrix();
    }
    this.sky.position.copy(cam.position);
    for (const g of this.clouds.children) {
      g.position.x += g.userData.spd * dt;
      if (g.position.x > 90) g.position.x -= 180;
    }
    this.clouds.position.set(cam.position.x * 0.9, 0, cam.position.z * 0.9);
    this.fog.near = Math.max(5, d * 2.2);
    this.fog.far = this.fog.near + 26;
  }

  // 3D の点 → 3D 画面の中の位置（0..1, 上が0）。見えなければ null
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }
}
