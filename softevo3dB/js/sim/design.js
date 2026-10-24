// 設計図を扱う道具（左右対称のコピー・複製・正規化・検査）
// 設計図の形式は model.js の先頭の説明を参照

import * as V from './vec.js';
import { compileModel, normalizeLim, JOINT_TYPES } from './model.js';

export const DESIGN_VERSION = 1;

export function cloneDesign(d) { return JSON.parse(JSON.stringify(d)); }

let seq = 0;
export function newBoneId(design, base = 'b') {
  const ids = new Set(design.bones.map(b => b.id));
  let id;
  do { id = `${base}${(++seq).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`; } while (ids.has(id));
  return id;
}

// 骨の左右（中心線からの位置）: +1 右, -1 左, 0 中心
export function sideOf(bone) {
  const z = ((bone.j || bone.a)[2] + bone.a[2] + bone.b[2]) / 3;
  return z > 0.004 ? 1 : z < -0.004 ? -1 : 0;
}

// 右側（z>0）の骨から左側の相方を作る（親が左右の骨なら、その相方につなぐ）
// bones は「右側と中心」だけ書いておけばよい。id の末尾 R → L
export function withMirrors(bones) {
  const out = bones.map(b => ({ ...b }));
  const map = new Map();
  for (const b of bones) if (sideOf(b) > 0) map.set(b.id, b.id.endsWith('R') ? b.id.slice(0, -1) + 'L' : b.id + '_m');
  for (const b of bones) {
    if (!map.has(b.id)) continue;
    const m = {
      ...JSON.parse(JSON.stringify(b)), id: map.get(b.id),
      parent: map.has(b.parent) ? map.get(b.parent) : b.parent,
      a: V.mirrorP(b.a), b: V.mirrorP(b.b), mirror: b.id,
    };
    if (b.j) m.j = V.mirrorP(b.j);
    if (b.name) m.name = b.name.replace('右', '左');
    out.find(x => x.id === b.id).mirror = m.id;
    out.push(m);
  }
  return out;
}

// 相方の形を、一次側（先に並んでいる方）から鏡に映して合わせる
export function syncMirrors(design) {
  const byId = new Map(design.bones.map(b => [b.id, b]));
  const order = design.bones;
  for (let i = 0; i < order.length; i++) {
    const b = order[i];
    if (!b.mirror || !byId.has(b.mirror)) { delete b.mirror; continue; }
    const p = byId.get(b.mirror);
    if (order.indexOf(p) > i) continue;   // こちらが一次側
    b.a = V.mirrorP(p.a); b.b = V.mirrorP(p.b);
    if (p.j) b.j = V.mirrorP(p.j); else delete b.j;
    b.r = p.r; b.shape = p.shape; b.w = p.w; b.dens = p.dens;
    b.joint = p.joint ? JSON.parse(JSON.stringify(p.joint)) : undefined;
    if (b.joint) delete b.joint.lim;   // 可動域は組み立て時に鏡に映して計算
    if (p.joint && p.joint.lim) b.joint.lim = JSON.parse(JSON.stringify(p.joint.lim));
  }
  return design;
}

// 設計図の全体を、いちばん下が y=0 に来るように持ち上げる・左右中央に寄せる
export function grounded(design) {
  const m = compileModel(design);
  const dy = -m.minY;
  for (const b of design.bones) {
    b.a = [b.a[0], b.a[1] + dy, b.a[2]];
    b.b = [b.b[0], b.b[1] + dy, b.b[2]];
    if (b.j) b.j = [b.j[0], b.j[1] + dy, b.j[2]];
  }
  return design;
}

// 受け取ったデータの検査と正規化（オンラインで受け取ったものは信用しない）
export function sanitizeDesign(d) {
  if (!d || !Array.isArray(d.bones)) return null;
  const bones = [];
  for (const b of d.bones.slice(0, 40)) {
    if (!b || typeof b.id !== 'string') return null;
    const p3 = (p) => Array.isArray(p) && p.length === 3 && p.every(v => Number.isFinite(v) && Math.abs(v) < 5) ? p.map(Number) : null;
    const a = p3(b.a), bb = p3(b.b), j = b.j ? p3(b.j) : null;
    if (!a || !bb || (b.j && !j)) return null;
    const type = JOINT_TYPES[b.joint && b.joint.type] ? b.joint.type : 'hinge';
    const nb = {
      id: b.id.slice(0, 24), parent: typeof b.parent === 'string' ? b.parent.slice(0, 24) : null,
      a, b: bb, r: Math.max(0.008, Math.min(0.4, +b.r || 0.03)),
      shape: b.shape === 'box' ? 'box' : 'capsule',
      dens: Math.max(0.2, Math.min(4, +b.dens || 1)),
    };
    if (j) nb.j = j;
    if (nb.shape === 'box') nb.w = Math.max(0.016, Math.min(0.8, +b.w || 0.08));
    if (typeof b.mirror === 'string') nb.mirror = b.mirror.slice(0, 24);
    if (typeof b.name === 'string') nb.name = b.name.slice(0, 12);
    if (b.sense) nb.sense = true;
    if (nb.parent) {
      nb.joint = { type, lim: normalizeLim(type, b.joint && b.joint.lim) };
      if (b.joint && Number.isFinite(b.joint.arm)) nb.joint.arm = Math.max(0.008, Math.min(0.15, b.joint.arm));
      if (b.joint && Number.isFinite(b.joint.str)) nb.joint.str = Math.max(0.1, Math.min(8, b.joint.str));
    }
    bones.push(nb);
  }
  const out = { v: DESIGN_VERSION, name: typeof d.name === 'string' ? d.name.slice(0, 12) : '', bones };
  if (d.muscles && typeof d.muscles === 'object') {
    out.muscles = { str: Math.max(0.2, Math.min(4, +d.muscles.str || 1)) };
    if (Array.isArray(d.muscles.extra)) {
      out.muscles.extra = d.muscles.extra.slice(0, 16).filter(x => x && typeof x.from === 'string' && typeof x.to === 'string').map(x => ({
        id: String(x.id || '').slice(0, 24), from: x.from.slice(0, 24), to: x.to.slice(0, 24),
        f: Math.max(0.1, Math.min(4, +x.f || 1)), sides: Array.isArray(x.sides) ? x.sides.slice(0, 8).map(s => (s < 0 ? -1 : 1)) : undefined,
        name: typeof x.name === 'string' ? x.name.slice(0, 12) : undefined,
      }));
    }
    if (d.muscles.off && typeof d.muscles.off === 'object') {
      out.muscles.off = {};
      for (const k of Object.keys(d.muscles.off).slice(0, 200)) if (d.muscles.off[k]) out.muscles.off[k.slice(0, 40)] = true;
    }
  }
  try { compileModel(out); } catch (e) { return null; }
  return out;
}
