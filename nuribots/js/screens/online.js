// オンラインのメニュー: ライブ対戦（クイック・ルーム）とゴースト対戦

import { C } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text } from '../gfx/font.js';
import { topBar, backdrop } from '../ui/layout.js';
import { botPortrait, deckStrip } from '../ui/widgets.js';
import { NumPad } from '../ui/keyboard.js';
import { fmtSteps } from '../game/coach.js';
import { RULES_HINT } from '../net/fire.js';
import { Net, ARCH, toWire } from '../ml/net.js';
import { Rng } from '../core/rng.js';

export class OnlineScreen {
  constructor(app) { this.app = app; this.pad = null; this.busy = false; this.ghost = null; }

  enter() {
    const app = this.app;
    this.pad = null;
    this.busy = false;
    app.sound.playSong('home');
    if (!app.G.profile.name) {
      app.go('name', { title: 'プレイヤー名', label: 'オンラインで表示される名前', initial: '', ret: 'online', done: (v) => { app.G.profile.name = v; app.G.save(); } });
      return;
    }
    this.checking = true;
    app.online.check().then(() => { this.checking = false; this.refreshGhost(); });
  }

  async refreshGhost() { this.ghost = await this.app.online.myGhost(); }

  leave() {}
  update() {}
  view() { return null; }

  async myEntry() {
    const app = this.app, G = app.G, bot = G.bot;
    let net = await G.loadNet(bot);
    if (!net) net = new Net(ARCH).init(new Rng(1));
    return { name: app.online.name, bot: bot.name, deck: G.usableDeck(bot), steps: bot.steps, wire: toWire(net), net };
  }

  async start(kind, code) {
    const app = this.app;
    if (this.busy) return;
    this.busy = true;
    const bo = app.G.s.online.bestOf;
    const me = await this.myEntry();
    app.go('room', { kind, code, bestOf: bo, me });
    this.busy = false;
  }

  draw(ui) {
    const app = this.app, fb = ui.fb, G = app.G, bot = G.bot, O = app.online;
    const W = ui.W, H = ui.H;
    backdrop(app);
    if (this.pad) ui.block();
    if (topBar(app, 'オンライン対戦') === 'back') return this.back();
    let y = app.top + 26;
    // プロフィール
    ui.panel(6, y, W - 12, 46, C.night, C.dusk);
    botPortrait(fb, 12, y + 6, 0, 2);
    const nh = ui.hit('on-name', 50, y + 4, W - 60, 14);
    text(fb, O.name, 50, y + 5, col(nh.down ? C.gold : C.white));
    if (nh.click) app.go('name', { title: 'プレイヤー名', initial: G.profile.name, ret: 'online', done: (v) => { G.profile.name = v; G.save(); } });
    text(fb, `${bot.name}・学習 ${fmtSteps(bot.steps)}手`, 50, y + 18, col(C.mist), { maxW: W - 60 });
    deckStrip(fb, 50, y + 31, G.usableDeck(bot), 10, 2);
    y += 52;
    // 接続
    let st, sc;
    if (this.checking) { st = '接続をたしかめています…'; sc = C.mist; }
    else if (O.status === 'ok') { st = '接続OK'; sc = C.emerald; }
    else { st = O.errorText(O.error); sc = C.salmon; }
    const lines = ui.textBlock(st, 8, y, W - 16, sc);
    y += lines + 4;
    if (!this.checking && O.status !== 'ok') {
      if (ui.button('on-retry', 8, y, 90, 18, 'もう一度', { face: C.night, icon: 'refresh' })) { this.checking = true; O.check().then(() => { this.checking = false; this.refreshGhost(); }); }
      y += 24;
    }
    const ok = O.status === 'ok' && !this.checking;
    // 形式
    ui.header(6, y, W - 12, 'ライブ対戦');
    y += 14;
    const bw = (W - 12 - 4) >> 1;
    if (ui.chip('on-bo1', 6, y, bw, 20, '1本勝負', G.s.online.bestOf === 1)) { G.s.online.bestOf = 1; G.save(); }
    if (ui.chip('on-bo3', 10 + bw, y, bw, 20, '3本勝負+作戦', G.s.online.bestOf === 3)) { G.s.online.bestOf = 3; G.save(); }
    y += 24;
    if (G.s.online.bestOf === 3) { ui.textBlock('試合の合間に60秒の作戦タイム。相手の脳を相手に「対策学習」できる', 8, y, W - 16, C.lilac); y += 26; }
    if (ui.button('on-quick', 6, y, W - 12, 28, 'クイック対戦', { face: C.purple, icon: 'bolt', sub: 'だれかと すぐに', disabled: !ok })) this.start('quick');
    y += 32;
    if (ui.button('on-create', 6, y, bw, 28, 'ルームを作る', { face: C.indigo, disabled: !ok, sub: '友だちと' })) this.start('create');
    if (ui.button('on-join', 10 + bw, y, bw, 28, 'コードで参加', { face: C.indigo, disabled: !ok, sub: '4けたの番号' })) this.pad = new NumPad(4, 'ルームコード');
    y += 36;
    ui.header(6, y, W - 12, 'ゴースト対戦');
    y += 14;
    if (ui.button('on-ghosts', 6, y, W - 12, 28, 'ゴーストに挑戦', { face: C.teal, icon: 'ghost', sub: '登録されたロボといつでも', disabled: !ok })) app.go('ghosts');
    y += 32;
    const g = this.ghost;
    text(fb, g ? `登録中: ${g.name}  ${g.w}勝${g.l}敗${g.d ? g.d + '分' : ''}` : 'あなたのロボはまだ登録されていません', 8, y + 2, col(g ? C.gold : C.mist), { maxW: W - 16 });
    y += 16;
    if (ui.button('on-upload', 6, y, W - 12, 22, g ? `いまの${bot.name}で登録しなおす` : `${bot.name}を登録する`, { face: C.night, icon: 'upload', disabled: !ok || !bot.steps })) this.upload();
    y += 26;
    if (this.pad) {
      ui.unblock();
      const sy = ui.sheet(H - app.top - 40, '');
      const r = this.pad.draw(ui, sy + 10);
      if (r) { const code = r.ok ? r.value : null; this.pad = null; if (code) this.start('join', code); }
    }
  }

  async upload() {
    const app = this.app, G = app.G, bot = G.bot;
    if (this.busy) return;
    this.busy = true;
    try {
      const net = await G.loadNet(bot);
      if (!net) throw new Error('nobrain');
      await app.online.uploadGhost(bot, net, G.usableDeck(bot));
      app.ui.toast(`${bot.name}をゴーストとして登録したよ`, C.mint);
      this.refreshGhost();
    } catch (e) {
      app.ui.toast(e.kind ? app.online.errorText(e.kind) : '登録できませんでした', C.scarlet, 4);
    }
    this.busy = false;
  }

  back() { if (this.pad) { this.pad = null; return; } this.app.go('home'); }
}

export { RULES_HINT };
