FROM python:3.11-slim

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

RUN chmod 755 /app/entrypoint.sh

ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
