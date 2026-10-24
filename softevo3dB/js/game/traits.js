// 体の特徴を読みとる（名前の候補・物語の文・図鑑の説明に使う）
import { compileModel } from '../sim/model.js';

export const SPECIES_COLORS = [0xd9a58c, 0x8fb3d9, 0x9bc48a, 0xe0c068, 0xc98fd0, 0x7fd1c4, 0xe38b6f, 0xa8a0e0, 0xd4d08a, 0x88c2a8, 0xe0a0b0, 0x9fb0c0];

// 体の数え方
export function bodyStats(model) {
  const B = model.bodies;
  const H = model.size.h;
  const nearG = (b) => b.lowY < model.minY + Math.max(0.02, 0.08 * H);
  // 脚 = 地面に届く「先端の骨」の数（同じ脚の中では一番先だけ。胴より下へ伸びているものだけ）
  let legs = 0;
  const rootLow = B[0].lowY;
  for (const b of B) {
    if (b.i === 0 || !nearG(b)) continue;
    if (b.children.some(ci => nearG(B[ci]))) continue;
    if (b.mirror < 0 && b.lowY > rootLow - 0.3 * B[0].r) continue;
    legs++;
  }
  // 腕 = 左右の相方がいて、地面に届かない末端の枝
  let arms = 0;
  for (const b of B) if (b.mirror >= 0 && b.children.length === 0 && !nearG(b) && b.i !== 0) arms++;
  // しっぽ: 胴より後ろの、中心線上の枝
  const root = B[0];
  const tail = B.some(b => b.parent === 0 && Math.abs(b.c[2]) < 0.01 && b.c[0] < root.c[0] - 0.05 && !nearG(b));
  const tallness = H / Math.max(0.05, model.size.x);
  let muscles = model.muscles.length;
  let mobile = 0;
  for (const j of model.joints) if (j.type !== 'fixed') mobile++;
  return {
    bones: B.length, legs, arms, tail, H, L: model.size.x, mass: model.mass, tallness, muscles, joints: mobile, dofs: model.nDof,
    upright: tallness > 1.4 && legs === 2,
  };
}

// 体の形の呼び名
export function planName(st) {
  if (st.legs === 0) return st.L > 3 * st.H ? 'ほそ長い体' : '足のない体';
  if (st.legs === 2) return st.upright ? '直立の二本足' : '二本足';
  return `${st.legs}本足`;
}

const PRE = { 0: 'ヒレ', 1: 'イッポン', 2: 'フタアシ', 3: 'ミツアシ', 4: 'ヨツアシ', 5: 'イツアシ', 6: 'ムツアシ', 7: 'ナナアシ', 8: 'ヤツアシ' };
// 名前の候補
export function suggestName(model, habitat = 'land', seed = 0) {
  const st = bodyStats(model);
  const r = (n) => (Math.abs(Math.floor(seed * 9301 + 49297)) % 233280) % n;
  let pre = PRE[st.legs] || 'タアシ';
  if (st.legs === 0 && habitat !== 'water') pre = 'ニョロ';
  const adj = [];
  if (st.H > 1.2) adj.push('オオ');
  else if (st.H < 0.15) adj.push('チビ');
  if (st.tallness > 2.2) adj.push('セタカ');
  if (st.L > 2.5 * st.H && st.legs > 0) adj.push('ナガ');
  if (st.tail && st.legs > 0) adj.push('オナガ');
  let suf;
  if (st.legs === 0) suf = habitat === 'water' ? 'ウオ' : 'ムシ';
  else if (st.legs >= 6) suf = 'ムシ';
  else if (st.upright) suf = ['ビト', 'ヒト', 'ジン'][r(3)];
  else if (st.legs === 2) suf = st.tail ? 'リュウ' : 'ドリ';
  else if (st.legs === 4) suf = st.H < 0.25 ? 'トカゲ' : 'ケモノ';
  else suf = 'モドキ';
  const a = adj.length ? adj[r(adj.length)] : '';
  let name = a + pre + suf;
  if (name.length > 10) name = (a || '') + suf;
  return name.slice(0, 12);
}

// 親から子へ、体がどう変わったか（物語の文）
export function describeChange(pm, cm) {
  const a = bodyStats(pm), b = bodyStats(cm);
  const out = [];
  if (b.legs > a.legs) out.push(`足が${b.legs - a.legs}本ふえた`);
  if (b.legs < a.legs) out.push(b.legs === 0 ? '足をなくした' : `足が${a.legs - b.legs}本へった`);
  if (b.arms > a.arms) out.push('腕ができた');
  if (b.arms < a.arms && b.arms === 0) out.push('腕をなくした');
  if (b.tail && !a.tail) out.push('しっぽがのびた');
  if (!b.tail && a.tail) out.push('しっぽをなくした');
  const hr = b.H / a.H;
  if (hr > 1.25) out.push(`背が${hr.toFixed(1)}倍になった`);
  else if (hr < 0.8) out.push('背が低くなった');
  const mr = b.mass / a.mass;
  if (mr > 1.4) out.push('体が重くなった');
  else if (mr < 0.7) out.push('体が軽くなった');
  if (b.joints > a.joints + 1) out.push('関節がふえた');
  if (!out.length && b.bones !== a.bones) out.push(`骨が${b.bones > a.bones ? 'ふえた' : 'へった'}`);
  if (!out.length) out.push('体のつくりはそのまま');
  return out;
}

export function modelOf(design) { return compileModel(design); }
