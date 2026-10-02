// ピクセル描画エンジン
//  1) 3Dシーンを「低解像度」のレンダーターゲットに描く
//  2) ポストエフェクト: 輪郭線 → ベイヤーディザ → 32色パレットに減色
//  3) UIフレームバッファ（ソフト描画）と重ねて、整数倍の最近傍拡大で画面に出す
// → 画面に出るものはすべて「ドット」になる。

import { PALETTE, SCREEN } from '../core/config.js';
import { FB } from './fb.js';

const THREE = window.THREE;

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST_FRAG = `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 res;
uniform float cNear;
uniform float cFar;
uniform vec3 palette[32];
uniform float ditherAmt;
uniform float outlineOn;
uniform vec3 outlineColor;
uniform float outlineMax;
uniform float debugDepth;
varying vec2 vUv;

float viewDist(float d) {
  return (cNear * cFar) / (cFar - d * (cFar - cNear));
}
float m2(float x, float y) { return 2.0 * x + 3.0 * y - 4.0 * x * y; }
float bayer4(vec2 p) {
  float x = mod(p.x, 4.0), y = mod(p.y, 4.0);
  float x0 = mod(x, 2.0), y0 = mod(y, 2.0);
  float x1 = floor(x / 2.0), y1 = floor(y / 2.0);
  return 4.0 * m2(x0, y0) + m2(x1, y1);
}
void main() {
  vec2 px = floor(gl_FragCoord.xy);
  vec2 texel = 1.0 / res;
  vec3 c = texture2D(tColor, vUv).rgb;
  if (outlineOn > 0.5) {
    float d0 = viewDist(texture2D(tDepth, vUv).r);
    float dl = viewDist(texture2D(tDepth, vUv - vec2(texel.x, 0.0)).r);
    float dr = viewDist(texture2D(tDepth, vUv + vec2(texel.x, 0.0)).r);
    float du = viewDist(texture2D(tDepth, vUv + vec2(0.0, texel.y)).r);
    float dd = viewDist(texture2D(tDepth, vUv - vec2(0.0, texel.y)).r);
    float dn = min(min(dl, dr), min(du, dd));
    // 自分より手前に物がある「外側のふち」だけ暗くする
    if (dn < outlineMax && d0 - dn > max(0.5, dn * 0.18)) c = outlineColor;
  }
  if (debugDepth > 0.5) { float dd0 = viewDist(texture2D(tDepth, vUv).r); gl_FragColor = vec4(vec3(clamp(dd0 / 60.0, 0.0, 1.0)), 1.0); return; }
  float b = (bayer4(px) + 0.5) / 16.0 - 0.5;
  c += b * ditherAmt;
  vec3 best = palette[0];
  float bd = 1e9;
  for (int i = 0; i < 32; i++) {
    vec3 p = palette[i];
    vec3 d = c - p;
    float rm = (c.r + p.r) * 0.5;
    float dist = (2.0 + rm) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - rm) * d.b * d.b;
    if (dist < bd) { bd = dist; best = p; }
  }
  gl_FragColor = vec4(best, 1.0);
}
`;

const FINAL_FRAG = `
uniform sampler2D tPost;
uniform sampler2D tUI;
uniform vec2 vres;
uniform float viewH;
uniform float k;
uniform vec2 off;
uniform vec3 bg;
void main() {
  vec2 p = floor((gl_FragCoord.xy - off) / k);
  float yTop = vres.y - 1.0 - p.y;
  vec3 col = bg;
  if (yTop < viewH) {
    col = texture2D(tPost, vec2((p.x + 0.5) / vres.x, 1.0 - (yTop + 0.5) / viewH)).rgb;
  }
  vec4 ui = texture2D(tUI, vec2((p.x + 0.5) / vres.x, (yTop + 0.5) / vres.y));
  col = mix(col, ui.rgb, ui.a);
  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToVec3(h) {
  return new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
}

export class PixelRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    r.setPixelRatio(1);
    r.autoClear = false;
    r.sortObjects = true;
    this.renderer = r;
    this.gl = r.getContext();
    this.VW = 1; this.VH = 1; this.k = 1; this.offX = 0; this.offY = 0;
    this.devW = 1; this.devH = 1; this.dpr = 1;
    this.safe = { t: 0, b: 0, l: 0, r: 0 };
    this.viewH = 0;
    this.bg = 0x181425;
    this.fb = new FB(1, 1);
    this.cam2d = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.ditherAmt = 0.09;
    this.outline = true;
    this._probe = makeSafeProbe();
    this._debugSafe = parseSafeParam();
    this._buildPost();
    this._buildFinal();
    this.resize();
  }

  _buildPost() {
    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, res: { value: new THREE.Vector2(1, 1) },
        cNear: { value: 0.1 }, cFar: { value: 200 }, palette: { value: PALETTE.map(hexToVec3) },
        ditherAmt: { value: this.ditherAmt }, outlineOn: { value: 1 },
        outlineColor: { value: hexToVec3(0x181425) }, outlineMax: { value: 38 }, debugDepth: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    const m = new THREE.Mesh(this.quadGeo, this.postMat);
    m.frustumCulled = false;
    this.postScene.add(m);
  }

  _buildFinal() {
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tPost: { value: null }, tUI: { value: null }, vres: { value: new THREE.Vector2(1, 1) },
        viewH: { value: 0 }, k: { value: 1 }, off: { value: new THREE.Vector2(0, 0) },
        bg: { value: hexToVec3(this.bg) },
      },
      vertexShader: VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
    });
    this.finalScene = new THREE.Scene();
    const m = new THREE.Mesh(this.quadGeo, this.finalMat);
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
    if (cssW <= cssH * 0.8) {
      // 縦長（スマホ）
      const minH = dpr >= 2 ? SCREEN.minH : 330;   // 高精細でない画面は少し低くてもドットの大きさを優先
      k = Math.max(1, Math.min(Math.round(devW / SCREEN.targetW), Math.floor(devH / minH)));
      VW = Math.floor(devW / k); VH = Math.floor(devH / k);
    } else {
      // 横長（PCなど）: 中央に縦長の画面を作る
      k = Math.max(1, Math.round(devH / 430));
      VH = Math.floor(devH / k);
      VW = Math.min(Math.floor(devW / k), Math.round(VH * 0.56));
    }
    this.k = k; this.VW = VW; this.VH = VH; this.dpr = dpr;
    this.devW = devW; this.devH = devH;
    this.offX = Math.floor((devW - VW * k) / 2);
    this.offY = Math.floor((devH - VH * k) / 2);
    this.cssW = cssW; this.cssH = cssH;
    // セーフエリア（ノッチ・ホームバー）を仮想ピクセルで
    const ins = this._readInsets();
    this.safe.t = Math.max(0, Math.ceil((ins.t * dpr - this.offY) / k));
    this.safe.b = Math.max(0, Math.ceil((ins.b * dpr - this.offY) / k));
    this.safe.l = Math.max(0, Math.ceil((ins.l * dpr - this.offX) / k));
    this.safe.r = Math.max(0, Math.ceil((ins.r * dpr - this.offX) / k));
    // UIフレームバッファとテクスチャ
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
    this.setViewHeight(this.viewH || VH, true);
  }

  _readInsets() {
    if (this._debugSafe) return this._debugSafe;
    const cs = getComputedStyle(this._probe);
    return {
      t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0,
      l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0,
    };
  }

  // 3Dを描く高さ（上から何ピクセルまで）
  setViewHeight(h, force = false) {
    h = Math.max(0, Math.min(this.VH, h | 0));
    if (h === this.viewH && this.sceneRT && !force) return;
    this.viewH = h;
    if (this.sceneRT) { this.sceneRT.dispose(); this.sceneRT.depthTexture.dispose(); }
    if (this.postRT) this.postRT.dispose();
    const w = this.VW, hh = Math.max(1, h);
    this.sceneRT = new THREE.WebGLRenderTarget(w, hh, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
      depthBuffer: true, stencilBuffer: false, generateMipmaps: false,
    });
    this.sceneRT.depthTexture = new THREE.DepthTexture(w, hh);
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;
    this.postRT = new THREE.WebGLRenderTarget(w, hh, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    const pu = this.postMat.uniforms;
    pu.tColor.value = this.sceneRT.texture;
    pu.tDepth.value = this.sceneRT.depthTexture;
    pu.res.value.set(w, hh);
    this.finalMat.uniforms.tPost.value = this.postRT.texture;
    this.finalMat.uniforms.viewH.value = h;
  }

  get aspect() { return this.VW / Math.max(1, this.viewH); }

  render(scene, camera, clearColor = 0x000000) {
    const r = this.renderer;
    if (this.viewH > 0 && scene && camera) {
      r.setRenderTarget(this.sceneRT);
      r.setClearColor(clearColor, 1);
      r.clear(true, true, false);
      r.render(scene, camera);
      const pu = this.postMat.uniforms;
      pu.cNear.value = camera.near; pu.cFar.value = camera.far;
      pu.ditherAmt.value = this.ditherAmt;
      pu.outlineOn.value = this.outline ? 1 : 0;
      r.setRenderTarget(this.postRT);
      r.render(this.postScene, this.cam2d);
    }
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
    const v = this.finalMat.uniforms.bg.value;
    v.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
  }

  // 画面のタッチ座標 → 仮想ピクセル座標
  toVirtual(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = this.devW / rect.width, sy = this.devH / rect.height;
    const x = ((clientX - rect.left) * sx - this.offX) / this.k;
    const y = ((clientY - rect.top) * sy - this.offY) / this.k;
    return { x, y };
  }
}

function makeSafeProbe() {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);' +
    'padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);';
  document.body.appendChild(d);
  return d;
}

// テスト用: ?safe=47,34 でノッチ(上47pt)とホームバー(下34pt)を再現
function parseSafeParam() {
  try {
    const m = /[?&]safe=([\d.]+)(?:,([\d.]+))?(?:,([\d.]+))?(?:,([\d.]+))?/.exec(location.search);
    if (!m) return null;
    return { t: +m[1] || 0, b: +(m[2] || 0), l: +(m[3] || 0), r: +(m[4] || 0) };
  } catch (e) { return null; }
}
