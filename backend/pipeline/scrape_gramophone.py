"""Scrape Virtual Gramophone for artist bios and photos."""
import json
import logging
import time
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

BASE_DIR = Path(__file__).resolve().parent.parent
PHOTOS_DIR = BASE_DIR / "static" / "photos"
DATA_DIR = BASE_DIR / "data"

ARTISTS = {
    "joseph-allard": {
        "name": "Joseph Allard",
        "search": "Joseph Allard fiddle",
        "gramophone_id": "allard",
    },
    "la-bolduc": {
        "name": "La Bolduc",
        "search": "La Bolduc Mary Travers",
        "gramophone_id": "bolduc",
    },
    "jean-carignan": {
        "name": "Jean Carignan",
        "search": "Jean Carignan fiddle",
        "gramophone_id": "carignan",
    },
    "ovila-legare": {
        "name": "Ovila Légaré",
        "search": "Ovila Legare",
        "gramophone_id": "legare",
    },
}

GRAMOPHONE_SEARCH = "https://www.bac-lac.gc.ca/eng/discover/films-videos-sound-recordings/virtual-gramophone/Pages/virtual-gramophone.aspx"


def fetch_bio_from_wikipedia(name: str) -> str:
    """Fallback: fetch first paragraph from Wikipedia."""
    try:
        import urllib.parse
        title = urllib.parse.quote(name.replace(" ", "_"))
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
        r = httpx.get(url, timeout=15)
        r.raise_for_status()
        data = r.json()
        return data.get("extract", "")
    except Exception as exc:
        logger.warning("Wikipedia fetch failed for %s: %s", name, exc)
        return ""


def download_photo(url: str, out_path: Path) -> bool:
    if out_path.exists():
        return True
    try:
        r = httpx.get(url, timeout=20, follow_redirects=True)
        r.raise_for_status()
        out_path.write_bytes(r.content)
        logger.info("Downloaded photo: %s", out_path.name)
        return True
    except Exception as exc:
        logger.warning("Photo download failed %s: %s", url, exc)
        return False


def main():
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    bios = {}
    for artist_id, info in ARTISTS.items():
        logger.info("Processing %s …", info["name"])
        bio = fetch_bio_from_wikipedia(info["name"])
        bios[artist_id] = {
            "name": info["name"],
            "bio": bio or f"Quebec musician {info['name']}, active in the early 20th century.",
            "photo_file": f"{info['gramophone_id']}.jpg",
        }
        time.sleep(1)

    out = DATA_DIR / "gramophone_bios.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(bios, f, ensure_ascii=False, indent=2)
    logger.info("Wrote %s", out)


if __name__ == "__main__":
    main()
