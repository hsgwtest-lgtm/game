// 設計図の編集（画面の操作から呼ぶ、純粋な関数たち）
//   どれも design を直接書きかえる。左右対称モードでは、編集した側から相方へ形をうつす。
import * as V from './vec.js';
import { MAX_BONES, DEFAULT_LIM } from './model.js';
import { newBoneId, sideOf } from './design.js';

export const byId = (d, id) => d.bones.find(b => b.id === id) || null;
export const childrenOf = (d, id) => d.bones.filter(b => b.parent === id);
export function subtreeIds(d, id) {
  const out = [id];
  for (let k = 0; k < out.length; k++) for (const c of d.bones) if (c.parent === out[k]) out.push(c.id);
  return out;
}
export const rootOf = (d) => d.bones.find(b => !b.parent);

function closestT(a, b, p) {
  const ab = V.sub(b, a), l2 = V.dot(ab, ab);
  if (l2 < 1e-12) return 0;
  return Math.max(0, Math.min(1, V.dot(V.sub(p, a), ab) / l2));
}
function translateBone(b, d) {
  b.a = V.add(b.a, d); b.b = V.add(b.b, d);
  if (b.j) b.j = V.add(b.j, d);
}
const r4 = (p) => p.map(v => Math.round(v * 10000) / 10000);
function tidy(b) { b.a = r4(b.a); b.b = r4(b.b); if (b.j) b.j = r4(b.j); }

// 相方へ形をうつす（ids の骨を「元」として）
export function mirrorFrom(d, ids) {
  for (const id of ids) {
    const s = byId(d, id);
    if (!s || !s.mirror) continue;
    const m = byId(d, s.mirror);
    if (!m) { delete s.mirror; continue; }
    m.a = V.mirrorP(s.a); m.b = V.mirrorP(s.b);
    if (s.j) m.j = V.mirrorP(s.j); else delete m.j;
    m.r = s.r; m.shape = s.shape; m.w = s.w; m.dens = s.dens;
    if (s.joint) {
      m.joint = JSON.parse(JSON.stringify(s.joint));
    }
  }
}

// 骨の終わり（b）を動かす。子は、つながっている位置に応じて一緒に動く（根もとに近い子ほど動かない）
export function moveEnd(d, id, p, mirror = true) {
  const bone = byId(d, id);
  if (!bone) return;
  const old = bone.b.slice();
  const delta = V.sub(p, old);
  const moved = [id];
  for (const c of childrenOf(d, id)) {
    const t = closestT(bone.a, old, c.j || c.a);
    const sh = V.scale(delta, t);
    for (const sid of subtreeIds(d, c.id)) { translateBone(byId(d, sid), sh); moved.push(sid); }
  }
  bone.b = p.slice();
  if (!bone.parent) { /* 胴の形 */ }
  for (const sid of moved) tidy(byId(d, sid));
  if (mirror) mirrorFrom(d, moved);
}

// 骨の始まり（a・関節）を動かす。根もとの骨以外は、骨と子孫をまるごと平行移動。
// 関節は親の骨の表面から離れすぎないようにする
export function moveStart(d, id, p, mirror = true) {
  const bone = byId(d, id);
  if (!bone) return;
  if (!bone.parent) {
    const old = bone.a.slice();
    const delta = V.sub(p, old);
    const moved = [id];
    for (const c of childrenOf(d, id)) {
      const t = 1 - closestT(old, bone.b, c.j || c.a);
      const sh = V.scale(delta, t);
      for (const sid of subtreeIds(d, c.id)) { translateBone(byId(d, sid), sh); moved.push(sid); }
    }
    bone.a = p.slice();
    for (const sid of moved) tidy(byId(d, sid));
    if (mirror) mirrorFrom(d, moved);
    return;
  }
  const par = byId(d, bone.parent);
  // 親の骨の上の点に寄せる
  const t = closestT(par.a, par.b, p);
  const onAxis = V.lerp(par.a, par.b, t);
  let off = V.sub(p, onAxis);
  const lim = (par.shape === 'box' ? Math.max(par.r, (par.w || 0) / 2) : par.r) * 1.05;
  const ol = V.len(off);
  if (ol > lim) off = V.scale(off, lim / ol);
  const target = V.add(onAxis, off);
  const delta = V.sub(target, bone.j || bone.a);
  const ids = subtreeIds(d, id);
  for (const sid of ids) { translateBone(byId(d, sid), delta); tidy(byId(d, sid)); }
  if (mirror) mirrorFrom(d, ids);
}

// 新しい骨をのばす（from → to）。左右対称モードで中心から外れたら、反対側にも作る
export function addBone(d, parentId, from, to, { mirror = true, r = null } = {}) {
  if (d.bones.length >= MAX_BONES) return null;
  const par = byId(d, parentId);
  if (!par) return null;
  const n = d.bones.length + 1;
  const rr = r || Math.max(0.01, Math.min(0.05, par.r * 0.7));
  const type = par.parent ? 'hinge' : 'ball';
  const bone = {
    id: newBoneId(d, 'b'), name: `骨${n}`, parent: parentId,
    j: r4(from), a: r4(from), b: r4(to), r: Math.round(rr * 1000) / 1000,
    joint: { type, lim: DEFAULT_LIM[type].map(x => x.slice()) },
  };
  d.bones.push(bone);
  const side = sideOf(bone);
  if (mirror && side !== 0 && d.bones.length < MAX_BONES) {
    const mp = par.mirror ? par.mirror : (sideOf(par) === 0 ? parentId : null);
    if (mp) {
      const m = {
        ...JSON.parse(JSON.stringify(bone)), id: newBoneId(d, 'b'), parent: mp,
        a: V.mirrorP(bone.a), b: V.mirrorP(bone.b), j: V.mirrorP(bone.j), mirror: bone.id,
      };
      bone.mirror = m.id;
      bone.name = (side > 0 ? '右' : '左') + bone.name;
      m.name = (side > 0 ? '左' : '右') + `骨${n}`;
      d.bones.push(m);
    }
  }
  return bone;
}

export function deleteBone(d, id, mirror = true) {
  const bone = byId(d, id);
  if (!bone || !bone.parent) return false;
  const kill = new Set(subtreeIds(d, id));
  if (mirror && bone.mirror && byId(d, bone.mirror)) for (const x of subtreeIds(d, bone.mirror)) kill.add(x);
  d.bones = d.bones.filter(b => !kill.has(b.id));
  for (const b of d.bones) if (b.mirror && kill.has(b.mirror)) delete b.mirror;
  if (d.muscles && d.muscles.extra) d.muscles.extra = d.muscles.extra.filter(x => !kill.has(x.from) && !kill.has(x.to));
  return true;
}

// 太さ・形・関節などを変える
export function setBone(d, id, patch, mirror = true) {
  const bone = byId(d, id);
  if (!bone) return;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'joint') bone.joint = { ...(bone.joint || {}), ...v };
    else bone[k] = v;
  }
  if (mirror) mirrorFrom(d, [id]);
}

// 長さを変える（向きはそのまま）
export function setLength(d, id, L, mirror = true) {
  const bone = byId(d, id);
  if (!bone) return;
  let dir = V.sub(bone.b, bone.a);
  const l = V.len(dir);
  dir = l > 1e-6 ? V.scale(dir, 1 / l) : [0, -1, 0];
  moveEnd(d, id, V.add(bone.a, V.scale(dir, Math.max(0.005, L))), mirror);
}
export const boneLength = (b) => V.dist(b.a, b.b);

// 平衡感覚を置く骨（1つだけ）
export function setSense(d, id) { for (const b of d.bones) { if (b.id === id) b.sense = true; else delete b.sense; } }

// 左右の相方を作る（中心から外れた、相方のない骨）
export function makeMirror(d, id) {
  const bone = byId(d, id);
  if (!bone || bone.mirror || sideOf(bone) === 0) return null;
  const ids = subtreeIds(d, id);
  if (d.bones.length + ids.length > MAX_BONES) return null;
  const map = new Map();
  for (const sid of ids) map.set(sid, newBoneId(d, 'b'));
  const par = byId(d, bone.parent);
  const parentM = par && par.mirror ? par.mirror : bone.parent;
  for (const sid of ids) {
    const s = byId(d, sid);
    const m = {
      ...JSON.parse(JSON.stringify(s)), id: map.get(sid), parent: sid === id ? parentM : map.get(s.parent),
      a: V.mirrorP(s.a), b: V.mirrorP(s.b), mirror: sid,
      name: s.name.startsWith('右') ? '左' + s.name.slice(1) : s.name.startsWith('左') ? '右' + s.name.slice(1) : s.name + '′',
    };
    if (s.j) m.j = V.mirrorP(s.j);
    delete m.sense;
    s.mirror = m.id;
    d.bones.push(m);
  }
  return map.get(id);
}
