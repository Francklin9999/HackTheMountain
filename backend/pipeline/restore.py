"""Audio restoration: noisereduce + preemphasis + MP3 export."""
import argparse
import logging
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def restore_file(src: Path, out_mp3: Path) -> bool:
    if out_mp3.exists():
        logger.info("Skip (already restored): %s", out_mp3.name)
        return True
    try:
        import librosa
        import noisereduce as nr
        import numpy as np
        import soundfile as sf

        y, sr = librosa.load(str(src), sr=44100, mono=True)
        y_clean = nr.reduce_noise(y=y, sr=sr, stationary=True)
        y_filtered = librosa.effects.preemphasis(y_clean)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_wav = tmp.name

        sf.write(tmp_wav, y_filtered, sr, subtype="PCM_16")

        result = subprocess.run(
            ["ffmpeg", "-y", "-i", tmp_wav, "-b:a", "128k", str(out_mp3)],
            capture_output=True,
            text=True,
        )
        Path(tmp_wav).unlink(missing_ok=True)

        if result.returncode != 0:
            logger.error("ffmpeg failed for %s: %s", src.name, result.stderr[-300:])
            return False

        logger.info("Restored → %s", out_mp3.name)
        return True
    except Exception as exc:
        logger.error("restore_file failed for %s: %s", src.name, exc)
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--in-dir", default="static/audio/raw")
    parser.add_argument("--out-dir", default="static/audio")
    args = parser.parse_args()

    in_dir = Path(args.in_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    sources = list(in_dir.glob("*.mp3")) + list(in_dir.glob("*.wav"))
    logger.info("Found %d audio files to restore.", len(sources))

    ok = 0
    for src in sources:
        stem = src.stem.replace(" ", "-").lower()
        out_mp3 = out_dir / f"{stem}.mp3"
        if restore_file(src, out_mp3):
            ok += 1

    logger.info("Done. %d / %d restored.", ok, len(sources))


if __name__ == "__main__":
    main()
