/* =====================================================================
   SoftEvo 8 — online.js
   オンライン道場 (Firebase Realtime Database の REST API)
   ---------------------------------------------------------------------
   物理が決定論的なので、対戦は「非同期」で十分:
   ・公開された生物 (体 + 脳) を、だれでも自分の端末で再現して挑戦できる
   ・挑戦の結果はひとことを添えて持ち主に届き、持ち主は「まったく同じ取組」を再生できる
   ・かけっこの記録は見る人の端末で計算し直すので、ごまかしようがない
   データ (softevo7 と同じプロジェクトの softevo8/v1 の下):
     creatures/{id} … 公開された生物
     stats/{id}     … 勝ち / 負け / 分け / 拍手 (サーバー側で加算)
     bouts/{id}     … 挑戦の記録 (挑戦者の生物・結果・ひとこと・返信)
   ===================================================================== */
import { brainLayout, genomeLength, validateBlueprint, OBJECTIVES, BATTLES } from './sim.js';
import { b64ToF32, f32ToB64, uid } from './store.js';

const DEFAULT_DB = 'https://softevo-leaderboard-default-rtdb.asia-southeast1.firebasedatabase.app';
const ROOT = 'softevo8/v1';
const PROFILE_KEY = 'softevo8/profile';
const SEEN_KEY = 'softevo8/inboxSeen';
export const MODES = ['sumo', 'tug', 'race'];

export class OnlineError extends Error {
  constructor(kind, msg) { super(msg || kind); this.kind = kind; }
}

/** Firebase のルールに追加してもらう設定 (権限エラーの時に案内する) */
export const RULES_HINT = `"softevo8": { ".read": true, ".write": true }`;

function base() {
  try { return (localStorage.getItem('softevo8/dbURL') || DEFAULT_DB).replace(/\/$/, ''); } catch { return DEFAULT_DB; }
}

async function req(path, { method = 'GET', body, query } = {}) {
  const url = `${base()}/${ROOT}/${path}.json${query ? `?${query}` : ''}`;
  let res;
  try {
    // Content-Type を付けない (= プリフライトなし)。Firebase は本文を JSON として受け取る
    res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch (e) {
    throw new OnlineError('network', 'ネットワークにつながりません');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403 || /permission/i.test(t)) throw new OnlineError('permission', 'データベースへのアクセスが許可されていません');
    throw new OnlineError('http', `サーバーエラー (${res.status})`);
  }
  return res.json();
}
const latest = n => `orderBy=${encodeURIComponent('"$key"')}&limitToLast=${n}`;
const inc = n => ({ '.sv': { increment: n } });

// ─── プロフィール (ニックネーム + 端末ごとのID) ───
export function profile() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { /* ignore */ }
  if (!p || !p.id) { p = { id: uid() + uid(), name: '' }; saveProfile(p); }
  return p;
}
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* ignore */ } }
export function setName(name) { const p = profile(); p.name = cleanText(name, 16) || p.name; saveProfile(p); return p; }

// ─── 受け取ったデータの検証 (だれでも書き込めるので、信用しない) ───
const cleanText = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function checkBlueprint(bp) {
  if (!bp || !Array.isArray(bp.nodes) || !Array.isArray(bp.edges)) return null;
  if (bp.nodes.length < 2 || bp.nodes.length > 60 || bp.edges.length > 240) return null;
  const nodes = [];
  for (const p of bp.nodes) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1500 || Math.abs(p.y) > 1500) return null;
    nodes.push({ x: p.x, y: p.y });
  }
  const edges = [];
  for (const e of bp.edges) {
    if (!e || !isInt(e.a, 0, nodes.length - 1) || !isInt(e.b, 0, nodes.length - 1) || e.a === e.b || (e.type !== 'bone' && e.type !== 'muscle')) return null;
    edges.push({ a: e.a, b: e.b, type: e.type });
  }
  const clean = { nodes, edges };
  return validateBlueprint(clean) ? null : clean;
}

/** 生物 (体・脳) を検証して、ゲームで使える形に */
export function checkFighter(x) {
  if (!x || typeof x !== 'object') return null;
  const bp = checkBlueprint(x.bp);
  if (!bp || !isInt(x.hidden, 1, 32) || !(x.hidden2 == null || isInt(x.hidden2, 0, 32))) return null;
  const obj = typeof x.obj === 'string' && (OBJECTIVES[x.obj] || BATTLES[x.obj]) ? x.obj : null;
  if (!obj || typeof x.g !== 'string' || x.g.length > 60000) return null;
  let g;
  try { g = b64ToF32(x.g); } catch { return null; }
  const want = genomeLength(brainLayout(bp, { hidden: x.hidden, hidden2: x.hidden2 || 0, objective: obj }).sizes);
  if (g.length !== want || !g.every(Number.isFinite)) return null;
  return {
    name: cleanText(x.name, 24) || '名無し', owner: cleanText(x.owner, 16) || '名無し', ownerId: cleanText(x.ownerId, 40),
    bp, hidden: x.hidden, hidden2: x.hidden2 || 0, obj, g, gen: Number.isInteger(x.gen) ? x.gen : null,
  };
}

function checkCreature(id, x) {
  const f = checkFighter(x);
  if (!f || !MODES.includes(x.mode)) return null;
  return { ...f, id, mode: x.mode, msg: cleanText(x.msg, 80), created: Number(x.created) || 0 };
}

function checkBout(id, x) {
  if (!x || !MODES.includes(x.mode) || typeof x.defender !== 'string') return null;
  const ch = checkFighter(x.challenger);
  if (!ch || !Array.isArray(x.results) || x.results.length > 3) return null;
  const results = x.results.map(r => ({ winner: [0, 1, -1].includes(r && r.winner) ? r.winner : -1, kimarite: cleanText(r && r.kimarite, 8), t: Number(r && r.t) || 0 }));
  const reply = x.reply && typeof x.reply === 'object' ? { msg: cleanText(x.reply.msg, 80), name: cleanText(x.reply.name, 16), created: Number(x.reply.created) || 0 } : null;
  return {
    id, mode: x.mode, defender: cleanText(x.defender, 40), defName: cleanText(x.defName, 24), defOwner: cleanText(x.defOwner, 16), defOwnerId: cleanText(x.defOwnerId, 40),
    challenger: ch, results, msg: cleanText(x.msg, 80), created: Number(x.created) || 0, reply,
  };
}

const pack = f => ({ name: f.baseName || f.name, bp: f.bp, hidden: f.hidden, hidden2: f.hidden2 || 0, obj: f.obj, g: f32ToB64(f.g), gen: f.gen ?? null });

// ─── API ───
/** 公開された生物・成績・最近の取組をまとめて取得 */
export async function fetchAll() {
  const [cs, st, bs] = await Promise.all([req('creatures', { query: latest(150) }), req('stats'), req('bouts', { query: latest(200) })]);
  const creatures = [];
  for (const [id, x] of Object.entries(cs || {})) { const c = checkCreature(id, x); if (c) creatures.push(c); }
  const stats = {};
  for (const [id, s] of Object.entries(st || {})) {
    if (!s || typeof s !== 'object') continue;
    const n = k => (Number.isFinite(s[k]) && s[k] >= 0 ? Math.floor(s[k]) : 0);
    stats[id] = { w: n('w'), l: n('l'), d: n('d'), cheers: n('cheers') };
  }
  const bouts = [];
  for (const [id, x] of Object.entries(bs || {})) { const b = checkBout(id, x); if (b) bouts.push(b); }
  bouts.sort((a, b) => b.created - a.created);
  return { creatures, stats, bouts };
}

/** 生物を公開する。f: { name, bp, hidden, hidden2, obj, g(Float32Array), gen } */
export async function publish(f, mode, msg) {
  const p = profile();
  const body = { v: 1, ...pack(f), mode, msg: cleanText(msg, 80), owner: p.name || '名無し', ownerId: p.id, created: Date.now() };
  const r = await req('creatures', { method: 'POST', body });
  return r && r.name;
}

export async function withdraw(id) {
  await req(`creatures/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await req(`stats/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}

export async function cheer(id) {
  await req(`stats/${encodeURIComponent(id)}`, { method: 'PATCH', body: { cheers: inc(1) } });
}

/** 挑戦の結果を届ける。side: 挑戦者が西(0)か東(1)か。results は西から見た勝敗 */
export async function postBout({ mode, defender, challenger, side, results, msg }) {
  const p = profile();
  const mine = results.map(r => ({ winner: r.winner === -1 ? -1 : r.winner === side ? 0 : 1, kimarite: r.kimarite, t: Math.round(r.t * 10) / 10 }));
  const w = mine.filter(r => r.winner === 0).length, l = mine.filter(r => r.winner === 1).length;
  const body = {
    v: 1, mode, defender: defender.id, defName: defender.name, defOwner: defender.owner, defOwnerId: defender.ownerId,
    challenger: { ...pack(challenger), owner: p.name || '名無し', ownerId: p.id },
    results: mine, msg: cleanText(msg, 80), created: Date.now(),
  };
  await req('bouts', { method: 'POST', body });
  // 守った側の成績 (挑戦者が勝ち越せば守り側の負け)
  const key = w > l ? 'l' : l > w ? 'w' : 'd';
  await req(`stats/${encodeURIComponent(defender.id)}`, { method: 'PATCH', body: { [key]: inc(1) } });
  return { w, l };
}

export async function reply(boutId, msg) {
  const p = profile();
  await req(`bouts/${encodeURIComponent(boutId)}/reply`, { method: 'PUT', body: { msg: cleanText(msg, 80), name: p.name || '名無し', created: Date.now() } });
}

// ─── 受信箱の既読 ───
export function inboxSeen() { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } }
export function markInboxSeen(t) { try { localStorage.setItem(SEEN_KEY, String(t)); } catch { /* ignore */ } }
