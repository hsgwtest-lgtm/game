// タイトル: 十万の光がただよう
import { $, h } from './dom.js';
import { STAGE_DEFS } from '../sim/stages.js';
import { TRIALS } from '../game/story.js';
import { layoutFor, initialRow } from '../game/session.js';
import { DEMO } from '../game/demo.js';
import { ROW_FLOATS } from '../sim/brain.js';

export function coverRect(w, h, aspect = 1.5) {
  if (h / w > aspect) { const rw = h / aspect; return { x: (w - rw) / 2, y: 0, w: rw, h }; }
  const rh = w * aspect;
  return { x: 0, y: (h - rh) / 2, w, h: rh };
}

// 見せる本能を選ぶ: いちばん先まで進んだ試練の本能。なければ内蔵のお手本
export function ambientPick(app) {
  const save = app.save;
  for (let i = TRIALS.length - 1; i >= 0; i--) {
    const id = TRIALS[i].id;
    const t = save.trials[id];
    if (t && t.champion && save.stars[id]) return { id: id === 'maze' ? 'cradle' : id, row: Float32Array.from(t.champion), layout: layoutFor(id) };
  }
  if (DEMO && DEMO.row && DEMO.row.length === ROW_FLOATS) return { id: DEMO.stage, row: Float32Array.from(DEMO.row), layout: layoutFor(DEMO.stage) };
  return { id: 'cradle', row: initialRow('cradle', save), layout: layoutFor('cradle') };
}

// メニューの後ろで泳ぐ群れ（まだ準備されていなければ用意する）
export function ensureAmbient(app) {
  const sw = app.getSwarm('show');
  if (!sw.cfg || !sw.layout) {
    const pick = ambientPick(app);
    sw.setStage(STAGE_DEFS[pick.id].make(20261030));
    sw.setLayout(pick.layout);
    sw.setRows([pick.row]);
    sw.beaconPath = null;
    sw.reset(4242);
  }
  return sw;
}

export function createTitle(app) {
  const el = $('#s-title');
  el.innerHTML = `
    <div class="wrap">
      <h1>NOCTILUCA</h1>
      <p class="sub">十万の光、ひとつの本能</p>
    </div>
    <div class="menu">
      <button class="btn primary" data-a="start">航海をはじめる</button>
      <button class="btn" data-a="lab">えらぶ進化（ラボ）</button>
      <button class="btn ghost" data-a="how">しくみ</button>
    </div>
    <p class="count"></p>`;
  const count = $('.count', el);
  let sw = null;
  let pick = null;
  let t = 0;

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'start') app.go('map');
    if (a === 'lab') app.go('lab');
    if (a === 'how') app.go('how');
  });

  function setup() {
    sw = app.getSwarm('show');
    pick = ambientPick(app);
    const cfg = STAGE_DEFS[pick.id].make(20261030);
    cfg.predP = [...cfg.predP];
    sw.setStage(cfg);
    sw.setLayout(pick.layout);
    sw.setRows([pick.row]);
    sw.beaconPath = null;
    sw.reset(4242);
    t = 0;
  }

  return {
    el,
    enter() {
      const started = Object.keys(app.save.stars).length > 0 || Object.keys(app.save.trials).length > 0;
      $('[data-a=start]', el).textContent = started ? '航海をつづける' : '航海をはじめる';
      setup();
      count.textContent = `${sw.N.toLocaleString()} の光`;
    },
    leave() {},
    frame(dt) {
      if (!sw) return;
      const R = app.R;
      sw.step(1);
      t++;
      if (t > 1500) { sw.reset(4242 + t); t = 0; }
      R.clear();
      const W = app.canvas.clientWidth, H = app.canvas.clientHeight;
      R.drawWorlds(sw, [coverRect(W, H)], { trails: true, pointSize: 1.1, bright: 0.32, fade: 0.84, ring: 0.3 });
      void dt;
    },
  };
}

export { h };
