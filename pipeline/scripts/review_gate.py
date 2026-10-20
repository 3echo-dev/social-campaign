"""The clips approval that must exist before the clips are joined, and the sound choice that must exist before the video is finished.

Mirrors server/pipeline/facts.mjs (mediaSet, mediaSetApproved, finishingRecord). approvals/clips.json is written by the board when
the person approves the clips, or by the plugin's own sign-off once its checks pass; both count. The stitch script reads it
here and refuses to run (exit 6) until every clip is approved, so a skill cannot skip the check. The finishing script needs the
same clips approval and a recorded sound choice; it does not wait for the joined video to be approved, because the finished
video is the rough cut the person sees.

A job with no 3Echo clips in its saved price (clips the person supplied) has no review to wait for, and nothing is refused.
"""
import hashlib, json, os, re

KEY = re.compile(r"-(D\d+)-([A-Za-z][A-Za-z0-9_]*)-v(\d+)$")


def _json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _lines(path):
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        pass
    return out


def _sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def _parse(key):
    m = KEY.search(str(key or ""))
    if not m:
        return None
    item = m.group(2)
    return {"deliverable": m.group(1), "item": item, "version": int(m.group(3)), "key": str(key)}


def _canon(key):
    p = _parse(key)
    if not p:
        return None
    hit = re.match(r"^([A-Za-z]+?)0*(\d+)$", p["item"])
    item = hit.group(1).upper() + str(int(hit.group(2))) if hit else p["item"]
    return "%s-%s-v%d" % (str(key)[: str(key).rfind("-" + p["deliverable"] + "-")], p["deliverable"] + "-" + item, p["version"])


RELEASED_STATUS = ("failed", "cancelled", "canceled")


def _made_clips(jobdir, landed_keys):
    """Clips made or being made, priced or not (a redo inside the redo allowance has no price line): [parsed key].

    Mirrors facts.madeClips: a video create counts unless it ended failed or cancelled with no output and nothing landed for it.
    """
    records = _lines(os.path.join(jobdir, "generation", "records.jsonl"))
    found = {}
    for r in records:
        if r.get("type") != "create" or r.get("provider") != "threeEcho":
            continue
        if not (r.get("kind") == "video" or r.get("tool") == "create_video_job"):
            continue
        key = _canon(r.get("key"))
        p = _parse(key)
        if not p or key in found or re.match(r"^(R|TR)\d+$", p["item"]):
            continue
        made = False
        for c in records:
            if c.get("type") != "create" or c.get("provider") != "threeEcho" or _canon(c.get("key")) != key:
                continue
            results = [x for x in records if x.get("type") == "result" and x.get("providerJobId") == c.get("providerJobId")]
            result = results[-1] if results else None
            status = str((result or {}).get("status") or "").lower()
            outputs = (result or {}).get("outputAssetIds")
            has_outputs = isinstance(outputs, list) and len(outputs) > 0
            if result and status in RELEASED_STATUS and not has_outputs and key not in landed_keys:
                continue
            made = True
            break
        if made:
            found[key] = p
    return list(found.values())


def clip_set(jobdir):
    """The newest 3Echo clip of each slot (priced, or a redo made without a price line) and the file it landed as: [{key, deliverable, file, sha256}]."""
    quote = _json(os.path.join(jobdir, "pricing", "quote.json")) or {}
    landed = [e for e in _lines(os.path.join(jobdir, "generation", "landed.jsonl"))
              if e.get("type") == "landed" and e.get("file") and e.get("sha256")]
    landed_keys = set(_canon(e.get("key")) for e in landed)
    newest = {}

    def offer(p):
        slot = (p["deliverable"], p["item"])
        if slot not in newest or p["version"] > newest[slot]["version"]:
            newest[slot] = p

    for item in quote.get("items") or []:
        if not isinstance(item, dict) or item.get("provider") != "threeEcho" or item.get("kind") != "video":
            continue
        p = _parse(item.get("key"))
        if not p or re.match(r"^(R|TR)\d+$", p["item"]):
            continue
        offer(p)
    for p in _made_clips(jobdir, landed_keys):
        offer(p)
    panels = []
    for slot, p in sorted(newest.items()):
        file = None
        for e in reversed(landed):
            if _canon(e.get("key")) == _canon(p["key"]) and os.path.isfile(os.path.join(jobdir, *e["file"].split("/"))):
                file = e
                break
        panels.append({"key": p["key"], "deliverable": p["deliverable"], "file": file["file"] if file else None,
                       "sha256": file["sha256"] if file else None})
    return panels


def _matches(decision_files, panels):
    if not isinstance(decision_files, list) or len(decision_files) != len(panels) or not panels:
        return False
    for panel in panels:
        if not panel["file"] or not any(
                isinstance(f, dict) and (f.get("key") == panel["key"] or _canon(f.get("key")) == _canon(panel["key"]))
                and f.get("sha256") == panel["sha256"] for f in decision_files):
            return False
    return True


def clips_approved(jobdir):
    d = _json(os.path.join(jobdir, "approvals", "clips.json"))
    return bool(d and d.get("decision") == "approve" and _matches(d.get("files"), clip_set(jobdir)))


def stitch_problem(jobdir):
    """Why the clips cannot be joined yet, or None."""
    if not clip_set(jobdir) or clips_approved(jobdir):
        return None
    return ("The video clips are not signed off yet. They need the plugin's checks to pass (pipeline_clips_signoff) "
            "or the person's approval, then they can be joined.")


# ---------------------------------------------------------------- the joined video and what to add to it
# Mirrors server/pipeline/facts.mjs (cutSet, finishingRecord) and server/pipeline/finishing.mjs. The Director records the answer to
# "what should be added" in approvals/finishing.json at any time before finishing; it is not tied to the joined video's files
# (an older record that lists them is still accepted). finish-video.py refuses (exit 6) until the clips are approved and that
# answer is recorded. The joined video (media/D<n>/final-raw.mp4) is not approved on its own: the finished video is the rough cut.
# "combine" is the sound choice with music, voice-over and captions rows: its flags are read from the record itself.
FINISHING_CHOICES = {"captions": (True, False), "music": (False, True), "both": (True, True), "skip": (False, False), "combine": None}


def cut_files(jobdir):
    """The joined cuts, [(job-relative path, sha256)], one per post that has media/D<n>/final-raw.mp4."""
    out = []
    try:
        names = sorted((n for n in os.listdir(os.path.join(jobdir, "media")) if re.match(r"^D\d+$", n)),
                       key=lambda n: int(n[1:]))
    except OSError:
        return out
    for name in names:
        rel = "media/%s/final-raw.mp4" % name
        path = os.path.join(jobdir, *rel.split("/"))
        if os.path.isfile(path) and os.path.getsize(path):
            out.append((rel, _sha(path)))
    return out


def _covers(entries, cuts):
    if not isinstance(entries, list) or not cuts or len(entries) != len(cuts):
        return False
    return all(any(isinstance(e, dict) and e.get("file") == rel and e.get("sha256") == sha for e in entries) for rel, sha in cuts)


def cut_approved(jobdir):
    d = _json(os.path.join(jobdir, "approvals", "cut.json"))
    return bool(d and d.get("decision") == "approve" and _covers(d.get("files"), cut_files(jobdir)))


def finishing_record(jobdir):
    """The whole record of what to add when it is a valid choice, else None. It is not bound to the cut's files. A plan saved as a suggestion (before the person answered) is not a choice."""
    d = _json(os.path.join(jobdir, "approvals", "finishing.json"))
    if not d or d.get("choice") not in FINISHING_CHOICES or d.get("suggested") is True:
        return None
    return d


def finishing(jobdir):
    """(captions, music, choice) recorded, else None."""
    d = finishing_record(jobdir)
    if d is None:
        return None
    if d["choice"] == "combine":
        return bool(d.get("captions")), bool(d.get("music")), "combine"
    captions, music = FINISHING_CHOICES[d["choice"]]
    return captions, music, d["choice"]


def card_picks(d):
    """The combine card's picks held by a finishing record (a dict), or None for an older four-way record, which holds none.

    A record made on the card holds its picks whatever its choice says: "combine" when there is a voice-over, and "captions",
    "music", "both" or "skip" (what combine.mjs combineChoice gives) when there is none.
    """
    if d is None:
        return None
    if isinstance(d.get("combine"), dict):
        return d["combine"]
    return {} if d.get("choice") == "combine" else None


def combine_picks(jobdir):
    """(want_voice, captions_source, uses_combine): the voice-over row and where the captions' words come from.

    Only a record made on the combine card has a voice-over row; an older four-way choice has none and keeps the voice-over
    placed by the manifest. captions_source is "voice" (the voice-over words, or what is heard), "script" or "none".
    """
    d = finishing_record(jobdir)
    picks = card_picks(d)
    if picks is None:
        return False, "voice", False
    voice = (picks.get("voice") or {}).get("source", "none")
    captions = (picks.get("captions") or {}).get("source", "voice")
    return bool(d.get("voice")) and voice != "none", captions if captions in ("voice", "script", "none") else "voice", True


def caption_style(jobdir):
    """The subtitle look picked on the combine card, "word" (one or two words at a time) or "line" (whole lines), or None when none was picked.

    None means the shape decides (finish-video.py: word on a 9:16 video, line on every other shape). An older four-way choice has no style.
    A record made on the card carries it with or without a voice-over (see card_picks).
    """
    picks = card_picks(finishing_record(jobdir))
    if picks is None:
        return None
    captions = picks.get("captions") if isinstance(picks.get("captions"), dict) else {}
    style = captions.get("style")
    return style if style in ("word", "line") else None


def finishing_problem(jobdir):
    """Why captions or music may not be added yet, or None."""
    if not cut_files(jobdir):
        return "The clips are not joined yet. Join them with stitch-clips.py, then finish the video."
    if clip_set(jobdir) and not clips_approved(jobdir):
        return ("The video clips are not approved yet. Check every clip and sign them off (pipeline_clips_signoff), "
                "or wait for the person to approve them, then finish the video.")
    if finishing(jobdir) is None:
        return ("The sound choice (music, voice-over and captions) is not recorded yet. Ask once with pipeline_board_ask "
                "and record the answer with pipeline_finishing_choice.")
    return None
