// トレーニング画面: 強化学習（PPO）でロボを育てる。学習の様子をいろいろな角度で見られる。

import { C, TEAM } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text, mini, measure } from '../gfx/font.js';
import { lineChart, radar, miniArena, shareBar, signedBar, bar } from '../ui/charts.js';
import { deckRows, cardInfo, fmtNum } from '../ui/deckedit.js';
import { cardBadge, valueColor, icon, botPortrait } from '../ui/widgets.js';
import { Coach, oppName, radarOf, personality, shortSteps, fmtSteps, RADAR_KEYS } from '../game/coach.js';
import { CPU_DEFS } from '../sim/bots.js';
import { ARENAS } from '../sim/arenas.js';
import { CARD, cardValue, fmtValue, cleanDeck } from '../sim/rewards.js';
import { EV, VIEW, VIEW_N } from '../sim/env.js';
import { Net, ARCH } from '../ml/net.js';
import { Rng, randomSeed } from '../core/rng.js';
import { ENT_LEVELS, MILESTONES, gridToB64 } from '../game/save.js';
import { LEAGUE } from '../game/league.js';
import { ICONS, bitmap } from '../gfx/sprites.js';

const TABS = ['グラフ', 'ごほうび', 'せいかく', 'アリーナ', 'のう'];
const SPEEDS = ['観察', 'ふつう', 'MAX'];
const ACT_NAMES = ['とまる', '↑', '→', '↓', '←', '弾'];

export class TrainScreen {
  constructor(app) {
    this.app = app;
    this.tab = 0;
    this.coach = new Coach();
  }

  // 練習相手にできる CPU（勝った相手と、次の相手）
  availableCpus() {
    const G = this.app.G;
    const out = [];
    for (let i = 0; i < LEAGUE.length; i++) {
      const L = LEAGUE[i];
      if (L.opp.type !== 'cpu') continue;
      if (G.s.league.cleared[L.id] || i <= G.leagueIndex()) out.push(L.opp.key);
    }
    if (!out.includes('koro')) out.unshift('koro');
    return out;
  }

  oppsSpec() {
    const bot = this.app.G.bot;
    const avail = this.availableCpus();
    let opps = (bot.train.opps || []).filter(k => k === 'self' || avail.includes(k));
    if (!opps.length) opps = ['koro'];
    bot.train.opps = opps;
    return opps.map(k => k === 'self' ? { type: 'self' } : { type: 'cpu', key: k });
  }

  arenasSpec() {
    const G = this.app.G, bot = G.bot;
    let a = (bot.train.arenas || []).filter(x => G.arenaUnlocked(x));
    if (!a.length) a = [G.unlock.arenas[0] || 0];
    bot.train.arenas = a;
    return a;
  }

  async enter(p = {}) {
    const app = this.app, G = app.G;
    const token = this.token = (this.token || 0) + 1;
    this.ret = p.ret || 'home';
    this.bot = G.bot;
    const bot = this.bot;
    bot.deck = cleanDeck(bot.deck.filter(d => G.cardUnlocked(d.id)), G.slots);
    this.hist = [];
    this.frames = null;
    this.log = [];
    this.coach.reset();
    this.coach.stepMark = bot.steps;
    this.lastIter = null;
    this.sheet = null;
    this.info = null;
    this.paused = false;
    this.speed = bot.train.speed ?? 1;
    this.sessionSec = 0;
    this.stepsAtStart = bot.steps;
    this.rate = 0;
    this.rateT = 0; this.rateSteps = bot.steps;
    this.saving = false;
    this.exiting = false;
    this.demoNet = null;
    this.pendingNet = null;
    this.demoSpeed = 1;
    this.demoWait = 0;
    this.lastSaveT = 0;
    this.toldLeague = false;
    this.ready = false;
    this.err = null;
    app.world.camMode = 'fit';
    app.world.zoom = 1.04;
    app.world.focus = null;
    app.sound.playSong('train');
    // 前の保存が終わるのを待つ
    if (app.trainSaving) await app.trainSaving;
    const rec = await G.loadBrainRecord(bot);
    // 待っている間に画面を出ていたら何もしない
    if (token !== this.token || app.curName !== 'train') return;
    this.demoNet = new Net(ARCH);
    if (rec) this.demoNet.p.set(rec.p); else this.demoNet.init(new Rng(randomSeed()));
    const params = rec ? rec.p : this.demoNet.p.slice();
    // 学習の記録（グラフ）をつなぐ
    for (const h of bot.hist.slice(-80)) this.hist.push({ it: 0, steps: h.s, win: h.w, share: h.sh, R: h.r, ent: h.e, old: true });
    app.trainer.on('ready', () => { this.ready = true; })
      .on('iter', (m) => this.onIter(m))
      .on('frame', (m) => { this.frames = m.envs; })
      .on('auto', (m) => this.onParams(m))
      .on('error', (m) => { this.err = m.msg; app.ui.toast('学習でエラー: ' + m.msg, C.scarlet, 5); });
    app.trainer.start({
      params, adam: rec && rec.m ? { m: rec.m, v: rec.v, t: rec.t } : null, rs: rec ? rec.rs : null,
      deck: bot.deck, opps: this.oppsSpec(), arenas: this.arenasSpec(), ent: ENT_LEVELS[bot.train.ent ?? 1],
      speed: this.speed, seed: randomSeed(), steps: bot.steps, iters: bot.iters,
    });
    this.newDemo();
    this.say(bot.steps ? `続きから学習（${fmtSteps(bot.steps)}手 学習ずみ）` : 'でたらめに動くところから、ごほうびをたよりに学んでいくよ', C.mint);
  }

  say(text, color = C.white) {
    this.log.push({ text, color, t: this.app.t });
    if (this.log.length > 30) this.log.shift();
  }

  onIter(m) {
    const app = this.app, bot = this.bot;
    this.lastIter = m;
    const S = m.sum;
    const pt = { it: m.iter, steps: m.steps, win: S.winRate, share: S.share, R: S.R, ent: m.loss.entropy, kl: m.loss.kl, ev: m.loss.explained, cards: S.cards, n: S.n };
    if (S.n > 0) this.hist.push(pt);
    if (this.hist.length > 400) this.hist = this.hist.filter((_, i) => i % 2 === 0 || i === this.hist.length - 1);
    bot.steps = m.steps;
    bot.iters = m.iter;
    if (S.n >= 4) {
      bot.evs = S.evs.map(v => Math.round(v * 100) / 100);
      bot.radar = radarOf(S);
      if (m.iter % 4 === 0) app.G.pushHist(bot, { s: m.steps, w: round2(S.winRate), sh: round2(S.share), r: Math.round(S.R * 10) / 10, e: round2(m.loss.entropy) });
    }
    for (const msg of this.coach.onIter(m, bot.deck)) {
      this.say(msg.text, msg.color);
      if (msg.big) { app.ui.toast(msg.text, msg.color, 2.6); app.sound.play('levelup'); }
    }
    if (this.speed < 2 && app.curName === 'train') app.sound.play('learn');
    // つぎのリーグの相手に勝てそうなら知らせる
    const li = app.G.leagueIndex();
    const nextL = LEAGUE[li];
    if (nextL && nextL.opp.type === 'cpu' && !this.toldLeague) {
      const b = S.byOpp[nextL.opp.key];
      if (b && b.n >= 8 && b.winRate >= 0.7) {
        this.toldLeague = true;
        const msg = `${nextL.name}に勝てそう！ もどって CPUリーグで挑戦しよう`;
        this.say(msg, C.gold);
        app.ui.toast(msg, C.gold, 3.5);
      }
    }
    // アルバムの節目（まだ残していない一番大きい節目を1回だけ）
    if (!this.snapPending) {
      let k = -1;
      for (let i = 0; i < MILESTONES.length; i++) if (MILESTONES[i] > (bot.msLast || 0) && m.steps >= MILESTONES[i]) k = i;
      if (k >= 0) { bot.msLast = MILESTONES[k]; this.snapPending = MILESTONES[k]; }
    }
  }

  async onParams(m) {
    const app = this.app, bot = this.bot;
    if (!m || !m.params) return;
    const net = new Net(ARCH);
    net.p.set(m.params);
    this.pendingNet = net;
    this.latestMsg = m;
    // ライブ試合の脳をその場で新しくする（動きがだんだん変わっていく）
    const mt = app.spec.match;
    if (mt && mt.ctl[0] && mt.ctl[0].isNet && !mt.done) { mt.ctl[0].net = net; this.demoNet = net; this.pendingNet = null; this.brainFlash = app.t; }
    // アルバム
    if (this.snapPending) {
      const ms = this.snapPending;
      this.snapPending = null;
      const S = this.lastIter ? this.lastIter.sum : null;
      const g = this.frames && this.frames[0] ? gridToB64(this.frames[0].g) : '';
      await app.G.addSnapshot(bot, m.params, { steps: m.steps, w: S ? S.winRate : 0, sh: S ? S.share : 0, label: fmtSteps(ms) + '手', g });
      this.say(`アルバムに保存: ${fmtSteps(m.steps)}手のころの${bot.name}`, C.teal);
    }
    // 30秒ごとに保存
    if (app.t - this.lastSaveT > 30) { this.lastSaveT = app.t; await app.G.saveBrain(bot, m); app.G.save(); }
  }

  newDemo() {
    const app = this.app, bot = this.bot;
    if (this.pendingNet) { this.demoNet = this.pendingNet; this.pendingNet = null; }
    const opps = bot.train.opps;
    const k = opps[Math.floor(Math.random() * opps.length)];
    const arenas = bot.train.arenas;
    const arena = arenas[Math.floor(Math.random() * arenas.length)];
    this.demoOpp = k;
    const b = k === 'self' ? { type: 'net', net: this.demoNet.clone(), temp: 1 } : { type: 'cpu', key: k };
    app.spec.start({
      arena, seed: randomSeed(), a: { type: 'net', net: this.demoNet, temp: 1 }, b, speed: this.demoSpeed,
      deck: bot.deck, side: 0, policy: app.G.settings.policy ? 0 : -1,
      onEnd: (res) => {
        this.demoWait = 1.6;
        this.demoRes = res;
      },
    });
    this.demoRes = null;
  }

  leave(next) {
    const app = this.app;
    this.token++;
    app.spec.stop();
    this.heatOn = false;
    app.world.setHeat(null);
    if (!this.exiting) this.saveAndStop();
    app.world.zoom = 1;
  }

  saveAndStop() {
    const app = this.app, bot = this.bot;
    this.exiting = true;
    const p = (async () => {
      const m = await app.trainer.stop();
      if (m && m.params) {
        bot.steps = m.steps; bot.iters = m.iters;
        await app.G.saveBrain(bot, m);
      }
      bot.trainSec = (bot.trainSec || 0) + this.sessionSec;
      bot.train.speed = this.speed;
      app.G.save(true);
    })();
    app.trainSaving = p;
    return p;
  }

  onHide() { if (this.latestMsg) this.app.G.saveBrain(this.bot, this.latestMsg); this.app.G.save(true); }

  // きもちマップ: 学習中のロボを各マスに置いたときの「価値」を計算
  computeHeat() {
    const app = this.app;
    const m = app.spec.match;
    if (!m || !m.ctl[0] || !m.ctl[0].isNet) return;
    const env = m.env, net = m.ctl[0].net;
    const b = env.bots[0], o = env.bots[1];
    const ox = b.x, oy = b.y;
    const obs = this._hobs || (this._hobs = new Float32Array(net.arch.nIn));
    const lg = this._hlg || (this._hlg = new Float64Array(net.arch.nAct));
    const vals = new Float32Array(env.grid.length);
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < env.grid.length; c++) {
      if (env.grid[c] === 3) continue;
      const x = c % 16, y = (c / 16) | 0;
      if (x === o.x && y === o.y) continue;
      b.x = x; b.y = y;
      env.observe(0, obs);
      const v = net.forward(obs, lg);
      vals[c] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    b.x = ox; b.y = oy;
    env.blkDirty = true;
    const span = Math.max(1e-6, hi - lo);
    const heat = new Float32Array(env.grid.length);
    for (let c = 0; c < heat.length; c++) heat[c] = env.grid[c] === 3 ? 0 : (vals[c] - lo) / span;
    app.world.setHeat(heat);
  }

  update(dt) {
    const app = this.app;
    if (!this.paused) this.sessionSec += dt;
    app.spec.update(dt);
    if (this.heatOn) {
      this.heatT = (this.heatT || 0) - dt;
      if (this.heatT <= 0) { this.heatT = 0.4; this.computeHeat(); }
    }
    if (this.demoWait > 0) { this.demoWait -= dt; if (this.demoWait <= 0) this.newDemo(); }
    this.rateT += dt;
    if (this.rateT > 1.5) {
      this.rate = (this.bot.steps - this.rateSteps) / this.rateT;
      this.rateT = 0; this.rateSteps = this.bot.steps;
    }
  }

  _layout() {
    const app = this.app, H = app.H;
    const bottom = H - app.bottom;
    const ctrlY = bottom - 24;
    const logY = ctrlY - 27;
    const viewH = Math.max(150, Math.min(240, Math.floor(H * 0.39)));
    const tabY = viewH + 1;
    const cY = tabY + 18;
    return { bottom, ctrlY, logY, viewH, tabY, cY, cH: logY - cY - 3 };
  }

  view() { return { y: 0, h: this._layout().viewH, padT: this.app.top + 17, padB: 15 }; }

  draw(ui) {
    const app = this.app, fb = ui.fb, G = app.G, bot = this.bot;
    const W = ui.W, H = ui.H;
    const L = this._layout();
    if (this.sheet || this.info) ui.block();
    // ── 3Dの上の表示 ──
    const v = { y: 0, w: W, h: L.viewH };
    app.spec.drawPopups(ui, v);
    const ty = app.top;
    fb.rrect(3, ty, 118, 16, col(C.ink));
    text(fb, this.ready ? `学習 #${bot.iters}` : '準備中…', 7, ty + 3, col(this.paused ? C.lilac : C.mint));
    ui.mini(shortSteps(bot.steps), 117, ty + 6, C.white, 'right');
    if (this.brainFlash && app.t - this.brainFlash < 0.6) text(fb, '脳を更新', 6, ty + 19, col(C.gold), { outline: col(C.ink) });
    if (ui.button('tr-dspeed', W - 33, ty, 30, 16, `×${this.demoSpeed}`, { face: C.night })) {
      this.demoSpeed = this.demoSpeed >= 4 ? 1 : this.demoSpeed * 2;
      app.spec.speed = this.demoSpeed;
    }
    if (ui.button('tr-heat', W - 84, ty, 48, 16, 'きもち', { face: this.heatOn ? C.amber : C.night, fg: this.heatOn ? C.ink : C.white })) {
      this.heatOn = !this.heatOn;
      if (!this.heatOn) app.world.setHeat(null);
      else this.say('きもちマップ: ロボが「そのマスにいたら、この先どれだけごほうびがもらえそう」と思っているか（明るいほど高い）', C.gold);
    }
    if (this.heatOn) {
      const hy = L.viewH - 26;
      fb.rrect(4, hy, 88, 11, col(C.ink));
      const hc = [C.grape, C.violet, C.rose, C.coral, C.salmon, C.tan, C.sand, C.gold, C.cream];
      for (let i = 0; i < hc.length; i++) fb.rect(6 + i * 4, hy + 3, 4, 5, col(hc[i]));
      text(fb, '低い→高い', 44, hy, col(C.white));
    }
    const env = app.spec.env;
    if (env) {
      const by = L.viewH - 13;
      fb.rect(0, by - 2, W, 15, col(C.ink));
      shareBar(fb, 6, by + 3, 70, 5, env.score(0), env.score(1), env.floor);
      text(fb, `LIVE vs ${oppName(this.demoOpp)}`, 82, by, col(C.white), { maxW: W - 130 });
      ui.mini(`${Math.max(0, Math.ceil((240 - env.t) / 6))}S`, W - 5, by + 3, C.mist, 'right');
      if (this.demoRes) {
        const r = this.demoRes;
        const s = r.winner === 0 ? 'かち！' : r.winner === 1 ? 'まけ…' : 'ひきわけ';
        text(fb, s, W >> 1, L.viewH >> 1, col(r.winner === 0 ? C.gold : C.mist), { align: 'center', outline: col(C.ink), scale: 2 });
      }
    }
    // ── タブ ──
    fb.rect(0, L.tabY - 1, W, H - L.tabY + 1, col(C.ink));
    this.tab = ui.tabs('tr-tab', 2, L.tabY, W - 4, 16, TABS, this.tab);
    fb.pushClip(0, L.cY, W, L.cH);
    const cx = 6, cw = W - 12;
    if (this.tab === 0) this.drawGraph(ui, cx, L.cY + 2, cw, L.cH - 2);
    else if (this.tab === 1) this.drawRewards(ui, cx, L.cY + 2, cw, L.cH - 2);
    else if (this.tab === 2) this.drawPersona(ui, cx, L.cY + 2, cw, L.cH - 2);
    else if (this.tab === 3) this.drawArenas(ui, cx, L.cY + 2, cw, L.cH - 2);
    else this.drawBrain(ui, cx, L.cY + 2, cw, L.cH - 2);
    fb.popClip();
    // ── 実況 ──
    fb.rect(0, L.logY - 1, W, 26, col(C.night));
    const lines = this.log.slice(-2);
    lines.forEach((l, i) => {
      const age = app.t - l.t;
      const c = i === lines.length - 1 && age < 0.3 && Math.floor(age * 20) % 2 ? C.white : l.color;
      text(fb, l.text, 5, L.logY + 1 + i * 12, col(c), { maxW: W - 10 });
    });
    // ── 操作 ──
    const y = L.ctrlY;
    if (ui.button('tr-pause', 4, y, 24, 22, '', { icon: this.paused ? 'play' : 'pause', face: this.paused ? C.green : C.night })) {
      this.paused = !this.paused;
      if (this.paused) app.trainer.pause(); else app.trainer.resume();
      this.say(this.paused ? '学習を一時停止' : '学習を再開', C.lilac);
    }
    const sws = [34, 36, 32];
    let sx = 31;
    for (let i = 0; i < 3; i++) {
      if (ui.chip('tr-sp' + i, sx, y, sws[i], 22, SPEEDS[i], this.speed === i, { onFace: i === 2 ? C.ruby : C.sea })) {
        this.speed = i; app.trainer.setSpeed(i);
        if (i === 0) this.say('観察モード: アリーナタブで学習中の試合がゆっくり見えるよ', C.lilac);
        if (i === 2) this.say('ぜんりょく: いちばん速く学習（電池をたくさん使う）', C.lilac);
      }
      sx += sws[i] + 1;
    }
    if (ui.button('tr-set', sx + 2, y, 24, 22, '', { icon: 'gear', face: C.night })) this.sheet = 'set';
    if (ui.button('tr-exit', W - 48, y, 44, 22, 'もどる', { face: C.indigo })) this.exit();
    // ── シート ──
    if (this.sheet || this.info) ui.unblock();
    if (this.sheet === 'set') this.drawSettings(ui);
    if (this.info) { if (cardInfo(app, this.info, bot.deck) === 'close') this.info = null; }
  }

  async exit() {
    const app = this.app;
    if (this.exiting) return;
    app.ui.toast('保存しています…', C.mint, 1.2);
    app.spec.stop();
    await this.saveAndStop();
    app.go(this.ret);
  }

  // ── グラフ ──
  drawGraph(ui, x, y, w, h) {
    const fb = ui.fb;
    const hs = this.hist.slice(-160);
    const S = this.lastIter ? this.lastIter.sum : null;
    const L = this.lastIter ? this.lastIter.loss : null;
    const ch = Math.max(50, Math.floor(h * 0.42));
    text(fb, '勝率', x, y, col(C.gold));
    text(fb, S ? `${Math.round(S.winRate * 100)}%` : '--', x + 26, y, col(C.white));
    text(fb, '床', x + 66, y, col(C.sky));
    text(fb, S ? `${Math.round(S.share * 100)}%` : '--', x + 80, y, col(C.white));
    ui.mini(`${fmtRate(this.rate)}/S`, x + w, y + 3, C.lilac, 'right');
    lineChart(fb, x + 1, y + 13, w - 2, ch, [
      { data: hs.map(p => p.share), color: C.sky },
      { data: hs.map(p => p.win), color: C.gold },
    ], { min: 0, max: 1, grid: [0.25, 0.5, 0.75] });
    let yy = y + 13 + ch + 6;
    const h2 = Math.max(24, Math.floor((h - (yy - y) - 26) / 2));
    text(fb, 'ごほうび/試合', x, yy, col(C.leaf));
    text(fb, S ? fmtNum(S.R) : '--', x + 80, yy, col(C.white));
    lineChart(fb, x + 1, yy + 12, (w >> 1) - 6, h2, [{ data: hs.map(p => p.R), color: C.leaf }], { grid: [0] });
    text(fb, '迷い', x + (w >> 1) + 2, yy, col(C.lavender));
    text(fb, L ? L.entropy.toFixed(2) : '--', x + (w >> 1) + 30, yy, col(C.white));
    lineChart(fb, x + (w >> 1) + 3, yy + 12, (w >> 1) - 4, h2, [{ data: hs.map(p => p.ent), color: C.lavender }], { min: 0, max: 1.8, grid: [0.9] });
    yy += 12 + h2 + 5;
    const sec = Math.floor(this.sessionSec);
    text(fb, `${fmtSteps(this.bot.steps)}手  今回 ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}  価値の当たり ${L ? Math.round(Math.max(0, L.explained) * 100) + '%' : '--'}`, x, yy, col(C.mist), { maxW: w });
  }

  // ── ごほうび（内訳と、その場で編集）──
  drawRewards(ui, x, y, w, h) {
    const app = this.app, fb = ui.fb, bot = this.bot;
    const S = this.lastIter ? this.lastIter.sum : null;
    text(fb, '1試合でもらったごほうび', x, y, col(C.white));
    text(fb, S ? fmtNum(S.R) : '--', x + w, y, col(S ? valueColor(S.R) : C.mist), { align: 'right' });
    const off = ui.beginScroll('tr-rw', x - 2, y + 13, w + 4, h - 13);
    let yy = y + 15 + off;
    let max = 1;
    if (S) for (const d of bot.deck) max = Math.max(max, Math.abs(S.cards[CARD[d.id].ev] || 0));
    const r = deckRows(app, x, yy, w, bot.deck, { id: 'trd', rowH: 30, noRemove: false });
    // 各カードの稼ぎ（行の下に棒）
    if (S) {
      bot.deck.forEach((d, i) => {
        const v = S.cards[CARD[d.id].ev] || 0;
        const ry = yy + i * 30 + 25;
        signedBar(fb, x + 22, ry, w - 22 - 40, 2, v, max);
        mini(fb, fmtNum(v), x + w - 36, ry - 2, col(valueColor(v)));
      });
    }
    if (r.changed) {
      app.trainer.setDeck(bot.deck);
      app.G.save();
      this.say('ごほうびを変更！ ここから学習の向きが変わるよ', C.gold);
    }
    if (r.info) this.info = r.info;
    yy += r.h + 4;
    if (bot.deck.length < app.G.slots) {
      if (ui.button('tr-addcard', x, yy, w, 18, 'カードを追加（設計画面へ）', { face: C.night, fg: C.mist })) { this.exitTo('design'); }
      yy += 22;
    }
    ui.textBlock('学習中に値を変えると、ロボの行動がだんだん変わっていく様子が見られる', x, yy, w, C.lilac);
    yy += 26;
    ui.endScroll('tr-rw', yy - (y + 15 + off) + 4);
  }

  async exitTo(name) {
    if (this.exiting) return;
    this.app.spec.stop();
    await this.saveAndStop();
    this.app.go(name, { ret: 'train' });
  }

  // ── せいかく ──
  drawPersona(ui, x, y, w, h) {
    const fb = ui.fb, bot = this.bot;
    const S = this.lastIter ? this.lastIter.sum : null;
    const r = Math.min(32, Math.floor((h - 34) / 2));
    const rcx = x + 60, rcy = y + r + 14;
    radar(fb, rcx, rcy, r, bot.radar, C.mint, {});
    text(fb, personality(bot.radar), rcx, y + r * 2 + 28, col(C.sky), { align: 'center' });
    let yy = y;
    const sx = x + 130;
    text(fb, '1試合あたり', sx, yy, col(C.white));
    yy += 13;
    const e = S ? S.evs : null;
    const rows = [['ぬった', EV.PAINT, C.emerald], ['うばった', EV.STEAL, C.amber], ['命中', EV.HIT, C.scarlet], ['ピヨった', EV.STUNNED, C.lavender], ['爆弾', EV.ITEM, C.hotpink], ['弾', EV.SHOT, C.salmon], ['かべ', EV.BUMP, C.mist]];
    for (const [nm, k, c] of rows) {
      text(fb, nm, sx, yy, col(c));
      text(fb, e ? (e[k] >= 10 ? Math.round(e[k]) : e[k].toFixed(1)) : '--', x + w, yy, col(C.white), { align: 'right' });
      yy += 11;
    }
    yy += 3;
    text(fb, '相手ごとの勝率', sx, yy, col(C.white));
    yy += 12;
    if (S) for (const id in S.byOpp) {
      const b = S.byOpp[id];
      text(fb, oppName(id), sx, yy, col(C.mist), { maxW: 56 });
      bar(fb, sx + 58, yy + 3, w - (sx - x) - 58 - 22, 5, b.winRate, b.winRate >= 0.5 ? C.emerald : C.salmon);
      mini(fb, `${Math.round(b.winRate * 100)}`, x + w, yy + 3, col(C.white), 'right');
      yy += 11;
      if (yy > y + h - 8) break;
    }
  }

  // ── 並列アリーナ ──
  drawArenas(ui, x, y, w, h) {
    const fb = ui.fb;
    const fr = this.frames;
    text(fb, this.speed === 0 ? '学習中の8試合（観察モード）' : '学習中の8試合（同時進行）', x, y, col(C.white), { maxW: w });
    if (!fr) { text(fb, '準備中…', x, y + 20, col(C.mist)); return; }
    const s = 3, aw = 16 * s;
    const cols = 4;
    const gx = Math.floor((w - cols * aw) / (cols + 1));
    for (let i = 0; i < Math.min(8, fr.length); i++) {
      const f = fr[i];
      const ax = x + gx + (i % cols) * (aw + gx);
      const ay = y + 14 + Math.floor(i / cols) * (aw + 18);
      miniArena(fb, ax, ay, s, f.g, f.b, f.it, { hi: f.side, frameColor: f.side === 0 ? TEAM[0].main : TEAM[1].main });
      text(fb, oppName(f.opp), ax, ay + aw + 2, col(C.lilac), { maxW: aw + gx - 2 });
    }
    const yy = y + 14 + 2 * (aw + 18);
    if (yy < y + h - 10) ui.textBlock('白い印が学習中のロボ。枠の色がその試合でのチーム', x, yy, w, C.dusk);
  }

  // ── のう（AIの頭の中）──
  drawBrain(ui, x, y, w, h) {
    const fb = ui.fb, app = this.app;
    const m = app.spec.match;
    if (!m || !m.ctl[0].isNet) { text(fb, '準備中…', x, y + 10, col(C.mist)); return; }
    const ctl = m.ctl[0];
    const obs = ctl.obs, net = ctl.net;
    // AIの目（7×7）
    text(fb, 'AIの目', x, y, col(C.white));
    const cs = 6;
    const ex = x, ey = y + 13;
    for (let r = 0; r < VIEW; r++) for (let c = 0; c < VIEW; c++) {
      const k = r * VIEW + c;
      let cc = C.pale;
      if (obs[k + 2 * VIEW_N]) cc = C.dusk;
      else if (obs[k]) cc = TEAM[0].main;
      else if (obs[k + VIEW_N]) cc = TEAM[1].main;
      fb.rect(ex + c * cs, ey + r * cs, cs - 1, cs - 1, col(cc));
      if (obs[k + 3 * VIEW_N]) fb.rect(ex + c * cs + 1, ey + r * cs + 1, cs - 3, cs - 3, col(C.hotpink));
    }
    // 自分（中央）
    fb.frame(ex + 3 * cs - 1, ey + 3 * cs - 1, cs + 1, cs + 1, col(C.white));
    // 相手の向き
    const g = 4 * VIEW_N;
    const edx = obs[g + 8], edy = obs[g + 9];
    const ax = ex + 3 * cs + 2, ay = ey + 3 * cs + 2;
    const len = Math.min(18, Math.hypot(edx, edy) * 60);
    const ang = Math.atan2(edy, edx);
    fb.line(ax, ay, Math.round(ax + Math.cos(ang) * (len + 4)), Math.round(ay + Math.sin(ang) * (len + 4)), col(TEAM[1].light));
    text(fb, '赤線=相手の方角', ex, ey + VIEW * cs + 3, col(C.lilac));
    // 隠れ層
    const hx = x + 52;
    text(fb, 'ニューロン', hx, y, col(C.white));
    const drawLayer = (arr, lx, ly) => {
      let mx = 0.001;
      for (let i = 0; i < arr.length; i++) mx = Math.max(mx, arr[i]);
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i] / mx;
        const c = v <= 0.01 ? C.ink : v < 0.25 ? C.violet : v < 0.5 ? C.purple : v < 0.75 ? C.lavender : C.pink;
        fb.rect(lx + (i % 8) * 5, ly + Math.floor(i / 8) * 5, 4, 4, col(c));
      }
    };
    drawLayer(net.h1, hx, y + 13);
    drawLayer(net.h2, hx + 44, y + 13);
    mini(fb, 'L1', hx, y + 55, col(C.dusk));
    mini(fb, 'L2', hx + 44, y + 55, col(C.dusk));
    // 出力
    const ox = x + 146;
    text(fb, 'えらぶ確率', ox, y, col(C.white));
    const pr = ctl.prob;
    for (let a = 0; a < 6; a++) {
      const yy = y + 13 + a * 10;
      const on = a === ctl.lastAction;
      text(fb, ACT_NAMES[a], ox, yy, col(on ? C.gold : C.mist));
      bar(fb, ox + 30, yy + 3, w - (ox - x) - 30 - 18, 5, pr[a], on ? C.gold : C.sky);
      mini(fb, `${Math.round(pr[a] * 100)}`, x + w, yy + 3, col(C.white), 'right');
    }
    const vy = y + 13 + 6 * 10 + 6;
    text(fb, `この先のごほうび予想: ${fmtNum(ctl.value)}`, x, Math.max(vy, ey + VIEW * cs + 16), col(C.leaf), { maxW: w });
    ui.textBlock('目（まわり7×7マス＋相手・爆弾・時間など259個の数）→ 64 → 64 のニューロン → 6つの行動の確率', x, Math.max(vy, ey + VIEW * cs + 16) + 14, w, C.dusk);
  }

  // ── 設定シート ──
  drawSettings(ui) {
    const app = this.app, fb = ui.fb, G = app.G, bot = this.bot;
    const W = ui.W;
    const h = 236 + app.bottom;
    const y = ui.sheet(h, 'トレーニングの設定');
    let yy = y + 20;
    ui.header(8, yy, W - 16, 'スパーリング相手（学習の相手）');
    yy += 14;
    const avail = this.availableCpus().concat(['self']);
    const cw = Math.floor((W - 16 - 6) / 3);
    let changed = false;
    avail.forEach((k, i) => {
      const on = bot.train.opps.includes(k);
      const cx = 8 + (i % 3) * (cw + 3), cy = yy + Math.floor(i / 3) * 21;
      if (ui.chip('ts-o-' + k, cx, cy, cw, 19, k === 'self' ? '分身' : CPU_DEFS[k].name, on)) {
        if (on && bot.train.opps.length > 1) bot.train.opps = bot.train.opps.filter(x => x !== k);
        else if (!on) bot.train.opps.push(k);
        changed = true;
      }
    });
    yy += Math.ceil(avail.length / 3) * 21 + 6;
    if (changed) { app.trainer.setOpps(this.oppsSpec()); G.save(); this.say('スパーリング相手を変更', C.lilac); }
    ui.header(8, yy, W - 16, 'アリーナ');
    yy += 14;
    let ch2 = false;
    ARENAS.forEach((A, i) => {
      const unlocked = G.arenaUnlocked(i);
      const on = bot.train.arenas.includes(i);
      const cx = 8 + (i % 3) * (cw + 3), cy = yy + Math.floor(i / 3) * 21;
      if (ui.chip('ts-a-' + i, cx, cy, cw, 19, unlocked ? A.name : '？？？', on, { disabled: !unlocked })) {
        if (on && bot.train.arenas.length > 1) bot.train.arenas = bot.train.arenas.filter(x => x !== i);
        else if (!on) bot.train.arenas.push(i);
        ch2 = true;
      }
    });
    yy += 2 * 21 + 6;
    if (ch2) { app.trainer.setArenas(this.arenasSpec()); G.save(); }
    ui.header(8, yy, W - 16, '好奇心（迷いボーナス）');
    yy += 14;
    const names = ['ひかえめ', 'ふつう', 'つよめ'];
    for (let i = 0; i < 3; i++) {
      if (ui.chip('ts-e-' + i, 8 + i * (cw + 3), yy, cw, 19, names[i], (bot.train.ent ?? 1) === i)) {
        bot.train.ent = i; app.trainer.setEnt(ENT_LEVELS[i]); G.save();
        this.say(`好奇心を「${names[i]}」に`, C.lilac);
      }
    }
    yy += 24;
    ui.textBlock('好奇心が強いと色々ためす（学ぶのはゆっくり）。弱いと早く決めつける', 8, yy, W - 16, C.lilac);
    if (ui.button('ts-close', W - 72, y + h - app.bottom - 26, 64, 22, 'とじる', { face: C.dusk })) this.sheet = null;
  }

  back() {
    if (this.info) { this.info = null; return; }
    if (this.sheet) { this.sheet = null; return; }
    this.exit();
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
function fmtRate(r) { return r >= 1000 ? (r / 1000).toFixed(1) + 'K' : String(Math.round(r)); }
