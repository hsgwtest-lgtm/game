// ボクセル生物の「設計図」→ 物理モデル（節点・拘束・面）への変換
//
// ・ボクセル1個 = 8つの角（節点）を28本の拘束（12辺＋12面対角線＋4体対角線）でつないだ「やわらかい立方体」
// ・となりのボクセルとは角と辺を共有する。共有された拘束は、まわりのボクセルのかたさを足し合わせる（有限要素法の組み立てと同じ考え）
// ・筋肉のボクセルは脳の信号で「ふくらむ / ちぢむ」。拘束の自然長を、まわりのボクセルのかたさで重みづけした平均で変える
// ・同じ色の筋肉は、同じ出力ニューロン（神経）で動く

export const H = 0.1;                 // 1ボクセルの大きさ（m）
export const GRID = { x0: -6, x1: 6, y0: 0, y1: 6, z0: -4, z1: 4 };
export const MAX_VOXELS = 60;
export const MUSCLE_AMP = 0.3;        // 筋肉の伸縮幅（±30%）

export const M_BONE = 1;
export const M_SOFT = 2;
export const M_SLIP = 3;
export const M_MUSCLE0 = 4;           // 4..9 = 筋肉 A..F
export const N_CHANNELS = 6;

// density: 密度（水=1）, k: ばね定数（N/m）, mu: 摩擦係数
export const MATERIALS = {
  1: { key: 'bone', name: 'ほね', density: 1.4, k: 2.0e5, mu: 0.8 },
  2: { key: 'soft', name: 'やわらか', density: 0.6, k: 2.5e3, mu: 1.2 },
  3: { key: 'slip', name: 'ツルツル', density: 1.0, k: 2.0e5, mu: 0.06 },
};
for (let c = 0; c < N_CHANNELS; c++) {
  MATERIALS[M_MUSCLE0 + c] = { key: 'muscle', name: '筋肉', density: 1.0, k: 2.0e4, mu: 0.9, ch: c };
}

export const CH_LETTER = ['A', 'B', 'C', 'D', 'E', 'F'];
export const MIRROR_CH = [1, 0, 3, 2, 5, 4];   // 左右対称に置くときの色の入れ替え（A↔B, C↔D, E↔F）

export function isMuscle(m) { return m >= M_MUSCLE0 && m < M_MUSCLE0 + N_CHANNELS; }
export function channelOf(m) { return isMuscle(m) ? m - M_MUSCLE0 : -1; }
export function inGrid(x, y, z) {
  return x >= GRID.x0 && x <= GRID.x1 && y >= GRID.y0 && y <= GRID.y1 && z >= GRID.z0 && z <= GRID.z1;
}

const vkey = (x, y, z) => ((x + 64) << 14) | ((y + 64) << 7) | (z + 64);

// 重複を除き、位置の順に並べる（同じ形なら置いた順番に関係なく同じ生物になる）
export function normalizeVoxels(list) {
  const map = new Map();
  for (const v of list || []) {
    const x = v[0] | 0, y = v[1] | 0, z = v[2] | 0, m = v[3] | 0;
    if (!MATERIALS[m] || !inGrid(x, y, z)) continue;
    map.set(vkey(x, y, z), [x, y, z, m]);
  }
  return [...map.values()].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
}

// 体の検査: 問題があれば日本語のメッセージを返す
export function validateVoxels(list) {
  const vox = normalizeVoxels(list);
  const problems = [];
  if (vox.length === 0) return { ok: false, problems: ['ボクセルがありません'], vox };
  if (vox.length > MAX_VOXELS) problems.push(`ボクセルは ${MAX_VOXELS}こ まで`);
  if (!vox.some(v => isMuscle(v[3]))) problems.push('筋肉がありません（色つきのブロック）');
  const comps = components(vox);
  if (comps.count > 1) problems.push('はなれたパーツがあります');
  return { ok: problems.length === 0, problems, vox, comps };
}

// 角を共有していれば「つながっている」
export function components(vox) {
  const n = vox.length;
  const idx = new Map();
  vox.forEach((v, i) => idx.set(vkey(v[0], v[1], v[2]), i));
  const comp = new Int32Array(n).fill(-1);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const stack = [s];
    comp[s] = count;
    while (stack.length) {
      const i = stack.pop();
      const [x, y, z] = vox[i];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        const j = idx.get(vkey(x + dx, y + dy, z + dz));
        if (j !== undefined && comp[j] < 0) { comp[j] = count; stack.push(j); }
      }
    }
    count++;
  }
  return { count, comp };
}

const nkey = (a, b, c) => ((a + 64) << 14) | ((b + 64) << 7) | (c + 64);

// 角のローカル番号 li = dx + 2dy + 4dz
const CORNER = [];
for (let li = 0; li < 8; li++) CORNER.push([li & 1, (li >> 1) & 1, (li >> 2) & 1]);
const PAIRS = [];
for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) PAIRS.push([i, j]);
const BODY_DIAG = [[0, 7], [1, 6], [2, 5], [3, 4]];
// 6つの面: [軸, 向き(0/1), 外向き法線]
const FACES = [
  { axis: 0, side: 0, n: [-1, 0, 0] }, { axis: 0, side: 1, n: [1, 0, 0] },
  { axis: 1, side: 0, n: [0, -1, 0] }, { axis: 1, side: 1, n: [0, 1, 0] },
  { axis: 2, side: 0, n: [0, 0, -1] }, { axis: 2, side: 1, n: [0, 0, 1] },
];

// 面の4つの角を、外から見て反時計回りに並べる
function faceCorners(f) {
  const cs = [];
  for (let li = 0; li < 8; li++) if (CORNER[li][f.axis] === f.side) cs.push(li);
  const u = f.axis === 0 ? [0, 1, 0] : [1, 0, 0];
  const n = f.n;
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const ang = (li) => {
    const p = CORNER[li].map(c => c - 0.5);
    return Math.atan2(p[0] * v[0] + p[1] * v[1] + p[2] * v[2], p[0] * u[0] + p[1] * u[1] + p[2] * u[2]);
  };
  return cs.sort((a, b) => ang(a) - ang(b));
}
const FACE_CORNERS = FACES.map(faceCorners);

export function usedChannels(vox) {
  const used = [];
  for (let c = 0; c < N_CHANNELS; c++) if (vox.some(v => channelOf(v[3]) === c)) used.push(c);
  return used;
}

// 設計図の指紋（同じ形なら同じ値）
export function blueprintKey(vox) {
  let h = 2166136261 >>> 0;
  for (const v of vox) for (const x of v) { h ^= (x + 128) & 255; h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36) + ':' + vox.length;
}

export function compileBody(voxList) {
  const vox = normalizeVoxels(voxList);
  const nV = vox.length;
  if (!nV) throw new Error('empty body');
  const channels = usedChannels(vox);                 // 使っている色 → 出力ニューロンの順番
  const chIndex = new Int8Array(N_CHANNELS).fill(-1);
  channels.forEach((c, i) => { chIndex[c] = i; });
  const nCh = channels.length;

  // 節点
  const nodeMap = new Map();
  const nodeList = [];
  for (const [x, y, z] of vox) {
    for (let li = 0; li < 8; li++) {
      const [dx, dy, dz] = CORNER[li];
      const k = nkey(x + dx, y + dy, z + dz);
      if (!nodeMap.has(k)) { nodeMap.set(k, -1); nodeList.push([x + dx, y + dy, z + dz, k]); }
    }
  }
  nodeList.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
  nodeList.forEach((n, i) => nodeMap.set(n[3], i));
  const nN = nodeList.length;
  const voxNodes = new Int32Array(nV * 8);
  for (let v = 0; v < nV; v++) {
    const [x, y, z] = vox[v];
    for (let li = 0; li < 8; li++) {
      const [dx, dy, dz] = CORNER[li];
      voxNodes[v * 8 + li] = nodeMap.get(nkey(x + dx, y + dy, z + dz));
    }
  }

  // 質量・摩擦
  const mass = new Float64Array(nN);
  const muSum = new Float64Array(nN);
  const muCnt = new Float64Array(nN);
  const vol = H * H * H * 1000;   // 水と同じ密度なら 1kg
  for (let v = 0; v < nV; v++) {
    const mat = MATERIALS[vox[v][3]];
    for (let li = 0; li < 8; li++) {
      const n = voxNodes[v * 8 + li];
      mass[n] += mat.density * vol / 8;
      muSum[n] += mat.mu; muCnt[n] += 1;
    }
  }
  const invMass = new Float64Array(nN);
  const mu = new Float64Array(nN);
  let totalMass = 0;
  for (let n = 0; n < nN; n++) { invMass[n] = 1 / mass[n]; mu[n] = muSum[n] / muCnt[n]; totalMass += mass[n]; }

  // 自然な位置（重心を x,z=0、いちばん下を y=0 に）
  const rest = new Float64Array(nN * 3);
  let cx = 0, cz = 0, minY = 1e9;
  for (let n = 0; n < nN; n++) {
    const [a, b, c] = nodeList[n];
    const x = (a - 0.5) * H, y = b * H, z = (c - 0.5) * H;
    rest[n * 3] = x; rest[n * 3 + 1] = y; rest[n * 3 + 2] = z;
    cx += x * mass[n]; cz += z * mass[n];
    if (y < minY) minY = y;
  }
  cx /= totalMass; cz /= totalMass;
  let cy = 0;
  for (let n = 0; n < nN; n++) {
    rest[n * 3] -= cx; rest[n * 3 + 1] -= minY; rest[n * 3 + 2] -= cz;
    cy += rest[n * 3 + 1] * mass[n];
  }
  cy /= totalMass;

  // 拘束（重複をまとめる）
  const cMap = new Map();
  const cons = [];   // { a, b, k, chW: Float64Array(N_CHANNELS) }
  const diagIdx = [];   // ボクセルごとの体対角線の拘束番号
  for (let v = 0; v < nV; v++) {
    const mat = MATERIALS[vox[v][3]];
    const ch = channelOf(vox[v][3]);
    for (const [i, j] of PAIRS) {
      let a = voxNodes[v * 8 + i], b = voxNodes[v * 8 + j];
      if (a > b) { const t = a; a = b; b = t; }
      const key = a * 65536 + b;
      let ci = cMap.get(key);
      if (ci === undefined) {
        ci = cons.length;
        cMap.set(key, ci);
        cons.push({ a, b, k: 0, chW: new Float64Array(N_CHANNELS) });
      }
      const c = cons[ci];
      c.k += mat.k;
      if (ch >= 0) c.chW[ch] += mat.k;
    }
    diagIdx.push(BODY_DIAG.map(([i, j]) => {
      let a = voxNodes[v * 8 + i], b = voxNodes[v * 8 + j];
      if (a > b) { const t = a; a = b; b = t; }
      return cMap.get(a * 65536 + b);
    }));
  }
  const nC = cons.length;
  const ca = new Int32Array(nC), cb = new Int32Array(nC);
  const rest0 = new Float64Array(nC), comp = new Float64Array(nC);
  const actList = [];
  for (let i = 0; i < nC; i++) {
    const c = cons[i];
    ca[i] = c.a; cb[i] = c.b;
    const dx = rest[c.b * 3] - rest[c.a * 3], dy = rest[c.b * 3 + 1] - rest[c.a * 3 + 1], dz = rest[c.b * 3 + 2] - rest[c.a * 3 + 2];
    rest0[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    comp[i] = 1 / c.k;
    for (let ch = 0; ch < N_CHANNELS; ch++) {
      if (c.chW[ch] > 0) actList.push([i, chIndex[ch], (c.chW[ch] / c.k) * MUSCLE_AMP]);
    }
  }
  // 動く拘束の一覧（拘束番号順）
  const actC = new Int32Array(actList.length), actCh = new Int8Array(actList.length), actCoef = new Float64Array(actList.length);
  actList.forEach(([c, ch, w], i) => { actC[i] = c; actCh[i] = ch; actCoef[i] = w; });

  // 筋肉の伸び（固有感覚）: 色ごとの体対角線
  const strainStart = new Int32Array(nCh + 1);
  const strainList = [];
  for (let k = 0; k < nCh; k++) {
    strainStart[k] = strainList.length;
    for (let v = 0; v < nV; v++) if (channelOf(vox[v][3]) === channels[k]) strainList.push(...diagIdx[v]);
  }
  strainStart[nCh] = strainList.length;
  const strainIdx = Int32Array.from(strainList);

  // 接地センサーの区分（前後 × 左右）。+X が前、+Z が右
  const quad = new Uint8Array(nN);
  const quadCount = [0, 0, 0, 0];
  for (let n = 0; n < nN; n++) {
    const front = rest[n * 3] >= -1e-9, right = rest[n * 3 + 2] >= -1e-9;
    const q = (front ? 0 : 2) + (right ? 1 : 0);   // 0:左前 1:右前 2:左後 3:右後
    quad[n] = q; quadCount[q]++;
  }

  // 見える面（となりにボクセルがない面）
  const occ = new Set(vox.map(v => vkey(v[0], v[1], v[2])));
  const faces = [], faceMat = [], faceVox = [];
  for (let v = 0; v < nV; v++) {
    const [x, y, z, m] = vox[v];
    for (let f = 0; f < 6; f++) {
      const n = FACES[f].n;
      if (occ.has(vkey(x + n[0], y + n[1], z + n[2]))) continue;
      for (const li of FACE_CORNERS[f]) faces.push(voxNodes[v * 8 + li]);
      faceMat.push(m); faceVox.push(v);
    }
  }

  let minX = 1e9, maxX = -1e9, maxY = 0, minZ = 1e9, maxZ = -1e9;
  for (let n = 0; n < nN; n++) {
    minX = Math.min(minX, rest[n * 3]); maxX = Math.max(maxX, rest[n * 3]);
    maxY = Math.max(maxY, rest[n * 3 + 1]);
    minZ = Math.min(minZ, rest[n * 3 + 2]); maxZ = Math.max(maxZ, rest[n * 3 + 2]);
  }

  return {
    key: blueprintKey(vox),
    vox, nV, nN, nC, nCh, channels, chIndex,
    rest, mass, invMass, mu, totalMass, restCOM: [0, cy, 0],
    ca, cb, rest0, comp,
    actC, actCh, actCoef,
    strainStart, strainIdx,
    quad, quadCount,
    voxNodes,
    faces: Int32Array.from(faces), faceMat: Uint8Array.from(faceMat), faceVox: Int32Array.from(faceVox),
    nF: faceMat.length,
    size: { x: maxX - minX, y: maxY, z: maxZ - minZ, minX, maxX, minZ, maxZ },
  };
}

// 体の重さ・大きさなど（設計画面の表示用）
export function bodyStats(voxList) {
  const vox = normalizeVoxels(voxList);
  let kg = 0, muscles = 0;
  for (const v of vox) { kg += MATERIALS[v[3]].density; if (isMuscle(v[3])) muscles++; }
  return { count: vox.length, kg, muscles, channels: usedChannels(vox) };
}
