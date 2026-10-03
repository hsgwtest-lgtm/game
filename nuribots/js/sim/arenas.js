// アリーナ（16×16マス）の定義。
// 上半分（8行）だけ書くと、下半分は「180度回転」で自動的に作られる。
// → どちらのロボにとっても形がまったく同じ（公平）になる。
//   '.' 床   '#' かべ   'A' 青ロボのスタート（赤ロボは点対称の位置）

export const GW = 16, GH = 16, GN = GW * GH;

const DEFS = [
  {
    id: 0, key: 'plaza', name: 'ひろば', desc: 'なにもない広場。ぬる速さの勝負', items: false,
    top: [
      '................',
      '................',
      '..A.............',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  {
    id: 1, key: 'pillars', name: 'はしら', desc: '4本の柱とペンキ爆弾', items: true,
    top: [
      '................',
      '................',
      '..A.............',
      '................',
      '....##....##....',
      '....##....##....',
      '................',
      '................',
    ],
  },
  {
    id: 2, key: 'pond', name: 'いけ', desc: 'まんなかの池をまわりこめ', items: true,
    top: [
      '................',
      '................',
      '..A.............',
      '................',
      '................',
      '.......##.......',
      '.....######.....',
      '....########....',
    ],
  },
  {
    id: 3, key: 'islands', name: 'しま', desc: '3本の橋でつながった島', items: true,
    top: [
      '................',
      '................',
      '..A.............',
      '................',
      '................',
      '................',
      '................',
      '###.###..###.###',
    ],
  },
  {
    id: 4, key: 'maze', name: 'めいろ', desc: '曲がり角だらけ。見通しが悪い', items: true,
    top: [
      '................',
      '.A....#.........',
      '......#..####...',
      '.###..#.....#...',
      '......####..#.##',
      '..#.........#...',
      '..#..###........',
      '..#....#...##...',
    ],
  },
  {
    id: 5, key: 'zigzag', name: 'ジグザグ', desc: '長いかべが行く手をふさぐ', items: true,
    top: [
      '................',
      '..A.............',
      '................',
      '...#######......',
      '................',
      '........#######.',
      '................',
      '.######.........',
    ],
  },
];

function build(def) {
  const rows = def.top.slice();
  for (let y = 7; y >= 0; y--) rows.push(rows[y].split('').reverse().join(''));
  const wall = new Uint8Array(GN);
  let ax = -1, ay = -1;
  for (let y = 0; y < GH; y++) {
    const r = rows[y];
    if (r.length !== GW) throw new Error(`arena ${def.key}: row ${y} length ${r.length}`);
    for (let x = 0; x < GW; x++) {
      const ch = r[x];
      if (ch === '#') wall[y * GW + x] = 1;
      if (ch === 'A' && y < 8) { ax = x; ay = y; }
    }
  }
  if (ax < 0) throw new Error(`arena ${def.key}: no start`);
  const bx = GW - 1 - ax, by = GH - 1 - ay;
  // つながっているか確認（全部の床にたどり着けること）
  const seen = new Uint8Array(GN);
  const q = [ay * GW + ax];
  seen[q[0]] = 1;
  let reach = 0;
  while (q.length) {
    const c = q.pop();
    reach++;
    const x = c % GW, y = (c / GW) | 0;
    const nb = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx;
      if (wall[n] || seen[n]) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  let floor = 0;
  for (let i = 0; i < GN; i++) if (!wall[i]) floor++;
  if (reach !== floor) throw new Error(`arena ${def.key}: not connected (${reach}/${floor})`);
  return {
    ...def, rows, wall, floor,
    start: [{ x: ax, y: ay }, { x: bx, y: by }],
  };
}

export const ARENAS = DEFS.map(build);
export const N_ARENAS = ARENAS.length;
