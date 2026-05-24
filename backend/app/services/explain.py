from __future__ import annotations

import json
import logging

from app.config import OPENAI_API_KEY, OPENAI_MODEL_ID

_KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

logger = logging.getLogger(__name__)

_openai_client = None


def _get_client():
    global _openai_client
    if _openai_client is None and OPENAI_API_KEY:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    return _openai_client

_PROMPT_TEMPLATE = """\
You are a music critic writing for someone discovering a forgotten Quebec \
artist for the first time. Write 2-3 sentences explaining the emotional \
connection between what they hummed and the historical track they were \
matched with.

Input hummed features:
  Key: {input_key}
  Tempo: {input_bpm} BPM
  Contour: {input_contour}

Matched track:
  Artist: {artist_name} ({artist_born}-{artist_died})
  Track: {track_title} ({track_year})
  Key: {track_key}
  Tempo: {track_bpm} BPM
  Contour: {track_contour}
  Era: {era_context}

Requirements:
- Name at least one specific musical feature shared between them \
(key, mode, tempo, interval, rhythm pattern).
- Avoid generic words: "beautiful", "emotional", "moving", "soulful".
- 2-3 sentences only.
- Write like you are revealing a secret, not summarizing a Wikipedia page.

Output only the explanation. No preamble.\
"""


def _tempo_phrase(bpm: float) -> str:
    if bpm <= 0:
        return "an uncertain pulse"
    if bpm < 90:
        return "a slow pulse"
    if bpm < 140:
        return "a measured mid-tempo pulse"
    return "a quick pulse"


def _rule_based_explanation(
    input_feats: dict,
    artist_name: str,
    track_title: str,
    track_year: int,
    track_feats: dict,
) -> str:
    input_mode = input_feats.get("mode", "unknown")
    track_mode = track_feats.get("mode", "unknown")
    contour = track_feats.get("contour", "unknown")
    shared_mode = input_mode == track_mode and input_mode in {"major", "minor"}
    mode_phrase = f"the same {track_mode} color" if shared_mode else f"{track_mode} tonal color"
    tempo_phrase = _tempo_phrase(float(track_feats.get("bpm", 0) or 0))
    contour_phrase = (
        f"a {contour} phrase shape"
        if contour in {"ascending", "descending", "flat"}
        else "a similarly shaped melodic line"
    )
    return (
        f'Your melody lines up with {artist_name}\'s "{track_title}" ({track_year}) through {mode_phrase}, '
        f"{tempo_phrase}, and {contour_phrase}. The connection is being inferred from the musical profile itself, "
        "so it lands more like a family resemblance than a canned comparison."
    )


def fallback_text_explanation(
    mode: str,
    artist_name: str,
    track_title: str,
    track_year: int,
    track_feats: dict,
) -> str:
    source_phrase = "description" if mode == "description" else "reference"
    tempo_phrase = _tempo_phrase(float(track_feats.get("bpm", 0) or 0))
    contour = track_feats.get("contour", "unknown")
    contour_phrase = contour if contour in {"ascending", "descending", "flat"} else "shaped"
    return (
        f'Your {source_phrase} points toward {artist_name}\'s "{track_title}" ({track_year}), which carries '
        f"{tempo_phrase} and a {contour_phrase} melodic motion. Even without a generated write-up, the match is "
        "still being built from the track profile rather than a fixed canned answer."
    )


def extract_musical_features(mode: str, value: str) -> dict | None:
    client = _get_client()
    if not client:
        return None

    input_line = (
        f'Melody/feeling description: "{value}"'
        if mode == "description"
        else f"Song or link reference: {value}"
    )
    prompt = (
        "Extract musical features from the following input. "
        "Return ONLY a JSON object with exactly these fields:\n"
        '  "key_root": integer 0-11  (C=0 C#=1 D=2 D#=3 E=4 F=5 F#=6 G=7 G#=8 A=9 A#=10 B=11)\n'
        '  "mode": "major" or "minor"\n'
        '  "bpm": float between 40 and 240\n'
        '  "contour": "ascending", "descending", or "flat"\n\n'
        f"{input_line}\n\n"
        "If the input is a song link or title, infer from that song's known musical characteristics. "
        "Return only the JSON object, no explanation."
    )
    try:
        resp = client.chat.completions.create(
            model=OPENAI_MODEL_ID,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=80,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content)
        key_root = max(0, min(11, int(data.get("key_root", 0))))
        mode_str = data.get("mode", "major") if data.get("mode") in ("major", "minor") else "major"
        bpm = float(data.get("bpm", 120))
        contour = data.get("contour", "flat") if data.get("contour") in ("ascending", "descending", "flat") else "flat"
        return {
            "key_root": key_root,
            "key": f"{_KEY_NAMES[key_root]} {mode_str}",
            "mode": mode_str,
            "bpm": round(bpm, 1),
            "contour": contour,
        }
    except Exception as exc:
        logger.error("extract_musical_features failed: %s", exc)
        return None


def generate(
    input_feats: dict,
    artist_name: str,
    artist_born: int,
    artist_died: int,
    track_title: str,
    track_year: int,
    track_feats: dict,
    era_context: str,
) -> str:
    client = _get_client()
    if not client:
        logger.warning("OPENAI_API_KEY not set — returning fallback explanation.")
        return _rule_based_explanation(
            input_feats=input_feats,
            artist_name=artist_name,
            track_title=track_title,
            track_year=track_year,
            track_feats=track_feats,
        )

    try:
        prompt = _PROMPT_TEMPLATE.format(
            input_key=input_feats.get("key", "unknown"),
            input_bpm=input_feats.get("bpm", 0),
            input_contour=input_feats.get("contour", "unknown"),
            artist_name=artist_name,
            artist_born=artist_born,
            artist_died=artist_died,
            track_title=track_title,
            track_year=track_year,
            track_key=track_feats.get("key", "unknown"),
            track_bpm=track_feats.get("bpm", 0),
            track_contour=track_feats.get("contour", "unknown"),
            era_context=era_context,
        )

        response = client.chat.completions.create(
            model=OPENAI_MODEL_ID,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=256,
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        logger.error("explain.generate() failed: %s", exc)
        return _rule_based_explanation(
            input_feats=input_feats,
            artist_name=artist_name,
            track_title=track_title,
            track_year=track_year,
            track_feats=track_feats,
        )
