// 模倣流の修行画面（模倣学習：ビヘイビア・クローニング ＋ DAgger）
// あなたがお手本を見せる → でしが「目に映ったもの → 押したボタン」を覚える → AIにまかせる → 迷ったら手助け

import { C, text, mini, button, measure } from '../ui/widgets.js';
import { ICON } from '../gfx/sprites.js';
import { TrainBase } from './train.js';
import { ILSession } from '../game/session.js';
import { drawGraph, drawBrain, drawProbs, drawMap, drawEye, ACT_ICON } from '../ui/viz.js';
import { softmax } from '../ml/nn.js';
import { plan } from '../sim/planner.js';

export class ILScreen extends TrainBase {
  constructor(app) { super(app, 'il'); this.swipe = null; }

  makeSession(def) { return new ILSession(this.app, def); }
  tabNames() { return ['グラフ', 'データ', 'のう', '設定']; }
  focusNet() { return this.session.im.net; }
  footPath() { const s = this.session; return s.mode === 'demo' ? s.demoPath : (s.paths[0] || null); }
  bubbleTop() { const m = this.session.mode; return m === 'demo' || m === 'auto'; }

  intro() {
    const g = this.app.game, s = this.session, key = 'intro_il_' + this.def.id;
    const m = this.app.masters;
    this.par = plan(s.stage);
    if (!g.progress.seen.il) {
      g.progress.seen.il = true; g.saveProgress();
      m.say('il', 'わたしは模倣流のオウム先生。キミのお手本をそっくりマネするよ。マネ、マネ！ まずは下の「お手本」を押して、でしを巻物まで連れていってね。', { prio: 2, dur: 10 });
    } else if (!g.progress.seen[key]) m.say('il', this.def.lesson, { prio: 2, dur: 8 });
    g.progress.seen[key] = true;
  }

  drawStatus(fb, y) {
    const s = this.session, im = s.im;
    let str;
    if (s.mode === 'demo') str = `お手本中 ${s.demoAdded}歩  スワイプでもOK`;
    else if (s.mode === 'train') str = 'まねして学習中…';
    else if (s.mode === 'auto') str = `AIにまかせ中  手助け${s.autoFixes}回`;
    else str = `お手本${im.demos}回  データ${im.count}こ` + (im.acc != null ? `  一致${Math.round(im.acc * 100)}%` : '');
    text(fb, str, 4, y, C.white, { outline: C.ink });
    if (s.medal) fb.icon(ICON.medal, this.app.px.VW - 12, y + 2, C.gold);
  }

  onEvent(e) {
    const s = this.session, m = this.app.masters, im = s.im;
    switch (e.type) {
      case 'demoStart':
        this.app.sfx('teach');
        this.app.game.progress.seen.demo = true;
        break;
      case 'demoEnd':
        if (e.succ) m.say('il', `お手本ありがとう！ ${e.added}歩ぶん覚えるね。マネ、マネ…`, { key: 'de' });
        else m.say('il', `${['', '', '落ちちゃった', 'オニにやられちゃった', 'トゲにやられちゃった', '時間切れ'][e.cause] || '失敗'}…直前のお手本は「まずいお手本」だから捨てたよ。`, { key: 'df' });
        break;
      case 'trainStart': this.app.sfx('learn'); break;
      case 'trained': {
        const acc = im.acc != null ? Math.round(im.acc * 100) : 0;
        if (!e.res.succ) m.say('il', `一致度${acc}%！ さっそくやってみるね。`, { key: 'tr' });
        break;
      }
      case 'autoStart':
        if (s.stage.multiStart && e.si !== s.startIdx && !this.app.game.progress.seen.niwaHint) {
          this.app.game.progress.seen.niwaHint = true;
          m.say('il', 'こんどはちがうスタート地点から。お手本で見たことのない場面だけど、だいじょうぶかな…', { prio: 2 });
        }
        break;
      case 'airun':
        if (e.helped) { this.app.sfx('fix'); m.say('il', `手助けありがとう！ ${e.fixes}か所、迷った場面を重く覚えなおすね（DAgger）。`, { key: 'help' }); }
        else if (e.succ) {
          const steps = s.ep.steps[0];
          if (this.par && steps > this.par.steps + 2) m.say('il', `できた！ ${steps}歩でゴール。最短は${this.par.steps}歩だけど、キミのお手本どおりに歩いたよ。`, { key: 'okLong' });
          else m.say('il', 'できた！ キミのマネで巻物までたどりついたよ！', { key: 'ok' });
        } else {
          this.app.sfx('lose');
          m.say('il', '知らない場面で迷っちゃった…。まかせている時に、ボタンで手助けして！ 苦手な場面を重点的に覚えるよ。', { prio: 2, key: 'fail' });
        }
        break;
      default: break;
    }
  }

  onMedal(e) {
    this.app.masters.say('il', `免許皆伝！ キミのお手本${e.human}歩ぶんで覚えたよ。ごほうびの決め方はいらない、お手本が全部教えてくれるんだ。`, { prio: 3, dur: 9 });
  }

  medalLines(info) {
    const im = this.session.im;
    return [`人の手間: ${info.human}歩`, `お手本${im.demos}回・手助け${im.fixes}回`, info.steps ? `ゴールまで ${info.steps}歩` : ''];
  }

  // 3D をスワイプで操作（お手本中・まかせ中）
  _registerViewTap() {
    const s = this.session;
    if (s.mode !== 'demo' && s.mode !== 'auto') { super._registerViewTap(); return; }
    const app = this.app, vh = this.viewHeight();
    app.ui.area('swipe', 0, this.top + 34, app.px.VW, vh - this.top - 34, {
      down: (x, y) => { this.swipe = { x, y, done: false }; },
      move: (x, y) => {
        const sw = this.swipe;
        if (!sw || sw.done) return;
        const dx = x - sw.x, dy = y - sw.y;
        if (Math.hypot(dx, dy) > 9) {
          sw.done = true;
          const a = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 2) : (dy > 0 ? 1 : 0);
          s.input(a);
        }
      },
      up: () => { this.swipe = null; },
    });
  }

  drawTab(fb, tab, x, y, w, h) {
    const s = this.session;
    if (s.mode === 'demo' || s.mode === 'auto') { this._drawPad(fb, x, y, w, h); return; }
    if (s.mode === 'train') { this._drawTraining(fb, x, y, w, h); return; }
    const im = s.im, app = this.app;
    if (tab === 0) {
      const gh = Math.round(h * 0.5);
      drawGraph(fb, [{ data: im.lossHist, color: C.cyan, dot: true }], x, y + 11, w, gh, { empty: 'お手本を見せると学習します', min: 0 });
      text(fb, 'まちがいの大きさ（誤差）', x, y - 1, C.silver);
      const by = y + gh + 15;
      text(fb, 'AIだけで挑戦', x, by - 3, C.silver);
      const hist = im.history;
      fb.rect(x, by + 9, w, 12, C.ink);
      const n = Math.min(hist.length, Math.floor((w - 2) / 6));
      for (let i = 0; i < n; i++) {
        const d = hist[hist.length - n + i];
        fb.rect(x + 2 + i * 6, by + 11, 4, 8, d.helped ? C.yellow : d.succ ? C.lime : C.red);
      }
      text(fb, '緑=成功 赤=失敗 黄=手助け', x, by + 23, C.steel);
      text(fb, `成功 ${im.aiClears}/${im.aiRuns}`, x + w, by - 3, C.white, { align: 'right' });
    } else if (tab === 1) {
      const st = s.stage;
      const cell = Math.max(6, Math.min(Math.floor((h - 14) / st.H), Math.floor((w * 0.55) / st.W)));
      drawMap(fb, st, x + 1, y + 12, cell, { path: s.demoPath, pathColor: C.cyan, arrows: this.pmap ? this.pmap.arrows : null });
      text(fb, 'お手本のデータ', x, y - 1, C.silver);
      const tx = x + st.W * cell + 8;
      let yy = y + 12;
      const cnt = im.actionCounts();
      for (let a = 0; a < 5; a++) {
        fb.icon(ACT_ICON[a], tx, yy, C.cyan);
        text(fb, `${cnt[a]}`, tx + 10, yy - 2, C.white);
        yy += 10;
      }
      yy += 3;
      text(fb, `お手本${im.demos}回`, tx, yy, C.white); yy += 11;
      text(fb, `手助け${im.fixes}回`, tx, yy, C.yellow); yy += 11;
      text(fb, `人の手間${im.demoSteps + im.fixes}歩`, tx, yy, C.silver);
    } else if (tab === 2) {
      const ep = s.ep;
      const net = im.net;
      const obs = new Float32Array(105);
      ep.observe(0, obs);
      net.forward(obs);
      const probs = softmax(net.z, new Float32Array(5));
      text(fb, 'でしの脳', x, y - 1, C.cyan);
      drawBrain(fb, net, obs, x, y + 12, w - 54, h - 14, { cell: 4, probs, color: C.cyan });
      drawProbs(fb, probs, x + w - 50, y + 16, 50, { pick: probs.indexOf(Math.max(...probs)), color: C.cyan });
      text(fb, 'お手本と', x + w - 50, y + 60, C.steel);
      text(fb, '同じになる', x + w - 50, y + 71, C.steel);
      text(fb, 'よう直す', x + w - 50, y + 82, C.steel);
    } else if (tab === 3) {
      let yy = y;
      if (s.stage.multiStart) {
        text(fb, 'お手本のスタート', x, yy + 1, C.white);
        const n = s.stage.starts.length;
        for (let k = 0; k < n; k++) button(app, 'st' + k, x + w - (n - k) * 22, yy, 20, 13, String(k + 1), () => { s.startIdx = k; s._newEpisode(k); }, { active: s.startIdx === k, mini: true });
        yy += 18;
      }
      button(app, 'retrain', x, yy, w, 16, 'もう一度学習させる', () => s.startTraining(300), { disabled: im.count < 4 });
      yy += 19;
      button(app, 'clear', x, yy, w, 16, 'お手本データを消す', () => this.confirm('ためたお手本データを全部消しますか？（脳はそのまま）', () => s.clearData()), {});
      yy += 19;
      button(app, 'reset', x, yy, w, 16, '脳をはじめに戻す', () => this.confirm('模倣流の脳を、何も覚えていない状態に戻しますか？（データと印は残ります）', () => s.resetBrain()), { icon: ICON.reset });
      yy += 22;
      text(fb, 'ぶつかった操作は使わない', x, yy - 2, C.steel);
      text(fb, '落ちる直前の2歩は捨てる', x, yy + 10, C.steel);
    }
  }

  _drawTraining(fb, x, y, w, h) {
    const s = this.session, im = s.im;
    text(fb, 'まねして学習中…', x, y - 1, C.cyan);
    const p = s.trainProgress;
    fb.rect(x, y + 12, w, 6, C.ink);
    fb.rect(x, y + 12, Math.round(w * p), 6, C.cyan);
    drawGraph(fb, [{ data: im.lossHist, color: C.cyan, dot: true }], x, y + 24, w, h - 40, { min: 0 });
    text(fb, '誤差が下がる＝お手本に近づく', x, y + h - 12, C.silver);
  }

  // 十字ボタン（お手本・手助け）
  _drawPad(fb, x, y, w, h) {
    const s = this.session, app = this.app, ep = s.ep;
    const obs = new Float32Array(105);
    ep.observe(0, obs);
    // 左：でしの目
    text(fb, 'でしの目', x, y - 1, C.silver);
    drawEye(fb, obs, x + 2, y + 13, 7, { self: C.cyan });
    if (s.mode === 'auto') {
      // まかせ中：AIのやりたいこと
      const probs = s.im.policyProbs(obs, new Float32Array(5));
      text(fb, 'AIの気持ち', x, y + 52, C.silver);
      drawProbs(fb, probs, x, y + 65, 50, { pick: probs.indexOf(Math.max(...probs)), color: C.cyan, human: s.pending >= 0 ? s.pending : undefined });
    } else {
      text(fb, '赤=きけん', x, y + 52, C.red);
      text(fb, '灰=かべ', x, y + 64, C.gray);
      text(fb, '金=巻物', x, y + 76, C.gold);
      text(fb, '黄=アイテム', x, y + 88, C.yellow);
    }
    // 右：十字ボタン
    const bw = 30, bh = 26;
    const cx = x + w - bw * 1.5 - 4, cy = y + Math.round(h / 2) - 4;
    const dirs = [[0, cx - bw / 2, cy - bh * 1.5], [1, cx - bw / 2, cy + bh * 0.5], [2, cx - bw * 1.5, cy - bh / 2], [3, cx + bw / 2, cy - bh / 2], [4, cx - bw / 2, cy - bh / 2]];
    for (const [a, bx, by] of dirs) {
      const pressed = app.ui.capture && app.ui.capture.id === 'pad' + a;
      const xx = Math.round(bx), yy = Math.round(by);
      app.ui.area('pad' + a, xx, yy, bw - 1, bh - 1, {
        down: () => { app.sfx('tap'); s.input(a); if (s.mode === 'demo') s.hold(a); },
        up: () => s.release(),
      });
      const fill = a === 4 ? C.slate : (s.mode === 'auto' ? C.gold : C.cyan);
      fb.rrect(xx, yy + 1, bw - 1, bh - 1, C.ink);
      fb.rrect(xx, yy + (pressed ? 1 : 0), bw - 1, bh - 2, C.ink);
      fb.rect(xx + 1, yy + 1 + (pressed ? 1 : 0), bw - 3, bh - 4, pressed ? C.white : fill);
      const ic = ACT_ICON[a];
      fb.icon(ic, xx + Math.round((bw - 1 - ic.w) / 2), yy + Math.round((bh - 2 - ic.h) / 2) + (pressed ? 1 : 0), C.ink);
    }
    if (s.mode === 'auto') text(fb, '迷ったら押して手助け', x + w, y - 1, C.yellow, { align: 'right' });
    else text(fb, 'まんなか=まつ', x + w, y - 1, C.silver, { align: 'right' });
  }

  drawActions(fb, y) {
    const s = this.session, app = this.app, VW = app.px.VW;
    const x = 4, w = VW - 8;
    if (s.mode === 'demo') {
      button(app, 'cancel', x, y, w, 16, 'お手本をやめる', () => s.cancelDemo(), {});
      return;
    }
    if (s.mode === 'auto') {
      button(app, 'stop', x, y, 60, 16, 'とめる', () => s.stop(), { icon: ICON.pause });
      this.speedButton(fb, x + 63, y);
      text(fb, s.paused ? '' : '見ています…', x + 94, y + 3, C.silver);
      return;
    }
    const busy = s.mode === 'train';
    button(app, 'demo', x, y, 84, 16, 'お手本', () => s.startDemo(s.startIdx), { icon: ICON.hand, accent: C.cyan, disabled: busy });
    button(app, 'auto', x + 88, y, w - 88, 16, 'AIにまかせる', () => s.startAuto(), { icon: ICON.play, disabled: busy || s.im.steps === 0 });
  }

  drawViewExtra(fb, vh) {
    const s = this.session, app = this.app, VW = app.px.VW;
    if (s.mode === 'idle' && s.im.demos === 0 && Math.floor(app.time * 2) % 2 === 0) {
      text(fb, '↓「お手本」でスタート', VW / 2, vh - 16, C.white, { align: 'center', outline: C.ink });
    }
    if (s.mode === 'demo') {
      // お手本中の目印（画面のふちを水色に）
      fb.rect(0, this.top + 33, VW, 1, C.cyan);
      fb.rect(0, vh - 1, VW, 1, C.cyan);
    }
  }
}
