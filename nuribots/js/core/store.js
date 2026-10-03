// 保存: 小さなデータは localStorage、脳（大きな数値の配列）は IndexedDB。
// IndexedDB が使えない時は localStorage に base64 で入れる。

const DB = 'nuribots';
const ST = 'kv';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(ST);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return dbp;
}

function tx(db, mode, fn) {
  return new Promise((res) => {
    try {
      const t = db.transaction(ST, mode);
      const s = t.objectStore(ST);
      const r = fn(s);
      t.oncomplete = () => res(r && 'result' in r ? r.result : true);
      t.onerror = () => res(null);
      t.onabort = () => res(null);
    } catch (e) { res(null); }
  });
}

export async function idbGet(key) {
  const db = await open();
  if (db) {
    const v = await tx(db, 'readonly', s => s.get(key));
    if (v !== null && v !== undefined) return v;
  }
  return lsGetBin(key);
}

export async function idbSet(key, val) {
  const db = await open();
  if (db) {
    const ok = await tx(db, 'readwrite', s => s.put(val, key));
    if (ok !== null) return true;
  }
  return lsSetBin(key, val);
}

export async function idbDel(key) {
  const db = await open();
  if (db) await tx(db, 'readwrite', s => s.delete(key));
  try { localStorage.removeItem('nb/bin/' + key); } catch (e) { /* ignore */ }
}

export function lsGet(key, def = null) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : def;
  } catch (e) { return def; }
}

export function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
}

// ── localStorage 版（型付き配列を base64 に）──
function enc(v) {
  if (v instanceof Float32Array) {
    const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { __f32: btoa(s) };
  }
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = enc(v[k]); return o; }
  return v;
}
function dec(v) {
  if (v && typeof v === 'object' && v.__f32) {
    const s = atob(v.__f32);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return new Float32Array(u8.buffer);
  }
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = dec(v[k]); return o; }
  return v;
}
function lsGetBin(key) {
  try { const s = localStorage.getItem('nb/bin/' + key); return s ? dec(JSON.parse(s)) : null; } catch (e) { return null; }
}
function lsSetBin(key, val) {
  try { localStorage.setItem('nb/bin/' + key, JSON.stringify(enc(val))); return true; } catch (e) { return false; }
}

// 永続化をお願いする（iOS で消えにくくする）
export function persist() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
}
