// defs.js — 行動・感覚・方式の定義（全モジュールで共有する定数。純粋モジュール）

// 行動（6つ）
export const ACT = { EAT: 0, N: 1, E: 2, S: 3, W: 4, SLEEP: 5 };
export const N_ACT = 6;
export const ACT_JA = ['食べる', '北へ', '東へ', '南へ', '西へ', '眠る'];
export const ACT_ICON = ['eat', 'up', 'right', 'down', 'left', 'sleep'];
export const isMove = (a) => a >= 1 && a <= 4;

// 感覚（9つ）。4つの方式は同じ感覚を受けとる（ランダム＋選択だけは見ない）
//   ENERGY 体力 0〜1 / HERE 足元の草 0〜1 / SN〜SW 各方向のにおい（その方向の草の多さ 0〜1。通れない方向は -1）
//   DARK 夜なら1 / CROWD まわりの混み具合 0〜1 / NOISE 毎ターン変わる気まぐれ -1〜1
export const OBS = { ENERGY: 0, HERE: 1, SN: 2, SE: 3, SS: 4, SW: 5, DARK: 6, CROWD: 7, NOISE: 8 };
export const N_OBS = 9;
export const OBS_JA = ['体力', '足元の草', '北のにおい', '東のにおい', '南のにおい', '西のにおい', '夜', '混雑', '気まぐれ'];

// 学習方式（4つ）
export const M = { RULE: 0, NN: 1, Q: 2, DICE: 3 };
export const METHODS = [
  {
    key: 'rule',
    ja: 'ルール',
    long: 'ルールベース',
    color: '#c7d3e3',
    dark: '#56657a',
    icon: 'rule',
    role: '対照群（学習しない）',
    desc: '人が書いた「こうしなさい」という決まりで動く。最初からそこそこ上手だが、何世代たっても変わらない。',
  },
  {
    key: 'nn',
    ja: '進化NN',
    long: '進化ニューラルネット',
    color: '#ff6fd8',
    dark: '#8a2a76',
    icon: 'brain',
    role: '選択＋交叉＋突然変異',
    desc: '自作のニューラルネット（重み91個）が脳。生きているあいだは学ばない。世代交代で、よく餌を集めた家族の脳を選び、混ぜて、少し変えて次の世代へ。',
  },
  {
    key: 'q',
    ja: 'Q学習',
    long: 'Q学習（表形式）',
    color: '#5fe6ff',
    dark: '#1f6f86',
    icon: 'qtable',
    role: '経験から学ぶ（選択なし）',
    desc: '状況を144通りに分けた「Q表」に、行動ごとの良さを書きこむ。毎ターンの経験（体力の増減）で表を直す。ε の確率で試しに別の行動をとる。',
  },
  {
    key: 'dice',
    ja: 'ランダム＋選択',
    long: 'ランダム＋選択',
    color: '#ffd84a',
    dark: '#8a6a12',
    icon: 'dice',
    role: '選択だけ（感覚なし）',
    desc: 'まわりを見ずにサイコロで行動する。遺伝するのはサイコロの偏り（どの行動が出やすいか）だけ。世代交代で、よく集めた家族のサイコロを選んで写す。',
  },
];
export const N_METHODS = METHODS.length;
