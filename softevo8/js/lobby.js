/* =====================================================================
   SoftEvo 8 — lobby.js
   🌐 オンライン道場の画面
   ・番付 (すもう / つなひき) … 公開された生物に挑戦、拍手、その相手で特訓
   ・かけっこ記録 … 見る人の端末で走らせ直した記録で並べる (ごまかせない)
   ・受信箱 … 自分の生物への挑戦状。まったく同じ取組を再生して、返信・リベンジ特訓
   ===================================================================== */
import { BATTLES, ARENA_MODES, DEFAULT_SETTINGS, evaluate, prepareFighter } from './sim.js';
import { drawThumb } from './world.js';
import * as online from './online.js';
import { $, $$, el, toast, confirmDialog } from './ui.js';

const RACE_ENV = { terrain: 'flat', objective: 'distance', gravity: 1, friction: DEFAULT_SETTINGS.friction, evalSeconds: DEFAULT_SETTINGS.evalSeconds };
const when = t => new Date(t).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 公開された生物 → 闘技場の出場者 */
export function onlineFighter(c) {
  return {
    cid: `online:${c.id}`, si: 0, src: 'online', mode: c.mode, onlineId: c.id, owner: c.owner, ownerId: c.ownerId,
    baseName: c.name, name: `${c.name}(${c.owner})`, bp: c.bp, hidden: c.hidden, hidden2: c.hidden2, obj: c.obj, g: c.g, gen: c.gen,
    settings: { ...DEFAULT_SETTINGS }, hue: 0, note: `🌐 ${c.owner} さんの生物${c.msg ? ` 「${c.msg}」` : ''}`,
  };
}

export class Lobby {
  constructor(hooks) {
    this.hooks = hooks;
    this.tab = 'sumo';
    this.data = null;
    this.error = null;
    this.raceDist = new Map();
    $('#online-home').addEventListener('click', () => hooks.onHome());
    $('#online-refresh').addEventListener('click', () => this.load());
    $('#online-name').addEventListener('click', () => this.askName());
    $$('#online-tabs button').forEach(b => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
  }

  enter() {
    this.renderName();
    this.setTab(this.tab);
    this.load();
  }

  renderName() {
    const p = online.profile();
    $('#online-name').textContent = p.name ? `👤 ${p.name}` : '👤 名前を決める';
  }

  async askName() {
    const v = prompt('オンラインで表示する名前 (16文字まで)', online.profile().name || '');
    if (v && v.trim()) { online.setName(v); this.renderName(); }
    return online.profile().name;
  }

  async load() {
    $('#online-body').innerHTML = '<p class="empty">読み込み中…</p>';
    try {
      this.data = await online.fetchAll();
      this.error = null;
      this.hooks.onData && this.hooks.onData(this.data);
    } catch (e) {
      this.error = e;
    }
    this.render();
  }

  setTab(tab) {
    this.tab = tab;
    $$('#online-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'inbox' && this.data) { online.markInboxSeen(Date.now()); this.hooks.onData && this.hooks.onData(this.data); }
    this.render();
  }

  unread() {
    if (!this.data) return 0;
    const me = online.profile().id, seen = online.inboxSeen();
    return this.data.bouts.filter(b => b.defOwnerId === me && b.created > seen).length;
  }

  render() {
    const body = $('#online-body');
    const badge = $('#online-tabs [data-tab="inbox"] .badge');
    const n = this.tab === 'inbox' ? 0 : this.unread();
    badge.textContent = n || ''; badge.classList.toggle('hidden', !n);
    if (this.error) return this.renderError(body);
    if (!this.data) return;
    body.innerHTML = '';
    if (this.tab === 'inbox') return this.renderInbox(body);
    this.renderBoard(body, this.tab);
  }

  renderError(body) {
    body.innerHTML = '';
    const e = this.error;
    const box = el('div', { class: 'on-error' }, el('h3', {}, e.kind === 'network' ? '📡 オフラインです' : '🔒 オンライン道場に接続できません'));
    if (e.kind === 'permission') {
      box.append(el('p', {}, 'データベース (softevo7 と同じ Firebase プロジェクト) が softevo8 の読み書きを許可していません。Firebase コンソール → Realtime Database → ルール に、次の1行を追加して「公開」してください。'),
        el('pre', {}, `{\n  "rules": {\n    "leaderboard": { ".read": true, ".write": true },\n    ${online.RULES_HINT}\n  }\n}`));
    } else box.append(el('p', {}, `${e.message}。電波の良いところで「↻」を押してください。`));
    body.append(box);
  }

  // ─── 番付 ───
  renderBoard(body, mode) {
    const M = ARENA_MODES[mode], me = online.profile().id;
    body.append(el('div', { class: 'on-intro' },
      el('p', {}, mode === 'race'
        ? '🏃 公開された生物の「平地12秒」の記録。記録はあなたの端末で走らせ直して測っています。'
        : `${M.icon} 公開された生物に挑戦できます。結果はひとことを添えて持ち主に届き、持ち主は同じ取組を再生して返信できます。`),
      el('button', { class: 'btn primary small', onclick: () => this.publishDialog(mode) }, `＋ 自分の生物を${M.name}に出す`)));
    let list = this.data.creatures.filter(c => c.mode === mode);
    if (!list.length) { body.append(el('p', { class: 'empty' }, `まだ${M.name}に出ている生物はいません。最初の1体になろう。`)); return; }
    const S = this.data.stats;
    if (mode === 'race') {
      this.measureRace(list);
      list = list.slice().sort((a, b) => (this.raceDist.get(b.id) ?? -1e9) - (this.raceDist.get(a.id) ?? -1e9));
    } else {
      const score = c => { const s = S[c.id] || {}; return ((s.w || 0) + 1) / ((s.w || 0) + (s.l || 0) + 2); };
      list = list.slice().sort((a, b) => score(b) - score(a) || (S[b.id]?.w || 0) - (S[a.id]?.w || 0) || b.created - a.created);
    }
    const grid = el('div', { class: 'on-grid' });
    list.forEach((c, i) => {
      const s = S[c.id] || { w: 0, l: 0, d: 0, cheers: 0 };
      const mine = c.ownerId === me;
      const cv = el('canvas', { class: 'on-thumb' });
      const rec = mode === 'race'
        ? (this.raceDist.has(c.id) ? `🏃 ${(this.raceDist.get(c.id) / 100).toFixed(2)} m` : '🏃 計測中…')
        : `${s.w}勝${s.l}敗${s.d ? s.d + '分' : ''}`;
      const cheerBtn = el('button', { class: 'btn ghost small', title: '拍手を送る', onclick: async () => {
        try { await online.cheer(c.id); s.cheers++; cheerBtn.textContent = `👏 ${s.cheers}`; } catch (e) { toast(e.message); }
      } }, `👏 ${s.cheers}`);
      grid.append(el('article', { class: `on-card${mine ? ' mine' : ''}` },
        el('span', { class: 'on-rank' }, `${i + 1}`), cv,
        el('div', { class: 'on-info' },
          el('b', {}, c.name),
          el('small', {}, `${mine ? 'あなた' : c.owner}${c.gen != null ? ` · 第${c.gen}世代` : ''} · ${when(c.created)}`),
          c.msg ? el('p', { class: 'on-msg' }, `「${c.msg}」`) : null,
          el('div', { class: 'on-rec' }, rec)),
        el('div', { class: 'on-actions' },
          mode === 'race'
            ? el('button', { class: 'btn primary small', onclick: () => this.hooks.onRace(onlineFighter(c)) }, '🏃 一緒に走る')
            : el('button', { class: 'btn primary small', disabled: mine, onclick: () => this.hooks.onChallenge(onlineFighter(c), mode) }, '⚔ 挑戦'),
          mode !== 'race' && !mine ? el('button', { class: 'btn ghost small', title: 'この生物を相手に特訓する', onclick: () => this.train(null, onlineFighter(c), mode) }, '🧬 特訓') : null,
          cheerBtn,
          mine ? el('button', { class: 'btn ghost small danger-text', onclick: () => this.withdraw(c) }, '取り下げ') : null)));
      requestAnimationFrame(() => drawThumb(cv, c.bp));
    });
    body.append(grid);
  }

  /** かけっこの記録を、この端末で走らせて測る (決定論なので誰が測っても同じ) */
  measureRace(list) {
    const todo = list.filter(c => !this.raceDist.has(c.id));
    if (!todo.length || this.measuring) return;
    this.measuring = true;
    const step = () => {
      const t0 = performance.now();
      while (todo.length && performance.now() - t0 < 30) {
        const c = todo.shift();
        const f = prepareFighter(c, 'distance');
        this.raceDist.set(c.id, evaluate(f.bp, f.layout, f.genome, RACE_ENV).distance);
      }
      if (todo.length) setTimeout(step, 0);
      else { this.measuring = false; if (this.tab === 'race') this.render(); }
    };
    setTimeout(step, 0);
  }

  async withdraw(c) {
    if (!await confirmDialog('取り下げますか？', `「${c.name}」をオンライン道場から取り下げます。これまでの成績も消えます。`, '取り下げる', true)) return;
    try { await online.withdraw(c.id); toast('取り下げました'); this.load(); } catch (e) { toast(e.message); }
  }

  /** 自分の生物を公開する */
  async publishDialog(mode) {
    const mine = this.hooks.myCreatures();
    if (!mine.length) return toast('まだ育てた生物がいません。まず生物をつくって進化させよう');
    if (!online.profile().name && !(await this.askName())) return;
    const back = el('div', { class: 'modal-back' });
    const close = () => back.remove();
    const M = ARENA_MODES[mode];
    const sel = el('select', { class: 'ent-gen' });
    mine.forEach((c, i) => sel.append(el('option', { value: i }, c.name)));
    const gen = el('select', { class: 'ent-gen' });
    const fillGen = () => {
      gen.innerHTML = '';
      mine[+sel.value].snaps.forEach((s, i) => gen.append(el('option', { value: i }, `第${s.gen}世代 ${s.tag}`)));
    };
    sel.addEventListener('change', fillGen); fillGen();
    const msg = el('input', { class: 'on-input', maxlength: 60, placeholder: 'ひとこと (例: かかってこい！ / 後ずさりの達人です)' });
    const ok = el('button', { class: 'btn primary', onclick: async () => {
      ok.disabled = true;
      const f = this.hooks.fighterOf(mine[+sel.value], +gen.value);
      try { await online.publish(f, mode, msg.value); toast(`🌐 ${M.name}に出しました`); close(); this.load(); }
      catch (e) { toast(e.message); ok.disabled = false; }
    } }, '公開する');
    back.append(el('div', { class: 'modal' },
      el('h3', {}, `${M.icon} ${M.name}に生物を出す`),
      el('label', { class: 'on-field' }, el('span', {}, '生物'), sel),
      el('label', { class: 'on-field' }, el('span', {}, '世代'), gen),
      el('label', { class: 'on-field' }, el('span', {}, 'ひとこと'), msg),
      el('p', { class: 'dim' }, `公開すると、この生物の体と脳が「${online.profile().name}」の名前でだれでも見られるようになり、挑戦を受けます。`),
      el('div', { class: 'modal-actions' }, el('button', { class: 'btn ghost', onclick: close }, 'やめる'), ok)));
    back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
    document.body.append(back);
  }

  /** 特訓: 鍛える生物が決まっていなければ、自分の生物から選ぶ */
  train(f, rival, mode) {
    if (f) return this.hooks.onTrain(f, rival, mode);
    const mine = this.hooks.myCreatures();
    if (!mine.length) return toast('まだ育てた生物がいません');
    const back = el('div', { class: 'modal-back' });
    const close = () => back.remove();
    const grid = el('div', { class: 'pick-grid' });
    for (const c of mine) {
      const cv = el('canvas', { class: 'pick-thumb' });
      grid.append(el('button', { class: 'pick-item', onclick: () => { close(); this.hooks.onTrain(this.hooks.fighterOf(c, 0), rival, mode); } },
        cv, el('b', {}, c.name), el('small', {}, `第${c.snaps[0].gen}世代 · ${c.note}`)));
      requestAnimationFrame(() => drawThumb(cv, c.bp));
    }
    back.append(el('div', { class: 'modal wide' }, el('h3', {}, `「${rival.name}」を相手に鍛える生物`), grid,
      el('div', { class: 'modal-actions' }, el('button', { class: 'btn ghost', onclick: close }, 'やめる'))));
    back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
    document.body.append(back);
  }

  // ─── 受信箱 ───
  renderInbox(body) {
    const me = online.profile().id, D = this.data;
    const byId = new Map(D.creatures.map(c => [c.id, c]));
    const toMe = D.bouts.filter(b => b.defOwnerId === me);
    const byMe = D.bouts.filter(b => b.challenger.ownerId === me);
    const others = D.bouts.filter(b => b.defOwnerId !== me && b.challenger.ownerId !== me).slice(0, 30);
    const section = (title, items, kind, empty) => {
      body.append(el('h4', { class: 'pick-h' }, title));
      if (!items.length) { body.append(el('p', { class: 'dim on-empty' }, empty)); return; }
      const ul = el('ul', { class: 'on-bouts' });
      for (const b of items) ul.append(this.boutItem(b, kind, byId.get(b.defender)));
      body.append(ul);
    };
    section('📬 あなたの生物への挑戦', toMe, 'toMe', '生物を公開すると、ここに挑戦状が届きます。');
    section('📤 あなたの挑戦', byMe, 'byMe', 'オンラインの生物に挑戦して結果を送ると、相手の返信がここに届きます。');
    section('📰 みんなの取組', others, 'other', 'まだ取組はありません。');
  }

  boutItem(b, kind, def) {
    const B = BATTLES[b.mode];
    const w = b.results.filter(r => r.winner === 0).length, l = b.results.filter(r => r.winner === 1).length;
    const ch = b.challenger;
    const verdict = w > l ? `${ch.owner} さんの勝ち` : l > w ? `${b.defOwner} さんの勝ち` : '引き分け';
    const head = kind === 'toMe'
      ? `${ch.owner} さんの「${ch.name}」が、あなたの「${b.defName}」に挑戦`
      : kind === 'byMe' ? `あなたの「${ch.name}」→ ${b.defOwner} さんの「${b.defName}」` : `${ch.owner} さんの「${ch.name}」→ ${b.defOwner} さんの「${b.defName}」`;
    const isNew = kind === 'toMe' && b.created > online.inboxSeen();
    const li = el('li', { class: isNew ? 'new' : '' },
      el('div', { class: 'on-bout-head' }, el('span', {}, `${B.icon} ${when(b.created)}`), el('b', {}, head)),
      el('div', { class: 'on-bout-res' }, `${b.results.map(r => (r.winner === 0 ? '○' : r.winner === 1 ? '●' : '△') + r.kimarite).join(' ')} → ${verdict}`),
      b.msg ? el('p', { class: 'on-msg' }, `${ch.owner}:「${b.msg}」`) : null,
      b.reply ? el('p', { class: 'on-msg reply' }, `↩ ${b.reply.name}:「${b.reply.msg}」`) : null);
    const acts = el('div', { class: 'on-actions' });
    acts.append(def
      ? el('button', { class: 'btn primary small', onclick: () => this.hooks.onReplay(b, def) }, '▶ この取組を見る')
      : el('span', { class: 'dim' }, '(生物は取り下げ済み)'));
    if (kind === 'toMe') {
      acts.append(el('button', { class: 'btn ghost small', title: '挑戦者を相手に特訓', onclick: () => this.train(def ? onlineFighter(def) : null, { ...onlineFighter({ ...ch, mode: b.mode, id: `ch-${b.id}`, msg: '' }), name: `${ch.name}(${ch.owner})` }, b.mode) }, '🧬 リベンジ特訓'));
      if (!b.reply) {
        const inp = el('input', { class: 'on-input', maxlength: 60, placeholder: '返信 (例: 次は負けない！)' });
        acts.append(inp, el('button', { class: 'btn ghost small', onclick: async () => {
          if (!inp.value.trim()) return;
          try { await online.reply(b.id, inp.value); toast('返信しました'); this.load(); } catch (e) { toast(e.message); }
        } }, '↩ 返信'));
      }
    }
    li.append(acts);
    return li;
  }
}
