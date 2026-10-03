// ボスの脳（tools/make_bosses.mjs の出力）を js/ml/bosses.js にまとめる
//   node tools/pack_bosses.mjs senpai.json mirror.json king.json
import fs from 'fs';
const out = {};
for (const f of process.argv.slice(2)) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  out[d.key] = { steps: d.steps, deck: d.deck, brain: d.brain };
  console.log(d.key, d.steps, JSON.stringify(d.eval));
}
const src = '// 自動生成ファイル（tools/make_bosses.mjs → tools/pack_bosses.mjs）。CPUリーグのボスの学習済み脳（8bit）。\n' +
  'export const BOSS_DATA = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync('js/ml/bosses.js', src);
console.log('js/ml/bosses.js', src.length, 'bytes');
