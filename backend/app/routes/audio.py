from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import STATIC_AUDIO_DIR

router = APIRouter()


@router.get("/audio/{filename}")
async def serve_audio(filename: str):
    path = STATIC_AUDIO_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file '{filename}' not found.")
    return FileResponse(str(path), media_type="audio/mpeg")
