// 本能（全員が共有する小さなニューラルネット）の形と、遺伝子（重み）の並べ方。
//
// 入力は「左右対称」に作ってある:
//   偶の入力 xe … 左右を入れかえても変わらない量（ここの強さ・前方との差・自分の状態）
//   奇の入力 xo … 左右を入れかえると符号が反転する量（左の触角 − 右の触角）
// 隠れ層は h = tanh(We·xe + Wo·xo + b) と、鏡に映した h' = tanh(We·xe − Wo·xo + b) を両方計算し、
//   旋回 = Σ v (h − h')      … 鏡に映すと逆向きに曲がる（奇関数）
//   ほかの出力 = Σ u (h + h') + c … 鏡に映しても同じ（偶関数）
// とする。こうすると「右の危険から逃げる」ことを覚えると「左の危険から逃げる」ことも同時に覚える。

export const NE = 20; // 偶の入力（4の倍数にそろえる）
export const NO = 8;  // 奇の入力
export const HMAX = 16; // 隠れ層の最大数

// 偶の入力の番号
export const E = {
  CROWD: 0, GLOW: 1, FOOD: 2, DANGER: 3, WALL: 4, LIGHT: 5,
  CROWD_F: 6, GLOW_F: 7, FOOD_F: 8, DANGER_F: 9, WALL_F: 10, LIGHT_F: 11,
  FLOW_F: 12, SPEED: 13, ENERGY: 14, M1: 15, M2: 16, OWNGLOW: 17,
};
// 奇の入力の番号
export const O = { CROWD: 0, GLOW: 1, FOOD: 2, DANGER: 3, WALL: 4, LIGHT: 5, FLOW: 6 };

// 出力（旋回は別あつかい）
export const OUT = { SPEED: 0, GLOW: 1, M1: 2, M2: 3 };

// 感覚器官 → 使う入力と出力
export const SENSES = {
  food:   { e: [E.FOOD, E.FOOD_F], o: [O.FOOD], out: [] },
  touch:  { e: [E.WALL, E.WALL_F], o: [O.WALL], out: [] },
  crowd:  { e: [E.CROWD, E.CROWD_F], o: [O.CROWD], out: [] },
  light:  { e: [E.LIGHT, E.LIGHT_F], o: [O.LIGHT], out: [] },
  vibe:   { e: [E.DANGER, E.DANGER_F], o: [O.DANGER], out: [] },
  glow:   { e: [E.GLOW, E.GLOW_F, E.OWNGLOW], o: [O.GLOW], out: [OUT.GLOW] },
  flow:   { e: [E.FLOW_F], o: [O.FLOW], out: [] },
  memory: { e: [E.M1, E.M2], o: [], out: [OUT.M1, OUT.M2] },
};
export const SENSE_ORDER = ['food', 'touch', 'crowd', 'light', 'vibe', 'glow', 'flow', 'memory'];
const ALWAYS_E = [E.SPEED, E.ENERGY];

// 重みテクスチャ1行（1つの世界の本能）の並び（4つずつ = 1テクセル）
export const TX = {
  HID: 0,                       // 隠れ層 j ごとに 7 テクセル（偶20 + 奇8）
  HB: HMAX * 7,                 // 隠れ層のバイアス
  TW: HMAX * 7 + HMAX / 4,      // 旋回の重み v
  OW: HMAX * 7 + HMAX / 2,      // 出力 k の重み（k ごとに HMAX/4 テクセル）
  OB: HMAX * 7 + HMAX / 2 + HMAX, // 出力のバイアス
  DE: HMAX * 7 + HMAX / 2 + HMAX + 1,      // 近道: 偶の入力 → 出力 k（k ごとに 5 テクセル）
  DT: HMAX * 7 + HMAX / 2 + HMAX + 1 + 20, // 近道: 奇の入力 → 旋回（2 テクセル）
};
export const ROW_TEXELS = TX.DT + 2;
export const ROW_FLOATS = ROW_TEXELS * 4;

export const idxWe = (j, i) => (TX.HID + j * 7) * 4 + i;
export const idxWo = (j, i) => (TX.HID + j * 7 + 5) * 4 + i;
export const idxHB = (j) => TX.HB * 4 + j;
export const idxTW = (j) => TX.TW * 4 + j;
export const idxOW = (k, j) => (TX.OW + k * (HMAX / 4)) * 4 + j;
export const idxOB = (k) => TX.OB * 4 + k;
export const idxDE = (k, i) => (TX.DE + k * 5) * 4 + i;
export const idxDT = (i) => TX.DT * 4 + i;

// どの感覚が使えるか・隠れ層が何個か から、進化させる重みの番号の一覧を作る
export function activeLayout(senses, hidden) {
  const eIn = new Set(ALWAYS_E);
  const oIn = new Set();
  const outs = new Set([OUT.SPEED]);
  for (const s of senses) {
    const d = SENSES[s];
    if (!d) continue;
    d.e.forEach((i) => eIn.add(i));
    d.o.forEach((i) => oIn.add(i));
    d.out.forEach((k) => outs.add(k));
  }
  const idx = [];
  const kind = []; // 0=入力重み 1=バイアス 2=出力重み 3=出力バイアス
  for (let j = 0; j < hidden; j++) {
    [...eIn].sort((a, b) => a - b).forEach((i) => { idx.push(idxWe(j, i)); kind.push(0); });
    [...oIn].sort((a, b) => a - b).forEach((i) => { idx.push(idxWo(j, i)); kind.push(0); });
    idx.push(idxHB(j)); kind.push(1);
    idx.push(idxTW(j)); kind.push(2);
    [...outs].sort((a, b) => a - b).forEach((k) => { idx.push(idxOW(k, j)); kind.push(2); });
  }
  [...outs].sort((a, b) => a - b).forEach((k) => { idx.push(idxOB(k)); kind.push(3); });
  // 近道（入力から出力へ直接）: 単純な反射は1つの重みで身につく
  [...outs].sort((a, b) => a - b).forEach((k) => {
    [...eIn].sort((a, b) => a - b).forEach((i) => { idx.push(idxDE(k, i)); kind.push(4); });
  });
  [...oIn].sort((a, b) => a - b).forEach((i) => { idx.push(idxDT(i)); kind.push(4); });
  // シェーダーで入力を0にするためのマスク
  const maskE = new Float32Array(NE);
  const maskO = new Float32Array(NO);
  eIn.forEach((i) => { maskE[i] = 1; });
  oIn.forEach((i) => { maskO[i] = 1; });
  const outMask = new Float32Array(4);
  outs.forEach((k) => { outMask[k] = 1; });
  return { idx: Int32Array.from(idx), kind: Uint8Array.from(kind), maskE, maskO, outMask, hidden, senses: [...senses] };
}

// 遺伝子（進化させる重みだけの短い配列）→ テクスチャ1行
export function genomeToRow(genome, layout, row = new Float32Array(ROW_FLOATS)) {
  row.fill(0);
  const { idx } = layout;
  for (let i = 0; i < idx.length; i++) row[idx[i]] = genome[i];
  return row;
}

export function rowToGenome(row, layout) {
  const g = new Float32Array(layout.idx.length);
  for (let i = 0; i < g.length; i++) g[i] = row[layout.idx[i]];
  return g;
}

// 生まれたばかりの本能（でたらめ。少しだけ前に進みたがる）
export function randomRow(layout, rng, scale = 0.35) {
  const row = new Float32Array(ROW_FLOATS);
  const { idx, kind } = layout;
  for (let i = 0; i < idx.length; i++) {
    if (kind[i] === 0 || kind[i] === 2) row[idx[i]] = rng.gauss() * scale;
  }
  row[idxOB(OUT.SPEED)] = 0.4;
  row[idxOB(OUT.GLOW)] = -0.15; // はじめは光らない（光る理由が見つかれば光りだす）
  return row;
}

// 感覚がふえた・脳が育った とき、古い本能を新しい形へ写す（ふえた部分は0から）
export function migrateRow(row) {
  return Float32Array.from(row);
}

const tanh = Math.tanh;
const sigm = (x) => 1 / (1 + Math.exp(-x));

// CPU 版の順伝播（シェーダーと同じ計算）。可視化と反応カーブに使う。
export function forward(row, xe, xo, hidden, res = {}) {
  const h = res.h || (res.h = new Float32Array(HMAX));
  const hm = res.hm || (res.hm = new Float32Array(HMAX));
  let turn = 0;
  const o = [0, 0, 0, 0];
  for (let j = 0; j < hidden; j++) {
    let a = row[idxHB(j)];
    let c = 0;
    for (let i = 0; i < NE; i++) a += row[idxWe(j, i)] * xe[i];
    for (let i = 0; i < NO; i++) c += row[idxWo(j, i)] * xo[i];
    const hp = tanh(a + c);
    const hn = tanh(a - c);
    h[j] = hp; hm[j] = hn;
    turn += row[idxTW(j)] * (hp - hn);
    for (let k = 0; k < 4; k++) o[k] += row[idxOW(k, j)] * (hp + hn);
  }
  for (let j = hidden; j < HMAX; j++) { h[j] = 0; hm[j] = 0; }
  for (let i = 0; i < NO; i++) turn += row[idxDT(i)] * xo[i];
  for (let k = 0; k < 4; k++) for (let i = 0; i < NE; i++) o[k] += row[idxDE(k, i)] * xe[i];
  res.turn = tanh(turn);
  res.speed = sigm(o[0] + row[idxOB(0)]);
  res.glow = Math.max(0, Math.min(1, o[1] + row[idxOB(1)]));
  res.dm1 = tanh(o[2] + row[idxOB(2)]);
  res.dm2 = tanh(o[3] + row[idxOB(3)]);
  return res;
}

export const INPUT_LABELS_E = [
  '群れ', '光', '餌', '危険', '壁', '外光',
  '群れ前', '光前', '餌前', '危険前', '壁前', '外光前',
  '流れ前', '速さ', '元気', '記憶1', '記憶2', '自光', '', '',
];
export const INPUT_LABELS_O = ['群れ左右', '光左右', '餌左右', '危険左右', '壁左右', '外光左右', '流れ左右', ''];
