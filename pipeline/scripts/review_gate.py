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
