// species.js — 種の判定と分岐の記録（進化NN・ランダム＋選択で使う。純粋モジュール）
//   種の「代表」はその種の最初の個体の遺伝子。代表から一定以上はなれた子が生まれたら新しい種として枝分かれする
import { hash32 } from './util.js';

export const ESTABLISHED = 3; // この数をこえたら「定着した種」

const SYL = ['ピ', 'ポ', 'パ', 'プ', 'ペ', 'モ', 'ム', 'ミ', 'マ', 'メ', 'ル', 'リ', 'ロ', 'ラ', 'レ', 'ニ', 'ノ', 'ナ', 'ヌ', 'ネ', 'コ', 'キ', 'ク', 'カ', 'ケ', 'ト', 'タ', 'テ', 'チ', 'ツ', 'ボ', 'バ', 'ビ', 'ブ', 'ベ', 'ズ', 'ジ', 'ゴ', 'ガ', 'グ'];

export function speciesName(kind, id) {
  const h = hash32(id, kind === 'nn' ? 11 : 23, 0x51ec);
  const a = SYL[h % SYL.length];
  const b = SYL[(h >>> 7) % SYL.length];
  const c = (h >>> 14) & 1 ? 'ン' : SYL[(h >>> 16) % SYL.length];
  return `${a}${b}${c}族`;
}

export class SpeciesBook {
  // kind: 'nn' | 'dice'、dist: 遺伝子どうしの距離、th: 新種とみなす距離
  constructor(kind, dist, th) {
    this.kind = kind;
    this.dist = dist;
    this.th = th;
    this.list = [];
  }

  assign(g, parentSp, gen) {
    if (parentSp >= 0 && parentSp < this.list.length) {
      const sp = this.list[parentSp];
      if (this.dist(g, sp.rep) < this.th) return parentSp;
    }
    // ほかの生きている種に近ければそちらへ（収れん）
    let best = -1;
    let bd = this.th;
    for (const sp of this.list) {
      if (!sp.alive || sp.id === parentSp) continue;
      const d = this.dist(g, sp.rep);
      if (d < bd) {
        bd = d;
        best = sp.id;
      }
    }
    if (best >= 0) return best;
    const id = this.list.length;
    this.list.push({ id, parent: parentSp, born: gen, last: gen, rep: g.slice(), name: speciesName(this.kind, id), peak: 0, alive: true, n: 0, counts: [] });
    return id;
  }

  // 世代ごとの頭数を記録（0匹になった種は絶滅）。
  //   返り値: { born: [はじめて3匹以上に定着した種], extinct: [3匹以上いたことがあって絶えた種] }
  tally(gen, ids) {
    const cnt = new Map();
    for (const id of ids) cnt.set(id, (cnt.get(id) || 0) + 1);
    const born = [];
    const extinct = [];
    for (const sp of this.list) {
      const n = cnt.get(sp.id) || 0;
      if (n > 0) {
        sp.counts.push(gen, n);
        sp.last = gen;
        sp.n = n;
        if (n >= ESTABLISHED && sp.peak < ESTABLISHED && gen > 0) born.push(sp);
        if (n > sp.peak) sp.peak = n;
      } else if (sp.alive && sp.counts.length > 0) {
        sp.alive = false;
        sp.n = 0;
        if (sp.peak >= ESTABLISHED) extinct.push(sp);
      }
    }
    // 生まれたが一度も数えられなかった種（同じ世代のうちに別の種へ吸収された）は消しておく
    for (const sp of this.list) if (sp.counts.length === 0 && !cnt.has(sp.id)) sp.alive = false;
    // 記録が長くなりすぎないよう、古い頭数の記録は間引く（200世代より前は5世代おき）
    for (const sp of this.list) {
      if (sp.counts.length > 800) {
        const keep = [];
        for (let i = 0; i < sp.counts.length; i += 2) {
          const g = sp.counts[i];
          if (g > gen - 200 || g % 5 === 0 || i === 0) keep.push(g, sp.counts[i + 1]);
        }
        sp.counts = keep;
      }
    }
    return { born, extinct };
  }

  living() {
    return this.list.filter((s) => s.alive && s.counts.length > 0);
  }

  // 保存用（遺伝子は呼び出し側で base64 にする）
  toJSON(enc) {
    // 記録が長くなりすぎないよう、古い世代の頭数は間引く
    return this.list.map((s) => ({
      id: s.id,
      parent: s.parent,
      born: s.born,
      last: s.last,
      rep: enc(s.rep),
      name: s.name,
      peak: s.peak,
      alive: s.alive,
      n: s.n,
      counts: s.counts,
    }));
  }
  loadJSON(arr, dec) {
    this.list = arr.map((s) => ({ ...s, rep: dec(s.rep) }));
  }
}
