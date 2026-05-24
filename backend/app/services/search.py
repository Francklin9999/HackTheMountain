from __future__ import annotations

import json
import logging
from typing import Any

import numpy as np

from app.config import CORPUS_META_PATH, FAISS_INDEX_PATH

logger = logging.getLogger(__name__)

_index = None
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
