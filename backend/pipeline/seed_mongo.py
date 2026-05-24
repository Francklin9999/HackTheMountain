"""Seed MongoDB from artists_backup.json."""
import json
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main():
    from app.config import ARTISTS_BACKUP_PATH, MONGODB_URI

    if not MONGODB_URI:
        logger.info("No MONGODB_URI configured — JSON fallback active, skipping seed.")
        return

    from pymongo import MongoClient
    from pymongo.errors import BulkWriteError

    try:
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        db = client.get_default_database()
        col = db["artists"]
    except Exception as exc:
        logger.error("Cannot connect to MongoDB: %s", exc)
        return

    existing = col.count_documents({})
    if existing > 0:
        logger.info("MongoDB already has %d artists — skipping seed.", existing)
        return

    with open(ARTISTS_BACKUP_PATH, encoding="utf-8") as f:
        artists = json.load(f)

    try:
        result = col.insert_many(artists, ordered=False)
        logger.info("Seeded %d artists into MongoDB.", len(result.inserted_ids))
    except BulkWriteError as exc:
        inserted = exc.details.get("nInserted", 0)
        logger.warning("Partial insert: %d artists written (duplicates skipped).", inserted)

    col.create_index("era")
    col.create_index("born")
    logger.info("Indexes created.")


if __name__ == "__main__":
    main()
