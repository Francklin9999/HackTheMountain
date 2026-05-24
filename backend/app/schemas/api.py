from typing import Optional

from pydantic import BaseModel


class Artist(BaseModel):
    id: str
    name: str
    born: int
    died: int
    region: str
    bio: str
    photo_url: str
    era: str
    source_url: Optional[str] = None
    source_label: Optional[str] = None


class Track(BaseModel):
    id: str
    title: str
    year: int
    audio_url: str
    duration_s: int


class MatchBreakdown(BaseModel):
    vibe: float
    key: float
    tempo: float
    contour: float


class Connection(BaseModel):
    score: float
    explanation: str
    shared_features: list[str]
    breakdown: Optional[MatchBreakdown] = None
    key_label: Optional[str] = None
    tempo_bpm: Optional[float] = None
    contour_label: Optional[str] = None
    mode_label: Optional[str] = None


class MatchResponse(BaseModel):
    artist: Artist
    track: Track
    connection: Connection


class RelatedArtist(BaseModel):
    id: str
    name: str
    relation: str


class ArtistResponse(BaseModel):
    artist: Artist
    related: list[RelatedArtist]
    tracks: list[Track]


class HealthResponse(BaseModel):
    status: str
    corpus_size: int


class GraphNode(BaseModel):
    id: str
    name: str
    born: int
    died: int
    era: str
    photo_url: str
    track_count: int


class GraphEdge(BaseModel):
    source: str
    target: str
    relation: str


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
