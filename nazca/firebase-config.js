// ─────────────────────────────────────────────────────────────────────────────
// firebase-config.js  ─  Firebase Realtime Database 設定（Nazca-α）
// ─────────────────────────────────────────────────────────────────────────────
//
// 【セットアップ手順】
//   1. https://console.firebase.google.com でプロジェクトを新規作成
//   2. 「Realtime Database」を有効化（ロケーション: asia-southeast1 推奨）
//   3. 「ルール」タブに以下を貼り付けて「公開」:
//      {
//        "rules": {
//          "tracks": { ".read": true, ".write": true }
//        }
//      }
//   4. 「プロジェクトの設定」>「マイアプリ」>「ウェブアプリを追加」
//   5. 表示された firebaseConfig の値をここにコピーする
//
// ─────────────────────────────────────────────────────────────────────────────

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCETBs5fWk3-1PvFVS1-3E7OnmY5SStjHA",
  authDomain: "nazca-552fe.firebaseapp.com",
  databaseURL: "https://nazca-552fe-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "nazca-552fe",
  storageBucket: "nazca-552fe.firebasestorage.app",
  messagingSenderId: "12403224283",
  appId: "1:12403224283:web:9a397fb3597176a6bb26fe",
  measurementId: "G-DQ9NRX50S2"
};

// この値が true になると Firebase 機能が有効になります
export const IS_FIREBASE_CONFIGURED =
  FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' &&
  FIREBASE_CONFIG.databaseURL.indexOf('YOUR_PROJECT_ID') === -1;
