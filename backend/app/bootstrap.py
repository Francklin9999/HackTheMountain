from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from app.config import CLAP_INDEX_PATH, STATIC_AUDIO_DIR
from app.services import artist_db, clap, embed, features, search

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _build_clap_index() -> None:
    if not clap.is_available():
        logger.info("Bootstrap: CLAP not available — skipping CLAP index build.")
        return

    if CLAP_INDEX_PATH.exists():
        search.load_clap_index()
        if search.has_clap_index():
            logger.info("Bootstrap: CLAP index already exists, skipping rebuild.")
            return

    corpus_meta = search.get_corpus_meta()
    if not corpus_meta:
        return

    audio_dir = Path(STATIC_AUDIO_DIR)
    vectors: list[np.ndarray] = []
    row_order: list[int] = []

    for row_str, entry in corpus_meta.items():
        track_id = entry.get("track_id", "")
        artist_id = entry.get("artist_id", "")
        if not track_id or not artist_id:
            continue

        doc = artist_db.get_artist(artist_id)
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

        vec = clap.embed_audio(str(path))
        if vec is not None:
            vectors.append(vec)
            row_order.append(int(row_str))

    if not vectors:
        logger.warning("Bootstrap: no CLAP vectors produced.")
        return

    max_row = max(row_order)
    dim = vectors[0].shape[0]
    matrix = np.zeros((max_row + 1, dim), dtype="float32")
    for row, vec in zip(row_order, vectors):
        matrix[row] = vec

    search.build_clap_index(matrix)
    search.save_clap_index()
    logger.info("Bootstrap: CLAP index built with %d vectors.", len(vectors))


def main() -> None:
    logger.info("Bootstrap: loading MERT model …")
    embed.load_model()

    logger.info("Bootstrap: loading FAISS index …")
    search.load_index()

    logger.info("Bootstrap: loading artist cache …")
    artist_db.load_all()

    logger.info("Bootstrap: loading track feature cache …")
    cached_before = features.load_track_feature_cache()

    corpus_meta = search.get_corpus_meta()
    if not corpus_meta:
        logger.info("Bootstrap: no corpus metadata found; skipping warmup.")
        return

    logger.info(
        "Bootstrap: warming track features for %d corpus entries (cached=%d) …",
        len(corpus_meta),
        cached_before,
    )
    features.warm_all_tracks(corpus_meta, artist_db.get_artist, STATIC_AUDIO_DIR)
    logger.info("Bootstrap: track_feature_cache=%d", features.track_cache_size())

    logger.info("Bootstrap: loading CLAP model …")
    clap.load_model()

    logger.info("Bootstrap: building CLAP index …")
    _build_clap_index()

    logger.info("Bootstrap complete.")


if __name__ == "__main__":
    main()
