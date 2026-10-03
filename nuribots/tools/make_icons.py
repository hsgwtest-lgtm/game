#!/usr/bin/env python3
"""PWAアイコンを作る（ドット絵）: python3 tools/make_icons.py"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')


def hx(h):
    return ((h >> 16) & 255, (h >> 8) & 255, h & 255)


INK, NIGHT, PALE = hx(0x2e222f), hx(0x3e3546), hx(0xc7dcd0)
BLUE, SKY, COBALT, NAVY = hx(0x4d9be6), hx(0x8fd3ff), hx(0x4d65b4), hx(0x323353)
ORANGE, SAND, BRICK = hx(0xfb6b1d), hx(0xfbb954), hx(0xb33831)
GOLD, WHITE = hx(0xf9c22b), hx(0xffffff)

BOT = [
    '.......kk.......',
    '.......ak.......',
    '....kkkkkkkk....',
    '...kllllllllk...',
    '..kllbbbbbbblk..',
    '..klbkkkkkkbbk..',
    '..kbbkwkkwkbbk..',
    '..kbbkwkkwkbbk..',
    '..kbbkkkkkkbbk..',
    '..kbbbbbbbbbbk..',
    '..kdbbbbbbbbdk..',
    '...kddddddddk...',
    '..kkkkkkkkkkkk..',
    '.kaaaaaaaaaaaak.',
    '.kkkkkkkkkkkkkk.',
    '................',
]
COLS = {'k': INK, 'b': BLUE, 'l': SKY, 'd': COBALT, 'a': GOLD, 'e': INK, 'w': WHITE}


def make(size, maskable=False):
    g = 48
    img = Image.new('RGB', (g, g), NAVY if maskable else INK)
    px = img.load()
    # 床のタイル（6px = 5px + すき間1px）: 左上があお、右下がだいだい
    for ty in range(8):
        for tx in range(8):
            s = tx + ty
            c = BLUE if s <= 5 else ORANGE if s >= 9 else PALE
            for yy in range(5):
                for xx in range(5):
                    px[tx * 6 + xx, ty * 6 + yy] = c
            hl = SKY if c == BLUE else SAND if c == ORANGE else WHITE
            for k in range(5):
                px[tx * 6 + k, ty * 6] = hl
    # ロボ（まん中に2倍で）
    ox, oy = 8, 7
    for y, row in enumerate(BOT):
        for x, ch in enumerate(row):
            if ch in COLS:
                for dy in range(2):
                    for dx in range(2):
                        px[ox + x * 2 + dx, oy + y * 2 + dy] = COLS[ch]
    return img.resize((size, size), Image.NEAREST)


def main():
    os.makedirs(OUT, exist_ok=True)
    make(192).save(os.path.join(OUT, 'icon-192.png'))
    make(512).save(os.path.join(OUT, 'icon-512.png'))
    make(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
    a = Image.new('RGB', (180, 180), INK)
    a.paste(make(144), (18, 18))
    a.save(os.path.join(OUT, 'apple-touch-icon.png'))
    print('icons written')


if __name__ == '__main__':
    main()
