// ロボの「脳」: 小さなニューラルネット（多層パーセプトロン）。
//   観察 259 → 64 (ReLU) → 64 (ReLU) → 行動6つの好み（方策） ＋ 期待できるごほうび（価値）
// 重みは1本の Float32Array にまとめて持つ。1層目は「入力×出力」の向きで並べ、
// 0 の入力（何もないマス）を飛ばして速く計算する。
// forward は四則演算と ReLU だけ → どの端末でも同じ結果（オンライン対戦の同期に必要）。

import { OBS_N, N_ACT } from '../sim/env.js';

export const ARCH = { nIn: OBS_N, h1: 64, h2: 64, nAct: N_ACT };
export const BRAIN_VERSION = 1;

export class Net {
  constructor(arch = ARCH) {
    const { nIn, h1, h2, nAct } = arch;
    this.arch = { nIn, h1, h2, nAct };
    let o = 0;
    this.oW1 = o; o += nIn * h1;
    this.oB1 = o; o += h1;
    this.oW2 = o; o += h1 * h2;
    this.oB2 = o; o += h2;
    this.oWp = o; o += h2 * nAct;
    this.oBp = o; o += nAct;
    this.oWv = o; o += h2;
    this.oBv = o; o += 1;
    this.size = o;
    this.p = new Float32Array(o);
    this.h1 = new Float64Array(h1);
    this.h2 = new Float64Array(h2);
    // 区切り（量子化・可視化用）: [開始, 長さ, 名前]
    this.tensors = [
      [this.oW1, nIn * h1, 'W1'], [this.oB1, h1, 'b1'],
      [this.oW2, h1 * h2, 'W2'], [this.oB2, h2, 'b2'],
      [this.oWp, h2 * nAct, 'Wp'], [this.oBp, nAct, 'bp'],
      [this.oWv, h2, 'Wv'], [this.oBv, 1, 'bv'],
    ];
  }

  // 重みの初期値（学習の最初だけ。端末差があってもよい）
  init(rng) {
    const { nIn, h1, h2, nAct } = this.arch;
    const p = this.p;
    const g1 = Math.sqrt(2 / nIn) * 0.8, g2 = Math.sqrt(2 / h1);
    for (let i = 0; i < nIn * h1; i++) p[this.oW1 + i] = rng.normal() * g1;
    for (let i = 0; i < h1 * h2; i++) p[this.oW2 + i] = rng.normal() * g2;
    for (let i = 0; i < h2 * nAct; i++) p[this.oWp + i] = rng.normal() * 0.01;
    for (let i = 0; i < h2; i++) p[this.oWv + i] = rng.normal() * Math.sqrt(1 / h2);
    for (let i = 0; i < h1; i++) p[this.oB1 + i] = 0.01;
    for (let i = 0; i < h2; i++) p[this.oB2 + i] = 0.01;
    for (let i = 0; i < nAct; i++) p[this.oBp + i] = 0;
    p[this.oBv] = 0;
    return this;
  }

  copyFrom(net) { this.p.set(net.p); return this; }
  clone() { return new Net(this.arch).copyFrom(this); }

  // 1つの観察 x（xo から nIn 個）から、行動の好み logits と価値を出す
  forward(x, logits, xo = 0) {
    const { nIn, h1, h2, nAct } = this.arch;
    const p = this.p, H1 = this.h1, H2 = this.h2;
    for (let j = 0; j < h1; j++) H1[j] = p[this.oB1 + j];
    for (let k = 0; k < nIn; k++) {
      const xv = x[xo + k];
      if (xv === 0) continue;
      const wo = this.oW1 + k * h1;
      for (let j = 0; j < h1; j++) H1[j] += xv * p[wo + j];
    }
    for (let j = 0; j < h1; j++) if (H1[j] < 0) H1[j] = 0;
    for (let j = 0; j < h2; j++) H2[j] = p[this.oB2 + j];
    for (let i = 0; i < h1; i++) {
      const hv = H1[i];
      if (hv === 0) continue;
      const wo = this.oW2 + i * h2;
      for (let j = 0; j < h2; j++) H2[j] += hv * p[wo + j];
    }
    for (let j = 0; j < h2; j++) if (H2[j] < 0) H2[j] = 0;
    for (let a = 0; a < nAct; a++) logits[a] = p[this.oBp + a];
    let v = p[this.oBv];
    for (let j = 0; j < h2; j++) {
      const hv = H2[j];
      if (hv === 0) continue;
      const wo = this.oWp + j * nAct;
      for (let a = 0; a < nAct; a++) logits[a] += hv * p[wo + a];
      v += hv * p[this.oWv + j];
    }
    return v;
  }
}

// ── 保存・送信用の形 ──

function f32ToB64(f) {
  const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToU8(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

// 全精度（端末に保存する用）
export function packFull(net) {
  return { v: BRAIN_VERSION, a: [net.arch.nIn, net.arch.h1, net.arch.h2, net.arch.nAct], f: f32ToB64(net.p) };
}
export function unpackFull(o) {
  const net = new Net(archFrom(o.a));
  const u8 = b64ToU8(o.f);
  if (u8.length !== net.size * 4) throw new Error('brain size mismatch');
  net.p.set(new Float32Array(u8.buffer, 0, net.size));
  return net;
}

function archFrom(a) {
  if (!Array.isArray(a) || a[0] !== ARCH.nIn || a[1] !== ARCH.h1 || a[2] !== ARCH.h2 || a[3] !== ARCH.nAct) throw new Error('brain arch mismatch');
  return ARCH;
}

// 8bit に圧縮（オンラインで送る・CPUボスを持ち歩く用）。区切りごとに倍率を持つ
export function packQ8(net) {
  const scales = [];
  const q = new Int8Array(net.size);
  for (const [o, n] of net.tensors) {
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(net.p[o + i]));
    const s = Math.fround(mx > 0 ? mx / 127 : 1);
    scales.push(s);
    for (let i = 0; i < n; i++) q[o + i] = Math.max(-127, Math.min(127, Math.round(net.p[o + i] / s)));
  }
  const u8 = new Uint8Array(q.buffer);
  let str = '';
  for (let i = 0; i < u8.length; i += 0x8000) str += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { v: BRAIN_VERSION, a: [net.arch.nIn, net.arch.h1, net.arch.h2, net.arch.nAct], s: scales, q: btoa(str) };
}

export function unpackQ8(o) {
  if (!o || typeof o.q !== 'string' || !Array.isArray(o.s)) throw new Error('bad brain');
  const net = new Net(archFrom(o.a));
  if (o.s.length !== net.tensors.length) throw new Error('bad scales');
  const u8 = b64ToU8(o.q);
  if (u8.length !== net.size) throw new Error('brain size mismatch');
  const q = new Int8Array(u8.buffer);
  net.tensors.forEach(([off, n], ti) => {
    const s = Math.fround(Number(o.s[ti]));
    if (!Number.isFinite(s) || s <= 0 || s > 100) throw new Error('bad scale');
    for (let i = 0; i < n; i++) net.p[off + i] = q[off + i] * s;
  });
  return net;
}

// 8bit にしてから戻した脳（オンライン対戦では両端末ともこれを使う）
export function quantizedCopy(net) { return unpackQ8(packQ8(net)); }

// ── 通信用（バイナリを base64 に）: 'NB' + 版 + 形 + 区切りごとの倍率(float32) + 8bitの重み ──
// 倍率も float32 のバイトのまま送るので、受け取った側でもビット単位で同じ脳になる。
export function toWire(net) {
  const nT = net.tensors.length;
  const head = 4 + 8 + nT * 4;
  const buf = new ArrayBuffer(head + net.size);
  const dv = new DataView(buf);
  dv.setUint8(0, 78); dv.setUint8(1, 66); dv.setUint8(2, BRAIN_VERSION); dv.setUint8(3, nT);
  dv.setUint16(4, net.arch.nIn, true); dv.setUint16(6, net.arch.h1, true);
  dv.setUint16(8, net.arch.h2, true); dv.setUint16(10, net.arch.nAct, true);
  const q = new Int8Array(buf, head);
  net.tensors.forEach(([o, n], ti) => {
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(net.p[o + i]));
    const s = Math.fround(mx > 0 ? mx / 127 : 1);
    dv.setFloat32(12 + ti * 4, s, true);
    for (let i = 0; i < n; i++) q[o + i] = Math.max(-127, Math.min(127, Math.round(net.p[o + i] / s)));
  });
  const u8 = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < u8.length; i += 0x8000) str += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(str);
}

export function fromWire(b64) {
  if (typeof b64 !== 'string' || b64.length > 200000) throw new Error('bad wire');
  const u8 = b64ToU8(b64);
  const dv = new DataView(u8.buffer);
  if (u8.length < 12 || dv.getUint8(0) !== 78 || dv.getUint8(1) !== 66) throw new Error('bad wire');
  const nT = dv.getUint8(3);
  const a = [dv.getUint16(4, true), dv.getUint16(6, true), dv.getUint16(8, true), dv.getUint16(10, true)];
  const net = new Net(archFrom(a));
  if (nT !== net.tensors.length) throw new Error('bad wire tensors');
  const head = 4 + 8 + nT * 4;
  if (u8.length !== head + net.size) throw new Error('bad wire size');
  const q = new Int8Array(u8.buffer, head, net.size);
  net.tensors.forEach(([off, n], ti) => {
    const s = dv.getFloat32(12 + ti * 4, true);
    if (!Number.isFinite(s) || s <= 0 || s > 100) throw new Error('bad wire scale');
    for (let i = 0; i < n; i++) net.p[off + i] = q[off + i] * s;
  });
  return net;
}
