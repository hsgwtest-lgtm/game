// tests/bench.test.js — ベンチマーク「餌集め」
//   4つの方式を、同じ世界ルール・同じ初期条件（別々の島・同じ地形・同じ出発地点）で 120 世代学ばせ、
//   学習前と学習後の腕前を「腕前テスト」（学習を止めて決まったテスト用シーズンを走らせる）で測ってくらべる。
//   数値は tests/results.json に保存する（PROGRESS.md・README の数字はここから）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, section, assert } from './harness.js';
import { Lab, MODE } from '../js/sim.js';
import { M, METHODS } from '../js/defs.js';
import { SKILLS, skillScores, makeLearner } from '../js/methods.js';
import { DAY_TICKS } from '../js/world.js';
import { mean, sd } from '../js/util.js';
import { evaluatePolicy, policyOf, initialPolicyOf, EVAL_SEEDS } from '../js/evaluate.js';

const SEEDS = [7, 11, 23];
const GENS = 120;
const ARENA_GENS = 80;
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
const pad = (s, n) => {
  // 全角は2桁ぶんとして揃える
  let w = 0;
  for (const ch of String(s)) w += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
};
const stat = (xs) => ({ mean: mean(xs), sd: sd(xs), perSeed: xs });

// 1世代目の中で、日ごとに「1匹1ターンあたり食べた草」を測る
function intakeByDay(cfg) {
  const lab = new Lab(cfg);
  const isl = lab.islands[0];
  const days = lab.cfg.days;
  const food = new Array(days).fill(0);
  const alive = new Array(days).fill(0);
  let prev = 0;
  for (let t = 0; t < lab.seasonTicks; t++) {
    const d = Math.floor(t / DAY_TICKS);
    let a = 0;
    for (const c of isl.cs) if (c.alive) a++;
    alive[d] += a;
    isl.step();
    const now = isl.fams.reduce((s, f) => s + f.food, 0);
    food[d] += now - prev;
    prev = now;
  }
  return { perDay: food.map((f, i) => f / Math.max(1, alive[i])), famFood: mean(isl.fams.map((f) => f.food)) };
}

export function registerBenchTests() {
  section(`ベンチマーク「餌集め」（別々の島・同じ初期条件・島シード ${SEEDS.join('/')} × ${GENS}世代）`);
  const R = { methods: {}, seeds: SEEDS, gens: GENS, evalSeeds: EVAL_SEEDS };

  test('4方式を学ばせて、学習前と学習後の腕前を同じテスト島で測る', () => {
    const t0 = performance.now();
    const per = {};
    for (const m of [M.RULE, M.NN, M.Q, M.DICE]) per[m] = { before: [], after: [], wFirst: [], wLast: [], lFirst: [], lLast: [], sk: [], sk0: [], reach: [], curves: [], lifeCurves: [], owl: [] };
    for (const seed of SEEDS) {
      const lab = new Lab({ seed, mode: MODE.SEPARATE });
      for (const m of lab.cfg.methods) per[m].before.push(evaluatePolicy(lab, initialPolicyOf(lab, m)));
      lab.runGenerations(GENS);
      const ruleLevel = mean(lab.hist[M.RULE].fit);
      for (const m of lab.cfg.methods) {
        const H = lab.hist[m];
        per[m].after.push(evaluatePolicy(lab, policyOf(lab, m)));
        per[m].wFirst.push(mean(H.fit.slice(0, 3)));
        per[m].wLast.push(mean(H.fit.slice(-10)));
        per[m].lFirst.push(mean(H.life.slice(0, 3)));
        per[m].lLast.push(mean(H.life.slice(-10)));
        per[m].owl.push(mean(H.owl.slice(-10)));
        per[m].sk.push(H.sk.map((s) => mean(s.slice(-10))));
        // 学習前の行動テスト: 進化する2方式は世代0の集団（世代のあいだ変わらない）、
        // Q学習は空の表（世代0の記録は1世代ぶん学んだあとなので使わない）、ルールは一定
        per[m].sk0.push(m === M.Q ? skillScores(makeLearner(M.Q, lab.cfg)) : H.sk.map((s) => s[0]));
        per[m].curves.push(H.fit.slice());
        per[m].lifeCurves.push(H.life.slice());
        // ルールの成績の 90% に（5世代の移動平均で）はじめて届いた世代
        let reach = -1;
        for (let i = 4; i < H.fit.length; i++) {
          if (mean(H.fit.slice(i - 4, i + 1)) >= 0.9 * ruleLevel) {
            reach = i;
            break;
          }
        }
        per[m].reach.push(reach);
      }
    }
    for (const m of [M.RULE, M.NN, M.Q, M.DICE]) {
      const p = per[m];
      const before = stat(p.before.map((e) => e.fit));
      const after = stat(p.after.map((e) => e.fit));
      const curve = p.curves[0].map((_, i) => mean(p.curves.map((c) => c[i])));
      const lifeCurve = p.lifeCurves[0].map((_, i) => mean(p.lifeCurves.map((c) => c[i])));
      R.methods[METHODS[m].key] = {
        name: METHODS[m].long,
        evalBefore: before,
        evalAfter: after,
        ratio: after.mean / Math.max(1e-9, before.mean),
        lifeBefore: stat(p.before.map((e) => e.life)),
        lifeAfter: stat(p.after.map((e) => e.life)),
        worldFirst3: stat(p.wFirst),
        worldLast10: stat(p.wLast),
        lifeFirst3: stat(p.lFirst),
        lifeLast10: stat(p.lLast),
        owlLast10: stat(p.owl),
        skillsLast10: SKILLS.map((s, k) => ({ skill: s.ja, mean: mean(p.sk.map((x) => x[k])) })),
        skillsGen0: SKILLS.map((s, k) => mean(p.sk0.map((x) => x[k]))),
        genReach90OfRule: p.reach,
        curveMean: curve.map((v) => Math.round(v * 100) / 100),
        lifeCurveMean: lifeCurve.map((v) => Math.round(v * 1000) / 1000),
      };
    }
    R.benchMs = Math.round(performance.now() - t0);
    console.log('\n    腕前テスト（家族あたりの草。学習を止めて同じテスト島4シーズンの平均。3つの島シードの平均±標準偏差）');
    console.log(`    ${pad('方式', 16)}${pad('学習前', 14)}${pad('学習後', 14)}${pad('倍率', 8)}${pad('世界:最初3世代', 16)}${pad('世界:最後10世代', 17)}${pad('生存日数(最初→最後)', 22)}ルールの90%到達`);
    for (const m of [M.RULE, M.NN, M.Q, M.DICE]) {
      const r = R.methods[METHODS[m].key];
      console.log(
        `    ${pad(METHODS[m].ja, 16)}${pad(`${f2(r.evalBefore.mean)}±${f2(r.evalBefore.sd)}`, 14)}${pad(`${f2(r.evalAfter.mean)}±${f2(r.evalAfter.sd)}`, 14)}${pad(`×${f2(r.ratio)}`, 8)}${pad(f2(r.worldFirst3.mean), 16)}${pad(f2(r.worldLast10.mean), 17)}${pad(`${f2(r.lifeFirst3.mean)}→${f2(r.lifeLast10.mean)}`, 22)}${r.genReach90OfRule.map((g) => (g < 0 ? '未達' : `第${g}世代`)).join(' / ')}`
      );
    }
    console.log('\n    行動テスト（学習前 → 最後の10世代の平均。1.00 = その場面で正解の行動を必ずとる。Q学習の学習前は空の表）');
    for (const m of [M.RULE, M.NN, M.Q, M.DICE]) {
      const r = R.methods[METHODS[m].key];
      console.log(`    ${pad(METHODS[m].ja, 16)}${r.skillsLast10.map((s, k) => `${s.skill} ${f2(r.skillsGen0[k])}→${f2(s.mean)}`).join('  ')}`);
    }
  });

  test('ルール（対照群）: 学習しないので、学習前後の腕前がまったく同じ', () => {
    const r = R.methods.rule;
    r.evalBefore.perSeed.forEach((v, i) => assert(v === r.evalAfter.perSeed[i], `シード${SEEDS[i]}: ${v} と ${r.evalAfter.perSeed[i]}`));
    const drift = Math.abs(r.worldLast10.mean / r.worldFirst3.mean - 1);
    assert(drift < 0.1, `世界の中の成績も横ばい（変化 ${(drift * 100).toFixed(1)}%）`);
  });
  test('進化NN: 学習後の腕前が学習前の3倍以上（かつ +5 以上）', () => {
    const r = R.methods.nn;
    assert(r.ratio >= 3 && r.evalAfter.mean - r.evalBefore.mean >= 5, `${f2(r.evalBefore.mean)} → ${f2(r.evalAfter.mean)}`);
    r.evalBefore.perSeed.forEach((v, i) => assert(r.evalAfter.perSeed[i] > v * 2, `シード${SEEDS[i]}でも改善 ${f2(v)} → ${f2(r.evalAfter.perSeed[i])}`));
  });
  test('Q学習: 学習後の腕前が学習前（空の表）の3倍以上（かつ +5 以上）', () => {
    const r = R.methods.q;
    assert(r.ratio >= 3 && r.evalAfter.mean - r.evalBefore.mean >= 5, `${f2(r.evalBefore.mean)} → ${f2(r.evalAfter.mean)}`);
    r.evalBefore.perSeed.forEach((v, i) => assert(r.evalAfter.perSeed[i] > v * 2, `シード${SEEDS[i]}でも改善 ${f2(v)} → ${f2(r.evalAfter.perSeed[i])}`));
  });
  test('ランダム＋選択: 選択だけでも学習前の1.5倍以上になる', () => {
    const r = R.methods.dice;
    assert(r.ratio >= 1.5, `${f2(r.evalBefore.mean)} → ${f2(r.evalAfter.mean)}`);
    r.evalBefore.perSeed.forEach((v, i) => assert(r.evalAfter.perSeed[i] > v, `シード${SEEDS[i]}でも改善`));
  });
  test('世界の中の学習曲線: 学ぶ3方式は、最後の10世代が世代0を大きく上回り、長生きにもなる', () => {
    for (const k of ['nn', 'q', 'dice']) {
      const r = R.methods[k];
      const g0 = r.curveMean[0];
      assert(r.worldLast10.mean > g0 * 1.3, `${k}: 世代0 ${f2(g0)} → 最後10世代 ${f2(r.worldLast10.mean)}`);
      assert(r.lifeLast10.mean > r.lifeCurveMean[0], `${k}: 生存日数 ${f2(r.lifeCurveMean[0])} → ${f2(r.lifeLast10.mean)}`);
    }
  });
  test('感覚の効果: まわりを見ない「ランダム＋選択」は、感覚を使う3方式より低いところで止まる', () => {
    const d = R.methods.dice.evalAfter.mean;
    for (const k of ['rule', 'nn', 'q']) assert(R.methods[k].evalAfter.mean > d * 1.5, `${k} ${f2(R.methods[k].evalAfter.mean)} vs dice ${f2(d)}`);
  });
  test('行動の獲得: 進化NNとQ学習は「足元の草を食べる」「においをたどる」を学習前より +0.3 以上身につける', () => {
    for (const k of ['nn', 'q']) {
      const r = R.methods[k];
      const sk = r.skillsLast10;
      const s0 = r.skillsGen0;
      assert(sk[0].mean >= 0.6 && sk[0].mean >= s0[0] + 0.3, `${k} 食べる ${f2(s0[0])} → ${f2(sk[0].mean)}`);
      assert(sk[1].mean >= 0.45 && sk[1].mean >= s0[1] + 0.3, `${k} たどる ${f2(s0[1])} → ${f2(sk[1].mean)}`);
    }
    const ds = R.methods.dice.skillsLast10;
    assert(ds[1].mean < 0.3, `まわりを見ないサイコロは、においをたどれない ${f2(ds[1].mean)}`);
  });

  test('Q学習は1世代目のうちから学ぶ: 同じ1世代目を「学ばない(α=0)」と比べる', () => {
    const rows = SEEDS.map((seed) => {
      const learn = intakeByDay({ seed, methods: [M.Q] });
      const frozen = intakeByDay({ seed, methods: [M.Q], q: { alpha: 0 } });
      const rule = intakeByDay({ seed, methods: [M.RULE] });
      return { learn, frozen, rule };
    });
    const learnFam = mean(rows.map((r) => r.learn.famFood));
    const frozenFam = mean(rows.map((r) => r.frozen.famFood));
    const day = (key, d) => mean(rows.map((r) => r[key].perDay[d]));
    R.qWithinSeason = {
      famFoodLearning: learnFam,
      famFoodNoLearning: frozenFam,
      intakePerDayLearning: [0, 1, 2].map((d) => day('learn', d)),
      intakePerDayNoLearning: [0, 1, 2].map((d) => day('frozen', d)),
      intakePerDayRule: [0, 1, 2].map((d) => day('rule', d)),
    };
    console.log(`    1世代目の家族あたりの草: 学ぶQ ${f2(learnFam)} / 学ばないQ(α=0) ${f2(frozenFam)}`);
    console.log(`    1匹1ターンあたりの草（1日目→2日目→3日目）: 学ぶQ ${R.qWithinSeason.intakePerDayLearning.map((v) => v.toFixed(4)).join('→')} / 学ばないQ ${R.qWithinSeason.intakePerDayNoLearning.map((v) => v.toFixed(4)).join('→')} / ルール ${R.qWithinSeason.intakePerDayRule.map((v) => v.toFixed(4)).join('→')}`);
    assert(learnFam > frozenFam * 2.5, '1世代目だけで、学ばない場合の2.5倍以上集める');
    assert(day('learn', 2) > day('learn', 0), '同じ世代のなかでも、日がたつほど上手になる');
  });

  section(`競争モード（同じ島で4方式・島シード 7/11 × ${ARENA_GENS}世代）`);
  test('学ぶ方式ほど島の取り分（集めた草の割合）を増やし、見ない方式は小さいまま', () => {
    const rows = [7, 11].map((seed) => {
      const lab = new Lab({ seed, mode: MODE.ARENA });
      lab.runGenerations(ARENA_GENS);
      const o = {};
      for (const m of lab.cfg.methods) {
        const H = lab.hist[m];
        o[METHODS[m].key] = { shareFirst3: mean(H.share.slice(0, 3)), shareLast10: mean(H.share.slice(-10)), foundersLast: H.founders.at(-1), shareCurve: H.share.slice() };
      }
      return o;
    });
    R.arena = {};
    for (const k of ['rule', 'nn', 'q', 'dice']) {
      R.arena[k] = {
        shareFirst3: mean(rows.map((r) => r[k].shareFirst3)),
        shareLast10: mean(rows.map((r) => r[k].shareLast10)),
        foundersLast: rows.map((r) => r[k].foundersLast),
        shareCurveMean: rows[0][k].shareCurve.map((_, i) => Math.round(mean(rows.map((r) => r[k].shareCurve[i])) * 1000) / 1000),
      };
    }
    console.log(`    取り分（最初3世代 → 最後10世代）: ${['rule', 'nn', 'q', 'dice'].map((k) => `${METHODS[['rule', 'nn', 'q', 'dice'].indexOf(k)].ja} ${f2(R.arena[k].shareFirst3)}→${f2(R.arena[k].shareLast10)}`).join(' / ')}`);
    assert(R.arena.q.shareLast10 > R.arena.q.shareFirst3 + 0.1, 'Q学習は取り分を大きく増やす');
    assert(R.arena.nn.shareLast10 > R.arena.nn.shareFirst3 + 0.05, '進化NNも取り分を増やす');
    assert(R.arena.rule.shareLast10 < R.arena.rule.shareFirst3, '最初は強いルールも、学ぶ方式に追い上げられる');
    assert(R.arena.dice.shareLast10 < 0.15, 'まわりを見ない方式は小さいまま');
  });

  test('結果を tests/results.json に保存する', () => {
    R.date = new Date().toISOString();
    R.node = process.version;
    const path = fileURLToPath(new URL('./results.json', import.meta.url));
    writeFileSync(path, JSON.stringify(R, null, 1));
    assert(true);
  });
}
