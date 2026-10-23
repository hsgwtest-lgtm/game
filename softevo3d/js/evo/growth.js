// 成長の見える化: レベル・称号・わざ（動き方）の判定

// ── レベル ──
// 生まれたとき（第0世代）からの のびで決まる。序盤は小刻みに上がり、だんだん上がりにくくなる
// （+5cm で LV2, +1.5m で LV10, +4.8m で LV20, +15m で LV40）
export const MAX_LEVEL = 99;
const LV_SCALE = { distance: 0.05, jump: 0.012 };
const LV_POW = { distance: 1.55, jump: 1.38 };
// 地形・重力の難しさ（記録をレベル用の点数に直すときの倍率）
const TERRAIN_MUL = { flat: 1, hills: 1.15, bumpy: 1.1, stairs: 1.25 };
const GRAVITY_MUL = { earth: 1, mars: 0.8, moon: 0.6 };

export function levelThreshold(objective, lv) {
  if (lv <= 1) return 0;
  return LV_SCALE[objective] * Math.pow(lv - 1, LV_POW[objective]);
}

export function scoreOf(env, fit) {
  return Math.max(0, fit) * (TERRAIN_MUL[env.terrain] || 1) * (GRAVITY_MUL[env.gravity] || 1);
}

export function levelFor(objective, score) {
  let lv = 1;
  while (lv < MAX_LEVEL && score >= levelThreshold(objective, lv + 1)) lv++;
  return lv;
}

// 次のレベルまでの進み具合 0..1
export function levelProgress(objective, score, lv) {
  if (lv >= MAX_LEVEL) return 1;
  const a = levelThreshold(objective, lv), b = levelThreshold(objective, lv + 1);
  return Math.max(0, Math.min(1, (score - a) / (b - a)));
}

const TITLES = [
  [1, 'うまれたて'], [2, 'もぞもぞ'], [4, 'よちよち'], [6, 'のそのそ'], [8, 'てくてく'],
  [10, 'とことこ'], [13, 'すたすた'], [16, 'ずんずん'], [20, 'ぐんぐん'], [25, 'すいすい'],
  [30, 'びゅんびゅん'], [37, 'しっぷう'], [45, 'じんらい'], [55, 'いなずま'], [70, 'でんせつ'],
  [85, 'しんわ'], [99, 'かみさま'],
];
export function titleFor(lv) {
  let t = TITLES[0][1];
  for (const [l, name] of TITLES) if (lv >= l) t = name;
  return t;
}

// ── わざ（動き方）──
export const MOVES = {
  teku: { name: 'てくてく', desc: '足を じゅんばんに ついて あるく', icon: 'walk' },
  zuri: { name: 'ずりずり', desc: '足を あげずに はって すすむ', icon: 'crawl' },
  paka: { name: 'ぱかぱか', desc: 'ときどき 宙にういて かけぬける', icon: 'gallop' },
  pyon: { name: 'ぴょんぴょん', desc: 'とびはねて すすむ', icon: 'hop' },
  koro: { name: 'ころころ', desc: '体ごと ころがって すすむ', icon: 'roll' },
  sakasa: { name: 'さかさあるき', desc: 'ひっくりかえったまま すすむ', icon: 'flip' },
  naname: { name: 'ななめすすみ', desc: 'ななめに それながら すすむ', icon: 'diag' },
  jump: { name: 'ジャンプ', desc: 'じめんを けって とびあがる', icon: 'jump' },
  hijump: { name: 'ハイジャンプ', desc: '体の高さより 高く とぶ', icon: 'hijump' },
};
export const MOVE_KEYS = Object.keys(MOVES);

// 成績から「わざ」を判定（まだ判定できない＝null）
export function classifyMove(res, env, bodyHeight = 0.2) {
  if (!res || res.flag !== 'ok') return null;
  if (env.objective === 'jump') {
    if (res.jump >= Math.max(0.12, bodyHeight)) return 'hijump';
    if (res.jump >= 0.03) return 'jump';
    return null;
  }
  if (res.dist < 0.3) return null;
  if (Math.abs(res.rollZ) >= 1 || Math.abs(res.rollX) >= 1) return 'koro';
  if (res.upside >= 0.7) return 'sakasa';
  if (Math.abs(res.drift) > res.dist * 0.7) return 'naname';
  if (res.air >= 0.25) return 'pyon';
  if (res.air >= 0.06) return 'paka';
  const minQ = Math.min(...res.quad);
  if (minQ >= 0.93 && res.air < 0.02) return 'zuri';
  return 'teku';
}

export function formatFit(objective, v) {
  if (!Number.isFinite(v)) return '--';
  if (objective === 'jump') return (v * 100).toFixed(1) + 'cm';
  return v.toFixed(2) + 'm';
}

export function formatDelta(objective, d) {
  const cm = d * 100;
  const s = (cm >= 0 ? '+' : '') + (Math.abs(cm) >= 10 ? cm.toFixed(0) : cm.toFixed(1));
  return s + 'cm';
}
