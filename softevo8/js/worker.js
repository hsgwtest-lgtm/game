/* =====================================================================
   SoftEvo 8 — worker.js
   進化はバックグラウンドで回し続ける。画面はその「結果」を再生する。
   モード:
     pause … 停止
     watch … 観察: 画面の再生と歩調を合わせ、1世代ずつ進める
     fast  … 高速: 全力で世代を回す
   ===================================================================== */
import { Evolver } from './evo.js';

let evo = null;
let mode = 'pause';
let allowance = 0;
let timer = null;

function tick() {
  timer = null;
  if (!evo) return;
  const canRun = mode === 'fast' || (mode === 'watch' && allowance > 0);
  if (!canRun) return;
  const t0 = performance.now();
  // 高速モードでは短時間にまとめて実行 (メッセージ受信の隙間は確保)
  do {
    const s = evo.runGeneration();
    if (mode === 'watch') allowance--;
    const transfer = [s.champ.genome.buffer];
    if (s.champ.parentGenome) transfer.push(s.champ.parentGenome.buffer);
    for (const t of s.top) transfer.push(t.genome.buffer);
    postMessage({ type: 'gen', s }, transfer);
  } while (mode === 'fast' && performance.now() - t0 < 30);
  schedule();
}

function schedule() {
  if (!timer) timer = setTimeout(tick, 0);
}

onmessage = (ev) => {
  const m = ev.data;
  switch (m.type) {
    case 'init':
      evo = new Evolver(m.blueprint, m.settings, m.opts || {});
      allowance = 1;
      postMessage({ type: 'ready', sizes: evo.layout.sizes });
      schedule();
      break;
    case 'mode':
      mode = m.mode;
      if (mode === 'watch' && allowance < 1) allowance = 1;
      schedule();
      break;
    case 'grant':
      allowance = Math.min(2, allowance + 1);
      schedule();
      break;
    case 'env':
      if (evo) evo.setEnv(m.env);
      break;
  }
};
