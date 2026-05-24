# syntax=docker/dockerfile:1
FROM python:3.11-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

# ── Stage 1a: install CPU-only PyTorch (runs in parallel with 1b) ────────────
FROM base AS torch-deps
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install \
    torch==2.2.2 torchaudio==2.2.2 \
    --index-url https://download.pytorch.org/whl/cpu

# ── Stage 1b: install everything except torch (runs in parallel with 1a) ─────
FROM base AS other-deps
COPY requirements.txt /tmp/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    grep -vE "^torch" /tmp/requirements.txt \
    | pip install -r /dev/stdin

# ── Merge both dependency trees ──────────────────────────────────────────────
FROM base AS runtime

COPY --from=torch-deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=torch-deps /usr/local/bin /usr/local/bin
COPY --from=other-deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=other-deps /usr/local/bin /usr/local/bin

ARG PRECOMPUTE_ON_BUILD=1
WORKDIR /app
COPY . .

RUN cp -a /app/data /app/_bundled_data \
    && cp -a /app/static /app/_bundled_static

RUN chmod 755 /app/entrypoint.sh

RUN if [ "$PRECOMPUTE_ON_BUILD" = "1" ]; then python -m app.bootstrap; fi

RUN if [ -d /root/.cache/sillon ]; then \
      cp -a /root/.cache/sillon /app/_bundled_cache; \
    fi

ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
