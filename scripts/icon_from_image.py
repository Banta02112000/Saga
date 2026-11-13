"""App icon from the picture Banta supplied, used as is (cropped and resized, not redrawn).
Outside the icon's rounded square (the grey page, the soft shadow and the light rim) each row is filled with
the icon's own background colour at that height, so whatever shape the launcher cuts (circle, squircle) shows
only the icon's gradient."""
import sys
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
im = Image.open(SRC).convert("RGB")
L, T, R, B = 186, 170, 838, 854            # the rounded square in the 1024 x 1024 picture
SAMPLE_X = 232                             # inside the square, left of the bars: plain background
crop = im.crop((L, T, R, B))
w, h = crop.size
# the background colour of each row
def bg_at(yy):  # plain background at that height: near the left edge in the middle, the centre column above and below the bars
    yy = T + min(h - 22, max(22, yy))      # rows past the rim repeat the nearest inside row
    return im.getpixel((SAMPLE_X if 265 <= yy <= 770 else 512, yy))
rowc = [bg_at(y) for y in range(h)]
bgfill = Image.new("RGB", (w, h))
for y, c in enumerate(rowc):
    ImageDraw.Draw(bgfill).line([(0, y), (w, y)], fill=c)
mask = Image.new("L", (w, h), 0)
ImageDraw.Draw(mask).rounded_rectangle([18, 18, w - 19, h - 19], radius=104, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(3))
inner = Image.composite(crop, bgfill, mask)
# square without stretching: extend left and right with the row colours
s = max(w, h)
full = Image.new("RGB", (s, s))
for y in range(s):
    c = rowc[min(h - 1, max(0, y - (s - h) // 2))]
    ImageDraw.Draw(full).line([(0, y), (s, y)], fill=c)
full.paste(inner, ((s - w) // 2, (s - h) // 2))

sizes = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for d, k in sizes.items():
    n = int(108 * k)                       # adaptive foreground canvas; launchers show about the middle 72 dp
    scale = 0.68                           # the bars fit inside even a round launcher mask (72 dp visible)
    m = int(n * scale)
    off = (n - m) // 2
    # around the icon: each row continues the icon's own background colour at that height, so no edge shows
    fg = Image.new("RGB", (n, n))
    col = full.crop((4, 0, 5, s)).resize((1, m), Image.LANCZOS)
    for y in range(n):
        ImageDraw.Draw(fg).line([(0, y), (n, y)], fill=col.getpixel((0, min(m - 1, max(0, y - off)))))
    fg.paste(full.resize((m, m), Image.LANCZOS), ((n - m) // 2, (n - m) // 2))
    fg.save(f"{OUT}/mipmap-{d}/ic_launcher_fg.png")
    # legacy square icon: the original rounded square on transparency
    q = int(48 * k)
    leg = im.crop((L - 4, T - 4 + (h - w) // 2 * 0, R + 4, B + 4)).convert("RGBA")
    lw, lh = leg.size
    ls = max(lw, lh)
    sq = Image.new("RGBA", (ls, ls), (0, 0, 0, 0))
    sq.paste(leg, ((ls - lw) // 2, (ls - lh) // 2))
    lm = Image.new("L", (ls, ls), 0)
    ImageDraw.Draw(lm).rounded_rectangle([(ls - lw) // 2 + 6, (ls - lh) // 2 + 6, (ls + lw) // 2 - 7, (ls + lh) // 2 - 7], radius=90, fill=255)
    sq.putalpha(lm)
    sq.resize((q, q), Image.LANCZOS).save(f"{OUT}/mipmap-{d}/ic_launcher.png")
full.resize((512, 512), Image.LANCZOS).save(f"{OUT}/../icon-preview.png")
print("icon from", SRC, (L, T, R, B))
