// ライブ対戦のルーム: 相手待ち → 試合 → 作戦タイム（対策学習）→ 試合 …

import { C, TEAM } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text, mini } from '../gfx/font.js';
import { topBar, backdrop } from '../ui/layout.js';
import { botPortrait, deckStrip, cardBadge, valueColor } from '../ui/widgets.js';
import { lineChart } from '../ui/charts.js';
import { deckRows, cardInfo } from '../ui/deckedit.js';
import { LiveRoom, PLAN_MS } from '../net/online.js';
import { Net, ARCH, toWire, fromWire } from '../ml/net.js';
import { CARD, cardValue, fmtValue } from '../sim/rewards.js';
import { ARENAS } from '../sim/arenas.js';
import { randomSeed } from '../core/rng.js';
import { fmtSteps } from '../game/coach.js';

export class RoomScreen {
  constructor(app) { this.app = app; this.room = null; }

  enter(p = {}) {
    const app = this.app;
    this.msg = '';
    this.err = null;
    this.info = null;
    app.sound.playSong('home');
    if (p.kind) {
      this.me = p.me;
      this.planRunning = 0;
      this.myParams = null;
      this.planHist = [];
      this.connect(p.kind, p.code, p.bestOf);
    } else {
      this.room = app.online.room;
      if (!this.room) { app.go('online'); return; }
      if (this.room.state === 'plan' && this.room.planInfo && this.planRunning !== this.room.planInfo.n) this.startPlan(this.room.planInfo);
    }
  }

  async connect(kind, code, bestOf) {
    const app = this.app, O = app.online;
    this.state = 'connecting';
    this.kind = kind;
    try {
      let room;
      if (kind === 'create') room = await LiveRoom.create(O, this.me, bestOf, false);
      else if (kind === 'join') room = await LiveRoom.join(O, this.me, code);
      else room = await LiveRoom.quick(O, this.me, bestOf);
      if (app.curName !== 'room' && app.curName !== 'battle' && app.curName !== 'result') { room.close(); return; }
      this.room = room;
      O.room = room;
      room.on((ev, arg) => this.onRoom(ev, arg));
      if (room.state === 'paired' || room.accepted && room.role === 'guest') app.sound.play('join');
    } catch (e) {
      this.err = O.errorText(e.kind || 'network');
      this.state = 'error';
    }
  }

  onRoom(ev, arg) {
    const app = this.app, room = this.room;
    if (ev === 'paired') { app.sound.play('join'); app.ui.toast(`${room.opponentInfo()?.name || '相手'}が来た！`, C.gold); }
    else if (ev === 'battle') this.launch(arg);
    else if (ev === 'plan') {
      room.planInfo = arg;
      if (app.curName === 'room') this.startPlan(arg);
    }
    else if (ev === 'opleft') app.ui.toast('相手が退出しました', C.salmon, 3);
    else if (ev === 'left') { this.err = 'ルームがなくなりました'; }
    else if (ev === 'error') { app.ui.toast('通信エラー: ' + app.online.errorText(arg), C.scarlet, 4); }
    else if (ev === 'rematch') {
      app.ui.toast('もう一回！', C.gold);
      this.planRunning = 0;
      this.myParams = null;
      this.planDeck = null;
      this.waitRematch = false;
      this.submitted = false;
      if (app.curName !== 'room') app.go('room', {});
    }
  }

  async launch(info) {
    const app = this.app, room = this.room;
    // 作戦タイムの学習が動いていたら止める
    if (app.trainer.running) await app.trainer.stop();
    app.spec.stop();
    const me = room.side;
    const bo = room.bestOf;
    const params = {
      mode: 'online', me, arena: info.arena, seed: info.seed,
      a: { spec: { type: 'net', net: info.host.net }, name: info.host.name, portrait: 'bot', deck: info.host.deck, steps: info.host.steps, player: info.host.player },
      b: { spec: { type: 'net', net: info.guest.net }, name: info.guest.name, portrait: 'bot', deck: info.guest.deck, steps: info.guest.steps, player: info.guest.player },
      clock: () => (app.online.now() - info.start) / 1000,
      subtitle: bo > 1 ? `第${info.n}戦（${bo}本勝負）` : 'ライブ対戦',
      online: { sendEmote: (e) => room.sendEmote(e), onEmote: (fn) => { room.emoHandler = fn; } },
      showOppDeck: true, rematch: false, ret: 'room',
      round: info.n,
    };
    params.onEnd = (res) => {
      room.roundEnded(info.n, res);
      app.go('result', { battle: params, res, room });
    };
    app.go('battle', params);
  }

  // 作戦タイム: 相手の脳を相手に対策学習
  async startPlan(info) {
    const app = this.app, room = this.room;
    if (!info || this.planRunning === info.n) return;
    this.planRunning = info.n;
    this.planDeck = (this.planDeck || this.me.deck).map(d => ({ ...d }));
    this.rival = info.rival;
    this.planHist = [];
    this.planIter = null;
    this.submitted = false;
    const arena = room.arenaOf(info.n);
    this.planArena = arena;
    const base = this.myParams || this.me.net.p;
    app.trainer.on('iter', (m) => {
      this.planIter = m;
      const b = m.sum.byOpp.rival;
      if (b) this.planHist.push(b.winRate);
    }).on('auto', (m) => { this.latest = m; if (m && m.params) { const n = new Net(ARCH); n.p.set(m.params); this.demoNet = n; } })
      .on('ready', () => {}).on('frame', () => {}).on('error', () => {});
    app.trainer.start({
      params: new Float32Array(base), deck: this.planDeck, opps: this.rival ? [{ type: 'net', wire: this.rival.wire, id: 'rival', temp: 0.6 }] : [{ type: 'cpu', key: 'ace' }],
      arenas: [arena], ent: 0.01, speed: 2, seed: randomSeed(), steps: this.me.steps,
    });
    // 3Dの見本: 自分（育ち中）vs 相手
    this.demoNet = new Net(ARCH); this.demoNet.p.set(base);
    this.rivalNet = this.rival ? fromWire(this.rival.wire) : null;
    this.newDemo();
  }

  newDemo() {
    const app = this.app;
    if (!this.rivalNet || app.curName !== 'room') return;
    app.world.camMode = 'fit';
    app.spec.start({
      arena: this.planArena, seed: randomSeed(), a: { type: 'net', net: this.demoNet.clone() }, b: { type: 'net', net: this.rivalNet },
      speed: 2, deck: this.planDeck, side: 0, onEnd: () => { this.demoWait = 1.2; },
    });
  }

  async submitPlan() {
    const app = this.app, room = this.room;
    if (this.submitted || !room) return;
    this.submitted = true;
    let params = null;
    if (app.trainer.running) { const m = await app.trainer.stop(); if (m && m.params) params = m.params; }
    if (!params && this.latest) params = this.latest.params;
    const net = new Net(ARCH);
    net.p.set(params || this.myParams || this.me.net.p);
    this.myParams = net.p.slice();
    room.submit(this.planRunning, toWire(net), this.planDeck);
    app.spec.stop();
    app.sound.play('go');
  }

  leave(next) {
    const app = this.app;
    if (next !== 'battle' && next !== 'result' && next !== 'name') {
      if (app.trainer.running) app.trainer.stopNow();
      app.spec.stop();
      if (next !== 'room' && this.room) { this.room.close(); app.online.room = null; this.room = null; }
    } else app.spec.stop();
  }

  update(dt) {
    const app = this.app, room = this.room;
    if (!room) return;
    if (room.state === 'plan' && this.planRunning) {
      app.spec.update(dt);
      if (this.demoWait > 0) { this.demoWait -= dt; if (this.demoWait <= 0) this.newDemo(); }
      if (!this.submitted && room.planEnd && app.online.now() > room.planEnd) this.submitPlan();
    }
    if (room.state === 'over' || this.waitRematch) room.checkRematch();
  }

  view() {
    const room = this.room;
    if (room && room.state === 'plan' && this.planRunning && !this.submitted) return { y: 0, h: this._planViewH(), padT: this.app.top + 20, padB: 14 };
    return null;
  }

  _planViewH() { return Math.floor(this.app.H * 0.33); }

  draw(ui) {
    const app = this.app, fb = ui.fb;
    const W = ui.W, H = ui.H;
    const room = this.room;
    const st = this.err ? 'error' : room ? room.state : (this.state || 'connecting');
    if (st !== 'plan' || this.submitted) backdrop(app);
    if (this.info) ui.block();
    const title = st === 'plan' ? '作戦タイム' : 'ライブ対戦';
    if (topBar(app, title, { bg: st !== 'plan' || this.submitted }) === 'back') return this.back();
    const cy = H >> 1;
    if (st === 'error' || st === 'left') {
      ui.textBlock(this.err || 'エラー', 12, cy - 40, W - 24, C.salmon);
      if (ui.button('rm-back', (W >> 1) - 50, cy + 20, 100, 24, 'もどる', { face: C.dusk })) this.back();
      return;
    }
    if (st === 'connecting') {
      text(fb, this.kind === 'quick' ? '相手をさがしています' + '.'.repeat(Math.floor(app.t * 3) % 4) : 'つないでいます' + '.'.repeat(Math.floor(app.t * 3) % 4), W >> 1, cy - 20, col(C.white), { align: 'center' });
      if (ui.button('rm-cancel', (W >> 1) - 50, cy + 20, 100, 24, 'やめる', { face: C.dusk })) this.back();
      return;
    }
    if (st === 'waiting') {
      text(fb, room.quick ? 'クイック対戦の相手を待っています' : '相手を待っています', W >> 1, app.top + 40, col(C.white), { align: 'center' });
      text(fb, 'ルームコード', W >> 1, cy - 60, col(C.mist), { align: 'center' });
      mini(fb, room.code, W >> 1, cy - 44, col(C.gold), 'center', 7);
      ui.textBlock(room.quick ? 'だれかがクイック対戦をはじめると、すぐに試合がはじまります' : '友だちに このコードを伝えて「コードで参加」してもらおう', 14, cy + 4, W - 28, C.mist);
      text(fb, room.bestOf > 1 ? `${room.bestOf}本勝負（作戦タイムつき）` : '1本勝負', W >> 1, cy + 40, col(C.lilac), { align: 'center' });
      const dots = Math.floor(app.t * 2) % 4;
      for (let i = 0; i < 3; i++) fb.rect((W >> 1) - 8 + i * 7, cy + 58, 4, 4, col(i < dots ? C.mint : C.night));
      if (ui.button('rm-cancel', (W >> 1) - 50, H - app.bottom - 34, 100, 24, 'やめる', { face: C.dusk })) this.back();
      return;
    }
    if (st === 'paired' || st === 'battle' || st === 'between') {
      this.drawVersus(ui, st === 'between' ? '作戦タイムの準備中…' : 'まもなく試合開始！');
      return;
    }
    if (st === 'plan') { this.drawPlan(ui); return; }
    if (st === 'over') { this.drawOver(ui); return; }
  }

  drawVersus(ui, label) {
    const app = this.app, fb = ui.fb, room = this.room;
    const W = ui.W, H = ui.H;
    const cy = H >> 1;
    const op = room.opponentInfo();
    const names = room.role === 'host' ? [this.me.name, op ? op.name : '？'] : [op ? op.name : '？', this.me.name];
    botPortrait(fb, 30, cy - 50, 0, 3);
    botPortrait(fb, W - 78, cy - 50, 1, 3);
    text(fb, names[0], 54, cy + 2, col(TEAM[0].light), { align: 'center', maxW: 100 });
    text(fb, names[1], W - 54, cy + 2, col(TEAM[1].light), { align: 'center', maxW: 100 });
    text(fb, 'VS', W >> 1, cy - 36, col(C.gold), { align: 'center', scale: 2 });
    text(fb, room.side === 0 ? 'あなたは あお' : 'あなたは だいだい', W >> 1, cy + 22, col(C.white), { align: 'center' });
    const w = room.wins();
    if (Object.keys(room.results).length) mini(fb, `${w.host} - ${w.guest}`, W >> 1, cy + 40, col(C.white), 'center', 3);
    text(fb, label + '.'.repeat(Math.floor(app.t * 3) % 4), W >> 1, cy + 64, col(C.mist), { align: 'center' });
    if (!room.opponentAlive()) text(fb, '相手の接続が切れたかもしれません', W >> 1, cy + 80, col(C.salmon), { align: 'center' });
    if (ui.button('rm-leave', (W >> 1) - 50, H - app.bottom - 30, 100, 22, '退出する', { face: C.night })) this.back();
  }

  drawPlan(ui) {
    const app = this.app, fb = ui.fb, room = this.room;
    const W = ui.W, H = ui.H;
    const left = Math.max(0, Math.ceil(((room.planEnd || 0) - app.online.now()) / 1000));
    if (this.submitted) {
      text(fb, '脳を提出しました', W >> 1, (H >> 1) - 30, col(C.white), { align: 'center' });
      text(fb, '相手の準備を待っています' + '.'.repeat(Math.floor(app.t * 3) % 4), W >> 1, (H >> 1) - 10, col(C.mist), { align: 'center' });
      mini(fb, String(left), W >> 1, (H >> 1) + 12, col(C.gold), 'center', 3);
      if (ui.button('rm-leave', (W >> 1) - 50, H - app.bottom - 30, 100, 22, '退出する', { face: C.night })) this.back();
      return;
    }
    const vh = this._planViewH();
    // タイマーと勝敗（上のバーの左右）
    const ty = app.top + 1;
    fb.rrect(W - 40, ty, 37, 17, col(C.ink));
    mini(fb, String(left), W - 21, ty + 3, col(left <= 10 && Math.floor(app.t * 4) % 2 ? C.scarlet : C.gold), 'center', 2);
    const w = room.wins();
    fb.rrect(32, ty, 40, 17, col(C.ink));
    mini(fb, `${w.host}-${w.guest}`, 52, ty + 3, col(C.white), 'center', 2);
    text(fb, `つぎ: ${ARENAS[this.planArena]?.name || ''}`, 6, vh - 13, col(C.white), { outline: col(C.ink) });
    let y = vh + 3;
    fb.rect(0, vh, W, H - vh, col(C.ink));
    // 相手のごほうび
    const rv = this.rival;
    if (rv) {
      text(fb, `相手: ${rv.name}（${fmtSteps(rv.steps)}手）`, 6, y, col(TEAM[room.side === 0 ? 1 : 0].light), { maxW: W - 12 });
      y += 13;
      let x = 6;
      for (const d of rv.deck) {
        if (!CARD[d.id]) continue;
        cardBadge(fb, x, y, d.id, 11);
        const v = cardValue(d.id, d.lv);
        mini(fb, fmtValue(v).replace('−', '-'), x + 13, y + 3, col(valueColor(v)));
        x += 13 + 4 * fmtValue(v).length + 4;
        if (x > W - 30) break;
      }
      y += 16;
    }
    // 対策学習
    const it = this.planIter;
    const b = it && it.sum.byOpp.rival;
    text(fb, `対策学習 ${it ? fmtSteps(it.steps - this.me.steps) : 0}手`, 6, y, col(C.mint));
    text(fb, `相手に勝率 ${b ? Math.round(b.winRate * 100) + '%' : '--'}`, W - 6, y, col(C.gold), { align: 'right' });
    y += 13;
    lineChart(fb, 7, y, W - 14, 26, [{ data: this.planHist.slice(-80), color: C.gold }], { min: 0, max: 1, grid: [0.5] });
    y += 31;
    // 自分のデッキ（その場で変えられる）
    text(fb, 'ごほうびを調整（学習にすぐ反映）', 6, y, col(C.white));
    y += 13;
    const btnY = H - app.bottom - 26;
    const off = ui.beginScroll('plan-deck', 0, y, W, btnY - y - 3);
    const r = deckRows(app, 6, y + off, W - 12, this.planDeck, { id: 'pd', rowH: 28 });
    ui.endScroll('plan-deck', r.h + 2);
    if (r.changed) app.trainer.setDeck(this.planDeck);
    if (r.info) this.info = r.info;
    if (ui.button('rm-ready', 6, btnY, W - 12, 24, '準備OK（この脳で出す）', { face: C.green, icon: 'check' })) this.submitPlan();
    if (this.info) { ui.unblock(); if (cardInfo(app, this.info, this.planDeck) === 'close') this.info = null; }
  }

  drawOver(ui) {
    const app = this.app, fb = ui.fb, room = this.room;
    const W = ui.W, H = ui.H;
    const cy = H >> 1;
    const w = room.wins();
    const mine = room.role === 'host' ? w.host : w.guest, theirs = room.role === 'host' ? w.guest : w.host;
    const s = mine > theirs ? 'あなたの勝ち！' : mine < theirs ? 'あなたの負け…' : 'ひきわけ';
    text(fb, s, W >> 1, cy - 60, col(mine > theirs ? C.gold : C.mist), { align: 'center', scale: 2 });
    mini(fb, `${w.host} - ${w.guest}`, W >> 1, cy - 30, col(C.white), 'center', 4);
    const rm = room.checkRematch();
    const me = rm[room.role], op = rm[room.other];
    if (me && !op) text(fb, '相手の返事を待っています…', W >> 1, cy + 6, col(C.mist), { align: 'center' });
    if (op && !me) text(fb, '相手が「もう一回」を希望！', W >> 1, cy + 6, col(C.gold), { align: 'center' });
    if (!room.opponentAlive() || room.opLeft) text(fb, '相手は退出しました', W >> 1, cy + 20, col(C.salmon), { align: 'center' });
    const by = H - app.bottom - 30;
    const bw = (W - 16) >> 1;
    if (ui.button('rm-again', 6, by, bw, 24, 'もう一回', { face: C.blue, disabled: !!me || room.opLeft })) { room.voteRematch(); this.waitRematch = true; }
    if (ui.button('rm-end', 10 + bw, by, bw, 24, 'おわる', { face: C.dusk })) this.back();
  }

  back() {
    const app = this.app;
    if (this.info) { this.info = null; return; }
    if (app.trainer.running) app.trainer.stopNow();
    app.spec.stop();
    if (this.room) { this.room.close(); app.online.room = null; this.room = null; }
    app.go('online');
  }
}
