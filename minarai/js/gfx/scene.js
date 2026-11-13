// 3Dの作業場（Three.js）。ワーカーから届くスナップショットを、なめらかにつないで描く。
// 「AIの目」の画像はワーカーが別に描いている（こちらは人が見るための表示）。色は「AIの目」と同じにしてある。
import * as THREE from '../../lib/three.module.min.js';
import { L1, L2, VIEW, R_MAX, R_MIN, wrapPi } from '../core/arm.js';
import { PALETTE, BLOCK_HALF, GOAL_DRAW_R, GRIP } from '../core/raster.js';

const rgb = (c) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
const ARM_Y = 0.56;       // アームの高さ
const BLOCK_H = 0.36;

function neonBox(w, h, d, col, emis = 0.32) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.72), emissive: col, emissiveIntensity: emis * 0.7, roughness: 0.5, metalness: 0.1 }));
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: col.clone().lerp(new THREE.Color('#ffffff'), 0.55) }));
  m.add(e);
  return m;
}
function ring(r0, r1, col, opacity = 1, seg = 64) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, seg).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: false }));
  return m;
}

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070f');
    this.scene.fog = new THREE.Fog('#05070f', 16, 34);
    this.cam = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
    this.view = 'tilt'; this.el = 0.92; this.elTo = 0.92; this.az = 0; this.azTo = 0;
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BLOCK_H / 2);
    this._v = new THREE.Vector3(); this._ndc = new THREE.Vector2();
    this.cur = null; this.from = null; this.to = null; this.t0 = 0; this.dur = 60;
    this.gap = GRIP.open; this.pulse = 0; this.flashCol = null; this.time = 0;
    this._build();
    this.resize();
  }

  _build() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#b9c8ff', '#0a0f1e', 1.0));
    const d = new THREE.DirectionalLight('#ffffff', 1.3); d.position.set(3, 8, 5); s.add(d);
    // 机
    const table = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.75, 0.3, 64), new THREE.MeshStandardMaterial({ color: '#0b1226', roughness: 0.7, metalness: 0.3 }));
    table.position.y = -0.15; s.add(table);
    const rim = ring(2.56, 2.6, '#19f0ff', 0.8); rim.position.y = 0.002; s.add(rim);
    for (let rr = 0.5; rr <= 2.01; rr += 0.5) { const g = ring(rr - 0.006, rr + 0.006, '#2a3f73', 0.9); g.position.y = 0.003; s.add(g); }
    const reach = ring(R_MAX - 0.012, R_MAX + 0.012, '#19f0ff', 0.55); reach.position.y = 0.004; s.add(reach);
    const inner = ring(R_MIN - 0.01, R_MIN + 0.01, '#19f0ff', 0.3); inner.position.y = 0.004; s.add(inner);
    const pts = [];
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; pts.push(0.3 * Math.cos(a), 0.004, 0.3 * Math.sin(a), 2.5 * Math.cos(a), 0.004, 2.5 * Math.sin(a)); }
    const spokes = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#1b2a52' }));
    s.add(spokes);
    // 「AIの目」に映る範囲（四角い枠）
    const v = VIEW, fr = [-v, 0.006, -v, v, 0.006, -v, v, 0.006, -v, v, 0.006, v, v, 0.006, v, -v, 0.006, v, -v, 0.006, v, -v, 0.006, -v];
    this.frame = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(fr, 3)), new THREE.LineBasicMaterial({ color: '#ff3df2', transparent: true, opacity: 0.55 }));
    s.add(this.frame);

    // 置き場（2つまで）
    this.goals = [0, 1].map((i) => {
      const col = rgb(PALETTE.blocks[i]);
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CircleGeometry(GOAL_DRAW_R, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: rgb(PALETTE.goals[i]), transparent: true, opacity: 0.85 }));
      disc.position.y = 0.008; g.add(disc);
      const edge = ring(GOAL_DRAW_R - 0.035, GOAL_DRAW_R, col, 0.95, 48); edge.position.y = 0.012; g.add(edge);
      const glow = ring(GOAL_DRAW_R, GOAL_DRAW_R + 0.16, col, 0.16, 48); glow.position.y = 0.01; g.add(glow);
      Object.assign(g.userData, { glow, disc, edge, col, base: rgb(PALETTE.goals[i]), fin: null });
      g.visible = false; s.add(g);
      return g;
    });
    // ブロック（2つまで。色は種類で変わる）
    this.blocks = [0, 1].map(() => {
      const m = neonBox(BLOCK_HALF * 2, BLOCK_H, BLOCK_HALF * 2, rgb(PALETTE.blocks[0]), 0.4);
      m.visible = false; m.userData.type = -1; s.add(m);
      return m;
    });
    // アーム
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, ARM_Y + 0.06, 28), new THREE.MeshStandardMaterial({ color: '#27304e', roughness: 0.4, metalness: 0.6 }));
    base.position.y = (ARM_Y + 0.06) / 2; s.add(base);
    const baseRing = ring(0.3, 0.36, rgb(PALETTE.base), 0.9, 32); baseRing.position.y = 0.006; s.add(baseRing);
    this.shoulder = new THREE.Group(); this.shoulder.position.y = ARM_Y; s.add(this.shoulder);
    const c1 = rgb(PALETTE.link1), c2 = rgb(PALETTE.link2);
    const link1 = neonBox(L1, 0.16, 0.26, c1); link1.position.x = L1 / 2; this.shoulder.add(link1);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.22, 24), new THREE.MeshStandardMaterial({ color: '#c8cee6', roughness: 0.3, metalness: 0.6 })); this.shoulder.add(cap);
    this.elbow = new THREE.Group(); this.elbow.position.x = L1; this.shoulder.add(this.elbow);
    const ej = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.26, 24), new THREE.MeshStandardMaterial({ color: rgb(PALETTE.joint), emissive: rgb(PALETTE.joint), emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.5 })); this.elbow.add(ej);
    const l2 = L2 - GRIP.wrist;
    const link2 = neonBox(l2, 0.14, 0.22, c2); link2.position.x = l2 / 2; this.elbow.add(link2);
    // グリッパー（手のひら + 指2本。開くと白、にぎると赤むらさき）
    this.hand = new THREE.Group(); this.hand.position.x = L2; this.elbow.add(this.hand);
    this.gripMat = new THREE.MeshStandardMaterial({ color: '#70748a', emissive: rgb(PALETTE.gripOpen), emissiveIntensity: 0.5, roughness: 0.45 });
    this.palm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 1), this.gripMat); this.palm.position.set(-GRIP.wrist, -0.02, 0); this.hand.add(this.palm);
    const fg = new THREE.BoxGeometry(GRIP.len * 2, 0.3, GRIP.finger);
    this.fingers = [1, -1].map((sg) => { const f = new THREE.Mesh(fg, this.gripMat); f.position.set(-0.02, -0.17, 0); f.userData.sg = sg; this.hand.add(f); return f; });
    this.handLight = new THREE.PointLight('#ffffff', 0.6, 2.0); this.handLight.position.set(0, 0.2, 0); this.hand.add(this.handLight);
    // 指の行き先を示す輪
    this.cursor = ring(0.13, 0.17, '#ffffff', 0.9, 28); this.cursor.position.y = 0.02; this.cursor.visible = false; s.add(this.cursor);
    this.burst = ring(0.3, 0.36, '#ffffff', 0.9, 40); this.burst.position.y = 0.03; this.burst.visible = false; s.add(this.burst);
  }

  resize() {
    const c = this.canvas, w = c.clientWidth || 1, h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.w = w; this.h = h;
  }

  setView(v) { this.view = v; this.elTo = v === 'top' ? 1.5607 : 0.92; }
  toggleView() { this.setView(this.view === 'top' ? 'tilt' : 'top'); return this.view; }

  // 画面の点 → 机の上の座標（世界座標 x, y）。外れたら null
  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    this.ray.setFromCamera(this._ndc, this.cam);
    const p = this.ray.ray.intersectPlane(this.plane, this._v);
    if (!p) return null;
    return { x: p.x, y: -p.z };
  }

  setCursor(x, y, on) { this.cursor.visible = on; if (on) this.cursor.position.set(x, 0.02, -y); }

  // 新しいスナップショットを受け取る（period: 次が届くまでのおよその間隔 ms）
  push(snap, period, jump) {
    const now = performance.now();
    if (!this.cur || jump) { this.cur = Float32Array.from(snap); this.from = this.cur.slice(); this.to = this.cur.slice(); this.t0 = now; this.dur = 1; return; }
    this.from = this.cur.slice(); this.to = Float32Array.from(snap); this.t0 = now; this.dur = Math.max(16, Math.min(120, period));
    // ブロックが遠くへ飛んだ（並べ直し・つかんだ瞬間の吸いつき以外）は、つながず切り替える
    for (let i = 0; i < 2; i++) { const o = 6 + i * 4; if (Math.hypot(this.to[o] - this.from[o], this.to[o + 1] - this.from[o + 1]) > 0.6) { this.from[o] = this.to[o]; this.from[o + 1] = this.to[o + 1]; this.from[o + 2] = this.to[o + 2]; } }
  }

  flash(kind) {
    this.pulse = 1;
    this.flashCol = kind === 'success' ? '#a6ff3d' : kind === 'fail' ? '#ff3355' : kind === 'grasp' ? '#ff3df2' : '#ffffff';
    if (this.cur) {
      const a1 = this.cur[0], a2 = this.cur[1];
      this.burst.position.set(L1 * Math.cos(a1) + L2 * Math.cos(a1 + a2), 0.03, -(L1 * Math.sin(a1) + L2 * Math.sin(a1 + a2)));
    }
    this.burst.material.color.set(this.flashCol);
  }

  render(dt) {
    this.time += dt;
    const now = performance.now();
    if (this.to) {
      const k = Math.min(1, (now - this.t0) / this.dur), f = this.from, t = this.to, c = this.cur;
      c.set(t);
      c[0] = f[0] + wrapPi(t[0] - f[0]) * k; c[1] = f[1] + (t[1] - f[1]) * k;
      for (let i = 0; i < 2; i++) { const o = 6 + i * 4; c[o] = f[o] + (t[o] - f[o]) * k; c[o + 1] = f[o + 1] + (t[o + 1] - f[o + 1]) * k; c[o + 2] = f[o + 2] + wrapPi(t[o + 2] - f[o + 2]) * k; }
      this._apply(c, dt);
    }
    // カメラ（机ぜんたいが横幅に収まる距離まで下がる。斜めのときは手前が大きく見えるぶん少し余分に）
    this.el += (this.elTo - this.el) * Math.min(1, dt * 6);
    const tanV = Math.tan(this.cam.fov * Math.PI / 360), tanH = tanV * this.cam.aspect;
    const tilt = Math.max(0, Math.min(1, (1.5607 - this.el) / (1.5607 - 0.92)));
    const R = 2.66 - 0.16 * tilt;
    const dist = Math.max(R / tanH * (1 + 0.13 * tilt), R / tanV * (1 - 0.1 * tilt));
    const off = -0.28 - 0.1 * tilt;
    this.cam.position.set(0, dist * Math.sin(this.el), dist * Math.cos(this.el) + off);
    this.cam.up.set(0, 0, -1);
    this.cam.lookAt(0, 0, off);
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - dt * 1.8);
      const s = 1 + (1 - this.pulse) * 2.2;
      this.burst.visible = true; this.burst.scale.set(s, 1, s); this.burst.material.opacity = this.pulse * 0.9;
    } else this.burst.visible = false;
    this.frame.material.opacity = 0.35 + 0.2 * Math.sin(this.time * 2);
    this.renderer.render(this.scene, this.cam);
  }

  _apply(s, dt) {
    const a1 = s[0], a2 = s[1], grip = s[2], held = s[3], nb = s[4], ng = s[5];
    this.shoulder.rotation.y = a1; this.elbow.rotation.y = a2;
    // カメラのゆれ（「ゆれる目」の現場）: 「AIの目」に映る範囲の枠をずらして見せる
    const u = 2 * VIEW / 32;
    this.frame.position.set(-s[18] * u, 0, -s[19] * u);
    const gapTo = grip ? (held >= 0 ? GRIP.hold : GRIP.shut) : GRIP.open;
    this.gap += (gapTo - this.gap) * Math.min(1, dt * 22);
    for (const f of this.fingers) f.position.z = f.userData.sg * (this.gap / 2 + GRIP.finger / 2);
    this.palm.scale.z = this.gap + GRIP.finger * 2;
    const gc = rgb(grip ? PALETTE.gripClosed : PALETTE.gripOpen);
    this.gripMat.emissive.lerp(gc, Math.min(1, dt * 18));
    this.handLight.color.copy(this.gripMat.emissive);
    const finGoal = [false, false];
    for (let i = 0; i < 2; i++) {
      const b = this.blocks[i], o = 6 + i * 4;
      const type = s[o + 3] & 3, done = i < nb && s[o + 3] >= 4;
      if (done && type < 2) finGoal[type] = true;
      // 届けたブロックは、置き場に沈んで消える
      const sink = b.userData.sink = done ? Math.min(1, (b.userData.sink || 0) + dt * 3) : 0;
      b.visible = i < nb && sink < 1;
      if (!b.visible) continue;
      if (b.userData.type !== type) {
        b.userData.type = type;
        const col = rgb(PALETTE.blocks[type]);
        b.material.color.copy(col).multiplyScalar(0.72); b.material.emissive.copy(col);
        b.children[0].material.color.copy(col).lerp(new THREE.Color('#ffffff'), 0.55);
      }
      const lift = held === i ? 0.07 : 0;
      b.position.set(s[o], BLOCK_H / 2 + 0.01 + lift - sink * (BLOCK_H + 0.02), -s[o + 1]);
      b.rotation.y = s[o + 2];
      b.material.emissiveIntensity = 0.4 + 0.1 * Math.sin(this.time * 5 + i) + sink;
    }
    for (let i = 0; i < 2; i++) {
      const g = this.goals[i], u = g.userData;
      g.visible = i < ng;
      if (!g.visible) continue;
      g.position.set(s[14 + i * 2], 0, -s[15 + i * 2]);
      if (u.fin !== finGoal[i]) {
        u.fin = finGoal[i];
        const gray = rgb(PALETTE.goalDone);
        u.disc.material.color.copy(u.fin ? gray : u.base); u.edge.material.color.copy(u.fin ? gray.clone().multiplyScalar(2) : u.col); u.glow.visible = !u.fin;
      }
      const p = 1 + 0.08 * Math.sin(this.time * 3 + i * 2);
      u.glow.scale.set(p, 1, p);
    }
  }
}
