// 粒子の群れ（K 個の世界）を GPU で動かす
import { Program, PingPong, makeTex, makeFBO, uploadTex, drawFull, drawPoints, bindTarget, readFloat, FMT } from '../gl/gpu.js';
import * as S from './shaders.js';
import { ROW_TEXELS, ROW_FLOATS, NE, NO } from './brain.js';
import { SDF_W, SDF_H } from './sdf.js';

export const WORLD_W = 1.0;
export const WORLD_H = 1.5;
export const GRID_X = 64;
export const GRID_Y = 96;
export const P_REF = 1024; // 学習で使う1世界の粒子数（場の値はこの数を基準にそろえる）

const progCache = new WeakMap();
function programs(gl) {
  let p = progCache.get(gl);
  if (p) return p;
  p = {
    init: new Program(gl, S.VS_FULL, S.FS_INIT, 'init'),
    update: new Program(gl, S.VS_FULL, S.FS_UPDATE, 'update'),
    deposit: new Program(gl, S.VS_DEPOSIT, S.FS_DEPOSIT, 'deposit'),
    field: new Program(gl, S.VS_FULL, S.FS_FIELD, 'field'),
    fieldInit: new Program(gl, S.VS_FULL, S.FS_FIELD_INIT, 'fieldInit'),
    pred: new Program(gl, S.VS_FULL, S.FS_PRED, 'pred'),
    reduce: new Program(gl, S.VS_FULL, S.FS_REDUCE, 'reduce'),
    stamp: new Program(gl, S.VS_FULL, S.FS_STAMP, 'stamp'),
  };
  progCache.set(gl, p);
  return p;
}

export class Swarm {
  constructor(gl, { tilesX = 4, tilesY = 4, blockW = 32, blockH = 32 } = {}) {
    this.gl = gl;
    this.tilesX = tilesX; this.tilesY = tilesY;
    this.K = tilesX * tilesY;
    this.blockW = blockW; this.blockH = blockH;
    this.P = blockW * blockH;
    this.ptW = tilesX * blockW; this.ptH = tilesY * blockH;
    this.N = this.ptW * this.ptH;
    this.atlasW = tilesX * GRID_X; this.atlasH = tilesY * GRID_Y;
    this.prog = programs(gl);

    this.state = new PingPong(gl, this.ptW, this.ptH, [FMT.RGBA32F, FMT.RGBA32F, FMT.RGBA32F]);
    this.field = new PingPong(gl, this.atlasW, this.atlasH, [FMT.RGBA16F], { linear: true });
    this.depTex = makeTex(gl, this.atlasW, this.atlasH, FMT.RGBA16F);
    this.depFBO = makeFBO(gl, [this.depTex]);
    this.pred = new PingPong(gl, S.NPRED, this.K, [FMT.RGBA32F]);
    this.wTex = makeTex(gl, ROW_TEXELS, this.K, FMT.RGBA32F);
    this.envTex = makeTex(gl, SDF_W, SDF_H, FMT.RGBA16F, { linear: true });

    // 集計のための段々（ブロック → 1テクセル）
    this.levels = [];
    let bw = blockW, bh = blockH;
    while (bw > 1 || bh > 1) {
      const fx = Math.min(8, bw), fy = Math.min(8, bh);
      bw = Math.ceil(bw / fx); bh = Math.ceil(bh / fy);
      const w = tilesX * bw, h = tilesY * bh;
      const t0 = makeTex(gl, w, h, FMT.RGBA32F), t1 = makeTex(gl, w, h, FMT.RGBA32F);
      this.levels.push({ fx, fy, w, h, t: [t0, t1], fbo: makeFBO(gl, [t0, t1]) });
    }

    this.stepN = 0;
    this.seed = 1;
    this.cfg = null;
    this.layout = null;
    this.beacon = [0.5, 0.75];
    this.moon = [1, 0, 0, 0];
    this.moonS = 1;
    this.rows = new Float32Array(this.K * ROW_FLOATS);
  }

  dispose() {
    const gl = this.gl;
    this.state.dispose(); this.field.dispose(); this.pred.dispose();
    gl.deleteTexture(this.depTex); gl.deleteFramebuffer(this.depFBO);
    gl.deleteTexture(this.wTex); gl.deleteTexture(this.envTex);
    for (const l of this.levels) { l.t.forEach((t) => gl.deleteTexture(t)); gl.deleteFramebuffer(l.fbo); }
  }

  // 試練の環境をセット（壁の SDF もここで送る）
  setStage(cfg) {
    this.cfg = cfg;
    if (cfg.env && cfg.env !== this._envRef) {
      uploadTex(this.gl, this.envTex, cfg.env);
      this._envRef = cfg.env;
    }
  }

  setLayout(layout) { this.layout = layout; }

  // rows: K 本の Float32Array(ROW_FLOATS)、または1本（全世界に同じ本能）
  setRows(rows) {
    for (let k = 0; k < this.K; k++) {
      const r = rows[Math.min(k, rows.length - 1)];
      this.rows.set(r, k * ROW_FLOATS);
    }
    uploadTex(this.gl, this.wTex, this.rows);
  }

  _layoutUniforms(pr) {
    pr.set('uBlock', [this.blockW, this.blockH])
      .set('uTiles', [this.tilesX, this.tilesY])
      .set('uWorld', [WORLD_W, WORLD_H])
      .set('uGrid', [GRID_X, GRID_Y])
      .set('uAtlas', [this.atlasW, this.atlasH]);
  }

  _patchUniforms(pr) {
    const patches = this.cfg.patches || [];
    const arr = new Float32Array(32);
    patches.slice(0, 8).forEach((q, i) => arr.set(q, i * 4));
    pr.set('uPatch', arr).set('uNPatch', Math.min(8, patches.length));
  }

  reset(seed = 1) {
    const gl = this.gl;
    const cfg = this.cfg;
    this.seed = seed >>> 0;
    this.stepN = 0;
    gl.disable(gl.BLEND);
    // 粒子
    const pi = this.prog.init.use();
    this._layoutUniforms(pi);
    pi.tex('uEnv', this.envTex)
      .set('uSeed', this.seed % 1000000)
      .set('uSpawn', cfg.spawn)
      .set('uEnergy0', cfg.energy0);
    bindTarget(gl, this.state.writeFBO);
    drawFull(gl);
    this.state.swap();
    // 場
    const pf = this.prog.fieldInit.use();
    this._layoutUniforms(pf);
    this._patchUniforms(pf);
    pf.set('uFill', cfg.foodFill ?? 1.0);
    bindTarget(gl, this.field.writeFBO);
    drawFull(gl);
    this.field.swap();
    // 捕食者
    const pd = new Float32Array(S.NPRED * this.K * 4);
    const spawns = cfg.predSpawns || [];
    for (let k = 0; k < this.K; k++) {
      for (let i = 0; i < S.NPRED; i++) {
        const sp = spawns[i % Math.max(1, spawns.length)] || [0.5, 0.75, 0, 0];
        pd.set([sp[0], sp[1], sp[2] || 0, sp[3] || 0], (k * S.NPRED + i) * 4);
      }
    }
    uploadTex(gl, this.pred.read[0], pd);
    if (this.onReset) this.onReset();
  }

  setPredators(list) {
    // list: [[x,y,vx,vy], ...] を全世界に（本番で指で動かすとき用）
    const pd = new Float32Array(S.NPRED * this.K * 4);
    for (let k = 0; k < this.K; k++) list.slice(0, S.NPRED).forEach((q, i) => pd.set(q, (k * S.NPRED + i) * 4));
    uploadTex(this.gl, this.pred.read[0], pd);
  }

  // 1匹の捕食者を動かす（本番で指でつかんだとき）
  setPredator(i, x, y, vx = 0, vy = 0, world = 0) {
    uploadTex(this.gl, this.pred.read[0], new Float32Array([x, y, vx, vy]), i, world, 1, 1);
  }

  // 餌場を置く
  stampFood(x, y, r = 0.1, amount = 1, world = -1) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    const p = this.prog.stamp.use();
    this._layoutUniforms(p);
    p.tex('uField', this.field.read[0]).set('uStamp', [x, y, r, amount]).set('uWorldIdx', world);
    bindTarget(gl, this.field.writeFBO);
    drawFull(gl);
    this.field.swap();
  }

  readPredators() {
    return readFloat(this.gl, this.pred.readFBO, 0, 0, S.NPRED, this.K);
  }

  step(n = 1) {
    for (let i = 0; i < n; i++) this._step();
  }

  _envUniforms(pr) {
    const c = this.cfg;
    pr.tex('uEnv', this.envTex)
      .tex('uPred', this.pred.read[0])
      .set('uPredP', c.predP)
      .set('uLight', c.light)
      .set('uBeacon', this.beacon)
      .set('uFlow', c.flow)
      .set('uStep', this.stepN)
      .set('uMoon', this.moon);
  }

  // 月のリズム（0..1）。cfg.moon = { period, sharp, weight }
  moonAt(t) {
    const m = this.cfg.moon;
    if (!m) return 1;
    const ph = (t / m.period + (m.phase || 0)) % 1;
    const s = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
    return Math.pow(s, m.sharp || 1);
  }

  _step() {
    const gl = this.gl;
    const c = this.cfg;
    const L = this.layout;
    if (this.beaconPath) this.beacon = this.beaconPath(this.stepN);
    if (c.moon) {
      const sm = this.moonAt(this.stepN);
      this.moonS = sm;
      this.moon = [c.moon.floor + (1 - c.moon.floor) * sm, c.moon.weight, sm - (c.moon.mean ?? 0.5), 0];
    } else {
      this.moonS = 1;
      this.moon = [1, 0, 0, 0];
    }
    gl.disable(gl.BLEND);

    // 1) 粒子の更新
    const pu = this.prog.update.use();
    this._layoutUniforms(pu);
    const st = this.state.read;
    pu.tex('uA', st[0]).tex('uB', st[1]).tex('uC', st[2])
      .tex('uField', this.field.read[0])
      .tex('uW', this.wTex);
    this._envUniforms(pu);
    pu.set('uSeed', this.seed % 1000000)
      .set('uMaskE', L.maskE).set('uMaskO', L.maskO).set('uOutMask', L.outMask)
      .set('uHidden', L.hidden)
      .set('uPhys', c.phys).set('uSensor', c.sensor).set('uEnergy', c.energy)
      .set('uFoodP', c.foodP).set('uRew', c.rew).set('uRew2', c.rew2)
      .set('uHeat', c.heat || [0, 0, 1, 0])
      .set('uDefense', c.defense || [0, 0, 0, 0]);
    bindTarget(gl, this.state.writeFBO);
    drawFull(gl);
    this.state.swap();

    // 2) 場へ落とす
    bindTarget(gl, this.depFBO);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    const pdp = this.prog.deposit.use();
    this._layoutUniforms(pdp);
    const st2 = this.state.read;
    const cells = GRID_X * GRID_Y;
    pdp.tex('uA', st2[0]).tex('uB', st2[1]).tex('uC', st2[2])
      .set('uPTex', [this.ptW, this.ptH])
      .set('uDepW', [cells / this.P, P_REF / this.P, cells / this.P]);
    drawPoints(gl, this.N);
    gl.disable(gl.BLEND);

    // 3) 場の更新
    const pf = this.prog.field.use();
    this._layoutUniforms(pf);
    pf.tex('uField', this.field.read[0]).tex('uDep', this.depTex)
      .set('uGlowP', c.glowP).set('uFoodR', c.foodR);
    bindTarget(gl, this.field.writeFBO);
    drawFull(gl);
    this.field.swap();

    // 4) 捕食者
    if (c.predP[0] > 0) {
      const pp = this.prog.pred.use();
      this._layoutUniforms(pp);
      pp.tex('uPred', this.pred.read[0]).tex('uField', this.field.read[0]).tex('uEnv', this.envTex)
        .set('uPredP', c.predP).set('uPredM', c.predM)
        .set('uStep', this.stepN).set('uSeed', this.seed % 1000000);
      bindTarget(gl, this.pred.writeFBO);
      drawFull(gl);
      this.pred.swap();
    }
    this.stepN++;
  }

  // 世界ごとの合計: B = (Σ元気, Σいまの発光, Σ食べた量, Σ出口にいる)、C = (生きている数, ごほうび合計, Σ発光×月, Σ発光)
  reduce() {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    const pr = this.prog.reduce.use();
    let s0 = this.state.read[1], s1 = this.state.read[2];
    for (const lv of this.levels) {
      pr.use();
      pr.tex('uS0', s0).tex('uS1', s1).set('uF', [lv.fx, lv.fy]);
      bindTarget(gl, lv.fbo);
      drawFull(gl);
      s0 = lv.t[0]; s1 = lv.t[1];
    }
    const last = this.levels[this.levels.length - 1];
    const B = readFloat(gl, last.fbo, 0, 0, this.tilesX, this.tilesY, 0);
    const C = readFloat(gl, last.fbo, 0, 0, this.tilesX, this.tilesY, 1);
    return { B, C };
  }

  // 1つの世界の粒子をいくつか読む（解析用）
  readParticles(world = 0, n = 256) {
    const gl = this.gl;
    const tx = world % this.tilesX, ty = Math.floor(world / this.tilesX);
    const w = Math.min(this.blockW, 16), h = Math.min(this.blockH, Math.ceil(n / w));
    const x = tx * this.blockW, y = ty * this.blockH;
    const out = [];
    for (let a = 0; a < 3; a++) out.push(readFloat(gl, this.state.readFBO, x, y, w, h, a));
    return { A: out[0], B: out[1], C: out[2], n: w * h };
  }
}
