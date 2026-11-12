# Draws Saga's launcher icon (bars forming a play shape, on dark blue) at every Android size.
import os, sys
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 2048  # work size, scaled down afterwards
BG = (23, 37, 74, 255)
STOPS = [(0.0, (255, 200, 48)), (0.36, (255, 122, 61)), (0.68, (240, 69, 139)), (1.0, (123, 75, 214))]

def grad(w, h, x0, x1):
    g = Image.new("RGBA", (w, h))
    px = g.load()
    for x in range(w):
        t = min(1, max(0, (x - x0) / (x1 - x0)))
        for i in range(len(STOPS) - 1):
            a, b = STOPS[i], STOPS[i + 1]
            if a[0] <= t <= b[0]:
                u = (t - a[0]) / (b[0] - a[0]); c = tuple(int(a[1][k] + (b[1][k] - a[1][k]) * u) for k in range(3)); break
        for y in range(h): px[x, y] = c + (255,)
    return g

def mark(scale=1.0):
    """The mark alone on a transparent square of S pixels; scale shrinks it around the centre."""
    m = Image.new("L", (S, S), 0); d = ImageDraw.Draw(m)
    def P(x, y): return (S / 2 + (x - 512) * 2 * scale, S / 2 + (y - 512) * 2 * scale)
    w = 76
    bars = [(292, 236, 800), (398, 590, 752), (504, 500, 704), (610, 410, 656), (716, 300, 608)]  # x, top, bottom
    for x, t, b in bars:
        (x0, y0), (x1, y1) = P(x, t), P(x + w, b)
        d.rounded_rectangle([x0, y0, x1, y1], radius=w * scale, fill=255)
    # the band from the top of the first bar down across the others: the upper edge of the play shape
    cut = Image.new("L", (S, S), 0); dc = ImageDraw.Draw(cut)
    a, b = P(330, 274), P(640, 440)
    dc.line([a, b], fill=255, width=int(2 * (w + 44) * scale)); 
    m.paste(0, mask=cut)  # a dark gap either side of the band
    d = ImageDraw.Draw(m); d.line([a, b], fill=255, width=int(2 * w * scale))
    r = w * scale
    for c in (a, b): d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=255)
    (x0, y0), (x1, y1) = P(292, 236), P(368, 800); d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=255)
    g = grad(S, S, P(292, 0)[0], P(792, 0)[0])
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0)); out.paste(g, mask=m); return out

def full():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=BG)
    im.alpha_composite(mark(1.0)); return im

res = os.path.join(ROOT, "res_gen/res")
for name, legacy, fg in (("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216), ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432)):
    d = os.path.join(res, "mipmap-" + name)
    full().resize((legacy, legacy), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
    mark(0.62).resize((fg, fg), Image.LANCZOS).save(os.path.join(d, "ic_launcher_fg.png"))
full().resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, "res_gen/icon-preview.png"))
print("icons written")
