// いきもの ずかん: 育てている生き物の一覧
import { C, text, button, win, bigButton, iconButton, mini, LINE_H } from '../ui/widgets.js';
import { ICON, MOVE_ICON } from '../gfx/icons.js';
import { drawIso } from '../ui/iso.js';
import { message, confirm, sheet, askName } from '../ui/overlay.js';
import { db } from '../core/db.js';
import { titleFor, formatFit, MOVES } from '../evo/growth.js';
import { PRESETS } from '../sim/presets.js';
import { NAMES } from '../core/config.js';
import { newRecord } from '../evo/session.js';
import { decodeShare, openShareDialog, downloadJSON, parseJSON, pickFile } from '../core/share.js';
import { drawLogo } from './title.js';
import { wrap } from '../gfx/font.js';

export class ZukanScreen {
  constructor(app) { this.app = app; this.list = null; this.scroll = 0; this.t = 0; }

  enter(params = {}) {
    const app = this.app;
    this.t = 0;
    this.list = null;
    this.scroll = 0;
    app.sound.setMood('title');
    app.world.setTheme('flat');
    this.reload();
  }

  async reload() {
    const list = await db.listCreatures();
    list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    this.list = list;
    if (this.app.incoming) {
      const code = this.app.incoming;
      this.app.incoming = null;
      this.importCode(code);
    }
  }

  exit() {}
  viewHeight() { return 0; }
  update(dt) { this.t += dt; }

  async importCode(code) {
    const app = this.app;
    let p;
    try { p = await decodeShare(code); }
    catch (e) { message(app, { title: 'よみこめません', text: String(e.message || e), buttons: [{ label: 'OK' }], sfx: 'error' }); return; }
    message(app, {
      title: 'いきものが とどいた！', sfx: 'hatch',
      text: `${p.name}（LV${p.level}）\nずかんに くわえますか？`,
      extraH: 50,
      extraDraw: (fb, x, y, w) => drawIso(fb, p.voxels, x + w / 2, y + 24, w - 20, 46),
      buttons: [{ label: 'やめる' }, {
        label: 'くわえる', accent: C.lime, onTap: async () => {
          const rec = newRecord({ name: p.name, voxels: p.voxels, env: p.env, hidden: p.hidden, popSize: app.settings.pop, seedGenomes: p.genome ? [p.genome] : null });
          rec.journal.push({ gen: 0, kind: 'gift', text: p.genome ? `とどいた脳（${formatFit(p.env.objective, p.fit)}）から はじめる` : 'とどいた体から はじめる' });
          await db.putCreature(rec);
          app.toast(`${p.name} を くわえた！`, C.lime);
          this.reload();
        },
      }],
    });
  }

  openCard(rec) {
    const app = this.app;
    sheet(app, {
      title: rec.name,
      items: [
        { label: '▶ そだてる', onTap: () => app.go('lab', { id: rec.id }), active: true },
        { label: '成長パレード', sub: '昔の自分と競争', onTap: () => app.go('parade', { id: rec.id }) },
        { label: 'からだを かいぞう', sub: '脳は引きつぐ', onTap: () => app.go('build', { remodel: rec.id }) },
        { label: 'なまえを かえる', onTap: () => askName(app, { value: rec.name, randomName, onDone: async (v) => { rec.name = v; await db.putCreature(rec); this.reload(); } }) },
        { label: '共有コード（URL）', sub: 'ともだちへ', onTap: () => this.share(rec) },
        { label: 'ファイルに かきだす', immediate: true, onTap: () => this.exportFile(rec) },
        { label: 'にがす（けす）', onTap: () => confirm(app, 'にがす', `${rec.name} を にがしますか？\n（記録も きえます）`, async () => { await db.deleteCreature(rec.id); app.sfx('erase'); this.reload(); }, 'にがす', 'やめる') },
      ],
    });
  }

  async share(rec) {
    const champs = await db.getChamps(rec.id);
    openShareDialog(this.app, rec, bestChamp(champs, rec), message, C);
  }

  async exportFile(rec) {
    const champs = await db.getChamps(rec.id);
    downloadJSON(`softevo3d-${rec.name}.json`, { t: 'se3d-file', v: 1, rec, champs });
    this.app.sfx('save');
  }

  async importFile() {
    const app = this.app;
    const textStr = await pickFile();
    if (!textStr) return;
    try {
      const o = parseJSON(textStr);
      if (o.t !== 'se3d-file' || !o.rec) throw new Error('SoftEvo 3D のファイルではありません');
      const rec = o.rec;
      const old = rec.id;
      rec.id = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      rec.updated = Date.now();
      await db.putCreature(rec);
      await db.putChamps((o.champs || []).map(c => Object.assign({}, c, { cid: rec.id })));
      app.toast(`${rec.name} を よみこんだ`, C.lime);
      if (old) this.reload(); else this.reload();
    } catch (e) {
      message(app, { title: 'よみこめません', text: String(e.message || e), buttons: [{ label: 'OK' }], sfx: 'error' });
    }
  }

  newCreature() {
    const app = this.app;
    sheet(app, {
      title: 'あたらしく つくる',
      note: 'おてほんを もとにして、自由に かえられます',
      rowH: 17,
      items: [
        { label: 'からっぽから つくる', onTap: () => app.go('build', { preset: 'empty' }) },
        ...PRESETS.map(p => ({ label: p.name, sub: p.desc.slice(0, 11), onTap: () => app.go('build', { preset: p.key }) })),
      ],
    });
  }

  raceMenu() {
    const app = this.app;
    const sel = new Set(this.list.slice(0, 3).map(r => r.id));
    const items = this.list.slice(0, 8).map(r => ({
      label: r.name, sub: `LV${r.level}`,
      get active() { return sel.has(r.id); },
      onTap: () => { if (sel.has(r.id)) sel.delete(r.id); else if (sel.size < 5) sel.add(r.id); },
    }));
    const m = sheet(app, {
      title: 'かけっこ大会', keepOpen: true, rowH: 17,
      note: '出場する生き物を えらんでね（5匹まで）',
      items: [...items, { label: '▶ スタート', onTap: () => { if (sel.size < 2) { app.sfx('error'); return; } m.close(); app.go('parade', { race: [...sel] }); } }],
    });
  }

  importMenu() {
    const app = this.app;
    sheet(app, {
      title: 'よみこむ',
      items: [
        { label: '共有コードを はりつける', onTap: () => { const c = window.prompt('共有コード（URL）を はりつけてください'); if (c) this.importCode(c); } },
        { label: 'ファイルから', immediate: true, onTap: () => this.importFile() },
      ],
    });
  }

  draw(fb) {
    const app = this.app, px = app.px;
    const VW = px.VW, VH = px.VH, top = px.safe.t, bot = VH - px.safe.b;
    // 背景（3Dなし）: 方眼
    fb.rect(0, 0, VW, VH, C.navy);
    for (let y = (Math.floor(this.t * 6) % 12); y < VH; y += 12) fb.rect(0, y, VW, 1, C.slate);
    for (let x = 0; x < VW; x += 12) fb.rect(x, 0, 1, VH, C.slate);
    drawLogo(fb, VW / 2, top + 6, 2);
    text(fb, 'いきもの ずかん', VW / 2, top + 19, C.white, { align: 'center', outline: C.ink });
    iconButton(app, 'z_set', VW - 22, top + 4, 18, 14, ICON.gear, () => app.go('settings'));
    if (this.list && this.list.length >= 2) iconButton(app, 'z_race', 4, top + 4, 18, 14, ICON.flag, () => this.raceMenu());
    const listTop = top + 34, listBot = bot - 44;
    if (this.list === null) {
      text(fb, 'よみこみちゅう…', VW / 2, listTop + 40, C.silver, { align: 'center' });
    } else if (!this.list.length) {
      const w = VW - 20;
      const lines = wrap('ブロックを つんで 3Dの生き物を つくろう。筋肉の色ごとに 脳から 神経が つながり、世代を かさねて すこしずつ 歩きかたを おぼえていきます。', w - 18);
      win(fb, 10, listTop + 10, w, 24 + lines.length * LINE_H, { title: 'ようこそ！' });
      lines.forEach((l, i) => text(fb, l, 19, listTop + 20 + i * LINE_H, C.white));
      const iy = listTop + 40 + lines.length * LINE_H + 40;
      drawIso(fb, PRESETS[0].voxels, VW / 2, iy, 120, 90);
      text(fb, '「＋ つくる」から はじめよう', VW / 2, iy + 46, C.yellow, { align: 'center', outline: C.ink });
    } else {
      this._drawList(fb, listTop, listBot);
    }
    const bw = Math.floor((VW - 24) / 2);
    bigButton(app, 'z_new', 8, bot - 40, bw + 18, 34, '＋ つくる', 'あたらしい生き物', () => this.newCreature(), { accent: C.lime });
    button(app, 'z_imp', 30 + bw, bot - 40, VW - 38 - bw, 34, 'よみこむ', () => this.importMenu(), { icon: ICON.share });
  }

  _drawList(fb, y0, y1) {
    const app = this.app, VW = app.px.VW;
    const cardH = 54, gap = 4;
    const total = this.list.length * (cardH + gap);
    const maxScroll = Math.max(0, total - (y1 - y0));
    this.scroll = Math.max(0, Math.min(maxScroll, this.scroll));
    fb.setClip(0, y0, VW, y1 - y0);
    this.list.forEach((rec, i) => {
      const y = Math.round(y0 + i * (cardH + gap) - this.scroll);
      if (y > y1 || y + cardH < y0) return;
      const pressed = this._press === i;
      fb.rrect(6, y + 1, VW - 12, cardH - 1, C.ink);
      fb.rrect(6, y + (pressed ? 1 : 0), VW - 12, cardH - 1, C.ink);
      fb.rect(7, y + 1 + (pressed ? 1 : 0), VW - 14, cardH - 3, pressed ? C.slate : C.navy);
      fb.rect(9, y + 3, 58, cardH - 7, C.ink);
      drawIso(fb, rec.voxels, 38, y + cardH / 2, 54, cardH - 10);
      const tx = 72;
      text(fb, rec.name, tx, y + 3, C.white, { bold: true });
      text(fb, `LV${rec.level}`, VW - 12, y + 3, C.yellow, { align: 'right' });
      text(fb, `「${titleFor(rec.level)}」`, tx, y + 15, C.cyan);
      const last = rec.last;
      text(fb, `${rec.gen}世代  ${last ? formatFit(last.obj || 'distance', bestOf(rec)) : '--'}`, tx, y + 27, C.silver);
      let mx = tx;
      for (const k of Object.keys(rec.moves || {})) {
        const ic = MOVE_ICON[MOVES[k].icon];
        if (ic && mx < VW - 20) { fb.sprite(ic, mx, y + 40, ic.cols); mx += 11; }
      }
    });
    fb.resetClip();
    if (maxScroll > 0) {
      const h = Math.max(10, (y1 - y0) * (y1 - y0) / total);
      const sy = y0 + (y1 - y0 - h) * (this.scroll / maxScroll);
      fb.rect(VW - 4, Math.round(sy), 2, Math.round(h), C.steel);
    }
    // スクロールとタップ
    app.ui.area('z_list', 0, y0, VW, y1 - y0, {
      down: (x, y) => { this._drag = { y, s: this.scroll, moved: false }; this._press = Math.floor((y - y0 + this.scroll) / (cardH + gap)); },
      move: (x, y) => {
        if (!this._drag) return;
        if (Math.abs(y - this._drag.y) > 4) { this._drag.moved = true; this._press = -1; }
        if (this._drag.moved) this.scroll = this._drag.s - (y - this._drag.y);
      },
      up: (x, y) => {
        const d = this._drag; this._drag = null; this._press = -1;
        if (!d || d.moved) return;
        const i = Math.floor((y - y0 + this.scroll) / (cardH + gap));
        const inCard = ((y - y0 + this.scroll) % (cardH + gap)) < cardH;
        if (inCard && this.list[i]) { app.sfx('tap'); this.openCard(this.list[i]); }
      },
    });
  }
}

function bestOf(rec) {
  const k = rec.env ? `${rec.env.terrain}/${rec.env.gravity}/${rec.env.objective}` : '';
  const b = rec.bests && rec.bests[k];
  return b ? b.fit : (rec.last ? rec.last.fit : 0);
}

export function bestChamp(champs, rec) {
  if (!champs.length) return null;
  const e = champs[champs.length - 1].e;
  let best = null;
  for (const c of champs) if (c.e === e && (!best || c.fit > best.fit)) best = c;
  return best || champs[champs.length - 1];
}

export function randomName() { return NAMES[Math.floor(Math.random() * NAMES.length)]; }
