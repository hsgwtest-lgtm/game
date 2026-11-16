// data/*.json の読み込みと、欠けた項目を補う正規化。
// 正規化は DOM に依存しないので Node でも検証できる。

import { DEFAULT_ISLAND_NAME, DATA_URLS, DEMO_DATA_URLS, BARRIERS, DEFAULT_BARRIER } from './config.js';
import { DISTRICTS, DISTRICT_INDEX, DISTRICT_ALIASES } from './terrain.js';

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} を読み込めませんでした（${res.status}）`);
  return res.json();
}

// demo: true なら data/demo/ の「育った島」のデモデータを読む（?demo で開いたとき）
export async function loadData({ demo = false } = {}) {
  const urls = demo ? DEMO_DATA_URLS : DATA_URLS;
  const [stateRaw, rosterRaw] = await Promise.all([fetchJson(urls.state), fetchJson(urls.islanders)]);
  return normalizeData(stateRaw, rosterRaw);
}

const str = (v, fallback = '') => (typeof v === 'string' || typeof v === 'number' ? String(v) : fallback);
const int = (v, fallback) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : fallback);
// null や空文字を 0 と読まないための数値化
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const dayOrNull = (v) => (Number.isFinite(num(v)) ? Math.max(1, Math.floor(num(v))) : null);
const districtId = (id) => DISTRICT_ALIASES[id] || id;
const voteOf = (v) => (v && typeof v === 'object' ? { question: str(v.question), adopted: str(v.adopted), note: str(v.note) } : null);

export function normalizeData(stateRaw, rosterRaw) {
  const s = stateRaw && typeof stateRaw === 'object' ? stateRaw : {};
  const day = Math.max(1, int(s.day, 1));

  // 島民の行動範囲。地区ごとに、範囲の中か（inRange）と、範囲が広がった日（expandedDay）・理由（reason）・
  // 決め手になった投票（vote）を持つ。範囲は運営が開けるものではなく、住民の投票で広がるもの。
  // 書かれていない地区は公開時の範囲（砂浜・入り江・平原は中、森・高原は自然の障壁で外）とする。
  // expandedDay が今日より先なら、その日までは範囲の外（先に書いておける）。
  const given = new Map(
    (Array.isArray(s.districts) ? s.districts : []).filter((d) => d && typeof d === 'object').map((d) => [districtId(str(d.id)), d]),
  );
  const districts = DISTRICTS.map((d) => {
    const g = given.get(d.id) || {};
    const expandedDay = dayOrNull(g.expandedDay);
    const wanted = typeof g.inRange === 'boolean' ? g.inRange : expandedDay !== null ? true : d.safe;
    const inRange = wanted && !(expandedDay !== null && expandedDay > day);
    return {
      id: d.id,
      name: str(g.name).trim() || d.name,
      inRange,
      expandedDay: inRange ? expandedDay : null,
      reason: inRange ? str(g.reason) : '',
      vote: inRange ? voteOf(g.vote) : null,
      barrier: str(g.barrier).trim() || (BARRIERS[d.id] || DEFAULT_BARRIER).barrier,
    };
  });

  // 拠点（広場）。最初の投票「拠点はどこにする？」の結果として生まれる。
  // 決まるまでは null で、島民は漂着した砂浜に集まる。
  let base = null;
  const b0 = s.base;
  if (b0 && typeof b0 === 'object' && Number.isFinite(num(b0.x)) && Number.isFinite(num(b0.z))) {
    const decidedDay = dayOrNull(b0.decidedDay);
    if (decidedDay === null || decidedDay <= day) base = { name: str(b0.name).trim() || '広場', x: num(b0.x), z: num(b0.z), decidedDay, note: str(b0.note) };
  }

  const buildings = (Array.isArray(s.buildings) ? s.buildings : [])
    .filter((b) => b && typeof b === 'object' && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.z)))
    .map((b, n) => ({
      id: str(b.id, `building-${n + 1}`),
      type: str(b.type, 'unknown'),
      name: str(b.name),
      x: Number(b.x),
      z: Number(b.z),
      rot: Number(b.rot) || 0,
      builtDay: Number.isFinite(Number(b.builtDay)) ? int(b.builtDay) : null,
      note: str(b.note),
    }))
    .filter((b) => b.builtDay === null || b.builtDay <= day);

  // 年表。expands: その日に行動範囲へ加わった地区（例：["forest"]）。
  const chronicle = (Array.isArray(s.chronicle) ? s.chronicle : [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      day: int(c.day, 0),
      date: str(c.date),
      title: str(c.title, '（無題）'),
      text: str(c.text),
      vote: voteOf(c.vote),
      expands: [].concat(c.expands ?? []).map((id) => districtId(str(id))).filter((id) => id in DISTRICT_INDEX),
      auto: false,
    }));
  // 行動範囲の拡大は、必ず年表に「住民の決定」として残す。
  // 年表に expands つきの記事が無い拡大は、districts の記録から記事を自動で足す。
  for (const d of districts) {
    if (!d.inRange || d.expandedDay === null || chronicle.some((c) => c.expands.includes(d.id))) continue;
    chronicle.push({ day: d.expandedDay, date: '', title: `行動範囲が${d.name}まで広がった`, text: d.reason || '住民の投票で決まった。', vote: d.vote, expands: [d.id], auto: true });
  }
  chronicle.sort((a, b) => b.day - a.day);

  let currentVote = null;
  if (s.currentVote && typeof s.currentVote === 'object' && str(s.currentVote.question)) {
    const v = s.currentVote;
    const deadline = v.deadline ? new Date(v.deadline) : null;
    currentVote = {
      id: str(v.id),
      status: ['open', 'counting', 'closed'].includes(v.status) ? v.status : 'open',
      question: str(v.question),
      description: str(v.description),
      options: (Array.isArray(v.options) ? v.options : []).map((o, n) => ({
        key: str(o?.key, String.fromCharCode(65 + n)),
        label: str(o?.label ?? o),
        note: str(o?.note),
      })),
      deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
      postUrl: /^https:\/\//.test(str(v.postUrl)) ? str(v.postUrl) : '',
      result: v.result && typeof v.result === 'object' ? { key: str(v.result.key), note: str(v.result.note) } : null,
    };
  }

  const state = {
    sample: s.sample === true,
    islandName: str(s.islandName).trim() || DEFAULT_ISLAND_NAME,
    day,
    updatedAt: str(s.updatedAt),
    districts,
    base,
    buildings,
    chronicle,
    currentVote,
  };

  // 名簿
  const list = Array.isArray(rosterRaw) ? rosterRaw : Array.isArray(rosterRaw?.islanders) ? rosterRaw.islanders : [];
  const seen = new Set();
  const islanders = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const id = str(p.id).trim();
    if (!id || seen.has(id)) continue;
    const joinedDay = Math.max(1, int(p.joinedDay, 1));
    if (joinedDay > day) continue; // まだ漂着していない（先に名簿へ入れておける）
    seen.add(id);
    const anonymous = p.anonymous === true;
    const name = str(p.name).trim() || id;
    islanders.push({
      id,
      name,
      anonymous,
      displayName: anonymous ? '匿名の島民' : name,
      joinedDay,
      since: str(p.since),
      home: districtId(str(p.home, 'beach')), // 起点の地区（散歩でよく行く）。省略時は漂着した砂浜
      job: str(p.job, '島民'),
      color: str(p.color, '#4a90d9'),
      relationships: (Array.isArray(p.relationships) ? p.relationships : [])
        .filter((r) => r && str(r.id))
        .map((r) => ({ id: str(r.id), type: str(r.type, 'friend'), affinity: Math.max(0, Math.min(100, int(r.affinity, 50))) })),
      sample: p.sample === true,
      days: day - joinedDay + 1, // 在住日数（漂着した日を1日目と数える）
    });
  }
  // 島にいない相手との関係は表示しない
  for (const p of islanders) p.relationships = p.relationships.filter((r) => seen.has(r.id) && r.id !== p.id);

  return { state, islanders };
}

// 在住日数ランキング（長い順。同じなら名簿の順）
export function rankIslanders(islanders) {
  return islanders
    .map((p, index) => ({ p, index }))
    .sort((a, b) => b.p.days - a.p.days || a.index - b.index)
    .map((e, n, arr) => ({ ...e, rank: n > 0 && arr[n - 1].p.days === e.p.days ? null : n + 1 }))
    .map((e, n, arr) => {
      // 同じ日数は同じ順位
      if (e.rank === null) {
        let m = n - 1;
        while (arr[m].rank === null) m--;
        return { ...e, rank: arr[m].rank };
      }
      return e;
    });
}
