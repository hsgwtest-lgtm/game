// 門番の目: 画面の切り替えと遊びの流れ
import { Stage3D } from './gfx/scene.js';
import { STAGES, CHAPTERS } from './game/stages.js';
import { FEATS, ruleText, hornCount } from './game/rules.js';
import { buildLevel, trainSet, fitLevel, accuracy, starsFor, compareAll } from './game/level.js';
import { METHODS, METHOD_ORDER, decide, initNN, trainNN, nnModel, NN_STEPS } from './ml/models.js';
import { dailyDef, nightDef, todayKey, dailyScore } from './game/gen.js';
import { save } from './game/save.js';
import { drawMap, axisCaption, axisPairs } from './ui/map.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a) => Math.round(a * 100) + '%';
const NIGHT_LIVES = 8;

const stage = new Stage3D($('gl'));
const G = { phase: 'home', def: null, level: null, picks: [], method: 'linear', params: {}, lenses: [], model: null, nn: null, focus: -1, axis: 0, ctx: null };

// ───────── お知らせ・モーダル
let toastTimer = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200); }
function modal(html, handlers = {}) {
  const m = $('modal');
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  m.onclick = (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const fn = handlers[b.dataset.act]; if (fn) fn(b);
  };
  const first = m.querySelector('button'); if (first) first.focus({ preventScroll: true });
}
function closeModal() { $('modal').hidden = true; $('modal').innerHTML = ''; }
const starHtml = (n) => `<span class="stars" aria-label="星${n}つ">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;

// ───────── ホーム
function renderHome() {
  G.phase = 'home';
  $('play').hidden = true; $('home').hidden = false;
  const d = save.data, next = save.nextStage(), unlocked = save.unlocked();
  const allDone = STAGES.every((s) => save.cleared(s.id));
  const dailyOpen = save.cleared(5), nightOpen = save.cleared(11);
  const key = todayKey(), today = d.daily[key];
  let h = `<h1>門番の目</h1><p class="lead">見本を見せて教える。手法を変えると、同じ見本から別の脳が育つ。</p>
  <div class="hero"><p>${allDone ? '<b>全30の門を合格</b><br>★3と手法スタンプを集めよう。' : `<b>つぎの門: ${next + 1}. ${esc(STAGES[next].name)}</b><br>${esc(CHAPTERS[STAGES[next].chapter].name)}`}</p>
    <button class="btn btn-solid btn-block" data-stage="${next}">${d.plays ? 'つづきから' : 'はじめる'}</button></div>
  <div class="modes">
    <button class="mode" data-mode="daily" ${dailyOpen ? '' : 'disabled'}><b>日替わりの門</b><span>毎日1つ、ルールは秘密。</span><em>${dailyOpen ? (today ? `今日 ${today.score}点` : '今日はまだ') + (d.streak > 1 ? `・${d.streak}日連続` : '') : '6番の門を合格すると開く'}</em></button>
    <button class="mode" data-mode="night" ${nightOpen ? '' : 'disabled'}><b>夜勤</b><span>手札2枚で、どこまで守れるか。</span><em>${nightOpen ? (d.nightBest ? `最高 ${d.nightBest}点（${d.nightBestWave}門）` : '記録なし') : '12番の門を合格すると開く'}</em></button>
  </div>`;
  CHAPTERS.forEach((c, ci) => {
    h += `<h2>${esc(c.name)}<small>${esc(c.sub)}</small></h2><div class="stages">`;
    for (const s of STAGES.filter((x) => x.chapter === ci)) {
      const st = save.stars(s.id), open = save.open(s.id);
      h += `<button class="stage${s.boss ? ' boss' : ''}${s.id === next && !allDone ? ' next' : ''}" data-stage="${s.id}" ${open ? '' : 'disabled'} aria-label="${s.id + 1}番 ${esc(s.name)} 星${st}">${s.id + 1}<i>${'★'.repeat(st)}</i></button>`;
    }
    h += '</div>';
  });
  h += '<h2>手法の図鑑</h2><div class="book">';
  for (const m of METHOD_ORDER) {
    const on = unlocked.includes(m);
    const from = STAGES.find((s) => s.reward === m);
    h += `<article class="${on ? '' : 'locked'}"><h3>${on ? esc(METHODS[m].full) : '？？？'}</h3><p>${on ? esc(METHODS[m].blurb) : `${from.id + 1}番の門を合格するともらえる`}</p></article>`;
  }
  h += `</div><h2>記録</h2><dl class="stats">
    <div><dt>星</dt><dd>${save.totalStars()} / ${STAGES.length * 3}</dd></div>
    <div><dt>手法スタンプ</dt><dd>${save.stampCount()} / ${save.stampTotal()}</dd></div>
    <div><dt>日替わり連続</dt><dd>${d.streak || 0} 日</dd></div>
    <div><dt>夜勤の最高</dt><dd>${d.nightBest || 0} 点</dd></div></dl>
  <div class="foot"><button class="btn btn-outline" data-mode="how">あそびかた</button><button class="btn-text" data-mode="reset">記録を消す</button></div>`;
  $('home').innerHTML = h;
}
$('home').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.stage !== undefined) startStage(+b.dataset.stage);
  else if (b.dataset.mode === 'daily') startPlay(dailyDef(todayKey(), save.unlocked()), { mode: 'daily' });
  else if (b.dataset.mode === 'night') startNight();
  else if (b.dataset.mode === 'how') showHow();
  else if (b.dataset.mode === 'reset') {
    modal('<h2>記録を消しますか？</h2><p>星・スタンプ・手法のカードがすべて最初にもどります。</p><div class="btns"><button class="btn btn-outline" data-act="no">やめる</button><button class="btn btn-solid" data-act="yes">消す</button></div>',
      { no: closeModal, yes: () => { save.reset(); closeModal(); renderHome(); } });
  }
});

function showHow(then) {
  modal(`<h2>あそびかた</h2><div class="how"><ol>
    <li>列の訪問者をタップして<b>見本</b>にする。頭の上の札が答え（<b style="color:var(--pass-ink)">○ 通す</b>／<b style="color:var(--stop-ink)">× 止める</b>）。</li>
    <li>門番は見本だけを見て学ぶ。足もとの輪が、門番のいまの答え。札と食いちがう相手には黄色い「？」がつく。</li>
    <li><b>手法</b>と<b>レンズ</b>（門番が見る特徴）を選ぶ。同じ見本でも、手法で脳の形が変わる。</li>
    <li><b>本番へ</b>。はじめて見る訪問者を、門番がひとりで仕分ける。</li></ol>
    <h3>画面の見かた</h3>
    <p><b>門番の目</b>（右上）は門番から見えている相手。目からレンズへ、レンズから頭上の脳へ線が生える。</p>
    <p><b>頭の中の地図</b>（左上）はレンズ2つぶんの塗り分け。タップで組み合わせが変わる。</p>
    <div class="legend"><span><i style="background:var(--stop)"></i>止めるほうへ押す線</span><span><i style="background:var(--pass)"></i>通すほうへ押す線</span></div>
    <h3>星</h3><p>★ 合格　★★ 正解率90%以上　★★★ それを少ない見本で</p></div>
    <div class="btns"><button class="btn btn-solid" data-act="ok">わかった</button></div>`,
  { ok: () => { closeModal(); save.mark('seenHow'); if (then) then(); } });
}

// ───────── 出題の開始
function startStage(id) { startPlay(STAGES[id], { mode: 'campaign' }); }
function startNight() {
  startPlay(nightDef(Date.now() % 1e9, 1, save.unlocked()), { mode: 'night', seed: Date.now() % 1e9, wave: 1, lives: NIGHT_LIVES, score: 0 });
}
function startPlay(def, ctx, { intro = true } = {}) {
  G.def = def; G.ctx = ctx; G.level = buildLevel(def);
  G.picks = []; G.focus = -1; G.axis = 0; G.nn = null; G.model = null;
  G.lenses = def.lenses.slice();
  if (!def.cards.includes(G.method)) G.method = def.cards[def.cards.length - 1];
  if (ctx.mode === 'campaign' && def.cards.length > 1 && intro) G.method = def.cards[def.cards.length - 1];
  $('home').hidden = true; $('play').hidden = false; closeModal();
  $('sheet-teach').hidden = false; $('sheet-run').hidden = true;
  G.phase = 'teach';
  $('hud-name').textContent = ctx.mode === 'campaign' ? `${def.id + 1}. ${def.name}` : def.name + (ctx.mode === 'night' ? `　♥${ctx.lives}` : '');
  $('hud-hint').textContent = def.hint || 'ルールは秘密。列の ○× から見抜こう';
  layout();
  stage.endRun(); stage.setPool(G.level.pool);
  renderCards(); renderLens(); retrain();
  if (!save.data.seenHow) showHow(() => intro && showIntro());
  else if (intro) showIntro();
}
function showIntro() {
  const d = G.def, c = G.ctx;
  const cards = d.cards.map((m) => METHODS[m].name).join('・');
  let h = `<h2>${esc($('hud-name').textContent)}</h2><p><b>${esc(d.hint || 'ルールは秘密。列の ○× から見抜こう')}</b></p>`;
  if (d.lesson) h += `<div class="note-box">${esc(d.lesson)}</div>`;
  h += `<p>手札: ${esc(cards)}<br>見本にできる数: ${d.budget}体（列は${d.pool}体）`;
  if (c.mode === 'night') h += `<br>本番は10体。ミス1つで♥が1つ減る（のこり♥${c.lives}）。全問正解で♥が1つもどる。`;
  else h += `<br>合格: 本番${G.level.test.length}体で正解率${pct(d.pass)}以上`;
  if (c.mode === 'campaign') h += `<br>★★: ${pct(d.s2)}以上　★★★: それを見本${d.par}体以下で`;
  if (c.mode === 'daily') h += '<br>点数: 正解率×1000＋のこした見本×25';
  h += '</p><div class="btns"><button class="btn btn-solid" data-act="go">はじめる</button></div>';
  modal(h, { go: closeModal });
}

// ───────── 教える画面
function renderCards() {
  const d = G.def;
  $('cards').innerHTML = d.cards.map((m) => `<button class="card${save.data.seenCards[m] ? '' : ' new'}" role="radio" aria-checked="${m === G.method}" data-m="${m}">${METHODS[m].name}</button>`).join('');
  const M = METHODS[G.method];
  let h = '';
  if (M.dial) {
    const cur = G.params[G.method] ?? M.dial.def;
    h += `<span class="lab">${M.dial.label}</span><div class="seg">${M.dial.values.map((v) => `<button aria-pressed="${v === cur}" data-v="${v}">${v}</button>`).join('')}</div>`;
  }
  h += `<span class="note">${M.short}</span><button class="btn-icon" data-info="1" aria-label="${M.name}の説明">？</button>`;
  $('dial').innerHTML = h;
}
$('cards').addEventListener('click', (e) => {
  const b = e.target.closest('.card'); if (!b) return;
  G.method = b.dataset.m; save.markCard(G.method); renderCards(); retrain();
});
$('dial').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.info) { showMethodInfo(); return; }
  G.params[G.method] = +b.dataset.v; renderCards(); retrain();
});
const READ = {
  linear: 'レンズから出力へ線が1本ずつ。太いほど重みが大きい。赤むらさきは「止める」へ、緑は「通す」へ押す。',
  tree: '四角が質問、丸が答え。いま見ている相手がたどる道が青く光る。質問はレンズへ線でつながっている。',
  knn: '頭上の丸は覚えた見本。いま見ている相手にいちばん似た k 体へ青い線が伸び、その答えで決まる。',
  nn: 'レンズ → 中間の丸 → 出力。学習中は線の太さが動く。中間の丸は、いまの相手にどれだけ反応したかで光る。',
  forest: '三角が木1本。いまの相手に「止める」と言った木は赤むらさき、「通す」は緑。多いほうで決まる。',
};
function showMethodInfo() {
  const M = METHODS[G.method];
  modal(`<h2>${esc(M.full)}</h2><p>${esc(M.blurb)}</p><h3>脳の読みかた</h3><p>${READ[G.method]}</p>${M.dial ? `<h3>つまみ「${esc(M.dial.label)}」</h3><p>${DIALS[G.method]}</p>` : ''}<div class="btns"><button class="btn btn-solid" data-act="ok">とじる</button></div>`, { ok: closeModal });
}
const DIALS = {
  tree: '質問を何段まで重ねるか。深いほど細かく切れるが、見本の偶然まで覚えてしまう。',
  knn: '似ている見本を何体まで聞くか。1体だと、まちがった見本もそのまま信じる。増やすと多数決になるが、小さな飛び地は消える。',
  nn: '中間の丸の数。多いほど複雑な形を作れるが、見本が少ないと形が暴れる。',
  forest: '木の本数。多いほど多数決が安定する。',
};
function renderLens() {
  const d = G.def;
  $('lens').innerHTML = '<b>レンズ</b>' + d.lenses.map((f) => `<button aria-pressed="${G.lenses.includes(f)}" data-f="${f}">${FEATS[f].name}</button>`).join('');
}
$('lens').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const f = +b.dataset.f;
  if (G.lenses.includes(f)) { if (G.lenses.length === 1) { toast('レンズは1つ以上必要'); return; } G.lenses = G.lenses.filter((x) => x !== f); }
  else G.lenses = [...G.lenses, f].sort((a, b2) => a - b2);
  G.axis = 0; renderLens(); retrain();
});
$('btn-clear').addEventListener('click', () => { if (!G.picks.length) return; G.picks = []; retrain(); });
$('map-box').addEventListener('click', () => { G.axis++; refreshView(); });
$('btn-back').addEventListener('click', () => {
  if (G.ctx.mode === 'night' && G.ctx.wave > 1) {
    modal('<h2>夜勤をやめますか？</h2><p>ここまでの点数で記録します。</p><div class="btns"><button class="btn btn-outline" data-act="no">つづける</button><button class="btn btn-solid" data-act="yes">やめる</button></div>',
      { no: closeModal, yes: () => { save.recordNight(G.ctx.score, G.ctx.wave - 1); closeModal(); stage.endRun(); renderHome(); } });
  } else { stage.endRun(); renderHome(); }
});

// タップで見本にする／外す
let down = null;
$('gl').addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
$('gl').addEventListener('pointerup', (e) => {
  if (!down || G.phase !== 'teach') return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) return;
  const i = stage.pickAt(e.clientX, e.clientY);
  if (i < 0) { G.focus = -1; stage.focusPool(-1); refreshView(); return; }
  G.focus = i;
  if (G.picks.includes(i)) G.picks = G.picks.filter((k) => k !== i);
  else if (G.picks.length >= G.def.budget) { toast(`見本は${G.def.budget}体まで。外すにはもう一度タップ`); stage.focusPool(i); refreshView(); return; }
  else G.picks = [...G.picks, i];
  retrain();
});

// 見本・手法・レンズが変わるたびに学び直す
function retrain() {
  const { level } = G;
  const feats = G.lenses.slice();
  const param = G.params[G.method] ?? (METHODS[G.method].dial ? METHODS[G.method].dial.def : null);
  const { X, y } = trainSet(level, G.picks);
  const examples = G.picks.map((i) => ({ x: level.pool[i].x, y: level.pool[i].badge }));
  G.nn = null;
  const mixed = y.length > 1 && y.some((v) => v !== y[0]);
  if (G.method === 'nn' && mixed) {
    // ニューラルネットだけは、少しずつ学ぶ様子を見せる（最後は fit と同じ結果になる）
    const m = initNN(feats, param, level.seed);
    G.nn = { m, X, y, left: NN_STEPS };
    G.model = nnModel(m, false);
  } else {
    G.model = fitLevel(level, G.picks, G.method, param, feats);
  }
  stage.setLenses(G.def.lenses, G.lenses);
  stage.setBrain(G.model, examples);
  stage.focusPool(G.focus);
  refreshView();
}
function stepNN(dt) {
  const j = G.nn; if (!j) return;
  const n = Math.min(j.left, Math.max(4, Math.round(dt * 600))); // 全部でおよそ1.2秒
  trainNN(j.m, j.X, j.y, n); j.left -= n;
  if (j.left <= 0) { G.model = nnModel(j.m, true); G.nn = null; }
  stage.brain.refresh();
  refreshView();
}
function finishNN() { const j = G.nn; if (!j) return; trainNN(j.m, j.X, j.y, j.left); G.model = nnModel(j.m, true); G.nn = null; stage.brain.refresh(); refreshView(); }

function refreshView() {
  const { level, def } = G;
  const has = G.picks.length > 0;
  const preds = has ? level.pool.map((c) => decide(G.model, c.x)) : null;
  stage.setPoolState(G.picks, preds);
  $('hud-count').textContent = `${G.picks.length}/${def.budget}`;
  $('hud-count').parentElement.classList.toggle('full', G.picks.length >= def.budget);
  const ok = has ? level.pool.filter((c, i) => preds[i] === c.badge).length : 0;
  $('pool-acc').textContent = has ? `${ok}/${level.pool.length}` + (G.nn ? ' …' : '') : '–';
  $('btn-run').disabled = !has;
  $('btn-clear').disabled = !has;
  const pairs = axisPairs(G.lenses);
  const axes = pairs[G.axis % pairs.length];
  const fx = G.focus >= 0 ? level.pool[G.focus].x : (stage.focusX || null);
  drawMap($('map'), { model: has ? G.model : null, pool: G.phase === 'teach' ? level.pool : [], picks: G.picks, axes, focus: fx });
  $('map-cap').textContent = axisCaption(axes);
  const chip = $('chip');
  if (G.phase === 'teach' && G.focus >= 0) {
    const c = level.pool[G.focus];
    const lab = (v) => (v ? '<span class="s">× 止める</span>' : '<span class="p">○ 通す</span>');
    let t = `札 ${lab(c.badge)}`;
    if (has) { const p = G.model.predict(c.x); const dec = p >= 0.5 ? 1 : 0; t += `<br>門番 ${lab(dec)}${dec !== c.badge ? '<span class="w">？</span>' : ''}`; }
    chip.innerHTML = t; chip.hidden = false;
  } else chip.hidden = true;
}

// ───────── 本番
$('btn-run').addEventListener('click', () => {
  if (G.phase !== 'teach' || !G.picks.length) return;
  finishNN();
  G.phase = 'run';
  const test = G.level.test;
  G.runRes = { ok: 0, ng: 0 };
  $('sheet-teach').hidden = true; $('sheet-run').hidden = false; $('chip').hidden = true;
  $('dots').innerHTML = test.map(() => '<i></i>').join('');
  $('run-ok').textContent = '0'; $('run-ng').textContent = '0';
  $('btn-fast').textContent = '早送り'; G.fast = false;
  const dots = $('dots').children;
  stage.startRun(test, (x) => decide(G.model, x), {
    onJudge: (i, dec, truth) => {
      const ok = dec === truth; G.runRes[ok ? 'ok' : 'ng']++;
      dots[i].className = ok ? 'ok' : 'ng';
      $('run-ok').textContent = G.runRes.ok; $('run-ng').textContent = G.runRes.ng;
    },
    onDone: () => setTimeout(showResult, 250),
  });
  refreshView();
});
$('btn-fast').addEventListener('click', () => { G.fast = !G.fast; stage.setRunSpeed(G.fast ? 3 : 1); $('btn-fast').textContent = G.fast ? 'ふつうの速さ' : '早送り'; });
$('btn-skip').addEventListener('click', () => stage.skipRun());

function comparisonHtml() {
  const { level, def } = G;
  if (def.cards.length < 2) return '';
  const param = G.params[G.method] ?? null;
  const rows = compareAll(level, G.picks, G.lenses, def.cards, { method: G.method, param });
  return '<h3>同じ見本・同じレンズで、ほかの手法なら</h3><div class="cmp">' + rows.map((r) => {
    const dial = METHODS[r.method].dial;
    return `<div class="${r.method === G.method ? 'me' : ''}"><span>${METHODS[r.method].name}${dial ? `（${r.param ?? dial.def}）` : ''}</span><span class="bar"><i style="width:${Math.round(r.acc * 100)}%"></i></span><span>${pct(r.acc)}</span></div>`;
  }).join('') + '</div>';
}
function showResult() {
  if (G.phase !== 'run') return;
  G.phase = 'result';
  const { def, level, ctx } = G;
  const n = level.test.length, acc = G.runRes.ok / n, used = G.picks.length;
  const passed = acc + 1e-9 >= def.pass;
  const reveal = def.hint ? '' : `<div class="note-box">ルールは「${esc(ruleText(def.rule))}ものを止める」でした。</div>`;
  let h = '', handlers = {};
  const again = () => { closeModal(); backToTeach(); };
  const home = () => { closeModal(); stage.endRun(); renderHome(); };
  if (ctx.mode === 'campaign') {
    const stars = starsFor(def, acc, used);
    const before = save.unlocked();
    const rec = save.recordStage(def.id, { stars, acc, used, method: G.method });
    const gained = save.unlocked().filter((m) => !before.includes(m));
    h = `<h2>${passed ? '合格' : 'あと少し'}</h2>${starHtml(stars)}<p class="big">${pct(acc)}<small>${G.runRes.ok}/${n} 正解・見本${used}体</small></p>`;
    if (!passed) h += `<p>合格は${pct(def.pass)}以上。見本・手法・レンズを変えて、もう一度。</p>`;
    else if (stars === 1) h += `<p>★★は${pct(def.s2)}以上。</p>`;
    else if (stars === 2) h += `<p>★★★は、見本${def.par}体以下で${pct(def.s2)}以上。</p>`;
    if (rec.newStamp) h += `<div class="note-box">手法スタンプ: この門を「${METHODS[G.method].name}」で合格（${Object.keys(save.data.stamps[def.id]).length}/${def.cards.length}）</div>`;
    for (const m of gained) h += `<div class="note-box reward"><b>新しい手法「${esc(METHODS[m].full)}」</b><br>${esc(METHODS[m].blurb)}</div>`;
    if (rec.first && def.id === 5) h += '<div class="note-box reward"><b>「日替わりの門」が開いた</b></div>';
    if (rec.first && def.id === 11) h += '<div class="note-box reward"><b>「夜勤」が開いた</b></div>';
    h += reveal + comparisonHtml();
    const hasNext = passed && def.id + 1 < STAGES.length;
    h += `<div class="btns">${hasNext ? '<button class="btn btn-solid" data-act="next">つぎの門へ</button>' : ''}<button class="btn ${hasNext ? 'btn-outline' : 'btn-solid'}" data-act="again">見本を直してもう一度</button><button class="btn btn-outline" data-act="home">一覧へ</button></div>`;
    handlers = { next: () => startStage(def.id + 1), again, home };
  } else if (ctx.mode === 'daily') {
    const score = dailyScore(acc, used, def.budget);
    const better = save.recordDaily(def.daily, score, passed);
    h = `<h2>${passed ? '今日の門、合格' : '今日の門'}</h2><p class="big">${score}<small>点${better ? '・自己ベスト' : ''}</small></p><p>${pct(acc)}（${G.runRes.ok}/${n} 正解）・見本${used}体${save.data.streak > 1 && passed ? `・${save.data.streak}日連続` : ''}</p>`;
    h += reveal + comparisonHtml();
    h += '<div class="btns"><button class="btn btn-solid" data-act="again">見本を直してもう一度</button><button class="btn btn-outline" data-act="home">一覧へ</button></div>';
    handlers = { again, home };
  } else {
    const miss = G.runRes.ng;
    ctx.score += G.runRes.ok * 10 + (miss === 0 ? 20 : 0);
    ctx.lives = Math.min(NIGHT_LIVES, ctx.lives - miss + (miss === 0 ? 1 : 0));
    const over = ctx.lives <= 0;
    if (over) {
      const better = save.recordNight(ctx.score, ctx.wave);
      h = `<h2>夜勤おわり</h2><p class="big">${ctx.score}<small>点${better ? '・自己ベスト' : ''}</small></p><p>${ctx.wave}つめの門で♥がなくなった。</p>`;
      h += reveal + comparisonHtml() + '<div class="btns"><button class="btn btn-solid" data-act="retry">もう一度、夜勤へ</button><button class="btn btn-outline" data-act="home">一覧へ</button></div>';
      handlers = { retry: () => { closeModal(); startNight(); }, home };
    } else {
      h = `<h2>${ctx.wave}つめの門、通過</h2><p class="big">${G.runRes.ok}/${n}<small>正解・ミス${miss}</small></p><p>のこり ♥${ctx.lives}${miss === 0 ? '（全問正解で1つもどった）' : ''}　いま ${ctx.score}点</p>`;
      h += reveal + comparisonHtml() + '<div class="btns"><button class="btn btn-solid" data-act="next">つぎの門へ</button></div>';
      handlers = { next: () => { ctx.wave++; startPlay(nightDef(ctx.seed, ctx.wave, save.unlocked()), ctx); } };
    }
  }
  modal(h, handlers);
}
function backToTeach() {
  G.phase = 'teach';
  $('sheet-teach').hidden = false; $('sheet-run').hidden = true;
  stage.endRun(); stage.focusPool(G.focus); refreshView();
}

// ───────── 画面の大きさ・毎フレーム
function layout() {
  stage.resize();
  const r = $('eye-win').getBoundingClientRect(), c = $('gl').getBoundingClientRect();
  stage.setEyeRect(r.width ? { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height } : null);
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 300));

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.phase !== 'home') {
    if (G.nn && G.phase === 'teach') stepNN(dt);
    stage.update(dt);
    if (G.phase === 'run' && stage.focusX) refreshRunMap();
    stage.render();
  }
  requestAnimationFrame(frame);
}
let lastRunFocus = null;
function refreshRunMap() { if (stage.focusX !== lastRunFocus) { lastRunFocus = stage.focusX; refreshView(); } }

renderHome();
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// 開発用: ?s=7 で7番の門をすぐ開く
const q = new URLSearchParams(location.search);
if (q.has('s')) startStage(+q.get('s') - 1);
window.__monban = { G, stage, save, startStage, startPlay, retrain, finishNN, hornCount };
