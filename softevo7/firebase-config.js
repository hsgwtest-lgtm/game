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
  apiKey:            'YOUR_API_KEY',
  authDomain:        'YOUR_PROJECT_ID.firebaseapp.com',
  databaseURL:       'https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'YOUR_PROJECT_ID',
  storageBucket:     'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId:             'YOUR_APP_ID',
};

// この値が true になると Firebase 機能が有効になる
export const IS_FIREBASE_CONFIGURED =
  FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' &&
  !FIREBASE_CONFIG.databaseURL.includes('YOUR_PROJECT_ID');
