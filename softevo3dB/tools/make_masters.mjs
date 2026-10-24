// ぬし（地方の先住の生き物）を書き出す: node tools/make_masters.mjs
// tools/masters/<region>.json（train.mjs の結果）を読み、js/game/masters.js を作る
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { compileModel } from '../js/sim/model.js';
import { templateByKey } from '../js/sim/templates.js';
import { geneCount } from '../js/sim/nerves.js';
import { evaluate } from '../js/sim/sim.js';
import { REGIONS, envOf, regionAt, ERAS } from '../js/game/world.js';

const PLAN = {
  sea: { key: 'fish', name: 'ヒラリ', desc: '背骨をしならせて泳ぐサカナ' },
  shore: { key: 'lizard', name: 'ハマトカゲ', desc: '浅瀬と浜を行き来するトカゲ' },
  plain: { key: 'dog', name: 'ノハラ', desc: '草原をかける四つ足' },
  dune: { key: 'bug', name: 'スナムシ', desc: '6本の足で砂をつかむ' },
  forest: { key: 'lizard', name: 'ネッコトカゲ', desc: '木の根のあいだをすりぬける' },
  rock: { key: 'dog', name: 'イワノボリ', desc: '段差をのぼる四つ足' },
  ice: { key: 'bug', name: 'ツララムシ', desc: '氷の上でもすべらない' },
};

const out = {};
for (const [region, p] of Object.entries(PLAN)) {
  const design = templateByKey(p.key).build();
  const model = compileModel(design);
  let genes = new Float64Array(geneCount(model));
  const f = `tools/masters/${region}.json`;
  if (existsSync(f)) {
    const j = JSON.parse(readFileSync(f));
    const x = j.pick || j.x;
    if (x && x.length === genes.length) genes = Float64Array.from(x);
    else console.warn('length mismatch', region, x && x.length, genes.length);
  } else console.warn('missing', f);
  const recs = ERAS.map((e, i) => Math.max(0, evaluate(model, genes, envOf(regionAt(region, i), { assist: 0 })).dist));
  console.log(region.padEnd(7), p.name.padEnd(8), recs.map(r => r.toFixed(2)).join(' / '));
  out[region] = { ...p, genes: Array.from(genes, v => Math.round(v * 1e6) / 1e6) };
}
const src = `// 地方の「ぬし」（先住の生き物）。見本の体を、その地方の環境であらかじめ進化させたもの
// tools/make_masters.mjs が書き出す（手で直さない）
import { templateByKey } from '../sim/templates.js';

const RAW = ${JSON.stringify(out)};

export const MASTERS = {};
for (const [k, m] of Object.entries(RAW)) MASTERS[k] = { name: m.name, desc: m.desc, design: templateByKey(m.key).build(), genes: m.genes };
`;
writeFileSync('js/game/masters.js', src);
console.log('wrote js/game/masters.js');
