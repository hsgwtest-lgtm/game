// 保存（IndexedDB。使えなければ localStorage）
//   遊びの記録はまるごと1つの JSON にして保存する。遺伝子などの数字の列は base64 にして小さくする。
const DB = 'softevo3dB';
const STORE = 'kv';
const LS_PREFIX = 'softevo3dB/';

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}

export async function load(key) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const t = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      t.onsuccess = () => res(t.result === undefined ? null : t.result);
      t.onerror = () => rej(t.error);
    });
  } catch (e) {
    try { const s = localStorage.getItem(LS_PREFIX + key); return s ? JSON.parse(s) : null; } catch { return null; }
  }
}

export async function save(key, value) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(value, key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  } catch (e) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch { /* いっぱい */ }
  }
}

export async function remove(key) {
  try {
    const d = await db();
    await new Promise((res) => {
      const t = d.transaction(STORE, 'readwrite');
      t.objectStore(STORE).delete(key);
      t.oncomplete = () => res();
      t.onerror = () => res();
    });
  } catch { try { localStorage.removeItem(LS_PREFIX + key); } catch { /* */ } }
}

// 小さな設定（すぐ読みたいもの）
export function pref(key, def) {
  try { const v = localStorage.getItem(LS_PREFIX + 'pref/' + key); return v === null ? def : JSON.parse(v); } catch { return def; }
}
export function setPref(key, v) { try { localStorage.setItem(LS_PREFIX + 'pref/' + key, JSON.stringify(v)); } catch { /* */ } }

// 数字の列 ⇔ base64（Float64 なので、元の値と寸分違わない → 決定論の再生がずれない）
export function f64ToB64(arr) {
  const f = Float64Array.from(arr);
  const u = new Uint8Array(f.buffer);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToF64(b) {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  if (u.length % 8) throw new Error('bad length');
  return new Float64Array(u.buffer);
}
export function f32ToB64(arr) {
  const f = Float32Array.from(arr);
  const u = new Uint8Array(f.buffer);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToF32(b) {
  const s = atob(b);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  if (u.length % 4) throw new Error('bad length');
  return new Float32Array(u.buffer);
}

export function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }

// ファイルとして書き出す
export function downloadJSON(name, obj) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
