// 画面を iPhone 12 の大きさで撮る（開発用）: node tools/shot.mjs out.png "?s=7" "js to run" [waitMs]
import { serve, launch } from './run.mjs';
const [out, query = '', script = '', wait = '1500'] = process.argv.slice(2);
const srv = await serve();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const pg = await ctx.newPage();
const logs = [];
pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
pg.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html${query}`, { waitUntil: 'load' });
await pg.waitForTimeout(600);
if (script) { const r = await pg.evaluate(script); if (r !== undefined) console.log('result:', JSON.stringify(r)); }
await pg.waitForTimeout(+wait);
await pg.screenshot({ path: out });
console.log(logs.filter((l) => !l.includes('404') && !l.includes('GPU stall')).slice(0, 15).join('\n'));
await browser.close(); srv.close();
