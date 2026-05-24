from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

import numpy as np

from app.config import DISPLAY_CONFIDENCE_BIAS, TRACK_FEATURE_CACHE_PATH

logger = logging.getLogger(__name__)

_KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Disk-backed cache: track_id -> feature dict.
_track_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()

_UNKNOWN = {"key": "unknown", "key_root": -1, "mode": "unknown", "bpm": 0.0, "contour": "unknown"}


try:
    import librosa as _librosa
    _librosa_ok = True
except ImportError:
    _librosa_ok = False
    logger.warning("librosa not available — feature extraction disabled.")



def load_track_feature_cache() -> int:
    """Load the on-disk feature cache into memory. Returns number of entries loaded."""
    global _track_cache
    if not TRACK_FEATURE_CACHE_PATH.exists():
        logger.info("No track feature cache on disk yet.")
        return 0
    try:
        with open(TRACK_FEATURE_CACHE_PATH) as f:
            data = json.load(f)
        with _cache_lock:
            _track_cache.update(data)
        logger.info("Track feature cache loaded: %d entries.", len(data))
        return len(data)
    except Exception as exc:
        logger.warning("Could not load track feature cache: %s", exc)
        return 0


def _save_cache_unlocked() -> None:
    try:
        TRACK_FEATURE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(TRACK_FEATURE_CACHE_PATH, "w") as f:
            json.dump(_track_cache, f)
    except Exception as exc:
        logger.warning("Could not save track feature cache: %s", exc)



def extract(wav_path: str) -> dict:
    if not _librosa_ok:
        return dict(_UNKNOWN)
    try:
        y, sr = _librosa.load(wav_path, sr=22050, mono=True)

        chroma = _librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_mean = chroma.mean(axis=1)
        key_idx = int(np.argmax(chroma_mean))

        major_template = np.array([1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], dtype=float)
        minor_template = np.array([1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0], dtype=float)

        def score_template(template, root):
            return float(np.dot(chroma_mean, np.roll(template, root)))

        mode = "major" if score_template(major_template, key_idx) >= score_template(minor_template, key_idx) else "minor"
        key_str = f"{_KEY_NAMES[key_idx]} {mode}"

        tempo, _ = _librosa.beat.beat_track(y=y, sr=sr)
        bpm = round(float(np.atleast_1d(tempo)[0]), 1)

        f0, voiced_flag, _ = _librosa.pyin(y, fmin=80, fmax=1000, sr=sr)
        voiced = f0[voiced_flag] if voiced_flag is not None else np.array([])
        if len(voiced) > 1:
            delta = voiced[-1] - voiced[0]
            contour = "ascending" if delta > 20 else "descending" if delta < -20 else "flat"
        else:
            contour = "flat"

        return {"key": key_str, "key_root": key_idx, "mode": mode, "bpm": bpm, "contour": contour}
    except Exception as exc:
        logger.warning("features.extract() failed: %s", exc)
        return dict(_UNKNOWN)


def get_track_features(track_id: str, audio_path: str | None) -> dict:
    """Return cached features for a track, computing and caching on miss."""
    with _cache_lock:
        if track_id in _track_cache:
            return _track_cache[track_id]

    if not audio_path:
        return dict(_UNKNOWN)

    feats = extract(audio_path)

    with _cache_lock:
        _track_cache[track_id] = feats
        # Periodically save — every 50 new entries to avoid thrashing
        if len(_track_cache) % 50 == 0:
            _save_cache_unlocked()

    return feats



def warm_all_tracks(corpus_meta: dict, get_artist_fn, static_audio_dir) -> None:
    audio_dir = Path(static_audio_dir)

    total = len(corpus_meta)
    computed = 0
    skipped = 0

    logger.info("Feature warmup started: %d corpus entries.", total)

    for entry in corpus_meta.values():
        artist_id = entry.get("artist_id", "")
        track_id = entry.get("track_id", "")
        if not track_id:
            continue

        with _cache_lock:
            if track_id in _track_cache:
                skipped += 1
                continue

        doc = get_artist_fn(artist_id)
        if not doc:
            continue

        track_doc = next((t for t in doc.get("tracks", []) if t["id"] == track_id), None)
        if not track_doc:
            continue

        audio_url = track_doc.get("audio_url", "")
        if not audio_url.startswith("/api/audio/"):
            continue

        fname = audio_url.removeprefix("/api/audio/")
        path = audio_dir / fname
        if not path.exists():
            continue

        feats = extract(str(path))
        with _cache_lock:
            _track_cache[track_id] = feats
        computed += 1

    with _cache_lock:
        _save_cache_unlocked()

    logger.info(
        "Feature warmup complete: %d computed, %d already cached, %d total on disk.",
        computed, skipped, len(_track_cache),
    )



def shared_features(input_feats: dict, track_feats: dict) -> list[str]:
    feats: list[str] = []

    in_key = input_feats.get("key", "")
    tr_key = track_feats.get("key", "")
    if in_key and tr_key and in_key != "unknown":
        in_mode = "minor" if "minor" in in_key else "major" if "major" in in_key else ""
        tr_mode = "minor" if "minor" in tr_key else "major" if "major" in tr_key else ""
        if in_mode and in_mode == tr_mode:
            feats.append(f"{in_mode} key")

    in_bpm = input_feats.get("bpm", 0)
    tr_bpm = track_feats.get("bpm", 0)
    if in_bpm and tr_bpm:
        ratio = in_bpm / tr_bpm if tr_bpm else 0
        if 0.85 <= ratio <= 1.15:
            feats.append("similar tempo")
        elif 0.42 <= ratio <= 0.58:
            feats.append("half-time feel")
        elif 1.85 <= ratio <= 2.15:
            feats.append("double-time feel")
        feats.append("slow tempo" if in_bpm < 90 else "moderate tempo" if in_bpm < 140 else "fast tempo")

    in_cont = input_feats.get("contour", "")
    tr_cont = track_feats.get("contour", "")
    if in_cont and tr_cont and in_cont == tr_cont and in_cont != "unknown":
        feats.append(f"{in_cont} contour")

    return feats or ["melodic phrase"]


def _key_score(input_feats: dict, track_feats: dict) -> float:
    in_root = input_feats.get("key_root", -1)
    tr_root = track_feats.get("key_root", -1)
    in_mode = input_feats.get("mode", "")
    tr_mode = track_feats.get("mode", "")
    if in_root < 0 or tr_root < 0:
        return 0.6
    diff = abs(in_root - tr_root) % 12
    fifths_dist = min(diff, 12 - diff)
    root_score = max(0.0, 1.0 - (fifths_dist / 6.0) * 0.7)
    mode_bonus = 0.15 if in_mode == tr_mode and in_mode in ("major", "minor") else 0.0
    return min(1.0, root_score + mode_bonus)


def _tempo_score(input_feats: dict, track_feats: dict) -> float:
    in_bpm = float(input_feats.get("bpm", 0) or 0)
    tr_bpm = float(track_feats.get("bpm", 0) or 0)
    if in_bpm <= 0 or tr_bpm <= 0:
        return 0.5
    ratios = [in_bpm / tr_bpm, (in_bpm * 2) / tr_bpm, in_bpm / (tr_bpm * 2)]
    best = min(ratios, key=lambda r: abs(r - 1.0))
    return max(0.0, min(1.0, 1.0 - abs(best - 1.0) * 2.0))


def _contour_score(input_feats: dict, track_feats: dict) -> float:
    in_c = input_feats.get("contour", "")
    tr_c = track_feats.get("contour", "")
    if not in_c or not tr_c or in_c == "unknown" or tr_c == "unknown":
        return 0.5
    if in_c == tr_c:
        return 0.95
    if "flat" in (in_c, tr_c):
        return 0.6
    return 0.35


def _clamp_score(value: float) -> float:
    return max(0.0, min(1.0, value))


def _boost_display_confidence(score: float) -> float:
    raw = _clamp_score(score)
    return _clamp_score(raw + DISPLAY_CONFIDENCE_BIAS * (1.0 - raw))


def weighted_match_score(embed_cosine: float | None, input_feats: dict, track_feats: dict) -> dict:
    key_s = _key_score(input_feats, track_feats)
    tempo_s = _tempo_score(input_feats, track_feats)
    contour_s = _contour_score(input_feats, track_feats)
    if embed_cosine is None:
        vibe = 0.45 * key_s + 0.30 * tempo_s + 0.25 * contour_s
        overall = 0.45 * key_s + 0.30 * tempo_s + 0.25 * contour_s
    else:
        vibe = _clamp_score(float(embed_cosine))
        overall = 0.50 * vibe + 0.20 * key_s + 0.15 * tempo_s + 0.15 * contour_s

    return {
        "score": round(_boost_display_confidence(overall), 4),
        "raw_score": round(_clamp_score(overall), 4),
        "breakdown": {
            "vibe": round(_boost_display_confidence(vibe), 4),
            "key": round(_boost_display_confidence(key_s), 4),
            "tempo": round(_boost_display_confidence(tempo_s), 4),
            "contour": round(_boost_display_confidence(contour_s), 4),
        },
    }
