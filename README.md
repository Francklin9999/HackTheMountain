# Sillon

Hum a melody into your phone and get matched to a forgotten Quebec folk artist from the 78rpm era.

Built for Hack the Mountain 2026 — **sound art** category.

---

## What it does

You hum, whistle, or sing a few bars. Sillon records it, extracts a musical fingerprint, and finds the closest match in a curated corpus of pre-1960 Quebec folk recordings sourced from Internet Archive and Library & Archives Canada's Virtual Gramophone. A short explanation tells you *why* the match was made — shared key, tempo, melodic contour. You can then explore the artist's other tracks and see how the whole corpus connects as a force-directed graph.

You can also type a description ("something slow and sad in minor key") or paste a song link — Sillon infers the musical features and matches from there.

---

## How it works

**Hum / whistle / sing** — the main path:
1. Browser records a short audio clip and sends it to the backend
2. [MERT](https://huggingface.co/m-a-p/MERT-v1-330M) (music encoder, 330M params) embeds the clip into a 1024-dim vector
3. FAISS nearest-neighbour search finds the top matches in the pre-built corpus index
4. librosa extracts key, BPM, and melodic contour for a secondary scoring pass
5. GPT-4o-mini writes a 2–3 sentence explanation of the musical connection
6. The frontend reveals the matched artist, plays the original recording, and updates the knowledge graph

**Text description or song link** — the assisted path:
1. [CLAP](https://huggingface.co/laion/clap-htsat-unfused) embeds your text directly into the same audio vector space as the corpus tracks
2. FAISS search finds the nearest audio matches using that text embedding — no feature guessing needed
3. If CLAP is unavailable, falls back to GPT-4o-mini extracting musical features (key, mode, BPM, contour) and brute-force scoring against the feature cache

---

## Stack

- **Backend** — FastAPI, MERT, CLAP, FAISS, librosa, OpenAI API, MongoDB (falls back to JSON)
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

MERT (~1.3 GB) and CLAP (~600 MB) download automatically on first run.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## Docker

Build and start everything (backend, frontend, MongoDB, mobile):

```bash
cp backend/.env.example backend/.env   # add OPENAI_API_KEY
docker compose up --build
```

The build uses multi-stage parallelism — torch and the other Python deps install concurrently. On a fresh clone the entrypoint seeds the audio, photos, and data files automatically from the image.

| Env var | Default | What it does |
|---|---|---|
| `PRECOMPUTE_ON_BUILD` | `1` | Bake models + FAISS indices + feature cache into the image |
| `BOOTSTRAP_ON_START` | `missing` | Re-run bootstrap at startup only if the cache is absent |
| `PRECOMPUTE_ON_BUILD=0` | — | Skip build-time precompute for a faster image build |

Services:

| Service | Port | URL |
|---|---|---|
| Frontend (nginx) | 3000 | `http://localhost:3000` |
| Backend API | 8000 | `http://localhost:8000` |
| MongoDB | 27018 | internal |
| Expo (mobile) | 8081 | QR code in terminal |

---

## Corpus pipeline (one-time)

Only needed if rebuilding the corpus from scratch:

```bash
python -m pipeline.seed_wikidata   # fetch artists + download audio
python -m pipeline.restore         # noise-reduce and re-encode
python -m pipeline.embed_corpus    # build MERT embeddings + FAISS index
python -m pipeline.seed_mongo      # (optional) push to MongoDB
```

---

## Data sources

- **Audio recordings** — [Internet Archive 78rpm collection](https://archive.org/details/78rpm) (public domain)
- **Artist metadata** — [Wikidata](https://www.wikidata.org/) (SPARQL queries for Quebec folk musicians)
- **Additional recordings & context** — [Virtual Gramophone](https://www.collectionscanada.gc.ca/gramophone/) by Library & Archives Canada
