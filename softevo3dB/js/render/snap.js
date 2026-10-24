// 生き物の小さな絵（設計の姿勢）を作る。図鑑や見本えらびに使う
const THREE = window.THREE;
import { CreatureView, lin } from './creature.js';
import { poseOf } from './planet.js';

let scene = null, cam = null;
const cache = new Map();

export function snapshot(renderer, model, { w = 160, h = 120, color = 0xd9a58c, mode = 'skin', key = null, bg = 0x1b2140 } = {}) {
  if (key && cache.has(key)) return cache.get(key);
  if (!scene) {
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(lin(0xdfe9ff), lin(0x40384a), 1.0));
    const sun = new THREE.DirectionalLight(lin(0xffffff), 2.0);
    sun.position.set(2, 3, 2.5);
    scene.add(sun);
    cam = new THREE.PerspectiveCamera(30, w / h, 0.01, 50);
  }
  const view = new CreatureView(model, { color, mode });
  view.update(poseOf(model));
  scene.add(view.group);
  const size = Math.max(model.size.h, model.size.x, model.size.z, 0.08);
  const c = new THREE.Vector3((model.size.minX + model.size.maxX) / 2, model.minY + model.size.h / 2, 0);
  cam.aspect = w / h;
  cam.position.set(c.x + size * 1.35, c.y + size * 0.75, c.z + size * 2.0);
  cam.lookAt(c);
  cam.updateProjectionMatrix();
  const rt = new THREE.WebGLRenderTarget(w * 2, h * 2, { encoding: THREE.sRGBEncoding });
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color()).getHex();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(bg, 1);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(w * 2 * h * 2 * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, px);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, 1);
  scene.remove(view.group);
  view.dispose();
  rt.dispose();
  // 上下を反転して canvas へ
  const cv = document.createElement('canvas');
  cv.width = w * 2; cv.height = h * 2;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w * 2, h * 2);
  for (let y = 0; y < h * 2; y++) {
    const src = (h * 2 - 1 - y) * w * 2 * 4;
    img.data.set(px.subarray(src, src + w * 2 * 4), y * w * 2 * 4);
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/png');
  if (key) cache.set(key, url);
  return url;
}
