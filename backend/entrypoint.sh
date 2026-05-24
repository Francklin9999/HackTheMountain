#!/bin/sh
set -e

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

echo "==> Starting Sillon API on port 8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level info
