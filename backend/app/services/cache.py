from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from app.config import DEMO_CACHE_PATH

logger = logging.getLogger(__name__)

_cache: dict[str, Any] = {}


def _load() -> dict[str, Any]:
    global _cache
    if _cache:
        return _cache
    if DEMO_CACHE_PATH.exists():
        with open(DEMO_CACHE_PATH) as f:
            _cache = json.load(f)
    return _cache


def fingerprint(wav_path: str) -> str | None:
    try:
        import librosa

        y, _ = librosa.load(wav_path, sr=24000, mono=True, duration=1.0)
        return hashlib.sha256(y.tobytes()).hexdigest()
    except Exception as exc:
        logger.warning("fingerprint() failed: %s", exc)
        return None


def lookup(fp: str) -> dict | None:
    return _load().get(fp)


