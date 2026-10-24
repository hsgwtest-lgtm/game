// 物理の確認: node tools/phys_test.mjs
//  1) 見本の生き物を組み立てて、質量・自由度・筋肉の数を表示
//  2) 力を抜いた（筋肉オフ）状態で倒れても壊れないか（エネルギーが増えない）
//  3) 筋肉で設計時の姿勢を保とうとしたとき、どれだけ立っていられるか
//  4) 決定論（同じ入力 → 同じ結果）と速さ
import { compileModel } from '../js/sim/model.js';
import { TEMPLATES } from '../js/sim/templates.js';
import { World, Creature } from '../js/sim/physics.js';

const flat = { h: () => 0, n: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; }, friction: 1 };

function holdPose(c, model, gain = 1) {
  // 単純なPD（目標 = 設計時の姿勢）→ てこの長さで筋肉に割りふる
  const tau = new Float64Array(model.nDof);
  for (const d of model.dofs) {
    const th = c.jang[3 * d.joint + d.axis], om = c.jvel[3 * d.joint + d.axis];
    const K = (d.Tpos + d.Tneg) / 2 / 0.35 * gain;
    const D = 2 * 0.7 * Math.sqrt(K * d.Ieff);
    tau[d.i] = -K * th - D * om;
  }
  model.muscles.forEach((m, k) => {
    let u = 0.02;
    for (const a of m.arms) {
      const d = model.dofs[a.dof];
      const T = tau[a.dof];
      if (T * a.r > 0) u += (T * a.r) / (a.r > 0 ? d.Tpos * a.r : d.Tneg * -a.r) * Math.abs(a.r) / Math.abs(a.r);
    }
    c.act[k] += ((u > 1 ? 1 : u) - c.act[k]) * 0.5;
  });
}

function energy(c) {
  let E = 0;
  for (let i = 0; i < c.n; i++) {
    const m = c.mass[i];
    E += 0.5 * m * (c.v[3 * i] ** 2 + c.v[3 * i + 1] ** 2 + c.v[3 * i + 2] ** 2) + m * 9.81 * c.pos[3 * i + 1];
  }
  return E;
}

for (const t of TEMPLATES) {
  const design = t.build();
  const model = compileModel(design);
  console.log(`\n${t.name}: bones=${model.n} mass=${model.mass.toFixed(1)}kg dofs=${model.nDof} groups=${model.nGroup} muscles=${model.muscles.length} pairs=${model.pairs.length} h=${model.size.h.toFixed(2)}m`);
  if (t.key === 'human') {
    for (const d of model.dofs) console.log(`   dof ${d.name.padEnd(10)} g${d.group}${d.secondary ? '*' : ' '} ms=${d.msign} I=${d.Ieff.toFixed(2)} T+=${d.Tpos.toFixed(0)} T-=${d.Tneg.toFixed(0)} [${(d.lo * 57.3).toFixed(0)},${(d.hi * 57.3).toFixed(0)}]`);
  }
  if (t.habitat === 'water') continue;
  // 2) 力を抜く
  {
    const w = new World(flat);
    const c = w.add(new Creature(model));
    let E0 = energy(c), Emax = E0, maxV = 0;
    for (let f = 0; f < 240; f++) {
      w.step();
      const E = energy(c); if (E > Emax) Emax = E;
      for (let i = 0; i < c.v.length; i++) maxV = Math.max(maxV, Math.abs(c.v[i]));
    }
    let minY = 1e9; for (let i = 0; i < c.n; i++) minY = Math.min(minY, c.pos[3 * i + 1]);
    console.log(`  limp:  E0=${E0.toFixed(1)} Emax=${Emax.toFixed(1)} (gain ${(Emax - E0).toFixed(2)}J) Efinal=${energy(c).toFixed(1)} maxV=${maxV.toFixed(2)} minBodyY=${minY.toFixed(3)} rootY=${c.pos[1].toFixed(3)}`);
  }
  // 3) 姿勢を保つ
  {
    const w = new World(flat);
    const c = w.add(new Creature(model));
    const y0 = c.pos[3 * model.sense + 1];
    let fell = -1;
    const t0 = performance.now();
    for (let f = 0; f < 600; f++) {
      holdPose(c, model);
      w.step();
      if (fell < 0 && c.pos[3 * model.sense + 1] < y0 * 0.7) fell = f;
    }
    const ms = performance.now() - t0;
    console.log(`  hold:  senseY ${y0.toFixed(3)} → ${c.pos[3 * model.sense + 1].toFixed(3)} fell@${fell} | ${ms.toFixed(0)}ms / 10s sim  (${(ms / 600).toFixed(2)} ms/frame)`);
    // 決定論
    const w2 = new World(flat);
    const c2 = w2.add(new Creature(model));
    for (let f = 0; f < 600; f++) { holdPose(c2, model); w2.step(); }
    let same = true; for (let i = 0; i < c.pos.length; i++) if (c.pos[i] !== c2.pos[i]) same = false;
    console.log(`  deterministic: ${same}`);
  }
}
