import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


MONGODB_URI: str = os.getenv("MONGODB_URI", "")
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
CORS_ORIGINS: list[str] = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

STATIC_AUDIO_DIR = BASE_DIR / "static" / "audio"
STATIC_PHOTOS_DIR = BASE_DIR / "static" / "photos"
DATA_DIR = BASE_DIR / "data"
FAISS_INDEX_PATH = DATA_DIR / "corpus.faiss"
CORPUS_META_PATH = DATA_DIR / "corpus_meta.json"
ARTISTS_BACKUP_PATH = DATA_DIR / "artists_backup.json"
DEMO_CACHE_PATH = DATA_DIR / "demo_cache.json"
TRACK_FEATURE_CACHE_PATH = DATA_DIR / "track_features_cache.json"

MERT_MODEL_ID = "m-a-p/MERT-v1-330M"
OPENAI_MODEL_ID = "gpt-4o-mini"

LOW_SCORE_THRESHOLD = 0.3
ENABLE_DEMO_CACHE = _env_bool("ENABLE_DEMO_CACHE", False)
DISPLAY_CONFIDENCE_BIAS = max(0.0, min(0.25, float(os.getenv("DISPLAY_CONFIDENCE_BIAS", "0.06"))))
