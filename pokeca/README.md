# ポケカ番号サーチ

カード左下の表記（例: `sv3 066/108`）だけからポケモンカード（日本語版）を特定するPWA。

- エキスパンション記号 + 番号 で1枚に確定。記号を省略しても「番号/総数」から候補を出す
- `sv3 066/108` や `001/SV-P` をまとめて貼り付けても自動分解
- カメラでリアルタイム検知：枠に左下を合わせるだけで連続OCR → 実在カードと照合 → 直近4フレーム中2回一致で確定（Tesseract.js をCDNから初回ロード）
  - カードを替えればそのまま続けて読める連続スキャン、トーチ対応端末ではライトON/OFF
- 索引はオフライン動作（Service Worker）。カード画像は TCGdex assets から取得してキャッシュ
- `#sv3 066/108` のようにURLハッシュで直接検索も可

## データ更新

```
git clone --depth 1 https://github.com/tcgdex/cards-database
python3 tools/build_data.py cards-database/data-asia data
```

`build_data.py` は TypeScript を実行せず、テキストとして解析して `data/index.json`（弾・名前の索引）と
`data/sets/<弾>.json`（ワザ・特性などの詳細）を生成する。更新後は `sw.js` の `VER` を上げる。
