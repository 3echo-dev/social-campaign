#!/usr/bin/env python3
"""Normalise and concatenate the clips a generation manifest lists, and burn the
on-screen text over the cut.

    python stitch-clips.py <manifest.json> [--captions script.md] [--out media/D1/final.mp4]

Captions come from the file --captions or stitch.captions names, else the deliverable's
script.md, else its storyboard.md. An empty stitch.captions, or "none", asks for none.

A clip with headroom: {askSec, inSec, useSec} (the hook clip) is cut from inSec in and
keeps useSec, so the extra second asked for at the start is dropped.

Each clip's own audio, dialogue included, is kept: loudness-normalised per clip, never
replaced or ducked. A clip with no audio track gets silence.

Stdlib only. ffmpeg and ffprobe are called with argument lists, never a shell string.
Exit 3 means ffmpeg is missing: the clips are listed so the hand-off can ship them
separately rather than claiming a cut exists.
Exit 4 means captions were requested and none were burned: the cut is written without
text and the reason is printed.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time

RATIOS = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080),
          "3:4": (1080, 1440), "4:3": (1440, 1080), "21:9": (2520, 1080)}
FPS, BAND_TOP, BAND_BOTTOM, FONT_SIZE = 30, 220, 1420, 56
FONTS = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/System/Library/Fonts/Supplemental/Arial.ttf"]


def run(cmd, capture=True, cwd=None):
    return subprocess.run(cmd, capture_output=capture, text=True, cwd=cwd)


def probe(path):
    r = run(["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", path])
    if r.returncode != 0:
        return None
    d = json.loads(r.stdout or "{}")
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in d.get("streams", []) if s.get("codec_type") == "audio"), None)
    return {"duration": float(d.get("format", {}).get("duration") or v.get("duration") or 0),
            "width": v.get("width"), "height": v.get("height"),
            "codec": v.get("codec_name"), "fps": v.get("r_frame_rate"), "audio": a is not None}


def headroom_window(item):
    """(inSec, useSec) when a clip carries headroom, else None. The hook clip is asked for
    one second more than its beat; the cut starts inSec in and keeps useSec, so the weak
    first frames never reach the hook."""
    h = item.get("headroom")
    if not isinstance(h, dict):
        return None
    try:
        in_sec, use_sec = float(h.get("inSec")), float(h.get("useSec"))
    except (TypeError, ValueError):
        return None
    if in_sec < 0 or use_sec <= 0:
        return None
    return in_sec, use_sec


def esc_path(p):
    """drawtext parses ':' as an option separator and '\\' as an escape, so a
    Windows path has to lose both before it reaches the filter graph."""
    return p.replace("\\", "/").replace(":", "\\:")


NO_CAPTIONS = ("none", "no", "off", "false")
SILENT = ("", "-", "(silent)")


def has_text(text):
    return text.strip().lower() not in SILENT


def split_cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def split_spoken_on_screen(cell, bare_on_screen=False):
    text = cell.strip()
    marks = list(re.finditer(r"(spoken|vo|voiceover|voice-over|on-?screen(?:\s+text)?|super)\s*:", text, re.I))
    if marks:
        on_screen = ""
        for i, m in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            if re.search(r"on-?screen|super", m.group(1), re.I):
                on_screen = text[m.end():end].strip(" \t/;,")
        return on_screen
    parts = re.split(r"\s+/\s+", text)
    if len(parts) > 1:
        return " / ".join(parts[1:]).strip()
    if bare_on_screen and not re.match(r"^[\"'\u201c\u2018].*[\"'\u201d\u2019]$", text):
        return text
    return ""


def read_beats(path, bare_on_screen=False):
    """Pull (duration_seconds, on_screen_text) per beat, in order, from the first table
    whose header names a Duration column and an on-screen text column.

    script.md: # | Duration (s) | ... | On-screen text (3 to 7 words) | ...
    storyboard.md: # | ID | ... | Duration (s) | ... | Spoken / on-screen | ... | Keep / Edit / Cut
    Columns are found by header name, so a reordered or extended table still reads. A storyboard
    row marked Cut is skipped."""
    beats = []
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError as e:
        print("captions: cannot read %s (%s)" % (path, e.__class__.__name__), file=sys.stderr)
        return beats
    cols = None
    for line in lines:
        if not line.strip().startswith("|"):
            if beats:
                break
            cols = None
            continue
        cells = split_cells(line)
        lowered = [c.lower() for c in cells]
        if cols is None:
            dur = next((i for i, c in enumerate(lowered) if c.startswith("duration")), None)
            on_screen = next((i for i, c in enumerate(lowered) if c.startswith("on-screen") or c.startswith("on screen")), None)
            combined = next((i for i, c in enumerate(lowered) if "spoken" in c and "on-screen" in c), None)
            keep = next((i for i, c in enumerate(lowered) if c.startswith("keep")), None)
            if dur is not None and (on_screen is not None or combined is not None):
                cols = (dur, on_screen, combined, keep)
            continue
        if all(re.match(r"^:?-+:?$", c) for c in cells if c):
            continue
        dur, on_screen, combined, keep = cols
        if len(cells) <= max(i for i in cols if i is not None):
            continue
        if keep is not None and cells[keep].lower().startswith("cut"):
            continue
        try:
            seconds = float(cells[dur])
        except ValueError:
            continue
        text = cells[on_screen] if on_screen is not None else split_spoken_on_screen(cells[combined], bare_on_screen)
        beats.append((seconds, text))
    return beats


def script_candidates(jobdir, root):
    folder = os.path.basename(os.path.normpath(root))
    return [os.path.join(base, name) for name in ("script.md", "storyboard.md")
            for base in (os.path.join(jobdir, "drafts", folder), root)]


def captions_source(explicit, stitch, jobdir, root, resolve):
    named = stitch.get("captions")
    named = named.strip() if isinstance(named, str) else None
    if named is not None and (not named or named.lower() in NO_CAPTIONS):
        return None, False
    wanted = explicit or named or ""
    for candidate in (wanted, resolve(wanted)):
        if os.path.isfile(candidate):
            return candidate, True
    for path in script_candidates(jobdir, root):
        if os.path.isfile(path):
            if wanted.lower().endswith(".md"):
                print("captions: %s not found, using %s" % (wanted, path.replace(os.sep, "/")), file=sys.stderr)
            return path, True
    return None, True


def caption_filter(beats, width, height, font, folder):
    y = max(int(BAND_TOP * height / 1920), min(int(height * 0.62), int(BAND_BOTTOM * height / 1920)))
    size = max(20, int(FONT_SIZE * width / 1080))
    parts, t = [], 0.0
    for n, (dur, text) in enumerate(beats):
        if has_text(text):
            textfile = "caption-%d.txt" % n
            with open(os.path.join(folder, textfile), "w", encoding="utf-8") as f:
                f.write(text)
            parts.append(
                "drawtext=fontfile='%s':textfile='%s':expansion=none:fontsize=%d:fontcolor=white:"
                "borderw=4:bordercolor=black:x=(w-text_w)/2:y=%d:"
                "enable='between(t,%.2f,%.2f)'" % (esc_path(font), textfile, size, y, t, t + dur))
        t += dur
    return ",".join(parts)


def main():
    ap = argparse.ArgumentParser(description="Stitch the manifest's clips into one cut.")
    ap.add_argument("manifest")
    ap.add_argument("--captions", help="script.md or storyboard.md whose table carries the on-screen text; the manifest's stitch.captions can turn captions off")
    ap.add_argument("--out", help="output path (default: manifest stitch.output)")
    a = ap.parse_args()

    manifest = json.load(open(a.manifest, encoding="utf-8"))
    root = os.path.dirname(os.path.abspath(a.manifest))
    items = [i for i in manifest.get("items", []) if i.get("kind") == "video" and i.get("file")]
    by_id = {os.path.splitext(os.path.basename(i["file"]))[0]: i for i in items}
    stitch = manifest.get("stitch") or {}
    order = stitch.get("order") or list(by_id)

    # Every path in a manifest is job-relative (media/D1/S1.mp4) and the manifest sits at
    # <job>/media/D<n>/, so the job directory is two levels up. Inputs and the output must
    # resolve the same way, or the cut is written outside the job folder.
    jobdir = os.path.normpath(os.path.join(root, "..", ".."))

    def resolve(rel):
        if os.path.isabs(rel):
            return rel
        p = os.path.normpath(os.path.join(jobdir, rel))
        if os.path.exists(p):
            return p
        alt = os.path.normpath(os.path.join(os.getcwd(), rel))
        return alt if os.path.exists(alt) else p

    clips = []
    for sid in order:
        item = by_id.get(sid)
        if not item:
            sys.exit("stitch.order names %s but no video item has that file name" % sid)
        clips.append((sid, resolve(item["file"]), item))

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        print("ffmpeg is not installed, so there is no stitched cut and no burned text.", file=sys.stderr)
        print("Ship these clips separately in the hand-off, in this order:", file=sys.stderr)
        for sid, p, _ in clips:
            print("  %s  %s" % (sid, p.replace(os.sep, "/")), file=sys.stderr)
        print("Install: winget install Gyan.FFmpeg", file=sys.stderr)
        sys.exit(3)

    missing = [p for _, p, _ in clips if not os.path.exists(p)]
    if missing:
        sys.exit("missing clip file(s):\n  " + "\n  ".join(m.replace(os.sep, "/") for m in missing))

    ratio = next((i.get("ratio") for _, _, i in clips if i.get("ratio")), "9:16")
    W, H = RATIOS.get(ratio, RATIOS["9:16"])
    if a.out:
        out = a.out
    elif stitch.get("output"):
        out = resolve(stitch["output"])
    else:
        out = os.path.join(os.path.dirname(clips[0][1]), "final.mp4")
    out = os.path.abspath(out)
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True)
    except OSError as e:
        sys.exit("cannot write to %s: %s" % (os.path.dirname(out).replace(os.sep, "/"), e))

    print("target %dx%d @ %dfps, h264/yuv420p, aac 48k, ratio %s" % (W, H, FPS, ratio))
    tmp = tempfile.mkdtemp(prefix="stitch-")
    work = None   # the cut is rendered here, next to `out`; see below
    normalised, total, clip_audio, failed_captions = [], 0.0, [], False
    try:
        for sid, path, item in clips:
            info = probe(path)
            if not info:
                sys.exit("ffprobe could not read %s" % path)
            # write-script floors beats at 4 s, so a clip normally needs no trimming.
            # An older manifest may still carry trimToSeconds; honour it rather than
            # shipping the dead air that field was added to remove.
            trim = item.get("trimToSeconds")
            try:
                trim = float(trim) if trim is not None else None
            except (TypeError, ValueError):
                trim = None
            if trim is not None and trim <= 0:
                trim = None
            if trim is not None and trim > info["duration"] + 0.05:
                print("  note: %s trimToSeconds %.2fs exceeds the clip's %.2fs; using the whole clip"
                      % (sid, trim, info["duration"]), file=sys.stderr)
                trim = None
            window = headroom_window(item)
            seek = None
            if window:
                seek, trim = window
                if seek + trim > info["duration"] + 0.05:
                    print("  note: %s headroom window %.2fs + %.2fs runs past the clip's %.2fs; using what is there"
                          % (sid, seek, trim, info["duration"]), file=sys.stderr)
                    trim = max(0.1, info["duration"] - seek)
            kept = trim if trim is not None else info["duration"]
            print("  %-4s %s  %sx%s  %s  %.2fs  audio=%s%s" % (
                sid, os.path.basename(path), info["width"], info["height"],
                info["codec"], info["duration"], "yes" if info["audio"] else "no",
                ("  window %.2fs in, %.2fs kept" % (seek, trim)) if window
                else "  trim -> %.2fs" % trim if trim is not None else ""))
            total += kept
            clip_audio.append(bool(info["audio"]))
            dst = os.path.join(tmp, "%s.mp4" % sid)
            vf = ("scale=w=%d:h=%d:force_original_aspect_ratio=decrease,"
                  "pad=%d:%d:(ow-iw)/2:(oh-ih)/2,fps=%d,format=yuv420p" % (W, H, W, H, FPS))
            cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
            if seek:
                cmd += ["-ss", "%.3f" % seek]
            cmd += ["-i", path]
            if not info["audio"]:
                cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-shortest"]
            cmd += ["-map", "0:v:0", "-map", "0:a:0" if info["audio"] else "1:a:0"]
            cmd += ["-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                    "-c:a", "aac", "-ar", "48000", "-b:a", "192k",
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-vsync", "cfr"]
            # -t after the input trims the output, so it applies to the re-encoded stream.
            if trim is not None:
                cmd += ["-t", "%.3f" % trim]
            cmd += [dst]
            r = run(cmd)
            if r.returncode != 0:
                sys.exit("re-encode failed for %s:\n%s" % (sid, r.stderr.strip()))
            normalised.append(dst)

        listfile = os.path.join(tmp, "concat.txt")
        with open(listfile, "w", encoding="utf-8") as f:
            for p in normalised:
                f.write("file '%s'\n" % p.replace("\\", "/").replace("'", "'\\''"))
        joined = os.path.join(tmp, "joined.mp4")
        r = run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat",
                 "-safe", "0", "-i", listfile, "-c", "copy", joined])
        if r.returncode != 0:
            sys.exit("concat failed:\n%s" % r.stderr.strip())

        # The cut is rendered into a temp file next to `out` and renamed to `out` only after
        # every check passes, so a failed check leaves no final.mp4 and never replaces an
        # earlier good one. It is made here, not earlier, to keep the window in which a hard
        # kill could strand it as small as possible. mkstemp makes it 0600; give it the
        # permissions a plain file would get, because the rename carries them to `out`.
        try:
            fd, work = tempfile.mkstemp(prefix=".stitch-", suffix=".mp4", dir=os.path.dirname(out))
            os.close(fd)
            umask = os.umask(0)
            os.umask(umask)
            os.chmod(work, 0o666 & ~umask)
        except OSError as e:
            sys.exit("cannot write to %s: %s" % (os.path.dirname(out).replace(os.sep, "/"), e))

        burned = False
        source, requested = captions_source(a.captions, stitch, jobdir, root, resolve)
        why = None
        note = None
        if requested:
            font = next((f for f in FONTS if os.path.exists(f)), None)
            shown = source.replace(os.sep, "/") if source else None
            no_script = not any(os.path.isfile(p) for p in script_candidates(jobdir, root) if p.endswith("script.md"))
            beats = read_beats(source, no_script) if source else []
            if not source:
                why = "no script.md or storyboard.md found for the captions"
            elif not beats:
                why = "no table with a Duration column and on-screen text found in %s" % shown
            elif not any(has_text(text) for _, text in beats):
                requested = False
                note = "no beat in %s has on-screen text, so none was burned" % shown
            elif not font:
                why = "no usable font file found"
            else:
                r = run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", joined,
                         "-vf", caption_filter(beats, W, H, font, tmp), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                         "-c:a", "copy", work], cwd=tmp)
                if r.returncode == 0 and not re.search(r"drawtext|error", r.stderr, re.I):
                    burned = True
                else:
                    why = "drawtext failed:\n%s" % r.stderr.strip()[:400]
        if not burned:
            shutil.copyfile(joined, work)

        final = probe(work) or {}
        if any(clip_audio) and not final:
            sys.exit("ffprobe could not read the finished cut, so its audio could not be checked")
        if any(clip_audio) and not final.get("audio"):
            sys.exit("the cut has no audio track although %d clip(s) carry one" % sum(clip_audio))
        # On Windows a scanner or thumbnailer can hold the fresh file for a moment.
        for attempt in range(5):
            try:
                os.replace(work, out)
                break
            except OSError as e:
                if attempt == 4:
                    sys.exit("could not write %s: %s" % (out.replace(os.sep, "/"), e))
                time.sleep(0.2)
        print("wrote %s  %sx%s  %.2fs  (%d clip(s), sources total %.2fs, clip audio kept from %d, captions %s)" % (
            out.replace(os.sep, "/"), final.get("width"), final.get("height"),
            final.get("duration", 0.0), len(clips), total, sum(clip_audio), "burned" if burned else "none"))
        if note:
            print("captions: %s" % note)
        if requested and not burned:
            print("captions were requested and none were burned: %s. The cut has no on-screen text." % why, file=sys.stderr)
            failed_captions = True
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        if work:
            try:
                os.remove(work)
            except OSError:
                pass
    if failed_captions:
        sys.exit(4)


if __name__ == "__main__":
    main()
