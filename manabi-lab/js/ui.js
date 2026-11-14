// ui.js — 画面の部品（HUD・方式チップ・下のシート・個体カード・リプレイ操作・モーダル）。ブラウザ用
import { METHODS, M, ACT, ACT_JA, ACT_ICON, N_ACT } from './defs.js';
import { MODE, MODE_JA, CAUSE_JA, SKILL_GOT, DEFAULT_CFG } from './sim.js';
import { SKILLS, RULE_TEXT, diceProbs } from './methods.js';
import { RULES, DAY_TICKS, NIGHT_FROM, dayOf, clockOf, nightAt } from './world.js';
import * as Q from './qlearn.js';
import * as NN from './nn.js';
import { iconHTML, hydrateIcons, pixNumber, iconURL } from './icons.js';
import { drawCurves, drawLineage, drawSpeciesRiver, drawQPolicy, drawBrain, drawDice, drawReplay, drawShare, meterHTML, spColor, METRICS, ACT_COLORS } from './charts.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const last = (a) => (a && a.length ? a[a.length - 1] : 0);
const mstyle = (m) => `--mc:${METHODS[m].color};--md:${METHODS[m].dark}`;

// ドットを整数倍で拡大する（倍率がそろわないとドットの大きさがまちまちになる）
const dotScale = () => (window.innerWidth >= 700 ? 3 : 2);
function boxW(el) {
  const p = el.parentElement;
  const w = p ? p.clientWidth - (parseFloat(getComputedStyle(p).paddingLeft) || 0) - (parseFloat(getComputedStyle(p).paddingRight) || 0) : 0;
  return w > 40 ? w : 320;
}
// その canvas の場所に合う、ドット単位の幅
const dotW = (cv) => Math.max(80, Math.floor(boxW(cv) / dotScale()));
function fitPix(cv) {
  const s = Math.max(1, Math.floor(boxW(cv) / cv.width));
  cv.style.width = `${cv.width * s}px`;
  cv.style.height = `${cv.height * s}px`;
}

const SHEETS = {
  graph: '学習曲線',
  tree: '系図と種',
  replay: 'ベスト個体のリプレイ',
  mind: '4つの学び方',
  lab: '実験の設定',
};

// 学び方のちがい（一覧表）
const COMPARE = [
  ['まわりを見る（感覚を使う）', ['○', '○', '○', '×']],
  ['生きているあいだに学ぶ', ['×', '×', '○', '×']],
  ['世代をこえて伝わるもの', ['なし（規則は固定）', '脳の重み91個', 'みんなで共有するQ表', 'サイコロの偏り6個']],
  ['選択（よい家族を残す）', ['×', '○', '×', '○']],
  ['交叉（親を混ぜる）', ['×', '○', '×', '×']],
  ['突然変異（少し変える）', ['×', '○', '×', '○']],
  ['ためし（探索）', ['×', '突然変異', 'ε-greedy', '毎ターンがでたらめ']],
];

// アイコン画像を使うので、DOM ができてから作る
const helpHTML = () => `
<h2>あそびかた</h2>
<p>島の生き物は、草を食べて体力をため、体力が多いと子を産みます。体力がつきるか寿命で死にます。夜は暗くて草を食べにくく、歩くとフクロウにおそわれることがあります（眠っていれば安全）。</p>
<p><b>1世代 = 3日間のシーズン</b>。シーズンのはじめに、方式ごとに16匹の「創始者」が同じ場所から出発します。家族（創始者とその子孫）が集めた草の量が、その創始者の<b>適応度</b>です。シーズンが終わると、方式ごとのやり方で次の世代が作られます。</p>
<h3>4つの学び方</h3>
<ul class="mlist">
${METHODS.map((d) => `<li style="${mstyle(METHODS.indexOf(d))}">${iconHTML(d.icon)}<b>${d.ja}</b>：${esc(d.desc)}</li>`).join('')}
</ul>
<h3>操作</h3>
<ul>
<li>1本指ドラッグで島を回す・2本指でズームと移動・生き物をタップすると「いま何を考えているか」が見えます。</li>
<li>上の <b>停止 / 1x / 2x / 4x / 最大</b> で時間の速さ。<b>最大</b> は島の描画を止めて学習だけを全力で回す「ヘッドレス高速学習」です。</li>
<li>方式のチップをタップすると、見る島を切り替えます（競争モードでは、その方式だけを明るくします）。</li>
<li>下のボタン：<b>グラフ</b>（学習曲線・行動の獲得）、<b>系図</b>（親子のつながりと種の分岐）、<b>リプレイ</b>（ベスト家族のシーズンを1ターンも違わずに再生）、<b>方式</b>（それぞれの頭の中）、<b>実験</b>（条件を変えてやり直す・一気に学ばせる）。</li>
</ul>
<p class="note">データはこの端末の中だけに保存されます。オフラインでも動きます。</p>
`;

export class UI {
  constructor(app) {
    this.app = app;
    this.sheet = null;
    this.metric = 'fit';
    this.treeM = M.NN;
    this.mindM = M.NN;
    this.dirty = true;
    this.hudAcc = 1;
    this.infoAcc = 0;
    this.sheetAcc = 0;
    this.toastQ = [];
    this.toastT = 0;
    this.lastSky = '';
    this.chipEls = [];
    this.segEls = [];
    hydrateIcons();
    this.bind();
    this.buildTitleMethods();
  }

  // ======================================================= 結線
  bind() {
    const app = this.app;
    for (const b of document.querySelectorAll('[data-speed]')) {
      b.addEventListener('click', () => {
        const v = b.dataset.speed;
        app.setSpeed(v === 'max' ? 'max' : Number(v));
      });
    }
    for (const b of document.querySelectorAll('[data-sheet]')) b.addEventListener('click', () => this.toggleSheet(b.dataset.sheet));
    $('sheet-close').addEventListener('click', () => this.closeSheet());
    $('t-separate').addEventListener('click', () => app.start(MODE.SEPARATE));
    $('t-arena').addEventListener('click', () => app.start(MODE.ARENA));
    $('t-continue').addEventListener('click', () => app.continueGame());
    $('t-help').addEventListener('click', () => this.help());
    $('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') this.closeModal();
    });
    $('rep-exit').addEventListener('click', () => app.exitReplay());
    $('rep-start').addEventListener('click', () => {
      if (!app.replay) return;
      app.replay.t = 0;
      app.replay.playing = true;
      this.refreshReplay();
    });
    $('rep-play').addEventListener('click', () => {
      const r = app.replay;
      if (!r) return;
      if (r.t >= r.rep.ticks) r.t = 0;
      r.playing = !r.playing;
      this.refreshReplay();
    });
    $('rep-speed').addEventListener('click', () => {
      const r = app.replay;
      if (!r) return;
      r.speed = r.speed >= 8 ? 1 : r.speed * 2;
      this.refreshReplay();
    });
    $('rep-seek').addEventListener('input', (e) => {
      const r = app.replay;
      if (!r) return;
      r.t = Number(e.target.value);
      r.playing = false;
      this.refreshReplay();
    });
    $('fast').addEventListener('click', () => {
      if (app.speed === 'max') app.setSpeed(app.fastPrev || 1);
    });
  }

  buildTitleMethods() {
    $('t-methods').innerHTML = METHODS.map((d, m) => `<span class="tm" style="${mstyle(m)}">${iconHTML(d.icon)}<b>${d.ja}</b></span>`).join('');
  }

  // ======================================================= 画面の切り替え
  showTitle(info) {
    $('title').hidden = false;
    $('hud').hidden = true;
    $('dock').hidden = true;
    $('sheet').hidden = true;
    $('fast').hidden = true;
    $('t-continue').hidden = !info;
    $('t-continue-info').textContent = info || '';
  }
  showGame() {
    $('title').hidden = true;
    $('hud').hidden = false;
    $('dock').hidden = false;
    this.closeModal();
  }

  // 実験が新しくなったとき（方式チップ・シーズンの目盛りを作り直す）
  rebuild() {
    const app = this.app;
    const lab = app.lab;
    const ms = lab.cfg.methods;
    const chips = $('chips');
    chips.innerHTML = ms
      .map(
        (m) => `<button type="button" class="chip" data-m="${m}" style="${mstyle(m)}">${iconHTML(METHODS[m].icon)}<span class="cn">${METHODS[m].ja}</span><span class="cv"><span><b data-k="alive">0</b>匹</span><em data-k="food">0</em></span></button>`
      )
      .join('');
    this.chipEls = [...chips.querySelectorAll('.chip')];
    for (const el of this.chipEls) el.addEventListener('click', () => app.setViewMethod(Number(el.dataset.m)));
    const seg = $('season');
    const n = lab.cfg.days * 8;
    let s = '';
    for (let i = 0; i < n; i++) {
      const tod = ((i * DAY_TICKS) / 8 % DAY_TICKS) / DAY_TICKS;
      s += `<i class="${tod >= NIGHT_FROM ? 'nt' : ''}"></i>`;
    }
    seg.innerHTML = s;
    this.segEls = [...seg.children];
    if (!ms.includes(this.treeM)) this.treeM = ms.includes(M.NN) ? M.NN : M.DICE;
    if (!ms.includes(this.mindM)) this.mindM = ms[0];
    if (this.metric === 'share' && lab.cfg.mode !== MODE.ARENA) this.metric = 'fit';
    this.dirty = true;
    this.hudAcc = 1;
    this.hideInfo();
    if (this.sheet) this.openSheet(this.sheet);
  }

  refreshSpeed() {
    const s = String(this.app.speed);
    for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('on', b.dataset.speed === s);
    $('fast').hidden = this.app.speed !== 'max' || !this.app.started;
  }

  // ======================================================= 毎フレーム
  tick(dt) {
    const app = this.app;
    this.toastT -= dt;
    if (this.toastT <= 0 && this.toastQ.length) this.showToast(this.toastQ.shift());
    if (!app.started) return;
    const fast = app.speed === 'max';
    this.hudAcc += dt;
    if (this.hudAcc > (fast ? 0.25 : 0.1)) {
      this.hudAcc = 0;
      this.updateHud();
      if (fast) this.updateFast();
    }
    this.infoAcc += dt;
    if (app.selected >= 0 && this.infoAcc > 0.2) {
      this.infoAcc = 0;
      this.updateInfo();
    }
    this.sheetAcc += dt;
    if (this.sheet && ((this.dirty && this.sheetAcc > (fast ? 0.4 : 0.05)) || (this.sheet === 'mind' && this.sheetAcc > 0.5))) {
      this.sheetAcc = 0;
      this.dirty = false;
      this.refreshSheet();
    }
    if (app.replay) this.refreshReplayLive();
  }

  onGen(events) {
    this.dirty = true;
    if (this.app.speed === 'max') {
      // 高速学習中は大きなできごとだけ知らせる
      for (const e of events) if (e.type === 'skill' || e.type === 'lead') this.toast(e.text, e.m);
    } else for (const e of events.slice(0, 3)) this.toast(e.text, e.m);
  }

  updateHud() {
    const app = this.app;
    const lab = app.lab;
    const isl = app.replay ? null : app.island();
    const tick = app.replay ? app.replayTick() : Math.max(0, isl.tick - 1);
    pixNumber($('h-gen'), String(app.replay ? app.replay.rep.gen : lab.gen), '#ffd84a');
    $('h-day').textContent = `${dayOf(tick)}日目`;
    $('h-time').textContent = clockOf(tick);
    const sky = nightAt(tick) ? 'moon' : 'sun';
    if (sky !== this.lastSky) {
      this.lastSky = sky;
      $('h-sky').style.backgroundImage = `url(${iconURL(sky)})`;
    }
    const prog = Math.min(1, (tick + 1) / lab.seasonTicks);
    const on = Math.round(prog * this.segEls.length);
    this.segEls.forEach((el, i) => el.classList.toggle('on', i < on));
    if (!app.replay) {
      const live = lab.liveStats();
      for (const el of this.chipEls) {
        const m = Number(el.dataset.m);
        const s = live.find((x) => x.m === m);
        if (!s) continue;
        el.querySelector('[data-k="alive"]').textContent = s.alive;
        el.querySelector('[data-k="food"]').textContent = `草${f1(s.perFam)}`;
        const sel = lab.cfg.mode === MODE.ARENA ? app.highlight === m : app.viewM === m;
        el.classList.toggle('on', sel);
        el.classList.toggle('dim', lab.cfg.mode === MODE.ARENA && app.highlight >= 0 && app.highlight !== m);
      }
    }
  }

  // ======================================================= 最大速の表示
  updateFast() {
    const app = this.app;
    const lab = app.lab;
    pixNumber($('f-gen'), String(lab.gen), '#ffd84a');
    pixNumber($('f-rate'), app.rate >= 10 ? String(Math.round(app.rate)) : f1(app.rate), '#5fe6ff');
    $('f-target').textContent = app.fastTarget >= 0 ? `目標 第${app.fastTarget}世代まで（タップで止める）` : 'タップで 1x にもどる';
    drawCurves($('f-chart'), lab, 'fit', { w: dotW($('f-chart')), h: 56, ruleLine: true });
    fitPix($('f-chart'));
    $('f-legend').innerHTML = lab.cfg.methods.map((m) => `<span style="${mstyle(m)}"><i class="sw"></i>${METHODS[m].ja} ${f1(last(lab.hist[m].fit))}</span>`).join('');
  }

  // ======================================================= トースト
  toast(text, m = -1) {
    if (this.toastQ.length > 4) this.toastQ.shift();
    this.toastQ.push({ text, m });
    if (this.toastT <= 0) {
      this.showToast(this.toastQ.shift());
    }
  }
  showToast({ text, m }) {
    const el = $('toast');
    el.innerHTML = `${m >= 0 ? iconHTML(METHODS[m].icon, 's') : ''}<span>${esc(text)}</span>`;
    el.style.cssText = m >= 0 ? mstyle(m) : '';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.toastT = 2.2;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2100);
  }

  // ======================================================= モーダル
  modal(html) {
    $('modal-card').innerHTML = html;
    hydrateIcons($('modal-card'));
    $('modal').hidden = false;
    for (const b of $('modal-card').querySelectorAll('[data-close]')) b.addEventListener('click', () => this.closeModal());
  }
  closeModal() {
    $('modal').hidden = true;
  }
  help() {
    this.modal(`${helpHTML()}<div class="actions"><button type="button" class="pbtn gold" data-close>${iconHTML('play')}<span>わかった</span></button></div>`);
  }
  confirm(text, okLabel, onOk) {
    this.modal(`<p>${text}</p><div class="actions"><button type="button" class="pbtn" data-close><span>やめる</span></button><button type="button" class="pbtn gold" id="m-ok"><span>${esc(okLabel)}</span></button></div>`);
    $('m-ok').addEventListener('click', () => {
      this.closeModal();
      onOk();
    });
  }

  // ======================================================= 個体カード
  showInfo() {
    this.infoAcc = 1;
    $('info').hidden = false;
    this.updateInfo();
  }
  hideInfo() {
    $('info').hidden = true;
  }
  updateInfo() {
    const app = this.app;
    if (app.selected < 0 || app.replay) {
      this.hideInfo();
      return;
    }
    const isl = app.island();
    const c = isl.cs.find((x) => x.id === app.selected);
    const el = $('info');
    if (!c) {
      el.innerHTML = `<div class="info-head"><span>この生き物の記録はシーズンの終わりで閉じました</span><button type="button" class="pbtn icon-only small" id="i-close" aria-label="閉じる">${iconHTML('close')}</button></div>`;
      $('i-close').addEventListener('click', () => app.select(-1));
      return;
    }
    const d = METHODS[c.m];
    const who = c.founder ? '創始者' : `子（${c.depth}代目）`;
    let think = '';
    if (!c.alive) {
      think = `<p class="dead">${iconHTML(c.cause === 'owl' ? 'owl' : 'skull', 's')}${CAUSE_JA[c.cause] || ''}で死にました（${f1(c.age / DAY_TICKS)}日）</p>`;
    } else if (c.m === M.RULE) {
      think = `<p class="think">使った規則：${c.rule >= 0 ? `${c.rule + 1}. ${esc(RULE_TEXT[c.rule])}` : '—'}</p>`;
    } else if (c.m === M.NN) {
      const o = c.out ? Array.from(c.out) : new Array(N_ACT).fill(0);
      const mx = Math.max(...o);
      const mn = Math.min(...o);
      think = `<p class="think">脳の出した点数（いちばん高い行動をとる）</p>${actBars(o.map((v) => (mx > mn ? (v - mn) / (mx - mn) : 0)), o.indexOf(mx))}`;
    } else if (c.m === M.Q) {
      const L = app.lab.learnerOf(M.Q);
      if (c.qs >= 0 && L) {
        const p = Q.stateParts(c.qs);
        const qs = [];
        for (let a = 0; a < N_ACT; a++) qs.push(L.q[c.qs * N_ACT + a]);
        const mx = Math.max(...qs);
        const mn = Math.min(...qs);
        think = `<p class="think">状態 #${c.qs}：${Q.E_JA[p.e]}・足元の草が${['ない', '少し', 'たっぷり'][p.g]}・${Q.D_JA[p.d]}が${Q.S_JA[p.st]}・${Q.N_JA[p.n]}${c.explore ? ' <b class="hl">ためしの一手！</b>' : ''}</p>${actBars(
          qs.map((v) => (mx > mn ? (v - mn) / (mx - mn) : 0)),
          c.act
        )}<p class="note">棒＝Q表のこの状態の行（行動の良さ）。</p>`;
      }
    } else {
      const p = diceProbs(c.g);
      think = `<p class="think">まわりは見ていない。サイコロの出やすさ：</p>${actBars(Array.from(p).map((v) => Math.min(1, v * 2)), c.act, Array.from(p).map((v) => `${Math.round(v * 100)}%`))}`;
    }
    const fam = c.fam;
    el.style.cssText = mstyle(c.m);
    el.innerHTML = `
      <div class="info-head">${iconHTML(d.icon)}<b>${d.ja}</b><small>#${c.id}・家族${fam.slot + 1}・${who}</small>
        <button type="button" class="pbtn icon-only small" id="i-close" aria-label="閉じる">${iconHTML('close')}</button></div>
      <div class="info-row"><span>体力</span>${meterHTML(c.e / RULES.E_MAX, c.e < 20 ? '#ff5a5a' : '#63d36a')}<b>${Math.round(c.e)}</b></div>
      <div class="info-row"><span>行動</span>${iconHTML(ACT_ICON[c.act], 's')}<b>${ACT_JA[c.act]}</b><small>年齢${f1(c.age / DAY_TICKS)}日・子${c.kids}・家族の草${f1(fam.food)}</small></div>
      ${think}`;
    $('i-close').addEventListener('click', () => app.select(-1));
  }

  // ======================================================= リプレイ
  showReplay() {
    const r = this.app.replay;
    const rep = r.rep;
    const d = METHODS[rep.m];
    $('repbar').hidden = false;
    $('repbar').style.cssText = mstyle(rep.m);
    $('rep-icon').style.backgroundImage = `url(${iconURL(d.icon)})`;
    $('rep-title').textContent = `${d.ja}・第${rep.gen}世代のベスト家族`;
    $('rep-seek').max = String(rep.ticks);
    $('chips').hidden = true;
    this.hideInfo();
    this.closeSheet();
    $('dock').hidden = true;
    this.refreshReplay();
    this.app.view?.setInset($('repbar').offsetHeight + 12);
  }
  hideReplay() {
    $('repbar').hidden = true;
    $('chips').hidden = false;
    $('dock').hidden = !this.app.started;
    this.hudAcc = 1;
    this.app.view?.setInset(0);
  }
  refreshReplay() {
    const r = this.app.replay;
    if (!r) return;
    $('rep-play').querySelector('.ico').style.backgroundImage = `url(${iconURL(r.playing ? 'pause' : 'play')})`;
    $('rep-speed').textContent = `${r.speed}x`;
    this.refreshReplayLive(true);
  }
  refreshReplayLive(force = false) {
    const r = this.app.replay;
    const ti = Math.floor(r.t);
    if (!force && ti === this.lastRepT) return;
    this.lastRepT = ti;
    const rep = r.rep;
    const i = Math.min(rep.ticks, ti);
    $('rep-seek').value = String(i);
    $('rep-sub').textContent = `家族の草 ${f1(rep.famFood[i])} / ${f1(rep.finalFood)}・生きている家族 ${rep.famAlive[i]}匹・生まれた子 ${rep.births}`;
    drawReplay($('rep-chart'), rep, i, dotW($('rep-chart')));
    fitPix($('rep-chart'));
  }

  // ======================================================= シート
  toggleSheet(key) {
    if (this.sheet === key) this.closeSheet();
    else this.openSheet(key);
  }
  closeSheet() {
    this.sheet = null;
    $('sheet').hidden = true;
    for (const b of document.querySelectorAll('[data-sheet]')) b.classList.remove('on');
    document.body.classList.remove('sheet-open');
    this.app.view?.setInset(0);
  }
  openSheet(key) {
    this.sheet = key;
    $('sheet').hidden = false;
    document.body.classList.add('sheet-open');
    for (const b of document.querySelectorAll('[data-sheet]')) b.classList.toggle('on', b.dataset.sheet === key);
    $('sheet-title').textContent = SHEETS[key];
    const body = $('sheet-body');
    body.innerHTML = this[`build_${key}`]();
    hydrateIcons(body);
    this[`bind_${key}`]?.(body);
    this.dirty = false;
    this.refreshSheet();
    body.scrollTop = 0;
    this.app.view?.setInset(window.innerHeight - $('sheet').getBoundingClientRect().top);
  }
  refreshSheet() {
    if (!this.sheet) return;
    this[`refresh_${this.sheet}`]?.();
  }

  // ---- グラフ
  build_graph() {
    const lab = this.app.lab;
    const metrics = Object.keys(METRICS).filter((k) => k !== 'share' || lab.cfg.mode === MODE.ARENA);
    return `
      <div class="seg" id="g-metric">${metrics.map((k) => `<button type="button" class="pbtn small${k === this.metric ? ' on' : ''}" data-metric="${k}">${METRICS[k].ja}</button>`).join('')}</div>
      <canvas id="g-curve" class="pix"></canvas>
      <div id="g-legend" class="legend"></div>
      <p class="note">横＝世代、縦＝<span id="g-unit"></span>。暗い点は各世代の値、明るい線はその移動平均。点線はルール（学習しない対照群）の平均。</p>
      ${lab.cfg.mode === MODE.ARENA ? '<h3>島の取り分（集めた草の割合）</h3><canvas id="g-share" class="pix"></canvas><p class="note">取り分に応じて、次の世代の創始者の数（なわばり）が決まる。点線が半分。</p>' : ''}
      <h3>行動の獲得（行動テスト）</h3>
      <p class="note">決まった場面を見せて、正しい行動をとる割合（1.0＝必ずとる）。${SKILL_GOT}をこえた世代を「おぼえた」として記録。</p>
      <div id="g-skills" class="skills"></div>
      <h3>できごと</h3>
      <ol id="g-events" class="events"></ol>`;
  }
  bind_graph(body) {
    for (const b of body.querySelectorAll('[data-metric]')) {
      b.addEventListener('click', () => {
        this.metric = b.dataset.metric;
        for (const x of body.querySelectorAll('[data-metric]')) x.classList.toggle('on', x === b);
        this.refresh_graph();
      });
    }
  }
  refresh_graph() {
    const lab = this.app.lab;
    const met = this.metric;
    const cw = dotW($('g-curve'));
    drawCurves($('g-curve'), lab, met, { w: cw, h: Math.round(cw * 0.56), ruleLine: true });
    fitPix($('g-curve'));
    $('g-unit').textContent = `${METRICS[met].ja}（${METRICS[met].unit}）`;
    $('g-legend').innerHTML = lab.cfg.methods
      .map((m) => {
        const a = lab.hist[m][met] || [];
        const k = met === 'share' ? 100 : 1;
        return `<span style="${mstyle(m)}"><i class="sw"></i>${METHODS[m].ja} <b>${a.length ? f1(last(a) * k) : '—'}</b>${a.length > 1 ? `<small>（世代0: ${f1(a[0] * k)}）</small>` : ''}</span>`;
      })
      .join('');
    if ($('g-share')) {
      drawShare($('g-share'), lab, dotW($('g-share')));
      fitPix($('g-share'));
    }
    $('g-skills').innerHTML = `<div class="sk-head"><span></span>${SKILLS.map((s) => `<span>${iconHTML(s.icon, 's')}${s.short}</span>`).join('')}</div>${lab.cfg.methods
      .map((m) => {
        const H = lab.hist[m];
        return `<div class="sk-row" style="${mstyle(m)}"><span class="sk-name">${iconHTML(METHODS[m].icon, 's')}${METHODS[m].ja}</span>${SKILLS.map((s, k) => {
          const v = last(H.sk[k]);
          const g = lab.gotSkill[m][k];
          return `<span class="sk-cell">${meterHTML(v, METHODS[m].color)}<small>${H.sk[k].length ? f2(v) : '—'}${g >= 0 ? ` ★第${g}世代` : ''}</small></span>`;
        }).join('')}</div>`;
      })
      .join('')}`;
    hydrateIcons($('g-skills'));
    const ev = lab.events.slice(-30).reverse();
    $('g-events').innerHTML = ev.length
      ? ev.map((e) => `<li style="${mstyle(e.m)}">${iconHTML(e.type === 'record' ? 'star' : e.type === 'skill' ? 'brain' : e.type === 'extinct' ? 'skull' : e.type === 'lead' ? 'sword' : 'tree', 's')}<small>第${e.gen}世代</small>${esc(e.text)}</li>`).join('')
      : '<li class="empty">まだできごとはありません。世代が進むと、新記録・行動の獲得・種の分岐などがここに出ます。</li>';
  }

  // ---- 系図
  build_tree() {
    const lab = this.app.lab;
    const evo = lab.cfg.methods.filter((m) => m === M.NN || m === M.DICE);
    if (!evo.length) return '<p>系図があるのは、遺伝子を持つ「進化NN」と「ランダム＋選択」だけです。実験の設定でどちらかを入れてください。</p>';
    if (!evo.includes(this.treeM)) this.treeM = evo[0];
    return `
      <div class="seg">${evo.map((m) => `<button type="button" class="pbtn small${m === this.treeM ? ' on' : ''}" data-tm="${m}" style="${mstyle(m)}">${iconHTML(METHODS[m].icon, 's')}${METHODS[m].ja}</button>`).join('')}</div>
      <div class="scrollx"><canvas id="t-lin" class="pix lin"></canvas></div>
      <p class="note">横＝世代（画面に入るぶんの最近の世代。上の数字が世代）、縦＝その世代の創始者。点の色＝種、白い点＝エリート（そのまま残った上位）、点の上の黄色＝その世代のいちばん。線は親→子（交叉の2本目の親は暗い線）。<b class="hl">黄色い線</b>は、いまいちばん成績のよい個体の祖先をさかのぼった道すじです。</p>
      <h3>種の川</h3>
      <div class="scrollx"><canvas id="t-river" class="pix lin"></canvas></div>
      <p class="note">世代ごとに、どの種が何匹いたかを積み上げたもの。代表の遺伝子から一定以上はなれた子が生まれると新しい種に枝分かれします。</p>
      <h3>いまの種</h3>
      <ul id="t-species" class="species"></ul>
      <p class="note">ルールとQ学習には系図がありません。ルールは何も受け継がず、Q学習は1つのQ表をみんなで書き直すので「親子の血すじ」ではなく「経験の積み重ね」で学びます。</p>`;
  }
  bind_tree(body) {
    for (const b of body.querySelectorAll('[data-tm]')) {
      b.addEventListener('click', () => {
        this.treeM = Number(b.dataset.tm);
        this.openSheet('tree');
      });
    }
  }
  refresh_tree() {
    const lab = this.app.lab;
    if (!$('t-lin')) return;
    const m = this.treeM;
    drawLineage($('t-lin'), lab, m, { maxW: dotW($('t-lin')) });
    fitPix($('t-lin'));
    const L = lab.learnerOf(m);
    const book = L ? L.book : null;
    drawSpeciesRiver($('t-river'), book, lab.gen, { h: 40, maxW: dotW($('t-river')) });
    fitPix($('t-river'));
    if (!book) return;
    const alive = book.living().sort((a, b) => b.n - a.n);
    $('t-species').innerHTML =
      alive
        .slice(0, 10)
        .map((s) => {
          const par = s.parent >= 0 && book.list[s.parent] ? book.list[s.parent].name : '（はじまりの種）';
          return `<li><i class="sw" style="background:${spColor(s.id)}"></i><b>${esc(s.name)}</b><span>${s.n}匹</span><small>第${s.born}世代に誕生・祖先 ${esc(par)}</small></li>`;
        })
        .join('') + `<li class="sum">生きている種 ${alive.length}・これまでの種 ${book.list.filter((s) => s.counts.length).length}</li>`;
  }

  // ---- リプレイ一覧
  build_replay() {
    const lab = this.app.lab;
    return `
      <p class="note">シミュレーションは種つき乱数で決まるので、世代のはじめの状態さえあれば、同じシーズンを<b>1ターンも違わずに</b>もう一度起こせます。主役の家族を黄色の目印と足あとで追いかけます。</p>
      <div class="rcards">${lab.cfg.methods
        .map((m) => {
          const b = lab.best[m];
          const l = lab.latest[m];
          return `<div class="rcard" style="${mstyle(m)}">
            <div class="rc-head">${iconHTML(METHODS[m].icon)}<b>${METHODS[m].ja}</b></div>
            ${
              b
                ? `<button type="button" class="pbtn" data-rep="best" data-m="${m}">${iconHTML('star', 's')}<span>ベスト記録<small>第${b.gen}世代・草${f1(b.fit)}・子${b.kids}</small></span></button>
                   <button type="button" class="pbtn" data-rep="latest" data-m="${m}">${iconHTML('replay', 's')}<span>最新の世代のベスト<small>第${l.gen}世代・草${f1(l.fit)}・子${l.kids}</small></span></button>`
                : '<p class="note">1世代おわるとリプレイできます。</p>'
            }
          </div>`;
        })
        .join('')}</div>`;
  }
  bind_replay(body) {
    for (const b of body.querySelectorAll('[data-rep]')) b.addEventListener('click', () => this.app.startReplay(Number(b.dataset.m), b.dataset.rep));
  }
  refresh_replay() {
    // 世代が進んだら記録を差し替える
    const body = $('sheet-body');
    const y = body.scrollTop;
    body.innerHTML = this.build_replay();
    hydrateIcons(body);
    this.bind_replay(body);
    body.scrollTop = y;
  }

  // ---- 方式の中身
  build_mind() {
    const lab = this.app.lab;
    const ms = lab.cfg.methods;
    const m = this.mindM;
    const d = METHODS[m];
    let inner = '';
    if (m === M.RULE) {
      inner = `<h3>規則（上から順に調べる）</h3><ol class="rules" id="mi-rules">${RULE_TEXT.map((t, i) => `<li><span>${esc(t)}</span><em data-r="${i}"></em></li>`).join('')}</ol><p class="note">右の数字＝いま島にいるルールの生き物が、さっきのターンにその規則を使った割合。何世代たっても規則そのものは変わらない（対照群）。</p>`;
    } else if (m === M.NN) {
      inner = `<h3>いちばんの脳（重み${NN.N_W}個）</h3><canvas id="mi-brain" class="pix"></canvas>
        <p class="note">左の回路（IN→中間6）は体力(E)・足元の草(G)・夜(N)・混雑(C)・気まぐれ(R)を見て「食べる(E)」「眠る(Z)」の点数を出す。右の回路は1方向ぶんのにおい(S)・通れない(X)から「その方向へ歩く(GO)」点数を出し、北東南西で同じ重みを使う。青＝正、赤＝負。</p>
        <div class="kv" id="mi-nn"></div>`;
    } else if (m === M.Q) {
      inner = `<h3>Q表の方針地図（${Q.N_STATES}状態）</h3><canvas id="mi-q" class="pix"></canvas>
        <div class="legend">${[ACT.EAT, ACT.N, ACT.E, ACT.S, ACT.W, ACT.SLEEP].map((a) => `<span><i class="sw" style="background:${ACT_COLORS[a]}"></i>${ACT_JA[a]}</span>`).join('')}</div>
        <p class="note">大きなマス：縦＝体力（E2満腹が上）、横＝足元の草（G0なし→G2たっぷり）。その中の4×4：横＝においの方向（北東南西）、縦＝昼うすい／昼におう／夜うすい／夜におう。色と記号＝その状態でいちばん良いとされる行動。暗い点＝まだ一度も来たことのない状態。</p>
        <div class="kv" id="mi-qs"></div>`;
    } else {
      inner = `<h3>世代の平均のサイコロ</h3><canvas id="mi-dice" class="pix"></canvas><p class="note">どの行動がどれだけ出やすいか。まわりを見ないので、できるのは「出やすさ」を選ぶことだけ。点線＝6等分（1/6）。</p><div class="kv" id="mi-ds"></div>`;
    }
    return `
      <div class="seg">${ms.map((x) => `<button type="button" class="pbtn small${x === m ? ' on' : ''}" data-mm="${x}" style="${mstyle(x)}">${iconHTML(METHODS[x].icon, 's')}${METHODS[x].ja}</button>`).join('')}</div>
      <div class="mhead" style="${mstyle(m)}">${iconHTML(d.icon)}<div><b>${d.long}</b><small>${d.role}</small></div></div>
      <p>${esc(d.desc)}</p>
      ${inner}
      <h3>学び方のちがい</h3>
      <div class="scrollx"><table class="cmp"><thead><tr><th></th>${METHODS.map((x, i) => `<th style="${mstyle(i)}">${iconHTML(x.icon, 's')}<br>${x.ja}</th>`).join('')}</tr></thead>
      <tbody>${COMPARE.map(([k, v]) => `<tr><th>${k}</th>${v.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  bind_mind(body) {
    for (const b of body.querySelectorAll('[data-mm]')) {
      b.addEventListener('click', () => {
        this.mindM = Number(b.dataset.mm);
        this.openSheet('mind');
      });
    }
  }
  refresh_mind() {
    const app = this.app;
    const lab = app.lab;
    const m = this.mindM;
    const L = lab.learnerOf(m);
    if (!L) return;
    if (m === M.RULE) {
      const isl = lab.islandOf(M.RULE);
      const cnt = [0, 0, 0, 0];
      let n = 0;
      for (const c of isl.cs) {
        if (c.alive && c.m === M.RULE && c.rule >= 0) {
          cnt[c.rule]++;
          n++;
        }
      }
      for (const el of document.querySelectorAll('#mi-rules [data-r]')) el.textContent = n ? `${Math.round((cnt[Number(el.dataset.r)] / n) * 100)}%` : '—';
    } else if (m === M.NN) {
      const pop = L.evaluated && L.evaluated.length ? L.evaluated : L.current;
      let best = pop[0];
      for (const p of pop) if ((p.fit ?? 0) > (best.fit ?? 0)) best = p;
      drawBrain($('mi-brain'), best ? best.g : null);
      fitPix($('mi-brain'));
      $('mi-nn').innerHTML = kv([
        ['見せている脳', L.evaluated ? `前の世代でいちばん草を集めた家族（草${f1(best.fit ?? 0)}）` : '世代0（でたらめ）'],
        ['生きている種', `${L.book.living().length}`],
        ['突然変異', `重みごとに${Math.round(lab.cfg.nn.rate * 100)}%の確率で ±${lab.cfg.nn.sigma}`],
        ['交叉・エリート', `${Math.round(lab.cfg.nn.cx * 100)}%で2親を混ぜる・上位${lab.cfg.nn.elite}はそのまま`],
      ]);
    } else if (m === M.Q) {
      drawQPolicy($('mi-q'), L.q, L.visits);
      fitPix($('mi-q'));
      const ex = L.extraStats();
      $('mi-qs').innerHTML = kv([
        ['ε（ためす確率）', `${f2(ex.eps)}（世代ごとに×${lab.cfg.q.epsDecay}、下限${lab.cfg.q.epsMin}）`],
        ['学習率 α・割引率 γ', `${lab.cfg.q.alpha}・${lab.cfg.q.gamma}`],
        ['来たことのある状態', `${ex.known} / ${Q.N_STATES}`],
        ['書き直した回数', `${(L.updates + (L.live ? L.live.updates : 0)).toLocaleString()}回`],
        ['前の世代のTD誤差', f2(ex.td || 0)],
      ]);
    } else {
      drawDice($('mi-dice'), L.meanProbs(), Math.min(200, dotW($('mi-dice'))));
      fitPix($('mi-dice'));
      $('mi-ds').innerHTML = kv([
        ['生きている種', `${L.book.living().length}`],
        ['コピーのゆらぎ', `±${lab.cfg.dice.sigma}`],
        ['交叉', 'なし（選択とゆらぎだけ）'],
      ]);
    }
  }

  // ---- 実験の設定
  build_lab() {
    const app = this.app;
    const lab = app.lab;
    const c = lab.cfg;
    const opt = (vals, cur, fmt = (v) => v) => vals.map((v) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${fmt(v)}</option>`).join('');
    return `
      <div class="kv" id="x-sum">${this.labSummary()}</div>
      <h3>一気に学ばせる（ヘッドレス高速学習）</h3>
      <div class="row-btns">
        <button type="button" class="pbtn" data-fast="10">${iconHTML('bolt', 's')}<span>+10世代</span></button>
        <button type="button" class="pbtn" data-fast="50">${iconHTML('bolt', 's')}<span>+50世代</span></button>
        <button type="button" class="pbtn" data-fast="200">${iconHTML('bolt', 's')}<span>+200世代</span></button>
      </div>
      <p class="note">島の描画を止めて、決めた世代まで学習だけを最大速で回し、終わったら元の速さにもどります。</p>
      <h3>新しい実験</h3>
      <div class="form">
        <label class="fl">くらべ方
          <select id="x-mode" class="psel">${opt([MODE.SEPARATE, MODE.ARENA], c.mode, (v) => MODE_JA[v])}</select></label>
        <div class="fl">方式<div class="checks">${METHODS.map((d, m) => `<label class="pchk" style="${mstyle(m)}"><input type="checkbox" data-xm="${m}"${c.methods.includes(m) ? ' checked' : ''}>${iconHTML(d.icon, 's')}${d.ja}</label>`).join('')}</div></div>
        <label class="fl">島のシード<span class="inl"><input id="x-seed" class="pinp" type="number" min="1" max="999999" value="${c.seed}"><button type="button" class="pbtn small" id="x-roll">${iconHTML('dice', 's')}<span>くじ</span></button></span></label>
        <label class="fl">創始者の数<select id="x-founders" class="psel">${opt([8, 12, 16, 24, 32], c.founders, (v) => `${v}匹`)}</select></label>
        <label class="fl">1世代の日数<select id="x-days" class="psel">${opt([2, 3, 4, 5], c.days, (v) => `${v}日`)}</select></label>
        <details class="pdet"><summary>学び方のこまかい設定</summary>
          <label class="fl">Q学習 学習率 α<select id="x-qa" class="psel">${opt([0, 0.01, 0.03, 0.1, 0.3], c.q.alpha, (v) => (v === 0 ? '0（学ばない）' : v))}</select></label>
          <label class="fl">Q学習 割引率 γ<select id="x-qg" class="psel">${opt([0, 0.5, 0.8, 0.9, 0.97], c.q.gamma)}</select></label>
          <label class="fl">Q学習 最初の ε<select id="x-qe" class="psel">${opt([0, 0.1, 0.3, 0.6], c.q.eps0)}</select></label>
          <label class="fl">進化NN 突然変異の確率<select id="x-nr" class="psel">${opt([0, 0.05, 0.12, 0.3], c.nn.rate, (v) => `${Math.round(v * 100)}%`)}</select></label>
          <label class="fl">進化NN 交叉の確率<select id="x-nc" class="psel">${opt([0, 0.3, 0.6, 0.9], c.nn.cx, (v) => `${Math.round(v * 100)}%`)}</select></label>
          <label class="fl">サイコロ コピーのゆらぎ<select id="x-ds" class="psel">${opt([0, 0.04, 0.08, 0.2], c.dice.sigma)}</select></label>
        </details>
        <div class="row-btns"><button type="button" class="pbtn gold" id="x-go">${iconHTML('flask', 's')}<span>この設定で新しく始める</span></button>
        <button type="button" class="pbtn" id="x-bench">${iconHTML('chart', 's')}<span>テストと同じ条件</span></button></div>
        <p class="note">「テストと同じ条件」は、tests/ のベンチマークと同じ（4方式・別々の島・シード7・16匹・3日）。</p>
      </div>
      <h3>表示</h3>
      <div class="form">
        <label class="fl">ドットの大きさ<select id="x-pixel" class="psel">${opt([1, 2, 3, 4], app.prefs.pixel, (v) => `${v}倍`)}</select></label>
        <label class="pchk"><input type="checkbox" id="x-shadow"${app.prefs.shadows ? ' checked' : ''}>影を描く</label>
        <label class="pchk"><input type="checkbox" id="x-fx"${app.prefs.fx ? ' checked' : ''}>できごとの粒（食べる・生まれる・死ぬ）</label>
      </div>
      <h3>保存</h3>
      <div class="row-btns">
        <button type="button" class="pbtn" id="x-save">${iconHTML('save', 's')}<span>いま保存</span></button>
        <button type="button" class="pbtn" id="x-title">${iconHTML('island', 's')}<span>タイトルへ</span></button>
        <button type="button" class="pbtn" id="x-help">${iconHTML('help', 's')}<span>あそびかた</span></button>
      </div>
      <p class="note">実験は自動でこの端末に保存されます（読みこむと、その世代のはじめから再開）。</p>`;
  }
  bind_lab(body) {
    const app = this.app;
    for (const b of body.querySelectorAll('[data-fast]')) b.addEventListener('click', () => app.runFast(Number(b.dataset.fast)));
    $('x-roll').addEventListener('click', () => ($('x-seed').value = String(1 + Math.floor(Math.random() * 999999))));
    const read = () => {
      const methods = [...body.querySelectorAll('[data-xm]')].filter((x) => x.checked).map((x) => Number(x.dataset.xm));
      return {
        mode: $('x-mode').value,
        methods,
        seed: Number($('x-seed').value) || 1,
        founders: Number($('x-founders').value),
        days: Number($('x-days').value),
        q: { ...DEFAULT_CFG.q, alpha: Number($('x-qa').value), gamma: Number($('x-qg').value), eps0: Number($('x-qe').value) },
        nn: { ...DEFAULT_CFG.nn, rate: Number($('x-nr').value), cx: Number($('x-nc').value) },
        dice: { ...DEFAULT_CFG.dice, sigma: Number($('x-ds').value) },
      };
    };
    $('x-go').addEventListener('click', () => {
      const cfg = read();
      if (!cfg.methods.length) {
        this.toast('方式を1つ以上えらんでください');
        return;
      }
      if (cfg.mode === MODE.ARENA && cfg.methods.length < 2) {
        this.toast('競争モードは2つ以上の方式が必要です');
        return;
      }
      this.confirm('いまの実験を終わりにして、この設定で新しく始めますか？（いまの記録は消えます）', '新しく始める', () => app.newExperiment(cfg));
    });
    $('x-bench').addEventListener('click', () => {
      this.confirm('ベンチマークと同じ条件（4方式・別々の島・シード7・16匹・3日）で新しく始めますか？', '始める', () => app.newExperiment({ mode: MODE.SEPARATE, seed: 7 }));
    });
    $('x-pixel').addEventListener('change', (e) => app.setPixel(Number(e.target.value)));
    $('x-shadow').addEventListener('change', (e) => app.setShadows(e.target.checked));
    $('x-fx').addEventListener('change', (e) => app.setFx(e.target.checked));
    $('x-save').addEventListener('click', () => this.toast(app.save(true) ? '保存しました' : '保存できませんでした（容量不足かもしれません）'));
    $('x-title').addEventListener('click', () => app.toTitle());
    $('x-help').addEventListener('click', () => this.help());
  }
  labSummary() {
    const lab = this.app.lab;
    const c = lab.cfg;
    return kv([
      ['いまの実験', `${MODE_JA[c.mode]}・第${lab.gen}世代`],
      ['方式', c.methods.map((m) => METHODS[m].ja).join('・')],
      ['島のシード', `${c.seed}`],
      ['1世代', `${c.days}日（${c.days * DAY_TICKS}ターン）・創始者${c.mode === MODE.ARENA ? `合計${lab.arenaTotal}匹` : `${c.founders}匹ずつ`}`],
    ]);
  }
  refresh_lab() {
    if ($('x-sum')) $('x-sum').innerHTML = this.labSummary();
  }
}

function kv(rows) {
  return rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

// 6つの行動の棒（値は 0〜1）。hi は強調する行動
function actBars(vals, hi, labels) {
  return `<div class="abars">${vals
    .map((v, a) => `<span class="${a === hi ? 'hi' : ''}">${iconHTML(ACT_ICON[a], 's')}${meterHTML(v, ACT_COLORS[a])}${labels ? `<small>${labels[a]}</small>` : ''}</span>`)
    .join('')}</div>`;
}
