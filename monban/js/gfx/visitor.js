// 訪問者の見た目。6つの特徴がそのまま姿に出る
//  赤さ=体の色 / 大きさ=体の大きさ / 角=頭の角の本数 / 速さ=ゆれる速さと前のめり / 光=体の光と光の輪 / 高さ=浮いている高さ
import { THREE } from './util.js';
import { hornCount } from '../game/rules.js';

const bodyGeo = new THREE.SphereGeometry(0.36, 18, 14);
bodyGeo.scale(1, 1.18, 1);
const hornGeo = new THREE.ConeGeometry(0.075, 0.24, 8);
const eyeGeo = new THREE.SphereGeometry(0.05, 8, 8);
const shadowGeo = new THREE.CircleGeometry(0.36, 20).rotateX(-Math.PI / 2);
const haloGeo = new THREE.RingGeometry(0.43, 0.48, 28);
const blue = new THREE.Color('#2f6fe0'), red = new THREE.Color('#e8452c');
const hornMat = new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.6 });
const eyeMat = new THREE.MeshBasicMaterial({ color: '#1a1a1a' });
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.16, depthWrite: false });
const HORN_POS = [[0, 0], [-0.17, 0.02], [0.17, 0.02], [-0.08, 0.14], [0.08, 0.14]];
const HORN_SETS = [[], [0], [1, 2], [0, 1, 2], [1, 2, 3, 4]];

export function sizeScale(v) { return 0.62 + v * 0.66; }
export function floatHeight(v) { return v * 0.75; }

export class Visitor {
  constructor(x) {
    this.x = x;
    this.group = new THREE.Group();
    const col = blue.clone().lerp(red, x[0]);
    const glow = x[4];
    this.mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, emissive: col.clone().lerp(new THREE.Color('#fff7cf'), 0.5), emissiveIntensity: glow * 0.9 });
    this.body = new THREE.Group();
    const m = new THREE.Mesh(bodyGeo, this.mat);
    m.position.y = 0.42; this.body.add(m);
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(sx * 0.13, 0.52, 0.31); this.body.add(e); }
    for (const hi of HORN_SETS[hornCount(x[2])]) {
      const h = new THREE.Mesh(hornGeo, hornMat);
      const [hx, hz] = HORN_POS[hi];
      h.position.set(hx, 0.9 - Math.abs(hx) * 0.35, -hz + 0.02);
      h.rotation.z = -hx * 1.4;
      this.body.add(h);
    }
    if (glow > 0.3) {
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: (glow - 0.3) * 0.9, side: THREE.DoubleSide, depthWrite: false }));
      halo.position.set(0, 0.45, -0.05); this.body.add(halo); this.halo = halo;
    }
    const s = sizeScale(x[1]);
    this.body.scale.setScalar(s);
    this.scale = s;
    this.body.rotation.x = (x[3] - 0.5) * 0.5; // 速いものほど前のめり
    this.group.add(this.body);
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.position.y = 0.012; this.shadow.scale.setScalar(s * (1 - x[5] * 0.35));
    this.group.add(this.shadow);
    this.phase = (x[0] * 7 + x[1] * 13 + x[3] * 5) % 6.28;
    this.t = 0;
    this.baseY = floatHeight(x[5]);
    this.hop = 0;
  }
  // 頭のてっぺんの高さ（札を置く位置）
  get top() { return this.baseY + 1.0 * this.scale + 0.12; }
  get center() { return this.baseY + 0.45 * this.scale; }
  update(dt) {
    this.t += dt;
    const sp = 1.2 + this.x[3] * 9;
    this.body.position.y = this.baseY + Math.abs(Math.sin(this.t * sp + this.phase)) * (0.03 + this.x[3] * 0.09) + this.hop;
    if (this.halo) this.halo.rotation.z += dt * 0.8;
  }
  dispose() { this.mat.dispose(); if (this.halo) this.halo.material.dispose(); }
}
