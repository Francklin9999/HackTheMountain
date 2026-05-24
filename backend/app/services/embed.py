from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)

_model = None
_extractor = None
_device = "cpu"


def load_model() -> None:
    global _model, _extractor, _device
    try:
        import torch
        from transformers import AutoModel, Wav2Vec2FeatureExtractor

        from app.config import MERT_MODEL_ID

        _device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info("Loading MERT model %s on %s …", MERT_MODEL_ID, _device)
        _model = AutoModel.from_pretrained(MERT_MODEL_ID, trust_remote_code=True)
        _extractor = Wav2Vec2FeatureExtractor.from_pretrained(MERT_MODEL_ID)
        _model.eval()
        _model.to(_device)
        logger.info("MERT model loaded.")
    except Exception as exc:
        logger.warning("MERT model could not be loaded (%s). Embedding will return zeros.", exc)


def embed(wav_path: str) -> np.ndarray | None:
    if _model is None or _extractor is None:
        logger.warning("MERT not loaded — skipping embed.")
        return None
    try:
        import librosa
        import torch

        y, _ = librosa.load(wav_path, sr=24000, mono=True)
        if len(y) > 10 * 24000:
            start = (len(y) - 10 * 24000) // 2
            y = y[start : start + 10 * 24000]

        inputs = _extractor(y, sampling_rate=24000, return_tensors="pt")
        inputs = {k: v.to(_device) for k, v in inputs.items()}

        with torch.no_grad():
            out = _model(**inputs, output_hidden_states=True)

        vec = out.hidden_states[7].mean(dim=1).squeeze(0).cpu().numpy()
        norm = np.linalg.norm(vec)
        if norm == 0:
            return None
        return (vec / norm).astype("float32")
    except Exception as exc:
        logger.error("embed() failed: %s", exc)
        return None
