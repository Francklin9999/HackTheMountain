"""Sanity check: does MERT embed hums near the right corpus tracks?"""
import argparse
import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def embed(path: str, model, extractor, device: str) -> np.ndarray | None:
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
        return (vec / norm).astype("float32") if norm > 0 else None
    except Exception as exc:
        logger.error("embed failed %s: %s", path, exc)
        return None


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hums-dir", required=True)
    parser.add_argument("--corpus-dir", default="static/audio")
    parser.add_argument("--n-corpus", type=int, default=5)
    args = parser.parse_args()

    import torch
    from transformers import AutoModel, Wav2Vec2FeatureExtractor

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Loading MERT on %s …", device)
    model = AutoModel.from_pretrained("m-a-p/MERT-v1-330M", trust_remote_code=True)
    extractor = Wav2Vec2FeatureExtractor.from_pretrained("m-a-p/MERT-v1-330M")
    model.eval()
    model.to(device)

    hum_paths = sorted(Path(args.hums_dir).glob("*.wav"))[:5]
    corpus_paths = sorted(Path(args.corpus_dir).glob("*.mp3"))[: args.n_corpus]

    if len(hum_paths) < 5:
        logger.error("Need at least 5 hum WAVs in --hums-dir, found %d.", len(hum_paths))
        return
    if len(corpus_paths) < 1:
        logger.error("No corpus MP3s found in --corpus-dir.")
        return

    logger.info("Embedding %d hums …", len(hum_paths))
    hum_vecs = [(p.name, embed(str(p), model, extractor, device)) for p in hum_paths]

    logger.info("Embedding %d corpus tracks …", len(corpus_paths))
    corpus_vecs = [(p.name, embed(str(p), model, extractor, device)) for p in corpus_paths]

    print("\n=== Cosine similarity matrix (hum × corpus) ===")
    header = " " * 30 + "  ".join(n[:20].ljust(20) for n, _ in corpus_vecs)
    print(header)

    defensible = 0
    top1_counts: dict[str, int] = {}

    for hum_name, hv in hum_vecs:
        if hv is None:
            print(f"{hum_name:<30}  [embed failed]")
            continue
        scores = [(cn, cosine(hv, cv)) for cn, cv in corpus_vecs if cv is not None]
        scores.sort(key=lambda x: x[1], reverse=True)
        row = f"{hum_name:<30}  " + "  ".join(f"{s:.3f}".ljust(20) for _, s in scores)
        print(row)
        top1 = scores[0][0] if scores else None
        if top1:
            top1_counts[top1] = top1_counts.get(top1, 0) + 1
        if scores and scores[0][1] > 0.5:
            defensible += 1

    print("\n=== Top-1 distribution ===")
    for track, count in sorted(top1_counts.items(), key=lambda x: -x[1]):
        print(f"  {track}: {count} hum(s)")

    all_same = len(top1_counts) == 1 and list(top1_counts.values())[0] == len(hum_paths)

    print("\n=== VERDICT ===")
    if defensible >= 2 and not all_same:
        print("PASS — MERT embeds hums in a space where corpus tracks live nearby.")
        print("       Proceed to Step 5 (embed_corpus) with confidence.")
    else:
        if all_same:
            print("FAIL — Same corpus track returned for all hums. MERT embedding is degenerate.")
        else:
            print("FAIL — Fewer than 2 hums produced a score > 0.5 match.")
        print("       Pivot to pitch-contour DTW pipeline before building the FAISS index.")
        print("       See BACKEND.md H2 section for the fallback plan.")


if __name__ == "__main__":
    main()
