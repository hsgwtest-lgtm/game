/**
 * leaderboard.js — Firebase Realtime Database リーダーボードモジュール
 *
 * Firebase JS SDK v10 (CDN ESM) を動的インポートして使用します。
 * firebase-config.js の IS_FIREBASE_CONFIGURED が false の場合、
 * 全関数は安全にエラーを返します。
 */

import { FIREBASE_CONFIG, IS_FIREBASE_CONFIGURED } from './firebase-config.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';

// ─── Firebase シングルトン ───────────────────────────────────────────
let _db = null;
let _fbRef, _fbPush, _fbGet, _fbOnValue;

async function ensureFirebase() {
  if (_db) return _db;
  if (!IS_FIREBASE_CONFIGURED) {
    throw new Error(
      'Firebase が設定されていません。softevo7/firebase-config.js を編集して\n' +
      'Firebase プロジェクトの設定値を入力してください。'
    );
  }

  const { initializeApp, getApps } = await import(`${SDK_BASE}/firebase-app.js`);
  const {
    getDatabase, ref, push, get, onValue,
  } = await import(`${SDK_BASE}/firebase-database.js`);

  const app = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  _db = getDatabase(app);
  _fbRef = ref; _fbPush = push;
  _fbGet = get; _fbOnValue = onValue;
  return _db;
}

// ─── ゲノムのシリアライズ (Float32Array → 通常配列) ──────────────────
function serializeGenomeForDB(genome) {
  if (!genome) return null;
  return {
    weights: genome.weights.map(w => Array.from(w)),
    biases:  genome.biases.map(b => Array.from(b)),
  };
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * リーダーボードにエントリを投稿する
 * @param {{ nickname:string, score:number, generation:number, genome:object, blueprint:object|null }} data
 * @returns {Promise<object>} 投稿されたレコード
 */
export async function postEntry(data) {
  const db = await ensureFirebase();

  if (!data.genome?.weights || !data.genome?.biases) {
    throw new TypeError('genome.weights / genome.biases が必要です');
  }

  const entry = {
    nickname:   String(data.nickname  ?? 'Anonymous').slice(0, 20),
    score:      Number(data.score)      || 0,
    generation: Number(data.generation) || 0,
    genome:     serializeGenomeForDB(data.genome),
    blueprint:  data.blueprint ?? null,
    createdAt:  Date.now(),
  };

  await _fbPush(_fbRef(db, 'leaderboard'), entry);
  return entry;
}

/**
 * 上位エントリをスコア降順で取得する（一回取得）
 * @param {number} limit 取得件数上限 (default: 20)
 * @returns {Promise<Array>}
 */
export async function fetchTop(limit = 20) {
  const db = await ensureFirebase();

  const snapshot = await _fbGet(_fbRef(db, 'leaderboard'));
  if (!snapshot.exists()) return [];

  const entries = [];
  snapshot.forEach(child => entries.push({ id: child.key, ...child.val() }));
  return entries.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * リーダーボードをリアルタイム購読する
 * @param {(entries:Array, err?:Error)=>void} callback
 * @param {number} limit
 * @returns {()=>void} 購読解除関数
 */
export function subscribeTop(callback, limit = 20) {
  let unsubFn = () => {};

  ensureFirebase()
    .then(db => {
      const unsub = _fbOnValue(
        _fbRef(db, 'leaderboard'),
        snapshot => {
          const entries = [];
          if (snapshot.exists()) {
            snapshot.forEach(child => entries.push({ id: child.key, ...child.val() }));
          }
          callback(entries.sort((a, b) => b.score - a.score).slice(0, limit));
        },
        err => callback([], err),
      );
      unsubFn = unsub;
    })
    .catch(err => callback([], err));

  return () => unsubFn();
}
