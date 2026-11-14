// tests/shell.test.js — PWA の外側（ファイル構成・オフライン用の保存リスト・画面の部品・ドットのグラフ）の点検
//   ブラウザがなくても確かめられることを Node で確かめる。
//   グラフは本物の canvas のかわりに「fillRect を記録するだけの偽物」に描かせて、範囲外や NaN がないかを見る
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test, section, assert, eq } from './harness.js';
import { Lab, MODE } from '../js/sim.js';
import { M } from '../js/defs.js';
import { recordReplay } from '../js/replay.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ---- 偽の canvas（描いたドットを数え、変な座標がないか調べる）
class FakeCtx {
  constructor(cv) {
    this.cv = cv;
    this.fillStyle = '#000';
    this.imageSmoothingEnabled = true;
  }
  fillRect(x, y, w, h) {
    const cv = this.cv;
    cv.ops++;
    if (![x, y, w, h].every(Number.isFinite)) cv.bad.push(`NaN ${x},${y},${w},${h}`);
    else if (x + w <= 0 || y + h <= 0 || x >= cv.width || y >= cv.height) cv.out++;
    if (typeof this.fillStyle !== 'string' || !/^(#[0-9a-f]{3,8}|rgba?\()/i.test(this.fillStyle)) cv.bad.push(`色 ${this.fillStyle}`);
  }
  clearRect() {}
  drawImage(img, x, y) {
    this.cv.ops++;
    if (![x, y].every(Number.isFinite)) this.cv.bad.push(`drawImage NaN ${x},${y}`);
  }
}
class FakeCanvas {
  constructor() {
    this.width = 300;
    this.height = 150;
    this.ops = 0;
    this.out = 0;
    this.bad = [];
    this.style = {};
    this.dataset = {};
    this.ctx = new FakeCtx(this);
  }
  getContext() {
    return this.ctx;
  }
  toDataURL() {
    return 'data:image/png;base64,AAAA';
  }
}
function installFakeDocument() {
  globalThis.document = { createElement: (t) => (t === 'canvas' ? new FakeCanvas() : {}) };
}

export function registerShellTests() {
  section('PWA の外側（index.html・sw.js・manifest・アイコン・ドットのグラフ）');

  test('index.html が読みこむファイルがすべてある（相対パスだけ・CDNなし）', () => {
    const html = read('index.html');
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    assert(refs.length >= 5, '参照が少なすぎる');
    for (const r of refs) {
      assert(!/^(https?:)?\/\//.test(r), `外部への参照がある: ${r}`);
      assert(!r.startsWith('/'), `絶対パスがある: ${r}`);
      assert(existsSync(join(ROOT, r)), `ない: ${r}`);
    }
    assert(refs.includes('js/main.js') && refs.includes('manifest.webmanifest') && refs.includes('style.css'));
  });

  test('sw.js の保存リストに、動かすのに必要な全ファイルが入っている（初回からオフライン）', () => {
    const sw = read('sw.js');
    const list = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter((p) => p !== '');
    for (const p of list) assert(existsSync(join(ROOT, p)), `sw.js にあるのにファイルがない: ${p}`);
    for (const f of readdirSync(join(ROOT, 'js'))) if (f.endsWith('.js')) assert(list.includes(`js/${f}`), `sw.js に入っていない: js/${f}`);
    for (const f of ['index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', 'lib/three.module.min.js']) assert(list.includes(f), `sw.js に入っていない: ${f}`);
    // js どうしの import がすべて保存リストの中で閉じている
    for (const f of readdirSync(join(ROOT, 'js'))) {
      if (!f.endsWith('.js')) continue;
      for (const m of read(`js/${f}`).matchAll(/from '(\.[^']+)'/g)) {
        const target = join('js', m[1]).replace(/\\/g, '/');
        assert(existsSync(join(ROOT, target)), `${f} の import 先がない: ${m[1]}`);
        assert(list.includes(target), `${f} の import 先が sw.js にない: ${target}`);
      }
    }
  });

  test('manifest は正しい JSON で、アイコンと開始URLが相対パス', () => {
    const mf = JSON.parse(read('manifest.webmanifest'));
    eq(mf.start_url, './');
    eq(mf.display, 'standalone');
    assert(mf.icons.length > 0);
    for (const ic of mf.icons) assert(existsSync(join(ROOT, ic.src)), `アイコンがない: ${ic.src}`);
  });

  test('icon.svg はドット絵（crispEdges・32×32 の整数座標だけ）', () => {
    const svg = read('icon.svg');
    assert(svg.includes('shape-rendering="crispEdges"'), 'crispEdges でない');
    assert(svg.includes('viewBox="0 0 32 32"'));
    const nums = [...svg.matchAll(/[MhvHV](-?[\d.]+)/g)].map((m) => Number(m[1]));
    assert(nums.length > 50 && nums.every((n) => Number.isInteger(n)), '小数の座標がある');
  });

  test('style.css はドット調（pixelated・角丸なし・ぼかし影なし）', () => {
    const css = read('style.css');
    assert(css.includes('image-rendering: pixelated'));
    assert(!/border-radius:\s*(?!0)[\d.]+/.test(css), '角丸が使われている');
    assert(!/(linear|radial)-gradient/.test(css), 'グラデーションが使われている');
    // box-shadow のぼかしは 0 だけ（x y blur spread の blur が 0）
    for (const m of css.matchAll(/box-shadow:([^;]+);/g)) {
      for (const part of m[1].split(/,(?![^(]*\))/)) {
        const toks = part.replace(/var\([^)]*\)/g, '1px').replace(/calc\([^)]*\)/g, '1px').replace(/rgba?\([^)]*\)/g, 'C').trim().split(/\s+/).filter((t) => t !== 'inset' && t !== 'C' && t !== 'none' && !t.startsWith('#'));
        if (toks.length >= 3) assert(parseFloat(toks[2]) === 0, `ぼかし影: ${part.trim()}`);
      }
    }
  });

  test('画面のスクリプトが使う要素の id が index.html か部品のテンプレートにある', () => {
    const html = read('index.html');
    const ui = read('js/ui.js');
    const main = read('js/main.js');
    const ids = new Set();
    for (const src of [ui, main]) {
      for (const m of src.matchAll(/\$\('([\w-]+)'\)/g)) ids.add(m[1]);
      for (const m of src.matchAll(/getElementById\('([\w-]+)'\)/g)) ids.add(m[1]);
    }
    assert(ids.size > 30, `id が少ない ${ids.size}`);
    for (const id of ids) assert(html.includes(`id="${id}"`) || ui.includes(`id="${id}"`), `id="${id}" が見つからない`);
  });

  test('アイコンは全部 9×9 で、使っている色はすべてパレットにある', async () => {
    installFakeDocument();
    const { ICONS, PAL, iconCanvas } = await import('../js/icons.js');
    const { ACT_ICON, METHODS } = await import('../js/defs.js');
    const { SKILLS } = await import('../js/methods.js');
    for (const [name, rows] of Object.entries(ICONS)) {
      eq(rows.length, 9, `${name} の高さ`);
      for (const r of rows) {
        eq(r.length, 9, `${name} の幅`);
        for (const ch of r) assert(ch === '.' || PAL[ch], `${name} に知らない色 ${ch}`);
      }
      const cv = iconCanvas(name);
      assert(cv.ops > 5 && cv.bad.length === 0, `${name} がうまく描けない`);
    }
    for (const n of [...ACT_ICON, ...METHODS.map((d) => d.icon), ...SKILLS.map((s) => s.icon)]) assert(ICONS[n], `アイコン ${n} がない`);
    // 画面で名前を指定しているアイコンもすべてある
    for (const f of ['index.html', 'js/ui.js']) {
      for (const m of read(f).matchAll(/data-icon="(\w+)"|iconHTML\('(\w+)'|iconURL\('(\w+)'\)/g)) {
        const n = m[1] || m[2] || m[3];
        assert(ICONS[n], `${f} のアイコン ${n} がない`);
      }
    }
  });

  test('ドットのグラフ: 学習曲線・系図・種の川・Q表・脳・サイコロ・リプレイ・取り分が、範囲内に描ける', async () => {
    installFakeDocument();
    const C = await import('../js/charts.js');
    const sep = new Lab({ seed: 5, mode: MODE.SEPARATE, founders: 10, days: 2 });
    sep.runGenerations(14);
    const arena = new Lab({ seed: 5, mode: MODE.ARENA, founders: 10, days: 2 });
    arena.runGenerations(6);
    const check = (name, cv, minOps = 20) => {
      assert(cv.bad.length === 0, `${name}: ${cv.bad.slice(0, 3).join(' / ')}`);
      assert(cv.ops >= minOps, `${name}: ほとんど描かれていない（${cv.ops}）`);
      assert(cv.out <= cv.ops * 0.02, `${name}: 範囲外のドットが多い（${cv.out}/${cv.ops}）`);
      assert(Number.isInteger(cv.width) && Number.isInteger(cv.height) && cv.width > 0 && cv.height > 0, `${name}: 大きさ ${cv.width}×${cv.height}`);
    };
    for (const met of Object.keys(C.METRICS)) {
      const lab = met === 'share' ? arena : sep;
      for (const w of [96, 175, 233]) {
        const cv = new FakeCanvas();
        C.drawCurves(cv, lab, met, { w, h: Math.round(w * 0.56), ruleLine: true });
        check(`学習曲線 ${met} w${w}`, cv);
      }
    }
    for (const m of [M.NN, M.DICE]) {
      const cv = new FakeCanvas();
      C.drawLineage(cv, sep, m, { maxW: 175 });
      check(`系図 ${m}`, cv, 100);
      assert(cv.width <= 175, `系図の幅 ${cv.width}`);
      const rv = new FakeCanvas();
      C.drawSpeciesRiver(rv, sep.learnerOf(m).book, sep.gen, { h: 40, maxW: 175 });
      check(`種の川 ${m}`, rv);
    }
    const q = new FakeCanvas();
    C.drawQPolicy(q, sep.learnerOf(M.Q).q, sep.learnerOf(M.Q).visits);
    check('Q表', q, 144);
    const b = new FakeCanvas();
    C.drawBrain(b, sep.learnerOf(M.NN).current[0].g);
    check('脳', b, 91);
    const d = new FakeCanvas();
    C.drawDice(d, sep.learnerOf(M.DICE).meanProbs(), 175);
    check('サイコロ', d);
    const rep = recordReplay(sep, sep.best[M.NN]);
    for (const t of [0, 40, rep.ticks]) {
      const r = new FakeCanvas();
      C.drawReplay(r, rep, t, 175);
      check(`リプレイ t${t}`, r);
    }
    const sh = new FakeCanvas();
    C.drawShare(sh, arena, 175);
    check('取り分', sh);
    // データがまだない（世代0）ときも落ちない
    const fresh = new Lab({ seed: 9, mode: MODE.SEPARATE, founders: 8, days: 1 });
    for (const met of ['fit', 'life']) C.drawCurves(new FakeCanvas(), fresh, met, { w: 120, h: 60 });
    C.drawLineage(new FakeCanvas(), fresh, M.NN, { maxW: 120 });
    C.drawSpeciesRiver(new FakeCanvas(), fresh.learnerOf(M.NN).book, 0, { maxW: 120 });
  });

  test('3×5 のドット文字: 目盛りに使う文字がすべてある', async () => {
    installFakeDocument();
    const { pixText, textWidth } = await import('../js/icons.js');
    const cv = new FakeCanvas();
    pixText(cv.ctx, '0123456789.-+%/:XG ABCDEFGHIJKLMNOPQRSTUVWXYZ', 0, 0, '#ffffff');
    assert(cv.bad.length === 0);
    eq(textWidth('G12'), 11);
  });

  test('描画モジュールは Three.js（同梱版）と一緒に読みこめる', async () => {
    const T = await import('../lib/three.module.min.js');
    for (const k of ['WebGLRenderer', 'InstancedMesh', 'WebGLRenderTarget', 'DepthTexture', 'ShaderMaterial', 'NearestFilter', 'Points']) assert(T[k], `three に ${k} がない`);
    const R = await import('../js/render.js');
    assert(typeof R.View === 'function');
  });
}
