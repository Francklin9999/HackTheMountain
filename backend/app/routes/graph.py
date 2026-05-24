from fastapi import APIRouter

from app.schemas.api import GraphEdge, GraphNode, GraphResponse
from app.services import artist_db

router = APIRouter()


@router.get("/graph", response_model=GraphResponse)
async def get_graph():
    ids = artist_db.list_all_ids()
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    seen: set[tuple[str, str]] = set()

    for artist_id in ids:
        doc = artist_db.get_artist(artist_id)
        if not doc:
            continue
        nodes.append(GraphNode(
            id=doc.get("id") or artist_id,
            name=doc["name"],
            born=doc["born"],
            died=doc["died"],
            era=doc["era"],
            photo_url=doc["photo_url"],
            track_count=len(doc.get("tracks", [])),
        ))
        for rel in doc.get("related", []):
            key = (artist_id, rel["id"])
            reverse = (rel["id"], artist_id)
            if key not in seen and reverse not in seen:
                seen.add(key)
                edges.append(GraphEdge(
                    source=artist_id,
                    target=rel["id"],
                    relation=rel["relation"],
                ))

    return GraphResponse(nodes=nodes, edges=edges)
