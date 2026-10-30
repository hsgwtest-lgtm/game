// NOCTILUCA — 十万の光、ひとつの本能
// 起動・画面の切りかえ・描画ループ
import { createGL } from './gl/gpu.js';
import { Renderer } from './gfx/render.js';
import { Swarm } from './sim/swarm.js';
import { loadSave, writeSave } from './game/save.js';
import { $ } from './ui/dom.js';
import { createTitle } from './ui/title.js';
import { createMap } from './ui/map.js';
import { createEvolve } from './ui/evolve.js';
import { createShow } from './ui/show.js';
import { createHow } from './ui/how.js';
import { createLab } from './ui/lab.js';
import { QUALITY } from './game/quality.js';


const app = {
  save: loadSave(),
  swarms: {},
  screens: {},
  screen: null,
  screenName: '',
  dprCap: 2,
};
window.__app = app;

function bootError(msg) {
  const b = $('#boot');
  b.classList.add('err');
  $('#boot-msg').textContent = msg;
}

app.getSwarm = (kind) => {
  const gl = app.gl;
  if (kind === 'train') {
    if (!app.swarms.train) app.swarms.train = new Swarm(gl, { tilesX: 4, tilesY: 4, blockW: 32, blockH: 32 });
    return app.swarms.train;
  }
  if (kind === 'show') {
    const q = QUALITY[Math.max(0, Math.min(QUALITY.length - 1, app.save.settings.quality ?? 2))];
    const cur = app.swarms.show;
    if (cur && cur.blockW === q.w && cur.blockH === q.h) return cur;
    if (cur) cur.dispose();
    app.swarms.show = new Swarm(gl, { tilesX: 1, tilesY: 1, blockW: q.w, blockH: q.h });
    return app.swarms.show;
  }
  throw new Error('unknown swarm ' + kind);
};

app.go = (name, arg) => {
  if (app.screen && app.screen.leave) app.screen.leave();
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
  app.modal(null);
  app.screenName = name;
  app.screen = app.screens[name];
  app.screen.el.classList.add('on');
  if (app.screen.enter) app.screen.enter(arg);
};

let toastTimer = null;
app.toast = (html, ms = 3200) => {
  const t = $('#toast');
  t.innerHTML = html;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
};

app.modal = (html, onClose) => {
  const m = $('#modal');
  if (!html) { m.classList.remove('on'); m.innerHTML = ''; m.onclick = null; return null; }
  m.innerHTML = `<div class="card">${html}</div>`;
  m.classList.add('on');
  m.onclick = (e) => { if (e.target === m && onClose !== false) { app.modal(null); if (onClose) onClose(); } };
  return m.firstElementChild;
};

app.persist = (now = false) => writeSave(app.save, now);

// テスト用: ?safe=47,34 で iPhone 12 のノッチ（上47pt・下34pt）を再現
(() => {
  const q = new URLSearchParams(location.search).get('safe');
  if (!q) return;
  const [t, b] = q.split(',').map(Number);
  const r = document.documentElement.style;
  r.setProperty('--sat', `${t || 0}px`);
  r.setProperty('--sab', `${b || 0}px`);
})();

function boot() {
  const canvas = $('#gl');
  try {
    app.gl = createGL(canvas);
  } catch (e) {
    bootError(e.message + '。iPhone なら iOS 15 以降の Safari で開いてください。');
    return;
  }
  app.canvas = canvas;
  app.R = new Renderer(app.gl, canvas);
  app.R.resize(app.dprCap);
  try {
    app.screens.title = createTitle(app);
    app.screens.map = createMap(app);
    app.screens.evolve = createEvolve(app);
    app.screens.show = createShow(app);
    app.screens.how = createHow(app);
    app.screens.lab = createLab(app);
  } catch (e) {
    console.error(e);
    bootError('準備に失敗しました: ' + e.message);
    return;
  }
  const params = new URLSearchParams(location.search);
  app.go(params.get('screen') || 'title', params.get('arg') || undefined);
  setTimeout(() => $('#boot').classList.add('gone'), 250);
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(100, now - last);
    last = now;
    app.R.resize(app.dprCap);
    app.R.time = now / 1000;
    try {
      if (app.screen && app.screen.frame) app.screen.frame(dt, now);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const gl = app.gl;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); bootError('GPU がリセットされました。ページを読みこみ直してください。'); $('#boot').classList.remove('gone'); });
  void gl;
  document.addEventListener('visibilitychange', () => { if (document.hidden) app.persist(true); });
  window.addEventListener('pagehide', () => app.persist(true));
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
