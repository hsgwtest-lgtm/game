#!/usr/bin/env python3
"""PWAアイコンを作る（ドット絵のヒナ）: python3 tools/make_icons.py"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')

PAL = {
    '.': None, 'k': (0x18, 0x14, 0x25), 'c': (0xfe, 0xe7, 0x61), 'd': (0xfe, 0xae, 0x34),
    'w': (0xff, 0xff, 0xff), 'o': (0xf7, 0x76, 0x22),
}
CHICK = [
    '.....kkkkk......',
    '....kcccccck....',
    '...kcccccccck...',
    '..kcccccckwwk...',
    '..kcccccckwkk...',
    '.kdddcccccccckoo',
    'kddddccccccckooo',
    'kdddddccccccck..',
    'kddddddcccccck..',
    '.kddddcccccck...',
    '..kkddccccckk...',
    '....kkkkkkk.....',
    '.....o...o......',
]
BG = (0x26, 0x2b, 0x44)
BG2 = (0x18, 0x14, 0x25)
CYAN = (0x2c, 0xe8, 0xf5)
SKY = (0x00, 0x99, 0xdb)


def make(size, maskable=False):
    # 32x32 のドット絵を作ってから整数倍に拡大
    g = 32
    img = Image.new('RGB', (g, g), BG2 if maskable else BG)
    px = img.load()
    if not maskable:
        # 角を少し暗く
        for y in range(g):
            for x in range(g):
                if (x < 2 or y < 2 or x > g - 3 or y > g - 3):
                    px[x, y] = BG2
    # ピクセルの目（7x5）を背景に
    ox, oy = 8, 5
    pattern = [
        '1100011', '1000001', '0000000', '1000001', '1110111',
    ]
    for r, row in enumerate(pattern):
        for c, v in enumerate(row):
            col = CYAN if v == '1' else SKY
            for yy in range(2):
                for xx in range(2):
                    X, Y = ox + c * 2 + xx, oy + r * 2 + yy
                    if (xx + yy) % 2 == 0 or v == '1':
                        px[X, Y] = col
    # ヒナ
    cx, cy = 8, 15
    for y, row in enumerate(CHICK):
        for x, ch in enumerate(row):
            col = PAL.get(ch)
            if col:
                px[cx + x, cy + y] = col
    out = img.resize((size, size), Image.NEAREST)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    make(192).save(os.path.join(OUT, 'icon-192.png'))
    make(512).save(os.path.join(OUT, 'icon-512.png'))
    make(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
    # 180 は32の倍数でないので 160(5倍) を作って余白をつける
    a = Image.new('RGB', (180, 180), BG2)
    a.paste(make(160), (10, 10))
    a.save(os.path.join(OUT, 'apple-touch-icon.png'))
    print('icons written')


if __name__ == '__main__':
    main()
