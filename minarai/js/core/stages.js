// 現場（ステージ）の定義。下へ行くほど難しい。
//   task   : 'touch' ふれる / 'grasp' つかむ / 'place' 置き場まで運んで放す
//   blocks : 運ぶブロックの数（1〜2。2個のときは色ごとに置き場が決まっている）
//   decoy  : ニセモノ（赤）が1個まざる。ニセモノを置き場に置いたら失格
//   fixedGoal : 置き場がいつも同じ場所
//   turn   : ブロックが台といっしょに回る（1歩あたりのラジアン）
//   shake  : カメラが毎歩ゆれる（画素）。randomStart: アームの最初の姿勢が毎回ちがう
export const STAGES = [
  {
    id: 'touch', name: 'タッチ', brief: 'ブロックに手先でふれる',
    hint: 'いちばんやさしい現場。強化学習だけでも数分で覚えます。',
    task: 'touch', blocks: 1, goals: 0, maxSteps: 60,
  },
  {
    id: 'grasp', name: 'つかむ', brief: 'ブロックをつかむ',
    hint: '手先がブロックの真上に来たときだけ「にぎる」。早すぎると空振りします。',
    task: 'grasp', blocks: 1, goals: 0, maxSteps: 70,
  },
  {
    id: 'place', name: 'はこぶ', brief: 'いつもの置き場へ運んで放す',
    hint: '置き場はいつも手前の同じ場所。つかむ→運ぶ→放すの3つがつながります。',
    task: 'place', blocks: 1, goals: 1, fixedGoal: [0, -1.25], maxSteps: 100,
  },
  {
    id: 'anywhere', name: 'どこでも', brief: '毎回かわる置き場へ運ぶ',
    hint: '置き場の位置も「目」で見つけないといけません。',
    task: 'place', blocks: 1, goals: 1, maxSteps: 100,
  },
  {
    id: 'decoy', name: 'ニセモノ', brief: 'だいだい色だけ運ぶ（赤は失格）',
    hint: '色の見分けが必要。赤いニセモノを置き場に置くと、その回は失格です。',
    task: 'place', blocks: 1, goals: 1, decoy: true, maxSteps: 100,
  },
  {
    id: 'turn', name: '回る台', brief: '回っているブロックをつかんで運ぶ',
    hint: 'ブロックは台といっしょに回り続けます。先回りして待つのがコツ。',
    task: 'place', blocks: 1, goals: 1, turn: 0.03, maxSteps: 120,
  },
  {
    id: 'sort', name: '仕分け', brief: '2色を同じ色の置き場へ',
    hint: '手順が倍の長丁場。だいだい→だいだいの置き場、みどり→みどりの置き場。届けたブロックは回収されて消えます。強化学習だけだと時間がかかる現場です（模倣→強化や、頭脳の引き継ぎが効きます）。',
    task: 'place', blocks: 2, goals: 2, maxSteps: 180,
  },
  {
    id: 'shake', name: 'ゆれる目', brief: 'カメラがゆれる中で運ぶ',
    hint: '毎歩カメラがずれ、最初の姿勢も毎回ちがいます。お手本の丸暗記は通用しません。',
    task: 'place', blocks: 1, goals: 1, shake: 1.0, randomStart: true, maxSteps: 110,
  },
];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s, i) => [s.id, Object.assign(s, { no: i + 1 })]));

// 学び方（育て方）3通り
export const METHODS = [
  { id: 'bc', name: '模倣学習', short: '模倣', tag: 'お手本をまねる' },
  { id: 'rl', name: '強化学習', short: '強化', tag: 'ごほうびで自分で覚える' },
  { id: 'mix', name: '模倣→強化', short: '模倣→強化', tag: 'まねてから自分で磨く' },
];

// 検定の合格率と★
export const STAR_RATES = [0.6, 0.85, 0.97];
export function starsFor(rate) {
  let s = 0;
  for (const r of STAR_RATES) if (rate >= r - 1e-9) s++;
  return s;
}

// ★の合計で決まる肩書き
export const RANKS = [
  [0, '見習い'], [3, '研修生'], [8, '作業員'], [15, '主任'], [24, '班長'],
  [34, '職長'], [45, '工場長'], [57, '匠'], [72, '神の手'],
];
export function rankFor(stars) {
  let name = RANKS[0][1], next = null;
  for (let i = 0; i < RANKS.length; i++) {
    if (stars >= RANKS[i][0]) { name = RANKS[i][1]; next = RANKS[i + 1] || null; }
  }
  return { name, next };
}
