"""Stealth research worker, built on Scrapling: TikTok profiles, TikTok Creative Center top ads,
Meta Ad Library search and pages that answer 403 or a Cloudflare check.

Reads ONE JSON request on stdin and prints ONE JSON result on stdout. It never logs in, never
uses or stores cookies, never rotates proxies, and makes ONE request per operation. It has its
own deadline (the request's timeout_ms minus 3 s) and, when that passes, prints a timed_out
result and ends itself and the browser it started.

Request:  {"op": "tiktok_profile|tiktok_top_ads|meta_ad_library|page",
           "handle": "...", "url": "...", "query": "...", "keyword": "...", "country": "US", "period": 30,
           "limit": 20, "timeout_ms": 45000}
Result:   {"status": "ok|empty|blocked|login_required|not_installed|timed_out|error",
           "detail": "...", ...data}

Data by operation:
  tiktok_profile   profile {handle,nickname,bio,verified,followers,following,likes,videos},
                   items [{url,id,views,likes,comments,shares,createdAt,caption,durationS}]
  tiktok_top_ads   ads [{id,title,caption,brand,industry,ctr,likes,videoUrl,cover,landing,url}]
  meta_ad_library  ads [{id,pageName,startDate,text,snapshotUrl}]
  page             finalUrl, status, title, text (20k), links (200), method

Scrapling's own browser install is never run from here (the plugin installs Chromium in setup).
"""

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

DEFAULT_TIMEOUT_MS = 45_000
DEADLINE_MARGIN_S = 3.0
TEXT_CAP = 20_000
LINK_CAP = 200

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

def emit(result):
    """Print the one result and flush. Only the first call prints."""
    if not _printed.acquire(blocking=False):
        return
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
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


def op_tiktok_profile(request):
    handle = re.sub(r"[^A-Za-z0-9._]", "", str(request.get("handle") or "").lstrip("@"))
    if not handle:
        return {"status": "error", "detail": "No TikTok handle was given."}
    limit = max(1, min(int(request.get("limit") or 20), 50))
    response = stealth_fetch(
        TIKTOK_PROFILE_URL.format(handle=quote(handle)),
        capture_xhr=TIKTOK_ITEM_LIST,
        network_idle=False,
        wait=4000,
    )
    html = body_text(response)
    if looks_blocked(response, html):
        return {"status": "blocked", "detail": "TikTok answered with a bot check."}
    profile = profile_from_universal(universal_data(html))
    payloads = [p for p in (body_json(x) for x in getattr(response, "captured_xhr", []) or []) if p]
    items = items_from_item_list(payloads, handle, limit)
    if profile is None and not items:
        if LOGIN_PATTERN.search(html[:6000]):
            return {"status": "login_required", "detail": "TikTok asked for a sign in."}
        return {"status": "empty", "detail": "No profile data came back for that handle."}
    return {"status": "ok", "profile": profile or {"handle": handle}, "items": items}


# ---------------------------------------------------------------- TikTok Creative Center top ads

def ads_from_top_ads(payloads, country, limit):
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
            title = item.get("ad_title") or item.get("title") or ""
            ads.append({
                "id": ad_id,
                "title": title,
                "caption": title,
                "brand": item.get("brand_name"),
                "industry": industry if isinstance(industry, str) else None,
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


def op_tiktok_top_ads(request):
    country = re.sub(r"[^A-Za-z]", "", str(request.get("country") or "US")).upper()[:2] or "US"
    try:
        period = int(request.get("period") or 30)
    except (TypeError, ValueError):
        period = 30
    if period not in (7, 30, 180):
        period = 30
    limit = max(1, min(int(request.get("limit") or 20), 50))
    params = {"region": country, "period": period}
    keyword = str(request.get("keyword") or "").strip()[:80]
    if keyword:
        params["keyword"] = keyword
    url = f"{TOP_ADS_URL}?{urlencode(params)}"
    # network_idle=True hung this page for 8+ minutes in a live test: never use it here.
    response = stealth_fetch(url, capture_xhr=TOP_ADS_XHR, load_dom=False, wait=8000, network_idle=False)
    payloads = [p for p in (body_json(x) for x in getattr(response, "captured_xhr", []) or []) if p]
    ads = ads_from_top_ads(payloads, country, limit)
    if not ads:
        html = body_text(response)
        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
        if match:
            try:
                materials = json.loads(match.group(1))["props"]["pageProps"]["data"]["materials"]
                ads = ads_from_top_ads([{"data": {"materials": materials}}], country, limit)
            except Exception:  # noqa: BLE001
                ads = []
        if not ads:
            if looks_blocked(response, html):
                return {"status": "blocked", "detail": "TikTok Creative Center answered with a bot check."}
            return {"status": "empty", "detail": "Creative Center did not return its top ads list."}
    return {"status": "ok", "ads": ads}


# ---------------------------------------------------------------- Meta Ad Library

def text_of(response):
    try:
        return str(response.get_all_text(separator="\n", strip=True))
    except Exception:  # noqa: BLE001
        return ""


def ads_from_text(text, limit):
    """Cards in the rendered page text: each starts at 'Library ID: <digits>'."""
    ads = []
    parts = re.split(r"Library ID:?\s*", text)
    for part in parts[1:]:
        match = re.match(r"(\d{6,20})", part)
        if not match:
            continue
        ad_id = match.group(1)
        lines = [line.strip() for line in part[match.end():].split("\n") if line.strip()]
        started = None
        for line in lines[:12]:
            date = re.search(r"Started running on\s+(.+)", line, re.I)
            if date:
                started = date.group(1).strip()
                break
        page_name = None
        body = None
        for index, line in enumerate(lines[:40]):
            if line.lower() == "sponsored":
                if index + 1 < len(lines):
                    page_name = lines[index + 1]
                body_lines = []
                for follow in lines[index + 2:index + 14]:
                    if re.match(r"(Library ID|See ad details|See summary details|Platforms|Open Dropdown)", follow, re.I):
                        break
                    body_lines.append(follow)
                body = " ".join(body_lines).strip() or None
                break
        ads.append({"id": ad_id, "pageName": page_name, "startDate": started, "text": body})
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
        entry = found.setdefault(ad_id, {"id": ad_id, "pageName": None, "startDate": None, "text": None})
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


def op_page(request):
    url = safe_http_url(request.get("url"))
    if not url:
        return {"status": "error", "detail": "That address cannot be read."}
    from scrapling.fetchers import Fetcher

    try:
        response = Fetcher.get(url, impersonate="chrome", timeout=max(3, min(10, remaining_ms() // 1000)), retries=1, follow_redirects=True)
        text = text_of(response)
        if not looks_blocked(response, text):
            if not text.strip():
                return {"status": "empty", "detail": "The page had nothing to read."}
            return {"status": "ok", **page_result(response, "fetcher")}
    except Exception:  # noqa: BLE001 - a failed plain read goes to the one stealth attempt
        pass
    response = stealth_fetch(url, solve_cloudflare=True, network_idle=False, timeout=remaining_ms())
    text = text_of(response)
    if looks_blocked(response, text):
        return {"status": "blocked", "detail": "The site still answered with a bot check."}
    if not text.strip():
        return {"status": "empty", "detail": "The page had nothing to read."}
    return {"status": "ok", **page_result(response, "stealth")}


OPERATIONS = {
    "tiktok_profile": op_tiktok_profile,
    "tiktok_top_ads": op_tiktok_top_ads,
    "meta_ad_library": op_meta_ad_library,
    "page": op_page,
}


def main():
    global _deadline_s
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
