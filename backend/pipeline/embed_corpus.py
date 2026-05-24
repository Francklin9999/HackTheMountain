"""Build MERT embeddings and FAISS index from restored audio."""
import argparse
import json
import logging
import re
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def embed_file(path: str, model, extractor, device: str) -> np.ndarray | None:
    try:
        import librosa
        import torch

        y, _ = librosa.load(path, sr=24000, mono=True)
        if len(y) > 10 * 24000:
            start = (len(y) - 10 * 24000) // 2
            y = y[start : start + 10 * 24000]

        inputs = extractor(y, sampling_rate=24000, return_tensors="pt")
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.no_grad():
            out = model(**inputs, output_hidden_states=True)

        vec = out.hidden_states[7].mean(dim=1).squeeze(0).cpu().numpy()
        norm = np.linalg.norm(vec)
        if norm == 0:
            return None
        return (vec / norm).astype("float32")
    except Exception as exc:
        logger.error("embed_file failed %s: %s", path, exc)
        return None


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-dir", default="static/audio")
    parser.add_argument("--meta-json", default="data/corpus_meta.json")
    parser.add_argument("--index-out", default="data/corpus.faiss")
    parser.add_argument("--artist-backup", default="data/artists_backup.json")
    args = parser.parse_args()

    import torch
    from transformers import AutoModel, Wav2Vec2FeatureExtractor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Loading MERT on %s …", device)

    model = AutoModel.from_pretrained("m-a-p/MERT-v1-330M", trust_remote_code=True)
    extractor = Wav2Vec2FeatureExtractor.from_pretrained("m-a-p/MERT-v1-330M")
    model.eval()
    model.to(device)

    track_lookup: dict[str, dict] = {}
    backup_path = Path(args.artist_backup)
    if backup_path.exists():
        with open(backup_path) as f:
            artists = json.load(f)
        for artist in artists:
            for track in artist.get("tracks", []):
                fname = track["audio_url"].split("/")[-1]
                track_lookup[fname] = {
                    "artist_id": artist["_id"],
                    "track_id": track["id"],
                    "title": track["title"],
                    "year": track["year"],
                    "audio_url": track["audio_url"],
                }

    audio_dir = Path(args.audio_dir)
    mp3s = sorted(audio_dir.glob("*.mp3"))
    logger.info("Found %d MP3s to embed.", len(mp3s))

    vecs = []
    meta = {}

    for i, path in enumerate(mp3s):
        vec = embed_file(str(path), model, extractor, device)
        if vec is None:
            logger.warning("Skipping %s (embed failed).", path.name)
            continue

        known = track_lookup.get(path.name)
        if known:
            entry = known
        else:
            stem = path.stem
            entry = {
                "artist_id": "unknown",
                "track_id": slugify(stem),
                "title": stem.replace("-", " ").title(),
                "year": 0,
                "audio_url": f"/api/audio/{path.name}",
            }

        row_idx = len(vecs)
        vecs.append(vec)
        meta[str(row_idx)] = entry
        logger.info("[%d] Embedded %s → row %d", i + 1, path.name, row_idx)

    if not vecs:
        logger.error("No vectors produced. Aborting.")
        return

    import faiss

    matrix = np.stack(vecs)
    dim = matrix.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(matrix)

    index_out = Path(args.index_out)
    index_out.parent.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(index_out))
    logger.info("FAISS index written: %s (%d vectors, dim=%d).", index_out, index.ntotal, dim)

    meta_out = Path(args.meta_json)
    meta_out.parent.mkdir(parents=True, exist_ok=True)
    with open(meta_out, "w") as f:
        json.dump(meta, f, indent=2)
    logger.info("Corpus meta written: %s.", meta_out)


if __name__ == "__main__":
    main()
