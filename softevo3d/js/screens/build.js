// からだを つくる（ボクセル設計画面）
//  ・面をタップ → となりにブロックを置く / 床をタップ → 床に置く
//  ・ドラッグでまわす、2本指でズーム
//  ・ミラー: 左右対称に置く（筋肉は となりの色 A↔B, C↔D, E↔F になる＝左右べつべつに動かせる）

import { C, text, button, iconButton, win, LINE_H, measure } from '../ui/widgets.js';
import { ICON } from '../gfx/icons.js';
import { MAT_LOOK, PAL, NAMES, CH_NAME } from '../core/config.js';
import { rgb } from '../gfx/fb.js';
import { message, confirm, sheet, askName } from '../ui/overlay.js';
import { BuildView } from '../world/buildview.js';
import { Actor, Clock } from '../world/actor.js';
import { compileBody, validateVoxels, normalizeVoxels, inGrid, isMuscle, channelOf, MIRROR_CH, M_MUSCLE0, MAX_VOXELS, bodyStats } from '../sim/body.js';
import { brainLayout, randomGenome } from '../sim/brain.js';
import { PRESETS, presetByKey } from '../sim/presets.js';
import { RNG } from '../core/rng.js';
import { db } from '../core/db.js';
import { newRecord, remodelRecord } from '../evo/session.js';
import { randomName } from './zukan.js';

const MATS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const TOOLS = [['place', ICON.place, 'おく'], ['erase', ICON.erase, 'けす'], ['paint', ICON.paint, 'ぬる']];

export class BuildScreen {
  constructor(app) { this.app = app; this.view = null; }

  async enter(params = {}) {
    const app = this.app, w = app.world;
    if (!this.view) this.view = new BuildView(w);
    this.t = 0;
    this.tool = 'place';
    this.mat = 1;
    this.mirror = true;
    this.undoStack = [];
    this.redoStack = [];
    this.testing = null;
    this.remodel = null;
    this.name = '';
    this.vox = [];
    this.cursor = null;
    w.setTheme('build');
    w.envGroup.visible = false;
    w.buildGroup.visible = true;
    w.setView(0.65, 0.55, 1.7, true);
    w.cam.lead = 0;
    app.sound.setMood('build');
    this.view.showMirror(true);
    this.vox = [[0, 0, 0, 1]];
    if (params.preset && params.preset !== 'empty') this.vox = presetByKey(params.preset).voxels.map(v => v.slice());
    this._changed(false);
    if (params.remodel) {
      const rec = await db.getCreature(params.remodel);
      if (rec) { this.remodel = rec; this.vox = rec.voxels.map(v => v.slice()); this.name = rec.name; }
      this._changed(false);
    }
    const c = this.view.center();
    w.focus(c.x, c.y, c.z, true);
    if (!app.settings.help.build) {
      app.settings.help.build = true; app.saveSettings();
      message(app, {
        title: 'からだの つくりかた', align: 'left', width: 186,
        lines: [
          '・ブロックの面を タップ → となりに おく',
          '・ドラッグで まわす / 2本指で ズーム',
          '・色つきは 筋肉。脳の信号で ふくらむ・',
          '　ちぢむ。同じ色は 同じ神経で動く',
          '・ミラーON で 左右対称（反対がわは',
          '　となりの色になり べつべつに動く）',
          '・「ためす」で でたらめな脳で 動かせる',
        ],
        buttons: [{ label: 'わかった' }],
      });
    }
  }

  exit() {
    this._stopTest();
    this.app.world.buildGroup.visible = false;
    this.app.world.envGroup.visible = true;
    this.app.world.cam.lead = 0.25;
  }

  panelH() { return 96 + this.app.px.safe.b; }
  viewHeight() { return this.app.px.VH - this.panelH(); }

  _snapshot() { return this.vox.map(v => v.slice()); }
  _push() {
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() { if (!this.undoStack.length) return; this.redoStack.push(this._snapshot()); this.vox = this.undoStack.pop(); this.app.sfx('undo'); this._changed(); }
  redo() { if (!this.redoStack.length) return; this.undoStack.push(this._snapshot()); this.vox = this.redoStack.pop(); this.app.sfx('undo'); this._changed(); }

  _changed(stopTest = true) {
    if (stopTest) this._stopTest();
    const v = validateVoxels(this.vox);
    this.problems = v.problems;
    this.bad = new Set();
    if (v.comps && v.comps.count > 1) {
      // いちばん大きいかたまり以外を「はなれている」とする
      const cnt = new Map();
      for (const c of v.comps.comp) cnt.set(c, (cnt.get(c) || 0) + 1);
      let main = 0, mx = -1;
      for (const [c, n] of cnt) if (n > mx) { mx = n; main = c; }
      const norm = v.vox;
      const keyOf = (a) => a[0] + ',' + a[1] + ',' + a[2];
      const badKeys = new Set();
      norm.forEach((a, i) => { if (v.comps.comp[i] !== main) badKeys.add(keyOf(a)); });
      this.vox.forEach((a, i) => { if (badKeys.has(keyOf(a))) this.bad.add(i); });
    }
    this.stats = bodyStats(this.vox);
    this.view.setVoxels(this.vox, { bad: this.bad, blink: true });
  }

  _find(x, y, z) { return this.vox.findIndex(v => v[0] === x && v[1] === y && v[2] === z); }
  _mirrorMat(m) { return isMuscle(m) ? M_MUSCLE0 + MIRROR_CH[channelOf(m)] : m; }

  _target(hit) {
    if (!hit) return null;
    if (this.tool === 'place') {
      const c = hit.type === 'voxel' ? [hit.cell[0] + hit.normal[0], hit.cell[1] + hit.normal[1], hit.cell[2] + hit.normal[2]] : hit.cell;
      if (!inGrid(c[0], c[1], c[2]) || this._find(c[0], c[1], c[2]) >= 0) return null;
      return c;
    }
    return hit.type === 'voxel' ? hit.cell : null;
  }

  _apply(cell) {
    const app = this.app;
    const cells = [cell];
    if (this.mirror && cell[2] !== 0) cells.push([cell[0], cell[1], -cell[2]]);
    if (this.tool === 'place') {
      if (this.vox.length + cells.length > MAX_VOXELS) { app.sfx('error'); app.toast(`ブロックは ${MAX_VOXELS}こ まで`, C.red); return; }
      this._push();
      cells.forEach((c, i) => { if (this._find(c[0], c[1], c[2]) < 0) this.vox.push([c[0], c[1], c[2], i ? this._mirrorMat(this.mat) : this.mat]); });
      app.sfx('place');
    } else if (this.tool === 'erase') {
      if (this.vox.length <= cells.filter(c => this._find(c[0], c[1], c[2]) >= 0).length) { app.sfx('error'); return; }
      this._push();
      for (const c of cells) { const i = this._find(c[0], c[1], c[2]); if (i >= 0) this.vox.splice(i, 1); }
      app.sfx('erase');
    } else {
      this._push();
      cells.forEach((c, i) => { const k = this._find(c[0], c[1], c[2]); if (k >= 0) this.vox[k][3] = i ? this._mirrorMat(this.mat) : this.mat; });
      app.sfx('paint');
    }
    this._changed();
  }

  _ndc(x, y) {
    const px = this.app.px, vh = this.viewHeight();
    return { x: (x / px.VW) * 2 - 1, y: -((y / vh) * 2 - 1) };
  }

  _startTest() {
    const app = this.app;
    if (this.problems.length) { app.sfx('error'); app.toast(this.problems[0], C.red); return; }
    this._stopTest();
    const body = compileBody(this.vox);
    const L = brainLayout(body, app.settings.hidden);
    const g = randomGenome(L, new RNG());
    app.world.envGroup.visible = true;
    app.world.setTheme('flat');
    app.world.setTerrain('flat', 1);
    app.world.setRecord(null);
    this.view.setVisible(false);
    this.testing = { actor: new Actor(app.world, body, L, g, {}), clock: new Clock(), t: 0 };
    app.world.cam.lead = 0.2;
    app.sfx('go');
  }

  _stopTest() {
    if (!this.testing) return;
    this.testing.actor.dispose();
    this.testing = null;
    const w = this.app.world;
    w.envGroup.visible = false;
    w.setTheme('build');
    this.view.setVisible(true);
    w.cam.lead = 0;
    const c = this.view.center();
    w.focus(c.x, c.y, c.z);
  }

  _finish() {
    const app = this.app;
    if (this.problems.length) { app.sfx('error'); message(app, { title: 'まだ そだてられません', text: this.problems.join('\n'), buttons: [{ label: 'OK' }] }); return; }
    const go = async (name) => {
      let rec;
      if (this.remodel) rec = remodelRecord(this.remodel, null, normalizeVoxels(this.vox), name);
      else rec = newRecord({ name, voxels: this.vox, env: {}, hidden: app.settings.hidden, popSize: app.settings.pop });
      await db.putCreature(rec);
      app.settings.last = rec.id; app.saveSettings();
      app.go('lab', { id: rec.id, fresh: true });
    };
    askName(app, {
      title: this.remodel ? 'かいぞうした子の なまえ' : 'なまえを つけてね',
      value: this.name || randomName(), randomName, onDone: go,
    });
  }

  _presets() {
    const app = this.app;
    sheet(app, {
      title: 'おてほん', rowH: 17,
      items: PRESETS.map(p => ({
        label: p.name, sub: p.desc.slice(0, 11), onTap: () => {
          const load = () => { this._push(); this.vox = p.voxels.map(v => v.slice()); this._changed(); app.sfx('place'); const c = this.view.center(); app.world.focus(c.x, c.y, c.z); };
          if (this.vox.length > 1) confirm(app, 'おてほん', `いまの体を「${p.name}」に おきかえますか？`, load, 'おきかえる', 'やめる');
          else load();
        },
      })),
    });
  }

  update(dt, modal) {
    this.t += dt;
    const w = this.app.world;
    if (this.testing) {
      const T = this.testing;
      T.t += dt;
      T.actor.stepFrames(T.clock.frames(dt), 1e9);
      T.actor.sync(this.t);
      w.focus(T.actor.com[0], 0.12, T.actor.com[2]);
      if (T.t > 10) this._stopTest();
    } else {
      const c = this.view.center();
      w.focus(c.x, c.y, c.z);
      if (this.bad && this.bad.size) this.view.setVoxels(this.vox, { bad: this.bad, blink: Math.floor(this.t * 4) % 2 === 0 });
    }
  }

  draw(fb) {
    const app = this.app, px = app.px, VW = px.VW, VH = px.VH;
    const top = px.safe.t, vh = this.viewHeight();
    // ── 3D の操作 ──
    app.ui.area('b_view', 0, 0, VW, vh, {
      down: (x, y) => {
        this.drag = { x, y, moved: false, lx: x, ly: y };
        if (!this.testing) {
          const n = this._ndc(x, y);
          this.cursor = this._target(this.view.pick(n.x, n.y));
          this._updateCursor();
        }
      },
      move: (x, y) => {
        const d = this.drag; if (!d) return;
        if (!d.moved && Math.hypot(x - d.x, y - d.y) > 4) { d.moved = true; this.cursor = null; this._updateCursor(); }
        if (d.moved) app.world.orbit(-(x - d.lx) * 0.018, (y - d.ly) * 0.014);
        d.lx = x; d.ly = y;
      },
      up: () => {
        const d = this.drag; this.drag = null;
        if (d && !d.moved && this.cursor && !this.testing) this._apply(this.cursor);
        this.cursor = null; this._updateCursor();
      },
      cancelTap: () => { if (this.drag) this.drag.moved = true; this.cursor = null; this._updateCursor(); },
      pinch: (f) => app.world.zoom(f),
    });
    // ── 上のバー ──
    iconButton(app, 'b_back', 4, top + 3, 18, 14, ICON.back, () => {
      confirm(app, 'もどる', 'つくりかけの体は きえます。もどりますか？', () => app.go('zukan'), 'もどる', 'つづける');
    });
    const title = this.remodel ? `かいぞう: ${this.remodel.name}` : 'からだを つくる';
    text(fb, title, 26, top + 4, C.white, { outline: C.ink });
    const st = this.stats;
    text(fb, `${st.count}/${MAX_VOXELS}`, VW - 5, top + 4, st.count > MAX_VOXELS ? C.red : C.white, { align: 'right', outline: C.ink });
    text(fb, `${st.kg.toFixed(1)}kg  筋肉の色 ${st.channels.length}`, VW - 5, top + 17, C.silver, { align: 'right', outline: C.ink });
    if (this.testing) {
      const T = this.testing;
      text(fb, 'でたらめな脳で ためしちゅう', VW / 2, vh - 26, C.yellow, { align: 'center', outline: C.ink });
      text(fb, `${T.actor.distance.toFixed(2)}m`, VW / 2, vh - 14, C.white, { align: 'center', outline: C.ink });
    } else if (this.mirror) {
      text(fb, 'ミラー', 6, vh - 14, C.cyan, { outline: C.ink });
    }
    // ── 下のパネル ──
    const py = vh;
    fb.rect(0, py, VW, VH - py, C.navy);
    fb.rect(0, py, VW, 1, C.ink);
    fb.rect(0, py + 1, VW, 1, C.slate);
    let y = py + 5;
    // 道具
    const bw = 24, gap = 3;
    TOOLS.forEach(([key, icon], i) => {
      iconButton(app, 'b_tool_' + key, 6 + i * (bw + gap), y, bw, 16, icon, () => { this.tool = key; }, { active: this.tool === key });
    });
    iconButton(app, 'b_mirror', 6 + 3 * (bw + gap) + 4, y, bw, 16, ICON.mirror, () => { this.mirror = !this.mirror; this.view.showMirror(this.mirror); app.sfx('toggle'); }, { active: this.mirror });
    iconButton(app, 'b_undo', VW - 6 - bw * 2 - gap, y, bw, 16, ICON.undo, () => this.undo(), { disabled: !this.undoStack.length });
    iconButton(app, 'b_redo', VW - 6 - bw, y, bw, 16, ICON.redo, () => this.redo(), { disabled: !this.redoStack.length });
    y += 21;
    // 素材
    const sw = Math.floor((VW - 12 - 8 * 2) / 9);
    MATS.forEach((m, i) => {
      const x = 6 + i * (sw + 2);
      const sel = this.mat === m;
      const pressed = app.ui.btn('b_mat_' + m, x - 1, y - 1, sw + 2, 20, () => { this.mat = m; app.sfx('tap'); if (this.tool === 'erase') this.tool = 'place'; });
      fb.rrect(x, y + (pressed ? 1 : 0), sw, 17, sel ? C.white : C.ink);
      fb.rect(x + 1, y + 1 + (pressed ? 1 : 0), sw - 2, 15, rgb(MAT_LOOK[m].color));
      fb.rect(x + 1, y + 12 + (pressed ? 1 : 0), sw - 2, 4, rgb(MAT_LOOK[m].dark));
      if (isMuscle(m)) text(fb, 'ABCDEF'[m - 4], x + sw / 2, y + 2 + (pressed ? 1 : 0), C.ink, { align: 'center' });
      if (sel) { fb.rect(x + 2, y + 19, sw - 4, 2, C.white); }
    });
    y += 23;
    // 説明 or 問題
    const look = MAT_LOOK[this.mat];
    let info = isMuscle(this.mat) ? `筋肉 ${'ABCDEF'[this.mat - 4]}（${look.ch}）: 同じ色は 同じ神経` : `${look.name}: ${look.desc}`;
    let infoColor = C.silver;
    if (this.problems.length) { info = '！ ' + this.problems[0]; infoColor = Math.floor(this.t * 3) % 2 ? C.red : C.pink; }
    text(fb, info, VW / 2, y, infoColor, { align: 'center' });
    y += 15;
    // 下のボタン
    const w3 = Math.floor((VW - 12 - 8) / 3);
    button(app, 'b_preset', 6, y, w3, 20, 'おてほん', () => this._presets());
    button(app, 'b_test', 6 + w3 + 4, y, w3, 20, this.testing ? 'とめる' : 'ためす', () => { if (this.testing) this._stopTest(); else this._startTest(); }, { icon: this.testing ? ICON.pause : ICON.play });
    button(app, 'b_go', 6 + (w3 + 4) * 2, y, VW - 12 - (w3 + 4) * 2, 20, 'そだてる', () => this._finish(), { accent: this.problems.length ? null : C.lime, icon: ICON.egg });
  }

  _updateCursor() {
    if (!this.cursor) { this.view.setCursor(null); return; }
    const c = this.cursor;
    const mc = this.mirror && c[2] !== 0 ? [c[0], c[1], -c[2]] : null;
    const col = this.tool === 'erase' ? PAL.red : this.tool === 'paint' ? MAT_LOOK[this.mat].color : PAL.white;
    this.view.setCursor(c, mc, col);
  }
}
