// 画面を撮る（開発用）: node tools/ui.mjs "index.html?screen=title" out.png [waitMs] [actions-json]
//  actions: [{"click":"css"}, {"wait":ms}, {"shot":"file.png"}, {"eval":"js"}, {"tap":[x,y]}]
import { serve, launch } from './run.mjs';
const [,, page = 'index.html', out = '/tmp/ui.png', wait = '3000', actions = '[]'] = process.argv;
const srv = await serve();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const pg = await ctx.newPage();
const logs = [];
pg.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
pg.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await pg.goto(`http://127.0.0.1:${srv.address().port}/${page}`, { waitUntil: 'commit' });
await pg.waitForTimeout(+wait);
for (const a of JSON.parse(actions)) {
  try {
    if (a.click) await pg.click(a.click, { timeout: 5000 });
    if (a.tap) await pg.mouse.click(a.tap[0], a.tap[1]);
    if (a.wait) await pg.waitForTimeout(a.wait);
    if (a.shot) await pg.screenshot({ path: a.shot });
    if (a.eval) logs.push('[eval] ' + JSON.stringify(await pg.evaluate(a.eval)));
  } catch (e) { logs.push('[action-error] ' + JSON.stringify(a) + ' ' + e.message); }
}
await pg.screenshot({ path: out });
console.log(logs.filter((l) => !l.includes('favicon')).join('\n'));
await browser.close();
srv.close();
