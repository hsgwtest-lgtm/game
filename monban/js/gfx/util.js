// 3D表示の小道具: 文字ラベル、太さのある線
import * as THREE from '../../lib/three.module.min.js';

export const COL = {
  pass: '#1fa36a', stop: '#d6248f', ink: '#1a1a1a', slate: '#5b6b86', key: '#0017c1', white: '#ffffff', warn: '#ffc700',
};
export const colPass = new THREE.Color(COL.pass), colStop = new THREE.Color(COL.stop), colSlate = new THREE.Color(COL.slate);
export const mixDecision = (p, out = new THREE.Color()) => out.copy(colPass).lerp(colStop, Math.max(0, Math.min(1, p)));

const labelCache = new Map();
// 文字を描いた板（いつもカメラを向く）
export function makeLabel(text, { color = COL.ink, bg = 'rgba(255,255,255,0.92)', size = 0.32, bold = true, border = null } = {}) {
  const key = [text, color, bg, border].join('|');
  let tex = labelCache.get(key);
  if (!tex) {
    const pad = 14, fs = 44;
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    g.font = `${bold ? 700 : 500} ${fs}px "Noto Sans JP","Hiragino Sans",sans-serif`;
    const w = Math.ceil(g.measureText(text).width) + pad * 2, h = fs + pad * 1.4;
    c.width = w; c.height = h;
    g.font = `${bold ? 700 : 500} ${fs}px "Noto Sans JP","Hiragino Sans",sans-serif`;
    if (bg) { g.fillStyle = bg; roundRect(g, 0, 0, w, h, 16); g.fill(); }
    if (border) { g.strokeStyle = border; g.lineWidth = 5; roundRect(g, 2.5, 2.5, w - 5, h - 5, 14); g.stroke(); }
    g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(text, w / 2, h / 2 + 2);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData = { aspect: w / h };
    labelCache.set(key, tex);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(size * tex.userData.aspect, size, 1);
  sp.renderOrder = 20;
  return sp;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ○ と × の札
const markCache = {};
export function markTexture(kind) {
  if (markCache[kind]) return markCache[kind];
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.arc(48, 48, 44, 0, 7); g.fill();
  g.lineWidth = 12; g.lineCap = 'round';
  if (kind === 'pass') { g.strokeStyle = COL.pass; g.beginPath(); g.arc(48, 48, 24, 0, 7); g.stroke(); }
  else { g.strokeStyle = COL.stop; g.beginPath(); g.moveTo(28, 28); g.lineTo(68, 68); g.moveTo(68, 28); g.lineTo(28, 68); g.stroke(); }
  g.lineWidth = 5; g.strokeStyle = kind === 'pass' ? COL.pass : COL.stop; g.beginPath(); g.arc(48, 48, 44, 0, 7); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (markCache[kind] = t);
}

const UP = new THREE.Vector3(0, 1, 0);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
// a から b へ伸びる太さのある線。grow(0〜1) で根元から生えてくる
export class Beam {
  constructor(layer = 1) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    this.mesh = new THREE.Mesh(cylGeo, this.mat);
    this.mesh.layers.set(layer);
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3();
    this.r = 0.02; this.rNow = 0.02; this.grow = 0; this.delay = 0;
    this.target = new THREE.Color(0xffffff); this.opacity = 0.9;
  }
  set(a, b) { this.a.copy(a); this.b.copy(b); return this; }
  style(r, color, opacity = 0.9) { this.r = r; this.target.set(color); this.opacity = opacity; return this; }
  update(dt) {
    if (this.delay > 0) this.delay -= dt; else this.grow = Math.min(1, this.grow + dt * 2.4);
    this.rNow += (this.r - this.rNow) * Math.min(1, dt * 10);
    this.mat.color.lerp(this.target, Math.min(1, dt * 10));
    this.mat.opacity += (this.opacity - this.mat.opacity) * Math.min(1, dt * 10);
    const d = _v.subVectors(this.b, this.a); const len = d.length();
    const e = this.grow * this.grow * (3 - 2 * this.grow);
    this.mesh.visible = e > 0.001 && len > 1e-4;
    if (!this.mesh.visible) return;
    this.mesh.position.copy(this.a);
    this.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    this.mesh.scale.set(this.rNow * 1.35, len * e, this.rNow * 1.35);
  }
  dispose() { this.mat.dispose(); }
}
const _v = new THREE.Vector3();
export { THREE };
