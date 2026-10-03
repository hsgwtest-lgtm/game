// ゲームと同じ修行の進行（session.js）をブラウザなしで回して、各修行場で印が取れるか確かめる
//   node tools/check_sessions.mjs                 （全修行場・3流派）
//   node tools/check_sessions.mjs kagi rl key=3   （修行場・流派・ごほうびの変更）
// 模倣流は「最短ルート探索」をお手本の先生にする（人の代わり）。

const mem = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    key: (i) => [...mem.keys()][i],
    get length() { return mem.size; },
  },
  addEventListener() {}, location: { search: '' },
};
globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));

const { STAGES } = await import('../js/sim/stages.js');
const { GameState } = await import('../js/game/state.js');
const { GASession, RLSession, ILSession } = await import('../js/game/session.js');
const { plan } = await import('../js/sim/planner.js');

const args = process.argv.slice(2);
const only = args[0] && !args[0].includes('=') ? args[0].split(',') : STAGES.map((s) => s.id);
const schools = args[1] && !args[1].includes('=') ? args[1].split(',') : ['ga', 'rl', 'il'];
const rwOver = {};
for (const a of args) if (a.includes('=')) { const [k, v] = a.split('='); rwOver[k] = +v; }

// 「こうすれば解ける」という、ゲーム内のヒントどおりの設定
const RECOMMENDED = process.env.NOREC ? {} : {
  kagi: { key: 3 },
  koban: { coin: 0 },
  meiro: { shaping: 0, explore: 0.3 },
  shiken: { key: 3, explore: 0.3 },
};

function makeApp() {
  const game = new GameState();
  game.load();
  return { game, sfx() {}, masters: { say() {} } };
}

function runFast(session, maxFrames) {
  session.setFast(true);
  let frames = 0;
  while (session.fast && frames < maxFrames) { session.update(1 / 60); frames++; if (!session.fast && !session.medal) session.setFast(true); }
  session.setFast(false);
  return frames;
}

function runIL(app, def) {
  const s = new ILSession(app, def);
  const st = s.stage;
  // お手本：スタート地点1つめの最短ルート
  s.startDemo(0);
  const p = plan(st, st.maxSteps, null, 0);
  for (const a of p.actions) s.input(a);
  // 学習を最後まで
  let guard = 0;
  while (s.mode === 'train' && guard++ < 2000) s.update(0.05);
  // まかせる → 迷ったら先生（最短ルート探索）が手助け
  for (let round = 0; round < 12 && !s.medal; round++) {
    if (s.mode !== 'auto') s.startAuto();
    guard = 0;
    while (s.mode === 'auto' && guard++ < 400) {
      const ep = s.ep;
      const q = plan(st, st.maxSteps, { x: ep.x[0], y: ep.y[0], key: ep.key[0], t: ep.t }, ep.startIdx);
      const obs = new Float32Array(105);
      ep.observe(0, obs);
      if (q && q.actions.length && q.actions[0] !== s.im.greedy(obs)) s.input(q.actions[0]);
      s.timer = 999; s.update(0);
    }
    guard = 0;
    while (s.mode === 'train' && guard++ < 2000) s.update(0.05);
  }
  return { medal: s.medal, human: s.im.demoSteps + s.im.fixes, demos: s.im.demos, fixes: s.im.fixes };
}

const t0 = Date.now();
for (const id of only) {
  const def = STAGES.find((d) => d.id === id);
  const out = [];
  for (const k of schools) {
    const app = makeApp();
    const rw = Object.assign({}, app.game.rewards(id, k), RECOMMENDED[id] || {}, rwOver);
    app.game.saveRewards(id, k, rw);
    const t1 = Date.now();
    if (k === 'il') {
      const r = runIL(app, def);
      out.push(`IL ${r.medal ? 'OK' : 'NG'} 手間${r.human}歩(お手本${r.demos} 手助け${r.fixes}) ${Date.now() - t1}ms`);
      continue;
    }
    const s = k === 'ga' ? new GASession(app, def) : new RLSession(app, def);
    let total = 0;
    const FR = +(process.env.FRAMES || 2000), TR = +(process.env.TRIES || 4);
    for (let tries = 0; tries < TR && !s.medal; tries++) total += runFast(s, FR);
    const rec = app.game.rec(id, k);
    out.push(`${k.toUpperCase()} ${s.medal ? 'OK' : 'NG'} ${rec ? rec.cost + rec.unit : s.episodes + '回(未)'} ${Date.now() - t1}ms`);
  }
  console.log(`${def.no}.${def.name.padEnd(8, '　')} ${out.join(' | ')}`);
}
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
