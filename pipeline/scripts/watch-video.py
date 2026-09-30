#!/usr/bin/env python3
# Vendored and reworked from https://github.com/bradautomates/claude-video
# (skills/watch/scripts: watch.py, frames.py, download.py, transcribe.py, config.py).
#
# MIT License. Copyright (c) 2026 Bradley Bonanno
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this
# software and associated documentation files (the "Software"), to deal in the Software
# without restriction, including without limitation the rights to use, copy, modify, merge,
# publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
# to whom the Software is furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all copies or
# substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
# INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
# PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
# FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
# OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
# DEALINGS IN THE SOFTWARE.
#
# Changes from upstream: one dependency-free file, no Whisper or any network transcription,
# a markdown report written to disk instead of stdout, and a status line naming what was not
# analysed. Stdlib only; ffmpeg, ffprobe and yt-dlp are called with argument lists.
"""Probe a video, sample frames, resolve a transcript, and write a watch report.

    python watch-video.py <url-or-path> --out <dir> [--detail transcript|efficient|balanced]
        [--timestamps 0:12,1:05] [--start HH:MM:SS --end HH:MM:SS] [--transcript file.vtt]
"""
import argparse, json, os, re, shutil, subprocess, sys
from urllib.parse import urlparse

RES_W, MAX_H, MAX_FPS = 512, 1998, 2.0
SCENE_THRESHOLD, SCENE_MIN, KEYFRAME_MIN = 0.20, 8, 4
DEDUP_THUMB, DEDUP_THRESHOLD = 16, 2.0
CAPS = {"transcript": 0, "efficient": 50, "balanced": 100}
TS_RE = re.compile(r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})[.,](\d{3})")
SHOWINFO = re.compile(r"pts_time:([0-9.]+)")
TAG_RE = re.compile(r"<[^>]+>")


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def have(exe):
    return shutil.which(exe) is not None


def is_url(s):
    p = urlparse(s)
    return p.scheme in ("http", "https") and bool(p.netloc)


def parse_time(v):
    if v is None or v == "":
        return None
    parts = str(v).strip().split(":")
    try:
        if len(parts) == 1:
            return float(parts[0])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except ValueError:
        pass
    raise SystemExit("cannot parse time %r (expected SS, MM:SS or HH:MM:SS)" % v)


def fmt(sec):
    t = int(round(sec))
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return "%d:%02d:%02d" % (h, m, s) if h else "%02d:%02d" % (m, s)


def scale_filter():
    return ("scale=w='min(%d,iw)':h='min(%d,ih)':force_original_aspect_ratio=decrease:"
            "force_divisible_by=2" % (RES_W, MAX_H))


def budget(duration):
    """Frame budget by duration, so short clips stay dense and long ones stay capped."""
    if duration <= 0:
        return 1
    if duration <= 30:
        return max(12, int(round(duration)))
    if duration <= 60:
        return 40
    if duration <= 180:
        return 60
    if duration <= 600:
        return 80
    return 100


# ---------------------------------------------------------------- source

def fetch_captions(url, work):
    os.makedirs(work, exist_ok=True)
    run(["yt-dlp", "--skip-download", "--write-info-json", "--write-subs", "--write-auto-subs",
         "--sub-langs", "en.*", "--sub-format", "vtt", "--convert-subs", "vtt",
         "--no-playlist", "--ignore-errors", "-o", os.path.join(work, "video.%(ext)s"), "--", url])
    subs = sorted(f for f in os.listdir(work) if f.startswith("video") and f.endswith(".vtt"))
    pref = [s for s in subs if any(m in s for m in (".en.", ".en-US.", ".en-GB.", ".en-orig."))]
    info = {}
    ipath = os.path.join(work, "video.info.json")
    if os.path.exists(ipath):
        try:
            raw = json.load(open(ipath, encoding="utf-8"))
            info = {"title": raw.get("title"), "uploader": raw.get("uploader") or raw.get("channel"),
                    "duration": raw.get("duration")}
        except Exception:
            pass
    sub = os.path.join(work, (pref or subs)[0]) if subs else None
    return sub, info


def download_video(url, work):
    os.makedirs(work, exist_ok=True)
    run(["yt-dlp", "-N", "8", "-f", "bv*[height<=720]+ba/b[height<=720]/bv+ba/b",
         "--merge-output-format", "mp4", "--no-playlist", "--ignore-errors",
         "-o", os.path.join(work, "video.%(ext)s"), "--", url])
    for ext in (".mp4", ".mkv", ".webm", ".mov"):
        for f in sorted(os.listdir(work)):
            if f.startswith("video") and f.endswith(ext):
                return os.path.join(work, f)
    return None


def metadata(path):
    r = run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path])
    if r.returncode != 0:
        raise SystemExit("ffprobe failed on %s" % path)
    d = json.loads(r.stdout or "{}")
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in d.get("streams", []) if s.get("codec_type") == "audio"), None)
    return {"duration": float(d.get("format", {}).get("duration") or v.get("duration") or 0),
            "width": v.get("width"), "height": v.get("height"),
            "codec": v.get("codec_name"), "has_audio": a is not None}


# ---------------------------------------------------------------- frames

def _clear(d, prefix):
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        if f.startswith(prefix) and f.endswith(".jpg"):
            os.remove(os.path.join(d, f))


def _seek(start, end):
    c = []
    if start is not None:
        c += ["-ss", "%.3f" % start]
    if end is not None:
        c += ["-to", "%.3f" % end]
    return c


def extract_uniform(video, d, fps, cap, start, end):
    _clear(d, "raw_")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + _seek(start, end) + [
        "-i", video, "-vf", "fps=%.4f,%s" % (fps, scale_filter()),
        "-frames:v", str(max(1, cap)), "-q:v", "4", os.path.join(d, "raw_%04d.jpg")]
    if run(cmd).returncode != 0:
        raise SystemExit("ffmpeg uniform extraction failed")
    off = start or 0.0
    files = sorted(f for f in os.listdir(d) if f.startswith("raw_"))
    return [{"path": os.path.join(d, f), "t": round(off + i / fps, 2), "reason": "uniform"}
            for i, f in enumerate(files)]


def extract_select(video, d, vf_select, reason, start, end):
    _clear(d, "raw_")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "info", "-y"] + _seek(start, end)
    if reason == "keyframe":
        cmd += ["-skip_frame", "nokey"]
    cmd += ["-i", video, "-vf", vf_select, "-vsync", "vfr", "-q:v", "4",
            os.path.join(d, "raw_%04d.jpg")]
    r = run(cmd)
    if r.returncode != 0:
        raise SystemExit("ffmpeg %s extraction failed" % reason)
    off = start or 0.0
    stamps = [round(off + float(m.group(1)), 2) for m in SHOWINFO.finditer(r.stderr)]
    files = sorted(f for f in os.listdir(d) if f.startswith("raw_"))
    out = []
    for i, f in enumerate(files):
        out.append({"path": os.path.join(d, f),
                    "t": stamps[i] if i < len(stamps) else off,
                    "reason": "first-frame" if (i == 0 and reason == "scene-change") else reason})
    return out


def extract_at(video, d, stamps, start, end):
    _clear(d, "cue_")
    lo = start or 0.0
    hi = end if end is not None else float("inf")
    out, dropped = [], 0
    for t in sorted(set(round(float(x), 2) for x in stamps)):
        if not (lo <= t <= hi):
            dropped += 1
            continue
        p = os.path.join(d, "cue_%04d.jpg" % len(out))
        r = run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "%.3f" % t,
                 "-i", video, "-frames:v", "1", "-vf", scale_filter(), "-q:v", "4", p])
        if r.returncode == 0 and os.path.exists(p):
            out.append({"path": p, "t": t, "reason": "pinned"})
    return out, dropped


def thumbs(paths):
    """One ffmpeg pass over the JPEG sequence, sliced into 16x16 grayscale thumbnails."""
    if not paths:
        return []
    m = re.match(r"(.*?)(\d+)(\.jpg)$", os.path.basename(paths[0]))
    if not m:
        return []
    pattern = os.path.join(os.path.dirname(paths[0]), "%s%%0%dd%s" % (m.group(1), len(m.group(2)), m.group(3)))
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-start_number",
                        str(int(m.group(2))), "-i", pattern, "-vf",
                        "scale=%d:%d,format=gray" % (DEDUP_THUMB, DEDUP_THUMB),
                        "-f", "rawvideo", "-"], capture_output=True)
    chunk = DEDUP_THUMB * DEDUP_THUMB
    if r.returncode != 0 or len(r.stdout) != chunk * len(paths):
        return []
    return [r.stdout[i * chunk:(i + 1) * chunk] for i in range(len(paths))]


def dedupe(frames):
    if len(frames) <= 1:
        return frames, 0
    th = thumbs([f["path"] for f in frames])
    if len(th) != len(frames):
        return frames, 0
    kept, last, dropped = [frames[0]], th[0], []
    for f, t in zip(frames[1:], th[1:]):
        delta = sum(abs(x - y) for x, y in zip(t, last)) / len(t) if len(t) == len(last) else 999.0
        if delta <= DEDUP_THRESHOLD:
            dropped.append(f)
        else:
            kept.append(f)
            last = t
    for f in dropped:
        try:
            os.remove(f["path"])
        except OSError:
            pass
    return kept, len(dropped)


def even_sample(frames, n):
    if n >= len(frames) or n <= 0:
        return frames
    idx = [0] if n == 1 else [round(i * (len(frames) - 1) / (n - 1)) for i in range(n)]
    keep = {id(frames[i]) for i in idx}
    for f in frames:
        if id(f) not in keep:
            try:
                os.remove(f["path"])
            except OSError:
                pass
    return [frames[i] for i in idx]


def select_frames(video, d, detail, cap, duration, start, end):
    if detail == "efficient":
        cands = extract_select(video, d, "%s,showinfo" % scale_filter(), "keyframe", start, end)
        if len(cands) >= KEYFRAME_MIN:
            kept, drops = dedupe(cands)
            return even_sample(kept, cap), {"method": "keyframe", "cands": len(cands), "dropped": drops}
        for c in cands:
            try:
                os.remove(c["path"])
            except OSError:
                pass
    else:
        vf = "select='eq(n\\,0)+gt(scene\\,%s)',%s,showinfo" % (SCENE_THRESHOLD, scale_filter())
        cands = extract_select(video, d, vf, "scene-change", start, end)
        if len(cands) >= SCENE_MIN:
            kept, drops = dedupe(cands)
            return even_sample(kept, cap), {"method": "scene-change", "cands": len(cands), "dropped": drops}
        for c in cands:
            try:
                os.remove(c["path"])
            except OSError:
                pass
    target = min(cap, budget(duration))
    fps = min(MAX_FPS, target / duration) if duration > 0 else 1.0
    frames = extract_uniform(video, d, fps, target, start, end)
    kept, drops = dedupe(frames)
    return kept, {"method": "uniform (fallback)", "cands": len(frames), "dropped": drops}


def rename_by_time(frames):
    out = []
    for f in frames:
        name = "frame_%08.2fs.jpg" % f["t"]
        dst = os.path.join(os.path.dirname(f["path"]), name.replace(".", "-", name.count(".") - 1))
        try:
            if os.path.abspath(dst) != os.path.abspath(f["path"]):
                if os.path.exists(dst):
                    os.remove(dst)
                os.rename(f["path"], dst)
            f["path"] = dst
        except OSError:
            pass
        out.append(f)
    return out


# ---------------------------------------------------------------- transcript

def parse_captions(path):
    text = open(path, encoding="utf-8", errors="ignore").read()
    lines, segs, i = text.splitlines(), [], 0
    while i < len(lines):
        m = TS_RE.match(lines[i].strip())
        if not m:
            i += 1
            continue
        g = m.groups()
        start = int(g[0]) * 3600 + int(g[1]) * 60 + int(g[2]) + int(g[3]) / 1000.0
        end = int(g[4]) * 3600 + int(g[5]) * 60 + int(g[6]) + int(g[7]) / 1000.0
        i += 1
        cue = []
        while i < len(lines) and lines[i].strip():
            c = TAG_RE.sub("", lines[i]).strip()
            if c:
                cue.append(c)
            i += 1
        if cue:
            segs.append({"start": round(start, 2), "end": round(end, 2), "text": " ".join(cue)})
        i += 1
    # Auto captions repeat each line as it scrolls; collapse the rolling duplicates.
    out = []
    for s in segs:
        if out and s["text"] == out[-1]["text"]:
            out[-1]["end"] = s["end"]
        elif out and s["text"].startswith(out[-1]["text"] + " "):
            out[-1]["text"], out[-1]["end"] = s["text"], s["end"]
        else:
            out.append(s)
    return out


def load_transcript(path):
    if path.lower().endswith((".vtt", ".srt")):
        return parse_captions(path)
    lines = [l.strip() for l in open(path, encoding="utf-8", errors="ignore") if l.strip()]
    return [{"start": 0.0, "end": 0.0, "text": " ".join(lines)}] if lines else []


# ---------------------------------------------------------------- report

def main():
    ap = argparse.ArgumentParser(description="Sample frames and a transcript from a video, and write a watch report.")
    ap.add_argument("source", help="video URL or local file path")
    ap.add_argument("--out", required=True, help="output directory for frames and the default watch-report.md")
    ap.add_argument("--report", help="optional path for the markdown report")
    ap.add_argument("--detail", choices=["transcript", "efficient", "balanced"], default="balanced")
    ap.add_argument("--timestamps", help="comma separated absolute times to pin a frame at, e.g. 0:12,1:05")
    ap.add_argument("--start", help="range start (SS, MM:SS or HH:MM:SS)")
    ap.add_argument("--end", help="range end")
    ap.add_argument("--transcript", help="a supplied .vtt, .srt or .txt to use instead of captions")
    a = ap.parse_args()

    out = os.path.abspath(a.out)
    frames_dir = os.path.join(out, "frames")
    work = os.path.join(out, "source")
    os.makedirs(out, exist_ok=True)

    pinned_t = [parse_time(t) for t in (a.timestamps or "").split(",") if t.strip()]
    start, end = parse_time(a.start), parse_time(a.end)
    cap = CAPS[a.detail]
    notes, segs, tsource = [], [], "none"

    if a.transcript and os.path.exists(a.transcript):
        segs, tsource = load_transcript(a.transcript), "supplied"

    url, info, video = is_url(a.source), {}, None
    if url:
        if not have("yt-dlp"):
            notes.append("yt-dlp is not installed, so neither captions nor the video could be fetched")
        else:
            sub, info = fetch_captions(a.source, work)
            if sub and not segs:
                segs, tsource = parse_captions(sub), "captions"
    else:
        video = os.path.abspath(a.source)
        if not os.path.exists(video):
            raise SystemExit("file not found: %s" % video)

    need_frames = (cap > 0 or pinned_t)
    if url and need_frames and have("yt-dlp"):
        video = download_video(a.source, work)
        if not video:
            notes.append("yt-dlp produced no video file, so no frames were sampled")

    meta = {"duration": float(info.get("duration") or 0), "width": None, "height": None,
            "codec": None, "has_audio": False}
    if video and have("ffprobe"):
        meta = metadata(video)
    elif not have("ffprobe"):
        notes.append("ffprobe is not installed, so duration and resolution are unverified")

    dur = meta["duration"]
    eff_start = start or 0.0
    eff_end = end if end is not None else dur
    eff_dur = max(0.0, eff_end - eff_start)

    frames, sel, dropped_cues = [], {"method": "none", "cands": 0, "dropped": 0}, 0
    if not have("ffmpeg"):
        notes.append("ffmpeg is not installed, so no frames were sampled")
    elif video and need_frames:
        pinned = []
        if pinned_t:
            pinned, dropped_cues = extract_at(video, frames_dir, pinned_t, start, end)
        room = max(0, cap - len(pinned))
        if room and a.detail != "transcript":
            frames, sel = select_frames(video, frames_dir, a.detail, room, eff_dur or dur, start, end)
        frames = rename_by_time(sorted(pinned + frames, key=lambda f: f["t"]))
    if not segs:
        notes.append("no transcript: spoken claims cannot be assessed, only what a frame shows")

    if segs and (start is not None or end is not None):
        lo = start if start is not None else float("-inf")
        hi = end if end is not None else float("inf")
        segs = [s for s in segs if s["end"] >= lo and s["start"] <= hi]

    report = os.path.abspath(a.report) if a.report else os.path.join(out, "watch-report.md")
    os.makedirs(os.path.dirname(report), exist_ok=True)
    with open(report, "w", encoding="utf-8") as f:
        f.write("# Watch report\n\n")
        f.write("- **Source:** %s\n" % a.source)
        if info.get("title"):
            f.write("- **Title:** %s\n" % info["title"])
        if info.get("uploader"):
            f.write("- **Uploader:** %s\n" % info["uploader"])
        f.write("- **Duration:** %s (%.1fs)%s\n" % (fmt(dur), dur,
                "" if meta["width"] is None else ", %sx%s %s" % (meta["width"], meta["height"], meta["codec"] or "")))
        if start is not None or end is not None:
            f.write("- **Range:** %s to %s (%.1fs)\n" % (fmt(eff_start), fmt(eff_end), eff_dur))
        f.write("- **Frames:** %d selected of %d candidates (method: %s, %d near-duplicate(s) dropped, detail %s, cap %d)\n"
                % (len(frames), max(sel["cands"], len(frames)), sel["method"], sel["dropped"], a.detail, cap))
        if dropped_cues:
            f.write("- **Pinned timestamps dropped outside the range:** %d\n" % dropped_cues)
        f.write("- **Transcript:** %s (%d segment(s))\n\n" % (tsource, len(segs)))

        f.write("## Frames\n\n")
        if frames:
            f.write("Read every path below in one message. `t=` is the absolute timestamp in the source.\n\n")
            f.write("| Path | t= | Reason |\n|---|---|---|\n")
            for fr in frames:
                f.write("| `%s` | %s | %s |\n" % (fr["path"].replace(os.sep, "/"), fmt(fr["t"]), fr["reason"]))
        else:
            f.write("No frames were sampled.\n")

        f.write("\n## Transcript\n\n")
        if segs:
            f.write("Source: %s.\n\n```\n" % tsource)
            for s in segs:
                f.write("[%02d:%02d] %s\n" % (int(s["start"]) // 60, int(s["start"]) % 60, s["text"]))
            f.write("```\n")
        else:
            f.write("None available. Nothing spoken in this video has been analysed.\n")

        f.write("\n## Not analysed\n\n")
        if notes:
            for n in notes:
                f.write("- %s\n" % n)
        else:
            f.write("- Audio itself is never heard; the transcript above is the only record of speech.\n")

    print("wrote %s" % report.replace(os.sep, "/"))
    print("frames: %d (%s), transcript: %s" % (len(frames), sel["method"], tsource))
    for n in notes:
        print("NOT ANALYSED: %s" % n)


if __name__ == "__main__":
    main()
