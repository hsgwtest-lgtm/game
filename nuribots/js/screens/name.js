// 名前入力の画面（ロボ・プレイヤー）

import { NameEntry } from '../ui/keyboard.js';
import { topBar, backdrop } from '../ui/layout.js';

export class NameScreen {
  constructor(app) { this.app = app; }

  enter(p) {
    this.p = p;
    this.kb = new NameEntry(p.initial || '', p.label || 'なまえを入れてね', p.max || 8);
    this.ret = p.ret || this.app.prevName || 'home';
  }

  leave() {}
  update() {}
  view() { return null; }

  draw(ui) {
    const app = this.app;
    backdrop(app);
    if (topBar(app, this.p.title || 'なまえ') === 'back') return this.back();
    const r = this.kb.draw(ui, app.top + 30);
    if (r) {
      if (r.ok && this.p.done) this.p.done(r.value);
      app.go(this.ret, this.p.retParams || {});
    }
  }

  back() { this.app.go(this.ret, this.p.retParams || {}); }
}
