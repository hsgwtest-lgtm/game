#!/usr/bin/env python3
"""PWAアイコンを作る（ななめから見たボクセルのイヌ）: python3 tools/make_icons.py"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'icons')

INK = (0x18, 0x14, 0x25)
NAVY = (0x26, 0x2b, 0x44)
SLATE = (0x3a, 0x44, 0x66)
LIME = (0x63, 0xc7, 0x4d)
GREEN = (0x3e, 0x89, 0x48)
FOREST = (0x26, 0x5c, 0x42)
YELLOW = (0xfe, 0xe7, 0x61)
WHITE = (0xff, 0xff, 0xff)

# 素材: (上面, 右側面, 前面)
MAT = {
    'b': ((0xea, 0xd4, 0xaa), (0xe4, 0xa6, 0x72), (0xc2, 0x85, 0x69)),   # ほね
    'A': ((0xe4, 0x3b, 0x44), (0xa2, 0x26, 0x33), (0x73, 0x3e, 0x39)),   # 赤
    'B': ((0x00, 0x99, 0xdb), (0x12, 0x4e, 0x89), (0x26, 0x2b, 0x44)),   # 青
    'C': ((0xfe, 0xe7, 0x61), (0xfe, 0xae, 0x34), (0xf7, 0x76, 0x22)),   # 黄
    'D': ((0x63, 0xc7, 0x4d), (0x3e, 0x89, 0x48), (0x26, 0x5c, 0x42)),   # 緑
}

CUBE = [
    '...TT...',
    '.TTTTTT.',
    'LTTTTTTR',
    'LLLTTRRR',
    'LLLLRRRR',
    'LLLLRRRR',
    'LLLLRRRR',
    '.LLLRRR.',
    '...LR...',
]

# イヌ（x: 前, z: 右, y: 上）
VOX = []
for x in range(-2, 3):
    for z in range(-1, 2):
        VOX.append((x, 2, z, 'b'))
for (x, z, m) in [(2, -1, 'A'), (2, 1, 'B'), (-2, -1, 'C'), (-2, 1, 'D')]:
    VOX.append((x, 0, z, m))
    VOX.append((x, 1, z, m))
for z in range(-1, 2):
    VOX.append((2, 3, z, 'b'))


def draw(img, ox, oy):
    px = img.load()
    order = sorted(VOX, key=lambda v: (v[0] + v[2], v[1]))

    def put(bx, by, col, shape=False):
        for r, row in enumerate(CUBE):
            for c, ch in enumerate(row):
                if ch == '.':
                    continue
                x, y = bx + c, by + r
                if 0 <= x < img.width and 0 <= y < img.height:
                    px[x, y] = col if shape else col[{'T': 0, 'L': 1, 'R': 2}[ch]]
    for (x, y, z, m) in order:
        bx, by = ox + (x - z) * 4, oy + (x + z) * 2 - y * 5
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            put(bx + dx, by + dy, INK, True)
    for (x, y, z, m) in order:
        bx, by = ox + (x - z) * 4, oy + (x + z) * 2 - y * 5
        put(bx, by, MAT[m])
    # 目（前のいちばん上の面）
    for z in (-1, 1):
        bx, by = ox + (2 - z) * 4, oy + (2 + z) * 2 - 3 * 5
        ex, ey = bx + 5, by + 4 + (1 if z > 0 else 0)
        px[ex, ey] = WHITE
        px[ex + 1, ey] = INK


def make(size, maskable=False):
    g = 64
    img = Image.new('RGB', (g, g), NAVY)
    px = img.load()
    # 背景: 星のような点と方眼
    for y in range(g):
        for x in range(g):
            if (x % 8 == 0 or y % 8 == 0):
                px[x, y] = SLATE
    # 地面のひし形（市松）
    cx, cy = 32, 44
    for y in range(g):
        for x in range(g):
            dx, dy = abs(x - cx), abs(y - cy) * 2
            if dx + dy <= 26:
                tile = ((x - cx) // 4 + (y - cy) // 2) % 2
                px[x, y] = LIME if tile == 0 else GREEN
            elif dx + dy <= 28:
                px[x, y] = FOREST
    draw(img, 28, 34)
    for (sx, sy) in ((10, 10), (52, 14), (8, 30), (56, 34)):
        px[sx, sy] = YELLOW
        px[sx - 1, sy] = YELLOW
        px[sx + 1, sy] = YELLOW
        px[sx, sy - 1] = YELLOW
        px[sx, sy + 1] = YELLOW
    if maskable:
        inner = img.resize((50, 50), Image.NEAREST)
        img = Image.new('RGB', (g, g), NAVY)
        img.paste(inner, (7, 7))
    return img.resize((size, size), Image.NEAREST)


def main():
    os.makedirs(OUT, exist_ok=True)
    make(192).save(os.path.join(OUT, 'icon-192.png'))
    make(512).save(os.path.join(OUT, 'icon-512.png'))
    make(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
    a = Image.new('RGB', (180, 180), NAVY)
    a.paste(make(176), (2, 2))
    a.save(os.path.join(OUT, 'apple-touch-icon.png'))
    print('icons written')


if __name__ == '__main__':
    main()
