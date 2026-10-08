"""The person's review that must be approved before the clips are joined.

Mirrors server/pipeline/facts.mjs (mediaSet, mediaSetApproved). The board writes approvals/clips.json; the stitch script reads it
here and refuses to run (exit 6) until every clip is approved, so a skill cannot skip the review.

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


def clip_set(jobdir):
    """The newest priced 3Echo clip of each slot and the file it landed as: [{key, deliverable, file, sha256}]."""
    quote = _json(os.path.join(jobdir, "pricing", "quote.json")) or {}
    newest = {}
    for item in quote.get("items") or []:
        if not isinstance(item, dict) or item.get("provider") != "threeEcho" or item.get("kind") != "video":
            continue
        p = _parse(item.get("key"))
        if not p or re.match(r"^(R|TR)\d+$", p["item"]):
            continue
        slot = (p["deliverable"], p["item"])
        if slot not in newest or p["version"] > newest[slot]["version"]:
            newest[slot] = p
    landed = [e for e in _lines(os.path.join(jobdir, "generation", "landed.jsonl"))
              if e.get("type") == "landed" and e.get("file") and e.get("sha256")]
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
    return ("The video clips have not been approved yet. Present the clips review (pipeline_review_present with gate clips), "
            "wait for the person to approve them all, then join them.")


# ---------------------------------------------------------------- the joined video and what to add to it
# Mirrors server/pipeline/facts.mjs (cutSet, mediaSetApproved for gate "cut") and server/pipeline/finishing.mjs. The board writes
# approvals/cut.json when the person approves the joined video (media/D<n>/final-raw.mp4); the Director records the answer to
# "what should be added" in approvals/finishing.json. finish-video.py refuses (exit 6) until both match the files as they are now.
FINISHING_CHOICES = {"captions": (True, False), "music": (False, True), "both": (True, True), "skip": (False, False)}


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


def finishing(jobdir):
    """(captions, music, choice) recorded for the joined video as approved now, else None."""
    d = _json(os.path.join(jobdir, "approvals", "finishing.json"))
    if not d or d.get("choice") not in FINISHING_CHOICES or not cut_approved(jobdir) or not _covers(d.get("files"), cut_files(jobdir)):
        return None
    captions, music = FINISHING_CHOICES[d["choice"]]
    return captions, music, d["choice"]


def finishing_problem(jobdir):
    """Why captions or music may not be added yet, or None."""
    if not cut_files(jobdir):
        return "The clips are not joined yet. Join them with stitch-clips.py, show the joined video and wait for the person to approve it."
    if not cut_approved(jobdir):
        return ("The person has not approved the joined video yet. Present it (pipeline_review_present with gate cut), wait for the "
                "approval, then ask what to add. Nothing is added before that.")
    if finishing(jobdir) is None:
        return ("The person has not said what to add yet. Ask once with pipeline_board_ask (Add captions, Add background music, Both, "
                "Skip use as is) and record the answer with pipeline_finishing_choice.")
    return None
