// 育成画面（しんかラボ）
//
// ゆっくり成長（標準）: 世代ごとに
//   1) その世代のチャンピオンが10秒走る（前の王者 or ちょうせんしゃ がゴーストで並ぶ・記録の旗をこえると「きろくこうしん！」）
//   2) けっかカード（何cm のびたか・群れ全員の成績）
//   3) レベルアップ・わざを おぼえた などの できごと
//   4) 次の世代へ
// 急成長: 裏で休まず進化。画面は最新のチャンピオンを流しつづけ、できごとはお知らせで出す

import { C, text, button, iconButton, win, bar, mini, bigNum, tabs, LINE_H, measure } from '../ui/widgets.js';
import { ICON, MOVE_ICON } from '../gfx/icons.js';
import { message, sheet, askName, confirm } from '../ui/overlay.js';
import { StatusModal, EnvModal } from '../ui/labui.js';
import { drawGrowth, drawHerd, drawBrain, drawGait, drawJournal, GaitBuffer, HERD_LEGEND } from '../ui/viz.js';
import { drawIso } from '../ui/iso.js';
import { db } from '../core/db.js';
import { Session, envLabel } from '../evo/session.js';
import { titleFor, levelFor, levelProgress, formatFit, formatDelta, MOVES } from '../evo/growth.js';
import { Actor, Clock } from '../world/actor.js';
import { PAL } from '../core/config.js';
import { EVAL_SECONDS, EVAL_FRAMES } from '../sim/creature.js';
import { openShareDialog } from '../core/share.js';
import { randomName, bestChamp } from './zukan.js';

const TABS = ['せいせき', 'のう', 'リズム', 'にっき'];
const SPEEDS = [1, 2, 4];
const CAM_VIEWS = [
  { name: 'ななめ', yaw: 0.55, pitch: 0.36, dist: 2.2 },
  { name: 'よこ', yaw: 0.02, pitch: 0.12, dist: 2.5 },
  { name: 'まえ', yaw: 1.45, pitch: 0.22, dist: 2.0 },
  { name: 'うえ', yaw: 0.3, pitch: 1.25, dist: 3.0 },
];
const RESULT_TIME = 3.4;

export class LabScreen {
  constructor(app) { this.app = app; this.session = null; this.actors = []; }

  async enter(params = {}) {
    const app = this.app;
    this.loading = true;
    this.session = null;
    this.actors = [];
    this.main = null;
    this.t = 0;
    this.tab = 0;
    this.speed = 1;
    this.camIdx = 0;
    this.clock = new Clock();
    this.phase = 'load';
    this.queue = [];
    this.brainState = { sel: null, diff: true };
    this.journalScroll = 0;
    this.albumSel = null;
    this.flashT = 0;
    app.sound.setMood('lab');
    const w = app.world;
    w.buildGroup.visible = false;
    w.envGroup.visible = true;
    const rec = await db.getCreature(params.id);
    if (!rec) { app.toast('みつかりません', C.red); app.go('zukan'); return; }
    const champs = await db.getChamps(rec.id);
    const s = this.session = new Session(rec, champs, app.pool);
    s.onInfo = (info) => this._onInfo(info);
    app.settings.last = rec.id; app.saveSettings();
    this.showHerd = app.settings.herd !== false;
    const v = CAM_VIEWS[0];
    w.setView(v.yaw, v.pitch, v.dist, true);
    this._setEnvVisual(rec.env);
    if (champs.length) {
      this._showGen(s.lastGen);
    } else {
      this.phase = 'hatch';
      this.hatchT = 0;
      this.hatchReady = false;
      w.setRecord(null);
      w.focus(0, 0.12, 0, true);
    }
    this.loading = false;
    if (!app.settings.help.lab) {
      app.settings.help.lab = true; app.saveSettings();
      message(app, {
        title: 'しんかラボ', align: 'left', width: 188,
        lines: [
          '30匹の きょうだいが うまれて、',
          'いちばん遠くまで 進めた子たちが',
          '親になり、次の世代が うまれます。',
          '',
          '・ゆっくり: 1世代ずつ 走りを見る',
          '・急成長: うらで どんどん進化',
          '・白いゴースト＝前の王者',
          '・王者が かわらない世代は、',
          '　新入りの ちょうせんしゃが 挑む',
        ],
        buttons: [{ label: 'はじめる', accent: C.lime }],
      });
    }
  }

  exit() {
    this._clearActors();
    if (this.session) { this.session.destroy(); this.session = null; }
    this.app.world.setRecord(null);
  }

  saveNow() { if (this.session) this.session.save(true); }

  panelH() { return 150 + this.app.px.safe.b; }
  viewHeight() { return this.app.px.VH - this.panelH(); }

  // ── 表示する世代の切りかえ ──
  _setEnvVisual(env) {
    const w = this.app.world;
    w.setTheme(env.terrain);
    w.setTerrain(env.terrain, 1);
  }

  _clearActors() {
    for (const a of this.actors) a.dispose();
    this.actors = [];
    this.main = null;
  }

  _champOf(gen) { return this.session.champs.find(c => c.gen === gen) || this.session.champAt(gen); }

  _showGen(gen, album = false) {
    const s = this.session, w = this.app.world;
    const champ = this._champOf(gen);
    if (!champ) return;
    const env = s.envOf(champ.e);
    const info = s.infos.get(champ.gen) || null;
    this._setEnvVisual(env);
    this._clearActors();
    const ghosts = [];
    let ghostKind = null, ghostChamp = null;
    // 主役: ふつうはこの世代の王者。王者が かわらなかった世代は「ちょうせんしゃ」が主役で、王者がゴースト
    let mainG = champ.g, mainKind = 'champ', mainFit = champ.fit, mainId = champ.id;
    if (album) {
      const latest = s.champs[s.champs.length - 1];
      if (latest && latest.gen !== champ.gen && latest.e === champ.e) { ghostChamp = latest; ghostKind = 'now'; }
    } else {
      let prev = null;
      for (let i = s.champs.length - 1; i >= 0; i--) { const c = s.champs[i]; if (c.gen < champ.gen) { prev = c; break; } }
      if (prev && prev.e === champ.e && prev.id !== champ.id) { ghostChamp = prev; ghostKind = 'prev'; }
      else if (info && info.challenger && !info.newChamp) {
        mainG = info.challenger.g; mainKind = 'challenger'; mainFit = info.challenger.fit; mainId = info.challenger.id;
        ghostChamp = champ; ghostKind = 'king';
      }
    }
    if (ghostChamp) ghosts.push({ g: ghostChamp.g, color: PAL.white, density: 0.5 });
    if (!album && this.showHerd && info) {
      const skip = new Set([champ.id, mainId, ghostChamp && ghostChamp.id]);
      for (const r of info.ranked) {
        if (ghosts.length >= 6) break;
        if (skip.has(r.id)) continue;
        ghosts.push({ g: r.g, color: PAL.steel, density: 0.25 });
      }
    }
    for (const gh of ghosts) this.actors.push(new Actor(w, s.body, s.L, gh.g, env, { ghost: gh.color, density: gh.density }));
    this.main = new Actor(w, s.body, s.L, mainG, env);
    this.actors.push(this.main);
    this.gait = new GaitBuffer(s.body.nCh);
    this.main.onStep = (c) => this.gait.push(c);
    // それまでの記録（旗）
    let prevBest = null;
    for (const c of s.champs) if (c.e === champ.e && c.gen < champ.gen && (prevBest === null || c.fit > prevBest)) prevBest = c.fit;
    w.setRecord(env.objective === 'distance' ? prevBest : null);
    w.focus(0, 0.12, 0, true);
    this.viewing = { gen: champ.gen, champ, env, info, album, ghostKind, ghostFit: ghostChamp ? ghostChamp.fit : null, prevBest, mainKind, mainFit, mainG, ghostG: ghostChamp ? ghostChamp.g : null };
    if (!album) {
      let before = null;
      for (let i = s.champs.length - 1; i >= 0; i--) if (s.champs[i].gen < champ.gen) { before = s.champs[i]; break; }
      this.hud = before && before.level ? { level: before.level, score: before.score || 0 } : { level: champ.gen === 0 ? 1 : (champ.level || s.rec.level), score: 0 };
    }
    this.phase = album ? 'album' : 'run';
    this.runT = 0;
    this.crossed = false;
    this.clock = new Clock();
    this.brainState.sel = null;
    if (!album) { this.curGen = champ.gen; s.viewGen = champ.gen; }
  }

  _restartActors() {
    for (const a of this.actors) a.reset();
    if (this.gait) this.gait.clear();
    this.crossed = false;
    this.runT = 0;
  }

  // ── できごと ──
  _onInfo(info) {
    const app = this.app, s = this.session;
    if (this.phase === 'hatch' && info.gen === 0) {
      this.hatchReady = true;   // たまごの時間（2秒）がすぎたら かえる
      return;
    }
    if (s.mode === 'fast') {
      for (const ev of info.events) this._toastEvent(ev);
    }
    if (this.phase === 'wait' && info.gen > this.curGen) this._showGen(this.curGen + 1);
  }

  _toastEvent(ev) {
    const app = this.app;
    const col = ev.kind === 'level' ? C.yellow : ev.kind === 'move' ? C.cyan : ev.kind === 'first' ? C.lime : C.silver;
    app.toast(`G${ev.gen} ${ev.text}`, col, 2.6);
    if (ev.kind === 'level') app.sfx('level');
    else if (ev.kind === 'move') app.sfx('move');
    else if (ev.kind === 'first') app.sfx('record');
  }

  _afterResult() {
    const info = this.viewing && this.viewing.info;
    this.queue = info ? info.events.slice() : [];
    this.phase = 'events';
    this._nextEvent();
  }

  _nextEvent() {
    const app = this.app, s = this.session;
    while (this.queue.length) {
      const ev = this.queue.shift();
      if (ev.kind === 'level') {
        if (this.hud) this.hud.level = ev.lv;
        message(app, {
          title: 'レベルアップ！', sfx: 'level', tapClose: true, auto: 4, color: C.yellow,
          lines: [`${s.rec.name} は`, `LV${ev.from} → LV${ev.lv} に なった！`, ...(ev.newTitle ? [`しょうごう「${ev.title}」`] : [])],
          extraH: 46, extraDraw: (fb, x, y, w) => drawIso(fb, s.rec.voxels, x + w / 2, y + 22, w - 30, 42),
          onClose: () => this._nextEvent(),
        });
        return;
      }
      if (ev.kind === 'move') {
        const mv = MOVES[ev.key];
        message(app, {
          title: 'わざを おぼえた！', sfx: 'move', tapClose: true, auto: 4.5, color: C.cyan,
          sprite: MOVE_ICON[mv.icon], spriteScale: 4,
          lines: [`「${mv.name}」`, mv.desc],
          onClose: () => this._nextEvent(),
        });
        return;
      }
      if (ev.kind === 'first') {
        message(app, {
          title: 'はじめの いっぽ！', sfx: 'record', tapClose: true, auto: 3.5, color: C.lime,
          sprite: MOVE_ICON.walk, spriteScale: 4,
          lines: ['はじめて まえに すすんだ！', 'ここから すこしずつ うまくなる'],
          onClose: () => this._nextEvent(),
        });
        return;
      }
      if (ev.kind !== 'record') this._toastEvent(ev);
    }
    this._advance();
  }

  _advance() {
    const s = this.session;
    const c = this.viewing && this.viewing.champ;
    if (c && c.level) this.hud = { level: c.level, score: c.score || 0 };
    if (s.lastGen > this.curGen) this._showGen(this.curGen + 1);
    else this.phase = 'wait';
  }

  _skip() {
    if (this.phase === 'run') {
      if (this.session.mode === 'fast') {
        if (this.session.lastGen > this.curGen) this._showGen(this.session.lastGen);
        else this._restartActors();
      } else { this.phase = 'result'; this.resultT = 0; this.app.sfx('card'); }
    } else if (this.phase === 'result') this._afterResult();
    else if (this.phase === 'album') this._showGen(this.curGen);
  }

  update(dt, modal) {
    this.t += dt;
    if (this.loading || !this.session) return;
    const s = this.session, w = this.app.world;
    s.update();
    if (this.flashT > 0) this.flashT -= dt;
    if (this.phase === 'hatch') {
      w.focus(0, 0.12, 0);
      this.hatchT += dt;
      if (this.hatchReady && this.hatchT > 2.2 && !modal) {
        this.app.sfx('hatch');
        this.app.toast(`${s.rec.popSize}匹の きょうだいが うまれた！`, C.lime, 3);
        this._showGen(0);
      }
      return;
    }
    if (this.phase === 'wait') {
      if (s.lastGen > this.curGen) this._showGen(this.curGen + 1);
    }
    if (!this.main) return;
    const running = this.phase === 'run' || this.phase === 'album';
    if (running && !modal) {
      const n = this.clock.frames(dt, this.speed);
      for (const a of this.actors) a.stepFrames(n);
      this.runT += n / 60;
      const v = this.viewing;
      if (v.env.objective === 'distance' && v.prevBest !== null && v.prevBest > 0.05 && !this.crossed && !v.album && this.main.distance > v.prevBest) {
        this.crossed = true;
        this.flashT = 1.8;
        this.app.sfx('record');
      }
      if (this.main.done) {
        if (this.phase === 'album') this._restartActors();
        else if (s.mode === 'fast') {
          if (s.lastGen > this.curGen) this._showGen(s.lastGen);
          else this._restartActors();
        } else { this.phase = 'result'; this.resultT = 0; this.app.sfx('card'); }
      }
    }
    if (this.phase === 'result') {
      this.resultT += dt;
      if (this.resultT > RESULT_TIME && !modal) this._afterResult();
    }
    for (const a of this.actors) a.sync(this.t);
    const out = this.main.c.brain;
    const sel = this.brainState.sel;
    this.main.mesh.setHighlight(this.tab === 1 && sel && sel.layer === 2 ? sel.i : -1);
    void out;
    const com = this.main.com;
    w.focus(com[0], Math.max(0.1, com[1]), com[2]);
  }

  // ── メニュー ──
  _menu() {
    const app = this.app, s = this.session;
    sheet(app, {
      title: s.rec.name, rowH: 17,
      items: [
        { label: 'つよさ', sub: `LV${s.rec.level}`, onTap: () => app.openModal(new StatusModal(app, s)) },
        { label: 'かんきょうを かえる', sub: envLabel(s.rec.env).slice(0, 10), onTap: () => app.openModal(new EnvModal(app, s, (env) => this._applyEnv(env))) },
        { label: '成長パレード', sub: '昔の自分と', onTap: () => { s.save(true); app.go('parade', { id: s.rec.id }); } },
        { label: `なかまの ゴースト ${this.showHerd ? 'ON' : 'OFF'}`, onTap: () => { this.showHerd = !this.showHerd; app.settings.herd = this.showHerd; app.saveSettings(); } },
        { label: 'なまえを かえる', onTap: () => askName(app, { value: s.rec.name, randomName, onDone: (v) => s.rename(v) }) },
        { label: 'からだを かいぞう', sub: '脳は引きつぐ', onTap: () => { s.save(true); app.go('build', { remodel: s.rec.id }); } },
        { label: '共有コード（URL）', sub: 'ともだちへ', onTap: () => this._share() },
        { label: 'ずかんに もどる', onTap: () => app.go('zukan') },
      ],
    });
  }

  _applyEnv(env) {
    const s = this.session;
    if (s.setEnv(env)) {
      this.app.toast(`かんきょう: ${envLabel(env)}`, C.orchid, 3);
      this.app.sfx('gen');
      if (this.phase === 'wait' || this.phase === 'events') this._advance();
    }
  }

  _share() {
    const s = this.session;
    openShareDialog(this.app, s.rec, bestChamp(s.champs, s.rec), message, C);
  }

  _toggleMode() {
    const app = this.app, s = this.session;
    s.setMode(s.mode === 'fast' ? 'slow' : 'fast');
    app.sound.setMood(s.mode === 'fast' ? 'fast' : 'lab');
    app.sfx('toggle');
    if (s.mode === 'fast') {
      app.toast('急成長: うらで どんどん 進化します', C.orange, 2.6);
      if (this.phase === 'result' || this.phase === 'events' || this.phase === 'wait') this._advance();
    } else {
      app.toast('ゆっくり成長: 1世代ずつ 見ていきます', C.lime, 2.6);
    }
  }

  // ── 描画 ──
  draw(fb) {
    const app = this.app, px = app.px, VW = px.VW, VH = px.VH;
    const top = px.safe.t, vh = this.viewHeight();
    if (this.loading || !this.session) {
      fb.rect(0, 0, VW, VH, C.navy);
      text(fb, 'よみこみちゅう…', VW / 2, VH / 2, C.silver, { align: 'center' });
      return;
    }
    const s = this.session, rec = s.rec;
    // 3D の操作（ドラッグでまわす・ピンチでズーム）
    app.ui.area('lab_view', 0, 0, VW, vh, {
      down: (x, y) => { this.drag = { lx: x, ly: y, x, y, moved: false }; },
      move: (x, y) => {
        const d = this.drag; if (!d) return;
        if (!d.moved && Math.hypot(x - d.x, y - d.y) > 4) d.moved = true;
        if (d.moved) app.world.orbit(-(x - d.lx) * 0.018, (y - d.ly) * 0.014);
        d.lx = x; d.ly = y;
      },
      up: () => {
        const d = this.drag; this.drag = null;
        if (d && !d.moved && this.phase === 'result') this._afterResult();
      },
      pinch: (f) => app.world.zoom(f),
    });
    this._drawHUD(fb, top, vh);
    if (this.phase === 'hatch') this._drawHatch(fb, vh);
    if (this.phase === 'result') this._drawResult(fb, vh);
    this._drawPanel(fb, vh);
  }

  _drawHUD(fb, top, vh) {
    const app = this.app, px = app.px, VW = px.VW, s = this.session, rec = s.rec;
    iconButton(app, 'lab_back', 4, top + 3, 18, 14, ICON.back, () => app.go('zukan'));
    text(fb, rec.name, 26, top + 3, C.white, { outline: C.ink, bold: true });
    const nw = measure(rec.name) + 30;
    const live = s.mode === 'fast' || !this.hud;
    const lvShow = live ? rec.level : this.hud.level;
    text(fb, `LV${lvShow}`, nw, top + 3, C.yellow, { outline: C.ink });
    // 経験値（次のレベルまで）
    const obj = rec.env.objective;
    const sc = live ? (rec.scores[obj] || 0) : this.hud.score;
    const lvObj = levelFor(obj, sc);
    text(fb, `「${titleFor(lvShow)}」`, 24, top + 16, C.cyan, { outline: C.ink });
    bar(fb, 27, top + 30, 60, 3, levelProgress(obj, sc, lvObj), C.lime, C.ink, C.ink);
    // 世代
    const v = this.viewing;
    const genStr = v ? `${v.gen}` : '0';
    const sx = VW - 6 - measure('世代');
    const numW = (genStr.length * 4 - 1) * 2;
    text(fb, '世代', VW - 6, top + 3, C.white, { outline: C.ink, align: 'right' });
    bigNum(fb, genStr, sx - 3, top + 4, C.white, 2, 'right');
    text(fb, '第', sx - 5 - numW, top + 3, C.white, { outline: C.ink, align: 'right' });
    const modeStr = s.paused ? 'ていし中' : s.mode === 'fast' ? '急成長' : 'ゆっくり';
    const modeCol = s.paused ? C.red : s.mode === 'fast' ? C.orange : C.lime;
    text(fb, modeStr, VW - 6, top + 18, modeCol, { outline: C.ink, align: 'right' });
    if (s.mode === 'fast' && !s.paused && s.lastGen > (v ? v.gen : -1)) mini(fb, `NEW ${s.lastGen}`, VW - 6, top + 31, C.orange, 'right');
    if (!v || !this.main) return;
    // アルバム
    if (v.album) {
      win(fb, 6, top + 38, VW - 12, 22, { fill: C.plum });
      text(fb, `アルバム: 第${v.gen}世代`, 12, top + 43, C.white);
      button(app, 'lab_album_back', VW - 58, top + 41, 48, 15, 'もどる', () => this._showGen(this.curGen));
    }
    // 下の情報: 距離・時間
    const dist = this.main.distance;
    const isJump = v.env.objective === 'jump';
    const val = isJump ? this.main.c.st.maxClear : dist;
    const big = isJump ? (val * 100).toFixed(1) : val.toFixed(2);
    if (v.mainKind === 'challenger') text(fb, 'ちょうせんしゃの はしり', 8, vh - 36, C.gold, { outline: C.ink });
    else if (!v.album && v.ghostKind === 'prev') text(fb, 'あたらしい王者！', 8, vh - 36, Math.floor(this.t * 3) % 2 ? C.yellow : C.gold, { outline: C.ink });
    bigNum(fb, big, 8, vh - 22, v.mainKind === 'challenger' ? C.gold : C.white, 3);
    text(fb, isJump ? 'cm' : 'm', 10 + (big.length * 4 - 1) * 3 + 2, vh - 14, C.white, { outline: C.ink });
    const tf = Math.min(1, this.main.frame / EVAL_FRAMES);
    bar(fb, 8, vh - 5, VW - 16, 2, tf, C.white, C.ink, null);
    // ゴーストの説明
    let gy = vh - 34;
    if (v.ghostKind) {
      const label = v.ghostKind === 'prev' ? '白=前の王者' : v.ghostKind === 'king' ? '白=王者' : '白=いまの自分';
      const col = C.white;
      text(fb, label, VW - 6, gy, col, { outline: C.ink, align: 'right' });
      if (v.ghostFit !== null && v.ghostFit !== undefined) text(fb, formatFit(v.env.objective, v.ghostFit), VW - 6, gy + 11, col, { outline: C.ink, align: 'right' });
    }
    if (this.speed > 1) mini(fb, `X${this.speed}`, VW - 8, vh - 13, C.yellow, 'right');
    // 記録こうしん
    if (this.flashT > 0 && Math.floor(this.flashT * 6) % 2 === 0) {
      text(fb, 'きろく こうしん！', VW / 2, Math.round(vh * 0.32), C.yellow, { align: 'center', outline: C.ink, scale: 2 });
    }
    if (this.phase === 'wait') {
      const dots = '.'.repeat(1 + Math.floor(this.t * 3) % 3);
      text(fb, `第${this.curGen + 1}世代を けいさん中${dots}`, VW / 2, Math.round(vh * 0.42), C.white, { align: 'center', outline: C.ink });
    }
    if (this.brainKnocked()) text(fb, 'しゅじゅつ中', VW / 2, vh - 46, C.red, { align: 'center', outline: C.ink });
    if (s.error) {
      text(fb, '進化の計算で エラーが起きました', VW / 2, Math.round(vh * 0.5), C.red, { align: 'center', outline: C.ink });
      button(app, 'lab_retry', VW / 2 - 30, Math.round(vh * 0.5) + 14, 60, 15, 'もういちど', () => { s.error = null; });
    }
  }

  brainKnocked() {
    if (!this.main) return false;
    const b = this.main.c.brain;
    return b.knockIn.some(v => v) || b.knockH.some(v => v) || b.knockOut.some(v => v);
  }

  _drawHatch(fb, vh) {
    const app = this.app, VW = app.px.VW;
    const cx = VW / 2, cy = Math.round(vh * 0.5);
    const wob = Math.round(Math.sin(this.t * 14) * (1 + Math.floor(this.t) % 2));
    // たまご（ドット）
    const egg = ['..####..', '.######.', '########', '########', '########', '########', '.######.', '..####..'];
    const sc = 4;
    egg.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch !== '#') return;
      const col = (r + c) % 5 === 0 ? C.peach : C.cream;
      fb.rect(Math.round(cx - 16 + c * sc + wob), cy - 16 + r * sc, sc, sc, col);
    }));
    fb.rect(Math.round(cx - 6 + wob), cy - 6, 4, 4, C.lime);
    fb.rect(Math.round(cx + 4 + wob), cy + 2, 4, 4, C.lime);
    text(fb, 'たまごが ふるえている…', VW / 2, cy + 22, C.white, { align: 'center', outline: C.ink });
    text(fb, '30匹の きょうだいを しらべ中', VW / 2, cy + 35, C.silver, { align: 'center', outline: C.ink });
  }

  _drawResult(fb, vh) {
    const app = this.app, px = app.px, VW = px.VW, v = this.viewing;
    const info = v.info;
    const w = VW - 16, h = (info ? 112 : 66) + (v.mainKind === 'challenger' ? LINE_H : 0);
    const x = 8, y = Math.max(px.safe.t + 40, vh - h - 34);
    const k = Math.min(1, this.resultT / 0.15);
    if (k < 1) { win(fb, x, y + Math.round(h / 2 * (1 - k)), w, Math.max(8, Math.round(h * k))); return; }
    win(fb, x, y, w, h, { title: `第${v.gen}世代の けっか`, titleCenter: true });
    const obj = v.env.objective;
    let cy = y + 9;
    text(fb, '王者', x + 10, cy, C.gold);
    text(fb, formatFit(obj, v.champ.fit), x + 40, cy, C.white, { bold: true });
    if (v.mainKind === 'challenger') {
      text(fb, 'ぼうえい！', x + w - 10, cy, C.silver, { align: 'right' });
    } else if (info && info.delta !== null) {
      const d = info.delta;
      text(fb, Math.abs(d) < 0.0005 ? '±0' : formatDelta(obj, d), x + w - 10, cy, d > 0.0005 ? C.lime : C.silver, { align: 'right' });
    } else if (v.gen === 0) text(fb, 'はじまり', x + w - 10, cy, C.silver, { align: 'right' });
    cy += LINE_H;
    if (v.mainKind === 'challenger') {
      text(fb, 'ちょうせん', x + 10, cy, C.gold);
      text(fb, formatFit(obj, v.mainFit), x + 66, cy, C.white);
      text(fb, `あと ${formatDelta(obj, v.champ.fit - v.mainFit).replace('+', '')}`, x + w - 10, cy, C.silver, { align: 'right' });
      cy += LINE_H;
    }
    if (info) {
      text(fb, 'へいきん', x + 10, cy, C.sky);
      text(fb, formatFit(obj, info.mean), x + 58, cy, C.white);
      if (info.isRecord) text(fb, 'きろく！', x + w - 10, cy, Math.floor(this.t * 4) % 2 ? C.yellow : C.gold, { align: 'right' });
      cy += LINE_H + 2;
      drawHerd(fb, x + 8, cy, w - 16, 30, info.ranked, v.champ.id);
      cy += 33;
      let lx = x + 8;
      for (const [name, col] of HERD_LEGEND) { fb.rect(lx, cy + 4, 4, 4, col); text(fb, name, lx + 6, cy, C.silver); lx += measure(name) + 10; }
      cy += LINE_H + 2;
      text(fb, '上位の子が 親になって 次の世代へ', VW / 2, cy, C.white, { align: 'center' });
    } else {
      text(fb, 'つづきから 再開しました', VW / 2, cy, C.silver, { align: 'center' });
    }
    const left = Math.max(0, RESULT_TIME - this.resultT);
    bar(fb, x + 8, y + h - 7, w - 16, 2, 1 - left / RESULT_TIME, C.lime, C.ink, null);
    app.ui.btn('lab_result', x, y, w, h, () => this._afterResult());
  }

  _drawPanel(fb, vh) {
    const app = this.app, px = app.px, VW = px.VW, VH = px.VH, s = this.session;
    fb.rect(0, vh, VW, VH - vh, C.navy);
    fb.rect(0, vh, VW, 1, C.ink);
    tabs(app, 'lab_tab', 0, vh + 1, VW, 14, TABS, this.tab, (i) => { this.tab = i; });
    const cx = 4, cy = vh + 17, cw = VW - 8, ch = VH - px.safe.b - 24 - cy;
    if (this.tab === 0) this._drawTabGrowth(fb, cx, cy, cw, ch);
    else if (this.tab === 1) this._drawTabBrain(fb, cx, cy, cw, ch);
    else if (this.tab === 2) this._drawTabGait(fb, cx, cy, cw, ch);
    else this._drawTabJournal(fb, cx, cy, cw, ch);
    // 操作ボタン
    const by = VH - px.safe.b - 21;
    const gap = 3, mw = 58;
    const bw = Math.floor((VW - 8 - mw - gap * 5) / 5);
    let bx = 4;
    const fast = s.mode === 'fast';
    button(app, 'lab_mode', bx, by, mw, 18, fast ? '急成長' : 'ゆっくり', () => this._toggleMode(), { icon: fast ? ICON.bolt : ICON.snail, accent: fast ? C.orange : C.lime });
    bx += mw + gap;
    button(app, 'lab_speed', bx, by, bw, 18, `x${this.speed}`, () => { this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]; }, { mini: true });
    bx += bw + gap;
    iconButton(app, 'lab_skip', bx, by, bw, 18, ICON.skip, () => this._skip());
    bx += bw + gap;
    iconButton(app, 'lab_pause', bx, by, bw, 18, s.paused ? ICON.play : ICON.pause, () => {
      s.paused = !s.paused;
      app.toast(s.paused ? '進化を いったん止めました' : '進化を 再開しました', s.paused ? C.red : C.lime);
    }, { active: s.paused });
    bx += bw + gap;
    iconButton(app, 'lab_cam', bx, by, bw, 18, ICON.camera, () => {
      this.camIdx = (this.camIdx + 1) % CAM_VIEWS.length;
      const v = CAM_VIEWS[this.camIdx];
      app.world.setView(v.yaw, v.pitch, v.dist);
      app.toast(`カメラ: ${v.name}`, C.white, 1.2);
    });
    bx += bw + gap;
    iconButton(app, 'lab_menu', bx, by, VW - 4 - bx, 18, ICON.gear, () => this._menu());
  }

  _drawTabGrowth(fb, x, y, w, h) {
    const app = this.app, s = this.session, rec = s.rec, v = this.viewing;
    const upto = s.mode === 'fast' || !v ? Infinity : Math.max(this.curGen ?? -1, v.gen);
    const hist = upto === Infinity ? rec.history : rec.history.filter(r => r.gen <= upto);
    const gh = h - 30;
    const g = drawGrowth(fb, x, y, w, gh, hist, rec.envs, { mark: v ? v.gen : null, sel: this.albumSel, obj: rec.env.objective });
    if (g) {
      app.ui.area('lab_graph', x, y, w, gh, {
        down: (px) => { this.albumSel = this._nearestChamp(Math.min(upto, g.genAt(px))); },
        move: (px) => { this.albumSel = this._nearestChamp(Math.min(upto, g.genAt(px))); },
        up: () => {},
      });
    }
    mini(fb, 'BEST', x + w - 22, y + 3, C.gold);
    mini(fb, 'AVG', x + w - 22, y + 10, C.sky);
    let cy = y + gh + 3;
    if (this.albumSel !== null) {
      const c = this._champOf(this.albumSel);
      text(fb, `第${c.gen}世代 ${formatFit(s.envOf(c.e).objective, c.fit)}`, x + 2, cy, C.magenta);
      button(app, 'lab_album_go', x + w - 50, cy - 1, 50, 14, 'みる', () => { this._showGen(c.gen, true); }, { icon: ICON.film, accent: C.magenta });
      cy += 14;
      text(fb, c.move ? `わざ: ${MOVES[c.move].name}` : 'グラフを なぞって えらぶ', x + 2, cy, C.steel);
    } else {
      let best = null;
      for (const r of hist) if (r.e === s.envIdx && (best === null || r.best > best)) best = r.best;
      text(fb, `さいこう ${best === null ? '--' : formatFit(rec.env.objective, best)}`, x + 2, cy, C.gold);
      const gs = s.genSeconds;
      if (gs) text(fb, `1世代 ${gs.toFixed(1)}秒`, x + w - 2, cy, C.silver, { align: 'right' });
      cy += 14;
      text(fb, 'グラフをタップで 昔の世代へ', x + 2, cy, C.steel);
    }
  }

  _nearestChamp(gen) {
    const s = this.session;
    if (!s.champs.length) return null;
    const c = s.champAt(Math.max(s.champs[0].gen, gen));
    return c ? c.gen : s.champs[0].gen;
  }

  _drawTabBrain(fb, x, y, w, h) {
    const app = this.app, s = this.session;
    if (!this.main) return;
    const brain = this.main.c.brain;
    const bh = h - 16;
    const v = this.viewing;
    const prevG = v && !v.album && v.ghostG ? v.ghostG : null;
    const nodes = drawBrain(fb, x, y, w, bh, brain, s.L, this.brainState, this.t, prevG);
    if (prevG) {
      let n = 0;
      for (let k = 0; k < s.L.len - 1; k++) if (Math.abs(prevG[k] - brain.g[k]) > 1e-7) n++;
      button(app, 'lab_diff', x + 2, y + bh - 15, 86, 13, this.brainState.diff ? `かわった ${n}本` : '変化を見る', () => { this.brainState.diff = !this.brainState.diff; }, { active: !!this.brainState.diff });
    }
    app.ui.area('lab_brain', x, y, w, bh, {
      down: () => {},
      up: (px, py) => {
        let best = null, bd = 64;
        for (const n of nodes) { const d = (n.x - px) ** 2 + (n.y - py) ** 2; if (d < bd) { bd = d; best = n; } }
        this.brainState.sel = best ? { layer: best.layer, i: best.i } : null;
        if (best) app.sfx('tap');
      },
    });
    const sel = this.brainState.sel;
    const cy = y + bh + 3;
    if (sel) {
      const L = s.L;
      const name = sel.layer === 0 ? L.inNames[sel.i] : sel.layer === 1 ? `かくれ ${sel.i + 1}` : L.outNames ? `筋肉 ${'ABCDEF'[L.outCh[sel.i]]}` : '';
      const val = sel.layer === 0 ? brain.inp[sel.i] : sel.layer === 1 ? brain.hid[sel.i] : brain.out[sel.i];
      text(fb, `${name} ${val >= 0 ? '+' : ''}${val.toFixed(2)}`, x + 2, cy, C.white);
      const arr = sel.layer === 0 ? brain.knockIn : sel.layer === 1 ? brain.knockH : brain.knockOut;
      button(app, 'lab_knock', x + w - 62, cy - 1, 62, 13, arr[sel.i] ? 'もとにもどす' : 'しゅじゅつ', () => {
        arr[sel.i] = arr[sel.i] ? 0 : 1;
        app.sfx(arr[sel.i] ? 'erase' : 'undo');
        if (arr[sel.i]) app.toast('このニューロンを止めた。動きは どうかわる？', C.red, 2.6);
      }, { icon: ICON.knife, accent: arr[sel.i] ? C.red : null, mini: false });
    } else {
      text(fb, 'ニューロンを タップ（筋肉は体が光る）', x + 2, cy, C.steel);
    }
  }

  _drawTabGait(fb, x, y, w, h) {
    const s = this.session;
    drawGait(fb, x, y, w, h - 14, this.gait, s.body.nCh, s.body.channels);
    const per = this.main ? this.main.c.period : 0;
    text(fb, `緑=足がついている  周期 ${per.toFixed(2)}秒`, x + 2, y + h - 12, C.silver);
  }

  _drawTabJournal(fb, x, y, w, h) {
    const app = this.app, s = this.session;
    const r = drawJournal(fb, x, y, w, h, s.rec.journal, this.journalScroll);
    const maxS = Math.max(0, r.total - h + 4);
    this.journalScroll = Math.max(0, Math.min(maxS, this.journalScroll));
    app.ui.area('lab_journal', x, y, w, h, {
      down: (px, py) => { this.jdrag = { y: py, s: this.journalScroll, moved: false }; },
      move: (px, py) => { const d = this.jdrag; if (!d) return; if (Math.abs(py - d.y) > 4) d.moved = true; if (d.moved) this.journalScroll = d.s - (py - d.y); },
      up: (px, py) => {
        const d = this.jdrag; this.jdrag = null;
        if (!d || d.moved) return;
        const row = r.rows.find(rr => py >= rr.y0 && py < rr.y1);
        if (row && this.session.champs.length) { this.albumSel = this._nearestChamp(row.gen); this.tab = 0; app.sfx('tap'); }
      },
    });
  }
}
