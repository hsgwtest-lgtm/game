# 🎰 Casino PWA — GitHub Copilot Implementation Prompt

## プロジェクト概要

**プロジェクト名**: Cebu Casino PWA  
**対象**: iOS Safari PWA（GitHub Pages ホスティング）  
**技術スタック**: Vanilla JS (ES Modules), HTML5 Canvas 2D, CSS3 Animation  
**構成**: マルチファイル（単一HTMLは不要）  
**レンダリング**: Canvas 2D + CSS Animation（WebGLは使用しない）

-----

## ディレクトリ構成

```
casino-pwa/
├── index.html               # ロビー画面（メインエントリ）
├── manifest.json            # PWAマニフェスト
├── sw.js                    # Service Worker（オフライン対応）
├── style/
│   └── global.css           # グローバルCSS（カラー変数・フォント・共通UI）
├── js/
│   ├── main.js              # ロビー初期化・ゲームルーター
│   ├── audio.js             # 効果音管理（Web Audio API）
│   ├── chips.js             # チップ・残高管理（共通ステート）
│   ├── card.js              # デッキ生成・カード描画（Canvas 2D）共通モジュール
│   └── utils.js             # 共通ユーティリティ（アニメ・乱数等）
├── games/
│   ├── slots/
│   │   ├── slots.html
│   │   ├── slots.js
│   │   └── slots.css
│   ├── blackjack/
│   │   ├── blackjack.html
│   │   ├── blackjack.js
│   │   └── blackjack.css
│   ├── roulette/
│   │   ├── roulette.html
│   │   ├── roulette.js
│   │   └── roulette.css
│   ├── baccarat/
│   │   ├── baccarat.html
│   │   ├── baccarat.js
│   │   └── baccarat.css
│   └── dragon-tiger/
│       ├── dragon-tiger.html
│       ├── dragon-tiger.js
│       └── dragon-tiger.css
└── assets/
    └── icons/               # PWAアイコン（192x192, 512x512）
```

-----

## デザイン方針

### ビジュアルテーマ

- **ムード**: 高級マカオ/セブスタイルカジノ。ダーク、リッチ、シネマティック
- **カラーパレット**:
  
  ```css
  --bg-deep:      #0a0a0f;
  --bg-table:     #0d2818;   /* カジノグリーン */
  --gold:         #c9a84c;
  --gold-light:   #f0d080;
  --red-dragon:   #c0392b;
  --blue-tiger:   #1a4a8a;
  --chip-white:   #f5f5f0;
  --text-primary: #f0e8d0;
  --text-muted:   #8a7a5a;
  ```
- **フォント**: Google Fonts — `Playfair Display`（見出し）+ `Crimson Pro`（本文）
- **雰囲気**: ベルベット質感、金縁装飾、チップの光沢感
- **アニメーション**: CSS `@keyframes` + JS `requestAnimationFrame` で統一

-----

## 共通実装仕様

### PWA設定（manifest.json）

```json
{
  "name": "Cebu Casino",
  "short_name": "Casino",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0a0a0f",
  "theme_color": "#c9a84c",
  "start_url": "/",
  "icons": [
    { "src": "assets/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "assets/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### iOS PWA対応（全HTMLのheadに必須）

```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="apple-touch-icon" href="../../assets/icons/icon-192.png">
```

### チップ残高（chips.js）

```js
export const Chips = {
  get balance() { return parseInt(localStorage.getItem('casino_balance') || '10000'); },
  add(amount)   { localStorage.setItem('casino_balance', this.balance + amount); },
  subtract(amount) { localStorage.setItem('casino_balance', this.balance - amount); },
  reset()       { localStorage.setItem('casino_balance', '10000'); }
};
```

### カード共通モジュール（card.js）

```js
const SUITS  = ['♠', '♥', '♦', '♣'];
const RANKS  = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

export function createDeck(numDecks = 1) {
  const deck = [];
  for (let d = 0; d < numDecks; d++)
    for (const suit of SUITS)
      for (const rank of RANKS)
        deck.push({ suit, rank });
  return shuffle(deck);
}

export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Canvas 2D でカードを描画（共通）
// w, h はカードサイズ（例: 80x120px）
export function drawCard(ctx, card, x, y, w, h, faceUp = true) {
  const r = 8; // 角丸半径
  // カード背景
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = faceUp ? '#fdf8f0' : '#1a3a6a';
  ctx.fill();
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (faceUp) {
    const isRed = card.suit === '♥' || card.suit === '♦';
    ctx.fillStyle = isRed ? '#c0392b' : '#1a1a2e';
    ctx.font = `bold ${w * 0.25}px 'Crimson Pro', serif`;
    ctx.fillText(card.rank, x + 6, y + w * 0.28);
    ctx.font = `${w * 0.22}px serif`;
    ctx.fillText(card.suit, x + 6, y + w * 0.48);
    // 中央スート
    ctx.font = `${w * 0.45}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(card.suit, x + w / 2, y + h * 0.65);
    ctx.textAlign = 'left';
  } else {
    // 裏面パターン（斜線格子）
    ctx.strokeStyle = '#4a6a9a';
    ctx.lineWidth = 1;
    for (let i = -h; i < w + h; i += 8) {
      ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i - h, y + h); ctx.stroke();
    }
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
```

-----

## ゲーム別実装仕様

-----

### 🎰 1. スロット（slots.js）

#### 描画方式

Canvas 2D でリールを縦スクロール描画。外部ライブラリ不要。

#### シンボル定義

```js
const SYMBOLS = ['🍒', '🔔', '💎', '7️⃣', '⭐', '🃏', '🍋', '🍇'];
// 各シンボルの出現重み（低いほどレア）
const WEIGHTS  = [  30,   20,    5,    8,   15,   10,   25,   20];
```

#### リール構造

- リール数: 3本
- 表示行数: 3行（上・中・下）、中央行がペイライン
- 各リールは仮想的に20コマのシンボル配列を持ち、スクロール位置で表示シンボルを決定

#### スピンアニメ

```js
// 各リールのスピン速度（px/frame）は徐々に減速
// 停止順: リール1 → 0.6s後 リール2 → 0.6s後 リール3
// 停止時にバウンス（少し行き過ぎてから戻る）
```

#### ペイアウト表

```js
const PAYOUTS = {
  '💎💎💎': 50,   // ベット×50
  '7️⃣7️⃣7️⃣': 20,
  '🔔🔔🔔': 10,
  '⭐⭐⭐':   5,
  '🃏🃏🃏':   5,
  '🍇🍇🍇':  4,
  '🍋🍋🍋':  3,
  '🍒🍒🍒':  3,
  '🍒🍒_':   1,   // 🍒が左2つ揃い
  '🍒__':    0.5, // 🍒が左1つ
};
// ペイラインは中央行のみ（シンプル実装）
```

#### UI要素

- SPIN ボタン（大型・ゴールド）、スピン中はグレーアウト
- ベット選択: 10 / 50 / 100 / 500 チップボタン
- 残高・当選額の表示
- 当選時: ペイライン（中央）をゴールドで光らせる CSS アニメ

-----

### 🃏 2. ブラックジャック（blackjack.js）

#### ゲーム概要

プレイヤーとディーラーが手札の合計を21に近づけ、超えずに高い方が勝つカードゲーム。

#### デッキ設定

- 6デッキ（312枚）使用（カジノ標準）
- シャッフルタイミング: 残り52枚を切ったら自動リシャッフル

#### カードの値

```
A   = 1 または 11（手札が21を超えない範囲で11として計算）
2-9 = 額面通り
10, J, Q, K = 10
```

#### ハンドスコア計算

```js
function calcScore(hand) {
  let score = 0, aces = 0;
  for (const card of hand) {
    if (card.rank === 'A') { aces++; score += 11; }
    else if (['10','J','Q','K'].includes(card.rank)) score += 10;
    else score += parseInt(card.rank);
  }
  while (score > 21 && aces > 0) { score -= 10; aces--; }
  return score;
}
// ソフトハンド: Aが11として計算されている状態
// ハードハンド: Aが1として計算されている状態
```

#### ゲームフロー

```
1. ベット確定
2. 初期配布: プレイヤー表2枚、ディーラー表1枚＋裏1枚
3. ブラックジャック判定（初期手札がA+10系）
4. プレイヤーのアクション選択フェーズ
5. ディーラーのアクション（プレイヤーがバストしていない場合）
6. 結果判定・ペイアウト
```

#### プレイヤーアクション

```
HIT        : 1枚追加。21超えでバスト（即負け）
STAND      : これ以上引かずディーラーへ
DOUBLE DOWN: ベット2倍にして1枚だけ追加、その後自動スタンド
             （最初の2枚の時のみ可能）
SPLIT      : 同じランク2枚の時、2つのハンドに分割しベット追加
             Aのスプリットは各1枚のみ追加（再スプリット不可）
SURRENDER  : 最初の2枚でのみ可能。ベットの半分を回収して降伏
             （ディーラーのアップカードがA/10系の場合に有効）
INSURANCE  : ディーラーのアップカードがAの場合のみ
             サイドベット（ベットの半分）でディーラーBJに備える
             ディーラーBJ → 2:1ペイ、それ以外 → サイドベット没収
```

#### ディーラールール

```
- ソフト17（A+6）でもヒット（S17ルール）
- ハード17以上でスタンド
- プレイヤー全員バスト → ディーラーはアクション不要
- ディーラーはブラックジャックの場合、プレイヤーのアクション前に公開
```

#### 結果判定・ペイアウト

```
プレイヤーBJ（ディーラーBJなし）: ベット × 1.5（3:2）
プレイヤー勝ち（通常）          : ベット × 1（1:1）
引き分け（Push）                : ベット返却
プレイヤー負け / バスト         : ベット没収
ディーラーBJ（プレイヤーBJなし）: ベット没収
両者BJ                          : Push
```

#### Canvas描画

- テーブル上部: ディーラーエリア（裏向きカード含む）
- テーブル下部: プレイヤーエリア
- スプリット時: 左右にハンドを分けて表示
- カード配布アニメ: 右上から各エリアへスライドイン（CSS transform）

-----

### 🎡 3. ルーレット（roulette.js）

#### ゲーム概要

0〜36の番号が書かれたホイールにボールを投げ、止まった番号でベットを判定する。

#### ホイール番号配列（ヨーロピアン・シングルゼロ）

```js
const WHEEL = [
  0,32,15,19,4,21,2,25,17,34,6,27,13,36,
  11,30,8,23,10,5,24,16,33,1,20,14,31,9,
  22,18,29,7,28,12,35,3,26
]; // 時計回りの実際の配置順
```

#### 数字の色定義

```js
const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
// 0はグリーン、それ以外はBLACK
function getColor(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.includes(n) ? 'red' : 'black';
}
```

#### Canvas描画

- ホイール: `arc()` で37等分の扇形を描画、赤・黒・緑で塗り分け
- 番号テキスト: 各セクター中央に白文字
- ボール: `arc()` で小円、ホイールの回転に合わせて座標計算
- ベッティングテーブル: Canvas 2D でグリッド描画（タップ判定はCanvas座標変換）

#### ホイールアニメ

```js
// wheelAngle を毎フレーム加算（初期: 高速）→ イージングで減速
// ballAngle は逆方向に高速回転 → 減速しながら外縁から内側へ
// 停止時の番号 = WHEEL[Math.floor((ballAngle / (2π)) * 37) % 37]
```

#### ベット種別と配当

```js
const BET_TYPES = {
  // インサイドベット
  straight : { count: 1,  payout: 35 }, // 1点買い
  split    : { count: 2,  payout: 17 }, // 2点境界線
  street   : { count: 3,  payout: 11 }, // 横3点
  corner   : { count: 4,  payout: 8  }, // 4点コーナー
  line     : { count: 6,  payout: 5  }, // 6点ライン
  // アウトサイドベット
  column   : { count: 12, payout: 2  }, // 縦列12点
  dozen    : { count: 12, payout: 2  }, // 1st/2nd/3rd Dozen
  red      : { count: 18, payout: 1  },
  black    : { count: 18, payout: 1  },
  odd      : { count: 18, payout: 1  },
  even     : { count: 18, payout: 1  },
  low      : { count: 18, payout: 1  }, // 1-18
  high     : { count: 18, payout: 1  }, // 19-36
};
// 0はred/black/odd/even/low/highすべて外れ
```

#### ベット管理

```js
// 複数ベット同時可能（bets配列で管理）
// ベット確定後はSPINボタン押下まで変更可能
// スピン中はベット変更不可（ロック）
// CLEAR ボタンで全ベット削除
```

-----

### 🎴 4. バカラ（baccarat.js）

#### ゲーム概要

プレイヤーとバンカーの2サイドが手札を引き、9に近い方が勝つ。プレイヤーはどちらが勝つかに賭ける。

#### デッキ設定

- 8デッキ（416枚）使用（カジノ標準）
- カットカード: 残り約312枚でリシャッフル

#### カードの値

```
A           = 1
2-9         = 額面通り
10, J, Q, K = 0（テンカードと呼ぶ）
合計の1の位が得点（例: 7+8=15 → 5点）
```

#### ゲームフロー（完全な Third Card Rule）

**フェーズ1: 初期配布**

```
配布順: Player1枚 → Banker1枚 → Player2枚 → Banker2枚
（交互に配布するのが正式）
```

**フェーズ2: ナチュラル判定**

```
Player または Banker の合計が 8 または 9 → ナチュラル
ナチュラルの場合: 3枚目は引かずに即結果判定
両者ナチュラル: 高い方が勝ち（同点はタイ）
```

**フェーズ3: Playerの3枚目ルール**

```
Playerの合計 0-5 → 3枚目を引く
Playerの合計 6-7 → スタンド（引かない）
```

**フェーズ4: Bankerの3枚目ルール（Playerが引いた場合）**

```
Playerが3枚目を引いた場合、Bankerのドローはその3枚目の値に依存:

Banker合計 0-2 → 常にドロー
Banker合計 3   → Playerの3枚目が 8 以外 → ドロー
Banker合計 4   → Playerの3枚目が 2-7   → ドロー
Banker合計 5   → Playerの3枚目が 4-7   → ドロー
Banker合計 6   → Playerの3枚目が 6-7   → ドロー
Banker合計 7   → スタンド（常に）

Playerがスタンドした場合（合計6-7）:
Banker合計 0-5 → ドロー
Banker合計 6-7 → スタンド
```

#### 結果判定・ペイアウト

```
Player勝ち : ベット × 1（1:1、コミッションなし）
Banker勝ち : ベット × 0.95（5%コミッション差し引き）
Tie        : ベット × 8（8:1）、Player/Bankerベットは返却

オプションサイドベット:
Player Pair: 最初の2枚が同ランク → 11:1
Banker Pair: 最初の2枚が同ランク → 11:1
```

#### 路単（ビーズロード）履歴表示

```
過去の結果を縦6行×横n列のグリッドで表示
P = 青丸（Player勝ち）
B = 赤丸（Banker勝ち）
T = 緑丸（Tie）
縦6つ埋まったら次の列へ
```

#### Canvas描画

- テーブル中央: PLAYER エリア（左）と BANKER エリア（右）
- カードは横向きにスライドイン
- スコア表示: 各エリア下に大きく数字

-----

### 🐉 5. ドラゴンタイガー（dragon-tiger.js）

#### ゲーム概要

ドラゴンとタイガーに1枚ずつカードを配り、高い方が勝つ。バカラを極限までシンプルにしたゲーム。

#### カードランク（強さ順）

```
A（最弱）< 2 < 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K（最強）
スートは関係なし（Suited Tie判定のみ使用）
```

#### デッキ設定

- 8デッキ（416枚）使用
- リシャッフル: 残り約100枚で実施

#### ゲームフロー

```
1. プレイヤーがベット選択（Dragon / Tiger / Tie / Suited Tie）
2. Dragon に1枚、Tiger に1枚配布（表向き同時公開）
3. ランク比較 → 高い方が勝ち
4. 同ランク → Tie（スートは問わない）
5. ペイアウト
```

#### ペイアウト

```
Dragon 勝ち（Dragonにベット）: 1:1
                               ※ Tie時はベットの50%没収（半返し）
Tiger 勝ち（Tigerにベット） : 1:1
                               ※ Tie時はベットの50%没収（半返し）
Tie（Tieにベット）          : 8:1
Suited Tie（同ランク同スート）: 50:1
  ※ Suited Tieは8デッキでは理論上発生するが極めて稀
```

#### Tieの半返しルール（重要）

```js
// Dragon または Tiger にベットしていてTieになった場合:
function resolveTie(betAmount) {
  // ベットの50%を返却（50%没収）
  Chips.add(Math.floor(betAmount / 2));
}
```

#### 演出

```
Dragon勝利: ドラゴン側をゴールドで縁取り + CSS glow アニメ
Tiger勝利 : タイガー側をゴールドで縁取り + CSS glow アニメ
Tie       : 両サイドをグリーンで縁取り
カード公開: 裏向きで配置後、タイムラグをつけて表向きにフリップ（CSS transform rotateY）
```

#### Canvas描画

- 画面を左右に2分割: Dragon（赤）/ Tiger（青）
- 各サイド中央に大きくカード1枚
- 上部: DRAGON / TIGER のロゴテキスト
- カードの下: ランクをテキストで大きく表示

-----

## ロビー（index.html / main.js）

### 構成

- 5つのゲームカードをグリッド表示（CSS Grid）
- 残高表示（画面上部固定）
- タップでゲームページへ遷移（`location.href`）
- 各ゲームカードにアイコン絵文字 + ゲーム名 + 最低ベット額

### レイアウト案

```
┌─────────────────────────────┐
│  CEBU CASINO    💰 ¥10,000  │
├──────────┬──────────────────┤
│ 🎰        │ 🃏              │
│ SLOTS     │ BLACKJACK       │
│ min: ¥10  │ min: ¥100       │
├──────────┼──────────────────┤
│ 🎡        │ 🎴              │
│ ROULETTE  │ BACCARAT        │
│ min: ¥100 │ min: ¥100       │
├──────────┴──────────────────┤
│      🐉 DRAGON TIGER        │
│          min: ¥100          │
└─────────────────────────────┘
```

-----

## 効果音（audio.js）

Web Audio API で合成音を生成（外部ファイル不要）:

```js
export function createAudioContext() {
  return new (window.AudioContext || window.webkitAudioContext)();
  // iOS: ユーザーのタップイベント内で .resume() を呼ぶこと
}

// chipPlace() : 短い正弦波クリック（コインを置く音）
// cardFlip()  : 短いホワイトノイズ（カードをめくる音）
// win()       : 明るい上昇アルペジオ（C-E-G-C）
// bigWin()    : ファンファーレ風（より長く豪華に）
// lose()      : 低い下降トーン
// spin()      : ホワイトノイズ（リールまたはホイール回転中）
// ballRoll()  : 高周波ノイズ（ルーレットボール転がり）
```

-----

## パフォーマンス指針

|対策        |内容                                                    |
|----------|------------------------------------------------------|
|Canvas サイズ|`devicePixelRatio` 考慮で高解像度描画（`canvas.width = w * dpr`）|
|アニメループ    |ゲーム離脱時に `cancelAnimationFrame` で必ず停止                  |
|Canvas 再描画|変化した部分だけ `clearRect` + 再描画（全画面クリアを避ける）                |
|DOM要素数    |カード等は DOM でなく Canvas に描画してDOM肥大化を防ぐ                   |
|タッチ遅延     |`touch-action: none` + `touchstart` でタップ遅延300ms排除     |
|フォント読み込み  |FontFace API で確認後に Canvas描画開始                         |

-----

## 実装優先順位

1. **chips.js** + **card.js** + **global.css** — 共通基盤
1. **ロビー** (index.html + main.js)
1. **🐉 ドラゴンタイガー** — カード1枚×2、最シンプル
1. **🃏 ブラックジャック** — カード描画・フリップの完成形
1. **🎴 バカラ** — ブラックジャックの card.js を流用
1. **🎰 スロット** — Canvas スクロールアニメ
1. **🎡 ルーレット** — ホイール描画が最複雑

-----

## 完成イメージ

- 起動時: タイトルロゴがゴールドでフェードイン → ロビーへ
- ゲーム選択: タップ後、CSS トランジションでテーブルが展開
- 全体トーン: 「夜のマカオ VIPルーム」の空気感
- カード系ゲームは `card.js` を共有することでデザイン一貫性を保つ