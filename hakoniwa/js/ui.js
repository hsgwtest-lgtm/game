// ui.js — 画面の部品（上の情報バー・道具箱・パネル・ダイアログ・タイトル）
import { HERB, CARN, CLS_JA, DEATH_JA, maxEnergy, maturityOf } from './sim.js';
import { DAY_LEN, T_JA } from './world.js';
import { TRAIT_JA, TRAIT_MIN, TRAIT_MAX, DIET_ENDS, TR, fmtTrait, traitNorm } from './genetics.js';
import { ACTION_JA, ACTION_ICON } from './brain.js';
import { MISSIONS, missionById } from './missions.js';
import { drawPopulation, drawTraitTrend, drawHistogram, drawBrain, spColor, HERB_COLOR, CARN_COLOR } from './charts.js';

const $ = (id) => document.getElementById(id);
const PLACE_TOOLS = ['grass', 'fruit', 'tree', 'herb', 'carn'];
const TOOL_HELP = {
  look: '生き物をタップすると、くわしい様子と脳の中が見られます',
  grass: '島をタップすると、まわりに草の種をまきます',
  fruit: '島をタップすると、木の実を6こ置きます',
  tree: '島をタップすると、木の苗を植えます（育つと実がなる）',
  herb: '島をタップすると、選んだ種の草食動物を3匹放します',
  carn: '島をタップすると、選んだ種の肉食動物を1匹放します',
};
const COLOR_MODES = [
  ['gene', '種の色'],
  ['speed', '速さ'],
  ['size', '大きさ'],
  ['vision', '視野'],
  ['diet', '食性'],
  ['cold', '耐寒性'],
];
const COLOR_ENDS = { speed: ['遅い', '速い'], size: ['小さい', '大きい'], vision: ['せまい', '広い'], diet: ['草・雑食', '木の実・肉'], cold: ['暑さに強い', '寒さに強い'] };
const dayOf = (t) => Math.floor(t / DAY_LEN) + 1;
const fmtDay = (t) => `${dayOf(t)}日目`;

export class UI {
  constructor(app) {
    this.app = app;
    this.tool = 'look';
    this.toolSp = [null, null];
    this.sheet = null;
    this.sheetSub = { graph: 'pop', gcls: HERB, gtrait: TR.SPEED, species: 'list' };
    this.hudAcc = 1;
    this.sheetAcc = 0;
    this.toastTimer = 0;
    this.selDeadShown = false;
    this.bind();
  }

  bind() {
    document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => this.app.setSpeed(+b.dataset.speed)));
    document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    document.querySelectorAll('[data-event]').forEach((b) => b.addEventListener('click', () => this.useEvent(b.dataset.event)));
    document.querySelectorAll('[data-sheet]').forEach((b) =>
      b.addEventListener('click', () => (this.sheet === b.dataset.sheet ? this.closeSheet() : this.openSheet(b.dataset.sheet)))
    );
    $('sheet-close').addEventListener('click', () => this.closeSheet());
    const tools = $('tools');
    tools.addEventListener('scroll', () => tools.classList.toggle('end', tools.scrollLeft + tools.clientWidth >= tools.scrollWidth - 4), { passive: true });
    $('mission-bar').addEventListener('click', () => this.openSheet('goal'));
    $('t-continue').addEventListener('click', () => this.app.continueGame());
    $('t-sandbox').addEventListener('click', () => this.confirmNew(() => this.app.newSandbox()));
    $('t-missions').addEventListener('click', () => this.missionList());
    $('t-help').addEventListener('click', () => this.help());
    $('modal').addEventListener('click', (e) => {
      if (e.target === $('modal') && this.modalDismissable) this.closeModal();
    });
  }

  // ---------- 状態の切り替え
  showTitle(saveInfo) {
    $('title').hidden = false;
    $('hud').hidden = true;
    $('dock').hidden = true;
    this.closeSheet();
    $('t-continue').hidden = !saveInfo;
    if (saveInfo) $('t-continue-info').textContent = saveInfo;
  }
  showGame() {
    $('title').hidden = true;
    $('hud').hidden = false;
    $('dock').hidden = false;
    this.closeModal();
    this.setTool('look');
    this.refreshSpeed();
    this.hudAcc = 1;
    this.refreshCosts();
    this.updateHUD();
  }

  refreshSpeed() {
    document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed === this.app.speed)));
  }

  refreshCosts() {
    const sim = this.app.sim;
    document.querySelectorAll('[data-cost]').forEach((e) => {
      e.textContent = sim.god.inf ? '' : String(sim.costs[e.dataset.cost]);
    });
  }

  // ---------- 上の情報バー
  updateHUD() {
    const sim = this.app.sim;
    const w = sim.world;
    $('h-day').textContent = `${w.day}日目`;
    $('h-time').textContent = w.clockText();
    let icon = w.daylight > 0.4 ? '☀️' : '🌙';
    if (w.rainI > 0.3) icon = '🌧️';
    if (w.heatI > 0.3) icon = '🔥';
    if (w.coldI > 0.3) icon = w.snow > 0.3 ? '☃️' : '❄️';
    $('h-weather').textContent = icon;
    $('h-temp').textContent = `${Math.round(w.temp)}℃`;
    const herbEl = $('h-herb');
    const carnEl = $('h-carn');
    herbEl.textContent = sim.nCls[HERB];
    carnEl.textContent = sim.nCls[CARN];
    herbEl.parentElement.classList.toggle('flash', sim.nCls[HERB] > 0 && sim.nCls[HERB] < 6);
    carnEl.parentElement.classList.toggle('flash', sim.nCls[CARN] > 0 && sim.nCls[CARN] < 2);
    $('h-sp').textContent = sim.livingSpecies(1).length;
    $('h-gen').textContent = Math.max(sim.maxGen(HERB), sim.maxGen(CARN));
    $('h-grass').textContent = Math.round(w.grassMean() * 100);
    $('h-god').textContent = sim.god.inf ? '∞' : Math.floor(sim.god.pow);
    $('h-godchip').hidden = sim.god.inf;
    $('h-godchip').title = sim.god.inf ? '神の力（観察モードでは使い放題）' : `神の力（毎秒${sim.god.regen}ずつ回復、最大${sim.god.max}）`;
    const m = sim.mission;
    const mb = $('mission-bar');
    mb.hidden = !m;
    document.body.classList.toggle('has-mission', !!m);
    if (m) {
      const def = missionById(m.id);
      $('mb-title').textContent = `${def.icon} ${def.title}`;
      $('mb-text').textContent = m.status === 'play' ? m.text || '' : m.status === 'clear' ? '達成！' : '失敗';
      $('mb-fill').style.width = `${Math.round((m.progress || 0) * 100)}%`;
    }
    document.querySelectorAll('#tools [data-tool], #tools [data-event]').forEach((b) => {
      const k = b.dataset.tool || b.dataset.event;
      b.classList.toggle('poor', k !== 'look' && !sim.canPay(k));
    });
    const lg = $('legend');
    const mode = this.app.view.colorMode;
    lg.hidden = mode === 'gene';
    if (mode !== 'gene') {
      const [a, b] = COLOR_ENDS[mode];
      const name = COLOR_MODES.find((x) => x[0] === mode)[1];
      lg.innerHTML = `<b>${name}</b><span>${a}</span><span class="ramp"></span><span>${b}</span>`;
    }
  }

  // ---------- 道具
  setTool(t) {
    this.tool = t;
    document.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    this.renderToolOpt();
    if (this.app.playing && t !== 'look') this.toast(TOOL_HELP[t]);
  }

  speciesChoices(cls) {
    const sim = this.app.sim;
    const living = sim.species.filter((s) => s.cls === cls && s.n > 0).sort((a, b) => b.n - a.n);
    const gone = sim.species.filter((s) => s.cls === cls && s.n === 0 && s.starter);
    return { living, gone };
  }

  renderToolOpt() {
    const box = $('tool-opt');
    const t = this.tool;
    if (t !== 'herb' && t !== 'carn') {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const cls = t === 'herb' ? HERB : CARN;
    const { living, gone } = this.speciesChoices(cls);
    const all = [...living, ...gone];
    if (!all.length) {
      box.hidden = true;
      return;
    }
    let cur = this.toolSp[cls];
    if (cur == null || !all.some((s) => s.id === cur)) cur = this.toolSp[cls] = all[0].id;
    box.hidden = false;
    box.innerHTML =
      `<span class="lbl">放す種</span>` +
      all
        .map(
          (s) =>
            `<button type="button" class="sp-chip" data-sp="${s.id}" aria-pressed="${s.id === cur}"><span class="dot" style="background:${spColor(s)}"></span>${s.name}${s.n ? ` ${s.n}匹` : '（呼び戻す）'}</button>`
        )
        .join('');
    box.querySelectorAll('[data-sp]').forEach((b) =>
      b.addEventListener('click', () => {
        this.toolSp[cls] = +b.dataset.sp;
        this.renderToolOpt();
      })
    );
  }

  useEvent(kind) {
    const sim = this.app.sim;
    const r = sim.useTool(kind);
    this.toast(r.msg);
    this.hudAcc = 1;
  }

  tap(x, y) {
    if (!this.app.playing) return;
    const view = this.app.view;
    const sim = this.app.sim;
    // パネルを開いているあいだ（道具箱が隠れているとき）は、タップは生き物を選ぶだけ
    if (this.tool === 'look' || this.sheet) {
      const c = view.pickCreature(x, y, 34);
      if (c) this.select(c);
      else if (view.selected) this.deselect();
      return;
    }
    const g = view.pickGround(x, y);
    if (!g) {
      this.toast('島の上をタップしてください');
      return;
    }
    const cls = this.tool === 'herb' ? HERB : this.tool === 'carn' ? CARN : null;
    const r = sim.useTool(this.tool, g.x, g.z, { sp: cls === null ? null : this.toolSp[cls] });
    this.toast(r.msg);
    if (r.ok) {
      const color = { grass: '#8cff6a', fruit: '#ff7a5a', tree: '#5bd16a', herb: '#ffffff', carn: '#ffb36a' }[this.tool];
      view.burstAt(g.x, g.z, color, 14);
      if (cls !== null) this.renderToolOpt();
    }
    this.hudAcc = 1;
  }

  // ---------- 個体を選ぶ
  select(c) {
    const view = this.app.view;
    view.selected = c;
    view.follow = true;
    view.orbit.rad = Math.min(view.orbit.rad, 36);
    this.selDeadShown = false;
    this.openSheet('creature');
  }
  deselect() {
    const view = this.app.view;
    view.selected = null;
    view.follow = false;
    if (this.sheet === 'creature') this.closeSheet();
  }

  // ---------- パネル
  // パネルは下のタブの上に出す（タブで別のパネルへすぐ切り替えられる）
  openSheet(name) {
    this.sheet = name;
    const sh = $('sheet');
    $('dock').classList.add('compact');
    const tabsTop = document.querySelector('.tabs').getBoundingClientRect().top;
    const bottom = Math.max(0, window.innerHeight - tabsTop + 4);
    sh.style.bottom = `${bottom}px`;
    sh.style.maxHeight = `${Math.round(Math.max(220, Math.min(window.innerHeight * 0.56, window.innerHeight - bottom - 140)))}px`;
    sh.hidden = false;
    document.querySelectorAll('[data-sheet]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sheet === name)));
    this.buildSheet();
    sh.querySelector('.sheet-body').scrollTop = 0;
    requestAnimationFrame(() => this.app.view.setInset(window.innerHeight - sh.getBoundingClientRect().top));
  }
  closeSheet() {
    if (this.sheet === 'creature') {
      this.app.view.follow = false;
    }
    this.sheet = null;
    $('sheet').hidden = true;
    $('dock').classList.remove('compact');
    document.querySelectorAll('[data-sheet]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    this.app.view.setInset(0);
  }

  buildSheet() {
    const body = $('sheet-body');
    const title = $('sheet-title');
    const s = this.sheet;
    if (s === 'graph') {
      title.textContent = '📈 グラフ';
      const sub = this.sheetSub.graph;
      body.innerHTML = `
        <div class="seg" role="group">
          <button type="button" data-g="pop" aria-pressed="${sub === 'pop'}">個体数</button>
          <button type="button" data-g="trait" aria-pressed="${sub === 'trait'}">形質の変化</button>
        </div>
        <div id="g-body"></div>`;
      body.querySelectorAll('[data-g]').forEach((b) =>
        b.addEventListener('click', () => {
          this.sheetSub.graph = b.dataset.g;
          this.buildSheet();
        })
      );
      if (sub === 'pop') {
        $('g-body').innerHTML = `
          <canvas class="chart" id="cv-pop" aria-label="個体数の推移グラフ"></canvas>
          <div class="legend-list" id="pop-legend"></div>
          <p class="note">太線＝草食（緑）と肉食（橙）の合計。細線＝種ごと（点線は肉食）。緑の帯＝島の草の量。</p>
          <table class="stats" id="pop-stats"></table>`;
      } else {
        const g = this.sheetSub;
        $('g-body').innerHTML = `
          <div class="seg" role="group">
            <button type="button" data-c="0" aria-pressed="${g.gcls === HERB}">🐇 草食</button>
            <button type="button" data-c="1" aria-pressed="${g.gcls === CARN}">🦊 肉食</button>
          </div>
          <div class="opts" role="group">${TRAIT_JA.map((n, i) => `<button type="button" data-t="${i}" aria-pressed="${i === g.gtrait}">${n}</button>`).join('')}</div>
          <canvas class="chart" id="cv-trend" aria-label="形質の平均の推移"></canvas>
          <canvas class="chart small" id="cv-hist" aria-label="いまの分布"></canvas>
          <p class="note" id="trait-note"></p>
          <table class="stats" id="trait-stats"></table>`;
        body.querySelectorAll('[data-c]').forEach((b) =>
          b.addEventListener('click', () => {
            this.sheetSub.gcls = +b.dataset.c;
            this.buildSheet();
          })
        );
        body.querySelectorAll('[data-t]').forEach((b) =>
          b.addEventListener('click', () => {
            this.sheetSub.gtrait = +b.dataset.t;
            this.buildSheet();
          })
        );
      }
    } else if (s === 'species') {
      title.textContent = '🧬 種とできごと';
      const sub = this.sheetSub.species;
      body.innerHTML = `
        <div class="seg" role="group">
          <button type="button" data-s="list" aria-pressed="${sub === 'list'}">種の一覧</button>
          <button type="button" data-s="log" aria-pressed="${sub === 'log'}">できごと</button>
        </div>
        <div id="s-body"></div>`;
      body.querySelectorAll('[data-s]').forEach((b) =>
        b.addEventListener('click', () => {
          this.sheetSub.species = b.dataset.s;
          this.buildSheet();
        })
      );
    } else if (s === 'goal') {
      title.textContent = this.app.sim.mission ? '🏆 ミッション' : '🏆 ミッション一覧';
      body.innerHTML = '<div id="goal-body"></div>';
    } else if (s === 'menu') {
      title.textContent = '☰ メニュー';
      this.buildMenu(body);
    } else if (s === 'creature') {
      this.cBtnsFor = null;
      body.innerHTML = '<div id="c-body"></div><canvas class="chart brain" id="cv-brain" aria-label="この個体の脳（ニューラルネット）"></canvas><p class="note">左の12個が入力（感じたこと）、まん中が中間の8個、右が5つの行動。青い線は「強める」、赤い線は「弱める」つながり。いちばん点数の高い行動（黄色）を選んで動きます。重みは親から受け継がれ、少しずつ突然変異します。</p><div class="row-btns" id="c-btns"></div>';
    }
    this.refreshSheet(true);
  }

  refreshSheet(first) {
    const s = this.sheet;
    if (!s) return;
    const sim = this.app.sim;
    if (s === 'graph') {
      if (this.sheetSub.graph === 'pop') {
        drawPopulation($('cv-pop'), sim);
        const living = sim.livingSpecies(1).sort((a, b) => b.n - a.n);
        $('pop-legend').innerHTML =
          `<span><i class="line-swatch" style="background:${HERB_COLOR}"></i>草食 ${sim.nCls[HERB]}</span><span><i class="line-swatch" style="background:${CARN_COLOR}"></i>肉食 ${sim.nCls[CARN]}</span>` +
          living.map((sp) => `<span><i class="dot" style="background:${spColor(sp)}"></i>${sp.name} ${sp.n}</span>`).join('');
        const d = sim.deaths;
        const r = sim.records;
        $('pop-stats').innerHTML = `
          <tr><td>草の量</td><td>${Math.round(sim.world.grassMean() * 100)}%</td></tr>
          <tr><td>木 / 木の実 / 亡きがら</td><td>${sim.world.trees.length}本 / ${sim.world.fruits.length}こ / ${sim.world.carcs.length}</td></tr>
          <tr><td>これまでの誕生</td><td>${sim.births}</td></tr>
          <tr><td>死因（捕食・餓死・寿命・凍え・暑さ）</td><td>${d.eaten || 0}・${d.starve || 0}・${d.age || 0}・${d.cold || 0}・${d.heat || 0}</td></tr>
          <tr><td>狩りの成功率</td><td>${r.atk ? Math.round((r.hit / r.atk) * 100) : 0}%（${r.hit}/${r.atk}）</td></tr>
          <tr><td>生まれた種の数（はじめの3種をふくむ）</td><td>${sim.species.length}</td></tr>`;
      } else {
        const { gcls, gtrait } = this.sheetSub;
        drawTraitTrend($('cv-trend'), sim, gcls, gtrait);
        drawHistogram($('cv-hist'), sim, gcls, gtrait);
        const ends = gtrait === TR.DIET ? `（0＝${DIET_ENDS[gcls][0]}、1＝${DIET_ENDS[gcls][1]}）` : '';
        $('trait-note').textContent = `線＝${CLS_JA[gcls]}動物の平均${ends}、帯＝ばらつき（標準偏差）。環境に合った値の個体が多く子を残すと、線が動きます。`;
        const row = (cls) => {
          const n = sim.nCls[cls];
          if (!n) return `<tr><td>${CLS_JA[cls]}</td><td colspan="6">いない</td></tr>`;
          const m = TRAIT_JA.map((_, i) => fmtTrait(i, sim.classMean(cls, i)));
          return `<tr><td>${cls ? '🦊' : '🐇'} ${n}匹</td>${m.map((v) => `<td>${v}</td>`).join('')}<td>${sim.maxGen(cls)}</td></tr>`;
        };
        $('trait-stats').innerHTML = `<thead><tr><th>平均</th>${TRAIT_JA.map((n) => `<th>${n}</th>`).join('')}<th>世代</th></tr></thead><tbody>${row(HERB)}${row(CARN)}</tbody>`;
      }
    } else if (s === 'species') {
      const box = $('s-body');
      if (this.sheetSub.species === 'list') {
        const living = sim.species.filter((sp) => sp.n > 0).sort((a, b) => b.n - a.n);
        const ext = sim.species.filter((sp) => sp.n === 0).reverse();
        const tr = (sp) => {
          const st = sim.speciesStats(sp.id);
          const m = st.mean || sp.founder;
          const parent = sp.parent >= 0 ? `祖先: ${sim.species[sp.parent].name}　` : 'はじめからいた種　';
          return `${parent}${st.n ? `第${st.gmin}〜${st.gmax}世代` : `${fmtDay(sp.born)}〜${sp.ext !== null ? fmtDay(sp.ext) : ''}`}<br>速さ ${m[0].toFixed(2)}・大きさ ${m[1].toFixed(2)}・視野 ${m[2].toFixed(1)}・食性 ${m[3].toFixed(2)}・耐寒 ${m[4].toFixed(2)}`;
        };
        const rowHtml = (sp) =>
          `<button type="button" class="sp-row${sp.n ? '' : ' ext'}" data-spid="${sp.id}"><span class="dot" style="background:${spColor(sp)}"></span><span class="nm">${sp.cls ? '🦊' : '🐇'} ${sp.name}</span><span class="ct">${sp.n ? `${sp.n}匹` : '絶滅'}</span><span class="tr">${tr(sp)}</span></button>`;
        if (first || this.lastSpKey !== sim.species.map((x) => x.n).join(',')) {
          this.lastSpKey = sim.species.map((x) => x.n).join(',');
          const open = box.querySelector('details')?.open;
          box.innerHTML =
            `<p class="note">種は、祖先（その種の最初の個体）から形質が大きく離れた子が生まれたときに分かれます。タップでその種の1匹を追いかけます。</p>` +
            living.map(rowHtml).join('') +
            (ext.length ? `<details${open ? ' open' : ''}><summary>絶滅した種（${ext.length}）</summary>${ext.slice(0, 40).map(rowHtml).join('')}</details>` : '');
          box.querySelectorAll('[data-spid]').forEach((b) =>
            b.addEventListener('click', () => {
              const id = +b.dataset.spid;
              const members = sim.creatures.filter((c) => c.alive && c.sp === id);
              if (!members.length) {
                this.toast('この種はもう島にいません');
                return;
              }
              this.select(members[Math.floor(Math.random() * members.length)]);
            })
          );
        }
      } else {
        box.innerHTML = `<ul class="log">${sim.log
          .slice()
          .reverse()
          .map((e) => `<li><time>${fmtDay(e.t)}</time>${e.text}</li>`)
          .join('')}</ul>`;
      }
    } else if (s === 'goal') {
      this.renderGoal(first);
    } else if (s === 'creature') {
      this.renderCreature();
    }
  }

  renderGoal(first) {
    const sim = this.app.sim;
    const box = $('goal-body');
    const m = sim.mission;
    if (m) {
      const def = missionById(m.id);
      const left = def.limitDays ? Math.max(0, def.limitDays - (sim.world.time - m.start) / DAY_LEN) : null;
      box.innerHTML = `
        <p style="font-size:28px;margin:0">${def.icon}</p>
        <h3 style="margin-top:0;color:var(--gold);font-size:17px">${def.title}</h3>
        <p><b>目標:</b> ${def.goal}</p>
        <div class="meter" style="height:10px"><i style="width:${Math.round((m.progress || 0) * 100)}%"></i></div>
        <p class="note">${m.status === 'play' ? m.text || '' : m.status === 'clear' ? '達成しました！' : `失敗: ${m.reason}`}${left !== null && m.status === 'play' ? `　残り ${left.toFixed(1)} 日` : ''}</p>
        <p class="note">💡 ${def.hint}</p>
        <p class="note">✨ 神の力: 道具を使うと減り、毎秒${sim.god.regen}ずつ回復します（最大${sim.god.max}）。</p>
        <div class="row-btns">
          <button type="button" class="btn btn-outline btn-sm" id="g-retry">はじめからやり直す</button>
          <button type="button" class="btn btn-text btn-sm" id="g-list">ミッション一覧</button>
        </div>`;
      $('g-retry').addEventListener('click', () => this.confirm('このミッションを最初からやり直しますか？', () => this.app.startMission(m.id)));
      $('g-list').addEventListener('click', () => this.missionList());
      return;
    }
    if (!first) return;
    box.innerHTML = this.missionCards() + `<p class="note">ミッションを始めると、いまの観察中の島は上書きされます。</p>`;
    this.bindMissionCards(box);
  }

  missionCards() {
    const clears = this.app.prefs.clears || {};
    return MISSIONS.map((d) => {
      const c = clears[d.id];
      return `<div class="mission-card"><span class="ic">${d.icon}</span><span class="tt">${d.title}</span><span class="st">${c ? `★ 達成（${c.day}日）` : d.limitDays ? `期限${d.limitDays}日` : ''}</span><span class="gl">${d.goal}</span><span></span><button type="button" class="btn btn-solid btn-sm" data-mission="${d.id}" style="grid-column:2/-1;justify-self:start">挑戦する</button></div>`;
    }).join('');
  }
  bindMissionCards(box) {
    box.querySelectorAll('[data-mission]').forEach((b) => b.addEventListener('click', () => this.confirmNew(() => this.app.startMission(b.dataset.mission))));
  }

  buildMenu(body) {
    const app = this.app;
    const v = app.view;
    const sim = app.sim;
    body.innerHTML = `
      <h3>生き物の色分け</h3>
      <div class="opts" id="m-color">${COLOR_MODES.map(([k, n]) => `<button type="button" data-v="${k}" aria-pressed="${v.colorMode === k}">${n}</button>`).join('')}</div>
      <p class="note">形質で色分けすると、自然選択で値がそろっていく様子が島の上で見えます。</p>
      <h3>ドットの大きさ</h3>
      <div class="opts" id="m-pixel">${[
        [1.5, '細かい'],
        [2, 'ふつう'],
        [3, '粗い'],
      ]
        .map(([k, n]) => `<button type="button" data-v="${k}" aria-pressed="${v.pixel === k}">${n}</button>`)
        .join('')}</div>
      <h3>影</h3>
      <div class="opts" id="m-shadow"><button type="button" data-v="1" aria-pressed="${v.shadows}">あり</button><button type="button" data-v="0" aria-pressed="${!v.shadows}">なし（動作が軽い）</button></div>
      ${
        sim.mode === 'sandbox'
          ? `<h3>突然変異の強さ</h3>
      <div class="opts" id="m-mut">${[
        [0.5, '弱い'],
        [1, 'ふつう'],
        [2, '強い'],
      ]
        .map(([k, n]) => `<button type="button" data-v="${k}" aria-pressed="${sim.mut === k}">${n}</button>`)
        .join('')}</div>`
          : ''
      }
      <h3>記録</h3>
      <p class="note">島の様子はこの端末の中に自動で保存されます（約20秒ごと、アプリを閉じたとき）。</p>
      <div class="row-btns">
        <button type="button" class="btn btn-outline btn-sm" id="m-save">いま保存する</button>
        <button type="button" class="btn btn-outline btn-sm" id="m-help">あそびかた</button>
        <button type="button" class="btn btn-outline btn-sm" id="m-title">タイトルへ</button>
        <button type="button" class="btn btn-danger btn-sm" id="m-new">新しい島にする</button>
      </div>`;
    const group = (id, fn) =>
      body.querySelectorAll(`#${id} [data-v]`).forEach((b) =>
        b.addEventListener('click', () => {
          fn(b.dataset.v);
          body.querySelectorAll(`#${id} [data-v]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          app.savePrefs();
          this.hudAcc = 1;
        })
      );
    group('m-color', (val) => {
      v.colorMode = val;
      app.prefs.colorMode = val;
    });
    group('m-pixel', (val) => {
      v.setPixel(+val);
      app.prefs.pixel = +val;
    });
    group('m-shadow', (val) => {
      v.setShadows(val === '1');
      app.prefs.shadows = val === '1';
    });
    if (sim.mode === 'sandbox') group('m-mut', (val) => (sim.mut = +val));
    $('m-save').addEventListener('click', () => this.toast(app.save() ? '💾 保存しました' : '保存できませんでした（ブラウザの設定を確認してください）'));
    $('m-help').addEventListener('click', () => this.help());
    $('m-title').addEventListener('click', () => app.toTitle());
    $('m-new').addEventListener('click', () => this.confirm('いまの島を消して、新しい島で観察を始めますか？', () => app.newSandbox()));
  }

  renderCreature() {
    const c = this.app.view.selected;
    const box = $('c-body');
    if (!box) return;
    const sim = this.app.sim;
    if (!c) {
      this.closeSheet();
      return;
    }
    const sp = sim.species[c.sp];
    $('sheet-title').innerHTML = `<span class="dot" style="background:${spColor(sp)}"></span> ${c.cls ? '🦊' : '🐇'} ${sp.name} <small style="color:var(--sub);font-weight:400">#${c.id}</small>`;
    if (!c.alive) {
      box.innerHTML = `<p>この個体は一生を終えました（${DEATH_JA[c.cause] || '不明'}）。子どもは ${c.kids} 匹残しました。</p>`;
      $('c-btns').innerHTML = '';
      drawBrain($('cv-brain'), c);
      return;
    }
    const mE = maxEnergy(c);
    const mat = maturityOf(c);
    const ageDays = (c.age / DAY_LEN).toFixed(1);
    const k = sim.world.cellIndex(c.x, c.z);
    const place = k >= 0 ? T_JA[sim.world.type[k]] : '';
    const traitRows = TRAIT_JA.map((n, i) => {
      const ends = i === TR.DIET ? DIET_ENDS[c.cls] : null;
      const label = ends ? `${n}（${ends[0]}⇄${ends[1]}）` : n;
      return `<tr><td>${label}</td><td><span class="bar"><i style="width:${Math.round(traitNorm(i, c.t[i]) * 100)}%;background:${c.cls ? CARN_COLOR : HERB_COLOR}"></i></span>${fmtTrait(i, c.t[i])}</td><td>${fmtTrait(i, TRAIT_MIN[i])}〜${fmtTrait(i, TRAIT_MAX[i])}</td></tr>`;
    }).join('');
    box.innerHTML = `
      <dl class="kv">
        <dt>いまの行動</dt><dd>${ACTION_ICON[c.act]} <b>${ACTION_JA[c.act]}</b>${c.tired ? '（息切れ）' : ''}${c.digest > 0 ? '（消化中）' : ''}　<span style="color:var(--sub)">${place}</span></dd>
        <dt>体力</dt><dd><span class="bar"><i style="width:${Math.round((c.e / mE) * 100)}%"></i></span>${Math.round(c.e)} / ${Math.round(mE)}</dd>
        <dt>世代・年齢</dt><dd>第${c.gen}世代・${ageDays}日（寿命 約${(c.life / DAY_LEN).toFixed(1)}日）${c.age < mat ? '・子ども' : ''}</dd>
        <dt>記録</dt><dd>子ども ${c.kids}匹${c.cls === CARN ? `・狩り ${c.kills}回` : ''}</dd>
        <dt>暑さ寒さ</dt><dd>${c.stress > 0.05 ? `つらい（${Math.round(c.stress * 100)}%）` : 'ちょうどよい'}</dd>
      </dl>
      <table class="traits">${traitRows}</table>`;
    if (!this.cBtnsFor || this.cBtnsFor !== c.id) {
      this.cBtnsFor = c.id;
      $('c-btns').innerHTML = `<button type="button" class="btn btn-outline btn-sm" id="c-follow"></button><button type="button" class="btn btn-text btn-sm" id="c-color">形質で色分け</button>`;
      $('c-follow').addEventListener('click', () => {
        this.app.view.follow = !this.app.view.follow;
        this.renderFollowBtn();
      });
      $('c-color').addEventListener('click', () => this.openSheet('menu'));
    }
    this.renderFollowBtn();
    drawBrain($('cv-brain'), c);
  }
  renderFollowBtn() {
    const b = $('c-follow');
    if (b) b.textContent = this.app.view.follow ? '📷 追いかけるのをやめる' : '📷 追いかける';
  }

  // ---------- 毎フレーム
  tick(dt) {
    if (!this.app.playing) return;
    this.hudAcc += dt;
    if (this.hudAcc >= 0.25) {
      this.hudAcc = 0;
      this.updateHUD();
    }
    this.sheetAcc += dt;
    const every = this.sheet === 'creature' ? 0.2 : this.sheet === 'graph' ? 1 : 0.6;
    if (this.sheet && this.sheetAcc >= every) {
      this.sheetAcc = 0;
      if (this.sheet === 'species' && this.sheetSub.species === 'log') {
        if (this.lastLogLen !== this.app.sim.log.length) {
          this.lastLogLen = this.app.sim.log.length;
          this.refreshSheet(false);
        }
      } else this.refreshSheet(false);
    }
    const sel = this.app.view.selected;
    if (sel && !sel.alive && !this.selDeadShown) {
      this.selDeadShown = true;
      this.toast(`選んでいた個体が一生を終えた（${DEATH_JA[sel.cause] || ''}）`);
      this.app.view.follow = false;
    }
  }

  onEvents(evs) {
    if (!this.app.playing) return;
    for (const e of evs) {
      if (e.type === 'log') this.toast(e.text, 3200);
    }
  }

  // ---------- お知らせ・ダイアログ
  toast(msg, ms = 2200) {
    if (!msg) return;
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  modal(html, buttons = [], dismissable = true) {
    const card = $('modal-card');
    card.innerHTML = html + `<div class="modal-actions">${buttons.map((b, i) => `<button type="button" class="btn ${b.cls || 'btn-solid'}" data-mb="${i}">${b.label}</button>`).join('')}</div>`;
    card.querySelectorAll('[data-mb]').forEach((el) =>
      el.addEventListener('click', () => {
        const b = buttons[+el.dataset.mb];
        if (b.keep !== true) this.closeModal();
        b.onClick?.();
      })
    );
    this.modalDismissable = dismissable;
    $('modal').hidden = false;
    card.querySelector('button')?.focus({ preventScroll: true });
  }
  closeModal() {
    $('modal').hidden = true;
  }

  confirm(text, ok) {
    this.modal(`<h2>確認</h2><p>${text}</p>`, [
      { label: 'はい', cls: 'btn-solid', onClick: ok },
      { label: 'やめる', cls: 'btn-outline' },
    ]);
  }

  confirmNew(start) {
    if (this.app.hasSave() && !this.app.playing) {
      this.confirm('保存されている島の記録は上書きされます。新しく始めますか？', start);
    } else if (this.app.playing) {
      this.confirm('いまの島の記録は上書きされます。新しく始めますか？', start);
    } else start();
  }

  missionList() {
    const html = `<h2>🏆 ミッション</h2><p>それぞれ違う島から始まります。神の力（✨）を上手に使って目標を達成しよう。</p><div id="ml-box">${this.missionCards()}</div>`;
    this.modal(html, [{ label: '閉じる', cls: 'btn-outline' }]);
    this.bindMissionCards($('ml-box'));
    $('ml-box').querySelectorAll('[data-mission]').forEach((b) => b.addEventListener('click', () => this.closeModal(), { capture: true }));
  }

  missionIntro(id) {
    const d = missionById(id);
    this.modal(
      `<p class="big">${d.icon}</p><h2>${d.title}</h2><p><b>目標:</b> ${d.goal}${d.limitDays ? `（期限 ${d.limitDays}日）` : ''}</p><p>💡 ${d.hint}</p><p class="note">道具は神の力（✨）を使います。上の「🏆」バーをタップすると、いつでも目標を確認できます。</p>`,
      [{ label: 'はじめる', cls: 'btn-solid' }]
    );
  }

  missionEnded(kind) {
    const sim = this.app.sim;
    const m = sim.mission;
    const d = missionById(m.id);
    this.updateHUD();
    if (kind === 'clear') {
      this.modal(
        `<p class="big">🏆</p><h2>ミッション達成！</h2><p><b>${d.title}</b> を ${m.endDay.toFixed(1)} 日で達成しました。</p><p class="note">${m.text || ''}</p>`,
        [
          { label: 'このまま島を観察する', cls: 'btn-solid', onClick: () => this.app.toSandbox() },
          { label: 'ほかのミッションを選ぶ', cls: 'btn-outline', onClick: () => this.missionList() },
        ],
        false
      );
    } else {
      this.modal(
        `<p class="big">🥀</p><h2>ミッション失敗</h2><p>${m.reason}</p><p class="note">💡 ${d.hint}</p>`,
        [
          { label: 'もう一度挑戦', cls: 'btn-solid', onClick: () => this.app.startMission(m.id) },
          { label: 'このまま島を観察する', cls: 'btn-outline', onClick: () => this.app.toSandbox() },
          { label: 'ほかのミッションを選ぶ', cls: 'btn-text', onClick: () => this.missionList() },
        ],
        false
      );
    }
  }

  help() {
    this.modal(
      `<h2>あそびかた</h2>
      <p><b>操作</b></p>
      <ul>
        <li>1本指でドラッグ … 島を回す</li>
        <li>2本指でつまむ・広げる … ズーム、2本指でドラッグ … 移動</li>
        <li>タップ … 下の道具を使う（「観察」なら生き物を選ぶ）</li>
        <li>右上 ⏸ 1x 2x 4x … 時間の速さ</li>
      </ul>
      <p><b>島のしくみ</b></p>
      <ul>
        <li>草と木の実 → 草食動物（🐇）→ 肉食動物（🦊）の食物連鎖。亡きがらは肉食が食べ、土の養分にもなる。</li>
        <li>生き物はみんな自分の小さな脳（自作のニューラルネット：12入力→8→5行動）で、うろうろ・食べる・逃げる・繁殖・休むを選ぶ。</li>
        <li>子は親の形質（速さ・大きさ・視野・食性・耐寒性）と脳の重みを受け継ぎ、少しだけ突然変異する。</li>
        <li>速い個体は逃げきり、寒さに強い個体は寒波でも子を作れる。こうして島に合った形質が残る（自然選択）。</li>
        <li>祖先から形質が大きく離れた系統は、新しい種として名前がつく。</li>
        <li>速く走るほど、体が大きいほど、視野が広いほどエネルギーを使う。何事も一長一短。</li>
      </ul>
      <p><b>神さまの手</b></p>
      <ul>
        <li>🌱 草 ・ 🍎 木の実 ・ 🌳 木 ・ 🐇 草食 ・ 🦊 肉食 … 島をタップして使う</li>
        <li>🌧️ 雨（草がよく育つ）・ 🔥 熱波 ・ ❄️ 寒波 … ボタンを押すとすぐ起こる</li>
        <li>ミッションでは神の力（✨）を使う。観察モード（サンドボックス）では使い放題。</li>
      </ul>
      <p><b>見かた</b></p>
      <ul>
        <li>📈 グラフ … 個体数と、形質の平均・ばらつき・分布の変化</li>
        <li>🧬 種 … いま生きている種と、絶滅した種、できごとの記録</li>
        <li>選んだ個体の黄色い輪 … 視野。線 … いま向かっている相手</li>
      </ul>`,
      [{ label: 'わかった', cls: 'btn-solid' }]
    );
  }
}

