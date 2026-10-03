// 決定論のテスト: Node とブラウザで同じ試合を計算して、結果（ハッシュ）が一致するか
//   node tools/determinism.mjs [boss.json]（なければ js/ml/bosses.js のロボ先輩）
import fs from 'fs';
import { BOSS_DATA } from '../js/ml/bosses.js';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { Match } from '../js/sim/match.js';
import { Net, toWire, fromWire, unpackQ8 } from '../js/ml/net.js';
import { Rng } from '../js/core/rng.js';

const bossFile = process.argv[2];
const boss = bossFile ? JSON.parse(fs.readFileSync(bossFile, 'utf8')) : BOSS_DATA.senpai;
const wireA = toWire(unpackQ8(boss.brain));
const wireB = toWire(new Net().init(new Rng(42)));
const cases = [];
for (let i = 0; i < 12; i++) cases.push({ seed: (0x9e3779b9 * (i + 1)) >>> 0, arena: i % 6 });

function runAll(wa, wb, cs) {
  return cs.map(c => {
    const m = new Match({ arena: c.arena, seed: c.seed, a: { type: 'net', net: fromWire(wa) }, b: { type: 'net', net: fromWire(wb) }, logging: false });
    const r = m.runToEnd();
    return `${r.hash}:${r.scores[0]}-${r.scores[1]}`;
  });
}
const nodeRes = runAll(wireA, wireB, cases);
const nodeRes2 = runAll(wireA, wireB, cases);
console.log('node repeat equal:', JSON.stringify(nodeRes) === JSON.stringify(nodeRes2));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8123/index.html?screen=settings');
await page.waitForTimeout(1500);
const browserRes = await page.evaluate(async ({ wa, wb, cs }) => {
  const { Match } = await import('./js/sim/match.js');
  const { fromWire } = await import('./js/ml/net.js');
  return cs.map(c => {
    const m = new Match({ arena: c.arena, seed: c.seed, a: { type: 'net', net: fromWire(wa) }, b: { type: 'net', net: fromWire(wb) }, logging: false });
    const r = m.runToEnd();
    return `${r.hash}:${r.scores[0]}-${r.scores[1]}`;
  });
}, { wa: wireA, wb: wireB, cs: cases });
await browser.close();
let same = 0;
for (let i = 0; i < cases.length; i++) {
  const ok = nodeRes[i] === browserRes[i];
  if (ok) same++;
  console.log(`${ok ? '✓' : '✗'} arena ${cases[i].arena} seed ${cases[i].seed}: node ${nodeRes[i]} / browser ${browserRes[i]}`);
}
console.log(`${same}/${cases.length} identical`);
