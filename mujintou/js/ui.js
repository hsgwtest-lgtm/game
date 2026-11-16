// 画面のDOM部分：ヘッダー、タブ、島民検索・ランキング、年表、投票カード、詳細パネル。
// データ由来の文字列はすべて textContent で入れる（HTMLとして解釈させない）。

import { INSTAGRAM_URL, INSTAGRAM_HANDLE, RELATION_TYPES, DEFAULT_RELATION } from './config.js';
import { iconCanvas, islanderPortrait, hydrateIcons } from './pixelart.js';
import { rankIslanders } from './data.js';
import { LANDING } from './terrain.js';

// 子要素に null / undefined / false が来たら飛ばす。
const present = (c) => c !== null && c !== undefined && c !== false;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === 'data') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

// 中身をまとめて入れ替える。DOM の append / replaceChildren に null を渡すと
// 文字列 "null" が描かれてしまうので、条件つきの子要素は必ず el() かこれを通す。
function fill(node, children) {
  node.replaceChildren(...[].concat(children).filter(present));
}

const $ = (id) => document.getElementById(id);

function formatDeadline(date) {
  try {
    const f = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' });
    return `${f.format(date)}（日本時間）`;
  } catch {
    return date.toISOString();
  }
}

function formatRemaining(ms) {
  if (ms <= 0) return '';
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `あと${d}日${h}時間`;
  if (h > 0) return `あと${h}時間${m}分`;
  return `あと${Math.max(1, m)}分`;
}

export function createUI({ onSelectIslander, onCloseDetail, onSheetChange, onRecenter, now = () => Date.now() }) {
  const body = document.body;
  const panel = $('panel');
  const sheet = $('sheet');
  const views = {
    islanders: $('view-islanders'),
    chronicle: $('view-chronicle'),
    vote: $('view-vote'),
    detail: $('view-detail'),
  };
  const tabs = [...document.querySelectorAll('#tabs [data-tab]')];
  const desktop = window.matchMedia('(min-width: 900px)');

  let state = null;
  let islanders = [];
  let ranked = [];
  let portraitFor = (p) => islanderPortrait(p);
  let currentView = 'islanders';
  let returnView = null; // 詳細を閉じたときに戻る先（null ならシートを閉じる）
  let selected = -1;
  let nowLine = null;
  let voteTimer = null;

  hydrateIcons();

  // ---- シートとタブ ----------------------------------------------------------
  function isSheetOpen() {
    return desktop.matches || body.dataset.sheet === 'open';
  }

  function setSheet(open) {
    const before = body.dataset.sheet;
    body.dataset.sheet = open ? 'open' : 'closed';
    if (before !== body.dataset.sheet) onSheetChange?.();
  }

  function setView(name, { open = true } = {}) {
    currentView = name;
    panel.dataset.view = name;
    for (const [k, v] of Object.entries(views)) v.hidden = k !== name;
    const tabName = name === 'detail' ? 'islanders' : name;
    for (const t of tabs) {
      const active = open || desktop.matches ? t.dataset.tab === tabName : t.dataset.tab === 'island';
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    setSheet(open);
    sheet.scrollTop = 0;
  }

  for (const t of tabs) {
    t.addEventListener('click', () => {
      const name = t.dataset.tab;
      if (name === 'island') {
        setView(currentView === 'detail' ? 'islanders' : currentView, { open: false });
        if (selected >= 0) closeDetail(true);
        return;
      }
      if (currentView === 'detail' && selected >= 0) {
        selected = -1;
        onCloseDetail?.();
      }
      setView(name);
    });
  }
  desktop.addEventListener?.('change', () => {
    setView(currentView, { open: body.dataset.sheet === 'open' });
    onSheetChange?.();
  });

  $('recenter').addEventListener('click', () => onRecenter?.());
  $('vote-chip').addEventListener('click', () => setView('vote'));

  // ---- ヘッダー --------------------------------------------------------------
  function renderHeader() {
    $('island-name').textContent = state.islandName;
    document.title = state.islandName;
    $('day-chip').textContent = `${state.day}日目`;
    $('pop-chip').textContent = `島民 ${islanders.length}人`;
  }

  // ---- 島民：検索とランキング --------------------------------------------------
  const searchInput = $('search');
  const listEl = $('islander-list');
  const listMeta = $('list-meta');

  function matches(p, q) {
    if (!q) return true;
    const hay = p.anonymous ? p.displayName : `${p.name}\n${p.id}\n${p.job}`;
    return hay.toLowerCase().includes(q);
  }

  function renderList() {
    const q = searchInput.value.trim().toLowerCase().replace(/^@/, '');
    const rows = ranked.filter((e) => matches(e.p, q));
    listEl.replaceChildren();
    listMeta.textContent = q ? `「${searchInput.value.trim()}」の検索結果：${rows.length}人` : islanders.length ? `在住日数ランキング（全${islanders.length}人）` : '';
    if (!rows.length) {
      listEl.append(
        el('li', { class: 'empty' }, [
          el('p', { class: 'empty-title', text: islanders.length ? 'その名前の島民は見つかりませんでした' : 'まだ島民はいません' }),
          el('p', {
            text: islanders.length
              ? `まだ漂着していないのかもしれません。Instagram（@${INSTAGRAM_HANDLE}）をフォローした人は、動画の更新にあわせてこの島に漂着します。`
              : `Instagram（@${INSTAGRAM_HANDLE}）をフォローすると、この島に漂着します。名簿は動画の更新にあわせて反映されます。`,
          }),
        ]),
      );
      return;
    }
    for (const e of rows) {
      const p = e.p;
      const rank = el('span', { class: `rank rank-${Math.min(e.rank, 4)}` }, [e.rank <= 3 ? iconCanvas('crown', e.rank === 2 ? { C: '#c3c8d4', L: '#ffffff' } : e.rank === 3 ? { C: '#d08a4e', L: '#f3c9a0' } : undefined) : null, el('span', { text: `${e.rank}位` })]);
      const row = el(
        'button',
        { class: 'islander-row', type: 'button', 'aria-label': `${p.displayName}、${p.job}、在住${p.days}日、${e.rank}位。島で探す`, on: { click: () => onSelectIslander?.(e.index, { fromList: true }) } },
        [
          rank,
          el('span', { class: 'portrait-wrap' }, portraitFor(p, e.index)),
          el('span', { class: 'who' }, [
            el('span', { class: 'who-name' }, [el('span', { text: p.displayName }), p.sample ? el('span', { class: 'tag tag-sample', text: 'サンプル' }) : null]),
            el('span', { class: 'who-sub', text: p.anonymous ? p.job : `@${p.id}・${p.job}` }),
          ]),
          el('span', { class: 'days' }, [el('b', { text: String(p.days) }), el('span', { text: '日' })]),
        ],
      );
      listEl.append(el('li', {}, row));
    }
  }

  searchInput.addEventListener('input', renderList);
  $('search-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = searchInput.value.trim().toLowerCase().replace(/^@/, '');
    const hit = ranked.find((e) => matches(e.p, q));
    if (hit && q) {
      searchInput.blur();
      onSelectIslander?.(hit.index, { fromList: true });
    }
  });

  // ---- 島のいま（拠点と、島民の行動範囲） ----------------------------------------
  // 行動範囲は運営が開け閉めするものではなく、住民の投票で広がるもの。範囲の外は「自然の障壁」として説明する。
  const districtName = (id) => state.districts.find((d) => d.id === id)?.name || id;

  function renderIslandNow() {
    const inside = state.districts.filter((d) => d.inRange);
    const outside = state.districts.filter((d) => !d.inRange);
    const b = state.base;
    fill($('island-now'), [
      el('h3', { class: 'now-title', text: '島のいま' }),
      el('dl', { class: 'now-list' }, [
        el('div', {}, [
          el('dt', { text: '拠点' }),
          el('dd', {}, b ? [el('b', { text: b.name }), b.decidedDay ? el('span', { text: `（${b.decidedDay}日目に住民の投票で決定）` }) : null] : [el('b', { text: 'まだ決まっていない' }), el('span', { text: `（いまは${LANDING.name}が集まり場）` })]),
        ]),
        el('div', {}, [
          el('dt', { text: '行動範囲' }),
          el('dd', {}, [el('b', { text: inside.map((d) => d.name).join('・') || '—' }), ...inside.filter((d) => d.expandedDay).map((d) => el('span', { class: 'now-expanded', text: `${d.name}は${d.expandedDay}日目から` }))]),
        ]),
        outside.length
          ? el('div', {}, [
              el('dt', { text: '範囲の外' }),
              el(
                'dd',
                {},
                el(
                  'ul',
                  { class: 'now-barriers' },
                  outside.map((d) => el('li', {}, [el('b', { text: d.name }), el('span', { text: d.barrier })])),
                ),
              ),
            ])
          : null,
      ]),
      el('p', { class: 'now-note', text: outside.length ? `${outside.map((d) => d.name).join('や')}へ行くかどうかは、住民の投票で決まります。` : '島じゅうが、島民の行動範囲になりました。' }),
    ]);
  }

  // ---- 年表 ------------------------------------------------------------------
  function renderChronicle() {
    const root = $('chronicle-list');
    root.replaceChildren();
    if (!state.chronicle.length) {
      root.append(el('li', { class: 'empty' }, el('p', { text: 'まだ出来事がありません。島の出来事は、動画の更新にあわせてここに記録されます。' })));
      return;
    }
    for (const c of state.chronicle) {
      root.append(
        el('li', { class: `chron${c.expands.length ? ' chron-expand' : ''}` }, [
          el('div', { class: 'chron-head' }, [el('span', { class: 'chip chip-day', text: `${c.day}日目` }), c.date ? el('time', { datetime: c.date, text: c.date.replaceAll('-', '/') }) : null]),
          el('h3', { text: c.title }),
          c.text ? el('p', { text: c.text }) : null,
          c.expands.length ? el('p', { class: 'chron-range' }, [el('span', { class: 'chron-range-label', text: '行動範囲が広がった' }), el('b', { text: c.expands.map(districtName).join('・') })]) : null,
          c.vote && (c.vote.question || c.vote.adopted)
            ? el('div', { class: 'chron-vote' }, [
                el('span', { class: 'chron-vote-label' }, [iconCanvas('vote'), el('span', { text: '採用された投票結果' })]),
                c.vote.question ? el('span', { class: 'chron-vote-q', text: c.vote.question }) : null,
                el('strong', { text: c.vote.adopted ? `→ ${c.vote.adopted}` : '' }),
                c.vote.note ? el('span', { class: 'chron-vote-note', text: c.vote.note }) : null,
              ])
            : null,
        ]),
      );
    }
  }

  // ---- 投票カード ------------------------------------------------------------
  function voteStatus(v) {
    const passed = v.deadline && now() > v.deadline.getTime();
    if (v.status === 'closed') return { key: 'closed', label: '終了' };
    if (v.status === 'counting' || passed) return { key: 'counting', label: '集計中' };
    return { key: 'open', label: '受付中' };
  }

  function renderVote() {
    const root = $('vote-card');
    const chip = $('vote-chip');
    root.replaceChildren();
    const v = state.currentVote;
    const dot = document.querySelector('#tabs [data-tab="vote"] .tab-dot');
    if (!v) {
      chip.hidden = true;
      if (dot) dot.hidden = true;
      root.append(el('div', { class: 'empty' }, [el('p', { class: 'empty-title', text: 'いま受付中の投票はありません' }), el('p', { text: '次のお題は、次の動画で発表されます。' })]));
      return;
    }
    const st = voteStatus(v);
    chip.hidden = st.key !== 'open';
    if (dot) dot.hidden = st.key !== 'open';
    $('vote-chip-text').textContent = v.question;

    const remaining = v.deadline ? formatRemaining(v.deadline.getTime() - now()) : '';
    const url = v.postUrl || INSTAGRAM_URL;
    // 結果メモ・説明・締切は無いことがあるので fill() で入れる（append だと null が "null" と描かれる）
    fill(root, [
      el('div', { class: 'vote-head' }, [el('span', { class: `chip chip-${st.key}`, text: st.label }), el('span', { class: 'vote-kicker', text: '現在の投票お題' })]),
      el('h3', { class: 'vote-q', text: v.question }),
      v.description ? el('p', { class: 'vote-desc', text: v.description }) : null,
      el(
        'ol',
        { class: 'vote-options' },
        v.options.map((o) =>
          el('li', { class: v.result && v.result.key === o.key ? 'is-adopted' : '' }, [
            el('span', { class: 'opt-key', text: o.key }),
            el('span', { class: 'opt-body' }, [el('b', { text: o.label }), o.note ? el('span', { text: o.note }) : null]),
            v.result && v.result.key === o.key ? el('span', { class: 'tag tag-adopted', text: '採用' }) : null,
          ]),
        ),
      ),
      v.deadline
        ? el('p', { class: 'vote-deadline' }, [
            el('span', { class: 'vote-deadline-label', text: '締切' }),
            el('time', { datetime: v.deadline.toISOString(), text: formatDeadline(v.deadline) }),
            st.key === 'open' && remaining ? el('b', { class: 'vote-remaining', text: remaining }) : null,
            st.key === 'counting' ? el('b', { class: 'vote-remaining', text: '締め切りました。結果は次の動画で発表' }) : null,
          ])
        : null,
      v.result?.note ? el('p', { class: 'vote-result-note', text: v.result.note }) : null,
      el('div', { class: 'vote-how' }, [
        el('p', { class: 'vote-how-title', text: '投票はInstagramのコメントで' }),
        el('p', { text: 'このアプリの中では投票できません。次の手順で参加してください。' }),
        el('ol', {}, [el('li', { text: `Instagram（@${INSTAGRAM_HANDLE}）の最新の投稿をひらく` }), el('li', { text: `えらんだ案（${v.options.map((o) => o.key).join('・') || 'A・B・C'}）をコメントする` }), el('li', { text: 'いいねが一番多いコメントの案が採用されます' })]),
        st.key === 'open' ? el('a', { class: 'btn btn-primary', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Instagramで投票する' }) : el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Instagramをひらく' }),
      ]),
    ]);
  }

  // ---- 詳細パネル ------------------------------------------------------------
  function detailHeader(titleNode) {
    return el('div', { class: 'detail-head' }, [
      returnView ? el('button', { class: 'btn btn-small', type: 'button', text: '‹ 一覧へ', on: { click: () => closeDetail() } }) : el('span'),
      titleNode,
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': '閉じる', on: { click: () => closeDetail(true) } }, iconCanvas('close')),
    ]);
  }

  function showIslander(index, { fromList = false } = {}) {
    const p = islanders[index];
    if (!p) return;
    if (currentView !== 'detail') returnView = fromList || isSheetOpen() ? (currentView === 'detail' ? 'islanders' : currentView) : null;
    selected = index;
    const root = views.detail;
    nowLine = el('p', { class: 'now-line', 'aria-live': 'polite' });

    const byId = new Map(islanders.map((q, i) => [q.id, i]));
    const rels = p.relationships
      .map((r) => ({ r, j: byId.get(r.id) }))
      .filter((x) => x.j !== undefined)
      .sort((a, b) => b.r.affinity - a.r.affinity);

    fill(root, [
      detailHeader(el('span', { class: 'detail-kicker', text: '島民' })),
      el('div', { class: 'profile' }, [
        el('span', { class: 'portrait-wrap portrait-big' }, portraitFor(p, index)),
        el('div', { class: 'profile-main' }, [
          el('h3', {}, [el('span', { text: p.displayName }), p.sample ? el('span', { class: 'tag tag-sample', text: 'サンプル' }) : null]),
          p.anonymous ? null : el('p', { class: 'profile-id', text: `@${p.id}` }),
          nowLine,
        ]),
      ]),
      el('dl', { class: 'facts' }, [
        el('div', {}, [el('dt', { text: '在住' }), el('dd', {}, [el('b', { text: String(p.days) }), el('span', { text: '日' })])]),
        el('div', {}, [el('dt', { text: '仕事' }), el('dd', { text: p.job })]),
        el('div', {}, [el('dt', { text: '漂着' }), el('dd', { text: `${p.joinedDay}日目` })]),
      ]),
      p.since ? el('p', { class: 'since', text: `在住の起点：${p.since.replaceAll('-', '/')}` }) : null,
      el('h4', { class: 'section-title', text: '関係' }),
      rels.length
        ? el(
            'ul',
            { class: 'rel-list' },
            rels.map(({ r, j }) => {
              const type = RELATION_TYPES[r.type] || DEFAULT_RELATION;
              const q = islanders[j];
              return el(
                'li',
                {},
                el('button', { class: 'rel-row', type: 'button', 'aria-label': `${q.displayName}、${type.label}、好感度${r.affinity}。この島民を見る`, on: { click: () => onSelectIslander?.(j, { fromList: returnView !== null }) } }, [
                  el('span', { class: 'portrait-wrap portrait-small' }, portraitFor(q, j)),
                  el('span', { class: 'rel-main' }, [
                    el('span', { class: 'rel-name', text: q.displayName }),
                    el('span', { class: `rel-type rel-${r.type}` }, [iconCanvas(type.icon), el('span', { text: type.label })]),
                  ]),
                  el('span', { class: 'meter', role: 'img', 'aria-label': `好感度 ${r.affinity}` }, [
                    el('span', { class: 'meter-bar' }, el('span', { class: 'meter-fill', style: `width:${r.affinity}%` })),
                    el('span', { class: 'meter-num', text: String(r.affinity) }),
                  ]),
                ]),
              );
            }),
          )
        : el('p', { class: 'muted', text: 'まだ特別な関係はありません。これから育っていきます。' }),
    ]);
    setView('detail');
  }

  function showBuilding(b) {
    if (currentView !== 'detail') returnView = isSheetOpen() ? currentView : null;
    selected = -1;
    nowLine = null;
    const root = views.detail;
    fill(root, [
      detailHeader(el('span', { class: 'detail-kicker', text: '建物' })),
      el('div', { class: 'profile' }, [
        el('span', { class: 'portrait-wrap portrait-big portrait-building' }, iconCanvas('home')),
        el('div', { class: 'profile-main' }, [el('h3', { text: b.name }), el('p', { class: 'profile-id', text: b.typeLabel })]),
      ]),
      el('dl', { class: 'facts' }, [el('div', {}, [el('dt', { text: '完成' }), el('dd', { text: b.builtDay ? `${b.builtDay}日目` : '—' })]), el('div', {}, [el('dt', { text: '種類' }), el('dd', { text: b.typeLabel })])]),
      b.note ? el('p', { text: b.note }) : null,
    ]);
    setView('detail');
  }

  function closeDetail(forceClose = false) {
    selected = -1;
    nowLine = null;
    if (currentView === 'detail') {
      if (returnView && !forceClose) setView(returnView);
      else setView(returnView || 'islanders', { open: false });
    }
    returnView = null;
    onCloseDetail?.();
  }

  // ---- そのほか --------------------------------------------------------------
  let toastTimer = null;
  function toast(message, ms = 2600) {
    const t = $('toast');
    t.textContent = message;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), ms);
  }

  function setLoading(text) {
    const l = $('loading');
    if (!text) {
      l.hidden = true;
      return;
    }
    l.hidden = false;
    l.querySelector('.loading-text').textContent = text;
  }

  function showStageError(message) {
    const l = $('loading');
    l.hidden = false;
    l.classList.add('is-error');
    l.querySelector('.loading-text').textContent = message;
  }

  function renderData(data, opts = {}) {
    state = data.state;
    islanders = data.islanders;
    ranked = rankIslanders(islanders);
    if (opts.portraitFor) portraitFor = opts.portraitFor;
    renderHeader();
    renderList();
    renderIslandNow();
    renderChronicle();
    renderVote();
    $('sample-note').hidden = !(state.sample || islanders.some((p) => p.sample));
    $('updated').textContent = state.updatedAt ? `データ更新：${state.updatedAt.replaceAll('-', '/')}` : '';
    clearInterval(voteTimer);
    voteTimer = setInterval(renderVote, 60000);
  }

  setView('islanders', { open: false });

  return {
    renderData,
    showIslander,
    showBuilding,
    closeDetail,
    setView,
    toast,
    setLoading,
    showStageError,
    isSheetOpen,
    isDesktop: () => desktop.matches,
    selectedIndex: () => selected,
    setNowText: (text) => {
      if (nowLine && nowLine.textContent !== text) nowLine.textContent = text;
    },
    // シート＋タブがステージに重なっている高さ（スマホのみ）
    overlapHeight: () => {
      if (desktop.matches) return 0;
      return window.innerHeight - panel.getBoundingClientRect().top;
    },
    expectedOverlap: () => {
      if (desktop.matches) return 0;
      const tabsH = $('tabs').getBoundingClientRect().height;
      return body.dataset.sheet === 'open' ? tabsH + Math.round(window.innerHeight * 0.5) : tabsH;
    },
  };
}
