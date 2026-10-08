#!/usr/bin/env python3
"""Finish the plain joined cut: on-screen text, spoken-line captions, a music bed, an end card, a loudness-normalised encode.

    python finish-video.py <manifest.json> [--out media/D1/final.mp4] [--music media/music/choice.json] [--post drafts/D1/post.md]
    python finish-video.py <manifest.json> --variant v2 --hook "<text>" --cta "<text>"

Reads the stitched cut (stitch.output, else media/D<n>/final.mp4), keeps it as final-raw.mp4 next to it,
and writes the finished final.mp4 (plus final-finished.sha256, which marks it as this script's own output, and
finish-report.json, which says where the caption words came from). Run it right after the person approved the
joined video and said what to add. The joined video is plain: it carries no text, so everything on screen is
drawn here, once, in one style (bold white on a dark rounded box, inside the safe area above the bottom 500 px).

  * On-screen text: media/D<n>/onscreen.json, saved by stitch-clips.py from the script's on-screen text column
    ({"items": [{"start", "end", "text", "position"?}], "avoid"?: [{"x","y","w","h"}]}; avoid are fractions of the frame
    where a face or logo sits). It is drawn in a slot just above the captions, and moved above or below an avoid box
    it would cover. It is drawn whether or not captions are chosen, because it is the post's own text, not an extra.
  * Captions: each beat's spoken line, shown over that clip's span, two lines of 32 characters at most, bold
    white on a dark rounded box above the platform's bottom margin. The words come from the transcript of the
    approved cut when there is one (--transcript, else media/D<n>/transcript.json, else the workspace's
    imports/transcripts/<sha256 of final-raw.mp4>.json saved by media_transcribe / transcript_save). Without
    one they come from the script wording (a clip's dialogue, else the manifest's voice-over text, else the
    script's Spoken line column, else the storyboard's quoted speech) and finish-report.json and the printed
    line say "script wording, not checked against the speech".
    The words turn gold one by one (word times spread evenly over the chunk's span). No spoken lines,
    no captions.
  * Voice-over: the manifest's top-level voiceover [{beat, file, text}] (beat is 1-based, 1 or "B1").
    Each file is placed at its beat's start. A missing file is skipped with one plain line. When the clip
    already has its own dialogue, the voice-over text is not captioned a second time.
  * Music: media/music/choice.json. Trimmed to the video with a 1.5 s fade out, ducked under speech and
    voice-over with sidechaincompress, a plain bed when nothing speaks. Skipped when source is "none" or
    the file is missing.
  * End card: the last 2 s carry the brand logo and the post's call to action. Whatever is missing is skipped.
  * Encode: H.264 and AAC, two-pass loudnorm to -14 LUFS, +faststart, a keyframe every 2 s.
  * Variant (--variant <id> --hook <text> --cta <text>): the same finishing from the same final-raw.mp4,
    written to final-<id>.mp4 next to final.mp4, which is left alone. The hook replaces the first beat's
    on-screen text for the first 2 s (the first beat's own text starts after it); the cta replaces the end card's
    call to action.

Pillow and ffmpeg only. ffmpeg and ffprobe are called with argument lists, never a shell string.
Exit 0 finished, or nothing to add (the cut is kept as it is).
Exit 2 there is no stitched cut to finish.
Exit 3 ffmpeg, ffprobe or Pillow is missing: the stitched cut stays as final.mp4.
Exit 6 the joined video is not approved yet, or what to add is not recorded (approvals/cut.json, approvals/finishing.json): nothing is made.
Exit 7 music was chosen and no music track is saved: nothing is made. Say so, then price a track or pick another choice.
Exit 5 finishing failed: final-raw.mp4 is put back as final.mp4 and the reason is printed
(a failed variant just reports that it was not made).
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = None

FONTS = ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]
SAFE = {"top": 220, "bottom": 500, "left": 180, "right": 180}   # house default on 1080x1920
LINE_CHARS, MAX_LINES, END_SECONDS, FADE_SECONDS = 32, 2, 2.0, 1.5
NO_SPEECH = ("", "-", "(silent)", "silent", "none")
GOLD, WHITE = (245, 200, 75, 255), (255, 255, 255, 255)   # #F5C84B for the spoken word
HOOK_SECONDS = 2.0


def run(cmd, cwd=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)


def probe(path):
    r = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
    if r.returncode != 0:
        return None
    d = json.loads(r.stdout or "{}")
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in d.get("streams", []) if s.get("codec_type") == "audio"), None)
    return {"duration": float(d.get("format", {}).get("duration") or v.get("duration") or 0),
            "width": v.get("width"), "height": v.get("height"), "audio": a is not None}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


# ---------------------------------------------------------------- the words
def split_cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def spoken_from_cell(cell, combined):
    """A Spoken line column is the speech as written. A combined Spoken / on-screen cell
    carries speech after a spoken:/vo: mark, else as quoted text."""
    text = cell.strip()
    if not combined:
        return text
    marks = list(re.finditer(r"(spoken|vo|voiceover|voice-over|on-?screen(?:\s+text)?|super)\s*:", text, re.I))
    if marks:
        out = []
        for i, m in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            if not re.search(r"on-?screen|super", m.group(1), re.I):
                out.append(text[m.end():end].strip(" \t/;,"))
        return " ".join(out)
    quoted = re.findall(r"[\"\u201c](.+?)[\"\u201d]", text)
    return " ".join(quoted)


def read_spoken(path):
    """One spoken string per beat, in order, from the first table with a Duration column and a
    spoken column. A storyboard row marked Cut is skipped."""
    spoken, cols = [], None
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return spoken
    for line in lines:
        if not line.strip().startswith("|"):
            if spoken:
                break
            cols = None
            continue
        cells = split_cells(line)
        low = [c.lower() for c in cells]
        if cols is None:
            dur = next((i for i, c in enumerate(low) if c.startswith("duration")), None)
            sp = next((i for i, c in enumerate(low) if "spoken" in c or "voice-over" in c or "voiceover" in c), None)
            keep = next((i for i, c in enumerate(low) if c.startswith("keep")), None)
            if dur is not None and sp is not None:
                cols = (dur, sp, "on-screen" in low[sp], keep)
            continue
        if all(re.match(r"^:?-+:?$", c) for c in cells if c):
            continue
        dur, sp, combined, keep = cols
        if len(cells) <= max(i for i in (dur, sp, keep) if i is not None):
            continue
        if keep is not None and cells[keep].lower().startswith("cut"):
            continue
        try:
            float(cells[dur])
        except ValueError:
            continue
        spoken.append(spoken_from_cell(cells[sp], combined))
    return spoken


def wrap(text, width=LINE_CHARS):
    lines, cur = [], ""
    for word in text.split():
        while len(word) > width:
            if cur:
                lines.append(cur)
                cur = ""
            lines.append(word[:width])
            word = word[width:]
        if cur and len(cur) + 1 + len(word) > width:
            lines.append(cur)
            cur = word
        else:
            cur = (cur + " " + word).strip()
    if cur:
        lines.append(cur)
    return lines


def chunk_lines(text):
    """Chunks of at most two lines of 32 characters."""
    lines = wrap(re.sub(r"\s+", " ", text).strip())
    return ["\n".join(lines[i:i + MAX_LINES]) for i in range(0, len(lines), MAX_LINES)]


def front_matter(path):
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        return {}, ""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if not m:
        return {}, text
    fm = {}
    for line in m.group(1).splitlines():
        k = re.match(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*(?:#.*)?$", line)
        if k:
            fm[k.group(1).lower()] = k.group(2).strip("\"' ")
    return fm, m.group(2)


DISCLOSURE_RE = re.compile(r"\b(made with ai|ai[- ](made|generated)|generated (with|by) ai|real photo of)\b", re.I)


def cta_line(post_path):
    """The post's call to action: a cta front-matter value, else the last line of the caption."""
    fm, body = front_matter(post_path)
    if fm.get("cta"):
        return fm["cta"], fm
    m = re.search(r"^#\s*Caption\s*\n(.*?)(?=^#\s|\Z)", body, re.S | re.M)
    if not m:
        return "", fm
    lines = [l.strip() for l in m.group(1).splitlines() if l.strip() and not l.strip().startswith(("#", "{"))]
    # The AI disclosure is the caption's last line by design. It is not a call to action and is never burned in.
    lines = [l for l in lines if not DISCLOSURE_RE.search(l)]
    last = re.sub(r"[*_`>]", "", lines[-1]).strip() if lines else ""
    return last, fm


# ---------------------------------------------------------------- the pictures
def load_font(size):
    for f in FONTS:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return None


def text_box(text, scale, max_w, hl=None):
    """A bold white two-line label on a dark rounded box, as an RGBA image. With hl set, the word at
    that position (counted across the lines) is gold; the box and its size are the same either way."""
    size = 46
    while True:
        font = load_font(int(size * scale))
        if font is None:
            return None
        probe_im = ImageDraw.Draw(Image.new("RGBA", (4, 4)))
        lines = text.split("\n")
        widths = [probe_im.textlength(l, font=font) for l in lines]
        if max(widths) <= max_w or size <= 42:
            break
        size -= 1
    asc, desc = font.getmetrics()
    lh = int((asc + desc) * 1.12)
    padx, pady = int(28 * scale), int(18 * scale)
    w, h = int(max(widths)) + 2 * padx, lh * len(lines) + 2 * pady
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=int(24 * scale), fill=(0, 0, 0, 190))
    n = 0
    for i, l in enumerate(lines):
        if hl is None:
            d.text((w / 2, pady + i * lh), l, font=font, fill=WHITE, anchor="ma")
            continue
        words = l.split(" ")
        x0 = w / 2 - font.getlength(l) / 2
        for k, word in enumerate(words):
            x = x0 + font.getlength(" ".join(words[:k]) + (" " if k else ""))
            d.text((x, pady + i * lh), word, font=font, fill=GOLD if n == hl else WHITE, anchor="la")
            n += 1
    return im


def onscreen_box(W, H, scale, text):
    """The on-screen text as one bold white label on a dark box (the captions' style), at most 3 lines; None when it does not fit."""
    lines = wrap(re.sub(r"\s+", " ", text).strip())
    if not lines:
        return None
    if len(lines) > 3:
        print("finish: the on-screen text \"%s...\" does not fit in 3 lines, so it is not drawn (nothing is cut short)." % text[:30], file=sys.stderr)
        return None
    return text_box("\n".join(lines), scale, W - int(2 * 60 * scale))


def place_onscreen(box, W, H, scale, zone, slot_bottom, position, avoid):
    """The top-left y for an on-screen label: by default just above the caption slot, inside the safe area; a position
    keyword moves it; it steps above (else below) any avoid box (a face or logo) it would cover."""
    top = int(zone["top"] * scale)
    gap = int(16 * scale)
    if position == "top":
        y = top
    elif position == "middle":
        y = int(H * 0.40 - box.height / 2)
    else:
        y = slot_bottom - box.height
    y = max(top, min(y, slot_bottom - box.height))
    x0, x1 = (W - box.width) // 2, (W + box.width) // 2
    for _ in range(len(avoid) + 1):
        hit = None
        for r in avoid:
            rx0, rx1, ry0, ry1 = r["x"] * W, (r["x"] + r["w"]) * W, r["y"] * H, (r["y"] + r["h"]) * H
            if x0 < rx1 and x1 > rx0 and y < ry1 and y + box.height > ry0:
                hit = (ry0, ry1)
                break
        if not hit:
            return y
        above = int(hit[0]) - gap - box.height
        below = int(hit[1]) + gap
        if above >= top:
            y = above
        elif below + box.height <= slot_bottom:
            y = below
        else:
            print("finish: the on-screen text cannot avoid the marked face or logo area, so it is drawn where it fits.", file=sys.stderr)
            return y
    return y


def read_onscreen(path):
    """(items, avoid) from an on-screen plan file; ([], []) when there is none."""
    try:
        data = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return [], []
    items = []
    for entry in data.get("items", []) if isinstance(data, dict) else []:
        try:
            text = str(entry.get("text") or "").strip()
            start, end = float(entry.get("start")), float(entry.get("end"))
        except (AttributeError, TypeError, ValueError):
            continue
        if text and end > start:
            items.append({"start": start, "end": end, "text": text, "position": str(entry.get("position") or "")})
    avoid = []
    for r in (data.get("avoid") or []) if isinstance(data, dict) else []:
        try:
            avoid.append({k: float(r[k]) for k in ("x", "y", "w", "h")})
        except (KeyError, TypeError, ValueError):
            continue
    return items, avoid


def read_transcript(path):
    """[(start, end, text)] from a saved transcript: segments, else words grouped into one list; [] when unreadable."""
    try:
        data = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out = []
    for seg in data.get("segments", []) if isinstance(data, dict) else []:
        try:
            start = float(seg.get("start_s", seg.get("start")))
            end = float(seg.get("end_s", seg.get("end")))
            text = str(seg.get("text") or "").strip()
        except (AttributeError, TypeError, ValueError):
            continue
        if text:
            out.append((start, end, text))
    return out


def transcript_for(a, jobdir, raw, final):
    """The transcript of the approved cut and where it was found, else (None, '')."""
    candidates = []
    if a.transcript:
        candidates.append(a.transcript)
    candidates.append(os.path.join(os.path.dirname(final), "transcript.json"))
    try:
        # media_transcribe / transcript_save keep it at <workspace>/imports/transcripts/<sha256 of the media>.json
        workspace = os.path.normpath(os.path.join(jobdir, "..", "..", "..", ".."))
        candidates.append(os.path.join(workspace, "imports", "transcripts", sha256(raw) + ".json"))
    except OSError:
        pass
    for c in candidates:
        if os.path.isfile(c):
            segs = read_transcript(c)
            if segs:
                return segs, c
    return None, ""


def end_card(W, H, scale, logo_path, cta):
    """A full-frame transparent card: the logo, then the call to action, inside the safe zone."""
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    safe_l, safe_r = int(SAFE["left"] * scale), int(SAFE["right"] * scale)
    max_w = W - safe_l - safe_r
    parts = []
    if logo_path:
        try:
            logo = Image.open(logo_path).convert("RGBA")
            f = min(max_w / logo.width, 0.12 * H / logo.height)
            parts.append(logo.resize((max(1, int(logo.width * f)), max(1, int(logo.height * f))), Image.LANCZOS))
        except Exception:
            print("finish: the logo file could not be read, so the end card has no logo.", file=sys.stderr)
    if cta:
        lines = wrap(cta)
        if len(lines) > MAX_LINES or DISCLOSURE_RE.search(cta):
            # Never cut a line short or burn the AI disclosure: it stays in the caption and the platform AI label.
            print("finish: the call to action is too long for the end card or is the AI disclosure, so the end card shows the logo only. The disclosure stays in the caption and the platform AI label.", file=sys.stderr)
        else:
            box = text_box("\n".join(lines), scale, max_w)
            if box:
                parts.append(box)
    if not parts:
        return None
    gap = int(40 * scale)
    total = sum(p.height for p in parts) + gap * (len(parts) - 1)
    y = int(H * 0.40 - total / 2)
    y = max(int(SAFE["top"] * scale), y)
    for p in parts:
        card.alpha_composite(p, ((W - p.width) // 2, y))
        y += p.height + gap
    return card


# ---------------------------------------------------------------- the pieces around the cut
def safe_zone(plugin_scripts_dir, platform):
    """The platform's video safe zone from platform-rules, else the house default."""
    zone = dict(SAFE)
    path = os.path.join(plugin_scripts_dir, "..", "platform-rules", "%s.md" % platform)
    try:
        text = open(path, encoding="utf-8").read()
        m = re.search(r'"video"\s*:\s*\{.*?"safe_zone_px"\s*:\s*(\{[^}]*\})', text, re.S)
        if m:
            raw = json.loads(m.group(1))
            zone.update({k: int(raw[k]) for k in SAFE if k in raw})
    except (OSError, ValueError):
        pass
    return zone


def find_logo(brand_dir):
    voice = os.path.join(brand_dir, "brand-voice.md")
    try:
        inside = False
        for line in open(voice, encoding="utf-8").read().splitlines():
            if line.startswith("## "):
                inside = line.strip().lower() == "## brand marks"
                continue
            if inside and line.strip().startswith("|"):
                cells = split_cells(line)
                if len(cells) >= 2 and cells[0].lower() == "logo" and cells[1].lower() not in ("", "unknown", "none"):
                    p = os.path.join(brand_dir, cells[1])
                    if os.path.isfile(p) and not p.lower().endswith(".svg"):
                        return p
    except OSError:
        pass
    for ext in ("png", "webp", "jpg", "jpeg"):
        p = os.path.join(brand_dir, "assets", "logo.%s" % ext)
        if os.path.isfile(p):
            return p
    return None


def music_file(jobdir, choice_path):
    try:
        choice = json.load(open(choice_path, encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if choice.get("source") == "none" or not choice.get("file"):
        return None
    f = choice["file"]
    for p in (f, os.path.join(jobdir, f), os.path.join(os.path.dirname(choice_path), f)):
        if os.path.isfile(p):
            return os.path.abspath(p)
    return None


def loudnorm_json(stderr):
    m = list(re.finditer(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr, re.S))
    if not m:
        return None
    try:
        d = json.loads(m[-1].group(0))
        return {k: float(d[k]) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}
    except (ValueError, KeyError):
        return None


# ---------------------------------------------------------------- main
def fail_keep_raw(raw, final, why):
    """Put the untouched cut back as final.mp4 and say so, in one line."""
    try:
        if os.path.isfile(raw):
            shutil.copyfile(raw, final)
    except OSError:
        pass
    print("Finishing did not work (%s), so the plain cut is kept as the final video." % why, file=sys.stderr)
    sys.exit(5)


def fail_variant(why):
    print("The test version was not made (%s). The main video is untouched." % why, file=sys.stderr)
    sys.exit(5)


def read_voiceover(manifest, order, spans, resolve):
    """The manifest's voiceover list as [{beat (0-based), file, text, start, dur}], skipping what cannot be placed."""
    out = []
    for entry in manifest.get("voiceover") or []:
        if not isinstance(entry, dict):
            continue
        m = re.search(r"\d+", str(entry.get("beat", "")))
        k = int(m.group(0)) if m else 0
        if k < 1 or k > len(order):
            print("Voice-over skipped: beat %s is not in this video." % entry.get("beat"), file=sys.stderr)
            continue
        f = str(entry.get("file") or "")
        path = resolve(f) if f else ""
        if not f or not os.path.isfile(path):
            print("Voice-over for beat %d is skipped: its file %s is missing." % (k, f or "(none)"), file=sys.stderr)
            continue
        info = probe(path)
        if not info or not info["audio"]:
            print("Voice-over for beat %d is skipped: %s has no sound." % (k, f), file=sys.stderr)
            continue
        out.append({"beat": k - 1, "file": os.path.abspath(path), "text": str(entry.get("text") or "").strip(),
                    "start": spans[k - 1][0], "dur": info["duration"]})
    return out


def main():
    ap = argparse.ArgumentParser(description="Add captions, music and an end card to the stitched cut.")
    ap.add_argument("manifest")
    ap.add_argument("--out", help="the stitched cut to finish and the finished file (default: stitch.output or media/D<n>/final.mp4)")
    ap.add_argument("--music", help="music choice file (default: <job>/media/music/choice.json)")
    ap.add_argument("--post", help="post.md for the call to action (default: next to the manifest)")
    ap.add_argument("--no-captions", action="store_true", help="leave captions out even when the recorded choice has them")
    ap.add_argument("--no-music", action="store_true", help="leave music out even when the recorded choice has it")
    ap.add_argument("--no-end-card", action="store_true", help="leave the end card out")
    ap.add_argument("--transcript", help="a transcript file ({segments: [{start_s, end_s, text}]}) to build the captions from")
    ap.add_argument("--onscreen", help="the on-screen text plan (default: onscreen.json next to the cut)")
    ap.add_argument("--variant", help="make a test version, media/D<n>/final-<id>.mp4, from final-raw.mp4 and leave final.mp4 alone")
    ap.add_argument("--hook", help="with --variant: the hook text for the first 2 seconds")
    ap.add_argument("--cta", help="with --variant: the call to action for the end card")
    a = ap.parse_args()
    if (a.hook or a.cta) and not a.variant:
        print("--hook and --cta are only used with --variant <id>.", file=sys.stderr)
        sys.exit(2)
    if a.variant and not re.match(r"^[A-Za-z0-9_-]+$", a.variant):
        print("A variant id uses letters, numbers, - and _ only.", file=sys.stderr)
        sys.exit(2)

    manifest = json.load(open(a.manifest, encoding="utf-8"))
    root = os.path.dirname(os.path.abspath(a.manifest))
    jobdir = os.path.normpath(os.path.join(root, "..", ".."))
    brand_dir = os.path.join(os.path.dirname(os.path.dirname(jobdir)), "brand")

    def resolve(rel):
        if os.path.isabs(rel):
            return rel
        p = os.path.normpath(os.path.join(jobdir, rel))
        if os.path.exists(p):
            return p
        alt = os.path.normpath(os.path.join(os.getcwd(), rel))
        return alt if os.path.exists(alt) else p

    items = [i for i in manifest.get("items", []) if i.get("kind") == "video" and i.get("file")]
    by_id = {os.path.splitext(os.path.basename(i["file"]))[0]: i for i in items}
    stitch = manifest.get("stitch") or {}
    order = [s for s in (stitch.get("order") or list(by_id)) if s in by_id]
    if a.out:
        final = a.out
    elif stitch.get("output"):
        final = resolve(stitch["output"])
    elif order:
        final = os.path.join(os.path.dirname(resolve(by_id[order[0]]["file"])), "final.mp4")
    else:
        final = os.path.join(jobdir, "media", os.path.basename(root), "final.mp4")
    final = os.path.abspath(final)
    raw = os.path.join(os.path.dirname(final), "final-raw.mp4")
    stamp = os.path.join(os.path.dirname(final), "final-finished.sha256")
    target = os.path.join(os.path.dirname(final), "final-%s.mp4" % a.variant) if a.variant else final

    # Nothing is added before the person approved the joined video and said what to add (approvals/cut.json, finishing.json).
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import review_gate
    why = review_gate.finishing_problem(jobdir)
    if why:
        print(why, file=sys.stderr)
        sys.exit(6)
    want_captions, want_music, choice = review_gate.finishing(jobdir)
    a.want_captions = want_captions and not a.no_captions
    a.want_music = want_music and not a.no_music
    plan_path = a.onscreen or os.path.join(os.path.dirname(final), "onscreen.json")
    has_onscreen = bool(read_onscreen(plan_path)[0])
    if not (a.want_captions or a.want_music or has_onscreen):
        # Skip: the joined video is used as it is. An earlier finished final.mp4 is put back to the plain cut.
        if not a.variant and os.path.isfile(raw):
            try:
                shutil.copyfile(raw, final)
                if os.path.isfile(stamp):
                    os.remove(stamp)
            except OSError as e:
                print("Cannot restore the plain cut (%s)." % e, file=sys.stderr)
                sys.exit(5)
        print("Nothing to add (%s): the joined video is used as it is." % choice)
        sys.exit(0)
    if a.want_music and not music_file(jobdir, a.music or os.path.join(jobdir, "media", "music", "choice.json")):
        print("Background music was chosen but no music track is saved for this job, so nothing was made. Say so plainly: price a track "
              "(music costs credits) or ask for a saved one, or record a different choice.", file=sys.stderr)
        sys.exit(7)

    if a.variant:
        if not os.path.isfile(raw):
            print("There is no plain cut at %s to make a test version from. Finish the main video first." % raw.replace(os.sep, "/"), file=sys.stderr)
            sys.exit(2)
    elif not os.path.isfile(final):
        print("There is no stitched video at %s to finish. Stitch the clips first." % final.replace(os.sep, "/"), file=sys.stderr)
        sys.exit(2)
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None or Image is None:
        print("ffmpeg or Pillow is not installed, so the video is not finished. The plain cut stays as the final video.", file=sys.stderr)
        sys.exit(3)

    # Keep the stitched cut as final-raw.mp4. When final.mp4 is our own earlier output, finish from
    # the kept raw again instead of finishing twice. A variant always starts from the kept raw.
    if not a.variant:
        try:
            own = os.path.isfile(stamp) and os.path.isfile(raw) and open(stamp).read().strip() == sha256(final)
            if not own:
                shutil.copyfile(final, raw)
        except OSError as e:
            print("Cannot keep the stitched cut next to %s (%s)." % (final.replace(os.sep, "/"), e), file=sys.stderr)
            sys.exit(5)

    tmp = tempfile.mkdtemp(prefix="finish-")
    try:
        try:
            done = finish(a, manifest, items, order, jobdir, brand_dir, root, raw, target, None if a.variant else stamp, tmp, resolve)
        except SystemExit:
            raise
        except Exception as e:
            why = "%s: %s" % (e.__class__.__name__, str(e)[:200])
            if a.variant:
                fail_variant(why)
            fail_keep_raw(raw, final, why)
        if done is False:
            if a.variant:
                fail_variant("ffmpeg stopped with an error")
            fail_keep_raw(raw, final, "ffmpeg stopped with an error")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def build_audio(D, has_speech, music_idx, vo_first, vos, has_clip_audio, music):
    """The audio graph up to [mix]: clip sound and voice-over as one voice bus, the music ducked under it."""
    g = ["[0:a]aresample=48000,aformat=channel_layouts=stereo[ca]" if has_clip_audio else
         "anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:%.3f[ca]" % D]
    voice = "ca"
    if vos:
        labels = []
        for n, v in enumerate(vos):
            ms = int(round(v["start"] * 1000))
            g.append("[%d:a]aresample=48000,aformat=channel_layouts=stereo,adelay=%d|%d[vo%d]" % (vo_first + n, ms, ms, n))
            labels.append("[vo%d]" % n)
        g.append("[ca]%samix=inputs=%d:duration=first:dropout_transition=0:normalize=0[vb]" % ("".join(labels), len(vos) + 1))
        voice = "vb"
    if music:
        g.append("[%d:a]aresample=48000,atrim=0:%.3f,asetpts=N/SR/TB,afade=t=out:st=%.3f:d=%.1f,aformat=channel_layouts=stereo[mu]"
                 % (music_idx, D, max(0.0, D - FADE_SECONDS), FADE_SECONDS))
        if has_speech:
            g.append("[%s]asplit=2[vm][vs]" % voice)
            g.append("[mu]volume=0.5[mq]")
            g.append("[mq][vs]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=500[duck]")
            g.append("[vm][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]")
        else:
            g.append("[mu]volume=0.3[mq]")
            g.append("[%s][mq]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]" % voice)
    else:
        g.append("[%s]anull[mix]" % voice)
    return ";".join(g)


def finish(a, manifest, items, order, jobdir, brand_dir, root, raw, final, stamp, tmp, resolve):
    info = probe(raw)
    if not info or not info["duration"] or not info["width"]:
        return False
    W, H, D = info["width"], info["height"], info["duration"]
    scale = W / 1080.0
    by_id = {os.path.splitext(os.path.basename(i["file"]))[0]: i for i in items}

    # Post and platform (call to action, safe zone).
    folder = os.path.basename(root)
    post_path = a.post or os.path.join(root, "post.md")
    cta, fm = cta_line(post_path) if os.path.isfile(post_path) else ("", {})
    if a.variant and a.cta and a.cta.strip():
        cta = a.cta.strip()
    zone = safe_zone(os.path.dirname(os.path.abspath(__file__)), (fm.get("platform") or "tiktok").lower())

    # Each clip's span on the timeline.
    spans, t = [], 0.0
    for sid in order:
        item = by_id[sid]
        dur = None
        try:
            dur = float(item.get("trimToSeconds") or 0) or None
        except (TypeError, ValueError):
            pass
        if dur is None:
            p = probe(resolve(item["file"]))
            dur = p["duration"] if p else float(item.get("durationSeconds") or 0)
        spans.append((t, min(D, t + dur)))
        t += dur

    # Voice-over files placed at their beat's start.
    vos = read_voiceover(manifest, order, spans, resolve)
    vos = [v for v in vos if v["start"] < D]

    # Spoken line per clip: its own dialogue, else the voice-over text, else the script's beat at the same position.
    script = ""
    for base in (os.path.join(jobdir, "drafts", folder), root):
        for name in ("script.md", "storyboard.md"):
            if not script and os.path.isfile(os.path.join(base, name)):
                script = os.path.join(base, name)
    beats = read_spoken(script) if script else []
    lines, caption_ends = [], {}
    for n, sid in enumerate(order):
        dlg = by_id[sid].get("dialogue")
        text = dlg.get("line", "") if isinstance(dlg, dict) else (dlg if isinstance(dlg, str) else "")
        if not text.strip():
            mine = [v for v in vos if v["beat"] == n and v["text"]]
            if mine:
                text = " ".join(v["text"] for v in mine)
                caption_ends[n] = spans[n][0] + max(v["dur"] for v in mine) + 0.2
        if not text.strip() and len(beats) == len(order):
            text = beats[n]
        lines.append("" if text.strip().lower() in NO_SPEECH or not a.want_captions else text.strip())
    # The words come from the transcript of the approved cut when there is one. Without it they are the script's wording,
    # and the report says so: the captions were not checked against what is actually said.
    segments, transcript_path = transcript_for(a, jobdir, raw, final) if a.want_captions else (None, "")
    caption_source = "none"
    if a.want_captions:
        if segments:
            heard = 0
            for n, (s0, e0) in enumerate(spans):
                words = " ".join(t for (ts, te, t) in segments if s0 - 0.05 <= (ts + te) / 2.0 < e0 + 0.05).strip()
                if words:
                    lines[n] = words
                    caption_ends.pop(n, None)
                    heard += 1
            caption_source = "transcript" if heard else "script"
        elif any(lines):
            caption_source = "script"
    has_lines = any(lines)
    has_speech = bool(vos) or has_lines or any(isinstance(by_id[s].get("dialogue"), (dict, str)) or by_id[s].get("generateAudio") is True for s in order)

    # Overlays: [(png path, x, y, start, end)]. The captions turn one word gold at a time.
    overlays = []
    bottom_y = H - int(zone["bottom"] * scale)
    max_w = W - int((zone["left"] + zone["right"]) * scale)
    chunks_n = 0
    # On-screen text sits in a slot just above the captions' two-line box, inside the safe area.
    cap_probe = text_box("x\nx", scale, max_w)
    slot_bottom = bottom_y - (cap_probe.height if cap_probe is not None else int(120 * scale)) - int(24 * scale)
    onscreen, avoid = read_onscreen(a.onscreen or os.path.join(os.path.dirname(raw), "onscreen.json"))
    hook = a.hook.strip() if a.variant and a.hook and a.hook.strip() else ""
    if hook:
        onscreen = [dict(item, start=max(item["start"], HOOK_SECONDS)) for item in onscreen if item["end"] > HOOK_SECONDS]
        onscreen.insert(0, {"start": 0.0, "end": HOOK_SECONDS, "text": hook, "position": ""})
    drawn_text = 0
    for k, item in enumerate(onscreen):
        start, end = max(0.0, item["start"]), min(D, item["end"])
        if end <= start:
            continue
        box = onscreen_box(W, H, scale, item["text"])
        if box is None:
            continue
        p = os.path.join(tmp, "onscreen-%d.png" % k)
        box.save(p)
        overlays.append((p, (W - box.width) // 2, place_onscreen(box, W, H, scale, zone, slot_bottom, item["position"], avoid), start, end))
        drawn_text += 1
    if has_lines:
        n = 0
        for idx, ((s, e), text) in enumerate(zip(spans, lines)):
            e = min(e, caption_ends.get(idx, e))
            if not text or e <= s:
                continue
            chunks = chunk_lines(text)
            weights = [max(1, len(c.replace("\n", " "))) for c in chunks]
            at = s
            for chunk, w in zip(chunks, weights):
                end = at + (e - s) * w / float(sum(weights))
                count = len(chunk.split())
                dt = (end - at) / float(max(1, count))
                chunks_n += 1
                for j in range(count):
                    box = text_box(chunk, scale, max_w, hl=j)
                    if box is None:
                        print("finish: no bold font file found, so there are no captions.", file=sys.stderr)
                        break
                    n += 1
                    p = os.path.join(tmp, "cap-%d.png" % n)
                    box.save(p)
                    overlays.append((p, (W - box.width) // 2, bottom_y - box.height, at + j * dt, end if j == count - 1 else at + (j + 1) * dt))
                at = end
    logo = find_logo(brand_dir)
    card = None if a.no_end_card else end_card(W, H, scale, logo, cta)
    if card is not None:
        p = os.path.join(tmp, "end-card.png")
        card.save(p)
        overlays.append((p, 0, 0, max(0.0, D - END_SECONDS), D + 1))

    music_path = a.music or os.path.join(jobdir, "media", "music", "choice.json")
    music = music_file(jobdir, music_path) if a.want_music else None

    # Filter graph.
    inputs = ["-i", raw]
    for p, *_ in overlays:
        inputs += ["-i", p]
    graph, last = [], "0:v"
    for i, (p, x, y, s, e) in enumerate(overlays, start=1):
        graph.append("[%s][%d:v]overlay=%d:%d:enable='between(t,%.3f,%.3f)'[v%d]" % (last, i, x, y, s, e, i))
        last = "v%d" % i
    graph.append("[%s]format=yuv420p[vout]" % last)

    ainputs = ["-i", raw]
    if music:
        inputs += ["-stream_loop", "-1", "-i", music]
        ainputs += ["-stream_loop", "-1", "-i", music]
    for v in vos:
        inputs += ["-i", v["file"]]
        ainputs += ["-i", v["file"]]
    # The measure pass has no overlay inputs, so its input numbers differ.
    pre = build_audio(D, has_speech, len(overlays) + 1, len(overlays) + 1 + (1 if music else 0), vos, info["audio"], music)
    pre1 = build_audio(D, has_speech, 1, 1 + (1 if music else 0), vos, info["audio"], music)

    # Pass 1: measure the mixed audio. Pass 2 encodes with those numbers.
    ln = "loudnorm=I=-14:TP=-1.5:LRA=11"
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-y"] + ainputs + ["-filter_complex",
            pre1 + ";[mix]%s:print_format=json[m]" % ln, "-map", "[m]", "-t", "%.3f" % D, "-f", "null", "-"])
    if r.returncode != 0:
        print(r.stderr.strip()[-400:], file=sys.stderr)
        return False
    m = loudnorm_json(r.stderr)
    if m and m["input_i"] > -70:
        norm = "%s:measured_I=%.2f:measured_TP=%.2f:measured_LRA=%.2f:measured_thresh=%.2f:offset=%.2f:linear=true" % (
            ln, m["input_i"], m["input_tp"], m["input_lra"], m["input_thresh"], m["target_offset"])
    else:
        norm = ln
    work = os.path.join(os.path.dirname(final), ".finish-%d.mp4" % os.getpid())
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + inputs + [
        "-filter_complex", ";".join(graph + [pre, "[mix]%s,aresample=48000[aout]" % norm]),
        "-map", "[vout]", "-map", "[aout]", "-t", "%.3f" % D,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-force_key_frames", "expr:gte(t,n_forced*2)",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", work]
    r = run(cmd)
    out = probe(work) if r.returncode == 0 else None
    if not out or not out["audio"] or abs(out["duration"] - D) > 0.5:
        if r.returncode != 0:
            print(r.stderr.strip()[-400:], file=sys.stderr)
        try:
            os.remove(work)
        except OSError:
            pass
        return False
    os.replace(work, final)
    if stamp:
        open(stamp, "w").write(sha256(final))
    source_words = {"transcript": "from the transcript of the approved cut", "script": "from the script wording, not checked against the speech", "none": ""}[caption_source]
    try:
        report = {"captions": has_lines, "captionSource": caption_source, "transcript": transcript_path.replace(os.sep, "/") if transcript_path else None,
                  "onScreenText": drawn_text, "music": bool(music), "finalSha256": sha256(final)}
        if not a.variant:
            with open(os.path.join(os.path.dirname(final), "finish-report.json"), "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2)
    except OSError:
        pass
    print("wrote %s  %sx%s  %.2fs  (on-screen text %s, captions %s, music %s, voice-over %s, end card %s%s)" % (
        final.replace(os.sep, "/"), out["width"], out["height"], out["duration"],
        ("%d line(s)" % drawn_text) if drawn_text else "none",
        (("%d with the spoken word in gold, %s" % (chunks_n, source_words)) if has_lines else "none"),
        ("ducked under speech" if has_speech else "bed") if music else "none",
        ("%d placed" % len(vos)) if vos else "none",
        ("logo" if logo else "") + (" + " if logo and cta else "") + ("call to action" if cta else "") if card is not None else "none",
        (", test version %s%s" % (a.variant, " with its own hook" if a.hook else "")) if a.variant else ""))
    if not a.variant:
        print("kept %s" % raw.replace(os.sep, "/"))
    return True


if __name__ == "__main__":
    main()
