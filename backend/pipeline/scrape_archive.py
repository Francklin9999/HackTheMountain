"""Scrape Internet Archive for French-Canadian audio MP3s."""
import argparse
import logging
import time
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

SEARCH_URL = (
    "https://archive.org/advancedsearch.php"
    "?q=subject%3A%22French-Canadian%22+AND+mediatype%3Aaudio"
    "&output=json&rows={rows}&page={page}&fl[]=identifier,title"
)
DOWNLOAD_BASE = "https://archive.org/download/{identifier}/{file}"
MAX_DURATION_S = 300  # 5 minutes


def fetch_identifiers(rows: int = 600) -> list[str]:
    ids = []
    page = 1
    while len(ids) < rows:
        url = SEARCH_URL.format(rows=min(100, rows - len(ids)), page=page)
        try:
            r = httpx.get(url, timeout=30)
            r.raise_for_status()
            docs = r.json().get("response", {}).get("docs", [])
            if not docs:
                break
            ids.extend(d["identifier"] for d in docs if "identifier" in d)
            page += 1
        except Exception as exc:
            logger.error("Search page %d failed: %s", page, exc)
            break
    return ids[:rows]


def fetch_files(identifier: str) -> list[dict]:
    url = f"https://archive.org/metadata/{identifier}/files"
    try:
        r = httpx.get(url, timeout=20)
        r.raise_for_status()
        return r.json().get("result", [])
    except Exception as exc:
        logger.warning("metadata fetch failed for %s: %s", identifier, exc)
        return []


def download(identifier: str, fname: str, out_path: Path) -> bool:
    if out_path.exists():
        logger.info("Already exists: %s", out_path.name)
        return True
    url = DOWNLOAD_BASE.format(identifier=identifier, file=fname)
    try:
        with httpx.stream("GET", url, timeout=60, follow_redirects=True) as r:
            r.raise_for_status()
            out_path.write_bytes(r.read())
        logger.info("Downloaded %s", out_path.name)
        return True
    except Exception as exc:
        logger.error("Download failed %s: %s", fname, exc)
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="static/audio/raw")
    parser.add_argument("--limit", type=int, default=300)
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    identifiers = fetch_identifiers(rows=args.limit * 2)
    logger.info("Found %d identifiers.", len(identifiers))

    downloaded = 0
    for ident in identifiers:
        if downloaded >= args.limit:
            break
        files = fetch_files(ident)
        mp3s = [f for f in files if f.get("name", "").endswith(".mp3")]
        for f in mp3s:
            if downloaded >= args.limit:
                break
            duration = float(f.get("length", 0) or 0)
            if duration > MAX_DURATION_S:
                continue
            safe_name = f["name"].replace("/", "_")
            out_path = out_dir / f"{ident}__{safe_name}"
            if download(ident, f["name"], out_path):
                downloaded += 1
            time.sleep(0.3)

    logger.info("Done. Downloaded %d files to %s.", downloaded, out_dir)


if __name__ == "__main__":
    main()
