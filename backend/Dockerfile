FROM python:3.11-slim

ARG PRECOMPUTE_ON_BUILD=1

WORKDIR /app

# Audio processing system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first so the heavy CUDA wheels are never pulled
RUN pip install --no-cache-dir \
    torch==2.2.2 torchaudio==2.2.2 \
    --index-url https://download.pytorch.org/whl/cpu

# Install remaining dependencies (skip torch lines already satisfied above)
COPY requirements.txt .
RUN grep -vE "^torch" requirements.txt \
    | pip install --no-cache-dir -r /dev/stdin

COPY . .

# Stage bundled data and static files so the entrypoint can seed empty
# bind-mount dirs on first run (docker-compose mounts override COPY'd files).
RUN cp -a /app/data /app/_bundled_data \
    && cp -a /app/static /app/_bundled_static

RUN chmod 755 /app/entrypoint.sh

RUN if [ "$PRECOMPUTE_ON_BUILD" = "1" ]; then python -m app.bootstrap; fi

# Stage the precomputed cache so it can seed the named volume on first run
RUN if [ -d /root/.cache/sillon ]; then \
      cp -a /root/.cache/sillon /app/_bundled_cache; \
    fi

ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
