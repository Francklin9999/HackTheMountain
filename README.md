# Sillon

Hum a melody into your phone and get matched to a forgotten Quebec folk artist from the 78rpm era.

Built for Hack the Mountain 2026 — **sound art** category.

---

## What it does

You hum, whistle, or sing a few bars. Sillon records it, extracts a musical fingerprint, and finds the closest match in a curated corpus of pre-1960 Quebec folk recordings sourced from Internet Archive and Library & Archives Canada's Virtual Gramophone. A short explanation tells you *why* the match was made — shared key, tempo, melodic contour. You can then explore the artist's other tracks and see how the whole corpus connects as a force-directed graph.

The goal is to make forgotten music discoverable through something as natural and ephemeral as humming.

---

## How it works

1. Browser records a short audio clip and sends it to the backend
2. [MERT](https://huggingface.co/m-a-p/MERT-v1-330M) (music encoder, 330M params) embeds the clip into a 1024-dim vector
3. FAISS nearest-neighbour search finds the top matches in the pre-built corpus index
4. librosa extracts key, BPM, and melodic contour for a secondary scoring pass
5. GPT-4o-mini writes a 2–3 sentence explanation of the musical connection
6. The frontend reveals the matched artist, plays the original recording, and updates the knowledge graph

---

## Stack

- **Backend** — FastAPI, MERT, FAISS, librosa, OpenAI API, MongoDB (falls back to JSON)
- **Frontend** — React + Vite, Zustand, Three.js (time-tunnel intro), D3 force-directed graph
- **Mobile** — Expo (React Native)

---

## Running locally

**Backend**

```bash
cd backend
cp .env.example .env        # add OPENAI_API_KEY
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

MERT (~1.3 GB) downloads automatically on first run.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## Corpus pipeline (one-time)

```bash
python -m pipeline.seed_wikidata   # fetch artists + download audio
python -m pipeline.restore         # noise-reduce and re-encode
python -m pipeline.embed_corpus    # build MERT embeddings + FAISS index
python -m pipeline.seed_mongo      # (optional) push to MongoDB
```

---

## Docker

```bash
cd backend
docker build -t sillon-backend .
docker run --env-file .env -p 8000:8000 sillon-backend
```
