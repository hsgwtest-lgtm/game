// 遊びの状態と、物語のルール
//   種（species）… 1つの体の設計図と、その神経の遺伝子。1つの地方にすむ
//   定着 … 地方の「ぬし」の記録を破ること。定着した地方のとなりへ枝分かれできる
//   時代 … 定着した地方の数で進む。環境が変わり、適応できない種は危機 → 次の時代までに絶滅
import { REGIONS, REGION_KEYS, ERAS, eraIndexFor, regionAt, envOf, changedRegions, RACE_T, TRIAL_MIN, goalEnv } from './world.js';
import { SPECIES_COLORS, suggestName, describeChange, bodyStats, planName } from './traits.js';
import { compileModel } from '../sim/model.js';
import { cloneDesign, sanitizeDesign } from '../sim/design.js';
import { evaluate } from '../sim/sim.js';
import { geneCount } from '../sim/nerves.js';
import { inheritGenes, inheritRatio } from '../evo/inherit.js';
import { f64ToB64, b64ToF64, uid } from './store.js';
import { MASTERS } from './masters.js';

export const SAVE_KEY = 'game';

export function newGame() {
  return {
    v: 1, created: Date.now(), introDone: false, era: 0,
    settled: {}, species: [], chronicle: [], nextColor: 0, gensTotal: 0,
  };
}

// ── 便利 ──
export function speciesById(g, id) { return g.species.find(s => s.id === id) || null; }
export function living(g) { return g.species.filter(s => s.status !== 'extinct'); }
export function settledCount(g) { return Object.keys(g.settled).length; }
export function eraName(i) { return `第${i + 1}紀 ${ERAS[i].name}`; }
export function regionNow(g, key) { return regionAt(key, g.era); }
export function envFor(g, key, extra) { return envOf(regionAt(key, g.era), extra); }
export function genesOf(sp, which = 'champ') {
  const src = which === 'best' ? sp.best : sp.champ;
  return src && src.x ? b64ToF64(src.x) : new Float64Array(geneCount(modelFor(sp)));
}

const modelCache = new Map();
export function modelFor(sp) {
  const key = sp.id + ':' + (sp.designRev || 0);
  if (!modelCache.has(key)) modelCache.set(key, compileModel(sp.design));
  return modelCache.get(key);
}

// ── ぬし（先住の生き物）──
const masterCache = new Map();
export function masterOf(key) { return MASTERS[key] || null; }
export function masterModel(key) {
  const m = MASTERS[key];
  if (!m) return null;
  if (!masterCache.has('m:' + key)) masterCache.set('m:' + key, compileModel(m.design));
  return masterCache.get('m:' + key);
}
export function masterGenes(key) { const m = MASTERS[key]; return m ? Float64Array.from(m.genes) : null; }
// その時代での、ぬしの記録（決定論なので、計算して求める）
export function masterRecord(key, era) {
  const ck = `r:${key}:${era}`;
  if (masterCache.has(ck)) return masterCache.get(ck);
  const m = MASTERS[key];
  if (!m) return 0;
  const r = evaluate(masterModel(key), masterGenes(key), envOf(regionAt(key, era), { assist: 0 }));
  const d = Math.max(TRIAL_MIN, r.dist);
  masterCache.set(ck, d);
  return d;
}

// ── 物語の記録 ──
export function log(g, text, kind = 'note', sp = null) {
  g.chronicle.push({ era: g.era, t: Date.now(), text, kind, sp: sp ? sp.id : null });
  if (g.chronicle.length > 400) g.chronicle.splice(0, g.chronicle.length - 400);
}

// ── 種をつくる ──
export function createSpecies(g, { design, region, parent = null, name = '', goal = 'distance' }) {
  const clean = sanitizeDesign(design) || design;
  const model = compileModel(clean);
  const habitat = REGIONS[region].env.water ? 'water' : 'land';
  const sp = {
    id: uid(), name: (name || suggestName(model, habitat, g.species.length + 1)).slice(0, 12),
    color: SPECIES_COLORS[g.nextColor++ % SPECIES_COLORS.length],
    parent: parent ? parent.id : null, region, eraBorn: g.era, born: Date.now(),
    design: clean, designRev: 0, goal,
    champ: null, best: null, record: null, status: 'growing',
    evo: null, hist: { f: [], m: [], d: [], a: [] }, gens: 0, milestones: [],
    gait: null, settledAt: null, crisisAt: null, extinctAt: null,
  };
  // 親の神経を受けつぐ
  if (parent) {
    const pm = modelFor(parent);
    const genes = inheritGenes(pm, genesOf(parent, parent.best ? 'best' : 'champ'), model);
    sp.champ = { x: f64ToB64(genes), assist: 0, gen: 0, r: null };
    sp.inherit = inheritRatio(pm, model);
  }
  g.species.push(sp);
  const R = regionAt(region, g.era);
  if (parent) {
    const ch = describeChange(modelFor(parent), model);
    log(g, `『${parent.name}』から『${sp.name}』が分かれ、${R.name}へ渡った。${ch.join('、')}。`, 'branch', sp);
  } else {
    const st = bodyStats(model);
    log(g, `${R.name}で、『${sp.name}』が生まれた。骨${st.bones}本、関節${st.joints}個、筋肉${st.muscles}本の、${planName(st)}。`, 'birth', sp);
  }
  return sp;
}

// 設計を変えた（同じ種のまま。神経は受けつげる分だけ受けつぐ）
export function redesign(g, sp, design) {
  const old = modelFor(sp);
  const oldGenes = genesOf(sp, sp.best ? 'best' : 'champ');
  sp.design = sanitizeDesign(design) || design;
  sp.designRev = (sp.designRev || 0) + 1;
  const nm = modelFor(sp);
  const genes = inheritGenes(old, oldGenes, nm);
  sp.champ = { x: f64ToB64(genes), assist: 0, gen: sp.gens, r: null };
  sp.best = null; sp.record = null; sp.evo = null;
  if (sp.status === 'settled') sp.status = 'growing';
  log(g, `『${sp.name}』の体を作りかえた。${describeChange(old, nm).join('、')}。`, 'redesign', sp);
}

// ── 1世代の結果を記録する ──
//   res: engine の step の戻り値
//   戻り値: 起きたできごとの一覧（画面でお祝いする）
export function recordGeneration(g, sp, res) {
  const out = [];
  sp.gens = res.gen;
  g.gensTotal++;
  const c = res.champ, r = c.r;
  sp.champ = { x: f64ToB64(c.x), assist: c.assist, gen: res.gen, r: slimR(r) };
  const H = sp.hist;
  H.f.push(round(r.fitness)); H.m.push(round(res.mean)); H.d.push(round(r.dist)); H.a.push(c.assist);
  if (H.f.length > 3000) for (const k of ['f', 'm', 'd', 'a']) H[k].splice(0, 1000);
  // 支えなしの記録
  if (c.assist === 0 && !r.exploded) {
    const d = Math.max(0, r.dist);
    if (!sp.best || d > sp.best.dist) {
      const first = !sp.best;
      sp.best = { x: f64ToB64(c.x), gen: res.gen, dist: d, time: r.time, fell: r.fell };
      sp.record = d;
      if (!first) out.push({ type: 'record', dist: d });
    }
  }
  for (const e of res.events) {
    if (e.type === 'assist' && e.value === 0) {
      out.push(milestone(g, sp, 'noassist', '支えの手がはずれた', 'もう支えはいらない。自分の体だけで動ける。', c));
    }
    if (e.type === 'kick') out.push({ type: 'kick' });
  }
  // 節目の距離
  if (c.assist === 0) {
    for (const m of [0.5, 1, 2, 3, 5, 8, 12, 20, 30]) {
      if (r.dist >= m && !sp.milestones.some(x => x.key === `d${m}`)) {
        out.push(milestone(g, sp, `d${m}`, `${m}m 進んだ`, `${RACE_T}秒で ${m}m。第${res.gen}世代で達した。`, c));
      }
    }
    const model = modelFor(sp);
    const tall = model.bodies[model.sense].c[1] - model.minY > 0.25;
    if (tall && !r.fell && !REGIONS[sp.region].env.water && !sp.milestones.some(x => x.key === 'stand')) {
      out.push(milestone(g, sp, 'stand', '最後まで倒れなかった', `${RACE_T}秒のあいだ、一度も倒れずに動きつづけた。`, c));
    }
  }
  // ぬしを破った → 定着
  if (sp.status !== 'settled' && sp.record !== null && sp.record > masterRecord(sp.region, g.era)) {
    out.push(...settle(g, sp));
  }
  // 危機を乗りこえた
  return out.filter(Boolean);
}

function milestone(g, sp, key, title, text, c) {
  if (sp.milestones.some(x => x.key === key)) return null;
  const m = { key, gen: sp.gens, title, text, x: f64ToB64(c.x), assist: c.assist, t: Date.now() };
  sp.milestones.push(m);
  log(g, `『${sp.name}』${title}（第${sp.gens}世代）`, 'milestone', sp);
  return { type: 'milestone', m };
}

// 歩き方を見つけた（画面で分析した結果を受けとる）
export function noteGait(g, sp, gait, c) {
  if (!gait) return null;
  const out = [];
  const key = `gait:${gait.type}`;
  sp.gait = { type: gait.type, gen: sp.gens, assist: c.assist || 0 };
  const helped = (c.assist || 0) > 0;
  if (!helped && !['stand', 'crawl', 'wiggle'].includes(gait.type) && !sp.milestones.some(x => x.key === key)) {
    const m = milestone(g, sp, key, `「${gait.name}」を身につけた`, gait.desc, c);
    if (m) out.push(m);
  }
  return out;
}

// 定着
function settle(g, sp) {
  const out = [];
  const R = regionAt(sp.region, g.era);
  const wasCrisis = sp.status === 'crisis';
  sp.status = 'settled';
  sp.settledAt = { era: g.era, gen: sp.gens };
  sp.crisisAt = null;
  const firstHere = !g.settled[sp.region];
  g.settled[sp.region] = true;
  const mr = masterRecord(sp.region, g.era);
  if (wasCrisis) log(g, `『${sp.name}』は新しい${R.name}に適応し、危機を乗りこえた。（${sp.record.toFixed(2)}m）`, 'survive', sp);
  else log(g, `『${sp.name}』が${R.name}のぬし「${MASTERS[sp.region].name}」の記録 ${mr.toFixed(2)}m を破り、${R.name}に定着した。`, 'settle', sp);
  out.push({ type: 'settle', sp, firstHere, wasCrisis });
  // 時代が進むか
  const ne = eraIndexFor(settledCount(g));
  if (ne > g.era) out.push(...advanceEra(g, ne));
  return out;
}

// 時代を進める
export function advanceEra(g, ne) {
  const out = [];
  while (g.era < ne) {
    // 前の時代の危機を乗りこえられなかった種は絶滅
    for (const sp of g.species) {
      if (sp.status === 'crisis') {
        sp.status = 'extinct';
        sp.extinctAt = { era: g.era };
        log(g, `『${sp.name}』は${regionAt(sp.region, g.era).name}の変化に適応できず、絶滅した。化石だけが残った。`, 'extinct', sp);
        out.push({ type: 'extinct', sp });
      }
    }
    g.era++;
    const E = ERAS[g.era];
    log(g, `${eraName(g.era)}がはじまった。${E.story}`, 'era');
    out.push({ type: 'era', era: g.era });
    // 環境が変わった地方の種を、新しい環境でためす
    for (const key of changedRegions(g.era)) {
      for (const sp of g.species) {
        if (sp.region !== key || sp.status === 'extinct') continue;
        const genes = genesOf(sp, sp.best ? 'best' : 'champ');
        const r = evaluate(modelFor(sp), genes, envFor(g, key, { assist: 0, ...goalEnv(sp.goal || 'distance', modelFor(sp)) }));
        const d = Math.max(0, r.dist);
        const mr = masterRecord(key, g.era);
        sp.best = { x: f64ToB64(genes), gen: sp.gens, dist: d, time: r.time, fell: r.fell };
        sp.record = d;
        sp.evo = null;   // 新しい環境で進化をやり直す（遺伝子は受けつぐ）
        sp.champ = { x: f64ToB64(genes), assist: 0, gen: sp.gens, r: slimR(r) };
        if (d > mr) {
          log(g, `『${sp.name}』は変わった${regionAt(key, g.era).name}でも ${d.toFixed(2)}m 進めた。この環境にも耐えられる。`, 'survive', sp);
        } else {
          sp.status = 'crisis';
          sp.crisisAt = { era: g.era };
          log(g, `『${sp.name}』は危機にある。変わった${regionAt(key, g.era).name}では ${d.toFixed(2)}m しか進めない（ぬし ${mr.toFixed(2)}m）。次の時代までに適応しなければ絶滅する。`, 'crisis', sp);
          out.push({ type: 'crisis', sp });
        }
      }
    }
  }
  return out;
}

// 枝分かれできる地方（定着した種がいる地方のとなり）
export function branchTargets(g, sp) {
  if (sp.status !== 'settled') return [];
  return REGIONS[sp.region].adj.slice();
}

// はじめの一歩で選べる地方: どこからでもよい
export function startRegions() { return REGION_KEYS.slice(); }

export function slimR(r) {
  if (!r) return null;
  return { fitness: round(r.fitness), dist: round(r.dist), time: round(r.time), fell: !!r.fell, energy: round(r.energy), upright: round(r.upright) };
}
function round(v) { return Math.round(v * 1000) / 1000; }

export function cloneSpeciesDesign(sp) { return cloneDesign(sp.design); }
