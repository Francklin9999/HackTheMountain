import logging
import random
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.config import ENABLE_DEMO_CACHE, LOW_SCORE_THRESHOLD, OPENAI_MODEL_ID, STATIC_AUDIO_DIR
from app.schemas.api import Artist, Connection, MatchBreakdown, MatchResponse, Track
from app.services import artist_db, cache, clap, embed, explain, features, search
from app.services.explain import _get_client

logger = logging.getLogger(__name__)

router = APIRouter()

_FALLBACK_ARTIST_ID = "joseph-allard"


def _synthetic_doc_from_meta(meta: dict) -> dict:
    title = meta.get("title", "Unknown recording")
    year = meta.get("year", 0)
    audio_url = meta.get("audio_url", "")
    track_id = meta.get("track_id", "unknown-track")
    return {
        "id": "unknown",
        "name": "Unknown Artist",
        "born": 0,
        "died": 0,
        "region": "Quebec",
        "bio": "An unidentified artist from the 78rpm archive. The recording survives but the name behind it has been lost to time.",
        "photo_url": "",
        "era": "78rpm era",
        "tracks": [{
            "id": track_id,
            "title": title,
            "year": year,
            "audio_url": audio_url,
            "duration_s": 0,
        }],
        "related": [],
    }

_FALLBACK_RESPONSE = MatchResponse(
    artist=Artist(
        id="joseph-allard",
        name="Joseph Allard",
        born=1873,
        died=1947,
        region="Quebec",
        bio=(
            "Quebec fiddle virtuoso known as the 'Prince of Fiddlers'. Born in "
            "Saint-Denis-sur-Richelieu, Allard mastered the traditional Quebec reel and became "
            "the most recorded French-Canadian fiddler of the 78rpm era. His playing combined "
            "Irish jig influences with deep Quebecois melancholy — a sound that defined an era "
            "most have forgotten."
        ),
        photo_url="/api/photos/allard.jpg",
        era="1900s-1940s",
        source_url="https://www.collectionscanada.gc.ca/gramophone/",
        source_label="Virtual Gramophone · Library & Archives Canada",
    ),
    track=Track(
        id="reel-de-chateauguay",
        title="Reel de Chateauguay",
        year=1928,
        audio_url="/api/audio/reel-de-chateauguay.mp3",
        duration_s=187,
    ),
    connection=Connection(
        score=0.87,
        explanation=(
            "Both build tension through a descending minor third — the same interval that signals "
            "longing in nearly every musical tradition. Allard used it to evoke homesickness, the "
            "distance between the farm and the city. Your melody carries the same weight, a century later."
        ),
        shared_features=["minor key", "moderate tempo", "melancholic contour", "descending phrase"],
        breakdown=MatchBreakdown(vibe=0.85, key=0.92, tempo=0.78, contour=0.91),
        key_label="D minor",
        tempo_bpm=112,
        contour_label="descending",
        mode_label="Dorian",
    ),
)

_GRAMOPHONE_SOURCE = (
    "https://www.collectionscanada.gc.ca/gramophone/",
    "Virtual Gramophone · Library & Archives Canada",
)

_SOURCE_FALLBACKS: dict[str, tuple[str, str]] = {
    "joseph-allard": _GRAMOPHONE_SOURCE,
    "la-bolduc": _GRAMOPHONE_SOURCE,
    "jean-carignan": (
        "https://musicbrainz.org/artist/0fae3e84-12c5-4bcb-9b15-1c1d4d3c0a4b",
        "MusicBrainz · Verified artist",
    ),
    "ovila-legare": _GRAMOPHONE_SOURCE,
    "isidore-soucy": _GRAMOPHONE_SOURCE,
    "alfred-montmarquette": _GRAMOPHONE_SOURCE,
    "conrad-gauthier": _GRAMOPHONE_SOURCE,
    "charles-marchand": _GRAMOPHONE_SOURCE,
    "philippe-bruneau": _GRAMOPHONE_SOURCE,
    "felix-leclerc": _GRAMOPHONE_SOURCE,
}


def _track_audio_path(track_doc: dict):
    audio_url = track_doc.get("audio_url", "") if track_doc else ""
    if audio_url.startswith("/api/audio/"):
        fname = audio_url.removeprefix("/api/audio/")
        candidate = STATIC_AUDIO_DIR / fname
        if candidate.exists():
            return str(candidate)
    return None


def _mode_label(feats: dict) -> str:
    mode = feats.get("mode") or ""
    if mode == "minor":
        return "Aeolian"
    if mode == "major":
        return "Ionian"
    return ""


def _source_for(artist_id: str, doc: dict) -> tuple[str | None, str | None]:
    src_url = doc.get("source_url")
    src_lbl = doc.get("source_label")
    if not src_url:
        src_url, src_lbl = _SOURCE_FALLBACKS.get(artist_id, _GRAMOPHONE_SOURCE)
    return src_url, src_lbl


def _build_response_from_doc(doc: dict, input_feats: dict) -> MatchResponse:
    artist_id = doc.get("id") or _FALLBACK_ARTIST_ID
    tracks = doc.get("tracks", [])
    if not tracks:
        return _FALLBACK_RESPONSE

    track_doc = random.choice(tracks)
    track_path = _track_audio_path(track_doc)
    track_feats = features.get_track_features(track_doc.get("id", ""), track_path)

    explanation = explain.generate(
        input_feats=input_feats,
        artist_name=doc["name"],
        artist_born=doc["born"],
        artist_died=doc["died"],
        track_title=track_doc["title"],
        track_year=track_doc["year"],
        track_feats=track_feats,
        era_context=doc.get("era", ""),
    )
    scored = features.weighted_match_score(None, input_feats, track_feats)
    src_url, src_lbl = _source_for(artist_id, doc)

    return MatchResponse(
        artist=Artist(
            id=artist_id,
            name=doc["name"],
            born=doc["born"],
            died=doc["died"],
            region=doc["region"],
            bio=doc["bio"],
            photo_url=doc["photo_url"],
            era=doc["era"],
            source_url=src_url,
            source_label=src_lbl,
        ),
        track=Track(
            id=track_doc["id"],
            title=track_doc["title"],
            year=track_doc["year"],
            audio_url=track_doc["audio_url"],
            duration_s=track_doc["duration_s"],
        ),
        connection=Connection(
            score=scored["score"],
            explanation=explanation,
            shared_features=features.shared_features(input_feats, track_feats),
            breakdown=MatchBreakdown(**scored["breakdown"]),
            key_label=track_feats.get("key") if track_feats.get("key") != "unknown" else None,
            tempo_bpm=track_feats.get("bpm") or None,
            contour_label=track_feats.get("contour") if track_feats.get("contour") != "unknown" else None,
            mode_label=_mode_label(track_feats),
        ),
    )


def _random_artist_response(input_feats: dict) -> MatchResponse:
    best = None
    for artist_id, doc in artist_db.get_all().items():
        for track_doc in doc.get("tracks", []):
            track_path = _track_audio_path(track_doc)
            track_feats = features.get_track_features(track_doc.get("id", ""), track_path)
            scored = features.weighted_match_score(None, input_feats, track_feats)
            candidate = {
                "artist_id": artist_id,
                "doc": doc,
                "track_doc": track_doc,
                "track_feats": track_feats,
                "scored": scored,
            }
            if best is None or candidate["scored"]["raw_score"] > best["scored"]["raw_score"]:
                best = candidate

    if best is None:
        all_ids = artist_db.list_all_ids()
        if not all_ids:
            return _FALLBACK_RESPONSE
        artist_id = random.choice(all_ids)
        doc = artist_db.get_artist(artist_id)
        if not doc or not doc.get("tracks"):
            return _FALLBACK_RESPONSE
        return _build_response_from_doc(doc, input_feats)

    doc = best["doc"]
    track_doc = best["track_doc"]
    track_feats = best["track_feats"]
    scored = best["scored"]
    artist_id = best["artist_id"]
    src_url, src_lbl = _source_for(artist_id, doc)

    explanation = explain.generate(
        input_feats=input_feats,
        artist_name=doc["name"],
        artist_born=doc["born"],
        artist_died=doc["died"],
        track_title=track_doc["title"],
        track_year=track_doc["year"],
        track_feats=track_feats,
        era_context=doc.get("era", ""),
    )

    return MatchResponse(
        artist=Artist(
            id=artist_id,
            name=doc["name"],
            born=doc["born"],
            died=doc["died"],
            region=doc["region"],
            bio=doc["bio"],
            photo_url=doc["photo_url"],
            era=doc["era"],
            source_url=src_url,
            source_label=src_lbl,
        ),
        track=Track(
            id=track_doc["id"],
            title=track_doc["title"],
            year=track_doc["year"],
            audio_url=track_doc["audio_url"],
            duration_s=track_doc["duration_s"],
        ),
        connection=Connection(
            score=scored["score"],
            explanation=explanation,
            shared_features=features.shared_features(input_feats, track_feats),
            breakdown=MatchBreakdown(**scored["breakdown"]),
            key_label=track_feats.get("key") if track_feats.get("key") != "unknown" else None,
            tempo_bpm=track_feats.get("bpm") or None,
            contour_label=track_feats.get("contour") if track_feats.get("contour") != "unknown" else None,
            mode_label=_mode_label(track_feats),
        ),
    )


def _match_audio_sync(tmp_path: Path) -> MatchResponse:
    if ENABLE_DEMO_CACHE:
        fp = cache.fingerprint(str(tmp_path))
        if fp:
            cached = cache.lookup(fp)
            if cached:
                logger.info("Demo cache hit for %s.", fp[:12])
                return MatchResponse(**cached)

    vec = embed.embed(str(tmp_path))
    input_feats = features.extract(str(tmp_path))

    if vec is None:
        logger.warning("Embed returned None — picking random artist from DB.")
        return _random_artist_response(input_feats)

    results = search.search(vec, top_k=20)
    if not results or results[0]["score"] < LOW_SCORE_THRESHOLD:
        logger.warning("Low/no FAISS score — picking random artist from DB.")
        return _random_artist_response(input_feats)

    candidates = []
    seen_artists: set[str] = set()
    for r in results:
        doc = artist_db.get_artist(r["artist_id"])
        if not doc:
            corpus_meta = search.get_corpus_meta()
            meta = corpus_meta.get(str(r["row_index"]), {})
            if not meta.get("audio_url"):
                continue
            doc = _synthetic_doc_from_meta(meta)
        artist_key = r["artist_id"] + ":" + r["track_id"]
        if artist_key in seen_artists:
            continue
        seen_artists.add(artist_key)

        track_doc = next((t for t in doc.get("tracks", []) if t["id"] == r["track_id"]), None)
        if not track_doc and doc.get("tracks"):
            track_doc = doc["tracks"][0]
        if not track_doc:
            continue

        track_feats = features.get_cached_track_features(track_doc.get("id", ""))
        if track_feats is None:
            track_feats = {"key": "unknown", "key_root": -1, "mode": "unknown", "bpm": 0.0, "contour": "unknown"}

        scored = features.weighted_match_score(r["score"], input_feats, track_feats)

        candidates.append({
            "doc": doc,
            "track_doc": track_doc,
            "track_feats": track_feats,
            "raw_cosine": r["score"],
            "raw_overall": scored["raw_score"],
            "overall": scored["score"],
            "breakdown": scored["breakdown"],
        })

    if not candidates:
        return _random_artist_response(input_feats)

    candidates.sort(key=lambda c: c["raw_overall"], reverse=True)
    pool = candidates[:min(5, len(candidates))]
    weights = [c["overall"] for c in pool]
    best = random.choices(pool, weights=weights, k=1)[0]

    doc = best["doc"]
    track_doc = best["track_doc"]
    track_feats = best["track_feats"]
    shared = features.shared_features(input_feats, track_feats)

    explanation = explain.generate(
        input_feats=input_feats,
        artist_name=doc["name"],
        artist_born=doc["born"],
        artist_died=doc["died"],
        track_title=track_doc["title"],
        track_year=track_doc["year"],
        track_feats=track_feats,
        era_context=doc.get("era", ""),
    )

    artist_id = doc.get("id") or _FALLBACK_ARTIST_ID
    src_url, src_lbl = _source_for(artist_id, doc)

    return MatchResponse(
        artist=Artist(
            id=artist_id,
            name=doc["name"],
            born=doc["born"],
            died=doc["died"],
            region=doc["region"],
            bio=doc["bio"],
            photo_url=doc["photo_url"],
            era=doc["era"],
            source_url=src_url,
            source_label=src_lbl,
        ),
        track=Track(
            id=track_doc["id"],
            title=track_doc["title"],
            year=track_doc["year"],
            audio_url=track_doc["audio_url"],
            duration_s=track_doc["duration_s"],
        ),
        connection=Connection(
            score=best["overall"],
            explanation=explanation,
            shared_features=shared,
            breakdown=MatchBreakdown(**best["breakdown"]),
            key_label=track_feats.get("key") if track_feats.get("key") != "unknown" else None,
            tempo_bpm=track_feats.get("bpm") or None,
            contour_label=track_feats.get("contour") if track_feats.get("contour") != "unknown" else None,
            mode_label=_mode_label(track_feats),
        ),
    )


@router.post("/match", response_model=MatchResponse)
async def match_audio(audio: UploadFile):
    tmp_path = Path(f"/tmp/{uuid.uuid4()}.wav")
    try:
        content = await audio.read()
        tmp_path.write_bytes(content)
        return await run_in_threadpool(_match_audio_sync, tmp_path)
    except Exception as exc:
        logger.error("/api/match unhandled error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Match pipeline failed.")
    finally:
        if tmp_path.exists():
            tmp_path.unlink()



class AssistedMatchRequest(BaseModel):
    mode: str   # "description" | "link"
    value: str


def _explain_from_text(
    mode: str, value: str,
    artist_name: str, artist_born: int, artist_died: int,
    track_title: str, track_year: int, era_context: str, track_feats: dict,
) -> str:
    client = _get_client()
    if not client:
        return explain.fallback_text_explanation(
            mode=mode,
            artist_name=artist_name,
            track_title=track_title,
            track_year=track_year,
            track_feats=track_feats,
        )
    try:
        input_line = (
            f'Description of the melody or feeling: "{value}"'
            if mode == "description"
            else f"Song link provided by the listener: {value}"
        )
        prompt = (
            "You are a music critic revealing a forgotten Quebec voice to someone who shared a musical reference.\n\n"
            f"{input_line}\n\n"
            f"The archive matched them with: {artist_name} ({artist_born}-{artist_died}), "
            f'track "{track_title}" ({track_year}), era: {era_context}.\n\n'
            "Write 2-3 sentences explaining why this Quebec artist resonates with what they described or linked. "
            "Name at least one specific musical or emotional feature that connects them. "
            "Avoid generic words: beautiful, emotional, moving, soulful. "
            "Write like you are revealing a secret, not summarizing a Wikipedia page.\n\n"
            "Output only the explanation. No preamble."
        )
        resp = client.chat.completions.create(
            model=OPENAI_MODEL_ID,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
        )
        return resp.choices[0].message.content.strip()
    except Exception as exc:
        logger.error("_explain_from_text failed: %s", exc)
        return explain.fallback_text_explanation(
            mode=mode,
            artist_name=artist_name,
            track_title=track_title,
            track_year=track_year,
            track_feats=track_feats,
        )


def _assisted_candidates(text_feats: dict) -> list[dict]:
    candidates = []

    for aid, doc in artist_db.get_all().items():
        for track_doc in doc.get("tracks", []):
            track_id = track_doc.get("id", "")
            if not track_id:
                continue

            track_feats = features.get_cached_track_features(track_id)
            if track_feats is None:
                continue

            scored = features.weighted_match_score(None, text_feats, track_feats)
            candidates.append({
                "artist_id": aid,
                "doc": doc,
                "track_doc": track_doc,
                "track_feats": track_feats,
                "scored": scored,
            })

    logger.info(
        "Assisted match scanned %d cached tracks; cache_size=%d.",
        len(candidates),
        features.track_cache_size(),
    )
    return candidates


def _clap_assisted_match(body: AssistedMatchRequest) -> MatchResponse | None:
    if not clap.is_available() or not search.has_clap_index():
        return None

    query = body.value
    if body.mode == "description":
        query = f"music that sounds like: {body.value}"

    vec = clap.embed_text(query)
    if vec is None:
        return None

    results = search.search_clap(vec, top_k=20)
    if not results:
        return None

    candidates = []
    for r in results:
        doc = artist_db.get_artist(r["artist_id"])
        if not doc:
            corpus_meta = search.get_corpus_meta()
            meta = corpus_meta.get(str(r["row_index"]), {})
            if not meta.get("audio_url"):
                continue
            doc = _synthetic_doc_from_meta(meta)
        track_doc = next((t for t in doc.get("tracks", []) if t["id"] == r["track_id"]), None)
        if not track_doc and doc.get("tracks"):
            track_doc = doc["tracks"][0]
        if not track_doc:
            continue

        track_feats = features.get_cached_track_features(track_doc.get("id", ""))
        if track_feats is None:
            track_feats = {"key": "unknown", "key_root": -1, "mode": "unknown", "bpm": 0.0, "contour": "unknown"}
        input_feats = {"key": "unknown", "key_root": -1, "mode": "unknown", "bpm": 0.0, "contour": "unknown"}
        scored = features.weighted_match_score(r["score"], input_feats, track_feats)

        candidates.append({
            "doc": doc,
            "track_doc": track_doc,
            "track_feats": track_feats,
            "scored": scored,
            "artist_id": r["artist_id"],
        })

    if not candidates:
        return None

    candidates.sort(key=lambda c: c["scored"]["raw_score"], reverse=True)
    pool = candidates[:min(5, len(candidates))]
    weights = [c["scored"]["score"] for c in pool]
    best = random.choices(pool, weights=weights, k=1)[0]

    doc = best["doc"]
    track_doc = best["track_doc"]
    track_feats = best["track_feats"]
    scored = best["scored"]
    artist_id = best["artist_id"]
    src_url, src_lbl = _source_for(artist_id, doc)
    input_feats = {"key": "unknown", "key_root": -1, "mode": "unknown", "bpm": 0.0, "contour": "unknown"}

    explanation = _explain_from_text(
        mode=body.mode,
        value=body.value,
        artist_name=doc["name"],
        artist_born=doc["born"],
        artist_died=doc["died"],
        track_title=track_doc["title"],
        track_year=track_doc["year"],
        era_context=doc.get("era", ""),
        track_feats=track_feats,
    )

    logger.info("CLAP assisted match: %s / %s (score=%.4f).", artist_id, track_doc["id"], scored["score"])
    return MatchResponse(
        artist=Artist(
            id=artist_id,
            name=doc["name"],
            born=doc["born"],
            died=doc["died"],
            region=doc["region"],
            bio=doc["bio"],
            photo_url=doc["photo_url"],
            era=doc["era"],
            source_url=src_url,
            source_label=src_lbl,
        ),
        track=Track(
            id=track_doc["id"],
            title=track_doc["title"],
            year=track_doc["year"],
            audio_url=track_doc["audio_url"],
            duration_s=track_doc["duration_s"],
        ),
        connection=Connection(
            score=scored["score"],
            explanation=explanation,
            shared_features=features.shared_features(input_feats, track_feats),
            breakdown=MatchBreakdown(**scored["breakdown"]),
            key_label=track_feats.get("key") if track_feats.get("key") != "unknown" else None,
            tempo_bpm=track_feats.get("bpm") or None,
            contour_label=track_feats.get("contour") if track_feats.get("contour") != "unknown" else None,
            mode_label=_mode_label(track_feats),
        ),
    )


def _match_assisted_sync(body: AssistedMatchRequest) -> MatchResponse:
    try:
        clap_result = _clap_assisted_match(body)
        if clap_result is not None:
            return clap_result

        logger.info("CLAP unavailable or returned nothing — falling back to GPT feature extraction.")
        text_feats = explain.extract_musical_features(body.mode, body.value)
        if not text_feats:
            text_feats = {"key": "unknown", "key_root": -1, "mode": "unknown", "bpm": 0.0, "contour": "unknown"}

        candidates = _assisted_candidates(text_feats)

        if not candidates:
            logger.warning(
                "Assisted match: no cached track features yet (cache_size=%d) — "
                "returning fallback. Run pipeline.embed_corpus or wait for warmup to finish.",
                features.track_cache_size(),
            )
            return _FALLBACK_RESPONSE

        candidates.sort(key=lambda c: c["scored"]["score"], reverse=True)
        pool = candidates[:min(5, len(candidates))]
        weights = [c["scored"]["score"] for c in pool]
        best = random.choices(pool, weights=weights, k=1)[0]
        logger.info("Assisted match (GPT fallback) selected from pool of %d.", len(pool))

        artist_id = best["artist_id"]
        doc = best["doc"]
        track_doc = best["track_doc"]
        track_feats = best["track_feats"]
        scored = best["scored"]
        src_url, src_lbl = _source_for(artist_id, doc)

        explanation = _explain_from_text(
            mode=body.mode,
            value=body.value,
            artist_name=doc["name"],
            artist_born=doc["born"],
            artist_died=doc["died"],
            track_title=track_doc["title"],
            track_year=track_doc["year"],
            era_context=doc.get("era", ""),
            track_feats=track_feats,
        )

        return MatchResponse(
            artist=Artist(
                id=artist_id,
                name=doc["name"],
                born=doc["born"],
                died=doc["died"],
                region=doc["region"],
                bio=doc["bio"],
                photo_url=doc["photo_url"],
                era=doc["era"],
                source_url=src_url,
                source_label=src_lbl,
            ),
            track=Track(
                id=track_doc["id"],
                title=track_doc["title"],
                year=track_doc["year"],
                audio_url=track_doc["audio_url"],
                duration_s=track_doc["duration_s"],
            ),
            connection=Connection(
                score=scored["score"],
                explanation=explanation,
                shared_features=features.shared_features(text_feats, track_feats),
                breakdown=MatchBreakdown(**scored["breakdown"]),
                key_label=track_feats.get("key") if track_feats.get("key") != "unknown" else None,
                tempo_bpm=track_feats.get("bpm") or None,
                contour_label=track_feats.get("contour") if track_feats.get("contour") != "unknown" else None,
                mode_label=_mode_label(track_feats),
            ),
        )
    except Exception as exc:
        logger.error("/api/match/assisted unhandled error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Assisted match failed.")


@router.post("/match/assisted", response_model=MatchResponse)
async def match_assisted(body: AssistedMatchRequest):
    return await run_in_threadpool(_match_assisted_sync, body)
