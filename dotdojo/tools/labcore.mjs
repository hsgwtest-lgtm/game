// 学習の実験台（ブラウザなしで3流派を走らせる）
//   node tools/lab.mjs ippo,hashi --ga --rl --il --seeds 1,2,3
//   node tools/lab.mjs kagi --rl --rw key=3          （ごほうびを変える）
//   node tools/lab.mjs kagi --rl --rw shaping=0 --ent 2
//   node tools/lab.mjs ippo --show                    （地図と最短ルート）
// （中身は labcore.mjs。実験スクリプトから import して使える）
import { STAGES } from '../js/sim/stages.js';
import { Stage, Episode, N_IN, BASE_REWARD, ACTS } from '../js/sim/env.js';
import { plan } from '../js/sim/planner.js';
import { Population } from '../js/ml/ga.js';
import { PPOAgent } from '../js/ml/ppo.js';
import { Imitator } from '../js/ml/bc.js';
import { RNG } from '../js/core/rng.js';

globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));

// 実験の設定（CLI から上書き）
export const O = { rw: {}, gens: 150, rounds: 250, mirror: false, pop: 40, mut: 1, ent: 1, lr: 1, clones: 1, iltrain: 300, ilmode: 'dagger', ilInit: null };
let GENS = 150, ROUNDS = 250, mirror = false, rwOver = {};
const opt = (f, d) => {
  const m = { '--pop': 'pop', '--mut': 'mut', '--ent': 'ent', '--lr': 'lr', '--clones': 'clones', '--iltrain': 'iltrain', '--ilmode': 'ilmode' };
  return O[m[f]] ?? d;
};
export function configure(o) { Object.assign(O, o); GENS = O.gens; ROUNDS = O.rounds; mirror = O.mirror; rwOver = O.rw; }

export function rewardsFor(def) { return Object.assign({}, BASE_REWARD, def.rewards || {}, rwOver); }

export function show(def) {
  const st = new Stage(def, mirror);
  const p = plan(st);
  const grid = def.map.map((r) => (mirror ? r.split('').reverse().join('') : r).split(''));
  console.log(`\n[${def.id}] ${def.name}  ${st.W}x${st.H} maxSteps=${st.maxSteps} par=${p ? p.steps : 'NONE'}`);
  if (p) {
    let x = st.start.x, y = st.start.y;
    for (const a of p.actions) { x += ACTS[a][0]; y += ACTS[a][1]; if (grid[y] && grid[y][x] === '.') grid[y][x] = '*'; }
    console.log('  actions: ' + p.actions.map((a) => '↑↓←→・'[a]).join(''));
  }
  for (const r of grid) console.log('  |' + r.join('') + '|');
}

export function runGreedy1(st, rw, fn, si) {
  const ep = new Episode(st, 1, rw, si);
  const obs = new Float32Array(N_IN);
  while (!ep.allDone) { ep.observe(0, obs); ep.step([fn(obs)]); }
  return { succ: ep.succ[0], steps: ep.steps[0], ret: ep.ret[0], cause: ep.cause[0], coins: ep.coinsGot[0] };
}
// すべてのスタート地点で試す（全部成功で succ=1）
export function runGreedy(st, rw, fn) {
  let all = 1, steps = 0, coins = 0, cause = 0, ok = 0;
  for (let si = 0; si < st.starts.length; si++) {
    const r = runGreedy1(st, rw, fn, si);
    if (!r.succ) { all = 0; cause = r.cause; } else ok++;
    steps = Math.max(steps, r.steps); coins += r.coins;
  }
  return { succ: all, steps, coins, cause, ok, n: st.starts.length };
}

export function runGA(def, seed) {
  const st = new Stage(def, mirror), rw = rewardsFor(def);
  const pop = new Population({ size: +opt('--pop', 40), seed, mutIdx: +opt('--mut', 1) }).initRandom();
  const obs = new Float32Array(N_IN);
  let first = 0, firstEvals = 0, last = null;
  const srng = new RNG(seed * 7 + 1);
  let firstAll = 0;
  for (let g = 1; g <= GENS; g++) {
    const ep = new Episode(st, pop.size, rw, srng.int(0, st.starts.length - 1));
    const acts = new Int8Array(pop.size);
    while (!ep.allDone) {
      for (let i = 0; i < pop.size; i++) if (!ep.done[i]) { ep.observe(i, obs); acts[i] = pop.act(i, obs); }
      ep.step(acts);
    }
    pop.setResults(ep);
    last = pop.evolve();
    if (last.succ > 0 && !first) { first = g; firstEvals = pop.evals; }
    if (st.multiStart && first && !firstAll) {
      // エリート（前の世代で一番の子）が全スタートで成功するか
      const best = pop.members.find((m) => m.elite);
      const net = pop.nets[pop.members.indexOf(best)];
      const r = runGreedy(st, rw, (o) => { const z = net.forward(o); let b = 0; for (let k = 1; k < 5; k++) if (z[k] > z[b]) b = k; return b; });
      if (r.succ) firstAll = g;
    }
    if (first && (!st.multiStart || firstAll) && g >= Math.max(first, firstAll) + 5) break;
  }
  return { first: st.multiStart ? `${first}/all${firstAll}` : first, firstEvals, gen: pop.gen - 1, best: last.best.toFixed(2), succ: last.succ + '/' + last.n, coins: last.coins };
}

export function runRL(def, seed) {
  const st = new Stage(def, mirror), rw = rewardsFor(def);
  const ag = new PPOAgent({ seed, entIdx: +opt('--ent', 1), lrIdx: +opt('--lr', 1), clonesIdx: +opt('--clones', 1) });
  if (O.ilInit) ag.loadPolicy(O.ilInit);
  const acts = new Int8Array(ag.clones);
  let first = 0, firstEps = 0, last = null, g = null, firstAny = 0;
  const srng = new RNG(seed * 7 + 1);
  for (let r = 1; r <= ROUNDS; r++) {
    const ep = new Episode(st, ag.clones, rw, srng.int(0, st.starts.length - 1));
    ag.beginRound(ep);
    while (!ep.allDone) { ag.actAll(ep, acts); ep.step(acts); ag.afterStep(ep); }
    last = ag.endRoundSync(ep);
    if (last.succ > 0 && !firstAny) firstAny = r;
    g = runGreedy(st, rw, (o) => ag.greedy(o));
    if (g.succ && !first) { first = r; firstEps = ag.episodes; }
    if (first && r >= first + 5) break;
  }
  return { first, firstEps, firstAny, round: ag.round, succ: last.succ + '/' + last.n, ent: last.ent.toFixed(2), ret: last.ret.toFixed(2), greedy: g, coins: last.coins.toFixed(1) };

}

export function runIL(def, seed) {
  const st = new Stage(def, mirror), rw = rewardsFor(def);
  const im = new Imitator({ seed });
  const obs = new Float32Array(N_IN);
  const p = plan(st);
  if (!p) return { err: 'no plan' };
  const log = [];
  const demo = () => {
    const ep = new Episode(st, 1, rw);
    for (const a of p.actions) { ep.observe(0, obs); im.add(obs, a, 1); ep.step([a]); }
    im.demos++; im.demoSteps += p.actions.length;
  };
  const trainN = +opt('--iltrain', 300);
  demo();
  im.train(trainN, 32);
  let g = runGreedy(st, rw, (o) => im.greedy(o));
  log.push(`demo1:${g.succ ? 'OK' : 'x'}(${g.steps} ${g.ok}/${g.n})`);
  let iters = 0;
  const mode = opt('--ilmode', 'dagger');
  while (!g.succ && iters < 12) {
    iters++;
    if (mode === 'demos') { demo(); }
    else {
      // DAgger: AIにまかせて、AIが行った場面に先生（最短ルート探索）が正解をつける
      const si = iters % st.starts.length;
      const ep = new Episode(st, 1, rw, si);
      let fixes = 0;
      while (!ep.allDone) {
        ep.observe(0, obs);
        const q = plan(st, st.maxSteps, { x: ep.x[0], y: ep.y[0], key: ep.key[0], t: ep.t }, si);
        const ai = im.greedy(obs);
        if (q && q.actions.length) {
          const ea = q.actions[0];
          if (ea !== ai) { im.add(obs, ea, 2); fixes++; im.fixes++; }
          ep.step([ea]);   // 人が手を出したら、その操作で進む（HG-DAgger）
        } else ep.step([ai]);
      }
      log.push(`fix${iters}:${fixes}`);
    }
    im.train(trainN, 32);
    g = runGreedy(st, rw, (o) => im.greedy(o));
    log.push(g.succ ? `OK(${g.steps})` : `x(${['', 'goal', 'fall', 'oni', 'spike', 'time'][g.cause]} ${g.ok}/${g.n})`);
  }
  im.evalAcc();
  return { ok: g.succ, demos: im.demos, fixes: im.fixes, samples: im.count, acc: im.acc.toFixed(2), log: log.join(' '), w: im.net.w };
}

