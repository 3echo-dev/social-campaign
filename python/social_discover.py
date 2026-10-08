"""Discovery worker for popular short videos: Instagram (Instaloader) and TikTok (TikTok-Api).

Reads ONE JSON request on stdin and prints ONE JSON result on stdout. It only lists
candidates (url, owner, views, likes, date, duration). Downloading and teardown stay
with yt-dlp.

Request:  {"route": "instagram_hashtag|instagram_profile|tiktok_hashtag|tiktok_trending|tiktok_user",
           "target": "<tag without #, or username>", "limit": 20, "timeout_ms": 60000,
           "credentials_path": "<path to credentials.json>"}
Result:   {"status": "ok|empty|blocked|login_required|not_installed|error", "detail": "...",
           "authenticated": false, "items": [{"url","owner","views","likes","date","durationS","caption"}]}

Credentials are optional and read here from the local credentials file (never from the request,
never printed, never returned). Shape:
  {"instagram": {"username": "...", "sessionfile": "<path to an Instaloader session file>"},
   "tiktok": {"ms_token": "..."}}
A missing, unreadable or malformed file means an anonymous run. There are no login prompts: a
session file is only loaded, never created here.
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timezone

DEFAULT_TIMEOUT_MS = 60_000


def load_credentials(path):
    """The credentials dict, or {} for anything wrong with the file. Never raises, never logs."""
    if not path:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001 - an unreadable file is an anonymous run
        return {}


def iso_date(value):
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value), tz=timezone.utc).strftime("%Y-%m-%d")
        if isinstance(value, str) and value.isdigit():
            return datetime.fromtimestamp(float(value), tz=timezone.utc).strftime("%Y-%m-%d")
        if isinstance(value, datetime):
            return value.strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return None
    return None


def to_int(value):
    try:
        number = int(value)
        return number if number >= 0 else None
    except (TypeError, ValueError):
        return None


def classify(error):
    """Map an exception to a route status without leaking its text (it may carry URLs or tokens)."""
    name = type(error).__name__
    text = str(error).lower()
    if "login" in text or name in ("LoginRequiredException", "BadCredentialsException", "TwoFactorAuthRequiredException"):
        return "login_required", "A login is needed for this."
    if name in ("TooManyRequestsException", "QueryReturnedBadRequestException", "EmptyResponseException", "CaptchaException") \
            or "429" in text or "403" in text or "rate" in text and "limit" in text or "captcha" in text or "blocked" in text:
        return "blocked", "The platform refused or rate limited an anonymous read."
    if name in ("ProfileNotExistsException", "QueryReturnedNotFoundException", "NotFoundException"):
        return "empty", "That account or hashtag was not found."
    return "error", f"{name}"


# ---------------------------------------------------------------- Instaloader


def run_instagram(route, target, limit, creds):
    try:
        import instaloader
    except ImportError:
        return {"status": "not_installed", "detail": "instaloader is not installed in the research helper environment.", "items": []}

    loader = instaloader.Instaloader(
        quiet=True,
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        max_connection_attempts=1,
        request_timeout=20,
    )
    authenticated = False
    ig = creds.get("instagram") if isinstance(creds.get("instagram"), dict) else {}
    username, sessionfile = ig.get("username"), ig.get("sessionfile")
    if isinstance(username, str) and username and isinstance(sessionfile, str) and sessionfile:
        try:
            base = os.environ.get("SOCIAL_DISCOVER_CREDENTIALS_DIR", ".")
            path = sessionfile if os.path.isabs(sessionfile) else os.path.join(base, sessionfile)
            if os.path.exists(path):
                loader.load_session_from_file(username, path)
                authenticated = True
        except Exception:  # noqa: BLE001 - a stale session is an anonymous run, never a prompt
            authenticated = False

    items = []
    try:
        if route == "instagram_hashtag":
            posts = instaloader.Hashtag.from_name(loader.context, target).get_top_posts()
        else:
            posts = instaloader.Profile.from_username(loader.context, target).get_posts()
        scanned = 0
        for post in posts:
            scanned += 1
            if scanned > limit * 6:
                break
            if not getattr(post, "is_video", False):
                continue
            shortcode = getattr(post, "shortcode", None)
            if not shortcode:
                continue
            items.append({
                "url": f"https://www.instagram.com/reel/{shortcode}/",
                "owner": getattr(post, "owner_username", None),
                "views": to_int(getattr(post, "video_view_count", None)),
                "likes": to_int(getattr(post, "likes", None)),
                "date": iso_date(getattr(post, "date_utc", None)),
                "durationS": getattr(post, "video_duration", None),
                "caption": (getattr(post, "caption", None) or "")[:200] or None,
            })
            if len(items) >= limit:
                break
    except Exception as error:  # noqa: BLE001
        status, detail = classify(error)
        if items:
            return {"status": "ok", "detail": "Partial: the read stopped early.", "authenticated": authenticated, "items": items}
        return {"status": status, "detail": detail, "authenticated": authenticated, "items": []}
    return {"status": "ok" if items else "empty", "detail": None if items else "No video posts came back.", "authenticated": authenticated, "items": items}


# ---------------------------------------------------------------- TikTok-Api


async def run_tiktok(route, target, limit, creds):
    try:
        from TikTokApi import TikTokApi
    except ImportError:
        return {"status": "not_installed", "detail": "TikTokApi is not installed in the research helper environment.", "items": []}

    tt = creds.get("tiktok") if isinstance(creds.get("tiktok"), dict) else {}
    ms_token = tt.get("ms_token") if isinstance(tt.get("ms_token"), str) and tt.get("ms_token") else None
    items = []
    try:
        async with TikTokApi() as api:
            try:
                await api.create_sessions(
                    ms_tokens=[ms_token] if ms_token else None,
                    num_sessions=1,
                    sleep_after=3,
                    browser=os.environ.get("TIKTOK_BROWSER", "chromium"),
                    headless=True,
                )
            except Exception as error:  # noqa: BLE001
                if "executable" in str(error).lower() and "exist" in str(error).lower():
                    return {"status": "not_installed", "detail": "Playwright chromium is not installed in the research helper environment (python -m playwright install chromium).", "authenticated": bool(ms_token), "items": []}
                raise
            if route == "tiktok_hashtag":
                source = api.hashtag(name=target).videos(count=limit)
            elif route == "tiktok_user":
                source = api.user(username=target).videos(count=limit)
            else:
                source = api.trending.videos(count=limit)
            async for video in source:
                data = video.as_dict if isinstance(getattr(video, "as_dict", None), dict) else {}
                stats = data.get("stats") or data.get("statsV2") or {}
                author = (data.get("author") or {})
                owner = author.get("uniqueId") if isinstance(author, dict) else None
                vid = data.get("id") or getattr(video, "id", None)
                if not vid or not owner:
                    continue
                items.append({
                    "url": f"https://www.tiktok.com/@{owner}/video/{vid}",
                    "owner": owner,
                    "views": to_int(stats.get("playCount")),
                    "likes": to_int(stats.get("diggCount")),
                    "date": iso_date(to_int(data.get("createTime"))),
                    "durationS": (data.get("video") or {}).get("duration") if isinstance(data.get("video"), dict) else None,
                    "caption": (data.get("desc") or "")[:200] or None,
                })
                if len(items) >= limit:
                    break
    except Exception as error:  # noqa: BLE001
        status, detail = classify(error)
        if items:
            return {"status": "ok", "detail": "Partial: the read stopped early.", "authenticated": bool(ms_token), "items": items}
        return {"status": status, "detail": detail, "authenticated": bool(ms_token), "items": []}
    if items:
        return {"status": "ok", "detail": None, "authenticated": bool(ms_token), "items": items}
    # TikTok answers an anonymous session with an empty list rather than an error.
    return {"status": "blocked" if not ms_token else "empty", "detail": "TikTok returned no videos" + ("; an ms_token in the credentials file usually fixes this." if not ms_token else "."), "authenticated": bool(ms_token), "items": []}


def main():
    try:
        raw = sys.stdin.read()
        request = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        json.dump({"status": "error", "detail": "invalid request json", "items": []}, sys.stdout)
        return 2

    route = request.get("route")
    target = str(request.get("target") or "").strip().lstrip("#@")
    limit = max(1, min(int(request.get("limit") or 20), 50))
    timeout_s = int(request.get("timeout_ms") or DEFAULT_TIMEOUT_MS) / 1000
    cred_path = request.get("credentials_path")
    creds = load_credentials(cred_path)
    if cred_path:
        os.environ["SOCIAL_DISCOVER_CREDENTIALS_DIR"] = os.path.dirname(os.path.abspath(cred_path))
    if not target and route != "tiktok_trending":
        json.dump({"status": "error", "detail": "no target given", "items": []}, sys.stdout)
        return 2

    try:
        if route in ("instagram_hashtag", "instagram_profile"):
            result = run_instagram(route, target, limit, creds)
        elif route in ("tiktok_hashtag", "tiktok_trending", "tiktok_user"):
            result = asyncio.run(asyncio.wait_for(run_tiktok(route, target, limit, creds), timeout=timeout_s))
        else:
            result = {"status": "error", "detail": "unknown route", "items": []}
    except asyncio.TimeoutError:
        result = {"status": "blocked", "detail": "timed out", "items": []}
    except Exception as error:  # noqa: BLE001
        status, detail = classify(error)
        result = {"status": status, "detail": detail, "items": []}
    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
