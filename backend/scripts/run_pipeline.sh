#!/usr/bin/env bash
# Full data pipeline: scrape → restore → embed → seed
# Run from sillon-backend/ with the venv activated.
# Each step is idempotent — safe to re-run if a step fails mid-way.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=== Step 1: Scrape Internet Archive ==="
python -m pipeline.scrape_archive --out-dir static/audio/raw --limit 300

echo "=== Step 2: Scrape Virtual Gramophone bios ==="
python -m pipeline.scrape_gramophone

echo "=== Step 3: Restore audio (noisereduce + preemphasis) ==="
python -m pipeline.restore --in-dir static/audio/raw --out-dir static/audio

echo ""
echo ">>> MANUAL STEP 4: Curation <<<"
echo "    Listen to 30s of each file in static/audio/."
echo "    Delete weak or duplicate recordings."
echo "    Keep 80-100 with strongest emotional character."
echo "    Press ENTER when done …"
read -r

echo "=== Step 5: MERT sanity check (H2) ==="
echo "    Record 5 short hums (5-10s mono WAV) into /tmp/hums/."
echo "    Then run:"
echo "    python -m pipeline.sanity_mert --hums-dir /tmp/hums --corpus-dir static/audio"
echo ""

echo "=== Step 5b: Build FAISS index ==="
python -m pipeline.embed_corpus \
    --audio-dir static/audio \
    --meta-json data/corpus_meta.json \
    --index-out data/corpus.faiss \
    --artist-backup data/artists_backup.json

echo "=== Step 6: Seed MongoDB ==="
python -m pipeline.seed_mongo

echo "=== Pipeline complete ==="
echo "Start the server: uvicorn app.main:app --reload --port 8000"
