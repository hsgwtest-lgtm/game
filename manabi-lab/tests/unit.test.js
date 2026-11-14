// tests/unit.test.js — 学習エンジン（純粋モジュール）の単体テスト
import { test, section, assert, eq, near, deepEq } from './harness.js';
import { RNG, hash32, mean, f32ToB64, b64ToF32 } from '../js/util.js';
import { G, NC, DX, DY, RULES, makeTerrain, DAY_TICKS, nightAt } from '../js/world.js';
import { ACT, N_ACT, OBS, M } from '../js/defs.js';
import * as NN from '../js/nn.js';
import * as Q from '../js/qlearn.js';
import { nextGeneration, tournament } from '../js/ga.js';
import { ruleDecide, diceProbs, diceCum, skillScores, PROBES, makeLearner } from '../js/methods.js';
import { SpeciesBook } from '../js/species.js';
import { Lab, normalizeCfg, MODE } from '../js/sim.js';
import { recordReplay } from '../js/replay.js';
import { evaluatePolicy, policyOf, initialPolicyOf } from '../js/evaluate.js';

const obs = (e, here, sn, se, ss, sw, dark = 0, crowd = 0, noise = 0) => Float32Array.from([e, here, sn, se, ss, sw, dark, crowd, noise]);

export function registerUnitTests() {
  section('乱数と道具');
  test('同じシードの乱数は同じ列になる', () => {
    const a = new RNG(42);
    const b = new RNG(42);
    for (let i = 0; i < 1000; i++) eq(a.next(), b.next());
    const c = new RNG(43);
    assert(new RNG(42).next() !== c.next(), 'シードがちがえば列もちがう');
  });
  test('乱数の平均・ガウス乱数の分散がだいたい正しい', () => {
    const r = new RNG(7);
    const xs = [];
    const gs = [];
    for (let i = 0; i < 20000; i++) {
      xs.push(r.next());
      gs.push(r.gauss());
    }
    near(mean(xs), 0.5, 0.01, '一様乱数の平均');
    near(mean(gs), 0, 0.03, 'ガウスの平均');
    near(mean(gs.map((g) => g * g)), 1, 0.05, 'ガウスの分散');
  });
  test('hash32 は決定的で、入力が少しちがうと大きく変わる', () => {
    eq(hash32(1, 2, 3), hash32(1, 2, 3));
    assert(hash32(1, 2, 3) !== hash32(1, 2, 4));
  });
  test('Float32Array ⇔ base64 の往復で値が変わらない', () => {
    const f = Float32Array.from([0, 1.5, -3.25, 1e-7, 123456.789]);
    deepEq(Array.from(b64ToF32(f32ToB64(f))), Array.from(f));
  });

  section('島（地形・草・昼夜）');
  test('同じシードからは同じ島ができる', () => {
    const a = makeTerrain(20261114);
    const b = makeTerrain(20261114);
    deepEq(Array.from(a.level), Array.from(b.level));
    deepEq(Array.from(a.type), Array.from(b.type));
    deepEq(Array.from(a.grass0), Array.from(b.grass0));
  });
  test('歩ける陸地は1つにつながっていて、広さがほどよい（10個のシード）', () => {
    for (let s = 1; s <= 10; s++) {
      const t = makeTerrain(s * 977);
      assert(t.landCount >= NC * 0.3 && t.landCount <= NC * 0.65, `陸地の割合 ${t.landCount / NC}`);
      const seen = new Uint8Array(NC);
      const st = [t.land[0]];
      seen[t.land[0]] = 1;
      let n = 0;
      while (st.length) {
        const k = st.pop();
        n++;
        const x = k % G;
        const y = (k / G) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
          const m = ny * G + nx;
          if (t.walk[m] && !seen[m]) {
            seen[m] = 1;
            st.push(m);
          }
        }
      }
      eq(n, t.landCount, `シード${s * 977}: つながった陸地`);
      for (let i = 0; i < G; i++) for (const k of [i, (G - 1) * G + i, i * G, i * G + G - 1]) eq(t.walk[k], 0, '島のふちは海');
      for (const k of t.land) assert(t.grass0[k] >= 0 && t.grass0[k] <= t.fert[k] + 1e-6, '最初の草は育ちやすさ以下');
    }
  });
  test('1日は48ターンで、うち14ターンが夜', () => {
    let nights = 0;
    for (let t = 0; t < DAY_TICKS; t++) if (nightAt(t)) nights++;
    eq(nights, 14);
    eq(nightAt(0), false);
    eq(nightAt(DAY_TICKS - 1), true);
  });

  section('ニューラルネット（nn.js）');
  test('重みが全部0なら点数はかたよりの値そのもの', () => {
    const w = new Float32Array(NN.N_W);
    w[NN.OFF_BE] = 1.5;
    w[NN.OFF_BS] = -0.5;
    w[NN.OFF_BM] = 0.25;
    const hid = new Float32Array(NN.N_HID);
    const out = new Float32Array(NN.N_OUT);
    NN.forward(w, obs(0.5, 0.5, 0.2, 0.3, 0.4, -1), hid, out);
    near(out[ACT.EAT], 1.5, 1e-6);
    near(out[ACT.SLEEP], -0.5, 1e-6);
    for (let d = 0; d < 4; d++) near(out[1 + d], 0.25, 1e-6);
    eq(NN.argmax(out), ACT.EAT);
  });
  test('手計算した値と一致する（全体回路の1ニューロン）', () => {
    const w = new Float32Array(NN.N_W);
    // 中間0 = tanh(0.3 + 2×足元の草)、食べる = 1.5×中間0
    w[NN.OFF_WG + 0 * NN.G_IN + 1] = 2;
    w[NN.OFF_BG + 0] = 0.3;
    w[NN.OFF_WE + 0] = 1.5;
    const hid = new Float32Array(NN.N_HID);
    const out = new Float32Array(NN.N_OUT);
    NN.forward(w, obs(0, 0.4, 0, 0, 0, 0), hid, out);
    near(hid[0], Math.tanh(0.3 + 0.8), 1e-6);
    near(out[ACT.EAT], 1.5 * Math.tanh(1.1), 1e-6);
  });
  test('方向回路は4方向で同じ重み: においを回すと「歩く」点数も同じだけ回る', () => {
    const r = new RNG(3);
    for (let trial = 0; trial < 20; trial++) {
      const w = NN.randomBrain(r, 1.2);
      const s = [r.next(), r.next(), -1, r.next()];
      const hid = new Float32Array(NN.N_HID);
      const a = new Float32Array(NN.N_OUT);
      const b = new Float32Array(NN.N_OUT);
      NN.forward(w, obs(0.6, 0.1, s[0], s[1], s[2], s[3], 0, 0.2, 0.1), hid, a);
      NN.forward(w, obs(0.6, 0.1, s[3], s[0], s[1], s[2], 0, 0.2, 0.1), hid, b);
      for (let d = 0; d < 4; d++) near(b[1 + ((d + 1) % 4)], a[1 + d], 1e-5, '回した点数');
      near(a[ACT.EAT], b[ACT.EAT], 1e-6);
      near(a[ACT.SLEEP], b[ACT.SLEEP], 1e-6);
    }
  });
  test('交叉した子の重みは必ずどちらかの親のもの・突然変異は範囲内', () => {
    const r = new RNG(5);
    const a = NN.randomBrain(r);
    const b = NN.randomBrain(r);
    const c = NN.crossover(a, b, r);
    for (let i = 0; i < NN.N_W; i++) assert(c[i] === a[i] || c[i] === b[i], `重み${i}`);
    const m = NN.mutate(c.slice(), r, 1, 3);
    for (let i = 0; i < NN.N_W; i++) assert(Math.abs(m[i]) <= NN.W_MAX + 1e-6);
    eq(NN.distance(a, a), 0);
    assert(NN.distance(a, b) > 0.5, 'でたらめな2つの脳は遠い');
  });

  section('遺伝的アルゴリズム（ga.js）');
  test('トーナメント選択は適応度の高いものを選びやすい', () => {
    const r = new RNG(9);
    const fits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const cnt = new Array(10).fill(0);
    for (let i = 0; i < 5000; i++) cnt[tournament(fits, 3, r)]++;
    assert(cnt[9] > cnt[5] && cnt[5] > cnt[0], `選ばれた回数 ${cnt}`);
  });
  test('おもちゃの問題（遺伝子の合計を大きく）で世代ごとに良くなり、エリートはそのまま残る', () => {
    const r = new RNG(11);
    let pop = Array.from({ length: 16 }, (_, i) => ({ g: Float32Array.from({ length: 6 }, () => r.gauss()), gid: i }));
    const fit = (g) => g.reduce((a, b) => a + b, 0);
    const ops = {
      clone: (g) => g.slice(),
      crossover: (a, b, rr) => a.map((v, i) => (rr.next() < 0.5 ? v : b[i])),
      mutate: (g, rr) => {
        for (let i = 0; i < g.length; i++) if (rr.next() < 0.3) g[i] += rr.gauss() * 0.3;
        return g;
      },
    };
    const first = mean(pop.map((p) => fit(p.g)));
    let gid = 100;
    for (let gen = 0; gen < 30; gen++) {
      const parents = pop.map((p) => ({ ...p, fit: fit(p.g) }));
      const best = parents.reduce((a, b) => (b.fit > a.fit ? b : a));
      const next = nextGeneration(parents, 16, ops, { elite: 2, tour: 3, cx: 0.6 }, r);
      assert(next[0].elite && Array.from(next[0].g).join() === Array.from(best.g).join(), 'いちばん良い個体はそのまま残る');
      pop = next.map((x) => ({ g: x.g, gid: gid++ }));
    }
    const last = mean(pop.map((p) => fit(p.g)));
    assert(last > first + 3, `平均の適応度 ${first.toFixed(2)} → ${last.toFixed(2)}`);
  });

  section('Q学習（qlearn.js）');
  test('状態番号は144通りで、分解して組み立て直すと元にもどる', () => {
    eq(Q.N_STATES, 144);
    for (let s = 0; s < Q.N_STATES; s++) {
      const p = Q.stateParts(s);
      eq(Q.stateIndex(p.e, p.g, p.d, p.st, p.n), s);
    }
  });
  test('状態の作り方: 通れない方向は選ばず、同点なら向いている方を選ぶ', () => {
    let p = Q.stateParts(Q.stateOf(obs(0.5, 0, 0.1, 0.9, 0.2, -1), 0));
    eq(p.d, 1, 'においの強い東');
    eq(p.st, 1, 'におう');
    p = Q.stateParts(Q.stateOf(obs(0.5, 0, 0, 0, 0, 0), 2));
    eq(p.d, 2, '同点なら向いている南');
    eq(p.st, 0, 'うすい');
    p = Q.stateParts(Q.stateOf(obs(0.5, 0, -1, -1, -1, 0), 0));
    eq(p.d, 3, '通れるのは西だけ');
    p = Q.stateParts(Q.stateOf(obs(0.9, 0.5, 0, 0, 0, 0, 1), 0));
    eq(p.e, 2);
    eq(p.g, 2);
    eq(p.n, 1);
  });
  test('TD 更新の式: Q ← Q + α(r + γ maxQ(s′) − Q)', () => {
    const q = Q.newTable();
    q[5 * N_ACT + 2] = 1.0;
    q[7 * N_ACT + 0] = 2.0;
    q[7 * N_ACT + 4] = 3.0;
    const err = Q.tdUpdate(q, 5, 2, 0.5, 7, 0.1, 0.9);
    near(err, 0.5 + 0.9 * 3 - 1, 1e-6);
    near(q[5 * N_ACT + 2], 1 + 0.1 * (0.5 + 2.7 - 1), 1e-6);
    Q.tdUpdate(q, 5, 2, -1, -1, 0.5, 0.9);
    near(q[5 * N_ACT + 2], 1.22 + 0.5 * (-1 - 1.22), 1e-5, '終わり（死）は先を見ない');
  });
  test('同点のくじ引きは最大のものからだけ選ぶ', () => {
    const q = Q.newTable();
    q[3 * N_ACT + 1] = 1;
    q[3 * N_ACT + 4] = 1;
    const r = new RNG(1);
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(Q.greedy(q, 3, r));
    deepEq([...seen].sort(), [1, 4]);
    near(Q.greedyShare(q, 3, 1), 0.5, 1e-9);
    eq(Q.greedyShare(q, 3, 0), 0);
  });
  test('おもちゃの一本道（右へ行けばゴール）で正しい方針を学ぶ', () => {
    const q = Q.newTable();
    const r = new RNG(2);
    for (let ep = 0; ep < 300; ep++) {
      let s = 0;
      for (let t = 0; t < 50; t++) {
        const a = Q.epsGreedy(q, s, 0.2, r);
        const s2 = a === ACT.E ? s + 1 : a === ACT.W ? Math.max(0, s - 1) : s;
        if (s2 === 5) {
          Q.tdUpdate(q, s, a, 1, -1, 0.2, 0.9);
          break;
        }
        Q.tdUpdate(q, s, a, -0.01, s2, 0.2, 0.9);
        s = s2;
      }
    }
    for (let s = 0; s < 5; s++) eq(Q.greedy(q, s, r), ACT.E, `位置${s}では右へ`);
  });
  test('ε はだんだん小さくなり、下限で止まる', () => {
    const c = { eps0: 0.3, epsDecay: 0.9, epsMin: 0.05 };
    near(Q.epsAt(0, c), 0.3, 1e-9);
    assert(Q.epsAt(5, c) < Q.epsAt(1, c));
    near(Q.epsAt(500, c), 0.05, 1e-9);
  });

  section('ルールとサイコロ');
  test('ルールは行動テストを全部合格する（手で正解を書いたので）', () => {
    const L = makeLearner(M.RULE, normalizeCfg({}));
    deepEq(skillScores(L), [1, 1, 1]);
  });
  test('ルール: 夜で満腹なら眠る／足元に草があれば食べる／においの方へ歩く', () => {
    const r = new RNG(1);
    eq(ruleDecide(obs(0.8, 0, 0.1, 0.1, 0.1, 0.1, 1), r, 0, {}), ACT.SLEEP);
    eq(ruleDecide(obs(0.5, 0.6, 0, 0, 0, 0), r, 0, {}), ACT.EAT);
    eq(ruleDecide(obs(0.5, 0, 0.2, 0.1, 0.8, 0.1), r, 0, {}), ACT.S);
    for (let i = 0; i < 50; i++) {
      const a = ruleDecide(obs(0.5, 0, -1, 0, -1, -1), r, 0, {});
      eq(a, ACT.E, 'においがなければ通れる方へ');
    }
  });
  test('サイコロの確率は合計1で、引いた結果の割合も確率どおり', () => {
    const g = Float32Array.from([1, 0, -1, 0.5, 2, -2]);
    const p = diceProbs(g);
    near(p.reduce((a, b) => a + b, 0), 1, 1e-6);
    const cum = diceCum(g);
    eq(cum[N_ACT - 1], 1);
    const r = new RNG(4);
    const cnt = new Array(N_ACT).fill(0);
    const n = 30000;
    for (let i = 0; i < n; i++) {
      const x = r.next();
      let a = 0;
      while (a < N_ACT - 1 && x >= cum[a]) a++;
      cnt[a]++;
    }
    for (let a = 0; a < N_ACT; a++) near(cnt[a] / n, p[a], 0.012, `行動${a}`);
  });
  test('行動テストの場面はどれも「正解」が1つ決まっている', () => {
    for (const list of PROBES) for (const [o, a] of list) assert(o.length === 9 && a >= 0 && a < N_ACT);
  });

  section('種の記録（species.js）');
  test('近い遺伝子は同じ種、遠い遺伝子は親から枝分かれした新種', () => {
    const book = new SpeciesBook('nn', NN.distance, 0.5);
    const r = new RNG(8);
    const a = NN.randomBrain(r);
    const s0 = book.assign(a, -1, 0);
    const near1 = a.slice();
    near1[0] += 0.3;
    eq(book.assign(near1, s0, 1), s0);
    const far = NN.randomBrain(r);
    const s1 = book.assign(far, s0, 1);
    assert(s1 !== s0);
    eq(book.list[s1].parent, s0);
    const res = book.tally(1, [s0, s1, s1, s1]);
    eq(res.born.length, 1, '3匹以上で定着');
    const res2 = book.tally(2, [s0]);
    eq(res2.extinct.length, 1, '定着した種が0匹で絶滅');
  });

  section('シミュレーション（sim.js）');
  test('世界のきまりが守られている（体力・草・数の上限・家族の集計）', () => {
    const lab = new Lab({ seed: 5, founders: 12 });
    for (let gen = 0; gen < 3; gen++) {
      let lastFood = 0;
      for (let t = 0; t < lab.seasonTicks - 1; t++) {
        lab.step();
        let food = 0;
        for (const isl of lab.islands) {
          for (let k = 0; k < NC; k++) assert(isl.grass[k] >= -1e-6 && isl.grass[k] <= 1 + 1e-6, '草は0〜1');
          const alive = new Array(4).fill(0);
          for (const c of isl.cs) {
            if (!c.alive) continue;
            alive[c.m]++;
            assert(c.e > 0 && c.e <= RULES.E_MAX + 1e-6, `体力 ${c.e}`);
            assert(isl.terr.walk[c.k] === 1, '歩けるマスにいる');
            assert(c.k === c.y * G + c.x);
          }
          for (const m of isl.methods) {
            eq(isl.pop[m], alive[m], '生きている数の帳簿');
            assert(isl.pop[m] <= isl.cap[m], '数の上限');
          }
          for (const f of isl.fams) food += f.food;
        }
        assert(food >= lastFood - 1e-9, '集めた草は減らない');
        lastFood = food;
      }
      lab.step();
    }
    eq(lab.gen, 3);
  });
  test('同じ設定なら何度やっても同じ結果になる（再現性）', () => {
    const a = new Lab({ seed: 99 });
    const b = new Lab({ seed: 99 });
    a.runGenerations(5);
    b.runGenerations(5);
    deepEq(a.hist, b.hist);
  });
  test('リプレイ: 世代のはじめの状態から同じシーズンをもう一度起こすと、ベスト家族の成績がぴったり一致', () => {
    for (const mode of [MODE.SEPARATE, MODE.ARENA]) {
      const lab = new Lab({ seed: 31, mode });
      lab.runGenerations(4);
      for (const m of lab.cfg.methods) {
        for (const e of [lab.latest[m], lab.best[m]]) {
          const rep = recordReplay(lab, e);
          eq(rep.finalFood, e.fit, `${mode} 方式${m} 第${e.gen}世代`);
          eq(rep.frames.length, lab.seasonTicks + 1);
        }
      }
    }
  });
  test('保存して読みこむと、続きがそのまま再現される（世代の途中で保存しても同じ）', () => {
    for (const mode of [MODE.SEPARATE, MODE.ARENA]) {
      const a = new Lab({ seed: 17, mode });
      a.runGenerations(6);
      const b = new Lab({ seed: 17, mode });
      b.runGenerations(3);
      for (let t = 0; t < 50; t++) b.step(); // 世代の途中（Q表は学習が進んでいる）
      const json = JSON.parse(JSON.stringify(b.toJSON()));
      const c = Lab.fromJSON(json);
      eq(c.gen, 3);
      eq(c.tick, 0, '読みこむと世代のはじめから');
      c.runGenerations(3);
      deepEq(c.hist, a.hist, mode);
      deepEq(c.events, a.events, mode);
    }
  });
  test('競争モード: 創始者の割り当ては合計が一定で、どの方式にも最低数が残る', () => {
    const lab = new Lab({ seed: 3, mode: MODE.ARENA });
    for (let g = 0; g < 12; g++) {
      lab.runGenerations(1);
      const total = lab.cfg.methods.reduce((s, m) => s + lab.alloc[m], 0);
      eq(total, lab.arenaTotal);
      for (const m of lab.cfg.methods) assert(lab.alloc[m] >= lab.cfg.arenaMin);
      const shares = lab.cfg.methods.reduce((s, m) => s + lab.hist[m].share.at(-1), 0);
      near(shares, 1, 0.01, '取り分の合計');
    }
  });
  test('設定の正規化: おかしな値は範囲内に直る', () => {
    const c = normalizeCfg({ founders: 999, days: -3, methods: [9, 1, 1, 2], mode: 'arena', q: { alpha: 5 } });
    eq(c.founders, 40);
    eq(c.days, 1);
    deepEq(c.methods, [1, 2]);
    eq(c.mode, 'arena');
    eq(c.q.alpha, 1);
    eq(normalizeCfg({ mode: 'arena', methods: [1] }).mode, 'separate', '1方式だけなら競争にならない');
  });

  section('腕前テスト（evaluate.js）');
  test('ルールは何度測っても同じ値（学習しない対照群）', () => {
    const lab = new Lab({ seed: 12, methods: [M.RULE] });
    const a = evaluatePolicy(lab, policyOf(lab, M.RULE));
    lab.runGenerations(3);
    const b = evaluatePolicy(lab, policyOf(lab, M.RULE));
    eq(a.fit, b.fit);
    assert(a.fit > 3, 'ルールはちゃんと草を集める');
  });
  test('学習前の状態（空のQ表・世代0の遺伝子）が取り出せる', () => {
    const lab = new Lab({ seed: 12 });
    const q0 = initialPolicyOf(lab, M.Q);
    assert(q0.q.every((v) => v === 0));
    const n0 = initialPolicyOf(lab, M.NN);
    eq(n0.genomes.length, lab.cfg.founders);
    lab.runGenerations(2);
    const n0b = initialPolicyOf(lab, M.NN);
    deepEq(Array.from(n0b.genomes[0]), Array.from(n0.genomes[0]), '世代0のまま');
  });
}
