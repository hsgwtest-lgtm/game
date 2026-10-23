// おてほんの生き物（設計図）
// layers[y] = 上から見た図。行 = z（上の行が左側 z<0）、列 = x（右へ行くほど前 x>0）
// b=ほね s=やわらか i=ツルツル A〜F=筋肉（同じ文字＝同じ神経）

const CODE = { b: 1, s: 2, i: 3, A: 4, B: 5, C: 6, D: 7, E: 8, F: 9 };

export function fromLayers(layers, x0, z0) {
  const vox = [];
  layers.forEach((rows, y) => rows.forEach((row, r) => {
    [...row].forEach((ch, c) => { const m = CODE[ch]; if (m) vox.push([x0 + c, y, z0 + r, m]); });
  }));
  return vox;
}

export const PRESETS = [
  {
    key: 'inu', name: 'イヌ', desc: '4本足。足の筋肉が4色',
    voxels: fromLayers([
      ['C...A', '.....', 'D...B'],
      ['C...A', '.....', 'D...B'],
      ['bbbbb', 'bbbbb', 'bbbbb'],
      ['....b', '....b', '....b'],
    ], -2, -1),
  },
  {
    key: 'tokage', name: 'トカゲ', desc: '外がわに長い足。どっしり安定',
    voxels: fromLayers([
      ['C...A', '.....', '.....', '.....', 'D...B'],
      ['C...A', '.....', '.....', '.....', 'D...B'],
      ['C...A', 'bbbbb', 'bbbbb', 'bbbbb', 'D...B'],
    ], -2, -2),
  },
  {
    key: 'kani', name: 'カニ', desc: '6本足。左右3本ずつ',
    voxels: fromLayers([
      ['E.C.A', '.....', '.....', '.....', 'F.D.B'],
      ['E.C.A', 'bbbbb', 'bbbbb', 'bbbbb', 'F.D.B'],
      ['.....', '.bbb.', '.bbb.', '.bbb.', '.....'],
    ], -2, -2),
  },
  {
    key: 'kaeru', name: 'カエル', desc: '大きな後ろ足でけりだす',
    voxels: fromLayers([
      ['CC..A', '.....', 'DD..B'],
      ['Cbbbb', 'bbbbb', 'Dbbbb'],
      ['.bbbb', '.bbbb', '.bbbb'],
    ], -2, -1),
  },
  {
    key: 'imomushi', name: 'イモムシ', desc: '背中とおなかの筋肉で体をまげる',
    voxels: fromLayers([
      ['sCCCCCs'],
      ['bAAAAAb'],
    ], -3, 0),
  },
  {
    key: 'hebi', name: 'ヘビ', desc: '左右の筋肉で体をくねらせる',
    voxels: fromLayers([
      ['ACEACEA.', 'bbbbbbbb', 'BDFBDFB.'],
    ], -4, -1),
  },
  {
    key: 'slime', name: 'スライム', desc: 'まるごと筋肉。ぷるぷる動く',
    voxels: fromLayers([
      ['CsA', 'sbs', 'DsB'],
      ['CsA', 'sbs', 'DsB'],
    ], -1, -1),
  },
];

export function presetByKey(key) { return PRESETS.find(p => p.key === key) || PRESETS[0]; }
