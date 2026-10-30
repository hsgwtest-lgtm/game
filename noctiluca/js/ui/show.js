// 本番: 学んだ本能を、十万の群れにそのまま移す
import { $, esc, pct, starsHTML } from './dom.js';
import { TrialSession, metricOf } from '../game/session.js';
import { TRIALS, TRIAL_BY_ID, trialIndex, starsFor, EPILOGUE } from '../game/story.js';
import { QUALITY } from '../game/quality.js';
import { WORLD_W, WORLD_H } from '../sim/swarm.js';

export function createShow(app) {
  const el = $('#s-show');
  el.innerHTML = `
    <div class="showhud">
      <button class="iconbtn" data-a="back" aria-label="もどる">‹</button>
      <div class="ttl"><div class="nm"></div><div class="sub"></div></div>
      <button class="iconbtn" data-a="quality" aria-label="粒の数">◎</button>
    </div>
    <div class="showtime"></div>
    <div class="touch hit" style="position:absolute;touch-action:none"></div>
    <div class="meter">
      <div class="big"></div>
      <div class="track"><i></i></div>
      <div class="hint"></div>
    </div>
    <div class="showbar">
      <button class="btn" data-a="evolve">進化にもどる</button>
      <button class="btn primary" data-a="retry">もう一度</button>
    </div>`;
  const touch = $('.touch', el);
  const big = $('.meter .big', el);
  const track = $('.meter .track', el);
  const bar = $('.meter .track i', el);
  const hint = $('.meter .hint', el);
  const timeEl = $('.showtime', el);

  let session = null, trial = null, sw = null, cfg = null;
  let rect = { x: 0, y: 0, w: 1, h: 1 };
  let step = 0, done = false, result = null;
  let live = { alive: 1, goal: 0, sync: 0 };
  let grab = -1, beaconOn = false, beaconAmp = 0;
  let downgraded = false;
  let grabPos = null, grabVel = [0, 0];
  const perf = [];
  let lastPos = null;

  function layout() {
    const W = el.clientWidth, H = el.clientHeight;
    const hud = $('.showhud', el).getBoundingClientRect();
    const top = hud.bottom + 4;
    const bot = H - 150 - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab')) || 0);
    const availH = Math.max(100, bot - top);
    const w = Math.min(W, availH / 1.5);
    const h = w * 1.5;
    rect = { x: (W - w) / 2, y: top + (availH - h) / 2, w, h };
    Object.assign(touch.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
  }

  function thresholds() {
    track.querySelectorAll('.th').forEach((x) => x.remove());
    trial.pass.forEach((p) => {
      const s = document.createElement('span');
      s.className = 'th';
      s.style.left = `${p * 100}%`;
      track.appendChild(s);
    });
  }

  function start() {
    sw = app.getSwarm('show');
    const seed = (Math.random() * 1e9) | 0;
    cfg = session.makeCfg(seed);
    cfg.light = [...cfg.light];
    cfg.predP = [...cfg.predP];
    sw.setStage(cfg);
    sw.setLayout(session.layout);
    sw.setRows([session.championRow()]);
    sw.beaconPath = null;
    sw.beacon = [0.5, 0.75];
    sw.reset(seed);
    step = 0; done = false; result = null; grab = -1; beaconOn = false; beaconAmp = 0;
    live = { alive: 1, goal: 0, sync: 0 };
    const gens = session.evo ? session.evo.gen : (app.save.trials[session.id]?.evo?.gen || 0);
    $('.showhud .nm', el).textContent = `本番　${trial.name}`;
    $('.showhud .sub', el).textContent = `${sw.N.toLocaleString()} の光 ・ ${gens ? `${gens}世代の進化で生まれた本能` : 'まだ進化していない本能'}`;
    hint.textContent = trial.playHint || '';
    thresholds();
  }

  function measure() {
    const { B, C } = sw.reduce();
    const P = sw.P;
    const T = Math.max(1, step);
    live = { alive: C[0] / P, goal: B[3] / P, sync: C[2] / (P * T) };
    return live;
  }

  function metricNow() { return metricOf(trial.metric, { alive: [live.alive], goal: [live.goal], sync: [live.sync] }, 0); }

  function finish() {
    done = true;
    measure();
    const v = metricNow();
    const stars = starsFor(trial, v);
    const save = app.save;
    const real = !!TRIAL_BY_ID[trial.id];
    const prevStars = real ? (save.stars[trial.id] || 0) : 0;
    let next = null;
    if (real) {
      save.best[trial.id] = Math.max(save.best[trial.id] || 0, v);
      if (stars > prevStars) save.stars[trial.id] = stars;
      next = TRIALS[trialIndex(trial.id) + 1] || null;
      if (stars > 0 && next && !save.unlocked.includes(next.id)) save.unlocked.push(next.id);
      app.persist(true);
    }
    result = { v, stars };
    const msg = stars >= 3 ? 'みごとな本能だ。' : stars === 2 ? 'よく育った本能だ。' : stars === 1 ? '試練をこえた。' : 'まだ届かない。もう少し進化させよう。';
    const card = app.modal(`
      <div class="depth">本番の結果 ・ ${sw.N.toLocaleString()} の光</div>
      <h3>${esc(trial.name)}</h3>
      <div class="result">${pct(v)} <small style="font-size:14px;color:var(--current)">${esc(trial.metricName)}</small></div>
      <div class="stars">${starsHTML(stars)}</div>
      <p class="how">${msg} 学習した世界は1つ1024粒。本番はその${Math.round(sw.P / 1024)}倍の群れに、同じ本能をそのまま入れている。${stars > prevStars && stars > 0 && next ? `<br>次の試練「${esc(next.name)}」へ進めるようになった。` : ''}</p>
      <div class="row">
        <button class="btn ghost small" data-a="watch">このまま眺める</button>
        <button class="btn" data-a="evolve">進化にもどる</button>
        ${stars > 0 && next ? `<button class="btn primary" data-a="next">次の試練へ</button>` : '<button class="btn primary" data-a="retry">もう一度</button>'}
      </div>`, () => {});
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'watch') app.modal(null);
      if (b.dataset.a === 'evolve') goEvolve();
      if (b.dataset.a === 'retry') { app.modal(null); start(); }
      if (b.dataset.a === 'next') app.go('map', { open: next.id });
      if (b.dataset.a === 'epilogue') epilogue();
    });
    if (real && !next && stars > 0 && !save.seenIntro.epilogue) {
      const row = card.querySelector('.row');
      row.insertAdjacentHTML('afterbegin', '<button class="btn primary" data-a="epilogue">海面へ</button>');
    }
  }

  function epilogue() {
    app.save.seenIntro.epilogue = true;
    app.persist(true);
    const c = app.modal(`
      <div class="depth">水深 0m</div>
      <h3>満月の海面</h3>
      <div class="story">${EPILOGUE.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      <p class="how">ラボでは、好きな海の条件で、好きな方向へ本能を進化させられます。</p>
      <div class="row"><button class="btn" data-a="watch">このまま眺める</button><button class="btn primary" data-a="title">タイトルへ</button></div>`);
    c.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'watch') app.modal(null);
      if (b.dataset.a === 'title') app.go('title');
    });
  }

  function goEvolve() {
    if (TRIAL_BY_ID[trial.id]) app.go('evolve', { trial: trial.id });
    else app.go('evolve', { session });
  }

  function toWorld(e) {
    const r = touch.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * WORLD_W;
    const y = (1 - (e.clientY - r.top) / r.height) * WORLD_H;
    return [Math.max(0.01, Math.min(WORLD_W - 0.01, x)), Math.max(0.01, Math.min(WORLD_H - 0.01, y))];
  }

  touch.addEventListener('pointerdown', (e) => {
    touch.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    lastPos = p;
    if (trial.play === 'food') {
      sw.stampFood(p[0], p[1], 0.1, 1);
    } else if (trial.play === 'light') {
      beaconOn = true;
      sw.beacon = p;
    } else if (trial.play === 'jelly' && cfg.predP[0] > 0) {
      const pr = sw.readPredators();
      let bi = 0, bd = 1e9;
      for (let i = 0; i < cfg.predP[0]; i++) {
        const d = Math.hypot(pr[i * 4] - p[0], pr[i * 4 + 1] - p[1]);
        if (d < bd) { bd = d; bi = i; }
      }
      grab = bi;
      grabPos = p;
      sw.setPredator(grab, p[0], p[1], 0, 0);
    }
  });
  touch.addEventListener('pointermove', (e) => {
    const p = toWorld(e);
    if (trial.play === 'light' && beaconOn) sw.beacon = p;
    if (grab >= 0) {
      grabVel = [lastPos ? (p[0] - lastPos[0]) * 0.5 : 0, lastPos ? (p[1] - lastPos[1]) * 0.5 : 0].map((v) => Math.max(-0.006, Math.min(0.006, v)));
      grabPos = p;
    }
    lastPos = p;
  });
  const up = () => { grab = -1; beaconOn = false; lastPos = null; };
  touch.addEventListener('pointerup', up);
  touch.addEventListener('pointercancel', up);

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'back') { if (TRIAL_BY_ID[trial.id]) app.go('map', { open: trial.id }); else app.go('lab'); }
    if (a === 'evolve') goEvolve();
    if (a === 'retry') start();
    if (a === 'quality') {
      const q = ((app.save.settings.quality ?? 2) + 1) % QUALITY.length;
      app.save.settings.quality = q;
      app.persist();
      app.toast(`粒の数: <b>${(QUALITY[q].w * QUALITY[q].h).toLocaleString()}</b>（${QUALITY[q].name}）`);
      start();
    }
  });

  return {
    el,
    enter(arg) {
      if (typeof arg === 'string') arg = { trial: arg };
      const id = (arg && arg.trial) || 'cradle';
      trial = (arg && arg.meta) || TRIAL_BY_ID[id];
      session = (arg && arg.session) || new TrialSession(app, id);
      layout();
      start();
    },
    leave() { app.modal(null); },
    frame(dt) {
      if (!sw) return;
      // 重すぎる端末では粒を減らす（1回だけ）
      if (!downgraded && step > 30 && step < 150) {
        perf.push(dt);
        if (perf.length >= 90) {
          const avg = perf.reduce((a, b) => a + b, 0) / perf.length;
          const q = app.save.settings.quality ?? 2;
          if (avg > 48 && q > 0) {
            downgraded = true;
            app.save.settings.quality = q - 1;
            app.persist();
            app.toast(`動きが重いので、粒の数を <b>${(QUALITY[q - 1].w * QUALITY[q - 1].h).toLocaleString()}</b> にしました（右上の ◎ で変えられます）`, 4500);
            start();
            return;
          }
          perf.length = 0;
          downgraded = true;
        }
      }
      // 光の道しるべ（指を離すとゆっくり消える）
      beaconAmp += ((beaconOn ? 0.9 : 0) - beaconAmp) * 0.15;
      cfg.light[2] = beaconAmp;
      // つかんでいるクラゲは指の位置に（指を止めていても）
      if (grab >= 0 && grabPos) { sw.setPredator(grab, grabPos[0], grabPos[1], grabVel[0], grabVel[1]); grabVel = [grabVel[0] * 0.8, grabVel[1] * 0.8]; }
      sw.step(1);
      step++;
      if (!done && step % 12 === 0) measure();
      if (!done && step >= cfg.steps) finish();
      const v = metricNow();
      big.innerHTML = `${pct(v)}<small>${esc(trial.metricName)}</small>`;
      bar.style.width = `${Math.min(100, v * 100)}%`;
      const sec = Math.min(step, cfg.steps) / 60;
      timeEl.textContent = done ? '自由に眺めています' : `${sec.toFixed(1)} / ${(cfg.steps / 60).toFixed(0)} 秒`;
      const R = app.R;
      R.clear();
      R.drawWorlds(sw, [rect], { trails: true, pointSize: 1.0, bright: 0.62, fade: 0.8 });
    },
    resize: layout,
  };
}
