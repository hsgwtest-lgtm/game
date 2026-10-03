// 強化流の修行画面（強化学習：方策勾配 PPO）
// 分身たちが同じ脳で何度も挑戦 → ごほうびが予想より多かった行動を増やし、少なかった行動を減らす

import { C, text, mini, button, toggle } from '../ui/widgets.js';
import { ICON } from '../gfx/sprites.js';
import { TrainBase } from './train.js';
import { RLSession } from '../game/session.js';
import { RL_ENT, RL_LR, RL_CLONES } from '../ml/ppo.js';
import { drawGraph, drawBrain, drawProbs, drawMap, computePolicyMap } from '../ui/viz.js';
import { softmax, b64ToF32 } from '../ml/nn.js';
import { PAL } from '../core/config.js';

const ENT_NAMES = ['低', '中', '高'];
const LR_NAMES = ['遅', '中', '速'];

export class RLScreen extends TrainBase {
  constructor(app) { super(app, 'rl'); this.showRewardPopups = true; }

  makeSession(def) { return new RLSession(this.app, def); }
  tabNames() { return ['グラフ', 'ねだん', 'のう', 'ほうび', '設定']; }
  focusNet() { return this.session.agent.policy; }
  // ラウンドのあいだは、いまの脳で「本番」をした時の道を見せる
  phaseFootprints() { const s = this.session; const g = s.greedyRes; return s.phase === 'between' && g && g.per[0] && g.per[0].path ? { path: g.per[0].path, color: PAL.yellow } : null; }
  overlayButtons() { return [{ key: 'heat', icon: ICON.heat }, { key: 'arrows', icon: ICON.arrow }, { key: 'foot', icon: ICON.foot }]; }
  tabNeedsMap() { return this.tab === 1; }
  tabNeedsValue() { return this.tab === 1; }
  valueFn() { const ag = this.session.agent; return (o) => ag.value(o); }

  intro() {
    const g = this.app.game, s = this.session, key = 'intro_rl_' + this.def.id;
    const m = this.app.masters;
    if (!g.progress.seen.rl) {
      g.progress.seen.rl = true; g.saveProgress();
      m.say('rl', `ウキッ！ オレは強化流のサル師範。${s.agent.clones}人の分身が同じ脳で何度も挑戦する。うまくいった動きはもっとやる、失敗した動きはやめる。それだけで強くなるぞ！`, { prio: 2, dur: 10 });
    } else if (!g.progress.seen[key]) m.say('rl', this.def.lesson, { prio: 2, dur: 8 });
    g.progress.seen[key] = true;
    this.noSuccRounds = 0;
  }

  drawStatus(fb, y) {
    const s = this.session, ep = s.ep, ag = s.agent, app = this.app;
    let str;
    if (s.fast) str = `高速修行中…  ラウンド${ag.round + 1}`;
    else if (s.phase === 'learn') str = `ラウンド${ag.round} → 脳を更新`;
    else if (s.exam) str = '本番テスト中…';
    else {
      const goal = ep ? ep.successCount() : 0;
      str = `ラウンド${ag.round + 1}  ゴール${goal}/${ag.clones}`;
    }
    text(fb, str, 4, y, C.white, { outline: C.ink });
    // 迷い（エントロピー）メーター（走っている時だけ）
    if (s.phase !== 'run' || s.exam || s.fast) { if (s.medal) fb.icon(ICON.medal, app.px.VW - 12, y + 2, C.gold); return; }
    const last = ag.lastSummary;
    const ent = last ? last.ent / Math.log(5) : 1;
    const mx = app.px.VW - 40;
    text(fb, 'まよい', mx - 31, y, C.silver, { outline: C.ink });
    fb.rect(mx - 1, y + 3, 24, 7, C.ink);
    fb.rect(mx, y + 4, Math.round(22 * Math.min(1, ent)), 5, C.orange);
    if (s.medal) fb.icon(ICON.medal, app.px.VW - 12, y + 2, C.gold);
  }

  onEvent(e) {
    const s = this.session, m = this.app.masters;
    if (e.type === 'examStart') {
      this.showBanner('本番テスト', '迷わず一番の動きだけで挑む', C.yellow, 1.6);
      m.say('rl', 'いまの脳で「本番テスト」だ！ 確率で迷わず、一番自信のある動きだけで挑むぞ。', { prio: 2, key: 'exam' });
    }
    if (e.type === 'learnStart') {
      this.app.sfx('learn');
      if (s.agent.round <= 1) m.say('rl', 'ラウンドが終わるたびに脳を更新するぞ。予想よりごほうびが多かった動きは確率アップ、少なかった動きはダウンだ！', { key: 'learn1' });
    }
    if (e.type !== 'round') return;
    const sm = e.summary;
    if (!e.fast) {
      this.app.world.burst(s.stage.start.x, s.stage.start.y, 'learn', 10);
      this.showBanner(`ラウンド${sm.round + 1}`, sm.succ ? `前回ゴール ${sm.succ}/${sm.n}` : '', C.orange, 0.9);
    }
    if (sm.succ === 0) this.noSuccRounds++; else this.noSuccRounds = 0;
    const firstGoal = sm.succ > 0 && !this.hadGoal;
    if (sm.succ > 0) this.hadGoal = true;
    if (e.fast) return;
    const entN = sm.ent / Math.log(5);
    if (sm.round === 1) m.say('rl', 'はじめはでたらめに動いて、いろいろ試すんだ。これが「探検」だ！', { key: 'r1' });
    else if (firstGoal && !s.medal) m.say('rl', '分身がゴールしたぞ！ その時の動きの確率が上がる。だんだん迷いが減っていくはずだ！', { prio: 2, key: 'fg' });
    else if (sm.coins >= 6 && sm.succ === 0) m.say('rl', 'ウキー！ 小判集めに夢中で巻物を取りに行かない！ これが「ごほうびのハック」。ごほうびの決め方を見直そう！', { prio: 2, key: 'hack' });
    else if (entN < 0.2 && sm.succ === 0 && this.noSuccRounds > 8) {
      const timid = sm.steps > s.stage.maxSteps * 0.8;
      m.say('rl', timid ? 'こわがって動かなくなっちまった！ やられた時のばつが大きすぎるか、好奇心が足りないかも。' : ((this.def.hints && this.def.hints.rl) || '迷いがなくなったのにゴールできていない…好奇心を上げるか、ごほうびを見直そう！'), { prio: 2, key: 'stuck' });
    } else if (this.noSuccRounds === 25 && !s.medal) m.say('rl', (this.def.hints && this.def.hints.rl) || 'なかなかゴールできないな。ごほうびの決め方を工夫してみよう！', { prio: 2, key: 'stag' });
  }

  onMedal(e) {
    this.app.masters.say('rl', `免許皆伝だ！ ${e.cost}回の挑戦で、ごほうびだけを手がかりに道を覚えた。失敗こそ最高の先生だな！`, { prio: 3, dur: 9 });
  }

  medalLines(info) {
    return [`挑戦した回数: ${info.cost}回`, `ラウンド${info.round}で達成`, info.steps ? `ゴールまで ${info.steps}歩` : ''];
  }

  drawTab(fb, tab, x, y, w, h) {
    const s = this.session, ag = s.agent, app = this.app;
    if (tab === 0) {
      const hist = ag.history;
      const gh = Math.round(h * 0.5);
      drawGraph(fb, [
        { data: hist.map((d) => d.ret), color: C.orange, dot: true },
      ], x, y + 11, w, gh, { empty: '1ラウンド目を待っています', zero: true });
      text(fb, 'ごほうびの平均', x, y - 1, C.silver);
      text(fb, `${ag.round}ラウンド`, x + w, y - 1, C.silver, { align: 'right' });
      const by = y + gh + 15, bh = h - gh - 26;
      text(fb, 'ゴール率', x, by - 3, C.cyan);
      text(fb, 'まよい', x + 46, by - 3, C.steel);
      drawGraph(fb, [
        { data: hist.map((d) => d.ent / Math.log(5)), color: C.steel },
        { data: hist.map((d) => d.succ), color: C.cyan, dot: true },
      ], x, by + 9, w, bh, { min: 0, max: 1 });
      text(fb, `のべ ${ag.episodes}回`, x + w, by - 3, C.white, { align: 'right' });
    } else if (tab === 1) {
      // 価値マップ（ねだん）：明るいほど「ここからだとごほうびがたくさん」
      const st = s.stage, ep = s.ep;
      const cell = Math.max(6, Math.min(Math.floor((h - 14) / st.H), Math.floor((w * 0.55) / st.W)));
      const pm = this.pmap;
      drawMap(fb, st, x + 1, y + 12, cell, { values: pm ? pm.values : null, arrows: pm ? pm.arrows : null, path: s.greedyRes && s.greedyRes.per[0] ? s.greedyRes.per[0].path : null, pathColor: C.white, focusXY: ep ? [ep.x[Math.min(s.focus, ep.n - 1)], ep.y[Math.min(s.focus, ep.n - 1)]] : null });
      text(fb, 'ねだん（価値）', x, y - 1, C.silver);
      const tx = x + st.W * cell + 8, tw = w - (tx - x);
      let yy = y + 12;
      const lines = ['明るい所ほど', '「ここからだと', 'ごほうびが', 'もらえそう」', 'と思っている。', '矢印は', 'いちばん自信の', 'ある動き。'];
      for (const ln of lines) { text(fb, ln, tx, yy, C.white); yy += 11; }
      const g = s.greedyRes;
      if (g) {
        yy += 2;
        text(fb, g.succ ? `本番○ ${g.steps}歩` : `本番× ${g.ok}/${g.n}`, tx, yy, g.succ ? C.lime : C.pink);
      }
      void tw;
      if (!this.app.game.progress.seen.vtab) {
        this.app.game.progress.seen.vtab = true;
        this.app.masters.say('rl', '「ねだん」はこの脳の予想だ。ゴールの近くから明るくなって、だんだん広がっていくのを見てくれ！', { prio: 2 });
      }
    } else if (tab === 2) {
      const ep = s.ep;
      if (!ep) return;
      const i = Math.min(s.focus, ep.n - 1);
      const net = ag.policy;
      const obs = new Float32Array(105);
      ep.observe(i, obs);
      net.forward(obs);
      const probs = softmax(net.z, new Float32Array(5));
      text(fb, '分身みんなの脳（ひとつ）', x, y - 1, C.orange);
      drawBrain(fb, net, obs, x, y + 12, w - 54, h - 14, { cell: 4, probs, color: C.orange });
      drawProbs(fb, probs, x + w - 50, y + 16, 50, { pick: ep.act[i], color: C.orange });
      text(fb, '確率で選ぶ', x + w - 50, y + 60, C.steel);
      const v = ag.value(obs);
      text(fb, `ねだん ${v.toFixed(1)}`, x + w - 50, y + 72, C.yellow);
    } else if (tab === 3) {
      this.drawRewardKnobs(fb, x, y, w);
    } else if (tab === 4) {
      this._drawSettings(fb, x, y, w, h);
    }
  }

  _drawSettings(fb, x, y, w, h) {
    const s = this.session, ag = s.agent, app = this.app;
    let yy = y;
    const row = (label, names, cur, onPick, id) => {
      text(fb, label, x, yy + 1, C.white);
      const bx = x + w - names.length * 26;
      names.forEach((nm, k) => button(app, id + k, bx + k * 26, yy, 24, 13, nm, () => onPick(k), { active: cur === k, mini: /^\d+$/.test(nm) }));
      yy += 17;
    };
    row('分身の数', RL_CLONES.map(String), ag.clonesIdx, (k) => s.setClones(k), 'cl');
    row('好奇心', ENT_NAMES, ag.entIdx, (k) => { ag.entIdx = k; }, 'en');
    row('学習の速さ', LR_NAMES, ag.lrIdx, (k) => ag.setLr(k), 'lr');
    const il = app.game.loadBrain(this.def.id, 'il');
    const can = !!(il && il.w);
    button(app, 'combo', x, yy, w, 16, '模倣流の脳から始める', () => {
      if (!can) return;
      this.confirm('いまの強化流の脳を、模倣流で育てた脳に入れかえて、そこから強化学習で磨きます。', () => {
        s.loadPolicy(b64ToF32(il.w));
        app.masters.say('rl', 'お手本で覚えた脳をもらったぞ！ ここから試して試して、もっとうまくなる。いまのAIも使う「まねしてから鍛える」合わせ技だ！', { prio: 2, dur: 9 });
      }, '入れかえる');
    }, { disabled: !can });
    yy += 19;
    if (!can) { text(fb, '模倣流で学ばせると使える', x, yy - 2, C.steel); yy += 12; }
    button(app, 'reset', x, yy, w, 16, 'はじめからやり直す', () => this.confirm('この修行場の強化流の脳を、何も知らない状態に戻しますか？（印と記録は残ります）', () => { s.resetBrain(); this.hadGoal = false; }), { icon: ICON.reset });
  }

  drawActions(fb, y) {
    const s = this.session, app = this.app, VW = app.px.VW;
    const x = 4, w = VW - 8;
    button(app, 'pause', x, y, 22, 16, '', () => { s.paused = !s.paused; }, { icon: s.paused ? ICON.play : ICON.pause });
    this.speedButton(fb, x + 25, y);
    button(app, 'fast', x + 52, y, 74, 16, s.fast ? 'とめる' : '一気に学習', () => s.setFast(!s.fast), { icon: ICON.ff, active: s.fast });
    const on = this.overlay.heat;
    button(app, 'heatb', x + 129, y, w - 129, 16, 'ねだん', () => { this.overlay.heat = !on; this.mapT = 0; if (on) app.world.setHeat(null); }, { icon: ICON.heat, active: on });
  }

  drawViewExtra(fb, vh) {
    const s = this.session, app = this.app, VW = app.px.VW;
    if (s.fast) {
      fb.dither(0, this.top + 34, VW, vh - this.top - 34, C.ink, 8);
      text(fb, '高速修行中', VW / 2, vh / 2 - 14, C.orange, { align: 'center', outline: C.ink, bold: true });
      text(fb, `ラウンド${s.agent.round}`, VW / 2, vh / 2, C.white, { align: 'center', outline: C.ink });
      const last = s.agent.lastSummary;
      if (last) text(fb, `ゴール ${last.succ}/${last.n}`, VW / 2, vh / 2 + 13, C.yellow, { align: 'center', outline: C.ink });
    } else if (s.phase === 'learn') {
      const p = s.agent.updateProgress;
      const bw = 80, bx = Math.round(VW / 2 - bw / 2), by = Math.round(vh * 0.5);
      text(fb, '脳を更新中', VW / 2, by - 13, C.orange, { align: 'center', outline: C.ink });
      fb.rect(bx - 1, by - 1, bw + 2, 7, C.ink);
      fb.rect(bx, by, Math.round(bw * p), 5, C.orange);
    }
  }
}
