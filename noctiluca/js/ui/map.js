// 海の地図: 深海（下）から海面（上）へ
import { $, esc, starsHTML } from './dom.js';
import { TRIALS, SENSE_INFO, trialIndex } from '../game/story.js';
import { STAGE_DEFS } from '../sim/stages.js';
import { coverRect, ambientPick } from './title.js';
import { TrialSession } from '../game/session.js';

export function isUnlocked(app, id) {
  const i = trialIndex(id);
  if (i <= 0) return true;
  return (app.save.stars[TRIALS[i - 1].id] || 0) > 0 || app.save.unlocked.includes(id);
}

export function trialCard(app, tr) {
  const save = app.save;
  const st = save.trials[tr.id];
  const stars = save.stars[tr.id] || 0;
  const best = save.best[tr.id];
  const pills = tr.newSenses.map((s) => `<div class="pill">${SENSE_INFO[s].icon} ${esc(SENSE_INFO[s].name)}<small>${esc(SENSE_INFO[s].desc)}</small></div>`).join('');
  const gens = st && st.evo ? st.evo.gen : 0;
  return `
    <div class="depth">水深 ${tr.depth.toLocaleString()}m ・ 試練 ${tr.no}</div>
    <h3>${esc(tr.name)}</h3>
    <div class="goal">${esc(tr.goal)}</div>
    <div class="story">${tr.story.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
    ${pills ? `<h4>新しい感覚</h4><div class="new">${pills}</div>` : ''}
    <p class="how">${esc(tr.how)}</p>
    ${stars || best !== undefined ? `<div class="stars">${starsHTML(stars)}</div>` : ''}
    <div class="row">
      ${gens > 0 ? '<button class="btn ghost small" data-a="restart">本能を最初から</button>' : ''}
      ${st && st.champion && gens > 0 ? '<button class="btn" data-a="show">本番に挑戦</button>' : ''}
      <button class="btn primary" data-a="evolve">${gens > 0 ? `進化をつづける（${gens}世代）` : '進化をはじめる'}</button>
    </div>`;
}

export function openTrial(app, id) {
  const tr = TRIALS[trialIndex(id)];
  const card = app.modal(trialCard(app, tr));
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'evolve') app.go('evolve', { trial: id });
    if (a === 'show') app.go('show', { trial: id });
    if (a === 'restart') {
      if (b.dataset.sure) {
        new TrialSession(app, id).restart();
        app.toast('本能を生まれたときに戻しました');
        openTrial(app, id);
      } else {
        b.dataset.sure = '1';
        b.textContent = 'もう一度押すと消えます';
      }
    }
  });
}

export function createMap(app) {
  const el = $('#s-map');
  let sw = null;
  let t = 0;

  function build() {
    const save = app.save;
    const nodes = TRIALS.map((tr, i) => {
      const un = isUnlocked(app, tr.id);
      const stars = save.stars[tr.id] || 0;
      const nextOpen = un && !stars;
      return `<button class="node ${un ? '' : 'locked'} ${nextOpen ? 'current' : ''}" data-id="${tr.id}" data-i="${i}">
        <span class="dot"></span>
        <span class="tx"><span class="nm">${esc(tr.name)}</span><span class="gl">${un ? esc(tr.goal) : '前の試練で★をとると進める'}</span></span>
        <span class="st">${stars ? '★'.repeat(stars) : ''}</span>
      </button>`;
    }).join('');
    const senses = new Set();
    let hidden = 8;
    TRIALS.forEach((tr) => {
      if (isUnlocked(app, tr.id)) { tr.newSenses.forEach((s) => senses.add(s)); hidden = Math.max(hidden, STAGE_DEFS[tr.id].hidden); }
    });
    const organ = [...senses].map((s) => `<span class="sense" style="color:${SENSE_INFO[s].color}"><i>${SENSE_INFO[s].icon}</i>${esc(SENSE_INFO[s].name)}</span>`).join('');
    el.innerHTML = `
      <div class="top"><button class="iconbtn" data-a="back" aria-label="もどる">‹</button><h2>海の地図</h2></div>
      <div class="scale"></div>
      ${nodes}
      <div class="organs hit"><b>いまの体</b>${organ}<span>神経 ${hidden}</span></div>`;
    layout();
  }

  function layout() {
    const H = el.clientHeight || window.innerHeight;
    const scale = $('.scale', el);
    if (!scale) return;
    const r = scale.getBoundingClientRect();
    const top = r.top + 24, bot = r.bottom - 24;
    el.querySelectorAll('.tick').forEach((x) => x.remove());
    el.querySelectorAll('.node').forEach((n) => {
      const i = +n.dataset.i;
      const f = i / (TRIALS.length - 1);
      const y = bot - (bot - top) * f;
      n.style.top = `${y}px`;
      const tk = document.createElement('div');
      tk.className = 'tick';
      tk.style.top = `${y}px`;
      tk.style.left = '26px';
      tk.textContent = `${TRIALS[i].depth}m`;
      el.appendChild(tk);
    });
    void H;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a=back]');
    if (b) { app.go('title'); return; }
    const n = e.target.closest('.node');
    if (!n) return;
    const id = n.dataset.id;
    if (!isUnlocked(app, id)) { app.toast('ひとつ前の試練の本番で★をとると、ここへ進めます'); return; }
    openTrial(app, id);
  });

  return {
    el,
    enter(arg) {
      build();
      sw = app.getSwarm('show');
      const pick = ambientPick(app);
      const cfg = STAGE_DEFS[pick.id].make(777);
      sw.setStage(cfg); sw.setLayout(pick.layout); sw.setRows([pick.row]); sw.beaconPath = null; sw.reset(99);
      t = 0;
      if (arg && arg.open) setTimeout(() => openTrial(app, arg.open), 50);
      else if (!Object.keys(app.save.trials).length) setTimeout(() => openTrial(app, 'cradle'), 400);
    },
    leave() {},
    frame() {
      if (!sw) return;
      sw.step(1);
      if (++t > 1500) { sw.reset(99 + t); t = 0; }
      const R = app.R;
      R.clear();
      R.drawWorlds(sw, [coverRect(app.canvas.clientWidth, app.canvas.clientHeight)], { trails: true, pointSize: 1.1, bright: 0.3, fade: 0.86, ring: 0.3 });
    },
    resize: layout,
  };
}
