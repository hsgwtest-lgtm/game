#!/usr/bin/env python3
"""ピクセルフォントのアトラスを作る。

  python3 tools/build_font.py

js/ 以下のソースで使われている文字（＋ASCII＋ひらがな・カタカナ全部）を
PixelMplus10 でアンチエイリアスなしに描き、js/gfx/fontdata.js に書き出す。
ゲーム内の文章を増やしたら、このスクリプトを実行し直すこと。
"""
import base64
import os
import re
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TTF = os.path.join(ROOT, 'tools', 'PixelMplus10-Regular.ttf')
OUT = os.path.join(ROOT, 'js', 'gfx', 'fontdata.js')
SIZE = 10
H = 11      # ascent 9 + descent 2
ASC = 9


def collect_chars():
    chars = set(chr(c) for c in range(0x20, 0x7F))
    chars.update(chr(c) for c in range(0x3041, 0x3097))   # ひらがな
    chars.update(chr(c) for c in range(0x30A1, 0x30FB))   # カタカナ
    chars.update('ー～・、。「」『』（）！？：；％＋－×÷＝＜＞←↑→↓★☆♪●○■□▲△▼▽◆◇…‥〜♥♡')
    for base, _dirs, files in os.walk(os.path.join(ROOT, 'js')):
        for f in files:
            if not f.endswith('.js') or f == 'fontdata.js':
                continue
            with open(os.path.join(base, f), encoding='utf-8') as fh:
                text = fh.read()
            # コメントの文字は除く（行コメント・ブロックコメント）
            text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
            text = re.sub(r'(^|[^:\\])//[^\n]*', r'\1', text)
            for ch in text:
                if ord(ch) > 0x7E and ch not in '　':
                    chars.add(ch)
    chars.add('　')
    return sorted(chars)


def main():
    font = ImageFont.truetype(TTF, SIZE)
    chars = collect_chars()
    out_chars, widths, blob = [], [], bytearray()
    missing = []
    for ch in chars:
        try:
            adv = int(round(font.getlength(ch)))
        except Exception:
            adv = 0
        if adv <= 0:
            missing.append(ch)
            continue
        img = Image.new('1', (adv, H), 0)
        d = ImageDraw.Draw(img)
        d.fontmode = '1'
        d.text((0, ASC), ch, font=font, fill=1, anchor='ls')
        px = img.load()
        rows = []
        any_px = False
        for y in range(H):
            v = 0
            for x in range(min(adv, 16)):
                if px[x, y]:
                    v |= (1 << x)
                    any_px = True
            rows.append(v)
        if not any_px and ch not in ' 　':
            missing.append(ch)
            continue
        out_chars.append(ch)
        widths.append(adv)
        for v in rows:
            blob += struct.pack('<H', v)
    b64 = base64.b64encode(bytes(blob)).decode('ascii')
    js_chars = ''.join(out_chars).replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('// 自動生成ファイル（tools/build_font.py）。手で編集しないこと。\n')
        fh.write('// フォント: PixelMplus10 (M+ FONT LICENSE)\n')
        fh.write(f'export const FONT_H = {H};\n')
        fh.write(f'export const FONT_ASC = {ASC};\n')
        fh.write(f'export const FONT_CHARS = `{js_chars}`;\n')
        fh.write('export const FONT_W = [' + ','.join(str(w) for w in widths) + '];\n')
        fh.write(f'export const FONT_BITS = "{b64}";\n')
    print(f'{len(out_chars)} glyphs, {len(blob)} bytes -> {OUT}')
    if missing:
        print('missing:', ''.join(missing), file=sys.stderr)


if __name__ == '__main__':
    main()
