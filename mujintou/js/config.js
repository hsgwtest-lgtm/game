// 差し替え前提の定数はここに集約する。
// 島の名前は data/state.json の islandName があればそちらを優先し、無ければこの仮称を使う。

export const DEFAULT_ISLAND_NAME = '無人島プロジェクト';

// 連載アカウント（投票カードのリンク先）。state.json の currentVote.postUrl があればそちらを優先。
export const INSTAGRAM_HANDLE = 'eiei_mus';
export const INSTAGRAM_URL = 'https://www.instagram.com/eiei_mus/';

export const DATA_URLS = {
  state: './data/state.json',
  islanders: './data/islanders.json',
};
// ?demo をつけて開いたときに読む「育った島」のデモデータ（5日目・島民6人・建物あり）
export const DEMO_DATA_URLS = {
  state: './data/demo/state.json',
  islanders: './data/demo/islanders.json',
};

// 島民シミュレーションの基本パラメータ（全員の端末で同じ時刻＝同じ光景になる）
export const SIM = {
  slotSeconds: 60, // 1つの行動の長さ
  walkSpeed: 4.6, // 1秒あたりの移動量（ワールド単位）
  gatherEvery: 5, // 平均して何スロットに1回、広場に集まるか
  chatChance: 0.16, // 各スロットで会話を始める確率
};

// 名前ラベルを同時に出す上限（人口が増えたときの負荷対策）
export const MAX_LABELS = 40;

// ラベルのズーム連動。距離は「画面の高さが refHeight(px) のときの距離」に換算して比べる
// （画面が低い端末ほど同じ距離でも島民が小さく見えるので、早めに名前を隠す）。
//   引き（全体表示）  … 地区名だけ
//   中くらい          … 地区名＋島民名（小さめの字で、だんだん濃く）
//   寄り              … 島民名（距離が近いほど大きな字）
export const LABEL_ZOOM = {
  refHeight: 844,
  districtBeyond: 150, // 注視点までの距離がこれより遠いと地区名を出す
  hideBeyond: 200, // これより遠いと島民名を出さない（注視点までの距離・その島民までの距離の両方で判定）
  fadeBand: 40, // hideBeyond の手前この幅で、名前がだんだん現れる
  fullWithin: 60, // ここまで寄ると名前が最大サイズになる
  minFont: 9, // 名前の字の大きさ（px）：出はじめ
  maxFont: 13, // 　　　　　　　　　　　　：いちばん寄ったとき
  selectedMinFont: 12, // 選択中の島民は引いても名前を出し、これより小さくしない
};

// 行動範囲の外にある地区の「自然の障壁」。運営が閉じているのではなく、島の側に理由がある。
//   barrier: 年表タブの「島民の行動範囲」に出す説明（state.json の districts[].barrier で上書きできる）
//   edge:    境界の見晴らしスポットの呼び名
//   look:    そこで様子をうかがっている島民の「いま」の文
//   lines:   境界付近にいる島民がたまにつぶやくセリフ（吹き出し）
export const BARRIERS = {
  forest: {
    barrier: '獣の気配がして、下草が深く歩きにくい',
    edge: '森の手前',
    look: '森の奥をうかがっている',
    lines: ['森は危険そうだ…', '獣の声が聞こえた気がする', '下草が深くて進めそうにない…', 'ガサッ…いまの音は？'],
  },
  highland: {
    barrier: '風が冷たく、岩場で足場が悪い',
    edge: '高原のふもと',
    look: '高原を見上げている',
    lines: ['あの上は寒そうだ', '足場が悪そうだ', '風が冷たいな…', '岩だらけで登れそうにない'],
  },
};
export const DEFAULT_BARRIER = { barrier: 'まだ誰も足を踏み入れていない', edge: '', look: '向こう側をながめている', lines: [] };

export const JOBS = {
  漁師: { hat: 'headband', tool: 'rod', work: '釣りをしている' },
  農家: { hat: 'straw', tool: 'hoe', work: '畑を耕している' },
  大工: { hat: 'helmet', tool: 'hammer', work: 'トンカン作業している' },
  探検家: { hat: 'safari', tool: 'scope', work: 'あたりを調べている' },
  料理人: { hat: 'chef', tool: 'ladle', work: '料理をしている' },
};
export const DEFAULT_JOB = { hat: 'none', tool: 'none', work: 'はたらいている' };

export const RELATION_TYPES = {
  friend: { label: '仲良し', icon: 'note' },
  crush: { label: '片想い', icon: 'heart' },
  mutual: { label: '両想い', icon: 'heart' },
  rival: { label: 'ライバル', icon: 'bolt' },
  quarrel: { label: 'けんか中', icon: 'bolt' },
  family: { label: '家族', icon: 'heart' },
};
export const DEFAULT_RELATION = { label: '知り合い', icon: 'talk' };
