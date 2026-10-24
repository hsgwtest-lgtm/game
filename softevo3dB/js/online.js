// オンライン（Firebase Realtime Database の REST API）
//   物理が決定論なので、生き物（設計図＋遺伝子）さえ届けば、だれの端末でも寸分違わず同じ動きになる。
//   記録は公開するときに自分の端末で測り、見る人の端末でも測りなおせる（ごまかせない）。
//   データ（softevo3dB/v1 の下）:
//     creatures/{id} … 公開された種  { name, owner, ownerId, region, design, g(遺伝子), record, gens, goal, created }
//     stats/{id}     … 拍手・すもうの勝ち負け（サーバー側で加算）
import { sanitizeDesign } from './sim/design.js';
import { compileModel } from './sim/model.js';
import { geneCount } from './sim/nerves.js';
import { REGIONS } from './game/world.js';
import { b64ToF64, f64ToB64, uid, pref, setPref } from './game/store.js';

const DEFAULT_DB = 'https://softevo-leaderboard-default-rtdb.asia-southeast1.firebasedatabase.app';
const ROOT = 'softevo3dB/v1';
export const RULES_HINT = '"softevo3dB": { ".read": true, ".write": true }';

export class OnlineError extends Error {
  constructor(kind, msg) { super(msg || kind); this.kind = kind; }
}

function base() { return (pref('dbURL', DEFAULT_DB) || DEFAULT_DB).replace(/\/$/, ''); }

async function req(path, { method = 'GET', body, query } = {}) {
  const url = `${base()}/${ROOT}/${path}.json${query ? `?${query}` : ''}`;
  let res;
  try {
    // Content-Type を付けない（プリフライトなし）。Firebase は本文を JSON として読む
    res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch (e) {
    throw new OnlineError('network', 'ネットワークにつながりません');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403 || /permission/i.test(t)) throw new OnlineError('permission', 'データベースへの書きこみ・読みこみが許可されていません');
    throw new OnlineError('http', `サーバーエラー（${res.status}）`);
  }
  return res.json();
}
const latest = (n) => `orderBy=${encodeURIComponent('"$key"')}&limitToLast=${n}`;
const inc = (n) => ({ '.sv': { increment: n } });

// ── プロフィール ──
export function profile() {
  let p = pref('profile', null);
  if (!p || !p.id) { p = { id: uid() + uid(), name: '' }; setPref('profile', p); }
  return p;
}
export function setName(name) { const p = profile(); p.name = clean(name, 16) || p.name; setPref('profile', p); return p; }

const clean = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');

// 受けとった種を検査（だれでも書きこめるので信用しない）
export function checkCreature(id, x) {
  if (!x || typeof x !== 'object') return null;
  if (!REGIONS[x.region]) return null;
  const design = sanitizeDesign(x.design);
  if (!design) return null;
  let model;
  try { model = compileModel(design); } catch { return null; }
  if (typeof x.g !== 'string' || x.g.length > 20000) return null;
  let g;
  try { g = b64ToF64(x.g); } catch { return null; }
  if (g.length !== geneCount(model) || !g.every(v => Number.isFinite(v) && Math.abs(v) < 50)) return null;
  const record = Number(x.record);
  return {
    id, name: clean(x.name, 12) || '名無し', owner: clean(x.owner, 16) || '名無し', ownerId: clean(x.ownerId, 40),
    region: x.region, design, genes: g, record: Number.isFinite(record) ? record : 0,
    gens: Number.isInteger(x.gens) ? x.gens : 0, goal: x.goal === 'walk' ? 'walk' : 'distance',
    color: Number.isInteger(x.color) ? x.color & 0xffffff : 0xd9a58c, created: Number(x.created) || 0, msg: clean(x.msg, 60),
  };
}

export async function fetchCreatures() {
  const [cs, st] = await Promise.all([req('creatures', { query: latest(300) }), req('stats').catch(() => ({}))]);
  const list = [];
  for (const [id, x] of Object.entries(cs || {})) { const c = checkCreature(id, x); if (c) list.push(c); }
  const stats = {};
  for (const [id, v] of Object.entries(st || {})) {
    if (!v || typeof v !== 'object') continue;
    const n = (k) => (Number.isFinite(v[k]) && v[k] >= 0 ? Math.floor(v[k]) : 0);
    stats[id] = { cheers: n('cheers'), w: n('w'), l: n('l'), d: n('d') };
  }
  return { list, stats };
}

// 公開: sp（遊びの種）, record（公式コースで測った記録）
export async function publish(sp, record, genes, msg = '') {
  const p = profile();
  const body = {
    v: 1, name: sp.name, owner: p.name || '名無し', ownerId: p.id, region: sp.region, design: sp.design,
    g: f64ToB64(genes), record: Math.round(record * 1000) / 1000, gens: sp.gens, goal: sp.goal || 'distance',
    color: sp.color, msg: clean(msg, 60), created: Date.now(),
  };
  const r = await req('creatures', { method: 'POST', body });
  return r && r.name;
}
export async function withdraw(id) {
  await req(`creatures/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await req(`stats/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}
export async function cheer(id) { await req(`stats/${encodeURIComponent(id)}`, { method: 'PATCH', body: { cheers: inc(1) } }); }
// すもうの結果（守った側の成績）
export async function postSumo(defId, result) {
  const key = result === 'win' ? 'w' : result === 'lose' ? 'l' : 'd';
  await req(`stats/${encodeURIComponent(defId)}`, { method: 'PATCH', body: { [key]: inc(1) } });
}
