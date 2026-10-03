// 画面共通のレイアウト部品（上のバー・背景）

import { col } from './ui.js';
import { C } from '../core/const.js';
import { text } from '../gfx/font.js';

// ノッチの下に置く上のバー。戻るボタンが押されたら 'back' を返す
export function topBar(app, title, opt = {}) {
  const ui = app.ui, fb = ui.fb;
  const y = app.top;
  let res = null;
  if (opt.bg !== false) {
    fb.rect(0, 0, ui.W, y + 18, col(opt.bgColor ?? C.ink));
    fb.rect(0, y + 18, ui.W, 1, col(C.night));
  }
  if (opt.back !== false) {
    if (ui.button('top-back', 3, y + 1, 26, 16, '', { icon: 'back', face: C.night, sfx: 'back' })) res = 'back';
  }
  text(fb, title, ui.W >> 1, y + 4, col(opt.color ?? C.white), { align: 'center', maxW: ui.W - 80 });
  if (opt.right) {
    const r = opt.right;
    if (r.icon || r.label) {
      const w = r.w || (r.label ? 44 : 26);
      if (ui.button('top-right', ui.W - w - 3, y + 1, w, 16, r.label || '', { icon: r.icon, face: r.face ?? C.night })) res = 'right';
    } else if (r.text) text(fb, r.text, ui.W - 5, y + 4, col(r.color ?? C.mist), { align: 'right' });
  }
  return res;
}

// 3D のない画面の背景（ゆっくり動く斜めじま）
export function backdrop(app, y0 = 0) {
  const ui = app.ui, fb = ui.fb;
  fb.rect(0, y0, ui.W, ui.H - y0, col(C.ink));
  const ph = Math.floor(app.t * 6) % 16;
  fb.stripes(0, y0, ui.W, ui.H - y0, col(C.grape), 16, ph);
}

// 下のセーフエリアの上端
export function bottomY(app) { return app.ui.H - app.bottom; }
