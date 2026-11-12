// 訪問者の特徴（＝門番のレンズ）と、「止める／通す」を決めるルール
import { makeRng } from '../ml/rng.js';

// 特徴はすべて 0〜1。番号がレンズの番号
export const FEATS = [
  { id: 'red', name: '赤さ', lo: '青い', hi: '赤い', color: '#e0503c' },
  { id: 'size', name: '大きさ', lo: '小さい', hi: '大きい', color: '#3460fb' },
  { id: 'horn', name: '角', lo: '角が少ない', hi: '角が多い', color: '#8a5cf0' },
  { id: 'speed', name: '速さ', lo: 'おそい', hi: '速い', color: '#00a3bf' },
  { id: 'glow', name: '光', lo: '暗い', hi: '光る', color: '#d9a400' },
  { id: 'float', name: '高さ', lo: '低い', hi: '浮いている', color: '#259d63' },
];
export const NF = FEATS.length;
export const hornCount = (v) => Math.round(v * 4);

// ルールは入れ子にできる小さなデータ
//  thr:{f,t,dir}  sum:{fs,ws,t}  band:{f,lo,hi}  blob:{fs,c,r}  ring:{fs,c,r1,r2}
//  wave:{fx,fy,base,amp,freq}  dband:{fs,c,w}  and/or/xor:{parts}
export function evalRule(r, x) {
  switch (r.type) {
    case 'thr': return (r.dir === -1 ? x[r.f] < r.t : x[r.f] > r.t) ? 1 : 0;
    case 'sum': { let s = 0; r.fs.forEach((f, i) => { s += (r.ws ? r.ws[i] : 1) * x[f]; }); return s > r.t ? 1 : 0; }
    case 'band': return x[r.f] > r.lo && x[r.f] < r.hi ? 1 : 0;
    case 'dband': { let s = 0; for (const f of r.fs) s += x[f]; return Math.abs(s - r.c) < r.w ? 1 : 0; }
    case 'blob': { let s = 0; r.fs.forEach((f, i) => { s += (x[f] - r.c[i]) ** 2; }); return Math.sqrt(s) < r.r ? 1 : 0; }
    case 'ring': { let s = 0; r.fs.forEach((f, i) => { s += (x[f] - r.c[i]) ** 2; }); s = Math.sqrt(s); return s > r.r1 && s < r.r2 ? 1 : 0; }
    case 'wave': return x[r.fy] > r.base + r.amp * Math.sin(2 * Math.PI * r.freq * x[r.fx]) ? 1 : 0;
    case 'and': return r.parts.every((p) => evalRule(p, x)) ? 1 : 0;
    case 'or': return r.parts.some((p) => evalRule(p, x)) ? 1 : 0;
    case 'xor': return (r.parts.reduce((a, p) => a + evalRule(p, x), 0) % 2) ? 1 : 0;
  }
  throw new Error('rule? ' + r.type);
}
export function ruleFeats(r, set = new Set()) {
  if (r.parts) r.parts.forEach((p) => ruleFeats(p, set));
  else if (r.fs) r.fs.forEach((f) => set.add(f));
  else if (r.type === 'wave') { set.add(r.fx); set.add(r.fy); }
  else set.add(r.f);
  return set;
}

// ルールを日本語にする（日替わり・夜勤の答え合わせ用）
function thrText(r) {
  if (r.f === 2) { const n = Math.floor(r.t * 4) + 1; return r.dir === -1 ? `角が${n - 1}本以下` : `角が${n}本以上`; }
  return r.dir === -1 ? FEATS[r.f].lo : FEATS[r.f].hi;
}
export function ruleText(r) {
  const nm = (f) => FEATS[f].name;
  switch (r.type) {
    case 'thr': return thrText(r);
    case 'sum': return r.ws && r.ws.some((w) => w !== 1)
      ? `${r.fs.map((f, i) => nm(f) + (r.ws[i] >= 0.6 ? '（強く効く）' : '（少し効く）')).join('と')}を足して大きい`
      : `${r.fs.map(nm).join('＋')}の合計が大きい`;
    case 'band': return `${nm(r.f)}が中くらい`;
    case 'dband': return `${r.fs.map(nm).join('＋')}の合計が中くらい`;
    case 'blob': return `${r.fs.map((f, i) => nm(f) + (r.c[i] > 0.5 ? 'が高め' : 'が低め')).join('で')}の、ある姿に近い`;
    case 'ring': return `${r.fs.map(nm).join('と')}が「ふつう」から少しだけ外れている`;
    case 'wave': return `${nm(r.fy)}が、${nm(r.fx)}につれて波打つ境目より上`;
    case 'and': return r.parts.map(ruleText).join('、かつ ');
    case 'or': return r.parts.map((p) => (p.parts ? `（${ruleText(p)}）` : ruleText(p))).join('、または ');
    case 'xor': return `「${r.parts.map(ruleText).join('」「')}」のどちらか片方だけ`;
  }
  return '';
}

// レンズに無い特徴は、みんな同じ「ふつうの姿」にそろえる（角なし・光らない・浮かない）
export const NEUTRAL = [0.5, 0.5, 0, 0.3, 0, 0];
// 訪問者を作る
export function makeVisitor(rng, lenses) {
  const x = NEUTRAL.slice();
  for (const f of lenses) x[f] = f === 2 ? rng.int(5) / 4 : Math.round(rng() * 100) / 100;
  return x;
}
// まんべんなく散らばった訪問者のかたまりを作る（特徴ごとに n 段へ分け、段を1回ずつ使う）
function batch(rng, lenses, n) {
  const cols = {};
  for (const f of lenses) cols[f] = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = NEUTRAL.slice();
    for (const f of lenses) {
      const u = (cols[f][i] + rng()) / n;
      x[f] = f === 2 ? Math.min(4, Math.floor(u * 5)) / 4 : Math.round(u * 100) / 100;
    }
    out.push(x);
  }
  return out;
}
// 止める・通すがかたよらない集団を作る
export function makeCrowd(rule, lenses, n, seed, minFrac = 0.35) {
  const rng = makeRng(seed);
  const need = Math.ceil(n * minFrac), cap = n - need;
  const cnt = [0, 0], out = [];
  for (let guard = 0; out.length < n && guard < 400; guard++) {
    for (const x of batch(rng, lenses, n)) {
      const y = evalRule(rule, x);
      if (cnt[y] >= cap || out.length >= n) continue;
      cnt[y]++; out.push({ x, y });
    }
  }
  return rng.shuffle(out);
}
// 見本の答えを何体かわざと間違える（変装）
export function addNoise(crowd, count, seed) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const idx = rng.shuffle(crowd.map((_, i) => i)).slice(0, count);
  for (const i of idx) { crowd[i].badge = 1 - crowd[i].y; crowd[i].noisy = true; }
  for (const c of crowd) if (c.badge === undefined) c.badge = c.y;
  return crowd;
}
