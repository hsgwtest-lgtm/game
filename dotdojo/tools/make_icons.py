#!/usr/bin/env python3
"""PWAアイコンを作る（鳥居と3人のでし）: python3 tools/make_icons.py"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')

PAL = {
    '.': None,
    'k': (0x18, 0x14, 0x25),   # ink
    'n': (0x26, 0x2b, 0x44),   # navy
    's': (0x3a, 0x44, 0x66),   # slate
    'r': (0xe4, 0x3b, 0x44),   # red
    'd': (0x3e, 0x27, 0x31),   # dark brown
    'g': (0x63, 0xc7, 0x4d),   # lime
    'G': (0x3e, 0x89, 0x48),   # green
    'o': (0xf7, 0x76, 0x22),   # orange
    'O': (0xbe, 0x4a, 0x2f),   # rust
    'c': (0x2c, 0xe8, 0xf5),   # cyan
    'C': (0x00, 0x99, 0xdb),   # sky
    'w': (0xff, 0xff, 0xff),
    'y': (0xfe, 0xe7, 0x61),   # yellow
    'b': (0x73, 0x3e, 0x39),   # brown
    'B': (0xb8, 0x6f, 0x50),   # clay
}

# 32x32（'.' は背景）
ART = [
    '................................',
    '................................',
    '.....dddddddddddddddddddddd.....',
    '....rrrrrrrrrrrrrrrrrrrrrrrr....',
    '.....dddddddddddddddddddddd.....',
    '.......rr..............rr.......',
    '.....rrrrrrrrrrrrrrrrrrrrrr.....',
    '.......rr..............rr.......',
    '.......rr......yy......rr.......',
    '.......rr.....yyyy.....rr.......',
    '.......rr......yy......rr.......',
    '.......rr..............rr.......',
    '.......rr..............rr.......',
    '.......rr..............rr.......',
    '.......rr..............rr.......',
    '......kkkk............kkkk......',
    '................................',
    '...kkkkkk...kkkkkk...kkkkkk.....',
    '...kggggk...kookook..kcccck.....',
    '...kGGGGk...kOOOOOk..kccrck.....',
    '...kggggk...koooook..kcccck.....',
    '...kgwkwk...kowkwok..kcwkwk.....',
    '...kggggk...koooook..kcccck.....',
    '...kggggk...koooook..kcccck.....',
    '...kkkkkk...kkkkkkk..kkkkkk.....',
    '................................',
    '..gggggggggggggggggggggggggggg..',
    '..GGGGGGGGGGGGGGGGGGGGGGGGGGGG..',
    '...BBBBBBBBBBBBBBBBBBBBBBBBBB...',
    '.....bbbbbbbbbbbbbbbbbbbbbb.....',
    '........bbbbbbbbbbbbbbbb........',
    '................................',
]

BG = (0x12, 0x4e, 0x89)
BG2 = (0x26, 0x2b, 0x44)


def make(size, maskable=False):
    g = 32
    img = Image.new('RGB', (g, g), BG2 if maskable else BG)
    px = img.load()
    if not maskable:
        for y in range(g):
            for x in range(g):
                if y > 22:
                    px[x, y] = (0x0e, 0x3d, 0x6e) if (x + y) % 2 else BG
    # でしの列を整える（同じ幅に）
    for y, row in enumerate(ART):
        row = row.ljust(32, '.')[:32]
        for x, ch in enumerate(row):
            col = PAL.get(ch)
            if col:
                px[x, y] = col
    if maskable:
        # セーフゾーン（中央80%）に収まるように縮めて置き直す
        inner = img.resize((26, 26), Image.NEAREST)
        img = Image.new('RGB', (g, g), BG2)
        img.paste(inner, (3, 3))
    return img.resize((size, size), Image.NEAREST)


def main():
    os.makedirs(OUT, exist_ok=True)
    make(192).save(os.path.join(OUT, 'icon-192.png'))
    make(512).save(os.path.join(OUT, 'icon-512.png'))
    make(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
    a = Image.new('RGB', (180, 180), BG)
    a.paste(make(160), (10, 10))
    a.save(os.path.join(OUT, 'apple-touch-icon.png'))
    print('icons written')


if __name__ == '__main__':
    main()
