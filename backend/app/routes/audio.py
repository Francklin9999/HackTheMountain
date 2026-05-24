import os
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.config import STATIC_AUDIO_DIR

router = APIRouter()

_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


def _iter_file(path: str, start: int, end: int, chunk: int = 65536):
    with open(path, "rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            data = f.read(min(chunk, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data


@router.get("/audio/{filename}")
async def serve_audio(filename: str, request: Request):
    path = STATIC_AUDIO_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file '{filename}' not found.")

    file_size = os.path.getsize(path)
    range_header = request.headers.get("range")

    if not range_header:
        return FileResponse(str(path), media_type="audio/mpeg", headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        })

    m = _RANGE_RE.match(range_header)
    if not m:
        raise HTTPException(status_code=416, detail="Invalid Range header.")

    start_str, end_str = m.group(1), m.group(2)
    start = int(start_str) if start_str else 0
    end = int(end_str) if end_str else file_size - 1

    if start > end or end >= file_size:
        raise HTTPException(
            status_code=416,
            detail="Range not satisfiable.",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    length = end - start + 1
    return StreamingResponse(
        _iter_file(str(path), start, end),
        status_code=206,
        media_type="audio/mpeg",
        headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
        },
    )
