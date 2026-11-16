// 建物の定義（箱の組み合わせ）と、state.json の buildings を島の上に配置する処理。
// Three.js には依存しない。描画側は boxes を、シミュレーション側は spots / 敷地を使う。
//
// ローカル座標：+z が「正面」。rot（度）は上から見た回転で、0=南向き / 90=東向き / 180=北向き / 270=西向き。

import { N, CELL } from './terrain.js';

const WOOD = '#8f5f38';
const WOOD_DARK = '#5e3d24';
const WOOD_LIGHT = '#b98952';
const WALL = '#e2c391';
const THATCH_A = '#d8b052';
const THATCH_B = '#b98c3a';
const SOIL = '#6a4427';
const SOIL_LIGHT = '#82552f';
const LEAF_A = '#4fae4a';
const LEAF_B = '#86cc4e';
const GLASS = '#8fdcec';
const RED = '#d9503f';
const WHITE = '#f4efe2';

const box = (x, y, z, w, h, d, c) => ({ p: [x, y, z], s: [w, h, d], c });

function hut() {
  const b = [];
  b.push(box(0, 0.2, 0, 5.6, 0.4, 5.6, WOOD_DARK));
  b.push(box(0, 1.7, 0, 4.6, 2.6, 4.6, WALL));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.push(box(sx * 2.3, 1.75, sz * 2.3, 0.55, 2.7, 0.55, WOOD));
  b.push(box(0, 1.35, 2.32, 1.2, 1.9, 0.12, WOOD_DARK)); // 扉
  b.push(box(0.35, 1.3, 2.4, 0.15, 0.15, 0.1, THATCH_A)); // 取っ手
  b.push(box(1.45, 1.95, 2.32, 0.8, 0.8, 0.12, GLASS));
  b.push(box(2.32, 1.95, -0.2, 0.12, 0.8, 1.0, GLASS));
  b.push(box(-2.32, 1.95, 0.4, 0.12, 0.8, 1.0, GLASS));
  // 段々のかやぶき屋根
  const roof = [
    [6.2, THATCH_B],
    [5.2, THATCH_A],
    [4.0, THATCH_B],
    [2.8, THATCH_A],
    [1.4, THATCH_B],
  ];
  roof.forEach(([w, c], n) => b.push(box(0, 3.3 + n * 0.6, 0, w, 0.6, w, c)));
  // 軒先のたきぎ
  b.push(box(-1.7, 0.65, 2.75, 1.0, 0.5, 0.5, WOOD));
  b.push(box(-1.7, 1.05, 2.75, 0.7, 0.35, 0.5, WOOD_LIGHT));
  return {
    label: '小屋',
    boxes: b,
    height: 6.4,
    footprint: { x0: -3.1, x1: 3.1, z0: -3.1, z1: 3.1 },
    spots: [
      { x: 0.6, z: 4.6, fx: 0, fz: 0, jobs: ['料理人', '大工'], label: '小屋' },
      { x: 4.6, z: 0.4, fx: 0, fz: 0.4, jobs: ['大工'], label: '小屋' },
      { x: -4.6, z: -0.4, fx: 0, fz: -0.4, jobs: ['大工'], label: '小屋' },
    ],
  };
}

function field() {
  const b = [];
  b.push(box(0, 0.15, 0, 9.4, 0.3, 7.4, SOIL));
  const rows = [-2.55, -0.85, 0.85, 2.55];
  rows.forEach((z, r) => {
    b.push(box(0, 0.42, z, 8.4, 0.25, 0.85, SOIL_LIGHT));
    for (let n = 0; n < 6; n++) {
      const x = -3.5 + n * 1.4;
      const tall = (n + r) % 3 === 0;
      b.push(box(x, 0.8 + (tall ? 0.15 : 0), z, 0.55, 0.5 + (tall ? 0.3 : 0), 0.55, (n + r) % 2 ? LEAF_A : LEAF_B));
      if ((n * 3 + r) % 4 === 0) b.push(box(x + 0.2, 1.0, z + 0.15, 0.3, 0.3, 0.3, RED));
    }
  });
  // 柵（正面は開けておく）
  for (const x of [-4.7, 0, 4.7]) b.push(box(x, 0.6, -3.7, 0.3, 1.2, 0.3, WOOD_LIGHT));
  for (const x of [-4.7, 4.7]) for (const z of [0, 3.7]) b.push(box(x, 0.6, z, 0.3, 1.2, 0.3, WOOD_LIGHT));
  b.push(box(0, 0.85, -3.7, 9.4, 0.18, 0.18, WOOD_LIGHT));
  for (const x of [-4.7, 4.7]) b.push(box(x, 0.85, 0, 0.18, 0.18, 7.4, WOOD_LIGHT));
  // かかし
  b.push(box(3.4, 1.3, -2.9, 0.22, 2.4, 0.22, WOOD));
  b.push(box(3.4, 1.9, -2.9, 1.8, 0.22, 0.22, WOOD));
  b.push(box(3.4, 2.75, -2.9, 0.75, 0.6, 0.6, WALL));
  b.push(box(3.4, 3.15, -2.9, 1.3, 0.2, 1.1, THATCH_A));
  return {
    label: '畑',
    boxes: b,
    height: 3.4,
    footprint: { x0: -4.9, x1: 4.9, z0: -3.9, z1: 3.9 },
    spots: [
      { x: -2.2, z: 5.0, fx: -2.2, fz: 0, jobs: ['農家'], label: '畑' },
      { x: 2.4, z: 5.0, fx: 2.4, fz: 0, jobs: ['農家'], label: '畑' },
      { x: 6.2, z: -0.6, fx: 0, fz: -0.6, jobs: ['農家'], label: '畑' },
    ],
  };
}

export const PIER_DECK_Y = 1.35;
function pier() {
  const L = 18;
  const b = [];
  const top = PIER_DECK_Y;
  for (let z = -2; z < L; z++) {
    b.push(box(0, top - 0.14, z + 0.5, 2.7, 0.28, 0.92, z % 2 ? WOOD_LIGHT : WOOD));
  }
  for (let z = 1; z <= L; z += 4.25) {
    for (const sx of [-1, 1]) b.push(box(sx * 1.35, (top - 4) / 2 + 0.35, z, 0.45, top + 4.7, 0.45, WOOD_DARK));
  }
  // 係留ぐい と ロープ
  b.push(box(-1.35, top + 0.7, L - 0.2, 0.5, 0.5, 0.5, WHITE));
  // 小舟
  const bz = L - 6;
  b.push(box(2.9, 0.55, bz, 1.7, 0.7, 4.2, RED));
  b.push(box(2.9, 0.62, bz + 2.5, 1.1, 0.56, 0.9, RED));
  b.push(box(2.9, 0.93, bz, 1.2, 0.12, 3.6, WOOD_LIGHT));
  b.push(box(2.9, 1.05, bz - 0.6, 1.5, 0.14, 0.4, WOOD));
  return {
    label: '桟橋',
    boxes: b,
    height: 2.4,
    absoluteY: true,
    snapToCell: true,
    deck: { x0: -0.95, x1: 0.95, z0: -2.2, z1: L, y: top },
    spots: [
      { x: 0, z: L - 0.9, fx: 0, fz: L + 6, jobs: ['漁師'], label: '桟橋', spread: 0 },
      { x: 0, z: L - 5, fx: -6, fz: L - 5, jobs: ['漁師'], label: '桟橋', spread: 0 },
      { x: 0, z: L - 9, fx: 6, fz: L - 9, jobs: ['漁師'], label: '桟橋', spread: 0 },
    ],
  };
}

function watchtower() {
  const b = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.push(box(sx * 1.35, 3.3, sz * 1.35, 0.42, 6.6, 0.42, WOOD));
  for (const s of [-1, 1]) {
    b.push(box(0, 2.3, s * 1.35, 2.7, 0.24, 0.24, WOOD_DARK));
    b.push(box(s * 1.35, 4.3, 0, 0.24, 0.24, 2.7, WOOD_DARK));
  }
  b.push(box(0, 6.7, 0, 3.8, 0.4, 3.8, WOOD_LIGHT));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.push(box(sx * 1.7, 8.0, sz * 1.7, 0.28, 2.3, 0.28, WOOD));
  for (const s of [-1, 1]) {
    b.push(box(0, 7.8, s * 1.7, 3.6, 0.2, 0.2, WOOD_DARK));
    b.push(box(s * 1.7, 7.8, 0, 0.2, 0.2, 3.6, WOOD_DARK));
  }
  b.push(box(0, 9.3, 0, 4.6, 0.45, 4.6, THATCH_B));
  b.push(box(0, 9.75, 0, 3.2, 0.45, 3.2, THATCH_A));
  b.push(box(0, 10.15, 0, 1.6, 0.4, 1.6, THATCH_B));
  // はしご
  for (const sx of [-0.45, 0.45]) b.push(box(sx, 3.3, 1.75, 0.16, 6.6, 0.16, WOOD_LIGHT));
  for (let y = 0.7; y < 6.5; y += 0.85) b.push(box(0, y, 1.75, 0.9, 0.14, 0.14, WOOD_LIGHT));
  // 旗
  b.push(box(1.7, 11.0, -1.7, 0.16, 2.4, 0.16, WOOD_DARK));
  b.push(box(2.35, 11.7, -1.7, 1.2, 0.7, 0.1, RED));
  return {
    label: '見張り台',
    boxes: b,
    height: 12.2,
    footprint: { x0: -2.1, x1: 2.1, z0: -2.1, z1: 2.3 },
    spots: [
      { x: 0, z: 3.8, fx: 0, fz: 0, jobs: ['探検家'], label: '見張り台' },
      { x: 3.8, z: 0, fx: 9, fz: 0, jobs: ['探検家'], label: '見張り台' },
    ],
  };
}

// 未対応の type は立て札で代用する（データの打ち間違いで島が壊れないように）
function signpost() {
  return {
    label: '立て札',
    boxes: [box(0, 0.9, 0, 0.3, 1.8, 0.3, WOOD), box(0, 1.9, 0.05, 1.8, 1.0, 0.2, WOOD_LIGHT), box(0, 1.9, 0.17, 1.2, 0.2, 0.05, WOOD_DARK)],
    height: 2.6,
    footprint: { x0: -0.6, x1: 0.6, z0: -0.6, z1: 0.6 },
    spots: [{ x: 0, z: 2.4, fx: 0, fz: 0, jobs: [], label: '立て札' }],
  };
}

export const BUILDING_TYPES = { hut, field, pier, watchtower };
export const BUILDING_LABELS = { hut: '小屋', field: '畑', pier: '桟橋', watchtower: '見張り台' };

// 広場のたき火（建物データではなく、島に最初からある）
export function campfireBoxes() {
  const STONE = '#8d8f98';
  const STONE_D = '#6f7079';
  const b = [];
  const ring = [
    [-0.9, 0],
    [0.9, 0],
    [0, -0.9],
    [0, 0.9],
    [-0.65, -0.65],
    [0.65, -0.65],
    [-0.65, 0.65],
    [0.65, 0.65],
  ];
  ring.forEach(([x, z], n) => b.push(box(x, 0.2, z, 0.5, 0.4, 0.5, n % 2 ? STONE : STONE_D)));
  b.push(box(0, 0.25, 0, 1.2, 0.25, 0.3, WOOD_DARK));
  b.push(box(0, 0.3, 0, 0.3, 0.25, 1.2, WOOD));
  // 丸太のいす
  b.push(box(-3.0, 0.3, 0.6, 0.7, 0.6, 2.2, WOOD));
  b.push(box(2.9, 0.3, -0.8, 0.7, 0.6, 2.2, WOOD));
  b.push(box(0.4, 0.3, 3.1, 2.2, 0.6, 0.7, WOOD));
  return b;
}

const rad = (deg) => (deg * Math.PI) / 180;

// state.json の buildings を解決する。
// 戻り値：{ list, blocked:Set, reserved:Set, decks:Map }
export function resolveBuildings(defs, terrain) {
  const { idx, cellOf, cellCenter, inGrid, h } = terrain;
  const list = [];
  const blocked = new Set();
  const reserved = new Set();
  const decks = new Map();

  (defs || []).forEach((src, n) => {
    const make = BUILDING_TYPES[src.type] || signpost;
    const def = make();
    let x = Number(src.x) || 0;
    let z = Number(src.z) || 0;
    const rot = Number(src.rot) || 0;
    if (def.snapToCell) {
      const c = cellOf(x, z);
      const cc = cellCenter(c.i, c.j);
      x = cc.x;
      z = cc.z;
    }
    const sin = Math.sin(rad(rot));
    const cos = Math.cos(rad(rot));
    const toWorld = (lx, lz) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos });
    const toLocal = (wx, wz) => {
      const dx = wx - x;
      const dz = wz - z;
      return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
    };

    // 周辺のマスを走査して、敷地・床・地面の高さを求める
    const c0 = cellOf(x, z);
    const R = 14;
    let baseY = -Infinity;
    const foot = [];
    for (let dj = -R; dj <= R; dj++) {
      for (let di = -R; di <= R; di++) {
        const i = c0.i + di;
        const j = c0.j + dj;
        if (!inGrid(i, j)) continue;
        const cc = cellCenter(i, j);
        const l = toLocal(cc.x, cc.z);
        const k = idx(i, j);
        const f = def.footprint;
        if (f) {
          if (l.x >= f.x0 && l.x <= f.x1 && l.z >= f.z0 && l.z <= f.z1) {
            blocked.add(k);
            foot.push(k);
            baseY = Math.max(baseY, h[k]);
          }
          const m = 2.2; // 木や岩を置かない余白
          if (l.x >= f.x0 - m && l.x <= f.x1 + m && l.z >= f.z0 - m && l.z <= f.z1 + m + 2.5) reserved.add(k);
        }
        const d = def.deck;
        if (d) {
          if (l.x >= d.x0 && l.x <= d.x1 && l.z >= d.z0 && l.z <= d.z1) {
            if (h[k] < d.y + 0.5) decks.set(k, d.y);
          }
          if (l.x >= d.x0 - 4 && l.x <= d.x1 + 5 && l.z >= d.z0 - 3 && l.z <= d.z1 + 3) reserved.add(k);
        }
      }
    }
    if (def.absoluteY) {
      baseY = 0;
    } else if (!foot.length) {
      baseY = Math.max(1, h[idx(c0.i, c0.j)]);
    } else {
      // 敷地は整地する（高さの中央値にそろえる）。開拓で地面がならされる、という扱い。
      const hs = foot.map((k) => h[k]).sort((a, b) => a - b);
      baseY = Math.max(1, hs[Math.floor((hs.length - 1) / 2)]);
      for (const k of foot) h[k] = baseY;
    }

    const spots = def.spots.map((s) => {
      const p = toWorld(s.x, s.z);
      const f = toWorld(s.fx, s.fz);
      return { x: p.x, z: p.z, fx: f.x, fz: f.z, jobs: s.jobs, label: src.name || s.label, spread: s.spread ?? 0.9, building: src.id || `b${n}` };
    });

    list.push({
      id: src.id || `b${n}`,
      type: BUILDING_TYPES[src.type] ? src.type : 'unknown',
      typeLabel: def.label,
      name: src.name || def.label,
      builtDay: src.builtDay ?? null,
      note: src.note || '',
      x,
      z,
      y: baseY,
      rot,
      height: def.height,
      boxes: def.boxes,
      foundation: !def.absoluteY, // 斜面でも浮かないよう、土台を下へ伸ばす
      footprintLocal: def.footprint || null,
      spots,
    });
  });

  return { list, blocked, reserved, decks };
}

export { N, CELL };
