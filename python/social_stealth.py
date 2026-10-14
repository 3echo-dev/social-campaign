"""Stealth research worker, built on Scrapling: TikTok profiles, TikTok Creative Center top ads,
Meta Ad Library search and pages that answer 403 or a Cloudflare check (Instagram profile, post and
popular-topic pages included).

Reads ONE JSON request on stdin and prints ONE JSON result on stdout, in UTF-8 whatever the console
code page is (an emoji in a caption must never turn the answer into a traceback). It never logs in,
never uses or stores cookies, never rotates proxies, and makes ONE request per operation, with one
exception: when TikTok answers a profile page with an empty video list, the page is read one more time
(see op_tiktok_profile). It has its own deadline (the request's timeout_ms minus 3 s) and, when that
passes, prints a timed_out result and ends itself and the browser it started.

Request:  {"op": "tiktok_profile|tiktok_top_ads|meta_ad_library|page",
           "handle": "...", "url": "...", "query": "...", "keyword": "...", "country": "US", "period": 30,
           "limit": 20, "timeout_ms": 75000}
Result:   {"status": "ok|empty|blocked|login_required|rate_limited|not_found|not_installed|timed_out|error",
           "detail": "...", ...data}

Data by operation:
  tiktok_profile   profile {handle,nickname,bio,verified,followers,following,likes,videos},
                   items [{url,id,views,likes,comments,shares,createdAt,caption,durationS}],
                   attempts (1 or 2), itemsStatus ("empty" when the profile was read but no video was),
                   itemsNote
  tiktok_top_ads   ads [{id,title,caption,brand,industry,industryName,objective,ctr,likes,videoUrl,cover,landing,url}],
                   keyword, keywordApplied, listScope ("keyword" or "region_wide"), keywordNote. The keyword is typed into
                   the Creative Center's own "Search by brand or product keywords" box; when that box cannot be driven
                   the region-wide list comes back, labelled as such.
  meta_ad_library  ads [{id,pageName,startDate,text,headline,cta,domain,snapshotUrl}]; pageName is the advertiser's
                   page, text is the ad copy
  page             finalUrl, httpStatus, title, text (20k), links (200), method, meta {og:*, description, ...};
                   a page that is only a JavaScript shell (no text, no links) is reported as status "empty".
                   instagram.com pages also carry instagram {user, media}: the account and post facts the
                   page embeds for a signed out visitor (followers, caption, likes, comments, date, video
                   address, popular-topic play counts, and on a post page its first comments, photo posts included).
                   Instagram is read with the plain request only.

Scrapling's own browser install is never run from here (the plugin installs Chromium in setup).
"""

import html as html_lib
import ipaddress
import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlencode, urlparse

DEFAULT_TIMEOUT_MS = 75_000
DEADLINE_MARGIN_S = 3.0
TEXT_CAP = 20_000
LINK_CAP = 200
# A profile read whose video list is empty is repeated once, but only when this much of the deadline is left.
RETRY_MIN_REMAINING_MS = 20_000
# A page with less readable text than this and no links is a JavaScript shell, not a page.
SHELL_TEXT_MAX = 60
META_CAP = 40
META_VALUE_CAP = 1_000
INSTAGRAM_MEDIA_CAP = 60
INSTAGRAM_COMMENT_CAP = 100

TIKTOK_PROFILE_URL = "https://www.tiktok.com/@{handle}"
TIKTOK_ITEM_LIST = r"/api/post/item_list/"
TOP_ADS_URL = "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en"
TOP_ADS_XHR = r"creative_radar_api/v1/top_ads"
META_LIBRARY_URL = "https://www.facebook.com/ads/library/"

CHALLENGE_PATTERN = re.compile(
    r"just a moment|cf-challenge|challenge-platform|checking your browser|verify you are human|"
    r"attention required|access denied|please wait\.\.\.|captcha|unusual traffic|are you a robot",
    re.I,
)
LOGIN_PATTERN = re.compile(r"log in to (continue|see|view)|login_required|you must log in|sign in to continue", re.I)

_started = time.monotonic()
_deadline_s = DEFAULT_TIMEOUT_MS / 1000.0 - DEADLINE_MARGIN_S
_printed = threading.Lock()


# ---------------------------------------------------------------- output and deadline

def configure_output():
    """Read and write UTF-8 on stdin, stdout and stderr, whatever the console code page is.

    A Python started by a pipe on Windows uses cp1252, so one emoji in a caption raised UnicodeEncodeError and the
    reader that spawned this worker saw no JSON at all. The caller also sets PYTHONUTF8=1; this makes the worker
    correct on its own.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 - a stream that cannot be reconfigured stays as it is
            pass


def emit(result):
    """Print the one result and flush. Only the first call prints."""
    if not _printed.acquire(blocking=False):
        return
    try:
        text = json.dumps(result, ensure_ascii=False)
        sys.stdout.write(text)
    except UnicodeError:
        # Last resort for a stream that is not UTF-8 (or a lone surrogate): ASCII escapes are valid JSON anywhere.
        sys.stdout.write(json.dumps(result, ensure_ascii=True))
    sys.stdout.flush()


def hard_exit():
    """End this process and the browser it started. Windows: taskkill /T. POSIX: the whole process group."""
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(os.getpid()), "/T", "/F"], capture_output=True, timeout=5)
        elif os.getpgrp() == os.getpid():
            # Only when this worker leads its own group (Node starts it that way); never someone else's group.
            os.killpg(os.getpgrp(), 9)
    except Exception:  # noqa: BLE001
        pass
    os._exit(0)


def start_watchdog(seconds):
    def fire():
        emit({"status": "timed_out", "detail": "The page did not finish loading in time."})
        hard_exit()

    timer = threading.Timer(max(1.0, seconds), fire)
    timer.daemon = True
    timer.start()
    return timer


def remaining_ms(reserve_s=1.0):
    return max(1000, int((_deadline_s - (time.monotonic() - _started) - reserve_s) * 1000))


# ---------------------------------------------------------------- small helpers

def to_int(value):
    try:
        number = int(float(value))
        return number if number >= 0 else None
    except (TypeError, ValueError):
        return None


def iso_from_epoch(value):
    number = to_int(value)
    if number is None or number == 0:
        return None
    try:
        return datetime.fromtimestamp(number, tz=timezone.utc).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return None


def body_text(response):
    """The response body as text, never raising."""
    try:
        raw = response.body
        if isinstance(raw, (bytes, bytearray)):
            return bytes(raw).decode("utf-8", errors="replace")
        return str(raw or "")
    except Exception:  # noqa: BLE001
        return ""


def body_json(response):
    try:
        return json.loads(body_text(response))
    except Exception:  # noqa: BLE001
        return None


def status_of(response):
    try:
        return int(getattr(response, "status", 0) or 0)
    except (TypeError, ValueError):
        return 0


def looks_blocked(response, text):
    code = status_of(response)
    if code in (401, 403, 429, 503):
        return True
    head = (text or "")[:6000]
    return bool(CHALLENGE_PATTERN.search(head)) and len(text or "") < 8000


def classify(error):
    """Map an exception to a status without leaking its text (it may carry URLs)."""
    name = type(error).__name__
    text = str(error).lower()
    if name in ("ModuleNotFoundError", "ImportError"):
        return "not_installed", "Scrapling is not installed."
    if "executable doesn't exist" in text or "playwright install" in text or "patchright install" in text:
        return "not_installed", "The browser for the stealth reader is not installed."
    if "timeout" in text or name in ("TimeoutError", "TimeoutException"):
        return "timed_out", "The page did not finish loading in time."
    if "captcha" in text or "403" in text or "429" in text or "blocked" in text:
        return "blocked", "The site refused an anonymous read."
    return "error", name


def safe_http_url(url):
    """An http(s) URL that does not name this computer or a private address, else None."""
    try:
        parsed = urlparse(str(url or "").strip())
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return None
        host = parsed.hostname.lower()
        if host == "localhost" or host.endswith(".localhost") or host.endswith(".local") or host.endswith(".internal"):
            return None
        try:
            ip = ipaddress.ip_address(host)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
                return None
        except ValueError:
            pass
        return parsed.geturl()
    except Exception:  # noqa: BLE001
        return None


def stealth_fetch(url, **options):
    """One StealthyFetcher request: headless, no cookies, no proxy, no retries."""
    from scrapling.fetchers import StealthyFetcher

    options.setdefault("headless", True)
    options.setdefault("retries", 1)
    options.setdefault("google_search", False)
    options["timeout"] = min(int(options.get("timeout", remaining_ms())), remaining_ms())
    return StealthyFetcher.fetch(url, **options)


# ---------------------------------------------------------------- TikTok profile

def universal_data(html):
    match = re.search(
        r'<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>', html or "", re.S
    )
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except Exception:  # noqa: BLE001
        return None


def profile_from_universal(data):
    scope = (data or {}).get("__DEFAULT_SCOPE__", {}) if isinstance(data, dict) else {}
    detail = scope.get("webapp.user-detail", {}) if isinstance(scope, dict) else {}
    info = detail.get("userInfo", {}) if isinstance(detail, dict) else {}
    user = info.get("user", {}) or {}
    stats = info.get("stats", {}) or info.get("statsV2", {}) or {}
    if not user and not stats:
        return None
    return {
        "handle": user.get("uniqueId"),
        "nickname": user.get("nickname"),
        "bio": user.get("signature"),
        "verified": bool(user.get("verified")),
        "followers": to_int(stats.get("followerCount")),
        "following": to_int(stats.get("followingCount")),
        "likes": to_int(stats.get("heartCount", stats.get("heart"))),
        "videos": to_int(stats.get("videoCount")),
        "avatar": next((user[key] for key in ("avatarLarger", "avatarMedium", "avatarThumb") if isinstance(user.get(key), str) and user[key].startswith("http")), None),
    }


def items_from_item_list(payloads, handle, limit):
    items, seen = [], set()
    for payload in payloads:
        entries = payload.get("itemList") if isinstance(payload, dict) else None
        for entry in entries or []:
            if not isinstance(entry, dict):
                continue
            video_id = str(entry.get("id") or "")
            if not video_id or video_id in seen:
                continue
            seen.add(video_id)
            stats = entry.get("stats") or entry.get("statsV2") or {}
            author = (entry.get("author") or {}).get("uniqueId") if isinstance(entry.get("author"), dict) else None
            owner = author or handle
            items.append({
                "url": f"https://www.tiktok.com/@{owner}/video/{video_id}",
                "id": video_id,
                "views": to_int(stats.get("playCount")),
                "likes": to_int(stats.get("diggCount")),
                "comments": to_int(stats.get("commentCount")),
                "shares": to_int(stats.get("shareCount")),
                "createdAt": iso_from_epoch(entry.get("createTime")),
                "caption": entry.get("desc") or "",
                "durationS": to_int((entry.get("video") or {}).get("duration")),
            })
            if len(items) >= limit:
                return items
    return items


def read_tiktok_profile(handle, limit):
    """One load of the profile page: (response, html, blocked, profile, items)."""
    response = stealth_fetch(
        TIKTOK_PROFILE_URL.format(handle=quote(handle)),
        capture_xhr=TIKTOK_ITEM_LIST,
        network_idle=False,
        wait=4000,
    )
    html = body_text(response)
    if looks_blocked(response, html):
        return response, html, True, None, []
    profile = profile_from_universal(universal_data(html))
    payloads = [p for p in (body_json(x) for x in getattr(response, "captured_xhr", []) or []) if p]
    return response, html, False, profile, items_from_item_list(payloads, handle, limit)


def op_tiktok_profile(request):
    """A public TikTok profile and its latest videos.

    The one exception to "one request per operation": TikTok's item_list call answered 200 with an empty body on
    three of four live reads of one account (2026-10-13), the profile facts being there each time. When the list is
    empty and there is time left, the page is loaded ONE more time. If it is still empty the answer says so (a
    profile with itemsStatus "empty"), never an ok with nothing in it.
    """
    handle = re.sub(r"[^A-Za-z0-9._]", "", str(request.get("handle") or "").lstrip("@"))
    if not handle:
        return {"status": "error", "detail": "No TikTok handle was given."}
    limit = max(1, min(int(request.get("limit") or 20), 50))
    response, html, blocked, profile, items = read_tiktok_profile(handle, limit)
    if blocked:
        return {"status": "blocked", "detail": "TikTok answered with a bot check."}
    attempts = 1
    reload_refused = False
    if not items and remaining_ms() >= RETRY_MIN_REMAINING_MS:
        attempts = 2
        _, retry_html, retry_blocked, retry_profile, retry_items = read_tiktok_profile(handle, limit)
        reload_refused = retry_blocked
        if not retry_blocked:
            items = retry_items
            profile = profile or retry_profile
            html = retry_html if profile is None else html
    if profile is None and not items:
        if LOGIN_PATTERN.search(html[:6000]):
            return {"status": "login_required", "detail": "TikTok asked for a sign in."}
        return {"status": "empty", "detail": "No profile data came back for that handle."}
    result = {"status": "ok", "profile": profile or {"handle": handle}, "items": items, "attempts": attempts}
    if not items:
        result["itemsStatus"] = "empty"
        result["itemsNote"] = (
            "TikTok answered the profile page but its video list came back empty"
            + (", and the reload was refused." if reload_refused else " twice." if attempts == 2 else " (no time was left to ask again).")
        )
    return result


# ---------------------------------------------------------------- TikTok Creative Center top ads

# The 21 top level industries of the Creative Center (its filters list carries all 258 with their names).
TOP_INDUSTRIES = {
    "10": "Education", "11": "Vehicle & Transportation", "12": "Baby, Kids & Maternity", "13": "Financial Services",
    "14": "Beauty & Personal Care", "15": "Tech & Electronics", "16": "Appliances", "17": "Travel",
    "18": "Household Products", "19": "Pets", "20": "Apps", "21": "Home Improvement", "22": "Apparel & Accessories",
    "23": "News & Entertainment", "24": "Business Services", "25": "Games", "26": "Life Services",
    "27": "Food & Beverage", "28": "Sports & Outdoor", "29": "Health", "30": "E-Commerce (Non-app)",
}
TOP_ADS_LIST = "top_ads/v2/list"
TOP_ADS_FILTERS = "top_ads/v2/filters"
KEYWORD_SEARCH_BOX = 'input[placeholder*="brand or product"]'
KEYWORD_SETTLE_MS = 2000
KEYWORD_WAIT_MS = 6500


def xhr_pairs(response):
    """The (address, parsed JSON) of every XHR the page made that the capture pattern matched."""
    pairs = []
    for item in getattr(response, "captured_xhr", []) or []:
        payload = body_json(item)
        if payload:
            pairs.append((str(getattr(item, "url", "") or ""), payload))
    return pairs


def label_names(pairs):
    """Industry and objective names from the page's own filters list: {'label_20105000000': 'Apps', ...}."""
    names = {}
    for address, payload in pairs:
        if TOP_ADS_FILTERS not in address:
            continue
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            continue
        for group in ("industry", "objective"):
            for entry in data.get(group) or []:
                if not isinstance(entry, dict) or not isinstance(entry.get("value"), str):
                    continue
                if entry.get("label"):
                    names[str(entry["label"])] = entry["value"]
                if group == "industry" and entry.get("id") is not None:
                    names["label_%s" % entry["id"]] = entry["value"]
    return names


def industry_name(code, names):
    """'label_20105000000' -> the sub industry's name from the filters list, else its top level industry's name."""
    if not isinstance(code, str) or not code:
        return None
    if code in names:
        return names[code]
    digits = re.sub(r"\D", "", code)
    return TOP_INDUSTRIES.get(digits[:2]) if len(digits) >= 2 else None


def ads_from_top_ads(payloads, country, limit, names=None):
    names = names or {}
    ads, seen = [], set()
    for payload in payloads:
        data = payload.get("data") if isinstance(payload, dict) else None
        materials = []
        if isinstance(data, dict):
            materials = data.get("materials") or data.get("list") or []
        for item in materials:
            if not isinstance(item, dict):
                continue
            ad_id = str(item.get("id") or item.get("material_id") or "")
            if not ad_id or ad_id in seen:
                continue
            seen.add(ad_id)
            video = item.get("video_info") if isinstance(item.get("video_info"), dict) else {}
            video_url = video.get("video_url")
            if isinstance(video_url, dict):
                video_url = next((video_url[key] for key in ("720p", "540p", "480p", "360p") if video_url.get(key)), None) or next(iter(video_url.values()), None)
            industry = item.get("industry_key") or item.get("industry")
            industry = industry if isinstance(industry, str) else None
            objective = item.get("objective_key") if isinstance(item.get("objective_key"), str) else None
            title = item.get("ad_title") or item.get("title") or ""
            ads.append({
                "id": ad_id,
                "title": title,
                "caption": title,
                "brand": item.get("brand_name"),
                "industry": industry,
                "industryName": industry_name(industry, names),
                "objective": names.get(objective, objective) if objective else None,
                "ctr": item.get("ctr"),
                "likes": to_int(item.get("like")),
                "videoUrl": video_url if isinstance(video_url, str) else None,
                "cover": video.get("cover") if isinstance(video.get("cover"), str) else None,
                "landing": item.get("landing_page"),
                "country": country,
                "url": f"https://ads.tiktok.com/business/creativecenter/topads/{ad_id}/pc/en",
            })
            if len(ads) >= limit:
                return ads
    return ads


def apply_keyword_search(page, keyword, state):
    """Type the keyword into the page's own search box and press Enter, the way a visitor would.

    The page ignores a keyword in its address; its search box asks the list service for the matching ads. A welcome
    popup can cover the box, so it is dismissed first. Any problem is noted in `state` and the region-wide list that
    was already loaded is what comes back.
    """
    try:
        page.wait_for_timeout(KEYWORD_SETTLE_MS)
        try:
            page.keyboard.press("Escape")
            page.evaluate("() => document.querySelectorAll('[class*=\"Popup\"]').forEach((e) => e.remove())")
        except Exception:  # noqa: BLE001 - no popup to dismiss
            pass
        boxes = page.query_selector_all(KEYWORD_SEARCH_BOX)
        box = next((candidate for candidate in boxes if candidate.is_visible()), None)
        if box is None:
            state["error"] = "the page has no search box"
            return
        box.focus()
        box.fill(keyword, timeout=5000, force=True)
        box.press("Enter")
        page.wait_for_timeout(KEYWORD_WAIT_MS)
    except Exception as error:  # noqa: BLE001
        state["error"] = type(error).__name__


def op_tiktok_top_ads(request):
    country = re.sub(r"[^A-Za-z]", "", str(request.get("country") or "US")).upper()[:2] or "US"
    try:
        period = int(request.get("period") or 30)
    except (TypeError, ValueError):
        period = 30
    if period not in (7, 30, 180):
        period = 30
    limit = max(1, min(int(request.get("limit") or 20), 50))
    keyword = str(request.get("keyword") or "").strip()[:80]
    # The address carries the region and period only: a keyword in it is ignored by the page.
    url = f"{TOP_ADS_URL}?{urlencode({'region': country, 'period': period})}"
    state = {"error": None}
    options = {"capture_xhr": TOP_ADS_XHR, "load_dom": False, "wait": 4000 if keyword else 8000, "network_idle": False}
    if keyword:
        options["page_action"] = lambda page: apply_keyword_search(page, keyword, state)
    # network_idle=True hung this page for 8+ minutes in a live test: never use it here.
    response = stealth_fetch(url, **options)
    pairs = xhr_pairs(response)
    names = label_names(pairs)
    lists = [(address, payload) for address, payload in pairs if TOP_ADS_LIST in address]
    keyed = [payload for address, payload in lists if "keyword=" in address]
    if keyword and keyed:
        # The list the search box asked for (the last one, should it have asked twice).
        applied, payloads = True, [keyed[-1]]
    else:
        applied = False
        payloads = [payload for _address, payload in lists] or [payload for _address, payload in pairs]
    ads = ads_from_top_ads(payloads, country, limit, names)
    if applied and not ads:
        # The search ran and nothing matches: an answer, not a failure (and no reason to look anywhere else).
        return {"status": "ok", "ads": [], "keyword": keyword, "keywordApplied": True, "listScope": "keyword", "note": 'Creative Center has no top ads matching "%s" in %s over the last %d days.' % (keyword, country, period)}
    if not ads:
        html = body_text(response)
        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        if match:
            try:
                materials = json.loads(match.group(1))["props"]["pageProps"]["data"]["materials"]
                ads = ads_from_top_ads([{"data": {"materials": materials}}], country, limit, names)
            except Exception:  # noqa: BLE001
                ads = []
        if not ads:
            if looks_blocked(response, html):
                return {"status": "blocked", "detail": "TikTok Creative Center answered with a bot check."}
            return {"status": "empty", "detail": "Creative Center did not return its top ads list."}
    result = {"status": "ok", "ads": ads, "keyword": keyword or None, "keywordApplied": applied, "listScope": "keyword" if applied else "region_wide"}
    if keyword and not applied:
        why = state["error"] or "the page did not run the search"
        result["keywordNote"] = 'The keyword "%s" was not applied (%s), so this is the region-wide top ads list.' % (keyword, why)
    return result


# ---------------------------------------------------------------- Meta Ad Library

def text_of(response):
    try:
        return str(response.get_all_text(separator="\n", strip=True))
    except Exception:  # noqa: BLE001
        return ""


VIDEO_TIMER = re.compile(r"^\d{1,2}:\d{2}$")
DOMAIN_LINE = re.compile(r"^[A-Z0-9][A-Z0-9-]*(\.[A-Z0-9-]+)+(/\S*)?$")
CARD_EDGE = re.compile(r"^(Library ID|See ad details|See summary details|Platforms?|Open Dropdown|Active|Inactive|EU transparency)\b", re.I)
CTA_LINES = {
    "learn more", "shop now", "sign up", "download", "play game", "book now", "order now", "get offer", "subscribe",
    "apply now", "contact us", "install now", "watch more", "send message", "get quote", "listen now", "see menu",
    "call now", "get directions", "use app", "donate now", "request time", "get showtimes", "open link", "watch video",
    "get started", "send whatsapp message", "message us", "view more", "buy now",
}
COPY_LINES_MAX = 30
COPY_CHARS_MAX = 2000


def ads_from_text(text, limit):
    """Cards in the rendered page text: each starts at 'Library ID: <digits>'.

    A card reads: the page (advertiser) name, the word "Sponsored", the ad copy, then for a video its timer ("0:00",
    "/", "0:27"), the destination domain in capitals, a headline and the call to action button. The advertiser is the
    line BEFORE "Sponsored"; the copy is what follows it.
    """
    ads = []
    parts = re.split(r"Library ID:?\s*", text)
    for part in parts[1:]:
        match = re.match(r"(\d{6,20})", part)
        if not match:
            continue
        ad_id = match.group(1)
        lines = [line for line in (raw.replace("\u200b", "").strip() for raw in part[match.end():].split("\n")) if line]
        started = None
        for line in lines[:12]:
            date = re.search(r"Started running on\s+(.+)", line, re.I)
            if date:
                started = date.group(1).strip()
                break
        page_name = None
        body = None
        headline = None
        cta = None
        domain = None
        for index, line in enumerate(lines[:40]):
            if line.lower() != "sponsored":
                continue
            before = lines[index - 1] if index > 0 else None
            if before and not CARD_EDGE.match(before) and before.lower() != "sponsored":
                page_name = before
            copy = []
            cursor = index + 1
            while cursor < len(lines) and cursor - index <= COPY_LINES_MAX:
                follow = lines[cursor]
                if CARD_EDGE.match(follow) or VIDEO_TIMER.match(follow) or (DOMAIN_LINE.match(follow) and follow.upper() == follow) or follow.lower() in CTA_LINES:
                    break
                copy.append(follow)
                cursor += 1
            body = "\n".join(copy).strip()[:COPY_CHARS_MAX] or None
            # What follows the copy: the video timer, the destination domain, the headline and the button.
            tail = []
            while cursor < len(lines) and len(tail) < 8 and not CARD_EDGE.match(lines[cursor]):
                if not (VIDEO_TIMER.match(lines[cursor]) or lines[cursor] == "/"):
                    tail.append(lines[cursor])
                cursor += 1
            if tail and DOMAIN_LINE.match(tail[0]) and tail[0].upper() == tail[0]:
                domain = tail.pop(0)
            if tail and tail[-1].lower() in CTA_LINES:
                cta = tail.pop()
            headline = tail[0] if tail else None
            break
        ads.append({"id": ad_id, "pageName": page_name, "startDate": started, "text": body, "headline": headline, "cta": cta, "domain": domain})
        if len(ads) >= limit * 2:
            break
    return ads


def ads_from_html(html):
    """Ad archive ids embedded in the page's own data, with a page name when it sits close by."""
    found = {}
    for match in re.finditer(r'"ad_archive_id"\s*:\s*"?(\d{6,20})"?', html or ""):
        ad_id = match.group(1)
        window = html[match.end():match.end() + 3000]
        name = re.search(r'"page_name"\s*:\s*"((?:[^"\\]|\\.)*)"', window)
        start = re.search(r'"start_date"\s*:\s*(\d{9,11})', window)
        body = re.search(r'"body"\s*:\s*\{[^{}]*?"text"\s*:\s*"((?:[^"\\]|\\.)*)"', window)
        entry = found.setdefault(ad_id, {"id": ad_id, "pageName": None, "startDate": None, "text": None, "headline": None, "cta": None, "domain": None})
        def unescape(value):
            try:
                return json.loads(f'"{value}"')
            except Exception:  # noqa: BLE001
                return value
        if name and not entry["pageName"]:
            entry["pageName"] = unescape(name.group(1))
        if start and not entry["startDate"]:
            entry["startDate"] = iso_from_epoch(start.group(1))
        if body and not entry["text"]:
            entry["text"] = unescape(body.group(1))
    return list(found.values())


def op_meta_ad_library(request):
    query = str(request.get("query") or "").strip()
    if not query:
        return {"status": "error", "detail": "No search words were given."}
    country = re.sub(r"[^A-Za-z]", "", str(request.get("country") or "US")).upper()[:2] or "US"
    limit = max(1, min(int(request.get("limit") or 30), 60))
    params = {
        "active_status": "active", "ad_type": "all", "country": country, "media_type": "all",
        "q": query, "search_type": "keyword_unordered",
    }
    if re.fullmatch(r"\d{6,20}", query):
        params.pop("q")
        params.pop("search_type")
        params["view_all_page_id"] = query
    response = stealth_fetch(f"{META_LIBRARY_URL}?{urlencode(params)}", network_idle=False, wait=5000)
    html = body_text(response)
    text = text_of(response)
    merged, order = {}, []
    for entry in ads_from_text(text, limit) + ads_from_html(html):
        current = merged.get(entry["id"])
        if current is None:
            merged[entry["id"]] = dict(entry)
            order.append(entry["id"])
        else:
            for key, value in entry.items():
                if value and not current.get(key):
                    current[key] = value
    ads = []
    for ad_id in order[:limit]:
        entry = merged[ad_id]
        entry["snapshotUrl"] = f"https://www.facebook.com/ads/library/?id={ad_id}"
        ads.append(entry)
    if not ads:
        if looks_blocked(response, text or html):
            return {"status": "blocked", "detail": "The Meta Ad Library answered with a bot check."}
        if LOGIN_PATTERN.search((text or html)[:6000]):
            return {"status": "login_required", "detail": "The Meta Ad Library asked for a sign in."}
        return {"status": "empty", "detail": "No ads were found for that search."}
    return {"status": "ok", "ads": ads}


# ---------------------------------------------------------------- generic page

META_TAG = re.compile(r"<meta\s+([^>]*?)/?>", re.I)
META_ATTR = re.compile(r"([A-Za-z:_-]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')")
META_KEYS = re.compile(r"^(og:|twitter:|description$|keywords$|robots$)", re.I)


def meta_tags(html):
    """The page's own <meta> tags that describe it (Open Graph, Twitter card, description), HTML-unescaped."""
    found = {}
    for tag in META_TAG.finditer(html or ""):
        attrs = {}
        for attr in META_ATTR.finditer(tag.group(1)):
            attrs[attr.group(1).lower()] = html_lib.unescape(attr.group(2) if attr.group(2) is not None else attr.group(3) or "")
        key = attrs.get("property") or attrs.get("name")
        if key and "content" in attrs and META_KEYS.match(key) and key not in found:
            found[key] = attrs["content"][:META_VALUE_CAP]
            if len(found) >= META_CAP:
                break
    return found


def page_result(response, method):
    text = text_of(response)
    links = []
    try:
        for anchor in response.css("a[href]"):
            href = anchor.attrib.get("href", "")
            if href and not href.startswith(("javascript:", "#")):
                links.append(response.urljoin(href))
            if len(links) >= LINK_CAP:
                break
    except Exception:  # noqa: BLE001
        links = []
    title = ""
    try:
        title = str(response.css("title::text").get() or "")
    except Exception:  # noqa: BLE001
        title = ""
    return {
        "finalUrl": str(getattr(response, "url", "") or ""),
        "httpStatus": status_of(response),
        "title": title.strip(),
        "text": text[:TEXT_CAP],
        "links": links[:LINK_CAP],
        "method": method,
    }


def is_js_shell(result):
    """A page with no readable text and no links at all: its content is drawn in the browser (TikTok tag and search pages)."""
    return len((result.get("text") or "").strip()) < SHELL_TEXT_MAX and not result.get("links")


SHELL_DETAIL = "The page is only a JavaScript shell: its content is drawn in the browser, so there was nothing to read."


# ---------------------------------------------------------------- Instagram pages (signed out)

INSTAGRAM_HOST = re.compile(r"(^|\.)instagram\.com$", re.I)
SJS_BLOCK = re.compile(r"<script[^>]*type=\"application/json\"[^>]*data-sjs[^>]*>(.*?)</script>", re.S)
MEDIA_CODE = re.compile(r"^[A-Za-z0-9_-]{5,20}$")
MONTHS = {
    name: index
    for index, name in enumerate(
        ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], 1
    )
}


def is_instagram_url(url):
    try:
        return bool(INSTAGRAM_HOST.search(urlparse(url).hostname or ""))
    except Exception:  # noqa: BLE001
        return False


def iter_dicts(node, depth=0):
    """Every dict in a parsed JSON document, in document order."""
    if depth > 60:
        return
    if isinstance(node, dict):
        yield node
        for value in node.values():
            if isinstance(value, (dict, list)):
                yield from iter_dicts(value, depth + 1)
    elif isinstance(node, list):
        for value in node:
            if isinstance(value, (dict, list)):
                yield from iter_dicts(value, depth + 1)


def count_or_none(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def date_from_accessibility(text):
    """'Video by Duolingo on June 10, 2025.' -> '2025-06-10'. None when the caption carries no date."""
    match = re.search(r"on ([A-Z][a-z]+) (\d{1,2}), (\d{4})", str(text or ""))
    if not match or match.group(1) not in MONTHS:
        return None
    return "%s-%02d-%02d" % (match.group(3), MONTHS[match.group(1)], int(match.group(2)))


def first_video_url(node):
    versions = node.get("video_versions")
    if isinstance(versions, list):
        for version in versions:
            if isinstance(version, dict) and isinstance(version.get("url"), str) and version["url"].startswith("http"):
                return version["url"]
    return None


def sound_of(node):
    meta = node.get("clips_metadata")
    if not isinstance(meta, dict):
        return None
    music = meta.get("music_info")
    if isinstance(music, dict):
        asset = music.get("music_asset_info")
        if isinstance(asset, dict) and asset.get("title"):
            return " - ".join(str(x) for x in (asset.get("title"), asset.get("display_artist")) if x)
    original = meta.get("original_sound_info")
    if isinstance(original, dict) and original.get("original_audio_title"):
        return str(original["original_audio_title"])
    return None


def media_from_node(node):
    """The facts an Instagram media node carries for a signed out visitor, or None when it is not a media node."""
    code = node.get("code")
    if not isinstance(code, str) or not MEDIA_CODE.match(code):
        return None
    if not ("media_type" in node or "product_type" in node or "like_count" in node or "play_count" in node):
        return None
    caption = node.get("caption")
    text = caption.get("text") if isinstance(caption, dict) else None
    user = node.get("user") if isinstance(node.get("user"), dict) else {}
    owner = node.get("owner") if isinstance(node.get("owner"), dict) else {}
    taken = count_or_none(node.get("taken_at"))
    date = None
    if taken:
        try:
            date = datetime.fromtimestamp(taken, tz=timezone.utc).strftime("%Y-%m-%d")
        except Exception:  # noqa: BLE001
            date = None
    date = date or date_from_accessibility(node.get("accessibility_caption"))
    disabled = bool(node.get("like_and_view_counts_disabled"))
    media_type = node.get("media_type")
    product = node.get("product_type")
    duration = node.get("video_duration")
    plays = node.get("play_count") if node.get("play_count") is not None else node.get("view_count")
    if product == "clips":
        kind = "reel"
    elif media_type == 2:
        kind = "video"
    elif media_type == 8:
        kind = "carousel"
    elif media_type == 1:
        kind = "image"
    else:
        kind = None
    return {
        "code": code,
        "kind": kind,
        "owner": user.get("username") or owner.get("username"),
        "caption": text if isinstance(text, str) else None,
        "date": date,
        "takenAt": taken,
        "likes": None if disabled else count_or_none(node.get("like_count")),
        "comments": count_or_none(node.get("comment_count")),
        "views": count_or_none(plays),
        "durationS": round(float(duration), 2) if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration >= 0 else None,
        "videoUrl": first_video_url(node),
        "sound": sound_of(node),
    }


def merge_media(into, extra):
    """Fill the gaps of `into` with what `extra` knows about the same post."""
    for key, value in extra.items():
        if into.get(key) is None and value is not None:
            into[key] = value


def profile_picture_of(node):
    """The account's profile picture address as the page embeds it (the larger one when it lists both), or None."""
    hd = node.get("hd_profile_pic_url_info")
    if isinstance(hd, dict) and isinstance(hd.get("url"), str) and hd["url"].startswith("http"):
        return hd["url"]
    for key in ("profile_pic_url_hd", "profile_pic_url"):
        value = node.get(key)
        if isinstance(value, str) and value.startswith("http"):
            return value
    return None


def user_from_node(node):
    if count_or_none(node.get("follower_count")) is None or not ("biography" in node or "full_name" in node):
        return None
    return {
        "username": node.get("username") if isinstance(node.get("username"), str) else None,
        "fullName": node.get("full_name") if isinstance(node.get("full_name"), str) else None,
        "biography": node.get("biography") if isinstance(node.get("biography"), str) else None,
        "verified": node.get("is_verified") if isinstance(node.get("is_verified"), bool) else None,
        "followers": count_or_none(node.get("follower_count")),
        "following": count_or_none(node.get("following_count")),
        "posts": count_or_none(node.get("media_count")),
        "profilePicUrl": profile_picture_of(node),
    }


def comment_from_node(node):
    """One top level comment as the post page embeds it (typename XIGComment), or None."""
    if node.get("__typename") != "XIGComment" or not isinstance(node.get("text"), str):
        return None
    if node.get("parent_comment_id"):
        return None
    user = node.get("user") if isinstance(node.get("user"), dict) else {}
    return {
        "id": str(node.get("pk") or node.get("id") or ""),
        "username": user.get("username") if isinstance(user.get("username"), str) else None,
        "text": node["text"],
        "likes": count_or_none(node.get("comment_like_count")),
        "replies": count_or_none(node.get("child_comment_count")),
        "createdAt": count_or_none(node.get("created_at")),
    }


def instagram_facts(html):
    """What an Instagram page embeds for a signed out visitor: the account and its posts, in page order.

    Instagram ships its page data as JSON inside <script type="application/json" data-sjs> blocks. A profile carries
    the account (exact follower count, bio) and its first dozen posts; a post page carries that post with its likes,
    comments, date, caption and video address; a /popular/<topic>/ page carries reels with play counts.
    Never raises: an unreadable page gives {"user": None, "media": []}.
    """
    user = None
    media = {}
    order = []
    comments = {}
    for block in SJS_BLOCK.finditer(html or ""):
        raw = block.group(1)
        if '"code"' not in raw and '"follower_count"' not in raw and "XIGComment" not in raw:
            continue
        try:
            document = json.loads(raw)
        except Exception:  # noqa: BLE001
            continue
        for node in iter_dicts(document):
            if user is None:
                user = user_from_node(node)
            comment = comment_from_node(node)
            if comment is not None:
                comments.setdefault(comment["id"] or "%d" % len(comments), comment)
                continue
            found = media_from_node(node)
            if found is None:
                continue
            existing = media.get(found["code"])
            if existing is None:
                media[found["code"]] = found
                order.append(found["code"])
            else:
                merge_media(existing, found)
    facts = {"user": user, "media": [media[code] for code in order[:INSTAGRAM_MEDIA_CAP]]}
    if comments:
        # The first comments of a post, newest first, which a signed out visitor gets embedded in the post page
        # (photo posts and carousels included). The key is left out when there are none.
        facts["comments"] = list(comments.values())[:INSTAGRAM_COMMENT_CAP]
    return facts


def op_instagram_page(url):
    """One plain request in Chrome's clothes (curl_cffi), no browser: what Instagram answers a signed out visitor.

    No second attempt and no browser launch after a refusal: a 429 or a bot check is reported as it is.
    """
    from scrapling.fetchers import Fetcher

    response = Fetcher.get(url, impersonate="chrome", timeout=max(3, min(12, remaining_ms() // 1000)), retries=1, follow_redirects=True)
    code = status_of(response)
    html = body_text(response)
    if code == 404:
        return {"status": "not_found", "detail": "Instagram says that page does not exist."}
    if code == 429:
        return {"status": "rate_limited", "detail": "Instagram asked automated readers to slow down."}
    if code in (401, 403) or (CHALLENGE_PATTERN.search(html[:6000]) and len(html) < 8000):
        return {"status": "blocked", "detail": "Instagram answered with a bot check."}
    result = page_result(response, "fetcher")
    if "/accounts/login" in result["finalUrl"]:
        return {"status": "login_required", "detail": "Instagram sent the reader to its sign-in page."}
    result["meta"] = meta_tags(html)
    result["instagram"] = instagram_facts(html)
    facts = result["instagram"]
    if not facts["user"] and not facts["media"] and not result["meta"].get("og:description") and not result["meta"].get("description"):
        return {"status": "login_required", "detail": "Instagram showed its sign-in page instead of the content."}
    return {"status": "ok", **result}


JSON_LD_BLOCK = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>', re.I)
JSON_LD_CAP = 10
# Sign-in walls a rendered page shows instead of its content (Facebook is the one that does it to a signed out visitor).
RENDER_LOGIN_PATTERN = re.compile(r"log into facebook|log in to facebook|create new account|see more on facebook", re.I)
# How long a rendered read waits after the page loaded, so a single page app can draw its content.
RENDER_SETTLE_MS = 2500


def extract_json_ld(html):
    """The page's JSON-LD blocks, parsed, at most JSON_LD_CAP of them. A block that does not parse is skipped."""
    blocks = []
    for match in JSON_LD_BLOCK.finditer(html or ""):
        raw = match.group(1).strip()
        if not raw:
            continue
        try:
            blocks.append(json.loads(raw))
        except Exception:  # noqa: BLE001
            continue
        if len(blocks) >= JSON_LD_CAP:
            break
    return blocks


def finish_page(response, method, request):
    """The page result for a response, or the status that explains why there is none."""
    text = text_of(response)
    if looks_blocked(response, text):
        return {"status": "blocked", "detail": "The site still answered with a bot check."}
    if not text.strip():
        return {"status": "empty", "detail": "The page had nothing to read."}
    result = page_result(response, method)
    if is_js_shell(result):
        return {"status": "empty", "detail": SHELL_DETAIL}
    if method == "render" and len(text) < 3000 and RENDER_LOGIN_PATTERN.search(text):
        return {"status": "login_required", "detail": "The page asked for a sign in."}
    html = body_text(response)
    result["meta"] = meta_tags(html)
    if request.get("extract") == "json_ld":
        result["json_ld"] = extract_json_ld(html)
    return {"status": "ok", **result}


def op_page(request):
    """One page. A plain request in Chrome's clothes first; a browser only when that is refused, or when the caller
    asks for a render (`render: true`, for a page whose content is drawn by JavaScript and so came back empty)."""
    url = safe_http_url(request.get("url"))
    if not url:
        return {"status": "error", "detail": "That address cannot be read."}
    if is_instagram_url(url):
        return op_instagram_page(url)
    render = bool(request.get("render"))
    if not render:
        from scrapling.fetchers import Fetcher

        try:
            response = Fetcher.get(url, impersonate="chrome", timeout=max(3, min(10, remaining_ms() // 1000)), retries=1, follow_redirects=True)
            text = text_of(response)
            if not looks_blocked(response, text):
                return finish_page(response, "fetcher", request)
        except Exception:  # noqa: BLE001 - a failed plain read goes to the one stealth attempt
            pass
    options = {"solve_cloudflare": True, "network_idle": False, "timeout": remaining_ms()}
    if render:
        options["wait"] = RENDER_SETTLE_MS
    response = stealth_fetch(url, **options)
    return finish_page(response, "render" if render else "stealth", request)


OPERATIONS = {
    "tiktok_profile": op_tiktok_profile,
    "tiktok_top_ads": op_tiktok_top_ads,
    "meta_ad_library": op_meta_ad_library,
    "page": op_page,
}


def main():
    global _deadline_s
    configure_output()
    try:
        raw = sys.stdin.read()
        request = json.loads(raw) if raw.strip() else {}
        if not isinstance(request, dict):
            raise ValueError("request")
    except Exception:  # noqa: BLE001
        emit({"status": "error", "detail": "The request was not valid JSON."})
        return 0
    operation = OPERATIONS.get(str(request.get("op") or ""))
    if operation is None:
        emit({"status": "error", "detail": "Unknown operation."})
        return 0
    try:
        timeout_ms = int(request.get("timeout_ms") or DEFAULT_TIMEOUT_MS)
    except (TypeError, ValueError):
        timeout_ms = DEFAULT_TIMEOUT_MS
    _deadline_s = max(2.0, timeout_ms / 1000.0 - DEADLINE_MARGIN_S)
    try:
        import scrapling  # noqa: F401
    except Exception:  # noqa: BLE001
        emit({"status": "not_installed", "detail": "Scrapling is not installed."})
        return 0
    timer = start_watchdog(_deadline_s)
    try:
        result = operation(request)
    except Exception as error:  # noqa: BLE001
        status, detail = classify(error)
        result = {"status": status, "detail": detail}
    timer.cancel()
    emit(result)
    return 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.exit(code)
