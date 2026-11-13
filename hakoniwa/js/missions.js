// missions.js — ミッション5つ（それぞれ島の始まり方・神の力・達成条件が違う）
import { HERB, CARN } from './sim.js';
import { DAY_LEN } from './world.js';
import { TR } from './genetics.js';

const days = (sim) => (sim.world.time - sim.mission.start) / DAY_LEN;

// 草食の種のうち、minN匹以上いる種の形質平均の最大値
function bestSpeciesMean(sim, cls, ti, minN) {
  let best = null;
  for (const sp of sim.species) {
    if (sp.cls !== cls || sp.n < minN) continue;
    const st = sim.speciesStats(sp.id);
    if (st.n >= minN && (!best || st.mean[ti] > best.v)) best = { v: st.mean[ti], name: sp.name, n: st.n };
  }
  return best;
}

export const MISSIONS = [
  {
    id: 'm1',
    icon: '⚖️',
    title: 'はじまりの均衡',
    goal: '草食動物と肉食動物を、どちらも絶滅させずに10日間守る',
    hint: 'この島は肉食が多めで、草食が少なめ。草をまいたり、木の実を置いたりして草食を増やそう。肉食が増えすぎたら、草食を追加して支えよう。',
    limitDays: null,
    opt: { counts: { rabbit: 12, deer: 4, fox: 11 }, world: { grass0: 0.4 }, godStart: 50, godRegen: 1.0 },
    eval(sim, st) {
      const [h, c] = sim.nCls;
      if (h === 0) return { fail: '草食動物が絶滅してしまった' };
      if (c === 0) return { fail: '肉食動物が絶滅してしまった' };
      const d = days(sim);
      st.progress = Math.min(1, d / 10);
      st.text = `${Math.min(10, d).toFixed(1)} / 10 日`;
      if (d >= 10) return { clear: true };
      return null;
    },
  },
  {
    id: 'm2',
    icon: '💨',
    title: '俊足の血統',
    goal: '草食の種のどれか1つ（8匹以上）で、平均の「速さ」を1.85以上にする',
    hint: '肉食動物がいると、足の遅い個体から食べられる。肉食を増やして、選ばれる力（自然選択）を強めよう。ただし草食を絶滅させないこと。',
    limitDays: 30,
    opt: { godStart: 60, godRegen: 1.2 },
    eval(sim, st) {
      if (sim.nCls[HERB] === 0) return { fail: '草食動物が絶滅してしまった' };
      const b = bestSpeciesMean(sim, HERB, TR.SPEED, 8);
      const v = b ? b.v : 0;
      st.best = Math.max(st.best || 0, v);
      st.progress = Math.max(0, Math.min(1, (v - 1.0) / 0.85));
      st.text = b ? `${b.name}（${b.n}匹） 速さ ${v.toFixed(2)} / 1.85` : '8匹以上いる草食の種がいない';
      if (v >= 1.85) return { clear: true };
      if (days(sim) >= 30) return { fail: '期限の30日が過ぎてしまった' };
      return null;
    },
  },
  {
    id: 'm3',
    icon: '❄️',
    title: '雪国の毛皮',
    goal: '草食動物（10匹以上）の平均の「耐寒性」を0.68以上にする',
    hint: 'この島は少し寒い。寒波を起こすと、寒さに弱い個体は体力を失いやすい。草食が減りすぎないよう、草や木の実で支えながら寒さに慣らしていこう。',
    limitDays: 30,
    opt: { world: { tempBase: 12 }, counts: { fox: 3 }, costs: { cold: 15 }, godStart: 60, godRegen: 1.2 },
    eval(sim, st) {
      const n = sim.nCls[HERB];
      if (n === 0) return { fail: '草食動物が絶滅してしまった' };
      const v = sim.classMean(HERB, TR.COLD);
      st.progress = Math.max(0, Math.min(1, (v - 0.4) / 0.28));
      st.text = n >= 10 ? `草食${n}匹 耐寒性 ${v.toFixed(2)} / 0.68` : `草食が${n}匹（10匹以上必要） 耐寒性 ${v.toFixed(2)}`;
      if (n >= 10 && v >= 0.68) return { clear: true };
      if (days(sim) >= 30) return { fail: '期限の30日が過ぎてしまった' };
      return null;
    },
  },
  {
    id: 'm4',
    icon: '🧬',
    title: '多様性の島',
    goal: '動物の種を6種以上（どれも4匹以上）、同時に2日間保つ',
    hint: '新しい種は、祖先から形質が大きく離れたときに生まれる。森（木の実）・草原（草）・寒さ・暑さなど、いろいろな暮らし方ができる島にすると種が分かれやすい。',
    limitDays: 40,
    opt: { godStart: 60, godRegen: 1.2 },
    eval(sim, st, dt) {
      if (sim.nTotal === 0) return { fail: '動物がいなくなってしまった' };
      const k = sim.livingSpecies(4).length;
      if (k >= 6) st.hold = (st.hold || 0) + dt;
      else st.hold = 0;
      const need = 2 * DAY_LEN;
      st.progress = k >= 6 ? 0.5 + 0.5 * Math.min(1, st.hold / need) : (0.5 * Math.min(k, 6)) / 6;
      st.text = k >= 6 ? `${k}種 — 維持 ${(st.hold / DAY_LEN).toFixed(1)} / 2 日` : `4匹以上の種 ${k} / 6`;
      if (st.hold >= need) return { clear: true };
      if (days(sim) >= 40) return { fail: '期限の40日が過ぎてしまった' };
      return null;
    },
  },
  {
    id: 'm5',
    icon: '🌱',
    title: '荒れ島の再生',
    goal: '草食40匹以上・肉食6匹以上を、同時に1日間保つ',
    hint: '草は食べ尽くされ、木もわずか。肉食が多すぎて草食は追いつめられている。雨と木の苗で島をよみがえらせ、いなくなったモリジカを呼び戻そう。',
    limitDays: 25,
    opt: { world: { grass0: 0.06, trees: 5, fruit0: 0 }, counts: { rabbit: 12, deer: 0, fox: 9 }, godStart: 80, godRegen: 1.5 },
    eval(sim, st, dt) {
      const [h, c] = sim.nCls;
      if (h === 0) return { fail: '草食動物が絶滅してしまった' };
      if (c === 0) return { fail: '肉食動物が絶滅してしまった' };
      const ok = h >= 40 && c >= 6;
      if (ok) st.hold = (st.hold || 0) + dt;
      else st.hold = 0;
      st.progress = ok ? 0.5 + 0.5 * Math.min(1, st.hold / DAY_LEN) : 0.25 * Math.min(1, h / 40) + 0.25 * Math.min(1, c / 6);
      st.text = ok ? `草食${h}・肉食${c} — 維持 ${(st.hold / DAY_LEN).toFixed(1)} / 1 日` : `草食 ${h}/40・肉食 ${c}/6`;
      if (st.hold >= DAY_LEN) return { clear: true };
      if (days(sim) >= 25) return { fail: '期限の25日が過ぎてしまった' };
      return null;
    },
  },
];

export const missionById = (id) => MISSIONS.find((m) => m.id === id) || null;

export function missionOptions(id, seed) {
  const m = missionById(id);
  return Object.assign({ seed, mode: 'mission', mission: id }, JSON.parse(JSON.stringify(m.opt)));
}

// 毎フレーム呼ぶ。状態が変わったら 'clear' / 'fail' を返す
export function evalMission(sim, dt) {
  const st = sim.mission;
  if (!st || st.status !== 'play') return null;
  const m = missionById(st.id);
  if (!m) return null;
  const r = m.eval(sim, st, dt);
  if (!r) return null;
  if (r.clear) {
    st.status = 'clear';
    st.progress = 1;
    st.endDay = days(sim);
    return 'clear';
  }
  if (r.fail) {
    st.status = 'fail';
    st.reason = r.fail;
    st.endDay = days(sim);
    return 'fail';
  }
  return null;
}
