from fastapi import APIRouter, HTTPException

from app.schemas.api import Artist, ArtistResponse, RelatedArtist, Track
from app.services import artist_db

router = APIRouter()


def _doc_to_artist(doc: dict) -> Artist:
    return Artist(
        id=doc.get("id") or doc.get("_id", ""),
        name=doc["name"],
        born=doc["born"],
        died=doc["died"],
        region=doc["region"],
        bio=doc["bio"],
        photo_url=doc["photo_url"],
        era=doc["era"],
    )


@router.get("/artists/{artist_id}", response_model=ArtistResponse)
async def get_artist(artist_id: str):
    doc = artist_db.get_artist(artist_id)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Artist '{artist_id}' not found.")

    artist = _doc_to_artist(doc)

    related = [
        RelatedArtist(
            id=r["id"],
            name=r.get("name") or (artist_db.get_artist(r["id"]) or {}).get("name", r["id"]),
            relation=r["relation"],
        )
        for r in doc.get("related", [])
    ]

    tracks = [
        Track(
            id=t["id"],
            title=t["title"],
            year=t["year"],
            audio_url=t["audio_url"],
            duration_s=t["duration_s"],
        )
        for t in doc.get("tracks", [])
    ]

    return ArtistResponse(artist=artist, related=related, tracks=tracks)
