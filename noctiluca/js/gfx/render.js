// 画面に描く: 深海の背景（場）・粒子（夜光虫）・捕食者（クラゲ）
import { Program, makeTex, makeFBO, drawFull, drawPoints, drawInstancedQuads, FMT } from '../gl/gpu.js';
import { HEAD } from '../sim/shaders.js';
import { WORLD_W, WORLD_H, GRID_X, GRID_Y } from '../sim/swarm.js';
import { NPRED } from '../sim/shaders.js';

const MAXR = 16;

const RECTS = `
uniform vec4 uRects[${MAXR}];   // 画面上の四角（GL のピクセル座標、左下原点）
uniform vec2 uScreen;
`;

const LAYOUT = `
uniform ivec2 uBlock;
uniform ivec2 uTiles;
uniform vec2 uWorld;
uniform vec2 uGrid;
uniform vec2 uAtlas;
int worldOf(ivec2 tc) { ivec2 t = tc / uBlock; return t.y * uTiles.x + t.x; }
ivec2 tileOf(int w) { return ivec2(w % uTiles.x, w / uTiles.x); }
vec2 atlasUV(int w, vec2 p) {
  vec2 cell = clamp(p / uWorld * uGrid, vec2(0.5), uGrid - 0.5);
  return (vec2(tileOf(w)) * uGrid + cell) / uAtlas;
}
`;

const QUAD = `
vec2 quadCorner(int id) {
  return vec2(float(id == 1 || id == 2 || id == 4), float(id == 2 || id == 4 || id == 5));
}
`;

// ------------------------------------------------------------ 背景（水・餌・光の場・岩・海面の光）
const VS_BG = `${HEAD}${RECTS}${QUAD}
out vec2 vUV;
flat out int vW;
void main() {
  int w = gl_InstanceID;
  vec2 c = quadCorner(gl_VertexID);
  vec4 r = uRects[w];
  vUV = c;
  vW = w;
  gl_Position = vec4((r.xy + c * r.zw) / uScreen * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_BG = `${HEAD}${LAYOUT}
uniform sampler2D uField;
uniform sampler2D uEnv;
uniform vec4 uLight;
uniform vec2 uBeacon;
uniform vec4 uHeat;
uniform vec4 uFlow;
uniform float uTime;
uniform float uDetail;
uniform float uMoonL;
in vec2 vUV;
flat in int vW;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vUV * uWorld;
  vec4 f = texture(uField, atlasUV(vW, p));
  vec4 env = texture(uEnv, vUV);
  float sd = env.r;
  float y = vUV.y;
  vec3 col = mix(vec3(0.003, 0.008, 0.022), vec3(0.008, 0.03, 0.07), y);
  // 海面からの光
  float L = uLight.x * env.g * uMoonL;
  col += vec3(0.02, 0.06, 0.11) * L * L;
  if (uLight.x > 0.0) {
    float rays = noise(vec2(p.x * 9.0 + y * 2.0, uTime * 0.08)) * smoothstep(0.4, 1.0, y);
    col += vec3(0.03, 0.08, 0.12) * rays * uLight.x;
  }
  // 道しるべ（あなたの光）
  vec2 db = p - uBeacon;
  float B = uLight.z * exp(-dot(db, db) / (uLight.w * uLight.w));
  col += vec3(0.45, 0.35, 0.15) * B * 0.55;
  // 餌（バクテリアのマット・植物プランクトン）
  float food = smoothstep(0.0, 1.0, clamp(f.g, 0.0, 1.0));
  float cap = clamp(f.a, 0.0, 1.0);
  float speck = noise(p * 38.0 + vec2(0.0, uTime * 0.05)) * 0.35 + 0.65;
  col += vec3(0.08, 0.055, 0.015) * cap * 0.5;
  col += vec3(0.40, 0.30, 0.06) * food * speck * 0.5;
  // 熱水
  if (uHeat.w > 0.0) {
    float hr = 1.0 - length(p - uHeat.xy) / uHeat.z;
    if (hr > 0.0) col += vec3(0.9, 0.25, 0.05) * hr * hr * (0.6 + 0.4 * noise(vec2(p.x * 30.0, p.y * 30.0 - uTime * 0.6)));
  }
  // 仲間の光の場
  float g = f.r / (f.r + 25.0);
  col += vec3(0.08, 0.32, 0.85) * g * 0.9;
  // 流れ
  if (uFlow.y > 0.0 && uDetail > 0.5) {
    float s = noise(vec2(p.x * 3.0 - uTime * uFlow.y * 40.0 * sin(p.y * uFlow.z + uFlow.w), p.y * 40.0));
    col += vec3(0.02, 0.05, 0.07) * s;
  }
  // 岩
  if (sd < 0.0) {
    float n = noise(p * 46.0) * 0.45 + noise(p * 11.0) * 0.4 + noise(p * 3.0) * 0.15;
    vec3 rock = mix(vec3(0.055, 0.065, 0.085), vec3(0.13, 0.15, 0.18), n);
    rock *= 0.75 + 0.25 * smoothstep(-0.05, 0.0, sd);
    rock += vec3(0.10, 0.17, 0.24) * smoothstep(-0.007, 0.0, sd) * (0.5 + 0.5 * env.g);
    col = rock;
  } else {
    col *= 0.7 + 0.3 * smoothstep(0.0, 0.03, sd);
    col += vec3(0.03, 0.06, 0.09) * smoothstep(0.008, 0.0, sd);
  }
  o = vec4(col, 1.0);
}`;

// ------------------------------------------------------------ 粒子
const VS_PT = `${HEAD}${RECTS}${LAYOUT}
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uC;
uniform ivec2 uPTex;
uniform float uPointSize;
uniform float uBright;
uniform int uNRects;
out vec4 vCol;
void main() {
  int id = gl_VertexID;
  ivec2 tc = ivec2(id % uPTex.x, id / uPTex.x);
  vec4 C = texelFetch(uC, tc, 0);
  vec4 B0 = texelFetch(uB, tc, 0);
  if ((C.x < 0.5 && -B0.x > 40.0) || worldOf(tc) >= uNRects) { gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); return; }
  vec4 A = texelFetch(uA, tc, 0);
  vec4 B = texelFetch(uB, tc, 0);
  int w = worldOf(tc);
  vec4 r = uRects[w];
  if (r.z <= 0.0) { gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); return; }
  vec2 px = r.xy + A.xy / uWorld * r.zw;
  gl_Position = vec4(px / uScreen * 2.0 - 1.0, 0.0, 1.0);
  float glow = B.y;
  float en = clamp(B.x, 0.0, 1.0);
  vec3 base = mix(vec3(0.10, 0.28, 0.75), vec3(0.20, 0.85, 1.0), en);
  vec3 col = base * (0.30 + 0.45 * en) + vec3(0.65, 0.9, 1.0) * glow * 1.7;
  float size = uPointSize * (1.0 + glow * 0.9);
  if (C.x < 0.5) {
    float t = -B.x / 40.0;
    col = vec3(1.0, 0.35, 0.25) * (1.0 - t) * 0.9;
    size = uPointSize * (1.0 + t);
  }
  vCol = vec4(col * uBright, 1.0);
  gl_PointSize = size;
}`;

const FS_PT = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.25, 0.0, dot(d, d));
  o = vec4(vCol.rgb * a, a);
}`;

// ------------------------------------------------------------ 捕食者（クラゲ）
const VS_PRED = `${HEAD}${RECTS}
uniform sampler2D uPred;
uniform vec2 uWorld;
uniform int uNPred;
uniform float uSize;
out vec2 vQ;
out float vOn;
out vec2 vVel;
${QUAD}
void main() {
  int i = gl_InstanceID;
  int k = i % NPRED;
  int w = i / NPRED;
  vec2 c = quadCorner(gl_VertexID);
  vec4 P = texelFetch(uPred, ivec2(k, w), 0);
  vOn = k < uNPred ? 1.0 : 0.0;
  vec4 r = uRects[w];
  vec2 center = r.xy + P.xy / uWorld * r.zw;
  float s = uSize / uWorld.x * r.z;
  vQ = c * 2.0 - 1.0;
  vVel = P.zw;
  gl_Position = vec4((center + vQ * s) / uScreen * 2.0 - 1.0, 0.0, 1.0);
  if (vOn < 0.5) gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
}`;

const FS_PRED = `#version 300 es
precision highp float;
in vec2 vQ;
in float vOn;
in vec2 vVel;
uniform float uTime;
uniform float uRing;
uniform float uBody;   // 体の大きさ（四角に対する割合）
out vec4 o;
void main() {
  vec2 q = vQ;
  float r = length(q);
  vec2 dir = length(vVel) > 1e-6 ? normalize(vVel) : vec2(0.0, 1.0);
  vec2 lq = vec2(dot(q, vec2(dir.y, -dir.x)), dot(q, dir)) / uBody;   // +y が進む向き
  float t = uTime;
  float pulse = 0.5 + 0.5 * sin(t * 3.2);
  // かさ（ドーム）: 脈打つたびに少しすぼまる
  float bw = 0.62 - 0.07 * pulse;
  vec2 bq = (lq - vec2(0.0, 0.12)) / vec2(bw, 0.52);
  float scallop = 0.05 * sin(lq.x * 26.0 + t * 2.0);
  float dome = length(vec2(bq.x, max(bq.y, 0.0)));
  float inside = step(-0.28 + scallop, bq.y) * (1.0 - smoothstep(0.9, 1.0, dome));
  float rim = smoothstep(0.7, 0.95, dome) * inside;
  float body = inside * (0.35 + 0.65 * smoothstep(0.2, 1.0, dome));
  // しょく手（6本）と口腕（2本）
  float ten = 0.0;
  float yy = -(lq.y - 0.12 + 0.28 * 0.52);
  for (int k = 0; k < 6; k++) {
    float x0 = (float(k) - 2.5) * 0.19 * (bw / 0.62);
    float sway = sin(yy * 7.0 - t * 4.0 + float(k) * 1.3) * 0.07 * yy;
    float d = abs(lq.x - x0 - sway);
    ten += smoothstep(0.035, 0.0, d) * step(0.0, yy) * (1.0 - smoothstep(0.4, 1.7, yy));
  }
  for (int k = 0; k < 2; k++) {
    float x0 = (float(k) - 0.5) * 0.12;
    float sway = sin(yy * 9.0 - t * 3.0 + float(k) * 2.0) * 0.05 * yy;
    float d = abs(lq.x - x0 - sway);
    ten += 1.6 * smoothstep(0.06, 0.0, d) * step(0.0, yy) * (1.0 - smoothstep(0.2, 0.9, yy));
  }
  vec3 col = vec3(0.55, 0.16, 0.75) * body * 0.8 + vec3(1.0, 0.42, 0.78) * rim * (1.1 + 0.5 * pulse)
           + vec3(1.0, 0.45, 0.8) * ten * 0.45;
  float halo = exp(-dot(lq, lq) * 1.6) * 0.22;
  col += vec3(0.65, 0.12, 0.45) * halo;
  // 気配がとどく範囲（うっすら）
  col += vec3(0.75, 0.2, 0.45) * uRing * smoothstep(0.025, 0.0, abs(r - 0.97)) * 0.22;
  o = vec4(col * vOn, 1.0);
}`;

// ------------------------------------------------------------ 光の残像（本番用）
const FS_FADE = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uFade;
uniform vec2 uSize;
out vec4 o;
void main() { o = texture(uTex, gl_FragCoord.xy / uSize) * uFade; }`;

const FS_COMPOSE = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uGain;
out vec4 o;
void main() {
  vec3 c = texture(uTex, gl_FragCoord.xy / uSize).rgb * uGain;
  // 明るいところは少し青みを残したまま、なめらかに頭打ちに
  float lum = dot(c, vec3(0.3, 0.5, 0.2));
  c = c / (1.0 + lum * 0.55);
  o = vec4(c, 1.0);
}`;

const VS_SIMPLE = `#version 300 es
precision highp float;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export class Renderer {
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.bg = new Program(gl, VS_BG, FS_BG, 'bg');
    this.pt = new Program(gl, VS_PT, FS_PT, 'pt');
    this.pr = new Program(gl, VS_PRED, FS_PRED, 'pred');
    this.fade = new Program(gl, VS_SIMPLE, FS_FADE, 'fade');
    this.compose = new Program(gl, VS_SIMPLE, FS_COMPOSE, 'compose');
    this.dpr = 1;
    this.w = 1; this.h = 1;
    this.trail = null;
    this.time = 0;
  }

  resize(dprCap = 2) {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (w !== c.width || h !== c.height) {
      c.width = w; c.height = h;
      this._dropTrail();
    }
    this.dpr = dpr;
    this.w = w; this.h = h;
  }

  _dropTrail() {
    const gl = this.gl;
    if (this.trail) {
      this.trail.t.forEach((t) => gl.deleteTexture(t));
      this.trail.f.forEach((f) => gl.deleteFramebuffer(f));
      this.trail = null;
    }
  }

  _ensureTrail() {
    if (this.trail && this.trail.w === this.w && this.trail.h === this.h) return;
    this._dropTrail();
    const gl = this.gl;
    const t = [0, 1].map(() => makeTex(gl, this.w, this.h, FMT.RGBA16F, { linear: true }));
    this.trail = { w: this.w, h: this.h, t, f: t.map((x) => makeFBO(gl, [x])), cur: 0 };
  }

  clear(r = 0.003, g = 0.006, b = 0.016) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // CSS ピクセルの四角（左上原点）→ GL ピクセル（左下原点）
  rectsGL(rects) {
    const arr = new Float32Array(MAXR * 4);
    const d = this.dpr;
    rects.slice(0, MAXR).forEach((r, i) => {
      arr[i * 4] = r.x * d;
      arr[i * 4 + 1] = this.h - (r.y + r.h) * d;
      arr[i * 4 + 2] = r.w * d;
      arr[i * 4 + 3] = r.h * d;
    });
    return arr;
  }

  _layout(p, sw) {
    p.set('uBlock', [sw.blockW, sw.blockH]).set('uTiles', [sw.tilesX, sw.tilesY])
      .set('uWorld', [WORLD_W, WORLD_H]).set('uGrid', [GRID_X, GRID_Y]).set('uAtlas', [sw.atlasW, sw.atlasH]);
  }

  // 世界たちを描く。opts: { trails, pointSize, bright, ring, detail }
  drawWorlds(sw, rects, opts = {}) {
    const gl = this.gl;
    const R = this.rectsGL(rects);
    const n = Math.min(rects.length, sw.K);
    const cfg = sw.cfg;
    const scr = [this.w, this.h];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    // 1つの世界を描くときは、その四角の外にはみ出さない
    const clip = n === 1 && opts.clip !== false;
    if (clip) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.floor(R[0]), Math.floor(R[1]), Math.ceil(R[2]), Math.ceil(R[3]));
    }

    // 背景
    const bg = this.bg.use();
    this._layout(bg, sw);
    bg.set('uRects', R).set('uScreen', scr)
      .tex('uField', sw.field.read[0]).tex('uEnv', sw.envTex)
      .set('uLight', cfg.light).set('uBeacon', sw.beacon).set('uHeat', cfg.heat || [0, 0, 1, 0])
      .set('uFlow', cfg.flow).set('uTime', this.time).set('uDetail', opts.detail ?? 1)
      .set('uMoonL', sw.moon ? sw.moon[0] : 1);
    drawInstancedQuads(gl, n);

    const ptSize = (opts.pointSize ?? 1.6) * this.dpr;
    // 粒が多いほど1粒を暗く（重なっても白くとびすぎないように）
    const dens = Math.min(1, Math.pow(40000 / sw.P, 0.55));
    const st = sw.state.read;
    if (opts.trails) {
      // 残像つき: 粒子を別のバッファに足しこみ、少しずつ消す
      this._ensureTrail();
      const T = this.trail;
      const src = T.t[T.cur], dst = T.f[1 - T.cur];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
      gl.viewport(0, 0, this.w, this.h);
      const fd = this.fade.use();
      fd.tex('uTex', src).set('uFade', opts.fade ?? 0.82).set('uSize', scr);
      drawFull(gl);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._points(sw, R, scr, ptSize, (opts.bright ?? 0.55) * dens, n);
      T.cur = 1 - T.cur;
      // 合成
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.w, this.h);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const cp = this.compose.use();
      cp.tex('uTex', T.t[T.cur]).set('uSize', scr).set('uGain', 1.0);
      drawFull(gl);
    } else {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._points(sw, R, scr, ptSize, (opts.bright ?? 1.0) * dens, n);
    }

    // 捕食者
    if (cfg.predP[0] > 0) {
      gl.blendFunc(gl.ONE, gl.ONE);
      const pp = this.pr.use();
      pp.set('uRects', R).set('uScreen', scr).tex('uPred', sw.pred.read[0])
        .set('uWorld', [WORLD_W, WORLD_H]).set('uNPred', cfg.predP[0] | 0)
        .set('uSize', Math.max(cfg.predP[3], 0.07)).set('uTime', this.time).set('uRing', opts.ring ?? 1)
        .set('uBody', 0.055 / Math.max(cfg.predP[3], 0.07));
      drawInstancedQuads(gl, NPRED * n);
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    void st;
  }

  _points(sw, R, scr, ptSize, bright, n) {
    const gl = this.gl;
    const p = this.pt.use();
    this._layout(p, sw);
    const st = sw.state.read;
    p.set('uRects', R).set('uScreen', scr)
      .tex('uA', st[0]).tex('uB', st[1]).tex('uC', st[2])
      .set('uPTex', [sw.ptW, sw.ptH]).set('uPointSize', ptSize).set('uBright', bright).set('uNRects', n);
    // 表示する世界の分だけ（粒子テクスチャは世界ごとのブロックなので、全部描いて四角の外は捨てる）
    drawPoints(gl, sw.N);
    void n;
  }
}
