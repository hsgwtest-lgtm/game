// ヘッドレスブラウザで画面を撮る: node tools/shot.mjs <url-path> <out.png> [waitMs] [w] [h] [actions-json]
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const [,, path = '/', out = 'shot.png', wait = '2500', w = '390', h = '844', actions = '[]'] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto('http://127.0.0.1:8123' + path);
await page.waitForTimeout(+wait);
for (const a of JSON.parse(actions)) {
  if (a.tap) { await page.mouse.click(a.tap[0], a.tap[1]); }
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.shot) await page.screenshot({ path: a.shot });
  if (a.eval) logs.push('[eval] ' + JSON.stringify(await page.evaluate(a.eval)));
}
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
