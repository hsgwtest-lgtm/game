/* =====================================================================
   SoftEvo 8 — store.js
   ローカル保存 (localStorage) と ファイル書き出し/読み込み
   ===================================================================== */
const INDEX_KEY = 'softevo8/index';
const RUN_KEY = id => `softevo8/run/${id}`;

export function f32ToB64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToF32(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); return true; } catch { return false; }
}

export function listRuns() {
  try { return JSON.parse(safeGet(INDEX_KEY) || '[]'); } catch { return []; }
}

export function loadRun(id) {
  try { const s = safeGet(RUN_KEY(id)); return s ? JSON.parse(s) : null; } catch { return null; }
}

/** 保存: 成功なら true。容量不足なら古い履歴を間引いて再挑戦 */
export function saveRun(data, meta) {
  let json = JSON.stringify(data);
  if (!safeSet(RUN_KEY(data.id), json)) {
    const slim = { ...data, genomes: data.genomes.slice(-12), cladeHistory: data.cladeHistory.filter((_, i) => i % 3 === 0) };
    json = JSON.stringify(slim);
    if (!safeSet(RUN_KEY(data.id), json)) return false;
  }
  const idx = listRuns().filter(r => r.id !== data.id);
  idx.unshift({ ...meta, id: data.id, updated: Date.now(), size: json.length });
  safeSet(INDEX_KEY, JSON.stringify(idx));
  return true;
}

export function deleteRun(id) {
  try { localStorage.removeItem(RUN_KEY(id)); } catch { /* ignore */ }
  safeSet(INDEX_KEY, JSON.stringify(listRuns().filter(r => r.id !== id)));
}

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function pickJSONFile() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return reject(new Error('no file'));
      f.text().then(t => resolve(JSON.parse(t))).catch(reject);
    };
    inp.click();
  });
}

const NA = ['プニ', 'モチ', 'ポヨ', 'ピコ', 'ムニ', 'フワ', 'ペタ', 'ヌル', 'コロ', 'ぷる', 'トコ', 'ミル', 'ピピ', 'グニ'];
const NB = ['ロン', 'タン', 'ミン', 'スケ', 'ボウ', 'ゾウ', 'ノスケ', 'ピー', 'マル', 'ン', 'リン', 'ゴン', 'チ'];
export function randomName() {
  return NA[(Math.random() * NA.length) | 0] + NB[(Math.random() * NB.length) | 0];
}
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
