// ドットの文字入力（レトロゲームの「なまえをいれてね」方式）と数字キー。

import { col } from './ui.js';
import { C } from '../core/const.js';
import { text, measure } from '../gfx/font.js';

const HIRA = [
  'あいうえおはひふへほ',
  'かきくけこまみむめも',
  'さしすせそや　ゆ　よ',
  'たちつてとらりるれろ',
  'なにぬねのわをん゛゜',
  'ぁぃぅぇぉゃゅょっー',
];
const KATA = [
  'アイウエオハヒフヘホ',
  'カキクケコマミムメモ',
  'サシスセソヤ　ユ　ヨ',
  'タチツテトラリルレロ',
  'ナニヌネノワヲン゛゜',
  'ァィゥェォャュョッー',
];
const ABC = [
  'ABCDEFGHIJ',
  'KLMNOPQRST',
  'UVWXYZ0123',
  '456789!?-.',
  'abcdefghij',
  'klmnopqrst',
];
const PAGES = [HIRA, KATA, ABC];
const PAGE_NAMES = ['ひらがな', 'カタカナ', 'ABC'];

const DAKU = {
  'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご', 'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ',
  'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど', 'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ', 'う': 'ゔ',
  'カ': 'ガ', 'キ': 'ギ', 'ク': 'グ', 'ケ': 'ゲ', 'コ': 'ゴ', 'サ': 'ザ', 'シ': 'ジ', 'ス': 'ズ', 'セ': 'ゼ', 'ソ': 'ゾ',
  'タ': 'ダ', 'チ': 'ヂ', 'ツ': 'ヅ', 'テ': 'デ', 'ト': 'ド', 'ハ': 'バ', 'ヒ': 'ビ', 'フ': 'ブ', 'ヘ': 'ベ', 'ホ': 'ボ', 'ウ': 'ヴ',
};
const HANDAKU = { 'は': 'ぱ', 'ひ': 'ぴ', 'ふ': 'ぷ', 'へ': 'ぺ', 'ほ': 'ぽ', 'ハ': 'パ', 'ヒ': 'ピ', 'フ': 'プ', 'ヘ': 'ペ', 'ホ': 'ポ' };
const UNDAKU = {};
for (const k in DAKU) UNDAKU[DAKU[k]] = k;
for (const k in HANDAKU) UNDAKU[HANDAKU[k]] = k;

const RANDOM_NAMES = ['ヌリボ', 'ペンキング', 'ころもん', 'ドットマン', 'はけっち', 'ぬりぬり', 'ローラー', 'カラフル', 'ぺたぺた', 'ブラシオ', 'ピクセル', 'いろどり'];

export class NameEntry {
  constructor(initial = '', title = 'なまえ', maxLen = 8) {
    this.value = initial;
    this.title = title;
    this.maxLen = maxLen;
    this.page = 0;
  }

  _add(ch) {
    if (ch === '　' || !ch) return;
    const arr = Array.from(this.value);
    if (ch === '゛' || ch === '゜') {
      const last = arr[arr.length - 1];
      if (!last) return;
      const base = UNDAKU[last] || last;
      const map = ch === '゛' ? DAKU : HANDAKU;
      if (map[base] && map[base] !== last) arr[arr.length - 1] = map[base];
      else if (UNDAKU[last]) arr[arr.length - 1] = base;
      this.value = arr.join('');
      return;
    }
    if (arr.length >= this.maxLen) return;
    this.value += ch;
  }

  // 戻り値: null（入力中）/ {ok, value} / {cancel}
  draw(ui, y0) {
    const fb = ui.fb;
    const W = ui.W;
    // PC のキーボード
    for (const k of ui.in.keys) {
      if (k === 'Backspace') this.value = Array.from(this.value).slice(0, -1).join('');
      else if (k === 'Enter') { if (this.value.trim()) return { ok: true, value: this.value.trim() }; }
      else if (k === 'Escape') return { cancel: true };
      else if (k.length === 1 && /[A-Za-z0-9!?\-. ]/.test(k)) this._add(k === ' ' ? '' : k);
    }
    const kw = 21, kh = 19;
    const gx = Math.floor((W - kw * 10) / 2);
    let y = y0;
    text(fb, this.title, W >> 1, y, col(C.mist), { align: 'center' });
    y += 14;
    // 入力欄
    fb.rrect(gx, y, kw * 10, 20, col(C.ink));
    fb.rframe(gx, y, kw * 10, 20, col(C.mint));
    const vw = measure(this.value);
    text(fb, this.value, (W >> 1) - (vw >> 1), y + 5, col(C.white));
    if (Math.floor(ui.time * 2) % 2 === 0) fb.rect((W >> 1) + (vw >> 1) + 1, y + 4, 1, 12, col(C.mint));
    text(fb, `${Array.from(this.value).length}/${this.maxLen}`, gx + kw * 10 - 4, y + 5, col(C.dusk), { align: 'right' });
    y += 26;
    // ページ
    this.page = ui.tabs('kb-page', gx, y, kw * 10, 15, PAGE_NAMES, this.page);
    y += 18;
    const rows = PAGES[this.page];
    for (let r = 0; r < rows.length; r++) {
      const chars = Array.from(rows[r]);
      for (let c = 0; c < chars.length; c++) {
        const ch = chars[c];
        if (ch === '　') continue;
        const x = gx + c * kw, yy = y + r * kh;
        if (ui.button(`kb-${this.page}-${r}-${c}`, x, yy, kw - 1, kh - 1, ch, { face: C.navy, sfx: 'tick' })) this._add(ch);
      }
    }
    y += rows.length * kh + 4;
    const bw = Math.floor((kw * 10 - 9) / 4);
    if (ui.button('kb-bs', gx, y, bw, 20, 'けす', { face: C.dusk })) this.value = Array.from(this.value).slice(0, -1).join('');
    if (ui.button('kb-rnd', gx + bw + 3, y, bw, 20, 'おまかせ', { face: C.violet })) {
      this.value = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
    }
    if (ui.button('kb-cancel', gx + (bw + 3) * 2, y, bw, 20, 'やめる', { face: C.night })) return { cancel: true };
    if (ui.button('kb-ok', gx + (bw + 3) * 3, y, bw, 20, 'けってい', { face: C.green, disabled: !this.value.trim() })) return { ok: true, value: this.value.trim() };
    return null;
  }
}

// 4けたの数字（ルームコード）
export class NumPad {
  constructor(len = 4, title = 'ルームコード') { this.value = ''; this.len = len; this.title = title; }
  draw(ui, y0) {
    const fb = ui.fb, W = ui.W;
    for (const k of ui.in.keys) {
      if (/^[0-9]$/.test(k) && this.value.length < this.len) this.value += k;
      else if (k === 'Backspace') this.value = this.value.slice(0, -1);
      else if (k === 'Enter' && this.value.length === this.len) return { ok: true, value: this.value };
      else if (k === 'Escape') return { cancel: true };
    }
    let y = y0;
    text(fb, this.title, W >> 1, y, col(C.mist), { align: 'center' });
    y += 14;
    const bw = 30, gap = 6;
    const bx = (W - (bw * this.len + gap * (this.len - 1))) >> 1;
    for (let i = 0; i < this.len; i++) {
      const x = bx + i * (bw + gap);
      fb.rrect(x, y, bw, 30, col(C.ink));
      fb.rframe(x, y, bw, 30, col(i === this.value.length ? C.mint : C.dusk));
      if (this.value[i]) text(fb, this.value[i], x + bw / 2, y + 5, col(C.white), { align: 'center', scale: 2 });
    }
    y += 40;
    const kw = 56, kh = 30;
    const kx = (W - kw * 3 - 8) >> 1;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'けす', '0', 'OK'];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const x = kx + (i % 3) * (kw + 4), yy = y + Math.floor(i / 3) * (kh + 4);
      const isOk = k === 'OK';
      if (ui.button('np-' + k, x, yy, kw, kh, k, { face: isOk ? C.green : k === 'けす' ? C.dusk : C.navy, disabled: isOk && this.value.length !== this.len, sfx: 'tick' })) {
        if (k === 'けす') this.value = this.value.slice(0, -1);
        else if (isOk) return { ok: true, value: this.value };
        else if (this.value.length < this.len) this.value += k;
      }
    }
    y += 4 * (kh + 4) + 2;
    if (ui.button('np-cancel', kx, y, kw * 3 + 8, 20, 'やめる', { face: C.night })) return { cancel: true };
    return null;
  }
}
