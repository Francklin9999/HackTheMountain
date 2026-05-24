"""Bulk-download French-Canadian audio from Internet Archive."""
import argparse
import json
import logging
import re
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR   = Path(__file__).resolve().parent.parent
DATA_DIR   = BASE_DIR / "data"
AUDIO_DIR  = BASE_DIR / "static" / "audio"

SEARCH_URL = "https://archive.org/advancedsearch.php"
META_URL   = "https://archive.org/metadata/{ident}/files"
DL_URL     = "https://archive.org/download/{ident}/{file}"

MAX_DURATION_S = 420  # 7 minutes max

BROAD_QUERIES = [
    'subject:"French-Canadian" AND mediatype:audio',
    'collection:78rpm AND subject:"French Canadian"',
    'collection:78rpm AND subject:"Quebec" AND mediatype:audio',
    'collection:78rpm AND subject:"fiddle" AND mediatype:audio',
    'collection:78rpm AND subject:"folk" AND mediatype:audio',
    'subject:"Quebec" AND subject:"folk" AND mediatype:audio',
    'subject:"French Canadian folk" AND mediatype:audio',
    'subject:"Canadian folk music" AND mediatype:audio',
    'subject:"folk music" AND subject:"Canada" AND mediatype:audio',
    'subject:"fiddle" AND subject:"Canada" AND mediatype:audio',
    'subject:"reel" AND subject:"Quebec" AND mediatype:audio',
    'subject:"chanson" AND subject:"Quebec" AND mediatype:audio',
    'subject:"traditional music" AND subject:"Canada" AND mediatype:audio',
    'subject:"Canadian music" AND subject:"folk" AND mediatype:audio',
    'collection:folkways AND subject:"Canada" AND mediatype:audio',
    'subject:"accordion" AND subject:"Canadian" AND mediatype:audio',
    'subject:"harmonica" AND subject:"Canadian" AND mediatype:audio',
    'subject:"musique traditionnelle" AND mediatype:audio',
    'subject:"musique folk" AND mediatype:audio',
    'subject:"Québec" AND mediatype:audio',
]

_client = httpx.Client(
    timeout=30,
    headers={"User-Agent": "SillonArchive/1.0"},
    limits=httpx.Limits(max_connections=64, max_keepalive_connections=32),
    follow_redirects=True,
)
_lock = threading.Lock()


def search_identifiers(query: str, rows: int = 100) -> list[dict]:
    try:
        r = _client.get(
            SEARCH_URL,
            params={
                "q": query,
                "output": "json",
                "rows": rows,
                "fl[]": "identifier,title,creator,year",
            },
            timeout=20,
        )
        r.raise_for_status()
        return r.json().get("response", {}).get("docs", [])
    except Exception as exc:
        logger.warning("Search failed (%s): %s", query[:50], exc)
        return []


def fetch_files(ident: str) -> list[dict]:
    try:
        r = _client.get(META_URL.format(ident=ident), timeout=20)
        r.raise_for_status()
        return r.json().get("result", [])
    except Exception:
        return []


def download_file(ident: str, fname: str, out_path: Path) -> bool:
    if out_path.exists() and out_path.stat().st_size > 10_000:
        return True
    url = DL_URL.format(ident=ident, file=urllib.parse.quote(fname))
    try:
        with _client.stream("GET", url, timeout=120) as r:
            r.raise_for_status()
            out_path.write_bytes(r.read())
        kb = out_path.stat().st_size // 1024
        with _lock:
            logger.info("  ↓ %s (%d KB)", out_path.name[:60], kb)
        return True
    except Exception as exc:
        logger.warning("  ✗ %s: %s", fname[:40], exc)
        out_path.unlink(missing_ok=True)
        return False


def _parse_duration(raw) -> float:
    if not raw:
        return 0.0
    s = str(raw).strip()
    if ":" in s:
        parts = s.split(":")
        try:
            if len(parts) == 2:
                return int(parts[0]) * 60 + float(parts[1])
            if len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        except ValueError:
            return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def ident_to_candidates(ident: str, doc: dict) -> list[dict]:
    """Given an Archive.org identifier, return candidate dicts for each valid MP3."""
    files = fetch_files(ident)
    mp3s = [
        f for f in files
        if f.get("name", "").lower().endswith(".mp3")
        and 20 < _parse_duration(f.get("length")) < MAX_DURATION_S
    ]
    results = []
    for f in mp3s:
        results.append({
            "ident": ident,
            "title": doc.get("title", ident),
            "creator": doc.get("creator", ""),
            "year": doc.get("year", ""),
            "fname": f["name"],
            "duration": int(_parse_duration(f.get("length")) or 180),
        })
    return results


def collect_broad_candidates(per_query: int, workers: int) -> list[dict]:
    """Run all broad queries and return deduplicated candidates."""
    seen_idents: set[str] = set()
    candidates: list[dict] = []
    seen_lock = threading.Lock()

    def _search_query(q: str) -> list[dict]:
        docs = search_identifiers(q, rows=per_query)
        with _lock:
            logger.info("  Broad '%s…' → %d items", q[:50], len(docs))
        found = []
        for doc in docs:
            ident = doc.get("identifier", "")
            if not ident:
                continue
            with seen_lock:
                if ident in seen_idents:
                    continue
                seen_idents.add(ident)
            found.extend(ident_to_candidates(ident, doc))
        return found

    logger.info("Running %d broad queries with %d workers…", len(BROAD_QUERIES), workers)
    with ThreadPoolExecutor(max_workers=min(workers, len(BROAD_QUERIES))) as pool:
        futures = [pool.submit(_search_query, q) for q in BROAD_QUERIES]
        for fut in as_completed(futures):
            candidates.extend(fut.result())

    return candidates


def collect_artist_candidates(artists: list[dict], workers: int) -> list[dict]:
    """Search Archive.org for each artist by name and return candidates."""
    seen_idents: set[str] = set()
    seen_lock = threading.Lock()
    candidates: list[dict] = []
    counter = {"n": 0}

    def _search_artist(artist: dict) -> list[dict]:
        name = artist["name"]
        found = []
        for q in [
            f'creator:"{name}" AND mediatype:audio',
            f'"{name}" AND mediatype:audio',
            f'subject:"{name}" AND mediatype:audio',
        ]:
            docs = search_identifiers(q, rows=10)
            for doc in docs:
                ident = doc.get("identifier", "")
                if not ident:
                    continue
                with seen_lock:
                    if ident in seen_idents:
                        continue
                    seen_idents.add(ident)
                found.extend(ident_to_candidates(ident, doc))
        with _lock:
            counter["n"] += 1
            if counter["n"] % 20 == 0:
                logger.info("  Artist searches: %d/%d done, %d candidates so far",
                            counter["n"], len(artists), len(candidates) + len(found))
        return found

    logger.info("Searching %d artists in parallel with %d workers…", len(artists), workers)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_search_artist, a) for a in artists]
        for fut in as_completed(futures):
            candidates.extend(fut.result())

    return candidates


def download_candidates(candidates: list[dict], limit: int, workers: int,
                        existing_names: set[str]) -> list[dict]:
    """Download up to `limit` new files; skip already-existing ones."""
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    seen: set[tuple] = set()
    unique = []
    for c in candidates:
        key = (c["ident"], c["fname"])
        if key not in seen:
            seen.add(key)
            unique.append(c)

    logger.info("Unique candidate tracks: %d, downloading up to %d", len(unique), limit)

    to_dl = []
    for c in unique:
        safe = re.sub(r"[^a-zA-Z0-9._-]", "_", c["fname"])
        name = f"ia__{c['ident']}__{safe}"
        if name not in existing_names:
            to_dl.append({**c, "safe_name": name})
        if len(to_dl) >= limit:
            break

    results: list[dict] = []
    dl_lock = threading.Lock()

    def _dl(cand: dict) -> dict | None:
        out_path = AUDIO_DIR / cand["safe_name"]
        if download_file(cand["ident"], cand["fname"], out_path):
            with dl_lock:
                n = len(results) + 1
                logger.info("[%d/%d] %s", n, len(to_dl), cand["safe_name"][:50])
            return {**cand, "out_path": str(out_path)}
        return None

    logger.info("Downloading %d files with %d workers…", len(to_dl), workers)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_dl, c): c for c in to_dl}
        for fut in as_completed(futures):
            res = fut.result()
            if res:
                results.append(res)
    return results


def assign_to_artists(artists: list[dict], downloaded: list[dict]) -> tuple[list[dict], int]:
    """Assign newly downloaded tracks to artists that have no real audio file."""
    def _has_real_audio(artist: dict) -> bool:
        for t in artist.get("tracks", []):
            url = t.get("audio_url", "")
            fname = url.removeprefix("/api/audio/")
            if (AUDIO_DIR / fname).exists():
                return True
        return False

    needs_audio = [a for a in artists if not _has_real_audio(a)]
    logger.info("%d artists need audio, %d new files available", len(needs_audio), len(downloaded))

    pool = list(downloaded)
    if not pool:
        return artists, 0

    assigned = 0
    for i, artist in enumerate(needs_audio):
        cand = pool[i % len(pool)]
        year_raw = cand.get("year", "")
        try:
            year = int(str(year_raw).strip()[:4])
        except (ValueError, TypeError):
            year = min((artist.get("born") or 1900) + 25, 1975)
        year = min(max(year, 1880), 1990)

        title = (cand.get("title") or cand["fname"].rsplit(".", 1)[0]).replace("_", " ")[:80]
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        track_id = f"{artist['id']}-{slug[:28]}"
        audio_url = f"/api/audio/{cand['safe_name']}"

        artist["tracks"] = [{
            "id": track_id,
            "title": title,
            "year": year,
            "audio_url": audio_url,
            "duration_s": cand["duration"],
        }]
        assigned += 1

    return artists, assigned


def rebuild_corpus_meta(artists: list[dict]) -> None:
    corpus: dict = {}
    idx = 0
    for artist in artists:
        for track in artist.get("tracks", []):
            corpus[str(idx)] = {
                "artist_id": artist["id"],
                "track_id":  track["id"],
                "title":     track["title"],
                "year":      track["year"],
                "audio_url": track["audio_url"],
            }
            idx += 1
    corpus_path = DATA_DIR / "corpus_meta.json"
    with open(corpus_path, "w", encoding="utf-8") as f:
        json.dump(corpus, f, ensure_ascii=False, indent=2)
    logger.info("corpus_meta.json → %d entries", len(corpus))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit",     type=int, default=600, help="Max NEW files to download")
    parser.add_argument("--workers",   type=int, default=16,  help="Parallel threads")
    parser.add_argument("--per-query", type=int, default=100, help="Items per broad search query")
    parser.add_argument("--artists-file", default="data/artists_backup.json")
    parser.add_argument("--skip-artist-search", action="store_true",
                        help="Skip per-artist searches (faster, fewer results)")
    args = parser.parse_args()

    artists_path = BASE_DIR / args.artists_file
    with open(artists_path, encoding="utf-8") as f:
        artists = json.load(f)
    logger.info("Loaded %d artists", len(artists))

    existing_names = {p.name for p in AUDIO_DIR.glob("*.mp3")}
    logger.info("Existing audio files: %d", len(existing_names))

    logger.info("=== Phase 1: Broad collection searches ===")
    broad_candidates = collect_broad_candidates(per_query=args.per_query, workers=args.workers)
    logger.info("Broad search candidates: %d", len(broad_candidates))

    artist_candidates: list[dict] = []
    if not args.skip_artist_search:
        logger.info("=== Phase 2: Per-artist targeted searches ===")
        artist_candidates = collect_artist_candidates(artists, workers=args.workers)
        logger.info("Artist search candidates: %d", len(artist_candidates))

    all_candidates = broad_candidates + artist_candidates
    logger.info("Total candidates (before dedup): %d", len(all_candidates))

    logger.info("=== Phase 3: Downloading ===")
    downloaded = download_candidates(all_candidates, limit=args.limit, workers=args.workers,
                                     existing_names=existing_names)
    logger.info("Successfully downloaded: %d new files", len(downloaded))

    if downloaded:
        artists, assigned = assign_to_artists(artists, downloaded)
        logger.info("Assigned audio to %d artists", assigned)

        with open(artists_path, "w", encoding="utf-8") as f:
            json.dump(artists, f, ensure_ascii=False, indent=2)
        logger.info("Saved → %s", artists_path)

        rebuild_corpus_meta(artists)
    else:
        logger.warning("No new files downloaded.")

    total_audio = len(list(AUDIO_DIR.glob("*.mp3")))
    logger.info("Total audio files on disk: %d", total_audio)
    logger.info("Done. Run embed_corpus.py next to rebuild corpus.faiss.")


if __name__ == "__main__":
    main()
