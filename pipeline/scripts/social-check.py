#!/usr/bin/env python3
"""Social check on a finished video: four plain lines, never a block.

    python social-check.py <manifest.json> [--post drafts/D1/post.md] [--out validation/social-check.json]

Run it right after finish-video.py. It reads the manifest, the deliverable's script (or storyboard) and post.md,
the platform's rules from platform-rules/<platform>.md, and the finished video when ffprobe can read it.
Writes validation/social-check.json = { video, items: [{ id, ok, line }] } with these ids:

  * hook      words (a spoken line, a voice-over line or on-screen text) in the first 2 seconds
  * captions  words on screen for a sound-off viewer, inside the platform's safe zone
  * cta       a call to action beat or the end card
  * length    inside the platform's recommended band

ok is true for a pass and false for a heads-up. A heads-up is a plain sentence, not an error: this script always
exits 0 once it has written the file. Exit 2 means the manifest could not be read.
"""
import argparse, json, os, re, shutil, subprocess, sys

SAFE = {"top": 220, "bottom": 500, "left": 180, "right": 180}
NO_SPEECH = ("", "-", "(silent)", "silent", "none")
BAND_TOP, BAND_BOTTOM, FONT_SIZE = 220, 1420, 56          # the stitch's on-screen text band (stitch-clips.py)
CTA_WORDS = re.compile(r"\b(tap|click|shop|order|buy|get|try|grab|join|sign ?up|subscribe|follow|comment|dm|visit|book|learn more|link in bio|link in the bio|swipe|save|share|download|start|call|claim|use code)\b", re.I)


def split_cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def words_in(text):
    return [w for w in re.split(r"\s+", text.strip()) if w]


def read_beats(path):
    """Per beat: {seconds, spoken, onscreen, cta_hint}, from the first table with a Duration column. A Cut row is skipped."""
    beats, cols = [], None
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return beats
    for line in lines:
        if not line.strip().startswith("|"):
            if beats:
                break
            cols = None
            continue
        cells = split_cells(line)
        low = [c.lower() for c in cells]
        if cols is None:
            dur = next((i for i, c in enumerate(low) if c.startswith("duration")), None)
            spoken = next((i for i, c in enumerate(low) if "spoken" in c or "voice-over" in c or "voiceover" in c), None)
            screen = next((i for i, c in enumerate(low) if c.startswith("on-screen") or c.startswith("on screen")), None)
            keep = next((i for i, c in enumerate(low) if c.startswith("keep")), None)
            if dur is not None and (spoken is not None or screen is not None):
                cols = (dur, spoken, screen, keep)
            continue
        if all(re.match(r"^:?-+:?$", c) for c in cells if c):
            continue
        dur, spoken, screen, keep = cols
        need = max(i for i in cols if i is not None)
        if len(cells) <= need:
            continue
        if keep is not None and cells[keep].lower().startswith("cut"):
            continue
        try:
            seconds = float(cells[dur])
        except ValueError:
            continue
        sp = cells[spoken] if spoken is not None else ""
        on = cells[screen] if screen is not None else ""
        if spoken is not None and screen is None and "on-screen" in low[spoken]:
            on = sp          # a combined cell: either part counts as words on screen or spoken
        beats.append({"seconds": seconds, "spoken": "" if sp.strip().lower() in NO_SPEECH else sp.strip(),
                      "onscreen": "" if on.strip().lower() in NO_SPEECH else on.strip()})
    return beats


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


def post_cta(body, fm):
    if fm.get("cta"):
        return fm["cta"]
    m = re.search(r"^#\s*CTA\s*\n(.*?)(?=^#\s|^##\s|\Z)", body, re.S | re.M | re.I)
    if m:
        text = " ".join(l.strip() for l in m.group(1).splitlines() if l.strip() and not l.strip().startswith(("{", "#")))
        if text:
            return text
    m = re.search(r"^#\s*Caption\s*\n(.*?)(?=^#\s|\Z)", body, re.S | re.M | re.I)
    if m:
        lines = [l.strip() for l in m.group(1).splitlines() if l.strip() and not l.strip().startswith(("#", "{"))]
        return re.sub(r"[*_`>]", "", lines[-1]).strip() if lines else ""
    return ""


def platform_rules(scripts_dir, platform):
    """The platform's video block from platform-rules, with the house safe zone as the fallback."""
    rules = {"safe": dict(SAFE), "min": None, "max": None, "hard_max": None, "ratios": []}
    path = os.path.join(scripts_dir, "..", "platform-rules", "%s.md" % platform)
    try:
        text = open(path, encoding="utf-8").read()
        m = re.search(r'"video"\s*:\s*(\{.*?"safe_zone_px"\s*:\s*\{[^}]*\}[^}]*\})', text, re.S)
        if m:
            video = json.loads(m.group(1))
            rules["min"] = video.get("recommended_min_seconds")
            rules["max"] = video.get("recommended_max_seconds")
            rules["hard_max"] = video.get("max_seconds")
            rules["ratios"] = video.get("aspect_ratios") or []
            rules["safe"].update({k: int(v) for k, v in (video.get("safe_zone_px") or {}).items() if k in SAFE})
    except (OSError, ValueError):
        pass
    return rules


def probe(path):
    if not shutil.which("ffprobe") or not os.path.isfile(path):
        return None
    r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        d = json.loads(r.stdout or "{}")
    except ValueError:
        return None
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), {})
    dur = float(d.get("format", {}).get("duration") or v.get("duration") or 0)
    return {"duration": dur or None, "width": v.get("width"), "height": v.get("height")}


def clip_words(text, n=8):
    w = words_in(text)
    return " ".join(w[:n]) + ("..." if len(w) > n else "")


def num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser(description="Four plain social checks on the finished video.")
    ap.add_argument("manifest")
    ap.add_argument("--post", help="post.md (default: next to the manifest)")
    ap.add_argument("--out", help="where to write the result (default: <job>/validation/social-check.json)")
    a = ap.parse_args()
    try:
        manifest = json.load(open(a.manifest, encoding="utf-8"))
    except (OSError, ValueError):
        print("The media plan at %s could not be read, so there is no social check." % a.manifest, file=sys.stderr)
        sys.exit(2)

    root = os.path.dirname(os.path.abspath(a.manifest))
    jobdir = os.path.normpath(os.path.join(root, "..", ".."))
    folder = os.path.basename(root)
    scripts_dir = os.path.dirname(os.path.abspath(__file__))

    def resolve(rel):
        return rel if os.path.isabs(rel) else os.path.normpath(os.path.join(jobdir, rel))

    items = [i for i in manifest.get("items", []) if i.get("kind") == "video" and i.get("file")]
    by_id = {os.path.splitext(os.path.basename(i["file"]))[0]: i for i in items}
    stitch = manifest.get("stitch") or {}
    order = [s for s in (stitch.get("order") or list(by_id)) if s in by_id]
    final = resolve(stitch["output"]) if stitch.get("output") else os.path.join(jobdir, "media", folder, "final.mp4")
    video_rel = os.path.relpath(final, jobdir).replace(os.sep, "/")

    post_path = a.post or os.path.join(root, "post.md")
    fm, body = front_matter(post_path) if os.path.isfile(post_path) else ({}, "")
    platform = (fm.get("platform") or "tiktok").lower()
    rules = platform_rules(scripts_dir, platform)
    cta_text = post_cta(body, fm)

    script = ""
    for base in (os.path.join(jobdir, "drafts", folder), root):
        for name in ("script.md", "storyboard.md"):
            if not script and os.path.isfile(os.path.join(base, name)):
                script = os.path.join(base, name)
    beats = read_beats(script) if script else []

    voiceover = [v for v in (manifest.get("voiceover") or []) if isinstance(v, dict)]

    def beat_number(v):
        m = re.search(r"\d+", str(v.get("beat", "")))
        return int(m.group(0)) if m else None

    # --- spoken words per beat: the clip's dialogue, the script's spoken line, a voice-over line
    spoken = []
    for n, sid in enumerate(order):
        dlg = by_id[sid].get("dialogue")
        text = dlg.get("line", "") if isinstance(dlg, dict) else (dlg if isinstance(dlg, str) else "")
        if not text.strip() and n < len(beats):
            text = beats[n]["spoken"]
        for v in voiceover:
            if beat_number(v) == n + 1 and str(v.get("text", "")).strip():
                text = (text + " " + v["text"]).strip()
        spoken.append("" if text.strip().lower() in NO_SPEECH else text.strip())
    onscreen = [beats[n]["onscreen"] if n < len(beats) else "" for n in range(len(order))]

    result = []

    # --- hook
    first = (spoken[0] if spoken else "") or (onscreen[0] if onscreen else "")
    if first:
        result.append({"id": "hook", "ok": True, "line": "The first 2 seconds have words: \"%s\"." % clip_words(first)})
    else:
        result.append({"id": "hook", "ok": False,
                       "line": "Heads-up: nothing is said or shown as text in the first 2 seconds. Open with a line or a few words on screen."})

    # --- captions
    info = probe(final)
    safe = rules["safe"]
    finished = os.path.isfile(os.path.join(os.path.dirname(final), "final-raw.mp4")) or os.path.isfile(os.path.join(os.path.dirname(final), "final-finished.sha256"))
    any_spoken = any(spoken)
    any_screen = any(onscreen)
    height = (info or {}).get("height") or 1920
    width = (info or {}).get("width") or 1080
    scale = height / 1920.0
    problems = []
    if not any_spoken and not any_screen:
        problems.append("there are no captions or words on screen, so someone watching with the sound off gets nothing")
    else:
        if any_spoken and not finished:
            problems.append("the spoken lines have no captions because the video was not finished")
        if any_screen:
            y = max(int(BAND_TOP * scale), min(int(height * 0.62), int(BAND_BOTTOM * scale)))
            bottom = y + int(FONT_SIZE * (width / 1080.0) * 1.3)
            if y < int(safe["top"] * scale) or bottom > height - int(safe["bottom"] * scale):
                problems.append("the on-screen text sits outside the %s safe zone" % platform)
    if problems:
        result.append({"id": "captions", "ok": False, "line": "Heads-up: %s." % "; ".join(problems)})
    else:
        result.append({"id": "captions", "ok": True,
                       "line": "Captions and on-screen text stay inside the %s safe zone." % platform})

    # --- cta
    last_words = " ".join(x for x in ((spoken[-1] if spoken else ""), (onscreen[-1] if onscreen else "")) if x)
    beat_cta = bool(last_words and CTA_WORDS.search(last_words))
    card = bool(cta_text)
    if beat_cta:
        result.append({"id": "cta", "ok": True, "line": "The last beat asks the viewer to act: \"%s\"." % clip_words(last_words)})
    elif card:
        result.append({"id": "cta", "ok": True, "line": "The end card carries the call to action: \"%s\"." % clip_words(cta_text)})
    else:
        result.append({"id": "cta", "ok": False, "line": "Heads-up: no call to action in the last beat and none for the end card. Tell the viewer what to do next."})

    # --- length
    seconds = (info or {}).get("duration")
    if not seconds:
        total = sum(num(by_id[s].get("trimToSeconds")) or num(by_id[s].get("durationSeconds")) or 0 for s in order)
        seconds = total or None
    lo, hi, cap = num(rules["min"]), num(rules["max"]), num(rules["hard_max"])
    if not seconds:
        result.append({"id": "length", "ok": False, "line": "Heads-up: the length of the video could not be read, so it was not checked."})
    elif cap and seconds > cap:
        result.append({"id": "length", "ok": False, "line": "Heads-up: %d seconds is longer than %s allows (%d seconds)." % (round(seconds), platform, cap)})
    elif lo and seconds < lo:
        result.append({"id": "length", "ok": False, "line": "Heads-up: %d seconds is shorter than the %d to %d seconds that works best on %s." % (round(seconds), lo, hi or lo, platform)})
    elif hi and seconds > hi:
        result.append({"id": "length", "ok": False, "line": "Heads-up: %d seconds is longer than the %d to %d seconds that works best on %s." % (round(seconds), lo or 0, hi, platform)})
    else:
        result.append({"id": "length", "ok": True, "line": "%d seconds fits the length that works on %s." % (round(seconds), platform)})

    out = a.out or os.path.join(jobdir, "validation", "social-check.json")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    record = {"video": video_rel, "items": result}
    try:
        import hashlib
        if os.path.isfile(final):
            h = hashlib.sha256()
            with open(final, "rb") as f:
                for block in iter(lambda: f.read(1 << 20), b""):
                    h.update(block)
            record["sha256"] = h.hexdigest()
    except OSError:
        pass
    with open(out, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
        f.write("\n")
    for item in result:
        print("%s: %s" % (item["id"], item["line"]))


if __name__ == "__main__":
    main()
