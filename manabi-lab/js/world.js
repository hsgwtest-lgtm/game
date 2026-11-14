// world.js — ボクセルの島の地形、草（餌）の生え方、昼夜、そして全方式に共通の「世界のルール」
//   描画に依存しない純粋モジュール（Node のテストからもそのまま使う）
import { RNG, makeNoise2D, clamp, hash32 } from './util.js';

export const G = 28; // 島の一辺のマス数
export const NC = G * G;
export const LEVEL_H = 0.5; // 地形1段の高さ（描画用）
export const WATER_Y = 0.8; // 水面の高さ（段1の上面0.5と段2の上面1.0のあいだ）
export const DAY_TICKS = 48; // 1日のターン数
export const NIGHT_FROM = 0.7; // 1日のうちこの割合から先が夜（48ターン中 34〜47 の14ターン）

export const T = { DEEP: 0, SHALLOW: 1, SAND: 2, MEADOW: 3, HILL: 4, ROCK: 5, TREE: 6 };
export const T_JA = ['深い海', '浅瀬', '砂浜', '草原', '丘', '岩', '木'];
export const FERT = [0, 0, 0.22, 1, 0.6, 0, 0]; // 草の育ちやすさ
export const WALKABLE = [0, 0, 1, 1, 1, 0, 0]; // 歩けるか（海・岩・木は通れない）

// 向き: 0=北(上) 1=東(右) 2=南(下) 3=西(左)
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const DIR_JA = ['北', '東', '南', '西'];

// ---- 世界のルール（4つの方式すべてに同じものが適用される）
export const RULES = {
  E_MAX: 100, // 体力（エネルギー）の上限
  E_START: 50, // 世代のはじめの体力
  BASAL: 0.6, // 何をしていても1ターンに減る
  MOVE: 0.6, // 歩くと追加で減る
  NIGHT_MOVE: 0.8, // 夜に歩くとさらに追加で減る（暗くてつまずく）
  SLEEP_DAY: 0.4, // 昼に眠ったときの消費（BASAL のかわり）
  SLEEP_NIGHT: 0.15, // 夜に眠ったときの消費
  BITE: 0.25, // 1回で食べる草の量（マスの草は 0〜1）
  E_PER_GRASS: 24, // 草 1 あたりのエネルギー（1口で最大6）
  REPRO_E: 80, // この体力をこえると子を産む
  REPRO_AGE: 24, // 産めるようになる年齢（ターン）
  REPRO_CD: 24, // 次に産めるまでのターン
  CHILD_E: 35, // 子がもらう体力
  BIRTH_COST: 10, // 産むときに失う体力
  LIFE_DAYS: 2.5, // 寿命（日）
  LIFE_JITTER: 0.1, // 寿命のばらつき（±10%）
  VIS_DAY: 3, // においが届く距離（昼）
  VIS_NIGHT: 1, // 夜は1マス先までしか分からない
  CAP_MULT: 3, // 1方式あたりの数の上限 = 創始者数 × これ
  GROW_DAY: 0.012, // 草の伸び（昼）
  GROW_NIGHT: 0.002, // 草の伸び（夜）
  NIGHT_EAT: 0.3, // 夜は暗くて草をうまく食べられない（1口がこの割合になる）
  OWL_MOVE: 0.02, // 夜に歩くと、この確率でフクロウにおそわれる
  OWL_AWAKE: 0.006, // 夜に起きているだけ（食べる・その場）でもこの確率。眠っていれば安全
};

export const todOf = (tick) => (((tick % DAY_TICKS) + DAY_TICKS) % DAY_TICKS) / DAY_TICKS;
export const nightAt = (tick) => todOf(Math.floor(tick)) >= NIGHT_FROM;
export const dayOf = (tick) => Math.floor(tick / DAY_TICKS) + 1;
// 時刻の表示用: 朝6時を 0、日の入り（夜のはじまり）を 18時にあわせる
export function clockOf(tick) {
  const t = todOf(tick);
  const h = t < NIGHT_FROM ? 6 + (t / NIGHT_FROM) * 12 : 18 + ((t - NIGHT_FROM) / (1 - NIGHT_FROM)) * 12;
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
// 描画用のなめらかな明るさ（0=夜 1=昼）と太陽の高さ
export function sunAt(tick) {
  const t = todOf(tick);
  let elev;
  if (t < NIGHT_FROM) elev = Math.sin((t / NIGHT_FROM) * Math.PI);
  else elev = -Math.sin(((t - NIGHT_FROM) / (1 - NIGHT_FROM)) * Math.PI);
  const a = t < NIGHT_FROM ? (t / NIGHT_FROM) * Math.PI : Math.PI + ((t - NIGHT_FROM) / (1 - NIGHT_FROM)) * Math.PI;
  const day = clamp((elev + 0.12) / 0.4, 0, 1);
  return { elev, angle: a, daylight: day * day * (3 - 2 * day) };
}

// ---- 地形づくり（シードだけで決まる）
function genTerrain(s) {
  const rng = new RNG(s);
  const n1 = makeNoise2D(rng);
  const n2 = makeNoise2D(rng);
  const n3 = makeNoise2D(rng);
  const n4 = makeNoise2D(rng);
  const ox = rng.range(0, 150);
  const oz = rng.range(0, 150);
  const fbm = (x, y) => {
    let v = 0;
    let a = 0.5;
    let f = 1;
    for (let o = 0; o < 4; o++) {
      v += a * n1(x * f, y * f);
      a *= 0.5;
      f *= 2.03;
    }
    return v / 0.9375;
  };
  const level = new Uint8Array(NC);
  const type = new Uint8Array(NC);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const k = j * G + i;
      const nx = ((i + 0.5) / G) * 2 - 1;
      const nz = ((j + 0.5) / G) * 2 - 1;
      const wx = nx + (n2(i * 0.12 + ox, j * 0.12) - 0.5) * 0.5;
      const wz = nz + (n2(i * 0.12, j * 0.12 + oz) - 0.5) * 0.5;
      const d2 = wx * wx + wz * wz;
      let v = 1.0 - 1.15 * d2 + (fbm(i * 0.13 + ox, j * 0.13 + oz) - 0.5) * 0.85;
      if (i < 1 || j < 1 || i >= G - 1 || j >= G - 1) v = Math.min(v, 0.05);
      let t;
      let lv;
      if (v < 0.12) [t, lv] = [T.DEEP, 0];
      else if (v < 0.24) [t, lv] = [T.SHALLOW, 1];
      else if (v < 0.33) [t, lv] = [T.SAND, 2];
      else if (v < 0.6) [t, lv] = [T.MEADOW, 3];
      else if (v < 0.76) [t, lv] = [T.MEADOW, 4];
      else if (v < 0.98) [t, lv] = [T.HILL, 5];
      else [t, lv] = [T.ROCK, v > 1.06 ? 7 : 6];
      type[k] = t;
      level[k] = lv;
    }
  }
  // 木立ちと、ところどころの岩（通れない障害物。回り道が必要になる）
  for (let j = 1; j < G - 1; j++) {
    for (let i = 1; i < G - 1; i++) {
      const k = j * G + i;
      if (type[k] !== T.MEADOW && type[k] !== T.HILL) continue;
      const f = n3(i * 0.22 + 7, j * 0.22 + 3);
      if (f > 0.74 && rng.chance(0.75)) type[k] = T.TREE;
      else if (type[k] === T.MEADOW && rng.chance(0.018)) {
        type[k] = T.ROCK;
        level[k] += 1;
      }
    }
  }
  // 歩けるマスの最大のつながりだけ残す（閉じこめられたすき間は木でうめる）
  const walk = (k) => WALKABLE[type[k]] === 1;
  const comp = new Int32Array(NC).fill(-1);
  let best = -1;
  let bestN = 0;
  let cid = 0;
  const stack = [];
  for (let k = 0; k < NC; k++) {
    if (!walk(k) || comp[k] >= 0) continue;
    let cnt = 0;
    comp[k] = cid;
    stack.push(k);
    while (stack.length) {
      const q = stack.pop();
      cnt++;
      const qi = q % G;
      const qj = (q / G) | 0;
      for (let d = 0; d < 4; d++) {
        const ni = qi + DX[d];
        const nj = qj + DY[d];
        if (ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
        const m = nj * G + ni;
        if (walk(m) && comp[m] < 0) {
          comp[m] = cid;
          stack.push(m);
        }
      }
    }
    if (cnt > bestN) {
      bestN = cnt;
      best = cid;
    }
    cid++;
  }
  for (let k = 0; k < NC; k++) {
    if (walk(k) && comp[k] !== best) {
      if (type[k] === T.SAND) {
        type[k] = T.SHALLOW;
        level[k] = 1;
      } else type[k] = T.TREE;
    }
  }
  const fert = new Float32Array(NC);
  const walkA = new Uint8Array(NC);
  const grass0 = new Float32Array(NC);
  const land = [];
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const k = j * G + i;
      fert[k] = FERT[type[k]];
      walkA[k] = WALKABLE[type[k]];
      if (walkA[k]) {
        land.push(k);
        // 草はまだらに生える。よく育つ「草むら」と、ほとんど生えない「はげ地」がある（においをたどる意味が出る）
        const p = n4(i * 0.31 + 20, j * 0.31 + 20);
        const patch = clamp((p - 0.3) * 2.2, 0, 1);
        fert[k] *= 0.15 + 0.85 * patch;
        grass0[k] = fert[k] * patch;
      }
    }
  }
  return { seed: s, level, type, fert, walk: walkA, land: Int32Array.from(land), landCount: land.length, grass0 };
}

// 島の広さがちょうどよくなるまでシードをずらして作り直す（シードが同じなら必ず同じ島）
export function makeTerrain(seed) {
  let t = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    t = genTerrain(hash32(seed >>> 0, attempt, 0x5eed));
    if (t.landCount >= NC * 0.36 && t.landCount <= NC * 0.62) break;
  }
  t.seed = seed >>> 0;
  return t;
}

export function growGrass(grass, terr, night) {
  const r = night ? RULES.GROW_NIGHT : RULES.GROW_DAY;
  const land = terr.land;
  const fert = terr.fert;
  for (let n = 0; n < land.length; n++) {
    const k = land[n];
    const g = grass[k];
    grass[k] = g + r * fert[k] * (1 - g);
  }
}

export function totalGrass(grass, terr) {
  let s = 0;
  for (let n = 0; n < terr.land.length; n++) s += grass[terr.land[n]];
  return s;
}
