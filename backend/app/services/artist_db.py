from __future__ import annotations

import json
import logging
from typing import Any

from app.config import ARTISTS_BACKUP_PATH, MONGODB_URI

logger = logging.getLogger(__name__)

_mem: dict[str, Any] = {}

_backup: dict[str, Any] = {}
_mongo_client = None
_mongo_db = None


def _get_mongo_db():
    global _mongo_client, _mongo_db
    if _mongo_db is not None:
        return _mongo_db
    from pymongo import MongoClient
    _mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=2000)
    _mongo_db = _mongo_client.get_default_database()
    return _mongo_db


def _load_backup() -> dict[str, Any]:
    global _backup
    if _backup:
        return _backup
    if ARTISTS_BACKUP_PATH.exists():
        with open(ARTISTS_BACKUP_PATH) as f:
            data = json.load(f)
        _backup = {a["_id"]: a for a in data}
    return _backup


def load_all() -> int:
    """Load all artists into memory at startup. Returns count loaded."""
    global _mem
    if MONGODB_URI:
        try:
            db = _get_mongo_db()
            docs = list(db["artists"].find({}))
            for doc in docs:
                artist_id = doc.pop("_id")
                _mem[artist_id] = doc
            logger.info("Artist cache loaded from MongoDB: %d artists.", len(_mem))
            return len(_mem)
        except Exception as exc:
            logger.warning("MongoDB unreachable (%s), falling back to JSON backup.", exc)

    backup = _load_backup()
    for artist_id, doc in backup.items():
        clean = {k: v for k, v in doc.items() if k != "_id"}
        _mem[artist_id] = clean
    logger.info("Artist cache loaded from JSON backup: %d artists.", len(_mem))
    return len(_mem)


def get_artist(artist_id: str) -> dict | None:
    if _mem:
        return _mem.get(artist_id)

    if MONGODB_URI:
        try:
            db = _get_mongo_db()
            doc = db["artists"].find_one({"_id": artist_id})
            if doc:
                doc.pop("_id", None)
                return doc
        except Exception as exc:
            logger.warning("MongoDB unreachable (%s), falling back to JSON.", exc)

    return _load_backup().get(artist_id)


def get_all() -> dict:
    """Return the full in-memory artist dict {artist_id: doc}."""
    return _mem


def list_all_ids() -> list[str]:
    if _mem:
        return list(_mem.keys())

    if MONGODB_URI:
        try:
            db = _get_mongo_db()
            return [doc["_id"] for doc in db["artists"].find({}, {"_id": 1})]
        except Exception as exc:
            logger.warning("MongoDB unreachable (%s), using JSON.", exc)

    return list(_load_backup().keys())
