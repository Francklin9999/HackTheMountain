"""Seed artists from Wikidata + Internet Archive audio."""
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

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
AUDIO_DIR = BASE_DIR / "static" / "audio"

WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
ARCHIVE_SEARCH = "https://archive.org/advancedsearch.php"
ARCHIVE_META   = "https://archive.org/metadata/{identifier}/files"
ARCHIVE_DL     = "https://archive.org/download/{identifier}/{file}"

FOLK_OCCUPATIONS = [
    "Q177220",  # singer
    "Q753110",  # folk singer
    "Q1075651", # folk musician
    "Q486748",  # fiddler
    "Q2252262", # accordionist
    "Q36834",   # composer
    "Q639669",  # singer-songwriter
]

SPARQL_QUERIES = [
    # Quebec-born musicians
    """SELECT DISTINCT ?person ?personLabel ?birthDate ?deathDate ?birthPlaceLabel WHERE {{
  ?person wdt:P19 ?birthPlace.
  ?birthPlace wdt:P131* wd:Q176.
  ?person wdt:P106 ?occ.
  VALUES ?occ {{ {occupations} }}
  OPTIONAL {{ ?person wdt:P569 ?birthDate. }}
  OPTIONAL {{ ?person wdt:P570 ?deathDate. }}
  OPTIONAL {{ ?person wdt:P19 ?bpl. }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,fr". }}
}} LIMIT 400""",
    # French-Canadian by citizenship + language
    """SELECT DISTINCT ?person ?personLabel ?birthDate ?deathDate WHERE {{
  ?person wdt:P27 wd:Q16.
  ?person wdt:P103 wd:Q150.
  ?person wdt:P106 ?occ.
  VALUES ?occ {{ {occupations} }}
  OPTIONAL {{ ?person wdt:P569 ?birthDate. }}
  OPTIONAL {{ ?person wdt:P570 ?deathDate. }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en,fr". }}
}} LIMIT 400""",
]

_client = httpx.Client(
    timeout=30,
    headers={"User-Agent": "SillonArchive/1.0"},
    limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
)
_print_lock = threading.Lock()


def log(msg: str):
    with _print_lock:
        logger.info(msg)


def run_sparql(query: str) -> list[dict]:
    try:
        r = _client.get(
            WIKIDATA_SPARQL,
            params={"query": query},
            headers={**_client.headers, "Accept": "application/sparql-results+json"},
            timeout=60,
        )
        r.raise_for_status()
        return r.json().get("results", {}).get("bindings", [])
    except Exception as exc:
        logger.error("SPARQL failed: %s", exc)
        return []


def get_wikipedia_bio(name: str) -> str:
    for lang in ("en", "fr"):
        try:
            slug = urllib.parse.quote(name.replace(" ", "_"))
            r = _client.get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{slug}", timeout=10)
            if r.status_code == 200:
                extract = r.json().get("extract", "").strip()
                if len(extract) > 60:
                    return extract
        except Exception:
            pass
    return ""


def extract_year(s: str | None) -> int | None:
    if not s:
        return None
    m = re.search(r"(\d{4})", s)
    return int(m.group(1)) if m else None


def slugify(name: str) -> str:
    s = name.lower()
    for chars, rep in [("àáâãä", "a"), ("èéêë", "e"), ("ìíîï", "i"), ("òóôõö", "o"), ("ùúûü", "u")]:
        for c in chars:
            s = s.replace(c, rep)
    s = s.replace("ç", "c").replace("ñ", "n").replace("'", "").replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def era_label(born: int | None, died: int | None) -> str:
    if not born:
        return "Early 20th century"
    d0 = (born // 10) * 10
    return f"{d0}s-{(died // 10) * 10}s" if died else f"{d0}s-"


def search_archive(name: str, limit: int) -> list[dict]:
    try:
        r = _client.get(
            ARCHIVE_SEARCH,
            params={
                "q": f'creator:"{name}" AND mediatype:audio',
                "output": "json",
                "rows": limit * 4,
                "fl[]": "identifier,title,year",
            },
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("response", {}).get("docs", [])[:limit]
    except Exception:
        return []


def get_archive_files(identifier: str) -> list[dict]:
    try:
        r = _client.get(ARCHIVE_META.format(identifier=identifier), timeout=15)
        r.raise_for_status()
        return r.json().get("result", [])
    except Exception:
        return []


def download_mp3(identifier: str, fname: str, out_path: Path) -> bool:
    if out_path.exists() and out_path.stat().st_size > 10_000:
        return True
    url = ARCHIVE_DL.format(identifier=identifier, file=urllib.parse.quote(fname))
    try:
        with _client.stream("GET", url, timeout=120) as r:
            r.raise_for_status()
            out_path.write_bytes(r.read())
        log(f"  ↓ {out_path.name} ({out_path.stat().st_size // 1024} KB)")
        return True
    except Exception as exc:
        logger.warning("  ✗ download failed %s: %s", fname, exc)
        out_path.unlink(missing_ok=True)
        return False



def fetch_tracks(artist_id: str, name: str, born: int | None, audio_limit: int) -> list[dict]:
    tracks = []
    items = search_archive(name, limit=audio_limit)
    for item in items:
        identifier = item.get("identifier", "")
        if not identifier:
            continue
        files = get_archive_files(identifier)
        mp3s = sorted(
            [f for f in files
             if f.get("name", "").lower().endswith(".mp3")
             and 30 < float(f.get("length", 0) or 0) < 400],
            key=lambda f: float(f.get("length", 0) or 0),
        )
        if not mp3s:
            continue
        f = mp3s[0]
        raw = f["name"]
        safe = re.sub(r"[^a-zA-Z0-9._-]", "_", raw)
        out_path = AUDIO_DIR / f"{artist_id}__{safe}"
        if download_mp3(identifier, raw, out_path):
            dur = int(float(f.get("length", 180) or 180))
            title = (item.get("title") or raw.rsplit(".", 1)[0]).replace("_", " ")[:80]
            year_raw = item.get("year", "")
            year = int(year_raw) if str(year_raw).isdigit() else min((born or 1910) + 25, 1975)
            tracks.append({
                "id": f"{artist_id}-{slugify(title)[:28]}",
                "title": title,
                "year": min(max(year, 1880), 1990),
                "audio_url": f"/api/audio/{artist_id}__{safe}",
                "duration_s": dur,
            })
            if len(tracks) >= audio_limit:
                break
    return tracks



def process_artist(row: dict, seen_ids: set, audio_limit: int, max_birth: int) -> dict | None:
    name = row.get("personLabel", {}).get("value", "")
    if not name or name.startswith("Q"):
        return None

    born  = extract_year(row.get("birthDate", {}).get("value"))
    died  = extract_year(row.get("deathDate", {}).get("value"))

    if born and born > max_birth:
        return None

    bp = row.get("birthPlaceLabel", {}).get("value", "")
    region = "Quebec" if any(k in bp for k in ("Quebec", "Québec", "Montréal", "Montreal")) else "Canada"

    artist_id = slugify(name)
    if not artist_id or artist_id in seen_ids:
        return None

    log(f"Processing {name} ({born}–{died})…")

    bio = get_wikipedia_bio(name)
    if not bio:
        bio = (f"{name} was a French-Canadian musician active in the "
               f"{era_label(born, died)} era, part of Québec's folk tradition.")

    tracks = fetch_tracks(artist_id, name, born, audio_limit)
    if not tracks:
        track_id = f"{artist_id}-folk"
        tracks = [{
            "id": track_id,
            "title": f"Traditional — {name}",
            "year": min((born or 1900) + 28, 1978),
            "audio_url": f"/api/audio/{track_id}.mp3",
            "duration_s": 180,
        }]

    return {
        "_id": artist_id,
        "id": artist_id,
        "name": name,
        "born": born or 1900,
        "died": died or 1980,
        "region": region,
        "bio": bio,
        "photo_url": f"/api/photos/{artist_id}.jpg",
        "era": era_label(born, died),
        "tracks": tracks,
        "related": [],
    }


def build_relations(artists: list[dict]) -> list[dict]:
    by_id = {a["id"]: a for a in artists}
    for artist in artists:
        if artist.get("related"):
            continue
        born = artist["born"]
        related = []
        for oid, other in by_id.items():
            if oid == artist["id"]:
                continue
            if abs(born - other["born"]) <= 15 and len(related) < 3:
                related.append({"id": oid, "name": other["name"], "relation": "same era"})
        artist["related"] = related
    return artists



def load_existing(path: Path) -> list[dict]:
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-year",    type=int, default=1850)
    parser.add_argument("--max-year",    type=int, default=1960,
                        help="Only include artists born before this year")
    parser.add_argument("--audio-limit", type=int, default=3,
                        help="Max tracks to download per artist")
    parser.add_argument("--workers",     type=int, default=12,
                        help="Parallel threads for fetching + downloading")
    parser.add_argument("--out",         default="data/artists_backup.json")
    args = parser.parse_args()

    out_path = BASE_DIR / args.out
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    existing     = load_existing(out_path)
    existing_ids = {a["_id"] for a in existing}
    logger.info("Existing artists: %d", len(existing))

    occ_str = " ".join(f"wd:{q}" for q in FOLK_OCCUPATIONS)
    all_rows: dict[str, dict] = {}
    for i, tpl in enumerate(SPARQL_QUERIES):
        q = tpl.format(occupations=occ_str)
        logger.info("Running SPARQL query %d/%d…", i + 1, len(SPARQL_QUERIES))
        rows = run_sparql(q)
        logger.info("  → %d rows", len(rows))
        for row in rows:
            name = row.get("personLabel", {}).get("value", "")
            if name and not name.startswith("Q"):
                all_rows[name] = row
        time.sleep(1)

    logger.info("Total unique Wikidata candidates: %d", len(all_rows))

    seen_ids   = set(existing_ids)
    seen_lock  = threading.Lock()
    new_artists: list[dict] = []
    results_lock = threading.Lock()
    counter = {"done": 0, "total": len(all_rows)}

    def worker(row: dict) -> dict | None:
        with seen_lock:
            name = row.get("personLabel", {}).get("value", "")
            artist_id = slugify(name)
            if not artist_id or artist_id in seen_ids:
                return None
            seen_ids.add(artist_id)
        result = process_artist(row, set(), args.audio_limit, args.max_year)
        with results_lock:
            counter["done"] += 1
            if result:
                new_artists.append(result)
            pct = counter["done"] * 100 // counter["total"]
            logger.info("[%d%%] %d/%d processed, %d new artists",
                        pct, counter["done"], counter["total"], len(new_artists))
        return result

    logger.info("Processing %d candidates with %d workers…", len(all_rows), args.workers)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(worker, all_rows.values()))

    logger.info("New artists added: %d", len(new_artists))

    all_artists = existing + new_artists
    all_artists = build_relations(all_artists)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(all_artists, f, ensure_ascii=False, indent=2)
    logger.info("Wrote %d artists → %s", len(all_artists), out_path)

    corpus_path = DATA_DIR / "corpus_meta.json"
    corpus: dict = {}
    if corpus_path.exists():
        with open(corpus_path) as f:
            corpus = json.load(f)
    idx = max((int(k) for k in corpus), default=-1) + 1
    for artist in new_artists:
        for track in artist.get("tracks", []):
            corpus[str(idx)] = {
                "artist_id": artist["id"],
                "track_id":  track["id"],
                "title":     track["title"],
                "year":      track["year"],
                "audio_url": track["audio_url"],
            }
            idx += 1
    with open(corpus_path, "w", encoding="utf-8") as f:
        json.dump(corpus, f, ensure_ascii=False, indent=2)
    logger.info("corpus_meta.json → %d entries total", len(corpus))

    downloaded = sum(1 for a in new_artists if any(
        (AUDIO_DIR / t["audio_url"].removeprefix("/api/audio/")).exists()
        for t in a.get("tracks", [])
    ))
    logger.info("Artists with real audio: %d / %d", downloaded, len(new_artists))
    logger.info("Done. Run embed_corpus.py next to rebuild corpus.faiss.")


if __name__ == "__main__":
    main()
