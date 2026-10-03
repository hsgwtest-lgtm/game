// Firebase Realtime Database（REST API ＋ ストリーミング）。SDK なしで動く。
//  ・読み書き: fetch（Content-Type を付けないのでプリフライトなし）
//  ・リアルタイム: EventSource（サーバー送信イベント）で変更を受け取る
// データは nuribots/v1 の下にまとめる。

export const DEFAULT_DB = 'https://softevo-leaderboard-default-rtdb.asia-southeast1.firebasedatabase.app';
export const ROOT = 'nuribots/v1';
export const RULES_HINT = '"nuribots": { ".read": true, ".write": true }';
const DB_KEY = 'nuribots/db';

// ?db=... で接続先を変えられる（テスト用・自分の Firebase を使いたい人用）
try {
  const m = /[?&]db=([^&]+)/.exec(location.search);
  if (m) localStorage.setItem(DB_KEY, decodeURIComponent(m[1]));
} catch (e) { /* ignore */ }

export function dbUrl() {
  try { return (localStorage.getItem(DB_KEY) || DEFAULT_DB).replace(/\/$/, ''); } catch (e) { return DEFAULT_DB; }
}
export function setDbUrl(u) {
  try { if (u) localStorage.setItem(DB_KEY, u); else localStorage.removeItem(DB_KEY); } catch (e) { /* ignore */ }
}

export class FireError extends Error {
  constructor(kind, msg) { super(msg || kind); this.kind = kind; }
}

export const SV_TIME = { '.sv': 'timestamp' };
export function inc(n) { return { '.sv': { increment: n } }; }

async function req(path, { method = 'GET', body, query, timeout = 12000 } = {}) {
  const url = `${dbUrl()}/${ROOT}/${path}.json${query ? '?' + query : ''}`;
  let res;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
  try {
    res = await fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: ctl ? ctl.signal : undefined });
  } catch (e) {
    throw new FireError('network', 'ネットワークにつながりません');
  } finally { if (timer) clearTimeout(timer); }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403 || /permission/i.test(t)) throw new FireError('permission', 'データベースの書きこみが許可されていません');
    throw new FireError('http', `サーバーエラー (${res.status})`);
  }
  return res.json();
}

export const db = {
  get: (path, query) => req(path, { query }),
  put: (path, v) => req(path, { method: 'PUT', body: v }),
  patch: (path, v) => req(path, { method: 'PATCH', body: v }),
  post: (path, v) => req(path, { method: 'POST', body: v }),
  del: (path) => req(path, { method: 'DELETE' }),
};

// サーバーの時計とのずれ（ミリ秒）。両方の端末で同じ瞬間に試合を始めるのに使う
export async function measureOffset(pid) {
  let best = null;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    let v = await db.put(`clock/${pid}`, SV_TIME);
    const t1 = Date.now();
    if (typeof v !== 'number') v = await db.get(`clock/${pid}`);
    if (typeof v !== 'number') continue;
    const rtt = t1 - t0;
    const off = v - (t0 + t1) / 2;
    if (!best || rtt < best.rtt) best = { off, rtt };
    if (rtt < 150) break;
  }
  return best ? best.off : 0;
}

// path の場所に値を入れた新しいオブジェクトを返す（ストリームの put/patch 用）
function setAt(root, path, val) {
  const keys = path.split('/').filter(Boolean);
  if (!keys.length) return val;
  const out = root && typeof root === 'object' ? { ...root } : {};
  let cur = out;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cur[k] = cur[k] && typeof cur[k] === 'object' ? { ...cur[k] } : {};
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  if (val === null) delete cur[last]; else cur[last] = val;
  return out;
}

// 場所 path の変更を受け取りつづける。onData(全体のデータ)
export function listen(path, onData, onError) {
  let es = null;
  let data = null;
  let closed = false;
  let errors = 0;
  const open = () => {
    try { es = new EventSource(`${dbUrl()}/${ROOT}/${path}.json`); } catch (e) { if (onError) onError('network'); return; }
    es.addEventListener('put', (e) => {
      errors = 0;
      try { const m = JSON.parse(e.data); data = setAt(data, m.path, m.data); onData(data); } catch (err) { /* ignore */ }
    });
    es.addEventListener('patch', (e) => {
      errors = 0;
      try {
        const m = JSON.parse(e.data);
        for (const k in m.data) data = setAt(data, (m.path === '/' ? '' : m.path) + '/' + k, m.data[k]);
        onData(data);
      } catch (err) { /* ignore */ }
    });
    es.addEventListener('cancel', () => { if (onError) onError('permission'); });
    es.addEventListener('auth_revoked', () => { if (onError) onError('permission'); });
    es.onerror = () => {
      errors++;
      if (onError && errors === 3) onError('network');
    };
  };
  open();
  return {
    close() { closed = true; if (es) es.close(); },
    get data() { return data; },
    get closed() { return closed; },
  };
}

// 受け取った文字列をきれいに
export function cleanName(s, n = 10) {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n) : '';
}
