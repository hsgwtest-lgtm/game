// 記録した場面（64×64 画像と操作）を IndexedDB に保存して、開き直しても続きから使えるようにする。
// 200 場面ずつのかたまりで保存し、変わったかたまりだけを書き直す。
const DB_NAME = 'aieye';
const STORE = 'chunks';
export const CHUNK = 200;

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in self)) { reject(new Error('IndexedDB なし')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// 保存してある場面を data/labels に読み込み、場面の数を返す
export async function loadAll(data, labels, S, max) {
  const db = await openDb();
  const keysReq = await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const r = t.objectStore(STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const keys = keysReq.filter((k) => Number.isInteger(k)).sort((a, b) => a - b);
  let n = 0;
  for (const k of keys) {
    if (k * CHUNK !== n) break; // 途中が欠けていたらそこまで
    const rec = await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const r = t.objectStore(STORE).get(k);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!rec || !rec.count) break;
    const count = Math.min(rec.count, max - n);
    data.set(new Uint8Array(rec.data, 0, count * S), n * S);
    labels.set(new Uint8Array(rec.labels, 0, count), n);
    n += count;
    if (rec.count < CHUNK || n >= max) break;
  }
  return n;
}

// 変わったかたまり（dirty の番号）だけを書く
export async function saveChunks(data, labels, n, S, dirty) {
  if (!dirty.size) return;
  const db = await openDb();
  const ks = [...dirty];
  dirty.clear();
  await tx(db, 'readwrite', (st) => {
    for (const k of ks) {
      const start = k * CHUNK;
      const count = Math.max(0, Math.min(CHUNK, n - start));
      if (count === 0) { st.delete(k); continue; }
      st.put({
        count,
        data: data.slice(start * S, (start + count) * S).buffer,
        labels: labels.slice(start, start + count).buffer,
      }, k);
    }
  });
}

export async function clearAll() {
  const db = await openDb();
  await tx(db, 'readwrite', (st) => st.clear());
}
