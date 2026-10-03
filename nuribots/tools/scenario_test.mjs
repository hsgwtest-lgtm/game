// 進んだ状態（カード全部・リーグ途中）の画面と、ゴースト対戦の流れを試す
//   node tools/scenario_test.mjs <outdir>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';

const out = process.argv[2] || 'scenario';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.addInitScript(() => {
  if (!sessionStorage.getItem('init')) {
    sessionStorage.setItem('init', '1');
    localStorage.clear();
    const deck = [{ id: 'paint', lv: 2 }, { id: 'steal', lv: 2 }, { id: 'win', lv: 2 }, { id: 'hit', lv: 1 }, { id: 'approach', lv: 2 }, { id: 'item', lv: 1 }];
    localStorage.setItem('nuribots/save/v1', JSON.stringify({
      v: 1, seen: { intro: 1 }, profile: { id: 'scen01', name: 'シナリオ' },
      league: { cleared: { koro: 1, nurio: 1, oikake: 1, nurio2: 1, guard: 1 }, tries: {} },
      unlock: { cards: ['paint', 'steal', 'win', 'idle', 'explore', 'hit', 'shot', 'stunned', 'lost', 'item', 'approach', 'lead', 'bump'], arenas: [0, 1, 2, 3, 4], slots: 6, title: '' },
      bots: [{ id: 'b1', name: 'ヌリー', color: 0, deck, steps: 0, iters: 0, episodes: 0, hist: [], album: [], rec: { w: 3, l: 1, d: 0 }, train: { opps: ['nurio2', 'guard', 'self'], arenas: [0, 1, 2], ent: 1, speed: 2 } }],
    }));
  }
});
await page.goto('http://127.0.0.1:8123/?safe=47,34&screen=home&db=http://127.0.0.1:8124');
await page.waitForTimeout(2000);
const ev = (code) => page.evaluate(`(async()=>{ return ${code} })()`);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
await shot('01_home');
await ev(`__app.go('design')`);
await page.waitForTimeout(800);
await shot('02_design');
await ev(`__app.ui.scrollTo('design', 400)`);
await page.waitForTimeout(600);
await shot('03_design_scrolled');
await ev(`__app.go('league')`);
await page.waitForTimeout(1500);
await shot('04_league');
await ev(`__app.go('train')`);
await page.waitForTimeout(12000);
await shot('05_train');
await ev(`__app.screens.train.exit()`);
await page.waitForTimeout(1500);
await ev(`__app.go('online')`);
await page.waitForTimeout(2500);
await ev(`__app.screens.online.upload()`);
await page.waitForTimeout(2500);
await shot('06_online');
await ev(`__app.go('ghosts')`);
await page.waitForTimeout(2000);
await shot('07_ghosts');
const n = await ev(`(__app.screens.ghosts.list||[]).length`);
console.log('ghosts listed', n);
if (n) {
  await ev(`__app.screens.ghosts.challenge(__app.screens.ghosts.list[0])`);
  await page.waitForTimeout(3000);
  await ev(`__app.spec.skip()`);
  await page.waitForTimeout(4000);
  await shot('08_ghost_result');
  await ev(`__app.go('ghosts')`);
  await ev(`__app.screens.ghosts.load()`);
  await page.waitForTimeout(1500);
  console.log('ghost record', JSON.stringify(await ev(`__app.screens.ghosts.list.map(g=>[g.name,g.w,g.l,g.d])`)));
}
const fatal = await ev('__app.fatal');
if (fatal) logs.push('[fatal] ' + fatal);
console.log(logs.join('\n'));
await browser.close();
