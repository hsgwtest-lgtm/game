"""AI EYE 64 のアイコンを作る（64×64 のドット絵を拡大）。  python3 tools/make_icons.py"""
from pathlib import Path
from PIL import Image

BLUE = (29, 93, 175)
INK = (27, 32, 38)
WHITE = (255, 255, 255)
YEL = (255, 214, 10)
ORA = (240, 138, 36)
RED = (215, 38, 61)


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def art(size=64):
    im = Image.new('RGB', (size, size), BLUE)
    px = im.load()
    cx, cy = size / 2 - 0.5, size / 2 - 0.5
    w, h = 23.0, 14.0
    inside = lambda x, y: abs(y - cy) <= h * max(0.0, 1 - ((x - cx) / w) ** 2)
    for y in range(size):
        for x in range(size):
            if not inside(x, y):
                continue
            edge = not all(inside(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if edge:
                px[x, y] = INK
                continue
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d <= 4.2:
                px[x, y] = INK                      # 瞳
            elif d <= 11.5:
                t = (d - 4.2) / (11.5 - 4.2)       # 虹彩：中心が赤、外が黄（ヒートマップの色）
                px[x, y] = mix(RED, ORA, t * 2) if t < 0.5 else mix(ORA, YEL, (t - 0.5) * 2)
            elif d <= 12.5:
                px[x, y] = INK
            else:
                px[x, y] = WHITE
    for x, y in ((cx - 2.5, cy - 2.5), (cx - 1.5, cy - 2.5), (cx - 2.5, cy - 1.5)):
        px[int(x), int(y)] = WHITE                   # ハイライト
    return im


out = Path(__file__).resolve().parent.parent / 'icons'
out.mkdir(exist_ok=True)
base = art()
for name, s in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    base.resize((s, s), Image.NEAREST).save(out / name)
# マスカブル用は余白を多めに（中央 80% に収める）
m = Image.new('RGB', (80, 80), BLUE)
m.paste(base, (8, 8))
m.resize((512, 512), Image.NEAREST).save(out / 'icon-maskable-512.png')
print('icons written to', out)
