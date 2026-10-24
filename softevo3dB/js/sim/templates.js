// 見本の生き物（設計図）。どれも自由に改造できる、ただの出発点。
// 座標: +X 前, +Y 上, +Z 右。右側（z>0）と中心の骨だけ書き、左側は withMirrors で作る。

import { withMirrors, grounded } from './design.js';

const H = (lo, hi) => [[lo, hi], [0, 0], [0, 0]];

function make(name, bones, extra = {}) {
  return grounded({ v: 1, name, bones: withMirrors(bones), ...extra });
}

export const TEMPLATES = [
  {
    key: 'blank', name: '白紙', desc: '胴だけ。ここから骨をのばしていく', habitat: 'any',
    build: () => make('ナナシ', [
      { id: 'body', name: '胴', parent: null, a: [-0.12, 0.1, 0], b: [0.12, 0.1, 0], r: 0.06 },
    ]),
  },
  {
    key: 'fish', name: 'サカナ', desc: '背骨をくねらせて泳ぐ', habitat: 'water',
    build: () => make('サカナ', [
      { id: 'head', name: '頭', parent: null, a: [0.16, 0.3, 0], b: [0.26, 0.3, 0], r: 0.045 },
      { id: 's1', name: '背骨1', parent: 'head', j: [0.11, 0.3, 0], a: [0.11, 0.3, 0], b: [0.01, 0.3, 0], r: 0.042, joint: { type: 'saddle', lim: [[-8, 8], [-35, 35]] } },
      { id: 's2', name: '背骨2', parent: 's1', j: [-0.04, 0.3, 0], a: [-0.04, 0.3, 0], b: [-0.13, 0.3, 0], r: 0.036, joint: { type: 'saddle', lim: [[-8, 8], [-35, 35]] } },
      { id: 's3', name: '背骨3', parent: 's2', j: [-0.17, 0.3, 0], a: [-0.17, 0.3, 0], b: [-0.25, 0.3, 0], r: 0.028, joint: { type: 'saddle', lim: [[-8, 8], [-40, 40]] } },
      { id: 'tail', name: 'しっぽ', parent: 's3', j: [-0.28, 0.3, 0], a: [-0.28, 0.3, 0], b: [-0.37, 0.3, 0], r: 0.02, joint: { type: 'saddle', lim: [[-8, 8], [-45, 45]] } },
    ]),
  },
  {
    key: 'lizard', name: 'トカゲ', desc: '横に張りだした4本の足', habitat: 'land',
    build: () => make('トカゲ', [
      { id: 'body', name: '胴', parent: null, a: [-0.12, 0.12, 0], b: [0.12, 0.12, 0], r: 0.06 },
      { id: 'head', name: '頭', parent: 'body', j: [0.19, 0.12, 0], a: [0.22, 0.12, 0], b: [0.27, 0.12, 0], r: 0.045, joint: { type: 'saddle', lim: [[-15, 15], [-25, 25]] } },
      { id: 'tail', name: 'しっぽ', parent: 'body', j: [-0.19, 0.12, 0], a: [-0.2, 0.12, 0], b: [-0.42, 0.1, 0], r: 0.035, joint: { type: 'saddle', lim: [[-15, 15], [-35, 35]] } },
      { id: 'armR', name: '右うで', parent: 'body', j: [0.1, 0.12, 0.06], a: [0.1, 0.12, 0.06], b: [0.12, 0.11, 0.2], r: 0.025, joint: { type: 'ball', lim: [[-45, 45], [-50, 40], [0, 0]] } },
      { id: 'handR', name: '右手', parent: 'armR', j: [0.12, 0.11, 0.2], a: [0.12, 0.11, 0.2], b: [0.13, 0.02, 0.22], r: 0.02, joint: { type: 'hinge', lim: [[-60, 60]] } },
      { id: 'legR', name: '右もも', parent: 'body', j: [-0.1, 0.12, 0.06], a: [-0.1, 0.12, 0.06], b: [-0.12, 0.11, 0.2], r: 0.028, joint: { type: 'ball', lim: [[-45, 45], [-50, 40], [0, 0]] } },
      { id: 'footR', name: '右足', parent: 'legR', j: [-0.12, 0.11, 0.2], a: [-0.12, 0.11, 0.2], b: [-0.13, 0.02, 0.22], r: 0.02, joint: { type: 'hinge', lim: [[-60, 60]] } },
    ]),
  },
  {
    key: 'dog', name: 'イヌ', desc: '体の下にまっすぐ伸びた4本の足', habitat: 'land',
    build: () => make('イヌ', [
      { id: 'body', name: '胴', parent: null, a: [-0.24, 0.48, 0], b: [0.22, 0.48, 0], r: 0.085 },
      { id: 'head', name: '頭', parent: 'body', j: [0.3, 0.52, 0], a: [0.36, 0.56, 0], b: [0.44, 0.56, 0], r: 0.06, joint: { type: 'saddle', lim: [[-30, 30], [-30, 30]] } },
      { id: 'tail', name: 'しっぽ', parent: 'body', j: [-0.32, 0.5, 0], a: [-0.33, 0.5, 0], b: [-0.5, 0.55, 0], r: 0.022, joint: { type: 'saddle', lim: [[-30, 40], [-40, 40]] } },
      { id: 'fArmR', name: '右前あし上', parent: 'body', j: [0.2, 0.44, 0.07], a: [0.2, 0.44, 0.07], b: [0.2, 0.25, 0.08], r: 0.034, joint: { type: 'ball', lim: [[-70, 60], [-15, 25], [0, 0]], str: 1.3 } },
      { id: 'fLegR', name: '右前あし下', parent: 'fArmR', j: [0.2, 0.245, 0.08], a: [0.2, 0.245, 0.08], b: [0.2, 0.03, 0.08], r: 0.026, joint: { type: 'hinge', lim: [[-30, 100]], str: 1.6 } },
      { id: 'hThighR', name: '右後あし上', parent: 'body', j: [-0.22, 0.44, 0.07], a: [-0.22, 0.44, 0.07], b: [-0.18, 0.25, 0.08], r: 0.04, joint: { type: 'ball', lim: [[-60, 70], [-15, 25], [0, 0]], str: 1.3 } },
      { id: 'hLegR', name: '右後あし下', parent: 'hThighR', j: [-0.18, 0.245, 0.08], a: [-0.18, 0.245, 0.08], b: [-0.22, 0.03, 0.08], r: 0.03, joint: { type: 'hinge', lim: [[-100, 30]], str: 1.6 } },
    ]),
  },
  {
    key: 'bug', name: 'ムシ', desc: '6本の足で、いつも3本ずつ地面をつかむ', habitat: 'land',
    build: () => {
      const bones = [
        { id: 'thorax', name: '胸', parent: null, a: [-0.05, 0.1, 0], b: [0.05, 0.1, 0], r: 0.035 },
        { id: 'head', name: '頭', parent: 'thorax', j: [0.09, 0.1, 0], a: [0.11, 0.105, 0], b: [0.13, 0.105, 0], r: 0.028, joint: { type: 'saddle', lim: [[-20, 20], [-20, 20]] } },
        { id: 'abd', name: 'はら', parent: 'thorax', j: [-0.085, 0.1, 0], a: [-0.11, 0.1, 0], b: [-0.2, 0.095, 0], r: 0.04, joint: { type: 'saddle', lim: [[-15, 15], [-15, 15]] } },
      ];
      [['f', '前', 0.05, 0.04], ['m', '中', 0, 0], ['h', '後', -0.05, -0.04]].forEach(([k, nm, x, fx]) => {
        bones.push({ id: `${k}FemR`, name: `右${nm}あし上`, parent: 'thorax', j: [x, 0.1, 0.03], a: [x, 0.1, 0.03], b: [x + fx, 0.13, 0.1], r: 0.015, dens: 1.5, joint: { type: 'ball', lim: [[-40, 40], [-35, 35], [0, 0]], str: 1.3 } });
        bones.push({ id: `${k}TibR`, name: `右${nm}あし下`, parent: `${k}FemR`, j: [x + fx, 0.13, 0.1], a: [x + fx, 0.13, 0.1], b: [x + fx * 1.6, 0.014, 0.15], r: 0.013, dens: 1.5, joint: { type: 'hinge', lim: [[-60, 60]], str: 1.4 } });
      });
      return make('ムシ', bones);
    },
  },
  {
    key: 'frog', name: 'カエル', desc: '長くたたんだ後ろ足で、はねる', habitat: 'land',
    build: () => make('カエル', [
      { id: 'body', name: '胴', parent: null, a: [-0.06, 0.085, 0], b: [0.06, 0.1, 0], r: 0.05 },
      { id: 'armR', name: '右うで', parent: 'body', j: [0.05, 0.075, 0.04], a: [0.05, 0.075, 0.04], b: [0.07, 0.045, 0.08], r: 0.014, joint: { type: 'ball', lim: [[-50, 50], [-40, 40], [0, 0]] } },
      { id: 'handR', name: '右手', parent: 'armR', j: [0.07, 0.045, 0.08], a: [0.07, 0.045, 0.08], b: [0.085, 0.008, 0.09], r: 0.011, joint: { type: 'hinge', lim: [[-60, 60]] } },
      { id: 'thighR', name: '右もも', parent: 'body', j: [-0.05, 0.075, 0.045], a: [-0.05, 0.075, 0.045], b: [0.01, 0.06, 0.1], r: 0.022, joint: { type: 'ball', lim: [[-70, 70], [-40, 40], [0, 0]], str: 1.6 } },
      { id: 'shinR', name: '右すね', parent: 'thighR', j: [0.01, 0.06, 0.1], a: [0.01, 0.06, 0.1], b: [-0.07, 0.035, 0.11], r: 0.018, joint: { type: 'hinge', lim: [[-110, 110]], str: 1.8 } },
      { id: 'footR', name: '右足', parent: 'shinR', j: [-0.07, 0.035, 0.11], shape: 'box', a: [-0.08, 0.009, 0.11], b: [0.0, 0.009, 0.12], r: 0.009, w: 0.045, joint: { type: 'hinge', lim: [[-90, 90]], str: 2 } },
    ]),
  },
  {
    key: 'bird', name: 'トリ', desc: 'しっぽでつりあいをとる二本足', habitat: 'land',
    build: () => make('トリ', [
      { id: 'body', name: '胴', parent: null, a: [-0.1, 0.46, 0], b: [0.1, 0.5, 0], r: 0.08, sense: true },
      { id: 'neck', name: '首', parent: 'body', j: [0.16, 0.52, 0], a: [0.18, 0.55, 0], b: [0.22, 0.67, 0], r: 0.03, joint: { type: 'saddle', lim: [[-30, 30], [-20, 20]] } },
      { id: 'head', name: '頭', parent: 'neck', j: [0.23, 0.7, 0], a: [0.24, 0.71, 0], b: [0.31, 0.71, 0], r: 0.035, joint: { type: 'hinge', lim: [[-30, 30]] } },
      { id: 'tail', name: 'しっぽ', parent: 'body', j: [-0.17, 0.47, 0], a: [-0.18, 0.47, 0], b: [-0.34, 0.5, 0], r: 0.03, joint: { type: 'saddle', lim: [[-30, 30], [-30, 30]] } },
      { id: 'thighR', name: '右もも', parent: 'body', j: [0, 0.42, 0.06], a: [0, 0.42, 0.06], b: [0.06, 0.28, 0.07], r: 0.035, joint: { type: 'ball', lim: [[-70, 50], [-20, 30], [0, 0]], arm: 0.04, str: 1.4 } },
      { id: 'shinR', name: '右すね', parent: 'thighR', j: [0.06, 0.275, 0.07], a: [0.06, 0.275, 0.07], b: [-0.02, 0.075, 0.07], r: 0.025, joint: { type: 'hinge', lim: [[-50, 90]], arm: 0.035, str: 2.0 } },
      { id: 'footR', name: '右足', parent: 'shinR', j: [-0.02, 0.06, 0.07], shape: 'box', a: [-0.05, 0.015, 0.07], b: [0.09, 0.015, 0.07], r: 0.015, w: 0.06, joint: { type: 'saddle', lim: [[-40, 40], [-15, 15]], arm: 0.035, str: 3 } },
    ]),
  },
  {
    key: 'human', name: 'ヒト', desc: '二本足で立つ。腕と背骨もある', habitat: 'land',
    build: () => make('ヒト', [
      { id: 'pelvis', name: '骨盤', parent: null, a: [0, 0.95, -0.085], b: [0, 0.95, 0.085], r: 0.1 },
      { id: 'abdomen', name: 'おなか', parent: 'pelvis', j: [0, 1.0, 0], a: [0, 1.03, 0], b: [0, 1.15, 0], r: 0.095, joint: { type: 'ball', lim: [[-25, 30], [-20, 20], [-25, 25]], arm: 0.06, str: 1.2 } },
      { id: 'chest', name: '胸', parent: 'abdomen', j: [0, 1.2, 0], a: [0, 1.34, -0.06], b: [0, 1.34, 0.06], r: 0.13, joint: { type: 'fixed' }, sense: true },
      { id: 'head', name: '頭', parent: 'chest', j: [0, 1.5, 0], a: [0.01, 1.62, 0], b: [0.01, 1.62, 0], r: 0.095, joint: { type: 'fixed' } },
      { id: 'uArmR', name: '右上腕', parent: 'chest', j: [0, 1.43, 0.19], a: [0, 1.43, 0.19], b: [0, 1.15, 0.2], r: 0.042, joint: { type: 'ball', lim: [[-60, 100], [-5, 80], [0, 0]], arm: 0.04 } },
      { id: 'fArmR', name: '右前腕', parent: 'uArmR', j: [0, 1.14, 0.2], a: [0, 1.14, 0.2], b: [0, 0.86, 0.2], r: 0.034, joint: { type: 'hinge', lim: [[0, 140]], arm: 0.035 } },
      { id: 'thighR', name: '右もも', parent: 'pelvis', j: [0, 0.92, 0.09], a: [0, 0.92, 0.09], b: [0, 0.52, 0.09], r: 0.068, joint: { type: 'ball', lim: [[-20, 110], [-20, 40], [0, 0]], arm: 0.06, str: 1.4 } },
      { id: 'shinR', name: '右すね', parent: 'thighR', j: [0, 0.505, 0.09], a: [0, 0.505, 0.09], b: [0, 0.1, 0.09], r: 0.048, joint: { type: 'hinge', lim: [[-140, 0]], arm: 0.045, str: 2.4 } },
      { id: 'footR', name: '右足', parent: 'shinR', j: [0, 0.085, 0.09], shape: 'box', a: [-0.075, 0.035, 0.09], b: [0.19, 0.035, 0.09], r: 0.032, w: 0.105, joint: { type: 'saddle', lim: [[-40, 25], [-15, 15]], arm: 0.05, str: 4 } },
    ], {
      muscles: {
        extra: [
          { id: 'hamR', name: '右ハムストリング', from: 'pelvis', to: 'shinR', sides: [-1, -1], f: 0.7 },
          { id: 'hamL', name: '左ハムストリング', from: 'pelvis', to: 'shinL', sides: [-1, -1], f: 0.7 },
          { id: 'rfR', name: '右大腿直筋', from: 'pelvis', to: 'shinR', sides: [1, 1], f: 0.6 },
          { id: 'rfL', name: '左大腿直筋', from: 'pelvis', to: 'shinL', sides: [1, 1], f: 0.6 },
          { id: 'gasR', name: '右ふくらはぎ', from: 'thighR', to: 'footR', sides: [-1, -1], f: 1.2 },
          { id: 'gasL', name: '左ふくらはぎ', from: 'thighL', to: 'footL', sides: [-1, -1], f: 1.2 },
        ],
      },
    }),
  },
];

export function templateByKey(key) { return TEMPLATES.find(t => t.key === key) || TEMPLATES[0]; }
