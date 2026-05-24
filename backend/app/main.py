import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import CORS_ORIGINS, ENABLE_TRACK_WARMUP, STATIC_AUDIO_DIR
from app.routes import artists, audio, graph, health, match, photos
from app.services import artist_db, embed, features, search

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Sillon API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)


def _background_warmup() -> None:
    """Pre-compute track features for all corpus entries in a background thread."""
    corpus_meta = search.get_corpus_meta()
    if not corpus_meta:
        logger.info("Feature warmup skipped: no corpus meta loaded.")
        return
    features.warm_all_tracks(corpus_meta, artist_db.get_artist, STATIC_AUDIO_DIR)


@app.on_event("startup")
async def startup():
    logger.info("Loading MERT model …")
    embed.load_model()

    logger.info("Loading FAISS index …")
    search.load_index()

    logger.info("Loading artist cache …")
    artist_db.load_all()

    logger.info("Loading track feature cache …")
    features.load_track_feature_cache()

    if ENABLE_TRACK_WARMUP:
        logger.info(
            "Startup complete. corpus_size=%d — warming track features in background …",
            search.corpus_size(),
        )
        import threading

        threading.Thread(target=_background_warmup, daemon=True).start()
    else:
        logger.info(
            "Startup complete. corpus_size=%d — deferred track warmup is disabled.",
            search.corpus_size(),
        )


app.include_router(health.router, prefix="/api")
app.include_router(match.router, prefix="/api")
app.include_router(artists.router, prefix="/api")
app.include_router(audio.router, prefix="/api")
app.include_router(photos.router, prefix="/api")
app.include_router(graph.router, prefix="/api")
