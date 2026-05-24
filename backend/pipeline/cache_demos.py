"""Pre-compute and cache /api/match responses for demo hums."""
import argparse
import hashlib
import json
import logging
import sys
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

BASE_DIR = Path(__file__).resolve().parent.parent
DEMO_CACHE_PATH = BASE_DIR / "data" / "demo_cache.json"


def fingerprint(wav_path: str) -> str:
    import librosa

    y, _ = librosa.load(wav_path, sr=24000, mono=True, duration=1.0)
    return hashlib.sha256(y.tobytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hums", nargs="+", required=True)
    parser.add_argument("--backend-url", default="http://localhost:8000")
    args = parser.parse_args()

    existing: dict = {}
    if DEMO_CACHE_PATH.exists():
        with open(DEMO_CACHE_PATH) as f:
            existing = json.load(f)

    for hum_path in args.hums:
        path = Path(hum_path)
        if not path.exists():
            logger.error("File not found: %s", hum_path)
            sys.exit(1)

        fp = fingerprint(str(path))
        logger.info("Fingerprint %s → %s", path.name, fp[:16])

        with open(path, "rb") as f:
            files = {"audio": (path.name, f, "audio/wav")}
            r = httpx.post(f"{args.backend_url}/api/match", files=files, timeout=60)

        if r.status_code != 200:
            logger.error("Backend returned %d for %s", r.status_code, path.name)
            continue

        existing[fp] = r.json()
        logger.info("Cached response for %s (artist: %s)", path.name, existing[fp]["artist"]["name"])

    with open(DEMO_CACHE_PATH, "w") as f:
        json.dump(existing, f, indent=2)
    logger.info("Wrote %d cached entries to %s.", len(existing), DEMO_CACHE_PATH)


if __name__ == "__main__":
    main()
