from __future__ import annotations

import json
import logging
from typing import Any

import numpy as np

from app.config import CLAP_INDEX_PATH, CORPUS_META_PATH, FAISS_INDEX_PATH

logger = logging.getLogger(__name__)

_index = None
_clap_index = None
_corpus_meta: dict[str, Any] = {}


def load_index() -> None:
    global _index, _corpus_meta
    try:
        import faiss

        if not FAISS_INDEX_PATH.exists():
            logger.warning("FAISS index not found at %s. Search will return None.", FAISS_INDEX_PATH)
            return

        _index = faiss.read_index(str(FAISS_INDEX_PATH))
        logger.info("FAISS index loaded: %d vectors.", _index.ntotal)

        if CORPUS_META_PATH.exists():
            with open(CORPUS_META_PATH) as f:
                _corpus_meta = json.load(f)
            logger.info("Corpus meta loaded: %d entries.", len(_corpus_meta))
    except Exception as exc:
        logger.warning("FAISS load failed (%s). Search will return None.", exc)


def load_clap_index() -> None:
    global _clap_index
    try:
        import faiss

        if not CLAP_INDEX_PATH.exists():
            logger.info("CLAP FAISS index not found at %s — will build on first warmup.", CLAP_INDEX_PATH)
            return
        _clap_index = faiss.read_index(str(CLAP_INDEX_PATH))
        logger.info("CLAP FAISS index loaded: %d vectors.", _clap_index.ntotal)
    except Exception as exc:
        logger.warning("CLAP FAISS load failed (%s).", exc)


def save_clap_index() -> None:
    if _clap_index is None:
        return
    try:
        import faiss
        faiss.write_index(_clap_index, str(CLAP_INDEX_PATH))
        logger.info("CLAP FAISS index saved: %d vectors.", _clap_index.ntotal)
    except Exception as exc:
        logger.warning("Failed to save CLAP index: %s", exc)


def build_clap_index(vectors: np.ndarray) -> None:
    global _clap_index
    import faiss
    dim = vectors.shape[1]
    _clap_index = faiss.IndexFlatIP(dim)
    _clap_index.add(vectors.astype("float32"))
    logger.info("CLAP FAISS index built: %d vectors, dim=%d.", _clap_index.ntotal, dim)


def search_clap(vec: np.ndarray, top_k: int = 3) -> list[dict]:
    if _clap_index is None:
        return []
    try:
        q = vec.reshape(1, -1).astype("float32")
        scores, indices = _clap_index.search(q, top_k)
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            meta = _corpus_meta.get(str(idx), {})
            results.append({
                "row_index": int(idx),
                "score": float(score),
                "track_id": meta.get("track_id", ""),
                "artist_id": meta.get("artist_id", ""),
            })
        return results
    except Exception as exc:
        logger.error("search_clap() failed: %s", exc)
        return []


def has_clap_index() -> bool:
    return _clap_index is not None and _clap_index.ntotal > 0


def corpus_size() -> int:
    return _index.ntotal if _index is not None else 0


def get_corpus_meta() -> dict:
    return _corpus_meta


def search(vec: np.ndarray, top_k: int = 1) -> list[dict]:
    if _index is None:
        return []
    try:
        q = vec.reshape(1, -1).astype("float32")
        scores, indices = _index.search(q, top_k)
        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0:
                continue
            meta = _corpus_meta.get(str(idx), {})
            results.append(
                {
                    "row_index": int(idx),
                    "score": float(score),
                    "track_id": meta.get("track_id", ""),
                    "artist_id": meta.get("artist_id", ""),
                }
            )
        return results
    except Exception as exc:
        logger.error("search() failed: %s", exc)
        return []
