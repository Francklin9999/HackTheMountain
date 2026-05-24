from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)

_model = None
_processor = None
_device = "cpu"
_ok = False


def _resolve_device(preferred: str) -> str:
    try:
        import torch
    except Exception:
        return "cpu"

    if preferred == "cpu":
        return "cpu"
    if preferred == "cuda":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return "cuda" if torch.cuda.is_available() else "cpu"


def load_model() -> None:
    global _model, _processor, _device, _ok
    try:
        import torch
        from transformers import ClapModel, ClapProcessor

        from app.config import CLAP_DEVICE, CLAP_MODEL_ID, ENABLE_CLAP

        if not ENABLE_CLAP:
            logger.info("CLAP disabled by configuration.")
            _ok = False
            return

        _device = _resolve_device(CLAP_DEVICE)
        logger.info("Loading CLAP model %s on %s …", CLAP_MODEL_ID, _device)
        _model = ClapModel.from_pretrained(CLAP_MODEL_ID)
        _processor = ClapProcessor.from_pretrained(CLAP_MODEL_ID)
        _model.eval()
        _model.to(_device)
        _ok = True
        logger.info("CLAP model loaded.")
    except Exception as exc:
        logger.warning("CLAP model could not be loaded (%s). Text-to-audio search disabled.", exc)
        _ok = False


def is_available() -> bool:
    return _ok


def embed_text(text: str) -> np.ndarray | None:
    if not _ok:
        return None
    try:
        import torch

        inputs = _processor(text=[text], return_tensors="pt", padding=True)
        inputs = {k: v.to(_device) for k, v in inputs.items()}
        with torch.no_grad():
            vec = _model.get_text_features(**inputs).squeeze(0).cpu().numpy()
        del inputs
        if _device == "cuda":
            torch.cuda.empty_cache()
        norm = np.linalg.norm(vec)
        if norm == 0:
            return None
        return (vec / norm).astype("float32")
    except Exception as exc:
        logger.error("clap.embed_text() failed: %s", exc)
        return None


def embed_audio(wav_path: str) -> np.ndarray | None:
    if not _ok:
        return None
    try:
        import librosa
        import torch

        y, _ = librosa.load(wav_path, sr=48000, mono=True)
        inputs = _processor(audios=[y], sampling_rate=48000, return_tensors="pt")
        inputs = {k: v.to(_device) for k, v in inputs.items()}
        with torch.no_grad():
            vec = _model.get_audio_features(**inputs).squeeze(0).cpu().numpy()
        del inputs
        if _device == "cuda":
            torch.cuda.empty_cache()
        norm = np.linalg.norm(vec)
        if norm == 0:
            return None
        return (vec / norm).astype("float32")
    except Exception as exc:
        logger.error("clap.embed_audio() failed: %s", exc)
        return None
