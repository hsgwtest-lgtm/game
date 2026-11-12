// キャンペーンの30ステージ（5章×6）。章の最後は「今の手札では苦しい」門で、越えると新しい手法がもらえる
const T = (f, t, dir = 1) => ({ type: 'thr', f, t, dir });
const R = 0, S = 1, H = 2, V = 3, G = 4, F = 5; // 赤さ・大きさ・角・速さ・光・高さ

export const CHAPTERS = [
  { name: '第1章　線を引く', sub: '線形' },
  { name: '第2章　たずねて分ける', sub: '決定木' },
  { name: '第3章　似たものさがし', sub: 'k近傍法' },
  { name: '第4章　曲げて分ける', sub: 'ニューラルネット' },
  { name: '第5章　みんなで決める', sub: '森' },
];

// pool:見本の列の人数 / budget:見本にできる数 / noise:答えが間違っている見本の数
// ★1: 正解率が pass 以上 / ★2: s2（ふつう 0.9）以上 / ★3: ★2 を見本 par 体以下で
// par は tools/calibrate.mjs の結果を目安に決めた
export const STAGES = [
  // ── 第1章
  { name: 'はじめての門', hint: '大きいものを止める', rule: T(S, 0.5), lenses: [S, R], cards: ['linear'], pool: 10, budget: 4, par: 2,
    lesson: '列の訪問者をタップして「見本」にしよう。門番はその見本だけを見て学ぶ。' },
  { name: '足して決まる', hint: '大きさ＋速さ の合計が大きいものを止める', rule: { type: 'sum', fs: [S, V], t: 1.0 }, lenses: [S, V], cards: ['linear'], pool: 12, budget: 5, par: 3,
    lesson: '線形は、レンズごとの重みを足し合わせる。線の太さが重みの大きさ。' },
  { name: '重みのちがい', hint: '赤さが強く効き、光は少しだけ効く', rule: { type: 'sum', fs: [R, G], ws: [0.8, 0.2], t: 0.5 }, lenses: [R, G], cards: ['linear'], pool: 12, budget: 5, par: 3,
    lesson: '効き方がちがうと、線の太さもちがってくる。' },
  { name: 'じゃまなレンズ', hint: '角が2本以上のものを止める（ほかは関係ない）', rule: T(H, 0.4), lenses: [R, S, H, V, G, F], cards: ['linear'], pool: 12, budget: 4, par: 3,
    lesson: '関係ないレンズは外せる。レンズをタップして、見るものをしぼろう。' },
  { name: '四つの合計', hint: '赤さ＋大きさ＋速さ＋光 の合計が大きいものを止める', rule: { type: 'sum', fs: [R, S, V, G], t: 2.0 }, lenses: [R, S, V, G], cards: ['linear'], pool: 16, budget: 8, par: 6,
    lesson: 'レンズが多くても、足し算で決まるなら線形は強い。' },
  { name: 'かどのある門', hint: '赤くて、しかも大きいものだけ止める', rule: { type: 'and', parts: [T(R, 0.55), T(S, 0.5)] }, lenses: [R, S], cards: ['linear'], pool: 14, budget: 7, par: 5, pass: 0.75, boss: true, reward: 'tree',
    lesson: '「かつ」の境目には角がある。線1本では角を丸めることしかできない。' },
  // ── 第2章
  { name: 'かつ', hint: '赤くて、しかも大きいものだけ止める', rule: { type: 'and', parts: [T(R, 0.55), T(S, 0.5)] }, lenses: [R, S], cards: ['linear', 'tree'], pool: 14, budget: 6, par: 4,
    lesson: '決定木は質問を重ねる。深さ2なら「赤い？→大きい？」と2回たずねられる。' },
  { name: 'または', hint: '角が3本以上、または光るものを止める', rule: { type: 'or', parts: [T(H, 0.6), T(G, 0.7)] }, lenses: [H, G, S], cards: ['linear', 'tree'], pool: 14, budget: 6, par: 4 },
  { name: '中くらいだけ', hint: '大きさが中くらいのものだけ止める', rule: { type: 'band', f: S, lo: 0.35, hi: 0.7 }, lenses: [S, V], cards: ['linear', 'tree'], pool: 14, budget: 6, par: 4,
    lesson: '「中くらい」は線1本では囲めない。同じレンズに2回たずねればよい。' },
  { name: 'ななめは苦手', hint: '赤さ＋大きさ の合計が大きいものを止める', rule: { type: 'sum', fs: [R, S], t: 1.0 }, lenses: [R, S], cards: ['linear', 'tree'], pool: 14, budget: 6, par: 4,
    lesson: '決定木はまっすぐにしか切れない。ななめの境目は階段になる。手法を選ぼう。' },
  { name: '三つの質問', hint: '（赤くて大きい）または 速いものを止める', rule: { type: 'or', parts: [{ type: 'and', parts: [T(R, 0.5), T(S, 0.5)] }, T(V, 0.8)] }, lenses: [R, S, V, F], cards: ['linear', 'tree'], pool: 18, budget: 10, par: 9 },
  { name: '飛び地', hint: '赤さも大きさも中くらいの「ある姿」に近いものだけ止める', rule: { type: 'blob', fs: [R, S], c: [0.45, 0.55], r: 0.26 }, lenses: [R, S], cards: ['linear', 'tree'], pool: 16, budget: 7, par: 6, pass: 0.75, boss: true, reward: 'knn',
    lesson: '丸い飛び地を、まっすぐな切り口で囲むのは骨が折れる。' },
  // ── 第3章
  { name: '似ていれば止める', hint: '赤さも大きさも中くらいの「ある姿」に近いものだけ止める', rule: { type: 'blob', fs: [R, S], c: [0.45, 0.55], r: 0.26 }, lenses: [R, S], cards: ['tree', 'knn'], pool: 20, budget: 8, par: 6,
    lesson: 'k近傍法は学習しない。見本を覚えて、似ている見本の答えをまねるだけ。' },
  { name: 'ふたつの巣', hint: '止める姿が2種類ある', rule: { type: 'or', parts: [{ type: 'blob', fs: [R, S], c: [0.2, 0.25], r: 0.2 }, { type: 'blob', fs: [R, S], c: [0.75, 0.7], r: 0.22 }] }, lenses: [R, S], cards: ['tree', 'knn'], pool: 18, budget: 8, par: 6 },
  { name: '変装', hint: '光って速いものを止める。ただし見本の答えが2体まちがっている', rule: { type: 'sum', fs: [G, V], t: 1.0 }, lenses: [G, V], cards: ['knn'], pool: 16, budget: 10, par: 6, noise: 2,
    lesson: 'k=1 はまちがった見本もそのまま信じる。k を増やすと多数決になる。' },
  { name: 'まどわすレンズ', hint: '角と高さだけで決まる。ほかのレンズは関係ない', rule: { type: 'blob', fs: [H, F], c: [0.75, 0.7], r: 0.34 }, lenses: [R, S, H, V, G, F], cards: ['knn'], pool: 18, budget: 8, par: 6,
    lesson: 'k近傍法は「似ている」を全部のレンズで測る。関係ないレンズは外そう。' },
  { name: '片方だけ', hint: '「赤い」「大きい」のどちらか片方だけ当てはまるものを止める', rule: { type: 'xor', parts: [T(R, 0.5), T(S, 0.5)] }, lenses: [R, S], cards: ['linear', 'tree', 'knn'], pool: 20, budget: 9, par: 8,
    lesson: '止める場所がななめ向かいに2つある。線1本では絶対に分けられない形。' },
  { name: '三つの合計の帯', hint: '赤さ＋大きさ＋速さ の合計が中くらいのものを止める', rule: { type: 'dband', fs: [R, S, V], c: 1.5, w: 0.3 }, lenses: [R, S, V], cards: ['linear', 'tree', 'knn'], pool: 20, budget: 10, par: 9, pass: 0.7, s2: 0.8, boss: true, reward: 'nn',
    lesson: 'ななめの帯が3つのレンズにまたがる。覚えるだけでは見本が足りない。' },
  // ── 第4章
  { name: '曲げて分ける', hint: '赤さ＋大きさ の合計が中くらいのものを止める', rule: { type: 'dband', fs: [R, S], c: 1.0, w: 0.22 }, lenses: [R, S], cards: ['tree', 'knn', 'nn'], pool: 18, budget: 9, par: 7,
    lesson: 'ニューラルネットは中間の層で線を何本か作り、組み合わせる。重みは少しずつ動いて決まる。' },
  { name: '三つの合計の帯、再び', hint: '赤さ＋大きさ＋速さ の合計が中くらいのものを止める', rule: { type: 'dband', fs: [R, S, V], c: 1.5, w: 0.3 }, lenses: [R, S, V], cards: ['knn', 'nn'], pool: 20, budget: 11, par: 9 },
  { name: '波', hint: '高さが、赤さにつれて波打つ境目より上のものを止める', rule: { type: 'wave', fx: R, fy: F, base: 0.5, amp: 0.36, freq: 1.5 }, lenses: [R, F], cards: ['tree', 'knn', 'nn'], pool: 20, budget: 10, par: 9 },
  { name: '中間の数', hint: '（赤さ＋光が大きい）か（大きさ＋速さが大きい）の、片方だけ', rule: { type: 'xor', parts: [{ type: 'sum', fs: [R, G], t: 1.0 }, { type: 'sum', fs: [S, V], t: 1.0 }] }, lenses: [R, S, V, G], cards: ['knn', 'nn'], pool: 20, budget: 12, par: 11, pass: 0.75, s2: 0.85,
    lesson: '中間の数を増やすと複雑な形も作れる。ただし見本が少ないと形が暴れる。' },
  { name: '少ない見本', hint: '赤さ＋大きさ＋光 の合計が大きいものを止める', rule: { type: 'sum', fs: [R, S, G], t: 1.5 }, lenses: [R, S, G], cards: ['linear', 'knn', 'nn'], pool: 14, budget: 4, par: 3,
    lesson: '見本が4体しかない。こういうときに頼れるのはどの手法か。' },
  { name: 'うそつきの列', hint: '大きさ＋光 の合計が大きいものを止める。ただし見本の答えが3体まちがっている', rule: { type: 'sum', fs: [S, G], t: 1.0 }, lenses: [S, G, F], cards: ['tree', 'knn', 'nn'], pool: 20, budget: 12, par: 7, noise: 3, pass: 0.75, boss: true, reward: 'forest',
    lesson: 'まちがった見本が多い。1本の木も、1つの網も、だまされやすい。' },
  // ── 第5章
  { name: '森の多数決', hint: '大きさ＋光 の合計が大きいものを止める', rule: { type: 'sum', fs: [S, G], t: 1.0 }, lenses: [S, G], cards: ['tree', 'forest'], pool: 18, budget: 9, par: 5,
    lesson: '1本の木はななめを階段でしか切れない。切る位置の違う木を集めて多数決をとると、階段がならされる。' },
  { name: '手札えらび・一', hint: '角が多いほど、また浮いているほど怪しい', rule: { type: 'sum', fs: [H, F], t: 1.0 }, lenses: [R, S, H, V, G, F], cards: ['linear', 'tree', 'knn', 'nn', 'forest'], pool: 16, budget: 6, par: 4 },
  { name: '手札えらび・二', hint: '止める姿が2種類ある（速さと光で決まる）', rule: { type: 'or', parts: [{ type: 'blob', fs: [V, G], c: [0.22, 0.75], r: 0.22 }, { type: 'blob', fs: [V, G], c: [0.75, 0.25], r: 0.22 }] }, lenses: [S, V, G, F], cards: ['linear', 'tree', 'knn', 'nn', 'forest'], pool: 20, budget: 9, par: 7 },
  { name: '手がかりなし・一', hint: null, rule: { type: 'xor', parts: [T(V, 0.5), T(F, 0.5)] }, lenses: [S, V, F], cards: ['linear', 'tree', 'knn', 'nn', 'forest'], pool: 20, budget: 9, par: 7,
    lesson: 'ルールは教えてもらえない。列の○×から自分で見抜こう。' },
  { name: '手がかりなし・二', hint: null, rule: { type: 'dband', fs: [S, G], c: 1.0, w: 0.25 }, lenses: [R, S, H, G], cards: ['linear', 'tree', 'knn', 'nn', 'forest'], pool: 20, budget: 10, par: 8, noise: 1 },
  { name: '最後の門', hint: null, rule: { type: 'or', parts: [{ type: 'blob', fs: [R, S], c: [0.75, 0.75], r: 0.25 }, { type: 'and', parts: [T(H, 0.6), T(G, 0.5, -1)] }] }, lenses: [R, S, H, G], cards: ['linear', 'tree', 'knn', 'nn', 'forest'], pool: 20, budget: 12, par: 11, noise: 1, pass: 0.75, s2: 0.85, boss: true },
];
STAGES.forEach((s, i) => { s.id = i; s.chapter = Math.floor(i / 6); s.pass = s.pass ?? 0.8; s.s2 = s.s2 ?? 0.9; s.noise = s.noise || 0; s.seed = 1000 + i * 37; });

export const TEST_N = 30;
