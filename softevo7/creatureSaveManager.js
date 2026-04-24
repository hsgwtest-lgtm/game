/**
 * creatureSaveManager.js
 * SoftEvo7 — IndexedDB を使った生物スロット保存モジュール
 * DB名: "SoftEvoDB"  ストア名: "creatures"
 * スロット: 1〜10
 */

const DB_NAME    = 'SoftEvoDB';
const STORE_NAME = 'creatures';
const DB_VERSION = 1;

// ─── DB 初期化（シングルトン Promise）─────────────────
let _dbPromise = null;

function getDB() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB はこの環境でサポートされていません'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // slot (1〜10) をキーとして使用
        db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
      }
    };

    req.onsuccess  = (event) => resolve(event.target.result);
    req.onerror    = (event) => {
      _dbPromise = null; // 次回リトライ可能にする
      reject(new Error(`IndexedDB オープン失敗: ${event.target.error?.message ?? '不明なエラー'}`));
    };
    req.onblocked  = () => {
      _dbPromise = null;
      reject(new Error('IndexedDB がブロックされています。タブを閉じて再試行してください'));
    };
  });

  return _dbPromise;
}

// ─── スロット番号バリデーション ────────────────────────
function validateSlot(slot) {
  const n = Number(slot);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new RangeError(`スロット番号は 1〜10 の整数である必要があります (受け取った値: ${slot})`);
  }
  return n;
}

// ─── Float32Array ↔ 通常配列の相互変換（構造化クローン対応済みだが、
//     Safari の古いバージョンでの安全のため明示的に変換）─────
function serializeGenome(genome) {
  if (!genome) return genome;
  return {
    weights: genome.weights.map(w => Array.from(w)),
    biases:  genome.biases.map(b => Array.from(b)),
  };
}

function deserializeGenome(raw) {
  if (!raw) return raw;
  return {
    weights: raw.weights.map(w => new Float32Array(w)),
    biases:  raw.biases.map(b => new Float32Array(b)),
  };
}

// ─── Public API ────────────────────────────────────────

/**
 * 指定スロットに生物データを保存（上書き可）
 * @param {number} slot  1〜10
 * @param {object} creatureData  { genome, score, generation, name }
 */
export async function saveCreature(slot, creatureData) {
  const validSlot = validateSlot(slot);

  if (!creatureData || typeof creatureData !== 'object') {
    throw new TypeError('creatureData はオブジェクトである必要があります');
  }

  const record = {
    slot:       validSlot,
    genome:     serializeGenome(creatureData.genome ?? null),
    blueprint:  creatureData.blueprint ?? null,
    score:      typeof creatureData.score      === 'number' ? creatureData.score      : 0,
    generation: typeof creatureData.generation === 'number' ? creatureData.generation : 0,
    name:       typeof creatureData.name       === 'string' ? creatureData.name       : `生物-${validSlot}`,
    savedAt:    new Date(),
  };

  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.put(record);

    req.onsuccess = () => resolve(record);
    req.onerror   = (event) =>
      reject(new Error(`スロット ${validSlot} の保存に失敗しました: ${event.target.error?.message ?? '不明なエラー'}`));
    tx.onerror    = (event) =>
      reject(new Error(`トランザクションエラー: ${event.target.error?.message ?? '不明なエラー'}`));
  });
}

/**
 * 指定スロットから生物データを読み込む
 * @param {number} slot  1〜10
 * @returns {object|null} レコード（genome は Float32Array に復元済み）、存在しない場合は null
 */
export async function loadCreature(slot) {
  const validSlot = validateSlot(slot);
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(validSlot);

    req.onsuccess = (event) => {
      const record = event.target.result ?? null;
      if (record && record.genome) {
        record.genome = deserializeGenome(record.genome);
      }
      resolve(record);
    };
    req.onerror = (event) =>
      reject(new Error(`スロット ${validSlot} の読み込みに失敗しました: ${event.target.error?.message ?? '不明なエラー'}`));
  });
}

/**
 * 全スロット（1〜10）を取得する
 * @returns {Array<object|null>} 長さ10の配列。空スロットは null
 */
export async function loadAllCreatures() {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_NAME, 'readonly');
    const store   = tx.objectStore(STORE_NAME);
    const req     = store.getAll();

    req.onsuccess = (event) => {
      const rows = event.target.result; // 保存済みレコードの配列
      const result = Array.from({ length: 10 }, (_, i) => {
        const record = rows.find(r => r.slot === i + 1) ?? null;
        if (record && record.genome) {
          record.genome = deserializeGenome(record.genome);
        }
        return record;
      });
      resolve(result);
    };
    req.onerror = (event) =>
      reject(new Error(`全スロット読み込みに失敗しました: ${event.target.error?.message ?? '不明なエラー'}`));
  });
}

/**
 * 指定スロットのデータを削除する
 * @param {number} slot  1〜10
 */
export async function deleteCreature(slot) {
  const validSlot = validateSlot(slot);
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(validSlot);

    req.onsuccess = () => resolve(true);
    req.onerror   = (event) =>
      reject(new Error(`スロット ${validSlot} の削除に失敗しました: ${event.target.error?.message ?? '不明なエラー'}`));
    tx.onerror    = (event) =>
      reject(new Error(`トランザクションエラー: ${event.target.error?.message ?? '不明なエラー'}`));
  });
}
