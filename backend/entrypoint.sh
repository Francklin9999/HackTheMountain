#!/bin/sh
set -e

# Seed empty bind-mount dirs from bundled copies.
# docker-compose mounts host dirs over /app/data and /app/static.
# On a fresh clone those host dirs are empty, so copy the image files in.
if [ -d /app/_bundled_data ] && [ -z "$(ls -A /app/data 2>/dev/null)" ]; then
  echo "==> Seeding /app/data from bundled image files..."
  mkdir -p /app/data
  cp -a /app/_bundled_data/* /app/data/
fi

if [ -d /app/_bundled_static ] && [ -z "$(ls -A /app/static 2>/dev/null)" ]; then
  echo "==> Seeding /app/static from bundled image files..."
  mkdir -p /app/static
  cp -a /app/_bundled_static/* /app/static/
fi

if [ -d /app/_bundled_cache ] && [ -z "$(ls -A /root/.cache/sillon 2>/dev/null)" ]; then
  echo "==> Seeding /root/.cache/sillon from build-time precompute..."
  mkdir -p /root/.cache/sillon
  cp -a /app/_bundled_cache/* /root/.cache/sillon/
fi

echo "==> Waiting for MongoDB to be ready..."
python - <<'PYEOF'
import os, sys, time
from pymongo import MongoClient

uri = os.environ.get("MONGODB_URI", "")
if not uri:
    print("   No MONGODB_URI set — will use JSON fallback.")
    sys.exit(0)

for attempt in range(30):
    try:
        MongoClient(uri, serverSelectionTimeoutMS=2000).server_info()
        print("   MongoDB ready.")
        sys.exit(0)
    except Exception as e:
        print(f"   [{attempt+1}/30] waiting... ({e})")
        time.sleep(2)

print("ERROR: MongoDB not reachable after 60s.")
sys.exit(1)
PYEOF

echo "==> Seeding MongoDB (skipped if already populated)..."
python -m pipeline.seed_mongo

BOOTSTRAP_ON_START="${BOOTSTRAP_ON_START:-missing}"

should_bootstrap=1
if [ "$BOOTSTRAP_ON_START" = "never" ]; then
  should_bootstrap=0
elif [ "$BOOTSTRAP_ON_START" = "missing" ]; then
  if python - <<'PYEOF'
from app.config import TRACK_FEATURE_CACHE_PATH
raise SystemExit(0 if TRACK_FEATURE_CACHE_PATH.exists() else 1)
PYEOF
  then
    should_bootstrap=0
  fi
fi

if [ "$should_bootstrap" -eq 1 ]; then
  echo "==> Preloading models and precomputing runtime caches..."
  python -m app.bootstrap
else
  echo "==> Reusing precomputed runtime caches."
fi

echo "==> Starting Sillon API on port 8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info
