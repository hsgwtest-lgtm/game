// 進化流の修行画面（遺伝的アルゴリズム）
// 群れの全員が同時に挑む → 成績のよい子が親になる → 交叉と突然変異で次の世代

import { C, text, mini, button, toggle, measure } from '../ui/widgets.js';
import { ICON } from '../gfx/sprites.js';
import { TrainBase, CAUSE_NAME } from './train.js';
import { GASession } from '../game/session.js';
import { GA_POP, GA_MUTATION, HID } from '../ml/ga.js';
import { FAMILIES, PAL } from '../core/config.js';
import { drawGraph, drawBrain, drawProbs, drawMap } from '../ui/viz.js';
import { softmax } from '../ml/nn.js';
import { b64ToF32 } from '../ml/nn.js';
import { rgb } from '../gfx/fb.js';

const FAM = FAMILIES.map((f) => ({ c: rgb(f.color), d: rgb(f.dark) }));
const MUT_NAMES = ['弱', '中', '強'];

export class GAScreen extends TrainBase {
  constructor(app) { super(app, 'ga'); this.lastRecordGen = 0; }

  makeSession(def) { return new GASession(this.app, def); }
  tabNames() { return ['グラフ', 'むれ', 'のう', 'ほうび', '設定']; }
  focusNet() { return this.session.brainOf(); }
  // 世代のあいだは、チャンピオンの通った道を見せる
  phaseFootprints() { const s = this.session; return s.phase === 'between' && s.lastChamp && s.lastChamp.path ? { path: s.lastChamp.path, color: PAL.yellow } : null; }

  intro() {
    const g = this.app.game, s = this.session, key = 'intro_ga_' + this.def.id;
    const m = this.app.masters;
    if (!g.progress.seen.ga) {
      g.progress.seen.ga = true; g.saveProgress();
      m.say('ga', `わしは進化流のカメ仙人じゃ。${s.pop.size}人の群れがいっせいに挑み、成績のよい子が親になって次の世代をつくる。脳をまぜて少し変える…それが進化じゃ。`, { prio: 2, dur: 10 });
    } else if (!g.progress.seen[key]) {
      m.say('ga', this.def.lesson, { prio: 2, dur: 8 });
    }
    g.progress.seen[key] = true;
    this.stagnant = 0;
    this.bestSeen = s.pop.bestEver;
  }

  drawStatus(fb, y) {
    const s = this.session, ep = s.ep, pop = s.pop;
    let str;
    if (s.fast) str = `高速修行中…  第${pop.gen}世代`;
    else if (s.phase === 'between') str = `第${pop.gen - 1}世代 おわり → 親をえらぶ`;
    else {
      const alive = ep ? ep.aliveCount() : 0, goal = ep ? ep.successCount() : 0;
      str = `第${pop.gen}世代  のこり${alive}/${pop.size}  ゴール${goal}`;
    }
    text(fb, str, 4, y, C.white, { outline: C.ink });
    if (s.medal) fb.icon(ICON.medal, this.app.px.VW - 12, y + 2, C.gold);
  }

  onEvent(e) {
    if (e.type !== 'gen') return;
    const sm = e.summary, s = this.session, m = this.app.masters;
    if (!e.fast) {
      this.app.sfx('gen');
      this.showBanner(`第${sm.gen + 1}世代`, sm.succ ? `ゴール ${sm.succ}人` : '', C.lime, 1.0);
      const ep = s.ep;
      if (ep) this.app.world.burst(s.stage.start.x, s.stage.start.y, 'evolve', 12);
    }
    // 実況
    if (sm.record) { this.stagnant = 0; } else this.stagnant++;
    const firstGoal = sm.succ > 0 && !this.hadGoal;
    if (sm.succ > 0) this.hadGoal = true;
    if (e.fast) return;
    if (sm.gen === 1 && sm.succ === 0) m.say('ga', 'ほとんどの子が失敗したのう。じゃが、少しでもゴールに近づけた子が親になる。次の世代を見ておれ。', { key: 'g1' });
    else if (firstGoal && !s.medal) m.say('ga', 'おお！ ゴールにたどりついた子が出たぞ。この子の脳が次の世代へ受けつがれる。', { prio: 2, key: 'fg' });
    else if (sm.coins >= 6 && sm.succ === 0) m.say('ga', '小判ばかり集めて巻物を取らん子が「優秀」になっておる…。ごほうびの決め方のせいじゃ！', { prio: 2, key: 'hack' });
    else if (sm.record && sm.gen > 2 && Math.random() < 0.5) m.say('ga', `記録更新じゃ！ 成績 ${sm.best.toFixed(1)}。`, { key: 'rec' + (sm.gen % 5) });
    else if (this.stagnant === 15 && !s.medal) m.say('ga', (this.def.hints && this.def.hints.ga) || '伸びなやみじゃな。突然変異を変えるか、ごほうびの決め方を見直してみい。', { prio: 2, key: 'stag' });
    else if (sm.div < 0.12 && !s.medal && sm.gen > 10) m.say('ga', '群れがみな同じような脳になってきた。多様性が減ると、新しい道を見つけにくいぞ。', { key: 'div' });
  }

  onMedal(e) {
    this.app.masters.say('ga', `免許皆伝じゃ！ のべ${e.cost}人が挑んで、ついに道を見つけた。たくさん試して、よい子を残す。数の力じゃな。`, { prio: 3, dur: 9 });
  }

  medalLines(info) {
    return [`挑戦したでし: のべ${info.cost}人`, `第${info.gen}世代で達成`, info.steps ? `ゴールまで ${info.steps}歩` : ''];
  }

  // ── タブ ──
  drawTab(fb, tab, x, y, w, h) {
    const s = this.session, pop = s.pop, app = this.app;
    if (tab === 0) {
      const hist = pop.history;
      const gh = Math.round(h * 0.55);
      drawGraph(fb, [
        { data: hist.map((d) => d.avg), color: C.green },
        { data: hist.map((d) => d.best), color: C.yellow, dot: true },
      ], x, y + 11, w, gh, { empty: '1世代目を待っています', zero: true });
      text(fb, '成績', x, y - 1, C.silver);
      text(fb, '最高', x + 26, y - 1, C.yellow);
      text(fb, '平均', x + 50, y - 1, C.green);
      text(fb, `${Math.max(0, pop.gen - 1)}世代`, x + w, y - 1, C.silver, { align: 'right' });
      // ゴールした人数（棒）
      const by = y + gh + 15, bh = h - gh - 26;
      text(fb, 'ゴールした割合', x, by - 3, C.silver);
      fb.rect(x, by + 9, w, bh, C.ink);
      const n = Math.min(hist.length, w - 2);
      for (let i = 0; i < n; i++) {
        const d = hist[hist.length - n + i];
        const hh = Math.round(d.succ * (bh - 2));
        if (hh > 0) fb.rect(x + 1 + Math.round(i * (w - 2) / Math.max(1, n)), by + 9 + bh - 1 - hh, Math.max(1, Math.floor((w - 2) / Math.max(1, n))), hh, C.cyan);
      }
      text(fb, `のべ ${pop.evals}人`, x + w, by - 3, C.white, { align: 'right' });
    } else if (tab === 1) {
      this._drawFlock(fb, x, y, w, h);
    } else if (tab === 2) {
      const ep = s.ep;
      if (!ep) return;
      const i = Math.min(s.focus, ep.n - 1);
      const net = s.brainOf(i);
      const obs = new Float32Array(105);
      ep.observe(i, obs);
      net.forward(obs);
      const probs = softmax(net.z, new Float32Array(5));
      const m = pop.members[i];
      const f = FAMILIES[m.family] || FAMILIES[0];
      text(fb, `${f.name}${m.id}の脳`, x, y - 1, rgb(f.color));
      mini(fb, m.elite ? 'エリート' : `第${m.born}世代うまれ`, x + w, y + 2, C.silver, 'right');
      drawBrain(fb, net, obs, x, y + 12, w - 54, h - 14, { cell: 4, probs, color: C.lime });
      drawProbs(fb, probs, x + w - 50, y + 16, 50, { pick: probs.indexOf(Math.max(...probs)), color: C.lime });
      text(fb, 'えらぶのは', x + w - 50, y + 60, C.steel);
      text(fb, 'いつも一番', x + w - 50, y + 71, C.steel);
      text(fb, '点の高い手', x + w - 50, y + 82, C.steel);
    } else if (tab === 3) {
      this.drawRewardKnobs(fb, x, y, w);
    } else if (tab === 4) {
      this._drawSettings(fb, x, y, w, h);
    }
  }

  _drawFlock(fb, x, y, w, h) {
    const s = this.session, pop = s.pop, ep = s.ep, app = this.app;
    const n = pop.members.length;
    const cols = n <= 20 ? 10 : n <= 40 ? 10 : 16;
    const cw = Math.floor(w / cols), chh = n <= 40 ? 11 : 8;
    text(fb, '群れ（タップでえらぶ）', x, y - 1, C.silver);
    const gy = y + 12;
    for (let i = 0; i < n; i++) {
      const m = pop.members[i];
      const cx = x + (i % cols) * cw, cy = gy + Math.floor(i / cols) * chh;
      const f = FAM[m.family] || FAM[0];
      const done = ep && ep.done[i];
      const cause = ep ? ep.cause[i] : 0;
      fb.rect(cx, cy, cw - 1, chh - 1, C.ink);
      fb.rect(cx + 1, cy + 1, cw - 3, chh - 3, done && cause !== 1 ? f.d : f.c);
      if (done && cause !== 1) fb.checker(cx + 1, cy + 1, cw - 3, chh - 3, C.ink);
      if (cause === 1) fb.icon(ICON.star, cx + Math.floor((cw - 8) / 2), cy + Math.floor((chh - 8) / 2), C.white);
      if (m.elite) fb.rect(cx + 1, cy + 1, 2, 2, C.yellow);
      if (m.id === pop.oshiId) fb.rect(cx + cw - 4, cy + 1, 2, 2, C.magenta);
      if (i === s.focus) fb.frame(cx - 1, cy - 1, cw + 1, chh + 1, C.white);
      app.ui.btn('fl_' + i, cx, cy, cw - 1, chh - 1, () => { s.focus = i; this._syncWorld(false); this._syncItems(); });
    }
    // DNA：注目している子の脳はどちらの親から来たか（ニューロンごと）
    const rows = Math.ceil(n / cols);
    let dy = gy + rows * chh + 5;
    const m = pop.members[Math.min(s.focus, n - 1)];
    if (dy + 32 > y + h) return;
    text(fb, 'DNA（脳のつくり）', x + w, dy - 1, C.silver, { align: 'right' });
    dy += 14;
    const nCells = HID + 1;
    const dw = Math.floor(w / nCells);
    if (m.parents && m.src) {
      const pa = FAM[m.parents[0].family] || FAM[0], pb = FAM[m.parents[1].family] || FAM[0];
      text(fb, '親A', x, dy - 13, C.white, { align: 'left' });
      fb.rect(x + 22, dy - 10, 6, 6, pa.c);
      text(fb, '親B', x + 34, dy - 13, C.white);
      fb.rect(x + 56, dy - 10, 6, 6, pb.d);
      for (let j = 0; j < nCells; j++) {
        // そのニューロンの遺伝子の出どころ（先頭の遺伝子で判定）・突然変異の数
        if (j === 0) { /* 左端から並べる */ }
        const g0 = j < HID ? j * 105 : s.pop.netTmp.oB2;
        const src = m.src[g0];
        let mut = 0;
        if (m.mut) {
          const net = s.pop.netTmp;
          for (let p = 0; p < m.mut.length; p++) if (m.mut[p] && net.geneNeuron(p) === j) mut++;
        }
        const cx = x + j * dw;
        fb.rect(cx, dy, dw - 1, 16, C.ink);
        fb.rect(cx + 1, dy + 1, dw - 3, 14, src ? pb.d : pa.c);
        // 突然変異した遺伝子の割合（白い棒）
        const mh = Math.min(12, Math.round(mut / 111 * 60));
        if (mh > 0) fb.rect(cx + 1, dy + 15 - mh, Math.max(1, Math.floor((dw - 3) / 2)), mh, C.white);
      }
      text(fb, 'ニューロンごとに親から・白=突然変異', x, dy + 18, C.steel);
    } else {
      text(fb, m.elite ? 'エリート（そのまま残った子）' : '1世代目（ランダムな脳）', x, dy, C.steel);
    }
  }

  _drawSettings(fb, x, y, w, h) {
    const s = this.session, pop = s.pop, app = this.app;
    let yy = y;
    text(fb, '群れの数', x, yy + 1, C.white);
    let bx = x + w - 3 * 26;
    GA_POP.forEach((n, k) => {
      button(app, 'pop' + k, bx + k * 26, yy, 24, 13, String(n), () => s.setPopSize(n), { active: pop.size === n, mini: true });
    });
    yy += 17;
    text(fb, '突然変異', x, yy + 1, C.white);
    bx = x + w - 3 * 26;
    MUT_NAMES.forEach((nm, k) => {
      button(app, 'mut' + k, bx + k * 26, yy, 24, 13, nm, () => { pop.mutIdx = k; }, { active: pop.mutIdx === k });
    });
    yy += 17;
    text(fb, '推しを必ず残す', x, yy + 1, C.white);
    toggle(app, 'oshi_t', x + w - 24, yy + 2, pop.keepOshi, () => { pop.keepOshi = !pop.keepOshi; });
    yy += 17;
    // 合わせ技：模倣流の脳を群れに入れる
    const il = app.game.loadBrain(this.def.id, 'il');
    const can = !!(il && il.w);
    button(app, 'inject', x, yy, w, 16, '模倣流のでしを群れに入れる', () => {
      if (!can) return;
      const m = s.injectGenome(b64ToF32(il.w));
      app.masters.say('ga', 'お手本で育った子を群れに入れたぞ。この子の脳が親になれば、群れ全体が早く強くなる。合わせ技じゃ！', { prio: 2 });
      s.focus = s.pop.members.indexOf(m);
    }, { disabled: !can });
    yy += 19;
    if (!can) { text(fb, '模倣流で学ばせると使える', x, yy - 2, C.steel); yy += 12; }
    button(app, 'reset', x, yy, w, 16, 'はじめからやり直す', () => this.confirm('この修行場の進化流の群れを、1世代目からやり直しますか？（印と記録は残ります）', () => { s.resetBrain(); this.hadGoal = false; }), { icon: ICON.reset });
  }

  drawActions(fb, y) {
    const s = this.session, app = this.app, VW = app.px.VW;
    const x = 4, w = VW - 8;
    button(app, 'pause', x, y, 22, 16, '', () => { s.paused = !s.paused; }, { icon: s.paused ? ICON.play : ICON.pause });
    this.speedButton(fb, x + 25, y);
    button(app, 'fast', x + 52, y, 74, 16, s.fast ? 'とめる' : '一気に進化', () => s.setFast(!s.fast), { icon: ICON.ff, active: s.fast });
    const m = s.pop.members[s.focus];
    const isOshi = m && s.pop.oshiId === m.id;
    button(app, 'oshi', x + 129, y, w - 129, 16, isOshi ? '推し中' : '推しに', () => {
      if (!m) return;
      s.pop.oshiId = isOshi ? null : m.id;
      if (!isOshi) app.masters.say('ga', '推しの子は、成績にかかわらず次の世代に残すぞ。', { key: 'oshi' });
    }, { icon: ICON.heart, active: isOshi });
  }

  drawViewExtra(fb, vh) {
    const s = this.session;
    if (s.fast) {
      const app = this.app, VW = app.px.VW;
      fb.dither(0, this.top + 34, VW, vh - this.top - 34, C.ink, 8);
      text(fb, '高速修行中', VW / 2, vh / 2 - 14, C.lime, { align: 'center', outline: C.ink, bold: true });
      text(fb, `第${s.pop.gen}世代`, VW / 2, vh / 2, C.white, { align: 'center', outline: C.ink });
      const last = s.pop.history[s.pop.history.length - 1];
      if (last) text(fb, `ゴール ${Math.round(last.succ * s.pop.size)}人`, VW / 2, vh / 2 + 13, C.yellow, { align: 'center', outline: C.ink });
    }
  }
}
