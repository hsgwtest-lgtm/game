// ─────────────────────────────────────────────────────────────────────
// firebase-config.js  ─  Firebase Realtime Database 設定
// ─────────────────────────────────────────────────────────────────────
//
// 【セットアップ手順】
//   1. https://console.firebase.google.com でプロジェクトを新規作成
//   2. 「Realtime Database」を有効化（ロケーション: asia-southeast1 推奨）
//   3. 「ルール」タブに以下を貼り付けて「公開」:
//      {
//        "rules": {
//          "leaderboard": { ".read": true, ".write": true }
//        }
//      }
//   4. 「プロジェクトの設定」>「マイアプリ」>「ウェブアプリを追加」
//   5. 表示された firebaseConfig の値をここにコピーする
//
// ─────────────────────────────────────────────────────────────────────

export const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyAvMx8njrhoNd2gC3r5TPRWzvi7wElHPdw',
  authDomain:        'softevo-leaderboard.firebaseapp.com',
  databaseURL:       'https://softevo-leaderboard-default-rtdb.asia-southeast1.firebasedatabase.app/',
  projectId:         'softevo-leaderboard',
  storageBucket:     'softevo-leaderboard.firebasestorage.app',
  messagingSenderId: '427957455927',
  appId:             '1:427957455927:web:b41f7ed823d9fd89ae03b2',
};

// この値が true になると Firebase 機能が有効になります
export const IS_FIREBASE_CONFIGURED =
  FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' &&
  FIREBASE_CONFIG.databaseURL.indexOf('YOUR_PROJECT_ID') === -1;

