// 学習専用のワーカー（画面とは別のスレッド）。
// 画面がカクつかないように、ロールアウトと PPO の更新はすべてここで行う。

import { Trainer, summarize } from './trainer.js';
import { Net, unpackQ8, fromWire, ARCH } from './net.js';
import { Rng } from '../core/rng.js';

let tr = null;
let running = false;
let paused = false;
let speed = 1;          // 0=観察 1=ふつう 2=ぜんりょく
let lastFrame = 0;
let lastParams = 0;
let newEps = [];

const ch = new MessageChannel();
let yieldResolve = null;
ch.port1.onmessage = () => { const r = yieldResolve; yieldResolve = null; if (r) r(); };
function yieldNow() { return new Promise(r => { yieldResolve = r; ch.port2.postMessage(0); }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildOpps(list) {
  const out = [];
  for (const o of list || []) {
    if (o.type === 'cpu') out.push({ type: 'cpu', key: o.key, w: o.w || 1 });
    else if (o.type === 'self') out.push({ type: 'self', w: o.w || 1 });
    else if (o.type === 'net' && (o.q8 || o.wire)) {
      try { out.push({ type: 'net', id: o.id || 'net', net: o.wire ? fromWire(o.wire) : unpackQ8(o.q8), temp: o.temp || 1, w: o.w || 1 }); } catch (e) { /* 壊れた脳は無視 */ }
    }
  }
  if (!out.length) out.push({ type: 'cpu', key: 'koro', w: 1 });
  return out;
}

function postFrame() {
  const envs = tr.slots.map(s => {
    const e = s.env;
    return {
      g: e.grid.slice(), t: e.t, side: s.side, opp: s.oppId, arena: s.arena,
      b: e.bots.map(b => [b.x, b.y, b.dir, b.stun]), it: e.items.slice(),
    };
  });
  postMessage({ t: 'frame', envs });
}

function postParams(kind = 'params') {
  const p = tr.net.p.slice();
  const L = tr.learner;
  postMessage({
    t: kind, params: p, steps: tr.steps, iters: tr.iter,
    adam: { m: L.m.slice(), v: L.v.slice(), t: L.t },
    rs: { n: tr.rs.n, mean: tr.rs.mean, var: tr.rs.var },
  }, [p.buffer]);
}

async function loop() {
  while (running) {
    if (paused) { await sleep(120); continue; }
    tr.beginRollout();
    let done = false;
    while (!done) {
      done = tr.stepAll();
      const now = Date.now();
      if (now - lastFrame > (speed === 0 ? 60 : 110)) { postFrame(); lastFrame = now; }
      if (speed === 0) await sleep(16);
      else if (tr.t % (speed === 2 ? 64 : 24) === 0) await yieldNow();
      if (!running) return;
      while (paused && running) await sleep(120);
    }
    let loss;
    try { loss = tr.learn(); } catch (e) { postMessage({ t: 'error', msg: String(e && e.message || e) }); running = false; return; }
    const sum = tr.summary(40);
    postMessage({
      t: 'iter', iter: tr.iter, steps: tr.steps, loss, sum,
      eps: newEps.splice(0),
    });
    const now = Date.now();
    if (now - lastParams > 3000) { postParams('auto'); lastParams = now; }
    if (speed === 1) await sleep(Math.min(60, (loss.learnMs + loss.rollMs) * 0.25));
    else await yieldNow();
  }
}

onmessage = async (ev) => {
  const m = ev.data;
  switch (m.t) {
    case 'init': {
      const rng = new Rng(m.seed || 1);
      let net;
      if (m.params && m.params.length) {
        net = new Net(ARCH);
        if (m.params.length !== net.size) { postMessage({ t: 'error', msg: 'size' }); return; }
        net.p.set(m.params);
      } else net = new Net(ARCH).init(rng);
      tr = new Trainer({
        net, seed: m.seed || 1, deck: m.deck, arenas: m.arenas && m.arenas.length ? m.arenas : [0],
        opponents: buildOpps(m.opps), steps: m.steps || 0, iters: m.iters || 0,
        ppo: { ent: m.ent ?? 0.01, lr: m.lr ?? 1e-3 },
      });
      if (m.adam && m.adam.m && m.adam.m.length === net.size) {
        tr.learner.m.set(m.adam.m); tr.learner.v.set(m.adam.v); tr.learner.t = m.adam.t || 0;
      }
      if (m.rs && Number.isFinite(m.rs.var)) { tr.rs.n = m.rs.n; tr.rs.mean = m.rs.mean; tr.rs.var = m.rs.var; }
      tr.onEpisode = (s) => { newEps.push({ opp: s.opp, win: s.win, share: s.share, R: s.R, cards: s.cards, evs: s.evs, arena: s.arena, own: s.own, enemy: s.enemy }); if (newEps.length > 200) newEps.shift(); };
      speed = m.speed ?? 1;
      paused = !!m.paused;
      running = true;
      postMessage({ t: 'ready', steps: tr.steps, iters: tr.iter });
      postParams('auto');
      loop();
      break;
    }
    case 'deck': if (tr) tr.setDeck(m.deck); break;
    case 'opps': if (tr) tr.setOpponents(buildOpps(m.opps)); break;
    case 'arenas': if (tr) tr.setArenas(m.arenas); break;
    case 'ent': if (tr) tr.setEntropy(m.ent); break;
    case 'speed': speed = m.speed; break;
    case 'pause': paused = true; break;
    case 'resume': paused = false; break;
    case 'get': if (tr) postParams('params'); break;
    case 'stop':
      running = false;
      if (tr) postParams('final'); else postMessage({ t: 'final' });
      break;
    default: break;
  }
};
