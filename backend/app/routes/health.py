from fastapi import APIRouter

from app.schemas.api import HealthResponse
from app.services import search

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok", corpus_size=search.corpus_size())
