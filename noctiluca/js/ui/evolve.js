// 進化の画面: 16 の並列世界で、16 通りの本能が同時に試される
import { $, $$, esc, pct } from './dom.js';
import { TrialSession } from '../game/session.js';
import { drawLearning } from './charts.js';
import { drawInstinct, drawBrain } from './brainviz.js';
import { newFindings } from '../game/observer.js';
import { SLOT_CENTER, SLOT_ELITE } from '../ml/evolve.js';

const SPEEDS = [1, 4, 16, 'max'];

export function createEvolve(app) {
  const el = $('#s-evolve');
  el.innerHTML = `
    <div class="hud">
      <button class="iconbtn" data-a="back" aria-label="もどる">‹</button>
      <div class="ttl"><div class="nm"></div><div class="gen"></div><div class="prog"><i></i></div></div>
      <div class="speed">${SPEEDS.map((s) => `<button data-s="${s}">${s === 'max' ? '最速' : s + '×'}</button>`).join('')}</div>
    </div>
    <div class="tiles"></div>
    <div class="panel">
      <div class="tabs">
        <button data-t="curve" class="on">学習曲線</button>
        <button data-t="instinct">本能のくせ</button>
        <button data-t="brain">脳</button>
        <button data-t="log">観測記録</button>
      </div>
      <div class="pane"><canvas></canvas><div class="log" hidden></div><div class="legend"></div></div>
      <div class="actions"><div class="note"></div><button class="btn primary" data-a="show">本番に挑戦</button></div>
    </div>`;
  const tilesEl = $('.tiles', el);
  const cv = $('.pane canvas', el);
  const logEl = $('.pane .log', el);
  const legend = $('.pane .legend', el);
  const note = $('.actions .note', el);
  const showBtn = $('[data-a=show]', el);
  const nmEl = $('.hud .nm', el);
  const genEl = $('.hud .gen', el);
  const progEl = $('.hud .prog i', el);

  let session = null;
  let evo = null;
  let sw = null;
  let tab = 'curve';
  let rects = [];
  let tiles = [];
  let focus = -1;
  let maxSteps = 24;
  let prevInstinct = null;
  let prevRow = null;
  let lastMetrics = null;
  let paused = false;
  let picks = new Set();

  let hold = 0; // 世代の終わりに少しだけ止めて、順位を見せる
  function speed() { return app.save.settings.speed ?? 4; }

  function setSpeed(s) {
    app.save.settings.speed = s;
    $$('.speed button', el).forEach((b) => b.classList.toggle('on', String(s) === b.dataset.s));
    app.persist();
  }

  function buildTiles() {
    tilesEl.innerHTML = '';
    tiles = [];
    for (let k = 0; k < 16; k++) {
      const t = document.createElement('div');
      t.className = 'tile' + (k === SLOT_CENTER ? ' center' : k === SLOT_ELITE ? ' elite' : '');
      t.innerHTML = `<span class="lb">${k === SLOT_CENTER ? 'いま' : k === SLOT_ELITE ? '最高' : ''}</span><span class="medal"></span><span class="bar"><i></i></span>`;
      t.dataset.k = k;
      tilesEl.appendChild(t);
      tiles.push(t);
    }
  }

  function layout() {
    const W = el.clientWidth, H = el.clientHeight;
    const hud = $('.hud', el).getBoundingClientRect();
    const panel = $('.panel', el).getBoundingClientRect();
    const top = hud.bottom + 4, bot = panel.top - 2;
    const gap = 5, pad = 8;
    const availW = W - pad * 2, availH = Math.max(80, bot - top);
    const tw = Math.min((availW - gap * 3) / 4, ((availH - gap * 3) / 4) / 1.5);
    const th = tw * 1.5;
    const mw = tw * 4 + gap * 3, mh = th * 4 + gap * 3;
    const x0 = (W - mw) / 2, y0 = top + (availH - mh) / 2;
    rects = [];
    for (let k = 0; k < 16; k++) {
      const r = { x: x0 + (k % 4) * (tw + gap), y: y0 + Math.floor(k / 4) * (th + gap), w: tw, h: th };
      rects.push(r);
      const t = tiles[k];
      if (t) Object.assign(t.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, display: focus >= 0 && focus !== k ? 'none' : '' });
    }
    if (focus >= 0 && tiles[focus]) {
      const fw = Math.min(mw, mh / 1.5), fh = fw * 1.5;
      const r = { x: (W - fw) / 2, y: y0 + (mh - fh) / 2, w: fw, h: fh };
      rects = rects.map((q, k) => (k === focus ? r : { x: 0, y: 0, w: 0, h: 0 }));
      Object.assign(tiles[focus].style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    }
    void H;
  }

  let lastHeader = '';
  function header() {
    const g = evo ? evo.gen : 0;
    const ep = evo && evo.episodeSteps ? Math.min(1, 1 - evo.stepsLeft / evo.episodeSteps) : 0;
    progEl.style.width = `${(ep * 100).toFixed(1)}%`;
    const hist = session.metricHist;
    const m = lastMetrics ? lastMetrics[SLOT_CENTER] : (hist && hist.length ? hist[hist.length - 1].c : null);
    const html = `第 <b>${g + 1}</b> 世代${m !== null ? `　いま ${esc(session.metricName)} <b>${pct(m)}</b>` : ''}`;
    if (html !== lastHeader) { genEl.innerHTML = html; lastHeader = html; nmEl.textContent = session.title; }
  }

  function addLog(html, cls = '') {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.innerHTML = html;
    logEl.prepend(p);
    while (logEl.children.length > 80) logEl.lastChild.remove();
  }

  function drawPane() {
    if (!evo) return;
    logEl.hidden = tab !== 'log';
    cv.style.display = tab === 'log' ? 'none' : '';
    legend.innerHTML = '';
    if (tab === 'curve') {
      legend.innerHTML = `<span><i style="background:#49c8ff"></i>いまの本能</span><span><i style="background:#f2c35b"></i>最高記録</span>`;
      drawLearning(cv, session.metricHist, { pass: session.pass, label: session.metricName });
    } else if (tab === 'instinct') {
      prevInstinct = drawInstinct(cv, evo.eliteRow(), session.layout, prevInstinct);
    } else if (tab === 'brain') {
      const r = evo.eliteRow();
      drawBrain(cv, r, session.layout, prevRow);
    }
  }

  function updateNote() {
    const hist = session.metricHist;
    if (session.kind === 'lab') {
      note.innerHTML = picks.size ? `${picks.size} つの世界を選びました。世代の終わりに、その本能へ近づきます` : 'すてきな世界をタップして選ぶと、その方向へ進化します（選ばなければ自動）';
      return;
    }
    if (!hist.length) { note.textContent = `★1 の線: ${session.metricName} ${pct(session.pass[0])}`; return; }
    const recent = hist.slice(-5);
    const avg = recent.reduce((a, r) => a + r.c, 0) / recent.length;
    const ready = avg >= session.pass[0] * 0.95;
    showBtn.classList.toggle('glow', ready);
    note.innerHTML = ready
      ? `★1 の線（${pct(session.pass[0])}）に届きそう。十万の群れで試そう`
      : `★1 の線: ${esc(session.metricName)} ${pct(session.pass[0])}<br>直近の平均 ${pct(avg)}`;
  }

  function onEnd(ev) {
    const res = session.onGeneration(ev);
    lastMetrics = res.metrics;
    const m = res.metrics;
    const n = m.length;
    // 順位
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => ev.fit[b] - ev.fit[a]);
    const mx = Math.max(...m, 1e-6);
    tiles.forEach((t, k) => {
      t.classList.remove('ranked', 'flash', 'picked');
      const bar = t.querySelector('.bar i');
      if (k < n) bar.style.width = `${Math.max(2, (m[k] / Math.max(mx, session.pass[2] || 1)) * 100)}%`;
      const rk = order.indexOf(k);
      const md = t.querySelector('.medal');
      md.textContent = rk < 3 ? `${rk + 1}` : '';
      if (rk < 3) { t.classList.add('ranked'); void t.offsetWidth; t.classList.add('flash'); }
    });
    picks.clear();
    // 記録
    const r = ev.rec;
    const hist = session.metricHist;
    const prevBest = hist.length > 1 ? Math.max(...hist.slice(0, -1).map((x) => x.e)) : 0;
    if (hist.length > 1 && m[SLOT_ELITE] > prevBest + 0.02 && session.kind !== 'lab') {
      addLog(`<b>第${r.gen + 1}世代</b>最高記録を更新: ${esc(session.metricName)} ${pct(m[SLOT_ELITE])}`);
    }
    if (r.restored) addLog(`<b>第${r.gen + 1}世代</b>いまの本能が迷走したので、最高記録の本能へ戻した`);
    // くせの発見
    const known = session.findings;
    const { found } = newFindings(evo.eliteRow(), session.layout, known);
    for (const f of found) {
      known.push(f.id);
      addLog(`<b>第${r.gen + 1}世代</b>${esc(f.text)}`, 'find');
      app.toast(`<b>発見</b> ${esc(f.text)}`, 4200);
    }
    if (!session.passNoted && session.kind !== 'lab') {
      const recent = hist.slice(-3);
      if (recent.length === 3 && recent.every((x) => x.c >= session.pass[0])) {
        session.passNoted = true;
        addLog(`<b>第${r.gen + 1}世代</b>いまの本能が ★1 の線をこえた。本番に挑戦できる`, 'find');
      }
    }
    drawPane();
    prevRow = evo.eliteRow();
    updateNote();
    app.persist();
    if (speed() !== 'max') hold = speed() === 1 ? 50 : 28;
  }

  function intro() {
    if (app.save.seenIntro.evolve) return;
    paused = true;
    const c = app.modal(`
      <div class="depth">はじめに</div>
      <h3>16の並列世界</h3>
      <p class="how" style="font-size:14px;color:#cfe6f7">16の世界は、同じ海・同じ生まれ方。ちがうのは本能だけです。左上の<b style="color:var(--noc)">「いま」</b>が平均の本能、となりの<b style="color:var(--plankton)">「最高」</b>がこれまでの最高記録、残りの14は少しずつ変えた変異体。</p>
      <p class="how" style="font-size:14px;color:#cfe6f7">1世代（10秒）が終わるたびに、よく生きのびた変異の向きへ「いま」が動きます。これをくり返すのが進化戦略という機械学習です。世界をタップすると大きく見られます。</p>
      <div class="row"><button class="btn primary" data-a="ok">見てみる</button></div>`, false);
    c.querySelector('[data-a=ok]').addEventListener('click', () => {
      app.save.seenIntro.evolve = true;
      app.persist();
      app.modal(null);
      paused = false;
    });
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a],[data-s],[data-t]');
    if (b) {
      if (b.dataset.a === 'back') { if (session.kind === 'lab') app.go('lab'); else app.go('map', { open: session.id }); return; }
      if (b.dataset.a === 'show') { app.go('show', session.showArg()); return; }
      if (b.dataset.s) { setSpeed(b.dataset.s === 'max' ? 'max' : +b.dataset.s); return; }
      if (b.dataset.t) {
        tab = b.dataset.t;
        $$('.tabs button', el).forEach((x) => x.classList.toggle('on', x === b));
        drawPane();
        return;
      }
    }
    const t = e.target.closest('.tile');
    if (t) {
      const k = +t.dataset.k;
      if (session.kind === 'lab') {
        if (picks.has(k)) picks.delete(k); else picks.add(k);
        t.classList.toggle('picked', picks.has(k));
        updateNote();
      } else {
        focus = focus === k ? -1 : k;
        layout();
      }
    }
  });

  return {
    el,
    enter(arg) {
      if (typeof arg === 'string') arg = { trial: arg };
      if (arg && arg.session) session = arg.session;
      else session = new TrialSession(app, (arg && arg.trial) || 'cradle');
      if (!session.title) session.title = session.trial ? `試練${session.trial.no}　${session.trial.name}` : 'ラボ';
      if (!session.showArg) session.showArg = () => ({ trial: session.id });
      sw = app.getSwarm('train');
      evo = session.attach(sw);
      if (session.kind === 'lab') {
        evo.fitnessOverride = (fit) => {
          if (!picks.size) return null;
          return fit.map((f, k) => (picks.has(k) ? 1000 + f : f * 0.001));
        };
      }
      evo.listeners.clear();
      evo.on((ev) => { if (ev.type === 'end') onEnd(ev); });
      evo.startGeneration();
      buildTiles();
      focus = -1;
      logEl.innerHTML = '';
      const hist = session.metricHist;
      if (hist.length) addLog(`<b>再開</b>第${hist[hist.length - 1].g + 1}世代までの続きから`);
      else addLog(`<b>はじまり</b>16の世界に、生まれたばかりの本能を入れた。左上の「いま」が平均の本能、「最高」がこれまでの最高記録、ほかの14は変異体`);
      lastMetrics = null;
      prevInstinct = null;
      prevRow = evo.eliteRow();
      setSpeed(speed());
      paused = false;
      hold = 0;
      requestAnimationFrame(() => { layout(); drawPane(); updateNote(); header(); intro(); });
    },
    leave() {
      app.persist(true);
    },
    frame(dt) {
      if (!evo) return;
      if (!rects.length) layout();
      if (hold > 0) hold--;
      else if (!paused) {
        const s = speed();
        let n;
        if (s === 'max') {
          if (dt > 45) maxSteps = Math.max(4, maxSteps * 0.8);
          else if (dt < 24) maxSteps = Math.min(240, maxSteps * 1.12 + 1);
          n = Math.round(maxSteps);
        } else n = s;
        let left = n;
        while (left > 0) {
          const k = Math.min(left, evo.stepsLeft > 0 ? evo.stepsLeft : left);
          const ended = evo.advance(k);
          left -= k;
          if (ended && s !== 'max') break; // 世代の終わりで止めて順位を見せる
        }
      }
      const R = app.R;
      R.clear();
      R.drawWorlds(sw, rects, { pointSize: focus >= 0 ? 1.5 : 1.1, ring: focus >= 0 ? 1 : 0.6, detail: focus >= 0 ? 1 : 0 });
      header();
    },
    resize: layout,
  };
}
