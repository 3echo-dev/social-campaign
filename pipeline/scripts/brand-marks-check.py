#!/usr/bin/env python3
"""Check rendered frames against the brand's own marks: colours, logo, subtitle band.

    python brand-marks-check.py <brand> <job-id> [--tolerance 40] [--root <dir>]
    python brand-marks-check.py path/to/workspaces/<brand>/jobs/<job-id>/job.json

Reads `## Brand marks` from workspaces/<brand>/brand/brand-voice.md and every PNG or JPG
under media/D*/ plus any sampled frames watch-video.py left under media/D*/frames/.
Writes validation/brand-marks.json and raises R-VISUAL.

Pillow only, no OpenCV. That buys three real limits, and they are worth knowing before
anyone treats a finding as proof:

  * The logo is matched on greyscale, so a logo in the wrong colour still matches. Colour
    is the colour check's job, not this one's.
  * The match is upright and unrotated, at a fixed ladder of scales around the declared
    minimum height. A tilted, warped or partly occluded logo reads as absent.
  * Matching runs on a 120px-wide working copy, so a logo under about 6% of the frame
    width is below the resolution of the check and is reported as absent.

Exit 0 nothing found - 1 findings - 2 called wrongly - 3 no media, or no brand marks.
"""
import argparse, glob, json, math, os, sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is not installed. Run: python -m pip install pillow")

# The 9:16 safe rectangle from skills/storyboard: 720x1200 centred on 1080x1920.
CANVAS_W, CANVAS_H = 1080, 1920
MARGIN_TOP, MARGIN_BOTTOM, MARGIN_SIDE = 220, 500, 180
BAND_PX = 240            # how deep a subtitle band sits inside the safe rectangle
ROW_CONTRAST = 25.0      # greyscale standard deviation that counts as "there is text here"
MIN_TEXT_ROWS = 5        # rows that must clear it, measured on the working copy
BAND_WORK_H = 480        # working height for the band scan
LOGO_WORK_W = 120        # working width for the logo scan
LOGO_SCALES = (0.75, 1.0, 1.5, 2.5)
LOGO_MATCH = 0.55        # normalised cross-correlation that counts as a hit
DEFAULT_MIN_LOGO_H = 96  # 5% of 1920, used only when the brand left min_logo_height_px unknown
PALETTE = 16             # palette size for the quantise; smaller merges an accent into its neighbour
COLOUR_SHARE = 0.01      # a quantised colour under 1% of the pixels is not a dominant colour
IMAGES = (".png", ".jpg", ".jpeg")


# ---------------------------------------------------------------- workspace
# The same resolution order as lib-workspace.js, so a Python tool and a Node tool run
# against the same folder: --root, then the environment, then the nearest config, then cwd.
def find_root(explicit):
    if explicit:
        return os.path.abspath(explicit)
    if os.environ.get("SOCIAL_PIPELINE_ROOT"):
        return os.path.abspath(os.environ["SOCIAL_PIPELINE_ROOT"])
    d = os.getcwd()
    while True:
        cfg = os.path.join(d, ".social-pipeline", "config.json")
        if os.path.isfile(cfg):
            try:
                root = json.load(open(cfg, encoding="utf-8")).get("root")
                if root:
                    return os.path.abspath(os.path.join(d, root))
            except Exception:
                pass          # a malformed config must not stop a run
        up = os.path.dirname(d)
        if up == d:
            return os.getcwd()
        d = up


def brands_dir(root):
    nested = os.path.join(root, "workspaces")
    if os.path.isdir(nested) or os.path.basename(root) != "workspaces":
        return nested
    return root


def resolve(args):
    """Accept <brand> <job-id> or a path to the job folder, job.json or route.json."""
    first = args.brand or ""
    if "/" in first or "\\" in first or first.endswith(".json"):
        p = os.path.abspath(first)
        if os.path.isfile(p):
            p = os.path.dirname(p)
        return os.path.basename(os.path.dirname(os.path.dirname(p))), os.path.basename(p), p
    if not args.brand or not args.job:
        return None, None, None
    root = find_root(args.root)
    return args.brand, args.job, os.path.join(brands_dir(root), args.brand, "jobs", args.job)


# ---------------------------------------------------------------- brand marks
def read_marks(path):
    """Pull the two-or-more column table under `## Brand marks` into a dict.
    Anything left `unknown` is dropped, so an unfilled row skips its check rather
    than failing every frame the brand ever renders."""
    marks, inside = {}, False
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return None
    for line in lines:
        if line.startswith("## "):
            if inside:
                break
            inside = line.strip().lower() == "## brand marks"
            continue
        if not inside or not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 2 or set(cells[0]) <= set(":- "):
            continue
        key, value = cells[0].lower(), cells[1]
        if key in ("mark", "") or value.lower() in ("", "unknown", "none"):
            continue
        marks[key] = value
    return marks


def hexrgb(v):
    s = str(v).strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return None
    try:
        return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


# ---------------------------------------------------------------- colour
def dominant_colours(im):
    """Quantise to a small palette and keep the colours with real area."""
    small = im.convert("RGB").copy()
    small.thumbnail((400, 400))
    q = small.quantize(colors=PALETTE, method=Image.MEDIANCUT)
    palette = q.getpalette() or []
    total = small.width * small.height
    out = []
    for count, idx in (q.getcolors(4096) or []):
        if count / float(total) < COLOUR_SHARE:
            continue
        rgb = tuple(palette[idx * 3:idx * 3 + 3])
        if len(rgb) == 3:
            out.append((rgb, count / float(total)))
    return sorted(out, key=lambda p: -p[1])


def distance(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def check_colours(im, marks, tolerance, add):
    doms = dominant_colours(im)
    for name in ("primary", "secondary", "accent"):
        want = hexrgb(marks.get(name, "")) if marks.get(name) else None
        if not want:
            continue
        if not doms:
            add("colour", "no dominant colour could be read from this file")
            return
        near, dist = min(((c, distance(c, want)) for c, _ in doms), key=lambda p: p[1])
        if dist > tolerance:
            add("colour", "%s #%02X%02X%02X is absent; the nearest dominant colour is "
                          "#%02X%02X%02X, %d away and the tolerance is %d"
                % ((name,) + want + near + (round(dist), tolerance)))


# ---------------------------------------------------------------- logo
def integral(px, w, h):
    """Summed-area tables for values and squares, so a window mean and standard
    deviation cost the same whatever the window size."""
    s = [0.0] * ((w + 1) * (h + 1))
    s2 = [0.0] * ((w + 1) * (h + 1))
    for y in range(h):
        rs = rs2 = 0.0
        for x in range(w):
            v = px[y * w + x]
            rs += v
            rs2 += v * v
            s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + rs
            s2[(y + 1) * (w + 1) + x + 1] = s2[y * (w + 1) + x + 1] + rs2
    return s, s2


def window(t, w, x, y, tw, th):
    W = w + 1
    return (t[(y + th) * W + x + tw] - t[y * W + x + tw]
            - t[(y + th) * W + x] + t[y * W + x])


def best_match(frame, logo, min_h_frac):
    """Highest normalised cross-correlation of the logo over the frame, and the frame
    height fraction it was found at. Greyscale, upright, fixed scale ladder."""
    fw = LOGO_WORK_W
    fh = max(1, int(round(frame.height * fw / float(frame.width))))
    g = frame.convert("L").resize((fw, fh), Image.BILINEAR)
    px = [float(v) for v in g.tobytes()]
    sat, sat2 = integral(px, fw, fh)

    best, best_frac = -1.0, None
    for k in LOGO_SCALES:
        th = int(round(min_h_frac * k * fh))
        tw = int(round(th * logo.width / float(logo.height)))
        if th < 6 or tw < 6 or th > fh or tw > fw:
            continue
        t = logo.convert("L").resize((tw, th), Image.BILINEAR)
        tp = [float(v) for v in t.tobytes()]
        n = float(tw * th)
        tmean = sum(tp) / n
        tz = [v - tmean for v in tp]
        tnorm = math.sqrt(sum(v * v for v in tz))
        if tnorm < 1e-6:            # a blank template would match everything
            continue
        stride = max(1, tw // 6)
        for y in range(0, fh - th + 1, stride):
            for x in range(0, fw - tw + 1, stride):
                s = window(sat, fw, x, y, tw, th)
                s2 = window(sat2, fw, x, y, tw, th)
                var = s2 / n - (s / n) ** 2
                if var < 4.0:       # flat background, nothing to correlate against
                    continue
                wnorm = math.sqrt(var * n)
                dot = 0.0
                mean = s / n
                for j in range(th):
                    base = (y + j) * fw + x
                    row = j * tw
                    for i in range(tw):
                        dot += (px[base + i] - mean) * tz[row + i]
                score = dot / (wnorm * tnorm)
                if score > best:
                    best, best_frac = score, th / float(fh)
    return best, best_frac


def check_logo(im, logo, min_h_px, add):
    best, frac = best_match(im, logo, min_h_px / float(CANVAS_H))
    if best < LOGO_MATCH:
        add("logo", "the logo was not found; the best greyscale match anywhere in the frame "
                    "scored %.2f against a threshold of %.2f" % (max(best, 0.0), LOGO_MATCH))
        return
    found_px = frac * CANVAS_H
    if found_px < min_h_px * 0.9:
        add("logo", "the logo is too small: it appears at about %d px on a 1080x1920 frame "
                    "and the brand's minimum is %d px" % (round(found_px), min_h_px))


# ---------------------------------------------------------------- subtitles
def text_rows(px, w, y0, y1, x0, x1):
    """How many rows in this band carry enough contrast to be text."""
    rows = 0
    n = max(1, x1 - x0)
    for y in range(max(0, y0), max(0, y1)):
        s = ss = 0.0
        for x in range(x0, x1):
            v = px[y * w + x]
            s += v
            ss += v * v
        var = ss / n - (s / n) ** 2
        if var > ROW_CONTRAST ** 2:
            rows += 1
    return rows


def check_subtitles(im, band, add):
    w = max(1, int(round(im.width * BAND_WORK_H / float(im.height))))
    g = im.convert("L").resize((w, BAND_WORK_H), Image.BILINEAR)
    px = [float(v) for v in g.tobytes()]
    h = BAND_WORK_H
    sy, sx = h / float(CANVAS_H), w / float(CANVAS_W)
    top, bottom = int(MARGIN_TOP * sy), h - int(MARGIN_BOTTOM * sy)
    x0, x1 = int(MARGIN_SIDE * sx), w - int(MARGIN_SIDE * sx)
    deep = int(BAND_PX * sy)

    if band == "top":
        found = text_rows(px, w, top, top + deep, x0, x1)
    else:
        found = text_rows(px, w, bottom - deep, bottom, x0, x1)
    if found < MIN_TEXT_ROWS:
        add("subtitle", "no readable text in the %s subtitle band of the 9:16 safe rectangle; "
                        "%d contrasty row(s), %d expected" % (band, found, MIN_TEXT_ROWS))

    # Text under the safe rectangle is text the platform UI covers, which is worse than none.
    below = text_rows(px, w, bottom, h, x0, x1)
    if below >= MIN_TEXT_ROWS:
        add("subtitle", "text sits in the bottom %d px that the platform UI covers; "
                        "move it above the safe rectangle" % MARGIN_BOTTOM)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("brand", nargs="?")
    ap.add_argument("job", nargs="?")
    ap.add_argument("--tolerance", type=int, default=40,
                    help="how far a dominant colour may sit from a brand colour, 0-441")
    ap.add_argument("--root")
    ap.add_argument("--out")
    args = ap.parse_args()

    brand, job, job_dir = resolve(args)
    if not job_dir:
        print("usage: brand-marks-check.py <brand> <job-id> [--tolerance N]", file=sys.stderr)
        return 2

    voice = os.path.join(os.path.dirname(os.path.dirname(job_dir)), "brand", "brand-voice.md")
    marks = read_marks(voice)
    if not marks:
        print("No brand marks to check against. Add a `## Brand marks` table to %s with the "
              "logo path and the hex colours, then run this again."
              % voice.replace(os.sep, "/"), file=sys.stderr)
        return 3

    files = []
    for d in sorted(glob.glob(os.path.join(job_dir, "media", "D*"))):
        for pattern in (os.path.join(d, "*"), os.path.join(d, "frames", "*")):
            for f in sorted(glob.glob(pattern)):
                if os.path.splitext(f)[1].lower() in IMAGES and os.path.isfile(f):
                    files.append(f)
    if not files:
        print("No media to check. Nothing under %s/media/D*/ is a PNG or JPG, so the frames "
              "were never generated or never landed." % job_dir.replace(os.sep, "/"),
              file=sys.stderr)
        return 3

    logo, logo_path = None, marks.get("logo")
    if logo_path:
        p = os.path.join(os.path.dirname(voice), logo_path)
        try:
            logo = Image.open(p)
            logo.load()
        except Exception:
            logo = None
            print("The logo file %s could not be read, so the logo check was skipped."
                  % p.replace(os.sep, "/"), file=sys.stderr)
    try:
        min_logo_h = int(str(marks.get("min_logo_height_px", "")).strip() or DEFAULT_MIN_LOGO_H)
    except ValueError:
        min_logo_h = DEFAULT_MIN_LOGO_H
    band = str(marks.get("subtitle_band", "none")).strip().lower()

    report = {"jobId": job, "tolerance": args.tolerance, "checked": [], "findings": []}
    for f in files:
        rel = os.path.relpath(f, job_dir).replace(os.sep, "/")
        try:
            im = Image.open(f)
            im.load()
            im = im.convert("RGB")
        except Exception as e:
            report["checked"].append(rel)
            report["findings"].append({"file": rel, "code": "R-VISUAL", "check": "colour",
                                       "detail": "not a readable image (%s)" % type(e).__name__})
            continue

        def add(check, detail, rel=rel):
            report["findings"].append({"file": rel, "code": "R-VISUAL",
                                       "check": check, "detail": detail})

        check_colours(im, marks, args.tolerance, add)
        if logo is not None:
            check_logo(im, logo, min_logo_h, add)
        if band in ("top", "bottom"):
            check_subtitles(im, band, add)
        report["checked"].append(rel)

    out = args.out or os.path.join(job_dir, "validation", "brand-marks.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")

    for f in report["findings"]:
        print("%s  %s: %s" % (f["file"], f["check"], f["detail"]))
    print("Checked %d file(s) against the brand marks. %s -> %s"
          % (len(report["checked"]),
             "Nothing to fix." if not report["findings"]
             else "%d thing(s) to fix." % len(report["findings"]),
             out.replace(os.sep, "/")))
    return 1 if report["findings"] else 0


if __name__ == "__main__":
    sys.exit(main())
