// 保存（IndexedDB）
//  creatures: 生き物ごとの記録（体・集団・成長の記録・ぼうけんのしょ）
//  champs:    世代ごとのチャンピオン（成長アルバム用）。[生き物id, 世代] がキー
//  meta:      設定など
// IndexedDB が使えない環境（古いプライベートブラウズなど）ではメモリにだけ置く。

const NAME = 'softevo3d';
const VER = 1;

let dbp = null;
const mem = { creatures: new Map(), champs: new Map(), meta: new Map() };
let memoryOnly = false;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { memoryOnly = true; resolve(null); return; }
      const req = indexedDB.open(NAME, VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('creatures')) d.createObjectStore('creatures', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('champs')) d.createObjectStore('champs', { keyPath: ['cid', 'gen'] });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { memoryOnly = true; resolve(null); };
      req.onblocked = () => { memoryOnly = true; resolve(null); };
    } catch (e) { memoryOnly = true; resolve(null); }
  });
  return dbp;
}

function tx(d, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const st = t.objectStore(store);
    let out;
    const r = fn(st);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get memoryOnly() { return memoryOnly; },

  async listCreatures() {
    const d = await open();
    if (!d) return [...mem.creatures.values()];
    try { return (await tx(d, 'creatures', 'readonly', st => st.getAll())) || []; }
    catch (e) { return []; }
  },
  async getCreature(id) {
    const d = await open();
    if (!d) return mem.creatures.get(id) || null;
    try { return (await tx(d, 'creatures', 'readonly', st => st.get(id))) || null; }
    catch (e) { return null; }
  },
  async putCreature(rec) {
    const d = await open();
    if (!d) { mem.creatures.set(rec.id, rec); return true; }
    try { await tx(d, 'creatures', 'readwrite', st => st.put(rec)); return true; }
    catch (e) { mem.creatures.set(rec.id, rec); return false; }
  },
  async deleteCreature(id) {
    const d = await open();
    mem.creatures.delete(id);
    for (const k of [...mem.champs.keys()]) if (k.startsWith(id + '/')) mem.champs.delete(k);
    if (!d) return;
    try {
      await tx(d, 'creatures', 'readwrite', st => st.delete(id));
      await tx(d, 'champs', 'readwrite', st => st.delete(IDBKeyRange.bound([id, -1], [id, 1e9])));
    } catch (e) { /* noop */ }
  },

  async putChamp(c) {
    const d = await open();
    if (!d) { mem.champs.set(c.cid + '/' + c.gen, c); return; }
    try { await tx(d, 'champs', 'readwrite', st => st.put(c)); }
    catch (e) { mem.champs.set(c.cid + '/' + c.gen, c); }
  },
  async putChamps(list) {
    if (!list.length) return;
    const d = await open();
    if (!d) { for (const c of list) mem.champs.set(c.cid + '/' + c.gen, c); return; }
    try { await tx(d, 'champs', 'readwrite', st => { let r; for (const c of list) r = st.put(c); return r; }); }
    catch (e) { for (const c of list) mem.champs.set(c.cid + '/' + c.gen, c); }
  },
  async getChamps(cid) {
    const d = await open();
    let list = [];
    if (d) {
      try { list = (await tx(d, 'champs', 'readonly', st => st.getAll(IDBKeyRange.bound([cid, -1], [cid, 1e9])))) || []; }
      catch (e) { list = []; }
    }
    for (const [k, c] of mem.champs) if (k.startsWith(cid + '/') && !list.some(x => x.gen === c.gen)) list.push(c);
    return list.sort((a, b) => a.gen - b.gen);
  },
  async deleteChamps(cid, gens) {
    const d = await open();
    for (const g of gens) mem.champs.delete(cid + '/' + g);
    if (!d || !gens.length) return;
    try { await tx(d, 'champs', 'readwrite', st => { let r; for (const g of gens) r = st.delete([cid, g]); return r; }); }
    catch (e) { /* noop */ }
  },

  async getMeta(key, def = null) {
    const d = await open();
    if (!d) return mem.meta.has(key) ? mem.meta.get(key) : def;
    try { const v = await tx(d, 'meta', 'readonly', st => st.get(key)); return v === undefined ? def : v; }
    catch (e) { return def; }
  },
  async setMeta(key, val) {
    const d = await open();
    if (!d) { mem.meta.set(key, val); return; }
    try { await tx(d, 'meta', 'readwrite', st => st.put(val, key)); }
    catch (e) { mem.meta.set(key, val); }
  },
};

export function makeId() {
  return Date.now().toString(36) + Math.floor(Math.random() * 1e8).toString(36);
}
