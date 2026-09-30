#!/usr/bin/env python3
"""Write base64 image bytes from an MCP tool result to a real file.

    <base64> | python save-asset-bytes.py workspaces/{brand}/jobs/{job}/media/D1/P2.png

fetch_asset_bytes returns dataBase64 inline rather than writing a file, and its
thumbnail variant is small enough to pass through a tool result. That is the only
route to disk when egress to the asset host is blocked.

Decodes, converts to PNG (thumbnails come back as WebP, which pptxgenjs will not
embed), validates, and reports what the file is actually good for.
"""
import base64, io, sys, os
from PIL import Image

if len(sys.argv) < 2:
    sys.exit("usage: <base64-on-stdin> | save-asset-bytes.py <out.png>")
out = sys.argv[1]

raw = sys.stdin.read().strip()
if "," in raw[:80] and raw.lstrip().startswith("data:"):
    raw = raw.split(",", 1)[1]                       # tolerate a data: URL
raw = "".join(raw.split())                           # tolerate wrapped lines

try:
    data = base64.b64decode(raw, validate=True)
except Exception as e:
    sys.exit("not valid base64 (%s). Paste dataBase64 exactly, with nothing around it." % type(e).__name__)

if not data:
    sys.exit("decoded to zero bytes")

try:
    im = Image.open(io.BytesIO(data))
    im.load()
except Exception as e:
    sys.exit("decoded %d bytes but they are not an image (%s)" % (len(data), type(e).__name__))

src_fmt, w, h = im.format, im.width, im.height
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
# WebP is what thumbnails come back as, and most tools will not embed it.
im.convert("RGB").save(out, "PNG")

print("  wrote %s  %dx%d  (from %s, %d bytes)" % (out.replace(os.sep, "/"), w, h, src_fmt, len(data)))
if w == h:
    print("  NOTE: square. The thumbnail variant centre-crops, so a 9:16 frame loses its top and bottom.")
if w < 1500:
    print("  NOTE: %dpx wide. Fine for review, never for hand-off." % w)
    print("        Fetch the media variant where egress allows, or resume in Claude Code.")
