// 遺伝子の引きつぎ: 体の設計を変えても、同じ骨・同じ関節の軸の「動かし方」は親から受けつぐ
//   全体の遺伝子（リズムの速さなど）… そのまま
//   関節の軸ごとの遺伝子 … 「子の骨の id と軸」が同じものをコピー（新しい軸は 0 = おだやかな初期値）
//   足の組の遺伝子 … 足の骨の id が同じものをコピー
import { G_GLOBAL, G_PER, geneCount } from '../sim/nerves.js';

function groupKeys(model) {
  // グループ番号 → その代表（一次側）の「骨id:軸」
  const keys = new Array(model.nGroup).fill(null);
  for (const d of model.dofs) {
    if (d.secondary) continue;
    const jo = model.joints[d.joint];
    keys[d.group] = `${model.bodies[jo.child].id}:${d.axis}`;
  }
  return keys;
}
function footKeys(model) {
  const keys = [];
  for (const f of model.feet || []) if (!f.sec) keys[f.pair] = model.bodies[f.i].id;
  return keys;
}

// fromModel の遺伝子 genes を、toModel の並びに直す
export function inheritGenes(fromModel, genes, toModel) {
  const out = new Float64Array(geneCount(toModel));
  if (!genes) return out;
  for (let i = 0; i < G_GLOBAL; i++) out[i] = genes[i] || 0;
  const fk = groupKeys(fromModel), tk = groupKeys(toModel);
  const map = new Map(fk.map((k, g) => [k, g]));
  tk.forEach((k, g) => {
    const src = map.get(k);
    if (src === undefined) return;
    for (let j = 0; j < G_PER; j++) out[G_GLOBAL + G_PER * g + j] = genes[G_GLOBAL + G_PER * src + j] || 0;
  });
  const f0 = G_GLOBAL + G_PER * fromModel.nGroup, t0 = G_GLOBAL + G_PER * toModel.nGroup;
  const ffk = footKeys(fromModel), tfk = footKeys(toModel);
  const fmap = new Map(ffk.map((k, p) => [k, p]));
  tfk.forEach((k, p) => { const s = fmap.get(k); if (s !== undefined) out[t0 + p] = genes[f0 + s] || 0; });
  return out;
}

// どれだけ受けつげたか（0..1）: 物語の文に使う
export function inheritRatio(fromModel, toModel) {
  const fk = new Set(groupKeys(fromModel));
  const tk = groupKeys(toModel);
  if (!tk.length) return 1;
  return tk.filter(k => fk.has(k)).length / tk.length;
}
