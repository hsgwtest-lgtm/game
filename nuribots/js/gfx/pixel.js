// ピクセル描画エンジン。
//  1) Three.js の3Dを「低解像度」のレンダーターゲットに描く
//  2) 後処理: 奥行きの段差に輪郭線 → 4×4 ベイヤーディザ → 64色パレットに減色
//  3) UI フレームバッファを重ねて、整数倍の最近傍拡大で画面に出す
// → 画面に出るものは すべて「ドット」。

import { PALETTE, SCREEN, C } from '../core/const.js';
import { FB } from './fb.js';

const THREE = window.THREE;
const NPAL = PALETTE.length;

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST = `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 res;
uniform float cNear;
uniform float cFar;
uniform vec3 pal[${NPAL}];
uniform float dith;
uniform float outline;
uniform vec3 lineCol;
varying vec2 vUv;
float vd(float d) { return (cNear * cFar) / (cFar - d * (cFar - cNear)); }
float m2(float x, float y) { return 2.0 * x + 3.0 * y - 4.0 * x * y; }
float bayer(vec2 p) {
  float x = mod(p.x, 4.0), y = mod(p.y, 4.0);
  return 4.0 * m2(mod(x, 2.0), mod(y, 2.0)) + m2(floor(x / 2.0), floor(y / 2.0));
}
void main() {
  vec2 t = 1.0 / res;
  vec3 c = texture2D(tColor, vUv).rgb;
  if (outline > 0.5) {
    float d0 = vd(texture2D(tDepth, vUv).r);
    float dl = vd(texture2D(tDepth, vUv - vec2(t.x, 0.0)).r);
    float dr = vd(texture2D(tDepth, vUv + vec2(t.x, 0.0)).r);
    float du = vd(texture2D(tDepth, vUv + vec2(0.0, t.y)).r);
    float dd = vd(texture2D(tDepth, vUv - vec2(0.0, t.y)).r);
    float dn = min(min(dl, dr), min(du, dd));
    if (dn < cFar * 0.8 && d0 - dn > max(0.35, dn * 0.06)) c = lineCol;
  }
  float b = (bayer(floor(gl_FragCoord.xy)) + 0.5) / 16.0 - 0.5;
  c += b * dith;
  vec3 best = pal[0];
  float bd = 1e9;
  for (int i = 0; i < ${NPAL}; i++) {
    vec3 p = pal[i];
    vec3 d = c - p;
    float rm = (c.r + p.r) * 0.5;
    float dist = (2.0 + rm) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - rm) * d.b * d.b;
    if (dist < bd) { bd = dist; best = p; }
  }
  gl_FragColor = vec4(best, 1.0);
}
`;

const FINAL = `
uniform sampler2D tPost;
uniform sampler2D tUI;
uniform vec2 vres;
uniform vec4 view;   // x, y(上から), w, h  仮想ピクセル
uniform float k;
uniform vec2 off;
uniform vec3 bg;
uniform float has3d;
void main() {
  vec2 p = floor((gl_FragCoord.xy - off) / k);
  float yTop = vres.y - 1.0 - p.y;
  vec3 col = bg;
  if (has3d > 0.5 && p.x >= view.x && p.x < view.x + view.z && yTop >= view.y && yTop < view.y + view.w) {
    col = texture2D(tPost, vec2((p.x - view.x + 0.5) / view.z, 1.0 - (yTop - view.y + 0.5) / view.w)).rgb;
  }
  vec4 ui = texture2D(tUI, vec2((p.x + 0.5) / vres.x, (yTop + 0.5) / vres.y));
  col = mix(col, ui.rgb, ui.a);
  gl_FragColor = vec4(col, 1.0);
}
`;

function v3(h) { return new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255); }

export class PixelRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    r.setPixelRatio(1);
    r.autoClear = false;
    this.renderer = r;
    this.VW = 1; this.VH = 1; this.k = 1; this.offX = 0; this.offY = 0;
    this.devW = 1; this.devH = 1;
    this.safe = { t: 0, b: 0, l: 0, r: 0 };
    this.view = { x: 0, y: 0, w: 0, h: 0 };
    this.bg = C.ink;
    this.fb = new FB(1, 1);
    this.cam2d = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.PlaneGeometry(2, 2);
    this.dither = 0.075;
    this.outline = true;
    this.lineColor = C.ink;
    this._probe = makeProbe();
    this._fakeSafe = parseSafe();
    this._buildPost();
    this._buildFinal();
    this.resize();
  }

  _buildPost() {
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, res: { value: new THREE.Vector2(1, 1) },
        cNear: { value: 0.1 }, cFar: { value: 100 }, pal: { value: PALETTE.map(v3) },
        dith: { value: this.dither }, outline: { value: 1 }, lineCol: { value: v3(this.lineColor) },
      },
      vertexShader: VERT, fragmentShader: POST, depthTest: false, depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    const m = new THREE.Mesh(this.quad, this.postMat);
    m.frustumCulled = false;
    this.postScene.add(m);
  }

  _buildFinal() {
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tPost: { value: null }, tUI: { value: null }, vres: { value: new THREE.Vector2(1, 1) },
        view: { value: new THREE.Vector4(0, 0, 1, 1) }, k: { value: 1 }, off: { value: new THREE.Vector2(0, 0) },
        bg: { value: v3(this.bg) }, has3d: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: FINAL, depthTest: false, depthWrite: false,
    });
    this.finalScene = new THREE.Scene();
    const m = new THREE.Mesh(this.quad, this.finalMat);
    m.frustumCulled = false;
    this.finalScene.add(m);
  }

  // 画面サイズから「仮想ピクセル」の大きさを決める
  resize() {
    const cssW = Math.max(1, window.innerWidth), cssH = Math.max(1, window.innerHeight);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.renderer.setSize(devW, devH, false);
    let k, VW, VH;
    if (cssW <= cssH * 0.75) {
      // 縦長（スマホ）
      const minH = dpr >= 2 ? SCREEN.minH : 400;
      k = Math.max(1, Math.min(Math.floor(devW / SCREEN.minW), Math.floor(devH / minH)));
      VW = Math.floor(devW / k); VH = Math.floor(devH / k);
    } else {
      // 横長（PC・タブレット横）: まん中に縦長の画面を作る
      k = Math.max(1, Math.floor(devH / 506));
      if (devH / k < 470 && k > 1) k--;
      VH = Math.floor(devH / k);
      VW = Math.min(Math.floor(devW / k), Math.round(VH * 0.5));
    }
    this.k = k; this.VW = VW; this.VH = VH; this.dpr = dpr;
    this.devW = devW; this.devH = devH;
    this.offX = Math.floor((devW - VW * k) / 2);
    this.offY = Math.floor((devH - VH * k) / 2);
    const ins = this._insets();
    this.safe.t = Math.max(0, Math.ceil((ins.t * dpr - this.offY) / k));
    this.safe.b = Math.max(0, Math.ceil((ins.b * dpr - this.offY) / k));
    this.safe.l = Math.max(0, Math.ceil((ins.l * dpr - this.offX) / k));
    this.safe.r = Math.max(0, Math.ceil((ins.r * dpr - this.offX) / k));
    this.fb.resize(VW, VH);
    if (this.uiTex) this.uiTex.dispose();
    this.uiTex = new THREE.DataTexture(this.fb.data, VW, VH, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.uiTex.minFilter = THREE.NearestFilter;
    this.uiTex.magFilter = THREE.NearestFilter;
    this.uiTex.generateMipmaps = false;
    this.uiTex.flipY = false;
    this.uiTex.needsUpdate = true;
    const fu = this.finalMat.uniforms;
    fu.tUI.value = this.uiTex;
    fu.vres.value.set(VW, VH);
    fu.k.value = k;
    fu.off.value.set(this.offX, this.offY);
    const v = this.view;
    this.setView(v.y, v.h, true);
  }

  _insets() {
    if (this._fakeSafe) return this._fakeSafe;
    const cs = getComputedStyle(this._probe);
    return {
      t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0,
      l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0,
    };
  }

  // 3Dを描く範囲（上から y, 高さ h。横幅は画面いっぱい）
  setView(y, h, force = false) {
    y = Math.max(0, Math.min(this.VH, y | 0));
    h = Math.max(0, Math.min(this.VH - y, h | 0));
    const v = this.view;
    const w = this.VW;
    if (!force && v.y === y && v.h === h && v.w === w && this.rt) return;
    const sizeChanged = !this.rt || v.w !== w || v.h !== h;
    v.x = 0; v.y = y; v.w = w; v.h = h;
    if (sizeChanged && h > 0) {
      if (this.rt) { this.rt.dispose(); this.rt.depthTexture.dispose(); }
      if (this.postRT) this.postRT.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
        depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
      });
      this.rt.depthTexture = new THREE.DepthTexture(w, h);
      this.rt.depthTexture.type = THREE.UnsignedIntType;
      this.postRT = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      });
      const pu = this.postMat.uniforms;
      pu.tColor.value = this.rt.texture;
      pu.tDepth.value = this.rt.depthTexture;
      pu.res.value.set(w, h);
      this.finalMat.uniforms.tPost.value = this.postRT.texture;
    }
    this.finalMat.uniforms.view.value.set(0, y, w, Math.max(1, h));
  }

  get aspect() { return this.view.w / Math.max(1, this.view.h); }

  render(scene, camera, clear = 0x000000) {
    const r = this.renderer;
    const has = !!(scene && camera && this.view.h > 0 && this.rt);
    if (has) {
      r.setRenderTarget(this.rt);
      r.setClearColor(clear, 1);
      r.clear(true, true, false);
      r.render(scene, camera);
      const pu = this.postMat.uniforms;
      pu.cNear.value = camera.near; pu.cFar.value = camera.far;
      pu.dith.value = this.dither;
      pu.outline.value = this.outline ? 1 : 0;
      r.setRenderTarget(this.postRT);
      r.render(this.postScene, this.cam2d);
    }
    this.finalMat.uniforms.has3d.value = has ? 1 : 0;
    this.uiTex.needsUpdate = true;
    r.setRenderTarget(null);
    r.setViewport(0, 0, this.devW, this.devH);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.setViewport(this.offX, this.offY, this.VW * this.k, this.VH * this.k);
    r.render(this.finalScene, this.cam2d);
  }

  setBackground(hex) {
    this.bg = hex;
    this.finalMat.uniforms.bg.value.copy(v3(hex));
  }

  // タッチ座標 → 仮想ピクセル座標
  toVirtual(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.devW / rect.width, sy = this.devH / rect.height;
    return {
      x: ((clientX - rect.left) * sx - this.offX) / this.k,
      y: ((clientY - rect.top) * sy - this.offY) / this.k,
    };
  }
}

function makeProbe() {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);' +
    'padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);';
  document.body.appendChild(d);
  return d;
}

// テスト用: ?safe=47,34 で iPhone 12 のノッチ(上47pt)とホームバー(下34pt)を再現
function parseSafe() {
  try {
    const m = /[?&]safe=([\d.]+)(?:,([\d.]+))?(?:,([\d.]+))?(?:,([\d.]+))?/.exec(location.search);
    if (!m) return null;
    return { t: +m[1] || 0, b: +(m[2] || 0), l: +(m[3] || 0), r: +(m[4] || 0) };
  } catch (e) { return null; }
}
