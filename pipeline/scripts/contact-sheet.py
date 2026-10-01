#!/usr/bin/env python3
"""Compose a storyboard contact sheet from downloaded frames.

    python contact-sheet.py <frames-dir> [--cols 4] [--out contact-sheet.png]

Validates every frame first: a download that returned an error page saves happily as
a .png and reaches a hand-off package without complaint. Anything unreadable or under 200px
is reported and left out rather than shipped as creative.
"""
import argparse, os, re, sys
from PIL import Image, ImageDraw

BG, FG, BADGE = (24, 24, 27), (240, 240, 245), (220, 38, 38)
CELL, PAD, LABEL = 420, 16, 34

ap = argparse.ArgumentParser()
ap.add_argument("frames"); ap.add_argument("--cols", type=int, default=4)
ap.add_argument("--out", default=None)
a = ap.parse_args()

PANEL = re.compile(r"^P(\d+)\.(png|jpe?g|webp)$", re.I)   # P3.png only: not P3-r1.png, not contact-sheet.png

def panel_no(name):
    return int(PANEL.match(name).group(1))

# Archived regenerations (P3-r1.png) and any previous sheet must not become panels.
# Rerunning after a regeneration would otherwise paste the old sheet in as an extra cell.
files = sorted((f for f in os.listdir(a.frames) if PANEL.match(f)), key=panel_no)
if not files:
    sys.exit("no P<n>.png frames in %s" % a.frames)

good, bad, soft = [], [], []
for f in files:
    p = os.path.join(a.frames, f)
    try:
        with Image.open(p) as im:
            im.verify()
        with Image.open(p) as im:
            if min(im.size) < 200:
                bad.append((f, "too small: %dx%d" % im.size)); continue
            # A hand-off image wants full resolution: 1080 px on the short side, which
            # a 1080x1920 vertical frame meets. A 480px thumbnail is review quality only.
            if min(im.size) < 1080:
                soft.append((f, min(im.size)))
            good.append((f, im.convert("RGB").copy()))
    except Exception as e:
        bad.append((f, "not a readable image (%s)" % type(e).__name__))

for f, why in bad:
    print("EXCLUDED: %s - %s" % (f, why), file=sys.stderr)
for f, w in soft:
    print("LOW-RES:  %s - %dpx on the short side; hand-off wants 1080px. Fine for review only."
          % (f, w), file=sys.stderr)
if not good:
    sys.exit("no valid frames; nothing to compose")

cols = min(a.cols, len(good))
rows = (len(good) + cols - 1) // cols
W = cols * CELL + (cols + 1) * PAD
H = rows * (CELL + LABEL) + (rows + 1) * PAD
sheet = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(sheet)

for i, (name, im) in enumerate(good):
    r, c = divmod(i, cols)
    x = PAD + c * (CELL + PAD)
    y = PAD + r * (CELL + LABEL + PAD)
    im.thumbnail((CELL, CELL))
    sheet.paste(im, (x + (CELL - im.width) // 2, y + (CELL - im.height) // 2))
    pid = "P%d" % panel_no(name)
    draw.rectangle([x, y, x + 8 + 12 * len(pid), y + 26], fill=BADGE)
    draw.text((x + 6, y + 7), pid, fill=(255, 255, 255))
    draw.text((x, y + CELL + 8), name, fill=FG)

out = a.out or os.path.join(a.frames, "contact-sheet.png")
sheet.save(out)
print("wrote %s  %d panel(s), %d column(s)%s" %
      (out.replace(os.sep, "/"), len(good), cols,
       ", %d excluded" % len(bad) if bad else ""))
