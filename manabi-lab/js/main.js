// main.js — ブラウザ用の入口。学習エンジン（sim.js ほか純粋モジュール）と、描画・UI をつなぐ
//   ・ライブ: 1x/2x/4x でターンを進め、ターンのあいだは位置を補間して描く
//   ・最大（ヘッドレス高速学習）: 描画をほぼ止め、1フレームの持ち時間いっぱい世代を回す
//   ・リプレイ: 世代のはじめのスナップショットからシーズンを丸ごと記録し直し、巻き戻し・早送りで見る
import { View } from './render.js';
import { Gestures } from './input.js';
import { UI } from './ui.js';
import { Lab, MODE } from './sim.js';
import { recordReplay, REC, REC_N, trailOf } from './replay.js';
import { M, METHODS } from './defs.js';

const SAVE_KEY = 'manabi-lab:save:v1';
const PREF_KEY = 'manabi-lab:prefs:v1';
const TPS = { 1: 6, 2: 12, 4: 24 }; // 1秒あたりのターン数
const REP_TPS = 6;
const FAST_BUDGET = 24; // 最大速で1フレームに使う時間（ミリ秒）
const FAST_DRAW_EVERY = 8; // 最大速のとき、島を描くのは何フレームに1回か
const DEMO_CFG = { mode: MODE.ARENA, seed: 7, founders: 12 }; // タイトルの後ろで動く見本

function readJSON(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}
function writeJSON(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
    return true;
  } catch (e) {
    return false;
  }
}

const app = {
  lab: null,
  view: null,
  ui: null,
  started: false,
  speed: 1,
  acc: 0,
  viewM: M.NN,
  highlight: -1,
  selected: -1,
  replay: null,
  fastTarget: -1,
  fastPrev: 1,
  rate: 0,
  rateWin: [],
  frameN: 0,
  lastSave: 0,
  list: [],
  repPool: [],
  prefs: Object.assign({ pixel: 2, shadows: true, fx: true, speed: 1 }, readJSON(PREF_KEY) || {}),

  savePrefs() {
    writeJSON(PREF_KEY, this.prefs);
  },

  // ---------------------------------------------------- 実験の作成・切り替え
  makeLab(cfg) {
    return new Lab(cfg, { fx: this.prefs.fx });
  },
  setLab(lab) {
    this.lab = lab;
    if (this.view) this.view.setTerrain(lab.terrain);
    const ms = lab.cfg.methods;
    if (!ms.includes(this.viewM)) this.viewM = ms.includes(M.NN) ? M.NN : ms[0];
    this.highlight = -1;
    this.select(-1);
    this.acc = 0;
    this.ui.rebuild();
  },
  island() {
    return this.lab.islandOf(this.viewM) || this.lab.islands[0];
  },
  start(mode) {
    const seed = 1 + Math.floor(Math.random() * 999999);
    this.setLab(this.makeLab({ mode, seed }));
    this.started = true;
    this.ui.showGame();
    this.setSpeed(1);
    this.save(true);
    this.ui.toast(mode === MODE.ARENA ? '1つの島で4つの方式が競争します' : '4つの島で、同じ条件から学びはじめます');
  },
  continueGame() {
    const lab = this.loadSave();
    if (!lab) {
      this.ui.toast('記録を読みこめませんでした。新しく始めてください');
      return;
    }
    this.setLab(lab);
    this.started = true;
    this.ui.showGame();
    this.setSpeed(this.prefs.speed || 1);
    this.ui.toast(`第${lab.gen}世代のはじめから再開しました`);
  },
  newExperiment(cfg) {
    this.exitReplay();
    this.setLab(this.makeLab(cfg));
    this.save(true);
    this.setSpeed(1);
    this.ui.toast('新しい実験を始めました');
  },
  toTitle() {
    this.save(true);
    this.exitReplay();
    this.ui.closeSheet();
    this.started = false;
    this.setSpeed(1);
    // 後ろで動くのは見本の島（保存した実験は「つづきから」で読みこみ直す）
    this.setLab(this.makeLab(DEMO_CFG));
    this.ui.showTitle(this.saveInfo());
  },

  // ---------------------------------------------------- 速さ
  setSpeed(s) {
    if (s === 'max') {
      if (this.speed !== 'max') this.fastPrev = this.speed === 0 ? 1 : this.speed;
      this.lab.setFx(false);
      this.rateWin = [];
      this.rate = 0;
    } else {
      this.lab.setFx(this.prefs.fx);
      this.fastTarget = -1;
      this.prefs.speed = s;
      this.savePrefs();
      if (this.speed === 'max') this.save(true);
    }
    this.speed = s;
    this.acc = 0;
    this.ui.refreshSpeed();
  },
  // 決めた世代数だけ最大速で回し、終わったら元の速さにもどる
  runFast(n) {
    this.exitReplay();
    this.ui.closeSheet();
    const target = this.lab.gen + n;
    this.setSpeed('max');
    this.fastTarget = target;
  },

  setViewMethod(m) {
    if (this.lab.cfg.mode === MODE.ARENA) {
      this.highlight = this.highlight === m ? -1 : m;
    } else {
      if (this.viewM === m) return;
      this.viewM = m;
      this.select(-1);
      if (this.view) this.view.lastGrassTick = -1;
      this.ui.toast(`${METHODS[m].ja}の島を見ています`, m);
    }
    this.ui.hudAcc = 1;
  },
  select(id) {
    this.selected = id;
    if (this.view) this.view.selected = id;
    if (!this.ui) return;
    if (id >= 0) this.ui.showInfo();
    else this.ui.hideInfo();
  },
  setPixel(p) {
    this.prefs.pixel = p;
    this.savePrefs();
    if (this.view) this.view.setPixel(p);
  },
  setShadows(on) {
    this.prefs.shadows = on;
    this.savePrefs();
    if (this.view) this.view.setShadows(on);
  },
  setFx(on) {
    this.prefs.fx = on;
    this.savePrefs();
    if (this.speed !== 'max') this.lab.setFx(on);
  },

  // ---------------------------------------------------- 世代が変わったとき
  onGen() {
    this.ui.onGen(this.lab.genEvents);
    if (this.selected >= 0) this.select(-1);
    if (this.fastTarget >= 0 && this.lab.gen >= this.fastTarget) {
      const n = this.fastTarget;
      this.setSpeed(this.fastPrev || 1);
      this.ui.toast(`第${n}世代まで学ばせました`);
    }
    this.save(false);
  },

  // ---------------------------------------------------- 保存
  save(force) {
    if (!this.started || !this.lab) return false;
    const now = performance.now();
    if (!force && now - this.lastSave < 5000) return false;
    this.lastSave = now;
    return writeJSON(SAVE_KEY, { v: 1, savedAt: Date.now(), viewM: this.viewM, lab: this.lab.toJSON() });
  },
  loadSave() {
    const o = readJSON(SAVE_KEY);
    if (!o || o.v !== 1 || !o.lab) return null;
    try {
      const lab = Lab.fromJSON(o.lab, { fx: this.prefs.fx });
      if (typeof o.viewM === 'number') this.viewM = o.viewM;
      return lab;
    } catch (e) {
      return null;
    }
  },
  saveInfo() {
    const o = readJSON(SAVE_KEY);
    if (!o || !o.lab || !o.lab.cfg) return null;
    const mode = o.lab.cfg.mode === MODE.ARENA ? '競争' : '4つの島';
    return `${mode}・第${o.lab.gen}世代`;
  },

  // ---------------------------------------------------- リプレイ
  startReplay(m, kind) {
    const entry = kind === 'best' ? this.lab.best[m] : this.lab.latest[m];
    if (!entry) {
      this.ui.toast('まだリプレイできる記録がありません');
      return;
    }
    if (this.speed === 'max') this.setSpeed(this.fastPrev || 1);
    const rep = recordReplay(this.lab, entry);
    this.select(-1);
    this.replay = { rep, t: 0, playing: true, speed: 1, lastI: -1, dirs: new Map(), prevAlive: new Map() };
    if (this.view) this.view.lastGrassTick = null;
    this.ui.showReplay();
    if (Math.abs(rep.finalFood - rep.expectedFood) > 1e-6) this.ui.toast('記録とリプレイの結果が少しずれました');
  },
  exitReplay() {
    if (!this.replay) return;
    this.replay = null;
    if (this.view) {
      this.view.setTrail(null);
      this.view.lastGrassTick = null;
    }
    this.ui.hideReplay();
  },
  replayTick() {
    const r = this.replay;
    return Math.max(0, Math.min(r.rep.ticks, r.t) - 1 + 1e-6);
  },
  replayState() {
    const r = this.replay;
    const rep = r.rep;
    const T = rep.ticks;
    let i;
    let frac;
    if (r.t >= T) {
      i = T;
      frac = 1;
    } else {
      i = Math.min(T, Math.floor(r.t) + 1);
      frac = r.t - Math.floor(r.t);
    }
    const f = rep.frames[i];
    const list = this.list;
    list.length = 0;
    const alive = new Map();
    for (let j = 0; j < f.n; j++) {
      const o = j * REC_N;
      if (!f.rec[o + REC.ALIVE]) continue;
      const c = this.repPool[j] || (this.repPool[j] = {});
      c.id = f.rec[o + REC.ID];
      c.m = f.rec[o + REC.M];
      c.x = f.rec[o + REC.X];
      c.y = f.rec[o + REC.Y];
      c.px = f.rec[o + REC.PX];
      c.py = f.rec[o + REC.PY];
      c.act = f.rec[o + REC.ACT];
      c.e = f.rec[o + REC.E];
      c.depth = f.rec[o + REC.DEPTH];
      c.slot = f.rec[o + REC.SLOT];
      c.explore = !!f.rec[o + REC.EXPLORE];
      let dir = c.x > c.px ? 1 : c.x < c.px ? 3 : c.y > c.py ? 2 : c.y < c.py ? 0 : r.dirs.get(c.id) ?? 1;
      r.dirs.set(c.id, dir);
      c.dir = dir;
      list.push(c);
      alive.set(c.id, c);
    }
    // ターンが1つ進んだら、生まれた・死んだ・食べたを粒にする
    if (i !== r.lastI) {
      if (this.view && r.lastI >= 0 && i === r.lastI + 1) {
        const fx = [];
        for (const [id, p] of r.prevAlive) if (!alive.has(id)) fx.push({ t: 'death', x: p.x, y: p.y, m: p.m });
        for (const c of list) {
          if (!r.prevAlive.has(c.id)) fx.push({ t: 'birth', x: c.x, y: c.y, m: c.m });
          else if (c.act === 0 && Math.random() < 0.35) fx.push({ t: 'eat', x: c.x, y: c.y, m: c.m });
        }
        this.view.onFx(fx);
      }
      r.prevAlive = new Map([...alive].map(([id, c]) => [id, { x: c.x, y: c.y, m: c.m }]));
      r.lastI = i;
      if (this.view) this.view.setTrail(rep.focusId >= 0 ? trailOf(rep, rep.focusId, i, 48) : null);
    }
    const focusIdx = rep.focusIndex;
    return {
      grass: f.grass,
      gscale: 1 / 255,
      tick: Math.max(0, i - 1 + frac),
      gtick: -1 - i,
      list,
      frac,
      dim: (c) => c.slot !== focusIdx,
      focus: (c) => c.slot === focusIdx && c.depth === 0,
    };
  },

  // ---------------------------------------------------- ライブの描画用の状態
  liveState(frac) {
    const isl = this.island();
    const list = this.list;
    list.length = 0;
    for (const c of isl.cs) if (c.alive) list.push(c);
    const hl = this.lab.cfg.mode === MODE.ARENA ? this.highlight : -1;
    return {
      grass: isl.grass,
      gscale: 1,
      tick: Math.max(0, isl.tick - 1 + frac),
      gtick: this.lab.gen * 100000 + isl.tick + isl.idx * 0.1,
      list,
      frac,
      dim: hl >= 0 ? (c) => c.m !== hl : null,
      focus: null,
    };
  },
  flushFx() {
    for (const isl of this.lab.islands) {
      if (!isl.fx || !isl.fx.length) continue;
      if (this.view && isl === this.island() && this.speed !== 'max') this.view.onFx(isl.fx);
      isl.fx.length = 0;
    }
  },
};

// ======================================================= 起動
function boot() {
  const canvas = document.getElementById('view');
  try {
    app.view = new View(canvas);
    app.view.setPixel(app.prefs.pixel);
    app.view.setShadows(app.prefs.shadows);
  } catch (e) {
    app.view = null;
    canvas.hidden = true;
  }
  app.ui = new UI(app);
  if (!app.view) app.ui.toast('この端末では3D表示（WebGL）が使えないため、グラフだけで観察します');

  // タイトルの後ろでは、競争モードの島がゆっくり動いている（見本）
  app.setLab(app.makeLab(DEMO_CFG));
  app.speed = 1;
  app.ui.showTitle(app.saveInfo());

  if (app.view) {
    new Gestures(canvas, app.view, (x, y) => {
      if (!app.started || app.replay || app.speed === 'max') return;
      app.select(app.view.pick(x, y));
    });
    window.addEventListener('resize', () => app.view.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => app.view.resize(), 200));
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') app.save(true);
  });
  window.addEventListener('pagehide', () => app.save(true));

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    app.frameN++;
    const lab = app.lab;
    let state = null;
    if (app.replay) {
      const r = app.replay;
      if (r.playing) {
        r.t += dt * REP_TPS * r.speed;
        if (r.t >= r.rep.ticks) {
          r.t = r.rep.ticks;
          r.playing = false;
          app.ui.refreshReplay();
        }
      }
      state = app.replayState();
    } else if (!app.started) {
      // タイトル画面: 見本の島を 1x で動かし、カメラをゆっくり回す
      app.acc += dt * TPS[1];
      let n = 0;
      while (app.acc >= 1 && n++ < 4) {
        app.acc -= 1;
        lab.step();
      }
      if (app.view) app.view.orbit.az += dt * 0.08;
      app.flushFx();
      state = app.liveState(Math.min(1, app.acc));
    } else if (app.speed === 'max') {
      // ヘッドレス高速学習: 描画しないで、持ち時間いっぱい学習を回す
      const t0 = performance.now();
      const g0 = lab.gen;
      while (performance.now() - t0 < FAST_BUDGET) {
        if (lab.step()) {
          app.onGen();
          if (app.speed !== 'max') break;
        }
      }
      app.rateWin.push([now, lab.gen - g0]);
      while (app.rateWin.length && now - app.rateWin[0][0] > 1500) app.rateWin.shift();
      const span = app.rateWin.length > 1 ? (now - app.rateWin[0][0]) / 1000 : 0;
      if (span > 0.2) app.rate = app.rateWin.slice(1).reduce((s, x) => s + x[1], 0) / span;
      app.flushFx();
      if (app.frameN % FAST_DRAW_EVERY === 0) state = app.liveState(1);
    } else {
      if (app.speed > 0) {
        app.acc += dt * TPS[app.speed];
        let n = 0;
        while (app.acc >= 1 && n++ < 8) {
          app.acc -= 1;
          if (lab.step()) app.onGen();
        }
        if (app.acc > 1) app.acc = 1;
      }
      app.flushFx();
      state = app.liveState(app.speed > 0 ? Math.min(1, app.acc) : 1);
    }
    if (app.view && (state || app.speed !== 'max' || !app.started)) app.view.render(dt, state);
    app.ui.tick(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  window.__manabi = app;
}

boot();
