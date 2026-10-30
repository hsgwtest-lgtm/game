// WebGL2 の小さな道具箱（シェーダー・テクスチャ・フレームバッファ）
// 粒子の状態は RGBA32F テクスチャ、場（密度・光・餌）は RGBA16F テクスチャに置き、
// フラグメントシェーダーで「全粒子をいっせいに」計算する（GPGPU）。

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('この端末のブラウザは WebGL2 に対応していません');
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('この端末は浮動小数点テクスチャへの描画（EXT_color_buffer_float）に対応していません');
  }
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DITHER);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  return gl;
}

function withLines(src) {
  return src.split('\n').map((l, i) => String(i + 1).padStart(4, ' ') + '  ' + l).join('\n');
}

function compileShader(gl, type, src, name) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(`[shader ${name}] ${log}\n${withLines(src)}`);
    throw new Error(`シェーダーのコンパイルに失敗: ${name}: ${log}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vs, fs, name = 'prog') {
    this.gl = gl;
    this.name = name;
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs, name + '.vs'));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs, name + '.fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      throw new Error(`シェーダーのリンクに失敗: ${name}: ${log}`);
    }
    this.prog = p;
    this.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const base = info.name.replace(/\[0\]$/, '');
      this.u[base] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
    }
    this._unit = 0;
  }

  use() {
    this.gl.useProgram(this.prog);
    this._unit = 0;
    return this;
  }

  has(name) { return !!this.u[name]; }

  // 型はシェーダー側の宣言から自動で決める
  set(name, v) {
    const u = this.u[name];
    if (!u) return this;
    const gl = this.gl;
    switch (u.type) {
      case gl.FLOAT: if (u.size > 1) gl.uniform1fv(u.loc, v); else gl.uniform1f(u.loc, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
      case gl.INT: case gl.BOOL: if (u.size > 1) gl.uniform1iv(u.loc, v); else gl.uniform1i(u.loc, v); break;
      case gl.INT_VEC2: gl.uniform2iv(u.loc, v); break;
      case gl.INT_VEC4: gl.uniform4iv(u.loc, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
      default: throw new Error(`未対応の uniform 型 ${name}`);
    }
    return this;
  }

  tex(name, texture) {
    const u = this.u[name];
    if (!u) return this;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + this._unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u.loc, this._unit);
    this._unit++;
    return this;
  }
}

export const FMT = {
  RGBA32F: 'rgba32f',
  RGBA16F: 'rgba16f',
  R16F: 'r16f',
  RGBA8: 'rgba8',
};

function fmtInfo(gl, fmt) {
  switch (fmt) {
    case FMT.RGBA32F: return { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
    case FMT.RGBA16F: return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.FLOAT };
    case FMT.R16F: return { internal: gl.R16F, format: gl.RED, type: gl.FLOAT };
    case FMT.RGBA8: return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    default: throw new Error('unknown format ' + fmt);
  }
}

export function makeTex(gl, w, h, fmt = FMT.RGBA32F, { linear = false, data = null, repeat = false } = {}) {
  const t = gl.createTexture();
  const f = fmtInfo(gl, fmt);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, data);
  const filt = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
  const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  t.w = w; t.h = h; t.fmt = fmt;
  return t;
}

export function uploadTex(gl, t, data, x = 0, y = 0, w = t.w, h = t.h) {
  const f = fmtInfo(gl, t.fmt);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, f.format, f.type, data);
}

export function makeFBO(gl, textures) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const bufs = [];
  textures.forEach((t, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  });
  gl.drawBuffers(bufs);
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('フレームバッファが作れません (status ' + st + ')');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  fb.w = textures[0].w; fb.h = textures[0].h; fb.n = textures.length; fb.texs = textures;
  return fb;
}

// 同じ形のテクスチャ一式を2組持って交互に使う（読みながら書けないため）
export class PingPong {
  constructor(gl, w, h, fmts, opts = {}) {
    this.gl = gl;
    this.w = w; this.h = h;
    this.sets = [0, 1].map(() => fmts.map((f) => makeTex(gl, w, h, f, opts)));
    this.fbos = this.sets.map((s) => makeFBO(gl, s));
    this.cur = 0;
  }
  get read() { return this.sets[this.cur]; }
  get write() { return this.sets[1 - this.cur]; }
  get writeFBO() { return this.fbos[1 - this.cur]; }
  get readFBO() { return this.fbos[this.cur]; }
  swap() { this.cur = 1 - this.cur; }
  dispose() {
    const gl = this.gl;
    this.sets.flat().forEach((t) => gl.deleteTexture(t));
    this.fbos.forEach((f) => gl.deleteFramebuffer(f));
  }
}

export function bindTarget(gl, fbo, x = 0, y = 0, w = null, h = null) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  if (fbo) gl.viewport(x, y, w ?? fbo.w, h ?? fbo.h);
}

// 属性なしで描く全面三角形（頂点シェーダー側で gl_VertexID から位置を作る）
export const VS_FULL = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

let emptyVAO = null;
export function drawFull(gl) {
  if (!emptyVAO) emptyVAO = gl.createVertexArray();
  gl.bindVertexArray(emptyVAO);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function drawPoints(gl, n) {
  if (!emptyVAO) emptyVAO = gl.createVertexArray();
  gl.bindVertexArray(emptyVAO);
  gl.drawArrays(gl.POINTS, 0, n);
}

export function drawInstancedQuads(gl, n) {
  if (!emptyVAO) emptyVAO = gl.createVertexArray();
  gl.bindVertexArray(emptyVAO);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
}

export function readFloat(gl, fbo, x, y, w, h, attachment = 0) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
  const out = new Float32Array(w * h * 4);
  gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out;
}
