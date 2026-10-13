"""Local speech to text for media_transcribe: faster-whisper on the CPU, no account, no paid service.

Reads ONE JSON request on stdin and prints ONE JSON result on stdout, in UTF-8 whatever the console code page is.

Request:  {"path": "...", "model": "small", "language": "en"|null, "allow_download": false}
Result:   {"status": "ok|no_speech|model_missing|not_installed|error", "detail": "...",
           "model": "small", "language": "en", "duration_s": 12.3,
           "segments": [{"start_s": 0.0, "end_s": 3.5, "text": "..."}],
           "words": [{"start_s": 0.0, "end_s": 0.4, "text": "..."}]}

It never installs anything and never downloads a model unless the request says allow_download: a model that is not
already on this computer is reported as model_missing, with the model name, so the caller can say what to fetch.
The model runs on the CPU with int8 weights ("small", or "small.en" when the speech is English), which is what a
laptop can do in roughly a quarter of the audio's length. faster-whisper reads video files directly (it decodes the
audio track itself), so no ffmpeg step is needed here.
"""

import json
import os
import sys

WORDS_CAP = 6_000


def configure_output():
    """Read and write UTF-8 on stdin, stdout and stderr, whatever the console code page is (cp1252 on Windows when piped)."""
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001 - a stream that cannot be reconfigured stays as it is
            pass


def emit(result):
    try:
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
    except UnicodeError:
        sys.stdout.write(json.dumps(result, ensure_ascii=True))
    sys.stdout.flush()


def model_missing(error):
    """Whether the error means the model is simply not on this computer (as opposed to a real failure)."""
    name = type(error).__name__
    text = str(error).lower()
    return (
        name in ("LocalEntryNotFoundError", "OfflineModeIsEnabled")
        or "local_files_only" in text
        or "cannot find an appropriate cached snapshot" in text
        or "couldn't connect" in text
        or "outgoing traffic has been disabled" in text
    )


def main():
    configure_output()
    try:
        request = json.loads(sys.stdin.read() or "{}")
        if not isinstance(request, dict):
            raise ValueError("request")
    except Exception:  # noqa: BLE001
        emit({"status": "error", "detail": "The request was not valid JSON."})
        return 0
    path = str(request.get("path") or "")
    if not path or not os.path.isfile(path):
        emit({"status": "error", "detail": "That media file could not be found."})
        return 0
    model_name = str(request.get("model") or "small")
    language = request.get("language") or None
    allow_download = bool(request.get("allow_download", False))
    try:
        from faster_whisper import WhisperModel
    except Exception:  # noqa: BLE001
        emit({"status": "not_installed", "detail": "faster-whisper is not installed in this Python.", "model": model_name})
        return 0
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8", local_files_only=not allow_download)
    except Exception as error:  # noqa: BLE001
        if not allow_download and model_missing(error):
            emit({"status": "model_missing", "detail": "The %s speech model is not downloaded on this computer." % model_name, "model": model_name})
        else:
            emit({"status": "error", "detail": "The speech model could not be loaded: %s." % type(error).__name__, "model": model_name})
        return 0
    try:
        found, info = model.transcribe(path, language=language, vad_filter=True, word_timestamps=True)
        segments, words = [], []
        for segment in found:
            text = str(segment.text or "").strip()
            if not text:
                continue
            segments.append({"start_s": round(float(segment.start), 3), "end_s": round(float(segment.end), 3), "text": text})
            for word in getattr(segment, "words", None) or []:
                if len(words) < WORDS_CAP and str(word.word or "").strip():
                    words.append({"start_s": round(float(word.start), 3), "end_s": round(float(word.end), 3), "text": str(word.word).strip()})
    except Exception as error:  # noqa: BLE001
        emit({"status": "error", "detail": "The speech to text run failed: %s." % type(error).__name__, "model": model_name})
        return 0
    detected = getattr(info, "language", None) or language
    duration = getattr(info, "duration", None)
    if not segments:
        emit({"status": "no_speech", "detail": "No speech was found in that audio.", "model": model_name, "language": detected, "duration_s": duration})
        return 0
    emit({"status": "ok", "model": model_name, "language": detected, "duration_s": duration, "segments": segments, "words": words})
    return 0


if __name__ == "__main__":
    code = main()
    sys.stdout.flush()
    sys.exit(code)
