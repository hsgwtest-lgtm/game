// 画面めぐりのスクリーンショット: node tools/ui_tour.mjs <outdir> [screens...]
// ローカルサーバー（python3 -m http.server 8123）が必要
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'fs';

const out = process.argv[2] || 'tour';
const only = process.argv.slice(3);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => { if (m.type() !== 'log' || /error|warn/i.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
await page.addInitScript(() => {
  if (!sessionStorage.getItem('init')) {
    sessionStorage.setItem('init', '1');
    localStorage.clear();
    localStorage.setItem('nuribots/save/v1', JSON.stringify({ v: 1, seen: { intro: 1 }, profile: { id: 'testplayer01', name: 'テスト' } }));
  }
});
await page.goto('http://127.0.0.1:8123/?safe=47,34&screen=home&db=http://127.0.0.1:8124');
await page.waitForTimeout(1500);

const steps = [
  ['home', `__app.go('home')`, 2500],
  ['design', `__app.go('design')`, 1200],
  ['train', `__app.go('train')`, 9000],
  ['train_heat', `__app.screens.train.heatOn=true`, 2500],
  ['train_tab1', `__app.screens.train.heatOn=false; __app.world.setHeat(null); __app.screens.train.tab=1`, 1500],
  ['train_tab2', `__app.screens.train.tab=2`, 1500],
  ['train_tab3', `__app.screens.train.tab=3`, 1500],
  ['train_tab4', `__app.screens.train.tab=4`, 1500],
  ['train_set', `__app.screens.train.sheet='set'`, 1000],
  ['league', `__app.screens.train.sheet=null; __app.go('league')`, 2500],
  ['league_sheet', `__app.screens.league.sel=0`, 1000],
  ['battle', `__app.screens.league.fight(window.__lg0 = (await import('./js/game/league.js')).LEAGUE[0])`, 3500],
  ['battle_play', ``, 5000],
  ['result', `__app.spec.skip()`, 4500],
  ['album', `__app.go('album')`, 1500],
  ['howto', `__app.go('howto')`, 1200],
  ['howto3', `__app.screens.howto.page=2`, 1000],
  ['settings', `__app.go('settings')`, 1000],
  ['online', `__app.go('online')`, 3000],
  ['name', `__app.go('name',{title:'なまえ',initial:'ヌリー'})`, 800],
  ['title', `__app.go('title')`, 2500],
];
for (const [name, code, wait] of steps) {
  if (only.length && !only.includes(name)) { if (code) await page.evaluate(`(async()=>{${code}})()`).catch(e => logs.push('[eval] ' + e.message)); await page.waitForTimeout(Math.min(wait, 800)); continue; }
  if (code) await page.evaluate(`(async()=>{${code}})()`).catch(e => logs.push(`[eval ${name}] ` + e.message));
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
}
const fatal = await page.evaluate(() => window.__app && window.__app.fatal);
if (fatal) logs.push('[fatal] ' + fatal);
console.log(logs.join('\n'));
await browser.close();
