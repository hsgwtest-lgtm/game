// 動きの連続写真（コンタクトシート）を作る: node tools/sheet.mjs <key> <genes.json|-> <out.png> [times] [query]
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { execFileSync } from 'child_process';
const [key, g, out, timesArg, extra] = process.argv.slice(2);
const times = (timesArg || '0,0.5,1,1.5,2,2.5,3,3.5,4,5,6,8').split(',').map(Number);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 360, height: 300 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const url = `http://localhost:8765/softevo3dB/tools/view.html?static=1&k=${key}${g && g !== '-' ? '&g=tmp/' + g : ''}${extra ? '&' + extra : ''}`;
await page.goto(url);
await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
const files = [];
for (const t of times) {
  const r = await page.evaluate((t) => window.__seek(t), t);
  const f = `/tmp/claude-0/-home-claude/5a420261-25a1-5a7d-806d-c7a9d1baa61c/scratchpad/sheet_${files.length}.png`;
  await page.screenshot({ path: f });
  files.push(f);
  if (r.fell) { console.log('fell at', r.t.toFixed(2)); }
}
await browser.close();
if (errs.length) console.log('errors:', errs.slice(0, 5).join('\n'));
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
fs = sys.argv[2:]
ims = [Image.open(f) for f in fs]
w, h = ims[0].size
cols = 4
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, h * rows), (0, 0, 0))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(sys.argv[1])
`, out, ...files]);
console.log('saved', out);
