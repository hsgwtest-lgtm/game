// 裏方（Web Worker）: 作業の世界・「AIの目」・学習をぜんぶここで回す。画面（main.js）とはメッセージでやりとりする。
// 学習がどれだけ重くても、画面の操作と3D表示は止まらない。
import { STAGE_BY_ID } from './stages.js';
import { Env, expertAction, moveToward, SNAP, DEFAULT_REWARD } from './env.js';
import { Raster, OBS } from './raster.js';
import { KeyNet, PROP } from './nn.js';
import { DemoSet, addRobotDemos, BCTrainer } from './bc.js';
import { PPO } from './ppo.js';
import { Evaluator, NOUT, probs, sample } from './policy.js';
import { makeRng, hashStr } from './rng.js';
import * as db from './db.js';

const METHODS = ['bc', 'rl', 'mix'];
const MAX_DEMOS = 400;
const post = (m, tr) => self.postMessage(m, tr || []);
const toast = (text) => post({ type: 'toast', text });
const rnd = makeRng((Date.now() ^ 0x1234567) >>> 0);
const newSeed = () => (rnd() * 4294967296) >>> 0;

let stage = null;
let demos = new DemoSet();
let slots = {};      // 学び方ごとの頭脳: { net, critic, ppo, meta }
let job = null;      // 進行中の仕事（模倣学習・強化学習・検定）
let openToken = 0;

const live = {       // 画面に映している1台ぶんの作業場
  env: null, mode: 'idle', method: 'bc', period: 50, next: 0, hold: 0,
  input: { x: 0, y: 0, touching: false, gripSeq: 0 }, gripSeen: 0,
  src: '', event: '', hasProbs: false, fixing: false,
};
const ras = new Raster();
const eye = new Uint8Array(OBS), snap = new Float32Array(SNAP), prop1 = new Float32Array(PROP), offs1 = new Int32Array(1);
const pr = new Float64Array(NOUT), act = new Uint8Array(3), mv = [0, 0, 0];

function newMeta() {
  return { ready: false, bcEpochs: 0, bcDemos: 0, bcCurve: [], estimate: null, bcEstimate: null, rlSteps: 0, rlCurve: [], from: '', inherit: false };
}
const metas = () => Object.fromEntries(METHODS.map((m) => [m, slots[m] ? slots[m].meta : newMeta()]));
function demoInfo() {
  return { total: demos.demos.length, human: demos.count('human'), robot: demos.count('robot'), fix: demos.count('fix'), steps: demos._start };
}
function saveDemos() { if (stage) db.put('demos', stage.id, demos.toJSON()); post({ type: 'demos', demos: demoInfo() }); }
function saveSlot(m) {
  const s = slots[m];
  if (!stage || !s) return;
  if (!s.net) { db.del('models', stage.id + ':' + m); return; }
  if (s.ppo) s.critic = s.ppo.critic.getWeights();
  db.put('models', stage.id + ':' + m, { w: s.net.getWeights(), critic: s.critic, meta: s.meta });
}
const postSlots = () => post({ type: 'slots', stage: stage.id, slots: metas() });

async function openStage(id) {
  const token = ++openToken;
  stopJob(true);
  live.mode = 'idle';
  const st = STAGE_BY_ID[id];
  const d = DemoSet.from(await db.get('demos', id));
  const sl = {};
  for (const m of METHODS) {
    const rec = await db.get('models', id + ':' + m);
    const slot = { net: null, critic: null, ppo: null, meta: newMeta() };
    if (rec && rec.w) {
      const net = new KeyNet({}, 1);
      if (rec.w.length === net.count()) { net.setWeights(rec.w); slot.net = net; slot.critic = rec.critic || null; slot.meta = Object.assign(newMeta(), rec.meta); }
    }
    sl[m] = slot;
  }
  if (token !== openToken) return;
  stage = st; demos = d; slots = sl;
  live.env = new Env(stage, newSeed());
  live.hold = 0; live.src = ''; live.event = '';
  post({ type: 'opened', stage: id, demos: demoInfo(), slots: metas() });
  postFrame();
}

// ---------------------------------------------------------------- 画面に映す1台（教える・見る・手直し）
function setLive(mode, method) {
  if (!live.env) return;
  if (demos.pending()) demos.cancel();
  live.mode = mode; if (method) live.method = method;
  // 人が教えるときは、時間切れまでの歩数を3倍にゆるめる（手で動かすとお手本ロボより遠回りになるため）
  live.env.stage = mode === 'teach' ? Object.assign({}, stage, { maxSteps: stage.maxSteps * 3 }) : stage;
  live.hold = 0; live.fixing = false; live.src = ''; live.event = ''; live.hasProbs = false;
  live.input.touching = false; live.gripSeen = live.input.gripSeq;
  live.env.reset();
  live.next = 0;
  postFrame();
}

function postFrame() {
  const e = live.env;
  if (!e) return;
  e.snapshot(snap); ras.render(snap, 0, eye);
  const m = {
    type: 'frame', snap: snap.slice(), eye: eye.slice(), mode: live.mode, t: e.t, max: e.stage.maxSteps,
    done: e.done, success: e.success, event: live.event, src: live.src, pending: demos.pending(), grip: e.grip,
    probs: null, keys: null,
  };
  if (live.hasProbs) {
    m.probs = Float32Array.from(pr);
    const net = slots[live.method] && slots[live.method].net;
    if (net) {
      const K = net.cfg.keys, N = net.N, k = new Float32Array(K * 3);
      for (let i = 0; i < K; i++) { k[i * 3] = net.tok[i * 2]; k[i * 3 + 1] = net.tok[i * 2 + 1]; k[i * 3 + 2] = net.feat[N * N + i]; }
      m.keys = k;
    }
  }
  post(m, [m.snap.buffer, m.eye.buffer]);
  live.event = '';
}

function liveTick(now) {
  const e = live.env, inp = live.input;
  live.next = now + live.period;
  if (live.hold > 0) {
    if (--live.hold === 0) { e.reset(); live.fixing = false; live.src = ''; postFrame(); }
    return;
  }
  let u1 = 0, u2 = 0, g = e.grip;
  // 「にぎる／はなす」ボタンは、押された回数で受け取る（状態で受け取ると、AIが動かした直後に食い違う）
  const toggle = inp.gripSeq !== live.gripSeen;
  live.gripSeen = inp.gripSeq;
  if (live.mode === 'teach') {
    if (inp.touching) { moveToward(e, inp.x, inp.y, mv); u1 = mv[0]; u2 = mv[1]; }
    if (toggle) g = 1 - e.grip;
    if (u1 === 0 && u2 === 0 && !toggle) return;             // 何もしていない間は時間を進めない（記録もしない）
    demos.add(e, u1 + 1, u2 + 1, g);
    e.step(u1, u2, g); live.src = 'human';
  } else if (live.mode === 'watch') {
    const slot = slots[live.method];
    if (!slot || !slot.net) return;
    e.snapshot(snap); ras.render(snap, 0, eye);
    prop1[0] = e.a1; prop1[1] = e.a2; prop1[2] = e.grip;
    const z = slot.net.forward(eye, offs1, 1, prop1);
    probs(z, 0, pr); live.hasProbs = true;
    if ((inp.touching || toggle) && !job && live.method !== 'rl') {
      // 手直し: 指で動かしている間だけ人が操作し、その動きをお手本に足す
      if (inp.touching) { moveToward(e, inp.x, inp.y, mv); u1 = mv[0]; u2 = mv[1]; }
      if (toggle) g = 1 - e.grip;
      if (u1 !== 0 || u2 !== 0 || toggle) demos.add(e, u1 + 1, u2 + 1, g);
      live.fixing = true; live.src = 'human';
    } else {
      sample(z, 0, rnd, act, 0);
      u1 = act[0] - 1; u2 = act[1] - 1; g = act[2]; live.src = 'ai';
    }
    e.step(u1, u2, g);
  } else if (live.mode === 'expert') {
    expertAction(e, mv); e.step(mv[0], mv[1], mv[2]); live.src = 'robot';
  } else return;
  if (e.event) live.event = e.event;
  if (e.done) {
    if (demos.pending()) {
      if (e.success && demos.demos.length < MAX_DEMOS) { demos.commit(live.mode === 'teach' ? 'human' : 'fix'); saveDemos(); live.event = live.mode === 'teach' ? 'demo' : 'fixed'; }
      else { if (e.success) toast(`お手本は ${MAX_DEMOS} 本までです`); demos.cancel(); }
    }
    live.hold = Math.max(4, Math.round(600 / live.period));
  }
  postFrame();
}

// ---------------------------------------------------------------- 仕事（模倣学習・強化学習・検定）
function stopJob(silent) {
  if (!job) return;
  const j = job; job = null;
  if (j.kind === 'rl') { saveSlot(j.method); if (!silent) post({ type: 'rl', state: 'paused', method: j.method, meta: slots[j.method].meta }); }
  else if (j.kind === 'bc') { saveSlot(j.method); if (!silent) post({ type: 'bc', state: 'done', method: j.method, meta: slots[j.method].meta }); }
  else if (j.kind === 'exam' && !silent) post({ type: 'exam', state: 'cancel', method: j.method });
}

function resetSlot(m) {
  slots[m] = { net: null, critic: null, ppo: null, meta: newMeta() };
  db.del('models', stage.id + ':' + m);
}

function startBC(m, epochs, opts = {}) {
  if (job || !stage) return;
  if (!demos.demos.length) { toast('まず「教える」でお手本を記録してください'); return; }
  const slot = slots[m];
  if (m === 'mix' && slot.meta.rlSteps > 0) { toast('練習を始めたあとは、まね直しはできません（やり直すにはリセット）'); return; }
  if (!slot.net) { slot.net = new KeyNet({}, newSeed()); slot.meta = newMeta(); slot.ppo = null; slot.critic = null; }
  job = {
    kind: 'bc', method: m, target: epochs, done: 0, phase: 'train', ev: null,
    tr: new BCTrainer(slot.net, demos, stage, { lr: 2e-3, batch: 32, seed: newSeed(), augment: opts.augment !== false }),
  };
  post({ type: 'bc', state: 'start', method: m, epochs });
}

function tickBC() {
  const j = job, slot = slots[j.method], meta = slot.meta;
  if (j.phase === 'train') {
    const r = j.tr.step();
    if (!r) return;
    j.done++; meta.bcEpochs++; meta.ready = true;
    meta.bcCurve.push([meta.bcEpochs, +r.loss.toFixed(4), +r.acc.toFixed(4)]);
    if (meta.bcCurve.length > 300) meta.bcCurve = meta.bcCurve.filter((_, i) => i % 2 === 1);
    post({ type: 'bc', state: 'progress', method: j.method, epoch: j.done, epochs: j.target, loss: r.loss, acc: r.acc, total: meta.bcEpochs });
    if (j.done >= j.target || j.stop) { j.phase = 'eval'; j.ev = new Evaluator(slot.net, stage, 60, 31337 + meta.bcEpochs); }
  } else {
    j.ev.tick();
    if (j.ev.done) {
      meta.estimate = j.ev.rate; meta.bcEstimate = j.ev.rate; meta.bcDemos = demos.demos.length;
      job = null; saveSlot(j.method);
      post({ type: 'bc', state: 'done', method: j.method, meta });
    }
  }
}

function startRL(m, opts = {}) {
  if (job || !stage) return;
  const slot = slots[m];
  if (m === 'mix' && !slot.net) { toast('先に「まねる」で模倣学習をしてください'); return; }
  if (m === 'bc') return;
  if (!slot.net) { slot.net = new KeyNet({}, newSeed()); slot.meta = newMeta(); }
  const reward = Object.assign({}, DEFAULT_REWARD, opts.reward || {});
  if (!slot.ppo) {
    const o = { seed: newSeed(), reward };
    // 模倣から続けるとき: 最初の3周はクリティックだけ育てる（見積もりがでたらめなうちに方策を動かすと、まねた動きが壊れる）
    if (m === 'mix' || slot.meta.inherit) o.warmup = slot.meta.rlSteps === 0 ? 3 : 0;
    slot.ppo = new PPO(slot.net, stage, o);
    if (slot.critic && slot.critic.length === slot.ppo.critic.count()) { slot.ppo.critic.setWeights(slot.critic); slot.ppo.o.warmup = 0; }
    slot.ppo.steps = slot.meta.rlSteps;
  } else for (const e of slot.ppo.arena.envs) e.rw = reward;
  job = { kind: 'rl', method: m, ppo: slot.ppo, lastSave: performance.now(), mark: performance.now(), markSteps: slot.ppo.steps, sps: 0 };
  slot.meta.ready = true;
  post({ type: 'rl', state: 'start', method: m });
}

function tickRL() {
  const j = job, slot = slots[j.method], meta = slot.meta;
  const r = j.ppo.tick();
  if (!r) return;
  const now = performance.now();
  if (now - j.mark > 1500) { j.sps = (r.steps - j.markSteps) / ((now - j.mark) / 1000); j.mark = now; j.markSteps = r.steps; }
  meta.rlSteps = r.steps;
  let point = null;
  if (r.rate != null) {
    meta.estimate = r.rate;
    point = [r.steps, +r.rate.toFixed(3)];
    meta.rlCurve.push(point);
    if (meta.rlCurve.length > 240) meta.rlCurve = meta.rlCurve.filter((_, i) => i % 2 === 1);
  }
  post({ type: 'rl', state: 'progress', method: j.method, steps: r.steps, rate: r.rate, ret: r.ret, len: r.len, entropy: r.entropy, sps: j.sps, point });
  if (now - j.lastSave > 20000) { j.lastSave = now; saveSlot(j.method); }
}

function startExam(m) {
  if (job || !stage) return;
  const slot = slots[m];
  if (!slot.net || !slot.meta.ready) { toast('まだ育てていません'); return; }
  job = { kind: 'exam', method: m, ev: new Evaluator(slot.net, stage, 100, hashStr('kentei:' + stage.id), { par: 10 }), sent: -1, nextAt: 0 };
  post({ type: 'exam', state: 'start', method: m });
}

function tickExam(now) {
  const j = job;
  if (now < j.nextAt) return;
  j.nextAt = now + 14;
  j.ev.tick();
  if (j.ev.finished !== j.sent) { j.sent = j.ev.finished; post({ type: 'exam', state: 'progress', method: j.method, results: j.ev.results.slice(), finished: j.ev.finished, ok: j.ev.ok }); }
  if (j.ev.done) {
    const slot = slots[j.method];
    job = null;
    post({ type: 'exam', state: 'done', method: j.method, rate: j.ev.rate, steps: j.ev.ok ? j.ev.steps / j.ev.ok : 0, results: j.ev.results.slice(), meta: slot.meta, demos: demoInfo() });
  }
}

// ---------------------------------------------------------------- メッセージ
self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'open': await openStage(m.stage); break;
      case 'live': setLive(m.mode, m.method); break;
      case 'input': { const i = live.input; i.x = m.x; i.y = m.y; i.touching = m.touching; i.gripSeq = m.gripSeq; break; }
      case 'speed': live.period = m.period; break;
      case 'next': if (live.env) { if (demos.pending()) demos.cancel(); live.hold = 0; live.fixing = false; live.env.reset(); live.gripSeen = live.input.gripSeq; postFrame(); } break;
      case 'demo':
        if (!stage || job) break;
        if (demos.pending()) demos.cancel();
        if (m.op === 'undo') demos.removeLast();
        else if (m.op === 'clear') demos.clear();
        else if (m.op === 'robot') {
          const room = MAX_DEMOS - demos.demos.length;
          if (room <= 0) toast(`お手本は ${MAX_DEMOS} 本までです`);
          else addRobotDemos(demos, stage, Math.min(m.n || 10, room), newSeed(), m.noise == null ? 0.15 : m.noise);
        }
        saveDemos();
        break;
      case 'bc': if (m.op === 'start') startBC(m.method, m.epochs || 40, m); else if (job && job.kind === 'bc') job.stop = true; break;
      case 'rl': if (m.op === 'start') startRL(m.method, m); else if (job && job.kind === 'rl') stopJob(); break;
      case 'exam': startExam(m.method); break;
      case 'reset':
        if (!stage) break;
        if (job && job.method === m.method) stopJob(true);
        resetSlot(m.method); postSlots();
        break;
      case 'copy': {
        // 模倣学習の頭脳を「模倣→強化」の出発点にコピー
        if (!stage || job) break;
        const src = slots.bc;
        if (!src.net) { toast('模倣学習の頭脳がまだありません'); break; }
        const dst = { net: new KeyNet({}, 1), critic: null, ppo: null, meta: newMeta() };
        dst.net.copyFrom(src.net);
        Object.assign(dst.meta, { ready: true, bcEpochs: src.meta.bcEpochs, bcDemos: src.meta.bcDemos, bcCurve: src.meta.bcCurve.slice(), estimate: src.meta.estimate, bcEstimate: src.meta.bcEstimate, from: 'bc' });
        slots.mix = dst; saveSlot('mix'); postSlots();
        break;
      }
      case 'inherit': {
        // ほかの現場で育てた頭脳を連れてくる（引き継ぎ）
        if (!stage || job) break;
        const rec = await db.get('models', m.fromStage + ':' + m.fromMethod);
        const net = new KeyNet({}, 1);
        if (!rec || !rec.w || rec.w.length !== net.count()) { toast('その頭脳は見つかりませんでした'); break; }
        net.setWeights(rec.w);
        const meta = newMeta();
        Object.assign(meta, { ready: true, inherit: true, from: m.fromStage + ':' + m.fromMethod });
        slots[m.method] = { net, critic: null, ppo: null, meta };
        saveSlot(m.method); postSlots();
        break;
      }
      case 'stop': stopJob(true); break;
      case 'wipe': stopJob(true); await db.clear('demos'); await db.clear('models'); if (stage) await openStage(stage.id); break;
    }
  } catch (err) {
    post({ type: 'error', text: String(err && err.stack || err) });
  }
};

// ---------------------------------------------------------------- 回し続ける
const chan = new MessageChannel();
let wake = null;
chan.port1.onmessage = () => { const w = wake; wake = null; if (w) w(); };
const yieldNow = () => new Promise((res) => { wake = res; chan.port2.postMessage(0); });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function loop() {
  for (;;) {
    try {
      let now = performance.now();
      if (live.mode !== 'idle' && live.env && now >= live.next) liveTick(now);
      if (job) {
        if (job.kind === 'exam') { tickExam(now); await sleep(4); continue; }
        const end = now + 12;
        do { if (job.kind === 'bc') tickBC(); else tickRL(); } while (job && job.kind !== 'exam' && performance.now() < end);
        await yieldNow();
      } else {
        const wait = live.mode === 'idle' ? 40 : live.next - performance.now();
        await sleep(Math.max(1, Math.min(40, wait)));
      }
    } catch (err) {
      post({ type: 'error', text: String(err && err.stack || err) });
      job = null;
      await sleep(200);
    }
  }
}

post({ type: 'ready' });
loop();
