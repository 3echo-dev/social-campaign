#!/usr/bin/env python3
"""Social Campaign browser research worker.

Reads one JSON request on stdin:

    {"url": "...", "wait_for": "css selector"?, "scroll": 0..20?,
     "timeout_ms": 20000, "extract": "text"|"links"|"json_ld"}

Prints one JSON result on stdout:

    {"final_url": "...", "status": 200, "title": "...", "text": "...",
     "links": ["..."], "json_ld": [{...}], "blocked": false, "reason": null}

Standard library plus crawl4ai only. Never writes files. Never follows an
off-site redirect that lands on a login wall. Always exits with a hard
timeout, even if crawl4ai itself hangs.

This script is spawned by server/social/backends/browser.mjs with an argument
array (never a shell string), reads its one request from stdin and prints
its one result to stdout; everything else (progress, crawl4ai's own logging)
goes to stderr so stdout stays valid JSON.
"""

import asyncio
import json
import re
import sys
from urllib.parse import urlsplit

TEXT_CAP = 20_000
LINKS_CAP = 200
JSON_LD_CAP = 10
DEFAULT_TIMEOUT_MS = 20_000
MAX_SCROLL = 20

# Signals that a rendered page is a sign-in wall rather than the content asked for.
LOGIN_PATTERNS = re.compile(
    r"log ?in to (see|continue|view)|sign in to continue|create an account to|"
    r"you must be logged in|login_required|please log in|log into facebook|"
    r"polarisloggedout",
    re.IGNORECASE,
)

# Signals that an automated reader hit a bot check rather than the real page.
BOT_PATTERNS = re.compile(
    r"checking your browser|just a moment|cf-challenge|challenge-platform|"
    r"__rd_verify_|captcha|are you a robot|access denied|attention required",
    re.IGNORECASE,
)

EMPTY_TEXT_THRESHOLD = 200
SCRIPT_RATIO_THRESHOLD = 0.5


def script_ratio(html: str) -> float:
    if not html:
        return 0.0
    total = 0
    for match in re.finditer(r"<script\b[^>]*>[\s\S]*?</script>", html, re.IGNORECASE):
        total += len(match.group(0))
    return total / max(len(html), 1)


def is_empty_shell(html: str, text: str) -> bool:
    return len(text.strip()) < EMPTY_TEXT_THRESHOLD and script_ratio(html) > SCRIPT_RATIO_THRESHOLD


def extract_json_ld(html: str):
    blocks = []
    for match in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',
        html,
        re.IGNORECASE,
    ):
        raw = match.group(1).strip()
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        blocks.append(parsed)
        if len(blocks) >= JSON_LD_CAP:
            break
    return blocks


def is_same_site(a: str, b: str) -> bool:
    ha = urlsplit(a).hostname or ""
    hb = urlsplit(b).hostname or ""
    ha = ha.lower()
    hb = hb.lower()
    if ha.startswith("www."):
        ha = ha[4:]
    if hb.startswith("www."):
        hb = hb[4:]
    return ha == hb


async def run(request: dict) -> dict:
    url = str(request.get("url") or "").strip()
    if not url or not re.match(r"^https?://", url, re.IGNORECASE):
        return {
            "final_url": url,
            "status": 0,
            "title": None,
            "text": "",
            "links": [],
            "json_ld": [],
            "blocked": True,
            "reason": "not a web address",
        }

    wait_for = request.get("wait_for")
    scroll = max(0, min(MAX_SCROLL, int(request.get("scroll") or 0)))
    timeout_ms = int(request.get("timeout_ms") or DEFAULT_TIMEOUT_MS)

    from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

    js_code = None
    if scroll > 0:
        js_code = ";".join(
            "window.scrollTo(0, document.body.scrollHeight)" for _ in range(scroll)
        )

    browser_config = BrowserConfig(headless=True, verbose=False, java_script_enabled=True)
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=timeout_ms,
        wait_for=f"css:{wait_for}" if wait_for else None,
        js_code=js_code,
        scan_full_page=scroll > 0,
        check_robots_txt=True,
        verbose=False,
    )

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)

    final_url = getattr(result, "url", url) or url
    status = getattr(result, "status_code", None) or 0
    html = getattr(result, "html", "") or getattr(result, "cleaned_html", "") or ""
    text = ""
    markdown = getattr(result, "markdown", None)
    if markdown is not None:
        text = str(getattr(markdown, "raw_markdown", markdown) or "")
    if not text:
        text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text).strip()

    title = None
    metadata = getattr(result, "metadata", None) or {}
    if isinstance(metadata, dict):
        title = metadata.get("title")
    if not title:
        match = re.search(r"<title[^>]*>([\s\S]*?)</title>", html, re.IGNORECASE)
        if match:
            title = re.sub(r"\s+", " ", match.group(1)).strip() or None

    links = []
    raw_links = getattr(result, "links", None) or {}
    if isinstance(raw_links, dict):
        for group in ("internal", "external"):
            for entry in raw_links.get(group, []) or []:
                href = entry.get("href") if isinstance(entry, dict) else entry
                if isinstance(href, str) and href.startswith(("http://", "https://")):
                    links.append(href)
    links = links[:LINKS_CAP]

    json_ld = extract_json_ld(html)

    blocked = False
    reason = None
    success = getattr(result, "success", status == 0 or (200 <= status < 400))
    if not success and status == 0:
        blocked = True
        reason = "the browser worker could not load the page"
    elif LOGIN_PATTERNS.search(text) or LOGIN_PATTERNS.search(html[:20_000]):
        blocked = True
        reason = "login_wall"
    elif BOT_PATTERNS.search(text) or BOT_PATTERNS.search(html[:20_000]):
        blocked = True
        reason = "bot_check"
    elif is_empty_shell(html, text):
        blocked = True
        reason = "empty_shell"
    elif not is_same_site(url, final_url) and LOGIN_PATTERNS.search(text):
        # An off-site redirect that lands on someone else's login page is not
        # followed as content; it is reported as a login wall at the original url.
        blocked = True
        reason = "login_wall"
        final_url = url

    return {
        "final_url": final_url,
        "status": status,
        "title": title,
        "text": text[:TEXT_CAP],
        "links": links,
        "json_ld": json_ld,
        "blocked": blocked,
        "reason": reason,
    }


def main() -> int:
    try:
        raw = sys.stdin.read()
        request = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as error:
        json.dump({"error": f"invalid request json: {error}"}, sys.stdout)
        return 2

    timeout_ms = int(request.get("timeout_ms") or DEFAULT_TIMEOUT_MS)
    try:
        result = asyncio.run(asyncio.wait_for(run(request), timeout=timeout_ms / 1000 + 5))
    except asyncio.TimeoutError:
        json.dump(
            {
                "final_url": request.get("url"),
                "status": 0,
                "title": None,
                "text": "",
                "links": [],
                "json_ld": [],
                "blocked": True,
                "reason": "timed_out",
            },
            sys.stdout,
        )
        return 0
    except Exception as error:  # noqa: BLE001 - reported to the caller as JSON, never a raw traceback on stdout.
        print(f"social_fetch worker error: {error}", file=sys.stderr)
        json.dump({"error": str(error)}, sys.stdout)
        return 1

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
