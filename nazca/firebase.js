/**
 * firebase.js — Firebase Realtime Database 地上絵トラックモジュール（Nazca-α）
 *
 * Firebase JS SDK v10 (CDN ESM) を動的インポートして使用します。
 * firebase-config.js の IS_FIREBASE_CONFIGURED が false の場合、
 * 全関数は安全にエラーを返します。
 */

import { FIREBASE_CONFIG, IS_FIREBASE_CONFIGURED } from './firebase-config.js';

export { IS_FIREBASE_CONFIGURED } from './firebase-config.js';

const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';

// ─── Firebase シングルトン ───────────────────────────────────────────────────
let _db = null;
let _fbRef, _fbPush, _fbGet, _fbOnValue;

async function ensureFirebase() {
  if (_db) return _db;
  if (!IS_FIREBASE_CONFIGURED) {
    throw new Error(
      'Firebase が設定されていません。nazca/firebase-config.js を編集して\n' +
      'Firebase プロジェクトの設定値を入力してください。'
    );
  }

  const { initializeApp, getApps } = await import(`${SDK_BASE}/firebase-app.js`);
  const { getDatabase, ref, push, get, onValue } =
    await import(`${SDK_BASE}/firebase-database.js`);

  const app = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  _db    = getDatabase(app);
  _fbRef = ref; _fbPush = push; _fbGet = get; _fbOnValue = onValue;
  return _db;
}

// ─── Firebase から読んだトラックを正規化 ────────────────────────────────────
// Firebase Realtime Database は配列を {0:…, 1:…} オブジェクトに変換することがある。
// path は JSON 文字列で保存しているので JSON.parse で復元する。
function deserializeTrack(key, val) {
  return {
    ...val,
    id:   key,
    path: typeof val.path === 'string' ? JSON.parse(val.path) : [],
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * トラックを投稿する
 * @param {object} track  app.js の track オブジェクト（path, title, user, stats …）
 * @returns {Promise<void>}
 */
export async function postTrack(track) {
  const db = await ensureFirebase();

  const entry = {
    title:     String(track.title  || '無題').slice(0, 50),
    user:      String(track.user   || 'Anonymous').slice(0, 20),
    date:      track.date      || new Date().toISOString().slice(0, 10),
    path:      JSON.stringify(track.path),   // 配列のまま保存（オブジェクト変換回避）
    stats:     track.stats     || { distance: 0, calories: 0 },
    startTime: track.startTime || null,
    endTime:   track.endTime   || null,
    postedAt:  Date.now(),
  };

  await _fbPush(_fbRef(db, 'tracks'), entry);
}

/**
 * トラック一覧をリアルタイム購読する
 * @param {(tracks: Array, err?: Error) => void} callback
 * @returns {() => void} 購読解除関数
 */
export function subscribeToTracks(callback) {
  let unsubFn = () => {};

  ensureFirebase()
    .then(db => {
      const unsub = _fbOnValue(
        _fbRef(db, 'tracks'),
        snapshot => {
          const tracks = [];
          if (snapshot.exists()) {
            snapshot.forEach(child => {
              tracks.push(deserializeTrack(child.key, child.val()));
            });
          }
          // 新しい投稿順に並べる
          callback(tracks.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0)));
        },
        err => callback([], err),
      );
      unsubFn = unsub;
    })
    .catch(err => callback([], err));

  return () => unsubFn();
}
