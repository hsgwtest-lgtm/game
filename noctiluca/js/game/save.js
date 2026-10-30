// 端末に保存（localStorage）
const KEY = 'noctiluca.v1';

function fresh() {
  return {
    v: 1,
    unlocked: ['cradle'],
    stars: {},       // 試練 → 最高の星の数
    best: {},        // 試練 → 本番の最高記録
    trials: {},      // 試練 → { evo, champion, findings }
    settings: { quality: 2, speed: 4, sound: true },
    lab: null,
    seenIntro: {},
    created: Date.now(),
  };
}

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.v === 1) return Object.assign(fresh(), s);
  } catch (e) { /* 壊れていたら作り直す */ }
  return fresh();
}

let timer = null;
export function writeSave(s, now = false) {
  const go = () => {
    timer = null;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 容量不足など */ }
  };
  if (now) { if (timer) clearTimeout(timer); go(); return; }
  if (!timer) timer = setTimeout(go, 1500);
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
  return fresh();
}
