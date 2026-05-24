from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import STATIC_PHOTOS_DIR

router = APIRouter()


@router.get("/photos/{filename}")
async def serve_photo(filename: str):
    path = STATIC_PHOTOS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Photo '{filename}' not found.")
    return FileResponse(str(path), media_type="image/jpeg")
