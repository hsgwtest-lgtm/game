// タイトル画面: 後ろで CPU どうしの見本試合が流れる

import { C } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text } from '../gfx/font.js';
import { logo } from '../ui/widgets.js';
import { randomSeed } from '../core/rng.js';

const PAIRS = [['ace', 'guard'], ['nurio2', 'oikake'], ['guard', 'nurio2'], ['ace', 'nurio2']];

export class TitleScreen {
  constructor(app) { this.app = app; this.wait = 0; }

  enter() {
    const app = this.app;
    app.world.camMode = 'orbit';
    app.world.zoom = 1;
    app.world.focus = null;
    app.sound.playSong('home');
    this.newMatch();
  }

  newMatch() {
    const app = this.app;
    const p = PAIRS[Math.floor(Math.random() * PAIRS.length)];
    const arena = Math.floor(Math.random() * 6);
    app.spec.start({
      arena, seed: randomSeed(), a: { type: 'cpu', key: p[0] }, b: { type: 'cpu', key: p[1] }, speed: 1.3,
      onEnd: () => { this.wait = 2.5; },
    });
    this.wait = 0;
  }

  leave() { this.app.world.camMode = 'fit'; this.app.spec.stop(); }

  update(dt) {
    this.app.spec.update(dt);
    if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.newMatch(); }
  }

  view() { return { y: 0, h: this.app.H, padT: this.app.top + 70, padB: 90 }; }

  draw(ui) {
    const app = this.app, fb = ui.fb;
    const W = ui.W, H = ui.H;
    const ly = app.top + 26;
    // ロゴの後ろに帯
    fb.checker(0, ly - 12, W, 64, col(C.ink));
    logo(fb, W >> 1, ly, 3, app.t);
    text(fb, 'ごほうびで育てる AIぬりバトル', W >> 1, ly + 32, col(C.white), { align: 'center', outline: col(C.ink) });
    // スタート
    const by = H - app.bottom - 70;
    if (Math.floor(app.t * 2) % 2 === 0) text(fb, 'TAP TO START', W >> 1, by, col(C.gold), { align: 'center', outline: col(C.ink) });
    text(fb, '強化学習 × 報酬設計 × オンライン対戦', W >> 1, by + 22, col(C.mist), { align: 'center', outline: col(C.ink) });
    ui.mini('V1.0', W - 4, H - app.bottom - 8, C.lilac, 'right');
    // 画面のどこをタップしても進む
    const h = ui.hit('title-any', 0, 0, W, H);
    if (h.click) {
      app.sound.play('go');
      if (!app.G.s.seen.intro) app.go('howto', { intro: true });
      else app.go('home');
    }
  }

  back() {}
}
