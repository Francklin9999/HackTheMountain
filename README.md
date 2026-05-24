# Sillon

Hum a melody and get matched to a forgotten Quebec folk artist from the 78rpm era.

Built for Hack the Mountain 2026.

---

## How it works

1. You hum into the mic (or type a description / paste a song link)
2. The backend embeds the audio with [MERT](https://huggingface.co/m-a-p/MERT-v1-330M) and searches a FAISS index of corpus tracks
3. GPT-4o-mini writes a 2-3 sentence explanation of the musical connection
4. The frontend reveals the matched artist and plays the original recording

The corpus is sourced from Internet Archive (78rpm collection) and Library & Archives Canada's Virtual Gramophone.

---

## Stack

- **Backend** — FastAPI, MERT (music encoder), FAISS, librosa, OpenAI API, MongoDB (optional — falls back to a JSON file)
- **Frontend** — React + Vite, Zustand, Three.js (time tunnel scene), Force-directed graph

---

## Running locally

**Backend**

```bash
cd backend
cp .env.example .env        # fill in OPENAI_API_KEY at minimum
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The MERT model (~1.3 GB) downloads automatically on first startup.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## Pipeline scripts (one-time setup)

Run these in order if you want to rebuild the corpus from scratch:

```
python -m pipeline.seed_wikidata   # fetch artists from Wikidata + download audio
python -m pipeline.restore         # noise-reduce and re-encode audio
python -m pipeline.embed_corpus    # build MERT embeddings + FAISS index
python -m pipeline.seed_mongo      # (optional) push artists to MongoDB
```

---

## Docker

```bash
cd backend
docker build -t sillon-backend .
docker run --env-file .env -p 8000:8000 sillon-backend
```
